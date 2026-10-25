<script>
/**
 * 图片选择 / 上传组件（P0-07 / COM-03）
 * - 单图与多图共用：张数由 scene 规格决定（count=1 即单图，动态配图 count=9）
 * - 选图 → 规格校验（张数/大小/格式，超限前端拦截并 toast，不落库）→ 压缩 → 上传 → 回填 URL
 * - 用法：<sb-image-picker v-model="form.cover" scene="activity_cover" />
 */
import { UPLOAD_SCENES, validatePick, uploadFiles, MAX_SIDE } from '@/utils/upload'

export default {
  name: 'sb-image-picker',
  props: {
    /** 已上传图片 URL 列表（v-model） */
    modelValue: { type: Array, default: () => [] },
    /** 上传场景，决定张数/大小/格式规格（见 utils/upload.js UPLOAD_SCENES） */
    scene: { type: String, required: true },
    /** 覆盖场景默认张数上限（一般不用） */
    max: { type: Number, default: 0 },
    disabled: { type: Boolean, default: false },
  },
  emits: ['update:modelValue', 'change', 'error'],
  data() {
    return { uploading: false, progress: '' }
  },
  computed: {
    spec() {
      return UPLOAD_SCENES[this.scene] || { label: '图片', count: 1, maxMB: 5, accept: ['jpg', 'png'] }
    },
    maxCount() {
      return this.max > 0 ? this.max : this.spec.count
    },
    list() {
      return Array.isArray(this.modelValue) ? this.modelValue : []
    },
    canAdd() {
      return !this.disabled && !this.uploading && this.list.length < this.maxCount
    },
    hintText() {
      if (this.uploading) return `上传中 ${this.progress}`
      const parts = [
        `${this.spec.label}：最多 ${this.maxCount} 张`,
        `单张 ≤${this.spec.maxMB}MB`,
        this.spec.accept.join(' / '),
        `压缩后长边 ≤${MAX_SIDE}px`,
      ]
      return parts.join('｜')
    },
  },
  methods: {
    warn(message) {
      uni.showToast({ title: message, icon: 'none' })
      this.$emit('error', message)
    },
    emitValue(urls) {
      this.$emit('update:modelValue', urls)
      this.$emit('change', urls)
    },
    choose() {
      if (!this.canAdd) return
      const remain = this.maxCount - this.list.length
      uni.chooseImage({
        count: remain,
        sizeType: ['original'],
        sourceType: ['album', 'camera'],
        success: (res) => this.handlePick(res),
        fail: () => {},
      })
    },
    async handlePick(res) {
      const files = res.tempFiles && res.tempFiles.length
        ? res.tempFiles
        : (res.tempFilePaths || []).map((path) => ({ path }))

      const check = validatePick(this.scene, files, this.list.length)
      if (!check.ok) {
        this.warn(check.message)
        return
      }

      this.uploading = true
      this.progress = `0/${files.length}`
      const result = await uploadFiles(this.scene, files, (done, total) => {
        this.progress = `${done}/${total}`
      })
      this.uploading = false

      if (!result.ok) {
        this.warn(result.message)
        return
      }
      this.emitValue(this.list.concat(result.urls))
      uni.showToast({ title: '上传成功', icon: 'success' })
    },
    preview(index) {
      uni.previewImage({ urls: this.list, current: this.list[index] })
    },
    remove(index) {
      if (this.disabled) return
      const next = this.list.slice()
      next.splice(index, 1)
      this.emitValue(next)
    },
  },
}
</script>

<template>
  <view class="sb-image-picker">
    <view class="sb-image-picker__grid">
      <view v-for="(url, index) in list" :key="`${url}-${index}`" class="sb-image-picker__item">
        <image class="sb-image-picker__img" :src="url" mode="aspectFill" @tap="preview(index)" />
        <view v-if="!disabled" class="sb-image-picker__remove" @tap.stop="remove(index)">
          <text class="sb-image-picker__remove-icon">×</text>
        </view>
      </view>

      <view v-if="canAdd" class="sb-image-picker__add" @tap="choose">
        <text class="sb-image-picker__add-icon">＋</text>
        <text class="sb-image-picker__add-text">添加图片</text>
      </view>
      <view v-else-if="uploading" class="sb-image-picker__add sb-image-picker__add--busy">
        <text class="sb-image-picker__add-text">上传中 {{ progress }}</text>
      </view>
    </view>

    <text class="sb-image-picker__hint">{{ hintText }}</text>
  </view>
</template>

<style lang="scss" scoped>
.sb-image-picker {
  &__grid {
    display: flex;
    flex-wrap: wrap;
    margin: -8rpx;
  }

  &__item,
  &__add {
    position: relative;
    width: 200rpx;
    height: 200rpx;
    margin: 8rpx;
    @include memphis-border;
    border-radius: $radius-md;
    overflow: hidden;
  }

  &__item {
    background-color: $color-bg-canvas;
  }

  &__img {
    width: 100%;
    height: 100%;
    display: block;
  }

  &__remove {
    position: absolute;
    top: 0;
    right: 0;
    width: 44rpx;
    height: 44rpx;
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: $color-danger;
    border-left: 4rpx solid $color-border-dark;
    border-bottom: 4rpx solid $color-border-dark;
    border-bottom-left-radius: $radius-sm;
  }

  &__remove-icon {
    color: $uni-text-color-inverse;
    font-size: 32rpx;
    line-height: 1;
  }

  &__add {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background-color: $color-primary-light;
    @include press-active;

    &--busy {
      background-color: $color-bg-canvas;
    }
  }

  &__add-icon {
    font-size: 52rpx;
    line-height: 1;
    color: $color-primary;
    font-weight: 700;
  }

  &__add-text {
    margin-top: 12rpx;
    font-size: $fs-caption;
    color: $color-text-muted;
  }

  &__hint {
    display: block;
    margin-top: 20rpx;
    font-size: $fs-caption;
    color: $color-text-muted;
    line-height: 1.6;
  }
}
</style>
