<script setup>
/**
 * 公告管理（P2-02 / ADM-06）
 *
 * 接口：GET /announcement/list、POST /announcement/publish、POST /announcement/offline、POST /announcement/upload
 * （管理通道 + super / auditor 角色，服务端 requireRole 二次校验）
 *
 * 口径说明：
 * - 发布（先审后发）：标题 + 内容走敏感词过滤，命中 block / review 一律拦截（需求 2.5）；
 * - 发布成功 → 写入 announcements（published）+ 站内系统通知全体已认证用户 + 首页 Banner（最新 5 条轮播）；
 * - Banner 可选：≤5MB，jpg / png / webp，建议 16:9；上传走 /announcement/upload（JSON + base64 通道）；
 * - 下架 status=offline → 首页 Banner 实时移出；已下架公告不可恢复发布，需重新发布。
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { request } from '@/utils/request'

const PAGE_SIZE = 10
const TITLE_MAX = 60
const CONTENT_MAX = 5000
const KEYWORD_MAX = 20
const BANNER_MAX_MB = 5
const BANNER_ACCEPT = ['image/jpeg', 'image/png', 'image/webp']
const BANNER_EXT_MAP = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

const STATUS_META = {
  published: { label: '已发布', cls: 'bg-primary-light text-primary' },
  offline: { label: '已下架', cls: 'bg-ink-line/60 text-ink-muted' },
}

const filters = reactive({ keyword: '', status: 'all' })
const list = ref([])
const total = ref(0)
const page = ref(1)
const loading = ref(false)
const errorMessage = ref('')
const pendingId = ref('')
let requestSeq = 0

const dialog = reactive({
  visible: false,
  title: '',
  content: '',
  bannerUrl: '',
  uploading: false,
  saving: false,
  error: '',
})

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))
const isEmpty = computed(() => !loading.value && !errorMessage.value && list.value.length === 0)

function formatTime(value) {
  if (!value) return '—'
  const raw = value && typeof value === 'object' && value.$date ? value.$date : value
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return '—'
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function statusOf(status) {
  return STATUS_META[status] || STATUS_META.offline
}

async function load() {
  const seq = ++requestSeq
  loading.value = true
  errorMessage.value = ''
  const qs = new URLSearchParams()
  const kw = filters.keyword.trim()
  if (kw) qs.set('keyword', kw)
  if (filters.status !== 'all') qs.set('status', filters.status)
  qs.set('page', String(page.value))
  qs.set('page_size', String(PAGE_SIZE))
  const res = await request({ path: `/announcement/list?${qs.toString()}`, method: 'GET' })
  if (seq !== requestSeq) return // 丢弃过期响应（快速连点 / 改筛选）
  loading.value = false
  if (res.code !== 0 || !res.data) {
    errorMessage.value = res.message || '公告列表加载失败，请稍后重试'
    list.value = []
    total.value = 0
    return
  }
  list.value = res.data.list || []
  total.value = res.data.total || 0
  // 末页被清空（该页最后一条被下架后）→ 自动回退一页
  if (!list.value.length && page.value > 1) {
    page.value -= 1
    await load()
  }
}

function search() {
  page.value = 1
  load()
}

function reset() {
  filters.keyword = ''
  filters.status = 'all'
  page.value = 1
  load()
}

function goPage(next) {
  if (next < 1 || next > totalPages.value || next === page.value) return
  page.value = next
  load()
}

function openPublish() {
  dialog.title = ''
  dialog.content = ''
  dialog.bannerUrl = ''
  dialog.error = ''
  dialog.visible = true
}

/* ---------- Banner 上传（JSON + base64 通道，管理通道 /announcement/upload） ---------- */
function pickBanner() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = BANNER_ACCEPT.join(',')
  input.onchange = async () => {
    const file = input.files && input.files[0]
    if (!file) return
    if (file.size > BANNER_MAX_MB * 1024 * 1024) {
      dialog.error = `Banner 不能超过 ${BANNER_MAX_MB}MB，请更换图片`
      return
    }
    const ext = BANNER_EXT_MAP[file.type]
    if (!ext) {
      dialog.error = '仅支持 jpg / png / webp 格式'
      return
    }
    const reader = new FileReader()
    reader.onload = async () => {
      const base64 = String(reader.result).split(',')[1] || ''
      if (!base64) {
        dialog.error = '图片读取失败，请重新选择'
        return
      }
      dialog.uploading = true
      const res = await request({
        path: '/announcement/upload',
        method: 'POST',
        data: { scene: 'announcement_banner', base64, filename: `banner.${ext}`, mime: file.type },
      })
      dialog.uploading = false
      if (res.code !== 0 || !res.data) {
        dialog.error = res.message || 'Banner 上传失败，请稍后重试'
        return
      }
      dialog.bannerUrl = res.data.url
      dialog.error = ''
    }
    reader.readAsDataURL(file)
  }
  input.click()
}

function removeBanner() {
  dialog.bannerUrl = ''
}

async function submitPublish() {
  const title = dialog.title.trim()
  const content = dialog.content.trim()
  if (!title) {
    dialog.error = '公告标题不能为空'
    return
  }
  if (title.length > TITLE_MAX) {
    dialog.error = `公告标题最长 ${TITLE_MAX} 字`
    return
  }
  if (!content) {
    dialog.error = '公告内容不能为空'
    return
  }
  if (content.length > CONTENT_MAX) {
    dialog.error = `公告内容最长 ${CONTENT_MAX} 字`
    return
  }
  dialog.saving = true
  const res = await request({
    path: '/announcement/publish',
    method: 'POST',
    data: { title, content, banner: dialog.bannerUrl },
  })
  dialog.saving = false
  if (res.code !== 0) {
    dialog.error = res.message || '发布失败，请稍后重试'
    return
  }
  dialog.visible = false
  const notified = res.data && res.data.notified
  ElMessage.success(
    `公告「${title}」已发布` + (typeof notified === 'number' ? `，已通知 ${notified} 位用户` : '')
  )
  await load()
}

async function offlineAnnouncement(row) {
  try {
    await ElMessageBox.confirm(
      `下架后「${row.title}」将实时移出首页 Banner，已收到的通知不受影响，且不可再恢复发布。确认下架？`,
      '下架公告',
      { confirmButtonText: '下架', cancelButtonText: '取消', type: 'warning' }
    )
  } catch (e) {
    return // 用户取消
  }
  pendingId.value = row._id
  const res = await request({ path: '/announcement/offline', method: 'POST', data: { id: row._id } })
  pendingId.value = ''
  if (res.code !== 0) {
    ElMessage.error(res.message || '下架失败，请稍后重试')
    return
  }
  ElMessage.success(`「${row.title}」已下架`)
  await load()
}

function preview(row) {
  ElMessageBox.alert(
    `<div class="space-y-3">
      ${row.banner ? `<img src="${row.banner}" alt="banner" class="w-full rounded-xl border-2 border-memphis-dark" />` : '<p class="font-sans text-xs text-ink-muted">未配置 Banner 图</p>'}
      <p class="font-sans text-sm leading-relaxed text-ink-body">${String(row.content || '').replace(/</g, '&lt;').replace(/\n/g, '<br/>')}</p>
      <p class="font-sans text-[11px] text-ink-muted">发布于 ${formatTime(row.published_at)} · ${row.publisher_name || ''}</p>
    </div>`,
    `公告详情：${row.title}`,
    { dangerouslyUseHTMLString: true, confirmButtonText: '关闭', center: true }
  )
}

onMounted(load)
</script>

<template>
  <div class="space-y-6">
    <!-- 查询与发布 -->
    <div class="m-card p-6">
      <div class="flex flex-wrap items-end justify-between gap-4">
        <div class="flex flex-wrap items-end gap-5">
          <label class="block">
            <span class="font-sans text-xs font-bold text-memphis-dark">标题关键词</span>
            <input
              v-model="filters.keyword"
              type="search"
              :maxlength="KEYWORD_MAX"
              placeholder="按标题模糊搜索"
              class="mt-2 w-72 rounded-xl border-2 border-memphis-dark bg-canvas px-3 py-2 font-sans text-xs text-ink-body outline-none placeholder:text-ink-muted"
              @keyup.enter="search"
            />
          </label>

          <label class="block">
            <span class="font-sans text-xs font-bold text-memphis-dark">状态</span>
            <select
              v-model="filters.status"
              class="mt-2 rounded-xl border-2 border-memphis-dark bg-canvas px-3 py-2 font-sans text-xs text-ink-body outline-none"
            >
              <option value="all">全部</option>
              <option value="published">已发布</option>
              <option value="offline">已下架</option>
            </select>
          </label>

          <div class="flex gap-3">
            <button
              type="button"
              class="m-pressable rounded-xl border-2 border-memphis-dark bg-primary px-5 py-2 font-sans text-xs font-bold text-white shadow-memphis-sm"
              @click="search"
            >
              查询
            </button>
            <button
              type="button"
              class="m-pressable rounded-xl border-2 border-memphis-dark bg-card px-5 py-2 font-sans text-xs font-bold text-memphis-dark"
              @click="reset"
            >
              重置
            </button>
          </div>
        </div>

        <button
          type="button"
          class="m-pressable rounded-xl border-2 border-memphis-dark bg-primary px-5 py-2 font-sans text-xs font-bold text-white shadow-memphis-sm"
          @click="openPublish"
        >
          + 发布公告
        </button>
      </div>

      <p class="mt-4 font-sans text-xs leading-relaxed text-ink-muted">
        发布后写入站内系统通知（全体已认证用户）+ 首页 Banner（最新 5 条 published 轮播）；标题与内容经敏感词过滤，
        命中拦截 / 送审等级一律拦截（需求 2.5 先审后发）。下架后实时移出 Banner。共 {{ total }} 条
      </p>
    </div>

    <!-- 公告列表 -->
    <div class="m-card">
      <div class="flex items-center justify-between border-b-2 border-memphis-dark px-6 py-4">
        <span class="font-sans text-base font-bold text-memphis-dark">公告列表</span>
        <span class="font-sans text-xs text-ink-muted">按发布时间倒序 · 每页 {{ PAGE_SIZE }} 条</span>
      </div>

      <p
        v-if="errorMessage"
        class="m-6 rounded-xl border-2 border-memphis-dark bg-danger/10 px-4 py-3 font-sans text-xs leading-relaxed text-danger"
      >
        {{ errorMessage }}
      </p>

      <div v-else class="tbl-scroll">
        <table class="w-full border-collapse">
          <thead>
            <tr class="border-b-2 border-memphis-dark bg-canvas">
              <th class="tbl-nowrap px-6 py-3 text-left font-sans text-sm font-semibold text-memphis-dark">标题</th>
              <th class="tbl-nowrap px-6 py-3 text-left font-sans text-sm font-semibold text-memphis-dark">Banner</th>
              <th class="tbl-nowrap px-6 py-3 text-left font-sans text-sm font-semibold text-memphis-dark">状态</th>
              <th class="tbl-nowrap px-6 py-3 text-left font-sans text-sm font-semibold text-memphis-dark">发布时间</th>
              <th class="tbl-nowrap px-6 py-3 text-left font-sans text-sm font-semibold text-memphis-dark">发布人</th>
              <th class="tbl-nowrap px-6 py-3 text-left font-sans text-sm font-semibold text-memphis-dark">操作</th>
            </tr>
          </thead>
          <tbody>
            <!-- 加载态：整行骨架条 -->
            <template v-if="loading">
              <tr v-for="i in 5" :key="`skeleton-${i}`" class="border-b border-ink-line">
                <td colspan="6" class="px-6 py-4">
                  <div class="h-4 w-full animate-pulse rounded-full bg-ink-line"></div>
                </td>
              </tr>
            </template>

            <!-- 空态 -->
            <template v-else-if="isEmpty">
              <tr>
                <td colspan="6" class="px-6 py-16">
                  <div class="flex flex-col items-center gap-3">
                    <span class="flex h-16 w-16 items-center justify-center rounded-full border-2 border-memphis-dark bg-canvas">
                      <span class="material-symbols-outlined text-[28px] text-memphis-dark">campaign</span>
                    </span>
                    <span class="rounded-full border-2 border-memphis-dark bg-warning px-3 py-0.5 font-sans text-[11px] font-bold text-memphis-dark">
                      暂无公告
                    </span>
                    <span class="font-sans text-xs text-ink-muted">
                      没有匹配的公告，点击右上角「发布公告」创建
                    </span>
                  </div>
                </td>
              </tr>
            </template>

            <template v-else>
              <tr v-for="row in list" :key="row._id" class="border-b border-ink-line transition-colors hover:bg-canvas">
                <td class="px-6 py-4">
                  <div class="flex items-center gap-3">
                    <span class="flex h-8 w-8 items-center justify-center rounded-full border-2 border-memphis-dark bg-primary-light">
                      <span class="material-symbols-outlined text-[18px] text-memphis-dark">notifications</span>
                    </span>
                    <div class="min-w-0">
                      <p class="max-w-[320px] truncate font-sans text-sm font-bold text-memphis-dark">{{ row.title }}</p>
                      <p class="mt-0.5 max-w-[320px] truncate font-sans text-[11px] text-ink-muted">{{ row.content }}</p>
                    </div>
                  </div>
                </td>

                <td class="px-6 py-4">
                  <img
                    v-if="row.banner"
                    :src="row.banner"
                    :alt="row.title"
                    class="h-9 w-16 rounded-lg border-2 border-memphis-dark object-cover"
                  />
                  <span v-else class="font-sans text-[11px] text-ink-muted">无</span>
                </td>

                <td class="px-6 py-4">
                  <span
                    class="inline-flex items-center gap-1 whitespace-nowrap rounded-full border-2 border-memphis-dark px-2.5 py-0.5 font-sans text-[11px] font-bold shadow-memphis-xs"
                    :class="statusOf(row.status).cls"
                  >
                    {{ statusOf(row.status).label }}
                  </span>
                </td>

                <td class="tbl-nowrap px-6 py-4 font-sans text-sm text-ink-body">{{ formatTime(row.published_at) }}</td>
                <td class="tbl-nowrap px-6 py-4 font-sans text-sm text-ink-body">{{ row.publisher_name || '—' }}</td>

                <td class="px-6 py-4">
                  <div class="flex items-center gap-3">
                    <button
                      type="button"
                      class="m-pressable whitespace-nowrap rounded-xl border-2 border-memphis-dark bg-card px-3 py-1.5 font-sans text-xs font-bold text-memphis-dark shadow-memphis-xs"
                      @click="preview(row)"
                    >
                      详情
                    </button>
                    <button
                      v-if="row.status === 'published'"
                      type="button"
                      :disabled="pendingId === row._id"
                      class="m-pressable whitespace-nowrap rounded-xl border-2 border-memphis-dark bg-danger-light px-3 py-1.5 font-sans text-xs font-bold text-danger shadow-memphis-xs disabled:opacity-50"
                      @click="offlineAnnouncement(row)"
                    >
                      {{ pendingId === row._id ? '处理中…' : '下架' }}
                    </button>
                    <span v-else class="font-sans text-[11px] text-ink-muted">已下架</span>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>

      <div class="flex flex-wrap items-center justify-between gap-3 border-t-2 border-memphis-dark px-6 py-4">
        <span class="font-sans text-xs text-ink-muted">
          第 {{ page }} / {{ totalPages }} 页 · 共 {{ total }} 条
        </span>
        <div class="flex items-center gap-3">
          <button
            type="button"
            :disabled="page <= 1 || loading"
            class="m-pressable rounded-xl border-2 border-memphis-dark bg-card px-4 py-1.5 font-sans text-xs font-bold text-memphis-dark disabled:opacity-40"
            @click="goPage(page - 1)"
          >
            上一页
          </button>
          <button
            type="button"
            :disabled="page >= totalPages || loading"
            class="m-pressable rounded-xl border-2 border-memphis-dark bg-card px-4 py-1.5 font-sans text-xs font-bold text-memphis-dark disabled:opacity-40"
            @click="goPage(page + 1)"
          >
            下一页
          </button>
        </div>
      </div>
    </div>

    <!-- 发布公告弹窗 -->
    <el-dialog
      v-model="dialog.visible"
      title="发布公告"
      width="640px"
      :close-on-click-modal="false"
      align-center
    >
      <div class="space-y-4 py-2">
        <label class="block">
          <span class="mb-2 block font-sans text-xs font-bold text-memphis-dark">公告标题</span>
          <input
            v-model="dialog.title"
            type="text"
            :maxlength="TITLE_MAX"
            placeholder="如「关于国庆假期安排的通知」"
            class="w-full rounded-xl border-2 border-memphis-dark bg-canvas px-3 py-2 font-sans text-xs text-ink-body outline-none placeholder:text-ink-muted"
          />
        </label>

        <label class="block">
          <span class="mb-2 block font-sans text-xs font-bold text-memphis-dark">公告内容</span>
          <textarea
            v-model="dialog.content"
            :maxlength="CONTENT_MAX"
            rows="6"
            placeholder="正文内容…"
            class="w-full resize-y rounded-xl border-2 border-memphis-dark bg-canvas px-3 py-2 font-sans text-xs leading-relaxed text-ink-body outline-none placeholder:text-ink-muted"
          ></textarea>
          <span class="mt-1 block text-right font-sans text-[11px] text-ink-muted">
            {{ dialog.content.length }} / {{ CONTENT_MAX }}
          </span>
        </label>

        <div class="block">
          <span class="mb-2 block font-sans text-xs font-bold text-memphis-dark">Banner 图（可选）</span>
          <div v-if="dialog.bannerUrl" class="flex items-start gap-3">
            <img
              :src="dialog.bannerUrl"
              alt="banner 预览"
              class="h-16 w-28 rounded-xl border-2 border-memphis-dark object-cover shadow-memphis-xs"
            />
            <button
              type="button"
              class="m-pressable whitespace-nowrap rounded-xl border-2 border-memphis-dark bg-card px-3 py-1.5 font-sans text-xs font-bold text-memphis-dark shadow-memphis-xs"
              @click="removeBanner"
            >
              移除
            </button>
          </div>
          <div v-else>
            <button
              type="button"
              :disabled="dialog.uploading"
              class="m-pressable rounded-xl border-2 border-dashed border-memphis-dark bg-canvas px-5 py-3 font-sans text-xs font-bold text-memphis-dark disabled:opacity-50"
              @click="pickBanner"
            >
              {{ dialog.uploading ? '上传中…' : '选择图片（≤5MB · jpg/png/webp · 建议 16:9）' }}
            </button>
          </div>
        </div>

        <p
          v-if="dialog.error"
          class="rounded-xl border-2 border-memphis-dark bg-danger/10 px-4 py-3 font-sans text-xs leading-relaxed text-danger"
        >
          {{ dialog.error }}
        </p>

        <p class="rounded-xl border-2 border-memphis-dark bg-warning/20 px-4 py-2 font-sans text-[11px] leading-relaxed text-memphis-dark">
          标题与正文经敏感词过滤，命中拦截 / 送审等级将被拒绝发布；发布后自动通知全体已认证用户并上首页 Banner。
        </p>
      </div>
      <template #footer>
        <button
          type="button"
          class="m-pressable rounded-xl border-2 border-memphis-dark bg-card px-5 py-2 font-sans text-xs font-bold text-memphis-dark"
          @click="dialog.visible = false"
        >
          取消
        </button>
        <button
          type="button"
          :disabled="dialog.saving || dialog.uploading"
          class="m-pressable ml-3 rounded-xl border-2 border-memphis-dark bg-primary px-5 py-2 font-sans text-xs font-bold text-white shadow-memphis-sm disabled:opacity-50"
          @click="submitPublish"
        >
          {{ dialog.saving ? '发布中…' : '发布' }}
        </button>
      </template>
    </el-dialog>
  </div>
</template>
