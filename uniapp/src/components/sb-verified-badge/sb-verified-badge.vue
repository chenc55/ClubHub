<script>
/**
 * 白名单认证徽章（P0-02，规范来源 design.md「3.1」Verified Badge）
 * 浅蓝底 + 蓝字 + 蓝边框圆角胶囊，放置于学生姓名右侧同排水平对齐
 */
export default {
  name: 'sb-verified-badge',
  props: {
    /** 徽章文案 */
    text: { type: String, default: '白名单已认证' },
  },
}
</script>

<template>
  <view class="sb-verified-badge">
    <text class="sb-verified-badge__check">✓</text>
    <text class="sb-verified-badge__text"><slot>{{ text }}</slot></text>
  </view>
</template>

<style lang="scss" scoped>
.sb-verified-badge {
  display: inline-flex;
  align-items: center;
  gap: 6rpx;
  padding: 4rpx 16rpx;
  border-radius: 999px;
  border: 2rpx solid $color-info-text;
  background-color: $color-info-light;
  color: $color-info-text;
  font-size: $fs-caption;
  font-weight: 500;
  line-height: 1.4;
  white-space: nowrap;

  &__check {
    font-size: 20rpx;
    font-weight: 700;
  }

  &__text {
    white-space: nowrap;
  }
}
</style>