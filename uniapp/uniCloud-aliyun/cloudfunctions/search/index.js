/**
 * 全局搜索域云函数（P1-23 / COM-05）
 * URL 化前缀 /search（网关剥离前缀后透传 event.path），路由按相对路径注册
 * 单路由 GET /global：关键词同时检索 社团（名称/简介）、活动（标题）、招新岗位（标题）
 * 关键词精确匹配（需求 2.7：不做模糊 / 拼音）——实现为转义后的正则子串匹配；
 * 结果分组：「活动 / 社团」两组，招新岗位（open）挂靠所属社团条目下。
 * 排序（需求 2.7）：活动默认 start_time 升序（最近优先），ended/archived 沉底；
 * 社团综合 = 星级 × 20 + 成员数（对齐 P1-08 列表口径）。
 */
'use strict'
const club = require('./lib/club-common')

/** 搜索结果里活动分页 */
const ACTIVITY_PAGE_SIZE = 10
const ACTIVITY_PAGE_SIZE_MAX = 20
/** 社团组上限（数量级小，不分页） */
const CLUB_LIMIT = 20
/** 候选集上限 */
const SEARCH_CANDIDATE_MAX = 2000

/** 学生端可见的活动状态（排除 draft / pending 未发布活动） */
const ACTIVITY_PUBLISHED_STATUS = ['approved', 'signup', 'ongoing', 'ended', 'archived']
const ACTIVITY_ENDED_STATUS = ['ended', 'archived']
/** 招新开放中 */
const RECRUITMENT_STATUS_OPEN = 'open'
/** 关键词长度上限 */
const KEYWORD_MAX = 20

function clubs() {
  return uniCloud.database().collection('clubs')
}

function categories() {
  return uniCloud.database().collection('categories')
}

function activities() {
  return uniCloud.database().collection('activities')
}

function recruitments() {
  return uniCloud.database().collection('recruitments')
}

function activityRegistrations() {
  return uniCloud.database().collection('activity_registrations')
}

function clubMembers() {
  return uniCloud.database().collection('club_members')
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

/** 按任意字段聚合计数（报名数 / 成员数 / 活动数） */
async function countByField(collectionName, field, match) {
  const db = uniCloud.database()
  const $ = db.command.aggregate
  const res = await db
    .collection(collectionName)
    .aggregate()
    .match(match)
    .group({ _id: `$${field}`, total: $.sum(1) })
    .end()
  const map = new Map()
  for (const row of (res && res.data) || []) map.set(row._id, Number(row.total) || 0)
  return map
}

/** 活动卡公开结构 */
function publicActivity(row, signupCount, clubName) {
  const reg = Number(signupCount || 0)
  const capacity = Number(row.capacity)
  return {
    _id: row._id,
    title: row.title || '',
    cover: row.cover || '',
    club_id: row.club_id || '',
    club_name: clubName || '',
    location: row.location || '',
    start_time: row.start_time || null,
    end_time: row.end_time || null,
    status: row.status,
    signup_count: reg,
    progress: capacity > 0 ? Math.min(100, Math.round((reg / capacity) * 100)) : null,
  }
}

exports.main = async (event) => {
  const api = club.createRouter(event)

  api.get('/ping', () => club.ok({ pong: 'search', time: Date.now() }))

  /**
   * 全局搜索（公开）：关键词精确匹配（正则子串）
   * 查询参数：keyword, page?, page_size?（作用于活动组）
   */
  api.get('/global', async (ctx) => {
    const keyword = String((ctx.query && ctx.query.keyword) || '').trim()
    if (!keyword) return club.fail(club.ERROR_CODE.PARAM_INVALID, '请输入搜索关键词')
    if (keyword.length > KEYWORD_MAX) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, `关键词最长 ${KEYWORD_MAX} 字`)
    }
    const page = ctx.query.page === undefined ? 1 : Number(ctx.query.page)
    const pageSize = ctx.query.page_size === undefined ? ACTIVITY_PAGE_SIZE : Number(ctx.query.page_size)
    if (!Number.isInteger(page) || page < 1) return club.fail(club.ERROR_CODE.PARAM_INVALID, 'page 不合法')
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > ACTIVITY_PAGE_SIZE_MAX) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, `page_size 需在 1~${ACTIVITY_PAGE_SIZE_MAX} 之间`)
    }

    const cmd = uniCloud.database().command
    const softDel = { deleted: cmd.neq(1) }
    /** 精确匹配：转义正则元字符后子串匹配（需求 2.7，不做模糊 / 拼音） */
    const kw = club.escapeRegExp(keyword)
    const re = new RegExp(kw)

    // 分类名映射（社团卡 join）
    const catRes = await categories().where({ deleted: 0 }).get()
    const catNameById = new Map((catRes.data || []).map((c) => [c._id, c.name]))

    /* ---- 社团：名称 / 简介命中，normal + 综合排序（星级×20 + 成员数）---- */
    const clubRes = await clubs()
      .aggregate()
      .match({ status: 'normal', ...softDel, name: re })
      .limit(SEARCH_CANDIDATE_MAX)
      .end()
    // 简介命中需单独再查（正则只能匹配单字段，用或条件）
    const clubRes2 = await clubs()
      .aggregate()
      .match({ status: 'normal', ...softDel, intro: re })
      .limit(SEARCH_CANDIDATE_MAX)
      .end()
    const clubRowMap = new Map()
    for (const row of (clubRes.data || []).concat(clubRes2.data || [])) clubRowMap.set(row._id, row)
    let clubRows = Array.from(clubRowMap.values())
    const clubIds = clubRows.map((row) => row._id)
    const memberMap = clubIds.length
      ? await countByField('club_members', 'club_id', { club_id: cmd.in(clubIds), status: 'active', ...softDel })
      : new Map()
    const activityMap = clubIds.length
      ? await countByField('activities', 'club_id', { club_id: cmd.in(clubIds), status: cmd.in(ACTIVITY_PUBLISHED_STATUS), ...softDel })
      : new Map()
    // 命中社团的招新岗位（open）——按 club 挂靠
    const recruitMap = new Map()
    if (clubIds.length) {
      const rcRes = await recruitments()
        .aggregate()
        .match({ club_id: cmd.in(clubIds), status: RECRUITMENT_STATUS_OPEN, ...softDel, title: re })
        .limit(SEARCH_CANDIDATE_MAX)
        .end()
      const rcRows = rcRes.data || []
      const rcIds = rcRows.map((row) => row._id)
      const rcSignupMap = rcIds.length
        ? await countByField('recruitment_registrations', 'recruitment_id', { recruitment_id: cmd.in(rcIds), ...softDel })
        : new Map()
      for (const row of rcRows) {
        const signup = rcSignupMap.get(row._id) || 0
        const item = {
          _id: row._id,
          title: row.title || '',
          signup_end: row.signup_end || null,
          capacity: row.capacity == null ? null : Number(row.capacity),
          signup_count: signup,
          remaining: row.capacity == null ? null : Math.max(0, Number(row.capacity) - signup),
        }
        if (!recruitMap.has(row.club_id)) recruitMap.set(row.club_id, [])
        recruitMap.get(row.club_id).push(item)
      }
      // 每个社团内岗位按截止时间升序
      for (const list of recruitMap.values()) {
        list.sort((a, b) => toTime(a.signup_end) - toTime(b.signup_end))
      }
    }
    clubRows = clubRows
      .map((row) => ({
        _id: row._id,
        name: row.name || '',
        logo: row.logo || '',
        intro: row.intro || '',
        category_name: catNameById.get(row.category_id) || '',
        star_level: Number(row.star_level || 0),
        member_count: memberMap.get(row._id) || 0,
        activity_count: activityMap.get(row._id) || 0,
        recruitments: recruitMap.get(row._id) || [],
      }))
      .sort(
        (a, b) =>
          Number(b.star_level || 0) * 20 +
          Number(b.member_count || 0) -
          (Number(a.star_level || 0) * 20 + Number(a.member_count || 0))
      )
    clubRows = clubRows.slice(0, CLUB_LIMIT)

    /* ---- 活动：标题命中，已发布 + 时间升序（最近优先），ended/archived 沉底 + 分页 ---- */
    const actRes = await activities()
      .aggregate()
      .match({ status: cmd.in(ACTIVITY_PUBLISHED_STATUS), ...softDel, title: re })
      .limit(SEARCH_CANDIDATE_MAX)
      .end()
    const actRows = actRes.data || []
    const actIds = actRows.map((row) => row._id)
    const regMap = actIds.length
      ? await countByField('activity_registrations', 'activity_id', { activity_id: cmd.in(actIds), status: 'approved', ...softDel })
      : new Map()
    const clubNameById = new Map(clubRows.map((c) => [c._id, c.name]))
    // 活动可能来自未命中社团（独立条目），需全量社团名映射
    for (const row of clubRowMap.values()) clubNameById.set(row._id, row.name || '')
    const sortedActs = actRows
      .map((row) => ({
        row,
        ended: ACTIVITY_ENDED_STATUS.includes(row.status),
        start: toTime(row.start_time),
      }))
      .sort((a, b) => (a.ended === b.ended ? a.start - b.start : a.ended ? 1 : -1))
    const actTotal = sortedActs.length
    const actPage = sortedActs
      .slice((page - 1) * pageSize, page * pageSize)
      .map(({ row }) => publicActivity(row, regMap.get(row._id) || 0, clubNameById.get(row.club_id)))

    return club.ok({
      keyword,
      activities: { list: actPage, total: actTotal, page, page_size: pageSize, has_more: page * pageSize < actTotal },
      clubs: clubRows,
    })
  })

  return api.run()
}