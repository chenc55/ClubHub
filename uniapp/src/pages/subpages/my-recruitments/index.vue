<script>
/**
 * 我的招新状态页（学生端 / STU-06 / P1-17）
 *
 * 报名历史 + 岗位快照 + 状态标签（待审核 / 面试[含时间地点] / 已录取 / 已淘汰）+ 录取时间
 * 数据来源：GET /recruitment/my-status
 * 入口：个人中心「我的招新」
 */
import { getMyRecruitments } from '@/api/recruitment'
import { ERROR_CODE } from '@/utils/config'

const PAGE_SIZE = 20
const TABS = [
  { value: 'all', label: '全部' },
  { value: 'pending', label: '待审核' },
  { value: 'interview', label: '面试' },
  { value: 'accepted', label: '已录取' },
  { value: 'rejected', label: '已淘汰' },
]
const STATUS_META = {
  pending: { label: '待审核', cls: 'pending' },
  interview: { label: '面试', cls: 'warning' },
  accepted: { label: '已录取', cls: 'success' },
  rejected: { label: '已淘汰', cls: 'reject' },
}

export default {
  name: 'MyRecruitments',

  data: () => ({
    tabs: TABS,
    currentTab: 'all',
    loading: true,
    loadingMore: false,
    list: [],
    total: 0,
    page: 1,
    hasMore: false,
    error: '',
  }),

  computed: {
    isEmpty() {
      return !this.loading && !this.error && this.list.length === 0
    },
  },

  onShow() {
    this.load()
  },

  onReachBottom() {
    this.loadMore()
  },

  methods: {
    async load() {
      this.loading = true
      this.error = ''
      const res = await getMyRecruitments({ page: 1, page_size: PAGE_SIZE })
      this.loading = false
      if (res.code !== ERROR_CODE.SUCCESS) {
        this.error = res.message || '加载失败，请检查网络后重试'
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
      const res = await getMyRecruitments({ page: this.page + 1, page_size: PAGE_SIZE })
      this.loadingMore = false
      if (res.code !== ERROR_CODE.SUCCESS) {
        uni.showToast({ title: res.message || '加载更多失败，请稍后重试', icon: 'none' })
        return
      }
      this.list = this.list.concat((res.data && res.data.list) || [])
      this.page += 1
      this.hasMore = !!(res.data && res.data.has_more)
    },

    switchTab(value) {
      if (this.currentTab === value) return
      this.currentTab = value
    },

    statusMeta(status) {
      return STATUS_META[status] || { label: status, cls: 'muted' }
    },

    formatTime(value) {
      if (!value) return ''
      const raw = typeof value === 'object' && value.$date ? value.$date : value
      const date = new Date(raw)
      if (Number.isNaN(date.getTime())) return ''
      const pad = (n) => String(n).padStart(2, '0')
      const year = date.getFullYear() === new Date().getFullYear() ? '' : `${date.getFullYear()}-`
      return `${year}${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    },

    /** 态过滤后的展示列表 */
    visibleList() {
      if (this.currentTab === 'all') return this.list
      return this.list.filter((row) => row.status === this.currentTab)
    },
  },
}
</script>

<template>
  <view class="mrc-page">
    <!-- 状态 tab -->
    <scroll-view class="mrc-tabs" scroll-x :show-scrollbar="false">
      <view class="mrc-tabs__row">
        <view
          v-for="tab in tabs"
          :key="tab.value"
          class="mrc-tab"
          :class="{ 'mrc-tab--active': currentTab === tab.value }"
          @tap="switchTab(tab.value)"
        >
          {{ tab.label }}
        </view>
      </view>
    </scroll-view>

    <!-- 加载态 -->
    <view v-if="loading" class="mrc-card">
      <sb-skeleton :rows="4" />
    </view>

    <!-- 失败态 -->
    <view v-else-if="error" class="mrc-card">
      <sb-error :text="error" @retry="load" />
    </view>

    <!-- 空态 -->
    <view v-else-if="visibleList().length === 0" class="mrc-empty">
      <sb-illustration icon="eye" tone="warning" />
      <view class="mrc-empty__badge">该状态下暂无报名</view>
    </view>

    <!-- 列表 -->
    <template v-else>
      <view v-for="row in visibleList()" :key="row.registration_id" class="mrc-card">
        <view class="mrc-card__top">
          <text class="mrc-card__title">{{ row.recruitment_title || '未知岗位' }}</text>
          <view class="mrc-card__status" :class="`mrc-card__status--${statusMeta(row.status).cls}`">
            {{ statusMeta(row.status).label }}
          </view>
        </view>
        <text class="mrc-card__club">{{ row.club_name || '未知社团' }} · 报名于 {{ formatTime(row.applied_at) || '—' }}</text>

        <!-- 面试信息 -->
        <view v-if="row.status === 'interview' && row.interview" class="mrc-interview">
          面试时间：{{ formatTime(row.interview.time) }} · 地点：{{ row.interview.place || '待定' }}
        </view>

        <!-- 录取时间 -->
        <view v-else-if="row.status === 'accepted'" class="mrc-interview">
          已于 {{ formatTime(row.accept_at) }} 录取，请留意加团通知
        </view>
      </view>

      <!-- 分页状态 -->
      <view class="mrc-more">
        <text v-if="loadingMore" class="mrc-more__text">加载更多…</text>
        <text v-else-if="hasMore" class="mrc-more__text">上拉加载更多</text>
        <text v-else class="mrc-more__text">已加载全部 {{ total }} 条报名</text>
      </view>
    </template>
  </view>
</template>

<style lang="scss" scoped>
.mrc-page {
  min-height: 100vh;
  padding: 24rpx 32rpx 48rpx;
  background: $color-bg-canvas;
  box-sizing: border-box;
}

.mrc-tabs {
  white-space: nowrap;

  &__row {
    display: flex;
    gap: 12rpx;
  }

  .mrc-tab {
    display: inline-flex;
    padding: 10rpx 24rpx;
    border-radius: 999rpx;
    border: 3rpx solid $memphis-dark;
    background: $color-bg-card;
    font-size: $fs-body;
    color: $color-text-body;

    &--active {
      background: $color-primary;
      color: #ffffff;
    }
  }
}

.mrc-card {
  margin-top: 24rpx;
  padding: 28rpx 32rpx;
  border-radius: $radius-md;
  border: 4rpx solid $memphis-dark;
  background: $color-bg-card;
  box-shadow: $shadow-memphis-sm;

  &__top {
    display: flex;
    align-items: center;
    gap: 12rpx;
    flex-wrap: wrap;
  }

  &__title {
    font-size: $fs-h3;
    font-weight: 700;
    color: $color-text-title;
  }

  &__status {
    padding: 4rpx 14rpx;
    border-radius: 999rpx;
    border: 3rpx solid $memphis-dark;
    font-size: $fs-caption;
    background: $color-bg-canvas;

    &--pending {
      background: $color-info-light;
      color: $color-info-text;
    }

    &--warning {
      background: $color-warning-light;
    }

    &--success {
      background: $color-success-light;
    }

    &--reject {
      background: $color-danger-light;
      color: $color-danger;
    }
  }

  &__club {
    display: block;
    margin-top: 10rpx;
    font-size: $fs-caption;
    color: $color-text-muted;
  }
}

.mrc-interview {
  margin-top: 14rpx;
  padding: 12rpx 16rpx;
  border-radius: $radius-sm;
  background: $color-warning-light;
  font-size: $fs-caption;
  color: $color-warning;
}

.mrc-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20rpx;
  padding: 80rpx 0;

  &__badge {
    font-size: $fs-body;
    color: $color-text-muted;
  }
}

.mrc-more {
  padding: 24rpx 0;
  text-align: center;

  &__text {
    font-size: $fs-caption;
    color: $color-text-muted;
  }
}
</style>