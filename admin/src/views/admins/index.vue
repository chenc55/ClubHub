<script setup>
/**
 * 管理员账号与权限（P1-27 / ADM-08②）
 *
 * 接口：POST /admin/admins/query、/create、/status、/reset-password、/admins/change-password
 * （query/create/status/reset 仅 super；change-password 任意管理员自助——服务端 requireRole 二次校验）
 *
 * 口径说明：
 * - 仅超管可管理管理员账号（需求 2.3 权限矩阵），auditor / viewer 菜单不可见且接口 403；
 * - 创建账号：账号以字母开头（3~32 位）、密码 ≥6 位、角色 super/auditor/viewer、姓名可选；
 * - 禁用 / 启用需二次确认；禁止禁用当前登录账号（服务端拦截）；
 * - 超管重置密码（清失败计数与锁定）；自助修改密码需校验原密码；
 * - viewer 仅查看 / 导出（工作台 + 数据统计），无任何写权限——由路由 meta.roles 与后端守卫双重保障。
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { request } from '@/utils/request'
import { ROLE_LABELS, useAuthStore } from '@/store/auth'

const PAGE_SIZE = 20
const USERNAME_MAX = 32
const NAME_MAX = 20
const PASSWORD_MIN = 6

const ROLE_META = {
  super: { label: '超级管理员', cls: 'bg-danger-light text-danger' },
  auditor: { label: '审核员', cls: 'bg-primary-light text-memphis-dark' },
  viewer: { label: '数据查看员', cls: 'bg-canvas text-ink-muted' },
}
const ROLE_OPTIONS = Object.keys(ROLE_META).map((value) => ({ value, label: ROLE_LABELS[value] }))

const auth = useAuthStore()
const filters = reactive({ keyword: '', status: 'all' })
const list = ref([])
const total = ref(0)
const page = ref(1)
const loading = ref(false)
const errorMessage = ref('')
const pendingId = ref('')
let requestSeq = 0

const create = reactive({ visible: false, username: '', password: '', role: 'auditor', name: '', saving: false, error: '' })
const resetDlg = reactive({ visible: false, target: null, new_password: '', saving: false, error: '' })
const changeDlg = reactive({ visible: false, old_password: '', new_password: '', saving: false, error: '' })

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))
const isEmpty = computed(() => !loading.value && !errorMessage.value && list.value.length === 0)

function formatTime(value) {
  if (!value) return '—'
  const raw = value && typeof value === 'object' && value.$date ? value.$date : value
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return '—'
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function roleOf(role) {
  return ROLE_META[role] || ROLE_META.viewer
}

async function load() {
  const seq = ++requestSeq
  loading.value = true
  errorMessage.value = ''
  const res = await request({
    path: '/admin/admins/query',
    method: 'POST',
    data: {
      keyword: filters.keyword.trim(),
      status: filters.status,
      page: page.value,
      page_size: PAGE_SIZE,
    },
  })
  if (seq !== requestSeq) return
  loading.value = false
  if (res.code !== 0 || !res.data) {
    errorMessage.value = res.message || '管理员列表加载失败，请稍后重试'
    list.value = []
    total.value = 0
    return
  }
  list.value = res.data.list || []
  total.value = res.data.total || 0
  if (!list.value.length && page.value > 1) {
    page.value -= 1
    await load()
  }
}

function search() {
  page.value = 1
  load()
}

function reset() {
  filters.keyword = ''
  filters.status = 'all'
  page.value = 1
  load()
}

function goPage(next) {
  if (next < 1 || next > totalPages.value || next === page.value) return
  page.value = next
  load()
}

function openCreate() {
  Object.assign(create, { username: '', password: '', role: 'auditor', name: '', error: '' })
  create.visible = true
}

async function submitCreate() {
  const username = create.username.trim()
  if (!/^[A-Za-z][A-Za-z0-9_]{2,31}$/.test(username)) {
    create.error = '账号需以字母开头，3~32 位字母 / 数字 / 下划线'
    return
  }
  if (create.password.length < PASSWORD_MIN) {
    create.error = `密码至少 ${PASSWORD_MIN} 位`
    return
  }
  create.saving = true
  const res = await request({
    path: '/admin/admins/create',
    method: 'POST',
    data: {
      username,
      password: create.password,
      role: create.role,
      name: create.name.trim(),
    },
  })
  create.saving = false
  if (res.code !== 0) {
    create.error = res.message || '创建失败，请稍后重试'
    return
  }
  create.visible = false
  ElMessage.success(`已创建账号「${username}」（${ROLE_LABELS[create.role]}）`)
  await load()
}

async function toggleStatus(row) {
  const disabling = row.status === 'normal'
  try {
    await ElMessageBox.confirm(
      disabling
        ? `禁用后「${row.username}」将无法登录管理端（当前登录会话立即失效）；确认禁用？`
        : `启用后「${row.username}」可正常登录管理端。`,
      disabling ? '确认禁用该账号？' : '确认启用该账号？',
      { confirmButtonText: disabling ? '确认禁用' : '确认启用', cancelButtonText: '取消', type: 'warning' }
    )
  } catch (e) {
    return
  }
  pendingId.value = row._id
  const res = await request({
    path: '/admin/admins/status',
    method: 'POST',
    data: { admin_id: row._id, action: disabling ? 'disable' : 'enable' },
  })
  pendingId.value = ''
  if (res.code !== 0) {
    ElMessage.error(res.message || (disabling ? '禁用失败，请稍后重试' : '启用失败，请稍后重试'))
    return
  }
  ElMessage.success(disabling ? `已禁用「${row.username}」` : `已启用「${row.username}」`)
  await load()
}

function openReset(row) {
  Object.assign(resetDlg, { visible: true, target: row, new_password: '', error: '' })
}

async function submitReset() {
  if (resetDlg.new_password.length < PASSWORD_MIN) {
    resetDlg.error = `新密码至少 ${PASSWORD_MIN} 位`
    return
  }
  resetDlg.saving = true
  const res = await request({
    path: '/admin/admins/reset-password',
    method: 'POST',
    data: { admin_id: resetDlg.target._id, new_password: resetDlg.new_password },
  })
  resetDlg.saving = false
  if (res.code !== 0) {
    resetDlg.error = res.message || '重置失败，请稍后重试'
    return
  }
  resetDlg.visible = false
  ElMessage.success(`已重置「${resetDlg.target.username}」的密码`)
}

function openChange() {
  Object.assign(changeDlg, { visible: true, old_password: '', new_password: '', error: '' })
}

async function submitChange() {
  if (changeDlg.old_password.length < 1) {
    changeDlg.error = '请输入原密码'
    return
  }
  if (changeDlg.new_password.length < PASSWORD_MIN) {
    changeDlg.error = `新密码至少 ${PASSWORD_MIN} 位`
    return
  }
  changeDlg.saving = true
  const res = await request({
    path: '/admin/admins/change-password',
    method: 'POST',
    data: { old_password: changeDlg.old_password, new_password: changeDlg.new_password },
  })
  changeDlg.saving = false
  if (res.code !== 0) {
    changeDlg.error = res.message || '修改失败，请稍后重试'
    return
  }
  changeDlg.visible = false
  ElMessage.success('密码已修改，请牢记新密码')
}

onMounted(load)
</script>

<template>
  <div class="space-y-6">
    <!-- 页面标题 Banner -->
    <div
      class="flex flex-col justify-between gap-4 rounded-xl border-2 border-memphis-dark bg-card p-6 shadow-memphis-md lg:flex-row lg:items-center"
    >
      <div class="space-y-2">
        <h1 class="font-display text-2xl font-bold tracking-tight text-memphis-dark">管理员账号</h1>
        <p class="max-w-3xl font-sans text-sm text-ink-muted">
          超管创建账号并分配角色（超级管理员 / 审核员 / 数据查看员）、禁用 / 启用、重置密码；
          任意管理员可在顶栏自助修改密码。角色权限按需求 2.3 矩阵隔离（审核员无本模块、数据查看员仅查看）。
        </p>
      </div>
      <div class="flex items-center gap-3">
        <button
          type="button"
          class="m-pressable rounded-xl border-2 border-memphis-dark bg-card px-5 py-2 font-sans text-xs font-bold text-memphis-dark"
          @click="openChange"
        >
          修改我的密码
        </button>
        <button
          type="button"
          class="m-pressable rounded-xl border-2 border-memphis-dark bg-primary px-5 py-2 font-sans text-xs font-bold text-white shadow-memphis-sm"
          @click="openCreate"
        >
          + 创建账号
        </button>
      </div>
    </div>

    <!-- 查询筛选 -->
    <div class="m-card p-6">
      <div class="flex flex-wrap items-end justify-between gap-4">
        <div class="flex flex-wrap items-end gap-5">
          <label class="block">
            <span class="font-sans text-xs font-bold text-memphis-dark">账号 / 姓名</span>
            <input
              v-model="filters.keyword"
              type="search"
              :maxlength="USERNAME_MAX"
              placeholder="按登录账号或姓名模糊查询"
              class="mt-2 w-72 rounded-xl border-2 border-memphis-dark bg-canvas px-3 py-2 font-sans text-xs text-ink-body outline-none placeholder:text-ink-muted"
              @keyup.enter="search"
            />
          </label>
          <label class="block">
            <span class="font-sans text-xs font-bold text-memphis-dark">状态</span>
            <select
              v-model="filters.status"
              class="mt-2 rounded-xl border-2 border-memphis-dark bg-canvas px-3 py-2 font-sans text-xs text-ink-body outline-none"
            >
              <option value="all">全部</option>
              <option value="normal">正常</option>
              <option value="disabled">已禁用</option>
            </select>
          </label>
          <div class="flex gap-3">
            <button
              type="button"
              class="m-pressable rounded-xl border-2 border-memphis-dark bg-primary px-5 py-2 font-sans text-xs font-bold text-white shadow-memphis-sm"
              @click="search"
            >
              查询
            </button>
            <button
              type="button"
              class="m-pressable rounded-xl border-2 border-memphis-dark bg-card px-5 py-2 font-sans text-xs font-bold text-memphis-dark"
              @click="reset"
            >
              重置
            </button>
          </div>
        </div>
        <span class="rounded-full border-2 border-memphis-dark bg-canvas px-3 py-1 font-sans text-xs text-ink-muted">
          匹配 {{ total }} 个账号
        </span>
      </div>
    </div>

    <!-- 账号列表 -->
    <div class="m-card">
      <div class="flex items-center justify-between border-b-2 border-memphis-dark px-6 py-4">
        <span class="font-sans text-base font-bold text-memphis-dark">账号列表</span>
        <span class="font-sans text-xs text-ink-muted">按创建时间倒序 · 每页 {{ PAGE_SIZE }} 条</span>
      </div>

      <p
        v-if="errorMessage"
        class="m-6 rounded-xl border-2 border-memphis-dark bg-danger/10 px-4 py-3 font-sans text-xs leading-relaxed text-danger"
      >
        {{ errorMessage }}
      </p>

      <div v-else class="tbl-scroll">
        <table class="w-full border-collapse">
          <thead>
            <tr class="border-b-2 border-memphis-dark bg-canvas">
              <th class="tbl-nowrap px-6 py-3 text-left font-sans text-sm font-semibold text-memphis-dark">账号</th>
              <th class="tbl-nowrap px-6 py-3 text-left font-sans text-sm font-semibold text-memphis-dark">角色</th>
              <th class="tbl-nowrap px-6 py-3 text-left font-sans text-sm font-semibold text-memphis-dark">状态</th>
              <th class="tbl-nowrap px-6 py-3 text-left font-sans text-sm font-semibold text-memphis-dark">最近登录</th>
              <th class="tbl-nowrap px-6 py-3 text-left font-sans text-sm font-semibold text-memphis-dark">创建时间</th>
              <th class="tbl-nowrap px-6 py-3 text-left font-sans text-sm font-semibold text-memphis-dark">操作</th>
            </tr>
          </thead>
          <tbody>
            <template v-if="loading">
              <tr v-for="i in 5" :key="`skeleton-${i}`" class="border-b border-ink-line">
                <td colspan="6" class="px-6 py-4">
                  <div class="h-4 w-full animate-pulse rounded-full bg-ink-line"></div>
                </td>
              </tr>
            </template>
            <template v-else-if="isEmpty">
              <tr>
                <td colspan="6" class="px-6 py-16">
                  <div class="flex flex-col items-center gap-3">
                    <span class="flex h-16 w-16 items-center justify-center rounded-full border-2 border-memphis-dark bg-canvas">
                      <span class="material-symbols-outlined text-[28px] text-memphis-dark">admin_panel_settings</span>
                    </span>
                    <span class="rounded-full border-2 border-memphis-dark bg-warning px-3 py-0.5 font-sans text-[11px] font-bold text-memphis-dark">
                      暂无账号
                    </span>
                    <span class="font-sans text-xs text-ink-muted">没有匹配的管理员账号，点击右上角「创建账号」添加</span>
                  </div>
                </td>
              </tr>
            </template>
            <template v-else>
              <tr v-for="row in list" :key="row._id" class="border-b border-ink-line transition-colors hover:bg-canvas">
                <td class="px-6 py-4">
                  <div class="flex items-center gap-3 whitespace-nowrap">
                    <span class="flex h-9 w-9 items-center justify-center rounded-full border-2 border-memphis-dark bg-primary-light font-sans text-sm font-bold text-memphis-dark">
                      {{ (row.name || row.username || '?').slice(0, 1) }}
                    </span>
                    <div class="flex flex-col">
                      <span class="font-mono text-sm font-bold text-memphis-dark">{{ row.username }}</span>
                      <span class="mt-0.5 font-sans text-xs text-ink-muted">{{ row.name || '未填姓名' }}</span>
                    </div>
                  </div>
                </td>
                <td class="px-6 py-4">
                  <span
                    class="inline-flex items-center gap-1 whitespace-nowrap rounded-full border-2 border-memphis-dark px-2.5 py-0.5 font-sans text-[11px] font-bold shadow-memphis-xs"
                    :class="roleOf(row.role).cls"
                  >
                    {{ roleOf(row.role).label }}
                  </span>
                </td>
                <td class="px-6 py-4">
                  <span
                    class="inline-flex items-center gap-1 whitespace-nowrap rounded-full border-2 border-memphis-dark px-2.5 py-0.5 font-sans text-[11px] font-bold shadow-memphis-xs"
                    :class="row.status === 'normal' ? 'bg-memphis-green text-memphis-dark' : 'bg-danger-light text-danger'"
                  >
                    {{ row.status === 'normal' ? '正常' : '已禁用' }}
                  </span>
                </td>
                <td class="tbl-nowrap px-6 py-4 font-sans text-sm text-ink-body">{{ formatTime(row.last_login_at) }}</td>
                <td class="tbl-nowrap px-6 py-4 font-sans text-sm text-ink-body">{{ formatTime(row.created_at) }}</td>
                <td class="px-6 py-4">
                  <div class="flex items-center gap-3">
                    <button
                      type="button"
                      class="m-pressable whitespace-nowrap rounded-xl border-2 border-memphis-dark bg-card px-3 py-1.5 font-sans text-xs font-bold text-memphis-dark shadow-memphis-xs"
                      @click="openReset(row)"
                    >
                      重置密码
                    </button>
                    <button
                      v-if="auth.admin && row._id !== auth.admin._id"
                      type="button"
                      :disabled="pendingId === row._id"
                      class="m-pressable whitespace-nowrap rounded-xl border-2 border-memphis-dark px-3 py-1.5 font-sans text-xs font-bold shadow-memphis-xs disabled:opacity-50"
                      :class="row.status === 'normal' ? 'bg-danger-light text-danger' : 'bg-success-light text-ink-body'"
                      @click="toggleStatus(row)"
                    >
                      {{ row.status === 'normal' ? '禁用' : '启用' }}
                    </button>
                    <span v-else class="font-sans text-[11px] text-ink-muted">当前账号</span>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>

      <div class="flex flex-wrap items-center justify-between gap-3 border-t-2 border-memphis-dark px-6 py-4">
        <span class="font-sans text-xs text-ink-muted">第 {{ page }} / {{ totalPages }} 页 · 共 {{ total }} 条</span>
        <div class="flex items-center gap-3">
          <button
            type="button"
            :disabled="page <= 1 || loading"
            class="m-pressable rounded-xl border-2 border-memphis-dark bg-card px-4 py-1.5 font-sans text-xs font-bold text-memphis-dark disabled:opacity-40"
            @click="goPage(page - 1)"
          >
            上一页
          </button>
          <button
            type="button"
            :disabled="page >= totalPages || loading"
            class="m-pressable rounded-xl border-2 border-memphis-dark bg-card px-4 py-1.5 font-sans text-xs font-bold text-memphis-dark disabled:opacity-40"
            @click="goPage(page + 1)"
          >
            下一页
          </button>
        </div>
      </div>
    </div>

    <!-- 创建账号弹窗 -->
    <el-dialog v-model="create.visible" title="创建管理员账号" width="460px" :close-on-click-modal="false" align-center>
      <div class="space-y-4 py-2">
        <label class="block">
          <span class="mb-2 block font-sans text-xs font-bold text-memphis-dark">登录账号</span>
          <input
            v-model="create.username"
            type="text"
            :maxlength="USERNAME_MAX"
            placeholder="字母开头，3~32 位字母 / 数字 / 下划线"
            class="w-full rounded-xl border-2 border-memphis-dark bg-canvas px-3 py-2 font-sans text-xs text-ink-body outline-none placeholder:text-ink-muted"
          />
        </label>
        <label class="block">
          <span class="mb-2 block font-sans text-xs font-bold text-memphis-dark">初始密码</span>
          <input
            v-model="create.password"
            type="password"
            :maxlength="64"
            placeholder="至少 6 位"
            class="w-full rounded-xl border-2 border-memphis-dark bg-canvas px-3 py-2 font-sans text-xs text-ink-body outline-none placeholder:text-ink-muted"
          />
        </label>
        <label class="block">
          <span class="mb-2 block font-sans text-xs font-bold text-memphis-dark">角色</span>
          <div class="flex gap-3">
            <button
              v-for="opt in ROLE_OPTIONS"
              :key="opt.value"
              type="button"
              class="flex-1 rounded-xl border-2 px-3 py-2 text-left font-sans"
              :class="create.role === opt.value ? 'border-memphis-dark bg-primary-light shadow-memphis-xs' : 'border-ink-line bg-card'"
              @click="create.role = opt.value"
            >
              <span class="text-xs font-bold text-memphis-dark">{{ opt.label }}</span>
            </button>
          </div>
        </label>
        <label class="block">
          <span class="mb-2 block font-sans text-xs font-bold text-memphis-dark">姓名（可选）</span>
          <input
            v-model="create.name"
            type="text"
            :maxlength="NAME_MAX"
            placeholder="管理员的真实姓名"
            class="w-full rounded-xl border-2 border-memphis-dark bg-canvas px-3 py-2 font-sans text-xs text-ink-body outline-none placeholder:text-ink-muted"
          />
        </label>
        <p v-if="create.error" class="rounded-xl border-2 border-memphis-dark bg-danger/10 px-4 py-3 font-sans text-xs leading-relaxed text-danger">
          {{ create.error }}
        </p>
      </div>
      <template #footer>
        <button
          type="button"
          class="m-pressable rounded-xl border-2 border-memphis-dark bg-card px-5 py-2 font-sans text-xs font-bold text-memphis-dark"
          @click="create.visible = false"
        >
          取消
        </button>
        <button
          type="button"
          :disabled="create.saving"
          class="m-pressable ml-3 rounded-xl border-2 border-memphis-dark bg-primary px-5 py-2 font-sans text-xs font-bold text-white shadow-memphis-sm disabled:opacity-50"
          @click="submitCreate"
        >
          {{ create.saving ? '创建中…' : '创建' }}
        </button>
      </template>
    </el-dialog>

    <!-- 重置密码弹窗 -->
    <el-dialog v-model="resetDlg.visible" title="重置密码" width="420px" :close-on-click-modal="false" align-center>
      <div class="space-y-4 py-2">
        <p class="font-sans text-xs text-ink-muted">
          将重置「<span class="font-mono font-bold text-memphis-dark">{{ resetDlg.target && resetDlg.target.username }}</span>」的登录密码，并清除失败计数与锁定状态。
        </p>
        <label class="block">
          <span class="mb-2 block font-sans text-xs font-bold text-memphis-dark">新密码</span>
          <input
            v-model="resetDlg.new_password"
            type="password"
            :maxlength="64"
            placeholder="至少 6 位"
            class="w-full rounded-xl border-2 border-memphis-dark bg-canvas px-3 py-2 font-sans text-xs text-ink-body outline-none placeholder:text-ink-muted"
          />
        </label>
        <p v-if="resetDlg.error" class="rounded-xl border-2 border-memphis-dark bg-danger/10 px-4 py-3 font-sans text-xs leading-relaxed text-danger">
          {{ resetDlg.error }}
        </p>
      </div>
      <template #footer>
        <button
          type="button"
          class="m-pressable rounded-xl border-2 border-memphis-dark bg-card px-5 py-2 font-sans text-xs font-bold text-memphis-dark"
          @click="resetDlg.visible = false"
        >
          取消
        </button>
        <button
          type="button"
          :disabled="resetDlg.saving"
          class="m-pressable ml-3 rounded-xl border-2 border-memphis-dark bg-primary px-5 py-2 font-sans text-xs font-bold text-white shadow-memphis-sm disabled:opacity-50"
          @click="submitReset"
        >
          {{ resetDlg.saving ? '重置中…' : '确认重置' }}
        </button>
      </template>
    </el-dialog>

    <!-- 自助修改密码弹窗 -->
    <el-dialog v-model="changeDlg.visible" title="修改我的密码" width="420px" :close-on-click-modal="false" align-center>
      <div class="space-y-4 py-2">
        <label class="block">
          <span class="mb-2 block font-sans text-xs font-bold text-memphis-dark">原密码</span>
          <input
            v-model="changeDlg.old_password"
            type="password"
            :maxlength="64"
            placeholder="当前登录密码"
            class="w-full rounded-xl border-2 border-memphis-dark bg-canvas px-3 py-2 font-sans text-xs text-ink-body outline-none placeholder:text-ink-muted"
          />
        </label>
        <label class="block">
          <span class="mb-2 block font-sans text-xs font-bold text-memphis-dark">新密码</span>
          <input
            v-model="changeDlg.new_password"
            type="password"
            :maxlength="64"
            placeholder="至少 6 位"
            class="w-full rounded-xl border-2 border-memphis-dark bg-canvas px-3 py-2 font-sans text-xs text-ink-body outline-none placeholder:text-ink-muted"
          />
        </label>
        <p v-if="changeDlg.error" class="rounded-xl border-2 border-memphis-dark bg-danger/10 px-4 py-3 font-sans text-xs leading-relaxed text-danger">
          {{ changeDlg.error }}
        </p>
      </div>
      <template #footer>
        <button
          type="button"
          class="m-pressable rounded-xl border-2 border-memphis-dark bg-card px-5 py-2 font-sans text-xs font-bold text-memphis-dark"
          @click="changeDlg.visible = false"
        >
          取消
        </button>
        <button
          type="button"
          :disabled="changeDlg.saving"
          class="m-pressable ml-3 rounded-xl border-2 border-memphis-dark bg-primary px-5 py-2 font-sans text-xs font-bold text-white shadow-memphis-sm disabled:opacity-50"
          @click="submitChange"
        >
          {{ changeDlg.saving ? '保存中…' : '保存' }}
        </button>
      </template>
    </el-dialog>
  </div>
</template>