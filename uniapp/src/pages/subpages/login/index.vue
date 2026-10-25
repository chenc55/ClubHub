<script>
/**
 * 登录 / 学号认证页（STU-01 / COM-01② · P1-03）
 *
 * 四态（由登录态 + 账号态推导，见 computed.step）：
 * - guest    未登录：微信授权登录（P0-06：MP 走 wx.login；H5 微信内走网页授权，外部浏览器提示仅浏览）
 * - form     已登录未认证：填「学号 + 姓名」→ 后端与 whitelist 比对 → 绑定并换发 token
 * - done     已认证：展示认证徽标 + 姓名 + 学号（脱敏）+ 学院专业，提供换绑申诉入口
 * - disabled 已禁用：仅可浏览提示（写操作由 requireActiveStudent 在服务端拦截）
 *
 * 认证失败四分支（code 2001，data.reason 区分）：
 * - not_found     学号不在白名单 → 一般申诉
 * - name_mismatch 姓名与学号不符 → 一般申诉
 * - occupied      学号已被其他微信绑定 → 学号占用申诉（appeal_type = occupy，需求 4.1.1）
 *
 * 进入方式：登录页 / 敏感操作引导 `/pages/subpages/login/index?reason=need_auth`
 */
import { login, verifyStudent } from '@/api/user'
import { useUserStore } from '@/store/user'
import { ERROR_CODE, APP_CONFIG } from '@/utils/config'

const APPEAL_PATH = '/pages/subpages/rebind-appeal/index'

export default {
  data: () => ({
    signingIn: false,
    submitting: false,
    isWechat: false,
    /** 引导来源：need_auth = 报名 / 签到 / 招新等敏感操作触发（需求 4.1.1 步骤 3） */
    reason: '',
    /** 微信授权登录失败提示 */
    loginHint: '',
    /** 认证失败提示 + 结构化原因（用于选择申诉类型） */
    verifyHint: '',
    failReason: '',
    /** 账号被禁用提示（登录被拒时展示） */
    blocked: '',
    form: { student_no: '', name: '' },
  }),

  computed: {
    userStore() {
      return useUserStore()
    },
    step() {
      const store = this.userStore
      const status = store.userInfo && store.userInfo.status
      if (this.blocked || status === 'disabled') return 'disabled'
      if (!store.hasSession) return 'guest'
      return store.isAuthenticated ? 'done' : 'form'
    },
    stepDesc() {
      return {
        guest: '登录后可完成学号认证，报名活动、提交招新报名并接收通知。',
        form: '请填写学号与姓名完成认证；认证通过后可报名活动、签到与招新。',
        done: '认证完成，可报名活动、签到与提交招新报名。',
        disabled: '账号处于禁用状态，仅可浏览，写操作已被拦截。',
      }[this.step]
    },
    badgeText() {
      return { guest: '游客态', form: '待认证', done: '认证态', disabled: '已禁用' }[this.step]
    },
    badgeClass() {
      return `auth-card__badge--${this.step}`
    },
    verifiedUser() {
      return this.userStore.userInfo || {}
    },
    maskedStudentNo() {
      const no = String(this.verifiedUser.student_no || '')
      if (!no) return '学号未绑定'
      if (no.length <= 6) return `${no.slice(0, 1)}****`
      return `${no.slice(0, 4)}****${no.slice(-2)}`
    },
    collegeMajor() {
      return [this.verifiedUser.college, this.verifiedUser.major].filter(Boolean).join(' · ') || '学院专业未同步'
    },
    canSubmit() {
      return !this.submitting && !!this.form.student_no.trim() && !!this.form.name.trim()
    },
    /** 申诉类型：学号被占用 → occupy；其余认证失败 → rebind */
    appealType() {
      return this.failReason === 'occupied' ? 'occupy' : 'rebind'
    },
    /** 开发测试登录按钮是否可见（仅 H5 且配置开启；小程序走真实 wx.login 无需此通道） */
    enableTestLogin() {
      // #ifdef H5
      return !!APP_CONFIG.ENABLE_TEST_LOGIN
      // #endif
      return false
    },
  },

  onLoad(query) {
    this.reason = (query && query.reason) || ''
    // #ifdef H5
    this.isWechat = /MicroMessenger/i.test(navigator.userAgent)
    // #endif
    // 8.4 隐私合规：登录前再次校验隐私同意（未同意弹出，仅游客浏览）
    this.$nextTick(() => this.$refs.privacy.show())
  },

  methods: {
    /** H5 微信内浏览器：跳转公众号网页授权 */
    beginWechatOAuth() {
      if (!APP_CONFIG.H5_WECHAT_APPID || !APP_CONFIG.H5_OAUTH_REDIRECT) {
        this.loginHint = '微信网页授权尚未配置，请使用微信小程序登录。'
        return false
      }
      const redirect = encodeURIComponent(APP_CONFIG.H5_OAUTH_REDIRECT)
      location.href = `https://open.weixin.qq.com/connect/oauth2/authorize?appid=${encodeURIComponent(APP_CONFIG.H5_WECHAT_APPID)}&redirect_uri=${redirect}&response_type=code&scope=snsapi_base#wechat_redirect`
      return true
    },

    /** 微信授权登录（P0-06） */
    async signIn() {
      if (this.signingIn) return
      const payload = {}
      // #ifdef MP-WEIXIN
      const result = await new Promise((resolve, reject) => wx.login({ success: resolve, fail: reject }))
      payload.code = result.code
      payload.platform = 'mp-weixin'
      // #endif
      // #ifdef H5
      if (!this.isWechat) {
        this.loginHint = '当前浏览器支持游客浏览，请在微信中打开或使用微信小程序登录。'
        return
      }
      const query = new URLSearchParams(location.search)
      if (query.get('code')) {
        payload.code = query.get('code')
        payload.platform = 'h5-wechat'
      } else {
        this.beginWechatOAuth()
        return
      }
      // #endif

      await this.doLogin(payload)
    },

    /**
     * 开发测试登录（非需求功能）：无微信凭据环境下 H5 联调用。
     * 以配置的 TEST_LOGIN_CODE 调云端 /user/login，由云端 TEST_CODE2OPENID 映射到测试 openid。
     */
    async testSignIn() {
      if (this.signingIn || !this.enableTestLogin) return
      await this.doLogin({ code: APP_CONFIG.TEST_LOGIN_CODE, platform: 'h5-wechat' })
    },

    /** 登录请求与结果处理（signIn / testSignIn 共用） */
    async doLogin(payload) {
      if (this.signingIn) return
      this.signingIn = true
      this.loginHint = ''
      this.blocked = ''
      try {
        const res = await login(payload)
        if (res.code === ERROR_CODE.FORBIDDEN) {
          // 账号被禁用：保留游客态并展示禁用说明（需求 4.1.1 异常分支）
          this.blocked = res.message || '账号已被禁用，仅可浏览'
          return
        }
        if (res.code !== ERROR_CODE.SUCCESS) {
          this.loginHint = res.message || '登录失败，请稍后重试'
          return
        }
        this.userStore.setLogin({
          token: res.data.token,
          refresh_token: res.data.refresh_token,
          userInfo: res.data.user,
          authStatus: res.data.authStatus,
        })
        this.form.student_no = ''
        this.form.name = ''
        uni.showToast({ title: this.userStore.isAuthenticated ? '已登录（认证态）' : '登录成功', icon: 'success' })
      } catch (e) {
        this.loginHint = '登录暂不可用，请稍后重试'
      } finally {
        this.signingIn = false
      }
    },

    /** 提交学号认证（P1-03） */
    async submitVerify() {
      if (!this.canSubmit) return
      this.submitting = true
      this.verifyHint = ''
      this.failReason = ''
      const res = await verifyStudent({
        student_no: this.form.student_no.trim(),
        name: this.form.name.trim(),
      })
      this.submitting = false

      if (res.code === ERROR_CODE.UNAUTHORIZED) {
        // 会话失效：回到游客态重新授权
        this.userStore.resetAuth()
        this.loginHint = '登录已过期，请重新授权登录'
        return
      }
      if (res.code !== ERROR_CODE.SUCCESS) {
        this.verifyHint = res.message || '认证失败，请稍后重试'
        this.failReason = (res.data && res.data.reason) || ''
        return
      }

      // 认证成功：换发 token 并切到认证态（refresh_token 沿用原值）
      this.userStore.setLogin({
        token: res.data.token,
        refresh_token: this.userStore.refreshToken,
        userInfo: res.data.user,
        authStatus: res.data.authStatus,
      })
      uni.showToast({ title: '认证成功', icon: 'success' })
    },

    /** 申诉入口：占用 → occupy；其余 → rebind（页面本体由 P1-05 实现） */
    goAppeal() {
      const no = (this.form.student_no || this.verifiedUser.student_no || '').trim()
      uni.navigateTo({
        url: `${APPEAL_PATH}?type=${this.appealType}${no ? `&student_no=${encodeURIComponent(no)}` : ''}`,
      })
    },

    goBack() {
      uni.navigateBack()
    },
  },
}
</script>

<template>
  <view class="auth-page">
    <!-- 敏感操作触发提示（需求 4.1.1 步骤 3） -->
    <view v-if="reason === 'need_auth'" class="auth-notice">
      <text class="auth-notice__text">该操作需要先完成学号认证</text>
    </view>

    <!-- 顶部状态卡 -->
    <view class="auth-card">
      <view class="auth-card__head">
        <text class="auth-card__title">登录 / 学号认证</text>
        <view class="auth-card__badge" :class="badgeClass">{{ badgeText }}</view>
      </view>
      <text class="auth-card__desc">{{ stepDesc }}</text>
    </view>

    <!-- 游客态：微信授权登录 -->
    <view v-if="step === 'guest'" class="auth-card auth-card--body">
      <sb-button
        type="primary"
        block
        text="微信授权登录"
        :loading="signingIn"
        loading-text="登录中"
        @click="signIn"
      />
      <sb-button
        v-if="enableTestLogin"
        type="ghost"
        block
        text="开发测试登录"
        :loading="signingIn"
        loading-text="登录中"
        @click="testSignIn"
      />
      <text v-if="loginHint" class="auth-hint">{{ loginHint }}</text>
      <text class="auth-note">未登录也可以浏览社团、活动和招新信息</text>
    </view>

    <!-- 待认证：学号 + 姓名 -->
    <view v-else-if="step === 'form'" class="auth-card auth-card--body">
      <view class="auth-field">
        <text class="auth-field__label">学号</text>
        <input
          v-model="form.student_no"
          class="auth-field__input auth-field__input--mono"
          type="text"
          maxlength="20"
          placeholder="请输入学号"
          placeholder-class="auth-field__ph"
        />
      </view>
      <view class="auth-field">
        <text class="auth-field__label">姓名</text>
        <input
          v-model="form.name"
          class="auth-field__input"
          type="text"
          maxlength="20"
          placeholder="请输入真实姓名"
          placeholder-class="auth-field__ph"
        />
      </view>

      <sb-button
        type="primary"
        block
        text="提交认证"
        loading-text="认证中"
        :loading="submitting"
        :disabled="!canSubmit"
        @click="submitVerify"
      />

      <!-- 认证失败：提示 + 申诉入口 -->
      <view v-if="verifyHint" class="auth-fail">
        <text class="auth-fail__text">{{ verifyHint }}</text>
        <sb-button type="reject" size="sm" :text="appealType === 'occupy' ? '提交学号占用申诉' : '提交申诉'" @click="goAppeal" />
      </view>

      <text class="auth-note">学号与姓名需与学校花名册一致（由管理员导入）；认证通过后学号不可自行修改。</text>
    </view>

    <!-- 已认证 -->
    <view v-else-if="step === 'done'" class="auth-card auth-card--body">
      <view class="auth-done">
        <view class="auth-done__avatar">
          <text class="auth-done__avatar-text">{{ (verifiedUser.name || verifiedUser.nickname || '星').slice(0, 1) }}</text>
        </view>
        <view class="auth-done__info">
          <view class="auth-done__row">
            <text class="auth-done__name">{{ verifiedUser.name || verifiedUser.nickname || '同学' }}</text>
            <sb-verified-badge />
          </view>
          <text class="auth-done__no">{{ maskedStudentNo }}</text>
          <text class="auth-done__college">{{ collegeMajor }}</text>
        </view>
      </view>

      <sb-button type="ghost" block text="换绑申诉" @click="goAppeal" />
      <sb-button type="ghost" block text="返回" @click="goBack" />
      <text class="auth-note">如需更换学号，请提交换绑申诉，由管理员审核后生效。</text>
    </view>

    <!-- 已禁用：仅可浏览 -->
    <view v-else class="auth-card auth-card--body">
      <view class="auth-blocked">
        <text class="auth-blocked__title">账号已被禁用</text>
        <text class="auth-blocked__text">
          {{ blocked || '当前账号已被管理员禁用，仅可浏览社团与活动；报名 / 签到 / 招新等操作已停止。' }}
        </text>
      </view>
      <text class="auth-note">如有疑问请联系社团联合会管理员。</text>
    </view>

    <!-- 隐私合规弹窗（登录前校验） -->
    <sb-privacy-popup ref="privacy" />
  </view>
</template>

<style lang="scss" scoped>
.auth-page {
  min-height: 100vh;
  padding: 32rpx;
  background: $color-bg-canvas;
  box-sizing: border-box;
}

/* 敏感操作提示条（暖阳黄） */
.auth-notice {
  margin-bottom: 24rpx;
  padding: 20rpx 28rpx;
  border-radius: $radius-md;
  border: 4rpx solid $memphis-dark;
  background: $color-warning-light;
  box-shadow: $shadow-memphis-xs;

  &__text {
    font-size: $fs-body;
    font-weight: 600;
    color: $color-text-title;
  }
}

.auth-card {
  padding: 36rpx;
  border-radius: $radius-lg;
  border: 4rpx solid $memphis-dark;
  background: $color-bg-card;
  box-shadow: $shadow-memphis-md;

  &--body {
    margin-top: 32rpx;
    border-radius: $radius-md;
    box-shadow: $shadow-memphis-sm;
  }

  &__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16rpx;
  }

  &__title {
    font-size: $fs-h1;
    font-weight: 700;
    color: $color-text-title;
  }

  &__badge {
    flex-shrink: 0;
    padding: 6rpx 24rpx;
    border-radius: 999px;
    border: 3rpx solid $memphis-dark;
    font-size: $fs-caption;
    font-weight: 700;
    color: $memphis-dark;
    box-shadow: 3rpx 3rpx 0 0 $memphis-dark;

    &--guest {
      background: $color-warning;
    }

    &--form {
      background: $color-primary-light;
      color: $color-primary;
    }

    &--done {
      background: $color-success;
    }

    &--disabled {
      border-color: $color-danger;
      background: $color-danger-light;
      color: $color-danger;
      box-shadow: 3rpx 3rpx 0 0 $color-danger;
    }
  }

  &__desc {
    display: block;
    margin-top: 16rpx;
    font-size: $fs-body;
    line-height: 1.5;
    color: $color-text-muted;
  }
}

/* 表单域 */
.auth-field {
  margin-bottom: 28rpx;

  &__label {
    display: block;
    margin-bottom: 12rpx;
    font-size: $fs-body;
    font-weight: 700;
    color: $color-text-title;
  }

  &__input {
    width: 100%;
    height: 88rpx;
    padding: 0 24rpx;
    border-radius: $radius-md;
    border: 4rpx solid $memphis-dark;
    background: $color-bg-canvas;
    box-sizing: border-box;
    font-size: $fs-body;
    color: $color-text-body;

    &--mono {
      font-family: $font-mono;
      letter-spacing: 2rpx;
    }
  }

  &__ph {
    color: $color-text-muted;
    font-size: $fs-body;
  }
}

/* 成功态信息块 */
.auth-done {
  display: flex;
  align-items: center;
  gap: 24rpx;
  margin-bottom: 32rpx;

  &__avatar {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 96rpx;
    height: 96rpx;
    border-radius: 50%;
    border: 4rpx solid $memphis-dark;
    background: $color-primary-light;
    box-shadow: $shadow-memphis-xs;
  }

  &__avatar-text {
    font-size: $fs-h2;
    font-weight: 700;
    color: $color-text-title;
  }

  &__info {
    display: flex;
    flex-direction: column;
    gap: 6rpx;
  }

  &__row {
    display: flex;
    align-items: center;
    gap: 12rpx;
  }

  &__name {
    font-size: $fs-h3;
    font-weight: 700;
    color: $color-text-title;
  }

  &__no {
    font-family: $font-mono;
    font-size: $fs-caption;
    color: $color-text-body;
  }

  &__college {
    font-size: $fs-caption;
    color: $color-text-muted;
  }
}

/* 认证失败提示块 */
.auth-fail {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 20rpx;
  margin-top: 28rpx;
  padding: 24rpx;
  border-radius: $radius-md;
  border: 4rpx solid $color-danger;
  background: $color-danger-light;

  &__text {
    font-size: $fs-body;
    line-height: 1.5;
    color: $color-danger;
  }
}

/* 禁用说明块 */
.auth-blocked {
  display: flex;
  flex-direction: column;
  gap: 16rpx;

  &__title {
    font-size: $fs-h2;
    font-weight: 700;
    color: $color-danger;
  }

  &__text {
    font-size: $fs-body;
    line-height: 1.6;
    color: $color-text-body;
  }
}

.auth-hint {
  display: block;
  margin-top: 24rpx;
  font-size: $fs-caption;
  line-height: 1.5;
  color: $color-danger;
}

.auth-note {
  display: block;
  margin-top: 28rpx;
  font-size: $fs-caption;
  line-height: 1.5;
  color: $color-text-muted;
}
</style>
