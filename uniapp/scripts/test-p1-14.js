/**
 * P1-14 本地验收（离线，无需部署）
 * 覆盖：签到配置（权限 / 口令长度 / 生成动态二维码）、qr-refresh（旧码失效）、
 *       学生签到（未报名 / 口令错 / 二维码过期 / 时段外 / 定位范围外 / 成功 / 重复拦截 /
 *       现场补报成功 / 现场名额满）、代签补签（权限 / 24h 宽限 / 未报名 / 重复 / operator 记录）、
 *       签到名单统计
 * 运行：node scripts/test-p1-14.js
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
const stores = { activities: [], club_members: [], clubs: [], categories: [], users: [], activity_registrations: [], checkins: [], messages: [], sensitive_words: [] }

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
      result.forEach((row) => assignPatch(row, patch))
      return { updated: result.length }
    },
  }
  return query
}

/** 对齐真实 SDK 语义：普通对象按点号路径合并子字段，cmd.set() 才整体覆盖（2026-09-28） */
function assignPatch(row, patch) {
  for (const [key, value] of Object.entries(patch)) {
    row[key] = value && value.__set !== undefined ? value.__set : value
  }
}

function aggregateStub(name) {
  const state = { match: null }
  const chain = {
    match(cond) {
      state.match = cond
      return chain
    },
    group() {
      return chain
    },
    end: async () => {
      const rows = (stores[name] || []).filter((row) => !state.match || matchCond(row, state.match))
      const map = new Map()
      rows.forEach((row) => map.set(row.activity_id, (map.get(row.activity_id) || 0) + 1))
      return { data: [...map.entries()].map(([key, total]) => ({ _id: key, total })) }
    },
  }
  return chain
}

function collectionFor(name) {
  const rowsOf = () => stores[name] || []
  return {
    where: (cond) => makeQuery(rowsOf().filter((row) => matchCond(row, cond))),
    aggregate: () => aggregateStub(name),
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
        assignPatch(row, patch)
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
      set: (value) => ({ __set: value }),
      aggregate: { sum: (value) => ({ __sum: value }) },
    },
  }),
  httpclient: { request: async () => ({ data: { access_token: 'T', expires_in: 7200 } }) },
}

/* ---------- 种子数据 ---------- */
const DAY = 24 * 3600 * 1000
const HOUR = 3600 * 1000
const now = new Date()
const at = (ms) => new Date(ms)

function user(over) {
  seq += 1
  return { _id: `u-${seq}`, openid: `openid-${seq}`, name: '用户', student_no: `2026${String(seq).padStart(4, '0')}`, auth_status: 'verified', status: 'normal', deleted: 0, ...over }
}
const uManager = user({ name: '林晨' })
const uStudent = user({ name: '苏晚晴', student_no: '20260002' })
const uStudent2 = user({ name: '何子轩', student_no: '20260003' })
const uOther = user({ name: '路人' })
stores.users.push(uManager, uStudent, uStudent2, uOther)

stores.clubs.push({ _id: 'club-a', name: '天文社', intro: '', contact: '', status: 'normal', deleted: 0 })
stores.club_members.push({ _id: 'm-1', club_id: 'club-a', user_id: uManager._id, role: 'president', status: 'active', joined_at: at(now.getTime() - 30 * DAY) })

function activityRow(over) {
  return {
    club_id: 'club-a',
    title: '活动',
    content: '内容',
    cover: '',
    category_id: 'c-1',
    start_time: at(now.getTime() - 1 * HOUR),
    end_time: at(now.getTime() + 2 * HOUR),
    location: '操场',
    signup_start: at(now.getTime() - 1 * DAY),
    signup_end: at(now.getTime() + 1 * DAY),
    capacity: 2,
    need_approval: false,
    has_waitlist: false,
    allow_onsite: false,
    signin_config: {},
    status: 'ongoing',
    created_at: at(now.getTime() - 3 * DAY),
    updated_at: at(now.getTime() - 3 * DAY),
    deleted: 0,
    ...over,
  }
}
stores.activities.push(
  activityRow({ _id: 'act-ck', title: '扫码活动', allow_onsite: true, signin_config: { methods: ['qrcode'] } }),
  activityRow({ _id: 'act-pw', title: '口令活动', signin_config: { methods: ['qrcode', 'password'], password: '1234' } }),
  activityRow({ _id: 'act-geo', title: '定位活动', signin_config: { methods: ['geofence'], geo: { lat: 30.25, lng: 120.15, radius_m: 100 } } }),
  activityRow({ _id: 'act-nogeo', title: '无定位配置', signin_config: { methods: ['geofence'] } }),
  activityRow({ _id: 'act-window', title: '签到时段外', signin_config: { methods: ['qrcode', 'password'], password: '1234', signin_end: at(now.getTime() - 1 * HOUR) } }),
  activityRow({ _id: 'act-ended', title: '已结束活动', status: 'ended', signin_config: { methods: ['qrcode'] } }),
  activityRow({ _id: 'act-ended-old', title: '早结束活动', status: 'ended', end_time: at(now.getTime() - 48 * HOUR), signin_config: { methods: ['qrcode'] } })
)
stores.activity_registrations.push(
  { _id: 'r-1', activity_id: 'act-ck', user_id: uStudent._id, status: 'approved', checked_in: false, signup_at: at(now.getTime() - 2 * HOUR), created_at: at(now.getTime() - 2 * HOUR), deleted: 0 },
  { _id: 'r-2', activity_id: 'act-pw', user_id: uStudent._id, status: 'approved', checked_in: false, signup_at: at(now.getTime() - 2 * HOUR), created_at: at(now.getTime() - 2 * HOUR), deleted: 0 },
  { _id: 'r-3', activity_id: 'act-ended', user_id: uStudent._id, status: 'approved', checked_in: false, signup_at: at(now.getTime() - 2 * HOUR), created_at: at(now.getTime() - 2 * HOUR), deleted: 0 },
  { _id: 'r-4', activity_id: 'act-ended-old', user_id: uStudent._id, status: 'approved', checked_in: false, signup_at: at(now.getTime() - 2 * HOUR), created_at: at(now.getTime() - 2 * HOUR), deleted: 0 }
)

const activityFn = require('../uniCloud-aliyun/cloudfunctions/activity/index.js')

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
  const res = await activityFn.main({
    httpMethod: method,
    path: pathname.replace(/^\/activity/, ''),
    headers,
    body: body ? JSON.stringify(body) : '',
    queryStringParameters: query || {},
  })
  return { statusCode: res.statusCode, payload: JSON.parse(res.body) }
}

const actById = (id) => stores.activities.find((a) => a._id === id)

async function main() {
  /* ---------- 1. checkin/config ---------- */
  console.log('\n【checkin/config】')
  let r = await call('/checkin/config', { body: { activity_id: 'act-ck', methods: ['qrcode', 'password'], password: '8888' }, token: studentToken(uStudent) })
  assert('非负责人配置 → 403', r.payload.code === 403, JSON.stringify(r.payload))

  r = await call('/checkin/config', { body: { activity_id: 'act-ck', methods: ['qrcode'], password: '12' }, token: studentToken(uManager) })
  assert('口令过短 → 1001', r.payload.code === 1001, JSON.stringify(r.payload))

  r = await call('/checkin/config', { body: { activity_id: 'act-ck', methods: ['qrcode', 'password'], password: '8888' }, token: studentToken(uManager) })
  assert('启用口令并生成动态二维码', r.payload.code === 0 && !!r.payload.data.signin_config.qr_token && r.payload.data.signin_config.password === '8888', JSON.stringify(r.payload).slice(0, 200))
  const qrToken = r.payload.data.signin_config.qr_token
  assert('二维码 token 落库且 60s 有效期', actById('act-ck').signin_config.qr_token === qrToken && !!actById('act-ck').signin_config.qr_expires_at)

  /* ---------- 2. checkin/qr-refresh ---------- */
  console.log('\n【checkin/qr-refresh】')
  r = await call('/checkin/qr-refresh', { body: { activity_id: 'act-ck' }, token: studentToken(uManager) })
  assert('刷新后旧 token 失效（新 token 不同）', r.payload.code === 0 && r.payload.data.signin_config.qr_token !== qrToken, JSON.stringify(r.payload).slice(0, 160))

  /* ---------- 3. 学生签到：异常分支 ---------- */
  console.log('\n【checkin · 异常分支】')
  r = await call('/checkin', { body: { activity_id: 'act-pw', method: 'password', code: 'wrong' }, token: studentToken(uStudent) })
  assert('口令错误 → 1002', r.payload.code === 1002 && r.payload.message.includes('口令错误'), JSON.stringify(r.payload))

  r = await call('/checkin', { body: { activity_id: 'act-pw', method: 'password', code: '1234' }, token: studentToken(uStudent) })
  assert('口令正确 → 签到成功（落库 signin_method=password）', r.payload.code === 0 && stores.checkins.some((c) => c.activity_id === 'act-pw' && c.signin_method === 'password'), JSON.stringify(r.payload).slice(0, 160))
  assert('重复签到拦截（第一次为准）', (await call('/checkin', { body: { activity_id: 'act-pw', method: 'password', code: '1234' }, token: studentToken(uStudent) })).payload.code === 1002 && stores.checkins.filter((c) => c.activity_id === 'act-pw').length === 1)
  assert('签到后报名 checked_in=true', stores.activity_registrations.find((x) => x._id === 'r-2').checked_in === true)

  r = await call('/checkin', { body: { activity_id: 'act-window', method: 'password', code: '1234' }, token: studentToken(uManager) })
  assert('不在签到时段 → 1002', r.payload.code === 1002 && r.payload.message.includes('时段'), JSON.stringify(r.payload))

  r = await call('/checkin', { body: { activity_id: 'act-geo', method: 'geofence', lat: 30.25, lng: 120.2 }, token: studentToken(uStudent2) })
  assert('定位超出范围 → 1002（约 4.6km）', r.payload.code === 1002 && r.payload.message.includes('范围'), JSON.stringify(r.payload))

  r = await call('/checkin', { body: { activity_id: 'act-nogeo', method: 'geofence', lat: 30.25, lng: 120.15 }, token: studentToken(uStudent2) })
  assert('未配置定位 → 1002', r.payload.code === 1002 && r.payload.message.includes('未配置'), JSON.stringify(r.payload))

  r = await call('/checkin', { body: { activity_id: 'act-ck', method: 'qrcode', code: 'stale-token' }, token: studentToken(uStudent) })
  assert('二维码无效/过期 → 1002', r.payload.code === 1002 && r.payload.message.includes('过期'), JSON.stringify(r.payload))

  /* ---------- 4. 学生签到：现场补报 ---------- */
  console.log('\n【checkin · 现场补报】')
  r = await call('/checkin', { body: { activity_id: 'act-ck', method: 'qrcode', code: actById('act-ck').signin_config.qr_token }, token: studentToken(uStudent2) })
  assert('未报名 + allow_onsite → 现场补报后签到成功', r.payload.code === 0 && r.payload.data.onsite === true, JSON.stringify(r.payload).slice(0, 160))
  assert('补报落库（remark=现场补报，approved）', stores.activity_registrations.some((x) => x.activity_id === 'act-ck' && x.user_id === uStudent2._id && x.status === 'approved' && x.remark === '现场补报'))
  assert('补报者签到记录存在', stores.checkins.some((c) => c.activity_id === 'act-ck' && c.user_id === uStudent2._id))

  // act-ck 容量 2 已满（uStudent + uStudent2）
  r = await call('/checkin', { body: { activity_id: 'act-ck', method: 'qrcode', code: actById('act-ck').signin_config.qr_token }, token: studentToken(uOther) })
  assert('现场名额已满 → 1002', r.payload.code === 1002 && r.payload.message.includes('名额已满'), JSON.stringify(r.payload))

  r = await call('/checkin', { body: { activity_id: 'act-ended', method: 'qrcode', code: 'x' }, token: studentToken(uOther) })
  assert('非进行中（ended）→ 1002', r.payload.code === 1002 && r.payload.message.includes('进行中'), JSON.stringify(r.payload))

  /* ---------- 5. 代签 / 补签 ---------- */
  console.log('\n【checkin/manual】')
  r = await call('/checkin/manual', { body: { activity_id: 'act-ck', student_no: uStudent.student_no }, token: studentToken(uStudent) })
  assert('非负责人代签 → 403', r.payload.code === 403, JSON.stringify(r.payload))

  r = await call('/checkin/manual', { body: { activity_id: 'act-ended-old', student_no: uStudent.student_no }, token: studentToken(uManager) })
  assert('结束后超 24h 补签 → 1002', r.payload.code === 1002, JSON.stringify(r.payload))

  r = await call('/checkin/manual', { body: { activity_id: 'act-ended', student_no: uStudent2.student_no }, token: studentToken(uManager) })
  assert('未报名用户代签 → 1002', r.payload.code === 1002, JSON.stringify(r.payload))

  r = await call('/checkin/manual', { body: { activity_id: 'act-ended', student_no: uStudent.student_no }, token: studentToken(uManager) })
  assert('结束后 24h 内补签成功（manual + operator）', r.payload.code === 0 && stores.checkins.some((c) => c.activity_id === 'act-ended' && c.user_id === uStudent._id && c.signin_method === 'manual' && c.operator === uManager._id), JSON.stringify(r.payload).slice(0, 160))

  r = await call('/checkin/manual', { body: { activity_id: 'act-ended', student_no: uStudent.student_no }, token: studentToken(uManager) })
  assert('重复代签拦截', r.payload.code === 1002 && r.payload.message.includes('已签到'), JSON.stringify(r.payload))

  r = await call('/checkin/manual', { body: { activity_id: 'act-ended', student_no: '20269999' }, token: studentToken(uManager) })
  assert('学号不存在 → 404', r.payload.code === 404, JSON.stringify(r.payload))

  /* ---------- 6. 签到名单 ---------- */
  console.log('\n【checkin/list】')
  r = await call('/checkin/list', { method: 'GET', query: { activity_id: 'act-ck' }, token: studentToken(uManager) })
  assert('名单含已签/未签统计（1 已签：uStudent2 现场补报；r-1 未签）', r.payload.code === 0 && r.payload.data.total === 2 && r.payload.data.checked_count === 1 && r.payload.data.unchecked_count === 1, JSON.stringify(r.payload.data).slice(0, 200))
  assert('名单 join 姓名与脱敏学号', r.payload.data.list.every((row) => row.name && row.student_no_masked))

  r = await call('/checkin/list', { method: 'GET', query: { activity_id: 'act-ck' }, token: studentToken(uStudent) })
  assert('非负责人看名单 → 403', r.payload.code === 403, JSON.stringify(r.payload))

  console.log(`\n通过 ${passed} 项，失败 ${failed} 项`)
  if (failed > 0) process.exitCode = 1
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
