<script>
/**
 * 孟菲斯按钮四式（P0-02，规范来源 design.md「3.2 按钮体系」）
 * - primary：主 CTA（蓝底白字）
 * - approve：通过操作（薄荷绿底黑字）
 * - reject：拒绝/驳回（白底珊瑚红字）
 * - ghost：轻量次级（白底黑字）
 * 统一：4rpx 黑描边 + 硬投影 + 按下位移 3rpx 阴影归零；loading 态按钮内 Spinner
 */
export default {
  name: 'sb-button',
  props: {
    /** primary / approve / reject / ghost */
    type: { type: String, default: 'primary', validator: (v) => ['primary', 'approve', 'reject', 'ghost'].includes(v) },
    /** 按钮文案 */
    text: { type: String, default: '' },
    /** md（默认）/ sm */
    size: { type: String, default: 'md', validator: (v) => ['md', 'sm'].includes(v) },
    /** loading 态：按钮内 Spinner + loadingText */
    loading: { type: Boolean, default: false },
    /** loading 态文案（默认「提交中」，对应状态矩阵） */
    loadingText: { type: String, default: '提交中' },
    /** 禁用态 */
    disabled: { type: Boolean, default: false },
    /** 通栏（占满父容器宽度） */
    block: { type: Boolean, default: false },
  },
  emits: ['click'],
  computed: {
    classes() {
      return [
        'sb-button',
        `sb-button--${this.type}`,
        `sb-button--${this.size}`,
        { 'sb-button--block': this.block, 'sb-button--disabled': this.disabled || this.loading },
      ]
    },
  },
}
</script>

<template>
  <view class="sb-button" :class="classes" :hover-class="''" @tap="!disabled && !loading && $emit('click')">
    <!-- loading Spinner -->
    <view v-if="loading" class="sb-button__spinner" />
    <text class="sb-button__text">
      <slot>{{ loading ? loadingText : text }}</slot>
    </text>
  </view>
</template>

<style lang="scss" scoped>
.sb-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 12rpx;
  /* block 态 width:100% 必须把 padding/border 计入，否则内容盒模型下右溢出（P3-04 后修复） */
  box-sizing: border-box;
  border-radius: $radius-md;
  @include memphis-border;
  @include memphis-shadow('sm');
  @include press-active;

  /* ---- 四式 ---- */

  /* 主 CTA：活力蓝底白字（悬停转深蓝由 H5 :active 外形态保证彩度） */
  &--primary {
    background-color: $color-primary;
    color: #ffffff;

    &:active {
      background-color: $color-primary-hover;
    }
  }

  /* 通过：薄荷翡翠绿底黑字 */
  &--approve {
    background-color: $color-success;
    color: $memphis-dark;
  }

  /* 拒绝：白底珊瑚红字，按压转浅红底 */
  &--reject {
    background-color: #ffffff;
    color: $color-danger;

    &:active {
      background-color: $color-danger-light;
    }
  }

  /* 轻量次级：白底黑字 */
  &--ghost {
    background-color: #ffffff;
    color: $memphis-dark;
  }

  /* ---- 尺寸 ---- */
  &--md {
    min-height: 88rpx;
    padding: 0 48rpx;
  }

  &--sm {
    min-height: 64rpx;
    padding: 0 32rpx;
  }

  &--block {
    display: flex;
    width: 100%;
  }

  &--disabled {
    opacity: 0.5;
  }

  &__text {
    font-family: $font-sans;
    font-weight: 700;
    line-height: 1.2;

    .sb-button--md & {
      font-size: $fs-h3;
    }

    .sb-button--sm & {
      font-size: $fs-body;
    }
  }

  /* loading Spinner（环状渐变旋转） */
  &__spinner {
    width: 28rpx;
    height: 28rpx;
    border-radius: 50%;
    border: 4rpx solid rgba(255, 255, 255, 0.35);
    border-top-color: #ffffff;
    animation: sb-btn-spin 0.8s linear infinite;

    .sb-button--ghost & {
      border-color: rgba(15, 23, 42, 0.2);
      border-top-color: $memphis-dark;
    }
  }
}

@keyframes sb-btn-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>