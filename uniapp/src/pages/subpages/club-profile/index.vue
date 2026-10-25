<script>
/**
 * 社团资料编辑（CLB-01 / P1-09，负责人端，仅社长可写）
 *
 * 可编辑：名称 / 简介 / 联系方式 / Logo / 封面（Logo、封面走 P0-07 上传：club_logo / club_cover）
 * 只读：分类、星级（由管理员设定，需求 CLB-01）；服务端对这两个字段不在可写白名单内
 * 数据来源：GET /club/my-clubs（取目标社团与 can_edit 判定）+ POST /club/update（保存）
 * 进入方式：管理主页「编辑资料」（URL 参数 club_id）
 */
import { getMyClubs, updateClub } from '@/api/club'
import { ERROR_CODE } from '@/utils/config'

const NAME_MAX = 30
const INTRO_MAX = 500
const CONTACT_MAX = 50
const STAR_MAX = 5

export default {
  name: 'ClubProfile',

  data: () => ({
    clubId: '',
    loading: true,
    saving: false,
    error: '',
    /** 当前负责关系：{ role, can_edit, club } */
    membership: null,
    hint: '',
    form: { name: '', intro: '', contact: '' },
    /** sb-image-picker 使用数组模型，单图场景取首项 */
    logoList: [],
    coverList: [],
    limits: { name: NAME_MAX, intro: INTRO_MAX, contact: CONTACT_MAX },
  }),

  computed: {
    club() {
      return this.membership ? this.membership.club : null
    },
    /** 社长 + 社团正常才允许编辑（服务端在 /update 会二次校验） */
    canEdit() {
      return !!(this.membership && this.membership.can_edit)
    },
    readonlyHint() {
      if (!this.club) return ''
      if (this.club.status === 'banned') return '该社团已被管理员封禁，暂不可编辑资料。'
      if (this.membership && this.membership.role !== 'president') {
        return '仅社长可编辑社团资料；干部可在管理主页查看资料，如需修改请联系社长。'
      }
      return '当前状态不可编辑资料。'
    },
    canSubmit() {
      return (
        this.canEdit &&
        !this.saving &&
        this.form.name.trim().length >= 2 &&
        !!this.form.intro.trim() &&
        !!this.form.contact.trim()
      )
    },
  },

  onLoad(query) {
    this.clubId = (query && query.club_id) || ''
    if (!this.clubId) {
      this.loading = false
      this.error = '缺少社团参数，请从管理主页重新进入'
      return
    }
    this.load()
  },

  methods: {
    async load() {
      this.loading = true
      this.error = ''
      const res = await getMyClubs()
      this.loading = false

      if (res.code === ERROR_CODE.UNAUTHORIZED) {
        this.error = '登录已过期，请重新登录后再试'
        return
      }
      if (res.code !== ERROR_CODE.SUCCESS) {
        this.error = res.message || '社团资料加载失败，请检查网络后重试'
        return
      }

      const found = ((res.data && res.data.list) || []).find((item) => item.club._id === this.clubId)
      if (!found) {
        this.error = '你不是该社团的负责人，无法编辑资料'
        return
      }
      this.membership = found
      this.form.name = found.club.name || ''
      this.form.intro = found.club.intro || ''
      this.form.contact = found.club.contact || ''
      this.logoList = found.club.logo ? [found.club.logo] : []
      this.coverList = found.club.cover ? [found.club.cover] : []
    },

    starText(level) {
      const value = Math.min(STAR_MAX, Math.max(0, Number(level) || 0))
      if (!value) return '未评定'
      return `${'★'.repeat(value)}${'☆'.repeat(STAR_MAX - value)}`
    },

    async submit() {
      if (!this.canSubmit) return
      this.saving = true
      this.hint = ''
      const res = await updateClub({
        club_id: this.clubId,
        name: this.form.name.trim(),
        intro: this.form.intro.trim(),
        contact: this.form.contact.trim(),
        logo: this.logoList[0] || '',
        cover: this.coverList[0] || '',
      })
      this.saving = false

      if (res.code !== ERROR_CODE.SUCCESS) {
        this.hint = res.message || '保存失败，请稍后重试'
        return
      }
      uni.showToast({ title: '资料已保存', icon: 'success' })
      setTimeout(() => uni.navigateBack(), 600)
    },
  },
}
</script>

<template>
  <view class="profile-page">
    <!-- 加载态 -->
    <view v-if="loading" class="profile-card">
      <sb-skeleton :rows="5" />
    </view>

    <!-- 失败态 -->
    <view v-else-if="error" class="profile-card">
      <sb-error :text="error" @retry="load" />
    </view>

    <template v-else-if="club">
      <!-- 只读提示（非社长 / 已封禁） -->
      <view v-if="!canEdit" class="profile-readonly">
        <text class="profile-readonly__title">资料只读</text>
        <text class="profile-readonly__text">{{ readonlyHint }}</text>
      </view>

      <!-- 只读：分类与星级（由管理员设定） -->
      <view class="profile-card">
        <text class="profile-card__section">分类与星级</text>
        <view class="profile-meta">
          <view class="profile-meta__item">
            <text class="profile-meta__label">所属分类</text>
            <view class="profile-pill">{{ club.category_name || '未分类' }}</view>
          </view>
          <view class="profile-meta__item">
            <text class="profile-meta__label">星级</text>
            <view class="profile-star" :class="{ 'profile-star--none': !club.star_level }">
              {{ starText(club.star_level) }}
            </view>
          </view>
        </view>
        <text class="profile-note">分类与星级由社团联合会管理员设定，负责人不可修改。</text>
      </view>

      <!-- 可编辑字段 -->
      <view class="profile-card">
        <text class="profile-card__section">基础资料</text>

        <view class="profile-field">
          <text class="profile-field__label">社团名称</text>
          <input
            v-model="form.name"
            class="profile-field__input"
            type="text"
            :maxlength="limits.name"
            :disabled="!canEdit"
            placeholder="请输入社团名称（2~30 字）"
            placeholder-class="profile-field__ph"
          />
          <text class="profile-field__note">{{ form.name.length }} / {{ limits.name }}（不可与其它社团重名）</text>
        </view>

        <view class="profile-field">
          <text class="profile-field__label">社团简介</text>
          <textarea
            v-model="form.intro"
            class="profile-field__textarea"
            :maxlength="limits.intro"
            :disabled="!canEdit"
            placeholder="介绍社团定位、日常活动与特色"
            placeholder-class="profile-field__ph"
          />
          <text class="profile-field__note">{{ form.intro.length }} / {{ limits.intro }}</text>
        </view>

        <view class="profile-field">
          <text class="profile-field__label">联系方式</text>
          <input
            v-model="form.contact"
            class="profile-field__input"
            type="text"
            :maxlength="limits.contact"
            :disabled="!canEdit"
            placeholder="如：微信 / QQ 群 / 手机号"
            placeholder-class="profile-field__ph"
          />
        </view>

        <view class="profile-field">
          <text class="profile-field__label">社团 Logo</text>
          <sb-image-picker v-model="logoList" scene="club_logo" :disabled="!canEdit" />
        </view>

        <view class="profile-field">
          <text class="profile-field__label">社团封面</text>
          <sb-image-picker v-model="coverList" scene="club_cover" :disabled="!canEdit" />
        </view>

        <template v-if="canEdit">
          <sb-button
            type="primary"
            block
            text="保存资料"
            loading-text="保存中"
            :loading="saving"
            :disabled="!canSubmit"
            @click="submit"
          />
          <text v-if="hint" class="profile-hint">{{ hint }}</text>
          <text class="profile-note">保存后学生端社团列表与详情即时同步。</text>
        </template>
      </view>
    </template>
  </view>
</template>

<style lang="scss" scoped>
.profile-page {
  min-height: 100vh;
  padding: 24rpx 32rpx 48rpx;
  background: $color-bg-canvas;
  box-sizing: border-box;
}

.profile-card {
  padding: 32rpx;
  border-radius: $radius-md;
  border: 4rpx solid $memphis-dark;
  background: $color-bg-card;
  box-shadow: $shadow-memphis-sm;

  & + & {
    margin-top: 24rpx;
  }

  &__section {
    display: block;
    margin-bottom: 24rpx;
    font-size: $fs-h3;
    font-weight: 700;
    color: $color-text-title;
  }
}

/* 只读提示 */
.profile-readonly {
  margin-bottom: 24rpx;
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

/* 分类与星级（只读） */
.profile-meta {
  display: flex;
  align-items: center;
  gap: 40rpx;

  &__item {
    display: flex;
    align-items: center;
    gap: 16rpx;
  }

  &__label {
    font-size: $fs-caption;
    color: $color-text-muted;
  }
}

.profile-pill {
  padding: 6rpx 20rpx;
  border-radius: $radius-full;
  border: 3rpx solid $memphis-dark;
  background: $color-primary-light;
  color: $color-primary;
  font-size: $fs-caption;
  font-weight: 600;
}

.profile-star {
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

/* 表单 */
.profile-field {
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
  }

  &__textarea {
    height: 240rpx;
    padding: 20rpx 24rpx;
    line-height: 1.6;
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

.profile-hint {
  display: block;
  margin-top: 24rpx;
  font-size: $fs-caption;
  line-height: 1.6;
  color: $color-danger;
}

.profile-note {
  display: block;
  margin-top: 20rpx;
  font-size: $fs-caption;
  line-height: 1.6;
  color: $color-text-muted;
}
</style>
