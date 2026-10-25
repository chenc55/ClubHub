<script>
/**
 * 社团详情（STU-03 / P1-08）
 *
 * 内容：基础信息（Logo / 名称 / 简介 / 星级 / 分类 / 联系方式）+ 成员数 / 活动数
 *      + 招新入口（在招岗位由 P1-16 / P1-17 接入，本轮空态）+ 活动列表（最近 5 条，完整列表与排序由 P1-12 落地）
 *      + 动态 / 风采槽位（数据由 P2-01 接入，本轮空态）
 * 数据来源：GET /club/detail（公开只读；封禁 / 待审 / 驳回社团返回 404）
 * 进入方式：社团 Tab 卡片、首页热门社团等
 */
import { getClubDetail, getClubPosts } from '@/api/club'
import { ERROR_CODE } from '@/utils/config'

const STAR_MAX = 5
/** 活动状态 → 学生端文案（状态机见需求 4.4） */
const ACTIVITY_STATUS = {
  approved: { label: '即将开放', cls: 'warning' },
  signup: { label: '报名中', cls: 'success' },
  ongoing: { label: '进行中', cls: 'success' },
  ended: { label: '已结束', cls: 'muted' },
  archived: { label: '已结束', cls: 'muted' },
}

export default {
  name: 'ClubDetail',

  data: () => ({
    clubId: '',
    loading: true,
    error: '',
    club: null,
    activities: [],
    posts: [],
  }),

  /** 小程序转发分享（P3-01 / COM-06）：卡片 = Logo + 名称；无 Logo 用平台 Logo */
  onShareAppMessage() {
    const c = this.club
    return {
      title: (c && c.name) || '社团星球',
      imageUrl: (c && c.logo) || '/static/logo.png',
      path: `/pages/subpages/club-detail/index?id=${this.clubId}`,
    }
  },

  onLoad(query) {
    this.clubId = (query && query.id) || ''
    if (!this.clubId) {
      this.loading = false
      this.error = '缺少社团参数，请从社团列表重新进入'
      return
    }
    this.load()
  },

  methods: {
    async load() {
      this.loading = true
      this.error = ''
      const res = await getClubDetail(this.clubId)
      this.loading = false
      if (res.code !== ERROR_CODE.SUCCESS || !res.data || !res.data.club) {
        this.error =
          res.code === ERROR_CODE.NOT_FOUND
            ? '社团不存在或已下架'
            : res.message || '社团详情加载失败，请检查网络后重试'
        this.club = null
        this.activities = []
        this.posts = []
        return
      }
      this.club = res.data.club
      this.activities = res.data.activities || []
      this.loadPosts()
    },

    /** 动态 / 风采：社团动态流（P2-01 接入） */
    async loadPosts() {
      const res = await getClubPosts({ club_id: this.clubId, page_size: 10 })
      this.posts = (res.code === 0 && res.data && res.data.list) || []
    },

    starText(level) {
      const value = Math.min(STAR_MAX, Math.max(0, Number(level) || 0))
      if (!value) return '未评定'
      return `${'★'.repeat(value)}${'☆'.repeat(STAR_MAX - value)}`
    },

    activityStatus(status) {
      return ACTIVITY_STATUS[status] || { label: '已发布', cls: 'muted' }
    },

    /** 活动元信息：时间 · 地点（地点为空时省略） */
    activityMeta(item) {
      return item.location ? `${this.formatTime(item.start_time)} · ${item.location}` : this.formatTime(item.start_time)
    },

    /** 活动时间展示：MM-DD HH:mm（同年省略年份，跨年补全年） */
    formatTime(value) {
      if (!value) return '时间待定'
      const raw = typeof value === 'object' && value.$date ? value.$date : value
      const date = new Date(raw)
      if (Number.isNaN(date.getTime())) return '时间待定'
      const pad = (n) => String(n).padStart(2, '0')
      const year = date.getFullYear() === new Date().getFullYear() ? '' : `${date.getFullYear()}-`
      return `${year}${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    },

    /** 动态发布时间：MM-DD HH:mm */
    postTime(value) {
      if (!value) return ''
      const raw = typeof value === 'object' && value.$date ? value.$date : value
      const date = new Date(raw)
      if (Number.isNaN(date.getTime())) return ''
      const pad = (n) => String(n).padStart(2, '0')
      return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    },

    goRecruit() {
      uni.navigateTo({ url: `/pages/subpages/recruitment/index?club_id=${this.clubId}` })
    },

    goActivity(item) {
      uni.navigateTo({ url: `/pages/subpages/activity-detail/index?id=${item._id}` })
    },

    /** H5 分享降级：复制当前页链接（P1-29） */
    copyLink() {
      uni.setClipboardData({
        data: `${location.origin}${location.pathname}?id=${this.clubId}`,
        success: () => uni.showToast({ title: '链接已复制', icon: 'success' }),
      })
    },
  },
}
</script>

<template>
  <view class="detail-page">
    <!-- 加载态 -->
    <view v-if="loading" class="detail-card detail-card--state">
      <sb-skeleton :rows="4" />
    </view>

    <!-- 失败态 -->
    <view v-else-if="error" class="detail-card detail-card--state">
      <sb-error :text="error" @retry="load" />
    </view>

    <template v-else-if="club">
      <!-- 头部：Logo / 名称 / 星级 / 分类 / 数据条 -->
      <view class="detail-card">
        <view class="detail-card__head">
          <view class="detail-logo">
            <image v-if="club.logo" class="detail-logo__img" :src="club.logo" mode="aspectFill" />
            <text v-else class="detail-logo__text">{{ (club.name || '?').slice(0, 1) }}</text>
          </view>
          <view class="detail-card__main">
            <text class="detail-card__name">{{ club.name }}</text>
            <view class="detail-card__pills">
              <view class="detail-star" :class="{ 'detail-star--none': !club.star_level }">
                {{ starText(club.star_level) }}
              </view>
              <view v-if="club.category_name" class="detail-pill">{{ club.category_name }}</view>
            </view>
          </view>
        </view>

        <view class="detail-stats">
          <view class="detail-stats__item">
            <text class="detail-stats__num detail-stats__num--member">{{ club.member_count }}</text>
            <text class="detail-stats__label">成员</text>
          </view>
          <view class="detail-stats__item">
            <text class="detail-stats__num detail-stats__num--activity">{{ club.activity_count }}</text>
            <text class="detail-stats__label">活动</text>
          </view>
        </view>

        <view v-if="club.tags && club.tags.length" class="detail-tags">
          <text v-for="tag in club.tags" :key="tag" class="detail-tags__item">{{ tag }}</text>
        </view>
      </view>

      <!-- 简介与联系方式 -->
      <view class="detail-card detail-card--body">
        <text class="detail-section__title">社团简介</text>
        <text class="detail-intro">{{ club.intro || '该社团暂未填写简介' }}</text>
        <view class="detail-row">
          <text class="detail-row__label">联系方式</text>
          <text class="detail-row__value">{{ club.contact || '暂未公开' }}</text>
        </view>
      </view>

      <!-- 招新入口（在招岗位数据由 P1-16 / P1-17 接入） -->
      <view class="detail-card detail-card--body">
        <view class="detail-section__head">
          <text class="detail-section__title">招新信息</text>
          <view class="detail-section__badge">暂无在招岗位</view>
        </view>
        <text class="detail-note">该社团当前没有开放的招新岗位；岗位发布与报名由招新模块接入后在此展示。</text>
        <view class="detail-cta" @tap="goRecruit">
          <sb-button type="primary" size="sm" block text="查看招新专区" />
        </view>
      </view>

      <!-- H5 分享降级：复制链接（P1-29） -->
      <!-- #ifdef H5 -->
      <view class="detail-card detail-card--share" @tap="copyLink">
        <text class="detail-share__icon">⧉</text>
        <text class="detail-share__text">复制链接分享该社团</text>
      </view>
      <!-- #endif -->

      <!-- 活动列表（最近 5 条；完整列表与排序由 P1-12 落地） -->
      <view class="detail-card detail-card--body">
        <view class="detail-section__head">
          <text class="detail-section__title">社团活动</text>
          <text class="detail-section__count">最近 {{ activities.length }} 条</text>
        </view>

        <view v-if="!activities.length" class="detail-empty">
          <text class="detail-empty__text">该社团暂无已发布的活动</text>
        </view>
        <template v-else>
          <view
            v-for="item in activities"
            :key="item._id"
            class="detail-activity"
            @tap="goActivity(item)"
          >
            <view class="detail-activity__main">
              <text class="detail-activity__title">{{ item.title }}</text>
              <text class="detail-activity__meta">{{ activityMeta(item) }}</text>
            </view>
            <view class="detail-activity__status" :class="`detail-activity__status--${activityStatus(item.status).cls}`">
              {{ activityStatus(item.status).label }}
            </view>
          </view>
        </template>
      </view>

      <!-- 动态 / 风采槽位（P2-01 接入：社团动态流） -->
      <view class="detail-card detail-card--body">
        <view class="detail-section__head">
          <text class="detail-section__title">社团动态</text>
          <text class="detail-section__count">风采展示</text>
        </view>
        <view v-if="!posts.length" class="detail-empty">
          <text class="detail-empty__text">暂无动态，敬请期待</text>
        </view>
        <template v-else>
          <view v-for="post in posts" :key="post._id" class="detail-post">
            <text class="detail-post__content">{{ post.content }}</text>
            <view v-if="post.images && post.images.length" class="detail-post__imgs">
              <image
                v-for="(img, i) in post.images"
                :key="i"
                class="detail-post__img"
                :src="img"
                mode="aspectFill"
              />
            </view>
            <text class="detail-post__time">{{ postTime(post.published_at) }}</text>
          </view>
        </template>
      </view>
    </template>
  </view>
</template>

<style lang="scss" scoped>
.detail-page {
  min-height: 100vh;
  padding: 24rpx 32rpx 48rpx;
  background: $color-bg-canvas;
  box-sizing: border-box;
}

.detail-card {
  padding: 32rpx;
  border-radius: $radius-lg;
  border: 4rpx solid $memphis-dark;
  background: $color-bg-card;
  box-shadow: $shadow-memphis-md;

  &--body {
    margin-top: 24rpx;
    border-radius: $radius-md;
    box-shadow: $shadow-memphis-sm;
  }

  &--state {
    padding: 32rpx;
  }

  &__head {
    display: flex;
    align-items: center;
    gap: 24rpx;
  }

  &__main {
    flex: 1;
    min-width: 0;
  }

  &__name {
    display: block;
    font-size: $fs-h1;
    font-weight: 700;
    color: $color-text-title;
  }

  &__pills {
    display: flex;
    align-items: center;
    gap: 16rpx;
    margin-top: 16rpx;
  }
}

.detail-logo {
  flex-shrink: 0;
  width: 128rpx;
  height: 128rpx;
  border-radius: $radius-md;
  border: 4rpx solid $memphis-dark;
  background: $color-primary-light;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  box-shadow: $shadow-memphis-xs;

  &__img {
    width: 100%;
    height: 100%;
  }

  &__text {
    font-size: $fs-display;
    font-weight: 700;
    color: $color-primary;
  }
}

/* 星级徽章 */
.detail-star {
  padding: 6rpx 20rpx;
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

.detail-pill {
  padding: 6rpx 20rpx;
  border-radius: $radius-full;
  border: 3rpx solid $memphis-dark;
  background: $color-primary-light;
  color: $color-primary;
  font-size: $fs-caption;
  font-weight: 600;
}

/* 数据条 */
.detail-stats {
  display: flex;
  align-items: center;
  gap: 56rpx;
  margin-top: 28rpx;
  padding-top: 28rpx;
  border-top: 3rpx dashed $color-border-light;

  &__item {
    display: flex;
    align-items: baseline;
    gap: 10rpx;
  }

  &__num {
    font-family: $font-display;
    font-size: $fs-h2;
    font-weight: 700;

    &--member {
      color: $color-primary;
    }

    &--activity {
      color: $color-success;
    }
  }

  &__label {
    font-size: $fs-caption;
    color: $color-text-muted;
  }
}

.detail-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
  margin-top: 24rpx;

  &__item {
    padding: 6rpx 18rpx;
    border-radius: $radius-sm;
    border: 2rpx solid $color-border-light;
    background: $color-bg-canvas;
    color: $color-text-muted;
    font-size: $fs-caption;
  }
}

/* 分区 */
.detail-section {
  &__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16rpx;
  }

  &__title {
    display: block;
    font-size: $fs-h3;
    font-weight: 700;
    color: $color-text-title;
  }

  &__count {
    font-size: $fs-caption;
    color: $color-text-muted;
  }

  &__badge {
    padding: 6rpx 20rpx;
    border-radius: $radius-full;
    border: 3rpx solid $memphis-dark;
    background: $color-warning-light;
    color: $color-text-body;
    font-size: $fs-caption;
    font-weight: 600;
  }
}

.detail-intro {
  display: block;
  margin-top: 20rpx;
  font-size: $fs-body;
  line-height: 1.7;
  color: $color-text-body;
}

.detail-row {
  display: flex;
  align-items: flex-start;
  gap: 16rpx;
  margin-top: 24rpx;

  &__label {
    flex-shrink: 0;
    font-size: $fs-caption;
    color: $color-text-muted;
  }

  &__value {
    flex: 1;
    font-size: $fs-body;
    color: $color-text-body;
  }
}

.detail-note {
  display: block;
  margin-top: 16rpx;
  font-size: $fs-caption;
  line-height: 1.6;
  color: $color-text-muted;
}

.detail-cta {
  margin-top: 24rpx;
}

/* H5 分享降级：复制链接（P1-29） */
.detail-card--share {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10rpx;
  padding: 20rpx;
  border: 2rpx solid $memphis-dark;
  border-radius: $radius-md;
  background: $color-bg-card;
  box-shadow: $shadow-memphis-xs;

  .detail-share__icon {
    font-size: $fs-caption;
    color: $color-text-muted;
  }

  .detail-share__text {
    font-size: $fs-caption;
    font-weight: 600;
    color: $color-text-body;
  }
}

/* 活动列表 */
.detail-activity {
  display: flex;
  align-items: center;
  gap: 16rpx;
  margin-top: 20rpx;
  padding: 20rpx;
  border-radius: $radius-md;
  border: 3rpx solid $memphis-dark;
  background: $color-bg-canvas;
  @include press-active;

  &__main {
    flex: 1;
    min-width: 0;
  }

  &__title {
    display: block;
    font-size: $fs-body;
    font-weight: 700;
    color: $color-text-title;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  &__meta {
    display: block;
    margin-top: 8rpx;
    font-size: $fs-caption;
    color: $color-text-muted;
  }

  &__status {
    flex-shrink: 0;
    padding: 6rpx 18rpx;
    border-radius: $radius-full;
    border: 3rpx solid $memphis-dark;
    font-size: $fs-caption;
    font-weight: 600;

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
      border-color: $color-border-light;
    }
  }
}

/* 空态 */
.detail-empty {
  margin-top: 20rpx;
  padding: 40rpx 24rpx;
  border-radius: $radius-md;
  border: 3rpx dashed $memphis-dark;
  text-align: center;

  &__text {
    font-size: $fs-caption;
    color: $color-text-muted;
  }
}

/* 动态流（P2-01） */
.detail-post {
  padding: 20rpx 0;
  border-bottom: 2rpx dashed $color-border-light;

  &:last-child {
    border-bottom: none;
  }

  &__content {
    display: block;
    font-size: $fs-body;
    line-height: 1.6;
    color: $color-text-body;
    white-space: pre-wrap;
  }

  &__imgs {
    display: flex;
    flex-wrap: wrap;
    gap: 12rpx;
    margin-top: 12rpx;
  }

  &__img {
    width: 180rpx;
    height: 180rpx;
    border-radius: $radius-md;
    border: 2rpx solid $memphis-dark;
  }

  &__time {
    display: block;
    margin-top: 12rpx;
    font-size: 20rpx;
    color: $color-text-muted;
  }
}
</style>
