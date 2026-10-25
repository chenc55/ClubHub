<script>
/**
 * 孟菲斯卡片（P0-02，规范来源 design.md「2.3」圆角 + 硬投影 + 设计稿卡片）
 * - 白底 + 4rpx 黑描边 + 可配四级硬投影
 * - variant: solid（默认实心卡）/ dashed（虚线描边空态卡，如「申请创建新社团」引导卡）
 */
export default {
  name: 'sb-card',
  props: {
    /** 卡片标题（亦可使用 #title 插槽） */
    title: { type: String, default: '' },
    /** solid / dashed */
    variant: { type: String, default: 'solid', validator: (v) => ['solid', 'dashed'].includes(v) },
    /** 硬投影级别 none/xs/sm/md/lg */
    shadow: { type: String, default: 'sm', validator: (v) => ['none', 'xs', 'sm', 'md', 'lg'].includes(v) },
    /** 圆角 md(卡片默认) / lg(大卡片) */
    radius: { type: String, default: 'md', validator: (v) => ['md', 'lg'].includes(v) },
  },
  computed: {
    shadowStyle() {
      if (this.shadow === 'none') return 'none'
      return `var(--shadow-memphis-${this.shadow})`
    },
  },
}
</script>

<template>
  <view
    class="sb-card"
    :class="[`sb-card--${variant}`, `sb-card--r-${radius}`]"
    :style="{ boxShadow: shadowStyle }"
  >
    <view v-if="title || $slots.title" class="sb-card__head">
      <text class="sb-card__title"><slot name="title">{{ title }}</slot></text>
    </view>
    <view class="sb-card__body">
      <slot />
    </view>
  </view>
</template>

<style lang="scss" scoped>
.sb-card {
  position: relative;
  @include memphis-border;
  background-color: $color-bg-card;
  overflow: hidden;

  /* 圆角：普通卡片 / 大卡片 */
  &--r-md {
    border-radius: $radius-md;
  }

  &--r-lg {
    border-radius: $radius-lg;
  }

  /* 实心卡 */
  &--solid {
    background-color: $color-bg-card;
  }

  /* 虚线描边空态卡 */
  &--dashed {
    border-style: dashed;
    background-color: $color-bg-card;
  }

  &__head {
    padding: 28rpx 32rpx 0;
  }

  &__title {
    font-size: $fs-h2;
    font-weight: 700;
    color: $color-text-title;
  }

  &__body {
    padding: 28rpx 32rpx;
  }
}
</style>