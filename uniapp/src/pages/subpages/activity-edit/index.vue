<script>
/**
 * 活动创建 / 编辑（CLB-03① / P1-10，负责人端）
 *
 * 表单：标题 / 图文内容 / 封面（activity_cover 上传）/ 分类 / 开始与结束时间 / 地点 /
 *       报名起止 / 人数上限 / 报名审核（need_approval）/ 候补（has_waitlist）/ 现场补报（allow_onsite）/ 签到配置
 * 按钮：保存草稿（saveActivity，不触发敏感词）/ 提交审核（先保存后 submitActivity，命中敏感词被服务端 1001 拦截）
 * 数据来源：GET /activity/manage?activity_id=（编辑回显，限定本人管理的社团）
 * 进入方式：活动管理页「新建活动」/「编辑」/「提交审核」（?submit=1）
 */
import { getMyClubs } from '@/api/club'
import { getCategories } from '@/api/club'
import { saveActivity, submitActivity, getActivityManage } from '@/api/activity'
import { useUserStore } from '@/store/user'
import { ERROR_CODE } from '@/utils/config'
import { requestSubscribe } from '@/utils/subscribe'

const TITLE_MAX = 50
const CONTENT_MAX = 5000
const LOCATION_MAX = 100
const CAPACITY_MAX = 10000
const PASSCODE_MAX = 16
const SIGNIN_METHODS = [
  { value: 'qrcode', label: '扫码签到' },
  { value: 'password', label: '口令签到' },
  { value: 'geofence', label: '定位签到' },
]
/** 默认时段：明天 19:00~21:00，报名即日起至活动开始前 1 小时 */
function defaultTimes() {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 19, 0, 0)
  const end = new Date(start.getTime() + 2 * 3600 * 1000)
  const signupStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0)
  const signupEnd = new Date(start.getTime() - 3600 * 1000)
  return { start, end, signupStart, signupEnd }
}

const pad2 = (n) => String(n).padStart(2, '0')
const toDateStr = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
const toTimeStr = (d) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`

export default {
  name: 'ActivityEdit',

  data: () => ({
    activityId: '',
    autoSubmit: false,
    loading: true,
    saving: false,
    error: '',
    hint: '',
    /** 我管理的社团（president / officer 均可创建活动） */
    clubs: [],
    categories: [],
    /** 编辑中的原记录（含 status，判断是否可编辑） */
    origin: null,
    signinMethods: SIGNIN_METHODS,
    form: {
      clubIndex: -1,
      title: '',
      content: '',
      coverList: [],
      categoryIndex: -1,
      startDate: '',
      startTime: '19:00',
      endDate: '',
      endTime: '21:00',
      signupStartDate: '',
      signupStartTime: '00:00',
      signupEndDate: '',
      signupEndTime: '18:00',
      location: '',
      capacity: '50',
      needApproval: false,
      hasWaitlist: true,
      allowOnsite: false,
      signinMethodsSel: ['qrcode'],
      passcode: '',
      radiusM: '',
      windowStart: '0',
      windowEnd: '0',
    },
    limits: { title: TITLE_MAX, content: CONTENT_MAX, location: LOCATION_MAX },
  }),

  computed: {
    userStore() {
      return useUserStore()
    },
    isVerified() {
      return this.userStore.isAuthenticated
    },
    clubNames() {
      return this.clubs.map((item) => item.club.name)
    },
    categoryNames() {
      return this.categories.map((item) => item.name)
    },
    selectedClub() {
      return this.form.clubIndex >= 0 ? this.clubs[this.form.clubIndex] : null
    },
    selectedCategory() {
      return this.form.categoryIndex >= 0 ? this.categories[this.form.categoryIndex] : null
    },
    /** 编辑态：仅草稿可编辑 */
    isEditable() {
      return !this.activityId || (this.origin && this.origin.status === 'draft')
    },
    canSubmit() {
      return (
        this.isVerified &&
        !!this.selectedClub &&
        !!this.form.title.trim() &&
        !!this.form.content.trim() &&
        !!this.selectedCategory &&
        !!this.form.location.trim() &&
        Number(this.form.capacity) >= 1 &&
        this.form.signinMethodsSel.length > 0
      )
    },
  },

  onLoad(query) {
    this.activityId = (query && query.id) || ''
    this.autoSubmit = (query && query.submit) === '1'
    this.initDefaults()
    this.load()
  },

  methods: {
    initDefaults() {
      const { start, end, signupStart, signupEnd } = defaultTimes()
      this.form.startDate = toDateStr(start)
      this.form.startTime = toTimeStr(start)
      this.form.endDate = toDateStr(end)
      this.form.endTime = toTimeStr(end)
      this.form.signupStartDate = toDateStr(signupStart)
      this.form.signupStartTime = toTimeStr(signupStart)
      this.form.signupEndDate = toDateStr(signupEnd)
      this.form.signupEndTime = toTimeStr(signupEnd)
    },

    async load() {
      this.loading = true
      this.error = ''
      const [clubRes, catRes] = await Promise.all([getMyClubs(), getCategories()])
      if (clubRes.code === ERROR_CODE.SUCCESS) this.clubs = (clubRes.data && clubRes.data.list) || []
      if (catRes.code === ERROR_CODE.SUCCESS) this.categories = (catRes.data && catRes.data.list) || []

      if (this.activityId) {
        const res = await getActivityManage({ activity_id: this.activityId })
        this.loading = false
        if (res.code !== ERROR_CODE.SUCCESS || !(res.data && res.data.list && res.data.list[0])) {
          this.error = (res.code === ERROR_CODE.NOT_FOUND ? res.message : '活动加载失败，请稍后重试') || '活动加载失败，请稍后重试'
          return
        }
        this.origin = res.data.list[0]
        this.fillForm(this.origin)
        return
      }

      this.loading = false
      if (!this.clubs.length) {
        this.error = '你还没有管理的社团，无法创建活动'
        return
      }
      this.form.clubIndex = 0
    },

    fillForm(activity) {
      const start = new Date(activity.start_time)
      const end = new Date(activity.end_time)
      const signupStart = new Date(activity.signup_start)
      const signupEnd = new Date(activity.signup_end)
      this.form.title = activity.title || ''
      this.form.content = activity.content || ''
      this.form.coverList = activity.cover ? [activity.cover] : []
      this.form.location = activity.location || ''
      this.form.capacity = String(activity.capacity || '')
      this.form.needApproval = !!activity.need_approval
      this.form.hasWaitlist = !!activity.has_waitlist
      this.form.allowOnsite = !!activity.allow_onsite
      this.form.startDate = toDateStr(start)
      this.form.startTime = toTimeStr(start)
      this.form.endDate = toDateStr(end)
      this.form.endTime = toTimeStr(end)
      this.form.signupStartDate = toDateStr(signupStart)
      this.form.signupStartTime = toTimeStr(signupStart)
      this.form.signupEndDate = toDateStr(signupEnd)
      this.form.signupEndTime = toTimeStr(signupEnd)

      const clubIndex = this.clubs.findIndex((item) => item.club._id === activity.club_id)
      this.form.clubIndex = clubIndex >= 0 ? clubIndex : -1
      const catIndex = this.categories.findIndex((item) => item._id === activity.category_id)
      this.form.categoryIndex = catIndex >= 0 ? catIndex : -1

      const config = activity.signin_config || {}
      this.form.signinMethodsSel = Array.isArray(config.methods) ? config.methods : ['qrcode']
      // 字段名与后端签到时候的读取口径一致：password / geo（P1-14 起；旧名 code / location 已废弃）
      this.form.passcode = (config && config.password) || ''
      this.form.radiusM = (config && config.geo && config.geo.radius_m) ? String(config.geo.radius_m) : ''
      this.form.windowStart = (config && config.time_window) ? String(config.time_window.start_offset_min || 0) : '0'
      this.form.windowEnd = (config && config.time_window) ? String(config.time_window.end_offset_min || 0) : '0'
    },

    toggleMethod(value) {
      const list = this.form.signinMethodsSel.slice()
      const index = list.indexOf(value)
      if (index === -1) list.push(value)
      else list.splice(index, 1)
      this.form.signinMethodsSel = list
    },

    onClubChange(event) {
      this.form.clubIndex = Number(event.detail.value)
    },
    onCategoryChange(event) {
      this.form.categoryIndex = Number(event.detail.value)
    },

    /** 组合日期 + 时间为毫秒时间戳 */
    combineDateTime(dateStr, timeStr) {
      return new Date(`${dateStr}T${timeStr || '00:00'}:00`).getTime()
    },

    buildPayload() {
      return {
        club_id: this.selectedClub.club._id,
        title: this.form.title.trim(),
        content: this.form.content.trim(),
        cover: this.form.coverList[0] || '',
        category_id: this.selectedCategory._id,
        start_time: this.combineDateTime(this.form.startDate, this.form.startTime),
        end_time: this.combineDateTime(this.form.endDate, this.form.endTime),
        location: this.form.location.trim(),
        signup_start: this.combineDateTime(this.form.signupStartDate, this.form.signupStartTime),
        signup_end: this.combineDateTime(this.form.signupEndDate, this.form.signupEndTime),
        capacity: Number(this.form.capacity),
        need_approval: this.form.needApproval,
        has_waitlist: this.form.hasWaitlist,
        allow_onsite: this.form.allowOnsite,
        signin_config: {
          methods: this.form.signinMethodsSel,
          password: this.form.signinMethodsSel.indexOf('password') !== -1 ? this.form.passcode.trim() : '',
          geo:
            this.form.signinMethodsSel.indexOf('geofence') !== -1 && Number(this.form.radiusM) > 0
              ? { radius_m: Number(this.form.radiusM) }
              : null,
          time_window: {
            start_offset_min: Number(this.form.windowStart) || 0,
            end_offset_min: Number(this.form.windowEnd) || 0,
          },
        },
      }
    },

    validate() {
      if (!this.canSubmit) return '请完整填写活动信息（标题 / 内容 / 分类 / 地点 / 人数 / 至少一种签到方式）'
      const payload = this.buildPayload()
      if (payload.end_time <= payload.start_time) return '活动结束时间需晚于开始时间'
      if (payload.signup_start >= payload.signup_end) return '报名开始时间需早于报名截止时间'
      if (payload.signup_end > payload.start_time) return '报名截止时间需不晚于活动开始时间'
      if (payload.capacity < 1 || payload.capacity > CAPACITY_MAX) return `人数上限需在 1~${CAPACITY_MAX} 之间`
      if (payload.signin_config.methods.indexOf('password') !== -1 && !payload.signin_config.password) return '口令签到需填写签到口令'
      if (payload.signin_config.methods.indexOf('geofence') !== -1 && Number(this.form.radiusM) <= 0) {
        return '定位签到需填写定位半径'
      }
      return ''
    },

    /** 保存草稿 */
    async saveDraft() {
      if (!this.isVerified) {
        this.hint = '请先完成登录与学号认证'
        return
      }
      const errText = this.validate()
      if (errText) {
        this.hint = errText
        return
      }
      const payload = this.buildPayload()
      if (this.activityId) payload.activity_id = this.activityId
      this.saving = true
      this.hint = ''
      const res = await saveActivity(payload)
      this.saving = false
      if (res.code !== ERROR_CODE.SUCCESS) {
        this.hint = res.message || '保存失败，请稍后重试'
        return
      }
      uni.showToast({ title: '草稿已保存', icon: 'success' })
      setTimeout(() => uni.navigateBack(), 600)
    },

    /** 提交审核：先保存（创建或更新草稿）再 submit；命中敏感词由服务端 1001 拦截 */
    async submit() {
      if (!this.isVerified) {
        this.hint = '请先完成登录与学号认证'
        return
      }
      const errText = this.validate()
      if (errText) {
        this.hint = errText
        return
      }
      const payload = this.buildPayload()
      if (this.activityId) payload.activity_id = this.activityId

      this.saving = true
      this.hint = ''
      let savedId = this.activityId
      if (!savedId) {
        const saveRes = await saveActivity(payload)
        if (saveRes.code !== ERROR_CODE.SUCCESS) {
          this.saving = false
          this.hint = saveRes.message || '保存失败，请稍后重试'
          return
        }
        savedId = saveRes.data.activity._id
      }

      // 同步请求订阅授权（V-11：负责人提交审核时机）
      requestSubscribe('club_review_submit')

      const submitRes = await submitActivity(savedId)
      this.saving = false
      if (submitRes.code !== ERROR_CODE.SUCCESS) {
        this.hint = submitRes.message || '提交审核失败，请稍后重试'
        return
      }
      uni.showToast({ title: '已提交审核', icon: 'success' })
      setTimeout(() => uni.navigateBack(), 600)
    },
  },
}
</script>

<template>
  <view class="edit-page">
    <!-- 未认证引导 -->
    <view v-if="!isVerified" class="edit-card">
      <text class="edit-card__title">创建活动</text>
      <text class="edit-card__desc">发布活动需先完成学号认证，且为社团社长 / 干部。</text>
    </view>

    <template v-else>
      <!-- 加载态 -->
      <view v-if="loading" class="edit-card">
        <sb-skeleton :rows="6" />
      </view>

      <!-- 失败态 / 不可编辑 -->
      <view v-else-if="error" class="edit-card">
        <sb-error :text="error" @retry="load" />
      </view>
      <view v-else-if="!isEditable" class="edit-card">
        <sb-error text="仅「草稿」状态的活动可编辑（当前已提交或已发布）" />
      </view>

      <template v-else>
        <!-- 所属社团与分类 -->
        <view class="edit-card">
          <text class="edit-card__section">归属与分类</text>

          <view class="edit-field">
            <text class="edit-field__label">所属社团</text>
            <picker
              mode="selector"
              :range="clubNames"
              :value="form.clubIndex"
              :disabled="!!activityId"
              @change="onClubChange"
            >
              <view class="edit-field__picker">
                <text :class="selectedClub ? 'edit-field__picker-text' : 'edit-field__ph'">
                  {{ selectedClub ? selectedClub.club.name : '请选择社团' }}
                </text>
                <text class="edit-field__picker-icon">▾</text>
              </view>
            </picker>
          </view>

          <view class="edit-field">
            <text class="edit-field__label">活动分类</text>
            <picker mode="selector" :range="categoryNames" :value="form.categoryIndex" @change="onCategoryChange">
              <view class="edit-field__picker">
                <text :class="selectedCategory ? 'edit-field__picker-text' : 'edit-field__ph'">
                  {{ selectedCategory ? selectedCategory.name : '请选择分类' }}
                </text>
                <text class="edit-field__picker-icon">▾</text>
              </view>
            </picker>
          </view>
        </view>

        <!-- 基础信息 -->
        <view class="edit-card">
          <text class="edit-card__section">活动信息</text>

          <view class="edit-field">
            <text class="edit-field__label">活动标题</text>
            <input
              v-model="form.title"
              class="edit-field__input"
              type="text"
              :maxlength="limits.title"
              placeholder="请输入活动标题"
              placeholder-class="edit-field__ph"
            />
            <text class="edit-field__note">{{ form.title.length }} / {{ limits.title }}</text>
          </view>

          <view class="edit-field">
            <text class="edit-field__label">图文内容</text>
            <textarea
              v-model="form.content"
              class="edit-field__textarea"
              :maxlength="limits.content"
              placeholder="介绍活动内容、流程与注意事项"
              placeholder-class="edit-field__ph"
            />
            <text class="edit-field__note">{{ form.content.length }} / {{ limits.content }}</text>
          </view>

          <view class="edit-field">
            <text class="edit-field__label">活动封面</text>
            <sb-image-picker v-model="form.coverList" scene="activity_cover" />
          </view>

          <view class="edit-field">
            <text class="edit-field__label">活动地点</text>
            <input
              v-model="form.location"
              class="edit-field__input"
              type="text"
              :maxlength="limits.location"
              placeholder="如：大学生活动中心 101"
              placeholder-class="edit-field__ph"
            />
          </view>
        </view>

        <!-- 时间与名额 -->
        <view class="edit-card">
          <text class="edit-card__section">时间与名额</text>

          <view class="edit-field">
            <text class="edit-field__label">活动开始</text>
            <view class="edit-field__datetime">
              <picker mode="date" :value="form.startDate" @change="form.startDate = $event.detail.value">
                <view class="edit-field__pick-half">{{ form.startDate }}</view>
              </picker>
              <picker mode="time" :value="form.startTime" @change="form.startTime = $event.detail.value">
                <view class="edit-field__pick-half">{{ form.startTime }}</view>
              </picker>
            </view>
          </view>

          <view class="edit-field">
            <text class="edit-field__label">活动结束</text>
            <view class="edit-field__datetime">
              <picker mode="date" :value="form.endDate" @change="form.endDate = $event.detail.value">
                <view class="edit-field__pick-half">{{ form.endDate }}</view>
              </picker>
              <picker mode="time" :value="form.endTime" @change="form.endTime = $event.detail.value">
                <view class="edit-field__pick-half">{{ form.endTime }}</view>
              </picker>
            </view>
          </view>

          <view class="edit-field">
            <text class="edit-field__label">报名开始</text>
            <view class="edit-field__datetime">
              <picker mode="date" :value="form.signupStartDate" @change="form.signupStartDate = $event.detail.value">
                <view class="edit-field__pick-half">{{ form.signupStartDate }}</view>
              </picker>
              <picker mode="time" :value="form.signupStartTime" @change="form.signupStartTime = $event.detail.value">
                <view class="edit-field__pick-half">{{ form.signupStartTime }}</view>
              </picker>
            </view>
          </view>

          <view class="edit-field">
            <text class="edit-field__label">报名截止</text>
            <view class="edit-field__datetime">
              <picker mode="date" :value="form.signupEndDate" @change="form.signupEndDate = $event.detail.value">
                <view class="edit-field__pick-half">{{ form.signupEndDate }}</view>
              </picker>
              <picker mode="time" :value="form.signupEndTime" @change="form.signupEndTime = $event.detail.value">
                <view class="edit-field__pick-half">{{ form.signupEndTime }}</view>
              </picker>
            </view>
          </view>

          <view class="edit-field">
            <text class="edit-field__label">人数上限</text>
            <input
              v-model="form.capacity"
              class="edit-field__input"
              type="number"
              placeholder="请输入报名人数上限"
              placeholder-class="edit-field__ph"
            />
          </view>

          <view class="edit-switches">
            <view class="edit-switch">
              <view class="edit-switch__main">
                <text class="edit-switch__label">报名需审核</text>
                <text class="edit-switch__desc">开启后报名需负责人逐个审核通过</text>
              </view>
              <switch :checked="form.needApproval" color="#2F80ED" @change="form.needApproval = $event.detail.value" />
            </view>
            <view class="edit-switch">
              <view class="edit-switch__main">
                <text class="edit-switch__label">开启候补</text>
                <text class="edit-switch__desc">满员后报名进入候补队列，有名额按报名顺序转正</text>
              </view>
              <switch :checked="form.hasWaitlist" color="#2F80ED" @change="form.hasWaitlist = $event.detail.value" />
            </view>
            <view class="edit-switch">
              <view class="edit-switch__main">
                <text class="edit-switch__label">允许现场补报</text>
                <text class="edit-switch__desc">活动进行中未报名者可现场报名后签到</text>
              </view>
              <switch :checked="form.allowOnsite" color="#2F80ED" @change="form.allowOnsite = $event.detail.value" />
            </view>
          </view>
        </view>

        <!-- 签到配置 -->
        <view class="edit-card">
          <text class="edit-card__section">签到配置</text>

          <view class="edit-field">
            <text class="edit-field__label">签到方式（至少一种）</text>
            <view class="edit-methods">
              <view
                v-for="method in signinMethods"
                :key="method.value"
                class="edit-method"
                :class="{ 'edit-method--active': form.signinMethodsSel.indexOf(method.value) !== -1 }"
                @tap="toggleMethod(method.value)"
              >
                {{ method.label }}
              </view>
            </view>
          </view>

          <view v-if="form.signinMethodsSel.indexOf('password') !== -1" class="edit-field">
            <text class="edit-field__label">签到口令</text>
            <input
              v-model="form.passcode"
              class="edit-field__input"
              type="text"
              :maxlength="PASSCODE_MAX"
              placeholder="报名同学凭口令签到"
              placeholder-class="edit-field__ph"
            />
          </view>

          <view v-if="form.signinMethodsSel.indexOf('geofence') !== -1" class="edit-field">
            <text class="edit-field__label">定位半径（米）</text>
            <input
              v-model="form.radiusM"
              class="edit-field__input"
              type="number"
              placeholder="如：200"
              placeholder-class="edit-field__ph"
            />
            <text class="edit-field__note">以活动地点为中心，超出半径无法签到</text>
          </view>

          <view class="edit-field">
            <text class="edit-field__label">签到时段</text>
            <view class="edit-field__datetime">
              <view class="edit-field__pick-half edit-field__pick-half--input">
                <input v-model="form.windowStart" type="number" placeholder="开始前" placeholder-class="edit-field__ph" />
                <text class="edit-field__unit">分</text>
              </view>
              <view class="edit-field__pick-half edit-field__pick-half--input">
                <input v-model="form.windowEnd" type="number" placeholder="结束后" placeholder-class="edit-field__ph" />
                <text class="edit-field__unit">分</text>
              </view>
            </view>
            <text class="edit-field__note">相对活动开始时间：可提前 N 分钟开始签到、延后 N 分钟结束签到</text>
          </view>
        </view>

        <text v-if="hint" class="edit-hint">{{ hint }}</text>

        <view class="edit-actions">
          <view class="edit-actions__item">
            <sb-button type="ghost" block text="保存草稿" :loading="saving" loading-text="保存中" @click="saveDraft" />
          </view>
          <view class="edit-actions__item">
            <sb-button type="primary" block text="提交审核" :loading="saving" loading-text="提交中" @click="submit" />
          </view>
        </view>
        <text class="edit-note">提交审核后由社团联合会审核，通过后到达报名开始时间自动开放报名；内容命中敏感词将被拦截。</text>
      </template>
    </template>
  </view>
</template>

<style lang="scss" scoped>
.edit-page {
  min-height: 100vh;
  padding: 24rpx 32rpx 48rpx;
  background: $color-bg-canvas;
  box-sizing: border-box;
}

.edit-card {
  padding: 32rpx;
  border-radius: $radius-lg;
  border: 4rpx solid $memphis-dark;
  background: $color-bg-card;
  box-shadow: $shadow-memphis-md;

  & + & {
    margin-top: 24rpx;
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
    margin-bottom: 24rpx;
    font-size: $fs-h3;
    font-weight: 700;
    color: $color-text-title;
  }
}

.edit-field {
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
  &__picker,
  &__pick-half {
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
    height: 260rpx;
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

  &__datetime {
    display: flex;
    align-items: center;
    gap: 20rpx;
  }

  &__pick-half {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    height: 88rpx;
    padding: 0 16rpx;

    &--input {
      gap: 8rpx;

      input {
        flex: 1;
        min-width: 0;
        text-align: center;
      }
    }
  }

  &__unit {
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

/* 开关 */
.edit-switches {
  & + & {
    margin-top: 0;
  }
}

.edit-switch {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20rpx;
  padding: 20rpx 0;
  border-bottom: 3rpx solid $color-border-light;

  &:last-child {
    border-bottom: 0;
  }

  &__main {
    flex: 1;
    min-width: 0;
  }

  &__label {
    display: block;
    font-size: $fs-body;
    font-weight: 700;
    color: $color-text-title;
  }

  &__desc {
    display: block;
    margin-top: 8rpx;
    font-size: $fs-caption;
    color: $color-text-muted;
  }
}

/* 签到方式 */
.edit-methods {
  display: flex;
  flex-wrap: wrap;
  gap: 16rpx;
}

.edit-method {
  padding: 12rpx 28rpx;
  border-radius: $radius-full;
  border: 3rpx solid $memphis-dark;
  background: $color-bg-card;
  color: $color-text-body;
  font-size: $fs-caption;
  font-weight: 600;
  @include memphis-shadow('xs');
  @include press-active;

  &--active {
    background: $color-primary;
    color: #ffffff;
    box-shadow: $shadow-memphis-sm;
  }
}

.edit-hint {
  display: block;
  margin-top: 24rpx;
  font-size: $fs-caption;
  line-height: 1.6;
  color: $color-danger;
}

.edit-actions {
  display: flex;
  align-items: center;
  gap: 20rpx;
  margin-top: 32rpx;

  &__item {
    flex: 1;
  }
}

.edit-note {
  display: block;
  margin-top: 20rpx;
  font-size: $fs-caption;
  line-height: 1.6;
  color: $color-text-muted;
}
</style>
