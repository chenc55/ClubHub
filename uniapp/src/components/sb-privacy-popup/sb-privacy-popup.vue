<script>
/**
 * 隐私合规弹窗（P1-24 / 8.4 隐私与合规）
 *
 * 首次进入 App 弹出征求「隐私政策 / 用户协议」同意；未同意时仅可游客浏览。
 * 同意状态落本地 storage（clubhub_privacy_agreed = '1'）；`show()` 幂等——已同意不弹。
 * 用法（easycom 自动注册）：
 *   <sb-privacy-popup ref="privacy" @deny="..." />
 *   this.$refs.privacy.show()   // 需要时手动唤起（如登录前再次校验）
 * 事件：@agree（已同意） / @deny（点击「不同意 / 仅浏览」）
 */
const AGREED_KEY = 'clubhub_privacy_agreed'

export default {
  name: 'SbPrivacyPopup',

  data: () => ({
    visible: false,
  }),

  methods: {
    hasAgreed() {
      try {
        return uni.getStorageSync(AGREED_KEY) === '1'
      } catch (e) {
        return false
      }
    },

    /** 可读性展示：已同意直接返回 true；未同意弹出并返回 false */
    show() {
      if (this.hasAgreed()) return true
      this.visible = true
      return false
    },

    onAgree() {
      try {
        uni.setStorageSync(AGREED_KEY, '1')
      } catch (e) {
        /* 存储异常不做兜底，本次会话内仍放行 */
      }
      this.visible = false
      this.$emit('agree')
    },

    /** 不同意 → 仅游客浏览（记录 denied 供页面引导，再次进入仍可弹） */
    onDeny() {
      this.visible = false
      this.$emit('deny')
    },

    openStatic(type) {
      uni.navigateTo({ url: `/pages/subpages/static-page/index?type=${type}` })
    },
  },
}
</script>

<template>
  <view v-if="visible" class="pp-mask" @tap.stop>
    <view class="pp-card" @tap.stop>
      <text class="pp-card__title">欢迎使用社团星球</text>
      <text class="pp-card__desc">
        在使用本平台前，请阅读并同意
        <text class="pp-card__link" @tap="openStatic('privacy')">《隐私政策》</text>
        与
        <text class="pp-card__link" @tap="openStatic('agreement')">《用户协议》</text>
        。我们仅收集为提供服务所必需的信息（最小化收集），你的学号等敏感信息将进行脱敏展示。
      </text>
      <view class="pp-card__cta">
        <view class="pp-btn pp-btn--ghost" @tap="onDeny">不同意，仅浏览</view>
        <view class="pp-btn pp-btn--primary" @tap="onAgree">同意并继续</view>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.pp-mask {
  position: fixed;
  inset: 0;
  z-index: 999;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 48rpx;
  background: rgba(15, 23, 42, 0.6);
  box-sizing: border-box;
}

.pp-card {
  width: 100%;
  padding: 40rpx 32rpx;
  border-radius: $radius-lg;
  border: 4rpx solid $memphis-dark;
  background: $color-bg-card;
  box-shadow: $shadow-memphis-lg;
}

.pp-card__title {
  display: block;
  font-size: $fs-h2;
  font-weight: 700;
  color: $color-text-title;
  text-align: center;
}

.pp-card__desc {
  display: block;
  margin-top: 24rpx;
  font-size: $fs-body;
  line-height: 1.6;
  color: $color-text-body;
}

.pp-card__link {
  color: $color-primary;
}

.pp-card__cta {
  display: flex;
  gap: 16rpx;
  margin-top: 32rpx;
}

.pp-btn {
  flex: 1;
  padding: 18rpx 0;
  border-radius: $radius-md;
  border: 3rpx solid $memphis-dark;
  font-size: $fs-body;
  font-weight: 700;
  text-align: center;
  box-shadow: $shadow-memphis-sm;

  &--ghost {
    background: #ffffff;
    color: $memphis-dark;
  }

  &--primary {
    background: $color-primary;
    color: #ffffff;
  }
}
</style>