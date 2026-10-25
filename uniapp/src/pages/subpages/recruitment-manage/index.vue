<script>
/**
 * 招新管理列表（负责人端 / CLB-04① / P1-16）
 *
 * 承接 club-admin「招新管理」入口：我管理的社团的招新岗位，状态 tab + 分页 + 新建
 * 行操作按状态：草稿 → 编辑 / 提交审核；开放中 → 手动关闭；驳回 → 展示理由并可重提
 * 数据来源：GET /recruitment/manage（status 支持 all / draft / pending / open / closed）
 * 入口：社团管理主页「招新管理」
 */
import { getRecruitmentManage, closeRecruitment } from '@/api/recruitment'
import { ERROR_CODE } from '@/utils/config'

const PAGE_SIZE = 20
const TABS = [
  { value: 'all', label: '全部' },
  { value: 'draft', label: '草稿' },
  { value: 'pending', label: '待审核' },
  { value: 'open', label: '开放中' },
  { value: 'closed', label: '已关闭' },
]
const STATUS_META = {
  draft: { label: '草稿', cls: 'muted' },
  pending: { label: '待审核', cls: 'pending' },
  open: { label: '开放中', cls: 'success' },
  closed: { label: '已关闭', cls: 'muted' },
}

export default {
  name: 'RecruitmentManage',

  data: () => ({
    clubId: '',
    tabs: TABS,
    currentTab: 'all',
    loading: true,
    loadingMore: false,
    list: [],
    total: 0,
    page: 1,
    hasMore: false,
    error: '',
    pendingId: '',
  }),

  computed: {
    isEmpty() {
      return !this.loading && !this.error && this.list.length === 0
    },
  },

  onLoad(query) {
    this.clubId = (query && query.club_id) || ''
  },

  onShow() {
    this.load()
  },

  onReachBottom() {
    this.loadMore()
  },

  methods: {
    async load() {
      this.loading = true
      this.error = ''
      const res = await getRecruitmentManage({ status: this.currentTab, page: 1, page_size: PAGE_SIZE })
      this.loading = false
      if (res.code !== ERROR_CODE.SUCCESS) {
        this.error = res.message || '招新列表加载失败，请检查网络后重试'
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
      const res = await getRecruitmentManage({ status: this.currentTab, page: this.page + 1, page_size: PAGE_SIZE })
      this.loadingMore = false
      if (res.code !== ERROR_CODE.SUCCESS) {
        uni.showToast({ title: res.message || '加载更多失败，请稍后重试', icon: 'none' })
        return
      }
      this.list = this.list.concat((res.data && res.data.list) || [])
      this.page += 1
      this.hasMore = !!(res.data && res.data.has_more)
    },

    switchTab(value) {
      if (this.currentTab === value) return
      this.currentTab = value
      this.load()
    },

    statusMeta(status) {
      return STATUS_META[status] || { label: status, cls: 'muted' }
    },

    formatTime(value) {
      if (!value) return '时间待定'
      const raw = typeof value === 'object' && value.$date ? value.$date : value
      const date = new Date(raw)
      if (Number.isNaN(date.getTime())) return '时间待定'
      const pad = (n) => String(n).padStart(2, '0')
      const year = date.getFullYear() === new Date().getFullYear() ? '' : `${date.getFullYear()}-`
      return `${year}${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    },

    goCreate() {
      uni.navigateTo({ url: this.clubId ? `/pages/subpages/recruitment-edit/index?club_id=${this.clubId}` : '/pages/subpages/recruitment-edit/index' })
    },

    goEdit(row) {
      if (row.status !== 'draft') {
        uni.showToast({ title: '仅草稿可编辑', icon: 'none' })
        return
      }
      uni.navigateTo({ url: `/pages/subpages/recruitment-edit/index?id=${row._id}` })
    },

    goSubmit(row) {
      if (row.status !== 'draft') return
      uni.navigateTo({ url: `/pages/subpages/recruitment-edit/index?id=${row._id}&submit=1` })
    },

    goApplicants(row) {
      uni.navigateTo({ url: `/pages/subpages/applicants/index?id=${row._id}` })
    },

    async close(row) {
      if (row.status !== 'open') return
      try {
        const res = await new Promise((resolve) => {
          uni.showModal({
            title: '关闭招新',
            content: `确认关闭「${row.title}」？关闭后学生无法继续报名。`,
            confirmText: '确认关闭',
            cancelText: '取消',
            success: resolve,
          })
        })
        if (!res.confirm) return
      } catch (e) {
        return
      }
      this.pendingId = row._id
      const apiRes = await closeRecruitment(row._id)
      this.pendingId = ''
      if (apiRes.code !== ERROR_CODE.SUCCESS) {
        uni.showToast({ title: apiRes.message || '操作失败，请稍后重试', icon: 'none' })
        return
      }
      uni.showToast({ title: '招新已关闭', icon: 'none' })
      await this.load()
    },
  },
}
</script>

<template>
  <view class="rcm-page">
    <!-- 标题 + 新建 -->
    <view class="rcm-head">
      <view class="rcm-head__main">
        <text class="rcm-head__title">招新管理</text>
        <text class="rcm-head__sub">共 {{ total }} 个岗位</text>
      </view>
      <sb-button type="primary" size="sm" text="新建岗位" @click="goCreate" />
    </view>

    <!-- 状态 tab -->
    <scroll-view class="rcm-tabs" scroll-x :show-scrollbar="false">
      <view class="rcm-tabs__row">
        <view
          v-for="tab in tabs"
          :key="tab.value"
          class="rcm-tab"
          :class="{ 'rcm-tab--active': currentTab === tab.value }"
          @tap="switchTab(tab.value)"
        >
          {{ tab.label }}
        </view>
      </view>
    </scroll-view>

    <!-- 加载态 -->
    <view v-if="loading" class="rcm-card">
      <sb-skeleton :rows="4" />
    </view>

    <!-- 失败态 -->
    <view v-else-if="error" class="rcm-card">
      <sb-error :text="error" @retry="load" />
    </view>

    <!-- 空态 -->
    <view v-else-if="isEmpty" class="rcm-empty">
      <sb-illustration icon="eye" tone="warning" />
      <view class="rcm-empty__badge">该状态下暂无岗位</view>
      <sb-button v-if="currentTab === 'draft' || currentTab === 'all'" type="primary" size="sm" text="创建第一个岗位" @click="goCreate" />
    </view>

    <!-- 岗位列表 -->
    <template v-else>
      <view v-for="row in list" :key="row._id" class="rcm-card">
        <view class="rcm-card__head">
          <view class="rcm-card__main">
            <view class="rcm-card__title-row">
              <text class="rcm-card__title">{{ row.title }}</text>
              <view class="rcm-card__status" :class="`rcm-card__status--${statusMeta(row.status).cls}`">
                {{ statusMeta(row.status).label }}
              </view>
            </view>
            <text class="rcm-card__club">{{ row.club_name || '未知社团' }} · 报名截止 {{ formatTime(row.signup_end) }} · 招聘 {{ row.capacity || '不限' }} 人</text>
            <text class="rcm-card__meta">报名表 {{ row.form_fields ? row.form_fields.length : 0 }} 项<template v-if="row.multi_step"> · 多步（含面试）</template></text>
            <text v-if="row.status === 'draft' && row.reject_reason" class="rcm-card__reason">驳回理由：{{ row.reject_reason }}</text>
          </view>
        </view>

        <!-- 行操作 -->
        <view v-if="row.status === 'draft'" class="rcm-card__actions">
          <view class="rcm-card__action" @tap.stop="goEdit(row)">
            <sb-button type="ghost" size="sm" block text="编辑" />
          </view>
          <view class="rcm-card__action" @tap.stop="goSubmit(row)">
            <sb-button type="primary" size="sm" block text="提交审核" />
          </view>
        </view>
        <view v-else-if="row.status === 'open' || row.status === 'closed'" class="rcm-card__actions">
          <view class="rcm-card__action" @tap.stop="goApplicants(row)">
            <sb-button type="ghost" size="sm" block text="申请人" />
          </view>
          <view v-if="row.status === 'open'" class="rcm-card__action" @tap.stop="close(row)">
            <sb-button type="reject" size="sm" block :loading="pendingId === row._id" text="手动关闭" />
          </view>
        </view>
        <text v-else-if="row.status === 'pending'" class="rcm-card__note">管理员正在审核，审核结果将通知你</text>
      </view>

      <!-- 分页状态 -->
      <view class="rcm-more">
        <text v-if="loadingMore" class="rcm-more__text">加载更多…</text>
        <text v-else-if="hasMore" class="rcm-more__text">上拉加载更多</text>
        <text v-else class="rcm-more__text">已加载全部 {{ total }} 个岗位</text>
      </view>
    </template>
  </view>
</template>

<style lang="scss" scoped>
.rcm-page {
  min-height: 100vh;
  padding: 24rpx 32rpx 48rpx;
  background: $color-bg-canvas;
  box-sizing: border-box;
}

.rcm-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
  padding: 28rpx 32rpx;
  border-radius: $radius-lg;
  border: 4rpx solid $memphis-dark;
  background: $color-bg-card;
  box-shadow: $shadow-memphis-md;

  &__main {
    display: flex;
    flex-direction: column;
    gap: 8rpx;
  }

  &__title {
    font-size: $fs-h1;
    font-weight: 700;
    color: $color-text-title;
  }

  &__sub {
    font-size: $fs-caption;
    color: $color-text-muted;
  }
}

.rcm-tabs {
  margin-top: 24rpx;
  white-space: nowrap;

  &__row {
    display: flex;
    gap: 12rpx;
  }

  .rcm-tab {
    display: inline-flex;
    padding: 10rpx 24rpx;
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
}

.rcm-card {
  margin-top: 24rpx;
  padding: 28rpx 32rpx;
  border-radius: $radius-md;
  border: 4rpx solid $memphis-dark;
  background: $color-bg-card;
  box-shadow: $shadow-memphis-sm;

  &__title-row {
    display: flex;
    align-items: center;
    gap: 12rpx;
    flex-wrap: wrap;
  }

  &__title {
    font-size: $fs-h3;
    font-weight: 700;
    color: $color-text-title;
  }

  &__status {
    padding: 4rpx 14rpx;
    border-radius: 999rpx;
    border: 3rpx solid $memphis-dark;
    font-size: $fs-caption;
    background: $color-bg-canvas;

    &--success {
      background: $color-success-light;
    }

    &--pending {
      background: $color-info-light;
    }

    &--muted {
      color: $color-text-muted;
    }
  }

  &__club,
  &__meta {
    display: block;
    margin-top: 10rpx;
    font-size: $fs-caption;
    color: $color-text-muted;
  }

  &__reason {
    display: block;
    margin-top: 10rpx;
    font-size: $fs-caption;
    color: $color-danger;
  }

  &__actions {
    display: flex;
    justify-content: flex-end;
    gap: 16rpx;
    margin-top: 20rpx;
    padding-top: 20rpx;
    border-top: 2rpx dashed $memphis-dark;

    .rcm-card__action {
      width: 220rpx;
    }
  }

  &__note {
    display: block;
    margin-top: 20rpx;
    padding-top: 20rpx;
    border-top: 2rpx dashed $memphis-dark;
    font-size: $fs-caption;
    color: $color-text-muted;
  }
}

.rcm-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20rpx;
  padding: 80rpx 0;

  &__badge {
    font-size: $fs-body;
    color: $color-text-muted;
  }
}

.rcm-more {
  padding: 24rpx 0;
  text-align: center;

  &__text {
    font-size: $fs-caption;
    color: $color-text-muted;
  }
}
</style>
