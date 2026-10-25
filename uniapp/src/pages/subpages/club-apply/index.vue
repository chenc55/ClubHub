<script>
/**
 * 社团入驻申请（CLB-01① / 需求 4.2.1 · P1-06）
 *
 * 流程：已认证学生填写「名称 / 简介 / 分类 / 联系方式」→ clubs.status = pending
 *      → 管理员审核（ADM-02①，管理端「社团管理」页）→ 通过（申请人自动成为社长）/ 驳回（附理由）
 * 约束：名称重复拦截；同时间仅一条进行中申请；驳回后可修改重提（复用原记录，状态回到 pending）。
 * 进入方式：我的社团 / 个人中心的「申请入驻」入口
 */
import { applyClub, getCategories, getClubApplyCurrent } from '@/api/club'
import { useUserStore } from '@/store/user'
import { ERROR_CODE } from '@/utils/config'

const NAME_MAX = 30
const INTRO_MAX = 500
const CONTACT_MAX = 50

/** 状态 → 文案与 sb-tag 三式 */
const STATUS_META = {
  pending: { tag: 'pending', label: '待审核' },
  normal: { tag: 'approved', label: '已通过' },
  rejected: { tag: 'rejected', label: '已驳回' },
}

export default {
  data: () => ({
    loading: true,
    submitting: false,
    /** 分类字典（来自 /club/categories） */
    categories: [],
    categoryIndex: -1,
    /** 我的申请：进行中 / 已通过 / 最近一条 */
    pending: null,
    approved: null,
    last: null,
    showForm: false,
    hint: '',
    form: { name: '', intro: '', contact: '' },
  }),

  computed: {
    userStore() {
      return useUserStore()
    },
    isVerified() {
      return this.userStore.isAuthenticated
    },
    categoryNames() {
      return this.categories.map((item) => item.name)
    },
    selectedCategory() {
      return this.categoryIndex >= 0 ? this.categories[this.categoryIndex] : null
    },
    /** 状态卡展示对象：优先进行中，其次已通过，最后最近一条 */
    current() {
      return this.pending || this.approved || this.last
    },
    currentMeta() {
      return (this.current && STATUS_META[this.current.status]) || null
    },
    badgeText() {
      if (!this.isVerified) return '未认证'
      if (!this.currentMeta) return '未申请'
      return this.currentMeta.label
    },
    canSubmit() {
      return (
        !this.submitting &&
        this.form.name.trim().length >= 2 &&
        !!this.selectedCategory &&
        !!this.form.intro.trim() &&
        !!this.form.contact.trim()
      )
    },
  },

  onShow() {
    this.load()
  },

  methods: {
    async load() {
      this.loading = true
      this.hint = ''
      const catRes = await getCategories()
      if (catRes.code === ERROR_CODE.SUCCESS) this.categories = (catRes.data && catRes.data.list) || []

      const res = await getClubApplyCurrent()
      this.loading = false
      if (res.code === ERROR_CODE.UNAUTHORIZED) {
        this.pending = null
        this.approved = null
        this.last = null
        this.showForm = false
        return
      }
      if (res.code !== ERROR_CODE.SUCCESS) {
        this.hint = res.message || '入驻状态加载失败，请稍后重试'
        return
      }
      this.pending = (res.data && res.data.pending) || null
      this.approved = (res.data && res.data.approved) || null
      this.last = (res.data && res.data.list && res.data.list[0]) || null
      // 无申请或上一条被驳回 → 允许填写；已通过/待审 → 只展示状态
      this.showForm = !this.pending && !this.approved && (!this.last || this.last.status === 'rejected')
      if (this.showForm && this.last && this.last.status === 'rejected') {
        // 驳回重提：预填上次内容，便于在原基础上修改
        this.form.name = this.last.name || ''
        this.form.intro = this.last.intro || ''
        this.form.contact = this.last.contact || ''
        const index = this.categories.findIndex((item) => item._id === this.last.category_id)
        if (index >= 0) this.categoryIndex = index
      }
    },

    onCategoryChange(event) {
      this.categoryIndex = Number(event.detail.value)
      this.hint = ''
    },

    async submit() {
      if (!this.canSubmit) return
      this.submitting = true
      this.hint = ''
      const res = await applyClub({
        name: this.form.name.trim(),
        intro: this.form.intro.trim(),
        contact: this.form.contact.trim(),
        category_id: this.selectedCategory._id,
      })
      this.submitting = false

      if (res.code === ERROR_CODE.UNAUTHORIZED) {
        this.userStore.resetAuth()
        this.hint = '登录已过期，请重新登录后再提交'
        return
      }
      if (res.code !== ERROR_CODE.SUCCESS) {
        this.hint = res.message || '提交失败，请稍后重试'
        return
      }
      uni.showToast({ title: res.data.resubmitted ? '已重新提交' : '申请已提交', icon: 'success' })
      this.showForm = false
      await this.load()
    },

    resetForm() {
      this.form.name = ''
      this.form.intro = ''
      this.form.contact = ''
      this.hint = ''
      this.showForm = true
    },

    formatTime(value) {
      if (!value) return ''
      const date = new Date(typeof value === 'object' && value.$date ? value.$date : value)
      if (Number.isNaN(date.getTime())) return ''
      const pad = (n) => String(n).padStart(2, '0')
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    },

    goLogin() {
      uni.navigateTo({ url: '/pages/subpages/login/index?reason=need_auth' })
    },

    goMyClubs() {
      // 入驻通过后申请人是该社社长，直接进入负责人端管理主页（P1-09）
      uni.navigateTo({ url: '/pages/subpages/club-admin/index' })
    },
  },
}
</script>

<template>
  <view class="apply-page">
    <!-- 顶部说明 -->
    <view class="apply-card">
      <view class="apply-card__head">
        <text class="apply-card__title">社团入驻申请</text>
        <view class="apply-card__badge" :class="{ 'apply-card__badge--done': currentMeta && currentMeta.tag === 'approved' }">
          {{ badgeText }}
        </view>
      </view>
      <text class="apply-card__desc">
        提交后由社团联合会管理员审核；通过后你将成为该社团社长，可发布动态、创建活动与招新。
        同一时间仅可有一条进行中的申请。
      </text>
    </view>

    <!-- 未认证引导 -->
    <view v-if="!isVerified" class="apply-card apply-card--body">
      <text class="apply-hint">申请入驻需先完成学号认证。</text>
      <sb-button type="primary" block text="去登录 / 认证" @click="goLogin" />
    </view>

    <template v-else>
      <view v-if="loading" class="apply-card apply-card--body">
        <text class="apply-loading">加载入驻状态…</text>
      </view>

      <!-- 状态卡 -->
      <view v-else-if="current" class="apply-card apply-card--body">
        <view class="apply-status">
          <view class="apply-status__head">
            <text class="apply-status__title">{{ current.name }}</text>
            <sb-tag :type="currentMeta.tag" :text="currentMeta.label" />
          </view>
          <view class="apply-status__row">
            <text class="apply-status__label">分类</text>
            <text class="apply-status__value">{{ current.category_name || '—' }}</text>
          </view>
          <view class="apply-status__row">
            <text class="apply-status__label">联系方式</text>
            <text class="apply-status__value">{{ current.contact || '—' }}</text>
          </view>
          <text class="apply-status__time">提交于 {{ formatTime(current.created_at) }}</text>

          <view v-if="current.status === 'rejected' && current.reject_reason" class="apply-reject">
            <text class="apply-reject__title">驳回理由</text>
            <text class="apply-reject__text">{{ current.reject_reason }}</text>
          </view>
          <text v-else-if="current.status === 'pending'" class="apply-status__note">
            管理员正在审核，请耐心等待；审核期间无法重复提交。
          </text>
          <text v-else-if="current.status === 'normal'" class="apply-status__note">
            入驻成功，你已是该社团社长，可前往「我的社团」开始管理。
          </text>
        </view>

        <sb-button v-if="current.status === 'rejected'" type="primary" block text="修改后重新提交" @click="resetForm" />
        <sb-button v-else-if="current.status === 'normal'" type="approve" block text="去社团管理" @click="goMyClubs" />
      </view>

      <!-- 申请表单 -->
      <view v-if="showForm" class="apply-card apply-card--body">
        <view class="apply-field">
          <text class="apply-field__label">社团名称</text>
          <input
            v-model="form.name"
            class="apply-field__input"
            type="text"
            :maxlength="NAME_MAX"
            placeholder="请输入社团名称（2~30 字）"
            placeholder-class="apply-field__ph"
          />
        </view>

        <view class="apply-field">
          <text class="apply-field__label">所属分类</text>
          <picker mode="selector" :range="categoryNames" :value="categoryIndex" @change="onCategoryChange">
            <view class="apply-field__picker">
              <text :class="selectedCategory ? 'apply-field__picker-text' : 'apply-field__ph'">
                {{ selectedCategory ? selectedCategory.name : '请选择社团分类' }}
              </text>
              <text class="apply-field__picker-icon">▾</text>
            </view>
          </picker>
        </view>

        <view class="apply-field">
          <text class="apply-field__label">社团简介</text>
          <textarea
            v-model="form.intro"
            class="apply-field__textarea"
            :maxlength="INTRO_MAX"
            placeholder="介绍社团定位、日常活动与招新计划"
            placeholder-class="apply-field__ph"
          />
          <text class="apply-field__note">{{ form.intro.length }} / {{ INTRO_MAX }}</text>
        </view>

        <view class="apply-field">
          <text class="apply-field__label">联系方式</text>
          <input
            v-model="form.contact"
            class="apply-field__input"
            type="text"
            :maxlength="CONTACT_MAX"
            placeholder="如：微信 / QQ 群 / 手机号"
            placeholder-class="apply-field__ph"
          />
        </view>

        <sb-button
          type="primary"
          block
          text="提交入驻申请"
          loading-text="提交中"
          :loading="submitting"
          :disabled="!canSubmit"
          @click="submit"
        />

        <text v-if="hint" class="apply-hint">{{ hint }}</text>
        <text class="apply-note">社团名称不可与现有社团重复；分类由管理员维护，如需新增请联系社联。</text>
      </view>
    </template>
  </view>
</template>

<style lang="scss" scoped>
.apply-page {
  min-height: 100vh;
  padding: 32rpx;
  background: $color-bg-canvas;
  box-sizing: border-box;
}

.apply-card {
  padding: 36rpx;
  border-radius: $radius-lg;
  border: 4rpx solid $memphis-dark;
  background: $color-bg-card;
  box-shadow: $shadow-memphis-md;

  &--body {
    margin-top: 32rpx;
    border-radius: $radius-md;
    box-shadow: $shadow-memphis-sm;
  }

  &__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16rpx;
  }

  &__title {
    font-size: $fs-h1;
    font-weight: 700;
    color: $color-text-title;
  }

  &__badge {
    flex-shrink: 0;
    padding: 6rpx 24rpx;
    border-radius: 999px;
    border: 3rpx solid $memphis-dark;
    background: $color-warning;
    color: $memphis-dark;
    font-size: $fs-caption;
    font-weight: 700;
    box-shadow: 3rpx 3rpx 0 0 $memphis-dark;

    &--done {
      background: $color-success;
    }
  }

  &__desc {
    display: block;
    margin-top: 16rpx;
    font-size: $fs-body;
    line-height: 1.6;
    color: $color-text-muted;
  }
}

.apply-loading {
  font-size: $fs-body;
  color: $color-text-muted;
}

/* 状态卡 */
.apply-status {
  &__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16rpx;
  }

  &__title {
    font-size: $fs-h3;
    font-weight: 700;
    color: $color-text-title;
  }

  &__row {
    display: flex;
    align-items: flex-start;
    gap: 16rpx;
    margin-top: 18rpx;
  }

  &__label {
    flex-shrink: 0;
    font-size: $fs-caption;
    color: $color-text-muted;
  }

  &__value {
    flex: 1;
    font-size: $fs-body;
    color: $color-text-body;
  }

  &__time {
    display: block;
    margin-top: 20rpx;
    font-size: $fs-caption;
    color: $color-text-muted;
  }

  &__note {
    display: block;
    margin-top: 20rpx;
    font-size: $fs-caption;
    line-height: 1.6;
    color: $color-text-muted;
  }
}

.apply-reject {
  margin-top: 24rpx;
  padding: 24rpx;
  border-radius: $radius-md;
  border: 4rpx solid $color-danger;
  background: $color-danger-light;

  &__title {
    display: block;
    font-size: $fs-caption;
    font-weight: 700;
    color: $color-danger;
  }

  &__text {
    display: block;
    margin-top: 8rpx;
    font-size: $fs-body;
    line-height: 1.6;
    color: $color-text-body;
  }
}

/* 表单 */
.apply-field {
  margin-bottom: 32rpx;

  &__label {
    display: block;
    margin-bottom: 12rpx;
    font-size: $fs-body;
    font-weight: 700;
    color: $color-text-title;
  }

  &__input,
  &__textarea,
  &__picker {
    width: 100%;
    border-radius: $radius-md;
    border: 4rpx solid $memphis-dark;
    background: $color-bg-canvas;
    box-sizing: border-box;
    font-size: $fs-body;
    color: $color-text-body;
  }

  &__input {
    height: 88rpx;
    padding: 0 24rpx;
  }

  &__textarea {
    height: 240rpx;
    padding: 20rpx 24rpx;
    line-height: 1.6;
  }

  &__picker {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 88rpx;
    padding: 0 24rpx;
  }

  &__picker-text {
    font-size: $fs-body;
    color: $color-text-body;
  }

  &__picker-icon {
    font-size: $fs-caption;
    color: $color-text-muted;
  }

  &__ph {
    color: $color-text-muted;
    font-size: $fs-body;
  }

  &__note {
    display: block;
    margin-top: 12rpx;
    font-size: $fs-caption;
    color: $color-text-muted;
  }
}

.apply-hint {
  display: block;
  margin-top: 24rpx;
  font-size: $fs-caption;
  line-height: 1.6;
  color: $color-danger;
}

.apply-note {
  display: block;
  margin-top: 24rpx;
  font-size: $fs-caption;
  line-height: 1.6;
  color: $color-text-muted;
}
</style>
