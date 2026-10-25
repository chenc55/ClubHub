import { APP_CONFIG } from './config'

function read(key, fallback) {
  try { return uni.getStorageSync(key) || fallback } catch { return fallback }
}

export function getToken() {
  return read(APP_CONFIG.TOKEN_KEY, '')
}

export function setToken(token) {
  uni.setStorageSync(APP_CONFIG.TOKEN_KEY, token || '')
}

export function readSession() {
  const token = getToken()
  return {
    token,
    refreshToken: token ? read(APP_CONFIG.REFRESH_TOKEN_KEY, '') : '',
    userInfo: token ? read(APP_CONFIG.USER_KEY, null) : null,
    authStatus: token && read(APP_CONFIG.AUTH_STATUS_KEY, 'guest') === 'authenticated' ? 'authenticated' : 'guest',
  }
}

export function saveSession({ token, refresh_token = '', userInfo = null, authStatus = 'guest' }) {
  if (!token) return clearSession()
  setToken(token)
  uni.setStorageSync(APP_CONFIG.REFRESH_TOKEN_KEY, refresh_token)
  uni.setStorageSync(APP_CONFIG.USER_KEY, userInfo)
  uni.setStorageSync(APP_CONFIG.AUTH_STATUS_KEY, authStatus === 'authenticated' ? 'authenticated' : 'guest')
}

export function clearSession() {
  for (const key of [APP_CONFIG.TOKEN_KEY, APP_CONFIG.REFRESH_TOKEN_KEY, APP_CONFIG.USER_KEY, APP_CONFIG.AUTH_STATUS_KEY]) {
    uni.removeStorageSync(key)
  }
}
