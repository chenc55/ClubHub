<script>
/**
 * 我的活动（STU-08 / P1-24）
 * 我报名的活动：活动快照 + 报名状态 + 签到结果（已签到 / 未签到）
 * 数据来源：GET /activity/my-registrations（P1-13；list 含 checked_in）
 */
import { getMyRegistrations } from '@/api/activity'
import { useUserStore } from '@/store/user'
import { ERROR_CODE } from '@/utils/config'

const PAGE_SIZE = 20
const REG_STATUS_META = {
  pending: { label: '待审核', cls: 'pending' },
  approved: { label: '已报名', cls: 'success' },
  waitlist: { label: '候补中', cls: 'warning' },
  rejected: { label: '已驳回', cls: 'rejected' },
  cancelled: { label: '已取消', cls: 'muted' },
}

export default {
  name: 'MyActivities',

  data: () => ({
    loading: true,
    loadingMore: false,
    list: [],
    total: 0,
    page: 1,
    hasMore: false,
    error: '',
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

  onReachBottom() {
    this.loadMore()
  },

  methods: {
    regMeta(status) {
      return REG_STATUS_META[status] || { label: status, cls: 'muted' }
    },

    async load() {
      this.loading = true
      this.error = ''
      const res = await getMyRegistrations({ page: 1, page_size: PAGE_SIZE })
      this.loading = false
      if (res.code !== ERROR_CODE.SUCCESS) {
        this.error = res.message || '记录加载失败，请检查网络后重试'
        this.list = []
        this.total = 0
        this.hasMore = false
        return
      }
      this.list = (res.data && res.data.list) || []
      this.total = (res.data && res.data.total) || 0
      this.hasMore = !!(res.data && res.data.has_more)
      this.page = 1
    },

    async loadMore() {
      if (this.loading || this.loadingMore || !this.hasMore || this.error) return
      this.loadingMore = true
      const res = await getMyRegistrations({ page: this.page + 1, page_size: PAGE_SIZE })
      this.loadingMore = false
      if (res.code !== ERROR_CODE.SUCCESS) return
      this.list = this.list.concat((res.data && res.data.list) || [])
      this.page += 1
      this.hasMore = !!(res.data && res.data.has_more)
    },

    goActivity(id) {
      uni.navigateTo({ url: `/pages/subpages/activity-detail/index?id=${id}` })
    },

    goLogin() {
      uni.navigateTo({ url: '/pages/subpages/login/index?reason=need_auth' })
    },

    formatTime(value) {
      if (!value) return ''
      const raw = typeof value === 'object' && value.$date ? value.$date : value
      const date = new Date(raw)
      if (Number.isNaN(date.getTime())) return ''
      const pad = (n) => String(n).padStart(2, '0')
      return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    },
  },
}
</script>

<template>
  <view class="ma-page">
    <!-- 未认证引导 -->
    <view v-if="!isVerified" class="ma-card">
      <text class="ma-card__title">我的活动</text>
      <text class="ma-card__desc">查看报名与签到记录需先完成学号认证。</text>
      <view class="ma-card__cta" @tap="goLogin">
        <sb-button type="primary" block text="去登录 / 认证" />
      </view>
    </view>

    <template v-else>
      <view v-if="loading" class="ma-card">
        <sb-skeleton :rows="4" />
      </view>

      <view v-else-if="error" class="ma-card">
        <sb-error :text="error" @retry="load" />
      </view>

      <view v-else-if="isEmpty" class="ma-empty">
        <sb-illustration icon="eye" tone="warning" />
        <view class="ma-empty__badge">还没有报名过活动</view>
      </view>

      <template v-else>
        <view v-for="item in list" :key="item._id" class="ma-card" @tap="goActivity(item.activity_id)">
          <view class="ma-row">
            <view class="ma-row__main">
              <view class="ma-row__top">
                <text class="ma-row__title">{{ item.title || '活动' }}</text>
                <view class="ma-row__status" :class="`ma-row__status--${regMeta(item.status).cls}`">
                  {{ regMeta(item.status).label }}
                </view>
              </view>
              <text class="ma-row__meta">报名于 {{ formatTime(item.signup_at) || '—' }}</text>
              <template v-if="item.status === 'approved'">
                <view class="ma-checkin" :class="{ 'ma-checkin--ok': item.checked_in }">
                  {{ item.checked_in ? '已签到' : '未签到' }}
                </view>
              </template>
            </view>
          </view>
        </view>
        <view class="ma-more">
          <text class="ma-more__text">{{ hasMore ? '上拉加载更多' : `已加载全部 ${total} 个活动` }}</text>
        </view>
      </template>
    </template>
  </view>
</template>

<style lang="scss" scoped>
.ma-page {
  min-height: 100vh;
  padding: 24rpx 32rpx 48rpx;
  background: $color-bg-canvas;
  box-sizing: border-box;
}

.ma-card {
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

.ma-row {
  &__main {
    display: flex;
    flex-direction: column;
    gap: 10rpx;
  }

  &__top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16rpx;
  }

  &__title {
    flex: 1;
    font-size: $fs-h3;
    font-weight: 700;
    color: $color-text-title;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__status {
    flex-shrink: 0;
    padding: 4rpx 16rpx;
    border-radius: 999rpx;
    border: 3rpx solid $memphis-dark;
    font-size: $fs-caption;
    background: $color-bg-canvas;

    &--pending {
      background: $color-info-light;
      color: $color-info-text;
    }

    &--success {
      background: $color-success-light;
    }

    &--warning {
      background: $color-warning-light;
    }

    &--rejected {
      background: $color-danger-light;
      color: $color-danger;
    }

    &--muted {
      opacity: 0.6;
    }
  }

  &__meta {
    font-size: $fs-caption;
    color: $color-text-muted;
  }
}

.ma-checkin {
  align-self: flex-start;
  padding: 4rpx 18rpx;
  border-radius: 999rpx;
  border: 3rpx solid $memphis-dark;
  background: $color-bg-canvas;
  font-size: $fs-caption;
  color: $color-text-muted;

  &--ok {
    background: $color-success;
    color: $memphis-dark;
    font-weight: 700;
  }
}

.ma-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20rpx;
  padding: 100rpx 0;

  &__badge {
    font-size: $fs-body;
    color: $color-text-muted;
  }
}

.ma-more {
  padding: 24rpx 0;
  text-align: center;

  &__text {
    font-size: $fs-caption;
    color: $color-text-muted;
  }
}
</style>