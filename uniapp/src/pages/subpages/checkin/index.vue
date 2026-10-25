<script>
/**
 * 学生签到（STU-05 / P1-14）
 *
 * 方式：扫码（uni.scanCode 解析动态二维码 token）/ 口令输入 / 定位签到（uni.getLocation）
 * 校验（服务端）：活动 ongoing + 签到时段 + 方式启用 + 凭证正确 + 未报名拦截
 * （allow_onsite → 现场补报占用剩余名额后可签）+ 重复签到拦截（以第一次为准）
 * 数据来源：GET /activity/detail（活动信息）+ POST /activity/checkin
 * 进入方式：活动详情「进行中 → 签到入口」、我的报名签到状态
 */
import { getActivityDetail, checkin } from '@/api/activity'
import { ERROR_CODE } from '@/utils/config'

const METHODS = [
  { value: 'qrcode', label: '扫码签到', desc: '扫描负责人动态二维码' },
  { value: 'password', label: '口令签到', desc: '输入负责人公布的口令' },
  { value: 'geofence', label: '定位签到', desc: '在活动地点范围内定位签到' },
]

export default {
  name: 'CheckinPage',

  data: () => ({
    activityId: '',
    loading: true,
    submitting: false,
    error: '',
    hint: '',
    activity: null,
    method: 'qrcode',
    code: '',
    location: null,
    success: false,
  }),

  computed: {
    methodOptions() {
      const cfg = this.activity && this.activity.signin_config
      const enabled = (cfg && Array.isArray(cfg.methods) && cfg.methods.length) ? cfg.methods : ['qrcode']
      return METHODS.filter((m) => enabled.indexOf(m.value) !== -1)
    },
    canSubmit() {
      if (this.submitting || !this.activity || this.success) return false
      if (this.method === 'password') return !!this.code.trim()
      return true
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

  onUnload() {
    this.stopTimer && this.stopTimer()
  },

  methods: {
    async load() {
      this.loading = true
      this.error = ''
      const res = await getActivityDetail(this.activityId)
      this.loading = false
      if (res.code !== ERROR_CODE.SUCCESS || !res.data || !res.data.activity) {
        this.error = res.message || '活动加载失败，请稍后重试'
        return
      }
      this.activity = res.data.activity
    },

    /** 扫码：解析动态二维码 token 作为凭证 */
    scan() {
      // #ifdef H5
      this.hint = 'H5 环境请使用口令或定位签到（真机扫码走小程序）'
      this.method = 'password'
      // #endif
      // #ifndef H5
      uni.scanCode({
        success: (res) => {
          const token = (res.result || '').trim()
          if (!token) {
            this.hint = '未识别到二维码内容，请重试'
            return
          }
          this.submitWith('qrcode', { code: token })
        },
        fail: () => {
          this.hint = '扫码取消'
        },
      })
      // #endif
    },

    /** 定位：获取坐标后提交 */
    locate() {
      uni.getLocation({
        type: 'gcj02',
        success: (res) => {
          this.location = { lat: res.latitude, lng: res.longitude }
          this.submitWith('geofence', { lat: res.latitude, lng: res.longitude })
        },
        fail: () => {
          this.hint = '获取定位失败，请检查位置权限后重试'
        },
      })
    },

    submitWith(method, extra) {
      this.doSubmit(Object.assign({ activity_id: this.activityId, method }, extra))
    },

    onPasswordSubmit() {
      this.doSubmit({ activity_id: this.activityId, method: 'password', code: this.code.trim() })
    },

    async doSubmit(payload) {
      if (this.submitting) return
      this.submitting = true
      this.hint = ''
      const res = await checkin(payload)
      this.submitting = false
      if (res.code !== ERROR_CODE.SUCCESS) {
        this.hint = res.message || '签到失败，请稍后重试'
        return
      }
      this.success = true
      const onsite = res.data && res.data.onsite
      uni.showToast({ title: onsite ? '现场补报成功并签到' : '签到成功', icon: 'success' })
      setTimeout(() => uni.navigateBack(), 1200)
    },

    formatTime(value) {
      if (!value) return '时间待定'
      const raw = typeof value === 'object' && value.$date ? value.$date : value
      const date = new Date(raw)
      if (Number.isNaN(date.getTime())) return '时间待定'
      const pad = (n) => String(n).padStart(2, '0')
      return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    },
  },
}
</script>

<template>
  <view class="ck-page">
    <!-- 加载骨架（脉冲波形） -->
    <view v-if="loading" class="ck-card ck-card--pulse">
      <view class="ck-skeleton ck-skeleton--title" />
      <view class="ck-skeleton ck-skeleton--qr" />
      <view class="ck-skeleton ck-skeleton--line" />
      <view class="ck-skeleton ck-skeleton--btn" />
    </view>

    <!-- 失败态 -->
    <view v-else-if="error" class="ck-card">
      <sb-error :text="error" @retry="load" />
    </view>

    <template v-else-if="activity">
      <view class="ck-head">
        <text class="ck-head__title">{{ activity.title }}</text>
        <text class="ck-head__meta">{{ activity.club_name || '' }} · {{ formatTime(activity.start_time) }}</text>
      </view>

      <!-- 方式选择 -->
      <view class="ck-methods">
        <view
          v-for="item in methodOptions"
          :key="item.value"
          class="ck-method"
          :class="{ 'ck-method--active': method === item.value }"
          @tap="method = item.value"
        >
          <text class="ck-method__label">{{ item.label }}</text>
          <text class="ck-method__desc">{{ item.desc }}</text>
        </view>
      </view>

      <!-- 扫码 -->
      <view v-if="method === 'qrcode'" class="ck-card">
        <sb-button type="primary" block :text="submitting ? '签到中…' : '扫一扫' " :disabled="submitting || success" @click="scan" />
        <text class="ck-tip">请扫描负责人在「签到管理」展示的动态二维码</text>
      </view>

      <!-- 口令 -->
      <view v-else-if="method === 'password'" class="ck-card">
        <input v-model="code" class="ck-input" type="text" :maxlength="16" placeholder="输入签到口令" placeholder-class="ck-input__ph" />
        <view class="ck-btn">
          <sb-button type="primary" block text="提交口令" :disabled="!canSubmit" :loading="submitting" @click="onPasswordSubmit" />
        </view>
      </view>

      <!-- 定位 -->
      <view v-else class="ck-card">
        <sb-button type="primary" block :text="submitting ? '签到中…' : '定位签到'" :disabled="submitting || success" @click="locate" />
        <text class="ck-tip">需在活动地点范围内，并允许获取位置权限</text>
      </view>

      <!-- 成功态 -->
      <view v-if="success" class="ck-success">
        <sb-illustration icon="check" tone="success" />
        <text class="ck-success__text">签到成功</text>
      </view>

      <text v-else-if="hint" class="ck-hint">{{ hint }}</text>
    </template>
  </view>
</template>

<style lang="scss" scoped>
.ck-page {
  min-height: 100vh;
  padding: 24rpx 32rpx 48rpx;
  background: $color-bg-canvas;
  box-sizing: border-box;
}

.ck-head {
  padding: 28rpx 32rpx;
  border-radius: $radius-lg;
  border: 4rpx solid $memphis-dark;
  background: $color-bg-card;
  box-shadow: $shadow-memphis-md;

  &__title {
    display: block;
    font-size: $fs-h2;
    font-weight: 700;
    color: $color-text-title;
  }

  &__meta {
    display: block;
    margin-top: 10rpx;
    font-size: $fs-caption;
    color: $color-text-muted;
  }
}

/* 方式选择 */
.ck-methods {
  display: flex;
  gap: 16rpx;
  margin-top: 24rpx;
}

.ck-method {
  flex: 1;
  padding: 20rpx 16rpx;
  border-radius: $radius-md;
  border: 4rpx solid $memphis-dark;
  background: $color-bg-card;
  box-shadow: $shadow-memphis-xs;
  @include press-active;

  &--active {
    background: $color-primary;
    border-color: $memphis-dark;

    .ck-method__label,
    .ck-method__desc {
      color: #ffffff;
    }
  }

  &__label {
    display: block;
    font-size: $fs-caption;
    font-weight: 700;
    color: $color-text-title;
    text-align: center;
  }

  &__desc {
    display: block;
    margin-top: 6rpx;
    font-size: 18rpx;
    color: $color-text-muted;
    text-align: center;
    line-height: 1.4;
  }
}

.ck-card {
  margin-top: 24rpx;
  padding: 32rpx;
  border-radius: $radius-md;
  border: 4rpx solid $memphis-dark;
  background: $color-bg-card;
  box-shadow: $shadow-memphis-sm;
}

.ck-input {
  width: 100%;
  height: 88rpx;
  padding: 0 24rpx;
  box-sizing: border-box;
  border-radius: $radius-sm;
  border: 4rpx solid $memphis-dark;
  background: $color-bg-canvas;
  font-size: $fs-body;
  color: $color-text-body;

  &__ph {
    color: $color-text-muted;
  }
}

.ck-btn {
  margin-top: 24rpx;
}

.ck-tip {
  display: block;
  margin-top: 20rpx;
  font-size: $fs-caption;
  line-height: 1.6;
  color: $color-text-muted;
  text-align: center;
}

.ck-hint {
  display: block;
  margin-top: 24rpx;
  font-size: $fs-caption;
  line-height: 1.6;
  color: $color-danger;
}

.ck-success {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-top: 24rpx;
  padding: 32rpx;
  border-radius: $radius-lg;
  border: 4rpx solid $color-success;
  background: $color-bg-card;

  &__text {
    margin-top: 16rpx;
    font-size: $fs-h3;
    font-weight: 700;
    color: $color-success;
  }
}

/* 骨架脉冲 */
.ck-card--pulse {
  display: flex;
  flex-direction: column;
  gap: 24rpx;
}

.ck-skeleton {
  border-radius: $radius-sm;
  background: linear-gradient(90deg, $color-bg-canvas 25%, $color-warning-light 50%, $color-bg-canvas 75%);
  background-size: 200% 100%;
  animation: ckPulse 1.4s infinite;

  &--title {
    height: 40rpx;
    width: 60%;
  }

  &--qr {
    height: 320rpx;
    width: 320rpx;
    align-self: center;
    border-radius: $radius-md;
  }

  &--line {
    height: 24rpx;
    width: 80%;
  }

  &--btn {
    height: 88rpx;
    border-radius: $radius-full;
  }
}

@keyframes ckPulse {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}
</style>
