<script>
/**
 * 换绑申诉（STU-01② / COM-01 · P1-05）
 *
 * 流程（需求 4.1.2）：提交「新学号 + 证明材料（≤3 图）+ 说明」→ appeals.status = pending
 *                    → 管理员审核（ADM-10）→ approved（解绑旧学号、绑定新学号）/ rejected（附理由）
 * 约束：同用户同时仅一条进行中申诉；提交时即可查看进度（pending / approved / rejected）。
 * 进入方式：认证页申诉入口 `/pages/subpages/rebind-appeal/index?type=rebind|occupy&student_no=xxx`
 */
import { getCurrentAppeal, submitAppeal } from '@/api/user'
import { useUserStore } from '@/store/user'
import { requestSubscribe } from '@/utils/subscribe'
import { ERROR_CODE } from '@/utils/config'

const STUDENT_NO_RE = /^[0-9A-Za-z]{4,20}$/
/** 进度态 → sb-tag 三式 */
const STATUS_META = {
  pending: { tag: 'pending', label: '待审核' },
  approved: { tag: 'approved', label: '已通过' },
  rejected: { tag: 'rejected', label: '已驳回' },
}

export default {
  data: () => ({
    loading: true,
    submitting: false,
    /** 当前进行中的申诉 / 最近一条申诉 */
    pending: null,
    last: null,
    /** 驳回后允许重新提交 */
    showForm: false,
    hint: '',
    form: { appeal_type: 'rebind', new_student_no: '', proof: '', proof_images: [] },
  }),

  computed: {
    userStore() {
      return useUserStore()
    },
    typeText() {
      return this.form.appeal_type === 'occupy' ? '学号占用申诉' : '换绑申诉'
    },
    isVerified() {
      return this.userStore.isAuthenticated
    },
    currentNo() {
      return (this.userStore.userInfo && this.userStore.userInfo.student_no) || ''
    },
    /** 进度卡展示对象：优先进行中，否则最近一条 */
    progress() {
      return this.pending || this.last
    },
    progressMeta() {
      return (this.progress && STATUS_META[this.progress.status]) || null
    },
    canSubmit() {
      if (this.submitting) return false
      if (!STUDENT_NO_RE.test(this.form.new_student_no.trim())) return false
      // 说明与证明材料至少提供其一
      return !!(this.form.proof.trim() || this.form.proof_images.length)
    },
  },

  onLoad(query) {
    const type = (query && query.type) || ''
    if (type === 'occupy' || type === 'rebind') this.form.appeal_type = type
    else this.form.appeal_type = this.isVerified ? 'rebind' : 'occupy'
    if (query && query.student_no) this.form.new_student_no = String(query.student_no).slice(0, 20)
  },

  onShow() {
    this.load()
  },

  methods: {
    async load() {
      this.loading = true
      const res = await getCurrentAppeal()
      this.loading = false
      if (res.code === ERROR_CODE.UNAUTHORIZED) {
        this.userStore.resetAuth()
        this.hint = '登录已过期，请重新登录后再提交申诉'
        return
      }
      if (res.code !== ERROR_CODE.SUCCESS) {
        this.hint = res.message || '申诉进度加载失败，请稍后重试'
        return
      }
      const list = (res.data && res.data.list) || []
      this.pending = (res.data && res.data.pending) || null
      this.last = list[0] || null
      // 无历史记录或上一条已驳回 → 允许提交
      this.showForm = !this.pending && (!this.last || this.last.status === 'rejected')
    },

    pickType(type) {
      if (this.submitting) return
      this.form.appeal_type = type
      this.hint = ''
    },

    async submit() {
      if (!this.canSubmit) return
      // 订阅授权：必须在点击事件中同步调用（失败静默，不阻断提交）
      requestSubscribe('appeal_submit')

      this.submitting = true
      this.hint = ''
      const res = await submitAppeal({
        appeal_type: this.form.appeal_type,
        new_student_no: this.form.new_student_no.trim(),
        proof: this.form.proof.trim(),
        proof_images: this.form.proof_images,
      })
      this.submitting = false

      if (res.code === ERROR_CODE.UNAUTHORIZED) {
        this.userStore.resetAuth()
        this.hint = '登录已过期，请重新登录后再提交申诉'
        return
      }
      if (res.code !== ERROR_CODE.SUCCESS) {
        this.hint = res.message || '提交失败，请稍后重试'
        return
      }

      uni.showToast({ title: '申诉已提交', icon: 'success' })
      this.form.proof = ''
      this.form.proof_images = []
      this.showForm = false
      await this.load()
    },

    resetForm() {
      this.form.new_student_no = ''
      this.form.proof = ''
      this.form.proof_images = []
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

    goBack() {
      uni.navigateBack()
    },
  },
}
</script>

<template>
  <view class="appeal-page">
    <!-- 顶部说明 -->
    <view class="appeal-card">
      <view class="appeal-card__head">
        <text class="appeal-card__title">{{ typeText }}</text>
        <view class="appeal-card__badge">{{ isVerified ? '已认证' : '未认证' }}</view>
      </view>
      <text class="appeal-card__desc">
        提交新学号与证明材料，由社团联合会管理员审核；审核结果将通过站内消息通知你。
        同一时间仅可有一条进行中的申诉。
      </text>
    </view>

    <!-- 进度卡 -->
    <view v-if="loading" class="appeal-card appeal-card--body appeal-loading">
      <text class="appeal-loading__text">加载申诉进度…</text>
    </view>

    <view v-else-if="progress" class="appeal-card appeal-card--body">
      <view class="appeal-progress">
        <view class="appeal-progress__head">
          <text class="appeal-progress__title">当前进度</text>
          <sb-tag :type="progressMeta.tag" :text="progressMeta.label" />
        </view>
        <view class="appeal-progress__row">
          <text class="appeal-progress__label">{{ progress.appeal_type === 'occupy' ? '占用申诉' : '换绑' }}</text>
          <text class="appeal-progress__value appeal-progress__value--mono">{{ progress.new_student_no }}</text>
        </view>
        <view v-if="progress.old_student_no" class="appeal-progress__row">
          <text class="appeal-progress__label">原学号</text>
          <text class="appeal-progress__value appeal-progress__value--mono">{{ progress.old_student_no }}</text>
        </view>
        <text class="appeal-progress__time">提交于 {{ formatTime(progress.created_at) }}</text>

        <view v-if="progress.status === 'rejected' && progress.reject_reason" class="appeal-reject">
          <text class="appeal-reject__title">驳回理由</text>
          <text class="appeal-reject__text">{{ progress.reject_reason }}</text>
        </view>
        <text v-else-if="progress.status === 'pending'" class="appeal-progress__note">
          管理员正在审核，请耐心等待；审核期间无法重复提交。
        </text>
        <text v-else-if="progress.status === 'approved'" class="appeal-progress__note">
          新学号已绑定生效，请前往「我的资料」查看。
        </text>
      </view>

      <sb-button v-if="progress.status === 'rejected'" type="primary" block text="重新提交申诉" @click="resetForm" />
      <sb-button v-else type="ghost" block text="返回" @click="goBack" />
    </view>

    <!-- 提交表单 -->
    <view v-if="showForm" class="appeal-card appeal-card--body">
      <view class="appeal-field">
        <text class="appeal-field__label">申诉类型</text>
        <view class="appeal-type">
          <view
            class="appeal-type__item"
            :class="{ 'appeal-type__item--active': form.appeal_type === 'rebind' }"
            @tap="pickType('rebind')"
          >
            <text class="appeal-type__text">换绑申诉</text>
          </view>
          <view
            class="appeal-type__item"
            :class="{ 'appeal-type__item--active': form.appeal_type === 'occupy' }"
            @tap="pickType('occupy')"
          >
            <text class="appeal-type__text">学号被占用</text>
          </view>
        </view>
        <text class="appeal-field__note">
          {{ form.appeal_type === 'occupy'
            ? '学号已被其他微信绑定，需管理员解绑后重新绑定到你。'
            : '更换为新的学号（需与原学号在同一花名册内）。' }}
        </text>
      </view>

      <view v-if="form.appeal_type === 'rebind' && currentNo" class="appeal-field">
        <text class="appeal-field__label">当前学号</text>
        <text class="appeal-field__static">{{ currentNo }}</text>
      </view>

      <view class="appeal-field">
        <text class="appeal-field__label">新学号</text>
        <input
          v-model="form.new_student_no"
          class="appeal-field__input appeal-field__input--mono"
          type="text"
          maxlength="20"
          placeholder="请输入要绑定的学号"
          placeholder-class="appeal-field__ph"
        />
      </view>

      <view class="appeal-field">
        <text class="appeal-field__label">证明材料</text>
        <sb-image-picker v-model="form.proof_images" scene="appeal_proof" />
      </view>

      <view class="appeal-field">
        <text class="appeal-field__label">情况说明</text>
        <textarea
          v-model="form.proof"
          class="appeal-field__textarea"
          maxlength="200"
          placeholder="请简要说明申诉原因（与证明材料至少填写其一）"
          placeholder-class="appeal-field__ph"
        />
        <text class="appeal-field__note">{{ form.proof.length }} / 200</text>
      </view>

      <sb-button
        type="primary"
        block
        text="提交申诉"
        loading-text="提交中"
        :loading="submitting"
        :disabled="!canSubmit"
        @click="submit"
      />

      <text v-if="hint" class="appeal-hint">{{ hint }}</text>
      <text class="appeal-note">申诉材料仅用于身份核验，请勿上传与申诉无关的图片。</text>
    </view>

    <!-- 未登录 / 进度加载失败 -->
    <view v-if="!loading && !progress && !showForm" class="appeal-card appeal-card--body">
      <text v-if="hint" class="appeal-hint">{{ hint }}</text>
      <sb-button type="primary" block text="去登录 / 认证" @click="goBack" />
    </view>
  </view>
</template>

<style lang="scss" scoped>
.appeal-page {
  min-height: 100vh;
  padding: 32rpx;
  background: $color-bg-canvas;
  box-sizing: border-box;
}

.appeal-card {
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
    background: $color-primary-light;
    color: $color-primary;
    font-size: $fs-caption;
    font-weight: 700;
    box-shadow: 3rpx 3rpx 0 0 $memphis-dark;
  }

  &__desc {
    display: block;
    margin-top: 16rpx;
    font-size: $fs-body;
    line-height: 1.6;
    color: $color-text-muted;
  }
}

.appeal-loading {
  &__text {
    font-size: $fs-body;
    color: $color-text-muted;
  }
}

/* 进度 */
.appeal-progress {
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
    align-items: center;
    gap: 16rpx;
    margin-top: 20rpx;
  }

  &__label {
    font-size: $fs-caption;
    color: $color-text-muted;
  }

  &__value {
    font-size: $fs-body;
    color: $color-text-body;

    &--mono {
      font-family: $font-mono;
      font-weight: 700;
      color: $color-text-title;
    }
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

.appeal-reject {
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
.appeal-field {
  margin-bottom: 32rpx;

  &__label {
    display: block;
    margin-bottom: 12rpx;
    font-size: $fs-body;
    font-weight: 700;
    color: $color-text-title;
  }

  &__input,
  &__textarea {
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

    &--mono {
      font-family: $font-mono;
      letter-spacing: 2rpx;
    }
  }

  &__textarea {
    height: 200rpx;
    padding: 20rpx 24rpx;
    line-height: 1.6;
  }

  &__static {
    display: block;
    font-family: $font-mono;
    font-size: $fs-body;
    color: $color-text-body;
  }

  &__ph {
    color: $color-text-muted;
    font-size: $fs-body;
  }

  &__note {
    display: block;
    margin-top: 12rpx;
    font-size: $fs-caption;
    line-height: 1.6;
    color: $color-text-muted;
  }
}

.appeal-type {
  display: flex;
  gap: 20rpx;

  &__item {
    flex: 1;
    padding: 20rpx 0;
    text-align: center;
    border-radius: $radius-md;
    border: 4rpx solid $memphis-dark;
    background: $color-bg-canvas;
    @include press-active;

    &--active {
      background: $color-primary-light;
    }
  }

  &__text {
    font-size: $fs-body;
    font-weight: 700;
    color: $color-text-title;
  }
}

.appeal-hint {
  display: block;
  margin-top: 24rpx;
  font-size: $fs-caption;
  line-height: 1.6;
  color: $color-danger;
}

.appeal-note {
  display: block;
  margin-top: 24rpx;
  font-size: $fs-caption;
  line-height: 1.6;
  color: $color-text-muted;
}
</style>
