/**
 * P1-19 本地验收（离线，无需部署）
 * 覆盖：成员列表（权限 / join 姓名与脱敏学号 / 角色排序 / 分页 / role_count / removed 不计入）、
 *       设 / 撤干部（仅社长 / 目标非社长 / 幂等拦截 / 封禁社团拦截）、
 *       移除成员（仅社长 / 社长不可移除 / 非成员 404 / status → removed / 封禁社团拦截）
 * 运行：node scripts/test-p1-19.js
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
const stores = { clubs: [], club_members: [], users: [], categories: [], activities: [], messages: [], sensitive_words: [] }

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
      lt: (value) => ({ __lt: value }),
      gt: (value) => ({ __gt: value }),
      aggregate: { sum: (value) => ({ __sum: value }) },
    },
  }),
  httpclient: { request: async () => ({ data: { access_token: 'T', expires_in: 7200 } }) },
}

/* ---------- 种子数据 ---------- */
const DAY = 24 * 3600 * 1000
const now = new Date()
const at = (ms) => new Date(ms)

function user(over) {
  seq += 1
  return { _id: `u-${seq}`, openid: `openid-${seq}`, name: '用户', student_no: `2026010${seq}01`, auth_status: 'verified', status: 'normal', deleted: 0, ...over }
}
const uP = user({ name: '林社长', student_no: '2026010101' }) // club-a 社长
const uO = user({ name: '何干部', student_no: '2026010201' }) // club-a 干部
const uM = user({ name: '苏成员', student_no: '2026010301' }) // club-a 成员
const uM2 = user({ name: '赵成员', student_no: '2026010401' }) // club-a 成员
const uRemoved = user({ name: '已被移除', student_no: '2026010501' }) // club-a removed
const uOutsider = user({ name: '路人', student_no: '2026010601' }) // 非成员
const uBossB = user({ name: '封禁社长', student_no: '2026010701' }) // club-banned 社长
stores.users.push(uP, uO, uM, uM2, uRemoved, uOutsider, uBossB)

stores.clubs.push(
  { _id: 'club-a', name: '天文社', intro: '', contact: '', status: 'normal', deleted: 0 },
  { _id: 'club-banned', name: '被封禁社', intro: '', contact: '', status: 'banned', deleted: 0 }
)
stores.club_members.push(
  { _id: 'm-p', club_id: 'club-a', user_id: uP._id, role: 'president', status: 'active', joined_at: at(now.getTime() - 30 * DAY), deleted: 0 },
  { _id: 'm-o', club_id: 'club-a', user_id: uO._id, role: 'officer', status: 'active', joined_at: at(now.getTime() - 20 * DAY), deleted: 0 },
  { _id: 'm-m', club_id: 'club-a', user_id: uM._id, role: 'member', status: 'active', joined_at: at(now.getTime() - 10 * DAY), deleted: 0 },
  { _id: 'm-m2', club_id: 'club-a', user_id: uM2._id, role: 'member', status: 'active', joined_at: at(now.getTime() - 5 * DAY), deleted: 0 },
  // 被移除成员（removed）：不出现在列表，role_count 不计入
  { _id: 'm-rm', club_id: 'club-a', user_id: uRemoved._id, role: 'member', status: 'removed', joined_at: at(now.getTime() - 1 * DAY), deleted: 0 },
  { _id: 'm-bp', club_id: 'club-banned', user_id: uBossB._id, role: 'president', status: 'active', joined_at: at(now.getTime() - 30 * DAY), deleted: 0 }
)

const clubFn = require('../uniCloud-aliyun/cloudfunctions/club/index.js')

function studentToken(userRow) {
  return club.signToken({
    type: club.TOKEN_TYPES.STUDENT,
    token_kind: 'access',
    userId: userRow._id,
    openid: userRow.openid,
    auth_status: userRow.auth_status,
  })
}

async function call(pathname, { method = 'POST', body, query, token } = {}) {
  const headers = { 'content-type': 'application/json' }
  if (token) headers.authorization = `Bearer ${token}`
  const res = await clubFn.main({
    httpMethod: method,
    path: pathname.replace(/^\/club/, ''),
    headers,
    body: body ? JSON.stringify(body) : '',
    queryStringParameters: query || {},
  })
  return { statusCode: res.statusCode, payload: JSON.parse(res.body) }
}

const memberByUser = (uid) => stores.club_members.find((x) => x.club_id === 'club-a' && x.user_id === uid)

async function main() {
  /* ---------- 1. 成员列表 ---------- */
  console.log('\n【GET /members】')
  let r = await call('/members', { method: 'GET', token: studentToken(uP) })
  assert('缺 club_id → 1001', r.payload.code === 1001, JSON.stringify(r.payload))

  r = await call('/members', { method: 'GET', query: { club_id: 'club-a' }, token: studentToken(uOutsider) })
  assert('非成员查看 → 403', r.payload.code === 403, JSON.stringify(r.payload))

  r = await call('/members', { method: 'GET', query: { club_id: 'club-a' }, token: studentToken(uM) })
  assert('普通成员查看 → 403', r.payload.code === 403, JSON.stringify(r.payload))

  r = await call('/members', { method: 'GET', query: { club_id: 'club-a' }, token: studentToken(uO) })
  assert(
    '干部可查看 + viewer_role=officer',
    r.payload.code === 0 && r.payload.data.viewer_role === 'officer' && r.payload.data.total === 4,
    JSON.stringify(r.payload.data).slice(0, 160)
  )

  r = await call('/members', { method: 'GET', query: { club_id: 'club-a' }, token: studentToken(uP) })
  const data = r.payload.data
  assert('社长查看：角色排序 社长→干部→成员', r.payload.code === 0 && data.viewer_role === 'president' && data.list.map((m) => m.role).join(',') === 'president,officer,member,member', JSON.stringify(data.list.map((m) => m.role)))
  assert('join 姓名 + 脱敏学号（2026010101→2026****01）', data.list.find((m) => m.user_id === uP._id).name === '林社长' && data.list.find((m) => m.user_id === uM2._id).student_no_masked === '2026****01', JSON.stringify(data.list[0]))
  assert('role_count 不含 removed', data.role_count.total === 4 && data.role_count.president === 1 && data.role_count.officer === 1 && data.role_count.member === 2, JSON.stringify(data.role_count))
  assert('removed 成员不出现在列表', !data.list.some((m) => m.user_id === uRemoved._id), 'removed 成员泄漏')

  r = await call('/members', { method: 'GET', query: { club_id: 'club-a', page_size: 2 }, token: studentToken(uP) })
  assert('分页 page1 → 2 条', r.payload.code === 0 && r.payload.data.list.length === 2 && r.payload.data.total === 4, JSON.stringify(r.payload.data).slice(0, 120))
  r = await call('/members', { method: 'GET', query: { club_id: 'club-a', page: 2, page_size: 2 }, token: studentToken(uP) })
  assert('分页 page2 → 后 2 条', r.payload.code === 0 && r.payload.data.list.map((m) => m.user_id).join(',') === `${uM._id},${uM2._id}`, JSON.stringify(r.payload.data.list.map((m) => m.user_id)))

  r = await call('/members', { method: 'GET', query: { club_id: 'club-a', page: 0 }, token: studentToken(uP) })
  assert('page 非法 → 1001', r.payload.code === 1001, JSON.stringify(r.payload))
  r = await call('/members', { method: 'GET', query: { club_id: 'club-a', page_size: 999 }, token: studentToken(uP) })
  assert('page_size 超限 → 1001', r.payload.code === 1001, JSON.stringify(r.payload))

  /* ---------- 2. 设 / 撤干部 ---------- */
  console.log('\n【POST /members/role】')
  r = await call('/members/role', { body: { club_id: 'club-a', user_id: uM._id, role: 'officer' }, token: studentToken(uO) })
  assert('非社长操作 → 403', r.payload.code === 403, JSON.stringify(r.payload))

  r = await call('/members/role', { body: { club_id: 'club-a', user_id: uOutsider._id, role: 'officer' }, token: studentToken(uP) })
  assert('目标非成员 → 404', r.payload.code === 404, JSON.stringify(r.payload))

  r = await call('/members/role', { body: { club_id: 'club-a', user_id: uP._id, role: 'member' }, token: studentToken(uP) })
  assert('目标为社长 → 403', r.payload.code === 403, JSON.stringify(r.payload))

  r = await call('/members/role', { body: { club_id: 'club-a', user_id: uO._id, role: 'officer' }, token: studentToken(uP) })
  assert('已是目标角色 → 1002', r.payload.code === 1002, JSON.stringify(r.payload))

  r = await call('/members/role', { body: { club_id: 'club-a', user_id: uM._id, role: 'officer' }, token: studentToken(uP) })
  assert(
    '设干部 → role 变 officer + role_count 更新',
    r.payload.code === 0 && memberByUser(uM._id).role === 'officer' && r.payload.data.member.role === 'officer' && r.payload.data.role_count.officer === 2 && r.payload.data.role_count.member === 1,
    JSON.stringify(r.payload.data).slice(0, 160)
  )

  r = await call('/members/role', { body: { club_id: 'club-a', user_id: uM._id, role: 'member' }, token: studentToken(uP) })
  assert('撤干部 → role 变回 member', r.payload.code === 0 && memberByUser(uM._id).role === 'member' && r.payload.data.role_count.officer === 1 && r.payload.data.role_count.member === 2, JSON.stringify(r.payload.data).slice(0, 160))

  r = await call('/members/role', { body: { club_id: 'club-banned', user_id: uBossB._id, role: 'officer' }, token: studentToken(uBossB) })
  assert('封禁社团写操作 → 1002', r.payload.code === 1002, JSON.stringify(r.payload))

  r = await call('/members/role', { body: { club_id: 'club-a', role: 'officer' }, token: studentToken(uP) })
  assert('缺 user_id → 1001', r.payload.code === 1001, JSON.stringify(r.payload))

  /* ---------- 3. 移除成员 ---------- */
  console.log('\n【POST /members/remove】')
  r = await call('/members/remove', { body: { club_id: 'club-a', user_id: uM2._id }, token: studentToken(uO) })
  assert('非社长操作 → 403', r.payload.code === 403, JSON.stringify(r.payload))

  r = await call('/members/remove', { body: { club_id: 'club-a', user_id: uP._id }, token: studentToken(uP) })
  assert('移除社长 → 403', r.payload.code === 403, JSON.stringify(r.payload))

  r = await call('/members/remove', { body: { club_id: 'club-a', user_id: uOutsider._id }, token: studentToken(uP) })
  assert('目标非成员 → 404', r.payload.code === 404, JSON.stringify(r.payload))

  r = await call('/members/remove', { body: { club_id: 'club-a', user_id: uM2._id }, token: studentToken(uP) })
  assert(
    '移除成员 → status=removed + role_count 减一',
    r.payload.code === 0 && memberByUser(uM2._id).status === 'removed' && r.payload.data.role_count.total === 3,
    JSON.stringify(r.payload).slice(0, 160)
  )

  r = await call('/members', { method: 'GET', query: { club_id: 'club-a' }, token: studentToken(uP) })
  assert('移除后列表不再包含该成员', r.payload.code === 0 && !r.payload.data.list.some((m) => m.user_id === uM2._id), JSON.stringify(r.payload.data.list.map((m) => m.user_id)))

  r = await call('/members/remove', { body: { club_id: 'club-banned', user_id: uBossB._id }, token: studentToken(uBossB) })
  assert('封禁社团移除 → 1002', r.payload.code === 1002, JSON.stringify(r.payload))

  r = await call('/members/remove', { body: { user_id: uM2._id }, token: studentToken(uP) })
  assert('缺 club_id → 1001', r.payload.code === 1001, JSON.stringify(r.payload))

  /* ---------- 汇总 ---------- */
  console.log(`\n结果：${passed} 通过，${failed} 失败`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
