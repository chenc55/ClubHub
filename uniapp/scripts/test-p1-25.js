/**
 * P1-25 本地验收（离线，无需部署）
 * 覆盖：敏感词库管理域 GET /sensitive_words/list、POST /save、POST /delete
 *       鉴权（无 token 401 / 学生通道 403 / viewer 角色 403）、空库、
 *       新增（created）/ 同词改等级（level 更新）/ 软删词复活、分页与 has_more、
 *       关键词精确子串匹配 + 正则元字符转义、删除与幂等、行为校验后词库集合状态
 * 运行：node scripts/test-p1-25.js
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

/* ---------- 集合 stub（含 aggregate） ---------- */
let seq = 0
const stores = { admins: require('./helpers/admin-fixtures').createAdminFixtures(), sensitive_words: [] }

function matchCond(row, cond) {
  if (cond && cond.__and) return cond.__and.every((item) => matchCond(row, item))
  if (cond && cond.__or) return cond.__or.some((item) => matchCond(row, item))
  return Object.keys(cond).every((key) => {
    const want = cond[key]
    if (want instanceof RegExp) return want.test(String(row[key] == null ? '' : row[key]))
    if (want && typeof want === 'object') {
      if (Object.prototype.hasOwnProperty.call(want, '__in')) return want.__in.indexOf(row[key]) !== -1
      if (Object.prototype.hasOwnProperty.call(want, '__neq')) return row[key] !== want.__neq
      if (Object.prototype.hasOwnProperty.call(want, '__gte')) return new Date(row[key]).getTime() >= new Date(want.__gte).getTime()
      if (Object.prototype.hasOwnProperty.call(want, '__lte')) return new Date(row[key]).getTime() <= new Date(want.__lte).getTime()
      if (Object.prototype.hasOwnProperty.call(want, '__lt')) return new Date(row[key]).getTime() < new Date(want.__lt).getTime()
      if (Object.prototype.hasOwnProperty.call(want, '__gt')) return new Date(row[key]).getTime() > new Date(want.__gt).getTime()
    }
    return row[key] === want
  })
}

function makeQuery(rows) {
  let result = rows
  const query = {
    where: (cond) => {
      result = result.filter((row) => matchCond(row, cond))
      return query
    },
    field: () => query,
    orderBy: (field, dir) => {
      result = result.slice().sort((a, b) => {
        const av = a[field]
        const bv = b[field]
        if (typeof av === 'number' && typeof bv === 'number') return dir === 'desc' ? bv - av : av - bv
        const at = new Date(av).getTime()
        const bt = new Date(bv).getTime()
        return dir === 'desc' ? bt - at : at - bt
      })
      return query
    },
    skip: (n) => {
      result = result.slice(n)
      return query
    },
    limit: (n) => {
      result = result.slice(0, n)
      return query
    },
    get: async () => ({ data: result.slice() }),
    count: async () => ({ total: result.length }),
    update: async (patch) => {
      result.forEach((row) => Object.assign(row, patch))
      return { updated: result.length }
    },
  }
  return query
}

function collectionFor(name) {
  const rowsOf = () => stores[name] || []
  return {
    where: (cond) => makeQuery(rowsOf().filter((row) => matchCond(row, cond))),
    add: async (doc) => {
      const list = Array.isArray(doc) ? doc : [doc]
      let lastId = ''
      list.forEach((item) => {
        lastId = `${name}-${++seq}`
        stores[name].push({ _id: lastId, ...item })
      })
      return { id: lastId, inserted: list.length }
    },
    doc: (id) => ({
      update: async (patch) => {
        const row = rowsOf().find((item) => item._id === id)
        if (!row) return { updated: 0 }
        Object.assign(row, patch)
        return { updated: 1 }
      },
    }),
  }
}

global.uniCloud = {
  database: () => ({
    collection: collectionFor,
    command: {
      and: (list) => ({ __and: list }),
      or: (list) => ({ __or: list }),
      in: (list) => ({ __in: list }),
      neq: (value) => ({ __neq: value }),
      gte: (value) => ({ __gte: value }),
      lte: (value) => ({ __lte: value }),
      lt: (value) => ({ __lt: value }),
      gt: (value) => ({ __gt: value }),
      aggregate: { sum: (value) => ({ __sum: value }) },
    },
  }),
  httpclient: { request: async () => ({ data: { access_token: 'T', expires_in: 7200 } }) },
}

/* ---------- 种子数据 ---------- */
const DAY = 24 * 3600 * 1000
const now = Date.now()
const at = (ms) => new Date(ms)

function seedWord(id, word, level, offsetDay, deleted = 0) {
  stores.sensitive_words.push({ _id: id, word, level, created_at: at(now - offsetDay * DAY), updated_at: at(now - offsetDay * DAY), deleted })
}
seedWord('w-1', '代考', 'block', 10)
seedWord('w-2', '烟花', 'review', 5)
seedWord('w-3', 'axb', 'review', 3)

const fn = require('../uniCloud-aliyun/cloudfunctions/sensitive_words/index.js')

function adminToken(role) {
  return club.signToken({ type: club.TOKEN_TYPES.ADMIN, adminId: { super: 'a-1', auditor: 'a-2', viewer: 'a-3' }[role], username: 'root', role, name: '超管' })
}
const studentToken = club.signToken({
  type: club.TOKEN_TYPES.STUDENT,
  token_kind: 'access',
  userId: 'u-1',
  openid: 'openid-1',
  auth_status: 'verified',
})

async function call({ method = 'GET', path = '/list', qs = {}, body = null, token = null }) {
  const headers = { 'content-type': 'application/json' }
  if (token) headers.authorization = `Bearer ${token}`
  const res = await fn.main({
    httpMethod: method,
    path,
    headers,
    body: body ? JSON.stringify(body) : '',
    queryStringParameters: qs,
  })
  const payload = JSON.parse(res.body)
  // 顶层直接透出 payload.code/data/message，便于断言；payload 保留原始结构
  return { statusCode: res.statusCode, payload, code: payload.code, data: payload.data, message: payload.message }
}

function listWords(role = 'super', qs = {}) {
  return call({ qs, token: adminToken(role) }).then((r) => r.payload)
}

async function main() {
  console.log('\n【GET /sensitive_words/list · 鉴权】')
  let r = await call({})
  assert('无 token → 401', r.payload.code === 401, JSON.stringify(r.payload))

  r = await call({ token: studentToken })
  assert('学生 token → 403（通道不匹配）', r.payload.code === 403, JSON.stringify(r.payload))

  r = await call({ token: adminToken('viewer') })
  assert('viewer 角色 → 403（角色无权）', r.payload.code === 403, JSON.stringify(r.payload))

  console.log('\n【GET /sensitive_words/list · 列表 / 分页 / 关键词】')
  r = await listWords()
  assert('种子 3 条全量返回（deleted:0）', r.code === 0 && r.data.total === 3 && r.data.list.length === 3 && !r.data.has_more, JSON.stringify(r.data))

  r = await listWords('super', { page_size: '1' })
  assert('page_size=1 → has_more=true，第一页 1 条', r.data.list.length === 1 && r.data.has_more === true, JSON.stringify(r.data))
  r = await listWords('super', { page_size: '1', page: '4' })
  assert('超界页 → 空列表 has_more=false', r.data.list.length === 0 && r.data.has_more === false, JSON.stringify(r.data))
  r = await listWords('super', { page_size: '0' })
  assert('page_size=0 → 1001', r.code === 1001, JSON.stringify(r))

  r = await listWords('super', { keyword: '考' })
  assert('关键词子串匹配命中「代考」', r.data.total === 1 && r.data.list[0].word === '代考', JSON.stringify(r.data))
  r = await listWords('super', { keyword: 'zzz' })
  assert('关键词无命中 → 空列表', r.data.total === 0 && r.data.list.length === 0, JSON.stringify(r.data))

  console.log('\n【POST /sensitive_words/save · 新增 / 改等级 / 校验】')
  r = await call({ method: 'POST', path: '/save', body: { word: '代购', level: 'block' }, token: adminToken('super') })
  assert('新增词条 → created=true', r.code === 0 && r.data.created === true && r.data.word.word === '代购' && r.data.word.level === 'block', JSON.stringify(r.data))

  r = await call({ method: 'POST', path: '/save', body: { word: '代购', level: 'review' }, token: adminToken('super') })
  assert('同词再存 → 非新增、仅改等级为 review', r.code === 0 && r.data.created === false && r.data.revived === false && r.data.previous_level === 'block' && r.data.word.level === 'review', JSON.stringify(r.data))

  r = await call({ method: 'POST', path: '/save', body: { word: '   ', level: 'block' }, token: adminToken('super') })
  assert('空白词 → 1001', r.code === 1001, JSON.stringify(r))
  r = await call({ method: 'POST', path: '/save', body: { word: '测试', level: 'invalid' }, token: adminToken('super') })
  assert('非法等级 → 1001', r.code === 1001, JSON.stringify(r))
  r = await call({ method: 'POST', path: '/save', body: { word: 'x'.repeat(31), level: 'block' }, token: adminToken('super') })
  assert('超长词（31 字）→ 1001', r.code === 1001, JSON.stringify(r))
  r = await call({ method: 'POST', path: '/save', body: { word: '代购', level: 'block' }, token: studentToken })
  assert('学生 token 写词库 → 403', r.code === 403, JSON.stringify(r))

  console.log('\n【关键词正则元字符转义】')
  r = await call({ method: 'POST', path: '/save', body: { word: 'a.b', level: 'block' }, token: adminToken('super') })
  assert('保存含字面点词条 a.b', r.code === 0 && r.data.created === true, JSON.stringify(r.data))
  r = await listWords('super', { keyword: 'a.b' })
  assert("keyword='a.b' 精确命中且不误伤 axb（元字符已转义）", r.data.total === 1 && r.data.list[0].word === 'a.b', JSON.stringify(r.data))

  console.log('\n【POST /sensitive_words/delete · 删除与幂等】')
  r = await call({ method: 'POST', path: '/delete', body: { word: '代考' }, token: adminToken('super') })
  assert('删除「代考」→ deleted=true', r.code === 0 && r.data.deleted === true, JSON.stringify(r.data))
  const softDeletedRow = stores.sensitive_words.find((w) => w.word === '代考')
  assert('删除后词条软删保留在库内（deleted=1，审计）', softDeletedRow && softDeletedRow.deleted === 1, JSON.stringify(softDeletedRow))
  r = await listWords()
  assert('删除后列表不再出现「代考」', !r.data.list.some((w) => w.word === '代考') && r.data.total === 4, JSON.stringify(r.data.list.map((w) => w.word)))

  r = await call({ method: 'POST', path: '/delete', body: { word: '不存在的词' }, token: adminToken('super') })
  assert('删除不存在词条 → 幂等成功（deleted=false）', r.code === 0 && r.data.deleted === false, JSON.stringify(r.data))
  r = await call({ method: 'POST', path: '/delete', body: { word: '代考' }, token: adminToken('super') })
  assert('重复删除已软删词条 → 幂等成功', r.code === 0 && r.data.deleted === false, JSON.stringify(r.data))

  console.log('\n【软删词复活】')
  r = await call({ method: 'POST', path: '/save', body: { word: '代考', level: 'review' }, token: adminToken('super') })
  assert('软删词重存 → 复活（revived=true 且等级覆盖为 review）', r.code === 0 && r.data.revived === true && r.data.created === false && r.data.previous_level === 'block' && r.data.word.level === 'review', JSON.stringify(r.data))
  r = await listWords()
  const revived = r.data.list.find((w) => w.word === '代考')
  assert('复活后列表可见且 level=review、deleted=0', revived && revived.level === 'review', JSON.stringify(revived))

  console.log('\n【词库集合最终状态（行为校验后的落库口径）】')
  const alive = stores.sensitive_words.filter((w) => w.deleted === 0).map((w) => `${w.word}:${w.level}`).sort()
  assert(
    '有效词条 = a.b:block + axb:review + 代购:review + 代考:review + 烟花:review',
    alive.join(',') === 'a.b:block,axb:review,代考:review,代购:review,烟花:review',
    alive.join(',')
  )
  const deletedCount = stores.sensitive_words.filter((w) => w.deleted === 1).length
  assert('复活后无遗留软删词条（复活覆盖 deleted）', deletedCount === 0, String(deletedCount))

  console.log('\n【实时生效联动：词库加载读取 deleted:0（P0-08 已验证 refresh 即时生效路径）】')
  const filter = require('../uniCloud-aliyun/cloudfunctions/common/sensitive-filter')
  const hit = filter.matchWords('今天有人在代购烟花', stores.sensitive_words.filter((w) => w.deleted === 0).map((w) => ({ word: w.word, level: w.level })))
  assert('新词「代购」/「烟花」作为词库生效', hit.map((h) => h.word).sort().join(',') === '代购,烟花', JSON.stringify(hit))

  /* ---------- 汇总 ---------- */
  console.log(`\n结果：${passed} 通过，${failed} 失败`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})