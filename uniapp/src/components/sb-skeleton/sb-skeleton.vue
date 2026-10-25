<script>
/**
 * 骨架屏组件（加载态）
 * 对应 design.md「5.5 UI 状态矩阵」加载态：灰白脉冲块
 */
export default {
  name: 'sb-skeleton',
  props: {
    /** 行数 */
    rows: { type: Number, default: 3 },
    /** 是否卡片模式（首行为封面大块） */
    card: { type: Boolean, default: false },
    /** 行高（rpx），卡片模式下首块高度为 coverHeight */
    rowHeight: { type: Number, default: 32 },
    /** 封面块高度（rpx），仅 card 模式生效 */
    coverHeight: { type: Number, default: 280 },
  },
  computed: {
    lineWidths() {
      // 每行宽度递减，模拟真实文本长短变化
      const widths = [100, 88, 72, 60, 80, 92, 66, 54]
      return Array.from({ length: this.rows }, (_, i) => widths[i % widths.length])
    },
  },
}
</script>

<template>
  <view class="sb-skeleton">
    <view v-if="card" class="sb-skeleton__cover" :style="{ height: coverHeight + 'rpx' }" />
    <view
      v-for="(w, i) in lineWidths"
      :key="i"
      class="sb-skeleton__line"
      :style="{ width: w + '%', height: rowHeight + 'rpx' }"
    />
  </view>
</template>

<style lang="scss" scoped>
.sb-skeleton {
  width: 100%;

  &__cover {
    border-radius: 16rpx;
    background: #e2e8f0;
    margin-bottom: 24rpx;
    animation: sb-pulse 1.5s ease-in-out infinite;
  }

  &__line {
    border-radius: 8rpx;
    background: #e2e8f0;
    margin-bottom: 20rpx;
    animation: sb-pulse 1.5s ease-in-out infinite;

    &:nth-child(2n) {
      animation-delay: 0.15s;
    }

    &:nth-child(3n) {
      animation-delay: 0.3s;
    }
  }
}

@keyframes sb-pulse {
  0%,
  100% {
    opacity: 0.45;
  }

  50% {
    opacity: 0.9;
  }
}
</style>