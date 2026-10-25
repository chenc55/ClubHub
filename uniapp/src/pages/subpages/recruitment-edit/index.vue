<script>
/**
 * 招新岗位创建 / 编辑（负责人端 / CLB-04① / P1-16）
 *
 * 内容：岗位信息（标题 / 内容 / 报名截止 / 招聘人数 / 是否多步）+ 自定义报名表构建器
 *      （字段类型：单选 / 多选 / 问答；可编辑标签、选项、必填；可删除）
 * 数据来源：GET /recruitment/manage（编辑回显）、POST /recruitment/save、POST /recruitment/submit
 * 进入方式：招新管理列表「新建 / 编辑」；club_id 来自上一页
 */
import { getRecruitmentManage, saveRecruitment, submitRecruitment } from '@/api/recruitment'
import { ERROR_CODE } from '@/utils/config'

const FIELD_TYPES = [
  { value: 'single', label: '单选' },
  { value: 'multi', label: '多选' },
  { value: 'text', label: '问答' },
]

function todayStrOf(offsetDays = 0) {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export default {
  name: 'RecruitmentEdit',

  data: () => ({
    clubId: '',
    recruitmentId: '',
    submitAfterSave: false,
    loading: true,
    saving: false,
    error: '',
    hint: '',
    fieldTypes: FIELD_TYPES,
    form: {
      title: '',
      content: '',
      signupDate: todayStrOf(7),
      signupTime: '23:59',
      capacity: '',
      multiStep: false,
      fields: [],
    },
    fieldSeq: 0,
  }),

  computed: {
    canSave() {
      return !this.saving && this.form.title.trim() && this.form.content.trim() && this.form.fields.length > 0
    },
  },

  onLoad(query) {
    this.clubId = (query && query.club_id) || ''
    this.recruitmentId = (query && query.id) || ''
    this.submitAfterSave = (query && query.submit === '1')
    if (!this.clubId && !this.recruitmentId) {
      this.loading = false
      this.error = '缺少社团参数，请从招新管理重新进入'
      return
    }
    if (this.recruitmentId) {
      this.load()
    } else {
      this.loading = false
      this.form.fields = [this.newField('single')]
      this.fieldSeq = 1
    }
  },

  methods: {
    async load() {
      this.loading = true
      const res = await getRecruitmentManage({ recruitment_id: this.recruitmentId })
      this.loading = false
      if (res.code !== ERROR_CODE.SUCCESS || !res.data || !res.data.recruitment) {
        this.error = res.message || '岗位加载失败，请稍后重试'
        return
      }
      const row = res.data.recruitment
      this.clubId = row.club_id
      const end = new Date(row.signup_end || Date.now() + 7 * 24 * 3600 * 1000)
      const pad = (n) => String(n).padStart(2, '0')
      this.form = {
        title: row.title || '',
        content: row.content || '',
        signupDate: `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}`,
        signupTime: `${pad(end.getHours())}:${pad(end.getMinutes())}`,
        capacity: row.capacity ? String(row.capacity) : '',
        multiStep: !!row.multi_step,
        fields: Array.isArray(row.form_fields) && row.form_fields.length ? row.form_fields.map((f) => ({ ...f, options: Array.isArray(f.options) ? f.options.slice() : [] })) : [this.newField('single')],
      }
      this.fieldSeq = this.form.fields.length
    },

    newField(type) {
      return { key: `f${++this.fieldSeq}`, label: '', type, required: false, options: type === 'text' ? [] : [''] }
    },

    addField(type) {
      if (this.form.fields.length >= 20) {
        uni.showToast({ title: '报名表字段最多 20 个', icon: 'none' })
        return
      }
      this.form.fields.push(this.newField(type))
    },

    removeField(index) {
      if (this.form.fields.length <= 1) {
        uni.showToast({ title: '至少保留一个字段', icon: 'none' })
        return
      }
      this.form.fields.splice(index, 1)
    },

    changeFieldType(field) {
      if (field.type === 'text') field.options = []
      else if (!field.options.length) field.options = ['']
    },

    addOption(field) {
      if (field.options.length >= 20) {
        uni.showToast({ title: '选项最多 20 个', icon: 'none' })
        return
      }
      field.options.push('')
    },

    removeOption(field, index) {
      if (field.options.length <= 1) {
        uni.showToast({ title: '至少保留一个选项', icon: 'none' })
        return
      }
      field.options.splice(index, 1)
    },

    formatTimeStamp(value) {
      const raw = typeof value === 'object' && value.$date ? value.$date : value
      const date = new Date(raw)
      if (Number.isNaN(date.getTime())) return ''
      const pad = (n) => String(n).padStart(2, '0')
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    },

    fieldTypeLabel(type) {
      const found = FIELD_TYPES.find((item) => item.value === type)
      return (found && found.label) || type
    },

    todayStr(offsetDays = 0) {
      return todayStrOf(offsetDays)
    },

    validate() {
      if (!this.form.title.trim() || this.form.title.trim().length < 2) {
        this.hint = '请填写岗位标题（至少 2 个字）'
        return false
      }
      if (!this.form.content.trim()) {
        this.hint = '请填写岗位内容'
        return false
      }
      const deadline = new Date(`${this.form.signupDate} ${this.form.signupTime}:00`).getTime()
      if (Number.isNaN(deadline) || deadline <= Date.now()) {
        this.hint = '报名截止时间需晚于当前时间'
        return false
      }
      if (this.form.capacity !== '' && (!Number.isInteger(Number(this.form.capacity)) || Number(this.form.capacity) < 1)) {
        this.hint = '招聘人数需为正整数（留空 = 不限）'
        return false
      }
      if (!this.form.fields.length) {
        this.hint = '请至少配置一个报名表字段'
        return false
      }
      const seen = new Set()
      for (const field of this.form.fields) {
        if (!field.label.trim()) {
          this.hint = '请填写字段标签'
          return false
        }
        if (seen.has(field.label.trim())) {
          this.hint = `字段标签「${field.label.trim()}」重复`
          return false
        }
        seen.add(field.label.trim())
        if ((field.type === 'single' || field.type === 'multi')) {
          const options = field.options.map((o) => String(o || '').trim()).filter(Boolean)
          if (options.length < 2) {
            this.hint = `字段「${field.label.trim()}」需至少 2 个选项`
            return false
          }
          field.options = options
        }
      }
      this.hint = ''
      return true
    },

    buildPayload() {
      const deadline = new Date(`${this.form.signupDate} ${this.form.signupTime}:00`).getTime()
      return {
        recruitment_id: this.recruitmentId || undefined,
        club_id: this.clubId,
        title: this.form.title.trim(),
        content: this.form.content.trim(),
        signup_end: deadline,
        capacity: this.form.capacity === '' ? null : Number(this.form.capacity),
        multi_step: this.form.multiStep,
        form_fields: this.form.fields.map((field) => ({
          key: field.key,
          label: field.label.trim(),
          type: field.type,
          required: !!field.required,
          options: field.type === 'text' ? [] : field.options.map((o) => String(o || '').trim()),
        })),
      }
    },

    async saveDraft() {
      if (!this.validate() || this.saving) return
      this.saving = true
      const res = await saveRecruitment(this.buildPayload())
      this.saving = false
      if (res.code !== ERROR_CODE.SUCCESS) {
        this.hint = res.message || '保存失败，请稍后重试'
        return
      }
      uni.showToast({ title: '已保存草稿', icon: 'success' })
      setTimeout(() => uni.navigateBack(), 600)
    },

    async saveAndSubmit() {
      if (!this.validate() || this.saving) return
      this.saving = true
      const saved = await saveRecruitment(this.buildPayload())
      if (saved.code !== ERROR_CODE.SUCCESS) {
        this.saving = false
        this.hint = saved.message || '保存失败，请稍后重试'
        return
      }
      const id = this.recruitmentId || ((saved.data && saved.data.recruitment && saved.data.recruitment._id))
      const res = await submitRecruitment(id)
      this.saving = false
      if (res.code !== ERROR_CODE.SUCCESS) {
        this.hint = res.message || '提交审核失败，请稍后重试'
        return
      }
      uni.showToast({ title: '已提交审核', icon: 'success' })
      setTimeout(() => uni.navigateBack(), 600)
    },
  },
}
</script>

<template>
  <view class="rce-page">
    <!-- 加载态 -->
    <view v-if="loading" class="rce-card">
      <sb-skeleton :rows="4" />
    </view>

    <!-- 失败态 -->
    <view v-else-if="error" class="rce-card">
      <sb-error :text="error" @retry="load" />
    </view>

    <template v-else>
      <!-- 岗位信息 -->
      <view class="rce-card">
        <text class="rce-card__section">岗位信息</text>
        <view class="rce-field">
          <text class="rce-field__label">岗位标题</text>
          <input v-model="form.title" class="rce-input" type="text" :maxlength="50" placeholder="如：干事招新" />
        </view>
        <view class="rce-field">
          <text class="rce-field__label">岗位内容</text>
          <textarea v-model="form.content" class="rce-textarea" :maxlength="5000" placeholder="岗位职责 / 任职要求 / 待遇说明等" />
        </view>
        <view class="rce-field">
          <text class="rce-field__label">报名截止</text>
          <view class="rce-picker">
            <picker mode="date" :value="form.signupDate" :start="todayStr(0)" @change="form.signupDate = $event.detail.value">
              <view class="rce-picker__item">{{ form.signupDate }}</view>
            </picker>
            <picker mode="time" :value="form.signupTime" @change="form.signupTime = $event.detail.value">
              <view class="rce-picker__item">{{ form.signupTime }}</view>
            </picker>
          </view>
        </view>
        <view class="rce-field">
          <text class="rce-field__label">招聘人数（留空 = 不限）</text>
          <input v-model="form.capacity" class="rce-input" type="number" placeholder="如：10" />
        </view>
        <view class="rce-field rce-field--row">
          <text class="rce-field__label">多步招新（含面试）</text>
          <switch :checked="form.multiStep" color="#2F80ED" @change="form.multiStep = $event.detail.value" />
        </view>
      </view>

      <!-- 自定义报名表构建器 -->
      <view class="rce-card">
        <view class="rce-card__head">
          <text class="rce-card__section">自定义报名表</text>
          <text class="rce-card__tip">单选 / 多选 / 问答 · 共 {{ form.fields.length }} 项</text>
        </view>

        <view v-for="(field, index) in form.fields" :key="field.key" class="rce-fieldbox">
          <view class="rce-fieldbox__top">
            <text class="rce-fieldbox__no">#{{ index + 1 }}</text>
            <text class="rce-fieldbox__type">{{ fieldTypeLabel(field.type) }}</text>
            <view class="rce-fieldbox__spacer" />
            <text class="rce-fieldbox__del" @tap="removeField(index)">删除</text>
          </view>
          <view class="rce-field">
            <input v-model="field.label" class="rce-input" type="text" :maxlength="20" placeholder="字段标签，如：意向部门" />
          </view>
          <view class="rce-field rce-field--row">
            <text class="rce-field__label">必填</text>
            <switch :checked="!!field.required" color="#2F80ED" @change="field.required = $event.detail.value" />
          </view>
          <view v-if="field.type !== 'text'" class="rce-field">
            <text class="rce-field__label">选项</text>
            <view v-for="(opt, oi) in field.options" :key="oi" class="rce-opt">
              <input v-model="field.options[oi]" class="rce-input" type="text" :maxlength="20" :placeholder="`选项 ${oi + 1}`" />
              <text class="rce-opt__del" @tap="removeOption(field, oi)">×</text>
            </view>
            <view class="rce-opt__add" @tap="addOption(field)">+ 添加选项</view>
          </view>
        </view>

        <!-- 添加字段 -->
        <view class="rce-addrow">
          <text class="rce-addrow__label">添加字段</text>
          <view
            v-for="type in fieldTypes"
            :key="type.value"
            class="rce-addrow__btn"
            @tap="addField(type.value)"
          >
            + {{ type.label }}
          </view>
        </view>
      </view>

      <text v-if="hint" class="rce-hint">{{ hint }}</text>

      <!-- 操作 -->
      <view class="rce-actions">
        <view class="rce-actions__btn">
          <sb-button type="ghost" block text="保存草稿" :loading="saving" loading-text="保存中" @click="saveDraft" />
        </view>
        <view class="rce-actions__btn">
          <sb-button type="primary" block :text="submitAfterSave ? '提交审核' : '保存并提交审核'" :loading="saving" loading-text="提交中" @click="saveAndSubmit" />
        </view>
      </view>
    </template>
  </view>
</template>

<style lang="scss" scoped>
.rce-page {
  min-height: 100vh;
  padding: 24rpx 32rpx 48rpx;
  background: $color-bg-canvas;
  box-sizing: border-box;
}

.rce-card {
  margin-top: 24rpx;
  padding: 32rpx;
  border-radius: $radius-md;
  border: 4rpx solid $memphis-dark;
  background: $color-bg-card;
  box-shadow: $shadow-memphis-sm;

  &__head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: 20rpx;
  }

  &__section {
    display: block;
    font-size: $fs-h3;
    font-weight: 700;
    color: $color-text-title;
  }

  &__tip {
    font-size: $fs-caption;
    color: $color-text-muted;
  }
}

.rce-field {
  margin-top: 24rpx;

  &--row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  &__label {
    display: block;
    margin-bottom: 10rpx;
    font-size: $fs-caption;
    font-weight: 700;
    color: $color-text-body;
  }
}

.rce-input {
  width: 100%;
  padding: 16rpx 20rpx;
  border-radius: $radius-sm;
  border: 3rpx solid $memphis-dark;
  background: $color-bg-canvas;
  font-size: $fs-body;
  box-sizing: border-box;
}

.rce-textarea {
  width: 100%;
  height: 160rpx;
  padding: 16rpx 20rpx;
  border-radius: $radius-sm;
  border: 3rpx solid $memphis-dark;
  background: $color-bg-canvas;
  font-size: $fs-body;
  box-sizing: border-box;
}

.rce-picker {
  display: flex;
  gap: 16rpx;

  &__item {
    padding: 16rpx 24rpx;
    border-radius: $radius-sm;
    border: 3rpx solid $memphis-dark;
    background: $color-bg-canvas;
    font-size: $fs-body;
  }
}

.rce-fieldbox {
  margin-top: 24rpx;
  padding: 24rpx;
  border-radius: $radius-sm;
  border: 3rpx dashed $memphis-dark;
  background: $color-bg-canvas;

  &__top {
    display: flex;
    align-items: center;
    gap: 12rpx;
    margin-bottom: 8rpx;
  }

  &__no {
    font-size: $fs-caption;
    font-weight: 700;
    color: $color-text-muted;
  }

  &__type {
    padding: 4rpx 14rpx;
    border-radius: 999rpx;
    border: 3rpx solid $memphis-dark;
    background: $color-primary-light;
    font-size: $fs-caption;
    color: $color-primary;
  }

  &__spacer {
    flex: 1;
  }

  &__del {
    font-size: $fs-caption;
    color: $color-danger;
  }
}

.rce-opt {
  display: flex;
  align-items: center;
  gap: 12rpx;
  margin-top: 12rpx;

  &__del {
    padding: 8rpx 16rpx;
    font-size: $fs-h3;
    color: $color-danger;
  }

  &__add {
    margin-top: 12rpx;
    font-size: $fs-caption;
    font-weight: 700;
    color: $color-primary;
  }
}

.rce-addrow {
  display: flex;
  align-items: center;
  gap: 12rpx;
  flex-wrap: wrap;
  margin-top: 24rpx;
  padding-top: 24rpx;
  border-top: 2rpx dashed $memphis-dark;

  &__label {
    font-size: $fs-caption;
    font-weight: 700;
    color: $color-text-body;
  }

  &__btn {
    padding: 10rpx 20rpx;
    border-radius: 999rpx;
    border: 3rpx solid $memphis-dark;
    background: $color-bg-card;
    font-size: $fs-caption;
    color: $color-primary;
  }
}

.rce-hint {
  display: block;
  margin-top: 20rpx;
  padding: 16rpx 20rpx;
  border-radius: $radius-sm;
  background: $color-danger-light;
  font-size: $fs-caption;
  color: $color-danger;
}

.rce-actions {
  display: flex;
  gap: 16rpx;
  margin-top: 32rpx;

  &__btn {
    flex: 1;
  }
}
</style>
