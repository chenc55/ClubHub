/**
 * P1-12 本地验收（离线，无需部署）
 * 覆盖：学生端活动列表（公开访问、可见口径、排序未结束升序 + 已结束沉底、分类/时间/状态/关键词筛选、
 *       我的报名可选 token、报名进度聚合、分页）/ 活动详情（404 分支、join 社团名与进度）/ 参数校验
 * 运行：node scripts/test-p1-12.js
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

/** 聚合 stub：按 activity_id 分组计数（countRegistrationsByActivityId 用） */
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
const todayNoon = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0)
const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7))
const at = (d) => new Date(d)

function user(over) {
  seq += 1
  return { _id: `u-${seq}`, openid: `openid-${seq}`, name: '用户', auth_status: 'verified', status: 'normal', deleted: 0, ...over }
}
const u1 = user({ name: '林晨' })
stores.users.push(u1)

stores.categories.push({ _id: 'c-1', name: '学术科技', sort: 1, deleted: 0 })
stores.clubs.push(
  { _id: 'club-a', name: '天文社', intro: '看星星', contact: 'QQ1', status: 'normal', deleted: 0 },
  { _id: 'club-b', name: '街舞社', intro: '跳舞', contact: 'QQ2', status: 'normal', deleted: 0 }
)

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
    capacity: 50,
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
  // 未结束组（按 start_time 升序期望）
  activityRow({ _id: 'a-ongoing', title: '进行中的天文直播', status: 'ongoing', start_time: at(now.getTime() - 1 * HOUR), end_time: at(now.getTime() + 2 * HOUR) }),
  activityRow({ _id: 'a-signup-b', title: '观星讲座', status: 'signup', start_time: at(now.getTime() + 1 * DAY) }),
  activityRow({ _id: 'a-signup-a', title: '流星雨之夜', status: 'signup', start_time: at(now.getTime() + 2 * DAY) }),
  activityRow({ _id: 'a-approved', title: '待开放的摄影展', status: 'approved', start_time: at(now.getTime() + 3 * DAY) }),
  // 已结束组（沉底，内部 start_time 倒序期望）
  activityRow({ _id: 'a-ended', title: '上周的观星夜', status: 'ended', start_time: at(now.getTime() - 2 * DAY) }),
  activityRow({ _id: 'a-archived', title: '已归档的活动', status: 'archived', start_time: at(now.getTime() - 5 * DAY) }),
  // 不可见
  activityRow({ _id: 'a-draft', title: '草稿活动', status: 'draft' }),
  activityRow({ _id: 'a-pending', title: '待审核活动', status: 'pending' }),
  // 时间筛选专用
  activityRow({ _id: 'a-today', title: '今天的观月会', status: 'signup', start_time: todayNoon, club_id: 'club-b' }),
  activityRow({ _id: 'a-week', title: '本周的观星课', status: 'signup', start_time: at(weekStart.getTime() + 2 * DAY), club_id: 'club-b' })
)

function regRow(over) {
  return { activity_id: 'a-signup-a', user_id: u1._id, status: 'approved', created_at: at(now.getTime() - 1 * DAY), ...over }
}
stores.activity_registrations.push(
  regRow({ _id: 'r-1', status: 'approved' }),
  regRow({ _id: 'r-2', activity_id: 'a-signup-a', user_id: 'u-other-1', status: 'pending' }),
  regRow({ _id: 'r-3', activity_id: 'a-signup-a', user_id: 'u-other-2', status: 'waitlist' }),
  regRow({ _id: 'r-4', activity_id: 'a-signup-a', user_id: 'u-other-3', status: 'cancelled' }),
  regRow({ _id: 'r-5', activity_id: 'a-ended', user_id: 'u-other-4', status: 'approved' }),
  regRow({ _id: 'r-6', activity_id: 'a-ended', user_id: 'u-other-5', status: 'approved' })
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

async function call(pathname, { method = 'GET', query, token } = {}) {
  const headers = { 'content-type': 'application/json' }
  if (token) headers.authorization = `Bearer ${token}`
  const res = await activityFn.main({
    httpMethod: method,
    path: pathname.replace(/^\/activity/, ''),
    headers,
    body: '',
    queryStringParameters: query || {},
  })
  return { statusCode: res.statusCode, payload: JSON.parse(res.body) }
}

const idsOf = (r) => r.payload.data.list.map((i) => i._id)

async function main() {
  /* ---------- 1. 公开访问与可见口径 ---------- */
  console.log('\n【列表 · 公开访问与可见口径】')
  let r = await call('/activity/list')
  assert('无 token 可访问（游客浏览，需求 4.1）', r.payload.code === 0, JSON.stringify(r.payload).slice(0, 120))
  const all = idsOf(r)
  assert('draft / pending 不可见（共 8 个可见）', r.payload.data.total === 8 && all.indexOf('a-draft') === -1 && all.indexOf('a-pending') === -1, JSON.stringify(all))

  /* ---------- 2. 排序：未结束升序 + 已结束沉底 ---------- */
  console.log('\n【列表 · 排序】')
  const times = (id) => new Date(stores.activities.find((row) => row._id === id).start_time).getTime()
  const upcomingIds = all.filter((id) => ['a-ongoing', 'a-signup-b', 'a-signup-a', 'a-approved', 'a-today', 'a-week'].indexOf(id) !== -1)
  const finishedIds = all.filter((id) => ['a-ended', 'a-archived'].indexOf(id) !== -1)
  const upcomingOk = upcomingIds.every((id, i) => i === 0 || times(upcomingIds[i - 1]) <= times(id))
  const finishedOk = finishedIds.every((id, i) => i === 0 || times(finishedIds[i - 1]) >= times(id))
  const lastUpcomingIndex = Math.max(...upcomingIds.map((id) => all.indexOf(id)))
  const firstFinishedIndex = Math.min(...finishedIds.map((id) => all.indexOf(id)))
  assert('未结束全部排在已结束之前（沉底）', lastUpcomingIndex < firstFinishedIndex, JSON.stringify(all))
  assert('未结束内部按开始时间升序（最近优先）', upcomingOk, JSON.stringify(upcomingIds))
  assert('已结束内部按开始时间倒序（刚结束的靠前）', finishedOk, JSON.stringify(finishedIds))

  /* ---------- 3. 筛选 ---------- */
  console.log('\n【列表 · 筛选】')
  r = await call('/activity/list', { query: { category_id: 'c-1' } })
  assert('分类筛选（c-1）返回全部可见活动', r.payload.code === 0 && r.payload.data.total === 8, JSON.stringify(idsOf(r)))
  r = await call('/activity/list', { query: { category_id: 'not-exist' } })
  assert('分类筛选（不存在分类）→ 空', r.payload.data.total === 0, JSON.stringify(idsOf(r)))

  r = await call('/activity/list', { query: { status: 'signup' } })
  assert('状态筛选「报名中」→ 仅 approved + signup', r.payload.data.list.every((i) => ['approved', 'signup'].indexOf(i.status) !== -1), JSON.stringify(idsOf(r)))

  r = await call('/activity/list', { query: { status: 'ended' } })
  assert('状态筛选「已结束」→ 仅 ended + archived', idsOf(r).join(',') === 'a-ended,a-archived', JSON.stringify(idsOf(r)))

  r = await call('/activity/list', { query: { time: 'today' } })
  assert('时间筛选「今天」→ 含 a-today，且不含明天/未来活动', idsOf(r).indexOf('a-today') !== -1 && idsOf(r).indexOf('a-signup-b') === -1 && idsOf(r).indexOf('a-ended') === -1, JSON.stringify(idsOf(r)))

  r = await call('/activity/list', { query: { time: 'week' } })
  assert('时间筛选「本周」→ 含 a-week 与 a-today', idsOf(r).indexOf('a-week') !== -1 && idsOf(r).indexOf('a-today') !== -1, JSON.stringify(idsOf(r)))

  r = await call('/activity/list', { query: { keyword: '流星' } })
  assert('关键词命中标题', idsOf(r).join(',') === 'a-signup-a', JSON.stringify(idsOf(r)))

  r = await call('/activity/list', { query: { keyword: '.*' } })
  assert('关键词正则元字符转义（不命中全表）', r.payload.data.total === 0, JSON.stringify(r.payload.data.total))

  /* ---------- 4. 我的报名（可选 token） ---------- */
  console.log('\n【列表 · 我的报名】')
  r = await call('/activity/list', { query: { my: '1' } })
  assert('my=1 无 token → 401', r.statusCode === 401 && r.payload.code === 401, JSON.stringify(r.payload))

  r = await call('/activity/list', { query: { my: '1' }, token: studentToken(u1) })
  assert('my=1 有 token → 仅返回我报名的活动', idsOf(r).join(',') === 'a-signup-a', JSON.stringify(idsOf(r)))

  /* ---------- 5. 报名进度聚合 ---------- */
  console.log('\n【列表 · 报名进度】')
  const signupA = r.payload.data.list.find((i) => i._id === 'a-signup-a')
  const signupA2 = (await call('/activity/list')).payload.data.list.find((i) => i._id === 'a-signup-a')
  assert('有效报名计数（pending/approved/waitlist，cancelled 不计）', signupA2.registered_count === 3, JSON.stringify(signupA2))
  const endedA = (await call('/activity/list')).payload.data.list.find((i) => i._id === 'a-ended')
  assert('已结束活动也带报名进度', endedA.registered_count === 2, JSON.stringify(endedA))

  /* ---------- 6. 分页 ---------- */
  console.log('\n【列表 · 分页】')
  r = await call('/activity/list', { query: { page: 1, page_size: 3 } })
  assert('第一页 3 条且 has_more=true', r.payload.data.list.length === 3 && r.payload.data.has_more === true, JSON.stringify(idsOf(r)))
  const page1 = idsOf(r)
  r = await call('/activity/list', { query: { page: 2, page_size: 3 } })
  assert('第二页不与第一页重叠', idsOf(r).every((id) => page1.indexOf(id) === -1), JSON.stringify(idsOf(r)))

  /* ---------- 7. 参数校验 ---------- */
  console.log('\n【列表 · 参数校验】')
  r = await call('/activity/list', { query: { page: '0' } })
  assert('page=0 → 1001', r.payload.code === 1001, JSON.stringify(r.payload))
  r = await call('/activity/list', { query: { page_size: 51 } })
  assert('page_size 超限 → 1001', r.payload.code === 1001, JSON.stringify(r.payload))
  r = await call('/activity/list', { query: { time: 'yesterday' } })
  assert('time 非法 → 1001', r.payload.code === 1001, JSON.stringify(r.payload))
  r = await call('/activity/list', { query: { status: 'bogus' } })
  assert('status 非法 → 1001', r.payload.code === 1001, JSON.stringify(r.payload))
  r = await call('/activity/list', { query: { keyword: '一二三四五六七八九十一二三四五六七八九十一' } })
  assert('关键词超长 → 1001', r.payload.code === 1001, JSON.stringify(r.payload))

  /* ---------- 8. 详情 ---------- */
  console.log('\n【详情】')
  r = await call('/activity/detail')
  assert('缺 activity_id → 1001', r.payload.code === 1001, JSON.stringify(r.payload))
  r = await call('/activity/detail', { query: { activity_id: 'not-exist' } })
  assert('不存在 → 404', r.payload.code === 404, JSON.stringify(r.payload))
  r = await call('/activity/detail', { query: { activity_id: 'a-draft' } })
  assert('草稿 → 404', r.payload.code === 404, JSON.stringify(r.payload))
  r = await call('/activity/detail', { query: { activity_id: 'a-pending' } })
  assert('待审核 → 404', r.payload.code === 404, JSON.stringify(r.payload))

  r = await call('/activity/detail', { query: { activity_id: 'a-signup-a' } })
  const detail = r.payload.data.activity
  assert('详情返回完整字段与 join 社团名、进度',
    r.payload.code === 0 && detail.title === '流星雨之夜' && detail.club_name === '天文社' &&
    detail.registered_count === 3 && detail.capacity === 50 && detail.need_approval === false,
    JSON.stringify(detail).slice(0, 300))

  r = await call('/activity/detail', { query: { activity_id: 'a-today' } })
  assert('详情 join 多社团（club-b 街舞社）', r.payload.data.activity.club_name === '街舞社', JSON.stringify(r.payload.data.activity.club_name))

  console.log(`\n通过 ${passed} 项，失败 ${failed} 项`)
  if (failed > 0) process.exitCode = 1
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
