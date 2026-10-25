<script>
/**
 * 活动管理列表（CLB-03① / P1-10，负责人端）
 *
 * 承接 club-admin「活动管理」入口：我管理的社团的活动，状态 tab + 分页 + 新建
 * 行操作按状态：草稿 → 编辑 / 提交审核；进行中 → 提前结束（二次确认 + 通知已报名用户）
 * 数据来源：GET /activity/manage（status 支持 all / draft / pending / published / finished）
 * 入口：社团管理主页「活动管理」
 */
import { getActivityManage, endActivity } from '@/api/activity'
import { ERROR_CODE } from '@/utils/config'

const PAGE_SIZE = 20
/** 状态 tab：精确值或复合别名（与服务端 manage 对齐） */
const TABS = [
  { value: 'all', label: '全部' },
  { value: 'draft', label: '草稿' },
  { value: 'pending', label: '待审核' },
  { value: 'published', label: '已发布' },
  { value: 'finished', label: '已结束' },
]
const STATUS_META = {
  draft: { label: '草稿', cls: 'muted' },
  pending: { label: '待审核', cls: 'pending' },
  approved: { label: '待开放', cls: 'warning' },
  signup: { label: '报名中', cls: 'success' },
  ongoing: { label: '进行中', cls: 'success' },
  ended: { label: '已结束', cls: 'muted' },
  archived: { label: '已归档', cls: 'muted' },
}

export default {
  name: 'ActivityManage',

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
    pendingId: '',
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
      const res = await getActivityManage({ status: this.currentTab, page: 1, page_size: PAGE_SIZE })
      this.loading = false
      if (res.code !== ERROR_CODE.SUCCESS) {
        this.error = res.message || '活动列表加载失败，请检查网络后重试'
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
      const res = await getActivityManage({ status: this.currentTab, page: this.page + 1, page_size: PAGE_SIZE })
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
      this.load()
    },

    statusMeta(status) {
      return STATUS_META[status] || { label: status, cls: 'muted' }
    },

    formatTime(value) {
      if (!value) return '时间待定'
      const raw = typeof value === 'object' && value.$date ? value.$date : value
      const date = new Date(raw)
      if (Number.isNaN(date.getTime())) return '时间待定'
      const pad = (n) => String(n).padStart(2, '0')
      const year = date.getFullYear() === new Date().getFullYear() ? '' : `${date.getFullYear()}-`
      return `${year}${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    },

    goCreate() {
      uni.navigateTo({ url: '/pages/subpages/activity-edit/index' })
    },

    goEdit(row) {
      if (row.status !== 'draft') {
        uni.showToast({ title: '仅草稿可编辑', icon: 'none' })
        return
      }
      uni.navigateTo({ url: `/pages/subpages/activity-edit/index?id=${row._id}` })
    },

    goCheckinManage(row) {
      uni.navigateTo({ url: `/pages/subpages/checkin-manage/index?id=${row._id}` })
    },

    goRegList(row) {
      uni.navigateTo({ url: `/pages/subpages/registration-list/index?id=${row._id}` })
    },

    goSubmit(row) {
      if (row.status !== 'draft') return
      uni.navigateTo({ url: `/pages/subpages/activity-edit/index?id=${row._id}&submit=1` })
    },

    async end(row) {
      if (row.status !== 'ongoing') return
      try {
        const res = await new Promise((resolve) => {
          uni.showModal({
            title: '提前结束活动',
            content: `确认提前结束「${row.title}」？结束后将通知全部已报名用户，且不可恢复。`,
            confirmText: '确认结束',
            cancelText: '取消',
            success: resolve,
          })
        })
        if (!res.confirm) return
      } catch (e) {
        return
      }

      this.pendingId = row._id
      const apiRes = await endActivity(row._id)
      this.pendingId = ''
      if (apiRes.code !== ERROR_CODE.SUCCESS) {
        uni.showToast({ title: apiRes.message || '操作失败，请稍后重试', icon: 'none' })
        return
      }
      const notified = (apiRes.data && apiRes.data.notified_count) || 0
      uni.showToast({ title: notified > 0 ? `已结束，已通知 ${notified} 人` : '活动已结束', icon: 'none' })
      await this.load()
    },
  },
}
</script>

<template>
  <view class="manage-page">
    <!-- 标题 + 新建 -->
    <view class="manage-head">
      <view class="manage-head__main">
        <text class="manage-head__title">活动管理</text>
        <text class="manage-head__sub">共 {{ total }} 个活动</text>
      </view>
      <sb-button type="primary" size="sm" text="新建活动" @click="goCreate" />
    </view>

    <!-- 状态 tab -->
    <scroll-view class="manage-tabs" scroll-x :show-scrollbar="false">
      <view class="manage-tabs__row">
        <view
          v-for="tab in tabs"
          :key="tab.value"
          class="manage-tab"
          :class="{ 'manage-tab--active': currentTab === tab.value }"
          @tap="switchTab(tab.value)"
        >
          {{ tab.label }}
        </view>
      </view>
    </scroll-view>

    <!-- 加载态 -->
    <view v-if="loading" class="manage-card">
      <sb-skeleton :rows="4" />
    </view>

    <!-- 失败态 -->
    <view v-else-if="error" class="manage-card">
      <sb-error :text="error" @retry="load" />
    </view>

    <!-- 空态 -->
    <view v-else-if="isEmpty" class="manage-empty">
      <sb-illustration icon="eye" tone="warning" />
      <view class="manage-empty__badge">该状态下暂无活动</view>
      <sb-button v-if="currentTab === 'draft' || currentTab === 'all'" type="primary" size="sm" text="创建第一个活动" @click="goCreate" />
    </view>

    <!-- 活动列表 -->
    <template v-else>
      <view v-for="row in list" :key="row._id" class="manage-card">
        <view class="manage-card__head">
          <view class="manage-card__main">
            <view class="manage-card__title-row">
              <text class="manage-card__title">{{ row.title }}</text>
              <view class="manage-card__status" :class="`manage-card__status--${statusMeta(row.status).cls}`">
                {{ statusMeta(row.status).label }}
              </view>
            </view>
            <text class="manage-card__club">{{ row.club_name || '未知社团' }} · {{ formatTime(row.start_time) }} · {{ row.location || '地点待定' }}</text>
            <text class="manage-card__meta">
              报名 {{ formatTime(row.signup_start) }} ~ {{ formatTime(row.signup_end) }} · 名额 {{ row.capacity }}
              <template v-if="row.need_approval"> · 需审核</template>
              <template v-if="row.has_waitlist"> · 候补</template>
            </text>
          </view>
        </view>

        <!-- 行操作 -->
        <view v-if="row.status === 'draft'" class="manage-card__actions">
          <view class="manage-card__action" @tap.stop="goEdit(row)">
            <sb-button type="ghost" size="sm" block text="编辑" />
          </view>
          <view class="manage-card__action" @tap.stop="goSubmit(row)">
            <sb-button type="primary" size="sm" block text="提交审核" />
          </view>
        </view>
        <view v-else-if="row.status === 'ongoing'" class="manage-card__actions">
          <view class="manage-card__action" @tap.stop="goRegList(row)">
            <sb-button type="ghost" size="sm" block text="报名名单" />
          </view>
          <view class="manage-card__action" @tap.stop="goCheckinManage(row)">
            <sb-button type="approve" size="sm" block text="签到管理" />
          </view>
          <view class="manage-card__action" @tap.stop="end(row)">
            <sb-button type="reject" size="sm" block text="提前结束" />
          </view>
        </view>
        <view v-else-if="row.status === 'approved' || row.status === 'signup' || row.status === 'ended' || row.status === 'archived'" class="manage-card__actions">
          <view class="manage-card__action" @tap.stop="goRegList(row)">
            <sb-button type="ghost" size="sm" block text="报名名单" />
          </view>
        </view>
        <text v-else-if="row.status === 'pending'" class="manage-card__note">管理员正在审核，审核结果将通知你</text>
      </view>

      <!-- 分页状态 -->
      <view class="manage-more">
        <text v-if="loadingMore" class="manage-more__text">加载更多…</text>
        <text v-else-if="hasMore" class="manage-more__text">上拉加载更多</text>
        <text v-else class="manage-more__text">已加载全部 {{ total }} 个活动</text>
      </view>
    </template>
  </view>
</template>

<style lang="scss" scoped>
.manage-page {
  min-height: 100vh;
  padding: 24rpx 32rpx 48rpx;
  background: $color-bg-canvas;
  box-sizing: border-box;
}

.manage-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
  padding: 28rpx 32rpx;
  border-radius: $radius-lg;
  border: 4rpx solid $memphis-dark;
  background: $color-bg-card;
  box-shadow: $shadow-memphis-md;

  &__main {
    display: flex;
    flex-direction: column;
    gap: 8rpx;
  }

  &__title {
    font-size: $fs-h1;
    font-weight: 700;
    color: $color-text-title;
  }

  &__sub {
    font-size: $fs-caption;
    color: $color-text-muted;
  }
}

/* 状态 tab */
.manage-tabs {
  margin-top: 24rpx;
  width: 100%;
  white-space: nowrap;

  &__row {
    display: inline-flex;
    align-items: center;
    gap: 16rpx;
  }
}

.manage-tab {
  flex-shrink: 0;
  padding: 12rpx 28rpx;
  border-radius: $radius-full;
  border: 3rpx solid $memphis-dark;
  background: $color-bg-card;
  color: $color-text-body;
  font-size: $fs-caption;
  font-weight: 600;
  @include memphis-shadow('xs');
  @include press-active;

  &--active {
    background: $color-primary;
    color: #ffffff;
    box-shadow: $shadow-memphis-sm;
  }
}

/* 活动卡 */
.manage-card {
  margin-top: 24rpx;
  padding: 28rpx;
  border-radius: $radius-lg;
  border: 4rpx solid $memphis-dark;
  background: $color-bg-card;
  box-shadow: $shadow-memphis-md;

  &__head {
    display: flex;
    align-items: flex-start;
    gap: 20rpx;
  }

  &__main {
    flex: 1;
    min-width: 0;
  }

  &__title-row {
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
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  &__status {
    flex-shrink: 0;
    padding: 4rpx 18rpx;
    border-radius: $radius-full;
    border: 3rpx solid $memphis-dark;
    font-size: $fs-caption;
    font-weight: 700;

    &--success {
      background: $color-success;
      color: $memphis-dark;
    }

    &--warning {
      background: $color-warning;
      color: $memphis-dark;
    }

    &--pending {
      background: $color-warning-light;
      color: $color-text-body;
    }

    &--muted {
      background: $color-bg-canvas;
      color: $color-text-muted;
      border-color: $color-border-light;
    }
  }

  &__club {
    display: block;
    margin-top: 12rpx;
    font-size: $fs-caption;
    color: $color-text-muted;
  }

  &__meta {
    display: block;
    margin-top: 8rpx;
    font-size: $fs-caption;
    color: $color-text-muted;
  }

  &__actions {
    display: flex;
    align-items: center;
    gap: 20rpx;
    margin-top: 24rpx;
  }

  &__action {
    flex: 1;
  }

  &__note {
    display: block;
    margin-top: 24rpx;
    padding-top: 20rpx;
    border-top: 3rpx dashed $color-border-light;
    font-size: $fs-caption;
    color: $color-text-muted;
  }
}

/* 空态 */
.manage-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-top: 24rpx;
  padding: 48rpx 32rpx;
  border-radius: $radius-lg;
  border: 4rpx dashed $memphis-dark;
  background: $color-bg-card;

  &__badge {
    margin: 28rpx 0 32rpx;
    padding: 10rpx 28rpx;
    border-radius: $radius-full;
    border: 3rpx solid $memphis-dark;
    background: $color-warning;
    color: $memphis-dark;
    font-size: $fs-caption;
    font-weight: 600;
    box-shadow: $shadow-memphis-xs;
  }
}

/* 分页 */
.manage-more {
  padding: 32rpx 0 16rpx;
  text-align: center;

  &__text {
    font-size: $fs-caption;
    color: $color-text-muted;
  }
}
</style>
