<script>
/**
 * 我的 Tab（STU-08 / P1-24 个人中心）
 *
 * 内容：未登录 → 「登录 / 认证」引导卡；已登录 → 头像 / 昵称 / 认证徽标卡
 *       + 入口列表（我的资料 / 我的活动 / 我的社团 / 我的报名 / 设置与帮助）
 * 隐私合规：首次进入弹出隐私政策同意弹窗（8.4），未同意仅游客浏览（登录入口由弹窗拦截）
 */
import { useUserStore } from '@/store/user'

const ENTRIES = [
  { key: 'profile', mark: '资', tone: 'blue', label: '我的资料', desc: '姓名 / 学号 / 学院专业', page: '/pages/subpages/my-profile/index' },
  { key: 'activities', mark: '活', tone: 'success', label: '我的活动', desc: '报名与签到记录', page: '/pages/subpages/my-activities/index' },
  { key: 'memberships', mark: '社', tone: 'primary', label: '我的社团', desc: '已加入的社团', page: '/pages/subpages/my-clubs/index' },
  { key: 'registrations', mark: '报', tone: 'warning', label: '我的报名', desc: '活动 / 招新报名记录', page: '/pages/subpages/my-registrations/index' },
  { key: 'settings', mark: '设', tone: 'gray', label: '设置与帮助', desc: '换绑申诉 / 协议 / 退出登录', page: '/pages/subpages/settings/index' },
]

export default {
  name: 'Profile',

  data: () => ({
    entries: ENTRIES,
  }),

  computed: {
    userStore() {
      return useUserStore()
    },
    isGuest() {
      return this.userStore.isGuest
    },
    nickname() {
      return (this.userStore.userInfo && (this.userStore.userInfo.nickname || this.userStore.userInfo.name)) || '星球同学'
    },
    verifiedText() {
      const auth = this.userStore.userInfo && this.userStore.userInfo.auth_status
      return auth === 'verified' ? '已认证' : '未认证'
    },
  },

  onShow() {
    this.refreshProfile()
  },

  methods: {
    /** 刷新登录态（进入本页时若本地已有 token 则已由 store.restore 持有） */
    refreshProfile() {
      const store = this.userStore
      if (store.hasSession) store.restore()
    },

    goLogin() {
      uni.navigateTo({ url: '/pages/subpages/login/index?reason=need_auth' })
    },

    onEntry(entry) {
      uni.navigateTo({ url: entry.page })
    },
  },
}
</script>

<template>
  <view class="pf-page">
    <!-- 未登录：登录/认证引导 -->
    <view v-if="isGuest" class="pf-card pf-card--login">
      <text class="pf-card__title">登录 / 学号认证</text>
      <text class="pf-card__desc">登录并完成学号认证后，可报名活动、加入社团、管理你的社团。</text>
      <view class="pf-card__cta" @tap="goLogin">
        <sb-button type="primary" block text="去登录 / 认证" />
      </view>
    </view>

    <!-- 已登录：头像 / 昵称卡 -->
    <view v-else class="pf-card pf-card--user">
      <view class="pf-avatar">
        <image v-if="userStore.userInfo && userStore.userInfo.avatar" class="pf-avatar__img" :src="userStore.userInfo.avatar" mode="aspectFill" />
        <text v-else class="pf-avatar__text">{{ nickname.slice(0, 1) }}</text>
      </view>
      <view class="pf-card__main">
        <text class="pf-card__name">{{ nickname }}</text>
        <view class="pf-badge" :class="{ 'pf-badge--ok': verifiedText === '已认证' }">{{ verifiedText }}</view>
      </view>
    </view>

    <!-- 入口列表 -->
    <view class="pf-card">
      <view v-for="entry in entries" :key="entry.key" class="pf-entry" @tap="onEntry(entry)">
        <view class="pf-entry__mark" :class="`pf-entry__mark--${entry.tone}`">{{ entry.mark }}</view>
        <view class="pf-entry__main">
          <text class="pf-entry__label">{{ entry.label }}</text>
          <text class="pf-entry__desc">{{ entry.desc }}</text>
        </view>
        <text class="pf-entry__arrow">›</text>
      </view>
    </view>

    <!-- 隐私合规弹窗（仅首次） -->
    <sb-privacy-popup ref="privacy" />
  </view>
</template>

<style lang="scss" scoped>
.pf-page {
  min-height: 100vh;
  padding: 24rpx 32rpx 48rpx;
  background: $color-bg-canvas;
  box-sizing: border-box;
}

.pf-card {
  margin-top: 24rpx;
  padding: 28rpx 32rpx;
  border-radius: $radius-md;
  border: 4rpx solid $memphis-dark;
  background: $color-bg-card;
  box-shadow: $shadow-memphis-sm;

  &--login,
  &--user {
    display: flex;
    flex-direction: column;
    gap: 16rpx;
  }

  &--user {
    flex-direction: row;
    align-items: center;
    gap: 20rpx;
  }

  &__title {
    font-size: $fs-h2;
    font-weight: 700;
    color: $color-text-title;
  }

  &__desc {
    font-size: $fs-body;
    line-height: 1.6;
    color: $color-text-muted;
  }

  &__cta {
    margin-top: 8rpx;
  }

  &__main {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 10rpx;
  }

  &__name {
    font-size: $fs-h2;
    font-weight: 700;
    color: $color-text-title;
  }
}

.pf-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 108rpx;
  height: 108rpx;
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

.pf-badge {
  align-self: flex-start;
  padding: 4rpx 18rpx;
  border-radius: 999rpx;
  border: 3rpx solid $memphis-dark;
  background: $color-warning;
  color: $memphis-dark;
  font-size: $fs-caption;
  font-weight: 700;

  &--ok {
    background: $color-success;
  }
}

.pf-entry {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 22rpx 0;
  border-bottom: 2rpx dashed $memphis-dark;

  &:last-child {
    border-bottom: none;
  }

  &__mark {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 60rpx;
    height: 60rpx;
    border-radius: $radius-sm;
    border: 3rpx solid $memphis-dark;
    font-size: $fs-caption;
    font-weight: 700;
    color: #ffffff;

    &--blue {
      background: $color-info;
    }

    &--success {
      background: $color-success;
    }

    &--primary {
      background: $color-primary;
    }

    &--warning {
      background: $color-warning;
      color: $memphis-dark;
    }

    &--gray {
      background: $color-text-muted;
    }
  }

  &__main {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 4rpx;
  }

  &__label {
    font-size: $fs-h3;
    font-weight: 700;
    color: $color-text-title;
  }

  &__desc {
    font-size: $fs-caption;
    color: $color-text-muted;
  }

  &__arrow {
    font-size: $fs-h3;
    color: $color-text-muted;
  }
}
</style>