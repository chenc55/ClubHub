/**
 * 内容监管域云函数（P1-26 / ADM-05）
 *
 * URL 化前缀 /moderation（网关剥离前缀后透传 event.path），路由按相对路径注册：
 *   GET  /list      → 对外 GET  /moderation/list       动态流 + 疑似队列 + 回收站（分页 / 筛选 / 关键词）
 *   POST /review    → 对外 POST /moderation/review     疑似队列复核（clear 合规移除标记 / take_down 违规下架并通知）
 *   POST /take-down → 对外 POST /moderation/take-down  下架动态（status=taken_down，通知社团负责人）
 *   POST /restore   → 对外 POST /moderation/restore    恢复（published + deleted=0 + 清除疑似标记）
 *   POST /delete    → 对外 POST /moderation/delete     删除违规（软删 deleted=1，可还原）
 *
 * 说明（需求 4.3.3 内容监管）：
 * - 社团动态「先发后审」：published 后由敏感词引擎置 flagged 进入疑似队列（数据源 P2-01 接入，本域先行建框架）；
 * - 下架 / 恢复、删除违规（软删 deleted=1 可还原）；严重违规封禁 / 停用社团复用 club 域 POST /club/ban；
 * - 管理通道：requireAuth(ADMIN) + requireRole(['super','auditor'])，对齐 admin 域 OPS_GUARD；
 * - 下架 / 违规复核均通知社团负责人（club_members role ∈ president/officer 且 active），场景 club_post_taken_down；
 * - 软删口径统一 deleted != 1 为「有效」；回收站视图（deleted=1）供误删还原。
 */
'use strict'
const club = require('./lib/club-common')
const notify = require('./lib/notify')

/** 管理通道守卫：超级管理员 / 审核员 */
const MGR_GUARD = [club.requireAuth(club.TOKEN_TYPES.ADMIN), club.requireRole(['super', 'auditor'])]

/** 动态状态（club_posts.status，需求 7.2） */
const POST_STATUS = { PUBLISHED: 'published', TAKEN_DOWN: 'taken_down' }
/** 列表筛选视图 */
const VIEW = { ALL: 'all', FLAGGED: 'flagged', TAKEN_DOWN: 'taken_down', DELETED: 'deleted' }
/** 疑似复核动作 */
const REVIEW_ACTION = { CLEAR: 'clear', TAKE_DOWN: 'take_down' }
/** 内容关键词长度上限 */
const KEYWORD_MAX = 20
/** 列表分页默认与上限 */
const PAGE_SIZE_DEFAULT = 20
const PAGE_SIZE_MAX = 100

function posts() {
  return uniCloud.database().collection('club_posts')
}

function clubs() {
  return uniCloud.database().collection('clubs')
}

function clubMembers() {
  return uniCloud.database().collection('club_members')
}

function toTime(value) {
  if (!value) return 0
  const raw = typeof value === 'object' && value.$date ? value.$date : value
  const time = new Date(raw).getTime()
  return Number.isNaN(time) ? 0 : time
}

/** 动态监管行：join 社团名；deleted=1 标记回收 */
function publicPost(row, clubName) {
  return {
    _id: row._id,
    club_id: row.club_id,
    club_name: clubName || '',
    content: row.content || '',
    images: row.images || [],
    status: row.status || POST_STATUS.PUBLISHED,
    flagged: !!row.flagged,
    published_at: row.published_at || null,
    deleted: Number(row.deleted || 0),
    created_at: row.created_at || null,
  }
}

async function findPostById(postId) {
  const res = await posts().where({ _id: postId }).limit(1).get()
  return (res.data && res.data[0]) || null
}

/** 社团负责人（社长 / 干部，active）——下架 / 违规通知的接收人 */
async function loadClubOfficers(clubId) {
  const cmd = uniCloud.database().command
  const res = await clubMembers()
    .where({ club_id: clubId, status: 'active', role: cmd.in(['president', 'officer']), deleted: 0 })
    .get()
  return (res.data || []).map((m) => m.user_id)
}

/** 向社团负责人发站内通知（去重键 scene + post_id，每个负责人一条） */
async function notifyOfficers(clubId, postId, vars) {
  const officerIds = await loadClubOfficers(clubId)
  if (!officerIds.length) return { sent: 0 }
  let sent = 0
  for (const userId of officerIds) {
    const result = await notify.send({ userId, scene: 'club_post_taken_down', bizId: postId, vars })
    if (!result.duplicate) sent += 1
  }
  return { sent, officers: officerIds.length }
}

/** 分页参数（GET 查询串均为字符串，手动归一） */
function splitPage(ctx) {
  const page = ctx.query.page === undefined ? 1 : Number(ctx.query.page)
  const pageSize = ctx.query.page_size === undefined ? PAGE_SIZE_DEFAULT : Number(ctx.query.page_size)
  if (!Number.isInteger(page) || page < 1) return { error: club.fail(club.ERROR_CODE.PARAM_INVALID, 'page 不合法') }
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > PAGE_SIZE_MAX) {
    return { error: club.fail(club.ERROR_CODE.PARAM_INVALID, `page_size 需在 1~${PAGE_SIZE_MAX} 之间`) }
  }
  return { page, pageSize }
}

exports.main = async (event) => {
  const api = club.createRouter(event)

  // 健康检查（无需鉴权）
  api.get('/ping', () => club.ok({ pong: 'moderation', time: Date.now() }))

  /* --------------------------------------------
   * 动态监管列表（动态流 / 疑似队列 / 已下架 / 回收站）
   * -------------------------------------------- */
  api.get('/list', ...MGR_GUARD, async (ctx) => {
    const sp = splitPage(ctx)
    if (sp.error) return sp.error
    const view = String((ctx.query.view || VIEW.ALL) || '').trim()
    if (!Object.values(VIEW).includes(view)) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, `view 取值不合法：${Object.values(VIEW).join(' / ')}`)
    }
    const keyword = String((ctx.query.keyword || '')).trim()
    if (keyword.length > KEYWORD_MAX) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, `关键词最长 ${KEYWORD_MAX} 字`)
    }

    const cond = {}
    if (view === VIEW.FLAGGED) {
      cond.flagged = true
      cond.deleted = 0
    } else if (view === VIEW.TAKEN_DOWN) {
      cond.status = POST_STATUS.TAKEN_DOWN
      cond.deleted = 0
    } else if (view === VIEW.DELETED) {
      cond.deleted = 1
    } else {
      // 动态流 = 全部（含已删除，供回收还原）
    }
    if (keyword) cond.content = new RegExp(club.escapeRegExp(keyword), 'i')

    const totalRes = await posts().where(cond).count()
    const total = totalRes.total || 0
    const listRes = await posts()
      .where(cond)
      .orderBy('published_at', 'desc')
      .orderBy('_id', 'desc')
      .skip((sp.page - 1) * sp.pageSize)
      .limit(sp.pageSize)
      .get()
    const rows = (listRes.data || []).map((row) => ({ row, club_id: row.club_id }))
    const clubIds = [...new Set(rows.map((r) => r.club_id))]
    const clubNameById = new Map()
    if (clubIds.length) {
      const cmd = uniCloud.database().command
      const clubRes = await clubs().where({ _id: cmd.in(clubIds) }).field({ name: true }).get()
      for (const c of clubRes.data || []) clubNameById.set(c._id, c.name || '')
    }

    return club.ok({
      list: rows.map(({ row }) => publicPost(row, clubNameById.get(row.club_id))),
      total,
      page: sp.page,
      page_size: sp.pageSize,
      has_more: sp.page * sp.pageSize < total,
    })
  })

  /* --------------------------------------------
   * 疑似队列复核（clear 合规移除标记 / take_down 违规下架并通知）
   * -------------------------------------------- */
  api.post('/review', ...MGR_GUARD, async (ctx) => {
    const err = club.checkParams(ctx.body, {
      post_id: { type: 'string', required: true, maxLen: 64 },
      action: { type: 'string', required: true, enum: Object.values(REVIEW_ACTION) },
    })
    if (err) return err

    const target = await findPostById(ctx.body.post_id.trim())
    if (!target || Number(target.deleted || 0) === 1) {
      return club.fail(club.ERROR_CODE.NOT_FOUND, '动态不存在或已删除')
    }
    if (!target.flagged) {
      return club.fail(club.ERROR_CODE.STATUS_INVALID, '该动态不在疑似队列，无需复核')
    }

    if (ctx.body.action === REVIEW_ACTION.CLEAR) {
      // 合规：仅移除疑似标记，动态保持发布
      await posts().doc(target._id).update({ flagged: false, updated_at: new Date() })
      return club.ok({ post: publicPost({ ...target, flagged: false }, '') })
    }

    // 违规：下架并通知社团负责人
    const patch = { status: POST_STATUS.TAKEN_DOWN, flagged: false, updated_at: new Date() }
    await posts().doc(target._id).update(patch)
    const clubRow = await clubs().where({ _id: target.club_id }).field({ name: true }).limit(1).get()
    const clubName = (clubRow.data && clubRow.data[0] && clubRow.data[0].name) || ''
    const notified = await notifyOfficers(target.club_id, target._id, {
      club_name: clubName,
      post_id: target._id,
    })
    return club.ok({
      post: publicPost({ ...target, ...patch }, clubName),
      notified,
    })
  })

  /* --------------------------------------------
   * 下架（违规 / 疑似违规处置；通知社团负责人）
   * -------------------------------------------- */
  api.post('/take-down', ...MGR_GUARD, async (ctx) => {
    const err = club.checkParams(ctx.body, { post_id: { type: 'string', required: true, maxLen: 64 } })
    if (err) return err

    const target = await findPostById(ctx.body.post_id.trim())
    if (!target || Number(target.deleted || 0) === 1) {
      return club.fail(club.ERROR_CODE.NOT_FOUND, '动态不存在或已删除')
    }
    if (target.status === POST_STATUS.TAKEN_DOWN) {
      return club.fail(club.ERROR_CODE.STATUS_INVALID, '该动态已下架')
    }

    const patch = { status: POST_STATUS.TAKEN_DOWN, flagged: false, updated_at: new Date() }
    await posts().doc(target._id).update(patch)
    const clubRow = await clubs().where({ _id: target.club_id }).field({ name: true }).limit(1).get()
    const clubName = (clubRow.data && clubRow.data[0] && clubRow.data[0].name) || ''
    const notified = await notifyOfficers(target.club_id, target._id, { club_name: clubName, post_id: target._id })
    return club.ok({ post: publicPost({ ...target, ...patch }, clubName), notified })
  })

  /* --------------------------------------------
   * 恢复（下架恢复 / 误删还原：status=published + deleted=0 + 清除疑似）
   * -------------------------------------------- */
  api.post('/restore', ...MGR_GUARD, async (ctx) => {
    const err = club.checkParams(ctx.body, { post_id: { type: 'string', required: true, maxLen: 64 } })
    if (err) return err

    const target = await findPostById(ctx.body.post_id.trim())
    if (!target) return club.fail(club.ERROR_CODE.NOT_FOUND, '动态不存在')
    const wasDeleted = Number(target.deleted || 0) === 1
    if (target.status === POST_STATUS.PUBLISHED && !wasDeleted) {
      return club.fail(club.ERROR_CODE.STATUS_INVALID, '该动态已是发布状态')
    }

    const patch = { status: POST_STATUS.PUBLISHED, deleted: 0, flagged: false, updated_at: new Date() }
    await posts().doc(target._id).update(patch)
    const clubRow = await clubs().where({ _id: target.club_id }).field({ name: true }).limit(1).get()
    const clubName = (clubRow.data && clubRow.data[0] && clubRow.data[0].name) || ''
    return club.ok({ post: publicPost({ ...target, ...patch }, clubName), restored_from_deleted: wasDeleted })
  })

  /* --------------------------------------------
   * 删除违规（软删 deleted=1，可还原）
   * -------------------------------------------- */
  api.post('/delete', ...MGR_GUARD, async (ctx) => {
    const err = club.checkParams(ctx.body, { post_id: { type: 'string', required: true, maxLen: 64 } })
    if (err) return err

    const target = await findPostById(ctx.body.post_id.trim())
    if (!target) return club.fail(club.ERROR_CODE.NOT_FOUND, '动态不存在')
    if (Number(target.deleted || 0) === 1) {
      return club.fail(club.ERROR_CODE.STATUS_INVALID, '该动态已删除')
    }

    const patch = { deleted: 1, updated_at: new Date() }
    await posts().doc(target._id).update(patch)
    const clubRow = await clubs().where({ _id: target.club_id }).field({ name: true }).limit(1).get()
    const clubName = (clubRow.data && clubRow.data[0] && clubRow.data[0].name) || ''
    return club.ok({ post: publicPost({ ...target, ...patch }, clubName) })
  })

  return api.run()
}