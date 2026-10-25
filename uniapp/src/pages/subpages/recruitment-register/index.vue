<script>
/**
 * 招新报名页（学生端 / STU-06 / P1-17）
 *
 * 岗位摘要 + 基础信息（姓名/学号自动带出）+ 自荐意向 + 自定义字段按 form_fields 动态渲染
 *      （单选 radio / 多选 checkbox / 问答 input）+ 必填校验；closed / 已满 / 截止禁止提交
 * 数据来源：GET /recruitment/detail、POST /recruitment/signup、getProfile（自动带出）
 * 入口：招新聚合页在招岗位 / 社团详情招新入口
 */
import { getRecruitmentDetail, signupRecruitment } from '@/api/recruitment'
import { getProfile } from '@/api/user'
import { requestSubscribe } from '@/utils/subscribe'
import { ERROR_CODE } from '@/utils/config'

export default {
  name: 'RecruitmentRegister',

  data: () => ({
    recruitmentId: '',
    loading: true,
    submitting: false,
    error: '',
    hint: '',
    recruitment: null,
    profile: null,
    formData: {},
    selfIntro: '',
    success: false,
  }),

  computed: {
    /** 是否已学号认证（报名属敏感操作，需认证态；需求 4.1.1 + 服务端 requireActiveStudent 对齐） */
    isVerified() {
      return !!(this.profile && this.profile.auth_status === 'verified')
    },
    canSubmit() {
      if (this.submitting || !this.recruitment || this.success) return false
      if (!this.isVerified) return false
      if (this.recruitment.status !== 'open') return false
      if (this.recruitment.deadline_passed === true) return false
      if (this.recruitment.full === true) return false
      return true
    },
  },

  onLoad(query) {
    this.recruitmentId = (query && query.id) || ''
    if (!this.recruitmentId) {
      this.loading = false
      this.error = '缺少岗位参数，请从招新列表重新进入'
      return
    }
    this.load()
  },

  /** 小程序转发分享（P3-01 / COM-06）：卡片 = 岗位标题 + 平台 Logo（岗位无封面） */
  onShareAppMessage() {
    const r = this.recruitment
    return {
      title: (r && r.title) || '社团星球 · 招新',
      imageUrl: '/static/logo.png',
      path: `/pages/subpages/recruitment-register/index?id=${this.recruitmentId}`,
    }
  },

  methods: {
    async load() {
      this.loading = true
      this.error = ''
      const [detailRes, profileRes] = await Promise.all([
        getRecruitmentDetail(this.recruitmentId),
        getProfile().catch(() => null),
      ])
      this.loading = false
      if (detailRes.code !== ERROR_CODE.SUCCESS || !detailRes.data || !detailRes.data.recruitment) {
        this.error = detailRes.message || '岗位加载失败，请稍后重试'
        return
      }
      this.recruitment = detailRes.data.recruitment
      this.profile = (profileRes && profileRes.data && profileRes.data.user) || profileRes && profileRes.data || null
      // 初始化动态字段值
      const data = {}
      for (const field of this.recruitment.form_fields || []) {
        if (field.type === 'multi') data[field.key] = []
        else data[field.key] = field.type === 'single' ? '' : ''
      }
      this.formData = data
    },

    toggleMulti(field, option) {
      const list = this.formData[field.key] || []
      const idx = list.indexOf(option)
      if (idx === -1) list.push(option)
      else list.splice(idx, 1)
      this.formData[field.key] = list.slice()
    },

    validate() {
      for (const field of this.recruitment.form_fields || []) {
        const value = this.formData[field.key]
        if (field.required && (value == null || String(value).trim() === '' || (Array.isArray(value) && value.length === 0))) {
          this.hint = `请填写「${field.label}」`
          return false
        }
      }
      this.hint = ''
      return true
    },

    async submit() {
      if (!this.validate() || this.submitting) return
      this.submitting = true

      // 订阅授权（V-11：提交招新报名时机）
      requestSubscribe('recruitment_signup')

      const res = await signupRecruitment({
        recruitment_id: this.recruitmentId,
        form_data: this.formData,
        self_intro: this.selfIntro.trim(),
      })
      this.submitting = false
      if (res.code !== ERROR_CODE.SUCCESS) {
        this.hint = res.message || '报名失败，请稍后重试'
        return
      }
      this.success = true
      uni.showToast({ title: '报名提交成功', icon: 'success' })
      setTimeout(() => uni.navigateBack(), 1200)
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
      return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    },

    /** H5 分享降级：复制当前页链接（P3-01；小程序端用右上角菜单转发） */
    copyLink() {
      uni.setClipboardData({
        data: `${location.origin}${location.pathname}?id=${this.recruitmentId}`,
        success: () => uni.showToast({ title: '链接已复制', icon: 'success' }),
      })
    },
  },
}
</script>

<template>
  <view class="rre-page">
    <!-- 加载态 -->
    <view v-if="loading" class="rre-card">
      <sb-skeleton :rows="4" />
    </view>

    <!-- 失败态 -->
    <view v-else-if="error" class="rre-card">
      <sb-error :text="error" @retry="load" />
    </view>

    <template v-else>
      <!-- 岗位摘要 -->
      <view class="rre-card">
        <text class="rre-card__title">{{ recruitment.title }}</text>
        <text class="rre-card__meta">{{ recruitment.club_name || '未知社团' }} · 报名截止 {{ formatTime(recruitment.signup_end) }}</text>
        <text v-if="recruitment.multi_step" class="rre-card__tag">多步招新（含面试）</text>
        <!-- H5 分享降级：复制链接（P3-01；小程序端右上角菜单转发） -->
        <!-- #ifdef H5 -->
        <view class="rre-share" @tap="copyLink">
          <text class="rre-share__icon">⧉</text>
          <text class="rre-share__text">复制链接分享</text>
        </view>
        <!-- #endif -->
      </view>

      <!-- 基础信息 -->
      <view class="rre-card">
        <text class="rre-card__section">基础信息</text>
        <view class="rre-field">
          <text class="rre-field__label">姓名</text>
          <text class="rre-field__text">{{ (profile && profile.name) || '—' }}</text>
        </view>
        <view class="rre-field">
          <text class="rre-field__label">学号</text>
          <text class="rre-field__text">{{ (profile && profile.student_no) || '—' }}</text>
        </view>
      </view>

      <!-- 自定义报名表 -->
      <view class="rre-card">
        <text class="rre-card__section">报名信息</text>
        <view v-for="field in recruitment.form_fields" :key="field.key" class="rre-field">
          <text class="rre-field__label">
            {{ field.label }}<text v-if="field.required" class="rre-field__req">*</text>
          </text>

          <!-- 单选 -->
          <view v-if="field.type === 'single'" class="rre-options">
            <view
              v-for="opt in field.options"
              :key="opt"
              class="rre-option"
              :class="{ 'rre-option--on': formData[field.key] === opt }"
              @tap="formData[field.key] = opt"
            >
              {{ opt }}
            </view>
          </view>

          <!-- 多选 -->
          <view v-else-if="field.type === 'multi'" class="rre-options">
            <view
              v-for="opt in field.options"
              :key="opt"
              class="rre-option"
              :class="{ 'rre-option--on': (formData[field.key] || []).indexOf(opt) !== -1 }"
              @tap="toggleMulti(field, opt)"
            >
              {{ opt }}
            </view>
          </view>

          <!-- 问答 -->
          <input
            v-else
            v-model="formData[field.key]"
            class="rre-input"
            type="text"
            :maxlength="200"
            :placeholder="field.required ? '请填写' : '选填'"
          />
        </view>

        <view class="rre-field">
          <text class="rre-field__label">自荐 / 意向</text>
          <textarea v-model="selfIntro" class="rre-textarea" :maxlength="500" placeholder="介绍自己、表达加入意向（选填）" />
        </view>
      </view>

      <text v-if="hint" class="rre-hint">{{ hint }}</text>

      <!-- 提交 / 禁用态 -->
      <view v-if="canSubmit" class="rre-actions">
        <sb-button type="primary" block :text="submitting ? '提交中…' : '提交报名'" :loading="submitting" @click="submit" />
      </view>
      <view v-else class="rre-disabled">
        <sb-button v-if="!isVerified" type="ghost" block text="先登录 / 学号认证" @click="goLogin" />
        <text v-else class="rre-disabled__text">{{ success ? '报名成功' : '该岗位当前不可报名' }}</text>
      </view>
    </template>
  </view>
</template>

<style lang="scss" scoped>
.rre-page {
  min-height: 100vh;
  padding: 24rpx 32rpx 48rpx;
  background: $color-bg-canvas;
  box-sizing: border-box;
}

.rre-card {
  margin-top: 24rpx;
  padding: 32rpx;
  border-radius: $radius-md;
  border: 4rpx solid $memphis-dark;
  background: $color-bg-card;
  box-shadow: $shadow-memphis-sm;

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

  &__tag {
    display: inline-block;
    margin-top: 12rpx;
    padding: 4rpx 14rpx;
    border-radius: 999rpx;
    border: 3rpx solid $memphis-dark;
    background: $color-info-light;
    font-size: $fs-caption;
    color: $color-info-text;
  }

  /* H5 分享降级：复制链接（P3-01） */
  &__share {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8rpx;
    margin-top: 20rpx;
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
      color: $color-text-muted;
    }
  }

  &__section {
    display: block;
    margin-bottom: 8rpx;
    font-size: $fs-h3;
    font-weight: 700;
    color: $color-text-title;
  }
}

.rre-field {
  margin-top: 24rpx;

  &__label {
    display: block;
    margin-bottom: 10rpx;
    font-size: $fs-caption;
    font-weight: 700;
    color: $color-text-body;
  }

  &__req {
    margin-left: 4rpx;
    color: $color-danger;
  }

  &__text {
    font-size: $fs-body;
    color: $color-text-body;
  }
}

.rre-options {
  display: flex;
  gap: 12rpx;
  flex-wrap: wrap;

  .rre-option {
    padding: 12rpx 24rpx;
    border-radius: 999rpx;
    border: 3rpx solid $memphis-dark;
    background: $color-bg-canvas;
    font-size: $fs-body;
    color: $color-text-body;

    &--on {
      background: $color-primary;
      color: #ffffff;
    }
  }
}

.rre-input {
  width: 100%;
  padding: 16rpx 20rpx;
  border-radius: $radius-sm;
  border: 3rpx solid $memphis-dark;
  background: $color-bg-canvas;
  font-size: $fs-body;
  box-sizing: border-box;
}

.rre-textarea {
  width: 100%;
  height: 160rpx;
  padding: 16rpx 20rpx;
  border-radius: $radius-sm;
  border: 3rpx solid $memphis-dark;
  background: $color-bg-canvas;
  font-size: $fs-body;
  box-sizing: border-box;
}

.rre-hint {
  display: block;
  margin-top: 20rpx;
  padding: 16rpx 20rpx;
  border-radius: $radius-sm;
  background: $color-danger-light;
  font-size: $fs-caption;
  color: $color-danger;
}

.rre-actions {
  margin-top: 32rpx;
}

.rre-disabled {
  margin-top: 32rpx;
  text-align: center;

  &__text {
    font-size: $fs-body;
    color: $color-text-muted;
  }
}
</style>