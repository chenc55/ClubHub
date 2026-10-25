<script setup>
/**
 * 管理端布局骨架：左 240px 侧边栏 + 顶栏 + 内容区（P0-03）
 */
import SideBar from '@/components/SideBar.vue'
import TopBar from '@/components/TopBar.vue'
</script>

<template>
  <div class="min-h-screen bg-canvas font-sans text-ink-title antialiased">
    <SideBar />
    <div class="pl-60">
      <TopBar />
      <main class="min-h-screen w-full pt-16">
        <router-view />
      </main>
    </div>
  </div>
</template>