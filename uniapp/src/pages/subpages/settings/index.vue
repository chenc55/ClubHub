<script>
/**
 * 设置与帮助（STU-08 / P1-24）
 * 入口：换绑申诉（P1-05 已实现）/ 隐私政策 / 用户协议 / 关于 / 退出登录（二次确认）
 */
import { useUserStore } from '@/store/user'

export default {
  name: 'Settings',

  computed: {
    userStore() {
      return useUserStore()
    },
  },

  methods: {
    go(type) {
      uni.navigateTo({ url: `/pages/subpages/static-page/index?type=${type}` })
    },

    goAppeal() {
      uni.navigateTo({ url: '/pages/subpages/rebind-appeal/index' })
    },

    goDeletion() {
      uni.navigateTo({ url: '/pages/subpages/deletion-apply/index' })
    },

    async onLogout() {
      if (!this.userStore.hasSession) {
        uni.showToast({ title: '当前为游客模式', icon: 'none' })
        return
      }
      try {
        const res = await new Promise((resolve) => {
          uni.showModal({
            title: '退出登录',
            content: '确定退出当前账号吗？已加入的社团与报名记录不会删除。',
            confirmText: '退出',
            cancelText: '取消',
            success: resolve,
          })
        })
        if (!res.confirm) return
      } catch (e) {
        return
      }
      this.userStore.logout()
      uni.showToast({ title: '已退出登录', icon: 'none' })
      setTimeout(() => uni.switchTab({ url: '/pages/profile/index' }), 300)
    },
  },
}
</script>

<template>
  <view class="st-page">
    <view class="st-card">
      <view class="st-entry" @tap="goAppeal">
        <text class="st-entry__label">换绑申诉</text>
        <text class="st-entry__desc">学号被占用 / 换绑微信</text>
        <text class="st-entry__arrow">›</text>
      </view>
      <view class="st-entry" @tap="go('privacy')">
        <text class="st-entry__label">隐私政策</text>
        <text class="st-entry__desc">信息收集与使用说明</text>
        <text class="st-entry__arrow">›</text>
      </view>
      <view class="st-entry" @tap="go('agreement')">
        <text class="st-entry__label">用户协议</text>
        <text class="st-entry__desc">使用条款与约定</text>
        <text class="st-entry__arrow">›</text>
      </view>
      <view class="st-entry" @tap="go('about')">
        <text class="st-entry__label">关于我们</text>
        <text class="st-entry__desc">社团星球 · ClubHub</text>
        <text class="st-entry__arrow">›</text>
      </view>
    </view>

    <view class="st-card">
      <view class="st-entry st-entry--danger" @tap="goDeletion">
        <text class="st-entry__label st-entry__label--danger">注销账号</text>
        <text class="st-entry__desc">提交个人数据删除申请</text>
        <text class="st-entry__arrow">›</text>
      </view>
      <view class="st-entry st-entry--danger" @tap="onLogout">
        <text class="st-entry__label st-entry__label--danger">退出登录</text>
        <text class="st-entry__arrow">›</text>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.st-page {
  min-height: 100vh;
  padding: 24rpx 32rpx 48rpx;
  background: $color-bg-canvas;
  box-sizing: border-box;
}

.st-card {
  margin-top: 24rpx;
  padding: 8rpx 32rpx;
  border-radius: $radius-md;
  border: 4rpx solid $memphis-dark;
  background: $color-bg-card;
  box-shadow: $shadow-memphis-sm;
}

.st-entry {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 26rpx 0;
  border-bottom: 2rpx dashed $memphis-dark;

  &:last-child {
    border-bottom: none;
  }

  &--danger {
    margin-top: 0;
  }

  &__label {
    font-size: $fs-h3;
    font-weight: 700;
    color: $color-text-title;

    &--danger {
      color: $color-danger;
    }
  }

  &__desc {
    flex: 1;
    font-size: $fs-caption;
    color: $color-text-muted;
    text-align: right;
  }

  &__arrow {
    font-size: $fs-h3;
    color: $color-text-muted;
  }
}
</style>