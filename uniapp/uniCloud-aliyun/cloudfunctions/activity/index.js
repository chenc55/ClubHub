/**
 * 活动域云函数（P0-05 骨架 / P1-10 活动创建与状态机 CLB-03①）
 * URL 化前缀 /activity（网关剥离前缀后透传 event.path），路由按相对路径注册
 *
 * P1-10（需求 4.2.2 + 活动状态机 4.4）：
 * - 负责人端 POST /activity/save（创建 / 更新草稿）、POST /activity/submit（提交审核 + 敏感词拦截）
 * - 负责人端 GET /activity/manage（我管理的社团的活动列表）、POST /activity/end（手动提前结束 + 通知）
 * - 定时触发器：approved→signup→ongoing→ended→archived 时间自动流转（阿里云版 timer 事件走 event.type === 'timer' 分支）
 * P1-11 活动审核、P1-12 学生端列表详情（公开 list/detail）、P1-13 报名闭环（register/cancel/promote/my-registrations）、P1-14 签到在此扩展。
 */
'use strict'
const crypto = require('crypto')
const club = require('./lib/club-common')
const notify = require('./lib/notify')
const filter = require('./lib/sensitive-filter')

/** 活动状态机（需求 4.4）：draft → pending → approved → signup → ongoing → ended → archived */
const ACTIVITY_STATUS = { DRAFT: 'draft', PENDING: 'pending', APPROVED: 'approved', SIGNUP: 'signup', ONGOING: 'ongoing', ENDED: 'ended', ARCHIVED: 'archived' }
const CLUB_MEMBER_ROLE = { PRESIDENT: 'president', OFFICER: 'officer' }
const CLUB_MEMBER_STATUS = { ACTIVE: 'active' }
/** 具备活动管理权限的身份（president / officer，需求 4.2.2 前置条件） */
const ACTIVITY_MANAGER_ROLES = [CLUB_MEMBER_ROLE.PRESIDENT, CLUB_MEMBER_ROLE.OFFICER]
/** 手动提前结束时通知的有效报名状态（pending 审核中 / approved 已通过 / waitlist 候补） */
const NOTIFY_REGISTRATION_STATUS = ['pending', 'approved', 'waitlist']
/** 定时触发器：结束后 24h 自动归档 */
const ARCHIVE_DELAY_MS = 24 * 3600 * 1000

const ACTIVITY_TITLE_MIN = 2
const ACTIVITY_TITLE_MAX = 50
const ACTIVITY_CONTENT_MAX = 5000
const ACTIVITY_LOCATION_MAX = 100
const ACTIVITY_CAPACITY_MIN = 1
const ACTIVITY_CAPACITY_MAX = 10000
const ACTIVITY_IMAGE_URL_MAX = 500
/** 签到口令长度上限 */
const SIGNIN_PASSCODE_MAX = 16
const SIGNIN_RADIUS_MIN = 1
const SIGNIN_RADIUS_MAX = 5000
const SIGNIN_TIME_WINDOW_MAX = 1440
/** 签到方式枚举（需求 4.1.4：扫码 / 口令 / 定位） */
const SIGNIN_METHODS = ['qrcode', 'password', 'geofence']
/** 管理端列表每页条数 */
const MANAGE_PAGE_SIZE = 20

/** 管理端活动审核权限：超管 / 审核员（与 2.3 权限矩阵「活动审核」一致） */
const OPS_GUARD = [club.requireAuth(club.TOKEN_TYPES.ADMIN), club.requireRole(['super', 'auditor'])]
const ACTIVITY_REVIEW_ACTION = { APPROVE: 'approve', REJECT: 'reject' }
const ACTIVITY_REASON_MIN = 2
const ACTIVITY_REASON_MAX = 200

/* ============================================================
 * P1-12 学生端列表与详情（STU-04①）
 * ============================================================ */
/** 学生端可见的活动状态（draft / pending 未发布不可见） */
const ACTIVITY_VISIBLE_STATUS = [ACTIVITY_STATUS.APPROVED, ACTIVITY_STATUS.SIGNUP, ACTIVITY_STATUS.ONGOING, ACTIVITY_STATUS.ENDED, ACTIVITY_STATUS.ARCHIVED]
/** 未结束（排序置前）与已结束（沉底）分组 */
const ACTIVITY_UPCOMING_STATUS = [ACTIVITY_STATUS.APPROVED, ACTIVITY_STATUS.SIGNUP, ACTIVITY_STATUS.ONGOING]
const ACTIVITY_FINISHED_STATUS = [ACTIVITY_STATUS.ENDED, ACTIVITY_STATUS.ARCHIVED]
/** 状态筛选参数映射：signup=报名中(待开放+报名中) / ongoing=进行中 / ended=已结束 */
const ACTIVITY_STATUS_FILTER = {
  signup: [ACTIVITY_STATUS.APPROVED, ACTIVITY_STATUS.SIGNUP],
  ongoing: [ACTIVITY_STATUS.ONGOING],
  ended: ACTIVITY_FINISHED_STATUS,
}
/** 有效报名状态（报名进度「已报」口径，cancelled / rejected 不计） */
const VALID_REGISTRATION_STATUS = ['pending', 'approved', 'waitlist']
/** 报名状态机（需求 4.1.3）：pending / approved / waitlist / rejected / cancelled */
const REG_STATUS = { PENDING: 'pending', APPROVED: 'approved', WAITLIST: 'waitlist', REJECTED: 'rejected', CANCELLED: 'cancelled' }
/** 占用名额的状态（approved + pending；waitlist 不占，防超卖） */
const REG_OCCUPY_STATUS = ['approved', 'pending']
/** 我的报名页展示的全部历史状态 */
const REG_HISTORY_STATUS = ['pending', 'approved', 'waitlist', 'rejected', 'cancelled']
/** 动态二维码有效期（防截图代签，每 60 秒自动刷新） */
const SIGNIN_QR_TTL_MS = 60 * 1000
/** 代签 / 补签宽限期（活动进行中 + 结束后 24h 内，需求 4.1.4 异常分支） */
const SIGNIN_MANUAL_GRACE_MS = 24 * 3600 * 1000
const ACTIVITY_LIST_PAGE_SIZE = 20
const ACTIVITY_LIST_PAGE_SIZE_MAX = 50
const ACTIVITY_KEYWORD_MAX = 20
const ACTIVITY_LIST_CANDIDATE_MAX = 2000
/** 我的报名过滤的时间边界（见 loadMyActivityIds 注释） */
const MY_REGISTRATION_LOOKBACK_DAYS = 60

function activities() {
  return uniCloud.database().collection('activities')
}

function clubMembers() {
  return uniCloud.database().collection('club_members')
}

function clubs() {
  return uniCloud.database().collection('clubs')
}

function registrations() {
  return uniCloud.database().collection('activity_registrations')
}

function checkins() {
  return uniCloud.database().collection('checkins')
}

function users() {
  return uniCloud.database().collection('users')
}

function categories() {
  return uniCloud.database().collection('categories')
}

/** 时间统一转毫秒（兼容 Date / 时间戳 / {$date}）；非法返回 0 */
function toTime(value) {
  if (!value) return 0
  const raw = typeof value === 'object' && value.$date ? value.$date : value
  const time = new Date(raw).getTime()
  return Number.isNaN(time) ? 0 : time
}

/** 时间展示（活动通知变量）：YYYY-MM-DD HH:mm */
function formatTime(value) {
  const date = new Date(toTime(value))
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

async function findActivityById(activityId) {
  const cmd = uniCloud.database().command
  const res = await activities().where({ _id: activityId, deleted: cmd.neq(1) }).limit(1).get()
  return (res.data && res.data[0]) || null
}

/** 当前用户在指定社团的有效管理身份（president / officer） */
async function findManagerMembership(clubId, userId) {
  const cmd = uniCloud.database().command
  const res = await clubMembers()
    .where({ club_id: clubId, user_id: userId, status: CLUB_MEMBER_STATUS.ACTIVE, role: cmd.in(ACTIVITY_MANAGER_ROLES) })
    .limit(1)
    .get()
  return (res.data && res.data[0]) || null
}

/** 该用户有管理权限的全部社团 ID */
async function findManagedClubIds(userId) {
  const cmd = uniCloud.database().command
  const res = await clubMembers()
    .where({ user_id: userId, status: CLUB_MEMBER_STATUS.ACTIVE, role: cmd.in(ACTIVITY_MANAGER_ROLES) })
    .get()
  return (res.data || []).map((item) => item.club_id)
}

/** 校验活动业务字段；返回错误响应或 null */
function validateActivityBody(body) {
  const err = club.checkParams(body, {
    club_id: { type: 'string', required: true, maxLen: 64 },
    title: { type: 'string', required: true, maxLen: ACTIVITY_TITLE_MAX },
    content: { type: 'string', required: true, maxLen: ACTIVITY_CONTENT_MAX },
    category_id: { type: 'string', required: true, maxLen: 64 },
    location: { type: 'string', required: true, maxLen: ACTIVITY_LOCATION_MAX },
    start_time: { type: 'number', required: true },
    end_time: { type: 'number', required: true },
    signup_start: { type: 'number', required: true },
    signup_end: { type: 'number', required: true },
    capacity: { type: 'int', required: true },
    need_approval: { type: 'bool', required: true },
    has_waitlist: { type: 'bool', required: true },
    allow_onsite: { type: 'bool', required: true },
    cover: { type: 'string', maxLen: ACTIVITY_IMAGE_URL_MAX },
    signin_config: { type: 'object' },
  })
  if (err) return err

  const title = String(body.title).trim()
  if (title.length < ACTIVITY_TITLE_MIN) {
    return club.fail(club.ERROR_CODE.PARAM_INVALID, `活动标题至少 ${ACTIVITY_TITLE_MIN} 个字`)
  }
  const content = String(body.content).trim()
  if (!content) return club.fail(club.ERROR_CODE.PARAM_INVALID, '请填写活动图文内容')

  const startTime = Number(body.start_time)
  const endTime = Number(body.end_time)
  const signupStart = Number(body.signup_start)
  const signupEnd = Number(body.signup_end)
  if (endTime <= startTime) {
    return club.fail(club.ERROR_CODE.PARAM_INVALID, '活动结束时间需晚于开始时间')
  }
  if (signupStart >= signupEnd) {
    return club.fail(club.ERROR_CODE.PARAM_INVALID, '报名开始时间需早于报名截止时间')
  }
  if (signupEnd > startTime) {
    return club.fail(club.ERROR_CODE.PARAM_INVALID, '报名截止时间需不晚于活动开始时间')
  }
  if (body.capacity < ACTIVITY_CAPACITY_MIN || body.capacity > ACTIVITY_CAPACITY_MAX) {
    return club.fail(club.ERROR_CODE.PARAM_INVALID, `人数上限需在 ${ACTIVITY_CAPACITY_MIN}~${ACTIVITY_CAPACITY_MAX} 之间`)
  }
  return null
}

/** 校验签到配置（P1-14 签到页使用；本轮只校验并快照存储） */
function validateSigninConfig(config) {
  if (!config) return null
  if (typeof config !== 'object' || Array.isArray(config)) {
    return club.fail(club.ERROR_CODE.PARAM_INVALID, '签到配置不合法')
  }
  const methods = Array.isArray(config.methods) ? config.methods : []
  if (!methods.length) {
    return club.fail(club.ERROR_CODE.PARAM_INVALID, '请至少选择一种签到方式')
  }
  for (const method of methods) {
    if (SIGNIN_METHODS.indexOf(method) === -1) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, '签到方式不合法')
    }
  }
  // 口令签到必填口令；定位签到必填半径（与前端校验一致，服务端二次兜底）
  // 字段名与 /checkin 读取口径一致：password / geo（旧名 code / location / passcode 已废弃，见 R-04）
  if (methods.indexOf('password') !== -1 && !String(config.password == null ? '' : config.password).trim()) {
    return club.fail(club.ERROR_CODE.PARAM_INVALID, '口令签到需填写签到口令')
  }
  if (methods.indexOf('geofence') !== -1) {
    const radius = Number((config.geo && config.geo.radius_m) || 0)
    if (!Number.isInteger(radius) || radius < SIGNIN_RADIUS_MIN || radius > SIGNIN_RADIUS_MAX) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, `定位签到需填写半径（${SIGNIN_RADIUS_MIN}~${SIGNIN_RADIUS_MAX} 米）`)
    }
  }
  if (config.password != null && String(config.password).length > SIGNIN_PASSCODE_MAX) {
    return club.fail(club.ERROR_CODE.PARAM_INVALID, `签到口令最多 ${SIGNIN_PASSCODE_MAX} 个字符`)
  }
  if (config.geo != null) {
    const radius = Number((config.geo && config.geo.radius_m) || 0)
    if (!Number.isInteger(radius) || radius < SIGNIN_RADIUS_MIN || radius > SIGNIN_RADIUS_MAX) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, `定位半径需在 ${SIGNIN_RADIUS_MIN}~${SIGNIN_RADIUS_MAX} 米之间`)
    }
  }
  if (config.time_window != null) {
    const start = Number((config.time_window && config.time_window.start_offset_min) || 0)
    const end = Number((config.time_window && config.time_window.end_offset_min) || 0)
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < 0 ||
        start > SIGNIN_TIME_WINDOW_MAX || end > SIGNIN_TIME_WINDOW_MAX) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, '签到时段偏移需在 0~1440 分钟之间')
    }
  }
  return null
}

/** 规范化签到配置（去除多余字段，保证落库结构稳定） */
function normalizeSigninConfig(config) {
  if (!config) return null
  const methods = (Array.isArray(config.methods) ? config.methods : []).filter((m) => SIGNIN_METHODS.indexOf(m) !== -1)
  const normalized = { methods }
  if (methods.indexOf('password') !== -1 && config.password != null) normalized.password = String(config.password)
  if (methods.indexOf('geofence') !== -1 && config.geo != null) {
    const geo = { radius_m: Number(config.geo.radius_m || 0) }
    if (config.geo.lat != null) geo.lat = Number(config.geo.lat)
    if (config.geo.lng != null) geo.lng = Number(config.geo.lng)
    normalized.geo = geo
  }
  if (config.time_window != null) {
    normalized.time_window = {
      start_offset_min: Number(config.time_window.start_offset_min || 0),
      end_offset_min: Number(config.time_window.end_offset_min || 0),
    }
  }
  return normalized
}

/** 活动对外结构（负责人端管理列表 / 编辑回显 / 管理端审核；含社团名 join 与状态） */
function publicManagedActivity(row, clubName, submitter) {
  return {
    _id: row._id,
    club_id: row.club_id || '',
    club_name: clubName || '',
    title: row.title || '',
    content: row.content || '',
    cover: row.cover || '',
    category_id: row.category_id || '',
    start_time: row.start_time || null,
    end_time: row.end_time || null,
    location: row.location || '',
    signup_start: row.signup_start || null,
    signup_end: row.signup_end || null,
    capacity: Number(row.capacity || 0),
    need_approval: !!row.need_approval,
    has_waitlist: !!row.has_waitlist,
    allow_onsite: !!row.allow_onsite,
    signin_config: row.signin_config || null,
    status: row.status,
    submitter_id: row.submitter_id || '',
    submitter_name: submitter ? submitter.name || submitter.nickname || '' : '',
    submitter_auth_status: submitter ? submitter.auth_status : '',
    reject_reason: row.reject_reason || '',
    review_by: row.review_by || '',
    review_at: row.review_at || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  }
}

/* ============================================================
 * P1-12 学生端列表与详情 helper
 * ============================================================ */

/** 按 activity_id 聚合计数有效报名（pending / approved / waitlist；cancelled / rejected 不计） */
async function countRegistrationsByActivityId(activityIds) {
  if (!activityIds.length) return new Map()
  const cmd = uniCloud.database().command
  const db = uniCloud.database()
  const $ = db.command.aggregate
  const res = await db
    .collection('activity_registrations')
    .aggregate()
    .match({ activity_id: cmd.in(activityIds), status: cmd.in(VALID_REGISTRATION_STATUS) })
    .group({ _id: '$activity_id', total: $.sum(1) })
    .end()
  const map = new Map()
  for (const row of (res && res.data) || []) map.set(row._id, Number(row.total) || 0)
  return map
}

/** 从请求头可选解析学生 access token（公开接口内做兼容；无效 / 游客返回 null） */
function optionalStudentFromEvent(event) {
  try {
    const entry = Object.entries(event.headers || {}).find(([name]) => name.toLowerCase() === 'authorization')
    const header = entry && typeof entry[1] === 'string' ? entry[1].trim() : ''
    const match = header.match(/^Bearer\s+(.+)$/i)
    if (!match) return null
    const payload = club.verifyToken(match[1])
    if (!payload) return null
    if (payload.type !== club.TOKEN_TYPES.STUDENT || payload.token_kind !== 'access') return null
    return payload
  } catch (e) {
    return null
  }
}

/** 我的有效报名活动 ID（限近 60 天，避免历史报名无限回查；P1-13 写入后生效） */
async function loadMyActivityIds(userId) {
  const cmd = uniCloud.database().command
  const since = new Date(Date.now() - MY_REGISTRATION_LOOKBACK_DAYS * 24 * 3600 * 1000)
  const res = await registrations()
    .where({ user_id: userId, status: cmd.in(VALID_REGISTRATION_STATUS), created_at: cmd.gte(since) })
    .limit(1000)
    .get()
  return (res.data || []).map((row) => row.activity_id)
}

/** 学生端活动结构（列表卡片 / 详情共用；含报名进度与状态文案字段） */
function publicStudentActivity(row, clubName, regCount) {
  return {
    _id: row._id,
    club_id: row.club_id || '',
    club_name: clubName || '',
    title: row.title || '',
    content: row.content || '',
    cover: row.cover || '',
    start_time: row.start_time || null,
    end_time: row.end_time || null,
    location: row.location || '',
    capacity: Number(row.capacity || 0),
    registered_count: Number(regCount || 0),
    need_approval: !!row.need_approval,
    has_waitlist: !!row.has_waitlist,
    allow_onsite: !!row.allow_onsite,
    status: row.status,
    created_at: row.created_at || null,
  }
}

/** 本地时区「今天 / 本周」时间边界 */
function timeRangeOf(kind) {
  const now = new Date()
  if (kind === 'today') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    return { gte: start, lt: new Date(start.getTime() + 24 * 3600 * 1000) }
  }
  if (kind === 'week') {
    const day = (now.getDay() + 6) % 7 // 周一 = 0
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day)
    return { gte: start, lt: new Date(start.getTime() + 7 * 24 * 3600 * 1000) }
  }
  return null
}

/* ============================================================
 * P1-13 活动报名闭环 helper（需求 4.1.3）
 * ============================================================ */

/** 我的报名记录（按状态集合过滤） */
async function findMyRegistration(activityId, userId, statuses) {
  const cmd = uniCloud.database().command
  const res = await registrations()
    .where({ activity_id: activityId, user_id: userId, status: cmd.in(statuses) })
    .limit(1)
    .get()
  return (res.data && res.data[0]) || null
}

/** 活动当前占用的名额数（approved + pending，waitlist 不占） */
async function countOccupy(activityId) {
  const cmd = uniCloud.database().command
  const res = await registrations()
    .where({ activity_id: activityId, status: cmd.in(REG_OCCUPY_STATUS) })
    .count()
  return Number((res && res.total) || 0)
}

/**
 * 候补递补（需求 4.1.3：释放名额后按 signup_at 升序将首位 waitlist → approved 并通知）
 * 返回转正的记录；无候补返回 null。并发窗口极小（查首位 → 转正），同 P1-06 口径。
 */
async function promoteWaitlist(activityId, now = new Date()) {
  const activityRow = await findActivityById(activityId)
  if (!activityRow) return null
  // 容量闸门（R-05）：占位人数已达上限则不再递补（取消释放名额后 countOccupy 必然 < capacity，
  // 故自动递补不受影响；此判定同时兜住「已超员」的历史数据，避免继续放大 approved > capacity）
  if ((await countOccupy(activityId)) >= Number(activityRow.capacity || 0)) return null
  const found = await registrations()
    .where({ activity_id: activityId, status: REG_STATUS.WAITLIST })
    .orderBy('signup_at', 'asc')
    .limit(1)
    .get()
  const row = (found.data && found.data[0]) || null
  if (!row) return null
  await registrations().doc(row._id).update({ status: REG_STATUS.APPROVED, updated_at: now })
  if (row.user_id) {
    try {
      await notify.send({
        userId: row.user_id,
        scene: 'activity_waitlist_promoted',
        bizId: activityId,
        vars: {
          activity_title: activityRow.title,
          activity_time: formatTime(activityRow.start_time),
          activity_place: activityRow.location,
          activity_id: activityId,
        },
      })
    } catch (e) {
      console.error('[activity/promote] notify failed:', e && e.message)
    }
  }
  return row
}

/** 我的报名行结构（join 活动快照） */
function publicMyRegistration(reg, activityRow, clubName) {
  return {
    registration_id: reg._id,
    activity_id: reg.activity_id,
    status: reg.status,
    remark: reg.remark || '',
    checked_in: !!reg.checked_in,
    signup_at: reg.signup_at || null,
    activity: publicStudentActivity(activityRow || {}, clubName, 0),
  }
}

/* ============================================================
 * P1-15 报名名单与导出 helper（需求 4.2.2 主流程 6 / CLB-03②）
 * ============================================================ */

/** 报名状态中文（导出 CSV 用） */
const REG_STATUS_LABEL = { pending: '待审核', approved: '已报名', waitlist: '候补', rejected: '已驳回', cancelled: '已取消' }

/** CSV 单元格转义（逗号 / 引号 / 换行包裹双引号） */
function csvCell(value) {
  const text = String(value == null ? '' : value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** 加载活动全部报名 + 用户信息 + 签到记录（名单 / 导出共用；上限 2000 行） */
async function loadRegistrationRows(activityId) {
  const cmd = uniCloud.database().command
  const regs = await registrations()
    .where({ activity_id: activityId, deleted: 0 })
    .orderBy('signup_at', 'asc')
    .limit(ACTIVITY_LIST_CANDIDATE_MAX)
    .get()
  const regRows = regs.data || []
  const userIds = regRows.map((row) => row.user_id)
  const userMap = new Map()
  if (userIds.length) {
    const userRes = await users().where({ _id: cmd.in(userIds) }).get()
    for (const item of userRes.data || []) userMap.set(item._id, item)
  }
  const checkinRes = await checkins()
    .where({ activity_id: activityId, deleted: 0 })
    .limit(ACTIVITY_LIST_CANDIDATE_MAX)
    .get()
  const checkinMap = new Map((checkinRes.data || []).map((row) => [row.user_id, row]))
  return { regRows, userMap, checkinMap }
}

/* ============================================================
 * P1-14 签到闭环 helper（需求 4.1.4）
 * ============================================================ */

/** 生成动态二维码 token（60 秒有效） */
function makeQrToken() {
  return crypto.randomBytes(16).toString('hex')
}

/** 签到配置默认值（无配置时按活动起止时段、仅 qrcode） */
function signinConfigOf(activity) {
  const cfg = (activity && activity.signin_config) || {}
  return {
    methods: Array.isArray(cfg.methods) && cfg.methods.length ? cfg.methods : ['qrcode'],
    qr_token: cfg.qr_token || '',
    qr_expires_at: cfg.qr_expires_at || null,
    password: cfg.password || '',
    geo: cfg.geo || null,
    signin_start: cfg.signin_start || (activity && activity.start_time) || null,
    signin_end: cfg.signin_end || (activity && activity.end_time) || null,
  }
}

/** 是否处于签到时段 */
function inSigninWindow(cfg, nowTime) {
  if (!cfg.signin_start && !cfg.signin_end) return true
  if (cfg.signin_start && nowTime < toTime(cfg.signin_start)) return false
  if (cfg.signin_end && nowTime > toTime(cfg.signin_end)) return false
  return true
}

/** Haversine 距离（米） */
function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2)
  return 2 * R * Math.asin(Math.sqrt(a))
}

/** 查询该用户在某活动的签到记录（重复签到拦截用，以第一次为准） */
async function findCheckin(activityId, userId) {
  const cmd = uniCloud.database().command
  const res = await checkins()
    .where({ activity_id: activityId, user_id: userId, deleted: cmd.neq(1) })
    .limit(1)
    .get()
  return (res.data && res.data[0]) || null
}

/** 写入签到记录并更新报名 checked_in（重复签到由 checkins 唯一索引 + 业务预查兜底） */
async function writeCheckin({ activityId, userId, method, operator, now = new Date() }) {
  const record = {
    activity_id: activityId,
    user_id: userId,
    signin_time: now, // 需求 7.3 checkins.signin_time（P1-15 统一为准绳字段）
    signin_method: method,
    operator: operator || null,
    duration: 0, // 时长分钟（预留，需求 4.1.4 主流程 4）
    created_at: now,
    updated_at: now,
    deleted: 0,
  }
  const added = await checkins().add(record)
  await registrations()
    .where({ activity_id: activityId, user_id: userId, status: REG_STATUS.APPROVED, deleted: 0 })
    .limit(1)
    .update({ checked_in: true, updated_at: now })
  return { _id: added.id, ...record }
}

/** 现场补报（allow_onsite，占用剩余名额后签到；需求 4.1.4 异常分支）——容量判定由调用处先行校验 */
async function onsiteRegister(activityId, userId, now = new Date()) {
  const record = {
    activity_id: activityId,
    user_id: userId,
    status: REG_STATUS.APPROVED,
    remark: '现场补报',
    checked_in: false,
    signup_at: now,
    created_at: now,
    updated_at: now,
    deleted: 0,
  }
  const added = await registrations().add(record)
  return { _id: added.id, ...record }
}

/* ============================================================
 * 定时触发器
 * 触发事件形态（2026-09-28 云端实测修正）：
 *   - 阿里云：{ Type: 'Timer', TriggerName: 'TIMER_LATEST', Time, triggerName, triggerTime }
 *     —— **无小写 type 字段**；只判 `event.type === 'timer'` 会让云端定时触发空转
 *     （表现为「有调用日志但状态不流转」）
 *   - 腾讯云 / 支付宝云：{ Type: 'Timer', TriggerName, Time }
 *   - 本地用例模拟：{ type: 'timer', triggerName, payload }
 * 每分钟执行一次，按活动状态机时间自动流转（需求 4.2.2 / 4.4）：
 *   approved → signup（到 signup_start 开放报名）
 *   signup   → ongoing（到 start_time 开签到）
 *   ongoing  → ended（到 end_time 自动结束）
 *   ended    → archived（结束后 24h 自动归档）
 * ============================================================ */
/** 定时触发事件判定：兼容阿里云 / 腾讯云 / 本地模拟三种形态 */
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

async function runTimer(now = new Date()) {
  const cmd = uniCloud.database().command
  const transitions = [
    { from: ACTIVITY_STATUS.APPROVED, to: ACTIVITY_STATUS.SIGNUP, when: { signup_start: cmd.lte(now) } },
    { from: ACTIVITY_STATUS.SIGNUP, to: ACTIVITY_STATUS.ONGOING, when: { start_time: cmd.lte(now) } },
    { from: ACTIVITY_STATUS.ONGOING, to: ACTIVITY_STATUS.ENDED, when: { end_time: cmd.lte(now) } },
    { from: ACTIVITY_STATUS.ENDED, to: ACTIVITY_STATUS.ARCHIVED, when: { end_time: cmd.lte(new Date(toTime(now) - ARCHIVE_DELAY_MS)) } },
  ]
  const stats = { approved: 0, signup: 0, ongoing: 0, ended: 0, archived: 0 }
  for (const item of transitions) {
    const where = { status: item.from, deleted: cmd.neq(1), ...item.when }
    const res = await activities().where(where).limit(100).get()
    const rows = res.data || []
    if (!rows.length) continue
    const ids = rows.map((row) => row._id)
    await activities().where({ _id: cmd.in(ids) }).update({ status: item.to, updated_at: now })
    stats[item.from] = rows.length
  }
  console.log('[activity-timer] transitions:', JSON.stringify(stats))
  return stats
}

exports.main = async (event) => {
  // 定时触发器分支（阿里云 timer 事件无 httpMethod，事件形态见上方 isTimerEvent 注释）
  if (isTimerEvent(event)) {
    try {
      const stats = await runTimer()
      return { code: 0, data: stats }
    } catch (e) {
      console.error('[activity-timer] failed:', e)
      return { code: 500, message: e && e.message }
    }
  }

  const api = club.createRouter(event)

  api.get('/ping', () => club.ok({ pong: 'activity', time: Date.now() }))

  // 负责人端：创建 / 更新活动草稿（保存不触发敏感词；提交审核走 /submit）
  api.post('/save', club.requireActiveStudent(), async (ctx) => {
    const err = validateActivityBody(ctx.body)
    if (err) return err
    const signinErr = validateSigninConfig(ctx.body.signin_config)
    if (signinErr) return signinErr

    const clubId = String(ctx.body.club_id).trim()
    const targetClub = await clubs().where({ _id: clubId, status: 'normal', deleted: 0 }).limit(1).get()
    if (!(targetClub.data && targetClub.data[0])) {
      return club.fail(club.ERROR_CODE.NOT_FOUND, '社团不存在或当前不可发布活动')
    }
    const membership = await findManagerMembership(clubId, ctx.user._id)
    if (!membership) {
      return club.fail(club.ERROR_CODE.FORBIDDEN, '你无权为该社团创建活动（需社长 / 干部身份）')
    }

    const now = new Date()
    const cmd = uniCloud.database().command
    const signinConfig = normalizeSigninConfig(ctx.body.signin_config)
    const patch = {
      title: String(ctx.body.title).trim(),
      content: String(ctx.body.content).trim(),
      cover: String(ctx.body.cover == null ? '' : ctx.body.cover).trim(),
      category_id: String(ctx.body.category_id).trim(),
      start_time: new Date(Number(ctx.body.start_time)),
      end_time: new Date(Number(ctx.body.end_time)),
      location: String(ctx.body.location).trim(),
      signup_start: new Date(Number(ctx.body.signup_start)),
      signup_end: new Date(Number(ctx.body.signup_end)),
      capacity: Number(ctx.body.capacity),
      need_approval: !!ctx.body.need_approval,
      has_waitlist: !!ctx.body.has_waitlist,
      allow_onsite: !!ctx.body.allow_onsite,
      signin_config: signinConfig,
      updated_at: now,
    }

    const activityId = String(ctx.body.activity_id || '').trim()
    if (activityId) {
      // 编辑：仅草稿可编辑（审核 / 已发布等状态不可改）
      const target = await findActivityById(activityId)
      if (!target) return club.fail(club.ERROR_CODE.NOT_FOUND, '活动不存在或已删除')
      if (target.club_id !== clubId) {
        return club.fail(club.ERROR_CODE.FORBIDDEN, '无权编辑该社团的活动')
      }
      if (target.status !== ACTIVITY_STATUS.DRAFT) {
        return club.fail(club.ERROR_CODE.STATUS_INVALID, '仅「草稿」状态的活动可编辑，当前为「' + target.status + '」')
      }
      // 必须用 cmd.set 整体覆盖：直接写对象时阿里云 SDK 会按点号路径展开子字段，
      // 而文档中 signin_config 为 null（创建时未配置签到）时 MongoDB 报
      // `Cannot create field 'methods' in element {signin_config: null}`（同类问题见 recruitment /screen 的 interview）
      const updatePatch =
        signinConfig == null ? { ...patch, signin_config: null } : { ...patch, signin_config: cmd.set(signinConfig) }
      await activities().doc(activityId).update(updatePatch)
      return club.ok({ activity: publicManagedActivity({ ...target, ...patch }, (targetClub.data && targetClub.data[0].name) || ''), updated: true })
    }

    const record = {
      ...patch,
      club_id: clubId,
      status: ACTIVITY_STATUS.DRAFT,
      created_at: now,
      deleted: 0,
    }
    const added = await activities().add(record)
    return club.ok({ activity: publicManagedActivity({ _id: added.id, ...record }, (targetClub.data && targetClub.data[0].name) || ''), updated: false })
  })

  // 负责人端：提交审核（draft → pending；先审后发，敏感词 block / review 一律拦截）
  api.post('/submit', club.requireActiveStudent(), async (ctx) => {
    const err = club.checkParams(ctx.body, { activity_id: { type: 'string', required: true, maxLen: 64 } })
    if (err) return err

    const target = await findActivityById(ctx.body.activity_id.trim())
    if (!target) return club.fail(club.ERROR_CODE.NOT_FOUND, '活动不存在或已删除')
    if (target.status !== ACTIVITY_STATUS.DRAFT) {
      return club.fail(club.ERROR_CODE.STATUS_INVALID, '仅「草稿」状态的活动可提交审核')
    }
    const membership = await findManagerMembership(target.club_id, ctx.user._id)
    if (!membership) {
      return club.fail(club.ERROR_CODE.FORBIDDEN, '你无权提交该社团的活动审核')
    }
    const clubRow = await clubs().where({ _id: target.club_id, deleted: 0 }).limit(1).get()
    if (!(clubRow.data && clubRow.data[0]) || clubRow.data[0].status !== 'normal') {
      return club.fail(club.ERROR_CODE.STATUS_INVALID, '社团当前状态不允许发布活动')
    }

    // 先审后发：命中 block 或 review 级 → 拦截提交，提示修改后重新提交（需求 2.5）
    const result = await filter.checkContent({ title: target.title, body: target.content })
    const decision = filter.decideByMode(filter.PUBLISH_MODES.PRE_REVIEW, result)
    if (!decision.allowed) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, '内容含违规词，请修改后重新提交')
    }

    // 记录发起人（审核结果通知用）并清空驳回留痕（驳回回退 draft 后修改重提，P1-11）
    const now = new Date()
    const patch = {
      status: ACTIVITY_STATUS.PENDING,
      submitter_id: ctx.user._id,
      reject_reason: '',
      review_by: '',
      review_at: null,
      updated_at: now,
    }
    await activities().doc(target._id).update(patch)
    return club.ok({ activity: publicManagedActivity({ ...target, ...patch }) })
  })

  // 负责人端：我管理的社团的活动列表（状态 tab + 分页 + join 社团名）
  api.get('/manage', club.requireAuth(club.TOKEN_TYPES.STUDENT), async (ctx) => {
    const status = String((ctx.query && ctx.query.status) || 'all')
    const page = Number((ctx.query && ctx.query.page) || 1)
    const pageSize = Number((ctx.query && ctx.query.page_size) || MANAGE_PAGE_SIZE)
    if (!Number.isInteger(page) || page < 1) return club.fail(club.ERROR_CODE.PARAM_INVALID, 'page 不合法')
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, 'page_size 需在 1~50 之间')
    }

    // 复合别名：published = 学生可见（approved/signup/ongoing）；finished = 已结束（ended/archived）
    const PUBLISHED_STATUS = [ACTIVITY_STATUS.APPROVED, ACTIVITY_STATUS.SIGNUP, ACTIVITY_STATUS.ONGOING]
    const FINISHED_STATUS = [ACTIVITY_STATUS.ENDED, ACTIVITY_STATUS.ARCHIVED]
    let statusFilter = null
    if (status === 'published') statusFilter = PUBLISHED_STATUS
    else if (status === 'finished') statusFilter = FINISHED_STATUS
    else if (status !== 'all') {
      if (Object.values(ACTIVITY_STATUS).indexOf(status) === -1) {
        return club.fail(club.ERROR_CODE.PARAM_INVALID, 'status 取值不合法')
      }
      statusFilter = [status]
    }

    // 编辑回显：按 activity_id 取单条（限定本人管理的社团；非负责人返回 404）
    const activityId = String((ctx.query && ctx.query.activity_id) || '').trim()
    if (activityId) {
      const clubIds = await findManagedClubIds(ctx.auth.userId)
      const target = await findActivityById(activityId)
      if (!target || clubIds.indexOf(target.club_id) === -1) {
        return club.fail(club.ERROR_CODE.NOT_FOUND, '活动不存在或无权查看')
      }
      const clubRes = await clubs().where({ _id: target.club_id, deleted: 0 }).limit(1).get()
      const clubName = (clubRes.data && clubRes.data[0] && clubRes.data[0].name) || ''
      return club.ok({ list: [publicManagedActivity(target, clubName)], total: 1, page, page_size: pageSize, has_more: false })
    }

    const clubIds = await findManagedClubIds(ctx.auth.userId)
    if (!clubIds.length) return club.ok({ list: [], total: 0, page, page_size: pageSize, has_more: false })

    const cmd = uniCloud.database().command
    const wheres = [{ club_id: cmd.in(clubIds), deleted: cmd.neq(1) }]
    if (statusFilter) wheres.push({ status: cmd.in(statusFilter) })
    const where = wheres.length === 1 ? wheres[0] : cmd.and(wheres)

    const counted = await activities().where(where).count()
    const total = Number((counted && counted.total) || 0)
    const found = await activities()
      .where(where)
      .orderBy('created_at', 'desc')
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .get()
    const rows = found.data || []

    const clubRes = await clubs().where({ _id: cmd.in(clubIds), deleted: 0 }).get()
    const clubNameMap = new Map((clubRes.data || []).map((row) => [row._id, row.name]))

    return club.ok({
      list: rows.map((row) => publicManagedActivity(row, clubNameMap.get(row.club_id))),
      total,
      page,
      page_size: pageSize,
      has_more: (page - 1) * pageSize + rows.length < total,
    })
  })

  // 负责人端：手动提前结束（仅 ongoing → ended），并通知全部已报名用户（需求 4.2.2）
  api.post('/end', club.requireActiveStudent(), async (ctx) => {
    const err = club.checkParams(ctx.body, { activity_id: { type: 'string', required: true, maxLen: 64 } })
    if (err) return err

    const target = await findActivityById(ctx.body.activity_id.trim())
    if (!target) return club.fail(club.ERROR_CODE.NOT_FOUND, '活动不存在或已删除')
    if (target.status !== ACTIVITY_STATUS.ONGOING) {
      return club.fail(club.ERROR_CODE.STATUS_INVALID, '仅「进行中」的活动可提前结束')
    }
    const membership = await findManagerMembership(target.club_id, ctx.user._id)
    if (!membership) {
      return club.fail(club.ERROR_CODE.FORBIDDEN, '你无权结束该社团的活动')
    }

    const now = new Date()
    await activities().doc(target._id).update({ status: ACTIVITY_STATUS.ENDED, updated_at: now })

    // 通知已报名用户（pending / approved / waitlist），去重由 notify 引擎保证
    const cmd = uniCloud.database().command
    const regRes = await registrations()
      .where({ activity_id: target._id, status: cmd.in(NOTIFY_REGISTRATION_STATUS) })
      .limit(500)
      .get()
    const regRows = regRes.data || []
    const notified = []
    for (const row of regRows) {
      if (!row.user_id) continue
      try {
        const pushed = await notify.send({
          userId: row.user_id,
          scene: 'activity_ended',
          bizId: target._id,
          vars: {
            activity_title: target.title,
            activity_time: formatTime(target.start_time),
            activity_place: target.location,
            activity_id: target._id,
          },
        })
        notified.push({ user_id: row.user_id, push_status: (pushed && pushed.push_status) || 'site_only' })
      } catch (e) {
        console.error('[activity/end] notify failed:', e && e.message)
      }
    }

    return club.ok({ activity: publicManagedActivity({ ...target, status: ACTIVITY_STATUS.ENDED }), notified_count: notified.length, notified })
  })

  /* ============================================================
   * P1-12 学生端活动列表与详情（STU-04①；公开只读，游客可浏览——需求 4.1 主流程 2）
   * ============================================================ */

  // 学生端：活动列表（分类 / 时间 / 状态 / 关键词 / 我的报名 + 排序 + 分页）
  api.get('/list', async (ctx) => {
    const raw = ctx.query || {}
    const page = raw.page === undefined || raw.page === '' ? 1 : Number(raw.page)
    const pageSize = raw.page_size === undefined || raw.page_size === '' ? ACTIVITY_LIST_PAGE_SIZE : Number(raw.page_size)
    const categoryId = String(raw.category_id == null ? '' : raw.category_id).trim()
    const timeKind = String(raw.time == null ? '' : raw.time)
    const statusFilter = String(raw.status == null ? '' : raw.status)
    const keyword = String(raw.keyword == null ? '' : raw.keyword).trim()
    const myOnly = raw.my === '1' || raw.my === 'true'

    if (!Number.isInteger(page) || page < 1) return club.fail(club.ERROR_CODE.PARAM_INVALID, 'page 不合法')
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > ACTIVITY_LIST_PAGE_SIZE_MAX) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, `page_size 需在 1~${ACTIVITY_LIST_PAGE_SIZE_MAX} 之间`)
    }
    if (timeKind && ['today', 'week', 'all'].indexOf(timeKind) === -1) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, 'time 取值不合法')
    }
    if (statusFilter && ['signup', 'ongoing', 'ended', 'all'].indexOf(statusFilter) === -1) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, 'status 取值不合法')
    }
    if (keyword.length > ACTIVITY_KEYWORD_MAX) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, `关键词最多 ${ACTIVITY_KEYWORD_MAX} 个字`)
    }

    // 我的报名：需有效学生 token（公开接口内可选解析；无则 401 引导登录）
    let myActivityIds = null
    if (myOnly) {
      const student = optionalStudentFromEvent(ctx.event)
      if (!student) return club.fail(club.ERROR_CODE.UNAUTHORIZED, '请先登录后查看我的报名')
      myActivityIds = await loadMyActivityIds(student.userId)
    }

    const cmd = uniCloud.database().command
    const wheres = [{ status: cmd.in(ACTIVITY_VISIBLE_STATUS), deleted: cmd.neq(1) }]
    if (categoryId) wheres.push({ category_id: categoryId })
    if (timeKind && timeKind !== 'all') {
      const range = timeRangeOf(timeKind)
      if (range) wheres.push(cmd.and([{ start_time: cmd.gte(range.gte) }, { start_time: cmd.lt(range.lt) }]))
    }
    if (statusFilter && statusFilter !== 'all' && ACTIVITY_STATUS_FILTER[statusFilter]) {
      wheres.push({ status: cmd.in(ACTIVITY_STATUS_FILTER[statusFilter]) })
    }
    if (keyword) {
      const reg = new RegExp(club.escapeRegExp(keyword), 'i')
      wheres.push({ title: reg })
    }
    if (myActivityIds !== null) {
      if (!myActivityIds.length) return club.ok({ list: [], total: 0, page, page_size: pageSize, has_more: false })
      wheres.push({ _id: cmd.in(myActivityIds) })
    }
    const where = wheres.length === 1 ? wheres[0] : cmd.and(wheres)

    const found = await activities().where(where).limit(ACTIVITY_LIST_CANDIDATE_MAX).get()
    const rows = found.data || []
    const regMap = await countRegistrationsByActivityId(rows.map((row) => row._id))

    // 排序（需求 2.7）：未结束按 start_time 升序（最近优先），已结束沉底（内部按 start_time 倒序）
    const upcoming = rows.filter((row) => ACTIVITY_UPCOMING_STATUS.indexOf(row.status) !== -1)
    const finished = rows.filter((row) => ACTIVITY_FINISHED_STATUS.indexOf(row.status) !== -1)
    upcoming.sort((a, b) => {
      const ta = toTime(a.start_time)
      const tb = toTime(b.start_time)
      if (ta !== tb) return ta - tb
      return a._id < b._id ? -1 : a._id > b._id ? 1 : 0
    })
    finished.sort((a, b) => {
      const ta = toTime(a.start_time)
      const tb = toTime(b.start_time)
      if (ta !== tb) return tb - ta
      return a._id < b._id ? -1 : a._id > b._id ? 1 : 0
    })
    const ordered = upcoming.concat(finished)

    // join 社团名
    const clubIds = [...new Set(ordered.map((row) => row.club_id).filter(Boolean))]
    const clubNameMap = new Map()
    if (clubIds.length) {
      const clubRes = await clubs().where({ _id: cmd.in(clubIds), deleted: 0 }).get()
      for (const item of clubRes.data || []) clubNameMap.set(item._id, item.name)
    }

    const total = ordered.length
    const start = (page - 1) * pageSize
    const pageItems = ordered.slice(start, start + pageSize)
    return club.ok({
      list: pageItems.map((row) => publicStudentActivity(row, clubNameMap.get(row.club_id), regMap.get(row._id))),
      total,
      page,
      page_size: pageSize,
      has_more: start + pageItems.length < total,
    })
  })

  // 学生端：活动详情（join 主办社团名 + 报名进度；draft / pending 不可见；可选返回我的报名状态）
  api.get('/detail', async (ctx) => {
    const activityId = String((ctx.query && ctx.query.activity_id) || '').trim()
    if (!activityId) return club.fail(club.ERROR_CODE.PARAM_INVALID, '参数 activity_id 不能为空')

    const target = await findActivityById(activityId)
    if (!target || ACTIVITY_VISIBLE_STATUS.indexOf(target.status) === -1) {
      return club.fail(club.ERROR_CODE.NOT_FOUND, '活动不存在或已下架')
    }
    const clubRes = await clubs().where({ _id: target.club_id, deleted: 0 }).limit(1).get()
    const clubName = (clubRes.data && clubRes.data[0] && clubRes.data[0].name) || ''
    const regMap = await countRegistrationsByActivityId([target._id])

    // 可选解析学生 token：返回我的有效报名状态（详情按钮真实多态，P1-13）
    let myRegistration = null
    const student = optionalStudentFromEvent(ctx.event)
    if (student) {
      const mine = await findMyRegistration(activityId, student.userId, VALID_REGISTRATION_STATUS)
      if (mine) myRegistration = { status: mine.status, signup_at: mine.signup_at || null }
    }
    return club.ok({ activity: publicStudentActivity(target, clubName, regMap.get(target._id)), my_registration: myRegistration })
  })

  /* ============================================================
   * P1-13 活动报名闭环（STU-04②；需求 4.1.3）
   * ============================================================ */

  // 学生端：报名（三路径分发：直接报 / 审核 / 候补）
  api.post('/register', club.requireActiveStudent(), async (ctx) => {
    const err = club.checkParams(ctx.body, {
      activity_id: { type: 'string', required: true, maxLen: 64 },
      remark: { type: 'string', maxLen: 200 },
    })
    if (err) return err

    const target = await findActivityById(ctx.body.activity_id.trim())
    if (!target) return club.fail(club.ERROR_CODE.NOT_FOUND, '活动不存在或已删除')
    if (target.status !== ACTIVITY_STATUS.SIGNUP) {
      return club.fail(club.ERROR_CODE.STATUS_INVALID, '活动当前不在报名中（仅报名中可报名）')
    }
    const nowTime = Date.now()
    if (nowTime < toTime(target.signup_start) || nowTime > toTime(target.signup_end)) {
      return club.fail(club.ERROR_CODE.STATUS_INVALID, '当前不在报名时段内')
    }

    const mine = await findMyRegistration(target._id, ctx.user._id, VALID_REGISTRATION_STATUS)
    if (mine) {
      return club.fail(club.ERROR_CODE.STATUS_INVALID, '你已报名该活动，请勿重复报名', { registration: publicMyRegistration(mine, target, '') })
    }

    const occupied = await countOccupy(target._id)
    let status = null
    if (occupied >= Number(target.capacity || 0)) {
      if (target.has_waitlist) status = REG_STATUS.WAITLIST
      else return club.fail(club.ERROR_CODE.STATUS_INVALID, '活动名额已满', { full: true })
    } else {
      status = target.need_approval ? REG_STATUS.PENDING : REG_STATUS.APPROVED
    }

    const now = new Date()
    const record = {
      activity_id: target._id,
      user_id: ctx.user._id,
      status,
      remark: String(ctx.body.remark == null ? '' : ctx.body.remark).trim(),
      checked_in: false,
      signup_at: now,
      created_at: now,
      updated_at: now,
      deleted: 0,
    }
    const added = await registrations().add(record)
    const saved = { _id: added.id, ...record }

    // 报名成功 / 候补 → 订阅消息 + 站内消息（需求 4.1.3 主流程 4）；审核类 pending 等待负责人审核结果通知
    let pushed = null
    if (status === REG_STATUS.APPROVED || status === REG_STATUS.WAITLIST) {
      pushed = await notify.send({
        userId: ctx.user._id,
        scene: status === REG_STATUS.APPROVED ? 'activity_signup_success' : 'activity_signup_waitlist',
        bizId: target._id,
        vars: {
          activity_title: target.title,
          activity_time: formatTime(target.start_time),
          activity_place: target.location,
          activity_id: target._id,
        },
      })
    }

    return club.ok({ registration: publicMyRegistration(saved, target, ''), status, pushed })
  })

  // 学生端：取消报名（截止前；释放名额后自动递补候补并通知）
  api.post('/cancel', club.requireActiveStudent(), async (ctx) => {
    const err = club.checkParams(ctx.body, { activity_id: { type: 'string', required: true, maxLen: 64 } })
    if (err) return err

    const target = await findActivityById(ctx.body.activity_id.trim())
    if (!target) return club.fail(club.ERROR_CODE.NOT_FOUND, '活动不存在或已删除')
    const mine = await findMyRegistration(target._id, ctx.user._id, VALID_REGISTRATION_STATUS)
    if (!mine) return club.fail(club.ERROR_CODE.STATUS_INVALID, '你尚未报名该活动')
    if (toTime(target.signup_end) < Date.now()) {
      return club.fail(club.ERROR_CODE.STATUS_INVALID, '报名已截止，无法取消')
    }

    const wasOccupying = REG_OCCUPY_STATUS.indexOf(mine.status) !== -1
    const now = new Date()
    await registrations().doc(mine._id).update({ status: REG_STATUS.CANCELLED, updated_at: now })

    // 释放名额（approved / pending 占用）且有候补 → 自动递补
    let promoted = null
    if (wasOccupying && target.has_waitlist) {
      promoted = await promoteWaitlist(target._id, now)
    }

    return club.ok({ registration: publicMyRegistration({ ...mine, status: REG_STATUS.CANCELLED }, target, ''), promoted: promoted ? { registration_id: promoted._id } : null })
  })

  // 负责人端：手动候补递补（P1-15 名单页触发；复用内部 promoteWaitlist）
  api.post('/promote', club.requireActiveStudent(), async (ctx) => {
    const err = club.checkParams(ctx.body, { activity_id: { type: 'string', required: true, maxLen: 64 } })
    if (err) return err

    const target = await findActivityById(ctx.body.activity_id.trim())
    if (!target) return club.fail(club.ERROR_CODE.NOT_FOUND, '活动不存在或已删除')
    const membership = await findManagerMembership(target.club_id, ctx.user._id)
    if (!membership) {
      return club.fail(club.ERROR_CODE.FORBIDDEN, '你无权操作该社团的报名')
    }
    if (!target.has_waitlist) {
      return club.fail(club.ERROR_CODE.STATUS_INVALID, '该活动未开启候补，无需递补')
    }
    // 容量闸门（R-05）：满员时明确提示，避免名单页出现「已报名 > 人数上限」
    if ((await countOccupy(target._id)) >= Number(target.capacity || 0)) {
      return club.fail(club.ERROR_CODE.STATUS_INVALID, '活动名额已满，无可递补')
    }
    const promoted = await promoteWaitlist(target._id)
    return club.ok({ promoted: promoted ? { registration_id: promoted._id } : null })
  })

  // P1-15：报名名单（负责人端，全部状态 + 状态/签到筛选 + join 用户 + 统计）
  api.get('/registrations', club.requireActiveStudent(), async (ctx) => {
    const activityId = String((ctx.query && ctx.query.activity_id) || '').trim()
    if (!activityId) return club.fail(club.ERROR_CODE.PARAM_INVALID, '参数 activity_id 不能为空')
    const status = String((ctx.query && ctx.query.status) || 'all').trim()
    const checked = String((ctx.query && ctx.query.checked) || 'all').trim()
    const page = Number((ctx.query && ctx.query.page) || 1)
    const pageSize = Number((ctx.query && ctx.query.page_size) || ACTIVITY_LIST_PAGE_SIZE)
    if (!Number.isInteger(page) || page < 1) return club.fail(club.ERROR_CODE.PARAM_INVALID, 'page 不合法')
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > ACTIVITY_LIST_PAGE_SIZE_MAX) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, 'page_size 取值不合法')
    }
    if (status !== 'all' && REG_HISTORY_STATUS.indexOf(status) === -1) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, 'status 取值不合法')
    }
    if (checked !== 'all' && checked !== 'yes' && checked !== 'no') {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, 'checked 取值不合法')
    }

    const target = await findActivityById(activityId)
    if (!target) return club.fail(club.ERROR_CODE.NOT_FOUND, '活动不存在或已删除')
    const membership = await findManagerMembership(target.club_id, ctx.user._id)
    if (!membership) return club.fail(club.ERROR_CODE.FORBIDDEN, '你无权查看该社团的报名名单')

    const { regRows, userMap, checkinMap } = await loadRegistrationRows(activityId)

    // 状态计数（全量，供筛选胶囊）
    const statusCount = { all: regRows.length, pending: 0, approved: 0, waitlist: 0, rejected: 0, cancelled: 0 }
    for (const row of regRows) {
      if (Object.prototype.hasOwnProperty.call(statusCount, row.status)) statusCount[row.status] += 1
    }
    // 签到统计（报名成功口径，ADM-07：签到率 = 签到人数 / 报名成功人数）
    const approvedRows = regRows.filter((row) => row.status === REG_STATUS.APPROVED)
    const approvedCount = approvedRows.length
    const checkedCount = approvedRows.filter((row) => checkinMap.has(row.user_id)).length
    const signinRate = approvedCount ? Number(((checkedCount / approvedCount) * 100).toFixed(1)) : 0

    let rows = regRows
    if (status !== 'all') rows = rows.filter((row) => row.status === status)
    if (checked === 'yes') rows = rows.filter((row) => checkinMap.has(row.user_id))
    else if (checked === 'no') rows = rows.filter((row) => !checkinMap.has(row.user_id))

    const total = rows.length
    const start = (page - 1) * pageSize
    const pageRows = rows.slice(start, start + pageSize)
    const list = pageRows.map((row) => {
      const user = userMap.get(row.user_id) || {}
      const ck = checkinMap.get(row.user_id) || null
      return {
        registration_id: row._id,
        user_id: row.user_id,
        name: user.name || '',
        student_no_masked: club.maskStudentNo(user.student_no), // P3-02：服务端脱敏，完整学号不出负责人端
        college: user.college || '',
        major: user.major || '',
        status: row.status,
        remark: row.remark || '',
        signup_at: row.signup_at || null,
        checked_in: !!ck,
        signin_time: ck ? ck.signin_time : null,
        signin_method: ck ? ck.signin_method : null,
        attendance: row.attendance || null,
      }
    })
    return club.ok({
      list,
      total,
      page,
      page_size: pageSize,
      has_more: start + list.length < total,
      status_count: statusCount,
      stats: { approved_count: approvedCount, checked_count: checkedCount, unchecked_count: approvedCount - checkedCount, signin_rate: signinRate },
      activity: { _id: target._id, title: target.title, start_time: target.start_time, end_time: target.end_time, location: target.location },
    })
  })

  // P1-15：报名审核（负责人端：pending → approved / rejected + 通知 activity_signup_result）
  api.post('/review-registration', club.requireActiveStudent(), async (ctx) => {
    const err = club.checkParams(ctx.body, {
      activity_id: { type: 'string', required: true, maxLen: 64 },
      registration_id: { type: 'string', required: true, maxLen: 64 },
      action: { type: 'string', required: true, maxLen: 16 },
      reason: { type: 'string', maxLen: 200 },
    })
    if (err) return err
    const action = String(ctx.body.action).trim()
    if (action !== 'approve' && action !== 'reject') {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, 'action 取值不合法')
    }
    if (action === 'reject' && !String(ctx.body.reason == null ? '' : ctx.body.reason).trim()) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, '驳回时请填写理由')
    }

    const target = await findActivityById(ctx.body.activity_id.trim())
    if (!target) return club.fail(club.ERROR_CODE.NOT_FOUND, '活动不存在或已删除')
    const membership = await findManagerMembership(target.club_id, ctx.user._id)
    if (!membership) return club.fail(club.ERROR_CODE.FORBIDDEN, '你无权操作该社团的报名')

    const regRes = await registrations()
      .where({ _id: ctx.body.registration_id.trim(), activity_id: target._id, deleted: 0 })
      .limit(1)
      .get()
    const reg = (regRes.data && regRes.data[0]) || null
    if (!reg) return club.fail(club.ERROR_CODE.NOT_FOUND, '报名记录不存在')
    if (reg.status !== REG_STATUS.PENDING) {
      return club.fail(club.ERROR_CODE.STATUS_INVALID, '仅「待审核」状态的报名可审核')
    }

    const now = new Date()
    const newStatus = action === 'approve' ? REG_STATUS.APPROVED : REG_STATUS.REJECTED
    await registrations().doc(reg._id).update({ status: newStatus, updated_at: now })
    const reason = String(ctx.body.reason == null ? '' : ctx.body.reason).trim()
    const pushed = await notify.send({
      userId: reg.user_id,
      scene: 'activity_signup_result',
      bizId: target._id,
      vars: {
        activity_title: target.title,
        activity_id: target._id,
        result: action === 'approve' ? '通过' : '驳回',
        result_text: action === 'approve' ? '审核通过' : '审核未通过',
        reason: reason || '无',
        reason_text: action === 'reject' ? `（理由：${reason}）` : '',
      },
    })
    return club.ok({ registration_id: reg._id, status: newStatus, pushed })
  })

  // P1-15：缺席标记（负责人端：attendance = present / absent / none 清空）
  api.post('/attendance', club.requireActiveStudent(), async (ctx) => {
    const err = club.checkParams(ctx.body, {
      activity_id: { type: 'string', required: true, maxLen: 64 },
      registration_id: { type: 'string', required: true, maxLen: 64 },
      attendance: { type: 'string', required: true, maxLen: 16 },
    })
    if (err) return err
    const attendance = String(ctx.body.attendance).trim()
    if (attendance !== 'present' && attendance !== 'absent' && attendance !== 'none') {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, 'attendance 取值不合法')
    }

    const target = await findActivityById(ctx.body.activity_id.trim())
    if (!target) return club.fail(club.ERROR_CODE.NOT_FOUND, '活动不存在或已删除')
    const membership = await findManagerMembership(target.club_id, ctx.user._id)
    if (!membership) return club.fail(club.ERROR_CODE.FORBIDDEN, '你无权操作该社团的报名')

    const regRes = await registrations()
      .where({ _id: ctx.body.registration_id.trim(), activity_id: target._id, deleted: 0 })
      .limit(1)
      .get()
    const reg = (regRes.data && regRes.data[0]) || null
    if (!reg) return club.fail(club.ERROR_CODE.NOT_FOUND, '报名记录不存在')
    if (reg.status !== REG_STATUS.APPROVED) {
      return club.fail(club.ERROR_CODE.STATUS_INVALID, '仅报名成功者可标记参加状态')
    }

    const now = new Date()
    const value = attendance === 'none' ? null : attendance
    await registrations().doc(reg._id).update({ attendance: value, updated_at: now })
    return club.ok({ registration_id: reg._id, attendance: value })
  })

  // P1-15：导出 CSV（负责人端；UTF-8 BOM，列：姓名/学号/学院专业/报名状态/报名时间/签到状态/签到时间）
  api.get('/export-csv', club.requireActiveStudent(), async (ctx) => {
    const activityId = String((ctx.query && ctx.query.activity_id) || '').trim()
    if (!activityId) return club.fail(club.ERROR_CODE.PARAM_INVALID, '参数 activity_id 不能为空')
    const target = await findActivityById(activityId)
    if (!target) return club.fail(club.ERROR_CODE.NOT_FOUND, '活动不存在或已删除')
    const membership = await findManagerMembership(target.club_id, ctx.user._id)
    if (!membership) return club.fail(club.ERROR_CODE.FORBIDDEN, '你无权导出该社团的报名名单')

    const { regRows, userMap, checkinMap } = await loadRegistrationRows(activityId)
    const pad = (n) => String(n).padStart(2, '0')
    const fmtDT = (value) => {
      if (!value) return ''
      const raw = typeof value === 'object' && value.$date ? value.$date : value
      const date = new Date(raw)
      if (Number.isNaN(date.getTime())) return ''
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    }

    const header = ['姓名', '学号', '学院专业', '报名状态', '报名时间', '签到状态', '签到时间']
    const lines = [header.map(csvCell).join(',')]
    for (const row of regRows) {
      const user = userMap.get(row.user_id) || {}
      const ck = checkinMap.get(row.user_id) || null
      lines.push(
        [
          user.name || '',
          user.student_no || '',
          [user.college, user.major].filter(Boolean).join(' '),
          REG_STATUS_LABEL[row.status] || row.status,
          fmtDT(row.signup_at),
          ck ? '已签到' : '未签到',
          ck ? fmtDT(ck.signin_time) : '',
        ].map(csvCell).join(',')
      )
    }
    const csv = '\uFEFF' + lines.join('\r\n')
    return club.ok({ csv, count: regRows.length, activity_title: target.title })
  })

  // 学生端：我的报名列表（历史 + 活动快照 + 签到结果 + 可取消标记）
  api.get('/my-registrations', club.requireAuth(club.TOKEN_TYPES.STUDENT), async (ctx) => {
    const page = Number((ctx.query && ctx.query.page) || 1)
    const pageSize = Number((ctx.query && ctx.query.page_size) || ACTIVITY_LIST_PAGE_SIZE)
    if (!Number.isInteger(page) || page < 1) return club.fail(club.ERROR_CODE.PARAM_INVALID, 'page 不合法')
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > ACTIVITY_LIST_PAGE_SIZE_MAX) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, 'page_size 取值不合法')
    }

    const cmd = uniCloud.database().command
    const where = { user_id: ctx.auth.userId, status: cmd.in(REG_HISTORY_STATUS) }
    const counted = await registrations().where(where).count()
    const total = Number((counted && counted.total) || 0)
    const found = await registrations()
      .where(where)
      .orderBy('signup_at', 'desc')
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .get()
    const regs = found.data || []

    const activityIds = [...new Set(regs.map((row) => row.activity_id).filter(Boolean))]
    const actMap = new Map()
    const clubNameMap = new Map()
    if (activityIds.length) {
      const actRes = await activities().where({ _id: cmd.in(activityIds), deleted: cmd.neq(1) }).get()
      for (const item of actRes.data || []) actMap.set(item._id, item)
      const clubIds = [...new Set((actRes.data || []).map((row) => row.club_id).filter(Boolean))]
      if (clubIds.length) {
        const clubRes = await clubs().where({ _id: cmd.in(clubIds), deleted: 0 }).get()
        for (const item of clubRes.data || []) clubNameMap.set(item._id, item.name)
      }
    }

    const nowTime = Date.now()
    const list = regs.map((row) => {
      const act = actMap.get(row.activity_id)
      const item = publicMyRegistration(row, act || {}, clubNameMap.get((act && act.club_id) || ''))
      // 可取消：活动报名中 + 我的报名有效 + 未截止
      item.can_cancel =
        !!act && act.status === ACTIVITY_STATUS.SIGNUP &&
        VALID_REGISTRATION_STATUS.indexOf(row.status) !== -1 &&
        toTime(act.signup_end) >= nowTime
      return item
    })

    return club.ok({
      list,
      total,
      page,
      page_size: pageSize,
      has_more: (page - 1) * pageSize + list.length < total,
    })
  })

  /* ============================================================
   * P1-14 签到闭环（STU-05 + CLB-03③；需求 4.1.4）
   * ============================================================ */

  // 负责人端：签到配置（时段 / 方式 / 口令 / 定位；首次启用 qrcode 即生成动态二维码）
  api.post('/checkin/config', club.requireActiveStudent(), async (ctx) => {
    const err = club.checkParams(ctx.body, {
      activity_id: { type: 'string', required: true, maxLen: 64 },
      methods: { type: 'array', maxLen: 3 },
      password: { type: 'string', maxLen: 12 },
      signin_start: { type: 'any' },
      signin_end: { type: 'any' },
      geo: { type: 'object' },
    })
    if (err) return err

    const target = await findActivityById(ctx.body.activity_id.trim())
    if (!target) return club.fail(club.ERROR_CODE.NOT_FOUND, '活动不存在或已删除')
    const membership = await findManagerMembership(target.club_id, ctx.user._id)
    if (!membership) return club.fail(club.ERROR_CODE.FORBIDDEN, '你无权配置该社团的签到')

    const methods = (ctx.body.methods || []).filter((m) => SIGNIN_METHODS.indexOf(m) !== -1)
    const cfg = Object.assign({}, target.signin_config || {})
    if (methods.length) cfg.methods = methods
    if (ctx.body.password !== undefined) {
      const pw = String(ctx.body.password || '').trim()
      if (pw && (pw.length < 4 || pw.length > 12)) return club.fail(club.ERROR_CODE.PARAM_INVALID, '口令需 4~12 位')
      cfg.password = pw
    }
    if (ctx.body.signin_start !== undefined) cfg.signin_start = ctx.body.signin_start || null
    if (ctx.body.signin_end !== undefined) cfg.signin_end = ctx.body.signin_end || null
    if (ctx.body.geo !== undefined) {
      const geo = ctx.body.geo
      if (geo && (typeof geo.lat !== 'number' || typeof geo.lng !== 'number' || !Number(geo.radius_m))) {
        return club.fail(club.ERROR_CODE.PARAM_INVALID, '定位配置需含 lat / lng / radius_m')
      }
      cfg.geo = geo || null
    }
    // qrcode 启用且无有效 token → 生成
    if (cfg.methods.indexOf('qrcode') !== -1 && (!cfg.qr_expires_at || toTime(cfg.qr_expires_at) < Date.now())) {
      cfg.qr_token = makeQrToken()
      cfg.qr_expires_at = new Date(Date.now() + SIGNIN_QR_TTL_MS)
    }
    // cmd.set：整体覆盖 signin_config（避免现值为 null 时 MongoDB 报 Cannot create field，见 /save 注释）
    await activities().doc(target._id).update({ signin_config: uniCloud.database().command.set(cfg), updated_at: new Date() })

    const refreshed = await findActivityById(target._id)
    return club.ok({ signin_config: signinConfigOf(refreshed) })
  })

  // 负责人端：刷新动态二维码（60 秒自动轮换，防截图代签）
  api.post('/checkin/qr-refresh', club.requireActiveStudent(), async (ctx) => {
    const err = club.checkParams(ctx.body, { activity_id: { type: 'string', required: true, maxLen: 64 } })
    if (err) return err
    const target = await findActivityById(ctx.body.activity_id.trim())
    if (!target) return club.fail(club.ERROR_CODE.NOT_FOUND, '活动不存在或已删除')
    const membership = await findManagerMembership(target.club_id, ctx.user._id)
    if (!membership) return club.fail(club.ERROR_CODE.FORBIDDEN, '你无权操作该社团的签到')

    const cfg = Object.assign({}, target.signin_config || {})
    cfg.qr_token = makeQrToken()
    cfg.qr_expires_at = new Date(Date.now() + SIGNIN_QR_TTL_MS)
    await activities().doc(target._id).update({ signin_config: uniCloud.database().command.set(cfg), updated_at: new Date() })
    // signinConfigOf() 的入参是「活动文档」（内部读 .signin_config），须回读后传入；
    // 直接传裸 cfg 会取到 undefined 而返回默认空配置（qr_token 为空，2026-09-28 云端定位）
    const refreshed = await findActivityById(target._id)
    return club.ok({ signin_config: signinConfigOf(refreshed) })
  })

  // 负责人端：代签 / 补签（活动进行中 + 结束后 24h 内；operator 记录；按 user_id 或学号）
  api.post('/checkin/manual', club.requireActiveStudent(), async (ctx) => {
    const err = club.checkParams(ctx.body, {
      activity_id: { type: 'string', required: true, maxLen: 64 },
      user_id: { type: 'string', maxLen: 64 },
      student_no: { type: 'string', maxLen: 32 },
    })
    if (err) return err
    const target = await findActivityById(ctx.body.activity_id.trim())
    if (!target) return club.fail(club.ERROR_CODE.NOT_FOUND, '活动不存在或已删除')
    const membership = await findManagerMembership(target.club_id, ctx.user._id)
    if (!membership) return club.fail(club.ERROR_CODE.FORBIDDEN, '你无权代签该社团的活动')

    // user_id 或学号二选一
    let userId = String(ctx.body.user_id || '').trim()
    if (!userId && ctx.body.student_no) {
      const userRes = await users().where({ student_no: String(ctx.body.student_no).trim(), deleted: 0 }).limit(1).get()
      const found = (userRes.data && userRes.data[0]) || null
      if (!found) return club.fail(club.ERROR_CODE.NOT_FOUND, '未找到该学号对应的已认证用户')
      userId = found._id
    }
    if (!userId) return club.fail(club.ERROR_CODE.PARAM_INVALID, 'user_id 与 student_no 至少填一项')

    const nowTime = Date.now()
    const endedAt = toTime(target.end_time)
    if (target.status !== ACTIVITY_STATUS.ONGOING && !(target.status === ACTIVITY_STATUS.ENDED && nowTime <= endedAt + SIGNIN_MANUAL_GRACE_MS)) {
      return club.fail(club.ERROR_CODE.STATUS_INVALID, '仅活动进行中或结束后 24 小时内可代签 / 补签')
    }
    const reg = await findMyRegistration(target._id, userId, [REG_STATUS.APPROVED])
    if (!reg) return club.fail(club.ERROR_CODE.STATUS_INVALID, '该用户未报名（或报名未通过）')
    const existing = await findCheckin(target._id, userId)
    if (existing) return club.fail(club.ERROR_CODE.STATUS_INVALID, '该用户已签到（重复代签拦截）')

    const saved = await writeCheckin({ activityId: target._id, userId, method: 'manual', operator: ctx.user._id })
    return club.ok({ checkin: saved })
  })

  // 负责人端：签到名单（已签 / 未签 + 统计 + 分页）
  api.get('/checkin/list', club.requireActiveStudent(), async (ctx) => {
    const activityId = String((ctx.query && ctx.query.activity_id) || '').trim()
    if (!activityId) return club.fail(club.ERROR_CODE.PARAM_INVALID, '参数 activity_id 不能为空')
    const page = Number((ctx.query && ctx.query.page) || 1)
    const pageSize = Number((ctx.query && ctx.query.page_size) || ACTIVITY_LIST_PAGE_SIZE)
    if (!Number.isInteger(page) || page < 1) return club.fail(club.ERROR_CODE.PARAM_INVALID, 'page 不合法')
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > ACTIVITY_LIST_PAGE_SIZE_MAX) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, 'page_size 取值不合法')
    }

    const target = await findActivityById(activityId)
    if (!target) return club.fail(club.ERROR_CODE.NOT_FOUND, '活动不存在或已删除')
    const membership = await findManagerMembership(target.club_id, ctx.user._id)
    if (!membership) return club.fail(club.ERROR_CODE.FORBIDDEN, '你无权查看该社团的签到名单')

    const cmd = uniCloud.database().command
    const regs = await registrations()
      .where({ activity_id: activityId, status: REG_STATUS.APPROVED, deleted: 0 })
      .orderBy('signup_at', 'asc')
      .limit(ACTIVITY_LIST_CANDIDATE_MAX)
      .get()
    const regRows = regs.data || []
    const userIds = regRows.map((row) => row.user_id)
    const userMap = new Map()
    if (userIds.length) {
      const userRes = await users().where({ _id: cmd.in(userIds) }).get()
      for (const item of userRes.data || []) userMap.set(item._id, item)
    }
    const checkinRes = await checkins()
      .where({ activity_id: activityId, deleted: 0 })
      .limit(ACTIVITY_LIST_CANDIDATE_MAX)
      .get()
    const checkinMap = new Map((checkinRes.data || []).map((row) => [row.user_id, row]))

    const total = regRows.length
    const start = (page - 1) * pageSize
    const pageRows = regRows.slice(start, start + pageSize)
    const list = pageRows.map((row) => {
      const user = userMap.get(row.user_id) || {}
      const ck = checkinMap.get(row.user_id) || null
      return {
        registration_id: row._id,
        user_id: row.user_id,
        name: user.name || '',
        student_no_masked: club.maskStudentNo(user.student_no), // P3-02：服务端脱敏
        checked_in: !!ck,
        signin_time: ck ? ck.signin_time : null,
        signin_method: ck ? ck.signin_method : null,
      }
    })
    return club.ok({
      list,
      total,
      checked_count: checkinMap.size,
      unchecked_count: Math.max(0, total - checkinMap.size),
      page,
      page_size: pageSize,
      has_more: start + list.length < total,
    })
  })

  // 学生端：签到（扫码 / 口令 / 定位；未报名且 allow_onsite → 现场补报）
  api.post('/checkin', club.requireActiveStudent(), async (ctx) => {
    const err = club.checkParams(ctx.body, {
      activity_id: { type: 'string', required: 'true', maxLen: 64 },
      method: { type: 'string', required: true, maxLen: 16 },
      code: { type: 'string', maxLen: 64 },
      lat: { type: 'number' },
      lng: { type: 'number' },
    })
    if (err) return err

    const target = await findActivityById(ctx.body.activity_id.trim())
    if (!target) return club.fail(club.ERROR_CODE.NOT_FOUND, '活动不存在或已删除')
    if (target.status !== ACTIVITY_STATUS.ONGOING) {
      return club.fail(club.ERROR_CODE.STATUS_INVALID, '活动不在进行中，无法签到')
    }
    const method = String(ctx.body.method || '')
    const cfg = signinConfigOf(target)
    if (SIGNIN_METHODS.indexOf(method) === -1 || cfg.methods.indexOf(method) === -1) {
      return club.fail(club.ERROR_CODE.STATUS_INVALID, '该签到方式未启用')
    }
    if (!inSigninWindow(cfg, Date.now())) {
      return club.fail(club.ERROR_CODE.STATUS_INVALID, '当前不在签到时段内')
    }

    // 凭证校验
    if (method === 'qrcode') {
      const code = String(ctx.body.code || '').trim()
      if (!code || code !== cfg.qr_token || toTime(cfg.qr_expires_at) < Date.now()) {
        return club.fail(club.ERROR_CODE.STATUS_INVALID, '二维码无效或已过期，请刷新后重试')
      }
    } else if (method === 'password') {
      if (!cfg.password || String(ctx.body.code || '') !== cfg.password) {
        return club.fail(club.ERROR_CODE.STATUS_INVALID, '口令错误，请重试')
      }
    } else if (method === 'geofence') {
      if (!cfg.geo || typeof ctx.body.lat !== 'number' || typeof ctx.body.lng !== 'number') {
        return club.fail(club.ERROR_CODE.STATUS_INVALID, '该活动未配置定位签到')
      }
      const distance = haversineMeters(cfg.geo.lat, cfg.geo.lng, ctx.body.lat, ctx.body.lng)
      if (distance > Number(cfg.geo.radius_m || 0)) {
        return club.fail(club.ERROR_CODE.STATUS_INVALID, '你不在签到范围内（当前距活动地点约 ' + Math.round(distance) + ' 米）')
      }
    }

    // 报名校验：无有效报名 → allow_onsite 现场补报（占用剩余名额）→ 否则拒绝
    let reg = await findMyRegistration(target._id, ctx.user._id, [REG_STATUS.APPROVED])
    if (!reg) {
      if (!target.allow_onsite) {
        return club.fail(club.ERROR_CODE.STATUS_INVALID, '未报名该活动，无法签到')
      }
      const occupied = await countOccupy(target._id)
      if (occupied >= Number(target.capacity || 0)) {
        return club.fail(club.ERROR_CODE.STATUS_INVALID, '现场名额已满，无法补报')
      }
      reg = await onsiteRegister(target._id, ctx.user._id)
    }

    // 重复签到拦截（以第一次为准）
    const existing = await findCheckin(target._id, ctx.user._id)
    if (existing) {
      return club.fail(club.ERROR_CODE.STATUS_INVALID, '你已签到，请勿重复签到', { checkin: existing })
    }

    const saved = await writeCheckin({ activityId: target._id, userId: ctx.user._id, method, operator: null })
    return club.ok({ checkin: saved, onsite: reg.remark === '现场补报' })
  })

  /* ============================================================
   * P1-11 活动审核（ADM-03；管理通道 super / auditor）
   * ============================================================ */

  // 管理端：待审 / 已审列表（分页 + join 社团名与发起人 + 待审徽标）
  api.post('/review-query', ...OPS_GUARD, async (ctx) => {
    const err = club.checkParams(ctx.body, {
      status: { type: 'string', enum: ['pending', 'approved', 'draft', 'all'] },
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

    const counted = await activities().where(where).count()
    const total = Number((counted && counted.total) || 0)
    const found = await activities()
      .where(where)
      .orderBy('created_at', 'desc')
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .get()
    const rows = found.data || []

    // join 社团名与发起人
    const clubIds = [...new Set(rows.map((row) => row.club_id).filter(Boolean))]
    const clubNameMap = new Map()
    if (clubIds.length) {
      const clubRes = await clubs().where({ _id: cmd.in(clubIds), deleted: 0 }).get()
      for (const item of clubRes.data || []) clubNameMap.set(item._id, item.name)
    }
    const submitterIds = [...new Set(rows.map((row) => row.submitter_id).filter(Boolean))]
    const submitterMap = new Map()
    if (submitterIds.length) {
      const userRes = await uniCloud.database().collection('users').where({ _id: cmd.in(submitterIds) }).get()
      for (const item of userRes.data || []) submitterMap.set(item._id, item)
    }
    const pendingCounted = await activities().where({ status: ACTIVITY_STATUS.PENDING, deleted: cmd.neq(1) }).count()

    return club.ok({
      list: rows.map((row) => publicManagedActivity(row, clubNameMap.get(row.club_id), submitterMap.get(row.submitter_id))),
      total,
      pending_total: Number((pendingCounted && pendingCounted.total) || 0),
      page,
      page_size: pageSize,
    })
  })

  // 管理端：通过 / 驳回（通过 → approved 待开放；驳回 → 回退 draft + 必填理由，通知发起人）
  api.post('/review', ...OPS_GUARD, async (ctx) => {
    const err = club.checkParams(ctx.body, {
      activity_id: { type: 'string', required: true, maxLen: 64 },
      action: { type: 'string', required: true, enum: [ACTIVITY_REVIEW_ACTION.APPROVE, ACTIVITY_REVIEW_ACTION.REJECT] },
      reason: { type: 'string', maxLen: ACTIVITY_REASON_MAX },
    })
    if (err) return err

    const target = await findActivityById(ctx.body.activity_id.trim())
    if (!target) return club.fail(club.ERROR_CODE.NOT_FOUND, '活动不存在或已删除')
    if (target.status !== ACTIVITY_STATUS.PENDING) {
      return club.fail(club.ERROR_CODE.STATUS_INVALID, '该活动当前状态不允许审核（仅待审可操作）')
    }

    const approving = ctx.body.action === ACTIVITY_REVIEW_ACTION.APPROVE
    const reason = String(ctx.body.reason || '').trim()
    if (!approving && reason.length < ACTIVITY_REASON_MIN) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, `请填写驳回理由（至少 ${ACTIVITY_REASON_MIN} 个字）`)
    }

    const reviewedAt = new Date()
    const reviewer = ctx.auth.username
    const nextStatus = approving ? ACTIVITY_STATUS.APPROVED : ACTIVITY_STATUS.DRAFT
    const patch = {
      status: nextStatus,
      reject_reason: approving ? '' : reason,
      review_by: reviewer,
      review_at: reviewedAt,
      updated_at: reviewedAt,
    }
    await activities().doc(target._id).update(patch)

    // 通知发起人（submitter_id；多负责人社团由实际提交审核者接收，需求 4.3.2）
    let pushed = null
    if (target.submitter_id) {
      const resultText = approving ? '已通过' : '未通过'
      const reasonText = reason ? `理由：${reason}` : ''
      pushed = await notify.send({
        userId: target.submitter_id,
        scene: 'club_activity_review',
        bizId: target._id,
        vars: {
          activity_title: target.title,
          result_text: resultText,
          reason_text: reasonText,
          result: resultText,
          reason: reason,
          activity_id: target._id,
        },
      })
    }

    const dict = { _id: target._id, ...target, ...patch }
    return club.ok({
      activity: publicManagedActivity(dict),
      notify: pushed,
    })
  })

  return api.run()
}
