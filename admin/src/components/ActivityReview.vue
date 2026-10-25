<script setup>
/**
 * 活动审核（P1-11 / ADM-03，管理端审核中心「活动审核」tab）
 *
 * 接口：POST /activity/review-query（待审 / 已审列表）、POST /activity/review（通过 / 驳回）
 * 规则：仅 pending 可审；通过 → approved（到 signup_start 由定时触发器自动开放报名）；
 *      驳回 → 回退 draft + 必填理由（≥2 字），发起人可修改重提；两种结果都通知发起人。
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { request } from '@/utils/request'

const PAGE_SIZE = 20
const STATUS_META = {
  pending: { label: '待审核', cls: 'bg-warning text-memphis-dark' },
  approved: { label: '已通过', cls: 'bg-memphis-green text-memphis-dark' },
  draft: { label: '已驳回回退', cls: 'bg-danger-light text-danger' },
}
const SIGNIN_METHOD_LABEL = { qrcode: '扫码', code: '口令', location: '定位' }

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
  const signin = row.signin_config || {}
  const methods = (Array.isArray(signin.methods) ? signin.methods : []).map((m) => SIGNIN_METHOD_LABEL[m] || m).join('、')
  return [
    { label: '主办社团', value: row.club_name || '—' },
    { label: '活动时间', value: `${formatTime(row.start_time)} ~ ${formatTime(row.end_time)}` },
    { label: '报名时段', value: `${formatTime(row.signup_start)} ~ ${formatTime(row.signup_end)}` },
    { label: '地点', value: row.location || '—' },
    { label: '人数上限', value: String(row.capacity || 0) },
    { label: '报名审核', value: row.need_approval ? '是' : '否' },
    { label: '候补', value: row.has_waitlist ? '是' : '否' },
    { label: '现场补报', value: row.allow_onsite ? '是' : '否' },
    { label: '签到方式', value: methods || '—' },
    { label: '签到口令', value: signin.passcode || '—' },
    { label: '定位半径', value: signin.location ? `${signin.location.radius_m} 米` : '—' },
    { label: '签到时段', value: signin.time_window ? `开始前 ${signin.time_window.start_offset_min} 分 ~ 结束后 ${signin.time_window.end_offset_min} 分` : '—' },
    { label: '提交时间', value: formatTime(row.created_at) },
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
    path: '/activity/review-query',
    method: 'POST',
    data: { status: filters.status, page: page.value, page_size: PAGE_SIZE },
  })
  if (seq !== requestSeq) return
  loading.value = false
  if (res.code !== 0 || !res.data) {
    errorMessage.value = res.message || '活动列表加载失败，请稍后重试'
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
      `通过后「${row.title}」进入待开放状态，到达报名开始时间将自动开放报名，并自动通知发起人「${row.submitter_name || '（未知）'}」。`,
      '确认通过该活动？',
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
    const input = await ElMessageBox.prompt('驳回后活动将退回发起人草稿箱，理由会同时通知发起人，请填写具体原因。', '驳回活动', {
      confirmButtonText: '确认驳回',
      cancelButtonText: '取消',
      inputPlaceholder: '例如：活动内容与社团定位不符，请调整后重新提交',
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
    path: '/activity/review',
    method: 'POST',
    data: { activity_id: row._id, action, reason },
  })
  pendingId.value = ''
  if (res.code !== 0) {
    ElMessage.error(res.message || `${label}失败，请稍后重试`)
    return
  }
  const notify = res.data && res.data.notify
  ElMessage.success(
    notify && notify.duplicate ? `已${label}（该活动的通知此前已发送）` : `已${label}，结果已通知发起人`
  )
  if (detailRow.value && detailRow.value._id === row._id) {
    detailRow.value = { ...detailRow.value, ...(res.data && res.data.activity) }
  }
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
              <option value="approved">已通过</option>
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

    <!-- 活动列表 -->
    <div class="m-card">
      <div class="flex items-center justify-between border-b-2 border-memphis-dark px-6 py-4">
        <span class="font-sans text-base font-bold text-memphis-dark">活动审核</span>
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
              <th class="tbl-nowrap px-6 py-3 text-left font-sans text-sm font-semibold text-memphis-dark">活动</th>
              <th class="tbl-nowrap px-6 py-3 text-left font-sans text-sm font-semibold text-memphis-dark">主办社团</th>
              <th class="tbl-nowrap px-6 py-3 text-left font-sans text-sm font-semibold text-memphis-dark">发起人</th>
              <th class="tbl-nowrap px-6 py-3 text-left font-sans text-sm font-semibold text-memphis-dark">活动时间</th>
              <th class="tbl-nowrap px-6 py-3 text-left font-sans text-sm font-semibold text-memphis-dark">提交时间</th>
              <th class="tbl-nowrap px-6 py-3 text-left font-sans text-sm font-semibold text-memphis-dark">状态</th>
              <th class="tbl-nowrap px-6 py-3 text-left font-sans text-sm font-semibold text-memphis-dark">操作</th>
            </tr>
          </thead>
          <tbody>
            <!-- 加载态 -->
            <template v-if="loading">
              <tr v-for="i in 5" :key="`skeleton-${i}`" class="border-b border-ink-line">
                <td colspan="7" class="px-6 py-4">
                  <div class="h-4 w-full animate-pulse rounded-full bg-ink-line"></div>
                </td>
              </tr>
            </template>

            <!-- 空态 -->
            <template v-else-if="isEmpty">
              <tr>
                <td colspan="7" class="px-6 py-16">
                  <div class="flex flex-col items-center gap-3">
                    <span class="flex h-16 w-16 items-center justify-center rounded-full border-2 border-memphis-dark bg-canvas">
                      <span class="material-symbols-outlined text-[28px] text-memphis-dark">event</span>
                    </span>
                    <span class="rounded-full border-2 border-memphis-dark bg-warning px-3 py-0.5 font-sans text-[11px] font-bold text-memphis-dark">
                      暂无内容
                    </span>
                    <span class="font-sans text-xs text-ink-muted">当前筛选下没有活动记录</span>
                  </div>
                </td>
              </tr>
            </template>

            <template v-else>
              <tr v-for="row in list" :key="row._id" class="border-b border-ink-line transition-colors hover:bg-canvas">
                <!-- 活动 -->
                <td class="px-6 py-4">
                  <div class="flex items-center gap-3 whitespace-nowrap">
                    <div class="flex h-9 w-9 items-center justify-center rounded-full border-2 border-memphis-dark bg-primary-light font-sans text-sm font-bold text-memphis-dark">
                      活
                    </div>
                    <div class="flex flex-col">
                      <span class="font-sans text-sm font-bold text-memphis-dark">{{ row.title }}</span>
                      <span class="mt-0.5 max-w-[220px] truncate font-sans text-xs text-ink-muted" :title="row.content">
                        {{ row.content || '（无内容）' }}
                      </span>
                    </div>
                  </div>
                </td>

                <td class="tbl-nowrap px-6 py-4 font-sans text-sm text-ink-body">{{ row.club_name || '—' }}</td>

                <!-- 发起人 -->
                <td class="px-6 py-4">
                  <div class="flex items-center gap-2 whitespace-nowrap">
                    <span class="font-sans text-sm font-bold text-memphis-dark">{{ row.submitter_name || '未认证用户' }}</span>
                    <span
                      v-if="row.submitter_auth_status === 'verified'"
                      class="rounded-full border border-info bg-info-light px-2 py-0.5 font-sans text-[11px] font-medium text-info-text"
                      >✓ 已认证</span
                    >
                  </div>
                </td>

                <td class="tbl-nowrap px-6 py-4 font-sans text-xs text-ink-body">
                  {{ formatTime(row.start_time) }} ~ {{ formatTime(row.end_time) }}
                </td>

                <td class="tbl-nowrap px-6 py-4 font-sans text-sm text-ink-body">{{ formatTime(row.created_at) }}</td>

                <!-- 状态 -->
                <td class="px-6 py-4">
                  <div class="flex flex-col gap-1 whitespace-nowrap">
                    <span
                      class="inline-flex items-center gap-1 self-start rounded-full border-2 border-memphis-dark px-2.5 py-0.5 font-sans text-[11px] font-bold shadow-memphis-xs"
                      :class="STATUS_META[row.status] && STATUS_META[row.status].cls"
                    >
                      <span v-if="row.status === 'pending'" class="h-1.5 w-1.5 rounded-full bg-memphis-dark"></span>
                      <span v-else-if="row.status === 'approved'">✓</span>
                      {{ (STATUS_META[row.status] && STATUS_META[row.status].label) || row.status }}
                    </span>
                    <span v-if="row.status !== 'pending' && row.review_by" class="font-sans text-[11px] text-ink-muted">
                      {{ row.review_by }} · {{ formatTime(row.review_at) }}
                    </span>
                    <span v-if="row.status === 'draft' && row.reject_reason" class="max-w-[200px] truncate font-sans text-[11px] text-danger" :title="row.reject_reason">
                      {{ row.reject_reason }}
                    </span>
                  </div>
                </td>

                <!-- 操作 -->
                <td class="px-6 py-4">
                  <div class="flex items-center gap-2 whitespace-nowrap">
                    <button
                      type="button"
                      class="m-pressable rounded-xl border-2 border-memphis-dark bg-card px-3 py-1.5 font-sans text-xs font-bold text-memphis-dark shadow-memphis-xs"
                      @click="openDetail(row)"
                    >
                      详情
                    </button>
                    <template v-if="row.status === 'pending'">
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
                    </template>
                    <span v-else class="font-sans text-xs text-ink-muted">已处理</span>
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

    <!-- 活动详情抽屉 -->
    <div v-if="detailRow" class="fixed inset-0 z-[60] flex justify-end">
      <div class="absolute inset-0 bg-memphis-dark/40" @click="closeDetail"></div>
      <aside class="relative flex h-full w-full max-w-[600px] flex-col border-l-2 border-memphis-dark bg-card">
        <div class="flex items-start justify-between gap-4 border-b-2 border-memphis-dark px-6 py-4">
          <div class="min-w-0 space-y-1">
            <h2 class="truncate font-display text-xl font-bold text-memphis-dark">{{ detailRow.title }}</h2>
            <div class="flex flex-wrap items-center gap-2">
              <span
                class="inline-flex items-center gap-1 rounded-full border-2 border-memphis-dark px-2.5 py-0.5 font-sans text-[11px] font-bold shadow-memphis-xs"
                :class="STATUS_META[detailRow.status] && STATUS_META[detailRow.status].cls"
              >
                {{ (STATUS_META[detailRow.status] && STATUS_META[detailRow.status].label) || detailRow.status }}
              </span>
              <span class="rounded-full bg-canvas px-2 py-0.5 font-sans text-[11px] text-ink-muted">
                {{ detailRow.club_name || '未知社团' }}
              </span>
              <span class="font-sans text-[11px] text-ink-muted">发起人：{{ detailRow.submitter_name || '未认证用户' }}</span>
            </div>
          </div>
          <button
            type="button"
            class="m-pressable flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-memphis-dark bg-card shadow-memphis-xs"
            @click="closeDetail"
          >
            <span class="material-symbols-outlined text-[18px] text-memphis-dark">close</span>
          </button>
        </div>

        <div class="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          <div class="m-card p-4">
            <span class="font-sans text-sm font-bold text-memphis-dark">活动信息</span>
            <dl class="mt-3 grid grid-cols-[92px_1fr] gap-x-3 gap-y-2">
              <template v-for="item in detailFields" :key="item.label">
                <dt class="font-sans text-xs text-ink-muted">{{ item.label }}</dt>
                <dd class="break-all font-sans text-xs text-ink-body">{{ item.value }}</dd>
              </template>
            </dl>
          </div>

          <div class="m-card p-4">
            <span class="font-sans text-sm font-bold text-memphis-dark">图文内容</span>
            <p class="mt-2 whitespace-pre-wrap font-sans text-xs leading-relaxed text-ink-body">
              {{ detailRow.content || '—' }}
            </p>
          </div>

          <div v-if="detailRow.cover" class="m-card p-4">
            <span class="font-sans text-sm font-bold text-memphis-dark">封面</span>
            <img :src="detailRow.cover" alt="活动封面" class="mt-3 h-40 w-full rounded-xl border-2 border-memphis-dark object-cover" />
          </div>

          <div v-if="detailRow.status === 'draft' && detailRow.reject_reason" class="m-card p-4">
            <span class="font-sans text-sm font-bold text-danger">驳回理由</span>
            <p class="mt-2 whitespace-pre-wrap font-sans text-xs leading-relaxed text-danger">{{ detailRow.reject_reason }}</p>
          </div>
        </div>

        <div class="flex items-center justify-end gap-3 border-t-2 border-memphis-dark bg-canvas px-6 py-4">
          <template v-if="detailRow.status === 'pending'">
            <button
              type="button"
              :disabled="pendingId === detailRow._id"
              class="m-pressable rounded-xl border-2 border-memphis-dark bg-card px-4 py-1.5 font-sans text-xs font-bold text-danger shadow-memphis-xs disabled:opacity-50"
              @click="reject(detailRow)"
            >
              驳回
            </button>
            <button
              type="button"
              :disabled="pendingId === detailRow._id"
              class="m-pressable rounded-xl border-2 border-memphis-dark bg-memphis-green px-4 py-1.5 font-sans text-xs font-bold text-memphis-dark shadow-memphis-xs disabled:opacity-50"
              @click="approve(detailRow)"
            >
              通过
            </button>
          </template>
          <button
            type="button"
            class="m-pressable rounded-xl border-2 border-memphis-dark bg-card px-4 py-1.5 font-sans text-xs font-bold text-memphis-dark shadow-memphis-xs"
            @click="closeDetail"
          >
            关闭
          </button>
        </div>
      </aside>
    </div>
  </div>
</template>
