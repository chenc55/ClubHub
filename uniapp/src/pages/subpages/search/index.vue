<script>
/**
 * 搜索结果页（COM-05 / P1-23 全局搜索与排序）
 *
 * 内容：顶部搜索框（保留关键词 / 300ms 防抖 / 空关键词不发请求）+ 分组结果——
 *       「活动」组（标题/封面/时间地点/进度）与「社团」组（Logo/星级/成员活动数，
 *       招新岗位挂靠社团条目下，按截止时间升序）+ 骨架 / 空态「未找到相关内容」/ 失败重试
 * 关键词精确匹配（需求 2.7：不做模糊 / 拼音）由服务端实现；本页只管输入与渲染。
 * 数据来源：GET /search/global
 * 进入方式：首页顶部搜索胶囊
 */
import { globalSearch } from '@/api/search'
import { ERROR_CODE } from '@/utils/config'

const PAGE_SIZE = 10
const DEBOUNCE_MS = 300

export default {
  name: 'Search',

  data: () => ({
    keyword: '',
    loading: false,
    error: '',
    searched: false,
    activities: [],
    actTotal: 0,
    actPage: 1,
    actHasMore: false,
    clubs: [],
    timer: null,
  }),

  computed: {
    noResult() {
      return this.searched && !this.loading && !this.error && this.activities.length === 0 && this.clubs.length === 0
    },
  },

  onLoad() {
    // 清空搜索（不要初始化关键词）
    this.keyword = ''
  },

  onUnload() {
    clearTimeout(this.timer)
  },

  onReachBottom() {
    this.loadMore()
  },

  methods: {
    /** 清空搜索：清除防抖计时器并复位（模板内不能用 clearTimeout，封装为方法） */
    onClear() {
      clearTimeout(this.timer)
      this.timer = null
      this.keyword = ''
      this.reset()
    },

    /** 防抖输入：300ms 后触发；空关键词不发请求并复位搜索结果 */
    onInput(e) {
      const value = String(e.detail.value || '')
      clearTimeout(this.timer)
      this.keyword = value
      if (!value.trim()) {
        this.reset()
        return
      }
      this.timer = setTimeout(() => this.search(this.keyword), DEBOUNCE_MS)
    },

    /** 清空复位 */
    reset() {
      this.searched = false
      this.error = ''
      this.activities = []
      this.clubs = []
      this.actTotal = 0
    },

    async search(keyword) {
      const kw = String(keyword || '').trim()
      if (!kw) return
      this.loading = true
      this.error = ''
      const res = await globalSearch({ keyword: kw, page: 1, page_size: PAGE_SIZE })
      this.loading = false
      this.searched = true
      if (res.code !== ERROR_CODE.SUCCESS || !res.data) {
        this.error = res.code === ERROR_CODE.PARAM_INVALID ? '' : res.message || '搜索失败，请稍后重试'
        this.activities = []
        this.clubs = []
        return
      }
      this.activities = (res.data.activities && res.data.activities.list) || []
      this.actTotal = (res.data.activities && res.data.activities.total) || 0
      this.actPage = 1
      this.actHasMore = !!(res.data.activities && res.data.activities.has_more)
      this.clubs = res.data.clubs || []
    },

    /** 活动组向上翻页（触底加载） */
    async loadMore() {
      if (this.loading || !this.actHasMore || this.error) return
      if (!this.keyword.trim()) return
      const kw = this.keyword.trim()
      const res = await globalSearch({ keyword: kw, page: this.actPage + 1, page_size: PAGE_SIZE })
      if (res.code !== ERROR_CODE.SUCCESS) {
        uni.showToast({ title: res.message || '加载更多失败，请稍后重试', icon: 'none' })
        return
      }
      this.activities = this.activities.concat((res.data.activities && res.data.activities.list) || [])
      this.actPage += 1
      this.actHasMore = !!(res.data.activities && res.data.activities.has_more)
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

    formatTime(value) {
      if (!value) return ''
      const raw = typeof value === 'object' && value.$date ? value.$date : value
      const date = new Date(raw)
      if (Number.isNaN(date.getTime())) return ''
      const pad = (n) => String(n).padStart(2, '0')
      return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    },

    starText(level) {
      const value = Math.min(5, Math.max(0, Number(level) || 0))
      if (!value) return '未评定'
      return `${'★'.repeat(value)}${'☆'.repeat(5 - value)}`
    },

    remainingText(row) {
      if (row.remaining == null) return '不限名额'
      return row.remaining > 0 ? `剩 ${row.remaining} 个名额` : '已满员'
    },
  },
}
</script>

<template>
  <view class="sr-page">
    <!-- 搜索框 -->
    <view class="sr-bar">
      <view class="sr-bar__input">
        <text class="sr-bar__icon">⌕</text>
        <input
          v-model="keyword"
          class="sr-bar__field"
          type="text"
          :maxlength="20"
          placeholder="搜索社团 / 活动 / 招新岗位"
          confirm-type="search"
          @input="onInput"
        />
        <text v-if="keyword" class="sr-bar__clear" @tap="onClear">×</text>
      </view>
    </view>

    <!-- 未搜索引导态 -->
    <view v-if="!searched && !loading && !error" class="sr-guide">
      <sb-illustration icon="eye" tone="warning" />
      <view class="sr-guide__badge">输入关键词搜索社团、活动或招新岗位</view>
    </view>

    <!-- 加载态 -->
    <view v-else-if="loading" class="sr-card">
      <sb-skeleton :rows="4" />
    </view>

    <!-- 失败态 -->
    <view v-else-if="error" class="sr-card">
      <sb-error :text="error" @retry="search(keyword)" />
    </view>

    <!-- 空态 -->
    <view v-else-if="noResult" class="sr-empty">
      <sb-illustration icon="eye" tone="warning" />
      <view class="sr-empty__badge">未找到相关内容</view>
      <text class="sr-empty__note">换个关键词试试，如社团名、活动标题</text>
    </view>

    <template v-else>
      <!-- 活动组 -->
      <view v-if="activities.length" class="sr-section">
        <view class="sr-section__head">
          <view class="sr-section__tag sr-section__tag--blue">活动</view>
          <text class="sr-section__count">{{ actTotal }} 条结果</text>
        </view>
        <view v-for="act in activities" :key="act._id" class="sr-act" @tap="goActivity(act._id)">
          <view class="sr-act__cover">
            <image v-if="act.cover" class="sr-act__cover-img" :src="act.cover" mode="aspectFill" />
            <text v-else class="sr-act__cover-text">{{ (act.title || '活').slice(0, 1) }}</text>
          </view>
          <view class="sr-act__main">
            <text class="sr-act__title">{{ act.title }}</text>
            <text class="sr-act__meta">{{ act.club_name }} · {{ formatTime(act.start_time) }} · {{ act.location || '地点待定' }}</text>
            <view class="sr-act__progress">
              <view class="sr-act__progress-track">
                <view class="sr-act__progress-fill" :style="{ width: `${act.progress || 0}%` }" />
              </view>
              <text class="sr-act__progress-text">已报 {{ act.signup_count }} 人</text>
            </view>
          </view>
        </view>
        <view class="sr-more">
          <text class="sr-more__text">{{ actHasMore ? '上拉加载更多' : `已加载全部 ${actTotal} 条` }}</text>
        </view>
      </view>

      <!-- 社团组（招新岗位挂靠） -->
      <view v-if="clubs.length" class="sr-section">
        <view class="sr-section__head">
          <view class="sr-section__tag sr-section__tag--gold">社团</view>
          <text class="sr-section__count">{{ clubs.length }} 个社团</text>
        </view>
        <view v-for="item in clubs" :key="item._id" class="sr-club">
          <view class="sr-club__main" @tap="goClub(item._id)">
            <view class="sr-club__logo">
              <image v-if="item.logo" class="sr-club__logo-img" :src="item.logo" mode="aspectFill" />
              <text v-else class="sr-club__logo-text">{{ (item.name || '?').slice(0, 1) }}</text>
            </view>
            <view class="sr-club__info">
              <view class="sr-club__top">
                <text class="sr-club__name">{{ item.name }}</text>
                <view v-if="item.category_name" class="sr-club__cat">{{ item.category_name }}</view>
              </view>
              <text class="sr-club__star">{{ starText(item.star_level) }}</text>
              <text class="sr-club__stats">{{ item.member_count }} 成员 · {{ item.activity_count }} 活动</text>
            </view>
          </view>

          <!-- 挂靠的招新岗位 -->
          <view v-if="item.recruitments && item.recruitments.length" class="sr-rcs">
            <view v-for="rc in item.recruitments" :key="rc._id" class="sr-rc" @tap="goRecruitment">
              <view class="sr-rc__main">
                <text class="sr-rc__title">{{ rc.title }}</text>
                <text class="sr-rc__meta">截止 {{ formatTime(rc.signup_end) }} · {{ remainingText(rc) }}</text>
              </view>
              <text class="sr-rc__cta">去报名</text>
            </view>
          </view>
        </view>
      </view>
    </template>
  </view>
</template>

<style lang="scss" scoped>
.sr-page {
  min-height: 100vh;
  padding: 24rpx 32rpx 48rpx;
  background: $color-bg-canvas;
  box-sizing: border-box;
}

.sr-bar {
  position: sticky;
  top: 0;
  z-index: 10;
  background: $color-bg-canvas;
  padding-bottom: 16rpx;

  &__input {
    display: flex;
    align-items: center;
    gap: 12rpx;
    padding: 14rpx 24rpx;
    border-radius: 999rpx;
    border: 4rpx solid $memphis-dark;
    background: $color-bg-card;
    box-shadow: $shadow-memphis-sm;
  }

  &__icon {
    font-size: $fs-h3;
    color: $color-text-muted;
  }

  &__field {
    flex: 1;
    font-size: $fs-body;
    color: $color-text-title;
  }

  &__clear {
    font-size: $fs-h3;
    color: $color-text-muted;
    padding: 0 4rpx;
  }
}

.sr-guide,
.sr-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20rpx;
  padding: 100rpx 0;

  &__badge {
    font-size: $fs-body;
    color: $color-text-muted;
  }

  &__note {
    font-size: $fs-caption;
    color: $color-text-muted;
  }
}

.sr-card {
  margin-top: 24rpx;
  padding: 28rpx 32rpx;
  border-radius: $radius-md;
  border: 4rpx solid $memphis-dark;
  background: $color-bg-card;
  box-shadow: $shadow-memphis-sm;
}

.sr-section {
  &__head {
    display: flex;
    align-items: center;
    gap: 12rpx;
    margin: 24rpx 0 16rpx;
  }

  &__tag {
    padding: 6rpx 18rpx;
    border-radius: $radius-sm;
    border: 3rpx solid $memphis-dark;
    font-size: $fs-caption;
    font-weight: 700;

    &--blue {
      background: $color-info;
      color: #ffffff;
    }

    &--gold {
      background: $color-warning;
      color: $memphis-dark;
    }
  }

  &__count {
    font-size: $fs-caption;
    color: $color-text-muted;
  }
}

/* 活动结果 */
.sr-act {
  display: flex;
  gap: 16rpx;
  padding: 20rpx 24rpx;
  margin-bottom: 16rpx;
  border-radius: $radius-md;
  border: 3rpx solid $memphis-dark;
  background: $color-bg-card;
  box-shadow: $shadow-memphis-sm;

  &__cover {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 120rpx;
    height: 120rpx;
    border-radius: $radius-sm;
    border: 3rpx solid $memphis-dark;
    background: $color-primary-light;
    overflow: hidden;

    &-img {
      width: 100%;
      height: 100%;
    }

    &-text {
      font-size: $fs-h3;
      font-weight: 700;
      color: $color-primary;
    }
  }

  &__main {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 8rpx;
  }

  &__title {
    font-size: $fs-h3;
    font-weight: 700;
    color: $color-text-title;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__meta {
    font-size: $fs-caption;
    color: $color-text-muted;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__progress {
    display: flex;
    align-items: center;
    gap: 10rpx;

    &-track {
      flex: 1;
      height: 14rpx;
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

/* 社团结果（含挂靠招新） */
.sr-club {
  padding: 24rpx;
  margin-bottom: 16rpx;
  border-radius: $radius-md;
  border: 3rpx solid $memphis-dark;
  background: $color-bg-card;
  box-shadow: $shadow-memphis-sm;

  &__main {
    display: flex;
    gap: 14rpx;
  }

  &__logo {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 80rpx;
    height: 80rpx;
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

  &__info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 6rpx;
  }

  &__top {
    display: flex;
    align-items: center;
    gap: 10rpx;
  }

  &__name {
    font-size: $fs-h3;
    font-weight: 700;
    color: $color-text-title;
  }

  &__cat {
    padding: 2rpx 12rpx;
    border-radius: 999rpx;
    border: 2rpx solid $memphis-dark;
    background: $color-bg-canvas;
    font-size: $fs-caption;
    color: $color-text-muted;
  }

  &__star {
    font-size: $fs-caption;
    color: $color-warning;
  }

  &__stats {
    font-size: $fs-caption;
    color: $color-text-muted;
  }
}

.sr-rcs {
  margin-top: 16rpx;
  border-top: 2rpx dashed $memphis-dark;
  padding-top: 12rpx;
}

.sr-rc {
  display: flex;
  align-items: center;
  gap: 12rpx;
  padding: 12rpx 4rpx;

  &__main {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 4rpx;
  }

  &__title {
    font-size: $fs-body;
    font-weight: 700;
    color: $color-text-title;
  }

  &__meta {
    font-size: $fs-caption;
    color: $color-text-muted;
  }

  &__cta {
    padding: 8rpx 20rpx;
    border-radius: 999rpx;
    border: 3rpx solid $memphis-dark;
    background: #ffffff;
    color: $color-success;
    font-size: $fs-caption;
    font-weight: 700;
  }
}

.sr-more {
  padding: 16rpx 0;
  text-align: center;

  &__text {
    font-size: $fs-caption;
    color: $color-text-muted;
  }
}
</style>