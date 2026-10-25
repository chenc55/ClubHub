/**
 * P1-01 本地验收（离线，无需部署）
 * 覆盖：白名单导入（追加/全量）/ 行级校验 / 库内重复与同批重复跳过 / 分块 / 上限拦截 /
 *       唯一索引冲突兜底 / 鉴权
 * 运行：node scripts/test-p1-01.js
 */
'use strict'
const path = require('path')

process.env.NODE_PATH = path.join(__dirname, '..', 'uniCloud-aliyun', 'cloudfunctions', 'common')
require('module').Module._initPaths()
process.env.CLUBHUB_JWT_SECRET = 'clubhub-test-secret'

const club = require('../uniCloud-aliyun/cloudfunctions/common/club-common')

let passed = 0
let failed = 0
function assert(name, cond, detail = '') {
  if (cond) {
    passed++
    console.log(`  ✔ ${name}`)
  } else {
    failed++
    console.log(`  ✘ FAIL ${name} ${detail}`)
  }
}

/* ---------- whitelist 集合 stub（含唯一索引语义） ---------- */
let rows = []
let seq = 0
// 竞态模拟开关：用于验证「预查重之后、批量写入之前」被并发插入的场景
let batchAddConflict = false
let perItemConflictNo = ''

function matchCond(row, cond) {
  return Object.keys(cond).every((key) => {
    const want = cond[key]
    if (want && want.__in) return want.__in.indexOf(row[key]) !== -1
    return row[key] === want
  })
}

const whitelistCollection = {
  where: (cond) => ({
    field: () => ({
      limit: () => ({ get: async () => ({ data: rows.filter((r) => matchCond(r, cond)) }) }),
    }),
    limit: () => ({ get: async () => ({ data: rows.filter((r) => matchCond(r, cond)) }) }),
    remove: async () => {
      const before = rows.length
      rows = rows.filter((r) => !matchCond(r, cond))
      return { deleted: before - rows.length }
    },
  }),
  add: async (doc) => {
    if (Array.isArray(doc) && batchAddConflict) throw new Error('duplicate key (concurrent insert)')
    const list = Array.isArray(doc) ? doc : [doc]
    const conflict = list.find(
      (d) => d.student_no === perItemConflictNo || rows.some((r) => r.student_no === d.student_no)
    )
    if (conflict) throw new Error(`duplicate key: ${conflict.student_no}`)
    if (new Set(list.map((d) => d.student_no)).size !== list.length) throw new Error('duplicate key in batch')
    list.forEach((d) => rows.push({ _id: `w-${++seq}`, ...d }))
    return { inserted: list.length }
  },
}

global.uniCloud = {
  database: () => ({
    collection: () => whitelistCollection,
    command: { in: (arr) => ({ __in: arr }) },
  }),
}

const adminFn = require('../uniCloud-aliyun/cloudfunctions/admin/index.js')
const adminToken = club.signToken({ type: 'admin', adminId: 'a-1', role: 'super' })
const studentToken = club.signToken({ type: 'student', token_kind: 'access', userId: 'u-1', openid: 'o-1' })

function makeEvent(body, token = adminToken) {
  const headers = { 'content-type': 'application/json' }
  if (token) headers.authorization = `Bearer ${token}`
  return {
    httpMethod: 'POST',
    path: '/whitelist/import',
    headers,
    body: JSON.stringify(body),
    queryStringParameters: {},
  }
}

async function importRows(body, token = adminToken) {
  const res = await adminFn.main(makeEvent(body, token))
  return { statusCode: res.statusCode, payload: JSON.parse(res.body) }
}

function row(rowNo, studentNo, name, college = '计算机学院', major = '软件工程') {
  return { row_no: rowNo, student_no: studentNo, name, college, major }
}

function resetRows() {
  rows = []
  seq = 0
}

;(async () => {
  console.log('P1-01 本地验收开始\n')

  /* ---------- 1. 鉴权 ---------- */
  console.log('【鉴权】')
  let r = await importRows({ mode: 'append', batch_no: 'b1', chunk_index: 0, rows: [row(2, '20260001', '林晨')] }, '')
  assert('未携带 token → 401', r.statusCode === 401, JSON.stringify(r.payload))
  r = await importRows({ mode: 'append', batch_no: 'b1', chunk_index: 0, rows: [row(2, '20260001', '林晨')] }, studentToken)
  assert('学生 token → 403 通道不匹配', r.statusCode === 403, JSON.stringify(r.payload))

  /* ---------- 2. 增量追加 ---------- */
  console.log('\n【增量追加 append】')
  resetRows()
  r = await importRows({
    mode: 'append',
    batch_no: 'import-20260921-01',
    chunk_index: 0,
    chunk_total: 1,
    rows: [row(2, '20260001', '林晨'), row(3, '20260117', '苏晚晴'), row(4, '20260452', '何子轩')],
  })
  assert('首块导入 3 行成功', r.payload.code === 0 && r.payload.data.success === 3, JSON.stringify(r.payload))
  assert('回执含 batch_no', r.payload.data.batch_no === 'import-20260921-01')
  assert('库内实际写入 3 条且带 batch_no', rows.length === 3 && rows.every((x) => x.batch_no === 'import-20260921-01'))
  assert('写入含 created_at', rows.every((x) => x.created_at instanceof Date))

  r = await importRows({
    mode: 'append',
    batch_no: 'import-20260921-02',
    chunk_index: 0,
    chunk_total: 1,
    rows: [row(2, '20260001', '林晨'), row(3, '20260999', '新同学')],
  })
  assert('库内已存在的学号 → 跳过并计入回执', r.payload.data.success === 1 && r.payload.data.skipped.length === 1 && r.payload.data.skipped[0].reason === '库内已存在', JSON.stringify(r.payload.data))
  assert('跳过行带 Excel 行号', r.payload.data.skipped[0].row_no === 2)
  assert('库内累计 4 条', rows.length === 4)

  /* ---------- 3. 行级校验 ---------- */
  console.log('\n【行级校验】')
  r = await importRows({
    mode: 'append',
    batch_no: 'import-20260921-03',
    chunk_index: 0,
    chunk_total: 1,
    rows: [row(2, '', '无学号'), row(3, 'abc', '学号过短'), row(4, '20260888', ''), row(5, '20260889', '正常同学')],
  })
  assert('空学号 / 学号格式 / 空姓名 计入 failed', r.payload.data.failed.length === 3, JSON.stringify(r.payload.data.failed))
  assert('failed 带行号与原因', r.payload.data.failed[0].row_no === 2 && r.payload.data.failed[0].reason.includes('学号'), JSON.stringify(r.payload.data.failed[0]))
  assert('合法行仍成功写入', r.payload.data.success === 1)

  /* ---------- 4. 同块内重复 ---------- */
  console.log('\n【同批重复】')
  r = await importRows({
    mode: 'append',
    batch_no: 'import-20260921-04',
    chunk_index: 0,
    chunk_total: 1,
    rows: [row(2, '20260777', '甲同学'), row(3, '20260777', '甲同学重复行')],
  })
  assert('同块重复 → 仅首行写入、次行跳过', r.payload.data.success === 1 && r.payload.data.skipped.length === 1 && r.payload.data.skipped[0].reason === '同批重复', JSON.stringify(r.payload.data))

  /* ---------- 5. 全量更新 ---------- */
  console.log('\n【全量更新 full】')
  resetRows()
  await importRows({
    mode: 'append',
    batch_no: 'old-batch',
    chunk_index: 0,
    chunk_total: 1,
    rows: [row(2, '20260001', '林晨'), row(3, '20260002', '旧数据同学')],
  })
  const before = rows.length
  r = await importRows({
    mode: 'full',
    batch_no: 'full-batch',
    chunk_index: 0,
    chunk_total: 1,
    reset: true,
    rows: [row(2, '20260001', '林晨'), row(3, '20260003', '全量同学')],
  })
  assert('全量首块先清空再写入', r.payload.data.success === 2 && r.payload.data.skipped.length === 0, JSON.stringify(r.payload.data))
  assert('清空后库内仅剩新批次数据', rows.length === 2 && rows.every((x) => x.batch_no === 'full-batch'), JSON.stringify(rows.map((x) => x.student_no)))
  assert('旧数据已被替换（清空前有 ' + before + ' 条）', !rows.some((x) => x.student_no === '20260002'))

  await importRows({
    mode: 'full',
    batch_no: 'full-batch-2',
    chunk_index: 1,
    rows: [row(2, '20260004', '第二块同学')],
  })
  assert('全量非首块不清空（chunk_index>0 且无 reset）', rows.length === 3, String(rows.length))

  /* ---------- 6. 分块与上限 ---------- */
  console.log('\n【分块与上限】')
  r = await importRows({ mode: 'append', batch_no: 'b', chunk_index: 0, rows: [] })
  assert('空块 → 1001', r.payload.code === 1001, JSON.stringify(r.payload))

  const bigChunk = Array.from({ length: 1001 }, (_, i) => row(i + 2, `202610${String(i).padStart(4, '0')}`, '同学'))
  r = await importRows({ mode: 'append', batch_no: 'b', chunk_index: 0, rows: bigChunk })
  assert('单块 >1000 行 → 1001', r.payload.code === 1001 && r.payload.message.includes('1000'), JSON.stringify(r.payload))

  r = await importRows({ mode: 'append', batch_no: 'b', chunk_index: 0, chunk_total: 21, rows: [row(2, '20261234', '同学')] })
  assert('总块数超 20000 行上限 → 1001 且提示拆分', r.payload.code === 1001 && r.payload.message.includes('20000'), JSON.stringify(r.payload))

  r = await importRows({ mode: 'bogus', batch_no: 'b', chunk_index: 0, rows: [row(2, '20261235', '同学')] })
  assert('mode 非法 → 1001', r.payload.code === 1001, JSON.stringify(r.payload))

  r = await importRows({ mode: 'append', batch_no: 'b', chunk_index: -1, rows: [row(2, '20261236', '同学')] })
  assert('chunk_index 负数 → 1001', r.payload.code === 1001, JSON.stringify(r.payload))

  /* ---------- 7. 唯一索引冲突兜底 ---------- */
  console.log('\n【唯一索引冲突兜底】')
  resetRows()
  // 模拟：预查重通过后、批量写入前，被并发插入了 20260001
  batchAddConflict = true
  perItemConflictNo = '20260001'
  r = await importRows({
    mode: 'append',
    batch_no: 'b-race',
    chunk_index: 0,
    rows: [row(2, '20260001', '林晨'), row(3, '20260050', '正常同学')],
  })
  batchAddConflict = false
  perItemConflictNo = ''
  assert(
    '批量写入冲突时降级逐条写入，冲突行记入回执',
    r.payload.data.success === 1 && r.payload.data.skipped.some((s) => s.reason.includes('写入冲突')),
    JSON.stringify(r.payload.data)
  )
  assert('非冲突行仍成功落库', rows.some((x) => x.student_no === '20260050'), JSON.stringify(rows.map((x) => x.student_no)))

  console.log(`\nP1-01 本地验收：${passed} 通过 / ${failed} 失败`)
  process.exit(failed > 0 ? 1 : 0)
})().catch((e) => {
  console.error('测试执行异常：', e)
  process.exit(1)
})
