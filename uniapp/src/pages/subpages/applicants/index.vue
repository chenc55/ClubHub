<script>
/**
 * 招新申请人管理页（负责人端 / CLB-04② / P1-18）
 *
 * 内容：岗位摘要 + 状态筛选胶囊（带计数）+ 申请人名单（姓名/学号脱敏/学院专业/状态/报名时间/面试信息）+
 *       行操作（查看报名表抽屉 / 设面试时间地点 / 录取 / 淘汰）+ 多选批量操作（通过进面试 / 录取 / 淘汰 / 一键通知）+
 *       导出 CSV
 * 数据来源：GET /recruitment/applicants、POST /recruitment/screen、/recruitment/notify、GET /recruitment/export-csv
 * 进入方式：招新管理列表 open/closed 岗位行操作「申请人」
 */
import { getApplicants, screenApplicants, notifyApplicants, exportApplicantsCsv } from '@/api/recruitment'
import { ERROR_CODE } from '@/utils/config'

const PAGE_SIZE = 20
const TABS = [
  { value: 'all', label: '全部' },
  { value: 'pending', label: '待审核' },
  { value: 'interview', label: '面试' },
  { value: 'accepted', label: '已录取' },
  { value: 'rejected', label: '已淘汰' },
]
const STATUS_META = {
  pending: { label: '待审核', cls: 'pending' },
  interview: { label: '面试', cls: 'warning' },
  accepted: { label: '已录取', cls: 'success' },
  rejected: { label: '已淘汰', cls: 'reject' },
}

export default {
  name: 'Applicants',

  data: () => ({
    recruitmentId: '',
    tabs: TABS,
    currentTab: 'all',
    loading: true,
    loadingMore: false,
    list: [],
    total: 0,
    page: 1,
    hasMore: false,
    error: '',
    formFields: [],
    recruitmentTitle: '',
    statusCount: {},
    selected: [],
    pendingId: '',
    hint: '',
    /** 报名表抽屉 */
    detailRow: null,
    /** 面试设置 */
    interviewRow: null,
    interviewTime: '',
    interviewPlace: '',
    exporting: false,
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
    this.recruitmentId = (query && query.id) || ''
    if (!this.recruitmentId) {
      this.loading = false
      this.error = '缺少岗位参数，请从招新管理重新进入'
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
      this.selected = []
      const res = await getApplicants({ recruitment_id: this.recruitmentId, status: this.currentTab, page: 1, page_size: PAGE_SIZE })
      this.loading = false
      if (res.code !== ERROR_CODE.SUCCESS || !res.data) {
        this.error = res.message || '名单加载失败，请检查网络后重试'
        this.list = []
        this.recruitmentTitle = ''
        return
      }
      const data = res.data
      this.list = data.list || []
      this.total = data.total || 0
      this.hasMore = !!data.has_more
      this.page = 1
      this.statusCount = data.status_count || {}
      if (data.activity) {
        this.recruitmentTitle = data.activity.title || ''
        this.formFields = data.activity.form_fields || []
      }
    },

    async loadMore() {
      if (this.loading || this.loadingMore || !this.hasMore || this.error) return
      this.loadingMore = true
      const res = await getApplicants({ recruitment_id: this.recruitmentId, status: this.currentTab, page: this.page + 1, page_size: PAGE_SIZE })
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

    maskNo(no) {
      if (!no) return ''
      const text = String(no)
      return text.length <= 6 ? text : `${text.slice(0, 4)}****${text.slice(-2)}`
    },

    formatTime(value) {
      if (!value) return ''
      const raw = typeof value === 'object' && value.$date ? value.$date : value
      const date = new Date(raw)
      if (Number.isNaN(date.getTime())) return ''
      const pad = (n) => String(n).padStart(2, '0')
      return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    },

    /** 报名表字段值展示（多选数组 → 顿号连接） */
    displayField(value) {
      if (value == null) return '—'
      if (Array.isArray(value)) return value.length ? value.join('、') : '—'
      return String(value).trim() || '—'
    },

    /* ---------- 多选 ---------- */
    toggleSelect(regId) {
      const idx = this.selected.indexOf(regId)
      if (idx === -1) this.selected.push(regId)
      else this.selected.splice(idx, 1)
    },

    clearSelect() {
      this.selected = []
    },

    selectVisible() {
      this.selected = this.list.map((row) => row.registration_id)
    },

    /* ---------- 批量操作 ---------- */
    async doScreen(action, extra = {}) {
      if (!this.selected.length) {
        uni.showToast({ title: '请先选择申请人', icon: 'none' })
        return
      }
      const labelMap = { approve: '进面试', interview: '标记面试', accept: '录取', reject: '淘汰' }
      try {
        const res = await new Promise((resolve) => {
          uni.showModal({
            title: `确认${labelMap[action]}`,
            content: `对已选 ${this.selected.length} 位申请人执行「${labelMap[action]}」？操作将同步发送通知。`,
            confirmText: '确认',
            cancelText: '取消',
            success: resolve,
          })
        })
        if (!res.confirm) return
      } catch (e) {
        return
      }
      this.pendingId = action
      const apiRes = await screenApplicants({ recruitment_id: this.recruitmentId, registration_ids: this.selected.slice(), action, ...extra })
      this.pendingId = ''
      if (apiRes.code !== ERROR_CODE.SUCCESS) {
        this.hint = apiRes.message || '操作失败，请稍后重试'
        return
      }
      this.hint = ''
      uni.showToast({ title: `已${labelMap[action]} ${this.selected.length} 人`, icon: 'none' })
      await this.load()
    },

    async doNotify() {
      if (!this.selected.length) {
        uni.showToast({ title: '请先选择申请人', icon: 'none' })
        return
      }
      this.pendingId = 'notify'
      const apiRes = await notifyApplicants({ recruitment_id: this.recruitmentId, registration_ids: this.selected.slice() })
      this.pendingId = ''
      if (apiRes.code !== ERROR_CODE.SUCCESS) {
        this.hint = apiRes.message || '通知失败，请稍后重试'
        return
      }
      const sent = (apiRes.data && apiRes.data.sent) || 0
      uni.showToast({ title: `已通知 ${sent} 人`, icon: 'none' })
    },

    /* ---------- 报名表抽屉 ---------- */
    openDetail(row) {
      this.detailRow = row
    },
    closeDetail() {
      this.detailRow = null
    },

    /* ---------- 面试设置 ---------- */
    openInterview(row) {
      this.interviewRow = row
      this.interviewTime = row.interview && row.interview.time ? this.formatTime(row.interview.time) : ''
      this.interviewPlace = (row.interview && row.interview.place) || ''
    },
    closeInterview() {
      this.interviewRow = null
    },
    async saveInterview() {
      if (!this.interviewRow) return
      if (!this.interviewTime.trim()) {
        this.hint = '请填写面试时间'
        return
      }
      const time = new Date(`${this.interviewTime}:00`)
      if (Number.isNaN(time.getTime())) {
        this.hint = '面试时间格式不正确'
        return
      }
      const row = this.interviewRow
      this.pendingId = `iv-${row.registration_id}`
      const apiRes = await screenApplicants({
        recruitment_id: this.recruitmentId,
        registration_ids: [row.registration_id],
        action: 'interview',
        interview: { time, place: this.interviewPlace.trim() },
      })
      this.pendingId = ''
      if (apiRes.code !== ERROR_CODE.SUCCESS) {
        this.hint = apiRes.message || '设置失败，请稍后重试'
        return
      }
      this.hint = ''
      uni.showToast({ title: '面试安排已保存并通知', icon: 'none' })
      this.closeInterview()
      await this.load()
    },

    /* ---------- 行级快捷录取 / 淘汰 ---------- */
    async onAccept(row) {
      this.selected = [row.registration_id]
      await this.doScreen('accept')
    },
    async onReject(row) {
      this.selected = [row.registration_id]
      await this.doScreen('reject')
    },

    /* ---------- 导出 ---------- */
    async onExport() {
      if (this.exporting) return
      this.exporting = true
      const res = await exportApplicantsCsv(this.recruitmentId)
      this.exporting = false
      if (res.code !== ERROR_CODE.SUCCESS || !res.data || !res.data.csv) {
        uni.showToast({ title: res.message || '导出失败，请稍后重试', icon: 'none' })
        return
      }
      const { csv, count, recruitment_title } = res.data
      const filename = `${recruitment_title || '招新申请人'}-名单-${Date.now()}.csv`
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
              fail: () => uni.showModal({ title: '导出完成', content: `文件已生成：${filename}`, showCancel: false }),
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
  <view class="apl-page">
    <!-- 头部：标题 + 批量操作 + 导出 -->
    <view class="apl-head">
      <view class="apl-head__main">
        <text class="apl-head__title">{{ recruitmentTitle || '申请人管理' }}</text>
        <text class="apl-head__sub">共 {{ total }} 人 · 已选 {{ selected.length }}</text>
        <view class="apl-head__bulk">
          <text class="apl-chip" @tap="selectVisible">全选本页</text>
          <text class="apl-chip" @tap="clearSelect">清空</text>
          <text class="apl-chip apl-chip--primary" @tap="doScreen('approve')">进面试</text>
          <text class="apl-chip apl-chip--success" @tap="doScreen('accept')">录取</text>
          <text class="apl-chip" @tap="doScreen('reject')">淘汰</text>
          <text class="apl-chip" @tap="doNotify">通知</text>
        </view>
      </view>
      <sb-button type="ghost" size="sm" text="导出 CSV" :loading="exporting" @click="onExport" />
    </view>

    <!-- 状态 tab -->
    <scroll-view class="apl-tabs" scroll-x :show-scrollbar="false">
      <view class="apl-tabs__row">
        <view
          v-for="tab in tabs"
          :key="tab.value"
          class="apl-tab"
          :class="{ 'apl-tab--active': currentTab === tab.value }"
          @tap="switchTab(tab.value)"
        >
          {{ tab.label }}<text v-if="tabCount(tab.value) > 0" class="apl-tab__count">{{ tabCount(tab.value) }}</text>
        </view>
      </view>
    </scroll-view>

    <!-- 加载态 -->
    <view v-if="loading" class="apl-card">
      <sb-skeleton :rows="4" />
    </view>

    <!-- 失败态 -->
    <view v-else-if="error" class="apl-card">
      <sb-error :text="error" @retry="load" />
    </view>

    <!-- 空态 -->
    <view v-else-if="isEmpty" class="apl-empty">
      <sb-illustration icon="eye" tone="warning" />
      <view class="apl-empty__badge">该状态下暂无申请人</view>
    </view>

    <!-- 申请人列表 -->
    <template v-else>
      <view v-for="row in list" :key="row.registration_id" class="apl-card">
        <view class="apl-row" :class="{ 'apl-row--sel': selected.indexOf(row.registration_id) !== -1 }" @tap="toggleSelect(row.registration_id)">
          <view class="apl-row__check">{{ selected.indexOf(row.registration_id) !== -1 ? '✓' : '' }}</view>
          <view class="apl-row__main">
            <view class="apl-row__top">
              <text class="apl-row__name">{{ row.name }}</text>
              <view class="apl-row__status" :class="`apl-row__status--${statusMeta(row.status).cls}`">
                {{ statusMeta(row.status).label }}
              </view>
            </view>
            <text class="apl-row__meta">
              {{ row.student_no_masked || maskNo(row.student_no) }}<template v-if="row.college || row.major"> · {{ row.college }} {{ row.major }}</template>
            </text>
            <text class="apl-row__meta">报名于 {{ formatTime(row.applied_at) || '—' }}</text>
            <text v-if="row.interview && row.interview.time" class="apl-row__iv">面试：{{ formatTime(row.interview.time) }} · {{ row.interview.place || '待定' }}</text>
          </view>
        </view>

        <!-- 行操作 -->
        <view class="apl-row__actions">
          <view class="apl-row__action" @tap.stop="openDetail(row)">
            <sb-button type="ghost" size="sm" block text="报名表" />
          </view>
          <template v-if="row.status === 'pending' || row.status === 'interview'">
            <view class="apl-row__action" @tap.stop="openInterview(row)">
              <sb-button type="primary" size="sm" block :text="row.status === 'interview' ? '重设面试' : '设面试'" />
            </view>
            <view class="apl-row__action" @tap.stop="onAccept(row)">
              <sb-button type="approve" size="sm" block :loading="pendingId === 'accept'" text="录取" />
            </view>
            <view class="apl-row__action" @tap.stop="onReject(row)">
              <sb-button type="reject" size="sm" block :loading="pendingId === 'reject'" text="淘汰" />
            </view>
          </template>
          <text v-else class="apl-row__note">{{ row.status === 'accepted' ? '已入团' : '已处理' }}</text>
        </view>
      </view>

      <!-- 分页状态 -->
      <view class="apl-more">
        <text v-if="loadingMore" class="apl-more__text">加载更多…</text>
        <text v-else-if="hasMore" class="apl-more__text">上拉加载更多</text>
        <text v-else class="apl-more__text">已加载全部 {{ total }} 人</text>
      </view>
    </template>

    <text v-if="hint" class="apl-hint">{{ hint }}</text>

    <!-- 报名表抽屉 -->
    <view v-if="detailRow" class="apl-drawer-mask" @tap="closeDetail">
      <view class="apl-drawer" @tap.stop>
        <view class="apl-drawer__head">
          <text class="apl-drawer__title">{{ detailRow.name }} 的报名表</text>
          <text class="apl-drawer__close" @tap="closeDetail">×</text>
        </view>
        <view class="apl-drawer__body">
          <view v-for="field in formFields" :key="field.key" class="apl-field">
            <text class="apl-field__label">{{ field.label }}</text>
            <text class="apl-field__value">
              {{ displayField(detailRow.form_data[field.key]) }}
            </text>
          </view>
        </view>
      </view>
    </view>

    <!-- 面试设置抽屉 -->
    <view v-if="interviewRow" class="apl-drawer-mask" @tap="closeInterview">
      <view class="apl-drawer" @tap.stop>
        <view class="apl-drawer__head">
          <text class="apl-drawer__title">设置面试 · {{ interviewRow.name }}</text>
          <text class="apl-drawer__close" @tap="closeInterview">×</text>
        </view>
        <view class="apl-drawer__body">
          <view class="apl-field">
            <text class="apl-field__label">面试时间</text>
            <input v-model="interviewTime" class="apl-input" type="text" placeholder="如 2026-09-25 14:00" />
          </view>
          <view class="apl-field">
            <text class="apl-field__label">面试地点</text>
            <input v-model="interviewPlace" class="apl-input" type="text" :maxlength="50" placeholder="如 活动室 101" />
          </view>
          <sb-button type="primary" block text="保存并通知" :loading="pendingId === `iv-${interviewRow.registration_id}`" @click="saveInterview" />
        </view>
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.apl-page {
  min-height: 100vh;
  padding: 24rpx 32rpx 48rpx;
  background: $color-bg-canvas;
  box-sizing: border-box;
}

.apl-head {
  display: flex;
  align-items: flex-start;
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
    gap: 10rpx;
    flex: 1;
  }

  &__title {
    font-size: $fs-h2;
    font-weight: 700;
    color: $color-text-title;
  }

  &__sub {
    font-size: $fs-caption;
    color: $color-text-muted;
  }

  &__bulk {
    display: flex;
    gap: 10rpx;
    flex-wrap: wrap;
    margin-top: 6rpx;
  }
}

.apl-chip {
  padding: 8rpx 18rpx;
  border-radius: 999rpx;
  border: 3rpx solid $memphis-dark;
  background: $color-bg-canvas;
  font-size: $fs-caption;
  color: $color-text-body;

  &--primary {
    background: $color-primary;
    color: #ffffff;
  }

  &--success {
    background: $color-success-light;
  }
}

.apl-tabs {
  margin-top: 24rpx;
  white-space: nowrap;

  &__row {
    display: flex;
    gap: 12rpx;
  }

  .apl-tab {
    display: inline-flex;
    align-items: center;
    gap: 6rpx;
    padding: 10rpx 22rpx;
    border-radius: 999rpx;
    border: 3rpx solid $memphis-dark;
    background: $color-bg-card;
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

.apl-card {
  margin-top: 24rpx;
  padding: 28rpx 32rpx;
  border-radius: $radius-md;
  border: 4rpx solid $memphis-dark;
  background: $color-bg-card;
  box-shadow: $shadow-memphis-sm;
}

.apl-row {
  display: flex;
  align-items: flex-start;
  gap: 16rpx;

  &--sel .apl-row__check {
    background: $color-primary;
    color: #ffffff;
    border-color: $color-primary;
  }

  &__check {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40rpx;
    height: 40rpx;
    margin-top: 4rpx;
    border-radius: $radius-sm;
    border: 3rpx solid $memphis-dark;
    background: $color-bg-canvas;
    font-size: $fs-caption;
  }

  &__main {
    flex: 1;
  }

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

    &--pending {
      background: $color-info-light;
      color: $color-info-text;
    }

    &--warning {
      background: $color-warning-light;
    }

    &--success {
      background: $color-success-light;
    }

    &--reject {
      background: $color-danger-light;
      color: $color-danger;
    }
  }

  &__meta {
    display: block;
    margin-top: 10rpx;
    font-size: $fs-caption;
    color: $color-text-muted;
  }

  &__iv {
    display: block;
    margin-top: 10rpx;
    padding: 8rpx 14rpx;
    border-radius: $radius-sm;
    background: $color-warning-light;
    font-size: $fs-caption;
    color: $color-warning;
  }

  &__actions {
    display: flex;
    justify-content: flex-end;
    gap: 12rpx;
    margin-top: 20rpx;
    padding-top: 20rpx;
    border-top: 2rpx dashed $memphis-dark;

    .apl-row__action {
      width: 160rpx;
    }

    .apl-row__note {
      font-size: $fs-caption;
      color: $color-text-muted;
    }
  }
}

.apl-empty {
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

.apl-more {
  padding: 24rpx 0;
  text-align: center;

  &__text {
    font-size: $fs-caption;
    color: $color-text-muted;
  }
}

.apl-hint {
  display: block;
  margin-top: 20rpx;
  padding: 16rpx 20rpx;
  border-radius: $radius-sm;
  background: $color-danger-light;
  font-size: $fs-caption;
  color: $color-danger;
}

.apl-drawer-mask {
  position: fixed;
  inset: 0;
  z-index: 99;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: flex-end;
}

.apl-drawer {
  width: 100%;
  max-height: 70vh;
  border-radius: $radius-lg $radius-lg 0 0;
  border-top: 4rpx solid $memphis-dark;
  background: $color-bg-card;
  padding: 32rpx 32rpx 48rpx;
  box-sizing: border-box;
  overflow-y: auto;

  &__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 24rpx;
  }

  &__title {
    font-size: $fs-h3;
    font-weight: 700;
    color: $color-text-title;
  }

  &__close {
    font-size: $fs-h1;
    color: $color-text-muted;
    padding: 0 8rpx;
  }
}

.apl-field {
  margin-bottom: 24rpx;

  &__label {
    display: block;
    margin-bottom: 8rpx;
    font-size: $fs-caption;
    font-weight: 700;
    color: $color-text-body;
  }

  &__value {
    font-size: $fs-body;
    color: $color-text-body;
  }
}

.apl-input {
  width: 100%;
  padding: 16rpx 20rpx;
  border-radius: $radius-sm;
  border: 3rpx solid $memphis-dark;
  background: $color-bg-canvas;
  font-size: $fs-body;
  box-sizing: border-box;
}
</style>