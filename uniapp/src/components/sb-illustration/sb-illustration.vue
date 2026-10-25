<script>
/**
 * 孟菲斯空态插画底座（P0-02）
 * 对应 design.md「4.2-3 空态与失败提示插画规范」：
 * 几何波点底纹圆形（48px~64px）+ 黑色硬线条图标，配色可配
 * sb-empty / sb-error 均基于本组件，插画实现唯一
 */
export default {
  name: 'sb-illustration',
  props: {
    /** 底纹色调：warning / danger / primary / neutral */
    tone: {
      type: String,
      default: 'warning',
      validator: (v) => ['warning', 'danger', 'primary', 'neutral'].includes(v),
    },
    /** 图标风格：eye（大眼睛）/ bang（感叹号） */
    icon: { type: String, default: 'eye', validator: (v) => ['eye', 'bang'].includes(v) },
  },
}
</script>

<template>
  <view class="sb-illustration" :class="`sb-illustration--${tone}`">
    <!-- 眼睛图标（黑色硬线条） -->
    <view v-if="icon === 'eye'" class="sb-illustration__eye">
      <view class="sb-illustration__pupil" />
    </view>
    <!-- 感叹号图标（竖条 + 圆点） -->
    <view v-else class="sb-illustration__bang">
      <view class="sb-illustration__bar" />
      <view class="sb-illustration__dotpoint" />
    </view>
  </view>
</template>

<style lang="scss" scoped>
.sb-illustration {
  position: relative;
  width: 128rpx; // 64px 规范上限
  height: 128rpx;
  border-radius: 50%;
  @include memphis-border;
  @include memphis-shadow('sm'); // 4rpx 硬投影

  /* 几何波点底纹 */
  background-image: radial-gradient(circle, rgba(15, 23, 42, 0.14) 3rpx, transparent 3.5rpx);
  background-size: 26rpx 26rpx;
  background-repeat: repeat;

  /* 色调修饰类（映射 design.md 令牌，禁止私设 hex） */
  &--warning {
    background-color: $color-warning-light;
  }

  &--danger {
    background-color: $color-danger-light;
  }

  &--primary {
    background-color: $color-primary-light;
  }

  &--neutral {
    background-color: $color-bg-canvas;
  }

  &__eye {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 64rpx;
    height: 44rpx;
    border: 6rpx solid $memphis-dark;
    border-radius: 50%;
    background: #ffffff;
    transform: translate(-50%, -50%);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  &__pupil {
    width: 16rpx;
    height: 16rpx;
    border-radius: 50%;
    background: $memphis-dark;
  }

  &__bang {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  &__bar {
    width: 12rpx;
    height: 48rpx;
    border-radius: 6rpx;
    background: $memphis-dark;
  }

  &__dotpoint {
    margin-top: 10rpx;
    width: 12rpx;
    height: 12rpx;
    border-radius: 50%;
    background: $memphis-dark;
  }
}
</style>