/**
 * P1-17 本地验收（离线，无需部署）
 * 覆盖：招新聚合 list（在招筛选 / 关键词 / club 筛选 / 剩余名额与满员 / 分页）、
 *       招新报名 signup（closed / 截止 / 重复 / 已是成员 / 已录取同社团其它岗位 / 名额已满 /
 *              form_data 必填与选项校验 / 成功落库 pending 含 self_intro）、
 *       我的招新状态 my-status（join 岗位与社团名 / interview / accept_at / 分页）
 * 运行：node scripts/test-p1-17.js
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
const stores = { recruitments: [], recruitment_registrations: [], club_members: [], clubs: [], categories: [], users: [], messages: [], sensitive_words: [] }

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
const HOUR = 3600 * 1000
const now = new Date()
const at = (ms) => new Date(ms)

function user(over) {
  seq += 1
  return { _id: `u-${seq}`, openid: `openid-${seq}`, name: '用户', student_no: `2026${String(seq).padStart(4, '0')}`, auth_status: 'verified', status: 'normal', deleted: 0, ...over }
}
const uStudent = user({ name: '苏晚晴', student_no: '20260002' })
const uStudent2 = user({ name: '何子轩', student_no: '20260003' })
const uMember = user({ name: '陈默', student_no: '20260004' })
const uPlain = user({ name: '路人', student_no: '20260005' })
stores.users.push(uStudent, uStudent2, uMember, uPlain)

stores.clubs.push(
  { _id: 'club-a', name: '天文社', intro: '', contact: '', status: 'normal', deleted: 0 },
  { _id: 'club-b', name: '街舞社', intro: '', contact: '', status: 'normal', deleted: 0 }
)
stores.club_members.push({ _id: 'm-1', club_id: 'club-a', user_id: uMember._id, role: 'member', status: 'active', joined_at: at(now.getTime() - 10 * DAY), deleted: 0 })

function recruitmentRow(over) {
  return {
    club_id: 'club-a',
    title: '干事招新',
    content: '欢迎加入',
    form_fields: [
      { key: 'dept', label: '意向部门', type: 'single', required: true, options: ['活动部', '宣传部'] },
      { key: 'skills', label: '擅长技能', type: 'multi', required: false, options: ['设计', '策划'] },
      { key: 'intro', label: '自我介绍', type: 'text', required: false, options: [] },
    ],
    multi_step: false,
    signup_end: at(now.getTime() + 3 * DAY),
    capacity: null,
    status: 'open',
    created_at: at(now.getTime() - 1 * DAY),
    updated_at: at(now.getTime() - 1 * DAY),
    deleted: 0,
    ...over,
  }
}
stores.recruitments.push(
  recruitmentRow({ _id: 'rc-1', title: '干事招新' }),
  recruitmentRow({ _id: 'rc-full', title: '满员岗位', capacity: 2 }),
  recruitmentRow({ _id: 'rc-expired', title: '已过时岗位', signup_end: at(now.getTime() - 1 * HOUR) }),
  recruitmentRow({ _id: 'rc-b', club_id: 'club-b', title: '街舞队员' }),
  recruitmentRow({ _id: 'rc-closed', title: '已关闭岗位', status: 'closed', signup_end: at(now.getTime() + 1 * DAY) }),
  recruitmentRow({ _id: 'rc-other', title: '干事招新（同社其他）' })
)
stores.recruitment_registrations.push(
  { _id: 'rr-1', recruitment_id: 'rc-full', user_id: uStudent._id, status: 'pending', form_data: {}, applied_at: at(now.getTime() - 1 * DAY), deleted: 0 },
  { _id: 'rr-2', recruitment_id: 'rc-full', user_id: uStudent2._id, status: 'accepted', form_data: {}, applied_at: at(now.getTime() - 1 * DAY), deleted: 0 },
  // uStudent 已录取 club-a 的 rc-other（同社团其他岗位）
  { _id: 'rr-3', recruitment_id: 'rc-other', user_id: uStudent._id, status: 'accepted', form_data: {}, applied_at: at(now.getTime() - 2 * DAY), accept_at: at(now.getTime() - 1 * DAY), deleted: 0 },
  // uStudent2 已报名 rc-1（重复拦截用）
  { _id: 'rr-4', recruitment_id: 'rc-1', user_id: uStudent2._id, status: 'pending', form_data: {}, applied_at: at(now.getTime() - 3 * HOUR), deleted: 0 }
)

const recruitmentFn = require('../uniCloud-aliyun/cloudfunctions/recruitment/index.js')

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
  const res = await recruitmentFn.main({
    httpMethod: method,
    path: pathname.replace(/^\/recruitment/, ''),
    headers,
    body: body ? JSON.stringify(body) : '',
    queryStringParameters: query || {},
  })
  return { statusCode: res.statusCode, payload: JSON.parse(res.body) }
}

const regById = (id) => stores.recruitment_registrations.find((x) => x._id === id)
const GOOD_FORM = { dept: '活动部', skills: ['设计'], intro: '热爱社团活动' }

async function main() {
  /* ---------- 1. 聚合列表 ---------- */
  console.log('\n【list】')
  let r = await call('/list', { method: 'GET', query: { page: 1, page_size: 20 }, token: null })
  assert('公开可访问（无需 token）', r.payload.code === 0, JSON.stringify(r.payload).slice(0, 120))
  // open 5 个：rc-1 / rc-full / rc-expired / rc-b / rc-other（rc-closed 隐藏）
  assert('仅返回 open 岗位（5 个）', r.payload.data.total === 5, JSON.stringify(r.payload.data.list.map((x) => x._id)))
  const full = r.payload.data.list.find((x) => x._id === 'rc-full')
  assert('满员岗位 remaining=0 / full=true', full.remaining === 0 && full.full === true, JSON.stringify(full))
  const okRow = r.payload.data.list.find((x) => x._id === 'rc-1')
  assert('不限名额 remaining=null / full=false / club_name join', okRow.remaining === null && okRow.full === false && okRow.club_name === '天文社', JSON.stringify(okRow))
  const expired = r.payload.data.list.find((x) => x._id === 'rc-expired')
  assert('已过截止岗位 deadline_passed=true', expired.deadline_passed === true, JSON.stringify(expired))

  r = await call('/list', { method: 'GET', query: { page: 1, page_size: 20, keyword: '干事' }, token: null })
  assert('关键词筛选命中 2 个', r.payload.code === 0 && r.payload.data.total === 2, JSON.stringify(r.payload.data.list.map((x) => x.title)))

  r = await call('/list', { method: 'GET', query: { page: 1, page_size: 2 }, token: null })
  assert('分页 page_size=2 → has_more', r.payload.code === 0 && r.payload.data.list.length === 2 && r.payload.data.has_more === true, JSON.stringify(r.payload.data).slice(0, 120))

  /* ---------- 2. 招新报名 ---------- */
  console.log('\n【signup】')
  r = await call('/signup', { body: { recruitment_id: 'rc-1', form_data: GOOD_FORM }, token: null })
  assert('未登录报名 → 401', r.payload.code === 401, JSON.stringify(r.payload))

  r = await call('/signup', { body: { recruitment_id: 'rc-closed', form_data: GOOD_FORM }, token: studentToken(uMember) })
  assert('closed 岗位 → 1002', r.payload.code === 1002 && /关闭/.test(r.payload.message), JSON.stringify(r.payload))

  r = await call('/signup', { body: { recruitment_id: 'rc-expired', form_data: GOOD_FORM }, token: studentToken(uStudent2) })
  assert('已截止岗位 → 1002', r.payload.code === 1002 && /截止/.test(r.payload.message), JSON.stringify(r.payload))

  r = await call('/signup', { body: { recruitment_id: 'rc-1', form_data: GOOD_FORM }, token: studentToken(uStudent2) })
  assert('重复报名 → 1002', r.payload.code === 1002 && /重复/.test(r.payload.message), JSON.stringify(r.payload))

  r = await call('/signup', { body: { recruitment_id: 'rc-1', form_data: GOOD_FORM }, token: studentToken(uMember) })
  assert('已是社团成员 → 1002', r.payload.code === 1002 && /成员/.test(r.payload.message), JSON.stringify(r.payload))

  r = await call('/signup', { body: { recruitment_id: 'rc-1', form_data: GOOD_FORM }, token: studentToken(uStudent) })
  assert('已录取同社团其他岗位 → 1002', r.payload.code === 1002 && /录取/.test(r.payload.message), JSON.stringify(r.payload))

  r = await call('/signup', { body: { recruitment_id: 'rc-full', form_data: GOOD_FORM }, token: studentToken(uPlain) })
  assert('名额已满（2/2）→ 1002', r.payload.code === 1002 && /名额/.test(r.payload.message), JSON.stringify(r.payload))

  r = await call('/signup', { body: { recruitment_id: 'rc-b', form_data: { dept: '坏选项' } }, token: studentToken(uStudent) })
  assert('单选项非法 → 1001', r.payload.code === 1001, JSON.stringify(r.payload))

  r = await call('/signup', { body: { recruitment_id: 'rc-b', form_data: { skills: ['设计'] } }, token: studentToken(uStudent) })
  assert('必填缺省（dept 未填）→ 1001', r.payload.code === 1001 && /意向部门/.test(r.payload.message), JSON.stringify(r.payload))

  r = await call('/signup', { body: { recruitment_id: 'rc-b', form_data: { dept: '活动部' } }, token: studentToken(uStudent) })
  assert('合法报名 → pending 落库 + self_intro', r.payload.code === 0 && stores.recruitment_registrations.some((x) => x.recruitment_id === 'rc-b' && x.user_id === uStudent._id && x.status === 'pending' && x.form_data.dept === '活动部'), JSON.stringify(r.payload).slice(0, 160))

  /* ---------- 3. 我的招新状态 ---------- */
  console.log('\n【my-status】')
  r = await call('/my-status', { method: 'GET', query: { page: 1, page_size: 20 }, token: studentToken(uStudent) })
  assert('我的招新历史（3 条）+ join 岗位与社团名', r.payload.code === 0 && r.payload.data.total === 3 && r.payload.data.list.every((row) => row.recruitment_title && row.club_name), JSON.stringify(r.payload.data).slice(0, 200))
  const acceptedRow = r.payload.data.list.find((x) => x.recruitment_id === 'rc-other')
  assert('accepted 记录含 accept_at / interview null', acceptedRow.status === 'accepted' && acceptedRow.accept_at && acceptedRow.interview === null, JSON.stringify(acceptedRow))

  stores.recruitment_registrations.push({ _id: 'rr-5', recruitment_id: 'rc-1', user_id: uStudent2._id, status: 'interview', form_data: {}, interview: { time: at(now.getTime() + 1 * DAY), place: '活动室 101' }, applied_at: at(now.getTime() - 2 * DAY), deleted: 0 })
  r = await call('/my-status', { method: 'GET', query: { page: 1, page_size: 20 }, token: studentToken(uStudent2) })
  const interviewRow = r.payload.data.list.find((x) => x.recruitment_id === 'rc-1' && x.interview)
  assert('interview 记录含时间地点', r.payload.code === 0 && interviewRow && interviewRow.interview.time && interviewRow.interview.place === '活动室 101', JSON.stringify(interviewRow))

  console.log(`\n通过 ${passed} 项，失败 ${failed} 项`)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error('测试异常：', e)
  process.exit(1)
})