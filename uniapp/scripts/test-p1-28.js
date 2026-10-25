/**
 * P1-28 本地验收（离线，无需部署）
 * 覆盖：管理工作台聚合 GET /dashboard/summary
 *       鉴权（无 token 401 / 学生通道 403 / viewer 可访问——工作台三角色均可见）、
 *       四类待办计数（clubs/activities/recruitments/appeals pending）、疑似动态数（flagged）、
 *       total 汇总、平台概览（认证用户/正常社团/活动总数/开放招新）、
 *       软删与状态口径（非 pending 不计、deleted=1 不计）
 * 运行：node scripts/test-p1-28.js
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
const stores = { clubs: [], activities: [], recruitments: [], appeals: [], club_posts: [], users: [] }

function matchCond(row, cond) {
  return Object.keys(cond).every((key) => {
    const want = cond[key]
    if (want instanceof RegExp) return want.test(String(row[key] == null ? '' : row[key]))
    if (want && typeof want === 'object') {
      if (Object.prototype.hasOwnProperty.call(want, '__in')) return want.__in.indexOf(row[key]) !== -1
      if (Object.prototype.hasOwnProperty.call(want, '__neq')) return row[key] !== want.__neq
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
    orderBy: () => query,
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
    doc: () => ({ update: async () => ({ updated: 0 }) }),
  }
}

global.uniCloud = {
  database: () => ({
    collection: collectionFor,
    command: { and: (l) => ({ __and: l }), or: (l) => ({ __or: l }), in: (l) => ({ __in: l }), neq: (v) => ({ __neq: v }) },
  }),
  httpclient: { request: async () => ({ data: {} }) },
}

/* ---------- 种子数据 ---------- */
function seed(name, rows) {
  rows.forEach((r) => stores[name].push({ _id: `${name}-${++seq}`, deleted: 0, ...r }))
}

seed('clubs', [
  { name: 'c-1', status: 'pending' }, // 待审
  { name: 'c-2', status: 'pending' }, // 待审
  { name: 'c-3', status: 'normal' }, // 正常
  { name: 'c-4', status: 'normal' }, // 正常
  { name: 'c-5', status: 'banned' }, // 封禁不计
])
seed('clubs', [{ name: 'c-6', status: 'pending', deleted: 1 }]) // 软删待审不计

seed('activities', [
  { title: 'a-1', status: 'pending' },
  { title: 'a-2', status: 'pending' },
  { title: 'a-3', status: 'approved' }, // 非待审
  { title: 'a-4', status: 'ongoing' },
])
seed('activities', [{ title: 'a-5', status: 'pending', deleted: 1 }])

seed('recruitments', [
  { title: 'r-1', status: 'pending' },
  { title: 'r-2', status: 'pending' },
  { title: 'r-3', status: 'open' }, // 开放中（overview）
  { title: 'r-4', status: 'closed' },
])
seed('recruitments', [{ title: 'r-5', status: 'pending', deleted: 1 }])

seed('appeals', [
  { appeal_type: 'rebind', status: 'pending' },
  { appeal_type: 'rebind', status: 'pending' },
  { appeal_type: 'rebind', status: 'approved' },
])
seed('appeals', [{ appeal_type: 'rebind', status: 'pending', deleted: 1 }])

seed('club_posts', [
  { club_id: 'c-3', content: 'p-1', flagged: true, status: 'published' }, // 疑似
  { club_id: 'c-3', content: 'p-2', flagged: true, status: 'published' }, // 疑似
  { club_id: 'c-3', content: 'p-3', flagged: false, status: 'published' }, // 非疑似
])
seed('club_posts', [{ club_id: 'c-3', content: 'p-4', flagged: true, deleted: 1 }]) // 软删疑似不计

seed('users', [
  { name: 'u-1', auth_status: 'verified' },
  { name: 'u-2', auth_status: 'verified' },
  { name: 'u-3', auth_status: 'verified' },
  { name: 'u-4', auth_status: 'unverified' }, // 未认证不计
])
seed('users', [{ name: 'u-5', auth_status: 'verified', deleted: 1 }])

const fn = require('../uniCloud-aliyun/cloudfunctions/dashboard/index.js')

function adminToken(role) {
  return club.signToken({ type: club.TOKEN_TYPES.ADMIN, adminId: 'a-1', username: 'root', role, name: '超管' })
}
const studentToken = club.signToken({
  type: club.TOKEN_TYPES.STUDENT,
  token_kind: 'access',
  userId: 'u-9',
  openid: 'openid-9',
  auth_status: 'verified',
})

async function call({ qs = {}, token = null }) {
  const headers = { 'content-type': 'application/json' }
  if (token) headers.authorization = `Bearer ${token}`
  const res = await fn.main({
    httpMethod: 'GET',
    path: '/summary',
    headers,
    body: '',
    queryStringParameters: qs,
  })
  const payload = JSON.parse(res.body)
  return { statusCode: res.statusCode, payload, code: payload.code, data: payload.data, message: payload.message }
}

async function main() {
  console.log('\n【GET /dashboard/summary · 鉴权】')
  let r = await call({})
  assert('无 token → 401', r.code === 401, JSON.stringify(r))
  r = await call({ token: studentToken })
  assert('学生 token → 403（通道不匹配）', r.code === 403, JSON.stringify(r))

  console.log('\n【GET /dashboard/summary · 四类待办计数】')
  r = await call({ token: adminToken('super') })
  assert('待审社团 = 2（pending 且未软删）', r.data.pending.clubs === 2, JSON.stringify(r.data.pending))
  assert('待审活动 = 2', r.data.pending.activities === 2, JSON.stringify(r.data.pending))
  assert('待审招新 = 2', r.data.pending.recruitments === 2, JSON.stringify(r.data.pending))
  assert('待审申诉 = 2', r.data.pending.appeals === 2, JSON.stringify(r.data.pending))
  assert('疑似动态 = 2（flagged 且未软删）', r.data.pending.flagged_posts === 2, JSON.stringify(r.data.pending))
  assert('待办合计 = 8（四类之和）', r.data.pending.total === 8, JSON.stringify(r.data.pending))

  console.log('\n【GET /dashboard/summary · 平台概览】')
  assert('认证用户 = 3（verified 未软删）', r.data.overview.verified_users === 3, JSON.stringify(r.data.overview))
  assert('正常社团 = 2（normal）', r.data.overview.normal_clubs === 2, JSON.stringify(r.data.overview))
  assert('活动总数 = 4（全部未软删）', r.data.overview.total_activities === 4, JSON.stringify(r.data.overview))
  assert('开放招新 = 1（open）', r.data.overview.open_recruitments === 1, JSON.stringify(r.data.overview))

  console.log('\n【GET /dashboard/summary · 角色可见性】')
  r = await call({ token: adminToken('viewer') })
  assert('viewer 可访问（工作台三角色均可见）', r.code === 0 && typeof r.data.pending.total === 'number', JSON.stringify(r))
  r = await call({ token: adminToken('auditor') })
  assert('auditor 可访问', r.code === 0 && r.data.pending.total === 8, JSON.stringify(r.data.pending))

  /* ---------- 汇总 ---------- */
  console.log(`\n结果：${passed} 通过，${failed} 失败`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})