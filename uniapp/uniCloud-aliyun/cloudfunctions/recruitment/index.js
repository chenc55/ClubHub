/**
 * 招新域云函数（P0-05 骨架 / P1-16 岗位创建与审核 CLB-04① + ADM-04）
 * URL 化前缀 /recruitment（网关剥离前缀后透传 event.path），路由按相对路径注册
 *
 * P1-16（需求 4.2.3 + 招新岗位状态机 4.4）：
 * - 负责人端 POST /recruitment/save（创建 / 更新草稿，含自定义报名表 form_fields）、POST /recruitment/submit（提交审核 + 敏感词拦截）
 * - 负责人端 GET /recruitment/manage（我管理的社团的岗位列表）、POST /recruitment/close（手动提前关闭）
 * - 管理端 POST /recruitment/review-query、POST /recruitment/review（通过 → open / 驳回 → draft + 理由 + 通知发起人）
 * - 学生端 GET /recruitment/detail（公开岗位详情，P1-17 报名页使用）
 * - 定时触发器：open → closed（报名截止 / 报满自动关闭，阿里云 timer 事件形态见 isTimerEvent）
 * P1-17 报名、P1-18 筛选录取在此扩展。
 */
'use strict'
const club = require('./lib/club-common')
const notify = require('./lib/notify')
const filter = require('./lib/sensitive-filter')

/** 招新岗位状态机（需求 4.4）：draft → pending → open → closed */
const RECRUITMENT_STATUS = { DRAFT: 'draft', PENDING: 'pending', OPEN: 'open', CLOSED: 'closed' }
/** 具备招新管理权限的身份（president / officer，需求 4.2.3 前置条件） */
const CLUB_MEMBER_ROLE = { PRESIDENT: 'president', OFFICER: 'officer' }
const CLUB_MEMBER_STATUS = { ACTIVE: 'active' }
const RECRUITMENT_MANAGER_ROLES = [CLUB_MEMBER_ROLE.PRESIDENT, CLUB_MEMBER_ROLE.OFFICER]

const RECRUITMENT_TITLE_MIN = 2
const RECRUITMENT_TITLE_MAX = 50
const RECRUITMENT_CONTENT_MAX = 5000
const RECRUITMENT_CAPACITY_MAX = 10000
/** 自定义报名表字段类型（P1-16 定稿：单选 / 多选 / 问答） */
const FORM_FIELD_TYPES = ['single', 'multi', 'text']
const FORM_FIELD_MAX = 20
const FORM_FIELD_LABEL_MAX = 20
const FORM_FIELD_OPTION_MAX = 20
const FORM_FIELD_OPTIONS_MIN = 2
/** 管理端列表每页条数 */
const MANAGE_PAGE_SIZE = 20

/** 管理端招新审核权限：超管 / 审核员（与 2.3 权限矩阵「招新审核」一致） */
const OPS_GUARD = [club.requireAuth(club.TOKEN_TYPES.ADMIN), club.requireRole(['super', 'auditor'])]
const RECRUITMENT_REVIEW_ACTION = { APPROVE: 'approve', REJECT: 'reject' }
const RECRUITMENT_REASON_MIN = 2
const RECRUITMENT_REASON_MAX = 200

/** 招新报名状态机（需求 4.4）：pending / interview / accepted / rejected */
const RECRUITMENT_REG_STATUS = { PENDING: 'pending', INTERVIEW: 'interview', ACCEPTED: 'accepted', REJECTED: 'rejected' }
/** 招新报名有效状态（报满计数口径；pending 待审核 / interview 面试 / accepted 已录取） */
const VALID_RECRUITMENT_REG_STATUS = [RECRUITMENT_REG_STATUS.PENDING, RECRUITMENT_REG_STATUS.INTERVIEW, RECRUITMENT_REG_STATUS.ACCEPTED]
/** 我的招新状态分页上限 */
const ACTIVITY_LIST_PAGE_SIZE_MAX = 50
/** 名单 / 导出一次性拉取上限（防超大请求）；后端按页查询 */
const ACTIVITY_LIST_CANDIDATE_MAX = 2000

function recruitments() {
  return uniCloud.database().collection('recruitments')
}

function recruitmentRegistrations() {
  return uniCloud.database().collection('recruitment_registrations')
}

function clubMembers() {
  return uniCloud.database().collection('club_members')
}

function clubs() {
  return uniCloud.database().collection('clubs')
}

function users() {
  return uniCloud.database().collection('users')
}

/** 时间统一转毫秒（兼容 Date / 时间戳 / {$date}）；非法返回 0 */
function toTime(value) {
  if (!value) return 0
  const raw = typeof value === 'object' && value.$date ? value.$date : value
  const time = new Date(raw).getTime()
  return Number.isNaN(time) ? 0 : time
}

/** 时间展示（招新通知变量）：YYYY-MM-DD HH:mm */
function formatTime(value) {
  const date = new Date(toTime(value))
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

async function findRecruitmentById(id) {
  const cmd = uniCloud.database().command
  const res = await recruitments().where({ _id: id, deleted: cmd.neq(1) }).limit(1).get()
  return (res.data && res.data[0]) || null
}

/** 当前用户在指定社团的有效管理身份（president / officer） */
async function findManagerMembership(clubId, userId) {
  const cmd = uniCloud.database().command
  const res = await clubMembers()
    .where({ club_id: clubId, user_id: userId, status: CLUB_MEMBER_STATUS.ACTIVE, role: cmd.in(RECRUITMENT_MANAGER_ROLES) })
    .limit(1)
    .get()
  return (res.data && res.data[0]) || null
}

/** 该用户有管理权限的全部社团 ID */
async function findManagedClubIds(userId) {
  const cmd = uniCloud.database().command
  const res = await clubMembers()
    .where({ user_id: userId, status: CLUB_MEMBER_STATUS.ACTIVE, role: cmd.in(RECRUITMENT_MANAGER_ROLES) })
    .get()
  return (res.data || []).map((item) => item.club_id)
}

/** 校验自定义报名表字段（P1-16 定稿结构）；返回错误响应或 null */
function validateFormFields(fields) {
  if (!Array.isArray(fields) || fields.length === 0) {
    return club.fail(club.ERROR_CODE.PARAM_INVALID, '请至少配置一个报名表字段')
  }
  if (fields.length > FORM_FIELD_MAX) {
    return club.fail(club.ERROR_CODE.PARAM_INVALID, `报名表字段最多 ${FORM_FIELD_MAX} 个`)
  }
  const seen = new Set()
  for (let i = 0; i < fields.length; i += 1) {
    const field = fields[i]
    if (!field || typeof field !== 'object') {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, `第 ${i + 1} 个字段配置不合法`)
    }
    const key = String(field.key || '').trim()
    if (!key || seen.has(key)) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, '字段 key 缺失或重复')
    }
    seen.add(key)
    const label = String(field.label == null ? '' : field.label).trim()
    if (!label || label.length > FORM_FIELD_LABEL_MAX) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, `字段「${label || key}」标签需 1~${FORM_FIELD_LABEL_MAX} 个字`)
    }
    const type = String(field.type || '')
    if (FORM_FIELD_TYPES.indexOf(type) === -1) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, `字段「${label}」类型不合法（单选/多选/问答）`)
    }
    if (type === 'single' || type === 'multi') {
      const options = Array.isArray(field.options) ? field.options : []
      if (options.length < FORM_FIELD_OPTIONS_MIN || options.length > FORM_FIELD_OPTION_MAX) {
        return club.fail(club.ERROR_CODE.PARAM_INVALID, `字段「${label}」需配置 ${FORM_FIELD_OPTIONS_MIN}~${FORM_FIELD_OPTION_MAX} 个选项`)
      }
      const valid = options.every((opt) => String(opt || '').trim() && String(opt).trim().length <= FORM_FIELD_LABEL_MAX)
      if (!valid) {
        return club.fail(club.ERROR_CODE.PARAM_INVALID, `字段「${label}」选项内容不合法`)
      }
    }
  }
  return null
}

/** 校验招新岗位业务字段；返回错误响应或 null */
function validateRecruitmentBody(body) {
  const err = club.checkParams(body, {
    club_id: { type: 'string', required: true, maxLen: 64 },
    title: { type: 'string', required: true, maxLen: RECRUITMENT_TITLE_MAX },
    content: { type: 'string', required: true, maxLen: RECRUITMENT_CONTENT_MAX },
    signup_end: { type: 'number', required: true },
    capacity: { type: 'int' },
    multi_step: { type: 'bool', required: true },
    form_fields: { type: 'array', required: true },
  })
  if (err) return err

  const title = String(body.title).trim()
  if (title.length < RECRUITMENT_TITLE_MIN) {
    return club.fail(club.ERROR_CODE.PARAM_INVALID, `岗位标题至少 ${RECRUITMENT_TITLE_MIN} 个字`)
  }
  const content = String(body.content).trim()
  if (!content) return club.fail(club.ERROR_CODE.PARAM_INVALID, '请填写岗位内容')

  const signupEnd = Number(body.signup_end)
  if (signupEnd <= Date.now()) {
    return club.fail(club.ERROR_CODE.PARAM_INVALID, '报名截止时间需晚于当前时间')
  }
  if (body.capacity != null && body.capacity !== 0) {
    if (!Number.isInteger(body.capacity) || body.capacity < 1 || body.capacity > RECRUITMENT_CAPACITY_MAX) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, `招聘人数需在 1~${RECRUITMENT_CAPACITY_MAX} 之间（空 = 不限）`)
    }
  }
  return validateFormFields(body.form_fields)
}

/** 岗位行结构（负责人 manage / 管理端审核共用） */
function publicRecruitment(row, clubName) {
  return {
    _id: row._id,
    club_id: row.club_id,
    club_name: clubName || '',
    title: row.title,
    content: row.content,
    form_fields: Array.isArray(row.form_fields) ? row.form_fields : [],
    multi_step: !!row.multi_step,
    signup_end: row.signup_end || null,
    capacity: row.capacity || null,
    status: row.status,
    reject_reason: row.reject_reason || '',
    submitter_id: row.submitter_id || '',
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    review_at: row.review_at || null,
  }
}

/** 定时：open → closed（报名截止 / 报满自动关闭；需求 4.2.3 主流程 5） */
async function runTimer(now = new Date()) {
  const cmd = uniCloud.database().command
  const stats = { deadline: 0, capacity: 0 }
  const nowTime = toTime(now)

  // 1) 到期关闭：signup_end <= now
  const expired = await recruitments()
    .where({ status: RECRUITMENT_STATUS.OPEN, deleted: cmd.neq(1), signup_end: cmd.lte(now) })
    .limit(100)
    .get()
  const expiredIds = (expired.data || []).map((row) => row._id)
  if (expiredIds.length) {
    await recruitments().where({ _id: cmd.in(expiredIds) }).update({ status: RECRUITMENT_STATUS.CLOSED, updated_at: now })
    stats.deadline = expiredIds.length
  }

  // 2) 报满关闭：capacity 有值且有效报名数 >= capacity
  const opened = await recruitments()
    .where({ status: RECRUITMENT_STATUS.OPEN, deleted: cmd.neq(1), capacity: cmd.gt(0) })
    .limit(100)
    .get()
  const capacityIds = []
  for (const row of opened.data || []) {
    const counted = await recruitmentRegistrations()
      .where({ recruitment_id: row._id, status: cmd.in(VALID_RECRUITMENT_REG_STATUS), deleted: 0 })
      .count()
    if (Number((counted && counted.total) || 0) >= Number(row.capacity)) capacityIds.push(row._id)
  }
  if (capacityIds.length) {
    await recruitments().where({ _id: cmd.in(capacityIds) }).update({ status: RECRUITMENT_STATUS.CLOSED, updated_at: now })
    stats.capacity = capacityIds.length
  }

  console.log('[recruitment-timer] close:', JSON.stringify(stats))
  return stats
}

/** 定时触发事件判定：兼容阿里云（Type/TriggerName，无小写 type）、腾讯云与本地模拟形态
 *  仅判 event.type === 'timer' 会导致云端定时触发空转（有调用日志但状态不流转） */
function isTimerEvent(event) {
  if (!event) return false
  return (
    event.type === 'timer' ||
    event.Type === 'Timer' ||
    event.Type === 'timer' ||
    typeof event.TriggerName === 'string' ||
    typeof event.triggerName === 'string'
  )
}

exports.main = async (event) => {
  // 定时触发器分支（阿里云 timer 事件无 httpMethod）
  if (isTimerEvent(event)) {
    try {
      const stats = await runTimer()
      return { code: 0, data: stats }
    } catch (e) {
      console.error('[recruitment-timer] failed:', e)
      return { code: 500, message: e && e.message }
    }
  }

  const api = club.createRouter(event)

  api.get('/ping', () => club.ok({ pong: 'recruitment', time: Date.now() }))

  // 负责人端：创建 / 更新岗位草稿（保存不触发敏感词；提交审核走 /submit）
  api.post('/save', club.requireActiveStudent(), async (ctx) => {
    const err = validateRecruitmentBody(ctx.body)
    if (err) return err

    const clubRowRes = await clubs().where({ _id: ctx.body.club_id.trim(), deleted: 0 }).limit(1).get()
    const clubRow = (clubRowRes.data && clubRowRes.data[0]) || null
    if (!clubRow) return club.fail(club.ERROR_CODE.NOT_FOUND, '社团不存在或已删除')
    if (clubRow.status !== 'normal') {
      return club.fail(club.ERROR_CODE.STATUS_INVALID, '社团当前状态不允许创建招新岗位')
    }
    const membership = await findManagerMembership(ctx.body.club_id.trim(), ctx.user._id)
    if (!membership) {
      return club.fail(club.ERROR_CODE.FORBIDDEN, '你无权为该社团创建招新岗位')
    }

    const now = new Date()
    const record = {
      club_id: ctx.body.club_id.trim(),
      title: String(ctx.body.title).trim(),
      content: String(ctx.body.content).trim(),
      form_fields: ctx.body.form_fields.map((field) => ({
        key: String(field.key || '').trim(),
        label: String(field.label || '').trim(),
        type: String(field.type),
        required: !!field.required,
        options: Array.isArray(field.options) ? field.options.map((opt) => String(opt).trim()) : [],
      })),
      multi_step: !!ctx.body.multi_step,
      signup_end: new Date(Number(ctx.body.signup_end)),
      capacity: ctx.body.capacity == null || ctx.body.capacity === 0 ? null : Number(ctx.body.capacity),
      status: RECRUITMENT_STATUS.DRAFT,
      created_at: now,
      updated_at: now,
      deleted: 0,
    }

    if (ctx.body.recruitment_id) {
      const target = await findRecruitmentById(String(ctx.body.recruitment_id).trim())
      if (!target) return club.fail(club.ERROR_CODE.NOT_FOUND, '岗位不存在或已删除')
      if (target.status !== RECRUITMENT_STATUS.DRAFT) {
        return club.fail(club.ERROR_CODE.STATUS_INVALID, '仅「草稿」状态的岗位可编辑')
      }
      if (target.club_id !== record.club_id) {
        return club.fail(club.ERROR_CODE.STATUS_INVALID, '不可变更岗位所属社团')
      }
      record.updated_at = now
      await recruitments().doc(target._id).update(record)
      return club.ok({ recruitment: publicRecruitment({ ...record, _id: target._id }, clubRow.name), updated: true })
    }

    const added = await recruitments().add(record)
    return club.ok({ recruitment: publicRecruitment({ ...record, _id: added.id }, clubRow.name), updated: false })
  })

  // 负责人端：提交审核（draft → pending；先审后发，命中 block / review 级敏感词拦截）
  api.post('/submit', club.requireActiveStudent(), async (ctx) => {
    const err = club.checkParams(ctx.body, { recruitment_id: { type: 'string', required: true, maxLen: 64 } })
    if (err) return err

    const target = await findRecruitmentById(ctx.body.recruitment_id.trim())
    if (!target) return club.fail(club.ERROR_CODE.NOT_FOUND, '岗位不存在或已删除')
    if (target.status !== RECRUITMENT_STATUS.DRAFT) {
      return club.fail(club.ERROR_CODE.STATUS_INVALID, '仅「草稿」状态的岗位可提交审核')
    }
    const membership = await findManagerMembership(target.club_id, ctx.user._id)
    if (!membership) {
      return club.fail(club.ERROR_CODE.FORBIDDEN, '你无权提交该社团的招新审核')
    }
    const clubRowRes = await clubs().where({ _id: target.club_id, deleted: 0 }).limit(1).get()
    if (!(clubRowRes.data && clubRowRes.data[0]) || clubRowRes.data[0].status !== 'normal') {
      return club.fail(club.ERROR_CODE.STATUS_INVALID, '社团当前状态不允许发布招新')
    }

    // 先审后发：命中 block 或 review 级 → 拦截提交，提示修改后重新提交（需求 2.5）
    const result = await filter.checkContent({ title: target.title, body: target.content })
    const decision = filter.decideByMode(filter.PUBLISH_MODES.PRE_REVIEW, result)
    if (!decision.allowed) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, '内容含违规词，请修改后重新提交')
    }

    const now = new Date()
    await recruitments().doc(target._id).update({
      status: RECRUITMENT_STATUS.PENDING,
      submitter_id: ctx.user._id,
      reject_reason: '',
      review_by: '',
      review_at: null,
      updated_at: now,
    })
    return club.ok({ recruitment: publicRecruitment({ ...target, status: RECRUITMENT_STATUS.PENDING, submitter_id: ctx.user._id }, '') })
  })

  // 负责人端：我管理的社团的岗位列表（状态 tab + 分页 + 编辑回显）
  api.get('/manage', club.requireActiveStudent(), async (ctx) => {
    const page = Number((ctx.query && ctx.query.page) || 1)
    const pageSize = Number((ctx.query && ctx.query.page_size) || MANAGE_PAGE_SIZE)
    const status = String((ctx.query && ctx.query.status) || 'all').trim()
    if (!Number.isInteger(page) || page < 1) return club.fail(club.ERROR_CODE.PARAM_INVALID, 'page 不合法')
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, 'page_size 取值不合法')
    }
    if (status !== 'all' && [RECRUITMENT_STATUS.DRAFT, RECRUITMENT_STATUS.PENDING, RECRUITMENT_STATUS.OPEN, RECRUITMENT_STATUS.CLOSED].indexOf(status) === -1) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, 'status 取值不合法')
    }

    const clubIds = await findManagedClubIds(ctx.user._id)
    if (!clubIds.length) return club.ok({ list: [], total: 0, page, page_size: pageSize, has_more: false })

    const cmd = uniCloud.database().command
    const where = { club_id: cmd.in(clubIds), deleted: cmd.neq(1) }
    if (status !== 'all') where.status = status
    const counted = await recruitments().where(where).count()
    const total = Number((counted && counted.total) || 0)
    const found = await recruitments()
      .where(where)
      .orderBy('created_at', 'desc')
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .get()
    const rows = found.data || []

    const clubNameMap = new Map()
    const clubRes = await clubs().where({ _id: cmd.in(clubIds), deleted: 0 }).get()
    for (const item of clubRes.data || []) clubNameMap.set(item._id, item.name)

    // 编辑回显：单条（限定本人管理的社团）
    if (ctx.query.recruitment_id) {
      const row = rows.find((item) => item._id === String(ctx.query.recruitment_id).trim())
      if (!row) return club.fail(club.ERROR_CODE.NOT_FOUND, '岗位不存在或已删除')
      return club.ok({ recruitment: publicRecruitment(row, clubNameMap.get(row.club_id)) })
    }

    return club.ok({
      list: rows.map((row) => publicRecruitment(row, clubNameMap.get(row.club_id))),
      total,
      page,
      page_size: pageSize,
      has_more: (page - 1) * pageSize + rows.length < total,
    })
  })

  // 负责人端：手动提前关闭（open → closed）
  api.post('/close', club.requireActiveStudent(), async (ctx) => {
    const err = club.checkParams(ctx.body, { recruitment_id: { type: 'string', required: true, maxLen: 64 } })
    if (err) return err

    const target = await findRecruitmentById(ctx.body.recruitment_id.trim())
    if (!target) return club.fail(club.ERROR_CODE.NOT_FOUND, '岗位不存在或已删除')
    const membership = await findManagerMembership(target.club_id, ctx.user._id)
    if (!membership) {
      return club.fail(club.ERROR_CODE.FORBIDDEN, '你无权操作该社团的招新')
    }
    if (target.status !== RECRUITMENT_STATUS.OPEN) {
      return club.fail(club.ERROR_CODE.STATUS_INVALID, '仅「开放中」的岗位可手动关闭')
    }
    const now = new Date()
    await recruitments().doc(target._id).update({ status: RECRUITMENT_STATUS.CLOSED, updated_at: now })
    return club.ok({ recruitment: publicRecruitment({ ...target, status: RECRUITMENT_STATUS.CLOSED }, '') })
  })

  // 学生端：公开岗位详情（open 开放中 / closed 已关闭可见；P1-17 报名页使用）
  api.get('/detail', async (ctx) => {
    const id = String((ctx.query && ctx.query.recruitment_id) || '').trim()
    if (!id) return club.fail(club.ERROR_CODE.PARAM_INVALID, '参数 recruitment_id 不能为空')
    const target = await findRecruitmentById(id)
    if (!target) return club.fail(club.ERROR_CODE.NOT_FOUND, '岗位不存在或已删除')
    if (target.status === RECRUITMENT_STATUS.DRAFT || target.status === RECRUITMENT_STATUS.PENDING) {
      return club.fail(club.ERROR_CODE.NOT_FOUND, '岗位不存在或已删除')
    }
    const clubRes = await clubs().where({ _id: target.club_id, deleted: 0 }).limit(1).get()
    const clubName = (clubRes.data && clubRes.data[0] && clubRes.data[0].name) || ''
    return club.ok({ recruitment: publicRecruitment(target, clubName) })
  })

  // 管理端：招新审核列表（待审 / 已审；join 社团名与发起人）
  api.post('/review-query', ...OPS_GUARD, async (ctx) => {
    const err = club.checkParams(ctx.body, {
      status: { type: 'string', enum: ['pending', 'open', 'draft', 'all'] },
      page: { type: 'int' },
      page_size: { type: 'int' },
    })
    if (err) return err

    const page = ctx.body.page === undefined ? 1 : Number(ctx.body.page)
    const pageSize = ctx.body.page_size === undefined ? 20 : Number(ctx.body.page_size)
    if (page < 1) return club.fail(club.ERROR_CODE.PARAM_INVALID, 'page 不合法')
    if (pageSize < 1 || pageSize > 100) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, 'page_size 需在 1~100 之间')
    }

    const cmd = uniCloud.database().command
    const wheres = [{ deleted: cmd.neq(1) }]
    if (ctx.body.status && ctx.body.status !== 'all') wheres.push({ status: ctx.body.status })
    const where = wheres.length === 1 ? wheres[0] : cmd.and(wheres)

    const counted = await recruitments().where(where).count()
    const total = Number((counted && counted.total) || 0)
    const found = await recruitments()
      .where(where)
      .orderBy('created_at', 'desc')
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .get()
    const rows = found.data || []

    const clubIds = [...new Set(rows.map((row) => row.club_id).filter(Boolean))]
    const clubNameMap = new Map()
    if (clubIds.length) {
      const clubRes = await clubs().where({ _id: cmd.in(clubIds), deleted: 0 }).get()
      for (const item of clubRes.data || []) clubNameMap.set(item._id, item.name)
    }
    const submitterIds = [...new Set(rows.map((row) => row.submitter_id).filter(Boolean))]
    const submitterMap = new Map()
    if (submitterIds.length) {
      const userRes = await users().where({ _id: cmd.in(submitterIds) }).get()
      for (const item of userRes.data || []) submitterMap.set(item._id, item)
    }
    const pendingCounted = await recruitments().where({ status: RECRUITMENT_STATUS.PENDING, deleted: cmd.neq(1) }).count()

    return club.ok({
      list: rows.map((row) => ({
        ...publicRecruitment(row, clubNameMap.get(row.club_id)),
        submitter_name: (submitterMap.get(row.submitter_id) || {}).name || '',
        review_by: row.review_by || '',
        review_at: row.review_at || null,
      })),
      total,
      pending_total: Number((pendingCounted && pendingCounted.total) || 0),
      page,
      page_size: pageSize,
    })
  })

  // 管理端：通过 / 驳回（通过 → open；驳回 → 回退 draft + 必填理由，通知发起人）
  api.post('/review', ...OPS_GUARD, async (ctx) => {
    const err = club.checkParams(ctx.body, {
      recruitment_id: { type: 'string', required: true, maxLen: 64 },
      action: { type: 'string', required: true, enum: [RECRUITMENT_REVIEW_ACTION.APPROVE, RECRUITMENT_REVIEW_ACTION.REJECT] },
      reason: { type: 'string', maxLen: RECRUITMENT_REASON_MAX },
    })
    if (err) return err

    const target = await findRecruitmentById(ctx.body.recruitment_id.trim())
    if (!target) return club.fail(club.ERROR_CODE.NOT_FOUND, '岗位不存在或已删除')
    if (target.status !== RECRUITMENT_STATUS.PENDING) {
      return club.fail(club.ERROR_CODE.STATUS_INVALID, '该岗位当前状态不允许审核（仅待审可操作）')
    }

    const approving = ctx.body.action === RECRUITMENT_REVIEW_ACTION.APPROVE
    const reason = String(ctx.body.reason || '').trim()
    if (!approving && reason.length < RECRUITMENT_REASON_MIN) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, `请填写驳回理由（至少 ${RECRUITMENT_REASON_MIN} 个字）`)
    }

    const reviewedAt = new Date()
    const reviewer = ctx.auth.username
    const nextStatus = approving ? RECRUITMENT_STATUS.OPEN : RECRUITMENT_STATUS.DRAFT
    const patch = {
      status: nextStatus,
      reject_reason: approving ? '' : reason,
      review_by: reviewer,
      review_at: reviewedAt,
      updated_at: reviewedAt,
    }
    await recruitments().doc(target._id).update(patch)

    // 通知发起人（submitter_id；多负责人社团由实际提交审核者接收，需求 4.3.2）
    let pushed = null
    if (target.submitter_id) {
      const resultText = approving ? '已通过' : '未通过'
      const reasonText = reason ? `理由：${reason}` : ''
      pushed = await notify.send({
        userId: target.submitter_id,
        scene: 'club_recruitment_review',
        bizId: target._id,
        vars: {
          recruitment_title: target.title,
          recruitment_id: target._id,
          result_text: resultText,
          reason_text: reasonText,
          result: resultText,
        },
      })
    }
    return club.ok({ recruitment_id: target._id, status: nextStatus, pushed })
  })

  /* ============================================================
   * P1-17 招新报名与我的状态（需求 4.1.6 / STU-06）
   * ============================================================ */

  // 学生端：招新聚合列表（公开；在招岗位 open + 分类/关键词筛选 + 剩余名额）
  api.get('/list', async (ctx) => {
    const page = Number((ctx.query && ctx.query.page) || 1)
    const pageSize = Number((ctx.query && ctx.query.page_size) || MANAGE_PAGE_SIZE)
    const keyword = String((ctx.query && ctx.query.keyword) || '').trim().slice(0, RECRUITMENT_TITLE_MAX)
    const clubId = String((ctx.query && ctx.query.club_id) || '').trim()
    if (!Number.isInteger(page) || page < 1) return club.fail(club.ERROR_CODE.PARAM_INVALID, 'page 不合法')
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, 'page_size 取值不合法')
    }

    const cmd = uniCloud.database().command
    const where = { status: RECRUITMENT_STATUS.OPEN, deleted: cmd.neq(1) }
    if (clubId) where.club_id = clubId
    if (keyword) where.title = new RegExp(keyword, 'i')

    const counted = await recruitments().where(where).count()
    const total = Number((counted && counted.total) || 0)
    const found = await recruitments()
      .where(where)
      .orderBy('signup_end', 'asc')
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .get()
    const rows = found.data || []

    const clubIds = [...new Set(rows.map((row) => row.club_id).filter(Boolean))]
    const clubNameMap = new Map()
    if (clubIds.length) {
      const clubRes = await clubs().where({ _id: cmd.in(clubIds), deleted: 0 }).get()
      for (const item of clubRes.data || []) clubNameMap.set(item._id, item.name)
    }

    // 剩余名额（open 岗位 capacity 有值时：capacity - 有效报名数）
    const capacityRows = rows.filter((row) => row.capacity)
    const regCountMap = new Map()
    if (capacityRows.length) {
      for (const row of capacityRows) {
        const c = await recruitmentRegistrations()
          .where({ recruitment_id: row._id, status: cmd.in(VALID_RECRUITMENT_REG_STATUS), deleted: 0 })
          .count()
        regCountMap.set(row._id, Number((c && c.total) || 0))
      }
    }

    const nowTime = Date.now()
    const list = rows.map((row) => {
      const regCount = regCountMap.get(row._id) || 0
      const capacity = row.capacity ? Number(row.capacity) : null
      return {
        _id: row._id,
        club_id: row.club_id,
        club_name: clubNameMap.get(row.club_id) || '',
        title: row.title,
        content: row.content,
        multi_step: !!row.multi_step,
        signup_end: row.signup_end || null,
        deadline_passed: toTime(row.signup_end) < nowTime,
        capacity,
        remaining: capacity == null ? null : Math.max(0, capacity - regCount),
        full: capacity != null && capacity - regCount <= 0,
        form_fields_count: Array.isArray(row.form_fields) ? row.form_fields.length : 0,
        created_at: row.created_at || null,
      }
    })
    return club.ok({ list, total, page, page_size: pageSize, has_more: (page - 1) * pageSize + list.length < total })
  })

  // 学生端：招新报名（前置：open + 未截止 + 未满；拦截：重复报名 / 已是成员 / 已录取同社团其他岗位）
  api.post('/signup', club.requireActiveStudent(), async (ctx) => {
    const err = club.checkParams(ctx.body, {
      recruitment_id: { type: 'string', required: true, maxLen: 64 },
      form_data: { type: 'object', required: true },
      self_intro: { type: 'string', maxLen: 500 },
    })
    if (err) return err

    const target = await findRecruitmentById(ctx.body.recruitment_id.trim())
    if (!target) return club.fail(club.ERROR_CODE.NOT_FOUND, '岗位不存在或已删除')
    if (target.status !== RECRUITMENT_STATUS.OPEN) {
      return club.fail(club.ERROR_CODE.STATUS_INVALID, '该岗位已关闭，无法报名')
    }
    if (toTime(target.signup_end) < Date.now()) {
      return club.fail(club.ERROR_CODE.STATUS_INVALID, '该岗位报名已截止')
    }

    const cmd = uniCloud.database().command
    // 重复报名拦截：同岗位已有记录（有效状态）
    const dup = await recruitmentRegistrations()
      .where({ recruitment_id: target._id, user_id: ctx.user._id, status: cmd.in(VALID_RECRUITMENT_REG_STATUS), deleted: 0 })
      .limit(1)
      .get()
    if (dup.data && dup.data[0]) {
      return club.fail(club.ERROR_CODE.STATUS_INVALID, '你已报名该岗位，请勿重复提交')
    }

    // 已是该社团成员拦截（active 成员）
    const memberRes = await clubMembers()
      .where({ club_id: target.club_id, user_id: ctx.user._id, status: CLUB_MEMBER_STATUS.ACTIVE, deleted: 0 })
      .limit(1)
      .get()
    if (memberRes.data && memberRes.data[0]) {
      return club.fail(club.ERROR_CODE.STATUS_INVALID, '你已是该社团成员，无需报名')
    }

    // 已录取该社团其他岗位拦截（需求 4.1.6 异常分支 3）
    const clubRecruitments = await recruitments()
      .where({ club_id: target.club_id, deleted: cmd.neq(1) })
      .field({ _id: true })
      .get()
    const clubRecruitmentIds = (clubRecruitments.data || []).map((row) => row._id)
    if (clubRecruitmentIds.length) {
      const accepted = await recruitmentRegistrations()
        .where({ recruitment_id: cmd.in(clubRecruitmentIds), user_id: ctx.user._id, status: RECRUITMENT_REG_STATUS.ACCEPTED, deleted: 0 })
        .limit(1)
        .get()
      if (accepted.data && accepted.data[0]) {
        return club.fail(club.ERROR_CODE.STATUS_INVALID, '你已被该社团其他岗位录取，无法再报名')
      }
    }

    // 名额校验：capacity 有值时已满 → 拦截
    if (target.capacity) {
      const c = await recruitmentRegistrations()
        .where({ recruitment_id: target._id, status: cmd.in(VALID_RECRUITMENT_REG_STATUS), deleted: 0 })
        .count()
      if (Number((c && c.total) || 0) >= Number(target.capacity)) {
        return club.fail(club.ERROR_CODE.STATUS_INVALID, '该岗位名额已满')
      }
    }

    // form_data 校验：必填字段必须存在且非空；可选字段缺省忽略
    const fields = Array.isArray(target.form_fields) ? target.form_fields : []
    const formData = ctx.body.form_data || {}
    for (const field of fields) {
      const value = formData[field.key]
      if (field.required && (value == null || String(value).trim() === '' || (Array.isArray(value) && value.length === 0))) {
        return club.fail(club.ERROR_CODE.PARAM_INVALID, `请填写「${field.label}」`)
      }
      if (field.type === 'single' && value != null && value !== '' && !field.options.some((opt) => opt === value)) {
        return club.fail(club.ERROR_CODE.PARAM_INVALID, `「${field.label}」选项不合法`)
      }
      if (field.type === 'multi' && Array.isArray(value)) {
        for (const v of value) {
          if (!field.options.some((opt) => opt === v)) {
            return club.fail(club.ERROR_CODE.PARAM_INVALID, `「${field.label}」选项不合法`)
          }
        }
      }
    }

    const now = new Date()
    const record = {
      recruitment_id: target._id,
      user_id: ctx.user._id,
      form_data: {
        ...formData,
        self_intro: String(ctx.body.self_intro == null ? '' : ctx.body.self_intro).trim(),
      },
      status: RECRUITMENT_REG_STATUS.PENDING,
      interview: null,
      applied_at: now,
      created_at: now,
      updated_at: now,
      deleted: 0,
    }
    const added = await recruitmentRegistrations().add(record)
    const saved = { _id: added.id, ...record }
    return club.ok({ registration: saved, status: RECRUITMENT_REG_STATUS.PENDING })
  })

  // 学生端：我的招新状态（历史 + 岗位快照 + 面试信息 + 录取时间）
  api.get('/my-status', club.requireAuth(club.TOKEN_TYPES.STUDENT), async (ctx) => {
    const page = Number((ctx.query && ctx.query.page) || 1)
    const pageSize = Number((ctx.query && ctx.query.page_size) || MANAGE_PAGE_SIZE)
    if (!Number.isInteger(page) || page < 1) return club.fail(club.ERROR_CODE.PARAM_INVALID, 'page 不合法')
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > ACTIVITY_LIST_PAGE_SIZE_MAX) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, 'page_size 取值不合法')
    }

    const cmd = uniCloud.database().command
    const where = { user_id: ctx.auth.userId, deleted: 0 }
    const counted = await recruitmentRegistrations().where(where).count()
    const total = Number((counted && counted.total) || 0)
    const found = await recruitmentRegistrations()
      .where(where)
      .orderBy('applied_at', 'desc')
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .get()
    const rows = found.data || []

    const recruitmentIds = [...new Set(rows.map((row) => row.recruitment_id).filter(Boolean))]
    const recMap = new Map()
    const clubNameMap = new Map()
    if (recruitmentIds.length) {
      const recRes = await recruitments().where({ _id: cmd.in(recruitmentIds), deleted: cmd.neq(1) }).get()
      for (const item of recRes.data || []) recMap.set(item._id, item)
      const clubIds = [...new Set((recRes.data || []).map((row) => row.club_id).filter(Boolean))]
      if (clubIds.length) {
        const clubRes = await clubs().where({ _id: cmd.in(clubIds), deleted: 0 }).get()
        for (const item of clubRes.data || []) clubNameMap.set(item._id, item.name)
      }
    }

    const list = rows.map((row) => {
      const rec = recMap.get(row.recruitment_id) || {}
      return {
        registration_id: row._id,
        recruitment_id: row.recruitment_id,
        recruitment_title: rec.title || '',
        club_name: clubNameMap.get(rec.club_id) || '',
        status: row.status,
        self_intro: (row.form_data && row.form_data.self_intro) || '',
        form_data: row.form_data || {},
        interview: row.interview || null,
        applied_at: row.applied_at || null,
        accept_at: row.accept_at || null,
      }
    })
    return club.ok({ list, total, page, page_size: pageSize, has_more: (page - 1) * pageSize + list.length < total })
  })

  /* ============================================================
   * P1-18 招新筛选与录取（需求 4.2.3 主流程 3~4 / CLB-04②）
   * ============================================================ */

  /** 录取自动入团（需求 4.1.6 主流程 6 + 4.2.4 异常分支：被移除成员原记录复活） */
  async function ensureClubMember(clubId, userId, now = new Date()) {
    const cmd = uniCloud.database().command
    const existed = await clubMembers()
      .where({ club_id: clubId, user_id: userId, deleted: 0 })
      .limit(1)
      .get()
    const row = (existed.data && existed.data[0]) || null
    if (row) {
      // 被移除成员再次录取 → 原记录复活（status: removed → active，更新 joined_at，需求 4.2.4）
      if (row.status !== CLUB_MEMBER_STATUS.ACTIVE) {
        await clubMembers().doc(row._id).update({ status: CLUB_MEMBER_STATUS.ACTIVE, joined_at: now, updated_at: now })
      }
      return row
    }
    const added = await clubMembers().add({
      club_id: clubId,
      user_id: userId,
      role: 'member',
      status: CLUB_MEMBER_STATUS.ACTIVE,
      joined_at: now,
      created_at: now,
      updated_at: now,
      deleted: 0,
    })
    return { _id: added.id }
  }

  /** 校验负责人对该岗位的管理权限，返回 { target, membership } 或错误响应 */
  async function requireRecruitmentManager(recruitmentId, userId) {
    const target = await findRecruitmentById(recruitmentId)
    if (!target) return { error: club.fail(club.ERROR_CODE.NOT_FOUND, '岗位不存在或已删除') }
    const membership = await findManagerMembership(target.club_id, userId)
    if (!membership) return { error: club.fail(club.ERROR_CODE.FORBIDDEN, '你无权操作该社团的招新') }
    return { target, membership }
  }

  // 负责人端：申请人列表（状态筛选 + 分页 + join 用户与报名表）
  api.get('/applicants', club.requireActiveStudent(), async (ctx) => {
    const recruitmentId = String((ctx.query && ctx.query.recruitment_id) || '').trim()
    if (!recruitmentId) return club.fail(club.ERROR_CODE.PARAM_INVALID, '参数 recruitment_id 不能为空')
    const status = String((ctx.query && ctx.query.status) || 'all').trim()
    const page = Number((ctx.query && ctx.query.page) || 1)
    const pageSize = Number((ctx.query && ctx.query.page_size) || MANAGE_PAGE_SIZE)
    if (!Number.isInteger(page) || page < 1) return club.fail(club.ERROR_CODE.PARAM_INVALID, 'page 不合法')
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > ACTIVITY_LIST_PAGE_SIZE_MAX) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, 'page_size 取值不合法')
    }
    if (status !== 'all' && [RECRUITMENT_REG_STATUS.PENDING, RECRUITMENT_REG_STATUS.INTERVIEW, RECRUITMENT_REG_STATUS.ACCEPTED, RECRUITMENT_REG_STATUS.REJECTED].indexOf(status) === -1) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, 'status 取值不合法')
    }

    const checked = await requireRecruitmentManager(recruitmentId, ctx.user._id)
    if (checked.error) return checked.error
    const target = checked.target

    const cmd = uniCloud.database().command
    const where = { recruitment_id: recruitmentId, deleted: 0 }
    if (status !== 'all') where.status = status
    const counted = await recruitmentRegistrations().where(where).count()
    const total = Number((counted && counted.total) || 0)
    const found = await recruitmentRegistrations()
      .where(where)
      .orderBy('applied_at', 'asc')
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .get()
    const rows = found.data || []

    const userIds = [...new Set(rows.map((row) => row.user_id).filter(Boolean))]
    const userMap = new Map()
    if (userIds.length) {
      const userRes = await users().where({ _id: cmd.in(userIds) }).get()
      for (const item of userRes.data || []) userMap.set(item._id, item)
    }

    // 各状态计数（筛选胶囊）
    const statusCount = { all: total, pending: 0, interview: 0, accepted: 0, rejected: 0 }
    const allRows = await recruitmentRegistrations().where({ recruitment_id: recruitmentId, deleted: 0 }).get()
    for (const row of allRows.data || []) {
      if (Object.prototype.hasOwnProperty.call(statusCount, row.status)) statusCount[row.status] += 1
    }

    const list = rows.map((row) => {
      const user = userMap.get(row.user_id) || {}
      return {
        registration_id: row._id,
        user_id: row.user_id,
        name: user.name || '',
        student_no_masked: club.maskStudentNo(user.student_no), // P3-02：服务端脱敏，完整学号不出负责人端
        college: user.college || '',
        major: user.major || '',
        status: row.status,
        form_data: row.form_data || {},
        interview: row.interview || null,
        applied_at: row.applied_at || null,
        accept_at: row.accept_at || null,
      }
    })
    return club.ok({
      list,
      total,
      page,
      page_size: pageSize,
      has_more: (page - 1) * pageSize + list.length < total,
      status_count: statusCount,
      activity: { _id: target._id, title: target.title, club_id: target.club_id, form_fields: target.form_fields || [] },
    })
  })

  // 负责人端：筛选操作（通过=进面试 / 录取 / 淘汰 / 标记面试设置时间地点；批量）
  api.post('/screen', club.requireActiveStudent(), async (ctx) => {
    const err = club.checkParams(ctx.body, {
      recruitment_id: { type: 'string', required: true, maxLen: 64 },
      registration_ids: { type: 'array', required: true },
      action: { type: 'string', required: true, maxLen: 16 },
      interview: { type: 'object' },
    })
    if (err) return err
    const action = String(ctx.body.action).trim()
    if (['approve', 'reject', 'accept', 'interview'].indexOf(action) === -1) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, 'action 取值不合法')
    }
    const ids = (ctx.body.registration_ids || []).filter((id) => String(id).trim()).map((id) => String(id).trim())
    if (!ids.length) return club.fail(club.ERROR_CODE.PARAM_INVALID, '请选择申请人')

    const checked = await requireRecruitmentManager(ctx.body.recruitment_id.trim(), ctx.user._id)
    if (checked.error) return checked.error
    const target = checked.target

    const cmd = uniCloud.database().command
    const rowsRes = await recruitmentRegistrations()
      .where({ _id: cmd.in(ids), recruitment_id: target._id, deleted: 0 })
      .limit(100)
      .get()
    const rows = rowsRes.data || []
    if (rows.length !== ids.length) return club.fail(club.ERROR_CODE.NOT_FOUND, '部分申请人记录不存在')

    const now = new Date()
    const results = []
    for (const row of rows) {
      let next = row.status
      switch (action) {
        case 'approve': {
          // 通过 → 进入面试（需求 4.1.6 主流程 4）；仅 pending 可标记
          if (row.status !== RECRUITMENT_REG_STATUS.PENDING) return club.fail(club.ERROR_CODE.STATUS_INVALID, `「${row.user_id}」当前状态不允许标记面试`)
          next = RECRUITMENT_REG_STATUS.INTERVIEW
          break
        }
        case 'reject': {
          if (row.status === RECRUITMENT_REG_STATUS.ACCEPTED) return club.fail(club.ERROR_CODE.STATUS_INVALID, '已录取者不可淘汰')
          next = RECRUITMENT_REG_STATUS.REJECTED
          break
        }
        case 'accept': {
          if (row.status === RECRUITMENT_REG_STATUS.REJECTED) return club.fail(club.ERROR_CODE.STATUS_INVALID, '已淘汰者不可录取')
          next = RECRUITMENT_REG_STATUS.ACCEPTED
          break
        }
        case 'interview': {
          // 标记面试并设置时间地点（pending → interview，或更新已有 interview）
          if (row.status === RECRUITMENT_REG_STATUS.ACCEPTED || row.status === RECRUITMENT_REG_STATUS.REJECTED) {
            return club.fail(club.ERROR_CODE.STATUS_INVALID, '已录取 / 已淘汰者不可再设面试')
          }
          next = RECRUITMENT_REG_STATUS.INTERVIEW
          break
        }
        default:
          break
      }
      const patch = { status: next, updated_at: now }
      if (action === 'interview' || action === 'approve') {
        // 必须用 cmd.set 整体覆盖：直接写对象时阿里云 SDK 会按点号路径展开子字段，
        // 而文档中 interview 为 null 时 MongoDB 报 `Cannot create field 'xxx' in element {interview: null}`
        // （2026-09-28 云端实测：不带该字段/传 {} 均 200，传含子字段的对象即 500）
        patch.interview = ctx.body.interview ? cmd.set(ctx.body.interview) : null
      }
      if (action === 'accept') {
        patch.accept_at = now
        await ensureClubMember(target.club_id, row.user_id, now)
      }
      if (next !== row.status || action === 'interview') {
        await recruitmentRegistrations().doc(row._id).update(patch)
      }
      results.push({ registration_id: row._id, status: next })
    }

    // 通知（面试安排用 recruitment_interview 场景，与结果通知 recruitment_result 去重键分开；
    // 录取 / 淘汰用 recruitment_result；需求 2.4「招新筛选结果 / 面试安排」）
    let pushed = 0
    const notifiedUsers = new Set()
    for (const row of rows) {
      if (notifiedUsers.has(row.user_id)) continue
      notifiedUsers.add(row.user_id)
      const slot = results.find((r) => r.registration_id === row._id)
      const interview = row.interview
      const interviewText = interview && interview.time ? `｜面试时间：${formatTime(interview.time)}${interview.place ? `，地点：${interview.place}` : ''}` : ''
      const isInterview = slot && (slot.status === RECRUITMENT_REG_STATUS.INTERVIEW)
      const scene = isInterview ? 'recruitment_interview' : 'recruitment_result'
      const resultText = isInterview ? '已进入面试' : { accepted: '已录取', rejected: '已淘汰' }[slot ? slot.status : '']
      const reasonText = slot && slot.status === RECRUITMENT_REG_STATUS.REJECTED ? '。感谢参与' : ''
      const notifyRes = await notify.send({
        userId: row.user_id,
        scene,
        bizId: target._id,
        vars: {
          recruitment_title: target.title,
          recruitment_id: target._id,
          result_text: resultText,
          interview_text: interviewText,
          reason_text: reasonText,
          result: slot ? slot.status : '',
          interview: interviewText,
        },
      })
      if (notifyRes && (notifyRes.channel === 'site' || notifyRes.pushed)) pushed += 1
    }

    return club.ok({ results, pushed })
  })

  // 一键通知（负责人端：对指定申请人批量发送当前状态通知）
  api.post('/notify', club.requireActiveStudent(), async (ctx) => {
    const err = club.checkParams(ctx.body, {
      recruitment_id: { type: 'string', required: true, maxLen: 64 },
      registration_ids: { type: 'array', required: true },
    })
    if (err) return err
    const ids = (ctx.body.registration_ids || []).filter((id) => String(id).trim()).map((id) => String(id).trim())
    if (!ids.length) return club.fail(club.ERROR_CODE.PARAM_INVALID, '请选择申请人')
    const checked = await requireRecruitmentManager(ctx.body.recruitment_id.trim(), ctx.user._id)
    if (checked.error) return checked.error
    const target = checked.target

    const cmd = uniCloud.database().command
    const rowsRes = await recruitmentRegistrations()
      .where({ _id: cmd.in(ids), recruitment_id: target._id, deleted: 0 })
      .limit(100)
      .get()
    const rows = rowsRes.data || []

    let sent = 0
    const seen = new Set()
    for (const row of rows) {
      if (seen.has(row.user_id)) continue
      seen.add(row.user_id)
      const interview = row.interview
      const interviewText = interview && interview.time ? `｜面试时间：${formatTime(interview.time)}${interview.place ? `，地点：${interview.place}` : ''}` : ''
      const isInterview = row.status === RECRUITMENT_REG_STATUS.INTERVIEW
      const scene = isInterview ? 'recruitment_interview' : 'recruitment_result'
      const resultText = isInterview ? '面试安排' : { pending: '筛选结果', accepted: '录取通知', rejected: '筛选结果' }[row.status] || '筛选结果'
      const notifyRes = await notify.send({
        userId: row.user_id,
        scene,
        bizId: target._id,
        vars: {
          recruitment_title: target.title,
          recruitment_id: target._id,
          result_text: resultText,
          interview_text: interviewText,
          reason_text: '',
          result: row.status,
          interview: interviewText,
        },
      })
      if (notifyRes && (notifyRes.channel === 'site' || notifyRes.pushed)) sent += 1
    }
    return club.ok({ sent, total: seen.size })
  })

  // 负责人端：导出 CSV（姓名/学号/学院专业/状态/报名时间；UTF-8 BOM）
  api.get('/export-csv', club.requireActiveStudent(), async (ctx) => {
    const recruitmentId = String((ctx.query && ctx.query.recruitment_id) || '').trim()
    if (!recruitmentId) return club.fail(club.ERROR_CODE.PARAM_INVALID, '参数 recruitment_id 不能为空')
    const checked = await requireRecruitmentManager(recruitmentId, ctx.user._id)
    if (checked.error) return checked.error
    const target = checked.target

    const cmd = uniCloud.database().command
    const rowsRes = await recruitmentRegistrations()
      .where({ recruitment_id: recruitmentId, deleted: 0 })
      .limit(ACTIVITY_LIST_CANDIDATE_MAX)
      .get()
    const rows = rowsRes.data || []
    const userIds = [...new Set(rows.map((row) => row.user_id).filter(Boolean))]
    const userMap = new Map()
    if (userIds.length) {
      const userRes = await users().where({ _id: cmd.in(userIds) }).get()
      for (const item of userRes.data || []) userMap.set(item._id, item)
    }

    const STATUS_LABEL = { pending: '待审核', interview: '面试', accepted: '已录取', rejected: '已淘汰' }
    const pad = (n) => String(n).padStart(2, '0')
    const fmtDT = (value) => {
      if (!value) return ''
      const raw = typeof value === 'object' && value.$date ? value.$date : value
      const date = new Date(raw)
      if (Number.isNaN(date.getTime())) return ''
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    }
    const header = ['姓名', '学号', '学院专业', '状态', '报名时间']
    const lines = [header.join(',')]
    for (const row of rows) {
      const user = userMap.get(row.user_id) || {}
      lines.push([user.name || '', user.student_no || '', [user.college, user.major].filter(Boolean).join(' '), STATUS_LABEL[row.status] || row.status, fmtDT(row.applied_at)].map(csvEscape).join(','))
    }
    function csvEscape(value) {
      const text = String(value == null ? '' : value)
      return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
    }
    const csv = '\uFEFF' + lines.join('\r\n')
    return club.ok({ csv, count: rows.length, recruitment_title: target.title })
  })

  return api.run()
}
