<script>
/**
 * 加载失败重试组件（P0-01 创建，P0-02 改造为复用 sb-illustration 插画底座）
 * 对应 design.md「5.5 UI 状态矩阵」异常态：孟菲斯插画 + 文案 + 重试 CTA
 */
export default {
  name: 'sb-error',
  props: {
    /** 失败提示文案 */
    text: { type: String, default: '加载失败，请检查网络后重试' },
    /** 重试按钮文案 */
    retryText: { type: String, default: '重试' },
  },
  emits: ['retry'],
}
</script>

<template>
  <view class="sb-error">
    <sb-illustration icon="bang" tone="danger" />
    <view class="sb-error__text">{{ text }}</view>
    <sb-button type="primary" :text="retryText" @click="$emit('retry')" />
  </view>
</template>

<style lang="scss" scoped>
.sb-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 48rpx 0;

  &__text {
    margin-top: 28rpx;
    margin-bottom: 32rpx;
    font-size: $fs-body;
    color: $color-text-body;
  }
}
</style>