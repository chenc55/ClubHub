/**
 * 社团域云函数（P0-05 骨架 / P1-06 社团入驻双轨 / P0-05 URL 化前缀 /club）
 * URL 化前缀 /club（网关剥离前缀后透传 event.path），路由按相对路径注册
 *
 * P1-06（需求 4.2.1 + ADM-02①）：
 * - 分类字典 GET /categories（公开，供入驻表单与导入模板）
 * - 学生端入驻申请 POST /apply、进度 GET /apply/current（写通道 requireActiveStudent）
 * - 管理端社团列表 POST /list、审核 POST /review、批量导入 POST /import（管理通道 + super/auditor）
 * P1-07（需求 4.3.2 ADM-02②）：
 * - 分类维护 POST /category/save、POST /category/delete、POST /category/sort、GET /category/list
 * - 星级评定 POST /star（1~5 星，0 = 取消评定）
 * - 封禁 / 停用 POST /ban（normal ⇄ banned，供 P1-26 内容监管联动）
 * P1-08（STU-03）：学生端公开只读 GET /list（分类 / 星级 / 关键词 / 综合-最新排序 + 分页）、GET /detail（含成员数 / 活动数与最近活动）
 * P1-09（CLB-01）：负责人端 GET /my-clubs（我管理的社团）、POST /update（编辑资料，仅社长）
 * P1-19（CLB-05）：成员管理 GET /members（列表，社长 / 干部可看）、POST /members/role（设 / 撤干部）、
 *                  POST /members/remove（移除成员）——写操作仅社长，移除置 status = removed
 * P1-20（CLB-03④ / CLB-04③）：GET /stats（社团统计：活动发布/报名/签到率 + 招新岗位/报名/录取 + 成员概览，range 过滤）
 * P1-24（STU-08）：GET /memberships（学生端我的社团：全部 active 成员关系含 member，removed 同步消失）
 * P2-01（CLB-02 + ADM-05 动态部分）：社团动态先发后审
 *   - POST /posts/save  负责人发布（正文 + ≤9 图；POST_REVIEW：block 拦截 / review 放行置 flagged 进监管疑似队列）
 *   - GET  /posts/my    我的动态列表（按 author_id 过滤，负责人）
 *   - GET  /posts/list  学生端社团动态流（published 且未删，社团详情「动态 / 风采」Tab 数据源）
 */
'use strict'
const club = require('./lib/club-common')
const notify = require('./lib/notify')
const filter = require('./lib/sensitive-filter')

/** 社团状态机（需求 4.4）：pending → normal → banned；驳回分支 pending ⇄ rejected */
const CLUB_STATUS = { PENDING: 'pending', NORMAL: 'normal', REJECTED: 'rejected', BANNED: 'banned' }
const CLUB_CREATE_TYPE = { APPLIED: 'applied', IMPORTED: 'imported' }
const CLUB_ACTION = { APPROVE: 'approve', REJECT: 'reject' }
const CLUB_MEMBER_ROLE = { PRESIDENT: 'president', OFFICER: 'officer', MEMBER: 'member' }
const CLUB_MEMBER_STATUS = { ACTIVE: 'active', REMOVED: 'removed' }
/** 具备社团管理身份的角色（干部可进管理视图，资料编辑另限社长——需求 2.3） */
const CLUB_MANAGER_ROLES = [CLUB_MEMBER_ROLE.PRESIDENT, CLUB_MEMBER_ROLE.OFFICER]

const CLUB_NAME_MAX = 30
const CLUB_NAME_MIN = 2
const CLUB_INTRO_MAX = 500
const CLUB_CONTACT_MAX = 50
const CLUB_REASON_MAX = 200
const CLUB_REASON_MIN = 2
/** 批量导入上限（社团数量远小于学生规模，参考白名单导入的分块方案） */
const CLUB_IMPORT_MAX_ROWS = 2000
const CLUB_IMPORT_MAX_CHUNK = 500

/** P1-07 分类维护与星级评定 / 封禁（ADM-02②） */
const CATEGORY_NAME_MIN = 2
const CATEGORY_NAME_MAX = 10
const CATEGORY_SORT_DIRECTION = { UP: 'up', DOWN: 'down' }
/** 星级区间：1~5 为评定，0 = 取消评定（未评定） */
const CLUB_STAR_MIN = 0
const CLUB_STAR_MAX = 5
const CLUB_BAN_ACTION = { BAN: 'ban', UNBAN: 'unban' }

/** P1-08 学生端列表与详情（STU-03） */
const CLUB_LIST_SORT = { COMPREHENSIVE: 'comprehensive', LATEST: 'latest' }
const CLUB_LIST_PAGE_SIZE = 20
const CLUB_LIST_PAGE_SIZE_MAX = 50
/** P1-19 成员管理（CLB-05）：成员列表分页与角色排序权重（社长 > 干部 > 成员） */
const CLUB_MEMBER_PAGE_SIZE = 20
const CLUB_MEMBER_PAGE_SIZE_MAX = 50
const CLUB_MEMBER_ROLE_ORDER = { president: 0, officer: 1, member: 2 }
const CLUB_KEYWORD_MAX = 20
/** 综合排序权重：星级 × 系数 + 成员数（1 星 ≈ 20 名成员，见需求 2.7） */
const CLUB_SCORE_STAR_WEIGHT = 20
/**
 * 候选集上限：综合排序需在内存中按「星级 + 成员数」加权排序后分页，
 * 故一次性取回全部候选；单校社团规模远小于该值（百团大战约 100 个），
 * 与批量导入上限 2000 行保持同一量级。
 */
const CLUB_LIST_CANDIDATE_MAX = 2000
/** 卡片「新入驻」派生标签的时间窗（天） */
const CLUB_NEW_DAYS = 30
const CLUB_DETAIL_ACTIVITY_LIMIT = 5
/** 学生端可见的活动状态（排除 draft / pending 未发布活动） */
const ACTIVITY_PUBLISHED_STATUS = ['approved', 'signup', 'ongoing', 'ended', 'archived']
const ACTIVITY_UPCOMING_STATUS = ['approved', 'signup', 'ongoing']
const ACTIVITY_ENDED_STATUS = ['ended', 'archived']

/** P1-20 统计（CLB-03④ / CLB-04③）：时间范围档位 / 活动全部状态 / 有效报名与录取口径 */
const STATS_RANGE = { ALL: 'all', D7: '7d', D30: '30d' }
const STATS_DAYS = { [STATS_RANGE.D7]: 7, [STATS_RANGE.D30]: 30 }
const ACTIVITY_ALL_STATUS = ['draft', 'pending', 'approved', 'signup', 'ongoing', 'ended', 'archived']
/** 有效报名口径（对齐 ADM-07：签到率 = 签到人数 / 报名成功人数，报名数取 approved） */
const REG_STATUS_APPROVED = 'approved'
/** 招新录取态 */
const RECRUITMENT_REG_ACCEPTED = 'accepted'
/** 统计一次性取回的候选上限（对齐名单 / 导出的 2000 量级） */
const STATS_CANDIDATE_MAX = 2000

/** P1-09 社团资料管理（CLB-01）：Logo / 封面为云存储 URL，限制长度防超长入库 */
const CLUB_IMAGE_URL_MAX = 500

/** 管理端社团运营权限：超管 / 审核员（与 2.3 权限矩阵「社团审核」一致） */
const OPS_GUARD = [club.requireAuth(club.TOKEN_TYPES.ADMIN), club.requireRole(['super', 'auditor'])]

function clubs() {
  return uniCloud.database().collection('clubs')
}

function categories() {
  return uniCloud.database().collection('categories')
}

function clubMembers() {
  return uniCloud.database().collection('club_members')
}

function users() {
  return uniCloud.database().collection('users')
}

function activities() {
  return uniCloud.database().collection('activities')
}

/** P1-20 统计（CLB-03④ / CLB-04③）：活动报名 / 招新 / 招新报名 / 签到集合 */
function activityRegistrations() {
  return uniCloud.database().collection('activity_registrations')
}

function recruitments() {
  return uniCloud.database().collection('recruitments')
}

function recruitmentRegistrations() {
  return uniCloud.database().collection('recruitment_registrations')
}

function checkins() {
  return uniCloud.database().collection('checkins')
}

/** 按 club_id 聚合分组计数：一次取回全部候选社团的计数，避免逐社团 count 造成 N 次查询 */
async function countByClubId(collectionName, match) {
  const db = uniCloud.database()
  const $ = db.command.aggregate
  const res = await db
    .collection(collectionName)
    .aggregate()
    .match(match)
    .group({ _id: '$club_id', total: $.sum(1) })
    .end()
  const map = new Map()
  for (const row of (res && res.data) || []) map.set(row._id, Number(row.total) || 0)
  return map
}

/**
 * 候选社团的成员数 / 活动数（成员数取 active 成员；活动数排除 draft / pending 未发布活动）
 * 注意：软删判断统一用 `deleted != 1` 而非 `deleted = 0` —— P1-06 建立的 club_members 记录未写 deleted 字段，
 * 用等值匹配会把历史成员全部漏掉（成员数恒为 0）；`neq(1)` 同时兼容「缺字段」与「显式软删」两种数据。
 */
async function loadClubCounters(clubIds) {
  if (!clubIds.length) return { memberMap: new Map(), activityMap: new Map() }
  const cmd = uniCloud.database().command
  const memberMap = await countByClubId('club_members', {
    club_id: cmd.in(clubIds),
    status: CLUB_MEMBER_STATUS.ACTIVE,
    deleted: cmd.neq(1),
  })
  const activityMap = await countByClubId('activities', {
    club_id: cmd.in(clubIds),
    status: cmd.in(ACTIVITY_PUBLISHED_STATUS),
    deleted: cmd.neq(1),
  })
  return { memberMap, activityMap }
}

/** 时间字段统一转毫秒（兼容 Date / 时间戳 / {$date} 结构）；非法返回 0 */
function toTime(value) {
  if (!value) return 0
  const raw = typeof value === 'object' && value.$date ? value.$date : value
  const time = new Date(raw).getTime()
  return Number.isNaN(time) ? 0 : time
}

/** 「最新」排序：入驻时间倒序；同时间以 _id 兜底，保证分页稳定 */
function compareLatest(a, b) {
  const ta = toTime(a.created_at)
  const tb = toTime(b.created_at)
  if (ta !== tb) return tb - ta
  if (a._id === b._id) return 0
  return a._id < b._id ? -1 : 1
}

/**
 * 学生端社团卡（P1-08）
 * 特色标签为**派生展示**，不新增数据库字段：分类名 / 星级 / 新入驻（30 天内）/ 活跃（有已发布活动）
 */
function publicClubCard(row, categoryName, memberCount, activityCount) {
  const starLevel = Number(row.star_level || 0)
  const members = Number(memberCount || 0)
  const activityTotal = Number(activityCount || 0)
  const createdAt = toTime(row.created_at)
  const tags = []
  if (categoryName) tags.push(categoryName)
  if (starLevel > 0) tags.push(`${starLevel} 星社团`)
  if (createdAt && Date.now() - createdAt <= CLUB_NEW_DAYS * 24 * 3600 * 1000) tags.push('新入驻')
  if (activityTotal > 0) tags.push('活跃')
  return {
    _id: row._id,
    name: row.name || '',
    intro: row.intro || '',
    logo: row.logo || '',
    cover: row.cover || '',
    contact: row.contact || '',
    category_id: row.category_id || '',
    category_name: categoryName || '',
    star_level: starLevel,
    member_count: members,
    activity_count: activityTotal,
    tags,
    created_at: row.created_at || null,
  }
}

/**
 * 负责人端社团结构：学生卡片字段 + status
 * 管理主页需据此展示「已封禁」并禁用操作；学生端 /list、/detail 仅返回 normal 社团，故不暴露 status
 */
function publicManagedClub(row, categoryName, memberCount, activityCount) {
  return { ...publicClubCard(row, categoryName, memberCount, activityCount), status: row.status }
}

/** 社团详情页活动区块：优先取未结束活动（开始时间升序，对齐需求 2.7「最近优先」），不足再补最近已结束 */
async function loadClubActivities(clubId) {
  const cmd = uniCloud.database().command
  const list = []
  const upcomingRes = await activities()
    .where({ club_id: clubId, status: cmd.in(ACTIVITY_UPCOMING_STATUS), deleted: 0 })
    .orderBy('start_time', 'asc')
    .limit(CLUB_DETAIL_ACTIVITY_LIMIT)
    .get()
  for (const item of upcomingRes.data || []) list.push(item)

  if (list.length < CLUB_DETAIL_ACTIVITY_LIMIT) {
    const endedRes = await activities()
      .where({ club_id: clubId, status: cmd.in(ACTIVITY_ENDED_STATUS), deleted: 0 })
      .orderBy('start_time', 'desc')
      .limit(CLUB_DETAIL_ACTIVITY_LIMIT - list.length)
      .get()
    for (const item of endedRes.data || []) list.push(item)
  }

  return list.map((item) => ({
    _id: item._id,
    title: item.title || '',
    cover: item.cover || '',
    location: item.location || '',
    start_time: item.start_time || null,
    end_time: item.end_time || null,
    status: item.status,
  }))
}

/** 分类列表（未软删，按 sort 升序）——分类字典与分类维护共用同一查询口径 */
async function listCategories() {
  const res = await categories().where({ deleted: 0 }).orderBy('sort', 'asc').get()
  return res.data || []
}

/** 分类字典（名 → _id 与 _id → 名），供表单校验、列表展示与导入解析 */
async function loadCategoryDict() {
  const list = await listCategories()
  const byId = new Map()
  const byName = new Map()
  list.forEach((item) => {
    byId.set(item._id, item.name)
    byName.set(item.name, item._id)
  })
  return { list, byId, byName }
}

/** 分类下未软删社团数（分类删除保护的判定依据，含待审/驳回/封禁社团） */
async function countClubsOfCategory(categoryId) {
  const res = await clubs().where({ category_id: categoryId, deleted: 0 }).count()
  return Number((res && res.total) || 0)
}

function publicClub(row, categoryName, applicant) {
  return {
    _id: row._id,
    name: row.name || '',
    intro: row.intro || '',
    logo: row.logo || '',
    cover: row.cover || '',
    contact: row.contact || '',
    category_id: row.category_id || '',
    category_name: categoryName || '',
    star_level: Number(row.star_level || 0),
    status: row.status,
    create_type: row.create_type,
    applicant_id: row.applicant_id || '',
    applicant_name: applicant ? applicant.name || applicant.nickname || '' : '',
    reject_reason: row.reject_reason || '',
    review_by: row.review_by || '',
    review_at: row.review_at || null,
    batch_no: row.batch_no || '',
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  }
}

async function findClubById(clubId) {
  const res = await clubs().where({ _id: clubId, deleted: 0 }).limit(1).get()
  return (res.data && res.data[0]) || null
}

/** 分类对外结构（club_count 供删除保护提示与管理端展示） */
function publicCategory(row, clubCount) {
  return {
    _id: row._id,
    name: row.name || '',
    sort: Number(row.sort || 0),
    club_count: Number(clubCount || 0),
  }
}

async function findCategoryById(categoryId) {
  const res = await categories().where({ _id: categoryId, deleted: 0 }).limit(1).get()
  return (res.data && res.data[0]) || null
}

/** 按给定顺序重排 sort（1..n，仅写有变化的行；顺带修复历史重复 sort 值） */
async function applyCategoryOrder(ordered) {
  const tasks = []
  ordered.forEach((item, i) => {
    const next = i + 1
    if (Number(item.sort) !== next) tasks.push(categories().doc(item._id).update({ sort: next }))
  })
  if (tasks.length) await Promise.all(tasks)
}

/** 分类列表 + 各分类社团数（管理端分类维护抽屉与删除保护共用） */
async function listCategoriesWithCount() {
  const list = await listCategories()
  const counts = await Promise.all(list.map((item) => countClubsOfCategory(item._id)))
  return list.map((item, i) => publicCategory(item, counts[i]))
}

/** 社团名是否已被占用（clubs.name 唯一索引；此处预查以给出友好提示） */
async function findClubByName(name, exceptId) {
  const res = await clubs().where({ name, deleted: 0 }).limit(1).get()
  const found = (res.data && res.data[0]) || null
  if (!found) return null
  if (exceptId && found._id === exceptId) return null
  return found
}

/**
 * 当前用户在指定社团的有效成员记录（status = active）
 * 说明：club_members 的软删语义由 P1-19 成员管理统一维护，此处与 P1-06 建记录口径一致，不额外过滤 deleted
 */
async function findMembership(clubId, userId) {
  const res = await clubMembers()
    .where({ club_id: clubId, user_id: userId, status: CLUB_MEMBER_STATUS.ACTIVE })
    .limit(1)
    .get()
  return (res.data && res.data[0]) || null
}

/** 学号脱敏（保留前 4 后 2，中间打码；需求 4.2.4 成员列表仅展示脱敏学号，完整学号不出服务端） */
function maskStudentNo(studentNo) {
  const value = String(studentNo || '')
  if (!value) return ''
  if (value.length <= 6) return '*'.repeat(value.length)
  return `${value.slice(0, 4)}${'*'.repeat(value.length - 6)}${value.slice(-2)}`
}

/** 社团成员对外结构（join users 的姓名 / 头像与脱敏学号；P1-19） */
function publicMember(row, user) {
  return {
    user_id: row.user_id,
    role: row.role || CLUB_MEMBER_ROLE.MEMBER,
    joined_at: row.joined_at || null,
    name: (user && (user.name || user.nickname)) || '',
    student_no_masked: user ? maskStudentNo(user.student_no) : '',
    avatar: (user && user.avatar) || '',
  }
}

/** 社团 active 成员的角色计数（列表与操作回执共用；软删口径 deleted != 1） */
async function loadRoleCount(clubId) {
  const cmd = uniCloud.database().command
  const res = await clubMembers()
    .where({ club_id: clubId, status: CLUB_MEMBER_STATUS.ACTIVE, deleted: cmd.neq(1) })
    .field({ role: true })
    .get()
  const roleCount = { total: 0, president: 0, officer: 0, member: 0 }
  for (const row of res.data || []) {
    roleCount.total += 1
    roleCount[row.role === CLUB_MEMBER_ROLE.PRESIDENT ? 'president' : row.role === CLUB_MEMBER_ROLE.OFFICER ? 'officer' : 'member'] += 1
  }
  return roleCount
}

/** 该用户最近一条入驻申请（applied） */
async function findLatestApply(userId) {
  const res = await clubs()
    .where({ applicant_id: userId, create_type: CLUB_CREATE_TYPE.APPLIED, deleted: 0 })
    .orderBy('created_at', 'desc')
    .limit(1)
    .get()
  return (res.data && res.data[0]) || null
}

exports.main = async (event) => {
  const api = club.createRouter(event)

  api.get('/ping', () => club.ok({ pong: 'club', time: Date.now() }))

  // 学生 token 通道示例
  api.get('/me-example', club.requireAuth(club.TOKEN_TYPES.STUDENT), (ctx) =>
    club.ok({ channel: 'club', auth: ctx.auth })
  )

  // 分类字典（公开）：入驻申请表单下拉 + 导入模板分类校验
  api.get('/categories', async () => {
    const dict = await loadCategoryDict()
    return club.ok({ list: dict.list.map((item) => ({ _id: item._id, name: item.name, sort: item.sort })) })
  })

  // 学生端：提交 / 重新提交入驻申请（需求 4.2.1 主流程 1 与异常分支「修改后重提」）
  api.post('/apply', club.requireActiveStudent(), async (ctx) => {
    const err = club.checkParams(ctx.body, {
      name: { type: 'string', required: true, maxLen: CLUB_NAME_MAX },
      intro: { type: 'string', required: true, maxLen: CLUB_INTRO_MAX },
      category_id: { type: 'string', required: true, maxLen: 64 },
      contact: { type: 'string', required: true, maxLen: CLUB_CONTACT_MAX },
    })
    if (err) return err

    const name = ctx.body.name.trim()
    const intro = ctx.body.intro.trim()
    const contact = ctx.body.contact.trim()
    if (name.length < CLUB_NAME_MIN) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, `社团名称至少 ${CLUB_NAME_MIN} 个字`)
    }
    if (!intro) return club.fail(club.ERROR_CODE.PARAM_INVALID, '请填写社团简介')
    if (!contact) return club.fail(club.ERROR_CODE.PARAM_INVALID, '请填写联系方式')

    const dict = await loadCategoryDict()
    if (!dict.byId.has(ctx.body.category_id)) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, '所选分类不存在，请刷新后重试')
    }

    const user = ctx.user
    const latest = await findLatestApply(user._id)
    // 已有进行中申请 → 不允许重复提交（需求：名称重复拦截 + 同一时间仅一条申请）
    if (latest && latest.status === CLUB_STATUS.PENDING) {
      return club.fail(club.ERROR_CODE.STATUS_INVALID, '已有进行中的入驻申请，请等待审核结果', {
        club: publicClub(latest, dict.byId.get(latest.category_id)),
      })
    }
    // 名称重复拦截（排除自身驳回记录，允许同名重提）
    const occupied = await findClubByName(name, latest && latest.status === CLUB_STATUS.REJECTED ? latest._id : '')
    if (occupied) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, '该社团名称已被使用，请更换名称后重试')
    }

    const patch = {
      name,
      intro,
      category_id: ctx.body.category_id,
      contact,
      status: CLUB_STATUS.PENDING,
      create_type: CLUB_CREATE_TYPE.APPLIED,
      applicant_id: user._id,
      reject_reason: '',
      review_by: '',
      review_at: null,
      updated_at: new Date(),
    }

    // 驳回后重提：复用原记录（状态回到 pending），保持 ID 稳定
    if (latest && latest.status === CLUB_STATUS.REJECTED) {
      try {
        await clubs().doc(latest._id).update(patch)
      } catch (e) {
        return club.fail(club.ERROR_CODE.PARAM_INVALID, '该社团名称已被使用，请更换名称后重试')
      }
      return club.ok({ club: publicClub({ ...latest, ...patch }, dict.byId.get(patch.category_id)), resubmitted: true })
    }

    const record = { ...patch, star_level: 0, batch_no: '', created_at: new Date(), deleted: 0 }
    try {
      const added = await clubs().add(record)
      return club.ok({ club: publicClub({ _id: added.id, ...record }, dict.byId.get(patch.category_id)), resubmitted: false })
    } catch (e) {
      // clubs.name 唯一索引兜底
      return club.fail(club.ERROR_CODE.PARAM_INVALID, '该社团名称已被使用，请更换名称后重试')
    }
  })

  // 学生端：我的入驻申请进度（含驳回理由，供修改重提）
  api.get('/apply/current', club.requireAuth(club.TOKEN_TYPES.STUDENT), async (ctx) => {
    const userId = ctx.auth.userId
    const dict = await loadCategoryDict()
    const res = await clubs()
      .where({ applicant_id: userId, create_type: CLUB_CREATE_TYPE.APPLIED, deleted: 0 })
      .orderBy('created_at', 'desc')
      .limit(5)
      .get()
    const list = (res.data || []).map((row) => publicClub(row, dict.byId.get(row.category_id)))
    const pending = list.find((item) => item.status === CLUB_STATUS.PENDING) || null
    const approved = list.find((item) => item.status === CLUB_STATUS.NORMAL) || null
    return club.ok({ list, pending, approved })
  })

  // 管理端：社团列表（status 筛选 + 分页 + 分类名/申请人 join + 待审数）
  // 路径用 /query 以区别于 P1-08 的学生端社团列表 /list
  api.post('/query', ...OPS_GUARD, async (ctx) => {
    const err = club.checkParams(ctx.body, {
      status: { type: 'string', enum: ['all', CLUB_STATUS.PENDING, CLUB_STATUS.NORMAL, CLUB_STATUS.REJECTED, CLUB_STATUS.BANNED] },
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
    const wheres = [{ deleted: 0 }]
    if (ctx.body.status && ctx.body.status !== 'all') wheres.push({ status: ctx.body.status })
    const where = wheres.length === 1 ? wheres[0] : cmd.and(wheres)

    const counted = await clubs().where(where).count()
    const total = Number((counted && counted.total) || 0)
    const found = await clubs()
      .where(where)
      .orderBy('created_at', 'desc')
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .get()
    const rows = found.data || []

    const dict = await loadCategoryDict()
    const applicantIds = [...new Set(rows.map((row) => row.applicant_id).filter(Boolean))]
    const applicantMap = new Map()
    if (applicantIds.length) {
      const userRes = await users().where({ _id: cmd.in(applicantIds) }).get()
      for (const item of userRes.data || []) applicantMap.set(item._id, item)
    }
    const pendingCounted = await clubs().where({ status: CLUB_STATUS.PENDING, deleted: 0 }).count()

    return club.ok({
      list: rows.map((row) => publicClub(row, dict.byId.get(row.category_id), applicantMap.get(row.applicant_id))),
      total,
      pending_total: Number((pendingCounted && pendingCounted.total) || 0),
      page,
      page_size: pageSize,
    })
  })

  // 管理端：入驻审核（通过 → normal 并创建 club_members.president；驳回 → rejected 附理由 + 通知）
  api.post('/review', ...OPS_GUARD, async (ctx) => {
    const err = club.checkParams(ctx.body, {
      club_id: { type: 'string', required: true, maxLen: 64 },
      action: { type: 'string', required: true, enum: [CLUB_ACTION.APPROVE, CLUB_ACTION.REJECT] },
      reason: { type: 'string', maxLen: CLUB_REASON_MAX },
    })
    if (err) return err

    const target = await findClubById(ctx.body.club_id.trim())
    if (!target) return club.fail(club.ERROR_CODE.NOT_FOUND, '社团不存在或已删除')
    if (target.status !== CLUB_STATUS.PENDING) {
      return club.fail(club.ERROR_CODE.STATUS_INVALID, '该社团当前状态不允许审核（仅待审可操作）')
    }

    const approving = ctx.body.action === CLUB_ACTION.APPROVE
    const reason = String(ctx.body.reason || '').trim()
    if (!approving && reason.length < CLUB_REASON_MIN) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, `请填写驳回理由（至少 ${CLUB_REASON_MIN} 个字）`)
    }

    const reviewedAt = new Date()
    const reviewer = ctx.auth.username
    let memberCreated = false

    if (approving) {
      const patch = {
        status: CLUB_STATUS.NORMAL,
        reject_reason: '',
        review_by: reviewer,
        review_at: reviewedAt,
        updated_at: reviewedAt,
      }
      await clubs().doc(target._id).update(patch)

      // 线上申请：申请人自动成为社长（需求 4.2.1 主流程 2）
      if (target.create_type === CLUB_CREATE_TYPE.APPLIED && target.applicant_id) {
        const existed = await clubMembers()
          .where({ club_id: target._id, user_id: target.applicant_id })
          .limit(1)
          .get()
        const current = (existed.data && existed.data[0]) || null
        if (current) {
          // 成员记录存在但可能处于 removed / 非社长（如被移除后重新入驻）→ 复活并设为社长
          await clubMembers().doc(current._id).update({
            role: CLUB_MEMBER_ROLE.PRESIDENT,
            status: CLUB_MEMBER_STATUS.ACTIVE,
            joined_at: reviewedAt,
          })
          memberCreated = true
        } else {
          try {
            await clubMembers().add({
              club_id: target._id,
              user_id: target.applicant_id,
              role: CLUB_MEMBER_ROLE.PRESIDENT,
              status: CLUB_MEMBER_STATUS.ACTIVE,
              joined_at: reviewedAt,
              // 显式写入软删标志，避免历史数据缺字段（计数查询统一用 deleted != 1 兼容两种）
              deleted: 0,
            })
            memberCreated = true
          } catch (e) {
            memberCreated = false
          }
        }
      }
    } else {
      await clubs().doc(target._id).update({
        status: CLUB_STATUS.REJECTED,
        reject_reason: reason,
        review_by: reviewer,
        review_at: reviewedAt,
        updated_at: reviewedAt,
      })
    }

    // 结果通知申请人（线上申请才有申请人；导入社团无需通知）
    // 场景按结果拆分：驳回后学生可修改重提，「驳回 → 通过」两条通知不会被去重规则拦掉
    let pushed = null
    if (target.create_type === CLUB_CREATE_TYPE.APPLIED && target.applicant_id) {
      pushed = await notify.send({
        userId: target.applicant_id,
        scene: approving ? 'club_apply_approved' : 'club_apply_rejected',
        bizId: target._id,
        vars: { club_name: target.name, reason: approving ? '' : reason },
      })
    }

    const updated = await findClubById(target._id)
    const dict = await loadCategoryDict()
    return club.ok({
      club: publicClub(updated || target, dict.byId.get((updated || target).category_id)),
      member_created: memberCreated,
      notify: pushed,
    })
  })

  // 管理端：批量导入创建社团（create_type = imported；重名跳过并记入回执）
  api.post('/import', ...OPS_GUARD, async (ctx) => {
    const err = club.checkParams(ctx.body, {
      batch_no: { type: 'string', required: true, maxLen: 40 },
      chunk_index: { type: 'int', required: true },
      rows: { type: 'array', required: true },
    })
    if (err) return err

    const chunkIndex = Number(ctx.body.chunk_index)
    const rows = ctx.body.rows
    const chunkTotal = Number(ctx.body.chunk_total || 0)
    if (chunkIndex < 0) return club.fail(club.ERROR_CODE.PARAM_INVALID, 'chunk_index 不合法')
    if (chunkTotal > Math.ceil(CLUB_IMPORT_MAX_ROWS / CLUB_IMPORT_MAX_CHUNK)) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, `单批最多 ${CLUB_IMPORT_MAX_ROWS} 行，请拆分文件后分批导入`)
    }
    if (!rows.length) return club.fail(club.ERROR_CODE.PARAM_INVALID, '本块无数据')
    if (rows.length > CLUB_IMPORT_MAX_CHUNK) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, `单块最多 ${CLUB_IMPORT_MAX_CHUNK} 行`)
    }

    const dict = await loadCategoryDict()
    const failed = []
    const prepared = []
    for (const raw of rows) {
      const rowNo = Number((raw && raw.row_no) || 0)
      const name = String((raw && raw.name) == null ? '' : raw.name).trim()
      const intro = String((raw && raw.intro) == null ? '' : raw.intro).trim().slice(0, CLUB_INTRO_MAX)
      const categoryName = String((raw && raw.category) == null ? '' : raw.category).trim()
      const contact = String((raw && raw.contact) == null ? '' : raw.contact).trim().slice(0, CLUB_CONTACT_MAX)

      if (!name) {
        failed.push({ row_no: rowNo, reason: '社团名称为空' })
        continue
      }
      if (name.length > CLUB_NAME_MAX) {
        failed.push({ row_no: rowNo, name, reason: `社团名称超长（≤${CLUB_NAME_MAX} 字）` })
        continue
      }
      if (!categoryName) {
        failed.push({ row_no: rowNo, name, reason: '分类为空' })
        continue
      }
      const categoryId = dict.byName.get(categoryName)
      if (!categoryId) {
        failed.push({ row_no: rowNo, name, reason: `分类「${categoryName}」不存在` })
        continue
      }
      prepared.push({ row_no: rowNo, name, intro, contact, category_id: categoryId })
    }

    // 库内查重 + 同块重复
    const existing = new Set()
    if (prepared.length) {
      const cmd = uniCloud.database().command
      const found = await clubs()
        .where({ name: cmd.in(prepared.map((row) => row.name)), deleted: 0 })
        .field({ name: true })
        .limit(CLUB_IMPORT_MAX_CHUNK)
        .get()
      for (const item of found.data || []) existing.add(item.name)
    }

    const skipped = []
    const seen = new Set()
    const pending = []
    for (const row of prepared) {
      if (existing.has(row.name)) {
        skipped.push({ row_no: row.row_no, name: row.name, reason: '库内已存在' })
        continue
      }
      if (seen.has(row.name)) {
        skipped.push({ row_no: row.row_no, name: row.name, reason: '同批重复' })
        continue
      }
      seen.add(row.name)
      pending.push(row)
    }

    const now = new Date()
    const docs = pending.map((row) => ({
      name: row.name,
      intro: row.intro,
      contact: row.contact,
      category_id: row.category_id,
      star_level: 0,
      status: CLUB_STATUS.NORMAL,
      create_type: CLUB_CREATE_TYPE.IMPORTED,
      applicant_id: '',
      reject_reason: '',
      review_by: '',
      review_at: null,
      batch_no: ctx.body.batch_no,
      created_at: now,
      updated_at: now,
      deleted: 0,
    }))

    let success = 0
    if (docs.length) {
      try {
        await clubs().add(docs)
        success = docs.length
      } catch (e) {
        // 唯一索引冲突兜底：逐条写入，冲突行计入回执
        for (let i = 0; i < docs.length; i += 1) {
          try {
            await clubs().add(docs[i])
            success += 1
          } catch (inner) {
            skipped.push({
              row_no: pending[i].row_no,
              name: pending[i].name,
              reason: '写入冲突（可能已被并发导入）',
            })
          }
        }
      }
    }

    return club.ok({
      batch_no: ctx.body.batch_no,
      chunk_index: chunkIndex,
      success,
      skipped,
      failed,
    })
  })

  /* ============================================================
   * P1-07 分类维护（ADM-02②）
   * ============================================================ */

  // 管理端：分类列表（含各分类社团数，供删除保护提示）
  api.get('/category/list', ...OPS_GUARD, async () => club.ok({ list: await listCategoriesWithCount() }))

  // 管理端：新增 / 重命名分类
  api.post('/category/save', ...OPS_GUARD, async (ctx) => {
    const err = club.checkParams(ctx.body, {
      category_id: { type: 'string', maxLen: 64 },
      name: { type: 'string', required: true, maxLen: CATEGORY_NAME_MAX },
    })
    if (err) return err

    const name = String(ctx.body.name).trim()
    if (name.length < CATEGORY_NAME_MIN) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, `分类名称至少 ${CATEGORY_NAME_MIN} 个字`)
    }
    const categoryId = String(ctx.body.category_id || '').trim()

    // 同名占用预查（不过滤 deleted：软删记录仍占用 categories.name 唯一索引）
    const dupRes = await categories().where({ name }).limit(1).get()
    const dup = (dupRes.data && dupRes.data[0]) || null

    // 重命名
    if (categoryId) {
      const target = await findCategoryById(categoryId)
      if (!target) return club.fail(club.ERROR_CODE.NOT_FOUND, '分类不存在或已删除')
      if (target.name === name) {
        return club.ok({ category: publicCategory(target, await countClubsOfCategory(categoryId)) })
      }
      if (dup) return club.fail(club.ERROR_CODE.PARAM_INVALID, '该分类名称已被占用（含已删除分类），请更换')
      try {
        await categories().doc(categoryId).update({ name })
      } catch (e) {
        return club.fail(club.ERROR_CODE.PARAM_INVALID, '该分类名称已被占用（含已删除分类），请更换')
      }
      return club.ok({ category: publicCategory({ ...target, name }, await countClubsOfCategory(categoryId)) })
    }

    // 新增
    if (dup && dup.deleted === 0) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, '该分类名称已存在，请更换')
    }
    const list = await listCategories()
    const nextSort = list.reduce((max, item) => Math.max(max, Number(item.sort) || 0), 0) + 1
    // 复用历史软删记录（同名的软删行仍占用唯一索引，直接复用可避免写入冲突）
    if (dup) {
      await categories().doc(dup._id).update({ name, sort: nextSort, deleted: 0 })
      return club.ok({ category: publicCategory({ ...dup, name, sort: nextSort }, 0) })
    }
    try {
      const added = await categories().add({ name, sort: nextSort, deleted: 0 })
      return club.ok({ category: publicCategory({ _id: added.id, name, sort: nextSort }, 0) })
    } catch (e) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, '该分类名称已存在，请更换')
    }
  })

  // 管理端：删除分类（兜底策略：被社团引用则禁止删除；至少保留一个分类）
  api.post('/category/delete', ...OPS_GUARD, async (ctx) => {
    const err = club.checkParams(ctx.body, {
      category_id: { type: 'string', required: true, maxLen: 64 },
    })
    if (err) return err

    const target = await findCategoryById(ctx.body.category_id.trim())
    if (!target) return club.fail(club.ERROR_CODE.NOT_FOUND, '分类不存在或已删除')

    const used = await countClubsOfCategory(target._id)
    if (used > 0) {
      return club.fail(
        club.ERROR_CODE.STATUS_INVALID,
        `该分类下仍有 ${used} 个社团，请先为其调整分类后再删除`,
        { club_count: used }
      )
    }
    const remaining = (await listCategories()).filter((item) => item._id !== target._id)
    if (!remaining.length) {
      return club.fail(club.ERROR_CODE.STATUS_INVALID, '至少需保留一个分类，无法删除最后一个分类')
    }
    await categories().doc(target._id).update({ deleted: 1 })
    return club.ok({ category_id: target._id, list: await listCategoriesWithCount() })
  })

  // 管理端：分类上移 / 下移（相邻交换，sort 归一为 1..n）
  api.post('/category/sort', ...OPS_GUARD, async (ctx) => {
    const err = club.checkParams(ctx.body, {
      category_id: { type: 'string', required: true, maxLen: 64 },
      direction: { type: 'string', required: true, enum: [CATEGORY_SORT_DIRECTION.UP, CATEGORY_SORT_DIRECTION.DOWN] },
    })
    if (err) return err

    const list = await listCategories()
    const index = list.findIndex((item) => item._id === ctx.body.category_id.trim())
    if (index === -1) return club.fail(club.ERROR_CODE.NOT_FOUND, '分类不存在或已删除')

    const targetIndex = index + (ctx.body.direction === CATEGORY_SORT_DIRECTION.UP ? -1 : 1)
    if (targetIndex < 0) return club.fail(club.ERROR_CODE.STATUS_INVALID, '已经是第一个分类')
    if (targetIndex >= list.length) return club.fail(club.ERROR_CODE.STATUS_INVALID, '已经是最后一个分类')

    const ordered = list.slice()
    const [moved] = ordered.splice(index, 1)
    ordered.splice(targetIndex, 0, moved)
    await applyCategoryOrder(ordered)
    return club.ok({ list: await listCategoriesWithCount() })
  })

  /* ============================================================
   * P1-07 星级评定与封禁 / 停用（ADM-02② / 需求 4.4 状态机）
   * ============================================================ */

  // 管理端：星级评定（1~5 星；0 = 取消评定）
  api.post('/star', ...OPS_GUARD, async (ctx) => {
    const err = club.checkParams(ctx.body, {
      club_id: { type: 'string', required: true, maxLen: 64 },
      star_level: { type: 'int', required: true },
    })
    if (err) return err

    const starLevel = Number(ctx.body.star_level)
    if (starLevel < CLUB_STAR_MIN || starLevel > CLUB_STAR_MAX) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, `星级需在 ${CLUB_STAR_MIN}~${CLUB_STAR_MAX} 之间（0 表示取消评定）`)
    }
    const target = await findClubById(ctx.body.club_id.trim())
    if (!target) return club.fail(club.ERROR_CODE.NOT_FOUND, '社团不存在或已删除')
    if (target.status !== CLUB_STATUS.NORMAL) {
      return club.fail(club.ERROR_CODE.STATUS_INVALID, '仅「正常」状态的社团可评定星级')
    }

    await clubs().doc(target._id).update({ star_level: starLevel, updated_at: new Date() })
    const dict = await loadCategoryDict()
    return club.ok({ club: publicClub({ ...target, star_level: starLevel }, dict.byId.get(target.category_id)) })
  })

  // 管理端：封禁 / 停用与解封（normal ⇄ banned；二次确认由管理端在调用前完成）
  api.post('/ban', ...OPS_GUARD, async (ctx) => {
    const err = club.checkParams(ctx.body, {
      club_id: { type: 'string', required: true, maxLen: 64 },
      action: { type: 'string', required: true, enum: [CLUB_BAN_ACTION.BAN, CLUB_BAN_ACTION.UNBAN] },
    })
    if (err) return err

    const target = await findClubById(ctx.body.club_id.trim())
    if (!target) return club.fail(club.ERROR_CODE.NOT_FOUND, '社团不存在或已删除')

    const banning = ctx.body.action === CLUB_BAN_ACTION.BAN
    if (banning && target.status !== CLUB_STATUS.NORMAL) {
      return club.fail(club.ERROR_CODE.STATUS_INVALID, '仅「正常」状态的社团可封禁 / 停用')
    }
    if (!banning && target.status !== CLUB_STATUS.BANNED) {
      return club.fail(club.ERROR_CODE.STATUS_INVALID, '仅「已封禁」状态的社团可解封')
    }

    const nextStatus = banning ? CLUB_STATUS.BANNED : CLUB_STATUS.NORMAL
    await clubs().doc(target._id).update({ status: nextStatus, updated_at: new Date() })
    const dict = await loadCategoryDict()
    return club.ok({ club: publicClub({ ...target, status: nextStatus }, dict.byId.get(target.category_id)) })
  })

  /* ============================================================
   * P1-08 学生端社团列表与详情（STU-03；公开只读，游客可浏览——需求 4.1 主流程 2）
   * ============================================================ */

  // 学生端：社团列表（分类筛选 + 星级「X 星及以上」+ 关键词 + 综合 / 最新排序 + 分页）
  api.get('/list', async (ctx) => {
    const raw = ctx.query || {}
    const page = raw.page === undefined || raw.page === '' ? 1 : Number(raw.page)
    const pageSize = raw.page_size === undefined || raw.page_size === '' ? CLUB_LIST_PAGE_SIZE : Number(raw.page_size)
    const sortField = raw.sort === undefined || raw.sort === '' ? CLUB_LIST_SORT.COMPREHENSIVE : String(raw.sort)
    const starMin = raw.star_min === undefined || raw.star_min === '' ? 0 : Number(raw.star_min)
    const keyword = String(raw.keyword == null ? '' : raw.keyword).trim()
    const categoryId = String(raw.category_id == null ? '' : raw.category_id).trim()

    if (!Number.isInteger(page) || page < 1) return club.fail(club.ERROR_CODE.PARAM_INVALID, 'page 不合法')
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > CLUB_LIST_PAGE_SIZE_MAX) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, `page_size 需在 1~${CLUB_LIST_PAGE_SIZE_MAX} 之间`)
    }
    if (sortField !== CLUB_LIST_SORT.COMPREHENSIVE && sortField !== CLUB_LIST_SORT.LATEST) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, 'sort 取值不合法')
    }
    if (!Number.isInteger(starMin) || starMin < CLUB_STAR_MIN || starMin > CLUB_STAR_MAX) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, `star_min 需在 ${CLUB_STAR_MIN}~${CLUB_STAR_MAX} 之间`)
    }
    if (keyword.length > CLUB_KEYWORD_MAX) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, `关键词最多 ${CLUB_KEYWORD_MAX} 个字`)
    }

    const cmd = uniCloud.database().command
    const wheres = [{ status: CLUB_STATUS.NORMAL, deleted: 0 }]
    if (categoryId) wheres.push({ category_id: categoryId })
    // 星级筛选：X 星及以上（0 = 不限；未评定社团仅在「不限」时出现）
    if (starMin > 0) wheres.push({ star_level: cmd.gte(starMin) })
    if (keyword) {
      // 需求 2.7：关键词字面匹配（不做模糊 / 拼音）；转义正则元字符，避免 `.*` 命中全表
      const reg = new RegExp(club.escapeRegExp(keyword), 'i')
      wheres.push(cmd.or([{ name: reg }, { intro: reg }]))
    }
    const where = wheres.length === 1 ? wheres[0] : cmd.and(wheres)

    // 综合排序需按「星级 + 成员数」加权后分页，故一次性取回候选集（上限见 CLUB_LIST_CANDIDATE_MAX）
    const found = await clubs().where(where).limit(CLUB_LIST_CANDIDATE_MAX).get()
    const rows = found.data || []
    const { memberMap, activityMap } = await loadClubCounters(rows.map((row) => row._id))
    const dict = await loadCategoryDict()
    const list = rows.map((row) => publicClubCard(row, dict.byId.get(row.category_id), memberMap.get(row._id), activityMap.get(row._id)))

    if (sortField === CLUB_LIST_SORT.COMPREHENSIVE) {
      list.sort((a, b) => {
        const scoreA = a.star_level * CLUB_SCORE_STAR_WEIGHT + a.member_count
        const scoreB = b.star_level * CLUB_SCORE_STAR_WEIGHT + b.member_count
        if (scoreA !== scoreB) return scoreB - scoreA
        if (a.member_count !== b.member_count) return b.member_count - a.member_count
        return compareLatest(a, b)
      })
    } else {
      list.sort(compareLatest)
    }

    const total = list.length
    const start = (page - 1) * pageSize
    const pageItems = list.slice(start, start + pageSize)
    return club.ok({
      list: pageItems,
      total,
      page,
      page_size: pageSize,
      has_more: start + pageItems.length < total,
    })
  })

  // 学生端：社团详情（基础信息 + 成员数 / 活动数 + 最近活动；封禁 / 待审 / 驳回社团不可见）
  api.get('/detail', async (ctx) => {
    const clubId = String((ctx.query && ctx.query.club_id) || '').trim()
    if (!clubId) return club.fail(club.ERROR_CODE.PARAM_INVALID, '参数 club_id 不能为空')

    const row = await findClubById(clubId)
    if (!row || row.status !== CLUB_STATUS.NORMAL) {
      return club.fail(club.ERROR_CODE.NOT_FOUND, '社团不存在或已下架')
    }
    const dict = await loadCategoryDict()
    const { memberMap, activityMap } = await loadClubCounters([row._id])
    return club.ok({
      club: publicClubCard(row, dict.byId.get(row.category_id), memberMap.get(row._id), activityMap.get(row._id)),
      activities: await loadClubActivities(row._id),
    })
  })

  /* ============================================================
   * P1-24 学生端「我的社团」（STU-08）：全部 active 成员关系（含 member 角色）
   * 与负责人端 /my-clubs（仅 president/officer 管理视图）区分；
   * 需求 4.2.4：成员被移除（status = removed）后此处同步消失，可再报该社团招新。
   * ============================================================ */
  api.get('/memberships', club.requireAuth(club.TOKEN_TYPES.STUDENT), async (ctx) => {
    const cmd = uniCloud.database().command
    const res = await clubMembers()
      .where({ user_id: ctx.auth.userId, status: CLUB_MEMBER_STATUS.ACTIVE, deleted: cmd.neq(1) })
      .get()
    const memberships = (res.data || []).slice().sort((a, b) => {
      const ta = toTime(a.joined_at)
      const tb = toTime(b.joined_at)
      if (ta !== tb) return tb - ta
      return a.club_id < b.club_id ? -1 : a.club_id > b.club_id ? 1 : 0
    })
    if (!memberships.length) return club.ok({ list: [] })

    const clubIds = memberships.map((item) => item.club_id)
    const found = await clubs().where({ _id: cmd.in(clubIds), deleted: 0 }).get()
    const rowMap = new Map((found.data || []).map((row) => [row._id, row]))
    const dict = await loadCategoryDict()
    const { memberMap, activityMap } = await loadClubCounters(memberships.map((m) => m.club_id))

    const list = memberships
      .filter((item) => rowMap.has(item.club_id))
      .map((item) => {
        const row = rowMap.get(item.club_id)
        return {
          club_id: item.club_id,
          role: item.role || CLUB_MEMBER_ROLE.MEMBER,
          joined_at: item.joined_at || null,
          club: publicClubCard(row, dict.byId.get(row.category_id), memberMap.get(item.club_id), activityMap.get(item.club_id)),
        }
      })
    return club.ok({ list })
  })

  /* ============================================================
   * P1-09 社团资料管理（CLB-01）：负责人端「我的社团」与资料编辑
   * 权限：管理视图对 president / officer 开放；**资料编辑仅 president**（需求 2.3 权限矩阵）
   * ============================================================ */

  // 负责人端：我管理的社团（多社团返回列表，供管理主页切换）
  api.get('/my-clubs', club.requireAuth(club.TOKEN_TYPES.STUDENT), async (ctx) => {
    const cmd = uniCloud.database().command
    const res = await clubMembers()
      .where({
        user_id: ctx.auth.userId,
        status: CLUB_MEMBER_STATUS.ACTIVE,
        role: cmd.in(CLUB_MANAGER_ROLES),
      })
      .get()
    const memberships = (res.data || []).slice().sort((a, b) => {
      const ta = toTime(a.joined_at)
      const tb = toTime(b.joined_at)
      if (ta !== tb) return ta - tb
      return a.club_id < b.club_id ? -1 : a.club_id > b.club_id ? 1 : 0
    })
    if (!memberships.length) return club.ok({ list: [] })

    const clubIds = memberships.map((item) => item.club_id)
    const found = await clubs().where({ _id: cmd.in(clubIds), deleted: 0 }).get()
    const rowMap = new Map((found.data || []).map((row) => [row._id, row]))
    const rows = memberships.map((item) => rowMap.get(item.club_id)).filter(Boolean)
    const { memberMap, activityMap } = await loadClubCounters(rows.map((row) => row._id))
    const dict = await loadCategoryDict()

    const list = memberships
      .filter((item) => rowMap.has(item.club_id))
      .map((item) => {
        const row = rowMap.get(item.club_id)
        return {
          role: item.role,
          joined_at: item.joined_at || null,
          // 可编辑 = 社长 + 社团正常（封禁社团仍返回，供负责人看到封禁状态；服务端在 /update 二次校验）
          can_edit: item.role === CLUB_MEMBER_ROLE.PRESIDENT && row.status === CLUB_STATUS.NORMAL,
          club: publicManagedClub(row, dict.byId.get(row.category_id), memberMap.get(row._id), activityMap.get(row._id)),
        }
      })
    return club.ok({ list })
  })

  // 负责人端：编辑社团资料（名称 / 简介 / 联系方式 / Logo / 封面；分类与星级由管理员设定，不可写）
  api.post('/update', club.requireActiveStudent(), async (ctx) => {
    const err = club.checkParams(ctx.body, {
      club_id: { type: 'string', required: true, maxLen: 64 },
      name: { type: 'string', required: true, maxLen: CLUB_NAME_MAX },
      intro: { type: 'string', required: true, maxLen: CLUB_INTRO_MAX },
      contact: { type: 'string', required: true, maxLen: CLUB_CONTACT_MAX },
      logo: { type: 'string', maxLen: CLUB_IMAGE_URL_MAX },
      cover: { type: 'string', maxLen: CLUB_IMAGE_URL_MAX },
    })
    if (err) return err

    const name = String(ctx.body.name).trim()
    const intro = String(ctx.body.intro).trim()
    const contact = String(ctx.body.contact).trim()
    if (name.length < CLUB_NAME_MIN) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, `社团名称至少 ${CLUB_NAME_MIN} 个字`)
    }
    if (!intro) return club.fail(club.ERROR_CODE.PARAM_INVALID, '请填写社团简介')
    if (!contact) return club.fail(club.ERROR_CODE.PARAM_INVALID, '请填写联系方式')

    const clubId = ctx.body.club_id.trim()
    const target = await findClubById(clubId)
    if (!target) return club.fail(club.ERROR_CODE.NOT_FOUND, '社团不存在或已删除')

    const membership = await findMembership(clubId, ctx.user._id)
    if (!membership) return club.fail(club.ERROR_CODE.FORBIDDEN, '你不是该社团的负责人，无权编辑资料')
    if (membership.role !== CLUB_MEMBER_ROLE.PRESIDENT) {
      return club.fail(club.ERROR_CODE.FORBIDDEN, '仅社长可编辑社团资料，如需修改请联系社长')
    }
    if (target.status !== CLUB_STATUS.NORMAL) {
      return club.fail(club.ERROR_CODE.STATUS_INVALID, '社团当前状态不允许编辑资料（仅正常状态可编辑）')
    }

    const occupied = await findClubByName(name, target._id)
    if (occupied) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, '该社团名称已被使用，请更换名称后重试')
    }

    // 可写字段白名单：category_id / star_level 不在此列（由管理员设定，需求 CLB-01）
    const patch = {
      name,
      intro,
      contact,
      logo: String(ctx.body.logo == null ? '' : ctx.body.logo).trim(),
      cover: String(ctx.body.cover == null ? '' : ctx.body.cover).trim(),
      updated_at: new Date(),
    }
    try {
      await clubs().doc(target._id).update(patch)
    } catch (e) {
      // clubs.name 唯一索引兜底（并发改名）
      return club.fail(club.ERROR_CODE.PARAM_INVALID, '该社团名称已被使用，请更换名称后重试')
    }

    const dict = await loadCategoryDict()
    const { memberMap, activityMap } = await loadClubCounters([clubId])
    return club.ok({
      role: membership.role,
      can_edit: true,
      club: publicManagedClub({ ...target, ...patch }, dict.byId.get(target.category_id), memberMap.get(clubId), activityMap.get(clubId)),
    })
  })

  /* ============================================================
   * P1-19 成员管理（CLB-05）：成员列表 / 设撤干部 / 移除成员
   * 权限：列表对 president / officer 开放（需求 2.3 干部可进管理视图）；
   *       设 / 撤干部与移除成员**仅社长**；写操作要求社团正常（封禁社团禁用全部管理操作）。
   * 语义：移除仅置 status = removed（保留 role 与历史报名 / 签到记录）；
   *       社长不可被自身 / 干部移除；复活由 P1-18 招新录取 ensureClubMember 实现。
   * ============================================================ */

  // 成员列表（含 join users 的姓名 / 头像与后端脱敏学号；分页 + 角色计数）
  api.get('/members', club.requireAuth(club.TOKEN_TYPES.STUDENT), async (ctx) => {
    const clubId = (ctx.query && ctx.query.club_id) || ''
    if (!clubId) return club.fail(club.ERROR_CODE.PARAM_INVALID, '参数 club_id 不能为空')

    const my = await findMembership(clubId, ctx.auth.userId)
    if (!my || !CLUB_MANAGER_ROLES.includes(my.role)) {
      return club.fail(club.ERROR_CODE.FORBIDDEN, '你不是该社团的负责人，无权查看成员')
    }
    const target = await findClubById(clubId)
    if (!target) return club.fail(club.ERROR_CODE.NOT_FOUND, '社团不存在或已删除')

    const page = ctx.query.page === undefined ? 1 : Number(ctx.query.page)
    const pageSize = ctx.query.page_size === undefined ? CLUB_MEMBER_PAGE_SIZE : Number(ctx.query.page_size)
    if (!Number.isInteger(page) || page < 1) return club.fail(club.ERROR_CODE.PARAM_INVALID, 'page 不合法')
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > CLUB_MEMBER_PAGE_SIZE_MAX) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, `page_size 需在 1~${CLUB_MEMBER_PAGE_SIZE_MAX} 之间`)
    }

    const cmd = uniCloud.database().command
    // 软删口径统一 deleted != 1（兼容 P1-06 建记录未写 deleted 的历史数据）
    const base = { club_id: clubId, status: CLUB_MEMBER_STATUS.ACTIVE, deleted: cmd.neq(1) }
    const counted = await clubMembers().where(base).count()
    const total = Number((counted && counted.total) || 0)

    const res = await clubMembers()
      .where(base)
      .orderBy('joined_at', 'asc')
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .get()
    const rows = res.data || []

    // join users：一次取回全部用户信息，按 user_id 建索引
    const userIds = rows.map((row) => row.user_id)
    const userMap = new Map()
    if (userIds.length) {
      const found = await users()
        .where({ _id: cmd.in(userIds) })
        .field({ name: true, nickname: true, student_no: true, avatar: true })
        .get()
      for (const u of found.data || []) userMap.set(u._id, u)
    }

    // 角色权重排序（社长 > 干部 > 成员），同角色按入团时间升序
    // 注意：权重 0（社长）不能用 `|| 3` 兜底（0 为 falsy 会被误判为 3）
    const orderOf = (role) => (CLUB_MEMBER_ROLE_ORDER[role] === undefined ? 3 : CLUB_MEMBER_ROLE_ORDER[role])
    const list = rows
      .map((row) => publicMember(row, userMap.get(row.user_id)))
      .sort((a, b) => orderOf(a.role) - orderOf(b.role) || toTime(a.joined_at) - toTime(b.joined_at))

    return club.ok({ list, total, page, page_size: pageSize, role_count: await loadRoleCount(clubId), viewer_role: my.role })
  })

  // 设置 / 撤销干部（officer ⇄ member，仅社长）
  api.post('/members/role', club.requireActiveStudent(), async (ctx) => {
    const err = club.checkParams(ctx.body, {
      club_id: { type: 'string', required: true, maxLen: 64 },
      user_id: { type: 'string', required: true, maxLen: 64 },
      role: { type: 'string', enum: [CLUB_MEMBER_ROLE.OFFICER, CLUB_MEMBER_ROLE.MEMBER] },
    })
    if (err) return err

    const clubId = ctx.body.club_id
    const targetUserId = ctx.body.user_id
    const nextRole = ctx.body.role === CLUB_MEMBER_ROLE.OFFICER ? CLUB_MEMBER_ROLE.OFFICER : CLUB_MEMBER_ROLE.MEMBER

    const target = await findClubById(clubId)
    if (!target) return club.fail(club.ERROR_CODE.NOT_FOUND, '社团不存在或已删除')

    const my = await findMembership(clubId, ctx.user._id)
    if (!my || my.role !== CLUB_MEMBER_ROLE.PRESIDENT) {
      return club.fail(club.ERROR_CODE.FORBIDDEN, '仅社长可设置 / 撤销干部')
    }
    if (target.status !== CLUB_STATUS.NORMAL) {
      return club.fail(club.ERROR_CODE.STATUS_INVALID, '社团当前状态不允许成员管理（仅正常状态可操作）')
    }

    const member = await findMembership(clubId, targetUserId)
    if (!member) return club.fail(club.ERROR_CODE.NOT_FOUND, '该用户不是社团成员')
    if (member.role === CLUB_MEMBER_ROLE.PRESIDENT) {
      return club.fail(club.ERROR_CODE.FORBIDDEN, '社长不可被设为干部或降为普通成员')
    }
    if (member.role === nextRole) {
      return club.fail(club.ERROR_CODE.STATUS_INVALID, '该成员已是目标角色，无需重复操作')
    }

    await clubMembers().doc(member._id).update({ role: nextRole, updated_at: new Date() })
    const userRes = await users()
      .where({ _id: targetUserId })
      .field({ name: true, nickname: true, student_no: true, avatar: true })
      .limit(1)
      .get()
    const user = (userRes.data && userRes.data[0]) || null
    return club.ok({
      member: publicMember({ ...member, role: nextRole }, user),
      role_count: await loadRoleCount(clubId),
    })
  })

  // 移除成员（status → removed，仅社长；社长不可被移除）
  api.post('/members/remove', club.requireActiveStudent(), async (ctx) => {
    const err = club.checkParams(ctx.body, {
      club_id: { type: 'string', required: true, maxLen: 64 },
      user_id: { type: 'string', required: true, maxLen: 64 },
    })
    if (err) return err

    const clubId = ctx.body.club_id
    const targetUserId = ctx.body.user_id

    const target = await findClubById(clubId)
    if (!target) return club.fail(club.ERROR_CODE.NOT_FOUND, '社团不存在或已删除')

    const my = await findMembership(clubId, ctx.user._id)
    if (!my || my.role !== CLUB_MEMBER_ROLE.PRESIDENT) {
      return club.fail(club.ERROR_CODE.FORBIDDEN, '仅社长可移除成员')
    }
    if (target.status !== CLUB_STATUS.NORMAL) {
      return club.fail(club.ERROR_CODE.STATUS_INVALID, '社团当前状态不允许成员管理（仅正常状态可操作）')
    }

    const member = await findMembership(clubId, targetUserId)
    if (!member) return club.fail(club.ERROR_CODE.NOT_FOUND, '该用户不是社团成员')
    if (member.role === CLUB_MEMBER_ROLE.PRESIDENT) {
      return club.fail(club.ERROR_CODE.FORBIDDEN, '社长不可被移除（需平台管理员介入）')
    }

    // 仅移除成员关系：保留 role 与历史报名 / 签到记录（需求 4.2.4 异常分支）
    await clubMembers().doc(member._id).update({ status: CLUB_MEMBER_STATUS.REMOVED, updated_at: new Date() })
    return club.ok({ user_id: targetUserId, role_count: await loadRoleCount(clubId) })
  })

  /* ============================================================
   * P1-20 社团统计（CLB-03④ / CLB-04③）：活动 / 招新 / 成员 三组指标
   * 口径对齐 ADM-07：签到率 = 签到人数 / 报名成功人数；报名数取 approved 有效报名。
   * 权限：president / officer 均可查看（只读，对齐 /members 管理视图）。
   * 时间范围（range=all|7d|30d）作用于活动的 created_at；成员为存量，不受范围影响。
   * ============================================================ */
  api.get('/stats', club.requireAuth(club.TOKEN_TYPES.STUDENT), async (ctx) => {
    const clubId = (ctx.query && ctx.query.club_id) || ''
    if (!clubId) return club.fail(club.ERROR_CODE.PARAM_INVALID, '参数 club_id 不能为空')

    const range = (ctx.query && ctx.query.range) || STATS_RANGE.ALL
    if (!Object.values(STATS_RANGE).includes(range)) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, 'range 取值不合法')
    }

    const my = await findMembership(clubId, ctx.auth.userId)
    if (!my || !CLUB_MANAGER_ROLES.includes(my.role)) {
      return club.fail(club.ERROR_CODE.FORBIDDEN, '你不是该社团的负责人，无权查看统计')
    }
    const target = await findClubById(clubId)
    if (!target) return club.fail(club.ERROR_CODE.NOT_FOUND, '社团不存在或已删除')

    const cmd = uniCloud.database().command
    // 软删口径统一 deleted != 1（兼容缺字段的历史数据）
    const softDel = { deleted: cmd.neq(1) }
    const startMs = STATS_DAYS[range] ? Date.now() - STATS_DAYS[range] * 24 * 3600 * 1000 : 0
    const inRange = startMs > 0 ? { created_at: cmd.gte(new Date(startMs)) } : {}

    /* ---- 活动维度 ---- */
    const actRes = await activities().where({ club_id: clubId, ...softDel, ...inRange }).limit(STATS_CANDIDATE_MAX).get()
    const actRows = actRes.data || []
    const statusDist = {}
    for (const st of ACTIVITY_ALL_STATUS) statusDist[st] = 0
    for (const row of actRows) statusDist[row.status] = (statusDist[row.status] || 0) + 1
    const published = actRows.filter((row) => ACTIVITY_PUBLISHED_STATUS.includes(row.status)).length

    const actIds = actRows.map((row) => row._id)
    let signups = 0
    let signinCount = 0
    if (actIds.length) {
      const regRes = await activityRegistrations()
        .aggregate()
        .match({ activity_id: cmd.in(actIds), status: REG_STATUS_APPROVED, ...softDel })
        .group({ _id: '$activity_id', total: cmd.aggregate.sum(1) })
        .end()
      signups = (regRes.data || []).reduce((sum, row) => sum + (Number(row.total) || 0), 0)

      const ciRes = await checkins()
        .aggregate()
        .match({ activity_id: cmd.in(actIds), ...softDel })
        .group({ _id: '$activity_id', total: cmd.aggregate.sum(1) })
        .end()
      signinCount = (ciRes.data || []).reduce((sum, row) => sum + (Number(row.total) || 0), 0)
    }
    const signinRate = signups > 0 ? Number((signinCount / signups).toFixed(2)) : null

    /* ---- 招新维度 ---- */
    const rcRes = await recruitments().where({ club_id: clubId, ...softDel, ...inRange }).limit(STATS_CANDIDATE_MAX).get()
    const rcRows = rcRes.data || []
    const rcIds = rcRows.map((row) => row._id)
    let rcSignups = 0
    let accepted = 0
    if (rcIds.length) {
      const rcRegRes = await recruitmentRegistrations()
        .aggregate()
        .match({ recruitment_id: cmd.in(rcIds), ...softDel })
        .group({ _id: '$recruitment_id', total: cmd.aggregate.sum(1) })
        .end()
      rcSignups = (rcRegRes.data || []).reduce((sum, row) => sum + (Number(row.total) || 0), 0)

      const accRes = await recruitmentRegistrations()
        .aggregate()
        .match({ recruitment_id: cmd.in(rcIds), status: RECRUITMENT_REG_ACCEPTED, ...softDel })
        .group({ _id: '$recruitment_id', total: cmd.aggregate.sum(1) })
        .end()
      accepted = (accRes.data || []).reduce((sum, row) => sum + (Number(row.total) || 0), 0)
    }

    /* ---- 成员维度（存量，不受时间范围影响）---- */
    const memRes = await clubMembers()
      .aggregate()
      .match({ club_id: clubId, status: CLUB_MEMBER_STATUS.ACTIVE, ...softDel })
      .group({ _id: '$role', total: cmd.aggregate.sum(1) })
      .end()
    const member = { total: 0, president: 0, officer: 0, member: 0 }
    for (const row of memRes.data || []) {
      const count = Number(row.total) || 0
      member.total += count
      if (row._id === CLUB_MEMBER_ROLE.PRESIDENT) member.president += count
      else if (row._id === CLUB_MEMBER_ROLE.OFFICER) member.officer += count
      else member.member += count
    }

    return club.ok({
      club: { _id: target._id, name: target.name, status: target.status },
      range,
      activity: { published, signups, signin_count: signinCount, signin_rate: signinRate, status_dist: statusDist },
      recruitment: { posts: rcRows.length, signups: rcSignups, accepted },
      member,
    })
  })

  /* ============================================================
   * P2-01 社团动态（CLB-02 + ADM-05 动态部分）
   * 先发后审：发布即 published；review 级敏感词 → 放行置 flagged（监管疑似队列）；block 级 → 拦截。
   * 权限：发布 / 我的动态 = 社团负责人（president / officer）；公开动态流 = 学生端只读。
   * ============================================================ */

  // 负责人发布动态（先发后审）
  api.post('/posts/save', club.requireActiveStudent(), async (ctx) => {
    const err = club.checkParams(ctx.body, {
      club_id: { type: 'string', required: true, maxLen: 64 },
      content: { type: 'string', required: true, maxLen: POST_CONTENT_MAX },
      images: { type: 'array', maxLen: POST_IMAGES_MAX },
    })
    if (err) return err

    const clubId = String(ctx.body.club_id).trim()
    const content = String(ctx.body.content || '').trim()
    if (!content) return club.fail(club.ERROR_CODE.PARAM_INVALID, '动态正文不能为空')
    if (content.length > POST_CONTENT_MAX) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, `动态正文最长 ${POST_CONTENT_MAX} 字`)
    }
    const images = Array.isArray(ctx.body.images) ? ctx.body.images.filter((u) => typeof u === 'string' && u) : []
    if (images.length > POST_IMAGES_MAX) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, `动态最多上传 ${POST_IMAGES_MAX} 张图片`)
    }

    // 负责人权限：president / officer 可发布（社长 / 干部，需求 2.3）
    const my = await findMembership(clubId, ctx.user._id)
    if (!my || !CLUB_MANAGER_ROLES.includes(my.role)) {
      return club.fail(club.ERROR_CODE.FORBIDDEN, '仅该社团社长 / 干部可发布动态')
    }
    const target = await findClubByIdForPost(clubId)
    if (!target) return club.fail(club.ERROR_CODE.NOT_FOUND, '社团不存在或已删除')
    if (target.status !== CLUB_STATUS.NORMAL) {
      return club.fail(club.ERROR_CODE.STATUS_INVALID, '社团当前不可发布动态（封禁 / 待审 / 驳回）')
    }

    // 先发后审：content 走敏感词 POST_REVIEW 决策——block 拦截，review 放行并置 flagged
    const result = await filter.checkContent({ title: '', body: content, extras: [] })
    const decision = filter.decideByMode(filter.PUBLISH_MODES.POST_REVIEW, result)
    if (!decision.allowed) {
      const hit = (result.hits && result.hits[0] && result.hits[0].word) || ''
      return club.fail(club.ERROR_CODE.PARAM_INVALID, `内容含违规词${hit ? `（${hit}）` : ''}，请修改后重新发布`)
    }

    const now = new Date()
    const added = await posts().add({
      club_id: clubId,
      author_id: ctx.user._id,
      content,
      images,
      status: 'published',
      flagged: decision.flagged,
      published_at: now,
      created_at: now,
      deleted: 0,
    })
    const row = {
      _id: added.id,
      club_id: clubId,
      author_id: ctx.user._id,
      content,
      images,
      status: 'published',
      flagged: decision.flagged,
      published_at: now,
      created_at: now,
    }
    return club.ok({
      post: publicPost(row),
      flagged: decision.flagged,
      // review 命中 → 已进入监管疑似队列（moderation /list?view=flagged）
      queued_for_review: decision.flagged,
    })
  })

  // 我的动态列表（负责人，按 author_id 过滤）
  api.get('/posts/my', club.requireAuth(club.TOKEN_TYPES.STUDENT), async (ctx) => {
    const page = ctx.query.page === undefined ? 1 : Number(ctx.query.page)
    const pageSize = ctx.query.page_size === undefined ? POST_PAGE_SIZE_DEFAULT : Number(ctx.query.page_size)
    if (!Number.isInteger(page) || page < 1) return club.fail(club.ERROR_CODE.PARAM_INVALID, 'page 不合法')
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > POST_PAGE_SIZE_MAX) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, `page_size 需在 1~${POST_PAGE_SIZE_MAX} 之间`)
    }

    const totalRes = await posts().where({ author_id: ctx.auth.userId, deleted: 0 }).count()
    const total = totalRes.total || 0
    const listRes = await posts()
      .where({ author_id: ctx.auth.userId, deleted: 0 })
      .orderBy('published_at', 'desc')
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .get()

    // join 社团名
    const rows = (listRes.data || []).map((row) => ({ row, club_id: row.club_id }))
    const clubIds = [...new Set(rows.map((r) => r.club_id))]
    const nameById = new Map()
    if (clubIds.length) {
      const cmd = uniCloud.database().command
      const clubRes = await clubs().where({ _id: cmd.in(clubIds) }).field({ name: true }).get()
      for (const c of clubRes.data || []) nameById.set(c._id, c.name || '')
    }

    return club.ok({
      list: rows.map(({ row }) => ({ ...publicPost(row), club_name: nameById.get(row.club_id) || '' })),
      total,
      page,
      page_size: pageSize,
      has_more: page * pageSize < total,
    })
  })

  // 学生端社团动态流（社团详情「动态 / 风采」Tab；published 且未删）
  api.get('/posts/list', async (ctx) => {
    const clubId = String((ctx.query && ctx.query.club_id) || '').trim()
    if (!clubId) return club.fail(club.ERROR_CODE.PARAM_INVALID, '参数 club_id 不能为空')
    const page = ctx.query.page === undefined ? 1 : Number(ctx.query.page)
    const pageSize = ctx.query.page_size === undefined ? POST_PAGE_SIZE_DEFAULT : Number(ctx.query.page_size)
    if (!Number.isInteger(page) || page < 1) return club.fail(club.ERROR_CODE.PARAM_INVALID, 'page 不合法')
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > POST_PAGE_SIZE_MAX) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, `page_size 需在 1~${POST_PAGE_SIZE_MAX} 之间`)
    }

    const cond = { club_id: clubId, status: 'published', deleted: 0 }
    const totalRes = await posts().where(cond).count()
    const total = totalRes.total || 0
    const listRes = await posts()
      .where(cond)
      .orderBy('published_at', 'desc')
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .get()
    return club.ok({
      list: (listRes.data || []).map(publicPost),
      total,
      page,
      page_size: pageSize,
      has_more: page * pageSize < total,
    })
  })

  return api.run()
}

/* ============================================================
 * P2-01 社团动态（CLB-02 + ADM-05 动态部分）
 * 先发后审：发布即 published；命中 review 级敏感词 → 不阻断、置 flagged=true 进入监管疑似队列；
 * 命中 block 级 → 拦截发布。下架 / 恢复 / 复核走 moderation 域（P1-26）。
 * ============================================================ */

/** 动态正文长度上限 */
const POST_CONTENT_MAX = 1000
/** 动态配图上限（需求 2.6：≤9 张） */
const POST_IMAGES_MAX = 9
/** 动态列表分页 */
const POST_PAGE_SIZE_DEFAULT = 10
const POST_PAGE_SIZE_MAX = 20

function posts() {
  return uniCloud.database().collection('club_posts')
}

/** 动态公开行（学生端 / 负责人端共用；author 信息由调用方 join） */
function publicPost(row) {
  return {
    _id: row._id,
    club_id: row.club_id,
    author_id: row.author_id || '',
    content: row.content || '',
    images: row.images || [],
    status: row.status || 'published',
    flagged: !!row.flagged,
    published_at: row.published_at || null,
    created_at: row.created_at || null,
  }
}

async function findClubByIdForPost(clubId) {
  const res = await clubs().where({ _id: clubId, deleted: 0 }).limit(1).get()
  return (res.data && res.data[0]) || null
}
