<script>
/**
 * 首页 Tab（STU-02 / P1-22 首页聚合）
 *
 * 模块：品牌栏 + 胶囊搜索（→ P1-23 搜索结果页）+ 公告 Banner 轮播（P2-02 接入数据，空则隐藏）+
 *       八大分类金刚区（→ 活动 Tab 带分类）+ 精选活动（报名中按报名数倒序，上拉分页）+
 *       热门社团榜（按成员数倒序）+ 招新推荐（开放中按截止时间升序）
 * 排序口径（需求 2.7）由服务端聚合实现；本页只负责渲染与跳转。
 * 数据来源：GET /home/index
 */
import { getHomeIndex } from '@/api/home'
import { ERROR_CODE } from '@/utils/config'

const PAGE_SIZE = 5
/** 金刚区撞色（黄/绿/紫/红循环；紫为 design.md 打包色，红取 danger） */
const CATEGORY_TONES = ['amber', 'green', 'violet', 'red']

export default {
  name: 'Home',

  data: () => ({
    loading: true,
    loadingMore: false,
    error: '',
    banners: [],
    categories: [],
    activities: [],
    actTotal: 0,
    actPage: 1,
    actHasMore: false,
    clubs: [],
    recruitments: [],
    bannerIndex: 0,
  }),

  computed: {
    hasBanners() {
      return this.banners.length > 0
    },
  },

  onLoad() {
    this.load()
    // 8.4 隐私合规：首次进入征求同意（未同意仅游客浏览；已同意幂等不弹）
    this.$nextTick(() => this.$refs.privacy.show())
  },

  onPullDownRefresh() {
    this.load().then(() => uni.stopPullDownRefresh())
  },

  onReachBottom() {
    this.loadMore()
  },

  methods: {
    async load() {
      this.loading = true
      this.error = ''
      const res = await getHomeIndex({ page: 1, page_size: PAGE_SIZE })
      this.loading = false
      if (res.code !== ERROR_CODE.SUCCESS || !res.data) {
        this.error = res.message || '首页加载失败，请检查网络后重试'
        return
      }
      const data = res.data
      this.banners = data.banners || []
      this.categories = (data.categories || []).slice(0, 8)
      this.activities = (data.activities && data.activities.list) || []
      this.actTotal = (data.activities && data.activities.total) || 0
      this.actPage = 1
      this.actHasMore = !!(data.activities && data.activities.has_more)
      this.clubs = data.clubs || []
      this.recruitments = data.recruitments || []
    },

    async loadMore() {
      if (this.loading || this.loadingMore || !this.actHasMore || this.error) return
      this.loadingMore = true
      const res = await getHomeIndex({ page: this.actPage + 1, page_size: PAGE_SIZE })
      this.loadingMore = false
      if (res.code !== ERROR_CODE.SUCCESS) {
        uni.showToast({ title: res.message || '加载更多失败，请稍后重试', icon: 'none' })
        return
      }
      this.activities = this.activities.concat((res.data.activities && res.data.activities.list) || [])
      this.actPage += 1
      this.actHasMore = !!(res.data.activities && res.data.activities.has_more)
    },

    categoryTone(index) {
      return CATEGORY_TONES[index % CATEGORY_TONES.length]
    },

    /** 金刚区分类 → 活动 Tab 并带分类（switchTab 不支持 query，用本地暂存一次性消费） */
    goCategory(item) {
      uni.setStorageSync('home_category_id', item._id)
      uni.switchTab({ url: '/pages/activities/index' })
    },

    goSearch() {
      uni.navigateTo({ url: '/pages/subpages/search/index' })
    },

    goHomeProfile() {
      uni.switchTab({ url: '/pages/profile/index' })
    },

    goActivity(id) {
      uni.navigateTo({ url: `/pages/subpages/activity-detail/index?id=${id}` })
    },

    goClub(id) {
      uni.navigateTo({ url: `/pages/subpages/club-detail/index?id=${id}` })
    },

    goRecruitment() {
      uni.navigateTo({ url: '/pages/subpages/recruitment/index' })
    },

    goBanner(id) {
      uni.navigateTo({
        url: id ? `/pages/subpages/announcement-detail/index?id=${id}` : '/pages/subpages/announcement-detail/index',
      })
    },

    starText(level) {
      const value = Math.min(5, Math.max(0, Number(level) || 0))
      if (!value) return '未评定'
      return `${'★'.repeat(value)}${'☆'.repeat(5 - value)}`
    },

    formatTime(value) {
      if (!value) return ''
      const raw = typeof value === 'object' && value.$date ? value.$date : value
      const date = new Date(raw)
      if (Number.isNaN(date.getTime())) return ''
      const pad = (n) => String(n).padStart(2, '0')
      return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    },

    remainingText(row) {
      if (row.remaining == null) return '不限名额'
      return row.remaining > 0 ? `剩 ${row.remaining} 个名额` : '已满员'
    },
  },
}
</script>

<template>
  <view class="home-page">
    <!-- 品牌栏 -->
    <view class="home-brand">
      <view class="home-brand__logo">
        <text class="home-brand__logo-text">星</text>
      </view>
      <view class="home-brand__title">
        <text class="home-brand__name">社团星球</text>
        <text class="home-brand__en">CLUBHUB · HOME</text>
      </view>
      <view class="home-brand__avatar" @tap="goHomeProfile">
        <text class="home-brand__avatar-text">我</text>
      </view>
    </view>

    <!-- 搜索胶囊 -->
    <view class="home-search" @tap="goSearch">
      <text class="home-search__icon">⌕</text>
      <text class="home-search__placeholder">搜索社团 / 活动 / 招新岗位</text>
      <view class="home-search__btn">
        <text class="home-search__btn-text">搜索</text>
      </view>
    </view>

    <!-- 加载态 -->
    <view v-if="loading" class="home-card">
      <sb-skeleton :rows="4" />
    </view>

    <!-- 失败态 -->
    <view v-else-if="error" class="home-card">
      <sb-error :text="error" @retry="load" />
    </view>

    <template v-else>
      <!-- 公告 Banner 轮播（P2-02 接入；空数据隐藏） -->
      <view v-if="hasBanners" class="home-banner">
        <swiper
          class="home-banner__swiper"
          :circular="banners.length > 1"
          :autoplay="banners.length > 1"
          :interval="3000"
          :duration="400"
          @change="(e) => (bannerIndex = e.detail.current)"
        >
          <swiper-item v-for="item in banners" :key="item._id" @tap="goBanner(item._id)">
            <view class="home-banner__card">
              <text class="home-banner__title">{{ item.title }}</text>
              <text class="home-banner__content">{{ item.content }}</text>
              <view class="home-banner__cta-row">
                <view class="home-banner__cta home-banner__cta--primary">查看详情</view>
                <view class="home-banner__cta home-banner__cta--ghost">了解活动</view>
              </view>
            </view>
          </swiper-item>
        </swiper>
        <view v-if="banners.length > 1" class="home-banner__dots">
          <view
            v-for="(item, index) in banners"
            :key="item._id"
            class="home-banner__dot"
            :class="{ 'home-banner__dot--active': index === bannerIndex }"
          />
        </view>
      </view>

      <!-- 八大分类金刚区 -->
      <view v-if="categories.length" class="home-section">
        <view class="home-section__head">
          <view class="home-section__tag home-section__tag--primary">分类</view>
          <text class="home-section__en">CATEGORIES</text>
        </view>
        <view class="home-grid">
          <view
            v-for="(item, index) in categories"
            :key="item._id"
            class="home-grid__cell"
            :class="`home-grid__cell--${categoryTone(index)}`"
            @tap="goCategory(item)"
          >
            <text class="home-grid__text">{{ (item.name || '?').slice(0, 2) }}</text>
            <text class="home-grid__name">{{ item.name }}</text>
          </view>
        </view>
      </view>

      <!-- 精选活动（报名中，分页） -->
      <view class="home-section">
        <view class="home-section__head">
          <view class="home-section__tag home-section__tag--blue">精选</view>
          <text class="home-section__en">RECOMMENDED</text>
        </view>
        <view v-if="!activities.length" class="home-empty-card">
          <text class="home-empty-card__text">暂无报名中的活动</text>
        </view>
        <view v-else>
          <view v-for="act in activities" :key="act._id" class="home-act" @tap="goActivity(act._id)">
            <view class="home-act__cover">
              <image v-if="act.cover" class="home-act__cover-img" :src="act.cover" mode="aspectFill" />
              <text v-else class="home-act__cover-text">{{ (act.title || '活').slice(0, 1) }}</text>
              <view class="home-act__tag">报名中</view>
            </view>
            <text class="home-act__title">{{ act.title }}</text>
            <text class="home-act__meta">{{ formatTime(act.start_time) }} · {{ act.location || '地点待定' }}</text>
            <view class="home-act__progress">
              <view class="home-act__progress-track">
                <view class="home-act__progress-fill" :style="{ width: `${act.progress || 0}%` }" />
              </view>
              <text class="home-act__progress-text">已报 {{ act.signup_count }} 人</text>
            </view>
          </view>
          <view class="home-more">
            <text v-if="loadingMore" class="home-more__text">加载更多…</text>
            <text v-else-if="actHasMore" class="home-more__text">上拉加载更多</text>
            <text v-else class="home-more__text">已加载全部 {{ actTotal }} 个活动</text>
          </view>
        </view>
      </view>

      <!-- 热门社团榜（成员数倒序） -->
      <view v-if="clubs.length" class="home-section">
        <view class="home-section__head">
          <view class="home-section__tag home-section__tag--gold">社团榜</view>
          <text class="home-section__en">TOP CLUBS</text>
        </view>
        <view class="home-clubs">
          <view v-for="(item, index) in clubs" :key="item._id" class="home-club" @tap="goClub(item._id)">
            <text class="home-club__rank">{{ index + 1 }}</text>
            <view class="home-club__logo">
              <image v-if="item.logo" class="home-club__logo-img" :src="item.logo" mode="aspectFill" />
              <text v-else class="home-club__logo-text">{{ (item.name || '?').slice(0, 1) }}</text>
            </view>
            <view class="home-club__main">
              <text class="home-club__name">{{ item.name }}</text>
              <text class="home-club__star">{{ starText(item.star_level) }}</text>
            </view>
            <view class="home-club__stats">
              <text class="home-club__stat">{{ item.member_count }} 成员</text>
              <text class="home-club__stat">{{ item.activity_count }} 活动</text>
            </view>
          </view>
        </view>
      </view>

      <!-- 招新推荐（开放中按截止时间升序） -->
      <view v-if="recruitments.length" class="home-section">
        <view class="home-section__head">
          <view class="home-section__tag home-section__tag--green">招新</view>
          <text class="home-section__en">RECRUITING</text>
        </view>
        <view class="home-rcs">
          <view v-for="item in recruitments" :key="item._id" class="home-rc" @tap="goRecruitment">
            <view class="home-rc__logo">
              <image v-if="item.club_logo" class="home-rc__logo-img" :src="item.club_logo" mode="aspectFill" />
              <text v-else class="home-rc__logo-text">{{ (item.club_name || '?').slice(0, 1) }}</text>
            </view>
            <view class="home-rc__main">
              <text class="home-rc__club">{{ item.club_name }}</text>
              <text class="home-rc__title">{{ item.title }}</text>
              <text class="home-rc__meta">截止 {{ formatTime(item.signup_end) }} · {{ remainingText(item) }}</text>
            </view>
            <view class="home-rc__cta">去报名</view>
          </view>
        </view>
      </view>
    </template>

    <!-- 隐私合规弹窗（首次自动唤起） -->
    <sb-privacy-popup ref="privacy" />
  </view>
</template>

<style lang="scss" scoped>
.home-page {
  min-height: 100vh;
  padding: 24rpx 32rpx 48rpx;
  background: $color-bg-canvas;
  box-sizing: border-box;
}

/* 品牌栏 */
.home-brand {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 20rpx 8rpx 0;

  &__logo {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 80rpx;
    height: 80rpx;
    border-radius: $radius-md;
    border: 4rpx solid $memphis-dark;
    background: $color-primary;
    box-shadow: $shadow-memphis-sm;

    &-text {
      font-size: $fs-h3;
      font-weight: 700;
      color: #ffffff;
    }
  }

  &__title {
    flex: 1;
    display: flex;
    flex-direction: column;
  }

  &__name {
    font-size: $fs-h2;
    font-weight: 700;
    color: $color-text-title;
  }

  &__en {
    font-size: $fs-caption;
    color: $color-text-muted;
    letter-spacing: 1rpx;
  }

  &__avatar {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 72rpx;
    height: 72rpx;
    border-radius: 50%;
    border: 3rpx solid $memphis-dark;
    background: $color-warning;

    &-text {
      font-size: $fs-caption;
      font-weight: 700;
      color: $memphis-dark;
    }
  }
}

/* 搜索胶囊 */
.home-search {
  display: flex;
  align-items: center;
  gap: 12rpx;
  margin-top: 24rpx;
  padding: 14rpx 14rpx 14rpx 24rpx;
  border-radius: 999rpx;
  border: 4rpx solid $memphis-dark;
  background: $color-bg-card;
  box-shadow: $shadow-memphis-sm;

  &__icon {
    font-size: $fs-h3;
    color: $color-text-muted;
  }

  &__placeholder {
    flex: 1;
    font-size: $fs-body;
    color: $color-text-muted;
  }

  &__btn {
    padding: 10rpx 28rpx;
    border-radius: 999rpx;
    border: 3rpx solid $memphis-dark;
    background: $color-warning;

    &-text {
      font-size: $fs-caption;
      font-weight: 700;
      color: $memphis-dark;
    }
  }
}

/* 卡片 / 分区通用 */
.home-card {
  margin-top: 24rpx;
  padding: 28rpx 32rpx;
  border-radius: $radius-md;
  border: 4rpx solid $memphis-dark;
  background: $color-bg-card;
  box-shadow: $shadow-memphis-sm;
}

.home-section {
  &__head {
    display: flex;
    align-items: center;
    gap: 12rpx;
    margin: 36rpx 0 20rpx;
  }

  &__tag {
    padding: 6rpx 18rpx;
    border-radius: $radius-sm;
    border: 3rpx solid $memphis-dark;
    font-size: $fs-caption;
    font-weight: 700;

    &--primary {
      background: $color-primary;
      color: #ffffff;
    }

    &--blue {
      background: $color-info;
      color: #ffffff;
    }

    &--gold {
      background: $color-warning;
      color: $memphis-dark;
    }

    &--green {
      background: $color-success;
      color: $memphis-dark;
    }
  }

  &__en {
    font-size: $fs-caption;
    color: $color-text-muted;
    letter-spacing: 2rpx;
  }
}

/* 公告 Banner */
.home-banner {
  margin-top: 24rpx;

  &__swiper {
    height: 260rpx;
    border-radius: $radius-lg;
    overflow: hidden;
  }

  &__card {
    display: flex;
    flex-direction: column;
    justify-content: center;
    height: 100%;
    padding: 32rpx;
    border-radius: $radius-lg;
    border: 4rpx solid $memphis-dark;
    background: $color-primary;
    box-sizing: border-box;
  }

  &__title {
    font-size: $fs-h3;
    font-weight: 700;
    color: #ffffff;
  }

  &__content {
    margin-top: 10rpx;
    font-size: $fs-caption;
    color: rgba(255, 255, 255, 0.85);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__cta-row {
    display: flex;
    gap: 12rpx;
    margin-top: 20rpx;
  }

  &__cta {
    padding: 8rpx 26rpx;
    border-radius: 999rpx;
    font-size: $fs-caption;
    font-weight: 700;

    &--primary {
      background: $color-warning;
      color: $memphis-dark;
    }

    &--ghost {
      background: #ffffff;
      color: $memphis-dark;
    }
  }

  &__dots {
    display: flex;
    justify-content: center;
    gap: 10rpx;
    margin-top: 14rpx;
  }

  &__dot {
    width: 14rpx;
    height: 14rpx;
    border-radius: 50%;
    border: 2rpx solid $memphis-dark;
    background: $color-bg-canvas;

    &--active {
      background: $color-primary;
    }
  }
}

/* 金刚区 */
.home-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 16rpx;

  &__cell {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8rpx;
    width: calc((100% - 48rpx) / 4);
    padding: 20rpx 0;
    border-radius: $radius-md;
    border: 3rpx solid $memphis-dark;
    box-shadow: $shadow-memphis-sm;
    box-sizing: border-box;

    &--amber {
      background: $color-warning;
    }

    &--green {
      background: $color-success;
    }

    &--violet {
      background: $color-info;
      color: #ffffff;
    }

    &--red {
      background: $color-danger-light;
      color: $color-danger;
    }
  }

  &__text {
    font-size: $fs-h3;
    font-weight: 700;
    color: inherit;
  }

  &__name {
    font-size: $fs-caption;
    color: inherit;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
    padding: 0 4rpx;
  }
}

/* 精选活动卡 */
.home-act {
  padding: 24rpx;
  border-radius: $radius-md;
  border: 4rpx solid $memphis-dark;
  background: $color-bg-card;
  box-shadow: $shadow-memphis-sm;
  margin-bottom: 20rpx;

  &__cover {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    height: 220rpx;
    border-radius: $radius-sm;
    border: 3rpx solid $memphis-dark;
    background: $color-primary-light;
    overflow: hidden;

    &-img {
      width: 100%;
      height: 100%;
    }

    &-text {
      font-size: $fs-h1;
      font-weight: 700;
      color: $color-primary;
    }
  }

  &__tag {
    position: absolute;
    top: 12rpx;
    left: 12rpx;
    padding: 4rpx 16rpx;
    border-radius: 999rpx;
    border: 2rpx solid $memphis-dark;
    background: $color-success;
    font-size: $fs-caption;
    font-weight: 700;
    color: $memphis-dark;
  }

  &__title {
    display: block;
    margin-top: 16rpx;
    font-size: $fs-h3;
    font-weight: 700;
    color: $color-text-title;
  }

  &__meta {
    display: block;
    margin-top: 8rpx;
    font-size: $fs-caption;
    color: $color-text-muted;
  }

  &__progress {
    display: flex;
    align-items: center;
    gap: 12rpx;
    margin-top: 14rpx;

    &-track {
      flex: 1;
      height: 18rpx;
      border-radius: 999rpx;
      border: 2rpx solid $memphis-dark;
      background: $color-bg-canvas;
      overflow: hidden;
    }

    &-fill {
      height: 100%;
      background: $color-success;
    }

    &-text {
      flex-shrink: 0;
      font-size: $fs-caption;
      color: $color-text-muted;
    }
  }
}

/* 热门社团榜 */
.home-clubs {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
}

.home-club {
  display: flex;
  align-items: center;
  gap: 14rpx;
  padding: 20rpx 24rpx;
  border-radius: $radius-md;
  border: 3rpx solid $memphis-dark;
  background: $color-bg-card;
  box-shadow: $shadow-memphis-sm;

  &__rank {
    font-size: $fs-h3;
    font-weight: 700;
    color: $color-warning;
    width: 40rpx;
  }

  &__logo {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 72rpx;
    height: 72rpx;
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
    gap: 6rpx;
  }

  &__name {
    font-size: $fs-h3;
    font-weight: 700;
    color: $color-text-title;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__star {
    font-size: $fs-caption;
    color: $color-warning;
  }

  &__stats {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 4rpx;
  }

  &__stat {
    font-size: $fs-caption;
    color: $color-text-muted;
  }
}

/* 招新推荐 */
.home-rcs {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
}

.home-rc {
  display: flex;
  align-items: center;
  gap: 14rpx;
  padding: 20rpx 24rpx;
  border-radius: $radius-md;
  border: 3rpx solid $memphis-dark;
  background: $color-bg-card;
  box-shadow: $shadow-memphis-sm;

  &__logo {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 72rpx;
    height: 72rpx;
    border-radius: 50%;
    border: 3rpx solid $memphis-dark;
    background: $color-success-light;
    overflow: hidden;

    &-img {
      width: 100%;
      height: 100%;
    }

    &-text {
      font-size: $fs-h3;
      font-weight: 700;
      color: $color-success;
    }
  }

  &__main {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 4rpx;
  }

  &__club {
    font-size: $fs-caption;
    color: $color-text-muted;
  }

  &__title {
    font-size: $fs-h3;
    font-weight: 700;
    color: $color-text-title;
  }

  &__meta {
    font-size: $fs-caption;
    color: $color-text-muted;
  }

  &__cta {
    padding: 10rpx 24rpx;
    border-radius: 999rpx;
    border: 3rpx solid $memphis-dark;
    background: #ffffff;
    color: $color-success;
    font-size: $fs-caption;
    font-weight: 700;
  }
}

/* 空态 / 分页 */
.home-empty-card {
  padding: 60rpx 24rpx;
  border-radius: $radius-md;
  border: 3rpx dashed $memphis-dark;
  background: $color-bg-card;
  text-align: center;

  &__text {
    font-size: $fs-body;
    color: $color-text-muted;
  }
}

.home-more {
  padding: 20rpx 0;
  text-align: center;

  &__text {
    font-size: $fs-caption;
    color: $color-text-muted;
  }
}
</style>