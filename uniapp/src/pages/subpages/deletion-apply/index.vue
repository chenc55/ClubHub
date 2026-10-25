<script>
/**
 * 注销账号申请（P3-02 / 需求 8.4）
 * 说明注销后果 + 选填理由 → 提交 POST /user/deletion-request → 成功态（待管理员处理）
 * 已提交过 pending 申请时服务端返回 1002 拦截，页面提示等待处理
 */
import { submitDeletionRequest } from '@/api/user'
import { ERROR_CODE } from '@/utils/config'

const REASON_MAX = 200

export default {
  name: 'DeletionApply',

  data: () => ({
    reason: '',
    submitting: false,
    submitted: false,
    error: '',
  }),

  methods: {
    async submit() {
      if (this.submitting || this.submitted) return
      try {
        const res = await new Promise((resolve) => {
          uni.showModal({
            title: '确认注销账号？',
            content: '注销后你的学号、姓名等个人数据将被匿名化处理，账号不可再登录；已加入的社团与报名记录将保留审计。申请提交后需管理员人工审核，请谨慎操作。',
            confirmText: '确认提交',
            cancelText: '再想想',
            confirmColor: '#F43F5E',
            success: resolve,
          })
        })
        if (!res.confirm) return
      } catch (e) {
        return
      }

      this.submitting = true
      this.error = ''
      const res = await submitDeletionRequest({ reason: this.reason.trim() })
      this.submitting = false
      if (res.code === ERROR_CODE.STATUS_INVALID) {
        this.error = res.message || '你已提交过注销申请，请等待管理员处理'
        return
      }
      if (res.code !== ERROR_CODE.SUCCESS || !res.data) {
        this.error = res.message || '提交失败，请稍后重试'
        return
      }
      this.submitted = true
    },

    goSettings() {
      uni.navigateBack()
    },
  },
}
</script>

<template>
  <view class="del-page">
    <view v-if="submitted" class="del-card del-card--done">
      <text class="del-done__icon">✓</text>
      <text class="del-done__title">注销申请已提交</text>
      <text class="del-done__text">
        管理员将在核实后人工处理，处理结果将通过站内消息通知你。通过后你的账号将被注销，个人数据完成匿名化处理。
      </text>
      <button class="del-btn" @click="goSettings">返回设置</button>
    </view>

    <template v-else>
      <view class="del-card">
        <text class="del-card__title">注销账号</text>
        <view class="del-tips">
          <text class="del-tips__title">注销后果（请仔细阅读）</text>
          <text class="del-tips__item">1. 账号将不可再登录，学号 / 姓名 / 微信绑定等个人可识别数据将被匿名化处理；</text>
          <text class="del-tips__item">2. 已加入的社团、报名记录等历史业务数据将保留用于平台审计与统计；</text>
          <text class="del-tips__item">3. 申请提交后由管理员人工审核，期间可正常使用账号；</text>
        </view>

        <label class="del-field">
          <span class="del-field__label">注销理由（选填）</span>
          <textarea
            v-model="reason"
            :maxlength="REASON_MAX"
            rows="4"
            placeholder="例如：不再使用本平台…"
            class="del-field__input"
          ></textarea>
        </label>

        <p v-if="error" class="del-error">{{ error }}</p>

        <button class="del-btn del-btn--danger" :disabled="submitting" @click="submit">
          {{ submitting ? '提交中…' : '提交注销申请' }}
        </button>
      </view>
    </template>
  </view>
</template>

<style lang="scss" scoped>
.del-page {
  min-height: 100vh;
  padding: 24rpx 32rpx 48rpx;
  background: $color-bg-canvas;
  box-sizing: border-box;
}

.del-card {
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
}

.del-tips {
  margin-top: 24rpx;
  padding: 24rpx;
  border-radius: $radius-sm;
  border: 2rpx solid $memphis-dark;
  background: $color-bg-canvas;

  &__title {
    display: block;
    font-size: $fs-h3;
    font-weight: 700;
    color: $color-text-title;
  }

  &__item {
    display: block;
    margin-top: 12rpx;
    font-size: $fs-caption;
    line-height: 1.6;
    color: $color-text-body;
  }
}

.del-field {
  display: block;
  margin-top: 28rpx;

  &__label {
    display: block;
    margin-bottom: 12rpx;
    font-size: $fs-caption;
    font-weight: 700;
    color: $color-text-title;
  }

  &__input {
    width: 100%;
    box-sizing: border-box;
    padding: 20rpx;
    border-radius: $radius-sm;
    border: 2rpx solid $memphis-dark;
    background: $color-bg-canvas;
    font-size: $fs-body;
    line-height: 1.6;
    color: $color-text-body;
  }
}

.del-error {
  margin-top: 20rpx;
  padding: 16rpx 20rpx;
  border-radius: $radius-sm;
  border: 2rpx solid $memphis-dark;
  background: rgba(244, 63, 94, 0.1);
  font-size: $fs-caption;
  color: #f43f5e;
}

.del-btn {
  margin-top: 32rpx;
  height: 88rpx;
  line-height: 88rpx;
  border-radius: $radius-md;
  border: 4rpx solid $memphis-dark;
  background: $color-primary;
  color: #ffffff;
  font-size: $fs-body;
  font-weight: 700;
  box-shadow: $shadow-memphis-sm;

  &--danger {
    background: #f43f5e;
  }
}

.del-done {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16rpx;
  padding: 48rpx 32rpx;

  &__icon {
    width: 96rpx;
    height: 96rpx;
    line-height: 96rpx;
    text-align: center;
    border-radius: 999rpx;
    border: 4rpx solid $memphis-dark;
    background: $color-success-light;
    font-size: 56rpx;
    color: #06d6a0;
  }

  &__title {
    font-size: $fs-h2;
    font-weight: 700;
    color: $color-text-title;
  }

  &__text {
    font-size: $fs-caption;
    line-height: 1.7;
    color: $color-text-body;
    text-align: center;
  }
}
</style>
