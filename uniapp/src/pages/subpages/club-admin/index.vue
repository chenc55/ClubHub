<script>
/**
 * 社团管理主页（CLB-01 / P1-09，负责人端）
 *
 * 内容：社团切换器（负责多个社团时）+ 资料卡（Logo / 名称 / 星级 / 分类 / 状态 / 成员数与活动数）
 *      + 「编辑资料」入口 + 管理入口列表（动态 / 活动 / 招新 / 成员 / 统计）
 * 权限：社长（president）与干部（officer）均可进入本页；**资料编辑仅社长**（需求 2.3 权限矩阵），
 *      干部的编辑入口置为只读说明；社团被管理员封禁时保留展示但禁用全部管理操作。
 * 数据来源：GET /club/my-clubs（服务端已判定 can_edit）
 * 入口：入驻申请通过后从「社团入驻申请」页进入；个人中心入口由 P1-24 接入
 */
import { getMyClubs } from '@/api/club'
import { useUserStore } from '@/store/user'
import { ERROR_CODE } from '@/utils/config'

const ROLE_LABEL = { president: '社长', officer: '干部' }
const STATUS_META = {
  normal: { label: '正常', cls: 'normal' },
  pending: { label: '待审核', cls: 'pending' },
  rejected: { label: '已驳回', cls: 'rejected' },
  banned: { label: '已封禁', cls: 'banned' },
}
/** 管理入口：对应页面由后续任务实现；已接入的（活动管理 P1-10）直接跳转，未接入前置灰并提示 */
const ENTRIES = [
  { key: 'posts', mark: '动', tone: 'warning', label: '社团动态', desc: '发布图文动态、查看审核状态', page: '/pages/subpages/post-create/index' },
  { key: 'activities', mark: '活', tone: 'primary', label: '活动管理', desc: '创建活动、报名名单、签到管理', task: 'P1-10 ~ P1-15', page: '/pages/subpages/activity-manage/index' },
  { key: 'recruitments', mark: '招', tone: 'success', label: '招新管理', desc: '发布岗位、筛选与录取申请人', task: 'P1-16 ~ P1-18', page: '/pages/subpages/recruitment-manage/index' },
  { key: 'members', mark: '员', tone: 'info', label: '成员管理', desc: '查看成员、设置与撤销干部', task: 'P1-19', page: '/pages/subpages/members/index' },
  { key: 'stats', mark: '统', tone: 'warning', label: '社团统计', desc: '活动 / 报名 / 成员数据概览', task: 'P1-20', page: '/pages/subpages/stats/index' },
]

export default {
  name: 'ClubAdmin',

  data: () => ({
    loading: true,
    error: '',
    list: [],
    currentIndex: 0,
    entries: ENTRIES,
  }),

  computed: {
    userStore() {
      return useUserStore()
    },
    isVerified() {
      return this.userStore.isAuthenticated
    },
    isEmpty() {
      return !this.loading && !this.error && this.list.length === 0
    },
    current() {
      return this.list[this.currentIndex] || null
    },
    currentClub() {
      return this.current ? this.current.club : null
    },
    currentStatus() {
      return (this.currentClub && STATUS_META[this.currentClub.status]) || null
    },
    roleLabel() {
      return (this.current && ROLE_LABEL[this.current.role]) || '成员'
    },
    /** 编辑入口可用性提示：区分「非社长」与「社团被封禁」 */
    editHint() {
      if (!this.current) return ''
      if (this.current.club.status === 'banned') return '社团已被封禁，暂不可编辑资料'
      if (this.current.role !== 'president') return '仅社长可编辑社团资料，如需修改请联系社长'
      return ''
    },
  },

  onShow() {
    this.load()
  },

  methods: {
    async load() {
      this.loading = true
      this.error = ''
      const res = await getMyClubs()
      this.loading = false

      if (res.code === ERROR_CODE.UNAUTHORIZED) {
        this.list = []
        return
      }
      if (res.code !== ERROR_CODE.SUCCESS) {
        this.error = res.message || '社团信息加载失败，请检查网络后重试'
        this.list = []
        return
      }
      this.list = (res.data && res.data.list) || []
      if (this.currentIndex >= this.list.length) this.currentIndex = 0
      // 同步到全局状态，供后续负责人端页面（活动 / 招新 / 成员）复用
      this.userStore.setClubRoles(
        this.list.map((item) => ({
          club_id: item.club._id,
          club_name: item.club.name,
          role: item.role,
          can_edit: item.can_edit,
        }))
      )
    },

    switchClub(index) {
      if (index === this.currentIndex) return
      this.currentIndex = index
    },

    starText(level) {
      const value = Math.min(5, Math.max(0, Number(level) || 0))
      if (!value) return '未评定'
      return `${'★'.repeat(value)}${'☆'.repeat(5 - value)}`
    },

    goEdit() {
      if (!this.current || !this.current.can_edit) return
      uni.navigateTo({ url: `/pages/subpages/club-profile/index?club_id=${this.current.club._id}` })
    },

    goApply() {
      uni.navigateTo({ url: '/pages/subpages/club-apply/index' })
    },

    goLogin() {
      uni.navigateTo({ url: '/pages/subpages/login/index?reason=need_auth' })
    },

    goDetail() {
      if (!this.current) return
      uni.navigateTo({ url: `/pages/subpages/club-detail/index?id=${this.current.club._id}` })
    },

    /** 管理入口：已接入的直接跳转，未接入的提示所属任务 */
    onEntry(entry) {
      if (entry.page) {
        // 招新 / 活动等管理入口携带当前社团 id，供多社团负责人定向操作
        const clubId = this.current && this.current.club && this.current.club._id
        const sep = entry.page.indexOf('?') === -1 ? '?' : '&'
        uni.navigateTo({ url: clubId ? `${entry.page}${sep}club_id=${clubId}` : entry.page })
        return
      }
      uni.showToast({ title: `「${entry.label}」由 ${entry.task} 接入`, icon: 'none' })
    },
  },
}
</script>

<template>
  <view class="admin-page">
    <!-- 未认证引导 -->
    <view v-if="!isVerified" class="admin-card">
      <text class="admin-card__title">社团管理</text>
      <text class="admin-card__desc">管理社团资料需先完成学号认证；认证通过且被指定为社长 / 干部后即可进入。</text>
      <view class="admin-card__cta" @tap="goLogin">
        <sb-button type="primary" block text="去登录 / 认证" />
      </view>
    </view>

    <template v-else>
      <!-- 加载态 -->
      <view v-if="loading" class="admin-card">
        <sb-skeleton :rows="4" />
      </view>

      <!-- 失败态 -->
      <view v-else-if="error" class="admin-card">
        <sb-error :text="error" @retry="load" />
      </view>

      <!-- 空态：无管理社团 -->
      <template v-else-if="isEmpty">
        <view class="admin-empty">
          <sb-illustration icon="eye" tone="warning" />
          <view class="admin-empty__badge">你还没有管理的社团</view>
          <text class="admin-empty__note">
            社团入驻审核通过后，你会自动成为该社团社长；若已入驻仍未显示，请联系社联为你指定社长 / 干部身份。
          </text>
          <sb-button type="primary" size="sm" text="申请创建新社团" @click="goApply" />
        </view>
      </template>

      <template v-else>
        <!-- 社团切换器（负责多个社团时显示） -->
        <view v-if="list.length > 1" class="admin-switch">
          <text class="admin-switch__label">切换社团（{{ list.length }} 个）</text>
          <scroll-view class="admin-switch__scroll" scroll-x :show-scrollbar="false">
            <view class="admin-switch__row">
              <view
                v-for="(item, index) in list"
                :key="item.club._id"
                class="admin-switch__chip"
                :class="{ 'admin-switch__chip--active': index === currentIndex }"
                @tap="switchClub(index)"
              >
                {{ item.club.name }}
              </view>
            </view>
          </scroll-view>
        </view>

        <!-- 资料卡 -->
        <view class="admin-card">
          <view class="admin-card__head">
            <view class="admin-logo">
              <image v-if="currentClub.logo" class="admin-logo__img" :src="currentClub.logo" mode="aspectFill" />
              <text v-else class="admin-logo__text">{{ (currentClub.name || '?').slice(0, 1) }}</text>
            </view>
            <view class="admin-card__main">
              <view class="admin-card__title-row">
                <text class="admin-card__name">{{ currentClub.name }}</text>
                <view class="admin-role">{{ roleLabel }}</view>
              </view>
              <view class="admin-card__pills">
                <view class="admin-star" :class="{ 'admin-star--none': !currentClub.star_level }">
                  {{ starText(currentClub.star_level) }}
                </view>
                <view v-if="currentClub.category_name" class="admin-pill">{{ currentClub.category_name }}</view>
                <view v-if="currentStatus" class="admin-status" :class="`admin-status--${currentStatus.cls}`">
                  {{ currentStatus.label }}
                </view>
              </view>
            </view>
          </view>

          <view class="admin-stats">
            <view class="admin-stats__item">
              <text class="admin-stats__num">{{ currentClub.member_count }}</text>
              <text class="admin-stats__label">成员</text>
            </view>
            <view class="admin-stats__item">
              <text class="admin-stats__num admin-stats__num--activity">{{ currentClub.activity_count }}</text>
              <text class="admin-stats__label">活动</text>
            </view>
          </view>

          <!-- 编辑资料 / 只读说明 -->
          <view v-if="current.can_edit" class="admin-card__cta" @tap="goEdit">
            <sb-button type="primary" block text="编辑资料" />
          </view>
          <view v-else class="admin-readonly">
            <text class="admin-readonly__text">{{ editHint }}</text>
          </view>

          <view class="admin-card__link" @tap="goDetail">
            <text class="admin-card__link-text">查看学生端展示效果</text>
            <text class="admin-card__link-arrow">›</text>
          </view>
        </view>

        <!-- 管理入口列表 -->
        <view class="admin-card admin-card--list">
          <text class="admin-card__section">管理入口</text>
          <view
            v-for="entry in entries"
            :key="entry.key"
            class="admin-entry"
            @tap="onEntry(entry)"
          >
            <view class="admin-entry__mark" :class="`admin-entry__mark--${entry.tone}`">{{ entry.mark }}</view>
            <view class="admin-entry__main">
              <view class="admin-entry__title-row">
                <text class="admin-entry__title">{{ entry.label }}</text>
                <view class="admin-entry__badge">待接入</view>
              </view>
              <text class="admin-entry__desc">{{ entry.desc }}</text>
            </view>
            <text class="admin-entry__task">{{ entry.task }}</text>
          </view>
        </view>
      </template>
    </template>
  </view>
</template>

<style lang="scss" scoped>
.admin-page {
  min-height: 100vh;
  padding: 24rpx 32rpx 48rpx;
  background: $color-bg-canvas;
  box-sizing: border-box;
}

.admin-card {
  padding: 32rpx;
  border-radius: $radius-lg;
  border: 4rpx solid $memphis-dark;
  background: $color-bg-card;
  box-shadow: $shadow-memphis-md;

  &--list {
    margin-top: 24rpx;
    border-radius: $radius-md;
    box-shadow: $shadow-memphis-sm;
  }

  &__title {
    display: block;
    font-size: $fs-h1;
    font-weight: 700;
    color: $color-text-title;
  }

  &__desc {
    display: block;
    margin-top: 16rpx;
    font-size: $fs-body;
    line-height: 1.6;
    color: $color-text-muted;
  }

  &__section {
    display: block;
    margin-bottom: 8rpx;
    font-size: $fs-h3;
    font-weight: 700;
    color: $color-text-title;
  }

  &__head {
    display: flex;
    align-items: center;
    gap: 24rpx;
  }

  &__main {
    flex: 1;
    min-width: 0;
  }

  &__title-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16rpx;
  }

  &__name {
    flex: 1;
    font-size: $fs-h2;
    font-weight: 700;
    color: $color-text-title;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  &__pills {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 12rpx;
    margin-top: 16rpx;
  }

  &__cta {
    margin-top: 28rpx;
  }

  &__link {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8rpx;
    margin-top: 24rpx;
    padding-top: 24rpx;
    border-top: 3rpx dashed $color-border-light;
    @include press-active;
  }

  &__link-text {
    font-size: $fs-caption;
    color: $color-text-muted;
  }

  &__link-arrow {
    font-size: $fs-body;
    color: $color-text-muted;
  }
}

/* 社团切换器 */
.admin-switch {
  margin-bottom: 24rpx;

  &__label {
    display: block;
    margin-bottom: 12rpx;
    font-size: $fs-caption;
    color: $color-text-muted;
  }

  &__scroll {
    width: 100%;
    white-space: nowrap;
  }

  &__row {
    display: inline-flex;
    align-items: center;
    gap: 16rpx;
  }

  &__chip {
    flex-shrink: 0;
    max-width: 420rpx;
    overflow: hidden;
    padding: 12rpx 28rpx;
    border-radius: $radius-full;
    border: 3rpx solid $memphis-dark;
    background: $color-bg-card;
    color: $color-text-body;
    font-size: $fs-caption;
    font-weight: 600;
    white-space: nowrap;
    text-overflow: ellipsis;
    @include memphis-shadow('xs');
    @include press-active;

    &--active {
      background: $color-primary;
      color: #ffffff;
      box-shadow: $shadow-memphis-sm;
    }
  }
}

/* Logo 块 */
.admin-logo {
  flex-shrink: 0;
  width: 112rpx;
  height: 112rpx;
  border-radius: $radius-md;
  border: 4rpx solid $memphis-dark;
  background: $color-primary-light;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  box-shadow: $shadow-memphis-xs;

  &__img {
    width: 100%;
    height: 100%;
  }

  &__text {
    font-size: $fs-h2;
    font-weight: 700;
    color: $color-primary;
  }
}

/* 角色 / 星级 / 分类 / 状态 徽标 */
.admin-role {
  flex-shrink: 0;
  padding: 6rpx 20rpx;
  border-radius: $radius-full;
  border: 3rpx solid $memphis-dark;
  background: $color-success;
  color: $memphis-dark;
  font-size: $fs-caption;
  font-weight: 700;
  box-shadow: $shadow-memphis-xs;
}

.admin-star {
  padding: 6rpx 20rpx;
  border-radius: $radius-full;
  border: 3rpx solid $memphis-dark;
  background: $color-warning;
  color: $memphis-dark;
  font-size: $fs-caption;
  font-weight: 700;
  box-shadow: $shadow-memphis-xs;

  &--none {
    background: $color-bg-canvas;
    color: $color-text-muted;
    font-weight: 600;
    box-shadow: none;
  }
}

.admin-pill {
  padding: 6rpx 20rpx;
  border-radius: $radius-full;
  border: 3rpx solid $memphis-dark;
  background: $color-primary-light;
  color: $color-primary;
  font-size: $fs-caption;
  font-weight: 600;
}

.admin-status {
  padding: 6rpx 20rpx;
  border-radius: $radius-full;
  border: 3rpx solid $memphis-dark;
  font-size: $fs-caption;
  font-weight: 600;

  &--normal {
    background: $color-success;
    color: $memphis-dark;
  }

  &--pending {
    background: $color-warning;
    color: $memphis-dark;
  }

  &--banned,
  &--rejected {
    background: $color-danger-light;
    color: $color-danger;
    border-color: $color-danger;
  }
}

/* 数据条 */
.admin-stats {
  display: flex;
  align-items: center;
  gap: 56rpx;
  margin-top: 28rpx;
  padding-top: 28rpx;
  border-top: 3rpx dashed $color-border-light;

  &__item {
    display: flex;
    align-items: baseline;
    gap: 10rpx;
  }

  &__num {
    font-family: $font-display;
    font-size: $fs-h2;
    font-weight: 700;
    color: $color-primary;

    &--activity {
      color: $color-success;
    }
  }

  &__label {
    font-size: $fs-caption;
    color: $color-text-muted;
  }
}

/* 只读说明（干部 / 封禁） */
.admin-readonly {
  margin-top: 28rpx;
  padding: 24rpx;
  border-radius: $radius-md;
  border: 3rpx dashed $color-border-light;
  background: $color-bg-canvas;

  &__text {
    font-size: $fs-caption;
    line-height: 1.6;
    color: $color-text-muted;
  }
}

/* 管理入口 */
.admin-entry {
  display: flex;
  align-items: center;
  gap: 20rpx;
  padding: 24rpx 0;
  border-bottom: 3rpx solid $color-border-light;
  @include press-active;

  &:last-child {
    border-bottom: 0;
  }

  &__mark {
    flex-shrink: 0;
    width: 72rpx;
    height: 72rpx;
    border-radius: $radius-sm;
    border: 3rpx solid $memphis-dark;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: $fs-h3;
    font-weight: 700;
    color: $memphis-dark;
    box-shadow: $shadow-memphis-xs;

    &--primary {
      background: $color-primary-light;
    }

    &--success {
      background: $color-success-light;
    }

    &--warning {
      background: $color-warning-light;
    }

    &--info {
      background: $color-info-light;
    }
  }

  &__main {
    flex: 1;
    min-width: 0;
  }

  &__title-row {
    display: flex;
    align-items: center;
    gap: 12rpx;
  }

  &__title {
    font-size: $fs-body;
    font-weight: 700;
    color: $color-text-title;
  }

  &__badge {
    padding: 2rpx 14rpx;
    border-radius: $radius-full;
    border: 2rpx solid $color-border-light;
    background: $color-bg-canvas;
    color: $color-text-muted;
    font-size: $fs-caption;
  }

  &__desc {
    display: block;
    margin-top: 8rpx;
    font-size: $fs-caption;
    color: $color-text-muted;
  }

  &__task {
    flex-shrink: 0;
    font-size: $fs-caption;
    color: $color-text-muted;
  }
}

/* 空态（虚线描边卡） */
.admin-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 48rpx 32rpx;
  border-radius: $radius-lg;
  border: 4rpx dashed $memphis-dark;
  background: $color-bg-card;

  &__badge {
    margin-top: 28rpx;
    padding: 10rpx 28rpx;
    border-radius: $radius-full;
    border: 3rpx solid $memphis-dark;
    background: $color-warning;
    color: $memphis-dark;
    font-size: $fs-caption;
    font-weight: 600;
    box-shadow: $shadow-memphis-xs;
  }

  &__note {
    margin: 24rpx 0 32rpx;
    font-size: $fs-caption;
    line-height: 1.6;
    color: $color-text-muted;
    text-align: center;
  }
}
</style>
