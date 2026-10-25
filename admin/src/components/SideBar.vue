<script setup>
/**
 * 侧边栏（240px，对照 design-assets/screen-admin-review）
 * 品牌区 + 分组导航（激活深蓝胶囊硬投影 + 红色计数徽章）+ 底部系统组
 * 菜单由路由表 meta.menu 生成（单一来源），按当前角色过滤
 */
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { menuRoutes } from '@/router'
import { useAuthStore } from '@/store/auth'
import { request } from '@/utils/request'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

/** P1-28：审核中心待办徽标 = 四类待审之和（社团审核入口在 /clubs，其余在 /review） */
const pendingTotal = ref(0)

onMounted(async () => {
  const res = await request({ path: '/dashboard/summary' })
  if (res.code === 0 && res.data && res.data.pending) {
    pendingTotal.value = Number(res.data.pending.total) || 0
  }
})

const groups = computed(() => {
  const visible = menuRoutes.filter((r) => r.meta.roles.includes(auth.role))
  return [
    { key: 'main', label: '主要功能', items: visible.filter((r) => r.meta.menu.group === 'main') },
    { key: 'system', label: '系统', items: visible.filter((r) => r.meta.menu.group === 'system') },
  ].filter((g) => g.items.length > 0)
})

function go(path) {
  router.push(`/${path}`)
}
</script>

<template>
  <aside
    class="fixed left-0 top-0 z-50 flex h-full w-60 flex-col justify-between border-r-2 border-memphis-dark bg-card shadow-[3px_0px_0px_#0F172A]"
  >
    <!-- 品牌区 -->
    <div>
      <div class="flex h-16 items-center gap-2 border-b-2 border-memphis-dark bg-canvas px-5">
        <div
          class="flex h-8 w-8 items-center justify-center rounded-lg border-2 border-memphis-dark bg-primary shadow-memphis-sm"
        >
          <span class="material-symbols-outlined text-[18px] text-white">star</span>
        </div>
        <div class="flex flex-col overflow-hidden">
          <span class="truncate font-sans text-base font-bold text-memphis-dark">社团星球</span>
          <span class="font-sans text-[10px] uppercase tracking-wider text-ink-muted">ClubHub 管理中心</span>
        </div>
      </div>

      <!-- 分组导航 -->
      <div v-for="g in groups" :key="g.key" class="px-4 pt-5">
        <span class="px-1 font-sans text-[11px] font-bold uppercase tracking-wider text-ink-muted">
          {{ g.label }}
        </span>
        <nav class="mt-2 space-y-2 pb-2">
          <a
            v-for="item in g.items"
            :key="item.path"
            class="group flex items-center justify-between rounded-xl border-2 border-transparent px-4 py-2.5 transition-all hover:bg-primary-light hover:text-primary"
            :class="{
              'border-memphis-dark bg-primary-light !text-primary shadow-memphis-sm font-bold': route.path === `/${item.path}`,
              'text-ink-body': route.path !== `/${item.path}`,
            }"
            @click="go(item.path)"
          >
            <div class="flex items-center gap-3">
              <span
                class="material-symbols-outlined text-[20px] transition-transform group-hover:scale-110"
                >{{ item.meta.menu.icon }}</span
              >
              <span class="font-sans text-sm font-medium">{{ item.meta.menu.label }}</span>
            </div>
            <span
              v-if="item.path === 'review' && pendingTotal > 0"
              class="rounded-full border border-memphis-dark bg-danger px-2 py-0.5 text-[11px] font-bold text-white"
              >{{ pendingTotal }}</span
            >
            <span
              v-else-if="item.path !== 'review' && item.meta.menu.badge"
              class="rounded-full border border-memphis-dark bg-danger px-2 py-0.5 text-[11px] font-bold text-white"
              >{{ item.meta.menu.badge }}</span
            >
          </a>
        </nav>
      </div>
    </div>

    <!-- 底部系统区 -->
    <div class="border-t-2 border-memphis-dark bg-canvas p-3">
      <a
        class="flex items-center gap-3 rounded-xl px-4 py-2 text-ink-body transition-all hover:bg-primary-light hover:text-primary"
      >
        <span class="material-symbols-outlined text-[18px]">exit_to_app</span>
        <span class="font-sans text-sm">返回学生端</span>
        <span class="material-symbols-outlined ml-auto text-[14px]">north_east</span>
      </a>
    </div>
  </aside>
</template>