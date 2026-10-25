<script>
/**
 * 活动报名（STU-04② / P1-13）
 *
 * 流程：从活动详情「去报名」进入 → 自动带出基础信息（姓名 / 学号 / 学院专业）→ 补填备注 → 提交
 * 分发（服务端）：need_approval → pending（待审核）；有名额 → approved；满员且候补 → waitlist；满员无候补 → 1002
 * 提交前同步 requestSubscribe('activity_signup')（V-11 订阅授权时机）
 * 数据来源：GET /activity/detail（校验可报名）+ GET /user/profile（基础信息）+ POST /activity/register
 */
import { getActivityDetail, registerActivity } from '@/api/activity'
import { getProfile } from '@/api/user'
import { useUserStore } from '@/store/user'
import { ERROR_CODE } from '@/utils/config'
import { requestSubscribe } from '@/utils/subscribe'

const REMARK_MAX = 200

export default {
  name: 'ActivityRegister',

  data: () => ({
    REMARK_MAX,
    activityId: '',
    loading: true,
    submitting: false,
    error: '',
    hint: '',
    activity: null,
    profile: null,
    remark: '',
  }),

  computed: {
    userStore() {
      return useUserStore()
    },
    isVerified() {
      return this.userStore.isAuthenticated
    },
    canSubmit() {
      return this.isVerified && !this.submitting && !!(this.activity && this.activity.status === 'signup')
    },
  },

  onLoad(query) {
    this.activityId = (query && query.id) || ''
    if (!this.activityId) {
      this.loading = false
      this.error = '缺少活动参数，请从活动详情重新进入'
      return
    }
    this.load()
  },

  methods: {
    async load() {
      this.loading = true
      this.error = ''
      const [detailRes, profileRes] = await Promise.all([getActivityDetail(this.activityId), getProfile()])
      this.loading = false

      if (detailRes.code !== ERROR_CODE.SUCCESS || !detailRes.data || !detailRes.data.activity) {
        this.error = (detailRes.code === ERROR_CODE.NOT_FOUND ? detailRes.message : '活动加载失败，请稍后重试') || '活动加载失败，请稍后重试'
        return
      }
      this.activity = detailRes.data.activity
      if (profileRes.code === ERROR_CODE.SUCCESS) this.profile = profileRes.data || null
    },

    async submit() {
      if (!this.canSubmit) return
      this.submitting = true
      this.hint = ''

      // 订阅授权（V-11：提交活动报名时机）
      requestSubscribe('activity_signup')

      const res = await registerActivity({ activity_id: this.activityId, remark: this.remark.trim() })
      this.submitting = false
      if (res.code !== ERROR_CODE.SUCCESS) {
        this.hint = res.message || '报名失败，请稍后重试'
        return
      }
      const status = res.data && res.data.status
      const text = status === 'waitlist' ? '已进入候补' : status === 'pending' ? '已提交，待负责人审核' : '报名成功'
      uni.showToast({ title: text, icon: 'none' })
      setTimeout(() => uni.navigateBack(), 800)
    },

    goLogin() {
      uni.navigateTo({ url: '/pages/subpages/login/index?reason=need_auth' })
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
  },
}
</script>

<template>
  <view class="reg-page">
    <!-- 加载态 -->
    <view v-if="loading" class="reg-card">
      <sb-skeleton :rows="4" />
    </view>

    <!-- 失败态 -->
    <view v-else-if="error" class="reg-card">
      <sb-error :text="error" @retry="load" />
    </view>

    <!-- 未认证引导 -->
    <view v-else-if="!isVerified" class="reg-card">
      <text class="reg-card__title">报名活动</text>
      <text class="reg-card__desc">报名活动需先完成登录与学号认证。</text>
      <view class="reg-card__cta" @tap="goLogin">
        <sb-button type="primary" block text="去登录 / 认证" />
      </view>
    </view>

    <!-- 不可报名 -->
    <view v-else-if="activity && activity.status !== 'signup'" class="reg-card">
      <text class="reg-card__title">{{ activity.title }}</text>
      <text class="reg-card__desc">该活动当前不在报名中（{{ activity.status }}），无法报名。</text>
    </view>

    <template v-else-if="activity">
      <!-- 活动摘要 -->
      <view class="reg-card">
        <text class="reg-card__title">{{ activity.title }}</text>
        <text class="reg-card__meta">
          {{ activity.club_name || '未知社团' }} · {{ formatTime(activity.start_time) }} · {{ activity.location || '地点待定' }}
        </text>
        <text class="reg-card__meta">已报 {{ activity.registered_count }} / {{ activity.capacity }}</text>
      </view>

      <!-- 基础信息（自动带出，只读） -->
      <view class="reg-card reg-card--body">
        <text class="reg-card__section">报名信息</text>
        <view class="reg-row">
          <text class="reg-row__label">姓名</text>
          <text class="reg-row__value">{{ (profile && (profile.name || profile.nickname)) || '—' }}</text>
        </view>
        <view class="reg-row">
          <text class="reg-row__label">学号</text>
          <text class="reg-row__value reg-row__value--mono">{{ (profile && profile.student_no) || '未绑定' }}</text>
        </view>
        <view class="reg-row">
          <text class="reg-row__label">学院专业</text>
          <text class="reg-row__value">
            {{ (profile && [profile.college, profile.major].filter(Boolean).join(' · ')) || '—' }}
          </text>
        </view>
      </view>

      <!-- 备注 -->
      <view class="reg-card reg-card--body">
        <text class="reg-card__section">备注</text>
        <textarea
          v-model="remark"
          class="reg-remark"
          :maxlength="REMARK_MAX"
          placeholder="选填：向负责人说明的情况（不超过 200 字）"
          placeholder-class="reg-remark__ph"
        />
        <text class="reg-remark__count">{{ remark.length }} / {{ REMARK_MAX }}</text>
      </view>

      <text v-if="hint" class="reg-hint">{{ hint }}</text>

      <view class="reg-cta">
        <sb-button type="primary" block text="提交报名" loading-text="提交中" :loading="submitting" :disabled="!canSubmit" @click="submit" />
      </view>
      <text class="reg-note">
        提交后将按活动规则分发：需审核 → 待负责人通过；满员且开启候补 → 自动进入候补（有名额按报名顺序转正）；满员无候补 → 提示已满。
      </text>
    </template>
  </view>
</template>

<style lang="scss" scoped>
.reg-page {
  min-height: 100vh;
  padding: 24rpx 32rpx 48rpx;
  background: $color-bg-canvas;
  box-sizing: border-box;
}

.reg-card {
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

  &__title {
    display: block;
    font-size: $fs-h2;
    font-weight: 700;
    color: $color-text-title;
  }

  &__desc {
    display: block;
    margin-top: 16rpx;
    font-size: $fs-body;
    line-height: 1.6;
    color: $color-text-muted;
  }

  &__meta {
    display: block;
    margin-top: 10rpx;
    font-size: $fs-caption;
    color: $color-text-muted;
  }

  &__section {
    display: block;
    margin-bottom: 20rpx;
    font-size: $fs-h3;
    font-weight: 700;
    color: $color-text-title;
  }

  &__cta {
    margin-top: 28rpx;
  }
}

/* 基础信息行 */
.reg-row {
  display: flex;
  align-items: flex-start;
  gap: 16rpx;
  margin-top: 18rpx;

  &:first-of-type {
    margin-top: 0;
  }

  &__label {
    flex-shrink: 0;
    width: 112rpx;
    font-size: $fs-caption;
    color: $color-text-muted;
  }

  &__value {
    flex: 1;
    font-size: $fs-body;
    color: $color-text-body;

    &--mono {
      font-family: $font-mono;
    }
  }
}

/* 备注 */
.reg-remark {
  width: 100%;
  height: 200rpx;
  padding: 20rpx 24rpx;
  box-sizing: border-box;
  border-radius: $radius-md;
  border: 4rpx solid $memphis-dark;
  background: $color-bg-canvas;
  font-size: $fs-body;
  line-height: 1.6;
  color: $color-text-body;

  &__ph {
    color: $color-text-muted;
  }

  &__count {
    display: block;
    margin-top: 12rpx;
    font-size: $fs-caption;
    color: $color-text-muted;
    text-align: right;
  }
}

.reg-hint {
  display: block;
  margin-top: 24rpx;
  font-size: $fs-caption;
  line-height: 1.6;
  color: $color-danger;
}

.reg-cta {
  margin-top: 32rpx;
}

.reg-note {
  display: block;
  margin-top: 20rpx;
  font-size: $fs-caption;
  line-height: 1.6;
  color: $color-text-muted;
}
</style>
