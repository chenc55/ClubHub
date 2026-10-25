<script>
/**
 * 社团动态发布（P2-01 / CLB-02）
 * 先发后审：命中 block 级敏感词拦截发布；命中 review 级放行并标记「疑似」送审（不阻断）。
 * 入口：社团管理主页「社团动态」（携带 club_id）；支持从「我的动态」再发。
 */
import { getMyClubs, savePost } from '@/api/club'
import { useUserStore } from '@/store/user'

const CONTENT_MAX = 1000

export default {
  name: 'PostCreate',

  data: () => ({
    clubId: '',
    clubs: [], // 我管理的社团（负责人）
    content: '',
    images: [],
    submitting: false,
    hint: '',
    result: '', // 'block' 拦截 / 'review' 送审 / 'ok'
    contentMax: CONTENT_MAX,
  }),

  computed: {
    clubName() {
      const found = this.clubs.find((c) => c.club && c.club._id === this.clubId)
      return (found && found.club && found.club.name) || ''
    },
    remain() {
      return Math.max(0, CONTENT_MAX - this.content.length)
    },
  },

  onLoad(query) {
    if (query && query.club_id) this.clubId = query.club_id
    this.loadClubs()
  },

  methods: {
    async loadClubs() {
      const res = await getMyClubs()
      if (res.code !== 0 || !res.data) {
        this.hint = (res && res.message) || '加载我的社团失败'
        return
      }
      this.clubs = res.data.list || res.data || []
      if (!this.clubId && this.clubs.length) this.clubId = this.clubs[0].club._id
    },

    onSelectClub(e) {
      this.clubId = e.detail.value
    },

    async submit() {
      if (this.submitting) return
      const content = this.content.trim()
      if (!this.clubId) {
        this.hint = '请选择要发布动态的社团'
        return
      }
      if (!content) {
        this.hint = '请输入动态正文'
        return
      }
      if (content.length > CONTENT_MAX) {
        this.hint = `动态正文最长 ${CONTENT_MAX} 字`
        return
      }
      this.submitting = true
      this.hint = ''
      const res = await savePost({ club_id: this.clubId, content, images: this.images })
      this.submitting = false
      if (res.code !== 0) {
        this.hint = res.message || '发布失败，请稍后重试'
        if (res.message && res.message.indexOf('违规词') !== -1) this.result = 'block'
        return
      }
      this.result = res.data && res.data.queued_for_review ? 'review' : 'ok'
      if (this.result === 'review') {
        uni.showToast({ title: '已发布（命中疑似词，已送审）', icon: 'none' })
      } else {
        uni.showToast({ title: '发布成功', icon: 'success' })
      }
      setTimeout(() => {
        uni.redirectTo({ url: '/pages/subpages/my-posts/index' })
      }, 600)
    },

    goMyPosts() {
      uni.navigateTo({ url: '/pages/subpages/my-posts/index' })
    },
  },
}
</script>

<template>
  <view class="post-page">
    <!-- 顶部说明卡 -->
    <view class="post-head">
      <text class="post-head__title">发布社团动态</text>
      <text class="post-head__desc">
        动态为「先发后审」：含拦截级敏感词将被拒绝；含送审级敏感词会正常发布并标记「疑似」供管理员复核。
      </text>
      <view class="post-head__link" @tap="goMyPosts">
        <text>查看我的动态</text>
        <text class="post-head__arrow">→</text>
      </view>
    </view>

    <view class="post-card">
      <!-- 社团选择（多社团负责人） -->
      <view class="post-field">
        <text class="post-field__label">发布到社团</text>
        <picker v-if="clubs.length > 1" mode="selector" :range="clubs" range-key="club.name" @change="onSelectClub">
          <view class="post-picker">
            <text>{{ clubName || '请选择社团' }}</text>
            <text class="post-picker__arrow">▾</text>
          </view>
        </picker>
        <view v-else-if="clubName" class="post-picker">
          <text>{{ clubName }}</text>
        </view>
        <text v-else class="post-field__empty">未找到可管理的社团（需为社长 / 干部）</text>
      </view>

      <!-- 正文 -->
      <view class="post-field">
        <text class="post-field__label">正文</text>
        <textarea
          v-model="content"
          class="post-textarea"
          :maxlength="contentMax"
          placeholder="记录社团动态、发布通知或活动回顾…"
          auto-height
        />
        <text class="post-field__count">{{ remain }} / {{ contentMax }}</text>
      </view>

      <!-- 配图（≤9 张） -->
      <view class="post-field">
        <text class="post-field__label">配图（最多 9 张）</text>
        <sb-image-picker v-model="images" scene="moments" />
      </view>

      <text v-if="hint" class="post-hint">{{ hint }}</text>
    </view>

    <!-- 发布 -->
    <view class="post-submit">
      <sb-button type="primary" block :text="submitting ? '发布中…' : '发布动态'" :disabled="submitting" @click="submit" />
    </view>
  </view>
</template>

<style lang="scss" scoped>
.post-page {
  min-height: 100vh;
  padding: 24rpx 32rpx 48rpx;
  background: $color-bg-canvas;
  box-sizing: border-box;
}

.post-head {
  padding: 24rpx;
  border-radius: $radius-lg;
  border: 4rpx solid $memphis-dark;
  background: $color-bg-card;
  box-shadow: $shadow-memphis-sm;

  &__title {
    font-family: $font-display;
    font-size: 36rpx;
    font-weight: 700;
    color: $color-text-title;
  }

  &__desc {
    display: block;
    margin-top: 12rpx;
    font-size: $fs-caption;
    line-height: 1.6;
    color: $color-text-muted;
  }

  &__link {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 6rpx;
    margin-top: 16rpx;
    font-size: $fs-caption;
    font-weight: 600;
    color: $color-primary;
  }

  &__arrow {
    font-size: 24rpx;
  }
}

.post-card {
  margin-top: 24rpx;
  padding: 24rpx;
  border-radius: $radius-lg;
  border: 3rpx solid $memphis-dark;
  background: $color-bg-card;
  box-shadow: $shadow-memphis-xs;
}

.post-field {
  position: relative;
  padding: 20rpx 0;

  & + & {
    border-top: 2rpx dashed $color-border-light;
  }

  &__label {
    display: block;
    margin-bottom: 16rpx;
    font-size: $fs-caption;
    font-weight: 700;
    color: $color-text-title;
  }

  &__count {
    position: absolute;
    right: 0;
    bottom: 8rpx;
    font-size: 20rpx;
    color: $color-text-muted;
  }

  &__empty {
    font-size: $fs-caption;
    color: $color-text-muted;
  }
}

.post-picker {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20rpx 24rpx;
  border-radius: $radius-md;
  border: 2rpx solid $memphis-dark;
  background: $color-bg-canvas;
  font-size: $fs-body;
  color: $color-text-body;

  &__arrow {
    color: $color-text-muted;
  }
}

.post-textarea {
  width: 100%;
  min-height: 220rpx;
  padding: 20rpx 24rpx;
  border-radius: $radius-md;
  border: 2rpx solid $memphis-dark;
  background: $color-bg-canvas;
  font-size: $fs-body;
  line-height: 1.6;
  color: $color-text-body;
  box-sizing: border-box;
}

.post-hint {
  display: block;
  margin-top: 12rpx;
  font-size: $fs-caption;
  color: $color-danger;
}

.post-submit {
  margin-top: 32rpx;
}
</style>