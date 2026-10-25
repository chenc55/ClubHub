<script>
/**
 * 空态组件（P0-01 创建，P0-02 改造为复用 sb-illustration 插画底座）
 * 对应 design.md「4.2-3」空态规范：波点底纹圆 + 黑线大眼睛 + 黄色小胶囊提示
 */
export default {
  name: 'sb-empty',
  props: {
    /** 空态提示文案 */
    text: { type: String, default: '暂无内容' },
    /** 可选操作按钮文案，为空则不显示按钮 */
    actionText: { type: String, default: '' },
  },
  emits: ['action'],
}
</script>

<template>
  <view class="sb-empty">
    <sb-illustration icon="eye" tone="warning" />
    <!-- 黄色小胶囊提示 -->
    <view class="sb-empty__badge">{{ text }}</view>
    <view v-if="actionText" class="sb-empty__action" @tap="$emit('action')">{{ actionText }}</view>
  </view>
</template>

<style lang="scss" scoped>
.sb-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 48rpx 0;

  /* 黄色小胶囊提示 */
  &__badge {
    margin-top: 28rpx;
    padding: 10rpx 28rpx;
    border-radius: 999px;
    border: 3rpx solid $memphis-dark;
    background: $color-warning;
    color: $memphis-dark;
    font-size: $fs-caption;
    font-weight: 600;
    box-shadow: 3rpx 3rpx 0 0 $memphis-dark;
  }

  &__action {
    margin-top: 32rpx;
  }
}
</style>