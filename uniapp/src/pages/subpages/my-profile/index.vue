<script>
/**
 * 我的资料（STU-08 / P1-24）
 * 全字段只读：头像 / 昵称 / 姓名 / 学号（脱敏）/ 学院专业——取自登录态 userInfo（P1-03 认证后）
 * 学号前端脱敏展示（保留前 4 后 2），完整学号不出页面
 */
import { useUserStore } from '@/store/user'

export default {
  name: 'MyProfile',

  computed: {
    userStore() {
      return useUserStore()
    },
    info() {
      return this.userStore.userInfo || {}
    },
    nickname() {
      return this.info.nickname || this.info.name || '—'
    },
    name() {
      return this.info.name || this.info.nickname || '—'
    },
    maskedNo() {
      const raw = String(this.info.student_no || '')
      if (!raw) return '—'
      if (raw.length <= 6) return '*'.repeat(raw.length)
      return `${raw.slice(0, 4)}${'*'.repeat(raw.length - 6)}${raw.slice(-2)}`
    },
    fields() {
      return [
        { label: '昵称', value: this.nickname },
        { label: '姓名', value: this.name },
        { label: '学号', value: this.maskedNo },
        { label: '学院', value: this.info.college || '—' },
        { label: '专业', value: this.info.major || '—' },
      ]
    },
  },
}
</script>

<template>
  <view class="mp-page">
    <view class="mp-card">
      <view class="mp-avatar">
        <image v-if="info.avatar" class="mp-avatar__img" :src="info.avatar" mode="aspectFill" />
        <text v-else class="mp-avatar__text">{{ nickname.slice(0, 1) }}</text>
      </view>
    </view>

    <view class="mp-card">
      <view v-for="(f, index) in fields" :key="index" class="mp-field">
        <text class="mp-field__label">{{ f.label }}</text>
        <text class="mp-field__value">{{ f.value }}</text>
      </view>
      <text class="mp-note">以上信息仅用于校内社团服务，学号已脱敏展示，仅平台管理员可见完整学号。</text>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.mp-page {
  min-height: 100vh;
  padding: 24rpx 32rpx 48rpx;
  background: $color-bg-canvas;
  box-sizing: border-box;
}

.mp-card {
  margin-top: 24rpx;
  padding: 28rpx 32rpx;
  border-radius: $radius-md;
  border: 4rpx solid $memphis-dark;
  background: $color-bg-card;
  box-shadow: $shadow-memphis-sm;
}

.mp-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 128rpx;
  height: 128rpx;
  margin: 0 auto;
  border-radius: $radius-md;
  border: 4rpx solid $memphis-dark;
  background: $color-primary;
  overflow: hidden;

  &__img {
    width: 100%;
    height: 100%;
  }

  &__text {
    font-size: $fs-h1;
    font-weight: 700;
    color: #ffffff;
  }
}

.mp-field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24rpx;
  padding: 22rpx 0;
  border-bottom: 2rpx dashed $memphis-dark;

  &:last-of-type {
    border-bottom: none;
  }

  &__label {
    font-size: $fs-body;
    color: $color-text-muted;
  }

  &__value {
    font-size: $fs-body;
    font-weight: 600;
    color: $color-text-title;
  }
}

.mp-note {
  display: block;
  margin-top: 16rpx;
  font-size: $fs-caption;
  line-height: 1.6;
  color: $color-text-muted;
}
</style>