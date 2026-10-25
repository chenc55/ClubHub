<script>
/**
 * 路由占位组件（P0-01 阶段使用）
 * 供二级页占位展示：页面标题 + 「路由占位」徽章 + 返回按钮
 * 各页面由后续 Sprint 子任务逐个实现真实功能后，替换掉本组件
 */
export default {
  name: 'page-stub',
  props: {
    /** 页面标题 */
    title: { type: String, default: '' },
    /** 补充说明 */
    desc: { type: String, default: '' },
  },
  methods: {
    goBack() {
      const pages = getCurrentPages()
      if (pages.length > 1) {
        uni.navigateBack()
      } else {
        uni.switchTab({ url: '/pages/home/index' })
      }
    },
  },
}
</script>

<template>
  <view class="page-stub">
    <view class="page-stub__card">
      <view class="page-stub__head">
        <text class="page-stub__title">{{ title }}</text>
        <view class="page-stub__badge">路由占位</view>
      </view>
      <text class="page-stub__desc">
        {{ desc || '该页面功能由后续 Sprint 子任务实现，当前仅完成路由注册。' }}
      </text>
      <view class="page-stub__btn" @tap="goBack">返回上一页</view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.page-stub {
  min-height: 100vh;
  padding: 48rpx 32rpx;
  background: $color-bg-canvas;

  &__card {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 64rpx 40rpx;
    border-radius: 20rpx;
    border: 4rpx solid $memphis-dark;
    background: $color-bg-card;
    box-shadow: 6rpx 6rpx 0 0 $memphis-dark;
  }

  &__head {
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  &__title {
    font-size: 40rpx;
    font-weight: 700;
    color: $color-text-title;
  }

  &__badge {
    margin-top: 16rpx;
    padding: 6rpx 24rpx;
    border-radius: 999px;
    border: 3rpx solid $memphis-dark;
    background: $color-warning;
    color: $memphis-dark;
    font-size: 22rpx;
    font-weight: 600;
    box-shadow: 3rpx 3rpx 0 0 $memphis-dark;
  }

  &__desc {
    margin-top: 32rpx;
    font-size: 26rpx;
    line-height: 1.6;
    color: $color-text-muted;
    text-align: center;
  }

  &__btn {
    margin-top: 48rpx;
    padding: 16rpx 56rpx;
    border-radius: 12rpx;
    border: 4rpx solid $memphis-dark;
    background: $color-primary;
    color: #ffffff;
    font-size: 28rpx;
    font-weight: 700;
    box-shadow: 4rpx 4rpx 0 0 $memphis-dark;

    &:active {
      transform: translate(3rpx, 3rpx);
      box-shadow: 0 0 0 0 $memphis-dark;
    }
  }
}
</style>