<script setup>
/**
 * 数据统计（P2-03 / ADM-07）
 *
 * 接口：GET /stats/overview（range: today|7d|30d|custom + start_at/end_at）、GET /stats/export
 * （管理通道，三角色 super / auditor / viewer 均可查看与导出，需求 2.3 矩阵）
 *
 * 口径（需求 2.2.3(7)，与 stats 云函数一致）：
 * - 用户：累计注册数（verified 总数）/ 新增用户数（周期内 verified_at）/ DAU（周期内 last_active_at）/ MAU（近 30 天）
 * - 社团：入驻总数（normal）/ 活跃社团占比（周期内有动态或有活动的 normal 社团）/ 分类分布
 * - 活动：发布数（周期内非草稿）/ 报名数（approved）/ 签到率（周期内 checked_in ÷ approved）
 * - 招新：岗位数 / 报名数 / 录取数（accepted）
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { request } from '@/utils/request'

const RANGE_OPTIONS = [
  { value: 'today', label: '今天' },
  { value: '7d', label: '近 7 天' },
  { value: '30d', label: '近 30 天' },
  { value: 'custom', label: '自定义区间' },
]

const filters = reactive({ range: '7d', startAt: '', endAt: '' })
const loading = ref(false)
const errorMessage = ref('')
const data = ref(null)
let requestSeq = 0

const rangeLabel = computed(() => RANGE_OPTIONS.find((o) => o.value === filters.range)?.label || filters.range)

function toMs(date) {
  return new Date(date).getTime()
}

async function load() {
  const seq = ++requestSeq
  loading.value = true
  errorMessage.value = ''
  const qs = new URLSearchParams()
  qs.set('range', filters.range)
  if (filters.range === 'custom') {
    if (!filters.startAt || !filters.endAt) {
      loading.value = false
      errorMessage.value = '请选择自定义时间区间'
      return
    }
    qs.set('start_at', String(toMs(filters.startAt)))
    qs.set('end_at', String(toMs(filters.endAt)))
  }
  const res = await request({ path: `/stats/overview?${qs.toString()}`, method: 'GET' })
  if (seq !== requestSeq) return
  loading.value = false
  if (res.code !== 0 || !res.data) {
    errorMessage.value = res.message || '统计数据加载失败，请稍后重试'
    data.value = null
    return
  }
  data.value = res.data
}

function pickRange(value) {
  filters.range = value
  if (value !== 'custom') load()
}

function reset() {
  filters.range = '7d'
  filters.startAt = ''
  filters.endAt = ''
  load()
}

async function exportCsv() {
  const qs = new URLSearchParams()
  qs.set('range', filters.range)
  if (filters.range === 'custom') {
    if (!filters.startAt || !filters.endAt) {
      ElMessage.warning('请先选择自定义时间区间')
      return
    }
    qs.set('start_at', String(toMs(filters.startAt)))
    qs.set('end_at', String(toMs(filters.endAt)))
  }
  const res = await request({ path: `/stats/export?${qs.toString()}`, method: 'GET' })
  if (res.code !== 0 || !res.data || !res.data.csv) {
    ElMessage.error(res.message || '导出失败，请稍后重试')
    return
  }
  const blob = new Blob([res.data.csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = res.data.filename || 'clubhub-stats.csv'
  a.click()
  URL.revokeObjectURL(url)
  ElMessage.success(`已导出 ${res.data.filename || '统计 CSV'}`)
}

function pct(value) {
  if (value == null) return '—'
  return `${(value * 100).toFixed(2)}%`
}

function rateOf(value) {
  if (value == null) return '—'
  return `${(value * 100).toFixed(2)}%`
}

const maxDistCount = computed(() => {
  const dist = (data.value && data.value.clubs && data.value.clubs.category_distribution) || []
  return Math.max(1, ...dist.map((d) => d.count))
})

onMounted(load)
</script>

<template>
  <div class="flex flex-col gap-6 p-6">
    <!-- 标题与筛选 -->
    <div
      class="flex flex-col justify-between gap-4 rounded-xl border-2 border-memphis-dark bg-card p-6 shadow-memphis-md lg:flex-row lg:items-center"
    >
      <div class="space-y-2">
        <h1 class="font-display text-3xl font-bold tracking-tight text-memphis-dark">数据统计</h1>
        <p class="max-w-3xl font-sans text-sm text-ink-muted">
          四维指标口径与需求 2.2.3(7) 一致：用户（累计 / 新增 / DAU / MAU）、社团（入驻 / 活跃占比 / 分类分布）、
          活动（发布 / 报名 approved / 签到率）、招新（岗位 / 报名 / 录取）。切换时间范围或导出 CSV。
        </p>
      </div>

      <div class="flex flex-wrap items-end gap-3">
        <div class="flex rounded-xl border-2 border-memphis-dark bg-canvas p-1">
          <button
            v-for="opt in RANGE_OPTIONS"
            :key="opt.value"
            type="button"
            class="rounded-lg px-3 py-1.5 font-sans text-xs font-bold transition-colors"
            :class="filters.range === opt.value ? 'bg-primary text-white shadow-memphis-xs' : 'text-memphis-dark'"
            @click="pickRange(opt.value)"
          >
            {{ opt.label }}
          </button>
        </div>
        <button
          v-if="filters.range === 'custom'"
          type="button"
          class="m-pressable rounded-xl border-2 border-memphis-dark bg-card px-4 py-2 font-sans text-xs font-bold text-memphis-dark shadow-memphis-sm"
          @click="reset"
        >
          重置
        </button>
        <button
          type="button"
          class="m-pressable rounded-xl border-2 border-memphis-dark bg-primary px-5 py-2 font-sans text-xs font-bold text-white shadow-memphis-sm"
          @click="exportCsv"
        >
          导出 CSV
        </button>
      </div>
    </div>

    <!-- 自定义区间选择器 -->
    <div
      v-if="filters.range === 'custom'"
      class="flex flex-wrap items-center gap-4 rounded-xl border-2 border-memphis-dark bg-card p-4 shadow-memphis-sm"
    >
      <span class="font-sans text-xs font-bold text-memphis-dark">统计区间</span>
      <input
        type="date"
        v-model="filters.startAt"
        class="rounded-xl border-2 border-memphis-dark bg-canvas px-3 py-2 font-sans text-xs text-ink-body outline-none"
      />
      <span class="font-sans text-xs text-ink-muted">至</span>
      <input
        type="date"
        v-model="filters.endAt"
        class="rounded-xl border-2 border-memphis-dark bg-canvas px-3 py-2 font-sans text-xs text-ink-body outline-none"
      />
      <button
        type="button"
        class="m-pressable rounded-xl border-2 border-memphis-dark bg-primary px-5 py-2 font-sans text-xs font-bold text-white shadow-memphis-sm"
        @click="load"
      >
        查询
      </button>
      <span class="font-sans text-[11px] text-ink-muted">含起始日全天；结束日取当日 00:00（左闭右开）</span>
    </div>

    <!-- 加载态 -->
    <template v-if="loading">
      <div class="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div v-for="i in 8" :key="`skeleton-${i}`" class="h-32 animate-pulse rounded-xl border-2 border-memphis-dark bg-card"></div>
      </div>
    </template>
    <template v-else-if="errorMessage">
      <div class="rounded-xl border-2 border-memphis-dark bg-danger/10 px-4 py-3 font-sans text-xs leading-relaxed text-danger">
        {{ errorMessage }}
      </div>
    </template>
    <template v-else-if="data">
      <!-- 用户 -->
      <div class="rounded-xl border-2 border-memphis-dark bg-card shadow-memphis-md">
        <div class="flex items-center justify-between border-b-2 border-memphis-dark px-6 py-4">
          <h2 class="font-sans text-lg font-bold text-memphis-dark">用户</h2>
          <span class="font-sans text-xs text-ink-muted">{{ rangeLabel }} · MAU 固定近 30 天</span>
        </div>
        <div class="grid grid-cols-2 gap-px bg-ink-line/60 md:grid-cols-4">
          <div class="bg-card p-6">
            <p class="font-sans text-xs font-bold text-ink-muted">累计注册数</p>
            <p class="mt-2 font-display text-3xl font-bold text-memphis-dark">{{ data.users.total_verified }}</p>
            <p class="mt-1 font-sans text-[11px] text-ink-muted">已认证（verified）</p>
          </div>
          <div class="bg-card p-6">
            <p class="font-sans text-xs font-bold text-ink-muted">新增用户数</p>
            <p class="mt-2 font-display text-3xl font-bold text-primary">{{ data.users.new_verified }}</p>
            <p class="mt-1 font-sans text-[11px] text-ink-muted">{{ rangeLabel }}内新认证</p>
          </div>
          <div class="bg-card p-6">
            <p class="font-sans text-xs font-bold text-ink-muted">活跃用户 DAU</p>
            <p class="mt-2 font-display text-3xl font-bold text-primary">{{ data.users.dau }}</p>
            <p class="mt-1 font-sans text-[11px] text-ink-muted">{{ rangeLabel }}内有访问行为去重</p>
          </div>
          <div class="bg-card p-6">
            <p class="font-sans text-xs font-bold text-ink-muted">活跃用户 MAU</p>
            <p class="mt-2 font-display text-3xl font-bold text-primary">{{ data.users.mau }}</p>
            <p class="mt-1 font-sans text-[11px] text-ink-muted">近 30 天去重</p>
          </div>
        </div>
      </div>

      <!-- 社团 -->
      <div class="rounded-xl border-2 border-memphis-dark bg-card shadow-memphis-md">
        <div class="flex items-center justify-between border-b-2 border-memphis-dark px-6 py-4">
          <h2 class="font-sans text-lg font-bold text-memphis-dark">社团</h2>
          <span class="font-sans text-xs text-ink-muted">{{ rangeLabel }} · 活跃口径：周期内有动态或有活动</span>
        </div>
        <div class="grid grid-cols-2 gap-px bg-ink-line/60 md:grid-cols-3">
          <div class="bg-card p-6">
            <p class="font-sans text-xs font-bold text-ink-muted">入驻社团数</p>
            <p class="mt-2 font-display text-3xl font-bold text-memphis-dark">{{ data.clubs.total }}</p>
            <p class="mt-1 font-sans text-[11px] text-ink-muted">正常（normal）</p>
          </div>
          <div class="bg-card p-6">
            <p class="font-sans text-xs font-bold text-ink-muted">活跃社团</p>
            <p class="mt-2 font-display text-3xl font-bold text-primary">{{ data.clubs.active_count }}</p>
            <p class="mt-1 font-sans text-[11px] text-ink-muted">{{ rangeLabel }}内有动态或有活动</p>
          </div>
          <div class="bg-card p-6">
            <p class="font-sans text-xs font-bold text-ink-muted">活跃社团占比</p>
            <p class="mt-2 font-display text-3xl font-bold text-primary">{{ rateOf(data.clubs.active_rate) }}</p>
            <p class="mt-1 font-sans text-[11px] text-ink-muted">活跃数 ÷ 入驻总数</p>
          </div>
        </div>
      </div>

      <!-- 活动 -->
      <div class="rounded-xl border-2 border-memphis-dark bg-card shadow-memphis-md">
        <div class="flex items-center justify-between border-b-2 border-memphis-dark px-6 py-4">
          <h2 class="font-sans text-lg font-bold text-memphis-dark">活动</h2>
          <span class="font-sans text-xs text-ink-muted">{{ rangeLabel }} · 报名 approved 口径</span>
        </div>
        <div class="grid grid-cols-2 gap-px bg-ink-line/60 md:grid-cols-3">
          <div class="bg-card p-6">
            <p class="font-sans text-xs font-bold text-ink-muted">发布数</p>
            <p class="mt-2 font-display text-3xl font-bold text-memphis-dark">{{ data.activities.published_count }}</p>
            <p class="mt-1 font-sans text-[11px] text-ink-muted">{{ rangeLabel }}内创建且非草稿</p>
          </div>
          <div class="bg-card p-6">
            <p class="font-sans text-xs font-bold text-ink-muted">报名数</p>
            <p class="mt-2 font-display text-3xl font-bold text-primary">{{ data.activities.signup_count }}</p>
            <p class="mt-1 font-sans text-[11px] text-ink-muted">{{ rangeLabel }}内有效报名</p>
          </div>
          <div class="bg-card p-6">
            <p class="font-sans text-xs font-bold text-ink-muted">签到率</p>
            <p class="mt-2 font-display text-3xl font-bold text-primary">{{ pct(data.activities.signin_rate) }}</p>
            <p class="mt-1 font-sans text-[11px] text-ink-muted">签到人数 ÷ 报名成功</p>
          </div>
        </div>
      </div>

      <!-- 招新 -->
      <div class="rounded-xl border-2 border-memphis-dark bg-card shadow-memphis-md">
        <div class="flex items-center justify-between border-b-2 border-memphis-dark px-6 py-4">
          <h2 class="font-sans text-lg font-bold text-memphis-dark">招新</h2>
          <span class="font-sans text-xs text-ink-muted">{{ rangeLabel }}</span>
        </div>
        <div class="grid grid-cols-2 gap-px bg-ink-line/60 md:grid-cols-3">
          <div class="bg-card p-6">
            <p class="font-sans text-xs font-bold text-ink-muted">岗位数</p>
            <p class="mt-2 font-display text-3xl font-bold text-memphis-dark">{{ data.recruitments.count }}</p>
            <p class="mt-1 font-sans text-[11px] text-ink-muted">{{ rangeLabel }}内创建</p>
          </div>
          <div class="bg-card p-6">
            <p class="font-sans text-xs font-bold text-ink-muted">报名数</p>
            <p class="mt-2 font-display text-3xl font-bold text-primary">{{ data.recruitments.signup_count }}</p>
            <p class="mt-1 font-sans text-[11px] text-ink-muted">{{ rangeLabel }}内报名记录</p>
          </div>
          <div class="bg-card p-6">
            <p class="font-sans text-xs font-bold text-ink-muted">录取数</p>
            <p class="mt-2 font-display text-3xl font-bold text-primary">{{ data.recruitments.accepted_count }}</p>
            <p class="mt-1 font-sans text-[11px] text-ink-muted">accepted</p>
          </div>
        </div>
      </div>

      <!-- 分类分布 -->
      <div class="rounded-xl border-2 border-memphis-dark bg-card shadow-memphis-md">
        <div class="flex items-center justify-between border-b-2 border-memphis-dark px-6 py-4">
          <h2 class="font-sans text-lg font-bold text-memphis-dark">社团分类分布</h2>
          <span class="font-sans text-xs text-ink-muted">正常社团按分类计数</span>
        </div>
        <div class="p-6">
          <div
            v-for="d in data.clubs.category_distribution"
            :key="d.category_id || 'uncat'"
            class="mb-4 flex items-center gap-4 last:mb-0"
          >
            <span class="w-24 shrink-0 font-sans text-xs font-bold text-memphis-dark">{{ d.category_name }}</span>
            <div class="h-4 flex-1 overflow-hidden rounded-full border-2 border-memphis-dark bg-canvas">
              <div
                class="h-full rounded-full bg-primary shadow-memphis-xs"
                :style="{ width: `${(d.count / maxDistCount) * 100}%` }"
              ></div>
            </div>
            <span class="w-16 shrink-0 text-right font-display text-lg font-bold text-memphis-dark">{{ d.count }}</span>
          </div>
          <p v-if="!data.clubs.category_distribution.length" class="font-sans text-xs text-ink-muted">暂无社团数据</p>
        </div>
      </div>
    </template>
  </div>
</template>
