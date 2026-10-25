<script>
/**
 * 我的报名（STU-08 / P1-24 升级为双 Tab；原活动 Tab 为 P1-13）
 *
 * 活动 Tab：活动报名列表（快照 + 状态标签 + 签到结果 + 取消，可取消时释放名额并候补递补）
 * 招新 Tab：我的招新报名（状态 tab 内嵌：面试 / 录取信息）
 * 数据来源：GET /activity/my-registrations + POST /activity/cancel；GET /recruitment/my-status
 */
import { getMyRegistrations, cancelRegistration } from '@/api/activity'
import { getMyRecruitments } from '@/api/recruitment'
import { useUserStore } from '@/store/user'
import { ERROR_CODE } from '@/utils/config'

const PAGE_SIZE = 20
const REG_STATUS_META = {
  pending: { label: '待审核', cls: 'pending' },
  approved: { label: '已报名', cls: 'success' },
  waitlist: { label: '候补中', cls: 'warning' },
  rejected: { label: '已驳回', cls: 'rejected' },
  cancelled: { label: '已取消', cls: 'muted' },
}
const RC_STATUS_META = {
  pending: { label: '待审核', cls: 'pending' },
  interview: { label: '面试', cls: 'warning' },
  accepted: { label: '已录取', cls: 'success' },
  rejected: { label: '已淘汰', cls: 'rejected' },
}
const TABS = [
  { value: 'activity', label: '活动报名' },
  { value: 'recruitment', label: '招新报名' },
]

export default {
  name: 'MyRegistrations',

  data: () => ({
    tabs: TABS,
    currentTab: 'activity',
    // 活动 Tab
    loading: true,
    loadingMore: false,
    list: [],
    total: 0,
    page: 1,
    hasMore: false,
    error: '',
    pendingId: '',
    // 招新 Tab
    rcLoading: false,
    rcError: '',
    rcList: [],
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
    rcEmpty() {
      return !this.rcLoading && !this.rcError && this.rcList.length === 0
    },
  },

  onShow() {
    if (!this.isVerified) return
    if (this.currentTab === 'activity') this.load()
    else this.loadRecruitments()
  },

  onReachBottom() {
    if (this.currentTab === 'activity') this.loadMore()
  },

  methods: {
    switchTab(value) {
      if (this.currentTab === value) return
      this.currentTab = value
      this.error = ''
      if (value === 'activity') this.load()
      else this.loadRecruitments()
    },

    regMeta(status) {
      return REG_STATUS_META[status] || { label: status, cls: 'muted' }
    },

    rcMeta(status) {
      return RC_STATUS_META[status] || { label: status, cls: 'muted' }
    },

    async load() {
      this.loading = true
      this.error = ''
      const res = await getMyRegistrations({ page: 1, page_size: PAGE_SIZE })
      this.loading = false
      if (res.code !== ERROR_CODE.SUCCESS) {
        this.error = res.message || '报名列表加载失败，请检查网络后重试'
        this.list = []
        this.total = 0
        this.hasMore = false
        return
      }
      this.list = (res.data && res.data.list) || []
      this.total = (res.data && res.data.total) || 0
      this.hasMore = !!(res.data && res.data.has_more)
      this.page = 1
    },

    async loadMore() {
      if (this.loading || this.loadingMore || !this.hasMore || this.error) return
      this.loadingMore = true
      const res = await getMyRegistrations({ page: this.page + 1, page_size: PAGE_SIZE })
      this.loadingMore = false
      if (res.code !== ERROR_CODE.SUCCESS) return
      this.list = this.list.concat((res.data && res.data.list) || [])
      this.page += 1
      this.hasMore = !!(res.data && res.data.has_more)
    },

    /** 招新 Tab：我的招新报名（join 岗位/社团 + 状态 + 面试/录取） */
    async loadRecruitments() {
      this.rcLoading = true
      this.rcError = ''
      const res = await getMyRecruitments({})
      this.rcLoading = false
      if (res.code !== ERROR_CODE.SUCCESS) {
        this.rcError = res.message || '招新记录加载失败，请检查网络后重试'
        this.rcList = []
        return
      }
      this.rcList = (res.data && res.data.list) || []
    },

    goLogin() {
      uni.navigateTo({ url: '/pages/subpages/login/index?reason=need_auth' })
    },

    goDetail(item) {
      uni.navigateTo({ url: `/pages/subpages/activity-detail/index?id=${item.activity_id}` })
    },

    async cancel(item) {
      if (!item.can_cancel) return
      try {
        const res = await new Promise((resolve) => {
          uni.showModal({
            title: '取消报名',
            content: `确认取消「${item.activity.title}」的报名？取消后若该活动有候补，将按报名顺序自动递补。`,
            confirmText: '确认取消',
            cancelText: '保留报名',
            success: resolve,
          })
        })
        if (!res.confirm) return
      } catch (e) {
        return
      }

      this.pendingId = item.registration_id
      const apiRes = await cancelRegistration(item.activity_id)
      this.pendingId = ''
      if (apiRes.code !== ERROR_CODE.SUCCESS) {
        uni.showToast({ title: apiRes.message || '取消失败，请稍后重试', icon: 'none' })
        return
      }
      const promoted = apiRes.data && apiRes.data.promoted
      uni.showToast({ title: promoted ? '已取消，候补已递补' : '已取消报名', icon: 'none' })
      await this.load()
    },

    formatTime(value) {
      if (!value) return '—'
      const raw = typeof value === 'object' && value.$date ? value.$date : value
      const date = new Date(raw)
      if (Number.isNaN(date.getTime())) return '—'
      const pad = (n) => String(n).padStart(2, '0')
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    },
  },
}
</script>

<template>
  <view class="mine-page">
    <!-- 未认证引导 -->
    <view v-if="!isVerified" class="mine-card">
      <text class="mine-card__title">我的报名</text>
      <text class="mine-card__desc">查看报名记录需先完成学号认证。</text>
      <view class="mine-card__cta" @tap="goLogin">
        <sb-button type="primary" block text="去登录 / 认证" />
      </view>
    </view>

    <template v-else>
      <!-- 双 Tab -->
      <view class="mine-tabs">
        <view
          v-for="tab in tabs"
          :key="tab.value"
          class="mine-tab"
          :class="{ 'mine-tab--active': currentTab === tab.value }"
          @tap="switchTab(tab.value)"
        >
          {{ tab.label }}
        </view>
      </view>

      <!-- 活动报名 Tab -->
      <template v-if="currentTab === 'activity'">
        <view v-if="loading" class="mine-card">
          <sb-skeleton :rows="4" />
        </view>
        <view v-else-if="error" class="mine-card">
          <sb-error :text="error" @retry="load" />
        </view>
        <view v-else-if="isEmpty" class="mine-empty">
          <sb-illustration icon="eye" tone="warning" />
          <view class="mine-empty__badge">暂无活动报名</view>
        </view>
        <template v-else>
          <view v-for="item in list" :key="item.registration_id" class="mine-card">
            <view class="mine-row" @tap="goDetail(item)">
              <view class="mine-row__main">
                <view class="mine-row__top">
                  <text class="mine-row__title">{{ item.activity.title }}</text>
                  <text class="mine-row__status" :class="`mine-row__status--${regMeta(item.status).cls}`">
                    {{ regMeta(item.status).label }}
                  </text>
                </view>
                <text class="mine-row__meta">
                  报名于 {{ formatTime(item.signup_at) }}<template v-if="item.checked_in"> · 已签到</template>
                </text>
              </view>
            </view>
            <view v-if="item.can_cancel" class="mine-row__actions">
              <view class="mine-row__action">
                <sb-button type="reject" size="sm" block :loading="pendingId === item.registration_id" text="取消报名" @click="cancel(item)" />
              </view>
            </view>
          </view>
          <view class="mine-more">
            <text class="mine-more__text">{{ hasMore ? '上拉加载更多' : `已加载全部 ${total} 条` }}</text>
          </view>
        </template>
      </template>

      <!-- 招新报名 Tab -->
      <template v-else>
        <view v-if="rcLoading" class="mine-card">
          <sb-skeleton :rows="4" />
        </view>
        <view v-else-if="rcError" class="mine-card">
          <sb-error :text="rcError" @retry="loadRecruitments" />
        </view>
        <view v-else-if="rcEmpty" class="mine-empty">
          <sb-illustration icon="eye" tone="warning" />
          <view class="mine-empty__badge">暂无招新报名</view>
        </view>
        <template v-else>
          <view v-for="row in rcList" :key="row.recruitment_id" class="mine-card">
            <view class="mine-row">
              <view class="mine-row__main">
                <view class="mine-row__top">
                  <text class="mine-row__title">{{ row.recruitment_title || '未知岗位' }}</text>
                  <text class="mine-row__status" :class="`mine-row__status--${rcMeta(row.status).cls}`">
                    {{ rcMeta(row.status).label }}
                  </text>
                </view>
                <text class="mine-row__meta">
                  {{ row.club_name || '未知社团' }} · 报名于 {{ formatTime(row.applied_at) || '—' }}
                </text>
                <view v-if="row.status === 'interview' && row.interview" class="mine-rc-note">
                  面试时间：{{ formatTime(row.interview.time) }} · 地点：{{ row.interview.place || '待定' }}
                </view>
                <view v-else-if="row.status === 'accepted'" class="mine-rc-note mine-rc-note--ok">
                  已于 {{ formatTime(row.accept_at) }} 录取，请留意加团通知
                </view>
              </view>
            </view>
          </view>
          <view class="mine-more">
            <text class="mine-more__text">已加载全部 {{ rcList.length }} 条</text>
          </view>
        </template>
      </template>
    </template>
  </view>
</template>

<style lang="scss" scoped>
.mine-page {
  min-height: 100vh;
  padding: 24rpx 32rpx 48rpx;
  background: $color-bg-canvas;
  box-sizing: border-box;
}

.mine-tabs {
  display: flex;
  gap: 12rpx;
  margin-top: 8rpx;
}

.mine-tab {
  padding: 10rpx 30rpx;
  border-radius: 999rpx;
  border: 3rpx solid $memphis-dark;
  background: $color-bg-card;
  font-size: $fs-body;
  color: $color-text-body;

  &--active {
    background: $color-primary;
    color: #ffffff;
  }
}

.mine-card {
  margin-top: 24rpx;
  padding: 28rpx 32rpx;
  border-radius: $radius-md;
  border: 4rpx solid $memphis-dark;
  background: $color-bg-card;
  box-shadow: $shadow-memphis-sm;

  &__title {
    display: block;
    font-size: $fs-h2;
    font-weight: 700;
    color: $color-text-title;
  }

  &__desc {
    display: block;
    margin-top: 12rpx;
    font-size: $fs-body;
    color: $color-text-muted;
  }

  &__cta {
    margin-top: 20rpx;
  }
}

.mine-row {
  &__main {
    display: flex;
    flex-direction: column;
    gap: 10rpx;
  }

  &__top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16rpx;
  }

  &__title {
    flex: 1;
    font-size: $fs-h3;
    font-weight: 700;
    color: $color-text-title;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__status {
    flex-shrink: 0;
    padding: 4rpx 16rpx;
    border-radius: 999rpx;
    border: 2rpx solid $memphis-dark;
    font-size: $fs-caption;
    background: $color-bg-canvas;

    &--pending {
      background: $color-info-light;
      color: $color-info-text;
    }

    &--success {
      background: $color-success-light;
      color: $color-success;
    }

    &--warning {
      background: $color-warning-light;
      color: $color-warning;
    }

    &--rejected {
      background: $color-danger-light;
      color: $color-danger;
    }

    &--muted {
      opacity: 0.6;
    }
  }

  &__meta {
    font-size: $fs-caption;
    color: $color-text-muted;
  }

  &__actions {
    display: flex;
    justify-content: flex-end;
    margin-top: 20rpx;
    padding-top: 20rpx;
    border-top: 2rpx dashed $memphis-dark;

    .mine-row__action {
      width: 200rpx;
    }
  }
}

.mine-rc-note {
  align-self: flex-start;
  padding: 8rpx 16rpx;
  border-radius: $radius-sm;
  background: $color-warning-light;
  font-size: $fs-caption;
  color: $color-warning;

  &--ok {
    background: $color-success-light;
    color: $color-success;
  }
}

.mine-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20rpx;
  padding: 100rpx 0;

  &__badge {
    font-size: $fs-body;
    color: $color-text-muted;
  }
}

.mine-more {
  padding: 24rpx 0;
  text-align: center;

  &__text {
    font-size: $fs-caption;
    color: $color-text-muted;
  }
}
</style>