<script setup>
/**
 * 用户与白名单（ADM-01）
 * P1-01 花名册导入 + P1-02 用户查询与账号管理（禁用 / 解封 / 绑定状态）
 */
import UserList from '@/components/UserList.vue'
import WhitelistImport from '@/components/WhitelistImport.vue'
</script>

<template>
  <div class="flex flex-col gap-6 p-6">
    <!-- 页面标题 Banner -->
    <div
      class="flex flex-col justify-between gap-4 rounded-xl border-2 border-memphis-dark bg-card p-6 shadow-memphis-md lg:flex-row lg:items-center"
    >
      <div class="space-y-2">
        <h1 class="font-display text-2xl font-bold tracking-tight text-memphis-dark">用户与白名单</h1>
        <p class="max-w-3xl font-sans text-sm text-ink-muted">
          按姓名 / 学号查询用户、查看微信与学号绑定状态、禁用或解封账号（禁用后学生端仅可浏览）；
          导入花名册作为学号认证（P1-03）的比对数据源，导入按批次记录 <span class="font-mono">batch_no</span> 并给出校验回执。
        </p>
      </div>
    </div>

    <UserList />

    <WhitelistImport />
  </div>
</template>
