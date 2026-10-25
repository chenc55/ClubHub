/**
 * 敏感词过滤引擎（P0-08 / COM-04）
 *
 * 规格来源：《功能需求.md》
 * - 2.5 内容安全执行规则（分级处理矩阵）
 * - 7.2 sensitive_words 集合（word 唯一 / level: block 拦截 | review 送审）
 *
 * 用法（各业务域云函数）：
 *   const filter = require('./lib/sensitive-filter')
 *   const result = await filter.checkContent({ title, body, extras: 自定义表单字段文案 })
 *   const decision = filter.decideByMode(filter.PUBLISH_MODES.PRE_REVIEW, result)
 *   if (!decision.allowed) return club.fail(club.ERROR_CODE.PARAM_INVALID, '内容含违规词，请修改后重新提交')
 *   // 先发后审场景：decision.flagged === true 时把 flagged 落库并进入监管队列
 *
 * 缓存策略：词库进程内缓存 10s，避免每次发布都查库；管理端（P1-25）写入后调用
 * refreshSensitiveWords() 可让当前实例立即生效，其余实例最长 10s 后生效。
 */
'use strict'

const LEVEL_BLOCK = 'block'
const LEVEL_REVIEW = 'review'

/** 发布模式 */
const PUBLISH_MODES = {
  /** 先审后发：活动 / 招新岗位 / 公告 —— 命中 block 或 review 一律拦截 */
  PRE_REVIEW: 'pre_review',
  /** 先发后审：社团动态 —— 命中 block 拦截；命中 review 放行但标记疑似送审 */
  POST_REVIEW: 'post_review',
}

/** 词库缓存时长（ms） */
const CACHE_TTL = 10 * 1000

/** 单次加载词条上限（uniCloud 服务端单次 get 上限） */
const LOAD_LIMIT = 1000

let cache = null
let loading = null

function normalizeWord(value) {
  return String(value == null ? '' : value).trim().toLowerCase()
}

function normalizeText(value) {
  return String(value == null ? '' : value).toLowerCase()
}

/**
 * 纯匹配：在文本中查找命中的词条（不查库，便于单元测试与复用）
 * @param {string} text 待检测文本
 * @param {Array<{word:string, level:string}>} words 词库
 * @returns {Array<{word:string, level:string}>} 命中词（同一词条只报一次）
 */
function matchWords(text, words) {
  const haystack = normalizeText(text)
  if (!haystack) return []
  const hits = []
  for (const item of words || []) {
    const word = normalizeWord(item && item.word)
    if (!word) continue
    if (haystack.indexOf(word) !== -1) {
      hits.push({ word: item.word, level: item.level === LEVEL_BLOCK ? LEVEL_BLOCK : LEVEL_REVIEW })
    }
  }
  return hits
}

/**
 * 合并多处匹配结果：block 优先于 review
 * @returns {{level:string|null, hits:Array}}
 */
function mergeHits(groups) {
  let level = null
  const hits = []
  for (const group of groups || []) {
    for (const hit of group || []) {
      hits.push(hit)
      if (hit.level === LEVEL_BLOCK) level = LEVEL_BLOCK
      else if (level !== LEVEL_BLOCK) level = LEVEL_REVIEW
    }
  }
  return { level, hits }
}

/**
 * 汇总待检测文本（2.5 过滤范围：标题 + 正文 + 自定义报名表字段文案）
 * @param {Object} content { title, body, extras }
 * @returns {string[]}
 */
function collectTexts(content) {
  const source = content || {}
  const texts = []
  if (typeof source.title === 'string') texts.push(source.title)
  if (typeof source.body === 'string') texts.push(source.body)
  const extras = Array.isArray(source.extras) ? source.extras : []
  for (const extra of extras) {
    if (typeof extra === 'string' && extra) texts.push(extra)
  }
  return texts
}

/**
 * 加载词库（带缓存）
 * @param {Object} [options] { force: true 时忽略缓存强制重载 }
 */
async function loadSensitiveWords(options = {}) {
  const now = Date.now()
  if (!options.force && cache && now - cache.loadedAt < CACHE_TTL) return cache.words
  if (loading) return loading

  loading = (async () => {
    let words = []
    try {
      const res = await uniCloud
        .database()
        .collection('sensitive_words')
        .where({ deleted: 0 })
        .limit(LOAD_LIMIT)
        .get()
      words = (res.data || []).map((item) => ({ word: item.word, level: item.level }))
    } catch (e) {
      console.error('[sensitive-filter] 词库加载失败', e && e.message)
      // 加载失败沿用旧缓存，避免因词库故障阻断全部内容发布
      if (cache) return cache.words
      words = []
    }
    cache = { words, loadedAt: Date.now() }
    return words
  })().finally(() => {
    loading = null
  })

  return loading
}

/** 词库变更后立即刷新缓存（管理端 P1-25 写入词条后调用） */
function refreshSensitiveWords() {
  return loadSensitiveWords({ force: true })
}

/** 清空缓存（仅测试/调试用） */
function clearCache() {
  cache = null
}

/**
 * 内容检测
 * @param {Object} content { title, body, extras } extras 为自定义报名表字段文案等附加文本
 * @param {Object} [options] { force: true 时忽略词库缓存 }
 * @returns {Promise<{level:string|null, hits:Array, words:number}>}
 */
async function checkContent(content, options = {}) {
  const words = await loadSensitiveWords(options)
  const groups = collectTexts(content).map((text) => matchWords(text, words))
  const merged = mergeHits(groups)
  return { level: merged.level, hits: merged.hits, words: words.length }
}

/**
 * 按发布模式给出处理决策（2.5 分级矩阵）
 * @param {'pre_review'|'post_review'} mode
 * @param {{level:string|null, hits:Array}} result checkContent 的返回
 * @returns {{allowed:boolean, flagged:boolean, level:string|null, hits:Array}}
 */
function decideByMode(mode, result) {
  const level = (result && result.level) || null
  const hits = (result && result.hits) || []

  if (mode === PUBLISH_MODES.POST_REVIEW) {
    if (level === LEVEL_BLOCK) return { allowed: false, flagged: false, level, hits }
    if (level === LEVEL_REVIEW) return { allowed: true, flagged: true, level, hits }
    return { allowed: true, flagged: false, level: null, hits: [] }
  }

  // 先审后发：命中任一等级即拦截提交
  if (level) return { allowed: false, flagged: false, level, hits }
  return { allowed: true, flagged: false, level: null, hits: [] }
}

module.exports = {
  LEVEL_BLOCK,
  LEVEL_REVIEW,
  PUBLISH_MODES,
  CACHE_TTL,
  matchWords,
  mergeHits,
  collectTexts,
  loadSensitiveWords,
  refreshSensitiveWords,
  clearCache,
  checkContent,
  decideByMode,
}
