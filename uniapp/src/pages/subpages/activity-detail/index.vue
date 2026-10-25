<script>
/**
 * 活动详情（STU-04① / P1-12）
 *
 * 内容：封面 + 状态标签、标题、主办社团（跳社团详情）、时间地点、图文正文、报名进度条、
 *       报名按钮多态（待开放 / 报名中 / 已满 / 进行中签到入口 / 已结束）——报名与签到动作由 P1-13 / P1-14 落地
 * 数据来源：GET /activity/detail（公开只读；draft / pending 不可见返回 404）
 * 进入方式：活动 Tab 卡片、首页推荐等
 */
import { getActivityDetail } from '@/api/activity'
import { ERROR_CODE } from '@/utils/config'

const STATUS_META = {
  approved: { label: '待开放', cls: 'warning' },
  signup: { label: '报名中', cls: 'success' },
  ongoing: { label: '进行中', cls: 'success' },
  ended: { label: '已结束', cls: 'muted' },
  archived: { label: '已结束', cls: 'muted' },
}
/** 我的报名状态 → 详情按钮文案 */
const MY_REG_META = {
  pending: { label: '待审核' },
  approved: { label: '已报名' },
  waitlist: { label: '候补中' },
}

export default {
  name: 'ActivityDetail',

  data: () => ({
    activityId: '',
    loading: true,
    error: '',
    activity: null,
    myRegistration: null,
  }),

  /** 小程序转发分享（P3-01 / COM-06）：卡片 = 封面 + 标题；无封面用平台 Logo */
  onShareAppMessage() {
    const a = this.activity
    return {
      title: (a && a.title) || '社团星球',
      imageUrl: (a && a.cover) || '/static/logo.png',
      path: `/pages/subpages/activity-detail/index?id=${this.activityId}`,
    }
  },

  computed: {
    statusMeta() {
      return (this.activity && STATUS_META[this.activity.status]) || null
    },
    isFull() {
      const activity = this.activity
      return !!activity && Number(activity.capacity || 0) > 0 && Number(activity.registered_count || 0) >= Number(activity.capacity)
    },
    progressPercent() {
      const activity = this.activity
      const capacity = Number((activity && activity.capacity) || 0)
      if (!activity || !capacity) return 0
      return Math.min(100, Math.round((Number(activity.registered_count || 0) / capacity) * 100))
    },
    /** 底部主操作按钮多态（P1-13 升级：接入真实报名状态） */
    cta() {
      const activity = this.activity
      if (!activity) return null
      const status = activity.status
      if (status === 'approved') return { label: '待开放', disabled: true, hint: '活动尚未开放报名' }
      if (status === 'signup') {
        if (this.myRegistration) {
          const meta = MY_REG_META[this.myRegistration.status] || { label: '已报名' }
          return { label: meta.label, disabled: true, hint: '你已报名该活动，点击查看我的报名', action: 'my' }
        }
        if (this.isFull) return { label: '已满', disabled: true, hint: '名额已满，可关注候补' }
        return { label: '去报名', disabled: false, hint: '', action: 'register' }
      }
      if (status === 'ongoing') return { label: '签到入口', disabled: false, hint: '', action: 'checkin' }
      return { label: '已结束', disabled: true, hint: '活动已结束，感谢参与' }
    },
  },

  onLoad(query) {
    this.activityId = (query && query.id) || ''
    if (!this.activityId) {
      this.loading = false
      this.error = '缺少活动参数，请从活动列表重新进入'
      return
    }
    this.load()
  },

  methods: {
    async load() {
      this.loading = true
      this.error = ''
      const res = await getActivityDetail(this.activityId)
      this.loading = false
      if (res.code !== ERROR_CODE.SUCCESS || !res.data || !res.data.activity) {
        this.error =
          res.code === ERROR_CODE.NOT_FOUND
            ? '活动不存在或已下架'
            : res.message || '活动详情加载失败，请检查网络后重试'
        this.activity = null
        return
      }
      this.activity = res.data.activity
      this.myRegistration = (res.data && res.data.my_registration) || null
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

    goClub() {
      if (!this.activity) return
      uni.navigateTo({ url: `/pages/subpages/club-detail/index?id=${this.activity.club_id}` })
    },

    /** 报名 / 签到动作：报名与我的报名已接通，签到由 P1-14 落地 */
    onCta() {
      const cta = this.cta
      if (!cta || cta.disabled) return
      if (cta.action === 'register') {
        uni.navigateTo({ url: `/pages/subpages/activity-register/index?id=${this.activityId}` })
        return
      }
      if (cta.action === 'my') {
        uni.navigateTo({ url: '/pages/subpages/my-registrations/index' })
        return
      }
      if (cta.action === 'checkin') {
        uni.navigateTo({ url: `/pages/subpages/checkin/index?id=${this.activityId}` })
      }
    },

    /** H5 分享降级：复制当前页链接（P1-29；小程序端无转发能力，两端一致仅 H5 提供复制） */
    copyLink() {
      uni.setClipboardData({
        data: `${location.origin}${location.pathname}?id=${this.activityId}`,
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
      <sb-skeleton :rows="5" />
    </view>

    <!-- 失败态 -->
    <view v-else-if="error" class="detail-card detail-card--state">
      <sb-error :text="error" @retry="load" />
    </view>

    <template v-else-if="activity">
      <!-- 封面 + 状态标签 -->
      <view class="detail-cover">
        <image v-if="activity.cover" class="detail-cover__img" :src="activity.cover" mode="aspectFill" />
        <view v-else class="detail-cover__fallback">
          <text class="detail-cover__text">{{ (activity.title || '活').slice(0, 2) }}</text>
        </view>
        <view v-if="statusMeta" class="detail-cover__badge" :class="`detail-cover__badge--${statusMeta.cls}`">
          {{ statusMeta.label }}
        </view>
      </view>

      <!-- 标题 + 主办社团 -->
      <view class="detail-card">
        <text class="detail-card__title">{{ activity.title }}</text>
        <view class="detail-club" @tap="goClub">
          <text class="detail-club__name">{{ activity.club_name || '未知社团' }}</text>
          <text class="detail-club__arrow">›</text>
        </view>

        <!-- 报名进度条 -->
        <view class="detail-progress">
          <view class="detail-progress__bar">
            <view class="detail-progress__fill" :style="{ width: progressPercent + '%' }" />
          </view>
          <text class="detail-progress__text">
            已报 {{ activity.registered_count }} / {{ activity.capacity }}<template v-if="isFull">（已满）</template>
          </text>
        </view>
      </view>

      <!-- 活动信息 -->
      <view class="detail-card detail-card--body">
        <text class="detail-card__section">活动信息</text>
        <view class="detail-row">
          <text class="detail-row__label">开始时间</text>
          <text class="detail-row__value">{{ formatTime(activity.start_time) }}</text>
        </view>
        <view class="detail-row">
          <text class="detail-row__label">结束时间</text>
          <text class="detail-row__value">{{ formatTime(activity.end_time) }}</text>
        </view>
        <view class="detail-row">
          <text class="detail-row__label">活动地点</text>
          <text class="detail-row__value">{{ activity.location || '待定' }}</text>
        </view>
        <view v-if="activity.need_approval || activity.has_waitlist || activity.allow_onsite" class="detail-flags">
          <text v-if="activity.need_approval" class="detail-flag">报名需审核</text>
          <text v-if="activity.has_waitlist" class="detail-flag">支持候补</text>
          <text v-if="activity.allow_onsite" class="detail-flag">允许现场补报</text>
        </view>
      </view>

      <!-- 图文正文 -->
      <view class="detail-card detail-card--body">
        <text class="detail-card__section">活动详情</text>
        <text class="detail-content">{{ activity.content || '暂无活动介绍' }}</text>
      </view>

      <!-- 底部主操作（多态） -->
      <view class="detail-cta">
        <!-- #ifdef H5 -->
        <view class="detail-share" @click="copyLink">
          <text class="detail-share__icon">⧉</text>
          <text class="detail-share__text">复制链接分享</text>
        </view>
        <!-- #endif -->
        <sb-button
          type="primary"
          block
          :text="(cta && cta.label) || '—'"
          :disabled="!cta || cta.disabled"
          @click="onCta"
        />
        <text v-if="cta && cta.hint" class="detail-cta__hint">{{ cta.hint }}</text>
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

/* 封面 */
.detail-cover {
  position: relative;
  width: 100%;
  height: 0;
  padding-bottom: 56.25%;
  border-radius: $radius-lg;
  border: 4rpx solid $memphis-dark;
  background: $color-bg-canvas;
  box-shadow: $shadow-memphis-md;
  overflow: hidden;

  &__img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }

  &__fallback {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, $color-primary-light, $color-info-light);
  }

  &__text {
    font-family: $font-display;
    font-size: 80rpx;
    font-weight: 700;
    color: $color-primary;
  }

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
}

.detail-card {
  margin-top: 24rpx;
  padding: 32rpx;
  border-radius: $radius-md;
  border: 4rpx solid $memphis-dark;
  background: $color-bg-card;
  box-shadow: $shadow-memphis-sm;

  &--state {
    box-shadow: $shadow-memphis-md;
  }

  &__title {
    display: block;
    font-size: $fs-h1;
    font-weight: 700;
    line-height: 1.3;
    color: $color-text-title;
  }

  &__section {
    display: block;
    margin-bottom: 20rpx;
    font-size: $fs-h3;
    font-weight: 700;
    color: $color-text-title;
  }
}

/* 主办社团 */
.detail-club {
  display: inline-flex;
  align-items: center;
  gap: 8rpx;
  margin-top: 16rpx;
  padding: 8rpx 20rpx;
  border-radius: $radius-full;
  border: 3rpx solid $memphis-dark;
  background: $color-primary-light;
  @include press-active;

  &__name {
    font-size: $fs-caption;
    font-weight: 600;
    color: $color-primary;
  }

  &__arrow {
    font-size: $fs-body;
    color: $color-primary;
  }
}

/* 报名进度条 */
.detail-progress {
  margin-top: 28rpx;

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

/* 信息行 */
.detail-row {
  display: flex;
  align-items: flex-start;
  gap: 16rpx;
  margin-top: 18rpx;

  &:first-of-type {
    margin-top: 0;
  }

  &__label {
    flex-shrink: 0;
    width: 96rpx;
    font-size: $fs-caption;
    color: $color-text-muted;
  }

  &__value {
    flex: 1;
    font-size: $fs-body;
    color: $color-text-body;
  }
}

/* 特色标签 */
.detail-flags {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
  margin-top: 20rpx;
}

.detail-flag {
  padding: 6rpx 18rpx;
  border-radius: $radius-sm;
  border: 2rpx solid $color-border-light;
  background: $color-bg-canvas;
  color: $color-text-muted;
  font-size: $fs-caption;
}

/* 正文 */
.detail-content {
  display: block;
  font-size: $fs-body;
  line-height: 1.8;
  color: $color-text-body;
  white-space: pre-wrap;
}

/* 底部主操作 */
.detail-cta {
  margin-top: 32rpx;

  /* H5 分享降级：复制链接（P1-29） */
  &__share {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8rpx;
    margin-bottom: 16rpx;
    padding: 16rpx;
    border: 2rpx solid $memphis-dark;
    border-radius: $radius-md;
    background: $color-bg-card;
    box-shadow: $shadow-memphis-xs;

    &__icon {
      font-size: $fs-caption;
      color: $color-text-muted;
    }

    &__text {
      font-size: $fs-caption;
      font-weight: 600;
      color: $color-text-body;
    }
  }

  &__hint {
    display: block;
    margin-top: 16rpx;
    text-align: center;
    font-size: $fs-caption;
    color: $color-text-muted;
  }
}
</style>
