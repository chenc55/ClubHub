<script>
/**
 * 社团统计页（负责人端 / CLB-03④ / CLB-04③ / P1-20）
 *
 * 内容：时间范围切换（全部 / 近 7 天 / 近 30 天）+ 活动卡（发布数 / 报名数 / 签到率）+
 *       活动状态分布条形图（纯 CSS）+ 招新卡（岗位数 / 报名数 / 录取数）+ 成员卡（总数 / 社长 / 干部）
 * 口径：签到率 = 签到人数 / 报名成功人数（对齐 ADM-07）；成员为存量，不受时间范围影响。
 * 权限：社长 / 干部均可查看（只读，服务端校验管理身份）。
 * 数据来源：GET /club/stats
 * 进入方式：社团管理主页「社团统计」入口（携带 club_id）
 */
import { getClubStats } from '@/api/club'
import { ERROR_CODE } from '@/utils/config'

const RANGES = [
  { value: 'all', label: '全部' },
  { value: '7d', label: '近 7 天' },
  { value: '30d', label: '近 30 天' },
]
const STATUS_META = {
  draft: { label: '草稿', cls: 'muted' },
  pending: { label: '待审核', cls: 'pending' },
  approved: { label: '待开放', cls: 'info' },
  signup: { label: '报名中', cls: 'success' },
  ongoing: { label: '进行中', cls: 'primary' },
  ended: { label: '已结束', cls: 'warning' },
  archived: { label: '已归档', cls: 'gray' },
}
const STATUS_ORDER = ['draft', 'pending', 'approved', 'signup', 'ongoing', 'ended', 'archived']

export default {
  name: 'ClubStats',

  data: () => ({
    clubId: '',
    ranges: RANGES,
    currentRange: 'all',
    loading: true,
    error: '',
    clubName: '',
    stats: null,
  }),

  computed: {
    isEmpty() {
      return !this.loading && !this.error && this.stats && this.isZero
    },
    isZero() {
      if (!this.stats) return true
      const { activity, recruitment, member } = this.stats
      return activity.published === 0 && recruitment.posts === 0 && member.total === 0
    },
    activity() {
      return (this.stats && this.stats.activity) || { published: 0, signups: 0, signin_count: 0, signin_rate: null, status_dist: {} }
    },
    recruitment() {
      return (this.stats && this.stats.recruitment) || { posts: 0, signups: 0, accepted: 0 }
    },
    member() {
      return (this.stats && this.stats.member) || { total: 0, president: 0, officer: 0, member: 0 }
    },
    statusRows() {
      const dist = this.activity.status_dist || {}
      const max = STATUS_ORDER.reduce((m, st) => Math.max(m, dist[st] || 0), 0)
      return STATUS_ORDER.map((st) => {
        const count = dist[st] || 0
        const meta = STATUS_META[st] || { label: st, cls: 'muted' }
        return { key: st, label: meta.label, cls: meta.cls, count, width: max > 0 ? `${Math.round((count / max) * 100)}%` : '0%' }
      })
    },
    signinText() {
      const rate = this.activity.signin_rate
      if (rate == null) return '—'
      return `${Math.round(Number(rate) * 100)}%`
    },
  },

  onLoad(query) {
    this.clubId = (query && query.club_id) || ''
    if (!this.clubId) {
      this.loading = false
      this.error = '缺少社团参数，请从社团管理重新进入'
      return
    }
    this.load()
  },

  methods: {
    async load() {
      this.loading = true
      this.error = ''
      const res = await getClubStats({ club_id: this.clubId, range: this.currentRange })
      this.loading = false
      if (res.code !== ERROR_CODE.SUCCESS || !res.data) {
        this.error = res.message || '统计数据加载失败，请检查网络后重试'
        this.stats = null
        return
      }
      this.stats = res.data
      this.clubName = (res.data.club && res.data.club.name) || ''
    },

    switchRange(value) {
      if (this.currentRange === value) return
      this.currentRange = value
      this.load()
    },
  },
}
</script>

<template>
  <view class="st-page">
    <!-- 头部：社团名 + 时间范围切换 -->
    <view class="st-head">
      <text class="st-head__title">{{ clubName || '社团统计' }}</text>
      <view class="st-head__range">
        <view
          v-for="item in ranges"
          :key="item.value"
          class="st-range"
          :class="{ 'st-range--active': currentRange === item.value }"
          @tap="switchRange(item.value)"
        >
          {{ item.label }}
        </view>
      </view>
    </view>

    <!-- 加载态 -->
    <view v-if="loading" class="st-card">
      <sb-skeleton :rows="4" />
    </view>

    <!-- 失败态 -->
    <view v-else-if="error" class="st-card">
      <sb-error :text="error" @retry="load" />
    </view>

    <!-- 空态 -->
    <view v-else-if="isEmpty" class="st-empty">
      <sb-illustration icon="eye" tone="warning" />
      <view class="st-empty__badge">该时间段暂无统计数据</view>
    </view>

    <template v-else-if="stats">
      <!-- 活动统计 -->
      <view class="st-card">
        <text class="st-card__section">活动统计</text>
        <view class="st-grid">
          <view class="st-cell">
            <text class="st-cell__num">{{ activity.published }}</text>
            <text class="st-cell__label">发布数</text>
          </view>
          <view class="st-cell">
            <text class="st-cell__num">{{ activity.signups }}</text>
            <text class="st-cell__label">报名数</text>
          </view>
          <view class="st-cell">
            <text class="st-cell__num st-cell__num--success">{{ signinText }}</text>
            <text class="st-cell__label">签到率</text>
          </view>
        </view>

        <!-- 活动状态分布条形图（纯 CSS） -->
        <view class="st-chart">
          <text class="st-chart__title">活动状态分布</text>
          <view v-for="row in statusRows" :key="row.key" class="st-bar">
            <text class="st-bar__label">{{ row.label }}</text>
            <view class="st-bar__track">
              <view class="st-bar__fill" :class="`st-bar__fill--${row.cls}`" :style="{ width: row.width }" />
            </view>
            <text class="st-bar__count">{{ row.count }}</text>
          </view>
        </view>
      </view>

      <!-- 招新统计 -->
      <view class="st-card">
        <text class="st-card__section">招新统计</text>
        <view class="st-grid">
          <view class="st-cell">
            <text class="st-cell__num">{{ recruitment.posts }}</text>
            <text class="st-cell__label">岗位数</text>
          </view>
          <view class="st-cell">
            <text class="st-cell__num">{{ recruitment.signups }}</text>
            <text class="st-cell__label">报名数</text>
          </view>
          <view class="st-cell">
            <text class="st-cell__num st-cell__num--success">{{ recruitment.accepted }}</text>
            <text class="st-cell__label">录取数</text>
          </view>
        </view>
      </view>

      <!-- 成员概览（存量） -->
      <view class="st-card">
        <text class="st-card__section">成员概览</text>
        <view class="st-grid">
          <view class="st-cell">
            <text class="st-cell__num">{{ member.total }}</text>
            <text class="st-cell__label">成员总数</text>
          </view>
          <view class="st-cell">
            <text class="st-cell__num st-cell__num--primary">{{ member.president }}</text>
            <text class="st-cell__label">社长</text>
          </view>
          <view class="st-cell">
            <text class="st-cell__num">{{ member.officer }}</text>
            <text class="st-cell__label">干部</text>
          </view>
        </view>
      </view>
    </template>
  </view>
</template>

<style lang="scss" scoped>
.st-page {
  min-height: 100vh;
  padding: 24rpx 32rpx 48rpx;
  background: $color-bg-canvas;
  box-sizing: border-box;
}

.st-head {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
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

  &__range {
    display: flex;
    gap: 12rpx;
  }
}

.st-range {
  padding: 8rpx 22rpx;
  border-radius: 999rpx;
  border: 3rpx solid $memphis-dark;
  background: $color-bg-canvas;
  font-size: $fs-caption;
  color: $color-text-body;

  &--active {
    background: $color-primary;
    color: #ffffff;
  }
}

.st-card {
  margin-top: 24rpx;
  padding: 28rpx 32rpx;
  border-radius: $radius-md;
  border: 4rpx solid $memphis-dark;
  background: $color-bg-card;
  box-shadow: $shadow-memphis-sm;

  &__section {
    display: block;
    margin-bottom: 24rpx;
    font-size: $fs-h3;
    font-weight: 700;
    color: $color-text-title;
  }
}

.st-grid {
  display: flex;
  justify-content: space-between;
  gap: 16rpx;
}

.st-cell {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8rpx;
  padding: 20rpx 12rpx;
  border-radius: $radius-sm;
  border: 3rpx solid $memphis-dark;
  background: $color-bg-canvas;

  &__num {
    font-size: $fs-display;
    font-weight: 700;
    color: $color-text-title;

    &--success {
      color: $color-success;
    }

    &--primary {
      color: $color-primary;
    }
  }

  &__label {
    font-size: $fs-caption;
    color: $color-text-muted;
  }
}

.st-chart {
  margin-top: 24rpx;

  &__title {
    display: block;
    margin-bottom: 16rpx;
    font-size: $fs-caption;
    font-weight: 700;
    color: $color-text-body;
  }
}

.st-bar {
  display: flex;
  align-items: center;
  gap: 12rpx;
  margin-bottom: 12rpx;

  &__label {
    flex-shrink: 0;
    width: 100rpx;
    font-size: $fs-caption;
    color: $color-text-body;
  }

  &__track {
    flex: 1;
    height: 28rpx;
    border-radius: $radius-sm;
    border: 3rpx solid $memphis-dark;
    background: $color-bg-canvas;
    overflow: hidden;
  }

  &__fill {
    height: 100%;
    border-radius: $radius-sm 0 0 $radius-sm;
    transition: width 0.3s ease;

    &--primary {
      background: $color-primary;
    }

    &--success {
      background: $color-success;
    }

    &--warning {
      background: $color-warning;
    }

    &--pending {
      background: $color-info-light;
    }

    &--info {
      background: $color-info;
    }

    &--muted,
    &--gray {
      background: $color-text-muted;
      opacity: 0.35;
    }
  }

  &__count {
    flex-shrink: 0;
    width: 40rpx;
    text-align: right;
    font-size: $fs-caption;
    font-weight: 700;
    color: $color-text-title;
  }
}

.st-empty {
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
</style>
