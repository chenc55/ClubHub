/**
 * 公告域云函数（P2-02 / ADM-06）
 *
 * URL 化前缀 /announcement（网关剥离前缀后透传 event.path），路由按相对路径注册：
 *   GET  /ping     → 对外 GET  /announcement/ping           健康检查（公开）
 *   POST /upload   → 对外 POST /announcement/upload         公告 Banner 上传（管理通道）
 *   POST /publish  → 对外 POST /announcement/publish        发布公告（管理通道，敏感词先审后发拦截）
 *   GET  /list     → 对外 GET  /announcement/list           公告列表（管理通道，分页 + 状态筛选 + 关键词）
 *   POST /offline  → 对外 POST /announcement/offline        下架公告（管理通道，实时移出首页 Banner）
 *   GET  /detail   → 对外 GET  /announcement/detail?id=     公告详情（公开，仅 published 可见）
 *
 * 业务口径（需求 ADM-06 / 4.3.4）：
 * - 管理员发布 → 写入 announcements（status=published）+ 站内系统通知全体已认证用户
 *   （notify 场景 announcement_published，biz_type=announcement，点击跳公告详情页）+ 首页 Banner（home 域自动取最新 5 条）；
 * - 敏感词（2.5 先审后发）：命中 block / review 一律拦截，提示修改后重新提交；
 * - 下架 status=offline → home 域 banners 实时移出；
 * - 管理通道：requireAuth(ADMIN) + requireRole(['super','auditor'])，对齐 admin 域 OPS_GUARD；
 * - 软删口径统一 deleted != 1 为「有效」。
 */
'use strict'
const club = require('./lib/club-common')
const notify = require('./lib/notify')
const filter = require('./lib/sensitive-filter')

/** 标题 / 正文长度上限 */
const TITLE_MAX = 60
const CONTENT_MAX = 5000
/** 列表关键词长度上限 */
const KEYWORD_MAX = 20
/** 列表分页默认与上限 */
const PAGE_SIZE_DEFAULT = 20
const PAGE_SIZE_MAX = 100
/** Banner URL 长度上限 */
const BANNER_URL_MAX = 500
/** 站内通知摘要截断长度 */
const SUMMARY_MAX = 60

/** 公告状态 */
const STATUS = { PUBLISHED: 'published', OFFLINE: 'offline' }

/** 管理通道守卫：超级管理员 / 审核员 */
const MGR_GUARD = [club.requireAuth(club.TOKEN_TYPES.ADMIN), club.requireRole(['super', 'auditor'])]

/* ============================================================
 * 公告 Banner 上传（管理通道；规格对齐《功能需求.md》2.6）
 * 说明：管理端（Web）无学生 token，不能复用 /user/upload（requireActiveStudent），
 * 故本域提供同构的管理上传通道，scene 仅允许 announcement_banner。
 * ============================================================ */
const UPLOAD_SCENES = {
  announcement_banner: { count: 1, maxMB: 5, accept: ['jpg', 'jpeg', 'png', 'webp'] },
}

// 单张体积上限：URL 化网关请求体上限实测约 1.43MB（JSON），base64 膨胀约 33%，取 950KB 原图上限
const UPLOAD_MAX_BYTES = 950 * 1024

/** 批量通知分批大小（避免单次拉取过多用户） */
const NOTIFY_BATCH = 200

function announcements() {
  return uniCloud.database().collection('announcements')
}

function users() {
  return uniCloud.database().collection('users')
}

function admins() {
  return uniCloud.database().collection('admins')
}

function dateKey() {
  const d = now()
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}

/** 取云存储可访问 URL（阿里云云存储文件按路径公开可读） */
async function storageUrl(fileID) {
  try {
    const res = await uniCloud.getTempFileURL({ fileList: [fileID] })
    const item = res && res.fileList && res.fileList[0]
    return (item && (item.tempFileURL || item.download_url)) || ''
  } catch (e) {
    return ''
  }
}

function now() {
  return new Date()
}

function toTime(value) {
  if (!value) return 0
  const raw = typeof value === 'object' && value.$date ? value.$date : value
  const time = new Date(raw).getTime()
  return Number.isNaN(time) ? 0 : time
}

/** 公告公开行（列表 / 详情共用） */
function publicAnnouncement(row, publisherName) {
  return {
    _id: row._id,
    title: row.title || '',
    content: row.content || '',
    banner: row.banner || '',
    status: row.status || STATUS.PUBLISHED,
    publisher: row.publisher || '',
    publisher_name: publisherName || '',
    published_at: row.published_at || null,
    created_at: row.created_at || null,
  }
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

/** 是否合法 URL（公告 Banner 服务端复校） */
function isValidUrl(value) {
  return /^https?:\/\/[^\s]+$/i.test(String(value || '').trim())
}

/** 向全体已认证且未禁用用户发站内通知（去重键 scene + 公告 _id，分页批量） */
async function notifyAllVerifiedUsers(announcementId, title, summary) {
  const vars = {
    announcement_title: title,
    announcement_summary: summary,
    announcement_id: announcementId,
  }
  let recipients = 0
  let sent = 0
  let duplicates = 0
  let offset = 0
  for (;;) {
    const res = await users()
      .where({ auth_status: 'verified', status: 'normal', deleted: 0 })
      .field({ _id: true })
      .skip(offset)
      .limit(NOTIFY_BATCH)
      .get()
    const rows = res.data || []
    if (!rows.length) break
    recipients += rows.length
    for (const row of rows) {
      const result = await notify.send({ userId: row._id, scene: 'announcement_published', bizId: announcementId, vars })
      if (result.duplicate) duplicates += 1
      else sent += 1
    }
    if (rows.length < NOTIFY_BATCH) break
    offset += rows.length
  }
  return { recipients, sent, duplicates }
}

exports.main = async (event) => {
  const api = club.createRouter(event)

  // 健康检查（无需鉴权）
  api.get('/ping', () => club.ok({ pong: 'announcement', time: Date.now() }))

  /* --------------------------------------------
   * Banner 上传（管理通道，scene=announcement_banner）
   * 通道说明：阿里云 URL 化网关自行消费 multipart 且不透传原始 body，故统一走 JSON（base64）通道
   * -------------------------------------------- */
  api.post('/upload', ...MGR_GUARD, async (ctx) => {
    const err = club.checkParams(ctx.body, {
      scene: { type: 'string', required: true, maxLen: 32 },
      base64: { type: 'string', required: true },
      filename: { type: 'string', maxLen: 128 },
      mime: { type: 'string', maxLen: 64 },
    })
    if (err) return err

    const sceneKey = ctx.body.scene
    const scene = UPLOAD_SCENES[sceneKey]
    if (!scene) return club.fail(club.ERROR_CODE.PARAM_INVALID, '上传场景不合法')

    const ext = club.fileExt(ctx.body.filename, ctx.body.mime)
    if (!ext || scene.accept.indexOf(ext) === -1) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, `仅支持 ${scene.accept.join(' / ')} 格式`)
    }

    let file
    try {
      file = Buffer.from(ctx.body.base64, 'base64')
    } catch (e) {
      file = null
    }
    if (!file || !file.length) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, '图片内容为空或格式不正确')
    }
    if (file.length > UPLOAD_MAX_BYTES) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, '图片体积超出上限，请更换图片后重试')
    }

    const rand = Math.random().toString(36).slice(2, 8)
    const cloudPath = `clubhub/${sceneKey}/${dateKey()}/${ctx.auth.adminId}-${Date.now()}-${rand}.${ext}`
    let uploaded
    try {
      uploaded = await uniCloud.uploadFile({
        cloudPath,
        fileContent: file,
        cloudPathAsRealPath: true,
      })
    } catch (e) {
      console.error('[announcement] uploadFile failed', e && e.message)
      return club.fail(club.ERROR_CODE.INTERNAL, '上传失败，请稍后重试')
    }
    const url = await storageUrl(uploaded.fileID)
    if (!url) return club.fail(club.ERROR_CODE.INTERNAL, '上传成功但获取访问地址失败，请稍后重试')
    return club.ok({ fileID: uploaded.fileID, url, size: file.length, ext, scene: sceneKey })
  })

  /* --------------------------------------------
   * 发布公告（管理通道）
   * 先审后发：title + content 走敏感词 PRE_REVIEW 决策，命中 block / review 一律拦截；
   * 通过后落库 published，并批量通知全体已认证用户 + 首页 Banner 自动接通（home 域读库）。
   * -------------------------------------------- */
  api.post('/publish', ...MGR_GUARD, async (ctx) => {
    const err = club.checkParams(ctx.body, {
      title: { type: 'string', required: true, maxLen: TITLE_MAX },
      content: { type: 'string', required: true, maxLen: CONTENT_MAX },
      banner: { type: 'string', maxLen: BANNER_URL_MAX },
    })
    if (err) return err

    const title = String(ctx.body.title).trim()
    const content = String(ctx.body.content).trim()
    if (!title) return club.fail(club.ERROR_CODE.PARAM_INVALID, '公告标题不能为空')
    if (!content) return club.fail(club.ERROR_CODE.PARAM_INVALID, '公告内容不能为空')
    const banner = String(ctx.body.banner || '').trim()
    if (banner && !isValidUrl(banner)) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, 'Banner 图片地址不合法')
    }

    // 敏感词先审后发：命中 block / review 一律拦截
    const result = await filter.checkContent({ title, body: content, extras: [] })
    const decision = filter.decideByMode(filter.PUBLISH_MODES.PRE_REVIEW, result)
    if (!decision.allowed) {
      const hit = (result.hits && result.hits[0] && result.hits[0].word) || ''
      return club.fail(club.ERROR_CODE.PARAM_INVALID, `内容含违规词${hit ? `（${hit}）` : ''}，请修改后重新提交`)
    }

    const timestamp = now()
    const added = await announcements().add({
      title,
      content,
      banner,
      status: STATUS.PUBLISHED,
      publisher: ctx.auth.adminId,
      published_at: timestamp,
      created_at: timestamp,
      deleted: 0,
    })
    const announcementId = added.id

    // 批量站内通知全体已认证用户（subscribe 未配置 / 被拒 / 失败由 notify 自动降级，不阻断发布）
    const summary = content.length > SUMMARY_MAX ? `${content.slice(0, SUMMARY_MAX)}…` : content
    const notified = await notifyAllVerifiedUsers(announcementId, title, summary)

    return club.ok({
      _id: announcementId,
      title,
      status: STATUS.PUBLISHED,
      published_at: timestamp,
      notified: notified.sent,
      recipients: notified.recipients,
    })
  })

  /* --------------------------------------------
   * 公告列表（管理通道）：分页 + 状态筛选（all/published/offline）+ 关键词（标题）
   * -------------------------------------------- */
  api.get('/list', ...MGR_GUARD, async (ctx) => {
    const sp = splitPage(ctx)
    if (sp.error) return sp.error

    const where = { deleted: 0 }
    const status = ctx.query.status === undefined ? 'all' : String(ctx.query.status)
    if (status === STATUS.PUBLISHED || status === STATUS.OFFLINE) where.status = status
    else if (status !== 'all') {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, 'status 取值仅支持 all / published / offline')
    }

    const keyword = String(ctx.query.keyword || '').trim()
    if (keyword) {
      if (keyword.length > KEYWORD_MAX) {
        return club.fail(club.ERROR_CODE.PARAM_INVALID, `关键词最长 ${KEYWORD_MAX} 字`)
      }
      // 标题模糊匹配
      const match = { title: new RegExp(keyword) }
      where.title = match.title
    }

    const base = announcements().where(where)
    const totalRes = await base.count()
    const listRes = await base.orderBy('created_at', 'desc').skip((sp.page - 1) * sp.pageSize).limit(sp.pageSize).get()

    const rows = listRes.data || []
    const pubIds = [...new Set(rows.map((row) => row.publisher).filter(Boolean))]
    const adminNameById = new Map()
    if (pubIds.length) {
      const cmd = uniCloud.database().command
      const adminRes = await admins()
        .where({ _id: cmd.in(pubIds), deleted: 0 })
        .field({ _id: true, name: true, username: true })
        .get()
      for (const admin of adminRes.data || []) {
        adminNameById.set(admin._id, admin.name || admin.username || '')
      }
    }

    return club.ok({
      list: rows.map((row) => publicAnnouncement(row, adminNameById.get(row.publisher))),
      total: Number((totalRes && totalRes.total) || 0),
      page: sp.page,
      page_size: sp.pageSize,
    })
  })

  /* --------------------------------------------
   * 下架公告（管理通道）：status=offline → home 域 banners 实时移出（幂等）
   * -------------------------------------------- */
  api.post('/offline', ...MGR_GUARD, async (ctx) => {
    const id = String((ctx.body && ctx.body.id) || '').trim()
    if (!id) return club.fail(club.ERROR_CODE.PARAM_INVALID, '公告 ID 不能为空')

    const res = await announcements().where({ _id: id, deleted: 0 }).limit(1).get()
    const row = res.data && res.data[0]
    if (!row) return club.fail(club.ERROR_CODE.NOT_FOUND, '公告不存在或已删除')

    if (row.status === STATUS.OFFLINE) {
      return club.ok({ _id: id, status: STATUS.OFFLINE, already: true })
    }

    await announcements().doc(id).update({ status: STATUS.OFFLINE })
    return club.ok({ _id: id, status: STATUS.OFFLINE })
  })

  /* --------------------------------------------
   * 公告详情（公开，游客可看）：仅 published 且未软删可见
   * -------------------------------------------- */
  api.get('/detail', async (ctx) => {
    const id = String((ctx.query && ctx.query.id) || '').trim()
    if (!id) return club.fail(club.ERROR_CODE.PARAM_INVALID, '公告 ID 不能为空')

    const res = await announcements().where({ _id: id, status: STATUS.PUBLISHED, deleted: 0 }).limit(1).get()
    const row = res.data && res.data[0]
    if (!row) return club.fail(club.ERROR_CODE.NOT_FOUND, '公告不存在或已下架')

    return club.ok(publicAnnouncement(row, ''))
  })

  return api.run()
}
