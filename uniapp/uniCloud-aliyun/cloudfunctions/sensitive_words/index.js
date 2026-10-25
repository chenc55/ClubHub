/**
 * 敏感词库管理域云函数（P1-25 / ADM-09）
 *
 * URL 化前缀 /sensitive_words（网关剥离前缀后透传 event.path），路由按相对路径注册：
 *   GET  /list   → 对外 GET  /sensitive_words/list
 *   POST /save   → 对外 POST /sensitive_words/save
 *   POST /delete → 对外 POST /sensitive_words/delete
 *
 * 说明：
 * - 管理通道：requireAuth(ADMIN) + requireRole(['super','auditor'])，对齐 admin 域 OPS_GUARD；
 * - 集合 sensitive_words（需求 7.2）：word 唯一索引、level: block 拦截 / review 送审、软删除 deleted；
 * - save 按 word 聚合（唯一索引语义一致：不存在即新增，未软删同词仅改等级，软删同词复活）；
 * - 写成功后调用 sensitive-filter.refreshSensitiveWords() 让当前实例立即生效
 *   （其余实例最长 10s 后生效，见 common/sensitive-filter 缓存策略；活动/招新/公告/动态共用此词库）。
 */
'use strict'
const club = require('./lib/club-common')
const filter = require('./lib/sensitive-filter')

/** 管理通道守卫：超级管理员 / 审核员 */
const MGR_GUARD = [club.requireAuth(club.TOKEN_TYPES.ADMIN), club.requireRole(['super', 'auditor'])]

/** 列表分页默认与上限 */
const PAGE_SIZE_DEFAULT = 20
const PAGE_SIZE_MAX = 100
/** 词条长度上限（trim 后） */
const WORD_MAX = 30
/** 列表关键词长度上限 */
const KEYWORD_MAX = 20
/** 词条等级枚举 */
const LEVELS = [filter.LEVEL_BLOCK, filter.LEVEL_REVIEW]

function words() {
  return uniCloud.database().collection('sensitive_words')
}

function publicWord(row) {
  return {
    _id: row._id,
    word: row.word,
    level: row.level,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  }
}

/** 分词页与 page_size（GET 查询串均为字符串，手动归一；失败返回 { error } 响应） */
function splitPage(ctx, fallbackMax) {
  const page = ctx.query.page === undefined ? 1 : Number(ctx.query.page)
  const pageSize = ctx.query.page_size === undefined ? PAGE_SIZE_DEFAULT : Number(ctx.query.page_size)
  if (!Number.isInteger(page) || page < 1) return { error: club.fail(club.ERROR_CODE.PARAM_INVALID, 'page 不合法') }
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > fallbackMax) {
    return { error: club.fail(club.ERROR_CODE.PARAM_INVALID, `page_size 需在 1~${fallbackMax} 之间`) }
  }
  return { page, pageSize }
}

exports.main = async (event) => {
  const api = club.createRouter(event)

  // 健康检查（无需鉴权）
  api.get('/ping', () => club.ok({ pong: 'sensitive_words', time: Date.now() }))

  /* --------------------------------------------
   * 词条列表（分页 + 可选关键词精确子串匹配）
   * -------------------------------------------- */
  api.get('/list', ...MGR_GUARD, async (ctx) => {
    const sp = splitPage(ctx, PAGE_SIZE_MAX)
    if (sp.error) return sp.error
    const keyword = String((ctx.query.keyword || '')).trim()
    if (keyword.length > KEYWORD_MAX) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, `关键词最长 ${KEYWORD_MAX} 字`)
    }

    let cond = { deleted: 0 }
    if (keyword) cond.word = new RegExp(club.escapeRegExp(keyword), 'i')

    const totalRes = await words().where(cond).count()
    const total = totalRes.total || 0
    const listRes = await words()
      .where(cond)
      .orderBy('created_at', 'desc')
      .skip((sp.page - 1) * sp.pageSize)
      .limit(sp.pageSize)
      .get()
    return club.ok({
      list: (listRes.data || []).map(publicWord),
      total,
      page: sp.page,
      page_size: sp.pageSize,
      has_more: sp.page * sp.pageSize < total,
    })
  })

  /* --------------------------------------------
   * 新增 / 改等级 / 复活（word 唯一）
   * -------------------------------------------- */
  api.post('/save', ...MGR_GUARD, async (ctx) => {
    const err = club.checkParams(ctx.body, {
      word: { type: 'string', required: true, maxLen: WORD_MAX },
      level: { type: 'string', required: true, enum: LEVELS },
    })
    if (err) return err

    const word = String(ctx.body.word).trim()
    if (!word) return club.fail(club.ERROR_CODE.PARAM_INVALID, '词条不能为空白')

    const existing = await words().where({ word }).limit(1).get()
    const now = new Date()
    let row = (existing.data && existing.data[0]) || null

    if (!row) {
      const added = await words().add({
        word,
        level: ctx.body.level,
        created_at: now,
        updated_at: now,
        deleted: 0,
      })
      row = { _id: added.id, word, level: ctx.body.level, created_at: now, updated_at: now }
      await filter.refreshSensitiveWords()
      return club.ok({ word: publicWord(row), created: true, revived: false })
    }

    // 未软删 → 仅改等级（词条不变）；软删 → 复活并覆盖等级
    const revived = Number(row.deleted || 0) === 1
    const previousLevel = row.level
    const patch = { level: ctx.body.level, updated_at: now, deleted: 0 }
    try {
      await words().doc(row._id).update(patch)
    } catch (e) {
      // 兜底：word 唯一索引几乎不会与本逻辑冲突（先查后写），异常时给出明确提示
      return club.fail(club.ERROR_CODE.STATUS_INVALID, '词条保存失败，请重试')
    }
    await filter.refreshSensitiveWords()
    return club.ok({
      word: publicWord({ ...row, ...patch }),
      created: false,
      revived,
      previous_level: previousLevel,
    })
  })

  /* --------------------------------------------
   * 删除（软删，word 唯一标识；不存在可幂等）
   * -------------------------------------------- */
  api.post('/delete', ...MGR_GUARD, async (ctx) => {
    const err = club.checkParams(ctx.body, {
      word: { type: 'string', required: true, maxLen: WORD_MAX },
    })
    if (err) return err
    const word = String(ctx.body.word).trim()
    if (!word) return club.fail(club.ERROR_CODE.PARAM_INVALID, '词条不能为空白')

    const existing = await words().where({ word }).limit(1).get()
    const row = (existing.data && existing.data[0]) || null
    if (!row || Number(row.deleted || 0) === 1) {
      // 已删除 / 不存在视为幂等成功（列表已不在，避免前端重复点击报错）
      return club.ok({ word, deleted: false })
    }
    await words().doc(row._id).update({ deleted: 1, updated_at: new Date() })
    await filter.refreshSensitiveWords()
    return club.ok({ word, deleted: true })
  })

  return api.run()
}