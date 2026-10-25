<script setup>
/**
 * 社团管理 · 入驻审核 / 批量导入 / 分类维护 / 星级评定（ADM-02 / P1-06 + P1-07）
 *
 * 接口：POST /club/query（社团列表 + 筛选 + 待审数）、POST /club/review（通过 / 驳回）、POST /club/import（批量导入）、
 *      GET /club/category/list、POST /club/category/save | /delete | /sort（分类维护抽屉）、
 *      POST /club/star（星级评定）、POST /club/ban（封禁 / 解封）
 * 需求 4.2.1 双轨：
 * - 线上申请：通过 → clubs.status=normal 且申请人自动成为 club_members.president；驳回 → rejected 附理由通知并可修改重提；
 * - 管理员导入：create_type=imported、status=normal（无需审核），重名跳过并记入回执，由管理员随后指定社长。
 * 需求 4.3.2（P1-07）：社团列表 / 详情、分类维护（增删改 + 排序）、星级评定（1~5 星）；
 * 需求 4.4 状态机：normal ⇄ banned（封禁 / 停用与解封，封禁前二次确认）。
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { request } from '@/utils/request'
import ClubImport from '@/components/ClubImport.vue'
import CategoryManager from '@/components/CategoryManager.vue'

const PAGE_SIZE = 20
const STAR_MAX = 5
const STATUS_META = {
  pending: { label: '待审核', cls: 'bg-warning text-memphis-dark' },
  normal: { label: '正常', cls: 'bg-memphis-green text-memphis-dark' },
  rejected: { label: '已驳回', cls: 'bg-danger-light text-danger' },
  banned: { label: '已封禁', cls: 'bg-danger-light text-danger' },
}

const filters = reactive({ status: 'pending' })
const list = ref([])
const total = ref(0)
const pendingTotal = ref(0)
const page = ref(1)
const loading = ref(false)
const errorMessage = ref('')
const pendingId = ref('')
const categoryVisible = ref(false)
const detailRow = ref(null)
const starTarget = ref(null)
const starValue = ref(0)
const starSaving = ref(false)
let requestSeq = 0

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))
const isEmpty = computed(() => !loading.value && !errorMessage.value && list.value.length === 0)

/** 详情抽屉字段（P1-07：社团列表 / 详情） */
const detailFields = computed(() => {
  const row = detailRow.value
  if (!row) return []
  return [
    { label: '分类', value: row.category_name || '未分类' },
    { label: '星级', value: row.star_level > 0 ? `${stars(row.star_level)}（${row.star_level} 星）` : '未评定' },
    { label: '状态', value: (STATUS_META[row.status] && STATUS_META[row.status].label) || row.status },
    { label: '创建方式', value: row.create_type === 'imported' ? '管理员导入' : '线上申请' },
    { label: '申请人', value: row.create_type === 'imported' ? '—' : row.applicant_name || '未认证用户' },
    { label: '联系方式', value: row.contact || '—' },
    { label: '审核人', value: row.review_by || '—' },
    { label: '审核时间', value: formatTime(row.review_at) },
    { label: '驳回理由', value: row.reject_reason || '—' },
    { label: '导入批次', value: row.batch_no || '—' },
    { label: '提交时间', value: formatTime(row.created_at) },
    { label: '更新时间', value: formatTime(row.updated_at) },
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
    path: '/club/query',
    method: 'POST',
    data: { status: filters.status, page: page.value, page_size: PAGE_SIZE },
  })
  if (seq !== requestSeq) return
  loading.value = false
  if (res.code !== 0 || !res.data) {
    errorMessage.value = res.message || '社团列表加载失败，请稍后重试'
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

async function approve(row) {
  const tip =
    row.create_type === 'applied'
      ? `通过后「${row.name}」将正式入驻，申请人「${row.applicant_name || '（未知）'}」自动成为社长，并自动通知申请人。`
      : `通过后「${row.name}」将正式入驻（管理员导入的社团不产生申请人通知）。`
  try {
    await ElMessageBox.confirm(tip, '确认通过入驻申请？', {
      confirmButtonText: '确认通过',
      cancelButtonText: '取消',
      type: 'warning',
    })
  } catch (e) {
    return
  }
  await review(row, 'approve', '')
}

async function reject(row) {
  let reason = ''
  try {
    const input = await ElMessageBox.prompt('驳回理由将通知申请人，请要求其补全资料后重提。', '驳回入驻申请', {
      confirmButtonText: '确认驳回',
      cancelButtonText: '取消',
      inputPlaceholder: '例如：简介过于简单，请补充社团定位与活动计划',
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
    path: '/club/review',
    method: 'POST',
    data: { club_id: row._id, action, reason },
  })
  pendingId.value = ''
  if (res.code !== 0) {
    ElMessage.error(res.message || `${label}失败，请稍后重试`)
    return
  }
  const extra = res.data && res.data.member_created ? '，申请人已设为社长' : ''
  ElMessage.success(`已${label}${extra}`)
  await load()
}

/* ---------- 星级展示（1~5 星徽章 / 未评定） ---------- */
function stars(level) {
  const value = Math.min(STAR_MAX, Math.max(0, Number(level) || 0))
  return `${'★'.repeat(value)}${'☆'.repeat(STAR_MAX - value)}`
}

/* ---------- 详情（P1-07：社团列表 / 详情） ---------- */
function openDetail(row) {
  detailRow.value = row
}

function closeDetail() {
  detailRow.value = null
}

/* ---------- 星级评定（P1-07 / ADM-02②） ---------- */
function openStar(row) {
  starTarget.value = row
  starValue.value = Number(row.star_level || 0)
}

function closeStar() {
  starTarget.value = null
  starValue.value = 0
}

async function saveStar() {
  const row = starTarget.value
  if (!row) return
  const level = Number(starValue.value)
  starSaving.value = true
  const res = await request({ path: '/club/star', method: 'POST', data: { club_id: row._id, star_level: level } })
  starSaving.value = false
  if (res.code !== 0) {
    ElMessage.error(res.message || '星级评定失败，请稍后重试')
    return
  }
  ElMessage.success(level > 0 ? `已将「${row.name}」评定为 ${level} 星` : `已取消「${row.name}」的星级评定`)
  if (res.data && res.data.club && detailRow.value && detailRow.value._id === row._id) {
    detailRow.value = { ...detailRow.value, ...res.data.club }
  }
  closeStar()
  await load()
}

/* ---------- 封禁 / 解封（需求 4.4 状态机；4.3.3 封禁前二次确认） ---------- */
async function toggleBan(row) {
  const banning = row.status === 'normal'
  const tip = banning
    ? `封禁后「${row.name}」在学生端不再展示，且不可再发布活动与招新；请确认已完成违规取证。`
    : `解封后「${row.name}」将恢复正常展示与运营。`
  try {
    await ElMessageBox.confirm(tip, banning ? '确认封禁 / 停用该社团？' : '确认解封该社团？', {
      confirmButtonText: banning ? '确认封禁' : '确认解封',
      cancelButtonText: '取消',
      type: 'warning',
    })
  } catch (e) {
    return
  }
  pendingId.value = row._id
  const res = await request({
    path: '/club/ban',
    method: 'POST',
    data: { club_id: row._id, action: banning ? 'ban' : 'unban' },
  })
  pendingId.value = ''
  if (res.code !== 0) {
    ElMessage.error(res.message || (banning ? '封禁失败，请稍后重试' : '解封失败，请稍后重试'))
    return
  }
  ElMessage.success(banning ? `已封禁「${row.name}」` : `已解封「${row.name}」`)
  if (res.data && res.data.club && detailRow.value && detailRow.value._id === row._id) {
    detailRow.value = { ...detailRow.value, ...res.data.club }
  }
  await load()
}

/** 分类维护抽屉变更后重载列表（分类名与归属数量会变） */
function onCategoryChanged() {
  load()
}

onMounted(load)
</script>

<template>
  <div class="flex flex-col gap-6 p-6">
    <!-- 标题 Banner -->
    <div
      class="flex flex-col justify-between gap-4 rounded-xl border-2 border-memphis-dark bg-card p-6 shadow-memphis-md lg:flex-row lg:items-center"
    >
      <div class="space-y-2">
        <div class="flex flex-wrap items-center gap-3">
          <h1 class="font-display text-2xl font-bold tracking-tight text-memphis-dark">社团管理</h1>
          <span
            class="inline-flex items-center gap-1 rounded-full border-2 border-memphis-dark bg-memphis-yellow px-3 py-0.5 font-sans text-[11px] font-bold text-memphis-dark shadow-memphis-xs"
          >
            待审 {{ pendingTotal }} 个
          </span>
        </div>
        <p class="max-w-3xl font-sans text-sm text-ink-muted">
          入驻双轨：线上申请（审核通过后申请人自动成为社长）与管理员批量导入（导入即为正常状态，随后指定社长）。
          驳回须填写理由并会通知申请人，申请人可修改后重新提交。分类维护（增删改 + 排序）、星级评定（1~5 星）与
          封禁 / 停用（二次确认）在同页完成。
        </p>
      </div>

      <button
        type="button"
        class="m-pressable flex shrink-0 items-center gap-2 self-start rounded-xl border-2 border-memphis-dark bg-card px-4 py-2 font-sans text-xs font-bold text-memphis-dark shadow-memphis-sm lg:self-auto"
        @click="categoryVisible = true"
      >
        <span class="material-symbols-outlined text-[18px]">sell</span>
        分类维护
      </button>
    </div>

    <!-- 筛选 -->
    <div class="m-card p-6">
      <div class="flex flex-wrap items-end justify-between gap-4">
        <div class="flex flex-wrap items-end gap-5">
          <label class="block">
            <span class="font-sans text-xs font-bold text-memphis-dark">社团状态</span>
            <select
              v-model="filters.status"
              class="mt-2 rounded-xl border-2 border-memphis-dark bg-canvas px-3 py-2 font-sans text-xs text-ink-body outline-none"
            >
              <option value="pending">待审核</option>
              <option value="normal">正常</option>
              <option value="rejected">已驳回</option>
              <option value="banned">已封禁</option>
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
          匹配 {{ total }} 个
        </span>
      </div>
    </div>

    <!-- 社团列表 -->
    <div class="m-card">
      <div class="flex items-center justify-between border-b-2 border-memphis-dark px-6 py-4">
        <span class="font-sans text-base font-bold text-memphis-dark">社团列表</span>
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
              <th class="tbl-nowrap px-6 py-3 text-left font-sans text-sm font-semibold text-memphis-dark">社团</th>
              <th class="tbl-nowrap px-6 py-3 text-left font-sans text-sm font-semibold text-memphis-dark">简介</th>
              <th class="tbl-nowrap px-6 py-3 text-left font-sans text-sm font-semibold text-memphis-dark">联系方式</th>
              <th class="tbl-nowrap px-6 py-3 text-left font-sans text-sm font-semibold text-memphis-dark">申请人</th>
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
                    <span class="font-sans text-xs text-ink-muted">当前筛选下没有社团记录</span>
                  </div>
                </td>
              </tr>
            </template>

            <template v-else>
              <tr v-for="row in list" :key="row._id" class="border-b border-ink-line transition-colors hover:bg-canvas">
                <!-- 社团：名称 + 分类药丸 + 创建方式 -->
                <td class="px-6 py-4">
                  <div class="flex items-center gap-3 whitespace-nowrap">
                    <div
                      class="flex h-9 w-9 items-center justify-center rounded-full border-2 border-memphis-dark bg-primary-light font-sans text-sm font-bold text-memphis-dark"
                    >
                      {{ (row.name || '?').slice(0, 1) }}
                    </div>
                    <div class="flex flex-col">
                      <div class="flex items-center gap-2">
                        <span class="font-sans text-sm font-bold text-memphis-dark">{{ row.name }}</span>
                        <span class="rounded-full bg-canvas px-2 py-0.5 font-sans text-[11px] text-ink-muted">
                          [{{ row.category_name || '未分类' }}]
                        </span>
                        <span
                          class="rounded-full px-2 py-0.5 font-sans text-[11px]"
                          :class="row.create_type === 'imported' ? 'bg-info-light text-info-text' : 'bg-warning-light text-ink-body'"
                        >
                          {{ row.create_type === 'imported' ? '管理员导入' : '线上申请' }}
                        </span>
                      </div>
                      <div class="mt-1 flex items-center gap-2">
                        <span
                          v-if="row.star_level > 0"
                          class="rounded-full border-2 border-memphis-dark bg-memphis-yellow px-2 py-0.5 font-sans text-[11px] font-bold text-memphis-dark shadow-memphis-xs"
                          :title="`星级 ${row.star_level} 星`"
                        >
                          {{ stars(row.star_level) }}
                        </span>
                        <span v-else class="rounded-full bg-canvas px-2 py-0.5 font-sans text-[11px] text-ink-muted">
                          未评定
                        </span>
                        <span v-if="row.batch_no" class="font-sans text-xs text-ink-muted">批次 {{ row.batch_no }}</span>
                      </div>
                    </div>
                  </div>
                </td>

                <td class="px-6 py-4">
                  <span class="block max-w-[260px] truncate font-sans text-xs text-ink-body" :title="row.intro">
                    {{ row.intro || '—' }}
                  </span>
                </td>

                <td class="tbl-nowrap px-6 py-4 font-sans text-xs text-ink-body">{{ row.contact || '—' }}</td>

                <td class="tbl-nowrap px-6 py-4 font-sans text-xs text-ink-body">
                  {{ row.create_type === 'imported' ? '—' : row.applicant_name || '未认证用户' }}
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
                      <span v-else-if="row.status === 'normal'">✓</span>
                      {{ (STATUS_META[row.status] && STATUS_META[row.status].label) || row.status }}
                    </span>
                    <span v-if="row.status !== 'pending' && row.review_by" class="font-sans text-[11px] text-ink-muted">
                      {{ row.review_by }} · {{ formatTime(row.review_at) }}
                    </span>
                    <span
                      v-if="row.status === 'rejected' && row.reject_reason"
                      class="max-w-[220px] truncate font-sans text-[11px] text-danger"
                      :title="row.reject_reason"
                    >
                      {{ row.reject_reason }}
                    </span>
                  </div>
                </td>

                <!-- 操作：详情 + 状态相关动作（P1-07 追加评星 / 封禁 / 解封） -->
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

                    <template v-else-if="row.status === 'normal'">
                      <button
                        type="button"
                        :disabled="pendingId === row._id"
                        class="m-pressable whitespace-nowrap rounded-xl border-2 border-memphis-dark bg-card px-3 py-1.5 font-sans text-xs font-bold text-memphis-dark shadow-memphis-xs disabled:opacity-50"
                        @click="openStar(row)"
                      >
                        评星
                      </button>
                      <button
                        type="button"
                        :disabled="pendingId === row._id"
                        class="m-pressable whitespace-nowrap rounded-xl border-2 border-memphis-dark bg-card px-3 py-1.5 font-sans text-xs font-bold text-danger shadow-memphis-xs disabled:opacity-50"
                        @click="toggleBan(row)"
                      >
                        封禁
                      </button>
                    </template>

                    <button
                      v-else-if="row.status === 'banned'"
                      type="button"
                      :disabled="pendingId === row._id"
                      class="m-pressable whitespace-nowrap rounded-xl border-2 border-memphis-dark bg-memphis-green px-3 py-1.5 font-sans text-xs font-bold text-memphis-dark shadow-memphis-xs disabled:opacity-50"
                      @click="toggleBan(row)"
                    >
                      解封
                    </button>
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

    <!-- 批量导入（双轨之一） -->
    <ClubImport />

    <!-- 星级评定（P1-07 / ADM-02②） -->
    <div v-if="starTarget" class="fixed inset-0 z-[55] flex items-center justify-center px-4">
      <div class="absolute inset-0 bg-memphis-dark/40" @click="closeStar"></div>
      <div class="relative w-full max-w-[420px] rounded-xl border-2 border-memphis-dark bg-card p-6 shadow-memphis-lg">
        <h2 class="font-display text-xl font-bold text-memphis-dark">星级评定</h2>
        <p class="mt-1 font-sans text-xs leading-relaxed text-ink-muted">
          为「{{ starTarget.name }}」评定 1~5 星（0 星即取消评定）；星级用于学生端社团列表展示与综合排序。
        </p>

        <div class="mt-5 flex items-center justify-center gap-2">
          <button
            v-for="n in STAR_MAX"
            :key="n"
            type="button"
            class="m-pressable flex h-10 w-10 items-center justify-center rounded-full border-2 border-memphis-dark shadow-memphis-xs"
            :class="n <= starValue ? 'bg-memphis-yellow' : 'bg-card'"
            :title="`${n} 星`"
            @click="starValue = n"
          >
            <span
              class="material-symbols-outlined text-[20px] text-memphis-dark"
              :style="{ fontVariationSettings: n <= starValue ? `'FILL' 1` : `'FILL' 0` }"
              >star</span
            >
          </button>
        </div>
        <p class="mt-3 text-center font-sans text-xs text-ink-muted">
          {{ starValue > 0 ? `当前选择 ${starValue} 星` : '当前为未评定' }}
        </p>

        <div class="mt-5 flex items-center justify-between gap-3">
          <button
            type="button"
            :disabled="starValue === 0"
            class="m-pressable rounded-xl border-2 border-memphis-dark bg-card px-4 py-1.5 font-sans text-xs font-bold text-ink-body shadow-memphis-xs disabled:opacity-40"
            @click="starValue = 0"
          >
            清除评定
          </button>
          <div class="flex items-center gap-3">
            <button
              type="button"
              class="m-pressable rounded-xl border-2 border-memphis-dark bg-card px-4 py-1.5 font-sans text-xs font-bold text-memphis-dark shadow-memphis-xs"
              @click="closeStar"
            >
              取消
            </button>
            <button
              type="button"
              :disabled="starSaving"
              class="m-pressable rounded-xl border-2 border-memphis-dark bg-primary px-4 py-1.5 font-sans text-xs font-bold text-white shadow-memphis-sm disabled:opacity-50"
              @click="saveStar"
            >
              {{ starSaving ? '保存中…' : '保存' }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 社团详情（P1-07：社团列表 / 详情） -->
    <div v-if="detailRow" class="fixed inset-0 z-50 flex justify-end">
      <div class="absolute inset-0 bg-memphis-dark/40" @click="closeDetail"></div>
      <aside class="relative flex h-full w-full max-w-[560px] flex-col border-l-2 border-memphis-dark bg-card">
        <div class="flex items-start justify-between gap-4 border-b-2 border-memphis-dark px-6 py-4">
          <div class="flex min-w-0 items-center gap-3">
            <img
              v-if="detailRow.logo"
              :src="detailRow.logo"
              alt="社团 Logo"
              class="h-12 w-12 shrink-0 rounded-full border-2 border-memphis-dark object-cover"
            />
            <span
              v-else
              class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 border-memphis-dark bg-primary-light font-sans text-base font-bold text-memphis-dark"
            >
              {{ (detailRow.name || '?').slice(0, 1) }}
            </span>
            <div class="min-w-0 space-y-1">
              <h2 class="truncate font-display text-xl font-bold text-memphis-dark">{{ detailRow.name }}</h2>
              <div class="flex flex-wrap items-center gap-2">
                <span
                  class="inline-flex items-center gap-1 rounded-full border-2 border-memphis-dark px-2.5 py-0.5 font-sans text-[11px] font-bold shadow-memphis-xs"
                  :class="STATUS_META[detailRow.status] && STATUS_META[detailRow.status].cls"
                >
                  {{ (STATUS_META[detailRow.status] && STATUS_META[detailRow.status].label) || detailRow.status }}
                </span>
                <span class="rounded-full bg-canvas px-2 py-0.5 font-sans text-[11px] text-ink-muted">
                  [{{ detailRow.category_name || '未分类' }}]
                </span>
                <span
                  class="rounded-full px-2 py-0.5 font-sans text-[11px]"
                  :class="detailRow.create_type === 'imported' ? 'bg-info-light text-info-text' : 'bg-warning-light text-ink-body'"
                >
                  {{ detailRow.create_type === 'imported' ? '管理员导入' : '线上申请' }}
                </span>
              </div>
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
            <span class="font-sans text-sm font-bold text-memphis-dark">基础信息</span>
            <dl class="mt-3 grid grid-cols-[88px_1fr] gap-x-3 gap-y-2">
              <template v-for="item in detailFields" :key="item.label">
                <dt class="font-sans text-xs text-ink-muted">{{ item.label }}</dt>
                <dd class="break-all font-sans text-xs text-ink-body">{{ item.value }}</dd>
              </template>
            </dl>
          </div>

          <div class="m-card p-4">
            <span class="font-sans text-sm font-bold text-memphis-dark">社团简介</span>
            <p class="mt-2 whitespace-pre-wrap font-sans text-xs leading-relaxed text-ink-body">
              {{ detailRow.intro || '—' }}
            </p>
          </div>

          <div v-if="detailRow.cover" class="m-card p-4">
            <span class="font-sans text-sm font-bold text-memphis-dark">社团封面</span>
            <img
              :src="detailRow.cover"
              alt="社团封面"
              class="mt-3 h-32 w-full rounded-xl border-2 border-memphis-dark object-cover"
            />
          </div>
        </div>

        <div class="flex items-center justify-end gap-3 border-t-2 border-memphis-dark bg-canvas px-6 py-4">
          <template v-if="detailRow.status === 'normal'">
            <button
              type="button"
              class="m-pressable rounded-xl border-2 border-memphis-dark bg-card px-4 py-1.5 font-sans text-xs font-bold text-memphis-dark shadow-memphis-xs"
              @click="openStar(detailRow)"
            >
              星级评定
            </button>
            <button
              type="button"
              :disabled="pendingId === detailRow._id"
              class="m-pressable rounded-xl border-2 border-memphis-dark bg-card px-4 py-1.5 font-sans text-xs font-bold text-danger shadow-memphis-xs disabled:opacity-50"
              @click="toggleBan(detailRow)"
            >
              封禁 / 停用
            </button>
          </template>
          <button
            v-else-if="detailRow.status === 'banned'"
            type="button"
            :disabled="pendingId === detailRow._id"
            class="m-pressable rounded-xl border-2 border-memphis-dark bg-memphis-green px-4 py-1.5 font-sans text-xs font-bold text-memphis-dark shadow-memphis-xs disabled:opacity-50"
            @click="toggleBan(detailRow)"
          >
            解封
          </button>
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

    <!-- 分类维护抽屉（P1-07 / ADM-02②） -->
    <CategoryManager v-model:visible="categoryVisible" @changed="onCategoryChanged" />
  </div>
</template>
