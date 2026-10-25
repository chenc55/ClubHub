/**
 * 数据统计域云函数（P2-03 / ADM-07）
 *
 * URL 化前缀 /stats（网关剥离前缀后透传 event.path），路由按相对路径注册：
 *   GET /ping     → 对外 GET  /stats/ping            健康检查（公开）
 *   GET /overview → 对外 GET  /stats/overview        四维指标（管理通道，三角色可见）
 *   GET /export   → 对外 GET  /stats/export          指标 + 分类分布 CSV 导出（管理通道）
 *
 * 统计口径（需求 2.2.3(7) 四维指标口径，与功能需求板块一致）：
 * - 用户：累计注册数 = users.auth_status=verified 总数；新增用户数 = 周期内 verified_at 计数
 *         （P2-03 新增字段，认证成功时写入）；活跃用户 DAU = 周期内 last_active_at 去重计数、
 *         MAU = 近 30 天 last_active_at 去重计数（P2-03 新增字段，登录/会话刷新/认证打点）；
 * - 社团：入驻社团数 = clubs.status=normal 总数；活跃社团占比 = 周期内有动态（club_posts.published_at）
 *         或有活动（activities.created_at 且非草稿）的 normal 社团去重数 ÷ 入驻总数；
 *         分类分布 = normal 社团按 category_id 分组 + join 分类名；
 * - 活动：发布数 = 周期内 created_at 且 status≠draft（经确认口径）；报名数 = 周期内
 *         activity_registrations.status=approved 计数；签到率 = 周期内 approved 中 checked_in 占比（复用 P1-15 口径）；
 * - 招新：岗位数 = 周期内 recruitments.created_at 计数；报名数 = 周期内报名记录计数；录取数 = 周期内 status=accepted 计数；
 * - 时间范围：today / 7d / 30d / custom（start_at / end_at，毫秒时间戳）；
 * - 管理通道：requireAuth(ADMIN) + requireRole(['super','auditor','viewer'])（需求 2.3：三角色可查看/导出）；
 * - 软删口径统一 deleted != 1 为「有效」。
 */
'use strict'
const club = require('./lib/club-common')

/** 管理通道守卫：三角色（数据统计与导出 super / auditor / viewer 均可，需求 2.3 权限矩阵） */
const MGR_GUARD = [club.requireAuth(club.TOKEN_TYPES.ADMIN), club.requireRole(['super', 'auditor', 'viewer'])]

/** 时间范围 */
const RANGE = { TODAY: 'today', DAY7: '7d', DAY30: '30d', CUSTOM: 'custom' }
/** MAU 固定窗口（近 30 天） */
const MAU_WINDOW_MS = 30 * 24 * 3600 * 1000

function users() {
  return uniCloud.database().collection('users')
}
function clubs() {
  return uniCloud.database().collection('clubs')
}
function categories() {
  return uniCloud.database().collection('categories')
}
function activities() {
  return uniCloud.database().collection('activities')
}
function activityRegistrations() {
  return uniCloud.database().collection('activity_registrations')
}
function clubPosts() {
  return uniCloud.database().collection('club_posts')
}
function recruitments() {
  return uniCloud.database().collection('recruitments')
}
function recruitmentRegistrations() {
  return uniCloud.database().collection('recruitment_registrations')
}

function toTime(value) {
  if (!value) return 0
  const raw = typeof value === 'object' && value.$date ? value.$date : value
  const time = new Date(raw).getTime()
  return Number.isNaN(time) ? 0 : time
}

/**
 * 解析时间范围
 * @returns {{error}|{startMs, endMs, range}} endMs 不含边界
 */
function parseRange(ctx) {
  const range = ctx.query.range === undefined ? RANGE.DAY30 : String(ctx.query.range)
  const nowMs = Date.now()
  const startOfToday = (() => {
    const d = new Date(nowMs)
    d.setHours(0, 0, 0, 0)
    return d.getTime()
  })()

  if (range === RANGE.TODAY) return { startMs: startOfToday, endMs: nowMs, range }
  if (range === RANGE.DAY7) return { startMs: nowMs - 7 * 24 * 3600 * 1000, endMs: nowMs, range }
  if (range === RANGE.DAY30) return { startMs: nowMs - 30 * 24 * 3600 * 1000, endMs: nowMs, range }
  if (range === RANGE.CUSTOM) {
    const startMs = Number(ctx.query.start_at)
    const endMs = Number(ctx.query.end_at)
    if (!Number.isInteger(startMs) || !Number.isInteger(endMs) || startMs <= 0 || endMs <= startMs) {
      return { error: club.fail(club.ERROR_CODE.PARAM_INVALID, 'custom 范围需提供合法的 start_at / end_at 毫秒时间戳（end_at > start_at）') }
    }
    return { startMs, endMs, range }
  }
  return { error: club.fail(club.ERROR_CODE.PARAM_INVALID, 'range 取值仅支持 today / 7d / 30d / custom') }
}

/**
 * 构建周期条件（对齐 activity 域 cmd.and 顶层惯例：`cmd.and([{...extra}, {field: gte}, {field: lt}])`，
 * [start, end) 左闭右开；extra 内可为普通字段或 cmd.neq 等操作符）
 */
function buildWhere(extra, timeField, startMs, endMs) {
  const cmd = uniCloud.database().command
  return cmd.and([
    { ...(extra || {}) },
    { [timeField]: cmd.gte(new Date(startMs)) },
    { [timeField]: cmd.lt(new Date(endMs)) },
  ])
}

/** 周期计数（时间字段在 [startMs, endMs) 内） */
async function countBetween(collectionName, timeField, startMs, endMs, extra = {}) {
  const res = await uniCloud
    .database()
    .collection(collectionName)
    .where(buildWhere(extra, timeField, startMs, endMs))
    .count()
  return Number((res && res.total) || 0)
}

exports.main = async (event) => {
  const api = club.createRouter(event)

  // 健康检查（无需鉴权）
  api.get('/ping', () => club.ok({ pong: 'stats', time: Date.now() }))

  /* --------------------------------------------
   * 四维指标总览（管理通道，三角色可见）
   * -------------------------------------------- */
  api.get('/overview', ...MGR_GUARD, async (ctx) => {
    const pr = parseRange(ctx)
    if (pr.error) return pr.error
    const { startMs, endMs, range } = pr
    const cmd = uniCloud.database().command

    /* ---------- 用户 ---------- */
    const userBase = { auth_status: 'verified', deleted: 0 }
    const totalVerified = await countBetween('users', 'verified_at', 0, endMs, userBase) // 全部历史（start=0）
    const newVerified = await countBetween('users', 'verified_at', startMs, endMs, userBase)
    const dau = await countBetween('users', 'last_active_at', startMs, endMs, { deleted: 0 })
    const mau = await countBetween('users', 'last_active_at', Date.now() - MAU_WINDOW_MS, Date.now(), { deleted: 0 })

    /* ---------- 社团 ---------- */
    const clubBase = { status: 'normal', deleted: 0 }
    const totalClubsRes = await clubs().where(clubBase).count()
    const totalClubs = Number((totalClubsRes && totalClubsRes.total) || 0)

    // 周期内活跃社团（有动态 published_at 或活动 created_at 非草稿）——normal 社团内去重
    const postRes = await clubPosts()
      .where(buildWhere({ deleted: 0 }, 'published_at', startMs, endMs))
      .field({ club_id: true })
      .get()
    const actRes = await activities()
      .where(buildWhere({ status: cmd.neq('draft'), deleted: 0 }, 'created_at', startMs, endMs))
      .field({ club_id: true })
      .get()
    const activeClubIds = new Set([
      ...(postRes.data || []).map((r) => r.club_id),
      ...(actRes.data || []).map((r) => r.club_id),
    ])
    // 与 normal 社团取交集
    const clubRowsRes = await clubs().where(clubBase).field({ _id: true, category_id: true }).get()
    const normalClubRows = clubRowsRes.data || []
    const normalClubIds = new Set(normalClubRows.map((r) => r._id))
    const activeNormalCount = [...activeClubIds].filter((id) => normalClubIds.has(id)).length
    const activeRate = totalClubs > 0 ? Number((activeNormalCount / totalClubs).toFixed(4)) : null

    // 分类分布（normal 社团按 category_id 分组 + join 分类名，sort 升序）
    const catRes = await categories().where({ deleted: 0 }).orderBy('sort', 'asc').get()
    const catNameById = new Map((catRes.data || []).map((c) => [c._id, c.name]))
    const distMap = new Map()
    for (const row of normalClubRows) {
      const catId = row.category_id || ''
      distMap.set(catId, (distMap.get(catId) || 0) + 1)
    }
    const categoryDistribution = Array.from(distMap.entries())
      .map(([category_id, count]) => ({ category_id, category_name: catNameById.get(category_id) || '未分类', count }))
      .sort((a, b) => b.count - a.count)

    /* ---------- 活动 ---------- */
    const publishedCount = await countBetween('activities', 'created_at', startMs, endMs, { status: cmd.neq('draft'), deleted: 0 })
    const signupCount = await countBetween('activity_registrations', 'created_at', startMs, endMs, { status: 'approved', deleted: 0 })
    const checkedRes = await activityRegistrations()
      .where(buildWhere({ status: 'approved', checked_in: true, deleted: 0 }, 'created_at', startMs, endMs))
      .count()
    const checkedCount = Number((checkedRes && checkedRes.total) || 0)
    const signinRate = signupCount > 0 ? Number((checkedCount / signupCount).toFixed(4)) : null

    /* ---------- 招新 ---------- */
    const recruitmentCount = await countBetween('recruitments', 'created_at', startMs, endMs, { deleted: 0 })
    const recruitmentSignupCount = await countBetween('recruitment_registrations', 'created_at', startMs, endMs, { deleted: 0 })
    const acceptedCount = await countBetween('recruitment_registrations', 'created_at', startMs, endMs, { status: 'accepted', deleted: 0 })

    return club.ok({
      range,
      start_at: new Date(startMs),
      end_at: new Date(endMs),
      users: { total_verified: totalVerified, new_verified: newVerified, dau, mau },
      clubs: {
        total: totalClubs,
        active_count: activeNormalCount,
        active_rate: activeRate,
        category_distribution: categoryDistribution,
      },
      activities: { published_count: publishedCount, signup_count: signupCount, signin_rate: signinRate },
      recruitments: { count: recruitmentCount, signup_count: recruitmentSignupCount, accepted_count: acceptedCount },
    })
  })

  /* --------------------------------------------
   * CSV 导出（管理通道，三角色可见；带 BOM 供 Excel 中文）
   * -------------------------------------------- */
  api.get('/export', ...MGR_GUARD, async (ctx) => {
    const pr = parseRange(ctx)
    if (pr.error) return pr.error
    const { startMs, endMs, range } = pr
    const cmd = uniCloud.database().command

    const totalVerified = await countBetween('users', 'verified_at', 0, endMs, { auth_status: 'verified', deleted: 0 })
    const newVerified = await countBetween('users', 'verified_at', startMs, endMs, { auth_status: 'verified', deleted: 0 })
    const dau = await countBetween('users', 'last_active_at', startMs, endMs, { deleted: 0 })
    const mau = await countBetween('users', 'last_active_at', Date.now() - MAU_WINDOW_MS, Date.now(), { deleted: 0 })

    const totalClubsRes = await clubs().where({ status: 'normal', deleted: 0 }).count()
    const totalClubs = Number((totalClubsRes && totalClubsRes.total) || 0)
    const postRes = await clubPosts()
      .where(buildWhere({ deleted: 0 }, 'published_at', startMs, endMs))
      .field({ club_id: true })
      .get()
    const actRes = await activities()
      .where(buildWhere({ status: cmd.neq('draft'), deleted: 0 }, 'created_at', startMs, endMs))
      .field({ club_id: true })
      .get()
    const activeClubIds = new Set([
      ...(postRes.data || []).map((r) => r.club_id),
      ...(actRes.data || []).map((r) => r.club_id),
    ])
    const clubRowsRes = await clubs().where({ status: 'normal', deleted: 0 }).field({ _id: true, category_id: true }).get()
    const normalClubRows = clubRowsRes.data || []
    const normalClubIds = new Set(normalClubRows.map((r) => r._id))
    const activeNormalCount = [...activeClubIds].filter((id) => normalClubIds.has(id)).length
    const activeRate = totalClubs > 0 ? Number((activeNormalCount / totalClubs).toFixed(4)) : null

    const catRes = await categories().where({ deleted: 0 }).orderBy('sort', 'asc').get()
    const catNameById = new Map((catRes.data || []).map((c) => [c._id, c.name]))
    const distMap = new Map()
    for (const row of normalClubRows) distMap.set(row.category_id || '', (distMap.get(row.category_id || '') || 0) + 1)

    const publishedCount = await countBetween('activities', 'created_at', startMs, endMs, { status: cmd.neq('draft'), deleted: 0 })
    const signupCount = await countBetween('activity_registrations', 'created_at', startMs, endMs, { status: 'approved', deleted: 0 })
    const checkedRes = await activityRegistrations()
      .where(buildWhere({ status: 'approved', checked_in: true, deleted: 0 }, 'created_at', startMs, endMs))
      .count()
    const checkedCount = Number((checkedRes && checkedRes.total) || 0)
    const signinRate = signupCount > 0 ? Number((checkedCount / signupCount).toFixed(4)) : null

    const recruitmentCount = await countBetween('recruitments', 'created_at', startMs, endMs, { deleted: 0 })
    const recruitmentSignupCount = await countBetween('recruitment_registrations', 'created_at', startMs, endMs, { deleted: 0 })
    const acceptedCount = await countBetween('recruitment_registrations', 'created_at', startMs, endMs, { status: 'accepted', deleted: 0 })

    const esc = (v) => {
      const s = String(v == null ? '' : v)
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const lines = ['维度,指标,数值']
    lines.push(`用户,累计注册数,${esc(totalVerified)}`)
    lines.push(`用户,新增用户数（${range}）,${esc(newVerified)}`)
    lines.push(`用户,活跃用户 DAU（${range}）,${esc(dau)}`)
    lines.push(`用户,活跃用户 MAU（近 30 天）,${esc(mau)}`)
    lines.push(`社团,入驻社团数,${esc(totalClubs)}`)
    lines.push(`社团,活跃社团数（${range}）,${esc(activeNormalCount)}`)
    lines.push(`社团,活跃社团占比（${range}）,${esc(activeRate == null ? '' : `${(activeRate * 100).toFixed(2)}%`)}`)
    lines.push(`活动,发布数（${range}）,${esc(publishedCount)}`)
    lines.push(`活动,报名数 approved（${range}）,${esc(signupCount)}`)
    lines.push(`活动,签到率（${range}）,${esc(signinRate == null ? '' : `${(signinRate * 100).toFixed(2)}%`)}`)
    lines.push(`招新,岗位数（${range}）,${esc(recruitmentCount)}`)
    lines.push(`招新,报名数（${range}）,${esc(recruitmentSignupCount)}`)
    lines.push(`招新,录取数 accepted（${range}）,${esc(acceptedCount)}`)
    lines.push('')
    lines.push('分类分布（normal 社团）,社团数,')
    for (const [catId, count] of distMap) {
      lines.push(`${esc(catNameById.get(catId) || '未分类')},${count},`)
    }

    const csv = `\ufeff${lines.join('\n')}`
    return club.ok({
      filename: `clubhub-stats-${range}-${Date.now()}.csv`,
      content_type: 'text/csv; charset=utf-8',
      csv,
    })
  })

  return api.run()
}
