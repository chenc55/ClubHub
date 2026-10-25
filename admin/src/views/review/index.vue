<script setup>
/**
 * 审核中心 · 换绑申诉审核（ADM-10 / P1-05）+ 活动审核（ADM-03 / P1-11）
 *
 * 申诉接口：POST /admin/appeals/query（待审 / 已审列表）、POST /admin/appeals/review（通过 / 驳回）
 * 活动审核：由 <ActivityReview> 组件承载（POST /activity/review-query、POST /activity/review）
 * 需求 4.3.5：通过 → 解绑旧学号、绑定新学号（users.student_no 更新）；驳回 → 必填理由；
 *            结果自动通知申请人（订阅消息 + 站内消息，由云函数调 notify 引擎完成）。
 * 需求 4.3.2：活动审核通过 → approved 待开放；驳回 → 回退 draft + 必填理由，通知发起人。
 * 异常分支：新学号不在白名单 / 已被他人绑定 → 服务端拒绝通过并提示驳回。
 *
 * 说明：社团审核在「社团管理」页（P1-06）；招新审核由 P1-16 追加到本页。
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { request } from '@/utils/request'
import ActivityReview from '@/components/ActivityReview.vue'
import RecruitmentReview from '@/components/RecruitmentReview.vue'

const activeTab = ref('appeal')
const TAB_META = [
  { key: 'appeal', label: '申诉审核' },
  { key: 'activity', label: '活动审核' },
  { key: 'recruitment', label: '招新审核' },
]

const PAGE_SIZE = 20

const STATUS_META = {
  pending: { label: '待审核', cls: 'bg-warning text-memphis-dark', dot: true },
  approved: { label: '已通过', cls: 'bg-memphis-green text-memphis-dark' },
  rejected: { label: '已驳回', cls: 'bg-danger-light text-danger' },
}
const NEW_NO_META = {
  ok: { label: '可绑定', cls: 'bg-success-light text-ink-body' },
  not_in_whitelist: { label: '不在白名单', cls: 'bg-danger-light text-danger' },
  occupied: { label: '已被他人绑定', cls: 'bg-danger-light text-danger' },
}

const filters = reactive({ status: 'pending' })
const list = ref([])
const total = ref(0)
const pendingTotal = ref(0)
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

function typeText(row) {
  return row.appeal_type === 'occupy' ? '学号占用' : '换绑'
}

async function load() {
  const seq = ++requestSeq
  loading.value = true
  errorMessage.value = ''
  const res = await request({
    path: '/admin/appeals/query',
    method: 'POST',
    data: { status: filters.status, page: page.value, page_size: PAGE_SIZE },
  })
  if (seq !== requestSeq) return
  loading.value = false
  if (res.code !== 0 || !res.data) {
    errorMessage.value = res.message || '申诉列表加载失败，请稍后重试'
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

/** 通过：解绑旧学号 + 绑定新学号（二次确认） */
async function approve(row) {
  const who = row.applicant_name || row.user_id
  const tip =
    `将通过后把「${who}」的学号由 ${row.old_student_no || '（未绑定）'} 变更为 ${row.new_student_no}，` +
    '旧学号立即解绑，并自动通知申请人。'
  try {
    await ElMessageBox.confirm(tip, '确认通过该申诉？', {
      confirmButtonText: '确认通过',
      cancelButtonText: '取消',
      type: 'warning',
    })
  } catch (e) {
    return
  }
  await review(row, 'approve', '')
}

/** 驳回：理由必填 */
async function reject(row) {
  let reason = ''
  try {
    const input = await ElMessageBox.prompt('驳回理由将同时通知申请人，请填写具体原因。', '驳回申诉', {
      confirmButtonText: '确认驳回',
      cancelButtonText: '取消',
      inputPlaceholder: '例如：新学号与姓名不匹配，请核对后重新提交',
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
    path: '/admin/appeals/review',
    method: 'POST',
    data: { appeal_id: row._id, action, reason },
  })
  pendingId.value = ''
  if (res.code !== 0) {
    ElMessage.error(res.message || `${label}失败，请稍后重试`)
    return
  }
  const notify = res.data && res.data.notify
  ElMessage.success(
    notify && notify.duplicate ? `已${label}（该申诉的通知此前已发送）` : `已${label}，结果已通知申请人`
  )
  await load()
}

onMounted(() => {
  // 支持工作台待办跳转：/review?tab=activity|recruitment|appeal
  const tab = useRoute().query.tab
  if (TAB_META.some((t) => t.key === tab)) activeTab.value = tab
  load()
})
</script>

<template>
  <div class="flex flex-col gap-6 p-6">
    <!-- 标题 Banner -->
    <div
      class="flex flex-col justify-between gap-4 rounded-xl border-2 border-memphis-dark bg-card p-6 shadow-memphis-md lg:flex-row lg:items-center"
    >
      <div class="space-y-2">
        <div class="flex flex-wrap items-center gap-3">
          <h1 class="font-display text-2xl font-bold tracking-tight text-memphis-dark">审核中心</h1>
          <span
            class="inline-flex items-center gap-1 rounded-full border-2 border-memphis-dark bg-memphis-yellow px-3 py-0.5 font-sans text-[11px] font-bold text-memphis-dark shadow-memphis-xs"
          >
            待审 {{ pendingTotal }} 条
          </span>
        </div>
        <p class="max-w-3xl font-sans text-sm text-ink-muted">
          本期实现「换绑 / 学号占用申诉」审核（ADM-10）、「活动」审核（ADM-03）与「招新」审核（ADM-04）：通过 / 驳回都会通过订阅消息 + 站内消息
          通知申请人或发起人。社团审核在「社团管理」页。
        </p>
      </div>

      <!-- 审核类型 tab -->
      <div class="mt-4 flex items-center gap-3 lg:mt-0">
        <button
          v-for="tab in TAB_META"
          :key="tab.key"
          type="button"
          class="m-pressable rounded-xl border-2 border-memphis-dark px-5 py-2 font-sans text-xs font-bold shadow-memphis-sm"
          :class="activeTab === tab.key ? 'bg-primary text-white' : 'bg-card text-memphis-dark'"
          @click="activeTab = tab.key"
        >
          {{ tab.label }}
        </button>
      </div>
    </div>

    <!-- 申诉审核（v-show 切换，加载状态保留在各自区块内） -->
    <div v-show="activeTab === 'appeal'" class="contents">
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
              <option value="rejected">已驳回</option>
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
          匹配 {{ total }} 条
        </span>
      </div>
    </div>

    <!-- 申诉列表 -->
    <div class="m-card">
      <div class="flex items-center justify-between border-b-2 border-memphis-dark px-6 py-4">
        <span class="font-sans text-base font-bold text-memphis-dark">换绑 / 占用申诉</span>
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
              <th class="tbl-nowrap px-6 py-3 text-left font-sans text-sm font-semibold text-memphis-dark">类型</th>
              <th class="tbl-nowrap px-6 py-3 text-left font-sans text-sm font-semibold text-memphis-dark">学号变更</th>
              <th class="tbl-nowrap px-6 py-3 text-left font-sans text-sm font-semibold text-memphis-dark">证明材料</th>
              <th class="tbl-nowrap px-6 py-3 text-left font-sans text-sm font-semibold text-memphis-dark">提交时间</th>
              <th class="tbl-nowrap px-6 py-3 text-left font-sans text-sm font-semibold text-memphis-dark">状态</th>
              <th class="tbl-nowrap px-6 py-3 text-left font-sans text-sm font-semibold text-memphis-dark">操作</th>
            </tr>
          </thead>
          <tbody>
            <!-- 加载态：整行骨架条 -->
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
                    <span class="font-sans text-xs text-ink-muted">当前筛选下没有申诉记录</span>
                  </div>
                </td>
              </tr>
            </template>

            <template v-else>
              <tr v-for="row in list" :key="row._id" class="border-b border-ink-line transition-colors hover:bg-canvas">
                <!-- 申请人 -->
                <td class="px-6 py-4">
                  <div class="flex items-center gap-3 whitespace-nowrap">
                    <div
                      class="flex h-9 w-9 items-center justify-center rounded-full border-2 border-memphis-dark bg-primary-light font-sans text-sm font-bold text-memphis-dark"
                    >
                      {{ (row.applicant_name || '?').slice(0, 1) }}
                    </div>
                    <div class="flex flex-col">
                      <div class="flex items-center gap-2">
                        <span class="font-sans text-sm font-bold text-memphis-dark">
                          {{ row.applicant_name || row.applicant_nickname || '未认证用户' }}
                        </span>
                        <span
                          v-if="row.applicant_auth_status === 'verified'"
                          class="rounded-full border border-info bg-info-light px-2 py-0.5 font-sans text-[11px] font-medium text-info-text"
                          >✓ 已认证</span
                        >
                      </div>
                      <span class="mt-0.5 font-mono text-xs text-ink-muted">
                        当前学号 {{ row.applicant_current_no || '未绑定' }}
                      </span>
                    </div>
                  </div>
                </td>

                <td class="tbl-nowrap px-6 py-4 font-sans text-sm text-ink-body">{{ typeText(row) }}</td>

                <!-- 学号变更 + 可用性提示 -->
                <td class="px-6 py-4">
                  <div class="flex items-center gap-2 whitespace-nowrap">
                    <span class="font-mono text-sm text-ink-muted">{{ row.old_student_no || '—' }}</span>
                    <span class="font-sans text-xs text-ink-muted">→</span>
                    <span class="font-mono text-sm font-bold text-memphis-dark">{{ row.new_student_no }}</span>
                    <span
                      v-if="row.status === 'pending' && NEW_NO_META[row.new_student_no_status]"
                      class="rounded-full border-2 border-memphis-dark px-2 py-0.5 font-sans text-[11px] font-bold"
                      :class="NEW_NO_META[row.new_student_no_status].cls"
                    >
                      {{ NEW_NO_META[row.new_student_no_status].label }}
                    </span>
                  </div>
                </td>

                <!-- 证明材料：说明 + 图片缩略预览 -->
                <td class="px-6 py-4">
                  <div class="flex items-center gap-3 whitespace-nowrap">
                    <el-image
                      v-if="row.proof_images && row.proof_images.length"
                      :src="row.proof_images[0]"
                      :preview-src-list="row.proof_images"
                      :preview-teleported="true"
                      fit="cover"
                      class="h-9 w-9 rounded-lg border-2 border-memphis-dark"
                    />
                    <span class="max-w-[240px] truncate font-sans text-xs text-ink-body" :title="row.proof">
                      {{ row.proof || (row.proof_images && row.proof_images.length ? `已上传 ${row.proof_images.length} 张证明` : '未提供说明') }}
                    </span>
                  </div>
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
                    <span v-if="row.status !== 'pending'" class="font-sans text-[11px] text-ink-muted">
                      {{ row.review_by || '—' }} · {{ formatTime(row.review_at) }}
                    </span>
                    <span v-if="row.status === 'rejected' && row.reject_reason" class="max-w-[200px] truncate font-sans text-[11px] text-danger" :title="row.reject_reason">
                      {{ row.reject_reason }}
                    </span>
                  </div>
                </td>

                <!-- 操作 -->
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
    </div>

    <!-- 活动审核（P1-11 / ADM-03） -->
    <ActivityReview v-show="activeTab === 'activity'" />

    <!-- 招新审核（P1-16 / ADM-04） -->
    <RecruitmentReview v-show="activeTab === 'recruitment'" />
  </div>
</template>
