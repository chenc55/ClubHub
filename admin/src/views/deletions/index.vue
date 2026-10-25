<script setup>
/**
 * 注销管理（P3-02 / 需求 8.4）
 *
 * 接口：POST /admin/deletion-requests/query、POST /admin/deletion-requests/review
 * （管理通道 + super / auditor 角色，服务端 requireRole 二次校验）
 *
 * 口径说明：
 * - 学生端提交注销申请 → 管理端人工处理：通过 = users 软删 + 个人可识别字段匿名化（学号清空、姓名「已注销」）；
 *   驳回 = 附理由 + 站内通知申请人（场景 account_deletion_result）；
 * - 列表 join 申请人脱敏学号（完整学号仅平台管理员可见）。
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { request } from '@/utils/request'

const PAGE_SIZE = 20
const REASON_MAX = 200

const STATUS_META = {
  pending: { label: '待处理', cls: 'bg-warning text-memphis-dark' },
  approved: { label: '已注销', cls: 'bg-ink-line/60 text-ink-muted' },
  rejected: { label: '已驳回', cls: 'bg-danger-light text-danger' },
}

const filters = reactive({ status: 'all' })
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

function statusOf(status) {
  return STATUS_META[status] || STATUS_META.pending
}

async function load() {
  const seq = ++requestSeq
  loading.value = true
  errorMessage.value = ''
  const res = await request({
    path: '/admin/deletion-requests/query',
    method: 'POST',
    data: { status: filters.status, page: page.value, page_size: PAGE_SIZE },
  })
  if (seq !== requestSeq) return
  loading.value = false
  if (res.code !== 0 || !res.data) {
    errorMessage.value = res.message || '注销申请加载失败，请稍后重试'
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

function goPage(next) {
  if (next < 1 || next > totalPages.value || next === page.value) return
  page.value = next
  load()
}

async function approve(row) {
  try {
    await ElMessageBox.confirm(
      `通过后「${row.applicant_name}」的账号将被注销：学号、姓名、微信绑定等个人数据匿名化处理，关联业务记录保留审计。确认通过？`,
      '通过注销申请',
      { confirmButtonText: '确认通过', cancelButtonText: '取消', type: 'warning' }
    )
  } catch (e) {
    return
  }
  pendingId.value = row._id
  const res = await request({ path: '/admin/deletion-requests/review', method: 'POST', data: { id: row._id, action: 'approve' } })
  pendingId.value = ''
  if (res.code !== 0) {
    ElMessage.error(res.message || '操作失败，请稍后重试')
    return
  }
  ElMessage.success('已通过，账号已注销并匿名化')
  await load()
}

async function reject(row) {
  let reason = ''
  try {
    const res = await ElMessageBox.prompt('请填写驳回理由（将随站内通知发送给申请人）', '驳回注销申请', {
      confirmButtonText: '驳回',
      cancelButtonText: '取消',
      inputType: 'textarea',
      inputPlaceholder: `理由（必填，最长 ${REASON_MAX} 字）`,
      inputValidator: (v) => (v && v.trim() ? true : '请填写驳回理由'),
    })
    reason = res.value.trim()
  } catch (e) {
    return
  }
  pendingId.value = row._id
  const res = await request({ path: '/admin/deletion-requests/review', method: 'POST', data: { id: row._id, action: 'reject', reason } })
  pendingId.value = ''
  if (res.code !== 0) {
    ElMessage.error(res.message || '操作失败，请稍后重试')
    return
  }
  ElMessage.success('已驳回并通知申请人')
  await load()
}

onMounted(load)
</script>

<template>
  <div class="space-y-6">
    <!-- 查询 -->
    <div class="m-card p-6">
      <div class="flex flex-wrap items-end justify-between gap-4">
        <label class="block">
          <span class="font-sans text-xs font-bold text-memphis-dark">状态</span>
          <select
            v-model="filters.status"
            class="mt-2 rounded-xl border-2 border-memphis-dark bg-canvas px-3 py-2 font-sans text-xs text-ink-body outline-none"
          >
            <option value="all">全部</option>
            <option value="pending">待处理</option>
            <option value="approved">已注销</option>
            <option value="rejected">已驳回</option>
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
        </div>
      </div>
      <p class="mt-4 font-sans text-xs leading-relaxed text-ink-muted">
        学生端「设置-注销账号」提交个人数据删除申请，此处人工审核。通过后账号软删 + 个人可识别字段匿名化（学号清空、
        姓名「已注销」），关联业务记录保留审计；驳回需填理由并站内通知申请人（需求 8.4）。共 {{ total }} 条
      </p>
    </div>

    <!-- 列表 -->
    <div class="m-card">
      <div class="flex items-center justify-between border-b-2 border-memphis-dark px-6 py-4">
        <span class="font-sans text-base font-bold text-memphis-dark">注销申请</span>
        <span class="font-sans text-xs text-ink-muted">按提交时间倒序 · 每页 {{ PAGE_SIZE }} 条</span>
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
              <th class="tbl-nowrap px-6 py-3 text-left font-sans text-sm font-semibold text-memphis-dark">申请人</th>
              <th class="tbl-nowrap px-6 py-3 text-left font-sans text-sm font-semibold text-memphis-dark">注销理由</th>
              <th class="tbl-nowrap px-6 py-3 text-left font-sans text-sm font-semibold text-memphis-dark">状态</th>
              <th class="tbl-nowrap px-6 py-3 text-left font-sans text-sm font-semibold text-memphis-dark">提交时间</th>
              <th class="tbl-nowrap px-6 py-3 text-left font-sans text-sm font-semibold text-memphis-dark">处理人</th>
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
                      <span class="material-symbols-outlined text-[28px] text-memphis-dark">person_off</span>
                    </span>
                    <span class="rounded-full border-2 border-memphis-dark bg-warning px-3 py-0.5 font-sans text-[11px] font-bold text-memphis-dark">
                      暂无申请
                    </span>
                    <span class="font-sans text-xs text-ink-muted">没有匹配的注销申请</span>
                  </div>
                </td>
              </tr>
            </template>

            <template v-else>
              <tr v-for="row in list" :key="row._id" class="border-b border-ink-line transition-colors hover:bg-canvas">
                <td class="px-6 py-4">
                  <div class="flex items-center gap-3">
                    <span class="flex h-8 w-8 items-center justify-center rounded-full border-2 border-memphis-dark bg-primary-light">
                      <span class="material-symbols-outlined text-[18px] text-memphis-dark">person</span>
                    </span>
                    <div>
                      <p class="font-sans text-sm font-bold text-memphis-dark">{{ row.applicant_name }}</p>
                      <p class="font-mono text-[11px] text-ink-muted">{{ row.applicant_no_masked || '—' }}</p>
                    </div>
                  </div>
                </td>

                <td class="px-6 py-4">
                  <p class="max-w-[260px] truncate font-sans text-xs text-ink-body">{{ row.reason || '—' }}</p>
                  <p v-if="row.reject_reason" class="mt-1 max-w-[260px] truncate font-sans text-[11px] text-danger">
                    驳回理由：{{ row.reject_reason }}
                  </p>
                </td>

                <td class="px-6 py-4">
                  <span
                    class="inline-flex items-center gap-1 whitespace-nowrap rounded-full border-2 border-memphis-dark px-2.5 py-0.5 font-sans text-[11px] font-bold shadow-memphis-xs"
                    :class="statusOf(row.status).cls"
                  >
                    {{ statusOf(row.status).label }}
                  </span>
                </td>

                <td class="tbl-nowrap px-6 py-4 font-sans text-sm text-ink-body">{{ formatTime(row.created_at) }}</td>
                <td class="tbl-nowrap px-6 py-4 font-sans text-sm text-ink-body">{{ row.review_by || '—' }}</td>

                <td class="px-6 py-4">
                  <div v-if="row.status === 'pending'" class="flex items-center gap-3">
                    <button
                      type="button"
                      :disabled="pendingId === row._id"
                      class="m-pressable whitespace-nowrap rounded-xl border-2 border-memphis-dark bg-danger-light px-3 py-1.5 font-sans text-xs font-bold text-danger shadow-memphis-xs disabled:opacity-50"
                      @click="reject(row)"
                    >
                      驳回
                    </button>
                    <button
                      type="button"
                      :disabled="pendingId === row._id"
                      class="m-pressable whitespace-nowrap rounded-xl border-2 border-memphis-dark bg-primary px-3 py-1.5 font-sans text-xs font-bold text-white shadow-memphis-xs disabled:opacity-50"
                      @click="approve(row)"
                    >
                      {{ pendingId === row._id ? '处理中…' : '通过（注销）' }}
                    </button>
                  </div>
                  <span v-else class="font-sans text-[11px] text-ink-muted">已处理</span>
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
  </div>
</template>
