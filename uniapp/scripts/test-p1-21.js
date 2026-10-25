/**
 * P1-21 本地验收（离线，无需部署）
 * 覆盖：消息列表（无 token 401 / type 过滤 / 分页 / 时间倒序 / unread_total / 用户隔离）、
 *       单条已读（权限 / 归属 404 / 幂等 / 未读数联动）、
 *       全部已读（按分类 / 全量）、未读数（分类计数）、空数据
 * 运行：node scripts/test-p1-21.js
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

/* ---------- 集合 stub（含 aggregate：match + group + end） ---------- */
let seq = 0
const stores = { messages: [], users: [], sensitive_words: [] }

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
      if (Object.prototype.hasOwnProperty.call(want, '__lt')) return new Date(row[key]).getTime() < new Date(want.__lt).getTime()
      if (Object.prototype.hasOwnProperty.call(want, '__gt')) return new Date(row[key]).getTime() > new Date(want.__gt).getTime()
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

function aggregateFor(rows) {
  let match = null
  let group = null
  const agg = {
    match: (cond) => {
      match = cond
      return agg
    },
    group: (spec) => {
      group = spec
      return agg
    },
    end: async () => {
      let list = rows.slice()
      if (match) list = list.filter((row) => matchCond(row, match))
      if (!group) return { data: list }
      const keyField = String(group._id).replace(/^\$/, '')
      const sumField = Object.keys(group).find((k) => k !== '_id')
      const sumValue = group[sumField] && group[sumField].__sum
      const map = new Map()
      for (const row of list) {
        const key = row[keyField] == null ? null : row[keyField]
        const cur = map.get(key) || { _id: key, [sumField]: 0 }
        cur[sumField] += typeof sumValue === 'number' ? sumValue : 1
        map.set(key, cur)
      }
      return { data: Array.from(map.values()) }
    },
  }
  return agg
}

function collectionFor(name) {
  const rowsOf = () => stores[name] || []
  return {
    where: (cond) => makeQuery(rowsOf().filter((row) => matchCond(row, cond))),
    aggregate: () => aggregateFor(rowsOf()),
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
      lt: (value) => ({ __lt: value }),
      gt: (value) => ({ __gt: value }),
      aggregate: { sum: (value) => ({ __sum: value }) },
    },
  }),
  httpclient: { request: async () => ({ data: { access_token: 'T', expires_in: 7200 } }) },
}

/* ---------- 种子数据 ---------- */
const HOUR = 3600 * 1000
const DAY = 24 * HOUR
const now = Date.now()

const uA = { _id: 'u-a', openid: 'openid-a', name: '林同学', status: 'normal', deleted: 0 }
const uB = { _id: 'u-b', openid: 'openid-b', name: '陈同学', status: 'normal', deleted: 0 }
stores.users.push(uA, uB)

const msg = (id, userId, type, isRead, createdMs, over = {}) => ({ _id: id, user_id: userId, type, scene: `scene_${id}`, title: `标题${id}`, content: `内容${id}`, biz_type: '', biz_id: '', is_read: isRead, created_at: new Date(createdMs), deleted: 0, ...over })
stores.messages.push(
  msg('m1', uA._id, 'activity', false, now - 1 * HOUR, { biz_type: 'activity', biz_id: 'act-1' }),
  msg('m2', uA._id, 'activity', true, now - 2 * HOUR, { biz_type: 'activity', biz_id: 'act-2' }),
  msg('m3', uA._id, 'recruitment', false, now - 3 * HOUR, { biz_type: 'recruitment', biz_id: 'rc-1' }),
  msg('m4', uA._id, 'system', false, now - 1 * DAY, { biz_type: 'club', biz_id: '' }),
  msg('m5', uA._id, 'system', true, now - 2 * DAY, { biz_type: 'announcement', biz_id: 'ann-1' }),
  msg('m6', uA._id, 'recruitment', true, now - 3 * DAY, { biz_type: 'recruitment', biz_id: 'rc-2' }),
  msg('m7', uB._id, 'activity', false, now - 1 * HOUR)
)

const msgFn = require('../uniCloud-aliyun/cloudfunctions/message/index.js')

function studentToken(userRow) {
  return club.signToken({
    type: club.TOKEN_TYPES.STUDENT,
    token_kind: 'access',
    userId: userRow._id,
    openid: userRow.openid,
    auth_status: 'verified',
  })
}

async function call(pathname, { method = 'GET', body, query, token } = {}) {
  const headers = { 'content-type': 'application/json' }
  if (token) headers.authorization = `Bearer ${token}`
  const res = await msgFn.main({
    httpMethod: method,
    path: pathname.replace(/^\/message/, ''),
    headers,
    body: body ? JSON.stringify(body) : '',
    queryStringParameters: query || {},
  })
  return { statusCode: res.statusCode, payload: JSON.parse(res.body) }
}

const byId = (id) => stores.messages.find((x) => x._id === id)

async function main() {
  /* ---------- 1. 消息列表 ---------- */
  console.log('\n【GET /list】')
  let r = await call('/list', { method: 'GET', query: { type: 'all' } })
  assert('无 token → 401', r.payload.code === 401, JSON.stringify(r.payload))

  r = await call('/list', { method: 'GET', query: { type: 'bad' }, token: studentToken(uA) })
  assert('type 非法 → 1001', r.payload.code === 1001, JSON.stringify(r.payload))

  r = await call('/list', { method: 'GET', query: { page: 0 }, token: studentToken(uA) })
  assert('page 非法 → 1001', r.payload.code === 1001, JSON.stringify(r.payload))

  r = await call('/list', { method: 'GET', query: { type: 'all' }, token: studentToken(uA) })
  assert('all：total=6 且时间倒序 + unread_total=3', r.payload.code === 0 && r.payload.data.total === 6 && r.payload.data.list[0]._id === 'm1' && r.payload.data.unread_total === 3, JSON.stringify(r.payload.data).slice(0, 160))

  r = await call('/list', { method: 'GET', query: { type: 'activity' }, token: studentToken(uA) })
  assert('type=activity 过滤 → 仅 m1/m2', r.payload.code === 0 && r.payload.data.total === 2 && r.payload.data.list.map((m) => m._id).join(',') === 'm1,m2', JSON.stringify(r.payload.data.list.map((m) => m._id)))

  r = await call('/list', { method: 'GET', query: { type: 'all', page: 1, page_size: 2 }, token: studentToken(uA) })
  assert('分页 page_size=2 → 2 条 + has_more', r.payload.code === 0 && r.payload.data.list.length === 2 && r.payload.data.has_more === true, JSON.stringify(r.payload.data).slice(0, 120))

  r = await call('/list', { method: 'GET', query: { type: 'all' }, token: studentToken(uB) })
  assert('用户隔离：uB 只有自己的 1 条', r.payload.code === 0 && r.payload.data.total === 1 && r.payload.data.list[0]._id === 'm7' && r.payload.data.unread_total === 1, JSON.stringify(r.payload.data).slice(0, 120))

  /* ---------- 2. 单条已读 ---------- */
  console.log('\n【POST /read】')
  r = await call('/read', { method: 'POST', body: { message_id: 'm1' } })
  assert('无 token → 401', r.payload.code === 401, JSON.stringify(r.payload))

  r = await call('/read', { method: 'POST', body: {}, token: studentToken(uA) })
  assert('缺 message_id → 1001', r.payload.code === 1001, JSON.stringify(r.payload))

  r = await call('/read', { method: 'POST', body: { message_id: 'm7' }, token: studentToken(uA) })
  assert('读别人的消息 → 404', r.payload.code === 404, JSON.stringify(r.payload))

  r = await call('/read', { method: 'POST', body: { message_id: 'not-exist' }, token: studentToken(uA) })
  assert('消息不存在 → 404', r.payload.code === 404, JSON.stringify(r.payload))

  r = await call('/read', { method: 'POST', body: { message_id: 'm1' }, token: studentToken(uA) })
  assert('未读→已读 updated=1 + unread_total 3→2', r.payload.code === 0 && byId('m1').is_read === true && r.payload.data.updated === 1 && r.payload.data.unread_total === 2, JSON.stringify(r.payload.data))

  r = await call('/read', { method: 'POST', body: { message_id: 'm1' }, token: studentToken(uA) })
  assert('已读幂等 updated=0', r.payload.code === 0 && r.payload.data.updated === 0 && r.payload.data.unread_total === 2, JSON.stringify(r.payload.data))

  /* ---------- 3. 全部已读 ---------- */
  console.log('\n【POST /read-all】')
  r = await call('/read-all', { method: 'POST', body: { type: 'bad' }, token: studentToken(uA) })
  assert('type 非法 → 1001', r.payload.code === 1001, JSON.stringify(r.payload))

  r = await call('/read-all', { method: 'POST', body: { type: 'recruitment' }, token: studentToken(uA) })
  assert('按分类已读：recruitment 清 m3 → updated=1 + unread_total=1', r.payload.code === 0 && byId('m3').is_read === true && byId('m4').is_read === false && r.payload.data.updated === 1 && r.payload.data.unread_total === 1, JSON.stringify(r.payload.data))

  r = await call('/read-all', { method: 'POST', body: {}, token: studentToken(uA) })
  assert('全部已读 → 清 m4 → updated=1 + unread_total=0', r.payload.code === 0 && byId('m4').is_read === true && r.payload.data.updated === 1 && r.payload.data.unread_total === 0, JSON.stringify(r.payload.data))

  r = await call('/read-all', { method: 'POST', body: {}, token: studentToken(uA) })
  assert('全部已读幂等 updated=0', r.payload.code === 0 && r.payload.data.updated === 0, JSON.stringify(r.payload.data))

  /* ---------- 4. 未读数 ---------- */
  console.log('\n【GET /unread】')
  r = await call('/unread', { method: 'GET', token: studentToken(uA) })
  assert('uA 未读数归零', r.payload.code === 0 && r.payload.data.total === 0 && r.payload.data.activity === 0 && r.payload.data.recruitment === 0 && r.payload.data.system === 0, JSON.stringify(r.payload.data))

  r = await call('/unread', { method: 'GET', token: studentToken(uB) })
  assert('uB 未读数（activity 1）', r.payload.code === 0 && r.payload.data.total === 1 && r.payload.data.activity === 1 && r.payload.data.system === 0, JSON.stringify(r.payload.data))

  /* ---------- 汇总 ---------- */
  console.log(`\n结果：${passed} 通过，${failed} 失败`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
