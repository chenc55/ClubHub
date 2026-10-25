<script>
/**
 * 活动 Tab（STU-04① / P1-12）
 *
 * 筛选：分类（胶囊单选）+ 时间（今天 / 本周 / 全部）+ 状态（报名中 / 进行中 / 已结束 / 全部）
 *       + 关键词（300ms 防抖，匹配标题）+「我报名的」开关（未登录引导认证）
 * 排序（服务端，需求 2.7）：未结束按开始时间升序（最近优先），已结束沉底
 * 交互：下拉刷新、触底加载更多（每页 20 条）、空态、失败重试
 * 数据来源：GET /activity/list（公开只读，游客可浏览；「我报名的」需登录）
 */
import { getCategories } from '@/api/club'
import { getActivityList } from '@/api/activity'
import { useUserStore } from '@/store/user'
import { ERROR_CODE } from '@/utils/config'

const PAGE_SIZE = 20
const KEYWORD_MAX = 20
const DEBOUNCE_MS = 300
const STATUS_META = {
  approved: { label: '待开放', cls: 'warning' },
  signup: { label: '报名中', cls: 'success' },
  ongoing: { label: '进行中', cls: 'success' },
  ended: { label: '已结束', cls: 'muted' },
  archived: { label: '已结束', cls: 'muted' },
}
const TIME_OPTIONS = [
  { value: 'all', label: '全部时间' },
  { value: 'today', label: '今天' },
  { value: 'week', label: '本周' },
]
const STATUS_OPTIONS = [
  { value: 'all', label: '全部状态' },
  { value: 'signup', label: '报名中' },
  { value: 'ongoing', label: '进行中' },
  { value: 'ended', label: '已结束' },
]

export default {
  name: 'PageActivities',

  data: () => ({
    loading: true,
    loadingMore: false,
    list: [],
    total: 0,
    page: 1,
    hasMore: false,
    error: '',
    keyword: '',
    categoryId: '',
    time: 'all',
    status: 'all',
    myOnly: false,
    categories: [],
    timeOptions: TIME_OPTIONS,
    statusOptions: STATUS_OPTIONS,
    /** 关键词防抖计时器 */
    timer: null,
  }),

  computed: {
    userStore() {
      return useUserStore()
    },
    isVerified() {
      return this.userStore.isAuthenticated
    },
    categoryOptions() {
      return [{ _id: '', name: '全部' }].concat(this.categories)
    },
    hasFilter() {
      return !!this.categoryId || this.time !== 'all' || this.status !== 'all' || !!this.keyword.trim() || this.myOnly
    },
    isEmpty() {
      return !this.loading && !this.error && this.list.length === 0
    },
    emptyText() {
      return this.hasFilter ? '没有符合条件的活动' : '暂无活动'
    },
    emptyActionText() {
      return this.hasFilter ? '重置筛选条件' : '去首页看看推荐'
    },
  },

  onLoad(query) {
    // P1-22 首页金刚区分类点击进入：switchTab 无法带 query，通过本地暂存一次性消费
    const pending = uni.getStorageSync('home_category_id')
    if (pending) {
      this.categoryId = pending
      uni.removeStorageSync('home_category_id')
    } else if (query && query.category_id) {
      this.categoryId = query.category_id
    }
    this.loadCategories()
    this.load()
  },

  onPullDownRefresh() {
    this.load().then(() => uni.stopPullDownRefresh())
  },

  onReachBottom() {
    this.loadMore()
  },

  onUnload() {
    clearTimeout(this.timer)
  },

  methods: {
    async loadCategories() {
      const res = await getCategories()
      if (res.code === ERROR_CODE.SUCCESS) this.categories = (res.data && res.data.list) || []
    },

    fetchPage(page) {
      return getActivityList({
        category_id: this.categoryId,
        time: this.time,
        status: this.status,
        keyword: this.keyword.trim(),
        my: this.myOnly ? '1' : '',
        page,
        page_size: PAGE_SIZE,
      })
    },

    async load() {
      this.loading = true
      this.error = ''
      const res = await this.fetchPage(1)
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
      const res = await this.fetchPage(this.page + 1)
      this.loadingMore = false
      if (res.code !== ERROR_CODE.SUCCESS) {
        uni.showToast({ title: res.message || '加载更多失败，请稍后重试', icon: 'none' })
        return
      }
      this.list = this.list.concat((res.data && res.data.list) || [])
      this.page += 1
      this.hasMore = !!(res.data && res.data.has_more)
    },

    onKeywordInput(value) {
      this.keyword = String(value || '').slice(0, KEYWORD_MAX)
      clearTimeout(this.timer)
      this.timer = setTimeout(() => this.load(), DEBOUNCE_MS)
    },

    selectCategory(id) {
      if (this.categoryId === id) return
      this.categoryId = id
      this.load()
    },

    selectTime(value) {
      if (this.time === value) return
      this.time = value
      this.load()
    },

    selectStatus(value) {
      if (this.status === value) return
      this.status = value
      this.load()
    },

    /** 我报名的开关：未登录引导认证，登录后切换 */
    toggleMy(event) {
      const on = !!(event && event.detail && event.detail.value)
      if (on && !this.isVerified) {
        uni.showModal({
          title: '查看我的报名',
          content: '需先完成登录与学号认证，报名记录会按你的账号展示。',
          confirmText: '去登录',
          cancelText: '取消',
          success: (res) => {
            if (res.confirm) uni.navigateTo({ url: '/pages/subpages/login/index?reason=need_auth' })
          },
        })
        return
      }
      this.myOnly = on
      this.load()
    },

    resetFilters() {
      this.categoryId = ''
      this.time = 'all'
      this.status = 'all'
      this.keyword = ''
      this.myOnly = false
      this.load()
    },

    statusMeta(status) {
      return STATUS_META[status] || { label: status, cls: 'muted' }
    },

    /** 报名进度百分比（0~100，已满封顶） */
    progressPercent(row) {
      const capacity = Number(row.capacity) || 0
      if (!capacity) return 0
      return Math.min(100, Math.round((Number(row.registered_count || 0) / capacity) * 100))
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

    goDetail(row) {
      uni.navigateTo({ url: `/pages/subpages/activity-detail/index?id=${row._id}` })
    },

    onEmptyAction() {
      if (this.hasFilter) {
        this.resetFilters()
        return
      }
      uni.switchTab({ url: '/pages/home/index' })
    },
  },
}
</script>

<template>
  <view class="acts-page">
    <!-- 标题栏 -->
    <view class="acts-head">
      <view class="acts-head__main">
        <text class="acts-head__title">活动</text>
        <view class="acts-head__slogan">发现精彩校园活动</view>
      </view>
      <view class="acts-head__badge">共 {{ total }} 个</view>
    </view>

    <!-- 搜索（仅检索当前列表范围，需求 2.7） -->
    <view class="acts-search">
      <sb-search-bar :model-value="keyword" placeholder="搜索活动标题" @input="onKeywordInput" @confirm="load" />
    </view>

    <!-- 分类筛选 -->
    <scroll-view class="acts-chips" scroll-x :show-scrollbar="false">
      <view class="acts-chips__row">
        <view
          v-for="item in categoryOptions"
          :key="item._id || 'all'"
          class="acts-chip"
          :class="{ 'acts-chip--active': categoryId === item._id }"
          @tap="selectCategory(item._id)"
        >
          {{ item.name }}
        </view>
      </view>
    </scroll-view>

    <!-- 时间 + 状态 + 我的报名 -->
    <view class="acts-filters">
      <view class="acts-filters__row">
        <view
          v-for="item in timeOptions"
          :key="item.value"
          class="acts-chip acts-chip--sm"
          :class="{ 'acts-chip--active': time === item.value }"
          @tap="selectTime(item.value)"
        >
          {{ item.label }}
        </view>
      </view>
      <view class="acts-filters__row">
        <view
          v-for="item in statusOptions"
          :key="item.value"
          class="acts-chip acts-chip--sm acts-chip--status"
          :class="{ 'acts-chip--active': status === item.value }"
          @tap="selectStatus(item.value)"
        >
          {{ item.label }}
        </view>
      </view>
      <view class="acts-mine">
        <text class="acts-mine__label">我报名的</text>
        <switch :checked="myOnly" color="#2F80ED" @change="toggleMy" />
      </view>
    </view>

    <!-- 加载态 -->
    <view v-if="loading" class="acts-card acts-card--state">
      <sb-skeleton :rows="4" />
    </view>

    <!-- 失败态 -->
    <view v-else-if="error" class="acts-card acts-card--state">
      <sb-error :text="error" @retry="load" />
    </view>

    <!-- 空态 -->
    <view v-else-if="isEmpty" class="acts-empty">
      <sb-illustration icon="eye" tone="warning" />
      <view class="acts-empty__badge">{{ emptyText }}</view>
      <sb-button type="primary" size="sm" :text="emptyActionText" @click="onEmptyAction" />
    </view>

    <!-- 活动卡列表 -->
    <template v-else>
      <view v-for="row in list" :key="row._id" class="acts-card" @tap="goDetail(row)">
        <!-- 16:9 封面 + 左上状态标签 -->
        <view class="acts-card__cover">
          <image v-if="row.cover" class="acts-card__cover-img" :src="row.cover" mode="aspectFill" />
          <view v-else class="acts-card__cover-fallback">
            <text class="acts-card__cover-text">{{ (row.title || '活').slice(0, 2) }}</text>
          </view>
          <view class="acts-card__badge" :class="`acts-card__badge--${statusMeta(row.status).cls}`">
            {{ statusMeta(row.status).label }}
          </view>
        </view>

        <view class="acts-card__body">
          <text class="acts-card__title">{{ row.title }}</text>
          <text class="acts-card__meta">
            {{ row.club_name || '未知社团' }} · {{ formatTime(row.start_time) }} · {{ row.location || '地点待定' }}
          </text>

          <!-- 报名进度条（已报 / 上限） -->
          <view class="acts-progress">
            <view class="acts-progress__bar">
              <view class="acts-progress__fill" :style="{ width: progressPercent(row) + '%' }" />
            </view>
            <text class="acts-progress__text">
              {{ row.registered_count }} / {{ row.capacity }} 已报
              <template v-if="Number(row.registered_count || 0) >= Number(row.capacity || 0)"> · 已满</template>
            </text>
          </view>
        </view>
      </view>

      <!-- 分页状态 -->
      <view class="acts-more">
        <text v-if="loadingMore" class="acts-more__text">加载更多…</text>
        <text v-else-if="hasMore" class="acts-more__text">上拉加载更多</text>
        <text v-else class="acts-more__text">已加载全部 {{ total }} 个活动</text>
      </view>
    </template>
  </view>
</template>

<style lang="scss" scoped>
.acts-page {
  min-height: 100vh;
  padding: 24rpx 32rpx 48rpx;
  background: $color-bg-canvas;
  box-sizing: border-box;
}

/* 标题栏 */
.acts-head {
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
    gap: 12rpx;
  }

  &__title {
    font-size: $fs-h1;
    font-weight: 700;
    color: $color-text-title;
  }

  &__slogan {
    align-self: flex-start;
    padding: 6rpx 20rpx;
    border-radius: $radius-full;
    border: 3rpx solid $memphis-dark;
    background: $color-primary-light;
    color: $color-primary;
    font-size: $fs-caption;
    font-weight: 600;
  }

  &__badge {
    flex-shrink: 0;
    padding: 8rpx 24rpx;
    border-radius: $radius-full;
    border: 3rpx solid $memphis-dark;
    background: $color-warning;
    color: $memphis-dark;
    font-size: $fs-caption;
    font-weight: 700;
    box-shadow: $shadow-memphis-xs;
  }
}

.acts-search {
  margin-top: 24rpx;
}

/* 筛选胶囊 */
.acts-chips {
  margin-top: 24rpx;
  width: 100%;
  white-space: nowrap;

  &__row {
    display: inline-flex;
    align-items: center;
    gap: 16rpx;
  }
}

.acts-chip {
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

  &--sm {
    padding: 8rpx 22rpx;
  }

  &--status {
    background: $color-warning-light;
  }
}

.acts-chip--status.acts-chip--active {
  background: $color-warning;
  color: $memphis-dark;
}

.acts-filters {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 16rpx;
  margin-top: 24rpx;

  &__row {
    display: flex;
    align-items: center;
    flex-wrap: wrap; /* 宽屏 H5 下 rpx 放大且内容列限宽 480px，状态行需允许换行防右溢出 */
    gap: 12rpx;
  }
}

/* 我报名的开关 */
.acts-mine {
  display: flex;
  align-items: center;
  gap: 12rpx;
  padding: 6rpx 20rpx;
  border-radius: $radius-full;
  border: 3rpx solid $memphis-dark;
  background: $color-bg-card;

  &__label {
    font-size: $fs-caption;
    font-weight: 600;
    color: $color-text-body;
  }
}

/* 活动卡 */
.acts-card {
  margin-top: 24rpx;
  border-radius: $radius-lg;
  border: 4rpx solid $memphis-dark;
  background: $color-bg-card;
  box-shadow: $shadow-memphis-md;
  overflow: hidden;
  @include press-active;

  &--state {
    padding: 32rpx;
  }

  /* 16:9 封面 */
  &__cover {
    position: relative;
    width: 100%;
    height: 0;
    padding-bottom: 56.25%;
    background: $color-bg-canvas;
    overflow: hidden;
  }

  &__cover-img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }

  &__cover-fallback {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, $color-primary-light, $color-info-light);
  }

  &__cover-text {
    font-family: $font-display;
    font-size: $fs-display;
    font-weight: 700;
    color: $color-primary;
  }

  /* 左上状态标签 */
  &__badge {
    position: absolute;
    top: 16rpx;
    left: 16rpx;
    padding: 6rpx 20rpx;
    border-radius: $radius-full;
    border: 3rpx solid $memphis-dark;
    font-size: $fs-caption;
    font-weight: 700;
    box-shadow: $shadow-memphis-xs;

    &--success {
      background: $color-success;
      color: $memphis-dark;
    }

    &--warning {
      background: $color-warning;
      color: $memphis-dark;
    }

    &--muted {
      background: $color-bg-card;
      color: $color-text-muted;
    }
  }

  &__body {
    padding: 24rpx 28rpx 28rpx;
  }

  &__title {
    display: block;
    font-size: $fs-h3;
    font-weight: 700;
    color: $color-text-title;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  &__meta {
    display: block;
    margin-top: 10rpx;
    font-size: $fs-caption;
    color: $color-text-muted;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
}

/* 报名进度条 */
.acts-progress {
  margin-top: 20rpx;

  &__bar {
    height: 20rpx;
    border-radius: $radius-full;
    border: 3rpx solid $memphis-dark;
    background: $color-bg-canvas;
    overflow: hidden;
  }

  &__fill {
    height: 100%;
    background: $color-success;
    transition: width 0.3s ease;
  }

  &__text {
    display: block;
    margin-top: 10rpx;
    font-size: $fs-caption;
    color: $color-text-muted;
  }
}

/* 空态 */
.acts-empty {
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
.acts-more {
  padding: 32rpx 0 16rpx;
  text-align: center;

  &__text {
    font-size: $fs-caption;
    color: $color-text-muted;
  }
}
</style>
