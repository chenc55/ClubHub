<script setup>
/**
 * 白名单导入组件（P1-01 / ADM-01①）
 *
 * 为什么在浏览器解析 Excel：URL 化网关不透传 multipart 且 JSON 请求体上限约 1.43MB，
 * xlsx 二进制无法送入云函数；因此由本组件用 SheetJS 解析 → 行级校验 → 按 1000 行/块提交，
 * 服务端再逐行复校（不信任客户端结果）并跳过库内重复。
 *
 * 规格（需求 4.3.1 / ADM-01）：.xlsx、模板下载、单批 ≤20,000 行；
 * 文件内重复与库内重复均「跳过并记入回执」；全量更新只影响后续认证比对，不追溯解绑已认证账号。
 */
import { computed, reactive, ref } from 'vue'
import * as XLSX from 'xlsx'
import { request } from '@/utils/request'

const MAX_ROWS = 20000
const CHUNK_SIZE = 1000
const REQUIRED_COLUMNS = ['学号', '姓名']
const COLUMN_MAP = { 学号: 'student_no', 姓名: 'name', 学院: 'college', 专业: 'major' }
const STUDENT_NO_RE = /^[0-9A-Za-z]{4,20}$/

const fileInput = ref(null)
const fileName = ref('')
const mode = ref('append')
const parsing = ref(false)
const importing = ref(false)
const progress = reactive({ done: 0, total: 0 })
const errorMessage = ref('')

/** 解析结果：有效去重后的行 + 本地校验回执 */
const parsed = reactive({ total: 0, valid: [], skipped: [], failed: [] })
/** 导入回执（含服务端返回部分） */
const receipt = ref(null)

const canImport = computed(() => !importing.value && !parsing.value && parsed.valid.length > 0)

function resetParsed() {
  parsed.total = 0
  parsed.valid = []
  parsed.skipped = []
  parsed.failed = []
  receipt.value = null
  errorMessage.value = ''
  progress.done = 0
  progress.total = 0
}

/** 下载导入模板 */
function downloadTemplate() {
  const sheet = XLSX.utils.aoa_to_sheet([
    ['学号', '姓名', '学院', '专业'],
    ['20260001', '示例·请删除本行', '计算机学院', '软件工程'],
  ])
  sheet['!cols'] = [{ wch: 14 }, { wch: 12 }, { wch: 18 }, { wch: 18 }]
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, '花名册')
  XLSX.writeFile(book, '社团星球-花名册导入模板.xlsx')
}

function readFileAsWorkbook(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        resolve(XLSX.read(new Uint8Array(event.target.result), { type: 'array' }))
      } catch (e) {
        reject(new Error('文件解析失败，请确认是有效的 .xlsx 文件'))
      }
    }
    reader.onerror = () => reject(new Error('文件读取失败，请重试'))
    reader.readAsArrayBuffer(file)
  })
}

/** 表头 → 列下标映射；缺列直接拦截 */
function buildColumnIndex(headerRow) {
  const index = {}
  headerRow.forEach((cell, i) => {
    const key = String(cell == null ? '' : cell).trim()
    if (COLUMN_MAP[key]) index[COLUMN_MAP[key]] = i
  })
  const missing = REQUIRED_COLUMNS.filter((label) => {
    const field = COLUMN_MAP[label]
    return index[field] === undefined
  })
  if (missing.length) {
    throw new Error(`表格缺少必需列：${missing.join('、')}（请使用模板下载的格式）`)
  }
  return index
}

async function onFileChange(event) {
  const file = event.target.files && event.target.files[0]
  if (!file) return
  resetParsed()
  fileName.value = file.name
  parsing.value = true
  try {
    if (!/\.xlsx?$/i.test(file.name)) throw new Error('仅支持 .xlsx / .xls 文件')
    const book = await readFileAsWorkbook(file)
    const sheet = book.Sheets[book.SheetNames[0]]
    if (!sheet) throw new Error('未找到工作表')
    const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: '' })
    if (!matrix.length) throw new Error('表格内容为空')
    const columns = buildColumnIndex(matrix[0])

    const dataRows = matrix.slice(1)
    parsed.total = dataRows.length
    if (dataRows.length > MAX_ROWS) {
      throw new Error(`单批最多 ${MAX_ROWS} 行（本次 ${dataRows.length} 行），请拆分文件后分批导入`)
    }

    const seen = new Set()
    dataRows.forEach((cells, i) => {
      const rowNo = i + 2 // Excel 行号（含表头）
      const pick = (field) => String((columns[field] === undefined ? '' : cells[columns[field]]) || '').trim()
      const studentNo = pick('student_no')
      const name = pick('name')
      const college = pick('college')
      const major = pick('major')

      if (!studentNo) {
        parsed.failed.push({ row_no: rowNo, reason: '学号为空' })
        return
      }
      if (!STUDENT_NO_RE.test(studentNo)) {
        parsed.failed.push({ row_no: rowNo, reason: `学号格式不合法（${studentNo}）` })
        return
      }
      if (!name) {
        parsed.failed.push({ row_no: rowNo, reason: '姓名为空' })
        return
      }
      if (seen.has(studentNo)) {
        parsed.skipped.push({ row_no: rowNo, student_no: studentNo, reason: '文件内重复' })
        return
      }
      seen.add(studentNo)
      parsed.valid.push({ row_no: rowNo, student_no: studentNo, name, college, major })
    })

    if (!parsed.valid.length) {
      errorMessage.value = '没有可导入的有效行，请检查文件内容'
    }
  } catch (e) {
    errorMessage.value = (e && e.message) || '文件校验失败'
    fileName.value = ''
    if (fileInput.value) fileInput.value.value = ''
  } finally {
    parsing.value = false
  }
}

function makeBatchNo() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `WH-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

async function startImport() {
  if (!canImport.value) return
  errorMessage.value = ''
  importing.value = true
  const batchNo = makeBatchNo()
  const chunks = []
  for (let i = 0; i < parsed.valid.length; i += CHUNK_SIZE) {
    chunks.push(parsed.valid.slice(i, i + CHUNK_SIZE))
  }
  progress.total = chunks.length
  progress.done = 0

  const result = {
    batch_no: batchNo,
    mode: mode.value,
    success: 0,
    skipped: parsed.skipped.slice(),
    failed: parsed.failed.slice(),
    aborted: '',
  }

  for (let i = 0; i < chunks.length; i += 1) {
    const res = await request({
      path: '/admin/whitelist/import',
      method: 'POST',
      data: {
        mode: mode.value,
        batch_no: batchNo,
        chunk_index: i,
        chunk_total: chunks.length,
        // 全量更新：仅首块清空现有花名册
        reset: mode.value === 'full' && i === 0,
        rows: chunks[i],
      },
    })
    if (res.code !== 0 || !res.data) {
      result.aborted = `第 ${i + 1}/${chunks.length} 块失败：${res.message || '未知错误'}`
      break
    }
    result.success += res.data.success
    if (res.data.skipped) result.skipped.push(...res.data.skipped)
    if (res.data.failed) result.failed.push(...res.data.failed)
    progress.done = i + 1
  }

  importing.value = false
  receipt.value = result
}
</script>

<template>
  <div class="space-y-6">
    <!-- 上传与模式 -->
    <div class="m-card p-6">
      <div class="flex items-center justify-between gap-4">
        <div class="flex flex-col">
          <span class="font-display text-base font-bold text-memphis-dark">花名册导入</span>
          <span class="mt-1 font-sans text-xs text-ink-muted">
            .xlsx 格式｜单批 ≤{{ MAX_ROWS.toLocaleString() }} 行｜学号 + 姓名必填
          </span>
        </div>
        <button
          type="button"
          class="m-pressable shrink-0 rounded-xl border-2 border-memphis-dark bg-card px-4 py-2 font-sans text-xs font-bold text-memphis-dark"
          @click="downloadTemplate"
        >
          下载模板
        </button>
      </div>

      <div class="mt-5 grid grid-cols-2 gap-5">
        <label class="block">
          <span class="font-sans text-xs font-bold text-memphis-dark">1. 选择文件</span>
          <input
            ref="fileInput"
            type="file"
            accept=".xlsx,.xls"
            class="mt-2 w-full rounded-xl border-2 border-memphis-dark bg-canvas px-3 py-2 font-sans text-xs text-ink-body outline-none file:mr-3 file:rounded-lg file:border-2 file:border-memphis-dark file:bg-primary file:px-3 file:py-1 file:font-sans file:text-xs file:font-bold file:text-white"
            @change="onFileChange"
          />
          <span v-if="fileName" class="mt-2 block font-sans text-[11px] text-ink-muted">
            已选：{{ fileName }}（共 {{ parsed.total }} 行）
          </span>
        </label>

        <div>
          <span class="font-sans text-xs font-bold text-memphis-dark">2. 导入模式</span>
          <div class="mt-2 flex gap-3">
            <label
              class="flex flex-1 cursor-pointer items-center gap-2 rounded-xl border-2 border-memphis-dark px-3 py-2"
              :class="mode === 'append' ? 'bg-primary-light' : 'bg-canvas'"
            >
              <input v-model="mode" type="radio" value="append" class="accent-primary" />
              <span class="font-sans text-xs text-ink-body">增量追加（已存在的跳过）</span>
            </label>
            <label
              class="flex flex-1 cursor-pointer items-center gap-2 rounded-xl border-2 border-memphis-dark px-3 py-2"
              :class="mode === 'full' ? 'bg-warning-light' : 'bg-canvas'"
            >
              <input v-model="mode" type="radio" value="full" class="accent-primary" />
              <span class="font-sans text-xs text-ink-body">全量更新（先清空花名册）</span>
            </label>
          </div>
          <p v-if="mode === 'full'" class="mt-2 font-sans text-[11px] leading-relaxed text-ink-muted">
            全量更新会清空现有花名册后重新写入；仅影响后续认证比对，不会解绑已认证学生。
          </p>
        </div>
      </div>

      <!-- 本地校验摘要 -->
      <div v-if="parsed.total || errorMessage" class="mt-5 flex flex-wrap items-center gap-3">
        <span class="rounded-full border-2 border-memphis-dark bg-card px-3 py-1 font-sans text-xs text-ink-body">
          待导入 {{ parsed.valid.length }} 行
        </span>
        <span class="rounded-full border-2 border-memphis-dark bg-warning-light px-3 py-1 font-sans text-xs text-ink-body">
          跳过 {{ parsed.skipped.length }} 行
        </span>
        <span class="rounded-full border-2 border-memphis-dark bg-danger/10 px-3 py-1 font-sans text-xs text-danger">
          失败 {{ parsed.failed.length }} 行
        </span>
      </div>

      <p
        v-if="errorMessage"
        class="mt-4 rounded-xl border-2 border-memphis-dark bg-danger/10 px-4 py-3 font-sans text-xs leading-relaxed text-danger"
      >
        {{ errorMessage }}
      </p>

      <div class="mt-5 flex items-center gap-4">
        <button
          type="button"
          :disabled="!canImport"
          class="m-pressable rounded-xl border-2 border-memphis-dark bg-primary px-5 py-2.5 font-sans text-xs font-bold text-white shadow-memphis-sm disabled:opacity-50"
          @click="startImport"
        >
          {{ importing ? '导入中…' : '3. 开始导入' }}
        </button>
        <span v-if="importing" class="font-sans text-xs text-ink-muted">
          正在提交第 {{ progress.done + 1 }} / {{ progress.total }} 块…
        </span>
        <span v-else-if="parsing" class="font-sans text-xs text-ink-muted">正在解析文件…</span>
      </div>
    </div>

    <!-- 校验回执 -->
    <div v-if="receipt" class="m-card p-6">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <span class="font-display text-base font-bold text-memphis-dark">导入回执</span>
        <span class="rounded-full border-2 border-memphis-dark bg-canvas px-3 py-1 font-mono text-[11px] text-ink-muted">
          批次 {{ receipt.batch_no }}｜{{ receipt.mode === 'full' ? '全量更新' : '增量追加' }}
        </span>
      </div>

      <div class="mt-4 flex flex-wrap gap-3">
        <span class="rounded-full border-2 border-memphis-dark bg-memphis-green/30 px-3 py-1 font-sans text-xs text-ink-body">
          成功 {{ receipt.success }} 行
        </span>
        <span class="rounded-full border-2 border-memphis-dark bg-warning-light px-3 py-1 font-sans text-xs text-ink-body">
          跳过 {{ receipt.skipped.length }} 行
        </span>
        <span class="rounded-full border-2 border-memphis-dark bg-danger/10 px-3 py-1 font-sans text-xs text-danger">
          失败 {{ receipt.failed.length }} 行
        </span>
      </div>

      <p
        v-if="receipt.aborted"
        class="mt-4 rounded-xl border-2 border-memphis-dark bg-danger/10 px-4 py-3 font-sans text-xs leading-relaxed text-danger"
      >
        {{ receipt.aborted }}（已成功的部分不受影响，可修正后重新导入）
      </p>

      <div v-if="receipt.skipped.length || receipt.failed.length" class="tbl-scroll mt-4 max-h-80 overflow-auto">
        <table class="w-full tbl-nowrap text-left font-sans text-xs">
          <thead class="bg-canvas">
            <tr class="border-b-2 border-memphis-dark">
              <th class="px-3 py-2 font-bold text-memphis-dark">Excel 行号</th>
              <th class="px-3 py-2 font-bold text-memphis-dark">学号</th>
              <th class="px-3 py-2 font-bold text-memphis-dark">类型</th>
              <th class="px-3 py-2 font-bold text-memphis-dark">原因</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(item, i) in receipt.skipped" :key="`s-${i}`" class="border-b border-ink-muted/20">
              <td class="px-3 py-1.5 text-ink-muted">{{ item.row_no || '—' }}</td>
              <td class="px-3 py-1.5 font-mono text-ink-title">{{ item.student_no || '—' }}</td>
              <td class="px-3 py-1.5 text-ink-muted">跳过</td>
              <td class="px-3 py-1.5 text-ink-body">{{ item.reason }}</td>
            </tr>
            <tr v-for="(item, i) in receipt.failed" :key="`f-${i}`" class="border-b border-ink-muted/20">
              <td class="px-3 py-1.5 text-ink-muted">{{ item.row_no || '—' }}</td>
              <td class="px-3 py-1.5 font-mono text-ink-title">{{ item.student_no || '—' }}</td>
              <td class="px-3 py-1.5 text-danger">失败</td>
              <td class="px-3 py-1.5 text-ink-body">{{ item.reason }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else class="mt-4 font-sans text-xs text-ink-muted">全部行均导入成功，无跳过或失败记录。</p>
    </div>
  </div>
</template>
