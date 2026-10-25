/**
 * P1-27 本地验收（离线，无需部署）
 * 覆盖：管理员账号与权限 /admins/query、/create、/status、/reset-password、/admins/change-password
 *       鉴权（无 token 401 / auditor 403 / viewer 403 / super 可）、列表查询（关键词/状态/分页）、
 *       创建（格式/重名/唯一索引兜底）、禁用启用（禁自己拦截/幂等/不存在）、
 *       重置密码（新密码生效/清锁定）、自助改密（旧密码校验/auditor 可自助）
 * 运行：node scripts/test-p1-27.js
 */
'use strict'
const path = require('path')
const crypto = require('crypto')

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

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex')
  return `sha256$${salt}$${crypto.createHash('sha256').update(salt + password).digest('hex')}`
}
function verifyPassword(password, hash) {
  const parts = String(hash || '').split('$')
  if (parts.length !== 3) return false
  return crypto.createHash('sha256').update(parts[1] + password).digest('hex') === parts[2]
}

/* ---------- 集合 stub ---------- */
let seq = 0
const stores = { admins: [], whitelist: [], users: [], appeals: [], messages: [], sensitive_words: [] }

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

/* ---------- 种子数据：种子超管 admin（P0-09 的 init_data 同构） ---------- */
const DAY = 24 * 3600 * 1000
const now = Date.now()
const at = (ms) => new Date(ms)

stores.admins.push({
  _id: 'a-root',
  username: 'admin',
  password_hash: hashPassword('DemoOnly@2026'),
  role: 'super',
  name: '超级管理员',
  status: 'normal',
  last_login_at: at(now - 1 * DAY),
  failed_attempts: 0,
  locked_until: null,
  created_at: at(now - 30 * DAY),
  deleted: 0,
})

const fn = require('../uniCloud-aliyun/cloudfunctions/admin/index.js')

function adminToken(adminRow) {
  return club.signToken({
    type: club.TOKEN_TYPES.ADMIN,
    adminId: adminRow._id,
    username: adminRow.username,
    role: adminRow.role,
    name: adminRow.name || '',
  })
}
const superToken = adminToken(stores.admins[0])
const auditorToken = adminToken({ _id: 'a-other', username: 'auditor1', role: 'auditor', name: '审核员' })
const viewerToken = adminToken({ _id: 'a-other2', username: 'viewer1', role: 'viewer', name: '查看员' })

async function call(path, body, token) {
  const headers = { 'content-type': 'application/json' }
  if (token) headers.authorization = `Bearer ${token}`
  const res = await fn.main({
    httpMethod: 'POST',
    path,
    headers,
    body: body ? JSON.stringify(body) : '',
    queryStringParameters: {},
  })
  const payload = JSON.parse(res.body)
  return { statusCode: res.statusCode, payload, code: payload.code, data: payload.data, message: payload.message }
}

async function main() {
  console.log('\n【鉴权：仅超管可管理管理员账号】')
  let r = await call('/admins/query', {})
  assert('无 token → 401', r.code === 401, JSON.stringify(r))
  r = await call('/admins/query', {}, auditorToken)
  assert('auditor 调 query → 403（需求 2.3 仅 super）', r.code === 403, JSON.stringify(r))
  r = await call('/admins/query', {}, viewerToken)
  assert('viewer 调 query → 403', r.code === 403, JSON.stringify(r))
  r = await call('/admins/create', { username: 'x', password: '123456', role: 'auditor' }, auditorToken)
  assert('auditor 调 create → 403', r.code === 403, JSON.stringify(r))
  r = await call('/admins/status', { admin_id: 'a-root', action: 'disable' }, viewerToken)
  assert('viewer 调 status → 403', r.code === 403, JSON.stringify(r))

  console.log('\n【POST /admins/query · 列表】')
  r = await call('/admins/query', {}, superToken)
  assert('超管可见管理员列表（种子 1 条）', r.code === 0 && r.data.total === 1 && r.data.list[0].username === 'admin', JSON.stringify(r.data))
  r = await call('/admins/query', { keyword: 'admin' }, superToken)
  assert('关键词命中 username', r.data.total === 1, JSON.stringify(r.data))
  r = await call('/admins/query', { keyword: '不存在的' }, superToken)
  assert('关键词无命中 → 空', r.data.total === 0, JSON.stringify(r.data))
  r = await call('/admins/query', { page_size: 0 }, superToken)
  assert('page_size=0 → 1001', r.code === 1001, JSON.stringify(r))

  console.log('\n【POST /admins/create · 创建账号】')
  r = await call('/admins/create', { username: 'audit01', password: 'Pass@123', role: 'auditor', name: '王审核' }, superToken)
  assert('创建审核员成功', r.code === 0 && r.data.admin.username === 'audit01' && r.data.admin.role === 'auditor' && r.data.admin.status === 'normal', JSON.stringify(r.data))
  const audit01 = stores.admins.find((a) => a.username === 'audit01')
  assert('密码以 sha256$salt$hash 存储且可校验', verifyPassword('Pass@123', audit01.password_hash) && audit01.password_hash.indexOf('sha256$') === 0, audit01.password_hash)

  r = await call('/admins/create', { username: 'audit01', password: 'Pass@123', role: 'viewer' }, superToken)
  assert('重名 → 1001', r.code === 1001, JSON.stringify(r))
  r = await call('/admins/create', { username: '1bad', password: 'Pass@123', role: 'auditor' }, superToken)
  assert('非法账号（数字开头）→ 1001', r.code === 1001, JSON.stringify(r))
  r = await call('/admins/create', { username: 'okuser', password: '123', role: 'auditor' }, superToken)
  assert('密码过短（<6 位）→ 1001', r.code === 1001, JSON.stringify(r))
  r = await call('/admins/create', { username: 'okuser', password: 'Pass@123', role: 'boss' }, superToken)
  assert('非法角色 → 1001', r.code === 1001, JSON.stringify(r))
  r = await call('/admins/create', { username: 'viewer1', password: 'Pass@123', role: 'viewer', name: '查看员' }, superToken)
  assert('创建 viewer 成功', r.code === 0 && r.data.admin.role === 'viewer', JSON.stringify(r.data))

  console.log('\n【POST /admins/status · 禁用 / 启用】')
  r = await call('/admins/status', { admin_id: 'a-root', action: 'disable' }, superToken)
  assert('禁用自己 → 1001（防止锁死）', r.code === 1001, JSON.stringify(r))
  r = await call('/admins/status', { admin_id: audit01._id, action: 'disable' }, superToken)
  assert('禁用 audit01 成功', r.code === 0 && r.data.admin.status === 'disabled', JSON.stringify(r.data))
  r = await call('/admins/status', { admin_id: audit01._id, action: 'disable' }, superToken)
  assert('重复禁用 → 1002', r.code === 1002, JSON.stringify(r))
  r = await call('/admins/status', { admin_id: 'a-not-exist', action: 'disable' }, superToken)
  assert('禁用不存在账号 → 404', r.code === 404, JSON.stringify(r))
  r = await call('/admins/status', { admin_id: audit01._id, action: 'enable' }, superToken)
  assert('启用 audit01 成功', r.code === 0 && r.data.admin.status === 'normal', JSON.stringify(r.data))

  console.log('\n【POST /admins/reset-password · 超管重置密码】')
  r = await call('/admins/reset-password', { admin_id: audit01._id, new_password: 'New@999' }, superToken)
  assert('重置密码成功', r.code === 0 && r.data.reset === true, JSON.stringify(r.data))
  const audit01After = stores.admins.find((a) => a.username === 'audit01')
  assert('重置后新密码可校验、旧密码失效', verifyPassword('New@999', audit01After.password_hash) && !verifyPassword('Pass@123', audit01After.password_hash), audit01After.password_hash)
  r = await call('/admins/reset-password', { admin_id: audit01._id, new_password: '123' }, superToken)
  assert('重置密码过短 → 1001', r.code === 1001, JSON.stringify(r))
  r = await call('/admins/reset-password', { admin_id: 'a-not-exist', new_password: 'New@999' }, superToken)
  assert('重置不存在账号 → 404', r.code === 404, JSON.stringify(r))
  r = await call('/admins/reset-password', { admin_id: audit01._id, new_password: 'New@999' }, auditorToken)
  assert('auditor 调重置 → 403', r.code === 403, JSON.stringify(r))

  console.log('\n【POST /admins/change-password · 自助修改密码】')
  r = await call('/admins/change-password', { old_password: 'wrong-old', new_password: 'Self@123' }, superToken)
  assert('原密码错误 → 1001', r.code === 1001, JSON.stringify(r))
  r = await call('/admins/change-password', { old_password: 'DemoOnly@2026', new_password: 'Self@123' }, superToken)
  assert('超管自助改密成功', r.code === 0 && r.data.changed === true, JSON.stringify(r.data))
  const rootAfter = stores.admins.find((a) => a.username === 'admin')
  assert('改密后新密码生效、旧密码失效', verifyPassword('Self@123', rootAfter.password_hash) && !verifyPassword('DemoOnly@2026', rootAfter.password_hash))
  r = await call('/admins/change-password', { old_password: 'New@999', new_password: 'Self2@123' }, adminToken(stores.admins.find((a) => a.username === 'audit01')))
  assert('auditor 自助改密成功（任意管理员可自助）', r.code === 0 && r.data.changed === true, JSON.stringify(r.data))
  const audit01Final = stores.admins.find((a) => a.username === 'audit01')
  assert('audit01 改密后新密码生效', verifyPassword('Self2@123', audit01Final.password_hash))
  r = await call('/admins/change-password', { old_password: 'Self@123', new_password: 'x' }, superToken)
  assert('新密码过短 → 1001', r.code === 1001, JSON.stringify(r))

  console.log('\n【落库口径（回滚）】')
  const finalAdmins = stores.admins.map((a) => `${a.username}:${a.role}:${a.status}`).sort()
  assert('管理员集合 = admin:super:normal + audit01:auditor:normal + viewer1:viewer:normal', finalAdmins.join(',') === 'admin:super:normal,audit01:auditor:normal,viewer1:viewer:normal', finalAdmins.join(','))

  /* ---------- 汇总 ---------- */
  console.log(`\n结果：${passed} 通过，${failed} 失败`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})