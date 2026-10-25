/**
 * 用户全局状态（Pinia）
 * - 游客态 guest：未登录/未认证，仅可浏览
 * - 认证态 authenticated：已完成学号认证的学生
 * - 社团角色 clubRoles：干部/社长（role: officer / leader），随 P1 相关任务接入真实数据
 */
import { defineStore } from 'pinia'
import { readSession, saveSession, clearSession } from '@/utils/session'

export const useUserStore = defineStore('user', {
  state: () => ({
    ...readSession(),
    /**
     * 社团管理角色列表（单用户可以负责多个社团）
     * 角色取值与数据库 club_members.role 对齐：president（社长）/ officer（干部）
     * [{ club_id, club_name, role: 'president' | 'officer', can_edit }]
     */
    clubRoles: [],
  }),

  getters: {
    isGuest: (state) => state.authStatus === 'guest',
    isAuthenticated: (state) => state.authStatus === 'authenticated',
    hasSession: (state) => !!state.token,
    /** 当前社团角色（多社团切换在 P1-09 管理主页实现，此处取第一个） */
    currentClubRole: (state) => (state.clubRoles.length ? state.clubRoles[0] : null),
    /** 是否社团负责人（干部 / 社长均可进入管理视图） */
    isClubManager: (state) => state.clubRoles.length > 0,
    /** 是否社长（仅社长可编辑社团资料，需求 2.3） */
    isClubLeader: (state) => state.clubRoles.some((c) => c.role === 'president'),
  },

  actions: {
    /** 写入登录态（P0-06 接入微信 openid 登录后填充真实数据） */
    setLogin({ token, refresh_token = '', userInfo = null, authStatus = 'guest' }) {
      if (this.userInfo?._id !== userInfo?._id) this.clubRoles = []
      saveSession({ token, refresh_token, userInfo, authStatus })
      this.restore()
    },

    /** 设置社团角色（P1 阶段接入真实数据） */
    setClubRoles(roles = []) {
      this.clubRoles = roles
    },

    /** 退出登录：回到游客态 */
    logout() {
      this.resetAuth()
    },

    /** 本地状态重置（清 token），供 401 统一处理调用 */
    resetAuth() {
      clearSession()
      this.restore()
      this.clubRoles = []
    },

    restore() {
      Object.assign(this, readSession())
      if (!this.token) this.clubRoles = []
    },
  },
})
