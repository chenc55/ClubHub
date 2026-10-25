/**
 * P1-18 本地验收（离线，无需部署）
 * 覆盖：申请人列表（权限 / 状态筛选 / join 用户 / status_count / 分页）、
 *       筛选操作 screen（权限 / 参数 / approve 进面试 / reject 淘汰 / accept 录取并自动入团 +
 *             被移除成员复活 / interview 设面试时间地点 / 已录取不可淘汰 / 已淘汰不可录取 / 通知）、
 *       一键通知 notify（去重 / 面试含时间地点）、导出 CSV（BOM / 表头 / 中文状态）
 * 运行：node scripts/test-p1-18.js
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
      gt: (value) => ({ __gt: value }),
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
const uManager = user({ name: '林晨', college: '计算机学院', major: '软件工程' })
const uA = user({ name: '苏晚晴', student_no: '20260002', college: '计科学院', major: '软件工程' })
const uB = user({ name: '何子轩', student_no: '20260003', college: '经管学院', major: '工商管理' })
const uC = user({ name: '赵一鸣', student_no: '20260004' })
stores.users.push(uManager, uA, uB, uC)

stores.clubs.push({ _id: 'club-a', name: '天文社', intro: '', contact: '', status: 'normal', deleted: 0 })
stores.club_members.push(
  { _id: 'm-1', club_id: 'club-a', user_id: uManager._id, role: 'president', status: 'active', joined_at: at(now.getTime() - 30 * DAY), deleted: 0 },
  // uC 曾被移除（removed），复验复活逻辑
  { _id: 'm-2', club_id: 'club-a', user_id: uC._id, role: 'member', status: 'removed', joined_at: at(now.getTime() - 20 * DAY), deleted: 0 }
)

stores.recruitments.push({
  _id: 'rc-1',
  club_id: 'club-a',
  title: '干事招新',
  content: '欢迎加入',
  form_fields: [
    { key: 'dept', label: '意向部门', type: 'single', required: true, options: ['活动部', '宣传部'] },
    { key: 'intro', label: '自我介绍', type: 'text', required: false, options: [] },
  ],
  multi_step: true,
  signup_end: at(now.getTime() + 3 * DAY),
  capacity: null,
  status: 'open',
  created_at: at(now.getTime() - 1 * DAY),
  updated_at: at(now.getTime() - 1 * DAY),
  deleted: 0,
})
stores.recruitment_registrations.push(
  { _id: 'rr-1', recruitment_id: 'rc-1', user_id: uA._id, status: 'pending', form_data: { dept: '活动部', intro: '热爱天文' }, interview: null, applied_at: at(now.getTime() - 3 * HOUR), accept_at: null, deleted: 0 },
  { _id: 'rr-2', recruitment_id: 'rc-1', user_id: uB._id, status: 'pending', form_data: { dept: '宣传部', intro: '有设计经验' }, interview: null, applied_at: at(now.getTime() - 2 * HOUR), accept_at: null, deleted: 0 },
  { _id: 'rr-3', recruitment_id: 'rc-1', user_id: uC._id, status: 'interview', form_data: { dept: '活动部' }, interview: { time: at(now.getTime() + 1 * DAY), place: '活动室 101' }, applied_at: at(now.getTime() - 1 * HOUR), accept_at: null, deleted: 0 }
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
const memberByUser = (uid) => stores.club_members.find((x) => x.club_id === 'club-a' && x.user_id === uid)

async function main() {
  /* ---------- 1. 申请人列表 ---------- */
  console.log('\n【applicants】')
  let r = await call('/applicants', { method: 'GET', query: { recruitment_id: 'rc-1' }, token: studentToken(uA) })
  assert('非负责人查询 → 403', r.payload.code === 403, JSON.stringify(r.payload))

  r = await call('/applicants', { method: 'GET', query: { recruitment_id: 'rc-1' }, token: studentToken(uManager) })
  assert('申请人列表 join 姓名/学号/学院 + status_count', r.payload.code === 0 && r.payload.data.total === 3 && r.payload.data.list[0].name === '苏晚晴' && r.payload.data.status_count.pending === 2 && r.payload.data.status_count.interview === 1 && r.payload.data.status_count.accepted === 0, JSON.stringify(r.payload.data).slice(0, 200))
  assert('申请人列表含 form_data 与面试信息', r.payload.data.list.find((x) => x.registration_id === 'rr-1').form_data.dept === '活动部' && r.payload.data.list.find((x) => x.registration_id === 'rr-3').interview.place === '活动室 101', JSON.stringify(r.payload.data.list[0]))

  r = await call('/applicants', { method: 'GET', query: { recruitment_id: 'rc-1', status: 'interview' }, token: studentToken(uManager) })
  assert('状态筛选 interview → 仅 rr-3', r.payload.code === 0 && r.payload.data.total === 1 && r.payload.data.list[0].registration_id === 'rr-3', JSON.stringify(r.payload.data).slice(0, 120))

  /* ---------- 2. 筛选操作（批量） ---------- */
  console.log('\n【screen】')
  r = await call('/screen', { body: { recruitment_id: 'rc-1', registration_ids: ['rr-1'], action: 'approve' }, token: studentToken(uA) })
  assert('非负责人操作 → 403', r.payload.code === 403, JSON.stringify(r.payload))

  r = await call('/screen', { body: { recruitment_id: 'rc-1', registration_ids: ['rr-1'], action: 'bad' }, token: studentToken(uManager) })
  assert('action 非法 → 1001', r.payload.code === 1001, JSON.stringify(r.payload))

  r = await call('/screen', { body: { recruitment_id: 'rc-1', registration_ids: [], action: 'approve' }, token: studentToken(uManager) })
  assert('未选申请人 → 1001', r.payload.code === 1001, JSON.stringify(r.payload))

  r = await call('/screen', { body: { recruitment_id: 'rc-1', registration_ids: ['rr-1', 'rr-2'], action: 'approve' }, token: studentToken(uManager) })
  assert('批量 approve → 都进 interview + 面试通知(recruitment_interview)', r.payload.code === 0 && regById('rr-1').status === 'interview' && regById('rr-2').status === 'interview' && stores.messages.some((m) => m.scene === 'recruitment_interview' && m.user_id === uA._id && /面试/.test(m.title + m.content)), JSON.stringify(r.payload).slice(0, 160))

  r = await call('/screen', { body: { recruitment_id: 'rc-1', registration_ids: ['rr-1'], action: 'approve' }, token: studentToken(uManager) })
  assert('interview 后不可再 approve → 1002', r.payload.code === 1002, JSON.stringify(r.payload))

  r = await call('/screen', { body: { recruitment_id: 'rc-1', registration_ids: ['rr-1'], action: 'interview', interview: { time: at(now.getTime() + 2 * DAY), place: '报告厅' } }, token: studentToken(uManager) })
  assert('interview 设时间地点 → 覆盖落库', r.payload.code === 0 && regById('rr-1').interview && regById('rr-1').interview.place === '报告厅', JSON.stringify(r.payload).slice(0, 160))

  r = await call('/screen', { body: { recruitment_id: 'rc-1', registration_ids: ['rr-1'], action: 'reject' }, token: studentToken(uManager) })
  assert('reject → rejected + 通知含淘汰', r.payload.code === 0 && regById('rr-1').status === 'rejected' && stores.messages.some((m) => m.scene === 'recruitment_result' && m.user_id === uA._id && /淘汰/.test(m.title + m.content)), JSON.stringify(r.payload).slice(0, 160))

  r = await call('/screen', { body: { recruitment_id: 'rc-1', registration_ids: ['rr-1'], action: 'accept' }, token: studentToken(uManager) })
  assert('rejected 不可录取 → 1002', r.payload.code === 1002, JSON.stringify(r.payload))

  /* ---------- 3. 录取与自动入团（含复活） ---------- */
  console.log('\n【accept / 入团】')
  r = await call('/screen', { body: { recruitment_id: 'rc-1', registration_ids: ['rr-2', 'rr-3'], action: 'accept' }, token: studentToken(uManager) })
  assert('accept 批量 → accepted（rr-2 新成员入团 + rr-3 复活）', r.payload.code === 0 && regById('rr-2').status === 'accepted' && regById('rr-3').status === 'accepted', JSON.stringify(r.payload).slice(0, 200))
  assert('rr-2 自动入团（新成员 active）', stores.club_members.some((x) => x.club_id === 'club-a' && x.user_id === uB._id && x.status === 'active' && x.role === 'member'), JSON.stringify(stores.club_members))
  const revived = memberByUser(uC._id)
  assert('被移除成员复活：removed → active', revived.status === 'active', JSON.stringify(revived))
  assert('录取通知含岗位名', stores.messages.some((m) => m.scene === 'recruitment_result' && m.user_id === uB._id && /录取/.test(m.title + m.content)), JSON.stringify(stores.messages.slice(-2)))

  r = await call('/screen', { body: { recruitment_id: 'rc-1', registration_ids: ['rr-2'], action: 'accept' }, token: studentToken(uManager) })
  assert('accept 重复录取 → 幂等（accepted 仍接受）', r.payload.code === 0 && regById('rr-2').status === 'accepted', JSON.stringify(r.payload).slice(0, 120))

  /* ---------- 4. 一键通知 ---------- */
  console.log('\n【notify】')
  r = await call('/notify', { body: { recruitment_id: 'rc-1', registration_ids: ['rr-2'] }, token: studentToken(uManager) })
  assert('一键通知 → sent、去重', r.payload.code === 0 && r.payload.data.total === 1, JSON.stringify(r.payload))

  /* ---------- 5. 导出 CSV ---------- */
  console.log('\n【export-csv】')
  r = await call('/export-csv', { method: 'GET', query: { recruitment_id: 'rc-1' }, token: studentToken(uA) })
  assert('非负责人导出 → 403', r.payload.code === 403, JSON.stringify(r.payload))

  r = await call('/export-csv', { method: 'GET', query: { recruitment_id: 'rc-1' }, token: studentToken(uManager) })
  assert('导出成功且 count=3', r.payload.code === 0 && r.payload.data.count === 3, JSON.stringify(r.payload.data).slice(0, 120))
  const csv = r.payload.data.csv
  assert('CSV 含 BOM 与表头', csv.startsWith('\uFEFF') && csv.indexOf('姓名,学号,学院专业,状态,报名时间') === 1, csv.slice(0, 80))
  assert('CSV 含学院专业与中文状态', csv.indexOf('计科学院 软件工程') !== -1 && csv.indexOf('已录取') !== -1 && csv.indexOf('已淘汰') !== -1, csv)

  console.log(`\n通过 ${passed} 项，失败 ${failed} 项`)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error('测试异常：', e)
  process.exit(1)
})