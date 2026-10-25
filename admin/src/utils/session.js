/**
 * 管理员会话持久化（P0-09）
 * 与 Pinia store 分离，避免 request ⇄ store 循环依赖；store 以本模块为持久层。
 */
import { API_CONFIG } from './config'

export function readSession() {
  try {
    const raw = localStorage.getItem(API_CONFIG.SESSION_KEY)
    return raw ? JSON.parse(raw) : null
  } catch (e) {
    return null
  }
}

export function writeSession(session) {
  try {
    localStorage.setItem(API_CONFIG.SESSION_KEY, JSON.stringify(session))
  } catch (e) {
    /* localStorage 不可用时仅保留内存态 */
  }
}

export function clearSession() {
  try {
    localStorage.removeItem(API_CONFIG.SESSION_KEY)
  } catch (e) {
    /* ignore */
  }
}
