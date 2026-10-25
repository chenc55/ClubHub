<script>
/**
 * 消息中心 Tab 页（STU-07 / P1-21）
 *
 * 内容：分类 Tab（全部 / 系统 / 活动 / 招新，带未读数徽标）+ 消息列表（未读红点 / 标题 / 摘要 / 时间）+
 *       下拉刷新 + 触底分页 + 「全部已读」+ 空态「暂无消息」
 * 交互：点击消息 → 标记已读并按 biz_type 跳转关联详情；未读数徽标随已读联动。
 * 数据来源：GET /message/list、/message/unread、POST /message/read、/message/read-all
 */
import { getMessageList, readMessage, readAllMessages, getUnreadCount } from '@/api/message'
import { ERROR_CODE } from '@/utils/config'

const PAGE_SIZE = 20
const TABS = [
  { value: 'all', label: '全部' },
  { value: 'system', label: '系统' },
  { value: 'activity', label: '活动' },
  { value: 'recruitment', label: '招新' },
]
/** biz_type → 详情页跳转（空 biz_id 的 activity/announcement 不跳转，仅标已读） */
const BIZ_ROUTE = {
  activity: (id) => `/pages/subpages/activity-detail/index?id=${id}`,
  recruitment: () => '/pages/subpages/my-recruitments/index',
  announcement: (id) => `/pages/subpages/announcement-detail/index?id=${id}`,
  appeal: () => '/pages/subpages/rebind-appeal/index',
  club: () => '/pages/subpages/club-apply/index',
}

export default {
  name: 'Messages',

  data: () => ({
    tabs: TABS,
    currentTab: 'all',
    loading: true,
    error: '',
    list: [],
    total: 0,
    page: 1,
    hasMore: false,
    unread: { total: 0, system: 0, activity: 0, recruitment: 0 },
    readingId: '',
    readAllPending: false,
  }),

  computed: {
    isEmpty() {
      return !this.loading && !this.error && this.list.length === 0
    },
  },

  onShow() {
    this.loadUnread()
    this.load()
  },

  onPullDownRefresh() {
    this.load(() => uni.stopPullDownRefresh())
  },

  onReachBottom() {
    this.loadMore()
  },

  methods: {
    async load(done) {
      this.loading = true
      this.error = ''
      const res = await getMessageList({ type: this.currentTab, page: 1, page_size: PAGE_SIZE })
      this.loading = false
      if (done) done()
      if (res.code !== ERROR_CODE.SUCCESS || !res.data) {
        this.error = res.message || '消息加载失败，请检查网络后重试'
        this.list = []
        return
      }
      const data = res.data
      this.list = data.list || []
      this.total = data.total || 0
      this.hasMore = !!data.has_more
      this.page = 1
    },

    async loadMore() {
      if (this.loading || !this.hasMore || this.error) return
      const res = await getMessageList({ type: this.currentTab, page: this.page + 1, page_size: PAGE_SIZE })
      if (res.code !== ERROR_CODE.SUCCESS) {
        uni.showToast({ title: res.message || '加载更多失败，请稍后重试', icon: 'none' })
        return
      }
      this.list = this.list.concat((res.data && res.data.list) || [])
      this.page += 1
      this.hasMore = !!(res.data && res.data.has_more)
    },

    async loadUnread() {
      const res = await getUnreadCount()
      if (res.code === ERROR_CODE.SUCCESS && res.data) {
        this.unread = { total: 0, system: 0, activity: 0, recruitment: 0, ...res.data }
      }
    },

    switchTab(value) {
      if (this.currentTab === value) return
      this.currentTab = value
      this.load()
    },

    tabUnread(value) {
      return value === 'all' ? this.unread.total : this.unread[value] || 0
    },

    badgeText(value) {
      const count = this.tabUnread(value)
      if (count <= 0) return ''
      return count > 99 ? '99+' : String(count)
    },

    formatTime(value) {
      if (!value) return ''
      const raw = typeof value === 'object' && value.$date ? value.$date : value
      const date = new Date(raw)
      if (Number.isNaN(date.getTime())) return ''
      const pad = (n) => String(n).padStart(2, '0')
      const now = new Date()
      const sameDay = date.toDateString() === now.toDateString()
      if (sameDay) return `${pad(date.getHours())}:${pad(date.getMinutes())}`
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    },

    /** 点击消息：标记已读 → 按 biz_type 跳转 */
    async onItemTap(row) {
      if (this.readingId) return
      this.readingId = row._id
      let unreadTotal = this.unread.total
      if (!row.is_read) {
        const res = await readMessage({ message_id: row._id })
        if (res.code === ERROR_CODE.SUCCESS && res.data) {
          row.is_read = true
          unreadTotal = res.data.unread_total
        }
      }
      this.readingId = ''
      // 跳转（未读总数仅本地刷新，不影响跳转）
      const builder = BIZ_ROUTE[row.biz_type]
      if (builder) {
        const url = builder(row.biz_id)
        if (url) {
          uni.navigateTo({ url })
          return
        }
      }
      // 无跳转目标（如公告缺 id）→ 仅刷新未读数
      this.unread = { ...this.unread, total: unreadTotal }
    },

    /** 全部已读（全局：无论当前分类，将全部消息标记已读） */
    async onReadAll() {
      if (this.readAllPending) return
      try {
        const res = await new Promise((resolve) => {
          uni.showModal({
            title: '全部已读',
            content: '确定将全部消息标记为已读吗？',
            confirmText: '确认',
            cancelText: '取消',
            success: resolve,
          })
        })
        if (!res.confirm) return
      } catch (e) {
        return
      }
      this.readAllPending = true
      const apiRes = await readAllMessages({})
      this.readAllPending = false
      if (apiRes.code !== ERROR_CODE.SUCCESS) {
        uni.showToast({ title: apiRes.message || '操作失败，请稍后重试', icon: 'none' })
        return
      }
      const updated = (apiRes.data && apiRes.data.updated) || 0
      uni.showToast({ title: updated ? `已读 ${updated} 条` : '没有未读消息', icon: 'none' })
      await this.load()
      await this.loadUnread()
    },
  },
}
</script>

<template>
  <view class="msg-page">
    <!-- 头部：标题 + 全部已读 -->
    <view class="msg-head">
      <text class="msg-head__title">消息</text>
      <text class="msg-head__action" @tap="onReadAll">全部已读</text>
    </view>

    <!-- 分类 Tab（带未读徽标） -->
    <scroll-view class="msg-tabs" scroll-x :show-scrollbar="false">
      <view class="msg-tabs__row">
        <view
          v-for="tab in tabs"
          :key="tab.value"
          class="msg-tab"
          :class="{ 'msg-tab--active': currentTab === tab.value }"
          @tap="switchTab(tab.value)"
        >
          {{ tab.label }}
          <text v-if="badgeText(tab.value)" class="msg-tab__badge">{{ badgeText(tab.value) }}</text>
        </view>
      </view>
    </scroll-view>

    <!-- 加载态 -->
    <view v-if="loading" class="msg-card">
      <sb-skeleton :rows="4" />
    </view>

    <!-- 失败态 -->
    <view v-else-if="error" class="msg-card">
      <sb-error :text="error" @retry="load" />
    </view>

    <!-- 空态 -->
    <view v-else-if="isEmpty" class="msg-empty">
      <sb-illustration icon="eye" tone="warning" />
      <view class="msg-empty__badge">暂无消息</view>
    </view>

    <!-- 消息列表 -->
    <template v-else>
      <view v-for="row in list" :key="row._id" class="msg-card" @tap="onItemTap(row)">
        <view class="msg-row">
          <view class="msg-dot" :class="{ 'msg-dot--read': row.is_read }" />
          <view class="msg-row__main">
            <view class="msg-row__top">
              <text class="msg-row__title" :class="{ 'msg-row__title--read': row.is_read }">{{ row.title }}</text>
              <text class="msg-row__time">{{ formatTime(row.created_at) }}</text>
            </view>
            <text class="msg-row__content">{{ row.content }}</text>
          </view>
        </view>
      </view>

      <!-- 分页状态 -->
      <view class="msg-more">
        <text class="msg-more__text">{{ hasMore ? '上拉加载更多' : `已加载全部 ${total} 条` }}</text>
      </view>
    </template>
  </view>
</template>

<style lang="scss" scoped>
.msg-page {
  min-height: 100vh;
  padding: 24rpx 32rpx 48rpx;
  background: $color-bg-canvas;
  box-sizing: border-box;
}

.msg-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 28rpx 32rpx;
  border-radius: $radius-lg;
  border: 4rpx solid $memphis-dark;
  background: $color-bg-card;
  box-shadow: $shadow-memphis-md;

  &__title {
    font-size: $fs-h2;
    font-weight: 700;
    color: $color-text-title;
  }

  &__action {
    padding: 10rpx 24rpx;
    border-radius: 999rpx;
    border: 3rpx solid $memphis-dark;
    background: $color-bg-canvas;
    font-size: $fs-caption;
    color: $color-text-body;
  }
}

.msg-tabs {
  margin-top: 24rpx;
  white-space: nowrap;

  &__row {
    display: flex;
    gap: 12rpx;
  }

  .msg-tab {
    display: inline-flex;
    align-items: center;
    gap: 6rpx;
    padding: 10rpx 22rpx;
    border-radius: 999rpx;
    border: 3rpx solid $memphis-dark;
    background: $color-bg-card;
    font-size: $fs-body;
    color: $color-text-body;

    &--active {
      background: $color-primary;
      color: #ffffff;
    }

    &__badge {
      min-width: 32rpx;
      padding: 0 8rpx;
      border-radius: 999rpx;
      background: $color-danger;
      color: #ffffff;
      font-size: $fs-caption;
      text-align: center;
      line-height: 32rpx;
    }
  }
}

.msg-card {
  margin-top: 24rpx;
  padding: 28rpx 32rpx;
  border-radius: $radius-md;
  border: 4rpx solid $memphis-dark;
  background: $color-bg-card;
  box-shadow: $shadow-memphis-sm;
}

.msg-row {
  display: flex;
  align-items: flex-start;
  gap: 16rpx;

  &__main {
    flex: 1;
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

    &--read {
      font-weight: 400;
      color: $color-text-body;
    }
  }

  &__time {
    flex-shrink: 0;
    font-size: $fs-caption;
    color: $color-text-muted;
  }

  &__content {
    display: block;
    margin-top: 10rpx;
    font-size: $fs-body;
    color: $color-text-body;
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }
}

.msg-dot {
  flex-shrink: 0;
  width: 20rpx;
  height: 20rpx;
  margin-top: 10rpx;
  border-radius: 50%;
  background: $color-danger;
  border: 3rpx solid $memphis-dark;

  &--read {
    background: transparent;
    border-color: transparent;
  }
}

.msg-empty {
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

.msg-more {
  padding: 24rpx 0;
  text-align: center;

  &__text {
    font-size: $fs-caption;
    color: $color-text-muted;
  }
}
</style>
