/**
 * 通知域云函数（P0-05 骨架 / P1-04 通知触达引擎）
 * URL 化前缀 /message（网关剥离前缀后透传 event.path），路由按相对路径注册
 *
 * 引擎主体在公共模块 common/notify（各业务云函数内联后直接调用，不跨云函数 HTTP 调用）：
 *   const notify = require('./lib/notify')
 *   await notify.send({ userId, scene, bizId, vars })
 * 本云函数只暴露「运维自检」接口，供开发空间调通与降级验证（需求 2.4 验收）。
 * P1-21 消息中心的学生端接口（列表 / 已读 / 全部已读 / 未读数）在此扩展。
 *   GET /list（分类过滤 + 分页 + unread_total）、POST /read（单条已读）、
 *   POST /read-all（按分类全部已读）、GET /unread（分类未读数，供徽标）。
 */
'use strict'
const club = require('./lib/club-common')
const notify = require('./lib/notify')

/** 引擎自检权限：场景清单开放给审核员，测试下发与消息查询仅超管 */
const ADMIN_GUARD = [club.requireAuth(club.TOKEN_TYPES.ADMIN), club.requireRole(['super', 'auditor'])]
const SUPER_GUARD = [club.requireAuth(club.TOKEN_TYPES.ADMIN), club.requireRole(['super'])]

/** P1-21 消息中心（STU-07）：消息分类 / 分页 / 未读口径 */
const MESSAGE_TYPES = ['system', 'activity', 'recruitment']
const MESSAGE_TYPE_ALL = 'all'
const MESSAGE_PAGE_SIZE = 20
const MESSAGE_PAGE_SIZE_MAX = 50

function messages() {
  return uniCloud.database().collection('messages')
}

function publicMessage(row) {
  return {
    _id: row._id,
    user_id: row.user_id,
    type: row.type,
    scene: row.scene || '',
    title: row.title || '',
    content: row.content || '',
    biz_type: row.biz_type || '',
    biz_id: row.biz_id || '',
    push_status: row.push_status || '',
    push_error: row.push_error || '',
    pushed_at: row.pushed_at || null,
    is_read: !!row.is_read,
    created_at: row.created_at || null,
  }
}

/**
 * 未读数统计（按分类 + 总计；供列表回执与 Tab 未读徽标）
 * 软删口径统一 deleted != 1；is_read 由 notify 落库时恒写布尔，无缺省问题
 */
async function countUnread(userId) {
  const cmd = uniCloud.database().command
  const res = await messages()
    .aggregate()
    .match({ user_id: userId, is_read: false, deleted: cmd.neq(1) })
    .group({ _id: '$type', total: cmd.aggregate.sum(1) })
    .end()
  const count = { total: 0, system: 0, activity: 0, recruitment: 0 }
  for (const row of res.data || []) {
    const total = Number(row.total) || 0
    count.total += total
    if (MESSAGE_TYPES.includes(row._id)) count[row._id] += total
  }
  return count
}

exports.main = async (event) => {
  const api = club.createRouter(event)

  api.get('/ping', () => club.ok({ pong: 'message', time: Date.now() }))

  api.get('/me-example', club.requireAuth(club.TOKEN_TYPES.STUDENT), (ctx) =>
    club.ok({ channel: 'message', auth: ctx.auth })
  )

  // 场景与模板配置自检（P1-04）：列出 2.4 场景清单、对应模板环境变量与是否已配置
  api.get('/scenes', ...ADMIN_GUARD, () =>
    club.ok({
      scenes: notify.listScenes(),
      moments: notify.SUBSCRIBE_MOMENTS,
      push_status: notify.PUSH_STATUS,
    })
  )

  // 测试下发（P1-04 验收用）：向指定用户按场景走一次完整链路（站内必写 + 订阅消息可降级）
  api.post('/test-send', ...SUPER_GUARD, async (ctx) => {
    const err = club.checkParams(ctx.body, {
      user_id: { type: 'string', required: true, maxLen: 64 },
      scene: { type: 'string', required: true, maxLen: 64 },
      biz_id: { type: 'string', maxLen: 64 },
      vars: { type: 'object' },
    })
    if (err) return err
    if (!notify.sceneOf(ctx.body.scene)) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, `未知通知场景：${ctx.body.scene}`)
    }
    const userId = ctx.body.user_id.trim()
    const found = await uniCloud.database().collection('users').where({ _id: userId, deleted: 0 }).limit(1).get()
    const user = (found.data && found.data[0]) || null
    if (!user) return club.fail(club.ERROR_CODE.NOT_FOUND, '接收人不存在或已注销')

    const result = await notify.send({
      userId,
      scene: ctx.body.scene,
      bizId: ctx.body.biz_id || '',
      vars: ctx.body.vars || {},
    })
    return club.ok(result)
  })

  // 消息查询（P1-04 验收核对用）：按接收人看最近消息及其推送状态
  api.post('/logs', ...SUPER_GUARD, async (ctx) => {
    const err = club.checkParams(ctx.body, {
      user_id: { type: 'string', required: true, maxLen: 64 },
      limit: { type: 'int' },
    })
    if (err) return err
    const limit = ctx.body.limit === undefined ? 20 : Number(ctx.body.limit)
    if (limit < 1 || limit > 50) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, 'limit 需在 1~50 之间')
    }
    const res = await messages()
      .where({ user_id: ctx.body.user_id.trim(), deleted: 0 })
      .orderBy('created_at', 'desc')
      .limit(limit)
      .get()
    return club.ok({ list: (res.data || []).map(publicMessage), limit })
  })

  /* ============================================================
   * P1-21 消息中心（STU-07）：学生端 列表 / 已读 / 全部已读 / 未读数
   * 浏览（列表 / 未读数）用 requireAuth(STUDENT)——被禁用用户仍可查看消息；
   * 已读 / 全部已读属写操作，用 requireActiveStudent（对齐「禁用用户仅可浏览」）。
   * ============================================================ */

  // 消息列表（分类过滤 + 时间倒序 + 分页；回执含全量未读数）
  api.get('/list', club.requireAuth(club.TOKEN_TYPES.STUDENT), async (ctx) => {
    const type = (ctx.query && ctx.query.type) || MESSAGE_TYPE_ALL
    if (![MESSAGE_TYPE_ALL].concat(MESSAGE_TYPES).includes(type)) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, 'type 取值不合法')
    }
    const page = ctx.query.page === undefined ? 1 : Number(ctx.query.page)
    const pageSize = ctx.query.page_size === undefined ? MESSAGE_PAGE_SIZE : Number(ctx.query.page_size)
    if (!Number.isInteger(page) || page < 1) return club.fail(club.ERROR_CODE.PARAM_INVALID, 'page 不合法')
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MESSAGE_PAGE_SIZE_MAX) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, `page_size 需在 1~${MESSAGE_PAGE_SIZE_MAX} 之间`)
    }

    const cmd = uniCloud.database().command
    const userId = ctx.auth.userId
    const base = { user_id: userId, deleted: cmd.neq(1) }
    const where = type === MESSAGE_TYPE_ALL ? base : { ...base, type }

    const counted = await messages().where(where).count()
    const total = Number((counted && counted.total) || 0)
    const res = await messages()
      .where(where)
      .orderBy('created_at', 'desc')
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .get()
    const unread = await countUnread(userId)
    return club.ok({
      list: (res.data || []).map(publicMessage),
      total,
      page,
      page_size: pageSize,
      has_more: page * pageSize < total,
      unread_total: unread.total,
    })
  })

  // 单条已读（幂等；校验归属当前用户）
  api.post('/read', club.requireActiveStudent(), async (ctx) => {
    const err = club.checkParams(ctx.body, { message_id: { type: 'string', required: true, maxLen: 64 } })
    if (err) return err
    const messageId = ctx.body.message_id.trim()
    const userId = ctx.user._id
    const cmd = uniCloud.database().command

    const found = await messages().where({ _id: messageId, user_id: userId, deleted: cmd.neq(1) }).limit(1).get()
    const row = (found.data && found.data[0]) || null
    if (!row) return club.fail(club.ERROR_CODE.NOT_FOUND, '消息不存在')

    let updated = 0
    if (!row.is_read) {
      const upd = await messages().doc(row._id).update({ is_read: true, updated_at: new Date() })
      updated = Number((upd && upd.updated) || 0)
    }
    const unread = await countUnread(userId)
    return club.ok({ updated, unread_total: unread.total })
  })

  // 全部已读（可按分类）
  api.post('/read-all', club.requireActiveStudent(), async (ctx) => {
    const type = (ctx.body && ctx.body.type) || MESSAGE_TYPE_ALL
    if (![MESSAGE_TYPE_ALL].concat(MESSAGE_TYPES).includes(type)) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, 'type 取值不合法')
    }
    const userId = ctx.user._id
    const cmd = uniCloud.database().command
    const base = { user_id: userId, is_read: false, deleted: cmd.neq(1) }
    const where = type === MESSAGE_TYPE_ALL ? base : { ...base, type }
    const upd = await messages().where(where).update({ is_read: true, updated_at: new Date() })
    const updated = Number((upd && upd.updated) || 0)
    const unread = await countUnread(userId)
    return club.ok({ updated, unread_total: unread.total })
  })

  // 未读数（含分类计数；Tab 徽标 / tabBar 角标）
  api.get('/unread', club.requireAuth(club.TOKEN_TYPES.STUDENT), async (ctx) => {
    const unread = await countUnread(ctx.auth.userId)
    return club.ok({ ...unread })
  })

  return api.run()
}
