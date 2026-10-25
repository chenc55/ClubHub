<script setup>
/**
 * 招新审核（P1-16 / ADM-04，管理端审核中心「招新审核」tab）
 *
 * 接口：POST /recruitment/review-query（待审 / 已审列表）、POST /recruitment/review（通过 / 驳回）
 * 规则：仅 pending 可审；通过 → open（开放报名）；驳回 → 回退 draft + 必填理由（≥2 字），发起人可修改重提；
 *      两种结果都通知发起人（club_recruitment_review）。
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { request } from '@/utils/request'

const PAGE_SIZE = 20
const STATUS_META = {
  pending: { label: '待审核', cls: 'bg-warning text-memphis-dark' },
  open: { label: '已通过', cls: 'bg-memphis-green text-memphis-dark' },
  draft: { label: '已驳回回退', cls: 'bg-danger-light text-danger' },
}
const FIELD_TYPE_LABEL = { single: '单选', multi: '多选', text: '问答' }

const filters = reactive({ status: 'pending' })
const list = ref([])
const total = ref(0)
const pendingTotal = ref(0)
const page = ref(1)
const loading = ref(false)
const errorMessage = ref('')
const pendingId = ref('')
const detailRow = ref(null)
let requestSeq = 0

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))
const isEmpty = computed(() => !loading.value && !errorMessage.value && list.value.length === 0)

const detailFields = computed(() => {
  const row = detailRow.value
  if (!row) return []
  const fields = (Array.isArray(row.form_fields) ? row.form_fields : []).map(
    (f) => `${f.label}（${FIELD_TYPE_LABEL[f.type] || f.type}${f.required ? '，必填' : ''}）${f.type !== 'text' && Array.isArray(f.options) ? '：' + f.options.join(' / ') : ''}`
  )
  return [
    { label: '所属社团', value: row.club_name || '—' },
    { label: '报名截止', value: formatTime(row.signup_end) },
    { label: '招聘人数', value: row.capacity ? `${row.capacity} 人` : '不限' },
    { label: '招新流程', value: row.multi_step ? '多步（含面试）' : '单轮' },
    { label: '报名表字段', value: fields.length ? fields.join('；') : '—' },
    { label: '岗位内容', value: row.content || '—' },
    { label: '提交时间', value: formatTime(row.created_at) },
    { label: '发起人', value: row.submitter_name || row.submitter_id || '—' },
    { label: '审核人', value: row.review_by || '—' },
    { label: '审核时间', value: formatTime(row.review_at) },
  ]
})

function formatTime(value) {
  if (!value) return '—'
  const raw = value && typeof value === 'object' && value.$date ? value.$date : value
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return '—'
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

async function load() {
  const seq = ++requestSeq
  loading.value = true
  errorMessage.value = ''
  const res = await request({
    path: '/recruitment/review-query',
    method: 'POST',
    data: { status: filters.status, page: page.value, page_size: PAGE_SIZE },
  })
  if (seq !== requestSeq) return
  loading.value = false
  if (res.code !== 0 || !res.data) {
    errorMessage.value = res.message || '招新列表加载失败，请稍后重试'
    list.value = []
    total.value = 0
    return
  }
  list.value = res.data.list || []
  total.value = res.data.total || 0
  pendingTotal.value = res.data.pending_total || 0
  if (!list.value.length && page.value > 1) {
    page.value -= 1
    await load()
  }
}

function search(status) {
  if (status) filters.status = status
  page.value = 1
  load()
}

function goPage(next) {
  if (next < 1 || next > totalPages.value || next === page.value) return
  page.value = next
  load()
}

function openDetail(row) {
  detailRow.value = row
}
function closeDetail() {
  detailRow.value = null
}

async function approve(row) {
  try {
    await ElMessageBox.confirm(
      `通过后「${row.title}」进入开放状态，学生即可报名，并自动通知发起人「${row.submitter_name || '（未知）'}」。`,
      '确认通过该招新岗位？',
      { confirmButtonText: '确认通过', cancelButtonText: '取消', type: 'warning' }
    )
  } catch (e) {
    return
  }
  await review(row, 'approve', '')
}

async function reject(row) {
  let reason = ''
  try {
    const input = await ElMessageBox.prompt('驳回后岗位将退回发起人草稿箱，理由会同时通知发起人，请填写具体原因。', '驳回招新岗位', {
      confirmButtonText: '确认驳回',
      cancelButtonText: '取消',
      inputPlaceholder: '例如：岗位内容与社团定位不符，请调整后重新提交',
      inputValidator: (value) => (String(value || '').trim().length >= 2 ? true : '请填写至少 2 个字的理由'),
    })
    reason = String(input.value || '').trim()
  } catch (e) {
    return
  }
  await review(row, 'reject', reason)
}

async function review(row, action, reason) {
  const label = action === 'approve' ? '通过' : '驳回'
  pendingId.value = row._id
  const res = await request({
    path: '/recruitment/review',
    method: 'POST',
    data: { recruitment_id: row._id, action, reason },
  })
  pendingId.value = ''
  if (res.code !== 0) {
    ElMessage.error(res.message || `${label}失败，请稍后重试`)
    return
  }
  const notify = res.data && res.data.notify
  ElMessage.success(
    notify && notify.duplicate ? `已${label}（该岗位的通知此前已发送）` : `已${label}，结果已通知发起人`
  )
  await load()
}

onMounted(load)
</script>

<template>
  <div class="flex flex-col gap-4">
    <!-- 筛选 -->
    <div class="m-card p-6">
      <div class="flex flex-wrap items-end justify-between gap-4">
        <div class="flex flex-wrap items-end gap-5">
          <label class="block">
            <span class="font-sans text-xs font-bold text-memphis-dark">审核状态</span>
            <select
              v-model="filters.status"
              class="mt-2 rounded-xl border-2 border-memphis-dark bg-canvas px-3 py-2 font-sans text-xs text-ink-body outline-none"
            >
              <option value="pending">待审核</option>
              <option value="open">已通过</option>
              <option value="draft">已驳回回退</option>
              <option value="all">全部</option>
            </select>
          </label>
          <button
            type="button"
            class="m-pressable rounded-xl border-2 border-memphis-dark bg-primary px-5 py-2 font-sans text-xs font-bold text-white shadow-memphis-sm"
            @click="search()"
          >
            查询
          </button>
        </div>
        <span class="rounded-full border-2 border-memphis-dark bg-canvas px-3 py-1 font-sans text-xs text-ink-muted">
          匹配 {{ total }} 条 · 待审 {{ pendingTotal }} 条
        </span>
      </div>
    </div>

    <!-- 岗位列表 -->
    <div class="m-card">
      <div class="flex items-center justify-between border-b-2 border-memphis-dark px-6 py-4">
        <span class="font-sans text-base font-bold text-memphis-dark">招新岗位</span>
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
              <th class="tbl-nowrap px-6 py-3 text-left font-sans text-sm font-semibold text-memphis-dark">岗位</th>
              <th class="tbl-nowrap px-6 py-3 text-left font-sans text-sm font-semibold text-memphis-dark">所属社团</th>
              <th class="tbl-nowrap px-6 py-3 text-left font-sans text-sm font-semibold text-memphis-dark">报名截止 / 人数</th>
              <th class="tbl-nowrap px-6 py-3 text-left font-sans text-sm font-semibold text-memphis-dark">发起人</th>
              <th class="tbl-nowrap px-6 py-3 text-left font-sans text-sm font-semibold text-memphis-dark">提交时间</th>
              <th class="tbl-nowrap px-6 py-3 text-left font-sans text-sm font-semibold text-memphis-dark">状态</th>
              <th class="tbl-nowrap px-6 py-3 text-left font-sans text-sm font-semibold text-memphis-dark">操作</th>
            </tr>
          </thead>
          <tbody>
            <template v-if="loading">
              <tr v-for="i in 5" :key="`skeleton-${i}`" class="border-b border-ink-line">
                <td colspan="7" class="px-6 py-4">
                  <div class="h-4 w-full animate-pulse rounded-full bg-ink-line"></div>
                </td>
              </tr>
            </template>

            <template v-else-if="isEmpty">
              <tr>
                <td colspan="7" class="px-6 py-16">
                  <div class="flex flex-col items-center gap-3">
                    <span class="flex h-16 w-16 items-center justify-center rounded-full border-2 border-memphis-dark bg-canvas">
                      <span class="material-symbols-outlined text-[28px] text-memphis-dark">visibility</span>
                    </span>
                    <span class="rounded-full border-2 border-memphis-dark bg-warning px-3 py-0.5 font-sans text-[11px] font-bold text-memphis-dark">
                      暂无内容
                    </span>
                    <span class="font-sans text-xs text-ink-muted">当前筛选下没有招新岗位</span>
                  </div>
                </td>
              </tr>
            </template>

            <template v-else>
              <tr v-for="row in list" :key="row._id" class="border-b border-ink-line transition-colors hover:bg-canvas">
                <td class="px-6 py-4">
                  <button type="button" class="text-left" @click="openDetail(row)">
                    <span class="font-sans text-sm font-bold text-memphis-dark hover:underline">{{ row.title }}</span>
                  </button>
                </td>
                <td class="tbl-nowrap px-6 py-4 font-sans text-sm text-ink-body">{{ row.club_name || '—' }}</td>
                <td class="tbl-nowrap px-6 py-4 font-sans text-sm text-ink-body">
                  {{ formatTime(row.signup_end) }} · {{ row.capacity ? `${row.capacity} 人` : '不限' }}
                </td>
                <td class="tbl-nowrap px-6 py-4 font-sans text-sm text-ink-body">{{ row.submitter_name || '—' }}</td>
                <td class="tbl-nowrap px-6 py-4 font-sans text-sm text-ink-body">{{ formatTime(row.created_at) }}</td>
                <td class="px-6 py-4">
                  <div class="flex flex-col gap-1 whitespace-nowrap">
                    <span
                      class="inline-flex items-center gap-1 self-start rounded-full border-2 border-memphis-dark px-2.5 py-0.5 font-sans text-[11px] font-bold shadow-memphis-xs"
                      :class="STATUS_META[row.status] && STATUS_META[row.status].cls"
                    >
                      <span v-if="row.status === 'pending'" class="h-1.5 w-1.5 rounded-full bg-memphis-dark"></span>
                      <span v-else-if="row.status === 'open'">✓</span>
                      {{ (STATUS_META[row.status] && STATUS_META[row.status].label) || row.status }}
                    </span>
                    <span v-if="row.status === 'draft' && row.reject_reason" class="max-w-[200px] truncate font-sans text-[11px] text-danger" :title="row.reject_reason">
                      {{ row.reject_reason }}
                    </span>
                  </div>
                </td>
                <td class="px-6 py-4">
                  <div v-if="row.status === 'pending'" class="flex items-center gap-3">
                    <button
                      type="button"
                      :disabled="pendingId === row._id"
                      class="m-pressable whitespace-nowrap rounded-xl border-2 border-memphis-dark bg-memphis-green px-3 py-1.5 font-sans text-xs font-bold text-memphis-dark shadow-memphis-xs disabled:opacity-50"
                      @click="approve(row)"
                    >
                      通过
                    </button>
                    <button
                      type="button"
                      :disabled="pendingId === row._id"
                      class="m-pressable whitespace-nowrap rounded-xl border-2 border-memphis-dark bg-card px-3 py-1.5 font-sans text-xs font-bold text-danger shadow-memphis-xs disabled:opacity-50"
                      @click="reject(row)"
                    >
                      驳回
                    </button>
                  </div>
                  <span v-else class="font-sans text-xs text-ink-muted">已处理</span>
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

    <!-- 详情抽屉 -->
    <el-drawer
      :model-value="!!detailRow"
      title="招新岗位详情"
      size="440px"
      @close="closeDetail"
    >
      <div v-if="detailRow" class="space-y-4">
        <div>
          <h3 class="font-display text-lg font-bold text-memphis-dark">{{ detailRow.title }}</h3>
          <p class="mt-1 font-sans text-xs text-ink-muted">
            {{ detailRow.club_name || '—' }} · {{ formatTime(detailRow.signup_end) }} 截止 · 招聘 {{ detailRow.capacity ? `${detailRow.capacity} 人` : '不限' }}
          </p>
        </div>
        <div class="space-y-2 border-t-2 border-dashed border-memphis-dark pt-4">
          <div v-for="item in detailFields" :key="item.label" class="flex gap-3">
            <span class="w-20 shrink-0 font-sans text-xs font-bold text-memphis-dark">{{ item.label }}</span>
            <span class="whitespace-pre-wrap font-sans text-xs leading-relaxed text-ink-body">{{ item.value }}</span>
          </div>
        </div>
      </div>
    </el-drawer>
  </div>
</template>
