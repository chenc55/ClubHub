<script>
/**
 * 设计系统 Demo 页（P0-02 产物）
 * 验收对照：design.md「2. 设计令牌系统」+ design-assets 三张核心屏
 * P0-07 追加：10 · 图片上传（单图 / 多图 + 规格拦截演示）
 */
import { UPLOAD_SCENES } from '@/utils/upload'

export default {
  data() {
    return {
      searchKeyword: '',
      now: '',
      // P0-07 上传演示：已上传 URL 列表（v-model）
      coverUrls: [],
      momentUrls: [],
      specs: UPLOAD_SCENES,
    }
  },
  onLoad() {
    // 排印展示用的等宽样例
    this.now = new Date()
  },
}
</script>

<template>
  <view class="demo">
    <view class="demo__hero">
      <text class="demo__hero-title">Neo-Memphis 设计系统</text>
      <text class="demo__hero-sub">design.md v1.0 · 移动端落地 · P0-02</text>
    </view>

    <!-- 1. 颜色令牌 -->
    <sb-card title="01 · 颜色令牌 Color Tokens">
      <view class="demo__swatches">
        <view v-for="s in [
          { name: '--color-primary', hex: '#2F80ED', bg: '#2F80ED' },
          { name: '--color-success', hex: '#06D6A0', bg: '#06D6A0' },
          { name: '--color-warning', hex: '#FFD166', bg: '#FFD166' },
          { name: '--color-danger', hex: '#F43F5E', bg: '#F43F5E' },
          { name: '--color-info', hex: '#0EA5E9', bg: '#0EA5E9' },
          { name: '--color-bg-canvas', hex: '#F8F9FF', bg: '#F8F9FF' },
          { name: '--color-text-title', hex: '#0F172A', bg: '#0F172A' },
          { name: '--color-text-muted', hex: '#64748B', bg: '#64748B' },
        ]" :key="s.name" class="demo__swatch">
          <view class="demo__swatch-box" :style="{ backgroundColor: s.bg }" />
          <text class="demo__swatch-name">{{ s.name }}</text>
          <text class="demo__swatch-hex">{{ s.hex }}</text>
        </view>
      </view>
    </sb-card>

    <!-- 2. 字体排印 -->
    <sb-card title="02 · 字体排印 Typography">
      <view class="demo__type">
        <text class="demo__type-display">Display · Space Grotesk 64rpx</text>
        <text class="demo__type-h1">H1 页面大标题 44rpx</text>
        <text class="demo__type-h2">H2 模块卡片标题 36rpx</text>
        <text class="demo__type-h3">H3 活动标题 / 表头 30rpx</text>
        <text class="demo__type-body">Body 正文 · 社团星球覆盖社团信息到活动报名的全链路。</text>
        <text class="demo__type-caption">Caption 时间戳 · 2025-04-17 14:22</text>
        <text class="demo__type-mono">Mono 学号 · 20260001 · JetBrains Mono</text>
      </view>
    </sb-card>

    <!-- 3. 圆角 / 边框 / 投影 -->
    <sb-card title="03 · 圆角 / 硬边框 / 硬投影">
      <view class="demo__geo">
        <view v-for="g in [
          { label: 'radius-sm 12rpx', cls: 'g-sm' },
          { label: 'radius-md 20rpx', cls: 'g-md' },
          { label: 'radius-lg 32rpx', cls: 'g-lg' },
          { label: 'radius-full', cls: 'g-full' },
        ]" :key="g.label" class="demo__geo-item">
          <view class="demo__geo-box" :class="g.cls" />
          <text class="demo__geo-label">{{ g.label }}</text>
        </view>
      </view>
      <view class="demo__geo">
        <view v-for="sh in [
          { label: 'shadow-xs', cls: 'sh-xs' },
          { label: 'shadow-sm', cls: 'sh-sm' },
          { label: 'shadow-md', cls: 'sh-md' },
          { label: 'shadow-lg', cls: 'sh-lg' },
        ]" :key="sh.label" class="demo__geo-item">
          <view class="demo__geo-box" :class="sh.cls" />
          <text class="demo__geo-label">{{ sh.label }}</text>
        </view>
      </view>
    </sb-card>

    <!-- 4. 按钮四式 -->
    <sb-card title="04 · 按钮四式 Buttons">
      <view class="demo__row">
        <sb-button type="primary" text="立即报名" />
        <sb-button type="approve" text="通过" />
      </view>
      <view class="demo__row">
        <sb-button type="reject" text="驳回" />
        <sb-button type="ghost" text="取消" />
      </view>
      <view class="demo__row">
        <sb-button type="primary" text="提交" loading />
        <sb-button type="approve" text="已截止" disabled size="sm" />
      </view>
      <sb-button type="primary" text="通栏主按钮" block />
      <text class="demo__hint">长按任意按钮体验按下微动反馈：位移 3rpx + 阴影归零</text>
    </sb-card>

    <!-- 5. 状态胶囊 + 认证徽章 -->
    <sb-card title="05 · 状态胶囊与认证徽章">
      <view class="demo__row demo__row--wrap">
        <sb-tag type="pending" />
        <sb-tag type="approved" text="招新中" />
        <sb-tag type="rejected" text="报名已满" />
      </view>
      <view class="demo__row demo__row--wrap">
        <view class="demo__student">
          <view class="demo__avatar">林</view>
          <text class="demo__student-name">林晨</text>
          <sb-verified-badge />
        </view>
      </view>
    </sb-card>

    <!-- 6. 卡片 -->
    <sb-card title="06 · 卡片 Cards">
      <sb-card title="实心卡 + sm 投影" shadow="sm">
        <text class="demo__card-txt">白底 + 4rpx 黑描边 + 硬投影，模块内容默认容器</text>
      </sb-card>
      <sb-card variant="dashed" shadow="none" class="demo__mt">
        <view class="demo__dashed-inner">
          <sb-illustration icon="eye" tone="warning" />
          <text class="demo__empty-tip">还没有加入任何社团</text>
          <sb-button type="primary" text="申请创建新社团" size="sm" />
        </view>
      </sb-card>
    </sb-card>

    <!-- 7. 胶囊搜索栏 -->
    <sb-card title="07 · 胶囊搜索栏">
      <sb-search-bar v-model="searchKeyword" placeholder="搜索社团、热门活动或招新岗位..." />
      <view class="demo__search-with-btn">
        <sb-search-bar v-model="searchKeyword" class="demo__flex1">
          <template #extra>
            <view class="demo__hot">HOT</view>
          </template>
        </sb-search-bar>
        <view class="demo__square-btn">扫</view>
      </view>
    </sb-card>

    <!-- 8. 空态插画 -->
    <sb-card title="08 · 空态插画 Illustrations">
      <sb-empty text="暂无内容" />
      <sb-error />
      <view class="demo__row demo__row--center">
        <sb-illustration icon="eye" tone="primary" />
        <sb-illustration icon="bang" tone="warning" />
        <sb-illustration icon="bang" tone="neutral" />
      </view>
    </sb-card>

    <!-- 9. 安全区适配 -->
    <sb-card title="09 · 安全区适配">
      <view class="demo__safe sb-safe-top">
        <text class="demo__card-txt">顶部避让：padding-top: var(--status-bar-height)（免被微信胶囊遮挡）</text>
      </view>
      <view class="demo__safe sb-safe-bottom">
        <text class="demo__card-txt">底部安全区：env(safe-area-inset-bottom)（自定义 TabBar / 固定底栏必加）</text>
      </view>
      <text class="demo__hint">工具类：sb-safe-top / sb-safe-bottom；Mixin：safe-top() / safe-bottom()／详见 styles/theme.css 与 uni.scss</text>
    </sb-card>

    <!-- 10. 图片上传（P0-07） -->
    <sb-card title="10 · 图片上传 Upload（P0-07）">
      <text class="demo__hint">单图：活动 / 招新封面（1 张 · ≤5MB · jpg/png/webp · 16:9）</text>
      <sb-image-picker v-model="coverUrls" scene="activity_cover" />
      <text class="demo__hint">多图：动态配图（≤9 张 · ≤5MB · 含 gif；GIF 受网关限制 ≤1.5MB）</text>
      <sb-image-picker v-model="momentUrls" scene="moments" />
      <text class="demo__hint">已上传 URL：{{ JSON.stringify(coverUrls.concat(momentUrls)) }}</text>
      <text class="demo__hint">超限（张数 / 大小 / 格式）由前端拦截并提示，不会发起上传；上传前本地压缩至长边 ≤2000px。</text>
    </sb-card>
  </view>
</template>

<style lang="scss" scoped>
.demo {
  min-height: 100vh;
  padding: 32rpx 32rpx 120rpx;
  background: $color-bg-canvas;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 32rpx;
}

.demo__hero {
  display: flex;
  flex-direction: column;
  padding: 40rpx 36rpx;
  border-radius: $radius-lg;
  @include memphis-border;
  @include memphis-shadow('md');
  background: $color-primary;

  .demo__hero-title {
    font-family: $font-display;
    font-size: $fs-display;
    font-weight: 700;
    color: #ffffff;
  }

  .demo__hero-sub {
    margin-top: 12rpx;
    font-size: $fs-caption;
    color: rgba(255, 255, 255, 0.85);
  }
}

/* 色板 */
.demo__swatches {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 24rpx;
}

.demo__swatch {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 150rpx;
}

.demo__swatch-box {
  width: 96rpx;
  height: 96rpx;
  border-radius: $radius-md;
  @include memphis-border;
  @include memphis-shadow('xs');
}

.demo__swatch-name {
  margin-top: 10rpx;
  font-family: $font-mono;
  font-size: 18rpx;
  color: $color-text-body;
}

.demo__swatch-hex {
  margin-top: 4rpx;
  font-family: $font-mono;
  font-size: 18rpx;
  color: $color-text-muted;
}

/* 排印 */
.demo__type {
  display: flex;
  flex-direction: column;
  gap: 20rpx;

  &-display {
    font-family: $font-display;
    font-size: $fs-display;
    font-weight: 700;
    color: $color-text-title;
  }

  &-h1 {
    font-family: $font-sans;
    font-size: $fs-h1;
    font-weight: 700;
    color: $color-text-title;
  }

  &-h2 {
    font-family: $font-sans;
    font-size: $fs-h2;
    font-weight: 700;
    color: $color-text-title;
  }

  &-h3 {
    font-family: $font-sans;
    font-size: $fs-h3;
    font-weight: 600;
    color: $color-text-title;
  }

  &-body {
    font-family: $font-sans;
    font-size: $fs-body;
    line-height: 1.5;
    color: $color-text-body;
  }

  &-caption {
    font-family: $font-sans;
    font-size: $fs-caption;
    color: $color-text-muted;
  }

  &-mono {
    font-family: $font-mono;
    font-size: $fs-body;
    color: $color-text-title;
  }
}

/* 圆角/投影 */
.demo__geo {
  display: flex;
  flex-direction: row;
  gap: 20rpx;
  margin-bottom: 24rpx;

  &:last-child {
    margin-bottom: 0;
  }
}

.demo__geo-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10rpx;
  flex: 1;
}

.demo__geo-box {
  width: 100%;
  height: 96rpx;
  background: $color-bg-card;
  @include memphis-border;

  &.g-sm {
    border-radius: $radius-sm;
  }

  &.g-md {
    border-radius: $radius-md;
  }

  &.g-lg {
    border-radius: $radius-lg;
  }

  &.g-full {
    border-radius: $radius-full;
  }

  &.sh-xs {
    box-shadow: $shadow-memphis-xs;
  }

  &.sh-sm {
    box-shadow: $shadow-memphis-sm;
  }

  &.sh-md {
    box-shadow: $shadow-memphis-md;
  }

  &.sh-lg {
    box-shadow: $shadow-memphis-lg;
  }
}

.demo__geo-label {
  font-family: $font-mono;
  font-size: 18rpx;
  color: $color-text-muted;
}

/* 通用行 */
.demo__row {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 24rpx;
  margin-bottom: 24rpx;

  &:last-child {
    margin-bottom: 0;
  }

  &--wrap {
    flex-wrap: wrap;
  }

  &--center {
    justify-content: center;
  }
}

.demo__hint {
  display: block;
  margin-top: 20rpx;
  font-size: $fs-caption;
  color: $color-text-muted;
}

/* 学生行（白名单徽章场景） */
.demo__student {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 12rpx;
}

.demo__avatar {
  width: 56rpx;
  height: 56rpx;
  border-radius: 50%;
  background: $color-primary-light;
  @include memphis-border(3rpx);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  color: $color-text-title;
}

.demo__student-name {
  font-size: $fs-h3;
  font-weight: 600;
  color: $color-text-title;
}

/* 卡片演示 */
.demo__mt {
  margin-top: 24rpx;
}

.demo__card-txt {
  font-size: $fs-body;
  line-height: 1.6;
  color: $color-text-body;
}

.demo__dashed-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24rpx;
}

.demo__empty-tip {
  font-size: $fs-body;
  color: $color-text-body;
}

/* 搜索栏演示 */
.demo__search-with-btn {
  margin-top: 24rpx;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 20rpx;
}

.demo__flex1 {
  flex: 1;
}

.demo__hot {
  padding: 4rpx 16rpx;
  border-radius: $radius-full;
  border: 2rpx solid $memphis-dark;
  background: $color-warning;
  color: $memphis-dark;
  font-family: $font-display;
  font-size: 18rpx;
  font-weight: 700;
}

/* 方形辅助按钮（对照设计稿扫一扫按钮：黄底黑边硬投影） */
.demo__square-btn {
  flex-shrink: 0;
  width: 88rpx;
  height: 88rpx;
  border-radius: $radius-md;
  @include memphis-border(3rpx);
  @include memphis-shadow('sm');
  background: $color-warning;
  color: $memphis-dark;
  font-size: $fs-h3;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  @include press-active;
}

/* 安全区演示 */
.demo__safe {
  padding: 24rpx;
  margin-bottom: 20rpx;
  border-radius: $radius-md;
  border: 3rpx dashed $color-text-muted;

  &:last-of-type {
    margin-bottom: 0;
  }
}
</style>