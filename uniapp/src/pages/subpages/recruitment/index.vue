<script>
/**
 * 招新聚合页（学生端 / STU-06 / P1-17）
 *
 * 在招岗位列表（open）：标题 / 社团名 / 报名截止（含已截止标签）/ 剩余名额（已满标签）/ 多步标记
 * 数据来源：GET /recruitment/list（公开）
 * 入口：底部 Tab「招新」/ 首页 / 社团详情
 */
import { getRecruitmentList } from '@/api/recruitment'
import { ERROR_CODE } from '@/utils/config'

const PAGE_SIZE = 20

export default {
  name: 'RecruitmentList',

  data: () => ({
    clubId: '',
    loading: true,
    loadingMore: false,
    list: [],
    total: 0,
    page: 1,
    hasMore: false,
    error: '',
    keyword: '',
  }),

  computed: {
    isEmpty() {
      return !this.loading && !this.error && this.list.length === 0
    },
  },

  onLoad(query) {
    this.clubId = (query && query.club_id) || ''
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
      const res = await getRecruitmentList({ club_id: this.clubId, keyword: this.keyword, page: 1, page_size: PAGE_SIZE })
      this.loading = false
      if (res.code !== ERROR_CODE.SUCCESS) {
        this.error = res.message || '岗位列表加载失败，请检查网络后重试'
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
      const res = await getRecruitmentList({ club_id: this.clubId, keyword: this.keyword, page: this.page + 1, page_size: PAGE_SIZE })
      this.loadingMore = false
      if (res.code !== ERROR_CODE.SUCCESS) {
        uni.showToast({ title: res.message || '加载更多失败，请稍后重试', icon: 'none' })
        return
      }
      this.list = this.list.concat((res.data && res.data.list) || [])
      this.page += 1
      this.hasMore = !!(res.data && res.data.has_more)
    },

    onSearch() {
      this.load()
    },

    formatTime(value) {
      if (!value) return '截止时间待定'
      const raw = typeof value === 'object' && value.$date ? value.$date : value
      const date = new Date(raw)
      if (Number.isNaN(date.getTime())) return '截止时间待定'
      const pad = (n) => String(n).padStart(2, '0')
      return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    },

    goDetail(row) {
      uni.navigateTo({ url: `/pages/subpages/recruitment-register/index?id=${row._id}` })
    },
  },
}
</script>

<template>
  <view class="rcl-page">
    <!-- 头部搜索 -->
    <view class="rcl-search">
      <input v-model="keyword" class="rcl-search__input" type="text" :maxlength="20" placeholder="搜索在招岗位" confirm-type="search" @confirm="onSearch" />
      <text class="rcl-search__btn" @tap="onSearch">搜索</text>
    </view>

    <!-- 加载态 -->
    <view v-if="loading" class="rcl-card">
      <sb-skeleton :rows="4" />
    </view>

    <!-- 失败态 -->
    <view v-else-if="error" class="rcl-card">
      <sb-error :text="error" @retry="load" />
    </view>

    <!-- 空态 -->
    <view v-else-if="isEmpty" class="rcl-empty">
      <sb-illustration icon="eye" tone="warning" />
      <view class="rcl-empty__badge">暂无开放中的招新岗位</view>
      <sb-button v-if="keyword" type="primary" size="sm" text="清除搜索" @click="keyword = '' ; onSearch()" />
    </view>

    <!-- 岗位列表 -->
    <template v-else>
      <view v-for="row in list" :key="row._id" class="rcl-card" @tap="goDetail(row)">
        <view class="rcl-card__top">
          <text class="rcl-card__title">{{ row.title }}</text>
          <text v-if="row.full" class="rcl-badge rcl-badge--full">已满</text>
          <text v-else-if="row.deadline_passed" class="rcl-badge rcl-badge--off">已截止</text>
          <text v-else-if="row.multi_step" class="rcl-badge">多步</text>
        </view>
        <text class="rcl-card__club">{{ row.club_name || '未知社团' }} · 报名截止 {{ formatTime(row.signup_end) }}</text>
        <text class="rcl-card__meta">
          <template v-if="row.remaining != null">剩余名额 {{ row.remaining }}</template>
          <template v-else>名额不限</template>
          <template v-if="row.form_fields_count"> · 报名表 {{ row.form_fields_count }} 项</template>
        </text>
      </view>

      <!-- 分页状态 -->
      <view class="rcl-more">
        <text v-if="loadingMore" class="rcl-more__text">加载更多…</text>
        <text v-else-if="hasMore" class="rcl-more__text">上拉加载更多</text>
        <text v-else class="rcl-more__text">已加载全部 {{ total }} 个岗位</text>
      </view>
    </template>
  </view>
</template>

<style lang="scss" scoped>
.rcl-page {
  min-height: 100vh;
  padding: 24rpx 32rpx 48rpx;
  background: $color-bg-canvas;
  box-sizing: border-box;
}

.rcl-search {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 20rpx 24rpx;
  border-radius: $radius-md;
  border: 4rpx solid $memphis-dark;
  background: $color-bg-card;
  box-shadow: $shadow-memphis-sm;

  &__input {
    flex: 1;
    padding: 12rpx 16rpx;
    border-radius: $radius-sm;
    border: 3rpx solid $memphis-dark;
    background: $color-bg-canvas;
    font-size: $fs-body;
  }

  &__btn {
    padding: 12rpx 24rpx;
    border-radius: $radius-sm;
    border: 3rpx solid $memphis-dark;
    background: $color-primary;
    font-size: $fs-body;
    font-weight: 700;
    color: #ffffff;
  }
}

.rcl-card {
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

  &__club,
  &__meta {
    display: block;
    margin-top: 10rpx;
    font-size: $fs-caption;
    color: $color-text-muted;
  }
}

.rcl-badge {
  padding: 4rpx 14rpx;
  border-radius: 999rpx;
  border: 3rpx solid $memphis-dark;
  background: $color-info-light;
  font-size: $fs-caption;
  color: $color-info-text;

  &--full,
  &--off {
    background: $color-danger-light;
    color: $color-danger;
  }
}

.rcl-empty {
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

.rcl-more {
  padding: 24rpx 0;
  text-align: center;

  &__text {
    font-size: $fs-caption;
    color: $color-text-muted;
  }
}
</style>