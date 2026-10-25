<script setup>
/**
 * 通用占位页（P0-03）
 * 每个菜单路由先指向本页，由对应 P1 子任务实现真实页面后替换
 */
import { useRoute } from 'vue-router'

const route = useRoute()
</script>

<template>
  <div class="flex flex-col gap-6 p-6">
    <!-- 页面标题 Banner -->
    <div
      class="flex flex-col justify-between gap-4 rounded-xl border-2 border-memphis-dark bg-card p-6 shadow-memphis-md lg:flex-row lg:items-center"
    >
      <div class="space-y-2">
        <div class="flex flex-wrap items-center gap-3">
          <h1 class="font-display text-2xl font-bold tracking-tight text-memphis-dark">{{ route.meta.title }}</h1>
          <span
            class="inline-flex items-center gap-1 rounded-full border border-memphis-dark bg-memphis-yellow px-2 py-0.5 font-sans text-[11px] font-bold uppercase text-memphis-dark shadow-memphis-xs"
          >
            <span class="h-2 w-2 animate-ping rounded-full bg-danger"></span>
            页面建设中
          </span>
        </div>
        <p class="max-w-3xl font-sans text-sm text-ink-muted">
          该模块由 SPRINT.md 对应子任务实现（P0-03 仅完成路由与权限骨架）。
        </p>
      </div>
    </div>

    <!-- 占位内容 -->
    <div
      class="flex flex-col items-center gap-4 rounded-xl border-2 border-dashed border-memphis-dark bg-card p-16"
    >
      <span class="material-symbols-outlined text-[56px] text-ink-muted">construction</span>
      <span class="font-sans text-sm text-ink-body">功能开发中，敬请期待</span>
    </div>
  </div>
</template>