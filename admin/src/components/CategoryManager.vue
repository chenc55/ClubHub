<script setup>
/**
 * 分类维护抽屉（P1-07 / ADM-02②）
 *
 * 接口：GET /club/category/list、POST /club/category/save、POST /club/category/delete、POST /club/category/sort
 * 规则：
 * - 分类名 2~10 字，库内唯一（软删记录仍占用唯一索引，新增时复用同名软删记录）；
 * - 排序为上移 / 下移（服务端按相邻交换把 sort 归一为 1..n）；
 * - 删除兜底：分类下仍有社团时禁止删除；至少保留一个分类（否则入驻表单无分类可选）。
 * 变更成功向父页发 changed，父页据此重载社团列表（分类名与数量会变）。
 */
import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { request } from '@/utils/request'

const props = defineProps({
  visible: { type: Boolean, default: false },
})
const emit = defineEmits(['update:visible', 'changed'])

const NAME_MIN = 2
const NAME_MAX = 10

const list = ref([])
const loading = ref(false)
const errorMessage = ref('')
const newName = ref('')
const creating = ref(false)
const pendingId = ref('')
const nameInput = ref(null)

const isEmpty = computed(() => !loading.value && !errorMessage.value && list.value.length === 0)

watch(
  () => props.visible,
  (open) => {
    if (open) {
      newName.value = ''
      load()
    }
  }
)

async function load() {
  loading.value = true
  errorMessage.value = ''
  const res = await request({ path: '/club/category/list', method: 'GET' })
  loading.value = false
  if (res.code !== 0 || !res.data) {
    errorMessage.value = res.message || '分类加载失败，请稍后重试'
    list.value = []
    return
  }
  list.value = res.data.list || []
}

/** 变更成功后统一刷新 + 通知父页 */
async function afterChange(message) {
  ElMessage.success(message)
  await load()
  emit('changed')
}

async function create() {
  const name = newName.value.trim()
  if (name.length < NAME_MIN) {
    ElMessage.warning(`分类名称至少 ${NAME_MIN} 个字`)
    return
  }
  creating.value = true
  const res = await request({ path: '/club/category/save', method: 'POST', data: { name } })
  creating.value = false
  if (res.code !== 0) {
    ElMessage.error(res.message || '新增失败，请稍后重试')
    return
  }
  newName.value = ''
  if (nameInput.value) nameInput.value.focus()
  await afterChange(`已新增分类「${name}」`)
}

async function rename(row) {
  let name = ''
  try {
    const input = await ElMessageBox.prompt('分类重命名后，已归属该分类的社团会同步展示新名称。', `重命名「${row.name}」`, {
      confirmButtonText: '保存',
      cancelButtonText: '取消',
      inputValue: row.name,
      inputValidator: (value) => {
        const text = String(value || '').trim()
        if (text.length < NAME_MIN) return `分类名称至少 ${NAME_MIN} 个字`
        if (text.length > NAME_MAX) return `分类名称最多 ${NAME_MAX} 个字`
        return true
      },
    })
    name = String(input.value || '').trim()
  } catch (e) {
    return
  }
  if (name === row.name) return

  pendingId.value = row._id
  const res = await request({ path: '/club/category/save', method: 'POST', data: { category_id: row._id, name } })
  pendingId.value = ''
  if (res.code !== 0) {
    ElMessage.error(res.message || '重命名失败，请稍后重试')
    return
  }
  await afterChange(`已重命名为「${name}」`)
}

async function move(row, direction) {
  pendingId.value = row._id
  const res = await request({ path: '/club/category/sort', method: 'POST', data: { category_id: row._id, direction } })
  pendingId.value = ''
  if (res.code !== 0) {
    ElMessage.error(res.message || '排序失败，请稍后重试')
    return
  }
  list.value = (res.data && res.data.list) || list.value
  emit('changed')
}

async function remove(row) {
  try {
    await ElMessageBox.confirm(
      `删除后该分类不再出现在入驻表单与筛选条件中（已归入该分类的社团不受影响，需先为它们调整分类才可删除）。`,
      `确认删除分类「${row.name}」？`,
      { confirmButtonText: '确认删除', cancelButtonText: '取消', type: 'warning' }
    )
  } catch (e) {
    return
  }
  pendingId.value = row._id
  const res = await request({ path: '/club/category/delete', method: 'POST', data: { category_id: row._id } })
  pendingId.value = ''
  if (res.code !== 0) {
    ElMessage.error(res.message || '删除失败，请稍后重试')
    return
  }
  await afterChange(`已删除分类「${row.name}」`)
}

function close() {
  emit('update:visible', false)
}
</script>

<template>
  <div v-if="visible" class="fixed inset-0 z-[60] flex justify-end">
    <div class="absolute inset-0 bg-memphis-dark/40" @click="close"></div>

    <aside class="relative flex h-full w-full max-w-[560px] flex-col border-l-2 border-memphis-dark bg-card">
      <!-- 头部 -->
      <div class="flex items-start justify-between gap-4 border-b-2 border-memphis-dark px-6 py-4">
        <div class="space-y-1">
          <h2 class="font-display text-xl font-bold text-memphis-dark">分类维护</h2>
          <p class="font-sans text-xs text-ink-muted">
            分类用于入驻申请、批量导入与社团筛选；排序值即学生端筛选条展示顺序。
          </p>
        </div>
        <button
          type="button"
          class="m-pressable flex h-8 w-8 items-center justify-center rounded-full border-2 border-memphis-dark bg-card shadow-memphis-xs"
          @click="close"
        >
          <span class="material-symbols-outlined text-[18px] text-memphis-dark">close</span>
        </button>
      </div>

      <div class="flex-1 space-y-5 overflow-y-auto px-6 py-5">
        <!-- 新增 -->
        <div class="m-card p-4">
          <span class="font-sans text-sm font-bold text-memphis-dark">新增分类</span>
          <div class="mt-3 flex items-center gap-3">
            <input
              ref="nameInput"
              v-model="newName"
              type="text"
              :maxlength="NAME_MAX"
              placeholder="例如：科技创新"
              class="min-w-0 flex-1 rounded-xl border-2 border-memphis-dark bg-canvas px-3 py-2 font-sans text-xs text-ink-body outline-none"
              @keyup.enter="create"
            />
            <button
              type="button"
              :disabled="creating"
              class="m-pressable whitespace-nowrap rounded-xl border-2 border-memphis-dark bg-primary px-4 py-2 font-sans text-xs font-bold text-white shadow-memphis-sm disabled:opacity-50"
              @click="create"
            >
              新增
            </button>
          </div>
          <span class="mt-2 block font-sans text-[11px] text-ink-muted">
            名称 {{ NAME_MIN }}~{{ NAME_MAX }} 个字，不可与现有分类重名。
          </span>
        </div>

        <!-- 兜底策略说明 -->
        <p class="rounded-xl border-2 border-memphis-dark bg-warning-light px-4 py-3 font-sans text-[11px] leading-relaxed text-ink-body">
          删除兜底：分类下仍有社团时不允许删除（保证已有社团数据完整）；且至少保留一个分类。
        </p>

        <p
          v-if="errorMessage"
          class="rounded-xl border-2 border-memphis-dark bg-danger/10 px-4 py-3 font-sans text-xs text-danger"
        >
          {{ errorMessage }}
        </p>

        <!-- 列表 -->
        <div class="m-card">
          <div class="flex items-center justify-between border-b-2 border-memphis-dark px-4 py-3">
            <span class="font-sans text-sm font-bold text-memphis-dark">分类列表</span>
            <span class="font-sans text-xs text-ink-muted">共 {{ list.length }} 个</span>
          </div>

          <div v-if="loading" class="space-y-3 p-4">
            <div v-for="i in 4" :key="`skeleton-${i}`" class="h-10 w-full animate-pulse rounded-xl bg-ink-line"></div>
          </div>

          <div v-else-if="isEmpty" class="flex flex-col items-center gap-2 px-4 py-12">
            <span class="material-symbols-outlined text-[28px] text-memphis-dark">sell</span>
            <span class="font-sans text-xs text-ink-muted">暂无分类，请先新增</span>
          </div>

          <ul v-else class="divide-y divide-ink-line">
            <li
              v-for="(row, index) in list"
              :key="row._id"
              class="flex items-center justify-between gap-3 px-4 py-3"
            >
              <div class="flex min-w-0 items-center gap-3">
                <span
                  class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-memphis-dark bg-canvas font-mono text-[11px] font-bold text-memphis-dark"
                >
                  {{ index + 1 }}
                </span>
                <div class="flex min-w-0 flex-col">
                  <span class="truncate font-sans text-sm font-bold text-memphis-dark">{{ row.name }}</span>
                  <span class="font-sans text-[11px]" :class="row.club_count > 0 ? 'text-ink-body' : 'text-ink-muted'">
                    {{ row.club_count > 0 ? `已有 ${row.club_count} 个社团` : '暂无社团使用' }}
                  </span>
                </div>
              </div>

              <div class="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  :disabled="index === 0 || pendingId === row._id"
                  title="上移"
                  class="m-pressable flex h-7 w-7 items-center justify-center rounded-full border-2 border-memphis-dark bg-card shadow-memphis-xs disabled:opacity-30"
                  @click="move(row, 'up')"
                >
                  <span class="material-symbols-outlined text-[16px] text-memphis-dark">arrow_upward</span>
                </button>
                <button
                  type="button"
                  :disabled="index === list.length - 1 || pendingId === row._id"
                  title="下移"
                  class="m-pressable flex h-7 w-7 items-center justify-center rounded-full border-2 border-memphis-dark bg-card shadow-memphis-xs disabled:opacity-30"
                  @click="move(row, 'down')"
                >
                  <span class="material-symbols-outlined text-[16px] text-memphis-dark">arrow_downward</span>
                </button>
                <button
                  type="button"
                  :disabled="pendingId === row._id"
                  class="m-pressable whitespace-nowrap rounded-xl border-2 border-memphis-dark bg-card px-3 py-1 font-sans text-xs font-bold text-memphis-dark shadow-memphis-xs disabled:opacity-50"
                  @click="rename(row)"
                >
                  重命名
                </button>
                <button
                  type="button"
                  :disabled="row.club_count > 0 || pendingId === row._id"
                  :title="row.club_count > 0 ? `该分类下仍有 ${row.club_count} 个社团，请先调整分类` : '删除分类'"
                  class="m-pressable whitespace-nowrap rounded-xl border-2 border-memphis-dark bg-card px-3 py-1 font-sans text-xs font-bold text-danger shadow-memphis-xs disabled:opacity-40"
                  @click="remove(row)"
                >
                  删除
                </button>
              </div>
            </li>
          </ul>
        </div>
      </div>

      <div class="flex items-center justify-between gap-3 border-t-2 border-memphis-dark bg-canvas px-6 py-4">
        <span class="font-sans text-[11px] text-ink-muted">分类变更对学生端入驻表单即时生效</span>
        <button
          type="button"
          class="m-pressable rounded-xl border-2 border-memphis-dark bg-card px-4 py-1.5 font-sans text-xs font-bold text-memphis-dark"
          @click="close"
        >
          完成
        </button>
      </div>
    </aside>
  </div>
</template>
