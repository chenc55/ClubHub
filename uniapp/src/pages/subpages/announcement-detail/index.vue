<script setup>
/**
 * 公告详情（P2-02 / ADM-06）
 * 入口：首页 Banner 轮播（home 页 goBanner）/ 消息中心公告通知（biz_type=announcement）
 * 数据：GET /announcement/detail（公开，游客可看；仅 published 可见，下架 / 不存在返回 404）
 */
import { ref } from 'vue'
import { onLoad } from '@dcloudio/uni-app'
import { getAnnouncementDetail } from '@/api/announcement'

const detail = ref(null)
const loading = ref(true)
const errorMessage = ref('')

onLoad((options) => {
  const id = (options && options.id) || ''
  load(id)
})

async function load(id) {
  loading.value = true
  errorMessage.value = ''
  const res = await getAnnouncementDetail(id)
  loading.value = false
  if (res.code !== 0 || !res.data) {
    errorMessage.value = res.message || '公告加载失败，请稍后重试'
    return
  }
  detail.value = res.data
}

function formatTime(value) {
  if (!value) return ''
  const raw = value && typeof value === 'object' && value.$date ? value.$date : value
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function goBack() {
  const pages = getCurrentPages()
  if (pages.length > 1) uni.navigateBack()
  else uni.switchTab({ url: '/pages/home/index' })
}
</script>

<template>
  <view class="ad-page">
    <!-- 加载态 -->
    <view v-if="loading" class="ad-card">
      <view class="ad-card__banner-skeleton"></view>
      <view class="ad-card__line-skeleton ad-card__line-skeleton--wide"></view>
      <view class="ad-card__line-skeleton"></view>
      <view class="ad-card__line-skeleton"></view>
    </view>

    <!-- 错误 / 已下架 -->
    <view v-else-if="errorMessage" class="ad-card ad-card--empty">
      <view class="ad-empty">
        <text class="ad-empty__icon">📢</text>
        <text class="ad-empty__text">{{ errorMessage }}</text>
        <text class="ad-empty__hint">公告可能已下架或不存在</text>
        <button class="ad-empty__btn" @click="goBack">返回</button>
      </view>
    </view>

    <!-- 正文 -->
    <view v-else-if="detail" class="ad-card">
      <image v-if="detail.banner" class="ad-card__banner" :src="detail.banner" mode="aspectFill" />
      <text class="ad-card__title">{{ detail.title }}</text>
      <text class="ad-card__meta">发布于 {{ formatTime(detail.published_at) }}</text>
      <text class="ad-card__content">{{ detail.content }}</text>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.ad-page {
  min-height: 100vh;
  padding: 24rpx 32rpx 48rpx;
  background: $color-bg-canvas;
  box-sizing: border-box;
}

.ad-card {
  margin-top: 24rpx;
  padding: 32rpx;
  border-radius: $radius-md;
  border: 4rpx solid $memphis-dark;
  background: $color-bg-card;
  box-shadow: $shadow-memphis-sm;

  &__banner {
    display: block;
    width: 100%;
    height: 340rpx;
    border-radius: $radius-sm;
    border: 4rpx solid $memphis-dark;
    background: $color-bg-canvas;
  }

  &__title {
    display: block;
    margin-top: 28rpx;
    font-size: $fs-h1;
    font-weight: 700;
    line-height: 1.4;
    color: $color-text-title;
  }

  &__meta {
    display: block;
    margin-top: 12rpx;
    font-size: $fs-caption;
    color: $color-text-muted;
  }

  &__content {
    display: block;
    margin-top: 28rpx;
    font-size: $fs-body;
    line-height: 1.8;
    color: $color-text-body;
    white-space: pre-wrap;
  }

  &--empty {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 60vh;
  }

  &__banner-skeleton {
    width: 100%;
    height: 340rpx;
    border-radius: $radius-sm;
    background: $color-border-light;
  }

  &__line-skeleton {
    height: 28rpx;
    margin-top: 24rpx;
    border-radius: $radius-full;
    background: $color-border-light;

    &--wide {
      width: 60%;
      height: 44rpx;
    }
  }
}

.ad-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16rpx;

  &__icon {
    font-size: 72rpx;
  }

  &__text {
    font-size: $fs-h3;
    font-weight: 700;
    color: $color-text-title;
  }

  &__hint {
    font-size: $fs-caption;
    color: $color-text-muted;
  }

  &__btn {
    margin-top: 12rpx;
    padding: 0 48rpx;
    height: 72rpx;
    line-height: 72rpx;
    border-radius: $radius-md;
    border: 4rpx solid $memphis-dark;
    background: $color-primary;
    color: #ffffff;
    font-size: $fs-body;
    font-weight: 700;
    box-shadow: $shadow-memphis-sm;
  }
}
</style>
