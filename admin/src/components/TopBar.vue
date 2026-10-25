<script setup>
/**
 * 顶栏（对照 design-assets/screen-admin-review）
 * 面包屑 + 学期胶囊 + 全局搜索 + 通知铃 + 头像角色下拉
 */
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/store/auth'
import { SEMESTER } from '@/config/semester'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

const keyword = ref('')
const pageTitle = computed(() => route.meta.title || '工作台')

function onCommand(cmd) {
  if (cmd === 'logout') {
    auth.logout()
    router.push('/login')
  }
}
</script>

<template>
  <header
    class="fixed left-60 right-0 top-0 z-40 flex h-16 items-center justify-between border-b-2 border-memphis-dark bg-card px-6 shadow-[0px_3px_0px_#0F172A]"
  >
    <!-- 左：面包屑 + 学期胶囊 -->
    <div class="flex items-center gap-6">
      <div class="flex items-center gap-1 font-sans text-xs text-ink-muted">
        <span class="cursor-pointer hover:text-primary" @click="router.push('/dashboard')">管理中心</span>
        <span class="material-symbols-outlined text-[14px]">chevron_right</span>
        <span class="text-xs font-bold text-ink-title">{{ pageTitle }}</span>
      </div>
      <div
        class="hidden items-center gap-2 rounded-full border-2 border-memphis-dark bg-warning-light px-3 py-1 shadow-memphis-sm xl:flex"
      >
        <span class="material-symbols-outlined text-[16px] text-memphis-dark">calendar_month</span>
        <span class="font-sans text-xs font-bold text-memphis-dark">{{ SEMESTER.label }}</span>
      </div>
    </div>

    <!-- 右：搜索 + 通知 + 用户 -->
    <div class="flex items-center gap-4">
      <div class="relative hidden md:block">
        <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-ink-muted"
          >search</span
        >
        <input
          v-model="keyword"
          class="w-60 rounded-full border-2 border-memphis-dark bg-canvas py-1.5 pl-9 pr-4 font-sans text-xs text-ink-title shadow-memphis-sm transition-all placeholder:text-ink-muted focus:w-72 focus:outline-none"
          placeholder="搜索社团、学号或活动..."
          type="text"
        />
      </div>

      <button
        class="relative flex h-10 w-10 items-center justify-center rounded-xl border-2 border-memphis-dark bg-card shadow-memphis-sm transition-all hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-memphis-xs"
        title="通知"
      >
        <span class="material-symbols-outlined text-[20px] text-ink-title">notifications</span>
        <span class="absolute -right-1 -top-1 h-3 w-3 rounded-full border border-memphis-dark bg-danger"></span>
      </button>

      <el-dropdown trigger="click" @command="onCommand">
        <div class="flex cursor-pointer items-center gap-2 border-l-2 border-ink-line pl-4">
          <div
            class="flex h-8 w-8 items-center justify-center rounded-full border-2 border-memphis-dark bg-primary shadow-memphis-xs"
          >
            <span class="material-symbols-outlined text-[18px] text-white">person</span>
          </div>
          <div class="flex flex-col text-left">
            <span class="font-sans text-xs font-bold leading-tight text-memphis-dark">{{ auth.name }}</span>
            <span class="font-sans text-[11px] leading-tight text-ink-muted">{{ auth.roleLabel }}</span>
          </div>
          <span class="material-symbols-outlined text-[18px] text-ink-muted">arrow_drop_down</span>
        </div>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="logout">
              <span class="material-symbols-outlined mr-1 align-middle text-[16px]">logout</span>
              退出登录
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>
  </header>
</template>