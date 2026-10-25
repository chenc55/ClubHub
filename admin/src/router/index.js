import { createRouter, createWebHashHistory } from 'vue-router'
import AdminLayout from '@/layouts/AdminLayout.vue'
import { useAuthStore } from '@/store/auth'

/**
 * 角色路由表（P0-03 产物；P0-09 角色标识与数据库 admins.role 对齐）
 * meta.roles 对应需求 2.3 管理端角色权限矩阵（角色标识以数据库为准）：
 * - super 超级管理员：全部模块
 * - auditor 审核员：全部模块，除「管理员账号与角色管理」
 * - viewer 数据查看员：仅工作台概览 + 数据统计
 * 权限矩阵（2.3）：
 *   ✔ 工作台(all) 用户白名单(sp,au) 社团审核/分类/星级(sp,au) 活动/招新/申诉审核(sp,au)
 *   ✔ 内容监管(sp,au) 公告管理(sp,au) 敏感词库(sp,au) 数据统计(all,仅查看) 管理员账号(sp)
 */
const ALL = ['super', 'auditor', 'viewer']
const OPS = ['super', 'auditor']
const SUPER = ['super']

export const menuRoutes = [
  {
    path: 'dashboard',
    component: () => import('@/views/dashboard/index.vue'),
    meta: {
      title: '工作台',
      roles: ALL,
      menu: { group: 'main', icon: 'dashboard', label: '工作台' },
    },
  },
  {
    path: 'stats',
    component: () => import('@/views/stats/index.vue'),
    meta: {
      title: '数据统计',
      roles: ALL,
      menu: { group: 'main', icon: 'monitoring', label: '数据统计' },
    },
  },
  {
    path: 'deletions',
    component: () => import('@/views/deletions/index.vue'),
    meta: {
      title: '注销管理',
      roles: OPS,
      menu: { group: 'main', icon: 'person_off', label: '注销管理' },
    },
  },
  {
    path: 'users',
    component: () => import('@/views/users/index.vue'),
    meta: {
      title: '用户与白名单',
      roles: OPS,
      menu: { group: 'main', icon: 'group', label: '用户与白名单' },
    },
  },
  {
    path: 'clubs',
    component: () => import('@/views/clubs/index.vue'),
    meta: {
      title: '社团管理',
      roles: OPS,
      menu: { group: 'main', icon: 'diversity_3', label: '社团管理' },
    },
  },
  {
    path: 'review',
    component: () => import('@/views/review/index.vue'),
    meta: {
      title: '审核中心',
      roles: OPS,
      menu: { group: 'main', icon: 'how_to_reg', label: '审核中心' },
    },
  },
  {
    path: 'content',
    component: () => import('@/views/content/index.vue'),
    meta: {
      title: '内容监管',
      roles: OPS,
      menu: { group: 'main', icon: 'policy', label: '内容监管' },
    },
  },
  {
    path: 'announcements',
    component: () => import('@/views/announcements/index.vue'),
    meta: {
      title: '公告管理',
      roles: OPS,
      menu: { group: 'main', icon: 'campaign', label: '公告管理' },
    },
  },
  {
    path: 'sensitive-words',
    component: () => import('@/views/sensitive-words/index.vue'),
    meta: {
      title: '敏感词库',
      roles: OPS,
      menu: { group: 'main', icon: 'hearing', label: '敏感词库' },
    },
  },
  {
    path: 'admins',
    component: () => import('@/views/admins/index.vue'),
    meta: {
      title: '管理员账号',
      roles: SUPER,
      menu: { group: 'system', icon: 'admin_panel_settings', label: '管理员账号' },
    },
  },
  {
    path: 'settings',
    component: () => import('@/views/StubPage.vue'),
    meta: {
      title: '系统设置',
      roles: SUPER,
      menu: { group: 'system', icon: 'settings', label: '系统设置' },
    },
  },
]

const routes = [
  {
    path: '/login',
    component: () => import('@/views/login/index.vue'),
    meta: { title: '登录', public: true },
  },
  {
    path: '/403',
    component: () => import('@/views/error/Forbidden.vue'),
    meta: { title: '无权限', public: true },
  },
  {
    path: '/',
    component: AdminLayout,
    redirect: '/dashboard',
    children: menuRoutes,
  },
  { path: '/:pathMatch(.*)*', redirect: '/dashboard' },
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

/** 角色路由守卫：未登录 / 会话过期 → /login；角色不符 → /403 */
router.beforeEach((to) => {
  if (to.meta.public) return true
  const auth = useAuthStore()
  if (!auth.isLoggedIn) {
    return { path: '/login', query: { redirect: to.fullPath } }
  }
  if (auth.isExpired) {
    auth.clear()
    return { path: '/login', query: { redirect: to.fullPath, reason: 'expired' } }
  }
  if (to.meta.roles && !to.meta.roles.includes(auth.role)) {
    return { path: '/403' }
  }
  return true
})

export default router