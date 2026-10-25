/**
 * P1-06 本地验收（离线，无需部署）
 * 覆盖：分类字典 / 入驻申请（校验、名称重复拦截、同用户仅一条进行中、驳回后重提复用记录）/
 *       我的申请进度 / 管理端社团列表（join 与筛选）/ 审核（通过自动建社长 + 通知、驳回必填理由 + 通知）/
 *       批量导入（分类解析、重名跳过记入回执、唯一索引竞态兜底）/ 鉴权与角色
 * 运行：node scripts/test-p1-06.js
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
const stores = { clubs: [], club_members: [], categories: [], users: [], messages: [] }
/** 竞态开关：模拟批量写入时唯一索引冲突 */
let clubBatchConflict = false

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

function addRows(name, doc) {
  const list = Array.isArray(doc) ? doc : [doc]
  if (name === 'clubs') {
    // 竞态开关：模拟批量写入时唯一索引冲突（含降级后的逐条写入同样冲突）
    if (clubBatchConflict) throw new Error('duplicate key: clubs.name')
    for (const item of list) {
      if (stores.clubs.some((row) => row.name === item.name && row.deleted === 0)) {
        throw new Error(`duplicate key: clubs.name (${item.name})`)
      }
    }
  }
  let lastId = ''
  list.forEach((item) => {
    lastId = `${name}-${++seq}`
    stores[name].push({ _id: lastId, ...item })
  })
  return { id: lastId, inserted: list.length }
}

function collectionFor(name) {
  const rowsOf = () => stores[name] || []
  return {
    where: (cond) => makeQuery(rowsOf().filter((row) => matchCond(row, cond))),
    add: async (doc) => addRows(name, doc),
    doc: (id) => ({
      update: async (patch) => {
        const row = (stores[name] || []).find((item) => item._id === id)
        if (!row) return { updated: 0 }
        if (name === 'clubs' && patch.name) {
          const holder = stores.clubs.find((item) => item.name === patch.name && item._id !== id && item.deleted === 0)
          if (holder) throw new Error('duplicate key: clubs.name')
        }
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
}

/* ---------- 数据与令牌 ---------- */
function makeUser(over) {
  seq += 1
  return {
    _id: `u-${seq}`,
    openid: `openid-${seq}`,
    nickname: '',
    student_no: '',
    name: '',
    auth_status: 'unverified',
    status: 'normal',
    deleted: 0,
    ...over,
  }
}

const u1 = makeUser({ name: '林晨', student_no: '20260001', auth_status: 'verified' })
const u2 = makeUser({ name: '苏晚晴', student_no: '20260117', auth_status: 'verified' })
const uDisabled = makeUser({ status: 'disabled' })
stores.users.push(u1, u2, uDisabled)

const CATEGORY_SEED = ['学术科技', '文艺表演', '体育竞技', '公益实践', '创新创业', '思想政治', '兴趣爱好', '其他']
CATEGORY_SEED.forEach((name, i) => {
  stores.categories.push({ _id: `c-${i + 1}`, name, sort: i + 1, deleted: 0 })
})
const CAT_SPORT = 'c-3'

const clubFn = require('../uniCloud-aliyun/cloudfunctions/club/index.js')

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

async function call(path, { method = 'POST', body, token } = {}) {
  const headers = { 'content-type': 'application/json' }
  if (token) headers.authorization = `Bearer ${token}`
  const res = await clubFn.main({
    httpMethod: method,
    path: path.replace(/^\/club/, ''),
    headers,
    body: body ? JSON.stringify(body) : '',
    queryStringParameters: {},
  })
  return { statusCode: res.statusCode, payload: JSON.parse(res.body) }
}

const APPLY_BODY = { name: '天文爱好者协会', intro: '一起观测星空', category_id: CAT_SPORT, contact: 'QQ群 123456' }

async function main() {
  /* ---------- 1. 分类字典 ---------- */
  console.log('\n【分类字典】')
  let r = await call('/club/categories', { method: 'GET' })
  assert('GET /club/categories 公开可访问（无需 token）', r.payload.code === 0 && r.payload.data.list.length === 8, JSON.stringify(r.payload).slice(0, 200))
  assert('按 sort 升序返回', r.payload.data.list[0].name === '学术科技' && r.payload.data.list[7].name === '其他', JSON.stringify(r.payload.data.list.map((i) => i.name)))

  /* ---------- 2. 入驻申请 ---------- */
  console.log('\n【入驻申请】')
  r = await call('/club/apply', { body: APPLY_BODY })
  assert('无 token → 401', r.statusCode === 401 && r.payload.code === 401, JSON.stringify(r.payload))

  r = await call('/club/apply', { body: APPLY_BODY, token: studentToken(uDisabled) })
  assert('禁用用户 → 403', r.statusCode === 403 && r.payload.code === 403, JSON.stringify(r.payload))

  r = await call('/club/apply', { body: { name: '天文爱好者协会' }, token: studentToken(u1) })
  assert('缺参数 → 1001', r.payload.code === 1001, JSON.stringify(r.payload).slice(0, 200))

  r = await call('/club/apply', { body: { ...APPLY_BODY, name: '星' }, token: studentToken(u1) })
  assert('名称过短 → 1001', r.payload.code === 1001 && r.payload.message.includes('至少'), JSON.stringify(r.payload))

  r = await call('/club/apply', { body: { ...APPLY_BODY, intro: '   ' }, token: studentToken(u1) })
  assert('简介为空 → 1001', r.payload.code === 1001 && r.payload.message.includes('简介'), JSON.stringify(r.payload))

  r = await call('/club/apply', { body: { ...APPLY_BODY, contact: '' }, token: studentToken(u1) })
  assert('联系方式为空 → 1001', r.payload.code === 1001, JSON.stringify(r.payload))

  r = await call('/club/apply', { body: { ...APPLY_BODY, category_id: 'not-exist' }, token: studentToken(u1) })
  assert('分类不存在 → 1001', r.payload.code === 1001 && r.payload.message.includes('分类'), JSON.stringify(r.payload))

  r = await call('/club/apply', { body: APPLY_BODY, token: studentToken(u1) })
  assert('提交成功 → status=pending', r.payload.code === 0 && r.payload.data.club.status === 'pending' && r.payload.data.resubmitted === false, JSON.stringify(r.payload).slice(0, 220))
  const applied = stores.clubs[0]
  assert('落库字段完整（applicant_id / create_type / star_level / deleted）',
    applied.applicant_id === u1._id && applied.create_type === 'applied' && applied.star_level === 0 && applied.deleted === 0 &&
    applied.reject_reason === '' && applied.review_by === '' && applied.review_at === null && applied.created_at instanceof Date,
    JSON.stringify(applied))
  assert('返回分类名已 join', r.payload.data.club.category_name === '体育竞技', r.payload.data.club.category_name)

  r = await call('/club/apply', { body: APPLY_BODY, token: studentToken(u1) })
  assert('已有进行中申请 → 1002 且带回该社团', r.payload.code === 1002 && r.payload.data.club._id === applied._id, JSON.stringify(r.payload).slice(0, 220))

  r = await call('/club/apply', { body: APPLY_BODY, token: studentToken(u2) })
  assert('名称重复拦截（他人已申请）→ 1001', r.payload.code === 1001 && r.payload.message.includes('已被使用'), JSON.stringify(r.payload))

  r = await call('/club/apply', { body: { ...APPLY_BODY, name: '街舞社' }, token: studentToken(u2) })
  assert('另一用户可用不同名称提交', r.payload.code === 0 && r.payload.data.club.status === 'pending', JSON.stringify(r.payload).slice(0, 200))
  const applied2 = stores.clubs[1]

  /* ---------- 3. 我的申请进度 ---------- */
  console.log('\n【申请进度】')
  r = await call('/club/apply/current', { method: 'GET' })
  assert('GET /club/apply/current 无 token → 401', r.statusCode === 401, JSON.stringify(r.payload))

  r = await call('/club/apply/current', { method: 'GET', token: studentToken(u1) })
  assert('返回进行中申请与列表', r.payload.code === 0 && r.payload.data.pending._id === applied._id && r.payload.data.list.length === 1, JSON.stringify(r.payload).slice(0, 220))
  assert('未通过时 approved 为空', r.payload.data.approved === null)
  assert('列表含分类名与驳回理由字段', r.payload.data.list[0].category_name === '体育竞技' && r.payload.data.list[0].reject_reason === '', JSON.stringify(r.payload.data.list[0]).slice(0, 200))

  r = await call('/club/apply/current', { method: 'GET', token: studentToken(u2) })
  assert('按申请人隔离（各自只看到自己的申请）', r.payload.code === 0 && r.payload.data.list.length === 1 && r.payload.data.list[0]._id === applied2._id, JSON.stringify(r.payload).slice(0, 200))

  /* ---------- 4. 管理端列表 ---------- */
  console.log('\n【管理端社团列表】')
  r = await call('/club/query', { body: {} })
  assert('无 token → 401', r.statusCode === 401, JSON.stringify(r.payload))

  r = await call('/club/query', { body: {}, token: studentToken(u1) })
  assert('学生 token → 403', r.payload.code === 403, JSON.stringify(r.payload))

  r = await call('/club/query', { body: {}, token: viewerToken })
  assert('viewer → 403', r.payload.code === 403, JSON.stringify(r.payload))

  r = await call('/club/query', { body: {}, token: auditorToken })
  assert('auditor 放行 → 总数与待审数正确', r.payload.code === 0 && r.payload.data.total === 2 && r.payload.data.pending_total === 2, JSON.stringify(r.payload).slice(0, 220))

  const row1 = r.payload.data.list.find((item) => item._id === applied._id)
  assert('join 申请人姓名与分类名', row1.applicant_name === '林晨' && row1.category_name === '体育竞技', JSON.stringify(row1).slice(0, 240))

  r = await call('/club/query', { body: { status: 'normal' }, token: auditorToken })
  assert('按状态筛选（暂无已通过）', r.payload.code === 0 && r.payload.data.total === 0, JSON.stringify(r.payload).slice(0, 200))

  r = await call('/club/query', { body: { status: 'bogus' }, token: auditorToken })
  assert('状态取值非法 → 1001', r.payload.code === 1001, JSON.stringify(r.payload))

  r = await call('/club/query', { body: { page_size: 101 }, token: auditorToken })
  assert('page_size 越界 → 1001', r.payload.code === 1001, JSON.stringify(r.payload))

  /* ---------- 5. 审核：驳回 → 重提 ---------- */
  console.log('\n【审核 · 驳回与重提】')
  r = await call('/club/review', { body: { club_id: 'not-exist', action: 'approve' }, token: superToken })
  assert('社团不存在 → 404', r.payload.code === 404, JSON.stringify(r.payload))

  r = await call('/club/review', { body: { club_id: applied._id, action: 'reject' }, token: superToken })
  assert('驳回缺理由 → 1001', r.payload.code === 1001 && r.payload.message.includes('驳回理由'), JSON.stringify(r.payload))

  r = await call('/club/review', { body: { club_id: applied._id, action: 'reject', reason: '否' }, token: superToken })
  assert('驳回理由过短 → 1001', r.payload.code === 1001, JSON.stringify(r.payload))

  r = await call('/club/review', { body: { club_id: applied._id, action: 'reject', reason: '简介过于简单，请补充社团定位与活动计划' }, token: superToken })
  assert('驳回成功 → rejected + 理由 + 审核人', (() => {
    const c = r.payload.data.club
    return r.payload.code === 0 && c.status === 'rejected' && c.reject_reason.includes('简介过于简单') && c.review_by === 'root' && !!c.review_at
  })(), JSON.stringify(r.payload).slice(0, 260))
  assert('驳回不创建成员', stores.club_members.length === 0)

  const rejectMsg = stores.messages.find((m) => m.scene === 'club_apply_rejected')
  assert('驳回自动通知申请人（站内消息 + biz_type=club）',
    !!rejectMsg && rejectMsg.biz_type === 'club' && rejectMsg.user_id === u1._id && rejectMsg.biz_id === applied._id,
    JSON.stringify(rejectMsg).slice(0, 240))
  assert('驳回通知文案含理由',
    rejectMsg.title === '入驻审核已驳回：天文爱好者协会' && rejectMsg.content.includes('驳回理由：简介过于简单'),
    `${rejectMsg.title}|${rejectMsg.content}`)
  assert('驳回通知按事件去重（同场景同业务仅一条）',
    stores.messages.filter((m) => m.scene === 'club_apply_rejected' && m.biz_id === applied._id).length === 1)

  r = await call('/club/review', { body: { club_id: applied._id, action: 'reject', reason: '再次驳回' }, token: superToken })
  assert('已处理社团重复审核 → 1002', r.payload.code === 1002, JSON.stringify(r.payload))

  r = await call('/club/apply', { body: { ...APPLY_BODY, intro: '一起观测星空，每周三晚团练，欢迎天文爱好者加入' }, token: studentToken(u1) })
  assert('驳回后重提成功 → resubmitted 且复用原记录', r.payload.code === 0 && r.payload.data.resubmitted === true && r.payload.data.club._id === applied._id, JSON.stringify(r.payload).slice(0, 240))
  const resubmitted = stores.clubs.find((item) => item._id === applied._id)
  assert('重提后回到 pending 且清空驳回留痕', resubmitted.status === 'pending' && resubmitted.reject_reason === '' && resubmitted.review_by === '' && resubmitted.review_at === null, JSON.stringify(resubmitted).slice(0, 260))
  assert('重提更新了简介', resubmitted.intro.includes('每周三晚团练'), resubmitted.intro)

  /* ---------- 6. 审核：通过 → 自动建社长 ---------- */
  console.log('\n【审核 · 通过】')
  r = await call('/club/review', { body: { club_id: applied._id, action: 'approve' }, token: auditorToken })
  assert('通过成功 → status=normal', r.payload.code === 0 && r.payload.data.club.status === 'normal', JSON.stringify(r.payload).slice(0, 240))
  assert('通过清空驳回理由且记录审核人', r.payload.data.club.reject_reason === '' && r.payload.data.club.review_by === 'auditor1', JSON.stringify(r.payload.data.club).slice(0, 240))
  assert('自动创建 club_members（申请人为 president）', r.payload.data.member_created === true && (() => {
    const m = stores.club_members[0]
    return m && m.club_id === applied._id && m.user_id === u1._id && m.role === 'president' && m.status === 'active' && m.joined_at instanceof Date
  })(), JSON.stringify(stores.club_members))

  const approveMsg = stores.messages.find((m) => m.scene === 'club_apply_approved')
  assert('通过自动通知申请人（未被驳回通知去重拦掉）',
    !!approveMsg && approveMsg.title === '入驻审核已通过：天文爱好者协会' && approveMsg.content.includes('社长'),
    JSON.stringify(stores.messages.map((m) => `${m.scene}:${m.title}`)))
  assert('同一社团「驳回 + 通过」各一条（共 2 条通知）', stores.messages.filter((m) => m.biz_id === applied._id).length === 2,
    JSON.stringify(stores.messages.map((m) => m.scene)))

  r = await call('/club/review', { body: { club_id: applied._id, action: 'approve' }, token: superToken })
  assert('重复通过 → 1002', r.payload.code === 1002, JSON.stringify(r.payload))

  r = await call('/club/apply/current', { method: 'GET', token: studentToken(u1) })
  assert('学生端可见已通过社团（approved 非空）', r.payload.data.approved && r.payload.data.approved._id === applied._id && r.payload.data.pending === null, JSON.stringify(r.payload).slice(0, 240))

  r = await call('/club/apply', { body: { ...APPLY_BODY, name: '观星社' }, token: studentToken(u1) })
  assert('已入驻用户可再次申请其他社团（用于多社团共管）', r.payload.code === 0 && r.payload.data.club.name === '观星社', JSON.stringify(r.payload).slice(0, 200))

  /* ---------- 7. 批量导入 ---------- */
  console.log('\n【批量导入】')
  r = await call('/club/import', { body: { chunk_index: 0, rows: [{ row_no: 2, name: '篮球社' }] } })
  assert('无 token → 401', r.statusCode === 401, JSON.stringify(r.payload))

  r = await call('/club/import', { body: { chunk_index: 0, rows: [{ row_no: 2, name: '篮球社' }] }, token: viewerToken })
  assert('viewer → 403', r.payload.code === 403, JSON.stringify(r.payload))

  r = await call('/club/import', { body: { chunk_index: 0, rows: [{ row_no: 2, name: '篮球社' }] }, token: superToken })
  assert('缺 batch_no → 1001', r.payload.code === 1001, JSON.stringify(r.payload))

  r = await call('/club/import', { body: { batch_no: 'CI-1', chunk_index: 0, rows: [] }, token: superToken })
  assert('空块 → 1001', r.payload.code === 1001, JSON.stringify(r.payload))

  const bigRows = Array.from({ length: 501 }, (_, i) => ({ row_no: i + 2, name: `社团${i}` }))
  r = await call('/club/import', { body: { batch_no: 'CI-1', chunk_index: 0, rows: bigRows }, token: superToken })
  assert('单块超 500 行 → 1001', r.payload.code === 1001, JSON.stringify(r.payload))

  r = await call('/club/import', {
    body: {
      batch_no: 'CI-1',
      chunk_index: 0,
      rows: [
        { row_no: 2, name: '篮球社', intro: '每周训练', category: '体育竞技', contact: '微信群' },
        { row_no: 3, name: '天文爱好者协会', category: '体育竞技' },
        { row_no: 4, name: '', category: '体育竞技' },
        { row_no: 5, name: '这个社团名称特别特别长超过三十个字符用于验证超长拦截逻辑是否生效', category: '体育竞技' },
        { row_no: 6, name: '摄影社', category: '不存在的分类' },
        { row_no: 7, name: '篮球社', category: '体育竞技' },
        { row_no: 8, name: '围棋社', category: '' },
      ],
    },
    token: superToken,
  })
  assert('导入成功 1 条（篮球社）', r.payload.data.success === 1, JSON.stringify(r.payload.data).slice(0, 300))
  const reasons = r.payload.data.failed.map((item) => item.reason)
  assert('库内已存在 → skipped 记入回执', r.payload.data.skipped.some((s) => s.row_no === 3 && s.reason === '库内已存在'), JSON.stringify(r.payload.data.skipped))
  assert('名称为空 → failed', reasons.some((x) => x.includes('名称为空')), JSON.stringify(reasons))
  assert('名称超长 → failed', reasons.some((x) => x.includes('超长')), JSON.stringify(reasons))
  assert('分类不存在 → failed', reasons.some((x) => x.includes('不存在')), JSON.stringify(reasons))
  assert('分类为空 → failed', reasons.some((x) => x.includes('分类为空')), JSON.stringify(reasons))
  assert('同批重复 → skipped 记入回执', r.payload.data.skipped.some((s) => s.row_no === 7 && s.reason === '同批重复'), JSON.stringify(r.payload.data.skipped))

  const imported = stores.clubs.find((item) => item.name === '篮球社')
  assert('导入社团落库字段正确（imported / normal / batch_no）',
    imported && imported.create_type === 'imported' && imported.status === 'normal' && imported.batch_no === 'CI-1' &&
    imported.applicant_id === '' && imported.star_level === 0 && imported.deleted === 0,
    JSON.stringify(imported).slice(0, 260))

  clubBatchConflict = true
  r = await call('/club/import', { body: { batch_no: 'CI-2', chunk_index: 0, rows: [{ row_no: 2, name: '排球社', category: '体育竞技' }] }, token: superToken })
  assert('批量写入冲突 → 降级逐条写入并记入回执', r.payload.data.success === 0 && r.payload.data.skipped.some((s) => s.reason.includes('写入冲突')), JSON.stringify(r.payload.data))
  clubBatchConflict = false

  r = await call('/club/import', { body: { batch_no: 'CI-3', chunk_index: 0, rows: [{ row_no: 2, name: '排球社', category: '体育竞技' }, { row_no: 3, name: '乒乓球社', category: '体育竞技' }] }, token: superToken })
  assert('冲突复位后可正常导入 2 条', r.payload.data.success === 2, JSON.stringify(r.payload.data))

  r = await call('/club/query', { body: { status: 'normal' }, token: auditorToken })
  assert('导入社团直接出现在已通过列表（无需审核）', r.payload.code === 0 && r.payload.data.total === 4, JSON.stringify(r.payload).slice(0, 200))
  assert('已通过列表含 1 个线上申请 + 3 个导入',
    r.payload.data.list.filter((c) => c.create_type === 'imported').length === 3 &&
      r.payload.data.list.filter((c) => c.create_type === 'applied').length === 1,
    JSON.stringify(r.payload.data.list.map((c) => `${c.name}:${c.create_type}`)))

  /* ---------- 8. 导入社团的审核分支（防御性） ---------- */
  console.log('\n【导入社团审核分支】')
  const importedPending = { _id: 'club-imported-pending', name: '待审导入社团', intro: '', contact: '', category_id: CAT_SPORT, star_level: 0, status: 'pending', create_type: 'imported', applicant_id: '', reject_reason: '', review_by: '', review_at: null, batch_no: 'CI-4', created_at: new Date(), updated_at: new Date(), deleted: 0 }
  stores.clubs.push(importedPending)
  r = await call('/club/review', { body: { club_id: importedPending._id, action: 'approve' }, token: superToken })
  assert('导入社团通过 → 不建成员、不发通知', r.payload.code === 0 && r.payload.data.member_created === false && r.payload.data.notify === null, JSON.stringify(r.payload).slice(0, 240))

  console.log(`\n结果：${passed} 通过 / ${failed} 失败`)
  if (failed > 0) process.exitCode = 1
}

main().catch((e) => {
  console.error('用例执行异常：', e)
  process.exitCode = 1
})
