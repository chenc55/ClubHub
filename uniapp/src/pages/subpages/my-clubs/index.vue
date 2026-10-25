<script>
/**
 * 我的社团（STU-08 / P1-24）
 * 已加入社团列表（Logo/名称/我的角色/入团时间）→ 点击跳社团详情；
 * 空态引导「去看看招新」；未登录引导登录/认证。
 * 数据来源：GET /club/memberships（全部 active 成员关系含 member；被移除后同步消失）
 */
import { getMyMemberships } from '@/api/club'
import { useUserStore } from '@/store/user'
import { ERROR_CODE } from '@/utils/config'

const ROLE_LABEL = { president: '社长', officer: '干部', member: '成员' }
const ROLE_CLS = { president: 'president', officer: 'officer', member: 'member' }

export default {
  name: 'MyClubs',

  data: () => ({
    loading: true,
    error: '',
    list: [],
  }),

  computed: {
    userStore() {
      return useUserStore()
    },
    isVerified() {
      return this.userStore.isAuthenticated
    },
    isEmpty() {
      return !this.loading && !this.error && this.list.length === 0
    },
  },

  onShow() {
    if (this.isVerified) this.load()
  },

  methods: {
    async load() {
      this.loading = true
      this.error = ''
      const res = await getMyMemberships()
      this.loading = false
      if (res.code !== ERROR_CODE.SUCCESS) {
        this.error = res.message || '社团列表加载失败，请检查网络后重试'
        this.list = []
        return
      }
      this.list = (res.data && res.data.list) || []
    },

    goClub(id) {
      uni.navigateTo({ url: `/pages/subpages/club-detail/index?id=${id}` })
    },

    goRecruitments() {
      uni.navigateTo({ url: '/pages/subpages/recruitment/index' })
    },

    goLogin() {
      uni.navigateTo({ url: '/pages/subpages/login/index?reason=need_auth' })
    },

    roleLabel(role) {
      return ROLE_LABEL[role] || '成员'
    },

    roleCls(role) {
      return ROLE_CLS[role] || 'member'
    },

    formatTime(value) {
      if (!value) return ''
      const raw = typeof value === 'object' && value.$date ? value.$date : value
      const date = new Date(raw)
      if (Number.isNaN(date.getTime())) return ''
      const pad = (n) => String(n).padStart(2, '0')
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    },
  },
}
</script>

<template>
  <view class="mc-page">
    <!-- 未认证引导 -->
    <view v-if="!isVerified" class="mc-card">
      <text class="mc-card__title">我的社团</text>
      <text class="mc-card__desc">查看已加入的社团需先完成学号认证。</text>
      <view class="mc-card__cta" @tap="goLogin">
        <sb-button type="primary" block text="去登录 / 认证" />
      </view>
    </view>

    <template v-else>
      <!-- 加载态 -->
      <view v-if="loading" class="mc-card">
        <sb-skeleton :rows="4" />
      </view>

      <!-- 失败态 -->
      <view v-else-if="error" class="mc-card">
        <sb-error :text="error" @retry="load" />
      </view>

      <!-- 空态：去看看招新 -->
      <view v-else-if="isEmpty" class="mc-empty">
        <sb-illustration icon="eye" tone="warning" />
        <view class="mc-empty__badge">还没有加入任何社团</view>
        <text class="mc-empty__note">去招新广场看看有没有感兴趣的社团吧</text>
        <view class="mc-empty__cta" @tap="goRecruitments">
          <sb-button type="primary" size="sm" text="去看看招新" />
        </view>
      </view>

      <!-- 社团列表 -->
      <template v-else>
        <view v-for="item in list" :key="item.club_id" class="mc-item" @tap="goClub(item.club_id)">
          <view class="mc-item__logo">
            <image v-if="item.club.logo" class="mc-item__logo-img" :src="item.club.logo" mode="aspectFill" />
            <text v-else class="mc-item__logo-text">{{ (item.club.name || '?').slice(0, 1) }}</text>
          </view>
          <view class="mc-item__main">
            <view class="mc-item__top">
              <text class="mc-item__name">{{ item.club.name }}</text>
              <view class="mc-role" :class="`mc-role--${roleCls(item.role)}`">{{ roleLabel(item.role) }}</view>
            </view>
            <text class="mc-item__meta">入团于 {{ formatTime(item.joined_at) || '—' }}</text>
            <view v-if="item.club.category_name || item.club.star_level" class="mc-item__pills">
              <text v-if="item.club.category_name" class="mc-pill">{{ item.club.category_name }}</text>
              <text v-if="item.club.star_level" class="mc-star">{{ '★'.repeat(Math.min(5, item.club.star_level)) }}</text>
            </view>
          </view>
          <text class="mc-item__arrow">›</text>
        </view>
      </template>
    </template>
  </view>
</template>

<style lang="scss" scoped>
.mc-page {
  min-height: 100vh;
  padding: 24rpx 32rpx 48rpx;
  background: $color-bg-canvas;
  box-sizing: border-box;
}

.mc-card {
  margin-top: 24rpx;
  padding: 28rpx 32rpx;
  border-radius: $radius-md;
  border: 4rpx solid $memphis-dark;
  background: $color-bg-card;
  box-shadow: $shadow-memphis-sm;

  &__title {
    display: block;
    font-size: $fs-h2;
    font-weight: 700;
    color: $color-text-title;
  }

  &__desc {
    display: block;
    margin-top: 12rpx;
    font-size: $fs-body;
    color: $color-text-muted;
  }

  &__cta {
    margin-top: 20rpx;
  }
}

.mc-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20rpx;
  padding: 100rpx 0;

  &__badge {
    font-size: $fs-h3;
    font-weight: 700;
    color: $color-text-title;
  }

  &__note {
    font-size: $fs-body;
    color: $color-text-muted;
  }

  &__cta {
    margin-top: 12rpx;
  }
}

.mc-item {
  display: flex;
  align-items: center;
  gap: 16rpx;
  margin-top: 24rpx;
  padding: 28rpx 32rpx;
  border-radius: $radius-md;
  border: 4rpx solid $memphis-dark;
  background: $color-bg-card;
  box-shadow: $shadow-memphis-sm;

  &__logo {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 84rpx;
    height: 84rpx;
    border-radius: $radius-sm;
    border: 3rpx solid $memphis-dark;
    background: $color-bg-canvas;
    overflow: hidden;

    &-img {
      width: 100%;
      height: 100%;
    }

    &-text {
      font-size: $fs-h3;
      font-weight: 700;
      color: $color-text-muted;
    }
  }

  &__main {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 8rpx;
  }

  &__top {
    display: flex;
    align-items: center;
    gap: 12rpx;
  }

  &__name {
    font-size: $fs-h3;
    font-weight: 700;
    color: $color-text-title;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__meta {
    font-size: $fs-caption;
    color: $color-text-muted;
  }

  &__pills {
    display: flex;
    align-items: center;
    gap: 10rpx;
  }

  &__arrow {
    font-size: $fs-h3;
    color: $color-text-muted;
  }
}

.mc-role {
  padding: 2rpx 14rpx;
  border-radius: 999rpx;
  border: 2rpx solid $memphis-dark;
  font-size: $fs-caption;
  font-weight: 700;

  &--president {
    background: $color-primary;
    color: #ffffff;
  }

  &--officer {
    background: $color-warning;
    color: $memphis-dark;
  }

  &--member {
    background: $color-bg-canvas;
    color: $color-text-body;
  }
}

.mc-pill {
  padding: 2rpx 12rpx;
  border-radius: 999rpx;
  border: 2rpx solid $memphis-dark;
  background: $color-bg-canvas;
  font-size: $fs-caption;
  color: $color-text-muted;
}

.mc-star {
  font-size: $fs-caption;
  color: $color-warning;
}
</style>