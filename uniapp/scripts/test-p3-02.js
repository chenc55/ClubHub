/**
 * P3-02 本地验收（离线，无需部署）
 * 覆盖：合规与脱敏专项（需求 8.4）
 *   A. 服务端学号脱敏：活动报名名单 / 招新申请人列表返回 student_no_masked（不再返回完整 student_no），
 *      导出 CSV 保留完整学号不受影响（P1-15 业务口径）；公共 maskStudentNo 规则
 *   B. 注销申请链路：学生端提交（user /deletion-request）→ 管理端列表（join 脱敏学号）→
 *      通过（users 软删 + 个人可识别字段匿名化）/ 驳回（理由必填 + 站内通知 account_deletion_result）
 * 运行：node scripts/test-p3-02.js
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
const stores = {
  users: [], admins: [], whitelist: [],
  activities: [], activity_registrations: [], checkins: [], club_members: [],
  recruitments: [], recruitment_registrations: [],
  account_deletion_requests: [], messages: [],
}

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
      if (Object.prototype.hasOwnProperty.call(want, '__lt')) return new Date(row[key]).getTime() < new Date(want.__lt).getTime()
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
        const at = new Date(a[field]).getTime()
        const bt = new Date(b[field]).getTime()
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
      lt: (value) => ({ __lt: value }),
      lte: (value) => ({ __lte: value }),
    },
  }),
  httpclient: { request: async () => ({ data: { access_token: 'T', expires_in: 7200 } }) },
}

/* ---------- 种子数据 ---------- */
const now = Date.now()
const at = (ms) => new Date(ms)

stores.users.push(
  { _id: 'u-1', openid: 'o-1', name: '苏晚晴', student_no: '20260002', auth_status: 'verified', status: 'normal', deleted: 0, created_at: at(now - 100000) },
  { _id: 'u-2', openid: 'o-2', name: '何子轩', student_no: '20260003', auth_status: 'verified', status: 'normal', deleted: 0, created_at: at(now - 100000) },
  { _id: 'u-mgr', openid: 'o-9', name: '社长', student_no: '20260001', auth_status: 'verified', status: 'normal', deleted: 0, created_at: at(now - 100000) },
  { _id: 'u-3', openid: 'o-3', name: '赵一鸣', student_no: '20260004', auth_status: 'verified', status: 'normal', deleted: 0, created_at: at(now - 100000) },
)
stores.admins.push(
  { _id: 'a-super', username: 'root', name: '超管', role: 'super', deleted: 0 },
  { _id: 'a-view', username: 'viewer1', name: '数据员', role: 'viewer', deleted: 0 }
)
stores.club_members.push(
  { _id: 'm-1', club_id: 'club-a', user_id: 'u-mgr', role: 'president', status: 'active', deleted: 0 }
)
stores.activities.push(
  { _id: 'act-1', club_id: 'club-a', title: '公开课', status: 'signup', created_at: at(now - 5000), deleted: 0 }
)
stores.activity_registrations.push(
  { _id: 'reg-1', activity_id: 'act-1', user_id: 'u-1', status: 'approved', signup_at: at(now - 4000), checked_in: false, deleted: 0 },
  { _id: 'reg-2', activity_id: 'act-1', user_id: 'u-2', status: 'approved', signup_at: at(now - 3000), checked_in: false, deleted: 0 }
)
stores.recruitments.push(
  { _id: 'rc-1', club_id: 'club-a', title: '干事招新', status: 'open', created_at: at(now - 5000), deleted: 0 }
)
stores.recruitment_registrations.push(
  { _id: 'app-1', recruitment_id: 'rc-1', user_id: 'u-3', status: 'pending', applied_at: at(now - 2000), deleted: 0 }
)

const activityFn = require('../uniCloud-aliyun/cloudfunctions/activity/index.js')
const recruitmentFn = require('../uniCloud-aliyun/cloudfunctions/recruitment/index.js')
const userFn = require('../uniCloud-aliyun/cloudfunctions/user/index.js')
const adminFn = require('../uniCloud-aliyun/cloudfunctions/admin/index.js')

function studentToken(userRow) {
  return club.signToken({ type: club.TOKEN_TYPES.STUDENT, token_kind: 'access', userId: userRow._id, openid: userRow.openid, auth_status: userRow.auth_status })
}
const mgrToken = studentToken(stores.users[2])
const user1Token = studentToken(stores.users[0])

function adminToken(adminRow) {
  return club.signToken({ type: club.TOKEN_TYPES.ADMIN, adminId: adminRow._id, username: adminRow.username, role: adminRow.role, name: adminRow.name || '' })
}
const superToken = adminToken(stores.admins[0])
const viewToken = adminToken(stores.admins[1])

async function call(fn, { method = 'GET', path, qs = {}, body = null, token = null }) {
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

async function main() {
  console.log('\n【A. maskStudentNo 规则】')
  assert('8 位学号前4后2 中间打码（20260002 → 2026**02）', club.maskStudentNo('20260002') === '2026**02', club.maskStudentNo('20260002'))
  assert('10 位学号中间全打码', club.maskStudentNo('2026000011') === '2026****11', club.maskStudentNo('2026000011'))
  assert('≤6 位全打码 / 空值空串', club.maskStudentNo('123456') === '******' && club.maskStudentNo('') === '')

  console.log('\n【A. 活动报名名单服务端脱敏】')
  let r = await call(activityFn, { path: '/registrations', qs: { activity_id: 'act-1' }, token: mgrToken })
  assert('registrations 返回 student_no_masked 且不再返回完整 student_no', r.code === 0 && r.data.list.length === 2 && r.data.list[0].student_no_masked === '2026**02' && r.data.list[1].student_no_masked === '2026**03' && !Object.prototype.hasOwnProperty.call(r.data.list[0], 'student_no'), JSON.stringify(r.data.list[0]))

  console.log('\n【A. 招新申请人服务端脱敏】')
  r = await call(recruitmentFn, { path: '/applicants', qs: { recruitment_id: 'rc-1' }, token: mgrToken })
  assert('applicants 返回 student_no_masked 且无完整 student_no', r.code === 0 && r.data.list[0].student_no_masked === '2026**04' && !r.data.list[0].student_no, JSON.stringify(r.data.list[0]))

  console.log('\n【B. 注销申请 · 学生端提交】')
  r = await call(userFn, { method: 'POST', path: '/deletion-request', body: { reason: '不再使用' } })
  assert('无 token → 401', r.code === 401, JSON.stringify(r))
  r = await call(userFn, { method: 'POST', path: '/deletion-request', body: { reason: '不再使用' }, token: user1Token })
  assert('提交成功 → pending 落库', r.code === 0 && r.data.status === 'pending', JSON.stringify(r.data))
  const reqId = r.data._id
  const reqRow = stores.account_deletion_requests.find((x) => x._id === reqId)
  assert('落库字段完整（user_id / reason / deleted=0）', reqRow.user_id === 'u-1' && reqRow.reason === '不再使用' && reqRow.deleted === 0, JSON.stringify(reqRow))
  r = await call(userFn, { method: 'POST', path: '/deletion-request', body: { reason: '再来一次' }, token: user1Token })
  assert('重复提交 pending → 1002', r.code === 1002, JSON.stringify(r))
  r = await call(userFn, { method: 'POST', path: '/deletion-request', body: { reason: '长'.repeat(201) }, token: user1Token })
  assert('理由超长（201 字）→ 1001', r.code === 1001, JSON.stringify(r))

  console.log('\n【B. 注销申请 · 管理端列表】')
  r = await call(adminFn, { method: 'POST', path: '/deletion-requests/query', body: {} })
  assert('无 token → 401', r.code === 401, JSON.stringify(r))
  r = await call(adminFn, { method: 'POST', path: '/deletion-requests/query', body: {}, token: viewToken })
  assert('viewer → 403（仅 super / auditor）', r.code === 403, JSON.stringify(r))
  r = await call(adminFn, { method: 'POST', path: '/deletion-requests/query', body: {}, token: superToken })
  assert('列表 = 1 条 pending，join 申请人脱敏学号', r.code === 0 && r.data.total === 1 && r.data.pending_total === 1 && r.data.list[0].applicant_name === '苏晚晴' && r.data.list[0].applicant_no_masked === '2026**02', JSON.stringify(r.data.list[0]))

  console.log('\n【B. 注销申请 · 驳回】')
  r = await call(adminFn, { method: 'POST', path: '/deletion-requests/review', body: { id: reqId, action: 'reject' }, token: superToken })
  assert('驳回缺理由 → 1001', r.code === 1001, JSON.stringify(r))
  r = await call(adminFn, { method: 'POST', path: '/deletion-requests/review', body: { id: reqId, action: 'reject', reason: '存在未完结的报名流程，暂不能注销' }, token: superToken })
  assert('驳回成功 → status=rejected + 理由落库 + 处理人', r.code === 0 && r.data.status === 'rejected' && r.data.review_by === 'root', JSON.stringify(r.data))
  const rejRow = stores.account_deletion_requests.find((x) => x._id === reqId)
  assert('驳回理由 / review_at 落库', rejRow.reject_reason.indexOf('未完结') !== -1 && !!rejRow.review_at, JSON.stringify(rejRow))
  const rejMsg = stores.messages.filter((m) => m.user_id === 'u-1' && m.scene === 'account_deletion_result')
  assert('驳回通知写入站内消息（标题含「未通过」+ 理由）', rejMsg.length === 1 && rejMsg[0].title.indexOf('未通过') !== -1 && rejMsg[0].content.indexOf('驳回理由') !== -1, JSON.stringify(rejMsg[0]))
  assert('用户未被注销（驳回不影响账号）', stores.users.find((u) => u._id === 'u-1').deleted === 0)
  r = await call(adminFn, { method: 'POST', path: '/deletion-requests/review', body: { id: reqId, action: 'approve' }, token: superToken })
  assert('已处理申请重复审核 → 1002', r.code === 1002, JSON.stringify(r))

  console.log('\n【B. 注销申请 · 通过（软删 + 匿名化）】')
  r = await call(userFn, { method: 'POST', path: '/deletion-request', body: { reason: '毕业离校' }, token: user1Token })
  assert('u-1 再次提交新申请 → 成功', r.code === 0, JSON.stringify(r))
  const reqId2 = r.data._id
  r = await call(adminFn, { method: 'POST', path: '/deletion-requests/review', body: { id: reqId2, action: 'approve' }, token: superToken })
  assert('通过成功 → status=approved', r.code === 0 && r.data.status === 'approved', JSON.stringify(r.data))
  const user1 = stores.users.find((u) => u._id === 'u-1')
  assert('users 软删 deleted=1', user1.deleted === 1, JSON.stringify(user1))
  assert('openid 匿名化（占位唯一）', user1.openid === `deleted-u-1`, JSON.stringify(user1.openid))
  assert('学号匿名化（唯一占位 deleted-{uid}，释放真实学号；不用 null 避开唯一索引 null 冲突）', user1.student_no === 'deleted-u-1', JSON.stringify(user1.student_no))
  assert('姓名 / 昵称 → 已注销，auth_status 重置 unverified', user1.name === '已注销' && user1.nickname === '已注销' && user1.auth_status === 'unverified', JSON.stringify(user1))
  const appMsg = stores.messages.filter((m) => m.user_id === 'u-1' && m.scene === 'account_deletion_result' && m.biz_id === reqId2)
  assert('通过通知写入站内消息（标题「已通过」，biz_id 对应本次申请）', appMsg.length === 1 && appMsg[0].title.indexOf('已通过') !== -1 && appMsg[0].content.indexOf('匿名化') !== -1, JSON.stringify(appMsg[0]))
  const req2Row = stores.account_deletion_requests.find((x) => x._id === reqId2)
  assert('申请记录保留（审计）且 review_by=root', req2Row.status === 'approved' && req2Row.review_by === 'root', JSON.stringify(req2Row))

  /* ---------- 汇总 ---------- */
  console.log(`\n结果：${passed} 通过，${failed} 失败`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
