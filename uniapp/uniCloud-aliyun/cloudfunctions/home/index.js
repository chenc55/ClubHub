/**
 * 首页聚合域云函数（P1-22 / STU-02）
 * URL 化前缀 /home（网关剥离前缀后透传 event.path），路由按相对路径注册
 * 单路由 GET /index：一次性返回首页各聚合模块（公开，游客可看）
 *   banners      最新 5 条 published 公告（P2-02 数据接入后启用；当前空集合 → 前端隐藏轮播）
 *   categories   分类字典（金刚区，按 sort 升序，最多 8 个）
 *   activities   精选/推荐活动（status=signup 报名中，按报名数倒序 + 分页）
 *   clubs        热门社团（按成员数倒序 top 5）
 *   recruitments 招新推荐（status=open 开放中，按 signup_end 升序 top 5）
 * 排序口径见需求 2.7：「精选/推荐活动 = 报名中活动按报名数倒序；热门社团 = 按成员数倒序；
 * 招新推荐 = 开放中岗位按截止时间升序。」
 */
'use strict'
const club = require('./lib/club-common')

/** 公告 Banner 上限（ADM-06：取最新 5 条 published 轮播） */
const BANNER_LIMIT = 5
/** 金刚区分类上限（设计稿：4 列 × 2 行） */
const CATEGORY_LIMIT = 8
/** 热门社团 top N */
const HOT_CLUB_LIMIT = 5
/** 招新推荐 top N */
const RECOMMEND_RECRUITMENT_LIMIT = 5
/** 精选活动分页（上拉加载更多） */
const ACTIVITY_PAGE_SIZE = 5
const ACTIVITY_PAGE_SIZE_MAX = 20
/** 候选集上限（聚合取回全量后在内存排序分页；单校规模远小于该值） */
const HOME_CANDIDATE_MAX = 2000

/** 活动状态：报名中 */
const ACTIVITY_STATUS_SIGNUP = 'signup'
/** 招新状态：开放中 */
const RECRUITMENT_STATUS_OPEN = 'open'
/** 公告状态：已发布 */
const ANNOUNCEMENT_STATUS_PUBLISHED = 'published'

function announcements() {
  return uniCloud.database().collection('announcements')
}

function categories() {
  return uniCloud.database().collection('categories')
}

function clubs() {
  return uniCloud.database().collection('clubs')
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

/** 分类名 → _id（金刚区展示与活动 join 分类名） */
async function loadCategoryNames() {
  const res = await categories().where({ deleted: 0 }).orderBy('sort', 'asc').get()
  return (res.data || []).map((item) => ({ _id: item._id, name: item.name, sort: item.sort }))
}

function toTime(value) {
  if (!value) return 0
  const raw = typeof value === 'object' && value.$date ? value.$date : value
  const time = new Date(raw).getTime()
  return Number.isNaN(time) ? 0 : time
}

/** 按任意字段聚合计数（home 需按 activity_id / recruitment_id 分组，非 club_id；通用化） */
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

/** 活动卡公开结构（前端展示最小集） */
function publicActivity(row, memberCount, clubName) {
  const reg = Number(memberCount || 0)
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
    capacity: capacity || 0,
    signup_count: reg,
    /** 报名进度（百分比，供进度条；无上限时 null） */
    progress: capacity > 0 ? Math.min(100, Math.round((reg / capacity) * 100)) : null,
  }
}

exports.main = async (event) => {
  const api = club.createRouter(event)

  api.get('/ping', () => club.ok({ pong: 'home', time: Date.now() }))

  /**
   * 首页聚合（公开）：公告轮播 / 分类金刚区 / 精选活动（分页）/ 热门社团 / 招新推荐
   * 查询参数：page / page_size 作用于精选活动
   */
  api.get('/index', async (ctx) => {
    const page = ctx.query.page === undefined ? 1 : Number(ctx.query.page)
    const pageSize = ctx.query.page_size === undefined ? ACTIVITY_PAGE_SIZE : Number(ctx.query.page_size)
    if (!Number.isInteger(page) || page < 1) return club.fail(club.ERROR_CODE.PARAM_INVALID, 'page 不合法')
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > ACTIVITY_PAGE_SIZE_MAX) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, `page_size 需在 1~${ACTIVITY_PAGE_SIZE_MAX} 之间`)
    }

    const cmd = uniCloud.database().command
    const softDel = { deleted: cmd.neq(1) }

    // 1) 公告轮播：最新 5 条 published（P2-02 数据接入后启用）
    const bannerRes = await announcements()
      .where({ status: ANNOUNCEMENT_STATUS_PUBLISHED, ...softDel })
      .orderBy('created_at', 'desc')
      .limit(BANNER_LIMIT)
      .get()
    const banners = (bannerRes.data || []).map((item) => ({
      _id: item._id,
      title: item.title || '',
      content: item.content || '',
      banner: item.banner || '',
      created_at: item.created_at || null,
    }))

    // 2) 分类金刚区（sort 升序，最多 8 个）
    const catList = await loadCategoryNames()
    const categoryList = catList.slice(0, CATEGORY_LIMIT)
    const catNameById = new Map(catList.map((c) => [c._id, c.name]))

    // 社团字典（join 用：活动卡 club_name、招新 club_name/logo；热搜只取正常社团）
    const clubRes = await clubs().where({ status: 'normal', ...softDel }).limit(HOME_CANDIDATE_MAX).get()
    const clubRows = clubRes.data || []
    const clubNameById = new Map(clubRows.map((row) => [row._id, row.name]))
    const clubLogoById = new Map(clubRows.map((row) => [row._id, row.logo || '']))

    // 3) 精选/推荐活动：报名中按报名数倒序 + 分页
    const actRes = await activities()
      .where({ status: ACTIVITY_STATUS_SIGNUP, ...softDel })
      .limit(HOME_CANDIDATE_MAX)
      .get()
    const actRows = actRes.data || []
    const actIds = actRows.map((row) => row._id)
    const regMap = actIds.length
      ? await countByField('activity_registrations', 'activity_id', { activity_id: cmd.in(actIds), status: 'approved', ...softDel })
      : new Map()
    const sortedActs = actRows
      .map((row) => ({ row, count: regMap.get(row._id) || 0 }))
      .sort((a, b) => b.count - a.count || toTime(b.row.created_at) - toTime(a.row.created_at))
    const actTotal = sortedActs.length
    const actPage = sortedActs.slice((page - 1) * pageSize, page * pageSize).map(({ row, count }) =>
      publicActivity(row, count, clubNameById.get(row.club_id))
    )

    // 4) 热门社团：按成员数倒序 top 5（聚合候选上限对齐 2000）
    const clubIds = clubRows.map((row) => row._id)
    const memberMap = clubIds.length
      ? await countByField('club_members', 'club_id', { club_id: cmd.in(clubIds), status: 'active', ...softDel })
      : new Map()
    const activityMap = clubIds.length
      ? await countByField('activities', 'club_id', {
          club_id: cmd.in(clubIds),
          status: cmd.in(['approved', 'signup', 'ongoing', 'ended', 'archived']),
          ...softDel,
        })
      : new Map()
    const hotClubs = clubRows
      .map((row) => ({
        _id: row._id,
        name: row.name || '',
        logo: row.logo || '',
        intro: row.intro || '',
        category_name: catNameById.get(row.category_id) || '',
        star_level: Number(row.star_level || 0),
        member_count: memberMap.get(row._id) || 0,
        activity_count: activityMap.get(row._id) || 0,
      }))
      .sort((a, b) => b.member_count - a.member_count)
      .slice(0, HOT_CLUB_LIMIT)

    // 5) 招新推荐：开放中按截止时间升序 top 5（含剩余名额）
    const rcRes = await recruitments()
      .where({ status: RECRUITMENT_STATUS_OPEN, ...softDel })
      .limit(HOME_CANDIDATE_MAX)
      .get()
    const rcRows = rcRes.data || []
    const rcIds = rcRows.map((row) => row._id)
    const signupMap = rcIds.length
      ? await countByField('recruitment_registrations', 'recruitment_id', { recruitment_id: cmd.in(rcIds), ...softDel })
      : new Map()
    const recommendRcs = rcRows
      .map((row) => ({
        _id: row._id,
        title: row.title || '',
        club_id: row.club_id || '',
        club_name: clubNameById.get(row.club_id) || '',
        club_logo: clubLogoById.get(row.club_id) || '',
        signup_end: row.signup_end || null,
        capacity: row.capacity == null ? null : Number(row.capacity),
        signup_count: signupMap.get(row._id) || 0,
        /** 剩余名额：不限 → null */
        remaining: row.capacity == null ? null : Math.max(0, Number(row.capacity) - (signupMap.get(row._id) || 0)),
      }))
      .sort((a, b) => toTime(a.signup_end) - toTime(b.signup_end))
      .slice(0, RECOMMEND_RECRUITMENT_LIMIT)

    return club.ok({
      banners,
      categories: categoryList,
      activities: { list: actPage, total: actTotal, page, page_size: pageSize, has_more: page * pageSize < actTotal },
      clubs: hotClubs,
      recruitments: recommendRcs,
    })
  })

  return api.run()
}