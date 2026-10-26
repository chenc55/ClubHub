/**
 * P1-11 本地验收（离线，无需部署）
 * 覆盖：管理端审核列表（权限 / 过滤 / 分页 / pending_total / join 发起人与社团名）/
 *       审核状态机（仅 pending 可审、通过 → approved、驳回 → draft + 必填理由）/
 *       发起人通知（submitter_id 落库、驳回与通过都通知、去重）/ 驳回后重提清痕迹
 * 运行：node scripts/test-p1-11.js
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
const stores = { admins: require('./helpers/admin-fixtures').createAdminFixtures(), activities: [], club_members: [], clubs: [], categories: [], users: [], activity_registrations: [], messages: [], sensitive_words: [] }

function matchCond(row, cond) {
  if (cond && cond.__and) return cond.__and.every((item) => matchCond(row, item))
  if (cond && cond.__or) return cond.__or.some((item) => matchCond(row, item))
  return Object.keys(cond).every((key) => {
    const want = cond[key]
    if (want instanceof RegExp) return want.test(String(row[key] == null ? '' : row[key]))
    if (want && typeof want === 'object') {
      if (Object.prototype.hasOwnProperty.call(want, '__in')) return want.__in.indexOf(row[key]) !== -1
      if (Object.prototype.hasOwnProperty.call(want, '__neq')) return row[key] !== want.__neq
      if (Object.prototype.hasOwnProperty.call(want, '__gte')) return Number(row[key] || 0) >= want.__gte
      if (Object.prototype.hasOwnProperty.call(want, '__lte')) return Number(row[key] || 0) <= want.__lte
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
    },
  }),
  httpclient: { request: async () => ({ data: { access_token: 'T', expires_in: 7200 } }) },
}

/* ---------- 种子数据 ---------- */
const DAY = 24 * 3600 * 1000
const HOUR = 3600 * 1000
const now = Date.now()
const at = (offset) => new Date(now + offset)

function user(over) {
  seq += 1
  return { _id: `u-${seq}`, openid: `openid-${seq}`, name: '用户', auth_status: 'verified', status: 'normal', deleted: 0, ...over }
}
const uPresident = user({ name: '林晨', student_no: '20260001' })
const uOfficer = user({ name: '苏晚晴' })
const uMember = user({ name: '何子轩' })
stores.users.push(uPresident, uOfficer, uMember)

stores.categories.push({ _id: 'c-1', name: '学术科技', sort: 1, deleted: 0 })
stores.sensitive_words.push(
  { _id: 'w-1', word: '兼职刷单', level: 'block', deleted: 0 },
  { _id: 'w-2', word: '代理招生', level: 'review', deleted: 0 }
)
stores.clubs.push({ _id: 'club-a', name: '天文社', intro: '看星星', contact: 'QQ1', status: 'normal', deleted: 0 })
stores.club_members.push(
  { _id: 'm-1', club_id: 'club-a', user_id: uPresident._id, role: 'president', status: 'active', joined_at: at(-30 * DAY) },
  { _id: 'm-2', club_id: 'club-a', user_id: uOfficer._id, role: 'officer', status: 'active', joined_at: at(-30 * DAY) },
  { _id: 'm-3', club_id: 'club-a', user_id: uMember._id, role: 'member', status: 'active', joined_at: at(-30 * DAY) }
)

function activityRow(over) {
  return {
    club_id: 'club-a',
    title: '天文观测夜',
    content: '一起看流星雨',
    cover: '',
    category_id: 'c-1',
    start_time: at(2 * DAY),
    end_time: at(2 * DAY + 2 * HOUR),
    location: '操场',
    signup_start: at(-1 * DAY),
    signup_end: at(1 * DAY),
    capacity: 50,
    need_approval: false,
    has_waitlist: true,
    allow_onsite: false,
    signin_config: { methods: ['qrcode'] },
    status: 'draft',
    submitter_id: '',
    reject_reason: '',
    review_by: '',
    review_at: null,
    created_at: at(-3 * DAY),
    updated_at: at(-3 * DAY),
    deleted: 0,
    ...over,
  }
}
stores.activities.push(
  activityRow({ _id: 'act-draft', title: '待提交的活动' }),
  activityRow({ _id: 'act-approved', title: '已通过的活动', status: 'approved', submitter_id: uPresident._id }),
  activityRow({ _id: 'act-rejected', title: '被驳回的活动', status: 'draft', submitter_id: uPresident._id, reject_reason: '内容过于简单，请补充活动计划', review_by: 'root', review_at: at(-1 * DAY) })
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
const superToken = club.signToken({ type: 'admin', adminId: 'a-1', username: 'root', role: 'super' })
const auditorToken = club.signToken({ type: 'admin', adminId: 'a-2', username: 'auditor1', role: 'auditor' })
const viewerToken = club.signToken({ type: 'admin', adminId: 'a-3', username: 'viewer1', role: 'viewer' })

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

const rowOf = (id) => stores.activities.find((row) => row._id === id)

async function main() {
  /* ---------- 1. 提交审核：submitter_id 落库 ---------- */
  console.log('\n【提交审核 · submitter_id】')
  let r = await call('/activity/submit', { body: { activity_id: 'act-draft' }, token: studentToken(uPresident) })
  assert('社长提交 → pending 且记录 submitter_id', r.payload.code === 0 && rowOf('act-draft').status === 'pending' && rowOf('act-draft').submitter_id === uPresident._id, JSON.stringify(rowOf('act-draft')).slice(0, 200))

  /* ---------- 2. review-query：权限与列表 ---------- */
  console.log('\n【review-query · 权限与列表】')
  r = await call('/activity/review-query', { body: {} })
  assert('无 token → 401', r.statusCode === 401, JSON.stringify(r.payload))

  r = await call('/activity/review-query', { body: {}, token: studentToken(uPresident) })
  assert('学生 token → 403（通道不匹配）', r.payload.code === 403, JSON.stringify(r.payload))

  r = await call('/activity/review-query', { body: {}, token: viewerToken })
  assert('viewer → 403（2.3 权限矩阵）', r.payload.code === 403, JSON.stringify(r.payload))

  r = await call('/activity/review-query', { body: { status: 'pending' }, token: auditorToken })
  assert('auditor 放行 → 待审列表含 act-draft', r.payload.code === 0 && r.payload.data.list.some((i) => i._id === 'act-draft'), JSON.stringify(r.payload.data.list.map((i) => i._id)))
  assert('pending_total 正确（仅 act-draft 为 pending）', r.payload.data.pending_total === 1, JSON.stringify(r.payload.data.pending_total))
  const pendingRow = r.payload.data.list.find((i) => i._id === 'act-draft')
  assert('join 发起人姓名与认证态 + 社团名', pendingRow.submitter_name === '林晨' && pendingRow.submitter_auth_status === 'verified' && pendingRow.club_name === '天文社', JSON.stringify(pendingRow).slice(0, 240))

  r = await call('/activity/review-query', { body: { status: 'draft' }, token: superToken })
  assert('draft 过滤 → 含被驳回回退的活动且带驳回理由', r.payload.code === 0 && r.payload.data.list.some((i) => i._id === 'act-rejected' && i.reject_reason), JSON.stringify(r.payload.data.list.map((i) => i._id)))

  r = await call('/activity/review-query', { body: { status: 'bogus' }, token: superToken })
  assert('status 非法 → 1001', r.payload.code === 1001, JSON.stringify(r.payload))

  r = await call('/activity/review-query', { body: { page_size: 101 }, token: superToken })
  assert('page_size 越界 → 1001', r.payload.code === 1001, JSON.stringify(r.payload))

  /* ---------- 3. review：状态机与校验 ---------- */
  console.log('\n【review · 状态机与校验】')
  r = await call('/activity/review', { body: { activity_id: 'act-approved', action: 'approve' }, token: superToken })
  assert('仅 pending 可审（approved → 1002）', r.payload.code === 1002 && r.payload.message.includes('仅待审'), JSON.stringify(r.payload))

  r = await call('/activity/review', { body: { activity_id: 'act-draft', action: 'reject' }, token: superToken })
  assert('驳回缺理由 → 1001', r.payload.code === 1001 && r.payload.message.includes('驳回理由'), JSON.stringify(r.payload))

  r = await call('/activity/review', { body: { activity_id: 'act-draft', action: 'reject', reason: '否' }, token: superToken })
  assert('驳回理由过短 → 1001', r.payload.code === 1001, JSON.stringify(r.payload))

  r = await call('/activity/review', { body: { activity_id: 'act-draft', action: 'approve' }, token: viewerToken })
  assert('viewer 审核 → 403', r.payload.code === 403, JSON.stringify(r.payload))

  r = await call('/activity/review', { body: { activity_id: 'not-exist', action: 'approve' }, token: superToken })
  assert('活动不存在 → 404', r.payload.code === 404, JSON.stringify(r.payload))

  /* ---------- 4. review：驳回 → draft + 通知发起人 ---------- */
  console.log('\n【review · 驳回与通知】')
  r = await call('/activity/review', { body: { activity_id: 'act-draft', action: 'reject', reason: '活动时间与校历冲突，请调整后重新提交' }, token: superToken })
  assert('驳回成功 → 回退 draft + 理由 + 审核留痕', r.payload.code === 0 && rowOf('act-draft').status === 'draft' && rowOf('act-draft').reject_reason.includes('校历冲突') && rowOf('act-draft').review_by === 'root' && !!rowOf('act-draft').review_at, JSON.stringify(rowOf('act-draft')).slice(0, 260))
  const rejectMsg = stores.messages.find((m) => m.scene === 'club_activity_review' && m.biz_id === 'act-draft')
  assert('通知发起人（站内消息，scene=club_activity_review）', !!rejectMsg && rejectMsg.user_id === uPresident._id, JSON.stringify(rejectMsg || {}).slice(0, 240))
  assert('驳回通知文案含活动名与理由', rejectMsg.content.indexOf('待提交的活动') !== -1 && rejectMsg.content.indexOf('校历冲突') !== -1, JSON.stringify(rejectMsg).slice(0, 300))
  const dupRes = await call('/activity/review', { body: { activity_id: 'act-draft', action: 'reject', reason: '再次驳回测试' }, token: superToken })
  assert('重复审核已驳回活动 → 1002', dupRes.payload.code === 1002, JSON.stringify(dupRes.payload))
  assert('通知未重复（去重键 scene+biz_id）', stores.messages.filter((m) => m.scene === 'club_activity_review' && m.biz_id === 'act-draft').length === 1)

  /* ---------- 5. 驳回后重提清痕迹 ---------- */
  console.log('\n【驳回后重提】')
  r = await call('/activity/submit', { body: { activity_id: 'act-draft' }, token: studentToken(uOfficer) })
  assert('干部重提 → pending 且清空驳回留痕', r.payload.code === 0 && rowOf('act-draft').status === 'pending' && rowOf('act-draft').reject_reason === '' && rowOf('act-draft').review_by === '' && rowOf('act-draft').review_at === null, JSON.stringify(rowOf('act-draft')).slice(0, 220))
  assert('重提刷新 submitter_id 为实际提交人', rowOf('act-draft').submitter_id === uOfficer._id, JSON.stringify(rowOf('act-draft').submitter_id))

  /* ---------- 6. review：通过 → approved + 通知 ---------- */
  console.log('\n【review · 通过与通知】')
  r = await call('/activity/review', { body: { activity_id: 'act-draft', action: 'approve' }, token: auditorToken })
  assert('auditor 通过 → approved（待开放）', r.payload.code === 0 && rowOf('act-draft').status === 'approved' && rowOf('act-draft').reject_reason === '', JSON.stringify(rowOf('act-draft')).slice(0, 220))
  const approveMsg = stores.messages.find((m) => m.scene === 'club_activity_review' && m.biz_id === 'act-draft' && m.user_id === uOfficer._id)
  assert('通过通知发给重提后的发起人（officer）', !!approveMsg && approveMsg.content.indexOf('已通过') !== -1, JSON.stringify(approveMsg || {}).slice(0, 260))

  r = await call('/activity/review-query', { body: { status: 'approved' }, token: superToken })
  const approved = r.payload.data.list.map((i) => i._id)
  assert('approved 过滤 → 含 act-approved 与 act-draft', approved.indexOf('act-approved') !== -1 && approved.indexOf('act-draft') !== -1, JSON.stringify(approved))
  assert('通过后 pending_total 归零', r.payload.data.pending_total === 0, JSON.stringify(r.payload.data.pending_total))

  console.log(`\n通过 ${passed} 项，失败 ${failed} 项`)
  if (failed > 0) process.exitCode = 1
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
