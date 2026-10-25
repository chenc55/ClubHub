<script setup>
/**
 * 管理端登录页（P0-09）
 * 账号 + 密码 + 图形验证码；失败展示剩余尝试次数 / 锁定剩余时间 / 禁用原因（需求 4.3.6）
 * 验证码一次性使用：任何登录失败后都刷新
 */
import { onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/store/auth'

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()

const form = reactive({ username: '', password: '', captchaCode: '' })
const captcha = reactive({ id: '', image: '' })
const errorMessage = ref('')
const submitting = ref(false)
const loadingCaptcha = ref(false)

async function refreshCaptcha() {
  loadingCaptcha.value = true
  form.captchaCode = ''
  const res = await auth.fetchCaptcha()
  loadingCaptcha.value = false
  if (res.code === 0 && res.data) {
    captcha.id = res.data.captcha_id
    captcha.image = res.data.image
  } else {
    captcha.id = ''
    captcha.image = ''
    errorMessage.value = res.message || '验证码加载失败，请点击图形验证码重试'
  }
}

async function submit() {
  if (submitting.value) return
  errorMessage.value = ''
  if (!form.username.trim()) {
    errorMessage.value = '请输入账号'
    return
  }
  if (!form.password) {
    errorMessage.value = '请输入密码'
    return
  }
  if (!form.captchaCode.trim()) {
    errorMessage.value = '请输入图形验证码'
    return
  }

  submitting.value = true
  const res = await auth.login({
    username: form.username.trim(),
    password: form.password,
    captchaId: captcha.id,
    captchaCode: form.captchaCode.trim(),
  })
  submitting.value = false

  if (res.code === 0) {
    router.replace(route.query.redirect || '/dashboard')
    return
  }
  errorMessage.value = res.message || '登录失败，请稍后重试'
  refreshCaptcha()
}

onMounted(() => {
  if (route.query.reason === 'expired') {
    errorMessage.value = '登录已过期，请重新登录'
  }
  refreshCaptcha()
})
</script>

<template>
  <div class="relative flex min-h-screen items-center justify-center overflow-hidden bg-canvas">
    <!-- 孟菲斯装饰几何 -->
    <div class="absolute -left-16 -top-16 h-64 w-64 rounded-full border-4 border-memphis-dark bg-memphis-yellow/60"></div>
    <div class="absolute -bottom-20 -right-10 h-72 w-72 rotate-45 border-4 border-memphis-dark bg-primary/20"></div>
    <div class="absolute right-24 top-16 h-8 w-8 rounded-full border-2 border-memphis-dark bg-danger"></div>
    <div class="absolute bottom-24 left-24 h-10 w-10 rounded-lg border-2 border-memphis-dark bg-memphis-green"></div>

    <div class="relative w-[460px] rounded-2xl border-2 border-memphis-dark bg-card p-10 shadow-memphis-lg">
      <!-- 品牌 -->
      <div class="flex items-center gap-3">
        <div
          class="flex h-12 w-12 items-center justify-center rounded-xl border-2 border-memphis-dark bg-primary shadow-memphis-sm"
        >
          <span class="material-symbols-outlined text-[26px] text-white">star</span>
        </div>
        <div class="flex flex-col">
          <span class="font-display text-xl font-bold text-memphis-dark">社团星球 · 管理中心</span>
          <span class="font-sans text-xs text-ink-muted">ClubHub Admin Console</span>
        </div>
      </div>

      <form class="mt-8 space-y-5" @submit.prevent="submit">
        <!-- 账号 -->
        <label class="block">
          <span class="font-sans text-xs font-bold text-memphis-dark">账号</span>
          <input
            v-model="form.username"
            type="text"
            autocomplete="username"
            placeholder="请输入管理员账号"
            class="mt-2 w-full rounded-xl border-2 border-memphis-dark bg-canvas px-4 py-3 font-sans text-sm text-ink-title outline-none focus:bg-card"
          />
        </label>

        <!-- 密码 -->
        <label class="block">
          <span class="font-sans text-xs font-bold text-memphis-dark">密码</span>
          <input
            v-model="form.password"
            type="password"
            autocomplete="current-password"
            placeholder="请输入密码"
            class="mt-2 w-full rounded-xl border-2 border-memphis-dark bg-canvas px-4 py-3 font-sans text-sm text-ink-title outline-none focus:bg-card"
          />
        </label>

        <!-- 图形验证码 -->
        <label class="block">
          <span class="font-sans text-xs font-bold text-memphis-dark">图形验证码</span>
          <div class="mt-2 flex items-center gap-3">
            <input
              v-model="form.captchaCode"
              type="text"
              maxlength="8"
              autocomplete="off"
              placeholder="输入右侧字符"
              class="w-full rounded-xl border-2 border-memphis-dark bg-canvas px-4 py-3 font-sans text-sm tracking-widest text-ink-title outline-none focus:bg-card"
            />
            <button
              type="button"
              class="m-pressable h-[46px] w-[132px] shrink-0 overflow-hidden rounded-xl border-2 border-memphis-dark bg-card"
              title="点击刷新验证码"
              @click="refreshCaptcha"
            >
              <img v-if="captcha.image" :src="captcha.image" alt="图形验证码" class="h-full w-full object-cover" />
              <span v-else class="font-sans text-xs text-ink-muted">{{ loadingCaptcha ? '加载中…' : '点击刷新' }}</span>
            </button>
          </div>
        </label>

        <!-- 错误提示 -->
        <p
          v-if="errorMessage"
          class="rounded-xl border-2 border-memphis-dark bg-danger/10 px-4 py-3 font-sans text-xs leading-relaxed text-danger"
        >
          {{ errorMessage }}
        </p>

        <button
          type="submit"
          :disabled="submitting"
          class="m-pressable w-full rounded-xl border-2 border-memphis-dark bg-primary py-3 font-sans text-sm font-bold text-white shadow-memphis-md disabled:opacity-60"
        >
          {{ submitting ? '登录中…' : '登录' }}
        </button>
      </form>

      <p class="mt-6 font-sans text-[11px] leading-relaxed text-ink-muted">
        连续失败 5 次将锁定 15 分钟；账号被禁用请联系超级管理员。
      </p>
    </div>
  </div>
</template>
