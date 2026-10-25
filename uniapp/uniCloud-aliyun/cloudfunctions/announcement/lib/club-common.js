/**
 * club-common 公共模块（P0-05 产物）
 * 统一响应（response）、双通道鉴权（auth）、参数校验（validate）、错误码（errorCode）
 * 阿里云版公共模块：uniCloud-aliyun/cloudfunctions/common/club-common/，云函数内 require('club-common')
 */
const crypto = require('crypto')

/* ============================================================
 * 统一错误码表（唯一权威：P0-05；前端 utils/config.js 与此对齐）
 * ============================================================ */
const ERROR_CODE = {
  SUCCESS: 0, // 成功
  /*** HTTP 层约定（statusCode 同步使用） ***/
  BAD_REQUEST: 400, // 请求格式错误（body 非法 JSON 等）
  UNAUTHORIZED: 401, // 未认证：缺少/无效 token
  FORBIDDEN: 403, // 已认证但无权限（含学生 token 访问管理域、角色越权）
  NOT_FOUND: 404, // 资源/路由不存在
  INTERNAL: 500, // 服务器内部错误
  /*** 业务码 ***/
  PARAM_INVALID: 1001, // 参数缺失或非法
  STATUS_INVALID: 1002, // 业务状态不允许（状态机冲突，如已截止后报名）
  WHITELIST_FAIL: 2001, // 白名单校验失败（学号认证）
}

/** HTTP 状态码映射：code -> statusCode（未列出的业务码一律 200） */
const HTTP_STATUS = {
  [ERROR_CODE.SUCCESS]: 200,
  [ERROR_CODE.BAD_REQUEST]: 400,
  [ERROR_CODE.UNAUTHORIZED]: 401,
  [ERROR_CODE.FORBIDDEN]: 403,
  [ERROR_CODE.NOT_FOUND]: 404,
  [ERROR_CODE.INTERNAL]: 500,
}

/* ============================================================
 * 统一响应（阿里云 URL 化：mpserverlessComposedResponse 包装）
 * 注意：不要自行设置 access-control-allow-origin —— uniCloud 网关会按请求 Origin
 * 回显该头（并带 allow-credentials），重复设置会导致浏览器判定 CORS 失败。
 * ============================================================ */
function compose(statusCode, payload) {
  return {
    mpserverlessComposedResponse: true,
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
    },
    isBase64Encoded: false,
    body: JSON.stringify(payload),
  }
}

function ok(data = null, message = 'ok') {
  return compose(HTTP_STATUS[ERROR_CODE.SUCCESS], {
    code: ERROR_CODE.SUCCESS,
    message,
    data: data === undefined ? null : data,
  })
}

/**
 * 业务失败：code 为业务码时 HTTP 200（app 内统一按 code 判断）；HTTP 层错误码携带对应状态码
 * @param {number} code 错误码
 * @param {string} [message] 面向用户的提示（省略时取默认文案）
 * @param {any} [data] 可选的结构化补充信息（如 2001 认证失败时携带 { reason }，供前端精准跳转申诉类型）
 */
function fail(code, message = '', data = null) {
  const statusCode = HTTP_STATUS[code] || 200
  return compose(statusCode, { code, message: message || defaultMessage(code), data: data === undefined ? null : data })
}

function defaultMessage(code) {
  return (
    {
      [ERROR_CODE.BAD_REQUEST]: '请求格式错误',
      [ERROR_CODE.UNAUTHORIZED]: '未登录或登录已过期',
      [ERROR_CODE.FORBIDDEN]: '暂无权限执行该操作',
      [ERROR_CODE.NOT_FOUND]: '资源不存在',
      [ERROR_CODE.INTERNAL]: '服务内部错误',
      [ERROR_CODE.PARAM_INVALID]: '参数缺失或非法',
      [ERROR_CODE.STATUS_INVALID]: '当前状态不允许该操作',
      [ERROR_CODE.WHITELIST_FAIL]: '白名单校验失败',
    }[code] || '服务开小差了，请稍后重试'
  )
}

/* ============================================================
 * JWT 双通道鉴权（无状态，不落库存字段；密钥生产环境必须改为环境变量）
 * ============================================================ */
function jwtSecret() {
  // 无 SDK 的离线脚本保留开发密钥；云端缺少配置时拒绝签发和校验。
  if (process.env.CLUBHUB_JWT_SECRET) return process.env.CLUBHUB_JWT_SECRET
  if (typeof uniCloud === 'undefined') return 'clubhub-dev-secret-2026'
  throw new Error('CLUBHUB_JWT_SECRET is required')
}
const TOKEN_TYPES = {
  STUDENT: 'student',
  ADMIN: 'admin',
}

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function signToken(payload, expiresInSec = 7 * 24 * 3600) {
  const now = Math.floor(Date.now() / 1000)
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = base64url(JSON.stringify({ ...payload, iat: now, exp: now + expiresInSec }))
  const sig = crypto.createHmac('sha256', jwtSecret()).update(`${header}.${body}`).digest('base64url')
  return `${header}.${body}.${sig}`
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [header, body, sig] = parts
  try {
    const expect = crypto.createHmac('sha256', jwtSecret()).update(`${header}.${body}`).digest('base64url')
    if (sig.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null
    const metadata = JSON.parse(Buffer.from(header, 'base64url').toString('utf8'))
    if (!metadata || metadata.alg !== 'HS256' || metadata.typ !== 'JWT') return null
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    if (!parsed || !Number.isFinite(parsed.exp) || parsed.exp <= Math.floor(Date.now() / 1000)) return null
    return parsed
  } catch (e) {
    return null
  }
}

/** 从 HTTP 头提取 Bearer token */
function extractToken(event) {
  const entry = Object.entries(event.headers || {}).find(([name]) => name.toLowerCase() === 'authorization')
  const header = entry && typeof entry[1] === 'string' ? entry[1].trim() : ''
  const match = header.match(/^Bearer\s+(.+)$/i)
  return match ? match[1] : ''
}

/**
 * 鉴权中间件工厂
 * @param {'student'|'admin'} type token 通道
 * @returns {Function} (ctx) => void|Response —— 通过返回响应拦截，放行则返回 true
 */
function requireAuth(type) {
  const expectType = type || TOKEN_TYPES.STUDENT
  return (ctx) => {
    const token = extractToken(ctx.event)
    const payload = verifyToken(token)
    if (!payload) {
      return fail(ERROR_CODE.UNAUTHORIZED)
    }
    if (payload.type !== expectType) {
      return fail(ERROR_CODE.FORBIDDEN, 'token 通道不匹配')
    }
    if (payload.token_kind === 'refresh' || (expectType === TOKEN_TYPES.STUDENT && payload.token_kind !== 'access')) {
      return fail(ERROR_CODE.UNAUTHORIZED, '请使用有效的访问凭证')
    }
    ctx.auth = payload
    return true
  }
}

/**
 * 角色权限（管理通道）：必须置于 requireAuth(ADMIN) 之后
 * 角色取值以数据库 admins.role 为准（需求 2.3 权限矩阵：super / auditor / viewer）
 */
function requireRole(roles) {
  const allow = Array.isArray(roles) ? roles : [roles]
  return (ctx) => {
    if (ctx.auth && allow.indexOf(ctx.auth.role) !== -1) return true
    return fail(ERROR_CODE.FORBIDDEN, '当前角色无权执行该操作')
  }
}

/* ============================================================
 * 学生账号态校验（P1-02）
 * 需求：被禁用用户（users.status = disabled）在学生端「仅可浏览」，
 * 报名 / 签到 / 招新等一切写操作必须被拦截。
 * 实现：写接口统一挂载 requireActiveStudent —— 除校验 token 外，实时回查 users，
 * 因此管理员「禁用」对已签发的 2h access token 立即生效（无需等 token 过期）。
 * 注意：读接口继续使用 requireAuth(STUDENT)，保证禁用用户仍可浏览。
 * ============================================================ */
/** 按 token 身份（userId + openid）回查有效用户；不存在/已软删返回 null */
async function loadStudentByIdentity(payload) {
  if (!payload || typeof payload.userId !== 'string' || typeof payload.openid !== 'string') return null
  if (typeof uniCloud === 'undefined' || !uniCloud.database) return null
  const res = await uniCloud.database()
    .collection('users')
    .where({ _id: payload.userId, openid: payload.openid, deleted: 0 })
    .limit(1)
    .get()
  return (res && res.data && res.data[0]) || null
}

/** 学生写操作鉴权：token 有效 + 账号存在 + status === 'normal'；通过后挂载 ctx.user */
function requireActiveStudent() {
  const checkToken = requireAuth(TOKEN_TYPES.STUDENT)
  return async (ctx) => {
    const denied = checkToken(ctx)
    if (denied !== true) return denied
    const user = await loadStudentByIdentity(ctx.auth)
    if (!user) return fail(ERROR_CODE.UNAUTHORIZED, '账号不可用，请重新登录')
    if (user.status !== 'normal') {
      return fail(ERROR_CODE.FORBIDDEN, '账号已被禁用，仅可浏览，请联系管理员处理')
    }
    ctx.user = user
    return true
  }
}

/* ============================================================
 * 参数校验（约定：非法入参返回 1001）
 * ============================================================ */
function isType(v, type) {
  if (type === 'string') return typeof v === 'string'
  if (type === 'number') return typeof v === 'number'
  if (type === 'int') return typeof v === 'number' && Number.isInteger(v)
  if (type === 'bool') return typeof v === 'boolean'
  if (type === 'object') return typeof v === 'object' && v !== null && !Array.isArray(v)
  if (type === 'array') return Array.isArray(v)
  return true
}

/**
 * 参数校验
 * rules: { field: { type, required, enum, maxLen, min } }
 * @returns {null | {code, message, data}} 合法返回 null，否则返回 1001 响应
 */
function checkParams(src, rules) {
  const source = src || {}
  for (const [field, rule] of Object.entries(rules)) {
    const value = source[field]
    if (value === undefined || value === null || value === '') {
      if (rule.required) {
        return fail(ERROR_CODE.PARAM_INVALID, `参数 ${field} 不能为空`)
      }
      continue
    }
    if (rule.type && !isType(value, rule.type)) {
      return fail(ERROR_CODE.PARAM_INVALID, `参数 ${field} 类型不合法`)
    }
    if (rule.enum && !rule.enum.includes(value)) {
      return fail(ERROR_CODE.PARAM_INVALID, `参数 ${field} 取值不合法`)
    }
    if (rule.maxLen && typeof value === 'string' && value.length > rule.maxLen) {
      return fail(ERROR_CODE.PARAM_INVALID, `参数 ${field} 超长`)
    }
  }
  return null
}

/* ============================================================
 * 文件相关工具
 * 说明：上传走 JSON（base64）通道 —— 阿里云 URL 化网关由 Spring 侧自行消费 multipart，
 * 不透传原始 body，故不使用 multipart/form-data。
 * ============================================================ */
/** 取文件扩展名（小写，不含点）；优先用文件名，其次用 mime */
function fileExt(filename, mime) {
  const nameExt = String(filename || '').split('.').pop().toLowerCase()
  if (/^[a-z0-9]{2,5}$/.test(nameExt) && nameExt !== String(filename).toLowerCase()) return nameExt
  const mimeMap = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' }
  return mimeMap[mime] || ''
}

/** 脱敏展示 openid（保留前 4 后 4）：管理端「查看绑定情况」只展示脱敏值（需求八·隐私最小化） */
function maskOpenid(openid) {
  const value = String(openid || '')
  if (!value) return ''
  if (value.length <= 8) return '*'.repeat(value.length)
  return `${value.slice(0, 4)}***${value.slice(-4)}`
}

/** 学号脱敏（保留前 4 后 2，中间打码；≤6 位全打码）：需求 J 列表脱敏，完整学号不出非管理员端（P3-02 抽至公共模块） */
function maskStudentNo(studentNo) {
  const value = String(studentNo || '')
  if (!value) return ''
  if (value.length <= 6) return '*'.repeat(value.length)
  return `${value.slice(0, 4)}${'*'.repeat(value.length - 6)}${value.slice(-2)}`
}

/** 转义正则元字符：模糊查询入参必须转义，避免用户输入 `.*` 命中全表 */
function escapeRegExp(input) {
  return String(input == null ? '' : input).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/* ============================================================
 * 简易路由（云函数内二级分发）
 * 用法：api.get('/ping', handler)；api.get('/me', mw1, mw2, controller)
 * 中间件返回 true/undefined 放行，返回 Response 则拦截；
 * controller 返回 Response 作为最终响应，返回 undefined 则默认 ok(null)
 * ============================================================ */
function createRouter(event) {
  const routes = [] // { method, path, handlers }
  const ctx = {
    event,
    auth: null,
    query: event.queryStringParameters || {},
  }

  function register(method, path, handlers) {
    routes.push({ method: method.toUpperCase(), path, handlers })
  }

  const api = {
    get: (path, ...handlers) => register('GET', path, handlers),
    post: (path, ...handlers) => register('POST', path, handlers),
    put: (path, ...handlers) => register('PUT', path, handlers),
    delete: (path, ...handlers) => register('DELETE', path, handlers),
    /** 处理并返回响应 */
    async run() {
      const method = (event.httpMethod || 'GET').toUpperCase()
      const path = event.path || '/'
      try {
        // 解析 body（空 body 给 {}）
        try {
          ctx.body = event.body ? JSON.parse(event.body) : {}
        } catch (e) {
          return fail(ERROR_CODE.BAD_REQUEST)
        }
        const route = routes.find((r) => r.method === method && r.path === path)
        if (!route) {
          return fail(ERROR_CODE.NOT_FOUND, `接口不存在：${method} ${path}`)
        }
        for (const handler of route.handlers) {
          const result = await handler(ctx)
          if (result !== true && result !== undefined) return result // 拦截/最终响应
        }
        return ok(null)
      } catch (e) {
        console.error('[club-common] unhandled error:', e)
        return fail(ERROR_CODE.INTERNAL)
      }
    },
  }
  return api
}

module.exports = {
  ERROR_CODE,
  TOKEN_TYPES,
  ok,
  fail,
  compose,
  signToken,
  verifyToken,
  extractToken,
  requireAuth,
  requireRole,
  requireActiveStudent,
  loadStudentByIdentity,
  checkParams,
  createRouter,
  fileExt,
  maskOpenid,
  maskStudentNo,
  escapeRegExp,
}
