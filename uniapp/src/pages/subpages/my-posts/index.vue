<script>
/**
 * 我的动态（P2-01 / CLB-02）
 * 按发布者过滤：状态（已发布 / 已下架）+ 疑似标记展示；支持再发一条。
 */
import { getMyPosts } from '@/api/club'

const PAGE_SIZE = 10
const TABS = [
  { key: 'all', label: '全部' },
  { key: 'published', label: '已发布' },
  { key: 'taken_down', label: '已下架' },
]

export default {
  name: 'MyPosts',

  data: () => ({
    tabs: TABS,
    currentTab: 'all',
    list: [],
    total: 0,
    page: 1,
    hasMore: false,
    loading: false,
    error: '',
  }),

  computed: {
    isEmpty() {
      return !this.loading && !this.error && this.list.length === 0
    },
  },

  onShow() {
    this.reload()
  },

  onReachBottom() {
    if (this.hasMore && !this.loading) this.loadMore()
  },

  methods: {
    reload() {
      this.page = 1
      this.list = []
      this.load()
    },

    switchTab(key) {
      this.currentTab = key
      this.reload()
    },

    async load() {
      if (this.loading) return
      this.loading = true
      this.error = ''
      const res = await getMyPosts({ page: this.page, page_size: PAGE_SIZE })
      this.loading = false
      if (res.code !== 0 || !res.data) {
        this.error = (res && res.message) || '加载失败，请稍后重试'
        return
      }
      let rows = res.data.list || []
      if (this.currentTab === 'published') rows = rows.filter((p) => p.status === 'published')
      if (this.currentTab === 'taken_down') rows = rows.filter((p) => p.status === 'taken_down')
      this.list = this.page === 1 ? rows : this.list.concat(rows)
      this.total = res.data.total || 0
      this.hasMore = !!res.data.has_more
    },

    loadMore() {
      this.page += 1
      this.load()
    },

    formatTime(value) {
      if (!value) return ''
      const raw = typeof value === 'object' && value.$date ? value.$date : value
      const date = new Date(raw)
      if (Number.isNaN(date.getTime())) return ''
      const pad = (n) => String(n).padStart(2, '0')
      return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    },

    goCreate() {
      uni.redirectTo({ url: '/pages/subpages/post-create/index' })
    },
  },
}
</script>

<template>
  <view class="mp-page">
    <!-- 标题栏 -->
    <view class="mp-head">
      <text class="mp-head__title">我的动态</text>
      <view class="mp-head__action" @tap="goCreate">
        <text class="mp-head__plus">＋</text>
        <text>发布</text>
      </view>
    </view>

    <!-- 状态 Tab -->
    <view class="mp-tabs">
      <view
        v-for="t in tabs"
        :key="t.key"
        class="mp-tabs__item"
        :class="{ 'mp-tabs__item--active': currentTab === t.key }"
        @tap="switchTab(t.key)"
      >
        {{ t.label }}
      </view>
    </view>

    <!-- 加载 / 失败 / 空态 -->
    <view v-if="loading" class="mp-state">
      <sb-skeleton :rows="3" />
    </view>
    <view v-else-if="error" class="mp-state">
      <sb-error :text="error" @retry="reload" />
    </view>
    <view v-else-if="isEmpty" class="mp-state">
      <sb-empty text="还没有发布过动态" :action="{ text: '去发布', onClick: goCreate }" />
    </view>

    <!-- 动态列表 -->
    <view v-else class="mp-list">
      <view v-for="post in list" :key="post._id" class="post-card">
        <view class="post-card__head">
          <view class="post-card__club">{{ post.club_name || '—' }}</view>
          <view class="post-card__time">{{ formatTime(post.published_at) }}</view>
        </view>
        <text class="post-card__content">{{ post.content }}</text>
        <view v-if="post.images && post.images.length" class="post-card__imgs">
          <image
            v-for="(img, i) in post.images"
            :key="i"
            class="post-card__img"
            :src="img"
            mode="aspectFill"
          />
        </view>
        <view class="post-card__foot">
          <text
            class="post-card__status"
            :class="post.status === 'published' ? 'post-card__status--pub' : 'post-card__status--down'"
          >
            {{ post.status === 'published' ? '已发布' : '已下架' }}
          </text>
          <text v-if="post.flagged" class="post-card__flag">⚠ 疑似（送审中）</text>
        </view>
      </view>
      <view v-if="hasMore" class="mp-more" @tap="loadMore">加载更多</view>
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

.mp-head {
  display: flex;
  align-items: center;
  justify-content: space-between;

  &__title {
    font-family: $font-display;
    font-size: 40rpx;
    font-weight: 700;
    color: $color-text-title;
  }

  &__action {
    display: flex;
    align-items: center;
    gap: 4rpx;
    padding: 12rpx 24rpx;
    border-radius: $radius-full;
    border: 2rpx solid $memphis-dark;
    background: $color-bg-card;
    box-shadow: $shadow-memphis-xs;
    font-size: $fs-caption;
    font-weight: 700;
    color: $color-text-body;
  }

  &__plus {
    font-size: 24rpx;
  }
}

.mp-tabs {
  display: flex;
  gap: 16rpx;
  margin-top: 24rpx;

  &__item {
    padding: 12rpx 28rpx;
    border-radius: $radius-full;
    border: 2rpx solid $memphis-dark;
    background: $color-bg-card;
    font-size: $fs-caption;
    color: $color-text-muted;

    &--active {
      background: $color-primary;
      color: #fff;
      box-shadow: $shadow-memphis-xs;
    }
  }
}

.mp-state {
  margin-top: 24rpx;
}

.mp-list {
  margin-top: 24rpx;
}

.post-card {
  padding: 24rpx;
  border-radius: $radius-lg;
  border: 3rpx solid $memphis-dark;
  background: $color-bg-card;
  box-shadow: $shadow-memphis-sm;

  & + & {
    margin-top: 20rpx;
  }

  &__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  &__club {
    font-size: $fs-caption;
    font-weight: 700;
    color: $color-primary;
  }

  &__time {
    font-size: 20rpx;
    color: $color-text-muted;
  }

  &__content {
    display: block;
    margin-top: 16rpx;
    font-size: $fs-body;
    line-height: 1.6;
    color: $color-text-body;
    white-space: pre-wrap;
  }

  &__imgs {
    display: flex;
    flex-wrap: wrap;
    gap: 12rpx;
    margin-top: 16rpx;
  }

  &__img {
    width: 200rpx;
    height: 200rpx;
    border-radius: $radius-md;
    border: 2rpx solid $memphis-dark;
  }

  &__foot {
    display: flex;
    align-items: center;
    gap: 16rpx;
    margin-top: 16rpx;
  }

  &__status {
    padding: 6rpx 16rpx;
    border-radius: $radius-full;
    border: 2rpx solid $memphis-dark;
    font-size: 20rpx;
    font-weight: 700;

    &--pub {
      background: $color-success-light;
      color: $color-text-body;
    }

    &--down {
      background: $color-warning-light;
      color: $color-text-body;
    }
  }

  &__flag {
    font-size: 20rpx;
    color: $color-warning;
    font-weight: 700;
  }
}

.mp-more {
  margin-top: 24rpx;
  text-align: center;
  font-size: $fs-caption;
  color: $color-text-muted;
  padding: 16rpx;
}
</style>