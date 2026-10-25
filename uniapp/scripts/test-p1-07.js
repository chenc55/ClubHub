/**
 * P1-07 本地验收（离线，无需部署）
 * 覆盖：分类维护（列表 / 新增 / 重命名 / 排序 / 删除兜底 / 软删同名复用 / 公开字典同步）/
 *       星级评定（区间校验、状态限制、落库与分类名 join）/ 封禁与解封（状态机与非法流转）/ 鉴权与角色越权
 * 运行：node scripts/test-p1-07.js
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

/* ---------- 集合 stub ---------- */
let seq = 0
const stores = { clubs: [], club_members: [], categories: [], users: [], messages: [] }

function matchCond(row, cond) {
  if (cond && cond.__and) return cond.__and.every((item) => matchCond(row, item))
  if (cond && cond.__or) return cond.__or.some((item) => matchCond(row, item))
  return Object.keys(cond).every((key) => {
    const want = cond[key]
    if (want instanceof RegExp) return want.test(String(row[key] == null ? '' : row[key]))
    if (want && typeof want === 'object' && Object.prototype.hasOwnProperty.call(want, '__in')) {
      return want.__in.indexOf(row[key]) !== -1
    }
    if (want && typeof want === 'object' && Object.prototype.hasOwnProperty.call(want, '__neq')) {
      return row[key] !== want.__neq
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
        // 数值字段（如 categories.sort）按数值排序，时间字段按时间排序
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
  }
  return query
}

/** 唯一索引模拟：clubs.name / categories.name（同样作用于软删记录） */
function assertUniqueName(name, doc, exceptId) {
  if (!name) return
  const rows = stores[name] || []
  const list = Array.isArray(doc) ? doc : [doc]
  for (const item of list) {
    if (!item.name) continue
    if (rows.some((row) => row.name === item.name && row._id !== exceptId)) {
      throw new Error(`duplicate key: ${name}.name (${item.name})`)
    }
  }
}

function addRows(name, doc) {
  const list = Array.isArray(doc) ? doc : [doc]
  if (name === 'clubs' || name === 'categories') assertUniqueName(name, doc)
  let lastId = ''
  list.forEach((item) => {
    lastId = `${name}-${++seq}`
    stores[name].push({ _id: lastId, ...item })
  })
  return { id: lastId, inserted: list.length }
}

function collectionFor(name) {
  const rowsOf = () => stores[name] || []
  return {
    where: (cond) => makeQuery(rowsOf().filter((row) => matchCond(row, cond))),
    add: async (doc) => addRows(name, doc),
    doc: (id) => ({
      update: async (patch) => {
        const row = rowsOf().find((item) => item._id === id)
        if (!row) return { updated: 0 }
        if ((name === 'clubs' || name === 'categories') && patch.name) {
          assertUniqueName(name, { name: patch.name }, id)
        }
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
    },
  }),
  httpclient: { request: async () => ({ data: { access_token: 'T', expires_in: 7200 } }) },
}

/* ---------- 种子数据 ---------- */
function makeUser(over) {
  seq += 1
  return { _id: `u-${seq}`, openid: `openid-${seq}`, name: '', auth_status: 'verified', status: 'normal', deleted: 0, ...over }
}
const u1 = makeUser({ name: '林晨', student_no: '20260001' })
stores.users.push(u1)

const CATEGORY_SEED = ['学术科技', '文艺表演', '体育竞技', '公益实践', '创新创业', '思想政治', '兴趣爱好', '其他']
CATEGORY_SEED.forEach((name, i) => {
  stores.categories.push({ _id: `c-${i + 1}`, name, sort: i + 1, deleted: 0 })
})

stores.clubs.push(
  {
    _id: 'club-normal',
    name: '天文爱好者协会',
    intro: '一起观测星空',
    logo: 'https://cdn.example.com/logo.png',
    cover: '',
    contact: 'QQ群 123456',
    category_id: 'c-3',
    star_level: 0,
    status: 'normal',
    create_type: 'imported',
    applicant_id: '',
    reject_reason: '',
    review_by: '',
    review_at: null,
    batch_no: 'B-001',
    created_at: new Date('2026-09-01T10:00:00Z'),
    updated_at: new Date('2026-09-01T10:00:00Z'),
    deleted: 0,
  },
  {
    _id: 'club-pending',
    name: '街舞社',
    intro: '每周团训',
    contact: '微信 streetdance',
    category_id: 'c-1',
    star_level: 0,
    status: 'pending',
    create_type: 'applied',
    applicant_id: u1._id,
    reject_reason: '',
    review_by: '',
    review_at: null,
    batch_no: '',
    created_at: new Date('2026-09-02T10:00:00Z'),
    updated_at: new Date('2026-09-02T10:00:00Z'),
    deleted: 0,
  },
  {
    _id: 'club-banned',
    name: '违规社团',
    intro: '已封禁',
    contact: '',
    category_id: 'c-2',
    star_level: 0,
    status: 'banned',
    create_type: 'imported',
    applicant_id: '',
    reject_reason: '',
    review_by: 'root',
    review_at: new Date('2026-09-03T10:00:00Z'),
    batch_no: '',
    created_at: new Date('2026-09-03T10:00:00Z'),
    updated_at: new Date('2026-09-03T10:00:00Z'),
    deleted: 0,
  }
)

const clubFn = require('../uniCloud-aliyun/cloudfunctions/club/index.js')

function studentToken(user) {
  return club.signToken({
    type: club.TOKEN_TYPES.STUDENT,
    token_kind: 'access',
    userId: user._id,
    openid: user.openid,
    auth_status: user.auth_status,
  })
}
const superToken = club.signToken({ type: 'admin', adminId: 'a-1', username: 'root', role: 'super' })
const auditorToken = club.signToken({ type: 'admin', adminId: 'a-2', username: 'auditor1', role: 'auditor' })
const viewerToken = club.signToken({ type: 'admin', adminId: 'a-3', username: 'viewer1', role: 'viewer' })

async function call(pathname, { method = 'POST', body, token } = {}) {
  const headers = { 'content-type': 'application/json' }
  if (token) headers.authorization = `Bearer ${token}`
  const res = await clubFn.main({
    httpMethod: method,
    path: pathname.replace(/^\/club/, ''),
    headers,
    body: body ? JSON.stringify(body) : '',
    queryStringParameters: {},
  })
  return { statusCode: res.statusCode, payload: JSON.parse(res.body) }
}

function categoryRows() {
  return stores.categories.filter((row) => row.deleted === 0)
}

async function main() {
  /* ---------- 1. 分类列表与鉴权 ---------- */
  console.log('\n【分类列表 · 鉴权】')
  let r = await call('/club/category/list', { method: 'GET' })
  assert('GET /club/category/list 无 token → 401', r.statusCode === 401 && r.payload.code === 401, JSON.stringify(r.payload))

  r = await call('/club/category/list', { method: 'GET', token: studentToken(u1) })
  assert('学生 token → 403', r.payload.code === 403, JSON.stringify(r.payload))

  r = await call('/club/category/list', { method: 'GET', token: viewerToken })
  assert('viewer → 403（2.3 权限矩阵：分类维护仅超管 / 审核员）', r.payload.code === 403, JSON.stringify(r.payload))

  r = await call('/club/category/list', { method: 'GET', token: auditorToken })
  assert('auditor 放行 → 8 个分类且按 sort 升序', r.payload.code === 0 && r.payload.data.list.length === 8 && r.payload.data.list[0].name === '学术科技', JSON.stringify(r.payload).slice(0, 220))

  const counts = {}
  r.payload.data.list.forEach((item) => {
    counts[item.name] = item.club_count
  })
  assert('返回各分类社团数（含待审 / 已封禁）', counts['学术科技'] === 1 && counts['文艺表演'] === 1 && counts['体育竞技'] === 1 && counts['其他'] === 0, JSON.stringify(counts))

  /* ---------- 2. 新增分类 ---------- */
  console.log('\n【新增分类】')
  r = await call('/club/category/save', { body: { name: '' }, token: superToken })
  assert('缺 name → 1001', r.payload.code === 1001, JSON.stringify(r.payload))

  r = await call('/club/category/save', { body: { name: '科' }, token: superToken })
  assert('名称过短 → 1001', r.payload.code === 1001 && r.payload.message.includes('至少'), JSON.stringify(r.payload))

  r = await call('/club/category/save', { body: { name: '这是一个超过十个字的分类名称' }, token: superToken })
  assert('名称超长 → 1001', r.payload.code === 1001, JSON.stringify(r.payload))

  r = await call('/club/category/save', { body: { name: '学术科技' }, token: superToken })
  assert('重名 → 1001', r.payload.code === 1001 && r.payload.message.includes('已存在'), JSON.stringify(r.payload))

  r = await call('/club/category/save', { body: { name: '科技创新' }, token: superToken })
  assert('新增成功 → sort 追加到末尾', r.payload.code === 0 && r.payload.data.category.sort === 9 && r.payload.data.category.club_count === 0, JSON.stringify(r.payload).slice(0, 220))
  const createdId = r.payload.data.category._id
  assert('落库 deleted=0', stores.categories.find((row) => row._id === createdId).deleted === 0)

  r = await call('/club/categories', { method: 'GET' })
  assert('公开字典同步返回新分类（学生端入驻表单即时生效）', r.payload.code === 0 && r.payload.data.list.length === 9 && r.payload.data.list[8].name === '科技创新', JSON.stringify(r.payload.data.list.map((i) => i.name)))

  /* ---------- 3. 删除后同名复用（唯一索引兼容） ---------- */
  console.log('\n【软删同名复用】')
  r = await call('/club/category/delete', { body: { category_id: createdId }, token: superToken })
  assert('无社团引用的新分类可删除 → deleted=1', r.payload.code === 0 && stores.categories.find((row) => row._id === createdId).deleted === 1, JSON.stringify(r.payload).slice(0, 200))
  assert('删除回执带回最新分类列表', r.payload.data.list.length === 8)

  r = await call('/club/categories', { method: 'GET' })
  assert('公开字典不再返回已删分类', r.payload.data.list.length === 8 && !r.payload.data.list.some((i) => i.name === '科技创新'))

  r = await call('/club/category/save', { body: { name: '科技创新' }, token: superToken })
  assert('同名再新增 → 复用软删记录（不新增行，避免唯一索引冲突）', r.payload.code === 0 && r.payload.data.category._id === createdId, JSON.stringify(r.payload).slice(0, 220))
  assert('复用后恢复 deleted=0 且 sort 追加到末尾', stores.categories.find((row) => row._id === createdId).deleted === 0 && stores.categories.find((row) => row._id === createdId).sort === 9)
  assert('分类总行数未增加（复用而非新增）', stores.categories.length === 9)

  /* ---------- 4. 重命名 ---------- */
  console.log('\n【重命名】')
  r = await call('/club/category/save', { body: { category_id: 'not-exist', name: '不存在分类' }, token: superToken })
  assert('分类不存在 → 404', r.payload.code === 404, JSON.stringify(r.payload))

  r = await call('/club/category/save', { body: { category_id: 'c-1', name: '文艺表演' }, token: superToken })
  assert('改为已存在名称 → 1001', r.payload.code === 1001 && r.payload.message.includes('已被占用'), JSON.stringify(r.payload))

  r = await call('/club/category/save', { body: { category_id: 'c-1', name: '学术科技类' }, token: superToken })
  assert('重命名成功（sort 保持不变）', r.payload.code === 0 && r.payload.data.category.name === '学术科技类' && r.payload.data.category.sort === 1, JSON.stringify(r.payload).slice(0, 220))

  r = await call('/club/category/save', { body: { category_id: 'c-1', name: '学术科技类' }, token: superToken })
  assert('同名重命名幂等（不报错）', r.payload.code === 0, JSON.stringify(r.payload))

  r = await call('/club/query', { body: { status: 'all' }, token: superToken })
  const renamedRow = r.payload.data.list.find((item) => item._id === 'club-pending')
  assert('社团侧分类名同步展示新名称', renamedRow.category_name === '学术科技类', JSON.stringify(renamedRow).slice(0, 220))

  /* ---------- 5. 分类排序 ---------- */
  console.log('\n【分类排序】')
  r = await call('/club/category/sort', { body: { category_id: 'c-1', direction: 'up' }, token: superToken })
  assert('第一个分类上移 → 1002', r.payload.code === 1002 && r.payload.message.includes('第一个'), JSON.stringify(r.payload))

  r = await call('/club/category/sort', { body: { category_id: 'c-1', direction: 'right' }, token: superToken })
  assert('direction 非法 → 1001', r.payload.code === 1001, JSON.stringify(r.payload))

  r = await call('/club/category/sort', { body: { category_id: 'c-9', direction: 'down' }, token: superToken })
  assert('分类不存在 → 404', r.payload.code === 404, JSON.stringify(r.payload))

  r = await call('/club/category/sort', { body: { category_id: 'c-1', direction: 'down' }, token: superToken })
  assert('下移与相邻分类交换', r.payload.code === 0 && r.payload.data.list[0]._id === 'c-2' && r.payload.data.list[1]._id === 'c-1', JSON.stringify(r.payload.data.list.map((i) => i.name)))

  r = await call('/club/category/sort', { body: { category_id: 'c-1', direction: 'up' }, token: superToken })
  assert('再上移还原顺序', r.payload.code === 0 && r.payload.data.list[0]._id === 'c-1' && r.payload.data.list[1]._id === 'c-2', JSON.stringify(r.payload.data.list.map((i) => i.name)))
  assert('排序值归一为 1..n', r.payload.data.list.map((i) => i.sort).join(',') === '1,2,3,4,5,6,7,8,9')

  // 重复 sort 值（历史脏数据）在排序时被归一
  stores.categories.find((row) => row._id === 'c-5').sort = 4
  r = await call('/club/category/sort', { body: { category_id: 'c-5', direction: 'up' }, token: superToken })
  assert('重复 sort 值参与排序后归一无重复', r.payload.code === 0 && new Set(r.payload.data.list.map((i) => i.sort)).size === r.payload.data.list.length, JSON.stringify(r.payload.data.list.map((i) => `${i.name}:${i.sort}`)))

  /* ---------- 6. 分类删除兜底 ---------- */
  console.log('\n【分类删除兜底】')
  r = await call('/club/category/delete', { body: { category_id: 'c-3' }, token: superToken })
  assert('分类被社团引用 → 1002 且带回社团数', r.payload.code === 1002 && r.payload.data.club_count === 1 && r.payload.message.includes('1 个社团'), JSON.stringify(r.payload))
  assert('被拒绝时分类未被软删', stores.categories.find((row) => row._id === 'c-3').deleted === 0)

  r = await call('/club/category/delete', { body: {} , token: superToken })
  assert('缺 category_id → 1001', r.payload.code === 1001, JSON.stringify(r.payload))

  r = await call('/club/category/delete', { body: { category_id: 'not-exist' }, token: superToken })
  assert('分类不存在 → 404', r.payload.code === 404, JSON.stringify(r.payload))

  r = await call('/club/category/delete', { body: { category_id: createdId }, token: superToken })
  assert('无引用分类删除成功', r.payload.code === 0 && stores.categories.find((row) => row._id === createdId).deleted === 1, JSON.stringify(r.payload).slice(0, 200))

  /* ---------- 7. 星级评定 ---------- */
  console.log('\n【星级评定】')
  r = await call('/club/star', { body: { club_id: 'club-normal', star_level: 3 } })
  assert('无 token → 401', r.statusCode === 401, JSON.stringify(r.payload))

  r = await call('/club/star', { body: { club_id: 'club-normal', star_level: 3 }, token: viewerToken })
  assert('viewer → 403', r.payload.code === 403, JSON.stringify(r.payload))

  r = await call('/club/star', { body: { star_level: 3 }, token: superToken })
  assert('缺 club_id → 1001', r.payload.code === 1001, JSON.stringify(r.payload))

  r = await call('/club/star', { body: { club_id: 'club-normal', star_level: '3' }, token: superToken })
  assert('星级非整数 → 1001', r.payload.code === 1001, JSON.stringify(r.payload))

  r = await call('/club/star', { body: { club_id: 'club-normal', star_level: 6 }, token: superToken })
  assert('星级越界（6）→ 1001', r.payload.code === 1001 && r.payload.message.includes('0~5'), JSON.stringify(r.payload))

  r = await call('/club/star', { body: { club_id: 'club-normal', star_level: -1 }, token: superToken })
  assert('星级越界（-1）→ 1001', r.payload.code === 1001, JSON.stringify(r.payload))

  r = await call('/club/star', { body: { club_id: 'not-exist', star_level: 3 }, token: superToken })
  assert('社团不存在 → 404', r.payload.code === 404, JSON.stringify(r.payload))

  r = await call('/club/star', { body: { club_id: 'club-pending', star_level: 3 }, token: superToken })
  assert('待审社团 → 1002（仅正常状态可评星）', r.payload.code === 1002 && r.payload.message.includes('正常'), JSON.stringify(r.payload))

  r = await call('/club/star', { body: { club_id: 'club-banned', star_level: 3 }, token: superToken })
  assert('已封禁社团 → 1002', r.payload.code === 1002, JSON.stringify(r.payload))

  r = await call('/club/star', { body: { club_id: 'club-normal', star_level: 5 }, token: auditorToken })
  assert('评定 5 星成功 → 返回星级与分类名', r.payload.code === 0 && r.payload.data.club.star_level === 5 && r.payload.data.club.category_name === '体育竞技', JSON.stringify(r.payload).slice(0, 240))
  assert('星级落库且刷新 updated_at', stores.clubs.find((row) => row._id === 'club-normal').star_level === 5 && stores.clubs.find((row) => row._id === 'club-normal').updated_at > new Date('2026-09-01T10:00:00Z'))

  r = await call('/club/star', { body: { club_id: 'club-normal', star_level: 0 }, token: superToken })
  assert('0 星 → 取消评定', r.payload.code === 0 && r.payload.data.club.star_level === 0, JSON.stringify(r.payload).slice(0, 200))

  r = await call('/club/query', { body: { status: 'normal' }, token: superToken })
  const queried = r.payload.data.list.find((item) => item._id === 'club-normal')
  assert('管理端列表返回星级与 logo / cover 字段', queried.star_level === 0 && queried.logo === 'https://cdn.example.com/logo.png' && queried.cover === '', JSON.stringify(queried).slice(0, 240))

  /* ---------- 8. 封禁 / 解封 ---------- */
  console.log('\n【封禁 / 解封（状态机）】')
  r = await call('/club/ban', { body: { club_id: 'club-normal', action: 'offline' }, token: superToken })
  assert('action 非法 → 1001', r.payload.code === 1001, JSON.stringify(r.payload))

  r = await call('/club/ban', { body: { club_id: 'not-exist', action: 'ban' }, token: superToken })
  assert('社团不存在 → 404', r.payload.code === 404, JSON.stringify(r.payload))

  r = await call('/club/ban', { body: { club_id: 'club-normal', action: 'ban' }, token: viewerToken })
  assert('viewer → 403', r.payload.code === 403, JSON.stringify(r.payload))

  r = await call('/club/ban', { body: { club_id: 'club-pending', action: 'ban' }, token: superToken })
  assert('待审社团 → 1002（仅正常状态可封禁）', r.payload.code === 1002 && r.payload.message.includes('正常'), JSON.stringify(r.payload))

  r = await call('/club/ban', { body: { club_id: 'club-normal', action: 'unban' }, token: superToken })
  assert('正常社团解封 → 1002', r.payload.code === 1002 && r.payload.message.includes('已封禁'), JSON.stringify(r.payload))

  r = await call('/club/ban', { body: { club_id: 'club-normal', action: 'ban' }, token: superToken })
  assert('封禁成功 → status=banned 并落库', r.payload.code === 0 && r.payload.data.club.status === 'banned' && stores.clubs.find((row) => row._id === 'club-normal').status === 'banned', JSON.stringify(r.payload).slice(0, 220))

  r = await call('/club/ban', { body: { club_id: 'club-normal', action: 'ban' }, token: superToken })
  assert('重复封禁 → 1002', r.payload.code === 1002, JSON.stringify(r.payload))

  r = await call('/club/ban', { body: { club_id: 'club-normal', action: 'unban' }, token: auditorToken })
  assert('解封成功 → status=normal', r.payload.code === 0 && r.payload.data.club.status === 'normal' && stores.clubs.find((row) => row._id === 'club-normal').status === 'normal', JSON.stringify(r.payload).slice(0, 220))

  r = await call('/club/ban', { body: { club_id: 'club-normal', action: 'unban' }, token: superToken })
  assert('重复解封 → 1002', r.payload.code === 1002, JSON.stringify(r.payload))

  /* ---------- 9. 至少保留一个分类 ---------- */
  console.log('\n【至少保留一个分类】')
  const backup = stores.categories.map((row) => ({ ...row }))
  stores.categories.forEach((row) => {
    if (row._id !== 'c-8') row.deleted = 1
  })
  r = await call('/club/category/delete', { body: { category_id: 'c-8' }, token: superToken })
  assert('删除最后一个分类 → 1002', r.payload.code === 1002 && r.payload.message.includes('至少'), JSON.stringify(r.payload))
  assert('被拒绝时最后一个分类仍在', categoryRows().length === 1)
  stores.categories.splice(0, stores.categories.length, ...backup)

  console.log(`\n通过 ${passed} 项，失败 ${failed} 项`)
  if (failed > 0) process.exitCode = 1
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
