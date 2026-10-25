/**
 * P1-13 本地验收（离线，无需部署）
 * 覆盖：报名三路径分发（直接报 / 审核 / 候补）、满员拦截、重复报名拦截、时段与状态前置、
 *       取消报名（释放名额 + 候补按 signup_at 递补 + 通知）、取消后再报、
 *       手动递补（权限 / 无候补）、我的报名列表（join / 状态 / 可取消标记）、详情 my_registration
 * 运行：node scripts/test-p1-13.js
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
const stores = { activities: [], club_members: [], clubs: [], categories: [], users: [], activity_registrations: [], messages: [], sensitive_words: [] }

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
  return { _id: `u-${seq}`, openid: `openid-${seq}`, name: '用户', auth_status: 'verified', status: 'normal', deleted: 0, ...over }
}
const uManager = user({ name: '林晨' })
const uStudent = user({ name: '苏晚晴' })
const uStudent2 = user({ name: '何子轩' })
const uStudent3 = user({ name: '路人丙' })
const uDisabled = user({ name: '被禁用者', status: 'disabled' })
stores.users.push(uManager, uStudent, uStudent2, uStudent3, uDisabled)

stores.clubs.push({ _id: 'club-a', name: '天文社', intro: '', contact: '', status: 'normal', deleted: 0 })
stores.club_members.push({ _id: 'm-1', club_id: 'club-a', user_id: uManager._id, role: 'president', status: 'active', joined_at: at(now.getTime() - 30 * DAY) })

function activityRow(over) {
  return {
    club_id: 'club-a',
    title: '活动',
    content: '内容',
    cover: '',
    category_id: 'c-1',
    start_time: at(now.getTime() + 2 * DAY),
    end_time: at(now.getTime() + 2 * DAY + 2 * HOUR),
    location: '操场',
    signup_start: at(now.getTime() - 1 * DAY),
    signup_end: at(now.getTime() + 1 * DAY),
    capacity: 2,
    need_approval: false,
    has_waitlist: true,
    allow_onsite: false,
    signin_config: { methods: ['qrcode'] },
    status: 'signup',
    created_at: at(now.getTime() - 3 * DAY),
    updated_at: at(now.getTime() - 3 * DAY),
    deleted: 0,
    ...over,
  }
}
stores.activities.push(
  activityRow({ _id: 'act-direct', title: '直接报名活动', capacity: 2 }),
  activityRow({ _id: 'act-review', title: '审核类活动', need_approval: true, capacity: 5 }),
  activityRow({ _id: 'act-full', title: '候补活动', capacity: 1 }),
  activityRow({ _id: 'act-nofull', title: '无候补满员活动', capacity: 1, has_waitlist: false }),
  activityRow({ _id: 'act-closed', title: '已截止活动', signup_end: at(now.getTime() - 1 * HOUR) }),
  activityRow({ _id: 'act-ongoing', title: '进行中活动', status: 'ongoing', start_time: at(now.getTime() - 1 * HOUR), end_time: at(now.getTime() + 1 * HOUR) })
)

function regRow(over) {
  return { activity_id: 'act-direct', user_id: uStudent._id, status: 'approved', checked_in: false, signup_at: at(now.getTime() - 2 * HOUR), created_at: at(now.getTime() - 2 * HOUR), deleted: 0, ...over }
}
stores.activity_registrations.push(
  // act-full 已满（1 approved 占满）+ 两个候补（signup_at 先后）
  regRow({ _id: 'r-full-1', activity_id: 'act-full', user_id: 'u-x1', status: 'approved', signup_at: at(now.getTime() - 3 * HOUR) }),
  regRow({ _id: 'r-wl-1', activity_id: 'act-full', user_id: 'u-y1', status: 'waitlist', signup_at: at(now.getTime() - 2 * HOUR) }),
  regRow({ _id: 'r-wl-2', activity_id: 'act-full', user_id: 'u-y2', status: 'waitlist', signup_at: at(now.getTime() - 1 * HOUR) }),
  // act-nofull 已满且无候补
  regRow({ _id: 'r-nf-1', activity_id: 'act-nofull', user_id: 'u-x2', status: 'approved', signup_at: at(now.getTime() - 3 * HOUR) }),
  // act-closed 已截止但 uStudent 有有效报名（用于测「截止后取消被拦」）
  regRow({ _id: 'r-closed-1', activity_id: 'act-closed', user_id: uStudent._id, status: 'approved', signup_at: at(now.getTime() - 3 * HOUR) })
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

const regsOf = (activityId) => stores.activity_registrations.filter((r) => r.activity_id === activityId)

async function main() {
  /* ---------- 1. register：鉴权与前置 ---------- */
  console.log('\n【register · 鉴权与前置】')
  let r = await call('/activity/register', { body: { activity_id: 'act-direct' } })
  assert('无 token → 401', r.statusCode === 401, JSON.stringify(r.payload))

  r = await call('/activity/register', { body: { activity_id: 'act-direct' }, token: studentToken(uDisabled) })
  assert('禁用用户 → 403', r.payload.code === 403, JSON.stringify(r.payload))

  r = await call('/activity/register', { body: { activity_id: 'act-ongoing' }, token: studentToken(uStudent) })
  assert('非报名中（ongoing）→ 1002', r.payload.code === 1002 && r.payload.message.includes('报名中'), JSON.stringify(r.payload))

  r = await call('/activity/register', { body: { activity_id: 'act-closed' }, token: studentToken(uStudent) })
  assert('不在报名时段（已截止）→ 1002', r.payload.code === 1002 && r.payload.message.includes('时段'), JSON.stringify(r.payload))

  /* ---------- 2. 三路径分发 ---------- */
  console.log('\n【register · 三路径分发】')
  r = await call('/activity/register', { body: { activity_id: 'act-direct', remark: '想参加' }, token: studentToken(uStudent) })
  assert('有名额 + 非审核 → approved', r.payload.code === 0 && r.payload.data.status === 'approved', JSON.stringify(r.payload).slice(0, 220))
  const myReg = regsOf('act-direct').find((x) => x.user_id === uStudent._id)
  assert('落库：remark + signup_at + checked_in=false', myReg.remark === '想参加' && !!myReg.signup_at && myReg.checked_in === false, JSON.stringify(myReg).slice(0, 220))
  assert('报名成功站内消息（scene=activity_signup_success）', stores.messages.some((m) => m.scene === 'activity_signup_success' && m.biz_id === 'act-direct' && m.user_id === uStudent._id))

  r = await call('/activity/register', { body: { activity_id: 'act-direct' }, token: studentToken(uStudent) })
  assert('重复报名有效 → 1002', r.payload.code === 1002 && r.payload.message.includes('重复报名'), JSON.stringify(r.payload))

  r = await call('/activity/register', { body: { activity_id: 'act-review' }, token: studentToken(uStudent) })
  assert('审核类 → pending（无通知）', r.payload.code === 0 && r.payload.data.status === 'pending' && !stores.messages.some((m) => m.scene === 'activity_signup_success' && m.biz_id === 'act-review'), JSON.stringify(r.payload).slice(0, 200))

  r = await call('/activity/register', { body: { activity_id: 'act-full' }, token: studentToken(uStudent) })
  assert('满员 + 候补 → waitlist', r.payload.code === 0 && r.payload.data.status === 'waitlist', JSON.stringify(r.payload).slice(0, 200))
  assert('候补站内消息（scene=activity_signup_waitlist）', stores.messages.some((m) => m.scene === 'activity_signup_waitlist' && m.biz_id === 'act-full' && m.user_id === uStudent._id))

  r = await call('/activity/register', { body: { activity_id: 'act-nofull' }, token: studentToken(uStudent) })
  assert('满员 + 无候补 → 1002 已满', r.payload.code === 1002 && r.payload.data.full === true, JSON.stringify(r.payload))

  /* ---------- 3. cancel：前置与递补 ---------- */
  console.log('\n【cancel · 前置与递补】')
  r = await call('/activity/cancel', { body: { activity_id: 'act-review' }, token: studentToken(uStudent2) })
  assert('未报名取消 → 1002', r.payload.code === 1002, JSON.stringify(r.payload))

  r = await call('/activity/cancel', { body: { activity_id: 'act-closed' }, token: studentToken(uStudent) })
  assert('报名截止后取消 → 1002', r.payload.code === 1002 && r.payload.message.includes('截止'), JSON.stringify(r.payload))

  // uStudent2 报名 act-full 变候补 → 取消 uStudent 的 approved（act-direct 无候补，act-full 的 approved 是 u-x1）
  // 构造递补场景：先让 uStudent2 报 act-full（waitlist），再让 u-x1 取消 approved → 递补首位 waitlist
  r = await call('/activity/register', { body: { activity_id: 'act-full' }, token: studentToken(uStudent2) })
  assert('uStudent2 进入 act-full 候补', r.payload.data.status === 'waitlist', JSON.stringify(r.payload).slice(0, 160))
  // 用管理 token 模拟 u-x1 取消（stub 直接操作数据 + 调接口更贴近：u-x1 无 token，改用直接构造）
  const wx1Row = regsOf('act-full').find((x) => x.user_id === 'u-x1')
  stores.activity_registrations.find((x) => x._id === wx1Row._id).status = 'cancelled'
  r = await call('/activity/promote', { body: { activity_id: 'act-full' }, token: studentToken(uManager) })
  assert('负责人手动递补 → 首位候补转正', r.payload.code === 0 && r.payload.data.promoted && regsOf('act-full').find((x) => x.user_id === 'u-y1').status === 'approved', JSON.stringify(r.payload))
  assert('递补通知（scene=activity_waitlist_promoted）', stores.messages.some((m) => m.scene === 'activity_waitlist_promoted' && m.biz_id === 'act-full' && m.user_id === 'u-y1'))

  // R-05 容量闸门：递补后名额已满，再次手动递补须被拦（避免 approved > capacity）
  r = await call('/activity/promote', { body: { activity_id: 'act-full' }, token: studentToken(uManager) })
  assert('满员时手动递补 → 1002（容量闸门）', r.payload.code === 1002 && r.payload.message.includes('名额已满'), JSON.stringify(r.payload))

  r = await call('/activity/promote', { body: { activity_id: 'act-full' }, token: studentToken(uStudent) })
  assert('非负责人递补 → 403', r.payload.code === 403, JSON.stringify(r.payload))
  r = await call('/activity/promote', { body: { activity_id: 'act-nofull' }, token: studentToken(uManager) })
  assert('未开启候补的活动递补 → 1002', r.payload.code === 1002 && r.payload.message.includes('候补'), JSON.stringify(r.payload))

  // 取消后释放名额自动递补：act-direct 有 uStudent approved（占 1/2），加一个 waitlist，取消 uStudent → 自动递补
  r = await call('/activity/register', { body: { activity_id: 'act-direct' }, token: studentToken(uStudent2) })
  assert('act-direct 第二人报名 → approved', r.payload.data.status === 'approved', JSON.stringify(r.payload).slice(0, 160))
  r = await call('/activity/register', { body: { activity_id: 'act-direct' }, token: studentToken(uStudent3) })
  assert('act-direct 满员第三人在候补', r.payload.data.status === 'waitlist', JSON.stringify(r.payload).slice(0, 160))

  r = await call('/activity/cancel', { body: { activity_id: 'act-direct' }, token: studentToken(uStudent) })
  assert('取消成功 → cancelled 且自动递补候补', r.payload.code === 0 && r.payload.data.registration.status === 'cancelled' && !!r.payload.data.promoted, JSON.stringify(r.payload).slice(0, 220))
  assert('候补 uStudent3 被转正', regsOf('act-direct').find((x) => x.user_id === uStudent3._id).status === 'approved')
  assert('转正通知发给 uStudent3', stores.messages.some((m) => m.scene === 'activity_waitlist_promoted' && m.biz_id === 'act-direct' && m.user_id === uStudent3._id))

  r = await call('/activity/register', { body: { activity_id: 'act-direct' }, token: studentToken(uStudent) })
  assert('取消后可再次报名（cancelled 不影响再报；此时已满 → 进入候补）', r.payload.code === 0 && r.payload.data.status === 'waitlist', JSON.stringify(r.payload).slice(0, 160))

  /* ---------- 4. my-registrations ---------- */
  console.log('\n【my-registrations】')
  r = await call('/activity/my-registrations', { method: 'GET' })
  assert('无 token → 401', r.statusCode === 401, JSON.stringify(r.payload))

  r = await call('/activity/my-registrations', { method: 'GET', token: studentToken(uStudent) })
  const mine = r.payload.data.list
  assert('我的报名列表 join 活动快照与状态', r.payload.code === 0 && mine.some((i) => i.activity_id === 'act-direct' && i.activity.title && ['approved', 'cancelled'].indexOf(i.status) !== -1), JSON.stringify(mine.map((i) => i.status)))
  assert('可取消标记（act-direct 报名中且我有效报名，当前为候补）', mine.find((i) => i.activity_id === 'act-direct' && i.status === 'waitlist').can_cancel === true, JSON.stringify(mine.map((i) => ({ a: i.activity_id, s: i.status, c: i.can_cancel }))))

  /* ---------- 5. detail my_registration ---------- */
  console.log('\n【detail · my_registration】')
  r = await call('/activity/detail', { method: 'GET', query: { activity_id: 'act-direct' } })
  assert('无 token → my_registration 为 null', r.payload.code === 0 && r.payload.data.my_registration === null, JSON.stringify(r.payload.data.my_registration))

  r = await call('/activity/detail', { method: 'GET', query: { activity_id: 'act-direct' }, token: studentToken(uStudent) })
  assert('带 token → 返回我的有效报名状态（当前为候补）', r.payload.code === 0 && r.payload.data.my_registration.status === 'waitlist', JSON.stringify(r.payload.data.my_registration))

  console.log(`\n通过 ${passed} 项，失败 ${failed} 项`)
  if (failed > 0) process.exitCode = 1
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
