<script>
/**
 * 签到管理（负责人端 / CLB-03③ / P1-14）
 *
 * 内容：动态二维码（60s 倒计时自动刷新，防截图代签）+ 口令展示 + 签到时段 / 方式 / 定位配置
 *       + 代签 / 补签（按学号，活动进行中 + 结束后 24h 内）+ 签到名单（已签 / 未签统计）
 * 数据来源：GET /activity/detail + POST /activity/checkin/config、/checkin/qr-refresh、
 *          /checkin/manual、GET /activity/checkin/list
 * 进入方式：活动管理行操作「签到管理」
 */
import uQRCode from 'uqrcodejs'
import { getActivityDetail, checkinConfig, checkinQrRefresh, checkinManual, getCheckinList } from '@/api/activity'
import { ERROR_CODE } from '@/utils/config'

const METHOD_OPTIONS = [
  { value: 'qrcode', label: '扫码' },
  { value: 'password', label: '口令' },
  { value: 'geofence', label: '定位' },
]
const QR_TTL_MS = 60 * 1000

export default {
  name: 'CheckinManage',

  data: () => ({
    activityId: '',
    loading: true,
    saving: false,
    error: '',
    hint: '',
    activity: null,
    cfg: null,
    /** 二维码 60s 倒计时 */
    qrCountdown: 60,
    countdownTimer: null,
    /** 配置表单 */
    methods: ['qrcode'],
    password: '',
    geo: { lat: '', lng: '', radius_m: '' },
    /** 代签表单 */
    manualNo: '',
    manualing: false,
    /** 名单 */
    list: [],
    listTotal: 0,
    checkedCount: 0,
    uncheckedCount: 0,
    listLoading: false,
    /** 签到方式选项（模板需实例属性） */
    methodOptions: METHOD_OPTIONS,
  }),

  computed: {
    qrToken() {
      return (this.cfg && this.cfg.qr_token) || ''
    },
  },

  onLoad(query) {
    this.activityId = (query && query.id) || ''
    if (!this.activityId) {
      this.loading = false
      this.error = '缺少活动参数，请从活动管理重新进入'
      return
    }
    this.load()
  },

  onUnload() {
    clearInterval(this.countdownTimer)
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
      const cfg = (this.activity.signin_config) || {}
      this.methods = Array.isArray(cfg.methods) && cfg.methods.length ? cfg.methods : ['qrcode']
      this.password = cfg.password || ''
      this.geo = Object.assign({ lat: '', lng: '', radius_m: '' }, cfg.geo || {})
      this.applyCfg(cfg)
      this.loadList()
      this.startCountdown()
    },

    applyCfg(cfg) {
      this.cfg = {
        methods: Array.isArray(cfg.methods) && cfg.methods.length ? cfg.methods : ['qrcode'],
        qr_token: cfg.qr_token || '',
        qr_expires_at: cfg.qr_expires_at || null,
        password: cfg.password || '',
        geo: cfg.geo || null,
        signin_start: cfg.signin_start || null,
        signin_end: cfg.signin_end || null,
      }
      this.$nextTick(() => this.drawQr(this.qrToken))
      const left = this.cfg.qr_expires_at
        ? Math.max(0, Math.ceil((new Date(this.cfg.qr_expires_at).getTime() - Date.now()) / 1000))
        : 0
      this.qrCountdown = Math.max(1, left)
    },

    startCountdown() {
      clearInterval(this.countdownTimer)
      this.countdownTimer = setInterval(() => {
        this.qrCountdown -= 1
        if (this.qrCountdown <= 0) this.refreshQr()
      }, 1000)
    },

    /** 绘制动态二维码（canvas type=2d，内容为 token；uqrcodejs 4.x 实例 API） */
    drawQr(text) {
      if (!text) return
      const size = 220
      const render = (ctx) => {
        const qr = new uQRCode({ data: text, size, errorCorrectLevel: uQRCode.errorCorrectLevel.M })
        qr.make()
        const cell = size / qr.moduleCount
        ctx.clearRect(0, 0, size, size)
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, size, size)
        ctx.fillStyle = '#222222'
        for (let i = 0; i < qr.moduleCount; i += 1) {
          for (let j = 0; j < qr.moduleCount; j += 1) {
            if (qr.modules[i][j].isBlack) ctx.fillRect(j * cell, i * cell, cell, cell)
          }
        }
      }
      // #ifdef H5
      // uni-app H5 下 canvas 编译为 <uni-canvas> 外层 + 内层真实 canvas，取内层可绘制节点
      const canvas = document.querySelector('#ck-qr-canvas canvas') || document.querySelector('#ck-qr-canvas')
      if (canvas && canvas.getContext) render(canvas.getContext('2d'))
      // #endif
      // #ifndef H5
      const query = uni.createSelectorQuery().in(this)
      query
        .select('#ck-qr-canvas')
        .fields({ node: true, size: true })
        .exec((res) => {
          const node = res && res[0] && res[0].node
          if (!node) return
          const ctx = node.getContext('2d')
          const dpr = uni.getSystemInfoSync().pixelRatio || 2
          node.width = size * dpr
          node.height = size * dpr
          ctx.scale(dpr, dpr)
          render(ctx)
        })
      // #endif
    },

    async refreshQr() {
      const res = await checkinQrRefresh(this.activityId)
      if (res.code === ERROR_CODE.SUCCESS && res.data && res.data.signin_config) {
        this.applyCfg(res.data.signin_config)
      } else {
        this.qrCountdown = 5
      }
    },

    toggleMethod(value) {
      const idx = this.methods.indexOf(value)
      if (idx === -1) this.methods.push(value)
      else if (this.methods.length > 1) this.methods.splice(idx, 1)
    },

    async saveConfig() {
      this.saving = true
      this.hint = ''
      const geo =
        this.methods.indexOf('geofence') !== -1 && this.geo.lat !== '' && this.geo.lng !== '' && this.geo.radius_m !== ''
          ? { lat: Number(this.geo.lat), lng: Number(this.geo.lng), radius_m: Number(this.geo.radius_m) }
          : null
      const res = await checkinConfig({
        activity_id: this.activityId,
        methods: this.methods,
        password: this.password.trim(),
        geo,
      })
      this.saving = false
      if (res.code !== ERROR_CODE.SUCCESS) {
        this.hint = res.message || '保存失败，请稍后重试'
        return
      }
      uni.showToast({ title: '签到配置已保存', icon: 'none' })
      if (res.data && res.data.signin_config) this.applyCfg(res.data.signin_config)
    },

    async loadList() {
      this.listLoading = true
      const res = await getCheckinList({ activity_id: this.activityId })
      this.listLoading = false
      if (res.code !== ERROR_CODE.SUCCESS) return
      this.list = (res.data && res.data.list) || []
      this.listTotal = (res.data && res.data.total) || 0
      this.checkedCount = (res.data && res.data.checked_count) || 0
      this.uncheckedCount = (res.data && res.data.unchecked_count) || 0
    },

    async doManual() {
      const no = this.manualNo.trim()
      if (!no) {
        this.hint = '请输入学号'
        return
      }
      this.manualing = true
      this.hint = ''
      const res = await checkinManual({ activity_id: this.activityId, student_no: no })
      this.manualing = false
      if (res.code !== ERROR_CODE.SUCCESS) {
        this.hint = res.message || '代签失败'
        return
      }
      uni.showToast({ title: '代签 / 补签成功', icon: 'none' })
      this.manualNo = ''
      this.loadList()
    },

    formatTime(value) {
      if (!value) return '—'
      const raw = typeof value === 'object' && value.$date ? value.$date : value
      const date = new Date(raw)
      if (Number.isNaN(date.getTime())) return '—'
      const pad = (n) => String(n).padStart(2, '0')
      return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    },
  },
}
</script>

<template>
  <view class="ckm-page">
    <!-- 加载态 -->
    <view v-if="loading" class="ckm-card">
      <sb-skeleton :rows="5" />
    </view>

    <!-- 失败态 -->
    <view v-else-if="error" class="ckm-card">
      <sb-error :text="error" @retry="load" />
    </view>

    <template v-else-if="activity">
      <!-- 活动摘要 -->
      <view class="ckm-head">
        <text class="ckm-head__title">{{ activity.title }}</text>
        <text class="ckm-head__meta">{{ activity.status }} · {{ formatTime(activity.start_time) }}</text>
      </view>

      <!-- 动态二维码 -->
      <view class="ckm-card ckm-card--center">
        <view class="ckm-qr">
          <canvas id="ck-qr-canvas" type="2d" class="ckm-qr__canvas" />
          <view class="ckm-qr__count">{{ qrCountdown }}s 后自动刷新</view>
        </view>
        <sb-button type="primary" size="sm" text="立即刷新二维码" @click="refreshQr" />
        <text class="ckm-tip">动态二维码每 60 秒自动刷新，防截图代签；学生用「扫码签到」扫描</text>
      </view>

      <!-- 签到配置 -->
      <view class="ckm-card">
        <text class="ckm-card__section">签到配置</text>
        <view class="ckm-methods">
          <view
            v-for="item in methodOptions"
            :key="item.value"
            class="ckm-method"
            :class="{ 'ckm-method--on': methods.indexOf(item.value) !== -1 }"
            @tap="toggleMethod(item.value)"
          >
            {{ item.label }}
          </view>
        </view>

        <view v-if="methods.indexOf('password') !== -1" class="ckm-field">
          <text class="ckm-field__label">口令</text>
          <input v-model="password" class="ckm-input" type="text" :maxlength="12" placeholder="4~12 位口令" />
        </view>

        <view v-if="methods.indexOf('geofence') !== -1" class="ckm-field">
          <text class="ckm-field__label">定位中心（纬度 / 经度 / 半径米）</text>
          <view class="ckm-geo">
            <input v-model="geo.lat" class="ckm-input ckm-input--sm" type="digit" placeholder="纬度" />
            <input v-model="geo.lng" class="ckm-input ckm-input--sm" type="digit" placeholder="经度" />
            <input v-model="geo.radius_m" class="ckm-input ckm-input--sm" type="number" placeholder="半径" />
          </view>
        </view>

        <view class="ckm-btn">
          <sb-button type="primary" block text="保存配置" :loading="saving" @click="saveConfig" />
        </view>
      </view>

      <!-- 代签 / 补签 -->
      <view class="ckm-card">
        <text class="ckm-card__section">代签 / 补签</text>
        <view class="ckm-field">
          <input v-model="manualNo" class="ckm-input" type="text" :maxlength="32" placeholder="输入学生学号" />
        </view>
        <view class="ckm-btn">
          <sb-button type="reject" block :text="manualing ? '处理中…' : '代签 / 补签'" @click="doManual" />
        </view>
        <text class="ckm-tip">仅活动进行中或结束后 24 小时内可代签；已报名（通过）用户方可签到</text>
      </view>

      <!-- 签到名单 -->
      <view class="ckm-card">
        <text class="ckm-card__section">签到名单（{{ checkedCount }} / {{ listTotal }} 已签）</text>
        <view v-if="listLoading" class="ckm-more">加载中…</view>
        <view v-else-if="list.length === 0" class="ckm-empty">暂无已报名成员</view>
        <view v-else>
          <view v-for="row in list" :key="row.registration_id" class="ckm-row">
            <view class="ckm-row__main">
              <text class="ckm-row__name">{{ row.name }}</text>
              <text class="ckm-row__no">{{ row.student_no_masked || row.student_no }}</text>
            </view>
            <text v-if="row.checked_in" class="ckm-row__state ckm-row__state--ok">
              {{ row.signin_method === 'manual' ? '代签' : '已签' }}
            </text>
            <text v-else class="ckm-row__state">未签</text>
          </view>
          <text v-if="uncheckedCount > 0" class="ckm-tip">还有 {{ uncheckedCount }} 人未签到</text>
        </view>
      </view>

      <text v-if="hint" class="ckm-hint">{{ hint }}</text>
    </template>
  </view>
</template>

<style lang="scss" scoped>
.ckm-page {
  min-height: 100vh;
  padding: 24rpx 32rpx 48rpx;
  background: $color-bg-canvas;
  box-sizing: border-box;
}

.ckm-head {
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

.ckm-card {
  margin-top: 24rpx;
  padding: 32rpx;
  border-radius: $radius-md;
  border: 4rpx solid $memphis-dark;
  background: $color-bg-card;
  box-shadow: $shadow-memphis-sm;

  &--center {
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  &__section {
    display: block;
    margin-bottom: 20rpx;
    font-size: $fs-h3;
    font-weight: 700;
    color: $color-text-title;
  }
}

.ckm-qr {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12rpx;
  padding: 24rpx;
  border-radius: $radius-md;
  border: 4rpx solid $memphis-dark;
  background: #ffffff;

  &__canvas {
    width: 220px;
    height: 220px;
  }

  &__count {
    padding: 4rpx 20rpx;
    border-radius: $radius-full;
    background: $color-warning;
    color: $memphis-dark;
    font-size: $fs-caption;
    font-weight: 700;
  }
}

.ckm-tip {
  display: block;
  margin-top: 16rpx;
  font-size: $fs-caption;
  line-height: 1.6;
  color: $color-text-muted;
}

.ckm-methods {
  display: flex;
  gap: 16rpx;
}

.ckm-method {
  flex: 1;
  padding: 16rpx 0;
  border-radius: $radius-sm;
  border: 3rpx solid $memphis-dark;
  background: $color-bg-canvas;
  color: $color-text-muted;
  font-size: $fs-caption;
  font-weight: 600;
  text-align: center;
  @include press-active;

  &--on {
    background: $color-primary;
    color: #ffffff;
  }
}

.ckm-field {
  margin-top: 20rpx;

  &__label {
    display: block;
    margin-bottom: 10rpx;
    font-size: $fs-caption;
    color: $color-text-muted;
  }
}

.ckm-input {
  width: 100%;
  height: 80rpx;
  padding: 0 24rpx;
  box-sizing: border-box;
  border-radius: $radius-sm;
  border: 4rpx solid $memphis-dark;
  background: $color-bg-canvas;
  font-size: $fs-body;
  color: $color-text-body;

  &--sm {
    flex: 1;
  }
}

.ckm-geo {
  display: flex;
  gap: 12rpx;
}

.ckm-btn {
  margin-top: 24rpx;
}

.ckm-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
  padding: 16rpx 0;
  border-top: 2rpx solid $color-border-light;

  &__main {
    display: flex;
    align-items: center;
    gap: 16rpx;
  }

  &__name {
    font-size: $fs-body;
    font-weight: 600;
    color: $color-text-title;
  }

  &__no {
    font-family: $font-mono;
    font-size: $fs-caption;
    color: $color-text-muted;
  }

  &__state {
    font-size: $fs-caption;
    color: $color-text-muted;

    &--ok {
      color: $color-success;
      font-weight: 700;
    }
  }
}

.ckm-more {
  padding: 24rpx 0;
  text-align: center;
  font-size: $fs-caption;
  color: $color-text-muted;
}

.ckm-empty {
  padding: 24rpx 0;
  text-align: center;
  font-size: $fs-caption;
  color: $color-text-muted;
}

.ckm-hint {
  display: block;
  margin-top: 24rpx;
  font-size: $fs-caption;
  color: $color-danger;
}
</style>
