/**
 * P1-02 本地验收（离线，无需部署）
 * 覆盖：用户查询（姓名/学号模糊 + 筛选 + 分页 + openid 脱敏 + 正则注入防护）/
 *       禁用 / 解封（幂等保护）/ 角色与通道越权 / 被禁用用户写操作拦截 / 解封后恢复
 * 运行：node scripts/test-p1-02.js
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

/* ---------- users 集合 stub（含 and / or / regex / count / skip / limit / update） ---------- */
let seq = 0
const users = []

function at(day) {
  return new Date(2026, 8, day, 9, 0, 0)
}

function makeUser(over) {
  seq += 1
  return {
    _id: `u-${seq}`,
    openid: `openid-${seq}-abcdefgh`,
    student_no: '',
    name: '',
    college: '',
    major: '',
    nickname: '',
    avatar: '',
    auth_status: 'unverified',
    status: 'normal',
    deleted: 0,
    created_at: at(20),
    updated_at: at(20),
    ...over,
  }
}

function matchCond(row, cond) {
  if (cond && cond.__and) return cond.__and.every((item) => matchCond(row, item))
  if (cond && cond.__or) return cond.__or.some((item) => matchCond(row, item))
  return Object.keys(cond).every((key) => {
    const want = cond[key]
    if (want instanceof RegExp) return want.test(String(row[key] == null ? '' : row[key]))
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
    orderBy: (field, dir) => {
      result = result.slice().sort((a, b) => {
        const av = new Date(a[field]).getTime()
        const bv = new Date(b[field]).getTime()
        return dir === 'desc' ? bv - av : av - bv
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

const usersCollection = {
  where: (cond) => makeQuery(users.filter((row) => matchCond(row, cond))),
  doc: (id) => ({
    update: async (patch) => {
      const row = users.find((item) => item._id === id)
      if (!row) return { updated: 0 }
      Object.assign(row, patch)
      return { updated: 1 }
    },
  }),
}

global.uniCloud = {
  database: () => ({
    collection: (name) => name === 'admins' ? require('./helpers/admin-fixtures').adminCollection() : usersCollection,
    command: {
      and: (list) => ({ __and: list }),
      or: (list) => ({ __or: list }),
    },
  }),
  uploadFile: async (opts) => ({ fileID: `cloud://test/space/${opts.cloudPath}` }),
  getTempFileURL: async ({ fileList }) => ({
    fileList: fileList.map((id) => ({ fileID: id, tempFileURL: `https://cdn.example.com/${id.split('/').pop()}` })),
  }),
}

/* ---------- 数据集 ---------- */
const u1 = makeUser({ name: '林晨', student_no: '20260001', college: '软件学院', major: '软件工程', auth_status: 'verified', openid: 'oX8abcdefgh1234567', created_at: at(1) })
const u2 = makeUser({ name: '苏晚晴', student_no: '20260117', college: '经管学院', major: '会计学', auth_status: 'verified', created_at: at(2) })
const u3 = makeUser({ name: '何子轩', student_no: '20260452', college: '计算机学院', major: '软件工程', status: 'disabled', created_at: at(3) })
const u4 = makeUser({ name: '林小雨', student_no: 'S2025099', college: '外国语学院', major: '英语', created_at: at(4) })
const u5 = makeUser({ name: '已注销', student_no: '20250000', deleted: 1, created_at: at(5) })
users.push(u1, u2, u3, u4, u5)

const adminFn = require('../uniCloud-aliyun/cloudfunctions/admin/index.js')
const userFn = require('../uniCloud-aliyun/cloudfunctions/user/index.js')

const superToken = club.signToken({ type: 'admin', adminId: 'a-1', username: 'root', role: 'super' })
const auditorToken = club.signToken({ type: 'admin', adminId: 'a-2', username: 'audit', role: 'auditor' })
const viewerToken = club.signToken({ type: 'admin', adminId: 'a-3', username: 'view', role: 'viewer' })
function studentToken(user) {
  return club.signToken({ type: 'student', token_kind: 'access', userId: user._id, openid: user.openid })
}

async function callAdmin(path, body, token = superToken) {
  const headers = { 'content-type': 'application/json' }
  if (token) headers.authorization = `Bearer ${token}`
  const res = await adminFn.main({ httpMethod: 'POST', path, headers, body: JSON.stringify(body), queryStringParameters: {} })
  return { statusCode: res.statusCode, payload: JSON.parse(res.body) }
}

async function callUser(method, path, body, token) {
  const headers = { 'content-type': 'application/json' }
  if (token) headers.authorization = `Bearer ${token}`
  const res = await userFn.main({
    httpMethod: method,
    // 云函数内路由为相对路径：对外 /user/xxx 的 /user 前缀由 URL 化网关剥离
    path: path.replace(/^\/user/, ''),
    headers,
    body: body ? JSON.stringify(body) : '',
    queryStringParameters: {},
  })
  return { statusCode: res.statusCode, payload: JSON.parse(res.body) }
}

const UPLOAD_OK = {
  scene: 'club_logo',
  filename: 'a.png',
  mime: 'image/png',
  base64: Buffer.from('fake-image-bytes').toString('base64'),
}

async function main() {
  /* ---------- 1. 查询：鉴权与越权 ---------- */
  console.log('\n【查询 · 鉴权与越权】')
  let r = await callAdmin('/users/query', {}, '')
  assert('未携带 token → 401', r.statusCode === 401 && r.payload.code === 401, JSON.stringify(r.payload))

  r = await callAdmin('/users/query', {}, studentToken(u1))
  assert('学生 token 调管理接口 → 403', r.payload.code === 403, JSON.stringify(r.payload))

  r = await callAdmin('/users/query', {}, viewerToken)
  assert('viewer 角色 → 403（当前角色无权）', r.payload.code === 403 && r.payload.message.includes('角色'), JSON.stringify(r.payload))

  r = await callAdmin('/users/query', {}, auditorToken)
  assert('auditor 角色 → 放行', r.payload.code === 0, JSON.stringify(r.payload))

  /* ---------- 2. 查询：筛选 / 分页 / 脱敏 ---------- */
  console.log('\n【查询 · 筛选与分页】')
  r = await callAdmin('/users/query', {})
  const first = r.payload.data
  assert('全量查询漏掉已软删用户', first.total === 4, JSON.stringify(first))
  assert('按 created_at 倒序', first.list[0]._id === u4._id && first.list[3]._id === u1._id, JSON.stringify(first.list.map((i) => i._id)))
  assert('默认分页 page=1 / page_size=20', first.page === 1 && first.page_size === 20, JSON.stringify(first))

  r = await callAdmin('/users/query', { keyword: '林' })
  assert('姓名模糊命中 2 人', r.payload.data.total === 2, JSON.stringify(r.payload.data.list.map((i) => i.name)))

  r = await callAdmin('/users/query', { keyword: '2026011' })
  assert('学号模糊命中 1 人', r.payload.data.total === 1 && r.payload.data.list[0]._id === u2._id, JSON.stringify(r.payload.data))

  r = await callAdmin('/users/query', { keyword: 's2025' })
  assert('学号匹配大小写不敏感', r.payload.data.total === 1 && r.payload.data.list[0]._id === u4._id, JSON.stringify(r.payload.data))

  r = await callAdmin('/users/query', { keyword: '.*' })
  assert('正则注入被转义（不命中全表）', r.payload.code === 0 && r.payload.data.total === 0, JSON.stringify(r.payload.data))

  r = await callAdmin('/users/query', { status: 'disabled' })
  assert('账号态筛选 → 仅禁用用户', r.payload.data.total === 1 && r.payload.data.list[0]._id === u3._id, JSON.stringify(r.payload.data.list))

  r = await callAdmin('/users/query', { auth_status: 'verified' })
  assert('认证态筛选 → 仅已认证', r.payload.data.total === 2, JSON.stringify(r.payload.data.list.map((i) => i.name)))

  r = await callAdmin('/users/query', { page: 2, page_size: 2 })
  assert('分页切片正确', r.payload.data.total === 4 && r.payload.data.list.length === 2 && r.payload.data.list[0]._id === u2._id, JSON.stringify(r.payload.data.list.map((i) => i._id)))

  r = await callAdmin('/users/query', { keyword: '林', status: 'disabled' })
  assert('关键词 + 状态组合筛选', r.payload.data.total === 0, JSON.stringify(r.payload.data.list))

  /* ---------- 3. 查询：参数校验与字段脱敏 ---------- */
  console.log('\n【查询 · 参数校验与脱敏】')
  r = await callAdmin('/users/query', { page_size: 101 })
  assert('page_size 超上限 → 1001', r.payload.code === 1001 && r.payload.message.includes('page_size'), JSON.stringify(r.payload))

  r = await callAdmin('/users/query', { page: 0 })
  assert('page < 1 → 1001', r.payload.code === 1001, JSON.stringify(r.payload))

  r = await callAdmin('/users/query', { page_size: 0 })
  assert('page_size < 1 → 1001', r.payload.code === 1001, JSON.stringify(r.payload))

  r = await callAdmin('/users/query', { status: 'bogus' })
  assert('状态取值非法 → 1001', r.payload.code === 1001, JSON.stringify(r.payload))

  r = await callAdmin('/users/query', { keyword: 'x'.repeat(33) })
  assert('关键词超长 → 1001', r.payload.code === 1001, JSON.stringify(r.payload))

  r = await callAdmin('/users/query', { keyword: '林晨' })
  const row = r.payload.data.list[0]
  assert('openid 脱敏（前 4 + *** + 后 4）', row.openid_masked === 'oX8a***4567', row.openid_masked)
  assert('返回绑定情况', row.openid_bound === true, JSON.stringify(row))
  assert('不返回原始 openid', row.openid === undefined, JSON.stringify(row))
  assert('返回学号与实名（管理端查询需要）', row.student_no === '20260001' && row.name === '林晨', JSON.stringify(row))

  /* ---------- 4. 禁用（P1-02 主流程） ---------- */
  console.log('\n【禁用】')
  r = await callAdmin('/users/disable', { user_id: u1._id, extra: 'ignored' })
  assert('禁用成功 → code=0 且 status=disabled', r.payload.code === 0 && r.payload.data.user.status === 'disabled', JSON.stringify(r.payload))
  assert('库内状态已落盘', users.find((i) => i._id === u1._id).status === 'disabled')

  r = await callAdmin('/users/disable', { user_id: u1._id })
  assert('重复禁用 → 1002', r.payload.code === 1002 && r.payload.message.includes('已被禁用'), JSON.stringify(r.payload))

  r = await callAdmin('/users/disable', { user_id: 'not-exist' })
  assert('目标不存在 → 404', r.statusCode === 404 && r.payload.code === 404, JSON.stringify(r.payload))

  r = await callAdmin('/users/disable', { user_id: u5._id })
  assert('目标已软删 → 404', r.payload.code === 404, JSON.stringify(r.payload))

  r = await callAdmin('/users/disable', {})
  assert('缺 user_id → 1001', r.payload.code === 1001 && r.payload.message.includes('user_id'), JSON.stringify(r.payload))

  r = await callAdmin('/users/disable', { user_id: u2._id }, viewerToken)
  assert('viewer 禁用 → 403', r.payload.code === 403 && users.find((i) => i._id === u2._id).status === 'normal', JSON.stringify(r.payload))

  /* ---------- 5. 学生端写操作拦截 / 仅浏览 ---------- */
  console.log('\n【学生端写操作拦截】')
  r = await callUser('POST', '/user/upload', UPLOAD_OK, studentToken(u2))
  assert('正常用户上传 → 放行', r.payload.code === 0, JSON.stringify(r.payload))

  r = await callUser('POST', '/user/upload', UPLOAD_OK, studentToken(u3))
  assert('禁用用户写操作 → 403', r.statusCode === 403 && r.payload.code === 403, JSON.stringify(r.payload))
  assert('禁用提示语含「仅可浏览」', r.payload.message.includes('禁用') && r.payload.message.includes('浏览'), r.payload.message)

  r = await callUser('GET', '/user/me', null, studentToken(u3))
  assert('禁用用户浏览接口仍放行（仅浏览）', r.payload.code === 0, JSON.stringify(r.payload))

  r = await callUser('POST', '/user/upload', UPLOAD_OK, studentToken(u5))
  assert('已软删用户写操作 → 401', r.statusCode === 401 && r.payload.code === 401, JSON.stringify(r.payload))

  r = await callUser('POST', '/user/upload', UPLOAD_OK, '')
  assert('无 token 写操作 → 401', r.payload.code === 401, JSON.stringify(r.payload))

  r = await callUser('POST', '/user/upload', UPLOAD_OK, studentToken(u1))
  assert('已落盘的禁用用户（u1）写操作被拦截', r.payload.code === 403, JSON.stringify(r.payload))

  /* ---------- 6. 解封（验收：解封后恢复正常） ---------- */
  console.log('\n【解封】')
  r = await callAdmin('/users/enable', { user_id: u1._id })
  assert('解封成功 → status=normal', r.payload.code === 0 && r.payload.data.user.status === 'normal', JSON.stringify(r.payload))

  r = await callAdmin('/users/enable', { user_id: u1._id })
  assert('重复解封 → 1002', r.payload.code === 1002 && r.payload.message.includes('正常状态'), JSON.stringify(r.payload))

  r = await callUser('POST', '/user/upload', UPLOAD_OK, studentToken(u1))
  assert('解封后写操作恢复 → 放行', r.payload.code === 0, JSON.stringify(r.payload))

  r = await callAdmin('/users/enable', { user_id: u1._id }, viewerToken)
  assert('viewer 解封 → 403', r.payload.code === 403, JSON.stringify(r.payload))

  console.log(`\n结果：${passed} 通过 / ${failed} 失败`)
  if (failed > 0) process.exitCode = 1
}

main().catch((e) => {
  console.error('用例执行异常：', e)
  process.exitCode = 1
})
