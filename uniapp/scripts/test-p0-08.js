/**
 * P0-08 本地验收（离线，无需部署）
 * 覆盖：纯匹配（block/review/未命中）/ 过滤范围（标题+正文+自定义表单文案）/
 *       分级决策三分支（先审后发 / 先发后审）/ 词库缓存与即时生效 / 词库故障降级
 * 运行：node scripts/test-p0-08.js
 */
'use strict'
const path = require('path')

const filter = require('../uniCloud-aliyun/cloudfunctions/common/sensitive-filter/index.js')

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

/* ---------- 词库 stub（模拟 sensitive_words 集合） ---------- */
let table = [
  { word: '代考', level: 'block' },
  { word: '兼职刷单', level: 'block' },
  { word: '外挂脚本', level: 'review' },
]
let dbShouldFail = false

function makeQuery() {
  const query = {
    where: () => query,
    limit: () => query,
    get: async () => {
      if (dbShouldFail) throw new Error('db down')
      return { data: table.slice() }
    },
  }
  return query
}

global.uniCloud = {
  database: () => ({ collection: () => makeQuery() }),
}

;(async () => {
  console.log('P0-08 本地验收开始\n')

  /* ---------- 1. 纯匹配 ---------- */
  console.log('【纯匹配 matchWords】')
  const words = table.map((w) => ({ word: w.word, level: w.level }))
  assert('命中文 block 词', filter.matchWords('便宜出代考服务', words)[0].level === 'block')
  assert('命中文 review 词', filter.matchWords('用了外挂脚本', words)[0].level === 'review')
  assert('未命中返回空数组', filter.matchWords('正常的社团活动通知', words).length === 0)
  assert('空文本返回空数组', filter.matchWords('', words).length === 0)
  assert('大小写归一后命中（词库英文词）', filter.matchWords('这里有 SPAM 内容', [{ word: 'spam', level: 'block' }]).length === 1)
  assert('同一词条只报一次', filter.matchWords('代考代考代考', words).filter((h) => h.word === '代考').length === 1)

  /* ---------- 2. 过滤范围 ---------- */
  console.log('\n【过滤范围（2.5：标题 + 正文 + 自定义报名表字段文案）】')
  assert('collectTexts 收集标题/正文/extras', filter.collectTexts({ title: 'a', body: 'b', extras: ['c', '', null] }).join('|') === 'a|b|c')

  let r = await filter.checkContent({ title: '招新公告', body: '欢迎报名', extras: ['请勿提供代考服务'] })
  assert('自定义表单字段文案纳入过滤 → 命中 block', r.level === 'block' && r.hits[0].word === '代考', JSON.stringify(r))

  r = await filter.checkContent({ title: '外挂脚本使用指南', body: '' })
  assert('标题命中 review', r.level === 'review', JSON.stringify(r))

  r = await filter.checkContent({ title: '社团招新', body: '本周五下午三点在体育馆', extras: ['姓名', '学号'] })
  assert('未命中 → level=null', r.level === null && r.hits.length === 0, JSON.stringify(r))

  /* ---------- 3. 分级决策三分支 ---------- */
  console.log('\n【分级决策 decideByMode】')
  const PRE = filter.PUBLISH_MODES.PRE_REVIEW
  const POST = filter.PUBLISH_MODES.POST_REVIEW

  let d = filter.decideByMode(PRE, { level: 'block', hits: [{ word: '代考', level: 'block' }] })
  assert('先审后发 + block → 拦截提交', d.allowed === false && d.flagged === false, JSON.stringify(d))

  d = filter.decideByMode(PRE, { level: 'review', hits: [{ word: '外挂脚本', level: 'review' }] })
  assert('先审后发 + review → 拦截提交', d.allowed === false, JSON.stringify(d))

  d = filter.decideByMode(PRE, { level: null, hits: [] })
  assert('先审后发 + 未命中 → 放行', d.allowed === true && d.flagged === false, JSON.stringify(d))

  d = filter.decideByMode(POST, { level: 'block', hits: [{ word: '代考', level: 'block' }] })
  assert('先发后审 + block → 拦截发布', d.allowed === false, JSON.stringify(d))

  d = filter.decideByMode(POST, { level: 'review', hits: [{ word: '外挂脚本', level: 'review' }] })
  assert('先发后审 + review → 放行且标记疑似（不阻断）', d.allowed === true && d.flagged === true, JSON.stringify(d))

  d = filter.decideByMode(POST, { level: null, hits: [] })
  assert('先发后审 + 未命中 → 放行不标记', d.allowed === true && d.flagged === false, JSON.stringify(d))

  /* ---------- 4. 缓存与词库即时生效 ---------- */
  console.log('\n【词库缓存与即时生效】')
  r = await filter.checkContent({ title: '正常内容' })
  assert('缓存已加载词库（words=3）', r.words === 3, JSON.stringify(r))

  table = table.concat([{ word: '校园贷款', level: 'block' }])
  r = await filter.checkContent({ title: '关于校园贷款的说明' })
  assert('缓存期内不感知新增词条（level=null）', r.level === null, JSON.stringify(r))

  await filter.refreshSensitiveWords()
  r = await filter.checkContent({ title: '关于校园贷款的说明' })
  assert('refresh 后新增词条即时生效 → 命中 block', r.level === 'block' && r.hits[0].word === '校园贷款', JSON.stringify(r))

  table = table.concat([{ word: '文凭代办', level: 'review' }])
  r = await filter.checkContent({ title: '文凭代办服务' }, { force: true })
  assert('force 选项跳过缓存即时生效 → 命中 review', r.level === 'review', JSON.stringify(r))

  /* ---------- 5. 词库故障降级 ---------- */
  console.log('\n【词库故障降级】')
  filter.clearCache()
  dbShouldFail = true
  r = await filter.checkContent({ title: '社团招新' })
  assert('词库不可用且无缓存 → 不阻断业务（level=null）', r.level === null && r.words === 0, JSON.stringify(r))

  dbShouldFail = false
  await filter.refreshSensitiveWords()
  dbShouldFail = true
  r = await filter.checkContent({ title: '代考', }, { force: true })
  assert('词库不可用但有旧缓存 → 沿用旧词库并命中', r.level === 'block', JSON.stringify(r))

  console.log(`\nP0-08 本地验收：${passed} 通过 / ${failed} 失败`)
  process.exit(failed > 0 ? 1 : 0)
})().catch((e) => {
  console.error('测试执行异常：', e)
  process.exit(1)
})
