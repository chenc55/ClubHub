/**
 * 请求封装（P0-09）
 * - 统一走 uniCloud URL 化接口（path 自带 /admin 前缀，如 '/admin/login'）
 * - 自动注入 Authorization: Bearer <token>（auth !== false 时）
 * - 统一返回 { code, data, message }；错误提示由调用方决定（登录页需展示具体原因）
 * - 401 → 清会话并跳登录页（会话超时自动登出）
 */
import { API_CONFIG, ERROR_CODE } from './config'
import { readSession, clearSession } from './session'

/** 会话失效时的跳转（用 location.hash 而非 router，避免 request ⇄ router ⇄ store 循环依赖） */
async function handleUnauthorized() {
  clearSession()
  // 动态引入 store，仅用于清掉内存态（避免静态循环依赖）
  try {
    const { useAuthStore } = await import('@/store/auth')
    useAuthStore().clear()
  } catch (e) {
    /* store 尚未初始化时忽略 */
  }
  const current = window.location.hash.replace(/^#/, '')
  if (!current.startsWith('/login')) {
    window.location.hash = `#/login?redirect=${encodeURIComponent(current || '/dashboard')}`
  }
}

/**
 * @param {Object} options
 * @param {string} options.path 接口路径，如 '/admin/login'
 * @param {string} [options.method='GET']
 * @param {Object} [options.data] 请求体（JSON）
 * @param {boolean} [options.auth=true] 是否注入 token
 * @returns {Promise<{code:number,data:any,message:string}>}
 */
export async function request({ path, method = 'GET', data, auth = true }) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), API_CONFIG.TIMEOUT)
  try {
    const headers = { 'content-type': 'application/json' }
    if (auth) {
      const session = readSession()
      if (session && session.token) headers.Authorization = `Bearer ${session.token}`
    }
    const res = await fetch(`${API_CONFIG.API_BASE}${path}`, {
      method,
      headers,
      body: data ? JSON.stringify(data) : undefined,
      signal: controller.signal,
    })
    const body = await res.json().catch(() => ({}))
    const payload = {
      code: typeof body.code === 'number' ? body.code : ERROR_CODE.NETWORK,
      data: body.data === undefined ? null : body.data,
      message: body.message || '',
    }
    if (payload.code === ERROR_CODE.UNAUTHORIZED) await handleUnauthorized()
    return payload
  } catch (e) {
    return {
      code: ERROR_CODE.NETWORK,
      data: null,
      message: e && e.name === 'AbortError' ? '请求超时，请稍后重试' : '网络异常，请检查网络后重试',
    }
  } finally {
    clearTimeout(timer)
  }
}
