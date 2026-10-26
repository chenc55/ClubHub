/**
 * P2-02 本地验收（离线，无需部署）
 * 覆盖：公告管理 ADM-06 全链路
 *   - 管理通道鉴权：无 token 401 / viewer 403 / auditor·super 可发布、列表、下架、上传
 *   - 发布：published 落库 + 全体已认证未禁用用户收到站内通知（announcement_published 场景）
 *   - 敏感词先审后发：命中 block / review 一律拦截
 *   - 参数校验：空标题 / 空内容 / 标题超长 / banner 非 URL 拦截
 *   - 列表：分页 + 状态筛选 + 关键词 + 发布人 join
 *   - 下架：status=offline（幂等）、实时移出 Banner（home 读库口径 = 详情不可见 / published 筛选不含）
 *   - 详情：公开可看（游客），仅 published 可见
 *   - Banner 上传：scene 校验 + 管理通道
 * 运行：node scripts/test-p2-02.js
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
const stores = { announcements: [], users: [], admins: [], messages: [], sensitive_words: [] }

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

stores.sensitive_words.push(
  { _id: 'sw-1', word: '代考', level: 'block', deleted: 0 },
  { _id: 'sw-2', word: '烟花', level: 'review', deleted: 0 }
)
stores.users.push(
  { _id: 'u-1', name: '甲', auth_status: 'verified', status: 'normal', deleted: 0 },
  { _id: 'u-2', name: '乙', auth_status: 'verified', status: 'normal', deleted: 0 },
  { _id: 'u-3', name: '丙（未认证）', auth_status: 'unverified', status: 'normal', deleted: 0 },
  { _id: 'u-4', name: '丁（禁用）', auth_status: 'verified', status: 'disabled', deleted: 0 },
  { _id: 'u-5', name: '戊（软删）', auth_status: 'verified', status: 'normal', deleted: 1 }
)
stores.admins.push(
  { _id: 'a-super', username: 'root', name: '超管', role: 'super', status: 'normal', deleted: 0 },
  { _id: 'a-aud', username: 'auditor1', name: '审核员', role: 'auditor', status: 'normal', deleted: 0 },
  { _id: 'a-view', username: 'viewer1', name: '数据员', role: 'viewer', status: 'normal', deleted: 0 }
)
// 预置 1 条已下架公告（状态筛选用）
stores.announcements.push({
  _id: 'ann-0',
  title: '旧公告（已下架）',
  content: '历史公告',
  banner: '',
  status: 'offline',
  publisher: 'a-super',
  published_at: at(now - 3 * DAY),
  created_at: at(now - 3 * DAY),
  deleted: 0,
})

const fn = require('../uniCloud-aliyun/cloudfunctions/announcement/index.js')

function adminToken(adminRow) {
  return club.signToken({
    type: club.TOKEN_TYPES.ADMIN,
    adminId: adminRow._id,
    username: adminRow.username,
    role: adminRow.role,
    name: adminRow.name || '',
  })
}
const superToken = adminToken(stores.admins[0])
const audToken = adminToken(stores.admins[1])
const viewToken = adminToken(stores.admins[2])

async function call({ method = 'GET', path, qs = {}, body = null, token = null }) {
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

function messagesOf(userId) {
  return stores.messages.filter((m) => m.user_id === userId && m.scene === 'announcement_published')
}

async function main() {
  console.log('\n【GET /ping · 健康检查】')
  let r = await call({ path: '/ping' })
  assert('公开 ping → 200', r.code === 0 && r.data.pong === 'announcement', JSON.stringify(r))

  console.log('\n【管理通道鉴权】')
  r = await call({ method: 'POST', path: '/publish', body: { title: '通知', content: '内容' } })
  assert('发布无 token → 401', r.code === 401, JSON.stringify(r))
  r = await call({ method: 'POST', path: '/publish', body: { title: '通知', content: '内容' }, token: viewToken })
  assert('发布 viewer → 403（仅 super / auditor）', r.code === 403, JSON.stringify(r))
  r = await call({ path: '/list', token: viewToken })
  assert('列表 viewer → 403', r.code === 403, JSON.stringify(r))
  r = await call({ method: 'POST', path: '/offline', body: { id: 'ann-x' }, token: viewToken })
  assert('下架 viewer → 403', r.code === 403, JSON.stringify(r))
  r = await call({ method: 'POST', path: '/upload', body: { scene: 'announcement_banner', base64: 'eA==' }, token: viewToken })
  assert('上传 viewer → 403', r.code === 403, JSON.stringify(r))

  console.log('\n【POST /publish · 敏感词先审后发】')
  r = await call({ method: 'POST', path: '/publish', body: { title: '诚信考试倡议', content: '请勿代考' }, token: superToken })
  assert('block 词「代考」→ 拦截 1001', r.code === 1001 && r.message.indexOf('违规词') !== -1, JSON.stringify(r))
  r = await call({ method: 'POST', path: '/publish', body: { title: '迎新晚会预告', content: '操场烟花秀' }, token: audToken })
  assert('review 词「烟花」→ 同样拦截 1001（先审后发命中任一等级即拦）', r.code === 1001, JSON.stringify(r))

  console.log('\n【POST /publish · 参数校验】')
  r = await call({ method: 'POST', path: '/publish', body: { title: '  ', content: '内容' }, token: superToken })
  assert('空白标题 → 1001', r.code === 1001, JSON.stringify(r))
  r = await call({ method: 'POST', path: '/publish', body: { title: '标题', content: '  ' }, token: superToken })
  assert('空白内容 → 1001', r.code === 1001, JSON.stringify(r))
  r = await call({ method: 'POST', path: '/publish', body: { title: '长'.repeat(61), content: '内容' }, token: superToken })
  assert('标题超长（61 字）→ 1001', r.code === 1001, JSON.stringify(r))
  r = await call({ method: 'POST', path: '/publish', body: { title: '标题', content: '内容', banner: 'not-a-url' }, token: superToken })
  assert('Banner 非 URL → 1001', r.code === 1001, JSON.stringify(r))

  console.log('\n【POST /publish · 正常发布 + 通知】')
  r = await call({
    method: 'POST',
    path: '/publish',
    body: { title: '关于国庆假期安排的通知', content: '国庆假期 10 月 1 日至 7 日放假，社团活动暂停，请注意安排。', banner: 'https://cdn.example.com/banner/ann1.jpg' },
    token: audToken,
  })
  assert('auditor 发布 → 成功，status=published、publisher=审核员、banner 落库', r.code === 0 && r.data.status === 'published' && r.data._id, JSON.stringify(r.data))
  const annId = r.data._id
  const row1 = stores.announcements.find((a) => a._id === annId)
  assert('落库字段完整（publisher / published_at / deleted=0）', row1.publisher === 'a-aud' && !!row1.published_at && row1.deleted === 0, JSON.stringify(row1))
  assert('通知已认证正常用户 2 人（甲 / 乙）', r.data.recipients === 2 && r.data.notified === 2, JSON.stringify(r.data))
  assert('u-1 收到 announcement_published 站内消息（含标题 / 摘要 / biz_id）', messagesOf('u-1').length === 1 && messagesOf('u-1')[0].biz_id === annId && messagesOf('u-1')[0].title.indexOf('国庆') !== -1, JSON.stringify(messagesOf('u-1')))
  assert('u-2 同样收到', messagesOf('u-2').length === 1, JSON.stringify(messagesOf('u-2')))
  assert('未认证 / 禁用 / 软删用户不收', messagesOf('u-3').length === 0 && messagesOf('u-4').length === 0 && messagesOf('u-5').length === 0, JSON.stringify({ u3: messagesOf('u-3').length, u4: messagesOf('u-4').length, u5: messagesOf('u-5').length }))

  // 二次发布：新公告 id → 每个用户去重键不同，仍各收 1 条（累计 2 条）
  r = await call({ method: 'POST', path: '/publish', body: { title: '社团嘉年华报名开启', content: '本周六社团嘉年华，欢迎同学们报名参加。' }, token: superToken })
  assert('super 发布第二则公告 → 成功', r.code === 0, JSON.stringify(r))
  assert('同用户不同公告各收 1 条（去重键 scene+announcement_id）', messagesOf('u-1').length === 2, JSON.stringify(messagesOf('u-1').length))
  const ann2 = r.data._id

  console.log('\n【GET /list · 分页 / 状态筛选 / 关键词 / 发布人】')
  r = await call({ path: '/list', token: superToken })
  assert('列表（all）= 3 条（2 published + 1 offline），created_at 倒序', r.code === 0 && r.data.total === 3 && r.data.list.length === 3 && r.data.list[0]._id === ann2, JSON.stringify({ total: r.data.total, first: r.data.list[0] && r.data.list[0]._id }))
  const joined = r.data.list.find((i) => i._id === annId)
  assert('列表 join 发布人姓名（审核员）', joined && joined.publisher_name === '审核员', JSON.stringify(joined))
  r = await call({ path: '/list', qs: { status: 'published' }, token: superToken })
  assert('筛选 published = 2 条', r.data.total === 2, JSON.stringify(r.data.total))
  r = await call({ path: '/list', qs: { status: 'offline' }, token: superToken })
  assert('筛选 offline = 1 条', r.data.total === 1 && r.data.list[0].status === 'offline', JSON.stringify(r.data))
  r = await call({ path: '/list', qs: { keyword: '国庆' }, token: superToken })
  assert('关键词「国庆」→ 命中 1 条', r.data.total === 1 && r.data.list[0].title.indexOf('国庆') !== -1, JSON.stringify(r.data))
  r = await call({ path: '/list', qs: { page: 2, page_size: 2 }, token: superToken })
  assert('分页第 2 页（page_size=2）→ 剩 1 条', r.data.total === 3 && r.data.list.length === 1, JSON.stringify({ total: r.data.total, len: r.data.list.length }))
  r = await call({ path: '/list', qs: { status: 'bogus' }, token: superToken })
  assert('非法状态值 → 1001', r.code === 1001, JSON.stringify(r))

  console.log('\n【GET /detail · 公开可见性】')
  r = await call({ path: '/detail', qs: { id: annId } })
  assert('已发布公告游客可见 → 200，含标题 / 内容 / Banner', r.code === 0 && r.data.title === '关于国庆假期安排的通知' && r.data.banner === 'https://cdn.example.com/banner/ann1.jpg', JSON.stringify(r.data))
  r = await call({ path: '/detail', qs: { id: 'ann-0' } })
  assert('已下架公告详情 → 404', r.code === 404, JSON.stringify(r))
  r = await call({ path: '/detail', qs: { id: 'ann-none' } })
  assert('不存在公告详情 → 404', r.code === 404, JSON.stringify(r))
  r = await call({ path: '/detail', qs: {} })
  assert('缺少 id → 1001', r.code === 1001, JSON.stringify(r))

  console.log('\n【POST /offline · 下架与实时移出】')
  r = await call({ method: 'POST', path: '/offline', body: { id: annId }, token: audToken })
  assert('auditor 下架 → status=offline', r.code === 0 && r.data.status === 'offline', JSON.stringify(r.data))
  r = await call({ method: 'POST', path: '/offline', body: { id: annId }, token: audToken })
  assert('重复下架幂等 → 成功 + already=true', r.code === 0 && r.data.already === true, JSON.stringify(r.data))
  r = await call({ method: 'POST', path: '/offline', body: { id: 'ann-none' }, token: audToken })
  assert('下架不存在公告 → 404', r.code === 404, JSON.stringify(r))
  r = await call({ path: '/detail', qs: { id: annId } })
  assert('下架后学生端详情 → 404（实时移出 Banner 口径）', r.code === 404, JSON.stringify(r))
  r = await call({ path: '/list', qs: { status: 'published' }, token: superToken })
  assert('下架后 published 列表不含该公告', r.data.list.every((item) => item._id !== annId), JSON.stringify(r.data.list.map((i) => i._id)))

  console.log('\n【POST /upload · Banner 上传】')
  r = await call({ method: 'POST', path: '/upload', body: { scene: 'moments', base64: 'eA==' }, token: superToken })
  assert('非公告场景 → 1001', r.code === 1001, JSON.stringify(r))
  r = await call({ method: 'POST', path: '/upload', body: { scene: 'announcement_banner', base64: 'eA==', filename: 'x.gif', mime: 'image/gif' }, token: superToken })
  assert('GIF 非公告格式 → 1001（仅 jpg/jpeg/png/webp）', r.code === 1001, JSON.stringify(r))

  /* ---------- 汇总 ---------- */
  console.log(`\n结果：${passed} 通过，${failed} 失败`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
