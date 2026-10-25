/** URL 化 API 请求：自动刷新一次；失效时同步清理缓存和 Pinia，silent 只控制提示。 */
import { getActivePinia } from 'pinia'
import { useUserStore } from '@/store/user'
import { APP_CONFIG, ERROR_CODE } from './config'
import { getToken, readSession, saveSession, clearSession } from './session'
export { getToken, setToken } from './session'

const mockHandlers = new Map()
let refreshing = null
let loginRedirectPending = false
const mockKey = (method, path) => `${String(method).toUpperCase()} ${path}`

export function registerMock(method, path, handler) {
  mockHandlers.set(mockKey(method, path), handler)
}

function clearAuth() {
  if (getActivePinia()) useUserStore().resetAuth()
  else clearSession()
}

function handleError(code, message) {
  uni.showToast({ title: message || '请求失败，请稍后重试', icon: 'none' })
  if (code !== ERROR_CODE.UNAUTHORIZED || loginRedirectPending) return
  const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []
  if (pages[pages.length - 1]?.route === 'pages/subpages/login/index') return
  loginRedirectPending = true
  setTimeout(() => {
    uni.navigateTo({ url: '/pages/subpages/login/index', complete: () => { loginRedirectPending = false } })
  }, 400)
}

function transport({ path, method, data, header = {} }) {
  if (APP_CONFIG.USE_MOCK || !APP_CONFIG.API_BASE) {
    const handler = mockHandlers.get(mockKey(method, path))
    return Promise.resolve().then(() => handler
      ? handler({ data, header })
      : { code: ERROR_CODE.NOT_FOUND, data: null, message: `未注册的 mock 接口：${method} ${path}` })
  }
  return new Promise((resolve) => uni.request({
    url: APP_CONFIG.API_BASE + path, method, data, header, timeout: APP_CONFIG.TIMEOUT,
    success: (res) => {
      const body = res.data || {}
      const code = res.statusCode >= 400 ? res.statusCode
        : typeof body.code === 'number' ? body.code : ERROR_CODE.INTERNAL
      resolve({ code, data: body.data ?? null, message: body.message || '' })
    },
    fail: () => resolve({ code: ERROR_CODE.NETWORK, data: null, message: '网络异常，请稍后重试' }),
  }))
}

function refresh(snapshot) {
  if (refreshing?.credential === snapshot.refreshToken) return refreshing.promise
  const pending = { credential: snapshot.refreshToken }
  pending.promise = (async () => {
    const result = await transport({ path: '/user/session/refresh', method: 'POST', data: { refresh_token: snapshot.refreshToken } })
    const current = readSession()
    // 退出或切换账号后，旧请求不能恢复旧会话。
    if (current.refreshToken !== snapshot.refreshToken || current.token !== snapshot.token) {
      return { code: ERROR_CODE.UNAUTHORIZED, data: null, message: '登录状态已变更' }
    }
    if (result.code === ERROR_CODE.SUCCESS && result.data?.token) {
      const session = {
        token: result.data.token, refresh_token: snapshot.refreshToken,
        userInfo: result.data.user ?? current.userInfo,
        authStatus: result.data.authStatus ?? current.authStatus,
      }
      if (getActivePinia()) useUserStore().setLogin(session)
      else saveSession(session)
      return result
    }
    if ([ERROR_CODE.UNAUTHORIZED, ERROR_CODE.FORBIDDEN].includes(result.code)) clearAuth()
    return result.code === ERROR_CODE.SUCCESS
      ? { code: ERROR_CODE.INTERNAL, data: null, message: '会话刷新失败，请稍后重试' } : result
  })().finally(() => { if (refreshing === pending) refreshing = null })
  refreshing = pending
  return pending.promise
}

/** silent 只抑制提示和跳转；登录失效始终清状态，网络失败保留会话供重试。 */
export async function request({ path, method = 'GET', data = {}, header = {}, silent = false, retried = false }) {
  const snapshot = readSession()
  const isSessionEndpoint = path === '/user/login' || path === '/user/session/refresh'
  const headers = { ...header }
  if (!isSessionEndpoint && snapshot.token) {
    for (const key of Object.keys(headers)) if (key.toLowerCase() === 'authorization') delete headers[key]
    headers.Authorization = `Bearer ${snapshot.token}`
  }
  let result = await transport({ path, method, data, header: headers })
  if (result.code === ERROR_CODE.UNAUTHORIZED && !isSessionEndpoint) {
    // 若另一并发请求已刷新 token，则直接用新 token 重试。
    if (!retried && getToken() && getToken() !== snapshot.token) {
      return request({ path, method, data, header, silent, retried: true })
    }
    if (!retried && snapshot.refreshToken && readSession().refreshToken === snapshot.refreshToken) {
      result = await refresh(snapshot)
      if (result.code === ERROR_CODE.SUCCESS) return request({ path, method, data, header, silent, retried: true })
    } else if (getToken() === snapshot.token) {
      clearAuth()
    }
  }
  if (result.code !== ERROR_CODE.SUCCESS && !silent) handleError(result.code, result.message)
  return result
}
