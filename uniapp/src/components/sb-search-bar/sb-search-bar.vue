<script>
/**
 * 胶囊搜索栏（P0-02，结构对照 design-assets/screen-mobile-home 顶部搜索栏）
 * 白底药丸 + 3rpx 黑描边 + 硬投影 + 按下微动；前缀 CSS 放大镜；右侧 extra 插槽（HOT 胶囊/扫码按钮等）
 */
export default {
  name: 'sb-search-bar',
  props: {
    /** 输入值（v-model） */
    modelValue: { type: String, default: '' },
    /** 占位提示 */
    placeholder: { type: String, default: '搜索社团、热门活动或招新岗位...' },
    /** 是否禁用 */
    disabled: { type: Boolean, default: false },
  },
  emits: ['update:modelValue', 'input', 'confirm', 'focus'],
  methods: {
    onInput(e) {
      const value = e.detail.value
      this.$emit('update:modelValue', value)
      this.$emit('input', value)
    },
  },
}
</script>

<template>
  <view class="sb-search-bar" :class="{ 'sb-search-bar--disabled': disabled }">
    <!-- CSS 放大镜图标（圆 + 旋转柄） -->
    <view class="sb-search-bar__icon" />
    <input
      class="sb-search-bar__input"
      :value="modelValue"
      :placeholder="placeholder"
      :disabled="disabled"
      confirm-type="search"
      @input="onInput"
      @confirm="$emit('confirm', $event)"
      @focus="$emit('focus', $event)"
    />
    <view v-if="$slots.extra" class="sb-search-bar__extra">
      <slot name="extra" />
    </view>
  </view>
</template>

<style lang="scss" scoped>
.sb-search-bar {
  display: flex;
  align-items: center;
  gap: 12rpx;
  height: 88rpx;
  padding: 0 20rpx 0 28rpx;
  border-radius: $radius-full;
  border: 3rpx solid $memphis-dark;
  background-color: $color-bg-card;
  box-shadow: 4rpx 4rpx 0 0 $memphis-dark;
  @include press-active;

  &--disabled {
    opacity: 0.6;
  }

  /* CSS 放大镜：黑描边圆 + 45° 柄 */
  &__icon {
    position: relative;
    flex-shrink: 0;
    width: 28rpx;
    height: 28rpx;
    border: 4rpx solid $memphis-dark;
    border-radius: 50%;

    &::after {
      content: '';
      position: absolute;
      right: -12rpx;
      bottom: -8rpx;
      width: 14rpx;
      height: 4rpx;
      border-radius: 2rpx;
      background-color: $memphis-dark;
      transform: rotate(45deg);
      transform-origin: left center;
    }
  }

  &__input {
    flex: 1;
    height: 100%;
    font-size: $fs-body;
    color: $color-text-title;
  }

  &__extra {
    flex-shrink: 0;
    display: flex;
    align-items: center;
  }
}
</style>