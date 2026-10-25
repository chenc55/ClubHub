<script setup>
/**
 * 管理工作台（P1-28 / 待办概览）
 *
 * 接口：GET /dashboard/summary（管理通道，三角色均可见）
 * 内容：平台概览 KPI（认证用户 / 正常社团 / 活动总数 / 开放招新）+ 四类待办 + 疑似动态，点击待办跳转对应审核页。
 * 权限：工作台概览三角色可见（需求 2.3）；auditor / viewer 侧边栏仅见各自菜单，后端 dashboard 接口不限制角色。
 */
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { request } from '@/utils/request'
import { useAuthStore } from '@/store/auth'

const auth = useAuthStore()
const router = useRouter()

const loading = ref(true)
const errorMessage = ref('')
const data = ref(null)

const TODO_META = [
  { key: 'clubs', label: '待审社团', icon: 'diversity_3', to: '/clubs', tone: 'bg-warning text-memphis-dark', desc: '入驻申请待审核' },
  { key: 'activities', label: '待审活动', icon: 'local_activity', to: '/review?tab=activity', tone: 'bg-primary-light text-primary', desc: '活动发布待审核' },
  { key: 'recruitments', label: '待审招新', icon: 'campaign', to: '/review?tab=recruitment', tone: 'bg-success-light text-ink-body', desc: '招新岗位待审核' },
  { key: 'appeals', label: '待审申诉', icon: 'how_to_reg', to: '/review?tab=appeal', tone: 'bg-info-light text-info-text', desc: '换绑 / 学号占用申诉' },
  { key: 'flagged_posts', label: '疑似动态', icon: 'policy', to: '/content?tab=posts', tone: 'bg-danger-light text-danger', desc: '敏感词命中待复核' },
]

const OVERVIEW_META = [
  { key: 'verified_users', label: '认证用户', icon: 'badge', tone: 'bg-primary-light text-primary' },
  { key: 'normal_clubs', label: '正常社团', icon: 'diversity_3', tone: 'bg-success-light text-ink-body' },
  { key: 'total_activities', label: '活动总数', icon: 'local_activity', tone: 'bg-info-light text-info-text' },
  { key: 'open_recruitments', label: '开放招新', icon: 'campaign', tone: 'bg-warning text-memphis-dark' },
]

async function load() {
  loading.value = true
  errorMessage.value = ''
  const res = await request({ path: '/dashboard/summary' })
  loading.value = false
  if (res.code !== 0 || !res.data) {
    errorMessage.value = res.message || '工作台数据加载失败，请稍后重试'
    data.value = null
    return
  }
  data.value = res.data
}

function go(path) {
  router.push(path)
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
          <h1 class="font-display text-3xl font-bold tracking-tight text-memphis-dark">管理工作台</h1>
          <span
            v-if="data"
            class="inline-flex items-center gap-1 rounded-full border border-memphis-dark bg-warning px-2 py-0.5 font-sans text-[11px] font-bold uppercase text-memphis-dark shadow-memphis-xs"
          >
            <span class="h-2 w-2 animate-ping rounded-full bg-danger"></span>
            {{ data.pending.total }} 条待办
          </span>
        </div>
        <p class="max-w-3xl font-sans text-sm text-ink-muted">
          欢迎回来，{{ auth.name }}（{{ auth.roleLabel }}）。待办一目了然，点击卡片直达对应审核列表；
          疑似动态为敏感词命中的「先发后审」送审队列（P2-01 数据源接入后自动填充）。
        </p>
      </div>
    </div>

    <!-- 加载 / 错误态 -->
    <template v-if="loading">
      <div class="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        <div v-for="i in 5" :key="`skeleton-${i}`" class="h-32 animate-pulse rounded-xl border-2 border-memphis-dark bg-card"></div>
      </div>
    </template>
    <template v-else-if="errorMessage">
      <div class="rounded-xl border-2 border-memphis-dark bg-danger/10 px-4 py-3 font-sans text-xs leading-relaxed text-danger">
        {{ errorMessage }}
      </div>
    </template>
    <template v-else-if="data">
      <!-- 待办卡片 -->
      <div class="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        <button
          v-for="t in TODO_META"
          :key="t.key"
          type="button"
          class="group m-pressable flex flex-col justify-between overflow-hidden rounded-xl border-2 border-memphis-dark bg-card p-4 text-left shadow-memphis-md"
          @click="go(t.to)"
        >
          <div class="z-10 flex items-center justify-between">
            <span class="font-sans text-xs font-bold text-ink-muted">{{ t.label }}</span>
            <span :class="['material-symbols-outlined text-[20px] text-memphis-dark']">{{ t.icon }}</span>
          </div>
          <div class="z-10 mt-4 flex items-end justify-between gap-2">
            <span class="font-display text-3xl font-bold text-memphis-dark">{{ data.pending[t.key] }}</span>
            <span class="font-sans text-[11px] text-ink-muted">点击进入 →</span>
          </div>
          <span :class="['z-10 mt-3 self-start rounded-full border-2 border-memphis-dark px-2 py-0.5 font-sans text-[10px] font-bold shadow-memphis-xs', t.tone]">
            {{ t.desc }}
          </span>
        </button>
      </div>

      <!-- 平台概览 KPI -->
      <div class="rounded-xl border-2 border-memphis-dark bg-card shadow-memphis-md">
        <div class="flex items-center justify-between border-b-2 border-memphis-dark px-6 py-4">
          <h2 class="font-sans text-lg font-bold text-memphis-dark">平台概览</h2>
          <span class="font-sans text-xs text-ink-muted">实时统计（soft-delete 口径）</span>
        </div>
        <div class="grid grid-cols-2 gap-4 p-6 md:grid-cols-4">
          <div
            v-for="k in OVERVIEW_META"
            :key="k.key"
            class="relative flex flex-col justify-between overflow-hidden rounded-xl border-2 border-memphis-dark bg-canvas p-4"
          >
            <div class="flex items-center justify-between">
              <span class="font-sans text-xs font-bold text-ink-muted">{{ k.label }}</span>
              <span :class="['material-symbols-outlined text-[20px] text-memphis-dark']">{{ k.icon }}</span>
            </div>
            <div class="mt-3">
              <span class="font-display text-3xl font-bold text-memphis-dark">{{ data.overview[k.key] }}</span>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>