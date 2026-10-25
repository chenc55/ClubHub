<script setup>
/**
 * 敏感词库管理（P1-25 / ADM-09）
 *
 * 接口：GET /sensitive_words/list、POST /sensitive_words/save、POST /sensitive_words/delete
 * （管理通道 + super / auditor 角色，服务端 requireRole 二次校验）
 *
 * 口径说明：
 * - 词条按 word 唯一（集合唯一索引）：新增不存在词条、同词重存仅改等级、软删词条重存即复活；
 * - level = block（命中即拦截）/ review（先发后审场景标记疑似送审，先审后发场景同样拦截）；
 * - 写成功后台已调用 refreshSensitiveWords() 即时生效（其余实例最长 10s），新增词条立即可用；
 * - 删除为软删（deleted=1，词条永久保留在库内便于审计）。
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { request } from '@/utils/request'

const PAGE_SIZE = 20
const WORD_MAX = 30
const KEYWORD_MAX = 20

const LEVEL_META = {
  block: { label: '拦截', cls: 'bg-danger-light text-danger', desc: '命中即拦截' },
  review: { label: '送审', cls: 'bg-warning text-memphis-dark', desc: '先发后审标记疑似' },
}

const filters = reactive({ keyword: '' })
const list = ref([])
const total = ref(0)
const page = ref(1)
const loading = ref(false)
const errorMessage = ref('')
const pendingId = ref('')
let requestSeq = 0

const dialog = reactive({ visible: false, mode: 'add', word: '', level: 'block', saving: false, error: '' })

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

function levelOf(level) {
  return LEVEL_META[level] || LEVEL_META.review
}

async function load() {
  const seq = ++requestSeq
  loading.value = true
  errorMessage.value = ''
  const qs = new URLSearchParams()
  const kw = filters.keyword.trim()
  if (kw) qs.set('keyword', kw)
  qs.set('page', String(page.value))
  qs.set('page_size', String(PAGE_SIZE))
  const res = await request({ path: `/sensitive_words/list?${qs.toString()}`, method: 'GET' })
  if (seq !== requestSeq) return // 丢弃过期响应（快速连点 / 改筛选）
  loading.value = false
  if (res.code !== 0 || !res.data) {
    errorMessage.value = res.message || '词库加载失败，请稍后重试'
    list.value = []
    total.value = 0
    return
  }
  list.value = res.data.list || []
  total.value = res.data.total || 0
  // 末页被清空（该页最后一条被删除后）→ 自动回退一页
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
  page.value = 1
  load()
}

function goPage(next) {
  if (next < 1 || next > totalPages.value || next === page.value) return
  page.value = next
  load()
}

function openAdd() {
  dialog.mode = 'add'
  dialog.word = ''
  dialog.level = 'block'
  dialog.error = ''
  dialog.visible = true
}

function openEdit(row) {
  dialog.mode = 'edit'
  dialog.word = row.word
  dialog.level = row.level
  dialog.error = ''
  dialog.visible = true
}

async function submitForm() {
  const word = dialog.word.trim()
  if (!word) {
    dialog.error = '词条不能为空'
    return
  }
  if (word.length > WORD_MAX) {
    dialog.error = `词条最长 ${WORD_MAX} 字`
    return
  }
  dialog.saving = true
  const res = await request({
    path: '/sensitive_words/save',
    method: 'POST',
    data: { word: dialog.word.trim(), level: dialog.level },
  })
  dialog.saving = false
  if (res.code !== 0) {
    dialog.error = res.message || '保存失败，请稍后重试'
    return
  }
  dialog.visible = false
  ElMessage.success(dialog.mode === 'add' ? `已新增「${word}」，立即生效` : `已更新「${word}」的等级`)
  await load()
}

async function removeWord(row) {
  try {
    await ElMessageBox.confirm(
      `删除后「${row.word}」将不再参与内容拦截 / 送审（软删除，不影响已发布内容），确认删除？`,
      '删除词条',
      { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' }
    )
  } catch (e) {
    return // 用户取消
  }
  pendingId.value = row._id
  const res = await request({ path: '/sensitive_words/delete', method: 'POST', data: { word: row.word } })
  pendingId.value = ''
  if (res.code !== 0) {
    ElMessage.error(res.message || '删除失败，请稍后重试')
    return
  }
  ElMessage.success(`已删除「${row.word}」`)
  await load()
}

onMounted(load)
</script>

<template>
  <div class="space-y-6">
    <!-- 查询与新增 -->
    <div class="m-card p-6">
      <div class="flex flex-wrap items-end justify-between gap-4">
        <div class="flex flex-wrap items-end gap-5">
          <label class="block">
            <span class="font-sans text-xs font-bold text-memphis-dark">词条</span>
            <input
              v-model="filters.keyword"
              type="search"
              :maxlength="KEYWORD_MAX"
              placeholder="精确子串匹配，如「代考」"
              class="mt-2 w-72 rounded-xl border-2 border-memphis-dark bg-canvas px-3 py-2 font-sans text-xs text-ink-body outline-none placeholder:text-ink-muted"
              @keyup.enter="search"
            />
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
          @click="openAdd"
        >
          + 新增词条
        </button>
      </div>

      <p class="mt-4 font-sans text-xs leading-relaxed text-ink-muted">
        block 命中即拦截（活动 / 招新 / 公告 / 动态）；review 在「先发后审」的动态中标记疑似送审、
        「先审后发」的活动中同样拦截（需求 2.5）。词条保存后立即生效（其余云函数实例最长 10 秒内同步）。
        共 {{ total }} 条
      </p>
    </div>

    <!-- 词条列表 -->
    <div class="m-card">
      <div class="flex items-center justify-between border-b-2 border-memphis-dark px-6 py-4">
        <span class="font-sans text-base font-bold text-memphis-dark">敏感词库</span>
        <span class="font-sans text-xs text-ink-muted">按创建时间倒序 · 每页 {{ PAGE_SIZE }} 条</span>
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
              <th class="tbl-nowrap px-6 py-3 text-left font-sans text-sm font-semibold text-memphis-dark">词条</th>
              <th class="tbl-nowrap px-6 py-3 text-left font-sans text-sm font-semibold text-memphis-dark">等级</th>
              <th class="tbl-nowrap px-6 py-3 text-left font-sans text-sm font-semibold text-memphis-dark">创建时间</th>
              <th class="tbl-nowrap px-6 py-3 text-left font-sans text-sm font-semibold text-memphis-dark">操作</th>
            </tr>
          </thead>
          <tbody>
            <!-- 加载态：整行骨架条（design.md §5 UI 状态矩阵） -->
            <template v-if="loading">
              <tr v-for="i in 5" :key="`skeleton-${i}`" class="border-b border-ink-line">
                <td colspan="4" class="px-6 py-4">
                  <div class="h-4 w-full animate-pulse rounded-full bg-ink-line"></div>
                </td>
              </tr>
            </template>

            <!-- 空态：孟菲斯大眼睛 + 黄色胶囊提示 -->
            <template v-else-if="isEmpty">
              <tr>
                <td colspan="4" class="px-6 py-16">
                  <div class="flex flex-col items-center gap-3">
                    <span
                      class="flex h-16 w-16 items-center justify-center rounded-full border-2 border-memphis-dark bg-canvas"
                    >
                      <span class="material-symbols-outlined text-[28px] text-memphis-dark">hearing</span>
                    </span>
                    <span
                      class="rounded-full border-2 border-memphis-dark bg-warning px-3 py-0.5 font-sans text-[11px] font-bold text-memphis-dark"
                    >
                      暂无词条
                    </span>
                    <span class="font-sans text-xs text-ink-muted">
                      没有匹配的敏感词，点击右上角「新增词条」维护词库
                    </span>
                  </div>
                </td>
              </tr>
            </template>

            <template v-else>
              <tr v-for="row in list" :key="row._id" class="border-b border-ink-line transition-colors hover:bg-canvas">
                <td class="px-6 py-4">
                  <div class="flex items-center gap-3 whitespace-nowrap">
                    <span
                      class="flex h-8 w-8 items-center justify-center rounded-full border-2 border-memphis-dark bg-primary-light"
                    >
                      <span class="material-symbols-outlined text-[18px] text-memphis-dark">block</span>
                    </span>
                    <span class="font-mono text-sm font-bold text-memphis-dark">{{ row.word }}</span>
                  </div>
                </td>

                <td class="px-6 py-4">
                  <div class="flex items-center gap-2 whitespace-nowrap">
                    <span
                      class="inline-flex items-center gap-1 whitespace-nowrap rounded-full border-2 border-memphis-dark px-2.5 py-0.5 font-sans text-[11px] font-bold shadow-memphis-xs"
                      :class="levelOf(row.level).cls"
                    >
                      {{ row.level }}
                    </span>
                    <span class="font-sans text-[11px] text-ink-muted">{{ levelOf(row.level).desc }}</span>
                  </div>
                </td>

                <td class="tbl-nowrap px-6 py-4 font-sans text-sm text-ink-body">{{ formatTime(row.created_at) }}</td>

                <td class="px-6 py-4">
                  <div class="flex items-center gap-3">
                    <button
                      type="button"
                      class="m-pressable whitespace-nowrap rounded-xl border-2 border-memphis-dark bg-card px-3 py-1.5 font-sans text-xs font-bold text-memphis-dark shadow-memphis-xs"
                      @click="openEdit(row)"
                    >
                      改等级
                    </button>
                    <button
                      type="button"
                      :disabled="pendingId === row._id"
                      class="m-pressable whitespace-nowrap rounded-xl border-2 border-memphis-dark bg-danger-light px-3 py-1.5 font-sans text-xs font-bold text-danger shadow-memphis-xs disabled:opacity-50"
                      @click="removeWord(row)"
                    >
                      删除
                    </button>
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

    <!-- 新增 / 改等级弹窗 -->
    <el-dialog
      v-model="dialog.visible"
      :title="dialog.mode === 'add' ? '新增词条' : '调整词条等级'"
      width="480px"
      :close-on-click-modal="false"
      align-center
    >
      <div class="space-y-4 py-2">
        <label class="block">
          <span class="mb-2 block font-sans text-xs font-bold text-memphis-dark">词条</span>
          <input
            v-model="dialog.word"
            type="text"
            :maxlength="WORD_MAX"
            :disabled="dialog.mode === 'edit'"
            placeholder="输入需要拦截 / 送审的词或短语"
            class="w-full rounded-xl border-2 border-memphis-dark bg-canvas px-3 py-2 font-sans text-xs text-ink-body outline-none placeholder:text-ink-muted disabled:bg-ink-line/40 disabled:text-ink-muted"
          />
          <p v-if="dialog.mode === 'edit'" class="mt-1 font-sans text-[11px] text-ink-muted">
            词条本体不可改（word 唯一），如需改词请先删除再新增
          </p>
        </label>

        <label class="block">
          <span class="mb-2 block font-sans text-xs font-bold text-memphis-dark">等级</span>
          <div class="flex gap-3">
            <button
              v-for="lv in ['block', 'review']"
              :key="lv"
              type="button"
              class="flex-1 rounded-xl border-2 px-4 py-3 text-left font-sans transition-colors"
              :class="
                dialog.level === lv
                  ? 'border-memphis-dark bg-primary-light shadow-memphis-xs'
                  : 'border-ink-line bg-card'
              "
              @click="dialog.level = lv"
            >
              <div class="flex items-center justify-between">
                <span class="font-mono text-sm font-bold text-memphis-dark">{{ lv }}</span>
                <span
                  class="rounded-full border-2 border-memphis-dark px-2 py-0.5 text-[10px]"
                  :class="levelOf(lv).cls"
                  >{{ levelOf(lv).label }}</span
                >
              </div>
              <span class="mt-1 block font-sans text-[11px] text-ink-muted">{{ levelOf(lv).desc }}</span>
            </button>
          </div>
        </label>

        <p
          v-if="dialog.error"
          class="rounded-xl border-2 border-memphis-dark bg-danger/10 px-4 py-3 font-sans text-xs leading-relaxed text-danger"
        >
          {{ dialog.error }}
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
          :disabled="dialog.saving"
          class="m-pressable ml-3 rounded-xl border-2 border-memphis-dark bg-primary px-5 py-2 font-sans text-xs font-bold text-white shadow-memphis-sm disabled:opacity-50"
          @click="submitForm"
        >
          {{ dialog.saving ? '保存中…' : '保存' }}
        </button>
      </template>
    </el-dialog>
  </div>
</template>