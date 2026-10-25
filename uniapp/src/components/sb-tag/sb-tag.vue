<script>
/**
 * 孟菲斯状态胶囊三式（P0-02，规范来源 design.md「3.1 状态胶囊与徽标」）
 * - pending 待审核：暖阳黄底黑字 + 内嵌小黑圆点
 * - approved 已通过/招新中：薄荷绿底黑字加粗 + ✓
 * - rejected 已驳回/淘汰：浅红底珊瑚红字
 */
export default {
  name: 'sb-tag',
  props: {
    /** pending / approved / rejected */
    type: { type: String, default: 'pending', validator: (v) => ['pending', 'approved', 'rejected'].includes(v) },
    /** 胶囊文案 */
    text: { type: String, default: '' },
  },
  computed: {
    labels() {
      return { pending: '待审核', approved: '已通过', rejected: '已驳回' }
    },
  },
}
</script>

<template>
  <view class="sb-tag" :class="`sb-tag--${type}`">
    <!-- 待审核：小黑圆点 -->
    <view v-if="type === 'pending'" class="sb-tag__dot" />
    <!-- 已通过：对勾 -->
    <text v-else-if="type === 'approved'" class="sb-tag__check">✓</text>
    <text class="sb-tag__text"><slot>{{ text || labels[type] }}</slot></text>
  </view>
</template>

<style lang="scss" scoped>
.sb-tag {
  display: inline-flex;
  align-items: center;
  gap: 8rpx;
  padding: 6rpx 20rpx;
  border-radius: 999px;
  font-size: $fs-caption;
  font-weight: 600;
  line-height: 1.4;
  white-space: nowrap;

  /* 待审核：暖阳黄 + 黑描边 + 硬投影 */
  &--pending {
    @include memphis-border(3rpx);
    background-color: $color-warning;
    color: $memphis-dark;
    box-shadow: 2rpx 2rpx 0 0 $memphis-dark;
  }

  /* 已通过：薄荷绿 + 黑描边 + 硬投影 + 加粗 */
  &--approved {
    @include memphis-border(3rpx);
    background-color: $color-success;
    color: $memphis-dark;
    box-shadow: 2rpx 2rpx 0 0 $memphis-dark;
    font-weight: 700;
  }

  /* 已驳回：浅红底珊瑚红字红边 */
  &--rejected {
    border: 3rpx solid $color-danger;
    background-color: $color-danger-light;
    color: $color-danger;
  }

  &__dot {
    width: 12rpx;
    height: 12rpx;
    border-radius: 50%;
    background-color: $memphis-dark;
  }

  &__check {
    font-size: 22rpx;
    font-weight: 700;
  }

  &__text {
    white-space: nowrap;
  }
}
</style>