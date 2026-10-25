/**
 * P1-15 本地验收（离线，无需部署）
 * 覆盖：报名名单（权限 / 参数校验 / 状态与签到筛选 / join 用户 / 状态计数 / 签到统计 / 分页）、
 *       报名审核（权限 / 非待审核拦截 / 驳回必填理由 / approve 通知 activity_signup_result / reject）、
 *       缺席标记（权限 / 仅报名成功者 / absent-present-none 落库与清空）、
 *       导出 CSV（权限 / BOM / 表头 / 中文状态 / 转义 / 签到时间）
 * 运行：node scripts/test-p1-15.js
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
      result.forEach((row) => Object.assign(row, patch))
      return { updated: result.length }
    },
  }
  return query
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
const uStudent = user({ name: '苏晚晴', student_no: '20260002', college: '计算机学院', major: '软件工程' })
const uStudent2 = user({ name: '何子轩', student_no: '20260003' })
const uStudent3 = user({ name: '赵一鸣', student_no: '20260004', college: '经管学院', major: '工商管理' })
const uStudent4 = user({ name: '路人,甲', student_no: '20260005' })
const uStudent5 = user({ name: '陈默', student_no: '20260006' })
stores.users.push(uManager, uStudent, uStudent2, uStudent3, uStudent4, uStudent5)

stores.clubs.push({ _id: 'club-a', name: '天文社', intro: '', contact: '', status: 'normal', deleted: 0 })
stores.club_members.push({ _id: 'm-1', club_id: 'club-a', user_id: uManager._id, role: 'president', status: 'active', joined_at: at(now.getTime() - 30 * DAY) })

const act1 = {
  _id: 'act-1',
  club_id: 'club-a',
  title: '流星雨观测夜',
  content: '一起看流星雨',
  cover: '',
  category_id: 'c-1',
  start_time: at(now.getTime() - 1 * HOUR),
  end_time: at(now.getTime() + 2 * HOUR),
  location: '操场',
  signup_start: at(now.getTime() - 1 * DAY),
  signup_end: at(now.getTime() + 1 * DAY),
  capacity: 2,
  need_approval: true,
  has_waitlist: true,
  allow_onsite: false,
  signin_config: {},
  status: 'ongoing',
  created_at: at(now.getTime() - 3 * DAY),
  updated_at: at(now.getTime() - 3 * DAY),
  deleted: 0,
}
stores.activities.push(act1)

const regAt = (i) => at(now.getTime() - i * HOUR)
stores.activity_registrations.push(
  { _id: 'r-1', activity_id: 'act-1', user_id: uStudent._id, status: 'approved', remark: '靠前', checked_in: false, signup_at: regAt(10), created_at: regAt(10), updated_at: regAt(10), deleted: 0 },
  { _id: 'r-2', activity_id: 'act-1', user_id: uStudent2._id, status: 'waitlist', remark: '', checked_in: false, signup_at: regAt(9), created_at: regAt(9), updated_at: regAt(9), deleted: 0 },
  { _id: 'r-3', activity_id: 'act-1', user_id: uStudent3._id, status: 'pending', remark: '想参加', checked_in: false, signup_at: regAt(8), created_at: regAt(8), updated_at: regAt(8), deleted: 0 },
  { _id: 'r-4', activity_id: 'act-1', user_id: uStudent4._id, status: 'cancelled', remark: '有事', checked_in: false, signup_at: regAt(7), created_at: regAt(7), updated_at: regAt(7), deleted: 0 },
  { _id: 'r-5', activity_id: 'act-1', user_id: uStudent5._id, status: 'rejected', remark: '', checked_in: false, signup_at: regAt(6), created_at: regAt(6), updated_at: regAt(6), deleted: 0 }
)
stores.checkins.push({ _id: 'c-1', activity_id: 'act-1', user_id: uStudent._id, signin_method: 'qrcode', signin_time: at(now.getTime() - 30 * 60 * 1000), operator: null, duration: 0, created_at: at(now.getTime() - 30 * 60 * 1000), deleted: 0 })

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

const regById = (id) => stores.activity_registrations.find((x) => x._id === id)

async function main() {
  /* ---------- 1. 报名名单 ---------- */
  console.log('\n【registrations】')
  let r = await call('/registrations', { method: 'GET', query: { activity_id: 'act-1' }, token: studentToken(uStudent) })
  assert('非负责人看名单 → 403', r.payload.code === 403, JSON.stringify(r.payload))

  r = await call('/registrations', { method: 'GET', query: { activity_id: 'act-1', status: 'bad' }, token: studentToken(uManager) })
  assert('status 取值非法 → 1001', r.payload.code === 1001, JSON.stringify(r.payload))

  r = await call('/registrations', { method: 'GET', query: { activity_id: 'act-1', checked: 'bad' }, token: studentToken(uManager) })
  assert('checked 取值非法 → 1001', r.payload.code === 1001, JSON.stringify(r.payload))

  r = await call('/registrations', { method: 'GET', query: { activity_id: 'act-1' }, token: studentToken(uManager) })
  assert('名单含全部 5 条报名', r.payload.code === 0 && r.payload.data.total === 5, JSON.stringify(r.payload.data).slice(0, 120))
  assert('状态计数正确', r.payload.data.status_count.all === 5 && r.payload.data.status_count.pending === 1 && r.payload.data.status_count.approved === 1 && r.payload.data.status_count.waitlist === 1 && r.payload.data.status_count.rejected === 1 && r.payload.data.status_count.cancelled === 1, JSON.stringify(r.payload.data.status_count))
  assert('签到统计（报名成功 1 人、已签 1、签到率 100）', r.payload.data.stats.approved_count === 1 && r.payload.data.stats.checked_count === 1 && r.payload.data.stats.unchecked_count === 0 && r.payload.data.stats.signin_rate === 100, JSON.stringify(r.payload.data.stats))
  const row1 = r.payload.data.list.find((row) => row.registration_id === 'r-1')
  assert('名单 join 姓名/脱敏学号/学院专业/签到', row1 && row1.name === '苏晚晴' && row1.student_no_masked === '2026**02' && !row1.student_no && row1.college === '计算机学院' && row1.major === '软件工程' && row1.checked_in === true && !!row1.signin_time && row1.attendance === null, JSON.stringify(row1))
  assert('名单按报名顺序升序', r.payload.data.list[0].registration_id === 'r-1', r.payload.data.list.map((x) => x.registration_id).join(','))

  r = await call('/registrations', { method: 'GET', query: { activity_id: 'act-1', status: 'waitlist' }, token: studentToken(uManager) })
  assert('状态筛选 waitlist → 仅 r-2', r.payload.code === 0 && r.payload.data.total === 1 && r.payload.data.list[0].registration_id === 'r-2', JSON.stringify(r.payload.data).slice(0, 120))

  r = await call('/registrations', { method: 'GET', query: { activity_id: 'act-1', checked: 'yes' }, token: studentToken(uManager) })
  assert('签到筛选 已签 → 仅 r-1', r.payload.code === 0 && r.payload.data.total === 1 && r.payload.data.list[0].registration_id === 'r-1', JSON.stringify(r.payload.data).slice(0, 120))

  r = await call('/registrations', { method: 'GET', query: { activity_id: 'act-1', checked: 'no' }, token: studentToken(uManager) })
  assert('签到筛选 未签 → 4 条（r-2~r-5）', r.payload.code === 0 && r.payload.data.total === 4, JSON.stringify(r.payload.data).slice(0, 120))

  r = await call('/registrations', { method: 'GET', query: { activity_id: 'act-1', page: 1, page_size: 2 }, token: studentToken(uManager) })
  assert('分页 page_size=2 → has_more 且首 2 条', r.payload.code === 0 && r.payload.data.list.length === 2 && r.payload.data.has_more === true, JSON.stringify(r.payload.data).slice(0, 120))

  /* ---------- 2. 报名审核 ---------- */
  console.log('\n【review-registration】')
  r = await call('/review-registration', { body: { activity_id: 'act-1', registration_id: 'r-3', action: 'approve' }, token: studentToken(uStudent) })
  assert('非负责人审核 → 403', r.payload.code === 403, JSON.stringify(r.payload))

  r = await call('/review-registration', { body: { activity_id: 'act-1', registration_id: 'r-1', action: 'approve' }, token: studentToken(uManager) })
  assert('非待审核（approved）→ 1002', r.payload.code === 1002, JSON.stringify(r.payload))

  r = await call('/review-registration', { body: { activity_id: 'act-1', registration_id: 'r-3', action: 'reject' }, token: studentToken(uManager) })
  assert('驳回未填理由 → 1001', r.payload.code === 1001, JSON.stringify(r.payload))

  r = await call('/review-registration', { body: { activity_id: 'act-1', registration_id: 'r-3', action: 'approve' }, token: studentToken(uManager) })
  assert('pending 通过 → approved', r.payload.code === 0 && regById('r-3').status === 'approved', JSON.stringify(r.payload).slice(0, 160))
  assert('通过后通知 activity_signup_result（站内）', stores.messages.some((m) => m.scene === 'activity_signup_result' && m.user_id === uStudent3._id && m.biz_id === 'act-1'), JSON.stringify(stores.messages.map((m) => ({ scene: m.scene, user_id: m.user_id }))))

  stores.activity_registrations.push({ _id: 'r-6', activity_id: 'act-1', user_id: uStudent4._id, status: 'pending', remark: '', checked_in: false, signup_at: regAt(5), created_at: regAt(5), updated_at: regAt(5), deleted: 0 })
  r = await call('/review-registration', { body: { activity_id: 'act-1', registration_id: 'r-6', action: 'reject', reason: '名额已满' }, token: studentToken(uManager) })
  assert('pending 驳回（带理由）→ rejected', r.payload.code === 0 && regById('r-6').status === 'rejected', JSON.stringify(r.payload).slice(0, 160))
  assert('驳回通知含理由', stores.messages.some((m) => m.scene === 'activity_signup_result' && m.user_id === uStudent4._id && /名额已满/.test(m.title + m.content)), JSON.stringify(stores.messages.slice(-1)[0]))

  /* ---------- 3. 缺席标记 ---------- */
  console.log('\n【attendance】')
  r = await call('/attendance', { body: { activity_id: 'act-1', registration_id: 'r-1', attendance: 'absent' }, token: studentToken(uStudent) })
  assert('非负责人标记 → 403', r.payload.code === 403, JSON.stringify(r.payload))

  r = await call('/attendance', { body: { activity_id: 'act-1', registration_id: 'r-2', attendance: 'absent' }, token: studentToken(uManager) })
  assert('候补报名不可标记 → 1002', r.payload.code === 1002, JSON.stringify(r.payload))

  r = await call('/attendance', { body: { activity_id: 'act-1', registration_id: 'r-1', attendance: 'absent' }, token: studentToken(uManager) })
  assert('标记缺席 → 落库 absent', r.payload.code === 0 && regById('r-1').attendance === 'absent', JSON.stringify(r.payload).slice(0, 120))

  r = await call('/attendance', { body: { activity_id: 'act-1', registration_id: 'r-1', attendance: 'present' }, token: studentToken(uManager) })
  assert('改标到场 → 覆盖为 present', r.payload.code === 0 && regById('r-1').attendance === 'present', JSON.stringify(r.payload).slice(0, 120))

  r = await call('/attendance', { body: { activity_id: 'act-1', registration_id: 'r-1', attendance: 'none' }, token: studentToken(uManager) })
  assert('清空判定 → attendance 为 null', r.payload.code === 0 && regById('r-1').attendance === null, JSON.stringify(r.payload).slice(0, 120))

  /* ---------- 4. 导出 CSV ---------- */
  console.log('\n【export-csv】')
  r = await call('/export-csv', { method: 'GET', query: { activity_id: 'act-1' }, token: studentToken(uStudent) })
  assert('非负责人导出 → 403', r.payload.code === 403, JSON.stringify(r.payload))

  r = await call('/export-csv', { method: 'GET', query: { activity_id: 'act-1' }, token: studentToken(uManager) })
  assert('导出成功且 count=6（r-1~r-6）', r.payload.code === 0 && r.payload.data.count === 6, JSON.stringify(r.payload.data).slice(0, 120))
  const csv = r.payload.data.csv
  assert('CSV 含 UTF-8 BOM 与表头', csv.startsWith('\uFEFF') && csv.indexOf('姓名,学号,学院专业,报名状态,报名时间,签到状态,签到时间') === 1, csv.slice(0, 80))
  assert('CSV 含中文状态映射（已报名/候补/已驳回/已取消；r-3 已通过故无待审核）', csv.indexOf('已报名') !== -1 && csv.indexOf('候补') !== -1 && csv.indexOf('已驳回') !== -1 && csv.indexOf('已取消') !== -1, csv)
  assert('CSV 含学院专业与签到时间', csv.indexOf('计算机学院 软件工程') !== -1 && csv.indexOf('已签到') !== -1, csv)
  assert('CSV 对含逗号姓名转义引号', csv.indexOf('"路人,甲"') !== -1, csv.split('\r\n').slice(0, 6).join(' | '))
  assert('CSV 行数 = 表头 + 6 条', csv.split('\r\n').length === 7, String(csv.split('\r\n').length))

  console.log(`\n通过 ${passed} 项，失败 ${failed} 项`)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error('测试异常：', e)
  process.exit(1)
})
