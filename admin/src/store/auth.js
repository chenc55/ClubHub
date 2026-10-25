/**
 * 管理员登录态（Pinia，P0-09）
 * - 真实账号密码 + 图形验证码登录；会话有效期由服务端 expires_in 决定
 * - 会话超时：request 层收到 401 会清会话并跳登录页；路由守卫亦按 expires_at 本地判断
 */
import { defineStore } from 'pinia'
import { request } from '@/utils/request'
import { readSession, writeSession, clearSession } from '@/utils/session'

export const ROLE_LABELS = {
  super: '超级管理员',
  auditor: '审核员',
  viewer: '数据查看员',
}

export const useAuthStore = defineStore('auth', {
  state: () => ({
    session: readSession(),
  }),

  getters: {
    isLoggedIn: (state) => !!state.session && !!state.session.token,
    token: (state) => (state.session && state.session.token) || '',
    admin: (state) => (state.session && state.session.admin) || null,
    role: (state) => (state.session && state.session.admin && state.session.admin.role) || '',
    roleLabel: (state) => ROLE_LABELS[state.role] || '未分配角色',
    name: (state) => {
      const admin = state.session && state.session.admin
      return (admin && (admin.name || admin.username)) || ''
    },
    /** 本地判断会话是否已过期（服务端以 401 为准） */
    isExpired: (state) => {
      const expiresAt = state.session && state.session.expires_at
      return !!expiresAt && expiresAt <= Date.now()
    },
  },

  actions: {
    setSession(session) {
      this.session = session
      writeSession(session)
    },

    clear() {
      this.session = null
      clearSession()
    },

    logout() {
      this.clear()
    },

    /** 获取图形验证码（含无状态票据 captcha_id） */
    fetchCaptcha() {
      return request({ path: '/admin/captcha', auth: false })
    },

    /** 账号密码 + 验证码登录；失败时返回服务端 message 供页面展示 */
    async login({ username, password, captchaId, captchaCode }) {
      const res = await request({
        path: '/admin/login',
        method: 'POST',
        auth: false,
        data: {
          username,
          password,
          captcha_id: captchaId,
          captcha_code: captchaCode,
        },
      })
      if (res.code !== 0 || !res.data) return res
      this.setSession({
        token: res.data.token,
        expires_at: Date.now() + (res.data.expires_in || 0) * 1000,
        admin: res.data.admin,
      })
      return res
    },

    /** 校验服务端会话（路由守卫放行前调用），失效则清会话 */
    async validate() {
      if (!this.token) return false
      const res = await request({ path: '/admin/session' })
      if (res.code !== 0 || !res.data) {
        this.clear()
        return false
      }
      this.setSession({
        token: this.token,
        expires_at: res.data.expires_at || (this.session && this.session.expires_at) || 0,
        admin: res.data.admin,
      })
      return true
    },
  },
})
