<script>
/**
 * 社团 Tab（STU-03 / P1-08）
 *
 * 筛选：分类（单选：全部 + categories 字典）+ 星级（X 星及以上）+ 关键词（300ms 防抖，匹配名称 / 简介）
 * 排序：综合（星级 × 20 + 成员数加权，需求 2.7）/ 最新（入驻时间倒序）
 * 交互：下拉刷新、触底加载更多（每页 20 条）、空态引导（申请创建新社团）、失败重试
 * 数据来源：GET /club/list（公开只读，游客态可浏览——需求 4.1 主流程 2）
 */
import { getCategories, getClubList } from '@/api/club'
import { ERROR_CODE } from '@/utils/config'

const PAGE_SIZE = 20
const KEYWORD_MAX = 20
const DEBOUNCE_MS = 300
const STAR_MAX = 5
/** 星级筛选语义：X 星及以上（0 = 不限） */
const STAR_OPTIONS = [
  { value: 0, label: '不限星级' },
  { value: 3, label: '3★+' },
  { value: 4, label: '4★+' },
  { value: 5, label: '5★+' },
]
const SORT_OPTIONS = [
  { value: 'comprehensive', label: '综合' },
  { value: 'latest', label: '最新' },
]

export default {
  name: 'PageClubs',

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
    starMin: 0,
    sort: 'comprehensive',
    categories: [],
    starOptions: STAR_OPTIONS,
    sortOptions: SORT_OPTIONS,
    /** 关键词防抖计时器 */
    timer: null,
  }),

  computed: {
    /** 分类胶囊：全部 + 分类字典（单选） */
    categoryOptions() {
      return [{ _id: '', name: '全部社团' }].concat(this.categories)
    },
    hasFilter() {
      return !!this.categoryId || this.starMin > 0 || !!this.keyword.trim()
    },
    isEmpty() {
      return !this.loading && !this.error && this.list.length === 0
    },
    emptyText() {
      return this.hasFilter ? '没有符合条件的社团' : '暂无社团'
    },
    emptyActionText() {
      return this.hasFilter ? '重置筛选条件' : '申请创建新社团'
    },
  },

  onLoad() {
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

    /** 统一请求：页码由调用方给出，其余条件取自筛选状态 */
    fetchPage(page) {
      return getClubList({
        category_id: this.categoryId,
        star_min: this.starMin,
        keyword: this.keyword.trim(),
        sort: this.sort,
        page,
        page_size: PAGE_SIZE,
      })
    },

    /** 首屏 / 刷新 / 筛选变化后重新加载（回到第 1 页） */
    async load() {
      this.loading = true
      this.error = ''
      const res = await this.fetchPage(1)
      this.loading = false
      if (res.code !== ERROR_CODE.SUCCESS) {
        this.error = res.message || '社团列表加载失败，请检查网络后重试'
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

    /** 触底加载更多（追加，不改变筛选条件） */
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

    /** 关键词输入：300ms 防抖（需求 2.7）；空关键词不触发额外请求由服务端按无条件处理 */
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

    selectStar(value) {
      if (this.starMin === value) return
      this.starMin = value
      this.load()
    },

    selectSort(value) {
      if (this.sort === value) return
      this.sort = value
      this.load()
    },

    resetFilters() {
      this.categoryId = ''
      this.starMin = 0
      this.keyword = ''
      this.sort = 'comprehensive'
      this.load()
    },

    /** 星级徽章文案：1~5 星为实心 + 空心补齐，未评定显示灰字 */
    starText(level) {
      const value = Math.min(STAR_MAX, Math.max(0, Number(level) || 0))
      if (!value) return '未评定'
      return `${'★'.repeat(value)}${'☆'.repeat(STAR_MAX - value)}`
    },

    goDetail(row) {
      uni.navigateTo({ url: `/pages/subpages/club-detail/index?id=${row._id}` })
    },

    goRecruit(row) {
      uni.navigateTo({ url: `/pages/subpages/recruitment/index?club_id=${row._id}` })
    },

    onEmptyAction() {
      if (this.hasFilter) {
        this.resetFilters()
        return
      }
      uni.navigateTo({ url: '/pages/subpages/club-apply/index' })
    },
  },
}
</script>

<template>
  <view class="clubs-page">
    <!-- 标题栏 -->
    <view class="clubs-head">
      <view class="clubs-head__main">
        <text class="clubs-head__title">社团总览</text>
        <view class="clubs-head__slogan">找到你的同频伙伴</view>
      </view>
      <view class="clubs-head__badge">共 {{ total }} 个</view>
    </view>

    <!-- 搜索（仅检索当前列表范围，需求 2.7） -->
    <view class="clubs-search">
      <sb-search-bar
        :model-value="keyword"
        placeholder="搜索社团名称或简介"
        @input="onKeywordInput"
        @confirm="load"
      />
    </view>

    <!-- 分类筛选（横滑胶囊，单选） -->
    <scroll-view class="clubs-chips" scroll-x :show-scrollbar="false">
      <view class="clubs-chips__row">
        <view
          v-for="item in categoryOptions"
          :key="item._id || 'all'"
          class="clubs-chip"
          :class="{ 'clubs-chip--active': categoryId === item._id }"
          @tap="selectCategory(item._id)"
        >
          {{ item.name }}
        </view>
      </view>
    </scroll-view>

    <!-- 星级筛选 + 排序 -->
    <view class="clubs-filters">
      <view class="clubs-filters__group">
        <view
          v-for="item in starOptions"
          :key="item.value"
          class="clubs-chip clubs-chip--sm"
          :class="{ 'clubs-chip--active': starMin === item.value }"
          @tap="selectStar(item.value)"
        >
          {{ item.label }}
        </view>
      </view>
      <view class="clubs-filters__group">
        <view
          v-for="item in sortOptions"
          :key="item.value"
          class="clubs-chip clubs-chip--sm clubs-chip--sort"
          :class="{ 'clubs-chip--active': sort === item.value }"
          @tap="selectSort(item.value)"
        >
          {{ item.label }}
        </view>
      </view>
    </view>

    <!-- 加载态（首屏骨架） -->
    <view v-if="loading" class="clubs-card clubs-card--state">
      <sb-skeleton :rows="4" />
    </view>

    <!-- 失败态 -->
    <view v-else-if="error" class="clubs-card clubs-card--state">
      <sb-error :text="error" @retry="load" />
    </view>

    <!-- 空态（含「申请创建新社团」引导卡，对照 screen-mobile-clubs） -->
    <view v-else-if="isEmpty" class="clubs-empty">
      <sb-illustration icon="eye" tone="warning" />
      <view class="clubs-empty__badge">{{ emptyText }}</view>
      <sb-button type="primary" size="sm" :text="emptyActionText" @click="onEmptyAction" />
    </view>

    <!-- 社团卡列表 -->
    <template v-else>
      <view v-for="row in list" :key="row._id" class="clubs-card" @tap="goDetail(row)">
        <view class="clubs-card__head">
          <view class="clubs-card__logo">
            <image v-if="row.logo" class="clubs-card__logo-img" :src="row.logo" mode="aspectFill" />
            <text v-else class="clubs-card__logo-text">{{ (row.name || '?').slice(0, 1) }}</text>
          </view>
          <view class="clubs-card__main">
            <view class="clubs-card__title-row">
              <text class="clubs-card__name">{{ row.name }}</text>
              <view class="clubs-card__star" :class="{ 'clubs-card__star--none': !row.star_level }">
                {{ starText(row.star_level) }}
              </view>
            </view>
            <!-- 数据条：成员数 / 活动数 -->
            <view class="clubs-card__stats">
              <view class="clubs-card__stat">
                <text class="clubs-card__stat-num clubs-card__stat-num--member">{{ row.member_count }}</text>
                <text class="clubs-card__stat-label">成员</text>
              </view>
              <view class="clubs-card__stat">
                <text class="clubs-card__stat-num clubs-card__stat-num--activity">{{ row.activity_count }}</text>
                <text class="clubs-card__stat-label">活动</text>
              </view>
            </view>
          </view>
        </view>

        <text v-if="row.intro" class="clubs-card__intro">「{{ row.intro }}」</text>

        <view v-if="row.tags && row.tags.length" class="clubs-card__tags">
          <text v-for="tag in row.tags" :key="tag" class="clubs-card__tag">{{ tag }}</text>
        </view>

        <!-- 双按钮：白幽灵（招新信息）+ 主色（查看详情）；作用于外层并阻止冒泡，避免与整卡点击冲突 -->
        <view class="clubs-card__actions">
          <view class="clubs-card__action" @tap.stop="goRecruit(row)">
            <sb-button type="ghost" size="sm" block text="招新信息" />
          </view>
          <view class="clubs-card__action" @tap.stop="goDetail(row)">
            <sb-button type="primary" size="sm" block text="查看详情" />
          </view>
        </view>
      </view>

      <!-- 分页状态 -->
      <view class="clubs-more">
        <text v-if="loadingMore" class="clubs-more__text">加载更多…</text>
        <text v-else-if="hasMore" class="clubs-more__text">上拉加载更多</text>
        <text v-else class="clubs-more__text">已加载全部 {{ total }} 个社团</text>
      </view>
    </template>
  </view>
</template>

<style lang="scss" scoped>
.clubs-page {
  min-height: 100vh;
  padding: 24rpx 32rpx 48rpx;
  background: $color-bg-canvas;
  box-sizing: border-box;
}

/* ---------- 标题栏 ---------- */
.clubs-head {
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

.clubs-search {
  margin-top: 24rpx;
}

/* ---------- 筛选胶囊 ---------- */
.clubs-chips {
  margin-top: 24rpx;
  width: 100%;
  white-space: nowrap;

  &__row {
    display: inline-flex;
    align-items: center;
    gap: 16rpx;
  }
}

.clubs-chip {
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

  &--sort {
    background: $color-warning-light;
  }
}

/* 排序胶囊激活态：黄底黑字（与分类胶囊的蓝底区分） */
.clubs-chip--sort.clubs-chip--active {
  background: $color-warning;
  color: $memphis-dark;
}

.clubs-filters {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap; /* 宽屏 H5 下 rpx 放大且内容列限宽 480px，星级 + 排序两组需允许换行防右溢出 */
  gap: 16rpx;
  margin-top: 24rpx;

  &__group {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 12rpx;
  }
}

/* ---------- 社团卡 ---------- */
.clubs-card {
  margin-top: 24rpx;
  padding: 28rpx;
  border-radius: $radius-lg;
  border: 4rpx solid $memphis-dark;
  background: $color-bg-card;
  box-shadow: $shadow-memphis-md;
  @include press-active;

  &--state {
    padding: 32rpx;
  }

  &__head {
    display: flex;
    align-items: center;
    gap: 24rpx;
  }

  /* 彩色图标块（深色描边） */
  &__logo {
    flex-shrink: 0;
    width: 104rpx;
    height: 104rpx;
    border-radius: $radius-md;
    border: 4rpx solid $memphis-dark;
    background: $color-primary-light;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    box-shadow: $shadow-memphis-xs;
  }

  &__logo-img {
    width: 100%;
    height: 100%;
  }

  &__logo-text {
    font-size: $fs-h2;
    font-weight: 700;
    color: $color-primary;
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

  &__name {
    flex: 1;
    font-size: $fs-h3;
    font-weight: 700;
    color: $color-text-title;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  /* 星级徽章（暖阳黄 + 黑描边，design.md 3.1） */
  &__star {
    flex-shrink: 0;
    padding: 4rpx 18rpx;
    border-radius: $radius-full;
    border: 3rpx solid $memphis-dark;
    background: $color-warning;
    color: $memphis-dark;
    font-size: $fs-caption;
    font-weight: 700;
    box-shadow: $shadow-memphis-xs;

    &--none {
      background: $color-bg-canvas;
      color: $color-text-muted;
      font-weight: 600;
      box-shadow: none;
    }
  }

  &__stats {
    display: flex;
    align-items: center;
    gap: 32rpx;
    margin-top: 16rpx;
  }

  &__stat {
    display: flex;
    align-items: baseline;
    gap: 8rpx;
  }

  &__stat-num {
    font-family: $font-display;
    font-size: $fs-h3;
    font-weight: 700;

    &--member {
      color: $color-primary;
    }

    &--activity {
      color: $color-success;
    }
  }

  &__stat-label {
    font-size: $fs-caption;
    color: $color-text-muted;
  }

  &__intro {
    display: block;
    margin-top: 20rpx;
    font-size: $fs-body;
    line-height: 1.6;
    color: $color-text-body;
  }

  &__tags {
    display: flex;
    flex-wrap: wrap;
    gap: 12rpx;
    margin-top: 20rpx;
  }

  &__tag {
    padding: 6rpx 18rpx;
    border-radius: $radius-sm;
    border: 2rpx solid $color-border-light;
    background: $color-bg-canvas;
    color: $color-text-muted;
    font-size: $fs-caption;
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
}

/* ---------- 空态（虚线描边卡） ---------- */
.clubs-empty {
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

/* ---------- 分页状态 ---------- */
.clubs-more {
  padding: 32rpx 0 16rpx;
  text-align: center;

  &__text {
    font-size: $fs-caption;
    color: $color-text-muted;
  }
}
</style>
