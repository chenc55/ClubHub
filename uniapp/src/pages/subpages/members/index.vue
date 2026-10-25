<script>
/**
 * 社团成员管理页（负责人端 / CLB-05 / P1-19）
 *
 * 内容：成员计数摘要 + 成员列表（角色徽标 / 姓名 / 脱敏学号 / 入团时间）+
 *       社长专属操作（设 / 撤干部、移除成员，二次确认）
 * 权限：社长（president）与干部（officer）均可查看列表；**写操作仅社长**（需求 2.3 权限矩阵），
 *      干部视图展示只读说明；服务端对封禁社团禁用写操作（页面不主动限制，交由服务端二次校验）。
 * 数据来源：GET /club/members（viewer_role 判定操作区）、POST /club/members/role、/club/members/remove
 * 进入方式：社团管理主页「成员管理」入口（携带 club_id）
 */
import { getClubMembers, setClubMemberRole, removeClubMember } from '@/api/club'
import { ERROR_CODE } from '@/utils/config'

const PAGE_SIZE = 20
const ROLE_META = {
  president: { label: '社长', cls: 'president' },
  officer: { label: '干部', cls: 'officer' },
  member: { label: '成员', cls: 'member' },
}

export default {
  name: 'ClubMembers',

  data: () => ({
    clubId: '',
    loading: true,
    error: '',
    list: [],
    total: 0,
    page: 1,
    hasMore: false,
    roleCount: {},
    viewerRole: '',
    pendingId: '',
    hint: '',
  }),

  computed: {
    isEmpty() {
      return !this.loading && !this.error && this.list.length === 0
    },
    /** 写操作区：仅社长可见 */
    isPresident() {
      return this.viewerRole === 'president'
    },
    countLabel() {
      const rc = this.roleCount
      const parts = []
      if (rc.president) parts.push(`社长 ${rc.president}`)
      if (rc.officer) parts.push(`干部 ${rc.officer}`)
      parts.push(`成员 ${rc.total || 0} 人`)
      return parts.join(' · ')
    },
  },

  onLoad(query) {
    this.clubId = (query && query.club_id) || ''
    if (!this.clubId) {
      this.loading = false
      this.error = '缺少社团参数，请从社团管理重新进入'
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
      const res = await getClubMembers({ club_id: this.clubId, page: 1, page_size: PAGE_SIZE })
      this.loading = false
      if (res.code !== ERROR_CODE.SUCCESS || !res.data) {
        this.error = res.message || '成员列表加载失败，请检查网络后重试'
        this.list = []
        return
      }
      const data = res.data
      this.list = data.list || []
      this.total = data.total || 0
      this.hasMore = this.list.length < this.total
      this.page = 1
      this.roleCount = data.role_count || {}
      this.viewerRole = data.viewer_role || 'member'
    },

    async loadMore() {
      if (this.loading || !this.hasMore || this.error) return
      const res = await getClubMembers({ club_id: this.clubId, page: this.page + 1, page_size: PAGE_SIZE })
      if (res.code !== ERROR_CODE.SUCCESS) {
        uni.showToast({ title: res.message || '加载更多失败，请稍后重试', icon: 'none' })
        return
      }
      this.list = this.list.concat((res.data && res.data.list) || [])
      this.page += 1
      this.hasMore = this.list.length < (res.data && res.data.total)
    },

    roleMeta(role) {
      return ROLE_META[role] || { label: role, cls: 'member' }
    },

    formatTime(value) {
      if (!value) return ''
      const raw = typeof value === 'object' && value.$date ? value.$date : value
      const date = new Date(raw)
      if (Number.isNaN(date.getTime())) return ''
      const pad = (n) => String(n).padStart(2, '0')
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    },

    async confirm(text, title = '确认操作') {
      try {
        const res = await new Promise((resolve) => {
          uni.showModal({ title, content: text, confirmText: '确认', cancelText: '取消', success: resolve })
        })
        return !!res.confirm
      } catch (e) {
        return false
      }
    },

    /** 设 / 撤干部（officer ⇄ member，仅社长） */
    async changeRole(row, nextRole) {
      const verb = nextRole === 'officer' ? '设为干部' : '撤销干部'
      const ok = await this.confirm(`确定将「${row.name}」${verb}吗？`, `确认${verb}`)
      if (!ok) return
      // H5 端 uni.showModal 关闭动画与紧接的重渲染存在竞态（遮罩不消失），先让出当前帧再更新数据
      await new Promise((resolve) => setTimeout(resolve, 50))
      this.pendingId = `role-${row.user_id}`
      const apiRes = await setClubMemberRole({ club_id: this.clubId, user_id: row.user_id, role: nextRole })
      this.pendingId = ''
      if (apiRes.code !== ERROR_CODE.SUCCESS) {
        this.hint = apiRes.message || '操作失败，请稍后重试'
        return
      }
      this.hint = ''
      uni.showToast({ title: `已${verb}`, icon: 'none' })
      await this.load()
    },

    /** 移除成员（status → removed，仅社长） */
    async onRemove(row) {
      const ok = await this.confirm(`确定将「${row.name}」移出社团吗？其历史报名 / 签到记录将保留。`, '确认移除成员')
      if (!ok) return
      // H5 端 uni.showModal 关闭动画与紧接的重渲染存在竞态（遮罩不消失），先让出当前帧再更新数据
      await new Promise((resolve) => setTimeout(resolve, 50))
      this.pendingId = `rm-${row.user_id}`
      const apiRes = await removeClubMember({ club_id: this.clubId, user_id: row.user_id })
      this.pendingId = ''
      if (apiRes.code !== ERROR_CODE.SUCCESS) {
        this.hint = apiRes.message || '移除失败，请稍后重试'
        return
      }
      this.hint = ''
      uni.showToast({ title: '已移除', icon: 'none' })
      await this.load()
    },
  },
}
</script>

<template>
  <view class="mb-page">
    <!-- 头部：标题 + 计数摘要 -->
    <view class="mb-head">
      <text class="mb-head__title">成员管理</text>
      <text class="mb-head__sub">{{ countLabel }}</text>
    </view>

    <!-- 干部只读说明 -->
    <view v-if="!isPresident" class="mb-note">
      <text class="mb-note__text">仅社长可设置 / 撤销干部或移除成员，如需调整请联系社长。</text>
    </view>

    <!-- 加载态 -->
    <view v-if="loading" class="mb-card">
      <sb-skeleton :rows="4" />
    </view>

    <!-- 失败态 -->
    <view v-else-if="error" class="mb-card">
      <sb-error :text="error" @retry="load" />
    </view>

    <!-- 空态 -->
    <view v-else-if="isEmpty" class="mb-empty">
      <sb-illustration icon="eye" tone="warning" />
      <view class="mb-empty__badge">暂无成员</view>
    </view>

    <!-- 成员列表 -->
    <template v-else>
      <view v-for="row in list" :key="row.user_id" class="mb-card">
        <view class="mb-row">
          <view class="mb-avatar">
            <image v-if="row.avatar" class="mb-avatar__img" :src="row.avatar" mode="aspectFill" />
            <text v-else class="mb-avatar__text">{{ (row.name || '?').slice(0, 1) }}</text>
          </view>
          <view class="mb-row__main">
            <view class="mb-row__top">
              <text class="mb-row__name">{{ row.name }}</text>
              <view class="mb-badge" :class="`mb-badge--${roleMeta(row.role).cls}`">
                {{ roleMeta(row.role).label }}
              </view>
            </view>
            <text class="mb-row__meta">{{ row.student_no_masked || '—' }}</text>
            <text class="mb-row__meta">入团于 {{ formatTime(row.joined_at) || '—' }}</text>
          </view>
        </view>

        <!-- 社长专属操作（社长行不展示） -->
        <view v-if="isPresident && row.role !== 'president'" class="mb-row__actions">
          <template v-if="row.role === 'member'">
            <view class="mb-row__action">
              <sb-button type="primary" size="sm" block :loading="pendingId === `role-${row.user_id}`" text="设干部" @click="changeRole(row, 'officer')" />
            </view>
          </template>
          <template v-else>
            <view class="mb-row__action">
              <sb-button type="ghost" size="sm" block :loading="pendingId === `role-${row.user_id}`" text="撤干部" @click="changeRole(row, 'member')" />
            </view>
          </template>
          <view class="mb-row__action">
            <sb-button type="reject" size="sm" block :loading="pendingId === `rm-${row.user_id}`" text="移除" @click="onRemove(row)" />
          </view>
        </view>
      </view>

      <!-- 分页状态 -->
      <view class="mb-more">
        <text class="mb-more__text">{{ hasMore ? '上拉加载更多' : `已加载全部 ${total} 人` }}</text>
      </view>
    </template>

    <text v-if="hint" class="mb-hint">{{ hint }}</text>
  </view>
</template>

<style lang="scss" scoped>
.mb-page {
  min-height: 100vh;
  padding: 24rpx 32rpx 48rpx;
  background: $color-bg-canvas;
  box-sizing: border-box;
}

.mb-head {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
  padding: 28rpx 32rpx;
  border-radius: $radius-lg;
  border: 4rpx solid $memphis-dark;
  background: $color-bg-card;
  box-shadow: $shadow-memphis-md;

  &__title {
    font-size: $fs-h2;
    font-weight: 700;
    color: $color-text-title;
  }

  &__sub {
    font-size: $fs-caption;
    color: $color-text-muted;
  }
}

.mb-note {
  margin-top: 20rpx;
  padding: 16rpx 20rpx;
  border-radius: $radius-sm;
  background: $color-info-light;
  font-size: $fs-caption;
  color: $color-info-text;
}

.mb-card {
  margin-top: 24rpx;
  padding: 28rpx 32rpx;
  border-radius: $radius-md;
  border: 4rpx solid $memphis-dark;
  background: $color-bg-card;
  box-shadow: $shadow-memphis-sm;
}

.mb-row {
  display: flex;
  align-items: flex-start;
  gap: 16rpx;

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

  &__meta {
    display: block;
    margin-top: 8rpx;
    font-size: $fs-caption;
    color: $color-text-muted;
  }

  &__actions {
    display: flex;
    justify-content: flex-end;
    gap: 12rpx;
    margin-top: 20rpx;
    padding-top: 20rpx;
    border-top: 2rpx dashed $memphis-dark;

    .mb-row__action {
      width: 160rpx;
    }
  }
}

.mb-avatar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 72rpx;
  height: 72rpx;
  border-radius: $radius-md;
  border: 3rpx solid $memphis-dark;
  background: $color-bg-canvas;
  overflow: hidden;

  &__img {
    width: 100%;
    height: 100%;
  }

  &__text {
    font-size: $fs-h3;
    font-weight: 700;
    color: $color-text-muted;
  }
}

.mb-badge {
  padding: 4rpx 14rpx;
  border-radius: 999rpx;
  border: 3rpx solid $memphis-dark;
  font-size: $fs-caption;
  background: $color-bg-canvas;

  &--president {
    background: $color-primary;
    color: #ffffff;
  }

  &--officer {
    background: $color-warning-light;
    color: $color-warning;
  }

  &--member {
    background: $color-bg-canvas;
  }
}

.mb-empty {
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

.mb-more {
  padding: 24rpx 0;
  text-align: center;

  &__text {
    font-size: $fs-caption;
    color: $color-text-muted;
  }
}

.mb-hint {
  display: block;
  margin-top: 20rpx;
  padding: 16rpx 20rpx;
  border-radius: $radius-sm;
  background: $color-danger-light;
  font-size: $fs-caption;
  color: $color-danger;
}
</style>
