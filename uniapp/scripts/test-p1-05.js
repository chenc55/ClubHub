/**
 * P1-05 本地验收（离线，无需部署）
 * 覆盖：申诉提交（校验 / 同用户仅一条 pending / rebind 与 occupy 差异）/
 *       学生端进度查看 / 管理端待审列表（申请人 join、新学号可用性标记、分页与越权）/
 *       驳回（理由必填 + 通知）/ 通过（白名单与占用校验、解绑旧学号绑定新学号、唯一索引竞态兜底 + 通知）
 * 运行：node scripts/test-p1-05.js
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

/* ---------- 集合 stub（等式 / in / neq / and / or / RegExp） ---------- */
let seq = 0
const stores = { appeals: [], users: [], whitelist: [], messages: [] }
/** 唯一索引冲突模拟：users.student_no 写入时命中该值则抛错 */
let usersStudentNoConflict = ''

function matchCond(row, cond) {
  if (cond && cond.__and) return cond.__and.every((item) => matchCond(row, item))
  if (cond && cond.__or) return cond.__or.some((item) => matchCond(row, item))
  return Object.keys(cond).every((key) => {
    const want = cond[key]
    if (want instanceof RegExp) return want.test(String(row[key] == null ? '' : row[key]))
    if (want && typeof want === 'object' && Object.prototype.hasOwnProperty.call(want, '__in')) {
      return want.__in.indexOf(row[key]) !== -1
    }
    if (want && typeof want === 'object' && Object.prototype.hasOwnProperty.call(want, '__neq')) {
      return row[key] !== want.__neq
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
        const av = new Date(a[field]).getTime()
        const bv = new Date(b[field]).getTime()
        return dir === 'desc' ? bv - av : av - bv
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
  }
  return query
}

function messagesAdd(doc) {
  const list = Array.isArray(doc) ? doc : [doc]
  for (const item of list) {
    const dup = stores.messages.some(
      (row) => row.user_id === item.user_id && row.scene === item.scene && row.biz_id === item.biz_id
    )
    if (dup) throw new Error('duplicate key: user_scene_biz_unique')
  }
  let lastId = ''
  list.forEach((item) => {
    lastId = `m-${++seq}`
    stores.messages.push({ _id: lastId, ...item })
  })
  return { id: lastId }
}

function usersUpdate(id, patch) {
  const row = stores.users.find((item) => item._id === id)
  if (!row) return { updated: 0 }
  if (patch.student_no && patch.student_no === usersStudentNoConflict) {
    throw new Error('duplicate key: users.student_no')
  }
  // 唯一索引语义：同 student_no 不允许第二人
  if (patch.student_no) {
    const holder = stores.users.find((item) => item.student_no === patch.student_no && item._id !== id && item.deleted === 0)
    if (holder) throw new Error('duplicate key: users.student_no')
  }
  Object.assign(row, patch)
  return { updated: 1 }
}

function collectionFor(name) {
  const rowsOf = () => stores[name] || []
  return {
    where: (cond) => makeQuery(rowsOf().filter((row) => matchCond(row, cond))),
    add: async (doc) => {
      if (name === 'messages') return messagesAdd(doc)
      const record = { _id: `${name}-${++seq}`, ...doc }
      stores[name].push(record)
      return { id: record._id }
    },
    doc: (id) => ({
      update: async (patch) => {
        if (name === 'users') return usersUpdate(id, patch)
        const row = (stores[name] || []).find((item) => item._id === id)
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
    },
  }),
  httpclient: { request: async () => ({ data: { access_token: 'T', expires_in: 7200 } }) },
  uploadFile: async () => ({ fileID: 'cloud://x.png' }),
  getTempFileURL: async () => ({ fileList: [] }),
}

/* ---------- 数据与令牌 ---------- */
function makeUser(over) {
  seq += 1
  return {
    _id: `u-${seq}`,
    openid: `openid-${seq}`,
    nickname: '',
    avatar: '',
    student_no: '',
    name: '',
    college: '',
    major: '',
    auth_status: 'unverified',
    status: 'normal',
    deleted: 0,
    created_at: new Date(2026, 8, 1),
    updated_at: new Date(2026, 8, 1),
    ...over,
  }
}

function makeAppeal(over) {
  seq += 1
  return {
    _id: `appeal-${seq}`,
    user_id: '',
    appeal_type: 'rebind',
    old_student_no: '',
    new_student_no: '',
    proof: '',
    proof_images: [],
    status: 'pending',
    reject_reason: '',
    review_by: '',
    review_at: null,
    created_at: new Date(2026, 8, 10 + seq),
    deleted: 0,
    ...over,
  }
}

const u1 = makeUser({ name: '林晨', student_no: '20260001', college: '软件学院', major: '软件工程', auth_status: 'verified', nickname: '林同学' })
const u2 = makeUser({ nickname: '游客乙' })
const u3 = makeUser({ name: '苏晚晴', student_no: '20260117', auth_status: 'verified' })
const uDisabled = makeUser({ status: 'disabled' })
const uDeleted = makeUser({ deleted: 1 })
stores.users.push(u1, u2, u3, uDisabled, uDeleted)

stores.whitelist.push(
  { _id: 'w-1', student_no: '20260001', name: '林晨', college: '软件学院', major: '软件工程' },
  { _id: 'w-2', student_no: '20260117', name: '苏晚晴', college: '经管学院', major: '会计学' },
  { _id: 'w-3', student_no: '20260452', name: '何子轩', college: '计算机学院', major: '软件工程' }
)

const userFn = require('../uniCloud-aliyun/cloudfunctions/user/index.js')
const adminFn = require('../uniCloud-aliyun/cloudfunctions/admin/index.js')

function studentToken(user) {
  return club.signToken({
    type: club.TOKEN_TYPES.STUDENT,
    token_kind: 'access',
    userId: user._id,
    openid: user.openid,
    auth_status: user.auth_status,
  })
}
const superToken = club.signToken({ type: 'admin', adminId: 'a-1', username: 'root', role: 'super' })
const auditorToken = club.signToken({ type: 'admin', adminId: 'a-2', username: 'auditor1', role: 'auditor' })
const viewerToken = club.signToken({ type: 'admin', adminId: 'a-3', username: 'viewer1', role: 'viewer' })

/** 云函数内路由为相对路径，此处按对外路径书写（自动剥离 /user、/admin 前缀） */
async function call(fn, path, { method = 'POST', body, token } = {}) {
  const headers = { 'content-type': 'application/json' }
  if (token) headers.authorization = `Bearer ${token}`
  const res = await fn.main({
    httpMethod: method,
    path: path.replace(/^\/(user|admin)/, ''),
    headers,
    body: body ? JSON.stringify(body) : '',
    queryStringParameters: {},
  })
  return { statusCode: res.statusCode, payload: JSON.parse(res.body) }
}
const callUser = (path, opts) => call(userFn, path, opts)
const callAdmin = (path, opts) => call(adminFn, path, opts)

async function main() {
  /* ---------- 1. 提交申诉 ---------- */
  console.log('\n【提交申诉】')
  let r = await callUser('/user/appeals', { body: { appeal_type: 'rebind', new_student_no: '20260452' } })
  assert('无 token → 401', r.statusCode === 401 && r.payload.code === 401, JSON.stringify(r.payload))

  r = await callUser('/user/appeals', { body: { appeal_type: 'rebind', new_student_no: '20260452' }, token: studentToken(uDisabled) })
  assert('禁用用户 → 403', r.statusCode === 403 && r.payload.code === 403, JSON.stringify(r.payload))

  r = await callUser('/user/appeals', { body: { appeal_type: 'rebind' }, token: studentToken(u1) })
  assert('缺新学号 → 1001', r.payload.code === 1001 && r.payload.message.includes('new_student_no'), JSON.stringify(r.payload))

  r = await callUser('/user/appeals', { body: { appeal_type: 'bogus', new_student_no: '20260452' }, token: studentToken(u1) })
  assert('申诉类型非法 → 1001', r.payload.code === 1001, JSON.stringify(r.payload))

  r = await callUser('/user/appeals', { body: { appeal_type: 'rebind', new_student_no: 'ab' }, token: studentToken(u1) })
  assert('学号格式非法 → 1001', r.payload.code === 1001 && r.payload.message.includes('格式'), JSON.stringify(r.payload))

  r = await callUser('/user/appeals', { body: { appeal_type: 'rebind', new_student_no: '20260001' }, token: studentToken(u1) })
  assert('新学号与当前学号相同 → 1001', r.payload.code === 1001 && r.payload.message.includes('相同'), JSON.stringify(r.payload))

  r = await callUser('/user/appeals', {
    body: { appeal_type: 'rebind', new_student_no: '20260452', proof_images: ['a', 'b', 'c', 'd'] },
    token: studentToken(u1),
  })
  assert('证明材料超过 3 张 → 1001', r.payload.code === 1001 && r.payload.message.includes('3'), JSON.stringify(r.payload))

  r = await callUser('/user/appeals', {
    body: { appeal_type: 'rebind', new_student_no: '20260452', proof_images: [''] },
    token: studentToken(u1),
  })
  assert('证明材料地址非法 → 1001', r.payload.code === 1001, JSON.stringify(r.payload))

  r = await callUser('/user/appeals', {
    body: { appeal_type: 'rebind', new_student_no: '20260452', proof: '本人学号变更证明', proof_images: ['https://cdn/a.jpg'] },
    token: studentToken(u1),
  })
  assert('换绑申诉提交成功', r.payload.code === 0 && r.payload.data.appeal.status === 'pending', JSON.stringify(r.payload))
  assert('rebind 记录旧学号（当前已绑定）', r.payload.data.appeal.old_student_no === '20260001', JSON.stringify(r.payload.data.appeal))
  assert('证明材料与说明已落库', r.payload.data.appeal.proof_images.length === 1 && r.payload.data.appeal.proof === '本人学号变更证明', JSON.stringify(r.payload.data.appeal))
  const appeal1 = stores.appeals[0]
  assert('落库字段完整（deleted / review_by / review_at）',
    appeal1.deleted === 0 && appeal1.review_by === '' && appeal1.review_at === null && appeal1.created_at instanceof Date,
    JSON.stringify(appeal1))

  r = await callUser('/user/appeals', { body: { appeal_type: 'occupy', new_student_no: '20260117' }, token: studentToken(u1) })
  assert('已有进行中申诉 → 1002 且带回该申诉', r.payload.code === 1002 && r.payload.data.appeal._id === appeal1._id, JSON.stringify(r.payload))

  r = await callUser('/user/appeals', { body: { appeal_type: 'occupy', new_student_no: '20260117', proof: '学号被他人占用' }, token: studentToken(u2) })
  assert('占用申诉提交成功', r.payload.code === 0 && r.payload.data.appeal.appeal_type === 'occupy', JSON.stringify(r.payload))
  assert('occupy 不记录旧学号', r.payload.data.appeal.old_student_no === '', JSON.stringify(r.payload.data.appeal))
  const appealOccupy = stores.appeals[stores.appeals.length - 1]

  /* ---------- 2. 学生端进度 ---------- */
  console.log('\n【申诉进度】')
  r = await callUser('/user/appeals/current', { method: 'GET' })
  assert('GET /user/appeals/current 无 token → 401', r.statusCode === 401, JSON.stringify(r.payload))

  r = await callUser('/user/appeals/current', { method: 'GET', token: studentToken(u1) })
  assert('返回进度（pending 命中）', r.payload.code === 0 && r.payload.data.pending && r.payload.data.pending._id === appeal1._id, JSON.stringify(r.payload).slice(0, 200))
  assert('返回最近记录列表', Array.isArray(r.payload.data.list) && r.payload.data.list.length >= 1, JSON.stringify(r.payload.data.list))

  r = await callUser('/user/appeals/current', { method: 'GET', token: studentToken(uDeleted) })
  assert('已软删用户进度 → 401', r.statusCode === 401, JSON.stringify(r.payload))

  /* ---------- 3. 管理端待审列表 ---------- */
  console.log('\n【待审列表】')
  r = await callAdmin('/admin/appeals/query', { body: {} })
  assert('无 token → 401', r.statusCode === 401, JSON.stringify(r.payload))

  r = await callAdmin('/admin/appeals/query', { body: {}, token: studentToken(u1) })
  assert('学生 token → 403', r.payload.code === 403, JSON.stringify(r.payload))

  r = await callAdmin('/admin/appeals/query', { body: {}, token: viewerToken })
  assert('viewer → 403（当前角色无权）', r.payload.code === 403, JSON.stringify(r.payload))

  r = await callAdmin('/admin/appeals/query', { body: {}, token: auditorToken })
  assert('auditor 放行 → 返回全部申诉与待审计数', r.payload.code === 0 && r.payload.data.total === 2 && r.payload.data.pending_total === 2, JSON.stringify(r.payload).slice(0, 220))

  const row1 = r.payload.data.list.find((item) => item._id === appeal1._id)
  assert('join 申请人信息（姓名 / 当前学号 / 认证态）',
    row1.applicant_name === '林晨' && row1.applicant_current_no === '20260001' && row1.applicant_auth_status === 'verified',
    JSON.stringify(row1).slice(0, 240))
  assert('新学号可用性标记 ok（20260452 在白名单且未被占用）', row1.new_student_no_status === 'ok', row1.new_student_no_status)

  const rowOccupy = r.payload.data.list.find((item) => item._id === appealOccupy._id)
  assert('新学号占用标记 occupied（20260117 已被苏晚晴绑定）', rowOccupy.new_student_no_status === 'occupied', rowOccupy.new_student_no_status)

  const appealNoWl = makeAppeal({ user_id: u2._id, appeal_type: 'rebind', old_student_no: '', new_student_no: '20999999' })
  stores.appeals.push(appealNoWl)
  r = await callAdmin('/admin/appeals/query', { body: { status: 'pending' }, token: auditorToken })
  const rowNoWl = r.payload.data.list.find((item) => item._id === appealNoWl._id)
  assert('新学号不在白名单标记 not_in_whitelist', rowNoWl.new_student_no_status === 'not_in_whitelist', rowNoWl.new_student_no_status)

  r = await callAdmin('/admin/appeals/query', { body: { status: 'all', page_size: 101 }, token: auditorToken })
  assert('page_size 越界 → 1001', r.payload.code === 1001, JSON.stringify(r.payload))

  r = await callAdmin('/admin/appeals/query', { body: { status: 'rejected' }, token: auditorToken })
  assert('按状态筛选（暂无已驳回）', r.payload.code === 0 && r.payload.data.total === 0, JSON.stringify(r.payload).slice(0, 200))

  /* ---------- 4. 驳回 ---------- */
  console.log('\n【驳回】')
  r = await callAdmin('/admin/appeals/review', { body: { appeal_id: appealNoWl._id, action: 'reject' }, token: superToken })
  assert('驳回缺理由 → 1001', r.payload.code === 1001 && r.payload.message.includes('驳回理由'), JSON.stringify(r.payload))

  r = await callAdmin('/admin/appeals/review', { body: { appeal_id: appealNoWl._id, action: 'reject', reason: '否' }, token: superToken })
  assert('理由过短 → 1001', r.payload.code === 1001, JSON.stringify(r.payload))

  r = await callAdmin('/admin/appeals/review', { body: { appeal_id: 'not-exist', action: 'reject', reason: '材料不齐' }, token: superToken })
  assert('申诉不存在 → 404', r.payload.code === 404, JSON.stringify(r.payload))

  r = await callAdmin('/admin/appeals/review', {
    body: { appeal_id: appealNoWl._id, action: 'reject', reason: '新学号不在花名册内，请核对后重新提交' },
    token: superToken,
  })
  assert('驳回成功 → status=rejected + 理由 + 审核人', (() => {
    const updated = r.payload.data.appeal
    return r.payload.code === 0 && updated.status === 'rejected' && updated.reject_reason.includes('花名册') && updated.review_by === 'root' && !!updated.review_at
  })(), JSON.stringify(r.payload).slice(0, 240))

  const rejectMsg = stores.messages.find((m) => m.biz_id === appealNoWl._id)
  assert('驳回后自动发通知（站内消息已写入）', !!rejectMsg && rejectMsg.scene === 'appeal_review_result' && rejectMsg.type === 'system' && rejectMsg.biz_type === 'appeal', JSON.stringify(rejectMsg).slice(0, 240))
  assert('通知文案含驳回归属与理由',
    rejectMsg.title === '申诉结果：换绑申诉' && rejectMsg.content.includes('审核已驳回') && rejectMsg.content.includes('驳回理由：新学号不在花名册内，请核对后重新提交'),
    `${rejectMsg.title}|${rejectMsg.content}`)
  assert('通知按事件去重（同一申诉一条）', stores.messages.filter((m) => m.biz_id === appealNoWl._id).length === 1)

  r = await callAdmin('/admin/appeals/review', { body: { appeal_id: appealNoWl._id, action: 'reject', reason: '再次驳回' }, token: superToken })
  assert('已处理申诉重复审核 → 1002', r.payload.code === 1002, JSON.stringify(r.payload))

  /* ---------- 5. 通过 ---------- */
  console.log('\n【通过】')
  r = await callAdmin('/admin/appeals/review', { body: { appeal_id: appealOccupy._id, action: 'approve' }, token: superToken })
  assert('新学号已被他人绑定 → 拒绝通过', r.payload.code === 1001 && r.payload.message.includes('已被其他用户绑定'), JSON.stringify(r.payload))
  assert('拒绝通过后状态仍为 pending', stores.appeals.find((a) => a._id === appealOccupy._id).status === 'pending')

  const appealNoWl2 = makeAppeal({ user_id: u2._id, appeal_type: 'rebind', new_student_no: '20999999' })
  stores.appeals.push(appealNoWl2)
  r = await callAdmin('/admin/appeals/review', { body: { appeal_id: appealNoWl2._id, action: 'approve' }, token: superToken })
  assert('新学号不在白名单 → 拒绝通过', r.payload.code === 1001 && r.payload.message.includes('白名单'), JSON.stringify(r.payload))

  r = await callAdmin('/admin/appeals/review', { body: { appeal_id: appeal1._id, action: 'approve' }, token: auditorToken })
  assert('通过成功 → status=approved', r.payload.code === 0 && r.payload.data.appeal.status === 'approved', JSON.stringify(r.payload).slice(0, 240))

  const boundUser = stores.users.find((item) => item._id === u1._id)
  assert('users.student_no 已更新为新学号', boundUser.student_no === '20260452', boundUser.student_no)
  assert('学籍字段取自白名单（何子轩 / 计算机学院）', boundUser.name === '何子轩' && boundUser.college === '计算机学院' && boundUser.major === '软件工程', JSON.stringify(boundUser).slice(0, 200))
  assert('认证态保持 verified', boundUser.auth_status === 'verified')
  assert('旧学号已解除绑定（无人占用 20260001）', stores.users.filter((item) => item.student_no === '20260001' && item.deleted === 0).length === 0)
  assert('审核人记录为 auditor1', r.payload.data.appeal.review_by === 'auditor1', r.payload.data.appeal.review_by)
  assert('通过后清空驳回理由', r.payload.data.appeal.reject_reason === '', r.payload.data.appeal.reject_reason)

  const approveMsg = stores.messages.find((m) => m.biz_id === appeal1._id)
  assert('通过后自动发通知（含「已通过」）', !!approveMsg && approveMsg.content.includes('已通过') && approveMsg.type === 'system', JSON.stringify(approveMsg).slice(0, 240))

  r = await callAdmin('/admin/appeals/review', { body: { appeal_id: appeal1._id, action: 'approve' }, token: superToken })
  assert('重复通过 → 1002', r.payload.code === 1002, JSON.stringify(r.payload))

  /* ---------- 6. 唯一索引竞态 ---------- */
  console.log('\n【唯一索引竞态】')
  const appealRace = makeAppeal({ user_id: u2._id, appeal_type: 'rebind', new_student_no: '20260117' })
  stores.appeals.push(appealRace)
  usersStudentNoConflict = '20260117'
  r = await callAdmin('/admin/appeals/review', { body: { appeal_id: appealRace._id, action: 'approve' }, token: superToken })
  assert('绑定瞬间被并发抢占 → 拒绝通过且提示绑定冲突', r.payload.code === 1001 && r.payload.message.includes('已被其他用户绑定'), JSON.stringify(r.payload))
  assert('竞态失败未改状态 / 未改学号', stores.appeals.find((a) => a._id === appealRace._id).status === 'pending' && stores.users.find((i) => i._id === u2._id).student_no === '')
  usersStudentNoConflict = ''

  r = await callAdmin('/admin/appeals/review', { body: { appeal_id: appealRace._id, action: 'approve' }, token: viewerToken })
  assert('viewer 审核 → 403', r.payload.code === 403, JSON.stringify(r.payload))

  /* ---------- 7. 进度再查询（驳回态可见理由） ---------- */
  console.log('\n【驳回后进度】')
  r = await callUser('/user/appeals/current', { method: 'GET', token: studentToken(u2) })
  assert('学生端可见驳回状态与理由', (() => {
    const rejected = (r.payload.data.list || []).find((item) => item._id === appealNoWl._id)
    return !!rejected && rejected.status === 'rejected' && rejected.reject_reason.includes('花名册')
  })(), JSON.stringify(r.payload).slice(0, 260))

  console.log(`\n结果：${passed} 通过 / ${failed} 失败`)
  if (failed > 0) process.exitCode = 1
}

main().catch((e) => {
  console.error('用例执行异常：', e)
  process.exitCode = 1
})
