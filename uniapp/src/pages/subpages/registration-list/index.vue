<script>
/**
 * 报名名单（负责人端 / CLB-03② / P1-15）
 *
 * 内容：活动摘要 + 统计（报名成功 / 已签 / 未签 / 签到率）+ 状态与签到筛选 +
 *       名单（join 姓名学号学院专业 + 报名状态 + 签到状态 + 缺席标记）+ 行操作（审核通过 / 驳回 /
 *       候补递补 / 标记缺席）+ 导出 CSV（经微信发送或下载）
 * 数据来源：GET /activity/registrations、POST /activity/review-registration、/activity/attendance、
 *          /activity/promote、GET /activity/export-csv
 * 进入方式：活动管理行操作「报名名单」
 */
import { getRegistrationList, reviewRegistration, markAttendance, promoteWaitlist, exportRegistrationCsv } from '@/api/activity'
import { ERROR_CODE } from '@/utils/config'

const PAGE_SIZE = 20
const TABS = [
  { value: 'all', label: '全部' },
  { value: 'pending', label: '待审核' },
  { value: 'approved', label: '已报名' },
  { value: 'waitlist', label: '候补' },
  { value: 'rejected', label: '已驳回' },
  { value: 'cancelled', label: '已取消' },
]
const CHECKED_TABS = [
  { value: 'all', label: '全部' },
  { value: 'yes', label: '已签到' },
  { value: 'no', label: '未签到' },
]
const STATUS_META = {
  pending: { label: '待审核', cls: 'pending' },
  approved: { label: '已报名', cls: 'success' },
  waitlist: { label: '候补', cls: 'warning' },
  rejected: { label: '已驳回', cls: 'reject' },
  cancelled: { label: '已取消', cls: 'muted' },
}

export default {
  name: 'RegistrationList',

  data: () => ({
    activityId: '',
    loading: true,
    loadingMore: false,
    error: '',
    hint: '',
    activity: null,
    tabs: TABS,
    currentTab: 'all',
    checkedTabs: CHECKED_TABS,
    checked: 'all',
    list: [],
    total: 0,
    page: 1,
    hasMore: false,
    statusCount: {},
    stats: { approved_count: 0, checked_count: 0, unchecked_count: 0, signin_rate: 0 },
    exporting: false,
    /** 驳回内联输入 */
    rejectRowId: '',
    rejectReason: '',
    promotingId: '',
    markingId: '',
  }),

  computed: {
    isEmpty() {
      return !this.loading && !this.error && this.list.length === 0
    },
    tabCount() {
      return (value) => (this.statusCount && this.statusCount[value] != null ? this.statusCount[value] : 0)
    },
  },

  onLoad(query) {
    this.activityId = (query && query.id) || ''
    if (!this.activityId) {
      this.loading = false
      this.error = '缺少活动参数，请从活动管理重新进入'
      return
    }
    this.load()
  },

  onReachBottom() {
    this.loadMore()
  },

  methods: {
    async load() {
      this.loading = true
      this.error = ''
      this.hint = ''
      this.rejectRowId = ''
      const res = await getRegistrationList({ activity_id: this.activityId, status: this.currentTab, checked: this.checked, page: 1, page_size: PAGE_SIZE })
      this.loading = false
      if (res.code !== ERROR_CODE.SUCCESS || !res.data) {
        this.error = res.message || '名单加载失败，请检查网络后重试'
        this.list = []
        this.activity = null
        return
      }
      const data = res.data
      this.activity = data.activity || null
      this.statusCount = data.status_count || {}
      this.stats = data.stats || this.stats
      this.list = data.list || []
      this.total = data.total || 0
      this.hasMore = !!data.has_more
      this.page = 1
    },

    async loadMore() {
      if (this.loading || this.loadingMore || !this.hasMore || this.error) return
      this.loadingMore = true
      const res = await getRegistrationList({ activity_id: this.activityId, status: this.currentTab, checked: this.checked, page: this.page + 1, page_size: PAGE_SIZE })
      this.loadingMore = false
      if (res.code !== ERROR_CODE.SUCCESS || !res.data) {
        uni.showToast({ title: res.message || '加载更多失败，请稍后重试', icon: 'none' })
        return
      }
      this.list = this.list.concat(res.data.list || [])
      this.page += 1
      this.hasMore = !!res.data.has_more
    },

    switchTab(value) {
      if (this.currentTab === value) return
      this.currentTab = value
      this.load()
    },

    switchChecked(value) {
      if (this.checked === value) return
      this.checked = value
      this.load()
    },

    statusMeta(status) {
      return STATUS_META[status] || { label: status, cls: 'muted' }
    },

    formatTime(value) {
      if (!value) return ''
      const raw = typeof value === 'object' && value.$date ? value.$date : value
      const date = new Date(raw)
      if (Number.isNaN(date.getTime())) return ''
      const pad = (n) => String(n).padStart(2, '0')
      return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    },

    /** 学号脱敏（需求 J：列表脱敏；导出 CSV 保留完整学号） */
    maskNo(no) {
      if (!no) return ''
      const text = String(no)
      return text.length <= 6 ? text : `${text.slice(0, 4)}****${text.slice(-2)}`
    },

    /* ---------- 报名审核 ---------- */
    async onApprove(row) {
      if (this.markingId || this.promotingId) return
      try {
        const res = await new Promise((resolve) => {
          uni.showModal({ title: '通过报名', content: `确认通过「${row.name}」的报名？`, confirmText: '通过', cancelText: '取消', success: resolve })
        })
        if (!res.confirm) return
      } catch (e) {
        return
      }
      this.markingId = row.registration_id
      const apiRes = await reviewRegistration({ activity_id: this.activityId, registration_id: row.registration_id, action: 'approve' })
      this.markingId = ''
      if (apiRes.code !== ERROR_CODE.SUCCESS) {
        uni.showToast({ title: apiRes.message || '操作失败，请稍后重试', icon: 'none' })
        return
      }
      uni.showToast({ title: '已通过，结果已通知', icon: 'none' })
      await this.load()
    },

    openReject(row) {
      this.rejectRowId = row.registration_id
      this.rejectReason = ''
    },

    cancelReject() {
      this.rejectRowId = ''
      this.rejectReason = ''
    },

    async confirmReject(row) {
      const reason = this.rejectReason.trim()
      if (!reason) {
        uni.showToast({ title: '请填写驳回理由', icon: 'none' })
        return
      }
      this.markingId = row.registration_id
      const apiRes = await reviewRegistration({ activity_id: this.activityId, registration_id: row.registration_id, action: 'reject', reason })
      this.markingId = ''
      if (apiRes.code !== ERROR_CODE.SUCCESS) {
        uni.showToast({ title: apiRes.message || '操作失败，请稍后重试', icon: 'none' })
        return
      }
      uni.showToast({ title: '已驳回，结果已通知', icon: 'none' })
      await this.load()
    },

    /* ---------- 候补递补 ---------- */
    async onPromote() {
      if (this.promotingId || this.markingId) return
      try {
        const res = await new Promise((resolve) => {
          uni.showModal({ title: '手动递补', content: '按报名顺序将首位候补转正？转正后自动通知该成员。', confirmText: '递补', cancelText: '取消', success: resolve })
        })
        if (!res.confirm) return
      } catch (e) {
        return
      }
      this.promotingId = 'go'
      const apiRes = await promoteWaitlist(this.activityId)
      this.promotingId = ''
      if (apiRes.code !== ERROR_CODE.SUCCESS) {
        uni.showToast({ title: apiRes.message || '递补失败，请稍后重试', icon: 'none' })
        return
      }
      const promoted = apiRes.data && apiRes.data.promoted
      uni.showToast({ title: promoted ? '已递补一名候补' : '当前无候补可递补', icon: 'none' })
      await this.load()
    },

    /* ---------- 缺席标记 ---------- */
    async onMark(row) {
      const absent = row.attendance !== 'absent'
      if (this.markingId || this.promotingId) return
      if (absent) {
        try {
          const res = await new Promise((resolve) => {
            uni.showModal({ title: '标记缺席', content: `确认将「${row.name}」标记为缺席？`, confirmText: '标记', cancelText: '取消', success: resolve })
          })
          if (!res.confirm) return
        } catch (e) {
          return
        }
      }
      this.markingId = row.registration_id
      const apiRes = await markAttendance({ activity_id: this.activityId, registration_id: row.registration_id, attendance: absent ? 'absent' : 'none' })
      this.markingId = ''
      if (apiRes.code !== ERROR_CODE.SUCCESS) {
        uni.showToast({ title: apiRes.message || '操作失败，请稍后重试', icon: 'none' })
        return
      }
      uni.showToast({ title: absent ? '已标记缺席' : '已取消标记', icon: 'none' })
      await this.load()
    },

    /* ---------- 导出 CSV ---------- */
    async onExport() {
      if (this.exporting) return
      this.exporting = true
      const res = await exportRegistrationCsv(this.activityId)
      this.exporting = false
      if (res.code !== ERROR_CODE.SUCCESS || !res.data || !res.data.csv) {
        uni.showToast({ title: res.message || '导出失败，请稍后重试', icon: 'none' })
        return
      }
      const { csv, count, activity_title } = res.data
      const filename = `${activity_title || '报名名单'}-报名名单-${Date.now()}.csv`
      // #ifdef H5
      try {
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
        uni.showToast({ title: `已导出 ${count} 条`, icon: 'none' })
      } catch (e) {
        uni.showToast({ title: '导出失败，请稍后重试', icon: 'none' })
      }
      // #endif
      // #ifndef H5
      try {
        const fs = uni.getFileSystemManager()
        const filePath = `${wx.env.USER_DATA_PATH}/${filename}`
        fs.writeFile({
          filePath,
          data: csv,
          encoding: 'utf8',
          success: () => {
            uni.shareFileMessage({
              filePath,
              fileName: filename,
              success: () => uni.showToast({ title: `已导出 ${count} 条`, icon: 'none' }),
              fail: () => {
                uni.showModal({ title: '导出完成', content: `文件已生成（共 ${count} 条）：${filename}\n可通过微信文件发送或开发者工具查看。`, showCancel: false })
              },
            })
          },
          fail: () => uni.showToast({ title: '写入文件失败', icon: 'none' }),
        })
      } catch (e) {
        uni.showToast({ title: '导出失败，请稍后重试', icon: 'none' })
      }
      // #endif
    },
  },
}
</script>

<template>
  <view class="rgl-page">
    <!-- 活动摘要 + 统计 -->
    <view v-if="activity" class="rgl-head">
      <text class="rgl-head__title">{{ activity.title }}</text>
      <text class="rgl-head__meta">{{ formatTime(activity.start_time) }} ~ {{ formatTime(activity.end_time) }} · {{ activity.location || '地点待定' }}</text>
      <view class="rgl-stats">
        <view class="rgl-stat">
          <text class="rgl-stat__num">{{ stats.approved_count }}</text>
          <text class="rgl-stat__label">报名成功</text>
        </view>
        <view class="rgl-stat">
          <text class="rgl-stat__num">{{ stats.checked_count }}</text>
          <text class="rgl-stat__label">已签到</text>
        </view>
        <view class="rgl-stat">
          <text class="rgl-stat__num">{{ stats.unchecked_count }}</text>
          <text class="rgl-stat__label">未签到</text>
        </view>
        <view class="rgl-stat">
          <text class="rgl-stat__num">{{ stats.signin_rate }}%</text>
          <text class="rgl-stat__label">签到率</text>
        </view>
      </view>
      <view class="rgl-export">
        <sb-button type="ghost" size="sm" block :text="exporting ? '导出中…' : '导出 CSV'" :loading="exporting" @click="onExport" />
      </view>
    </view>

    <!-- 筛选 -->
    <view class="rgl-filters">
      <scroll-view class="rgl-tabs" scroll-x :show-scrollbar="false">
        <view class="rgl-tabs__row">
          <view
            v-for="tab in tabs"
            :key="tab.value"
            class="rgl-tab"
            :class="{ 'rgl-tab--active': currentTab === tab.value }"
            @tap="switchTab(tab.value)"
          >
            {{ tab.label }}<text v-if="tabCount(tab.value) > 0" class="rgl-tab__count">{{ tabCount(tab.value) }}</text>
          </view>
        </view>
      </scroll-view>
      <view class="rgl-checked">
        <view
          v-for="tab in checkedTabs"
          :key="tab.value"
          class="rgl-checked__item"
          :class="{ 'rgl-checked__item--on': checked === tab.value }"
          @tap="switchChecked(tab.value)"
        >
          {{ tab.label }}
        </view>
      </view>
    </view>

    <!-- 加载态 -->
    <view v-if="loading" class="rgl-card">
      <sb-skeleton :rows="4" />
    </view>

    <!-- 失败态 -->
    <view v-else-if="error" class="rgl-card">
      <sb-error :text="error" @retry="load" />
    </view>

    <!-- 空态 -->
    <view v-else-if="isEmpty" class="rgl-empty">
      <sb-illustration icon="eye" tone="warning" />
      <view class="rgl-empty__badge">该筛选条件下暂无报名</view>
    </view>

    <!-- 名单 -->
    <template v-else>
      <view v-for="row in list" :key="row.registration_id" class="rgl-card">
        <view class="rgl-row">
          <view class="rgl-row__main">
            <view class="rgl-row__top">
              <text class="rgl-row__name">{{ row.name }}</text>
              <view class="rgl-row__status" :class="`rgl-row__status--${statusMeta(row.status).cls}`">
                {{ statusMeta(row.status).label }}
              </view>
              <text v-if="row.checked_in" class="rgl-row__ck rgl-row__ck--ok">已签到</text>
              <text v-else-if="row.attendance === 'absent'" class="rgl-row__ck rgl-row__ck--absent">缺席</text>
              <text v-else-if="row.attendance === 'present'" class="rgl-row__ck">已到</text>
            </view>
            <text class="rgl-row__meta">
              {{ row.student_no_masked || maskNo(row.student_no) }}<template v-if="row.college || row.major"> · {{ row.college }} {{ row.major }}</template>
            </text>
            <text class="rgl-row__meta">
              报名于 {{ formatTime(row.signup_at) || '—' }}
              <template v-if="row.checked_in && row.signin_time"> · 签到于 {{ formatTime(row.signin_time) }}</template>
              <template v-if="row.remark"> · 备注：{{ row.remark }}</template>
            </text>
          </view>
        </view>

        <!-- 驳回内联输入 -->
        <view v-if="rejectRowId === row.registration_id" class="rgl-reject">
          <input v-model="rejectReason" class="rgl-reject__input" type="text" :maxlength="200" placeholder="填写驳回理由（将通知该成员）" />
          <view class="rgl-reject__actions">
            <view class="rgl-reject__action">
              <sb-button type="ghost" size="sm" block text="取消" @click="cancelReject" />
            </view>
            <view class="rgl-reject__action">
              <sb-button type="reject" size="sm" block :text="markingId ? '提交中…' : '确认驳回'" @click="confirmReject(row)" />
            </view>
          </view>
        </view>

        <!-- 行操作 -->
        <view v-else class="rgl-row__actions">
          <template v-if="row.status === 'pending'">
            <view class="rgl-row__action" @tap.stop="onApprove(row)">
              <sb-button type="approve" size="sm" block :loading="markingId === row.registration_id" text="通过" />
            </view>
            <view class="rgl-row__action" @tap.stop="openReject(row)">
              <sb-button type="reject" size="sm" block text="驳回" />
            </view>
          </template>
          <template v-else-if="row.status === 'waitlist'">
            <view class="rgl-row__action" @tap.stop="onPromote">
              <sb-button type="primary" size="sm" block :loading="promotingId === 'go'" text="手动递补" />
            </view>
          </template>
          <template v-else-if="row.status === 'approved' && !row.checked_in">
            <view class="rgl-row__action" @tap.stop="onMark(row)">
              <sb-button
                type="ghost"
                size="sm"
                block
                :loading="markingId === row.registration_id"
                :text="row.attendance ? '取消标记' : '标记缺席'"
              />
            </view>
          </template>
          <text v-else class="rgl-row__note">—</text>
        </view>
      </view>

      <!-- 分页状态 -->
      <view class="rgl-more">
        <text v-if="loadingMore" class="rgl-more__text">加载更多…</text>
        <text v-else-if="hasMore" class="rgl-more__text">上拉加载更多</text>
        <text v-else class="rgl-more__text">已加载全部 {{ total }} 条报名</text>
      </view>
    </template>
  </view>
</template>

<style lang="scss" scoped>
.rgl-page {
  min-height: 100vh;
  padding: 24rpx 32rpx 48rpx;
  background: $color-bg-canvas;
  box-sizing: border-box;
}

.rgl-head {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
  padding: 28rpx 32rpx;
  border-radius: $radius-lg;
  border: 4rpx solid $memphis-dark;
  background: $color-bg-card;
  box-shadow: $shadow-memphis-md;

  &__title {
    display: block;
    font-size: $fs-h2;
    font-weight: 700;
    color: $color-text-title;
  }

  &__meta {
    display: block;
    font-size: $fs-caption;
    color: $color-text-muted;
  }
}

.rgl-stats {
  display: flex;
  margin-top: 8rpx;
  padding: 20rpx 0;
  border-top: 2rpx dashed $memphis-dark;

  .rgl-stat {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6rpx;

    &__num {
      font-size: $fs-h2;
      font-weight: 700;
      color: $color-primary;
    }

    &__label {
      font-size: $fs-caption;
      color: $color-text-muted;
    }
  }
}

.rgl-export {
  margin-top: 4rpx;
}

.rgl-filters {
  margin-top: 24rpx;
  padding: 20rpx 24rpx;
  border-radius: $radius-md;
  border: 4rpx solid $memphis-dark;
  background: $color-bg-card;
  box-shadow: $shadow-memphis-sm;

  .rgl-tabs {
    white-space: nowrap;

    &__row {
      display: flex;
      gap: 12rpx;
    }

    .rgl-tab {
      display: inline-flex;
      align-items: center;
      gap: 6rpx;
      padding: 10rpx 20rpx;
      border-radius: 999rpx;
      border: 3rpx solid $memphis-dark;
      background: $color-bg-canvas;
      font-size: $fs-body;
      color: $color-text-body;

      &--active {
        background: $color-primary;
        color: #ffffff;
      }

      &__count {
        font-size: $fs-caption;
        opacity: 0.8;
      }
    }
  }

  .rgl-checked {
    display: flex;
    gap: 12rpx;
    margin-top: 16rpx;

    &__item {
      padding: 8rpx 20rpx;
      border-radius: 999rpx;
      border: 3rpx solid $memphis-dark;
      background: $color-bg-canvas;
      font-size: $fs-caption;
      color: $color-text-body;

      &--on {
        background: $memphis-dark;
        color: #ffffff;
      }
    }
  }
}

.rgl-card {
  margin-top: 24rpx;
  padding: 28rpx 32rpx;
  border-radius: $radius-md;
  border: 4rpx solid $memphis-dark;
  background: $color-bg-card;
  box-shadow: $shadow-memphis-sm;
}

.rgl-row {
  &__top {
    display: flex;
    align-items: center;
    gap: 12rpx;
    flex-wrap: wrap;
  }

  &__name {
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

    &--warning {
      background: $color-warning-light;
    }

    &--pending {
      background: $color-info-light;
    }

    &--reject {
      background: $color-danger-light;
    }

    &--muted {
      color: $color-text-muted;
    }
  }

  &__ck {
    padding: 4rpx 14rpx;
    border-radius: 999rpx;
    border: 3rpx solid $memphis-dark;
    font-size: $fs-caption;
    background: $color-bg-canvas;

    &--ok {
      background: $color-success-light;
    }

    &--absent {
      background: $color-danger-light;
    }
  }

  &__meta {
    display: block;
    margin-top: 10rpx;
    font-size: $fs-caption;
    color: $color-text-muted;
  }

  &__actions {
    display: flex;
    justify-content: flex-end;
    gap: 16rpx;
    margin-top: 20rpx;
    padding-top: 20rpx;
    border-top: 2rpx dashed $memphis-dark;

    .rgl-row__action {
      width: 200rpx;
    }

    .rgl-row__note {
      font-size: $fs-caption;
      color: $color-text-muted;
    }
  }
}

.rgl-reject {
  margin-top: 20rpx;
  padding-top: 20rpx;
  border-top: 2rpx dashed $memphis-dark;

  &__input {
    width: 100%;
    padding: 16rpx 20rpx;
    border-radius: $radius-sm;
    border: 3rpx solid $memphis-dark;
    background: $color-bg-canvas;
    font-size: $fs-body;
    box-sizing: border-box;
  }

  &__actions {
    display: flex;
    justify-content: flex-end;
    gap: 16rpx;
    margin-top: 16rpx;

    .rgl-reject__action {
      width: 200rpx;
    }
  }
}

.rgl-empty {
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

.rgl-more {
  padding: 24rpx 0;
  text-align: center;

  &__text {
    font-size: $fs-caption;
    color: $color-text-muted;
  }
}
</style>
