<script setup>
/**
 * 403 无权限页（P0-03）
 * 角色不符被守卫拦截时跳转至此
 */
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/store/auth'

const auth = useAuthStore()
const router = useRouter()
</script>

<template>
  <div class="flex min-h-screen flex-col items-center justify-center bg-canvas">
    <div
      class="relative h-24 w-24 rounded-full border-4 border-memphis-dark bg-danger-light shadow-memphis-md"
      style="background-image: radial-gradient(circle, rgba(15, 23, 42, 0.14) 2px, transparent 2.5px); background-size: 14px 14px"
    >
      <span
        class="material-symbols-outlined absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[44px] text-memphis-dark"
        >gpp_bad</span
      >
    </div>
    <h1 class="mt-8 font-display text-3xl font-bold text-memphis-dark">403 · 无权限访问</h1>
    <p class="mt-2 font-sans text-sm text-ink-muted">
      当前角色「{{ auth.roleLabel }}」无权访问该模块（权限矩阵见需求 2.3）
    </p>
    <button
      class="m-pressable mt-8 rounded-xl border-2 border-memphis-dark bg-primary px-8 py-3 font-sans text-sm font-bold text-white shadow-memphis-md"
      @click="router.push('/dashboard')"
    >
      返回工作台
    </button>
  </div>
</template>