/**
 * P1-16 本地验收（离线，无需部署）
 * 覆盖：岗位创建/编辑（权限 / 字段校验 / form_fields 校验与归一化 / 编辑草稿 / 社团校验）、
 *       提交审核（状态前置 / 敏感词拦截 / pending + submitter_id）、
 *       我管理的岗位列表（状态筛选 / 分页 / 编辑回显 / 权限）、手动关闭、
 *       公开详情（draft/pending 404、open 返回 + club_name）、
 *       管理端审核（权限 / 非待审拦截 / 驳回理由 / 通过 open + 通知 / 驳回 draft + 理由 + 通知）、
 *       定时关闭（到期 / 报满）
 * 运行：node scripts/test-p1-16.js
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
const stores = { admins: require('./helpers/admin-fixtures').createAdminFixtures(), recruitments: [], recruitment_registrations: [], club_members: [], clubs: [], categories: [], users: [], messages: [], sensitive_words: [] }

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
const uManager = user({ name: '林晨' })
const uStudent = user({ name: '苏晚晴', student_no: '20260002' })
const uStudent2 = user({ name: '何子轩', student_no: '20260003' })
stores.users.push(uManager, uStudent, uStudent2)

stores.clubs.push(
  { _id: 'club-a', name: '天文社', intro: '', contact: '', status: 'normal', deleted: 0 },
  { _id: 'club-banned', name: '违规社团', intro: '', contact: '', status: 'banned', deleted: 0 }
)
stores.club_members.push(
  { _id: 'm-1', club_id: 'club-a', user_id: uManager._id, role: 'president', status: 'active', joined_at: at(now.getTime() - 30 * DAY) },
  { _id: 'm-2', club_id: 'club-banned', user_id: uManager._id, role: 'president', status: 'active', joined_at: at(now.getTime() - 30 * DAY) }
)

// 敏感词词库（block / review 两级）
stores.sensitive_words.push(
  { _id: 'w-1', word: '兼职刷单', level: 'block', deleted: 0 },
  { _id: 'w-2', word: '代理招生', level: 'review', deleted: 0 }
)

function recruitmentRow(over) {
  return {
    club_id: 'club-a',
    title: '干事招新',
    content: '欢迎加入',
    form_fields: [{ key: 'f1', label: '意向部门', type: 'single', required: true, options: ['文艺部', '技术部'] }],
    multi_step: false,
    signup_end: at(now.getTime() + 3 * DAY),
    capacity: null,
    status: 'draft',
    created_at: at(now.getTime() - 1 * DAY),
    updated_at: at(now.getTime() - 1 * DAY),
    deleted: 0,
    ...over,
  }
}
stores.recruitments.push(
  recruitmentRow({ _id: 'rc-1', title: '干事招新' }),
  recruitmentRow({ _id: 'rc-2', title: '部长招新', status: 'pending', submitter_id: uManager._id }),
  recruitmentRow({ _id: 'rc-3', title: '满员岗位', status: 'open', capacity: 2, signup_end: at(now.getTime() + 3 * DAY) }),
  recruitmentRow({ _id: 'rc-4', title: '已过期岗位', status: 'open', signup_end: at(now.getTime() - 1 * HOUR) })
)
stores.recruitment_registrations.push(
  { _id: 'rr-1', recruitment_id: 'rc-3', user_id: uStudent._id, status: 'pending', deleted: 0 },
  { _id: 'rr-2', recruitment_id: 'rc-3', user_id: uStudent2._id, status: 'accepted', deleted: 0 }
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
const superToken = club.signToken({ type: 'admin', adminId: 'a-1', username: 'root', role: 'super' })
const viewerToken = club.signToken({ type: 'admin', adminId: 'a-3', username: 'viewer', role: 'viewer' })

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

const rcById = (id) => stores.recruitments.find((x) => x._id === id)

const VALID_FIELDS = [
  { key: 'f1', label: '意向部门', type: 'single', required: true, options: ['文艺部', '技术部'] },
  { key: 'f2', label: '擅长领域', type: 'multi', required: false, options: ['设计', '策划', '外联'] },
  { key: 'f3', label: '自我介绍', type: 'text', required: true },
]

async function main() {
  /* ---------- 1. 岗位创建 / 编辑 ---------- */
  console.log('\n【save】')
  let r = await call('/save', { body: { club_id: 'club-a', title: '干事招新', content: 'y', signup_end: Date.now() + DAY, multi_step: false, form_fields: VALID_FIELDS }, token: studentToken(uStudent) })
  assert('非负责人创建 → 403', r.payload.code === 403, JSON.stringify(r.payload))

  r = await call('/save', { body: { club_id: 'club-a', title: '干', content: 'y', signup_end: Date.now() + DAY, multi_step: false, form_fields: VALID_FIELDS }, token: studentToken(uManager) })
  assert('标题过短 → 1001', r.payload.code === 1001, JSON.stringify(r.payload))

  r = await call('/save', { body: { club_id: 'club-a', title: '干事招新', content: 'y', signup_end: Date.now() - 1000, multi_step: false, form_fields: VALID_FIELDS }, token: studentToken(uManager) })
  assert('截止时间在过去 → 1001', r.payload.code === 1001, JSON.stringify(r.payload))

  r = await call('/save', { body: { club_id: 'club-a', title: '干事招新', content: 'y', signup_end: Date.now() + DAY, multi_step: false, form_fields: [] }, token: studentToken(uManager) })
  assert('报名表为空 → 1001', r.payload.code === 1001, JSON.stringify(r.payload))

  r = await call('/save', { body: { club_id: 'club-a', title: '干事招新', content: 'y', signup_end: Date.now() + DAY, multi_step: false, form_fields: [{ key: 'f1', label: '意向', type: 'single', required: true, options: [] }] }, token: studentToken(uManager) })
  assert('单选无选项 → 1001', r.payload.code === 1001, JSON.stringify(r.payload))

  r = await call('/save', { body: { club_id: 'club-a', title: '干事招新', content: 'y', signup_end: Date.now() + DAY, multi_step: false, form_fields: [{ key: 'f1', label: '意向', type: 'bad', required: true }] }, token: studentToken(uManager) })
  assert('字段类型非法 → 1001', r.payload.code === 1001, JSON.stringify(r.payload))

  r = await call('/save', { body: { club_id: 'club-x', title: '干事招新', content: 'y', signup_end: Date.now() + DAY, multi_step: false, form_fields: VALID_FIELDS }, token: studentToken(uManager) })
  assert('社团不存在 → 404', r.payload.code === 404, JSON.stringify(r.payload))

  r = await call('/save', { body: { club_id: 'club-banned', title: '干事招新', content: 'y', signup_end: Date.now() + DAY, multi_step: false, form_fields: VALID_FIELDS }, token: studentToken(uManager) })
  assert('封禁社团创建 → 1002', r.payload.code === 1002, JSON.stringify(r.payload))

  r = await call('/save', { body: { club_id: 'club-a', title: '新媒体干事', content: '负责公众号运营', signup_end: Date.now() + 5 * DAY, capacity: 10, multi_step: true, form_fields: VALID_FIELDS }, token: studentToken(uManager) })
  assert('正常创建草稿 → 落库 draft + 归一化', r.payload.code === 0 && r.payload.data.recruitment.status === 'draft' && stores.recruitments.some((x) => x.title === '新媒体干事' && Array.isArray(x.form_fields) && x.form_fields.length === 3 && x.form_fields[0].options[0] === '文艺部'), JSON.stringify(r.payload).slice(0, 200))

  const created = stores.recruitments.find((x) => x.title === '新媒体干事')
  r = await call('/save', { body: { recruitment_id: created._id, club_id: 'club-a', title: '新媒体干事（改）', content: '负责公众号运营', signup_end: Date.now() + 5 * DAY, capacity: 10, multi_step: true, form_fields: VALID_FIELDS }, token: studentToken(uManager) })
  assert('编辑草稿 → updated + 标题变更', r.payload.code === 0 && r.payload.data.updated === true && rcById(created._id).title === '新媒体干事（改）', JSON.stringify(r.payload).slice(0, 160))

  r = await call('/save', { body: { recruitment_id: 'rc-2', club_id: 'club-a', title: '部长招新改', content: 'y', signup_end: Date.now() + DAY, multi_step: false, form_fields: VALID_FIELDS }, token: studentToken(uManager) })
  assert('编辑非草稿（pending）→ 1002', r.payload.code === 1002, JSON.stringify(r.payload))

  /* ---------- 2. 提交审核 ---------- */
  console.log('\n【submit】')
  r = await call('/submit', { body: { recruitment_id: 'rc-2' }, token: studentToken(uManager) })
  assert('非草稿提交 → 1002', r.payload.code === 1002, JSON.stringify(r.payload))

  r = await call('/submit', { body: { recruitment_id: created._id }, token: studentToken(uStudent) })
  assert('非负责人提交 → 403', r.payload.code === 403, JSON.stringify(r.payload))

  rcById(created._id).title = '兼职刷单高薪'
  r = await call('/submit', { body: { recruitment_id: created._id }, token: studentToken(uManager) })
  assert('命中 block 敏感词 → 1001 拦截', r.payload.code === 1001, JSON.stringify(r.payload))
  rcById(created._id).title = '新媒体干事（改）'

  r = await call('/submit', { body: { recruitment_id: created._id }, token: studentToken(uManager) })
  assert('正常提交 → pending + submitter_id + 清空驳回留痕', r.payload.code === 0 && rcById(created._id).status === 'pending' && rcById(created._id).submitter_id === uManager._id, JSON.stringify(r.payload).slice(0, 160))

  /* ---------- 3. 我管理的岗位列表 ---------- */
  console.log('\n【manage】')
  r = await call('/manage', { method: 'GET', query: { status: 'all' }, token: studentToken(uStudent) })
  assert('非管理社团用户 → 空列表', r.payload.code === 0 && r.payload.data.total === 0, JSON.stringify(r.payload.data).slice(0, 120))

  r = await call('/manage', { method: 'GET', query: { status: 'all' }, token: studentToken(uManager) })
  assert('列表含 5 个岗位 + join 社团名', r.payload.code === 0 && r.payload.data.total === 5 && r.payload.data.list.every((row) => row.club_name === '天文社'), JSON.stringify(r.payload.data).slice(0, 160))

  r = await call('/manage', { method: 'GET', query: { status: 'pending' }, token: studentToken(uManager) })
  assert('状态筛选 pending → 2 条', r.payload.code === 0 && r.payload.data.total === 2, JSON.stringify(r.payload.data).slice(0, 120))

  r = await call('/manage', { method: 'GET', query: { status: 'all', recruitment_id: 'rc-1' }, token: studentToken(uManager) })
  assert('编辑回显单条', r.payload.code === 0 && r.payload.data.recruitment._id === 'rc-1' && Array.isArray(r.payload.data.recruitment.form_fields), JSON.stringify(r.payload.data).slice(0, 120))

  /* ---------- 4. 手动关闭 ---------- */
  console.log('\n【close】')
  r = await call('/close', { body: { recruitment_id: 'rc-1' }, token: studentToken(uManager) })
  assert('非 open 关闭 → 1002', r.payload.code === 1002, JSON.stringify(r.payload))

  r = await call('/close', { body: { recruitment_id: 'rc-3' }, token: studentToken(uStudent) })
  assert('非负责人关闭 → 403', r.payload.code === 403, JSON.stringify(r.payload))

  r = await call('/close', { body: { recruitment_id: 'rc-3' }, token: studentToken(uManager) })
  assert('open 手动关闭 → closed', r.payload.code === 0 && rcById('rc-3').status === 'closed', JSON.stringify(r.payload).slice(0, 120))

  /* ---------- 5. 公开详情 ---------- */
  console.log('\n【detail】')
  r = await call('/detail', { method: 'GET', query: { recruitment_id: 'rc-1' }, token: null })
  assert('draft 详情 → 404', r.payload.code === 404, JSON.stringify(r.payload))

  r = await call('/detail', { method: 'GET', query: { recruitment_id: 'rc-2' }, token: null })
  assert('pending 详情 → 404', r.payload.code === 404, JSON.stringify(r.payload))

  r = await call('/detail', { method: 'GET', query: { recruitment_id: 'rc-4' }, token: null })
  assert('open 详情公开返回 + club_name', r.payload.code === 0 && r.payload.data.recruitment.club_name === '天文社' && r.payload.data.recruitment.form_fields.length === 1, JSON.stringify(r.payload).slice(0, 160))

  /* ---------- 6. 管理端审核 ---------- */
  console.log('\n【review-query / review】')
  r = await call('/review-query', { body: { status: 'pending', page: 1, page_size: 20 }, token: studentToken(uManager) })
  assert('学生 token 查审核 → 403（通道不匹配）', r.payload.code === 403, JSON.stringify(r.payload))

  r = await call('/review-query', { body: { status: 'pending', page: 1, page_size: 20 }, token: viewerToken })
  assert('viewer 角色查审核 → 403', r.payload.code === 403, JSON.stringify(r.payload))

  r = await call('/review-query', { body: { status: 'pending', page: 1, page_size: 20 }, token: superToken })
  assert('超管查待审 → 2 条 + pending_total', r.payload.code === 0 && r.payload.data.total === 2 && r.payload.data.pending_total === 2 && r.payload.data.list[0].submitter_name === '林晨', JSON.stringify(r.payload.data).slice(0, 160))

  r = await call('/review', { body: { recruitment_id: 'rc-2', action: 'reject' }, token: superToken })
  assert('驳回未填理由 → 1001', r.payload.code === 1001, JSON.stringify(r.payload))

  r = await call('/review', { body: { recruitment_id: 'rc-2', action: 'approve' }, token: superToken })
  assert('通过 → open + 通知发起人', r.payload.code === 0 && rcById('rc-2').status === 'open' && stores.messages.some((m) => m.scene === 'club_recruitment_review' && m.user_id === uManager._id && /通过/.test(m.title + m.content)), JSON.stringify(r.payload).slice(0, 160))

  r = await call('/review', { body: { recruitment_id: created._id, action: 'reject', reason: '内容需补充' }, token: superToken })
  assert('驳回 → draft + 理由留痕 + 通知', r.payload.code === 0 && rcById(created._id).status === 'draft' && rcById(created._id).reject_reason === '内容需补充' && stores.messages.some((m) => m.scene === 'club_recruitment_review' && /未通过/.test(m.title + m.content)), JSON.stringify(r.payload).slice(0, 160))

  /* ---------- 7. 定时关闭 ---------- */
  console.log('\n【timer】')
  r = await recruitmentFn.main({ type: 'timer' })
  assert('timer 返回统计', r && r.code === 0 && typeof r.data === 'object', JSON.stringify(r))
  assert('到期岗位自动 closed', rcById('rc-4').status === 'closed', `rc-4=${rcById('rc-4').status}`)
  assert('报满岗位自动 closed（2/2）', rcById('rc-3').status === 'closed', `rc-3=${rcById('rc-3').status}`)
  assert('未到期未满员岗位保持 open', rcById('rc-2').status === 'open', `rc-2=${rcById('rc-2').status}`)

  console.log(`\n通过 ${passed} 项，失败 ${failed} 项`)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error('测试异常：', e)
  process.exit(1)
})
