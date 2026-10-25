<script setup>
/**
 * 用户查询与账号管理（P1-02 / ADM-01②）
 *
 * 接口：POST /admin/users/query、POST /admin/users/disable、POST /admin/users/enable
 * （均为管理通道 + super / auditor 角色；服务端同样校验角色，不依赖前端路由守卫）
 *
 * 口径说明：
 * - openid 仅展示脱敏值（后端口径，需求八·隐私最小化）；学号完整展示以支撑管理端查询；
 * - 禁用 = 学生端「仅浏览」，报名 / 签到 / 招新等写操作由 requireActiveStudent 拦截；
 * - 禁用 / 解封均需二次确认（对照 4.3.3「封禁前需二次确认」的管理端一致体验）。
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { request } from '@/utils/request'

const PAGE_SIZE = 20
const MAX_KEYWORD = 32

const filters = reactive({ keyword: '', status: 'all', auth_status: 'all' })
const list = ref([])
const total = ref(0)
const page = ref(1)
const loading = ref(false)
const errorMessage = ref('')
const pendingId = ref('')
let requestSeq = 0

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

function profileOf(row) {
  return [row.college, row.major].filter(Boolean).join(' · ') || '未认证 · 无学籍信息'
}

async function load() {
  const seq = ++requestSeq
  loading.value = true
  errorMessage.value = ''
  const res = await request({
    path: '/admin/users/query',
    method: 'POST',
    data: {
      keyword: filters.keyword.trim(),
      status: filters.status,
      auth_status: filters.auth_status,
      page: page.value,
      page_size: PAGE_SIZE,
    },
  })
  if (seq !== requestSeq) return // 丢弃过期响应（快速连点 / 改筛选）
  loading.value = false
  if (res.code !== 0 || !res.data) {
    errorMessage.value = res.message || '用户列表加载失败，请稍后重试'
    list.value = []
    total.value = 0
    return
  }
  list.value = res.data.list || []
  total.value = res.data.total || 0
  // 末页被清空（该页最后一位用户被处理后）→ 自动回退一页
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
  filters.auth_status = 'all'
  page.value = 1
  load()
}

function goPage(next) {
  if (next < 1 || next > totalPages.value || next === page.value) return
  page.value = next
  load()
}

async function toggleStatus(row) {
  const disabling = row.status === 'normal'
  const action = disabling ? '禁用' : '解封'
  const who = row.name || row.student_no || '该用户'
  const tip = disabling
    ? `禁用后「${who}」在小程序端仅可浏览，报名 / 签到 / 招新等写操作将被拦截并提示。`
    : `解封后「${who}」将立即恢复全部操作权限。`
  try {
    await ElMessageBox.confirm(tip, `确认${action}？`, {
      confirmButtonText: `确认${action}`,
      cancelButtonText: '取消',
      type: disabling ? 'warning' : 'info',
    })
  } catch (e) {
    return // 用户取消
  }

  pendingId.value = row._id
  const res = await request({
    path: disabling ? '/admin/users/disable' : '/admin/users/enable',
    method: 'POST',
    data: { user_id: row._id },
  })
  pendingId.value = ''
  if (res.code !== 0) {
    ElMessage.error(res.message || `${action}失败，请稍后重试`)
    return
  }
  ElMessage.success(`已${action}「${who}」`)
  await load()
}

onMounted(load)
</script>

<template>
  <div class="space-y-6">
    <!-- 查询与筛选 -->
    <div class="m-card p-6">
      <div class="flex flex-wrap items-end justify-between gap-4">
        <div class="flex flex-wrap items-end gap-5">
          <label class="block">
            <span class="font-sans text-xs font-bold text-memphis-dark">姓名 / 学号</span>
            <input
              v-model="filters.keyword"
              type="search"
              :maxlength="MAX_KEYWORD"
              placeholder="模糊查询，如「林」或「20260001」"
              class="mt-2 w-72 rounded-xl border-2 border-memphis-dark bg-canvas px-3 py-2 font-sans text-xs text-ink-body outline-none placeholder:text-ink-muted"
              @keyup.enter="search"
            />
          </label>

          <label class="block">
            <span class="font-sans text-xs font-bold text-memphis-dark">账号态</span>
            <select
              v-model="filters.status"
              class="mt-2 rounded-xl border-2 border-memphis-dark bg-canvas px-3 py-2 font-sans text-xs text-ink-body outline-none"
            >
              <option value="all">全部</option>
              <option value="normal">正常</option>
              <option value="disabled">已禁用</option>
            </select>
          </label>

          <label class="block">
            <span class="font-sans text-xs font-bold text-memphis-dark">认证态</span>
            <select
              v-model="filters.auth_status"
              class="mt-2 rounded-xl border-2 border-memphis-dark bg-canvas px-3 py-2 font-sans text-xs text-ink-body outline-none"
            >
              <option value="all">全部</option>
              <option value="verified">已认证</option>
              <option value="unverified">未认证</option>
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
          匹配 {{ total }} 人
        </span>
      </div>

      <p class="mt-4 font-sans text-xs leading-relaxed text-ink-muted">
        禁用为「仅浏览」：被禁用用户仍可浏览社团与活动，但报名 / 签到 / 招新等写操作会被拦截并提示；解封后立即恢复。
        微信 openid 仅展示脱敏值。
      </p>
    </div>

    <!-- 用户列表 -->
    <div class="m-card">
      <div class="flex items-center justify-between border-b-2 border-memphis-dark px-6 py-4">
        <span class="font-sans text-base font-bold text-memphis-dark">用户列表</span>
        <span class="font-sans text-xs text-ink-muted">按注册时间倒序 · 每页 {{ PAGE_SIZE }} 条</span>
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
              <th class="tbl-nowrap px-6 py-3 text-left font-sans text-sm font-semibold text-memphis-dark">用户</th>
              <th class="tbl-nowrap px-6 py-3 text-left font-sans text-sm font-semibold text-memphis-dark">学号</th>
              <th class="tbl-nowrap px-6 py-3 text-left font-sans text-sm font-semibold text-memphis-dark">微信绑定</th>
              <th class="tbl-nowrap px-6 py-3 text-left font-sans text-sm font-semibold text-memphis-dark">注册时间</th>
              <th class="tbl-nowrap px-6 py-3 text-left font-sans text-sm font-semibold text-memphis-dark">账号态</th>
              <th class="tbl-nowrap px-6 py-3 text-left font-sans text-sm font-semibold text-memphis-dark">操作</th>
            </tr>
          </thead>
          <tbody>
            <!-- 加载态：整行骨架条（design.md §5 UI 状态矩阵） -->
            <template v-if="loading">
              <tr v-for="i in 5" :key="`skeleton-${i}`" class="border-b border-ink-line">
                <td colspan="6" class="px-6 py-4">
                  <div class="h-4 w-full animate-pulse rounded-full bg-ink-line"></div>
                </td>
              </tr>
            </template>

            <!-- 空态：孟菲斯大眼睛 + 黄色胶囊提示 -->
            <template v-else-if="isEmpty">
              <tr>
                <td colspan="6" class="px-6 py-16">
                  <div class="flex flex-col items-center gap-3">
                    <span
                      class="flex h-16 w-16 items-center justify-center rounded-full border-2 border-memphis-dark bg-canvas"
                    >
                      <span class="material-symbols-outlined text-[28px] text-memphis-dark">visibility</span>
                    </span>
                    <span
                      class="rounded-full border-2 border-memphis-dark bg-warning px-3 py-0.5 font-sans text-[11px] font-bold text-memphis-dark"
                    >
                      暂无内容
                    </span>
                    <span class="font-sans text-xs text-ink-muted">没有匹配的用户，试试调整姓名 / 学号或筛选条件</span>
                  </div>
                </td>
              </tr>
            </template>

            <template v-else>
              <tr
                v-for="row in list"
                :key="row._id"
                class="border-b border-ink-line transition-colors hover:bg-canvas"
              >
                <!-- 用户：头像 + 姓名 + 认证徽标（水平单行平铺） -->
                <td class="px-6 py-4">
                  <div class="flex items-center gap-3 whitespace-nowrap">
                    <div
                      class="flex h-9 w-9 items-center justify-center rounded-full border-2 border-memphis-dark bg-primary-light font-sans text-sm font-bold text-memphis-dark"
                    >
                      {{ (row.name || row.nickname || '?').slice(0, 1) }}
                    </div>
                    <div class="flex flex-col">
                      <div class="flex items-center gap-2">
                        <span class="font-sans text-sm font-bold text-memphis-dark">
                          {{ row.name || row.nickname || '未设置昵称' }}
                        </span>
                        <span
                          v-if="row.auth_status === 'verified'"
                          class="rounded-full border border-info bg-info-light px-2 py-0.5 font-sans text-[11px] font-medium text-info-text"
                          >✓ 白名单已认证</span
                        >
                        <span
                          v-else
                          class="rounded-full border border-ink-line bg-canvas px-2 py-0.5 font-sans text-[11px] text-ink-muted"
                          >未认证</span
                        >
                      </div>
                      <span class="mt-0.5 font-sans text-xs text-ink-muted">{{ profileOf(row) }}</span>
                    </div>
                  </div>
                </td>

                <td class="tbl-nowrap px-6 py-4 font-mono text-sm text-ink-body">{{ row.student_no || '—' }}</td>

                <!-- 微信绑定情况（openid 脱敏） -->
                <td class="px-6 py-4">
                  <div class="flex items-center gap-2 whitespace-nowrap">
                    <span class="font-mono text-xs text-ink-body">{{ row.openid_masked || '—' }}</span>
                    <span
                      class="rounded-full border-2 border-memphis-dark px-2 py-0.5 font-sans text-[11px] font-bold"
                      :class="row.openid_bound ? 'bg-success-light text-ink-body' : 'bg-canvas text-ink-muted'"
                    >
                      {{ row.openid_bound ? '已绑定' : '未绑定' }}
                    </span>
                  </div>
                </td>

                <td class="tbl-nowrap px-6 py-4 font-sans text-sm text-ink-body">{{ formatTime(row.created_at) }}</td>

                <td class="px-6 py-4">
                  <span
                    class="inline-flex items-center gap-1 whitespace-nowrap rounded-full border-2 border-memphis-dark px-2.5 py-0.5 font-sans text-[11px] font-bold shadow-memphis-xs"
                    :class="row.status === 'normal' ? 'bg-memphis-green text-memphis-dark' : 'bg-danger-light text-danger'"
                  >
                    <span v-if="row.status === 'normal'">✓</span>
                    <span v-else>!</span>
                    {{ row.status === 'normal' ? '正常' : '已禁用' }}
                  </span>
                </td>

                <td class="px-6 py-4">
                  <button
                    type="button"
                    :disabled="pendingId === row._id"
                    class="m-pressable whitespace-nowrap rounded-xl border-2 border-memphis-dark px-3 py-1.5 font-sans text-xs font-bold shadow-memphis-xs disabled:opacity-50"
                    :class="row.status === 'normal' ? 'bg-danger-light text-danger' : 'bg-success-light text-ink-body'"
                    @click="toggleStatus(row)"
                  >
                    {{ row.status === 'normal' ? '禁用' : '解封' }}
                  </button>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>

      <div class="flex flex-wrap items-center justify-between gap-3 border-t-2 border-memphis-dark px-6 py-4">
        <span class="font-sans text-xs text-ink-muted">
          第 {{ page }} / {{ totalPages }} 页 · 共 {{ total }} 条
        </span>
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
  </div>
</template>
