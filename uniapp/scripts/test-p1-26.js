/**
 * P1-26 本地验收（离线，无需部署）
 * 覆盖：内容监管域 GET /moderation/list、POST /review、POST /take-down、POST /restore、POST /delete
 *       鉴权（无 token 401 / 学生通道 403 / viewer 403）、动态流/疑似队列/已下架/回收站视图、
 *       关键词子串 + 正则转义、分页 has_more、疑似复核（clear / take_down + 通知负责人）、
 *       下架幂等与通知、恢复（下架恢复 / 误删还原）、删除软删可还原、落库口径与消息去重
 * 运行：node scripts/test-p1-26.js
 */
'use strict'
const path = require('path')

process.env.NODE_PATH = path.join(__dirname, '..', 'uniCloud-aliyun', 'cloudfunctions', 'common')
require('module').Module._initPaths()
process.env.CLUBHUB_JWT_SECRET = 'clubhub-test-secret'

const club = require('../uniCloud-aliyun/cloudfunctions/common/club-common')

let passed = 0
let failed = 0
function assert(name, cond, detail = '') {
  if (cond) {
    passed++
    console.log(`  ✔ ${name}`)
  } else {
    failed++
    console.log(`  ✘ FAIL ${name} ${detail}`)
  }
}

/* ---------- 集合 stub ---------- */
let seq = 0
const stores = { admins: require('./helpers/admin-fixtures').createAdminFixtures(), club_posts: [], clubs: [], club_members: [], messages: [], sensitive_words: [] }

function matchCond(row, cond) {
  if (cond && cond.__and) return cond.__and.every((item) => matchCond(row, item))
  if (cond && cond.__or) return cond.__or.some((item) => matchCond(row, item))
  return Object.keys(cond).every((key) => {
    const want = cond[key]
    if (want instanceof RegExp) return want.test(String(row[key] == null ? '' : row[key]))
    if (want && typeof want === 'object') {
      if (Object.prototype.hasOwnProperty.call(want, '__in')) return want.__in.indexOf(row[key]) !== -1
      if (Object.prototype.hasOwnProperty.call(want, '__neq')) return row[key] !== want.__neq
      if (Object.prototype.hasOwnProperty.call(want, '__gte')) return new Date(row[key]).getTime() >= new Date(want.__gte).getTime()
      if (Object.prototype.hasOwnProperty.call(want, '__lte')) return new Date(row[key]).getTime() <= new Date(want.__lte).getTime()
    }
    return row[key] === want
  })
}

function makeQuery(rows) {
  let result = rows
  const query = {
    where: (cond) => {
      result = result.filter((row) => matchCond(row, cond))
      return query
    },
    field: () => query,
    orderBy: (field, dir) => {
      result = result.slice().sort((a, b) => {
        const av = a[field]
        const bv = b[field]
        if (typeof av === 'number' && typeof bv === 'number') return dir === 'desc' ? bv - av : av - bv
        const at = new Date(av).getTime()
        const bt = new Date(bv).getTime()
        return dir === 'desc' ? bt - at : at - bt
      })
      return query
    },
    skip: (n) => {
      result = result.slice(n)
      return query
    },
    limit: (n) => {
      result = result.slice(0, n)
      return query
    },
    get: async () => ({ data: result.slice() }),
    count: async () => ({ total: result.length }),
    update: async (patch) => {
      result.forEach((row) => Object.assign(row, patch))
      return { updated: result.length }
    },
  }
  return query
}

function collectionFor(name) {
  const rowsOf = () => stores[name] || []
  return {
    where: (cond) => makeQuery(rowsOf().filter((row) => matchCond(row, cond))),
    add: async (doc) => {
      const list = Array.isArray(doc) ? doc : [doc]
      let lastId = ''
      list.forEach((item) => {
        lastId = `${name}-${++seq}`
        stores[name].push({ _id: lastId, ...item })
      })
      return { id: lastId, inserted: list.length }
    },
    doc: (id) => ({
      update: async (patch) => {
        const row = rowsOf().find((item) => item._id === id)
        if (!row) return { updated: 0 }
        Object.assign(row, patch)
        return { updated: 1 }
      },
    }),
  }
}

global.uniCloud = {
  database: () => ({
    collection: collectionFor,
    command: {
      and: (list) => ({ __and: list }),
      or: (list) => ({ __or: list }),
      in: (list) => ({ __in: list }),
      neq: (value) => ({ __neq: value }),
      gte: (value) => ({ __gte: value }),
      lte: (value) => ({ __lte: value }),
      aggregate: { sum: (value) => ({ __sum: value }) },
    },
  }),
  httpclient: { request: async () => ({ data: { access_token: 'T', expires_in: 7200 } }) },
}

/* ---------- 种子数据 ---------- */
const DAY = 24 * 3600 * 1000
const now = Date.now()
const at = (ms) => new Date(ms)

stores.clubs.push(
  { _id: 'club-a', name: '天文社', status: 'normal', deleted: 0 },
  { _id: 'club-b', name: '街舞社', status: 'banned', deleted: 0 }
)
stores.club_members.push(
  { _id: 'm-1', club_id: 'club-a', user_id: 'u-1', role: 'president', status: 'active', deleted: 0 },
  { _id: 'm-2', club_id: 'club-a', user_id: 'u-2', role: 'officer', status: 'active', deleted: 0 },
  { _id: 'm-3', club_id: 'club-a', user_id: 'u-3', role: 'member', status: 'active', deleted: 0 }
)
function seedPost(id, clubId, content, opt = {}) {
  stores.club_posts.push({
    _id: id,
    club_id: clubId,
    content,
    images: opt.images || [],
    status: opt.status || 'published',
    flagged: !!opt.flagged,
    published_at: opt.published_at || at(now - (opt.days || 1) * DAY),
    deleted: opt.deleted === undefined ? 0 : opt.deleted,
    created_at: at(now - (opt.days || 1) * DAY),
  })
}
seedPost('p-1', 'club-a', '今晚观星活动欢迎参加', { days: 10 })
seedPost('p-2', 'club-a', '疑似违规代考广告', { days: 5, flagged: true })
seedPost('p-3', 'club-b', '已下架动态测试', { days: 3, status: 'taken_down' })
seedPost('p-4', 'club-a', '已删除动态', { days: 2, deleted: 1 })
seedPost('p-5', 'club-a', '带点号 a.b 的词', { days: 1 })

const fn = require('../uniCloud-aliyun/cloudfunctions/moderation/index.js')

function adminToken(role) {
  return club.signToken({ type: club.TOKEN_TYPES.ADMIN, adminId: { super: 'a-1', auditor: 'a-2', viewer: 'a-3' }[role], username: 'root', role, name: '超管' })
}
const studentToken = club.signToken({
  type: club.TOKEN_TYPES.STUDENT,
  token_kind: 'access',
  userId: 'u-9',
  openid: 'openid-9',
  auth_status: 'verified',
})

async function call({ method = 'GET', path = '/list', qs = {}, body = null, token = null }) {
  const headers = { 'content-type': 'application/json' }
  if (token) headers.authorization = `Bearer ${token}`
  const res = await fn.main({
    httpMethod: method,
    path,
    headers,
    body: body ? JSON.stringify(body) : '',
    queryStringParameters: qs,
  })
  const payload = JSON.parse(res.body)
  return { statusCode: res.statusCode, payload, code: payload.code, data: payload.data, message: payload.message }
}

async function main() {
  console.log('\n【GET /moderation/list · 鉴权】')
  let r = await call({})
  assert('无 token → 401', r.code === 401, JSON.stringify(r))

  r = await call({ token: studentToken })
  assert('学生 token → 403（通道不匹配）', r.code === 403, JSON.stringify(r))

  r = await call({ token: adminToken('viewer') })
  assert('viewer 角色 → 403', r.code === 403, JSON.stringify(r))

  console.log('\n【GET /moderation/list · 视图 / 分页 / 关键词】')
  r = await call({ token: adminToken('super') })
  assert('动态流（all）= 5 条全量（含回收）', r.code === 0 && r.data.total === 5 && r.data.list.length === 5, JSON.stringify(r.data))
  assert('join 社团名（天文社）', r.data.list.find((p) => p._id === 'p-1').club_name === '天文社', JSON.stringify(r.data.list[0]))

  r = await call({ token: adminToken('super'), qs: { view: 'flagged' } })
  assert('疑似队列 = 仅 p-2（flagged 且未删）', r.data.total === 1 && r.data.list[0]._id === 'p-2' && r.data.list[0].flagged === true, JSON.stringify(r.data))

  r = await call({ token: adminToken('super'), qs: { view: 'taken_down' } })
  assert('已下架视图 = 仅 p-3', r.data.total === 1 && r.data.list[0]._id === 'p-3', JSON.stringify(r.data))

  r = await call({ token: adminToken('super'), qs: { view: 'deleted' } })
  assert('回收站视图 = 仅 p-4（deleted=1）', r.data.total === 1 && r.data.list[0]._id === 'p-4' && r.data.list[0].deleted === 1, JSON.stringify(r.data))

  r = await call({ token: adminToken('super'), qs: { view: 'bad' } })
  assert('非法 view → 1001', r.code === 1001, JSON.stringify(r))

  r = await call({ token: adminToken('super'), qs: { keyword: '观星' } })
  assert('关键词命中 p-1', r.data.total === 1 && r.data.list[0]._id === 'p-1', JSON.stringify(r.data))

  r = await call({ token: adminToken('super'), qs: { keyword: 'a.b' } })
  assert("keyword='a.b' 精确命中 p-5 不误伤（元字符转义）", r.data.total === 1 && r.data.list[0]._id === 'p-5', JSON.stringify(r.data))

  r = await call({ token: adminToken('super'), qs: { page_size: '1' } })
  assert('page_size=1 → has_more=true 第一页 1 条', r.data.list.length === 1 && r.data.has_more === true, JSON.stringify(r.data))
  r = await call({ token: adminToken('super'), qs: { page_size: '0' } })
  assert('page_size=0 → 1001', r.code === 1001, JSON.stringify(r))

  console.log('\n【POST /moderation/review · 疑似复核】')
  r = await call({ method: 'POST', path: '/review', body: { post_id: 'p-2', action: 'clear' }, token: adminToken('super') })
  assert('合规复核 → 移除疑似标记、保持发布', r.code === 0 && r.data.post.flagged === false && r.data.post.status === 'published', JSON.stringify(r.data))

  r = await call({ method: 'POST', path: '/review', body: { post_id: 'p-2', action: 'clear' }, token: adminToken('super') })
  assert('非疑似动态再复核 → 1002（状态不允许）', r.code === 1002, JSON.stringify(r))

  seedPost('p-6', 'club-a', '新的疑似词条', { days: 0, flagged: true })
  r = await call({ method: 'POST', path: '/review', body: { post_id: 'p-6', action: 'take_down' }, token: adminToken('super') })
  assert('违规复核 → 下架 + 通知社团负责人', r.code === 0 && r.data.post.status === 'taken_down' && r.data.notified.sent === 2 && r.data.notified.officers === 2, JSON.stringify(r.data))

  console.log('\n【POST /moderation/take-down · 下架 + 通知】')
  r = await call({ method: 'POST', path: '/take-down', body: { post_id: 'p-1' }, token: adminToken('super') })
  assert('下架 p-1 → status=taken_down + 通知 2 名负责人', r.code === 0 && r.data.post.status === 'taken_down' && r.data.notified.sent === 2, JSON.stringify(r.data))

  r = await call({ method: 'POST', path: '/take-down', body: { post_id: 'p-1' }, token: adminToken('super') })
  assert('已下架再下架 → 1002', r.code === 1002, JSON.stringify(r))

  r = await call({ method: 'POST', path: '/take-down', body: { post_id: 'p-4' }, token: adminToken('super') })
  assert('对已删除动态下架 → 404', r.code === 404, JSON.stringify(r))

  console.log('\n【POST /moderation/restore · 恢复】')
  r = await call({ method: 'POST', path: '/restore', body: { post_id: 'p-1' }, token: adminToken('super') })
  assert('下架恢复 → published + 清除疑似 + deleted=0', r.code === 0 && r.data.post.status === 'published' && r.data.post.flagged === false && r.data.post.deleted === 0 && r.data.restored_from_deleted === false, JSON.stringify(r.data))

  r = await call({ method: 'POST', path: '/restore', body: { post_id: 'p-4' }, token: adminToken('super') })
  assert('回收站还原 → published + deleted=0（restored_from_deleted=true）', r.code === 0 && r.data.post.status === 'published' && r.data.post.deleted === 0 && r.data.restored_from_deleted === true, JSON.stringify(r.data))

  r = await call({ method: 'POST', path: '/restore', body: { post_id: 'p-3' }, token: adminToken('super') })
  assert('已下架 p-3 恢复 → published', r.code === 0 && r.data.post.status === 'published', JSON.stringify(r.data))

  r = await call({ method: 'POST', path: '/restore', body: { post_id: 'p-1' }, token: adminToken('super') })
  assert('已是发布态再恢复 → 1002', r.code === 1002, JSON.stringify(r))

  console.log('\n【POST /moderation/delete · 删除（软删可还原）】')
  r = await call({ method: 'POST', path: '/delete', body: { post_id: 'p-2' }, token: adminToken('super') })
  assert('删除 p-2 → deleted=1', r.code === 0 && r.data.post.deleted === 1, JSON.stringify(r.data))

  r = await call({ method: 'POST', path: '/delete', body: { post_id: 'p-2' }, token: adminToken('super') })
  assert('重复删除 → 1002', r.code === 1002, JSON.stringify(r))

  r = await call({ method: 'POST', path: '/delete', body: { post_id: 'p-9' }, token: adminToken('super') })
  assert('删除不存在动态 → 404', r.code === 404, JSON.stringify(r))

  console.log('\n【落库口径 / 通知去重】')
  const alive = stores.club_posts.filter((p) => p.deleted === 0 && p.status === 'published' && !p.flagged).map((p) => p._id).sort()
  assert('有效发布且无疑似标记 = p-1,p-3,p-4,p-5（p-2 已删）', alive.join(',') === 'p-1,p-3,p-4,p-5', alive.join(','))
  const messages = stores.messages
  assert('站内通知写入 4 条（p-1/p-6 各通知 2 名负责人，去重不重复）', messages.length === 4, JSON.stringify(messages.map((m) => m.scene)))
  assert('通知场景均为 club_post_taken_down 且 biz_type=post', messages.every((m) => m.scene === 'club_post_taken_down' && m.biz_type === 'post'), JSON.stringify(messages[0]))
  const sceneRows = stores.messages.map((m) => `${m.user_id}:${m.biz_id}`).sort()
  assert('去重键 user+post：u-1/u-2 × p-1、p-6 各一条', sceneRows.join(',') === 'u-1:p-1,u-1:p-6,u-2:p-1,u-2:p-6', sceneRows.join(','))

  /* ---------- 汇总 ---------- */
  console.log(`\n结果：${passed} 通过，${failed} 失败`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})