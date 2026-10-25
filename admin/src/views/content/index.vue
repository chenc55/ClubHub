<script setup>
/**
 * 内容监管（P1-26 / ADM-05）
 *
 * 动态监管接口：GET /moderation/list（视图/关键词/分页）、POST /moderation/review（合规/违规复核）、
 *   POST /moderation/take-down、POST /moderation/restore、POST /moderation/delete
 * 社团封禁接口：POST /club/query、POST /club/ban（复用 club 域，P1-07 已实现状态机）
 * （均为管理通道 + super / auditor 角色，服务端 requireRole 二次校验）
 *
 * 口径说明：
 * - 动态「先发后审」：命中敏感词 review 置 flagged 进入「疑似」队列（数据源 P2-01 接入，当前 dev 无真实动态）；
 * - 合规复核 = 仅移除疑似标记；违规复核 / 下架 = taken_down 并通知社团负责人；
 * - 删除 = 软删（deleted=1，回收站可还原）；恢复 = 还原发布态；
 * - 封禁社团（normal ⇄ banned）二次确认（需求 4.3.3），封禁后学生端不可见、不可再发布。
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { request } from '@/utils/request'

const PAGE_SIZE = 20
const KEYWORD_MAX = 20

const activeTab = ref('posts')

/* ---------------- 动态监管 ---------------- */
const VIEW_META = [
  { value: 'all', label: '全部动态' },
  { value: 'flagged', label: '疑似队列' },
  { value: 'taken_down', label: '已下架' },
  { value: 'deleted', label: '回收站' },
]
const STATUS_META = {
  published: { label: '已发布', cls: 'bg-memphis-green text-memphis-dark' },
  taken_down: { label: '已下架', cls: 'bg-warning text-memphis-dark' },
}

const postFilters = reactive({ view: 'all', keyword: '' })
const postList = ref([])
const postTotal = ref(0)
const postPage = ref(1)
const postLoading = ref(false)
const postError = ref('')
const postPendingId = ref('')
let postSeq = 0

const postTotalPages = computed(() => Math.max(1, Math.ceil(postTotal.value / PAGE_SIZE)))
const postEmpty = computed(() => !postLoading.value && !postError.value && postList.value.length === 0)

function formatTime(value) {
  if (!value) return '—'
  const raw = value && typeof value === 'object' && value.$date ? value.$date : value
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return '—'
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

async function loadPosts() {
  const seq = ++postSeq
  postLoading.value = true
  postError.value = ''
  const qs = new URLSearchParams()
  qs.set('view', postFilters.view)
  const kw = postFilters.keyword.trim()
  if (kw) qs.set('keyword', kw)
  qs.set('page', String(postPage.value))
  qs.set('page_size', String(PAGE_SIZE))
  const res = await request({ path: `/moderation/list?${qs.toString()}`, method: 'GET' })
  if (seq !== postSeq) return
  postLoading.value = false
  if (res.code !== 0 || !res.data) {
    postError.value = res.message || '动态列表加载失败，请稍后重试'
    postList.value = []
    postTotal.value = 0
    return
  }
  postList.value = res.data.list || []
  postTotal.value = res.data.total || 0
  if (!postList.value.length && postPage.value > 1) {
    postPage.value -= 1
    await loadPosts()
  }
}

function searchPosts() {
  postPage.value = 1
  loadPosts()
}

function resetPosts() {
  postFilters.keyword = ''
  postFilters.view = 'all'
  postPage.value = 1
  loadPosts()
}

function goPostPage(next) {
  if (next < 1 || next > postTotalPages.value || next === postPage.value) return
  postPage.value = next
  loadPosts()
}

async function postAction(action, row, extra = {}) {
  const pathMap = {
    reviewClear: '/moderation/review',
    reviewTakeDown: '/moderation/review',
    takeDown: '/moderation/take-down',
    restore: '/moderation/restore',
    remove: '/moderation/delete',
  }
  const dataMap = {
    reviewClear: { post_id: row._id, action: 'clear' },
    reviewTakeDown: { post_id: row._id, action: 'take_down' },
    takeDown: { post_id: row._id },
    restore: { post_id: row._id },
    remove: { post_id: row._id },
  }
  const tipMap = {
    reviewClear: `确认该动态内容合规？将移除「疑似」标记，动态保持发布。`,
    reviewTakeDown: `确认该动态违规？将下架动态并通知社团负责人。`,
    takeDown: `确认下架该动态？下架后学生端不可见，并通知社团负责人。`,
    restore: row.deleted === 1 ? `确认从回收站还原该动态？将恢复为已发布。` : `确认恢复该动态？将恢复为已发布。`,
    remove: `确认删除该动态？删除后进入回收站（可还原），学生端不可见。`,
  }
  try {
    await ElMessageBox.confirm(tipMap[action], '内容监管', {
      confirmButtonText: '确认',
      cancelButtonText: '取消',
      type: action === 'remove' || action === 'reviewTakeDown' ? 'warning' : 'info',
    })
  } catch (e) {
    return
  }
  postPendingId.value = row._id
  const res = await request({ path: pathMap[action], method: 'POST', data: dataMap[action] })
  postPendingId.value = ''
  if (res.code !== 0) {
    ElMessage.error(res.message || '操作失败，请稍后重试')
    return
  }
  const msgMap = {
    reviewClear: '已标记为合规，动态保持发布',
    reviewTakeDown: '已违规下架，并通知社团负责人',
    takeDown: '已下架，并通知社团负责人',
    restore: row.deleted === 1 ? '已从回收站还原' : '已恢复发布',
    remove: '已删除（回收站可还原）',
  }
  ElMessage.success(msgMap[action])
  await loadPosts()
}

/* ---------------- 社团封禁（复用 club 域） ---------------- */
const clubKeyword = ref('')
const clubList = ref([])
const clubTotal = ref(0)
const clubPage = ref(1)
const clubLoading = ref(false)
const clubError = ref('')
const clubPendingId = ref('')
let clubSeq = 0

const clubTotalPages = computed(() => Math.max(1, Math.ceil(clubTotal.value / PAGE_SIZE)))

async function loadClubs() {
  const seq = ++clubSeq
  clubLoading.value = true
  clubError.value = ''
  const res = await request({
    path: '/club/query',
    method: 'POST',
    data: {
      status: 'all',
      keyword: clubKeyword.value.trim(),
      page: clubPage.value,
      page_size: PAGE_SIZE,
    },
  })
  if (seq !== clubSeq) return
  clubLoading.value = false
  if (res.code !== 0 || !res.data) {
    clubError.value = res.message || '社团列表加载失败，请稍后重试'
    clubList.value = []
    clubTotal.value = 0
    return
  }
  clubList.value = res.data.list || []
  clubTotal.value = res.data.total || 0
  if (!clubList.value.length && clubPage.value > 1) {
    clubPage.value -= 1
    await loadClubs()
  }
}

function searchClubs() {
  clubPage.value = 1
  loadClubs()
}

function goClubPage(next) {
  if (next < 1 || next > clubTotalPages.value || next === clubPage.value) return
  clubPage.value = next
  loadClubs()
}

async function toggleBan(row) {
  const banning = row.status === 'normal'
  try {
    await ElMessageBox.confirm(
      banning
        ? `封禁后「${row.name}」在学生端不再展示，且不可再发布活动与招新；请确认已完成违规取证。`
        : `解封后「${row.name}」将恢复展示与发布权限。`,
      banning ? '确认封禁 / 停用该社团？' : '确认解封该社团？',
      { confirmButtonText: banning ? '确认封禁' : '确认解封', cancelButtonText: '取消', type: 'warning' }
    )
  } catch (e) {
    return
  }
  clubPendingId.value = row._id
  const res = await request({
    path: '/club/ban',
    method: 'POST',
    data: { club_id: row._id, action: banning ? 'ban' : 'unban' },
  })
  clubPendingId.value = ''
  if (res.code !== 0) {
    ElMessage.error(res.message || (banning ? '封禁失败，请稍后重试' : '解封失败，请稍后重试'))
    return
  }
  ElMessage.success(banning ? `已封禁「${row.name}」` : `已解封「${row.name}」`)
  await loadClubs()
}

onMounted(() => {
  // 支持工作台待办跳转：/content?tab=posts|clubs
  const tab = useRoute().query.tab
  if (tab === 'posts' || tab === 'clubs') activeTab.value = tab
  loadPosts()
  loadClubs()
})
</script>

<template>
  <div class="space-y-6">
    <!-- 页面标题 Banner -->
    <div
      class="flex flex-col justify-between gap-4 rounded-xl border-2 border-memphis-dark bg-card p-6 shadow-memphis-md lg:flex-row lg:items-center"
    >
      <div class="space-y-2">
        <h1 class="font-display text-2xl font-bold tracking-tight text-memphis-dark">内容监管</h1>
        <p class="max-w-3xl font-sans text-sm text-ink-muted">
          社团动态「先发后审」：浏览动态流与「疑似」待审队列，复核合规则移除标记、违规则下架并通知社团；
          下架 / 恢复、删除违规（软删除可还原）；严重违规封禁 / 停用社团（封禁前二次确认）。
          动态数据源随 P2-01 接入，当前为空态属正常。
        </p>
      </div>
    </div>

    <!-- 双 Tab -->
    <div class="flex gap-2">
      <button
        v-for="t in [
          { key: 'posts', label: '动态监管' },
          { key: 'clubs', label: '社团封禁' },
        ]"
        :key="t.key"
        type="button"
        class="rounded-xl border-2 px-5 py-2 font-sans text-sm font-bold"
        :class="activeTab === t.key ? 'border-memphis-dark bg-primary text-white shadow-memphis-sm' : 'border-memphis-dark bg-card text-memphis-dark'"
        @click="activeTab = t.key"
      >
        {{ t.label }}
      </button>
    </div>

    <!-- 动态监管 -->
    <template v-if="activeTab === 'posts'">
      <div class="m-card p-6">
        <div class="flex flex-wrap items-end justify-between gap-4">
          <div class="flex flex-wrap items-end gap-5">
            <label class="block">
              <span class="font-sans text-xs font-bold text-memphis-dark">视图</span>
              <select
                v-model="postFilters.view"
                class="mt-2 rounded-xl border-2 border-memphis-dark bg-canvas px-3 py-2 font-sans text-xs text-ink-body outline-none"
                @change="searchPosts"
              >
                <option v-for="v in VIEW_META" :key="v.value" :value="v.value">{{ v.label }}</option>
              </select>
            </label>
            <label class="block">
              <span class="font-sans text-xs font-bold text-memphis-dark">内容关键词</span>
              <input
                v-model="postFilters.keyword"
                type="search"
                :maxlength="KEYWORD_MAX"
                placeholder="内容子串匹配"
                class="mt-2 w-72 rounded-xl border-2 border-memphis-dark bg-canvas px-3 py-2 font-sans text-xs text-ink-body outline-none placeholder:text-ink-muted"
                @keyup.enter="searchPosts"
              />
            </label>
            <div class="flex gap-3">
              <button
                type="button"
                class="m-pressable rounded-xl border-2 border-memphis-dark bg-primary px-5 py-2 font-sans text-xs font-bold text-white shadow-memphis-sm"
                @click="searchPosts"
              >
                查询
              </button>
              <button
                type="button"
                class="m-pressable rounded-xl border-2 border-memphis-dark bg-card px-5 py-2 font-sans text-xs font-bold text-memphis-dark"
                @click="resetPosts"
              >
                重置
              </button>
            </div>
          </div>
          <span class="rounded-full border-2 border-memphis-dark bg-canvas px-3 py-1 font-sans text-xs text-ink-muted">
            匹配 {{ postTotal }} 条
          </span>
        </div>
      </div>

      <div class="m-card">
        <div class="flex items-center justify-between border-b-2 border-memphis-dark px-6 py-4">
          <span class="font-sans text-base font-bold text-memphis-dark">动态流</span>
          <span class="font-sans text-xs text-ink-muted">按发布时间倒序 · 每页 {{ PAGE_SIZE }} 条</span>
        </div>

        <p
          v-if="postError"
          class="m-6 rounded-xl border-2 border-memphis-dark bg-danger/10 px-4 py-3 font-sans text-xs leading-relaxed text-danger"
        >
          {{ postError }}
        </p>

        <div v-else class="tbl-scroll">
          <table class="w-full border-collapse">
            <thead>
              <tr class="border-b-2 border-memphis-dark bg-canvas">
                <th class="tbl-nowrap px-6 py-3 text-left font-sans text-sm font-semibold text-memphis-dark">动态内容</th>
                <th class="tbl-nowrap px-6 py-3 text-left font-sans text-sm font-semibold text-memphis-dark">社团</th>
                <th class="tbl-nowrap px-6 py-3 text-left font-sans text-sm font-semibold text-memphis-dark">状态</th>
                <th class="tbl-nowrap px-6 py-3 text-left font-sans text-sm font-semibold text-memphis-dark">发布时间</th>
                <th class="tbl-nowrap px-6 py-3 text-left font-sans text-sm font-semibold text-memphis-dark">操作</th>
              </tr>
            </thead>
            <tbody>
              <template v-if="postLoading">
                <tr v-for="i in 5" :key="`skeleton-${i}`" class="border-b border-ink-line">
                  <td colspan="5" class="px-6 py-4">
                    <div class="h-4 w-full animate-pulse rounded-full bg-ink-line"></div>
                  </td>
                </tr>
              </template>
              <template v-else-if="postEmpty">
                <tr>
                  <td colspan="5" class="px-6 py-16">
                    <div class="flex flex-col items-center gap-3">
                      <span class="flex h-16 w-16 items-center justify-center rounded-full border-2 border-memphis-dark bg-canvas">
                        <span class="material-symbols-outlined text-[28px] text-memphis-dark">policy</span>
                      </span>
                      <span class="rounded-full border-2 border-memphis-dark bg-warning px-3 py-0.5 font-sans text-[11px] font-bold text-memphis-dark">
                        暂无动态
                      </span>
                      <span class="font-sans text-xs text-ink-muted">没有匹配的动态（数据源随 P2-01 社团动态接入）</span>
                    </div>
                  </td>
                </tr>
              </template>
              <template v-else>
                <tr v-for="row in postList" :key="row._id" class="border-b border-ink-line transition-colors hover:bg-canvas">
                  <td class="px-6 py-4">
                    <div class="flex items-center gap-3 whitespace-nowrap">
                      <span class="flex h-8 w-8 items-center justify-center rounded-full border-2 border-memphis-dark bg-primary-light">
                        <span class="material-symbols-outlined text-[18px] text-memphis-dark">article</span>
                      </span>
                      <div class="flex flex-col">
                        <span class="max-w-[320px] truncate font-sans text-sm font-bold text-memphis-dark">{{ row.content }}</span>
                        <span class="mt-0.5 font-sans text-xs text-ink-muted">
                          {{ (row.images || []).length > 0 ? `${row.images.length} 张图` : '无图' }}
                          <span v-if="row.deleted === 1" class="text-danger"> · 已删除</span>
                        </span>
                      </div>
                    </div>
                  </td>
                  <td class="tbl-nowrap px-6 py-4 font-sans text-sm text-ink-body">{{ row.club_name || '—' }}</td>
                  <td class="px-6 py-4">
                    <div class="flex flex-wrap items-center gap-2">
                      <span
                        v-if="row.deleted === 1"
                        class="inline-flex items-center gap-1 whitespace-nowrap rounded-full border-2 border-memphis-dark bg-danger-light px-2.5 py-0.5 font-sans text-[11px] font-bold text-danger shadow-memphis-xs"
                      >
                        已删除
                      </span>
                      <span
                        v-else
                        class="inline-flex items-center gap-1 whitespace-nowrap rounded-full border-2 border-memphis-dark px-2.5 py-0.5 font-sans text-[11px] font-bold shadow-memphis-xs"
                        :class="STATUS_META[row.status] ? STATUS_META[row.status].cls : 'bg-canvas text-ink-muted'"
                      >
                        {{ STATUS_META[row.status] ? STATUS_META[row.status].label : row.status }}
                      </span>
                      <span
                        v-if="row.flagged"
                        class="inline-flex items-center gap-1 whitespace-nowrap rounded-full border-2 border-memphis-dark bg-warning px-2.5 py-0.5 font-sans text-[11px] font-bold text-memphis-dark shadow-memphis-xs"
                      >
                        ⚠ 疑似
                      </span>
                    </div>
                  </td>
                  <td class="tbl-nowrap px-6 py-4 font-sans text-sm text-ink-body">{{ formatTime(row.published_at) }}</td>
                  <td class="px-6 py-4">
                    <div class="flex flex-wrap items-center gap-2">
                      <template v-if="row.deleted === 1">
                        <button
                          type="button"
                          class="m-pressable whitespace-nowrap rounded-xl border-2 border-memphis-dark bg-success-light px-3 py-1.5 font-sans text-xs font-bold text-ink-body shadow-memphis-xs"
                          @click="postAction('restore', row)"
                        >
                          还原
                        </button>
                      </template>
                      <template v-else-if="row.flagged">
                        <button
                          type="button"
                          class="m-pressable whitespace-nowrap rounded-xl border-2 border-memphis-dark bg-success-light px-3 py-1.5 font-sans text-xs font-bold text-ink-body shadow-memphis-xs"
                          @click="postAction('reviewClear', row)"
                        >
                          合规放行
                        </button>
                        <button
                          type="button"
                          class="m-pressable whitespace-nowrap rounded-xl border-2 border-memphis-dark bg-danger-light px-3 py-1.5 font-sans text-xs font-bold text-danger shadow-memphis-xs"
                          @click="postAction('reviewTakeDown', row)"
                        >
                          违规下架
                        </button>
                      </template>
                      <template v-else>
                        <button
                          v-if="row.status === 'published'"
                          type="button"
                          class="m-pressable whitespace-nowrap rounded-xl border-2 border-memphis-dark bg-warning px-3 py-1.5 font-sans text-xs font-bold text-memphis-dark shadow-memphis-xs"
                          @click="postAction('takeDown', row)"
                        >
                          下架
                        </button>
                        <button
                          v-if="row.status === 'taken_down'"
                          type="button"
                          class="m-pressable whitespace-nowrap rounded-xl border-2 border-memphis-dark bg-success-light px-3 py-1.5 font-sans text-xs font-bold text-ink-body shadow-memphis-xs"
                          @click="postAction('restore', row)"
                        >
                          恢复
                        </button>
                        <button
                          type="button"
                          :disabled="postPendingId === row._id"
                          class="m-pressable whitespace-nowrap rounded-xl border-2 border-memphis-dark bg-danger-light px-3 py-1.5 font-sans text-xs font-bold text-danger shadow-memphis-xs disabled:opacity-50"
                          @click="postAction('remove', row)"
                        >
                          删除
                        </button>
                      </template>
                    </div>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>

        <div class="flex flex-wrap items-center justify-between gap-3 border-t-2 border-memphis-dark px-6 py-4">
          <span class="font-sans text-xs text-ink-muted">第 {{ postPage }} / {{ postTotalPages }} 页 · 共 {{ postTotal }} 条</span>
          <div class="flex items-center gap-3">
            <button
              type="button"
              :disabled="postPage <= 1 || postLoading"
              class="m-pressable rounded-xl border-2 border-memphis-dark bg-card px-4 py-1.5 font-sans text-xs font-bold text-memphis-dark disabled:opacity-40"
              @click="goPostPage(postPage - 1)"
            >
              上一页
            </button>
            <button
              type="button"
              :disabled="postPage >= postTotalPages || postLoading"
              class="m-pressable rounded-xl border-2 border-memphis-dark bg-card px-4 py-1.5 font-sans text-xs font-bold text-memphis-dark disabled:opacity-40"
              @click="goPostPage(postPage + 1)"
            >
              下一页
            </button>
          </div>
        </div>
      </div>
    </template>

    <!-- 社团封禁 -->
    <template v-else>
      <div class="m-card p-6">
        <div class="flex flex-wrap items-end justify-between gap-4">
          <label class="block">
            <span class="font-sans text-xs font-bold text-memphis-dark">社团名称 / 关键词</span>
            <input
              v-model="clubKeyword"
              type="search"
              :maxlength="KEYWORD_MAX"
              placeholder="按社团名称 / 简介模糊查询"
              class="mt-2 w-72 rounded-xl border-2 border-memphis-dark bg-canvas px-3 py-2 font-sans text-xs text-ink-body outline-none placeholder:text-ink-muted"
              @keyup.enter="searchClubs"
            />
          </label>
          <div class="flex gap-3">
            <button
              type="button"
              class="m-pressable rounded-xl border-2 border-memphis-dark bg-primary px-5 py-2 font-sans text-xs font-bold text-white shadow-memphis-sm"
              @click="searchClubs"
            >
              查询
            </button>
          </div>
          <span class="rounded-full border-2 border-memphis-dark bg-canvas px-3 py-1 font-sans text-xs text-ink-muted">
            匹配 {{ clubTotal }} 个社团
          </span>
        </div>
        <p class="mt-4 font-sans text-xs leading-relaxed text-ink-muted">
          封禁前需二次确认（需求 4.3.3）；封禁后学生端不再展示，且不可再发布活动与招新，解封后立即恢复。
        </p>
      </div>

      <div class="m-card">
        <p
          v-if="clubError"
          class="m-6 rounded-xl border-2 border-memphis-dark bg-danger/10 px-4 py-3 font-sans text-xs leading-relaxed text-danger"
        >
          {{ clubError }}
        </p>
        <div v-else class="tbl-scroll">
          <table class="w-full border-collapse">
            <thead>
              <tr class="border-b-2 border-memphis-dark bg-canvas">
                <th class="tbl-nowrap px-6 py-3 text-left font-sans text-sm font-semibold text-memphis-dark">社团</th>
                <th class="tbl-nowrap px-6 py-3 text-left font-sans text-sm font-semibold text-memphis-dark">状态</th>
                <th class="tbl-nowrap px-6 py-3 text-left font-sans text-sm font-semibold text-memphis-dark">操作</th>
              </tr>
            </thead>
            <tbody>
              <template v-if="clubLoading">
                <tr v-for="i in 5" :key="`skeleton-${i}`" class="border-b border-ink-line">
                  <td colspan="3" class="px-6 py-4">
                    <div class="h-4 w-full animate-pulse rounded-full bg-ink-line"></div>
                  </td>
                </tr>
              </template>
              <template v-else-if="clubList.length === 0">
                <tr>
                  <td colspan="3" class="px-6 py-16">
                    <div class="flex flex-col items-center gap-3">
                      <span class="flex h-16 w-16 items-center justify-center rounded-full border-2 border-memphis-dark bg-canvas">
                        <span class="material-symbols-outlined text-[28px] text-memphis-dark">diversity_3</span>
                      </span>
                      <span class="rounded-full border-2 border-memphis-dark bg-warning px-3 py-0.5 font-sans text-[11px] font-bold text-memphis-dark">
                        暂无社团
                      </span>
                    </div>
                  </td>
                </tr>
              </template>
              <template v-else>
                <tr v-for="row in clubList" :key="row._id" class="border-b border-ink-line transition-colors hover:bg-canvas">
                  <td class="px-6 py-4">
                    <div class="flex items-center gap-3 whitespace-nowrap">
                      <span class="font-sans text-sm font-bold text-memphis-dark">{{ row.name }}</span>
                    </div>
                  </td>
                  <td class="px-6 py-4">
                    <span
                      class="inline-flex items-center gap-1 whitespace-nowrap rounded-full border-2 border-memphis-dark px-2.5 py-0.5 font-sans text-[11px] font-bold shadow-memphis-xs"
                      :class="row.status === 'banned' ? 'bg-danger-light text-danger' : 'bg-memphis-green text-memphis-dark'"
                    >
                      {{ row.status === 'banned' ? '已封禁' : '正常' }}
                    </span>
                  </td>
                  <td class="px-6 py-4">
                    <button
                      type="button"
                      :disabled="clubPendingId === row._id"
                      class="m-pressable whitespace-nowrap rounded-xl border-2 border-memphis-dark px-3 py-1.5 font-sans text-xs font-bold shadow-memphis-xs disabled:opacity-50"
                      :class="row.status === 'banned' ? 'bg-success-light text-ink-body' : 'bg-danger-light text-danger'"
                      @click="toggleBan(row)"
                    >
                      {{ row.status === 'banned' ? '解封' : '封禁' }}
                    </button>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
        <div class="flex flex-wrap items-center justify-between gap-3 border-t-2 border-memphis-dark px-6 py-4">
          <span class="font-sans text-xs text-ink-muted">第 {{ clubPage }} / {{ clubTotalPages }} 页 · 共 {{ clubTotal }} 条</span>
          <div class="flex items-center gap-3">
            <button
              type="button"
              :disabled="clubPage <= 1 || clubLoading"
              class="m-pressable rounded-xl border-2 border-memphis-dark bg-card px-4 py-1.5 font-sans text-xs font-bold text-memphis-dark disabled:opacity-40"
              @click="goClubPage(clubPage - 1)"
            >
              上一页
            </button>
            <button
              type="button"
              :disabled="clubPage >= clubTotalPages || clubLoading"
              class="m-pressable rounded-xl border-2 border-memphis-dark bg-card px-4 py-1.5 font-sans text-xs font-bold text-memphis-dark disabled:opacity-40"
              @click="goClubPage(clubPage + 1)"
            >
              下一页
            </button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>