/**
 * P1-03 本地验收（离线，无需部署）
 * 覆盖：学号认证四分支（成功 / 未命中 / 姓名不符 / 学号已被他人绑定）/
 *       一学号一微信约束与唯一索引竞态兜底 / 已认证不可重复认证 /
 *       禁用与软删账号拦截 / 学籍字段取自白名单 / token 换发为认证态 / 账号态与认证态正交
 * 运行：node scripts/test-p1-03.js
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

/* ---------- 集合 stub（等式 / RegExp / neq / and / or / limit / update） ---------- */
let seq = 0
const users = []
const whitelist = []
/** 竞态开关：模拟 users.student_no 唯一索引在写入瞬间被并发抢占 */
let uniqueConflictNo = ''

function matchCond(row, cond) {
  if (cond && cond.__and) return cond.__and.every((item) => matchCond(row, item))
  if (cond && cond.__or) return cond.__or.some((item) => matchCond(row, item))
  return Object.keys(cond).every((key) => {
    const want = cond[key]
    if (want instanceof RegExp) return want.test(String(row[key] == null ? '' : row[key]))
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
    limit: (n) => {
      result = result.slice(0, n)
      return query
    },
    get: async () => ({ data: result.slice() }),
    count: async () => ({ total: result.length }),
  }
  return query
}

function makeCollection(rows) {
  return {
    where: (cond) => makeQuery(rows.filter((row) => matchCond(row, cond))),
    doc: (id) => ({
      update: async (patch) => {
        const row = rows.find((item) => item._id === id)
        if (!row) return { updated: 0 }
        if (patch.student_no && patch.student_no === uniqueConflictNo) {
          throw new Error('duplicate key: users.student_no')
        }
        Object.assign(row, patch)
        return { updated: 1 }
      },
    }),
  }
}

global.uniCloud = {
  database: () => ({
    collection: (name) => makeCollection(name === 'whitelist' ? whitelist : users),
    command: {
      and: (list) => ({ __and: list }),
      or: (list) => ({ __or: list }),
      neq: (value) => ({ __neq: value }),
    },
  }),
  uploadFile: async () => ({ fileID: 'cloud://test/x.png' }),
  getTempFileURL: async () => ({ fileList: [] }),
}

/* ---------- 数据集（对应 dev 空间种子白名单） ---------- */
function makeUser(over) {
  seq += 1
  return {
    _id: `u-${seq}`,
    openid: `openid-${seq}-abcdefgh`,
    nickname: '',
    avatar: '',
    auth_status: 'unverified',
    status: 'normal',
    deleted: 0,
    created_at: new Date(2026, 8, 1),
    updated_at: new Date(2026, 8, 1),
    ...over,
  }
}

whitelist.push(
  { _id: 'w-1', student_no: '20260001', name: '林晨', college: '软件学院', major: '软件工程', batch_no: 'seed-demo' },
  { _id: 'w-2', student_no: '20260117', name: '苏晚晴', college: '经管学院', major: '会计学', batch_no: 'seed-demo' },
  { _id: 'w-3', student_no: '20260452', name: '何子轩', college: '计算机学院', major: '软件工程', batch_no: 'seed-demo' }
)

const u1 = makeUser({ nickname: '游客甲' })
const u2 = makeUser({ nickname: '游客乙' })
const u3 = makeUser({ nickname: '游客丙' })
const uDisabled = makeUser({ nickname: '被禁用', status: 'disabled' })
const uDeleted = makeUser({ nickname: '已注销', deleted: 1 })
users.push(u1, u2, u3, uDisabled, uDeleted)

const userFn = require('../uniCloud-aliyun/cloudfunctions/user/index.js')

function tokenOf(user) {
  return club.signToken({
    type: club.TOKEN_TYPES.STUDENT,
    token_kind: 'access',
    userId: user._id,
    openid: user.openid,
    auth_status: user.auth_status,
  })
}

async function call(path, body, token) {
  const headers = { 'content-type': 'application/json' }
  if (token) headers.authorization = `Bearer ${token}`
  return userFn.main({
    httpMethod: 'POST',
    path,
    headers,
    body: body ? JSON.stringify(body) : '',
    queryStringParameters: {},
  }).then((res) => ({ statusCode: res.statusCode, payload: JSON.parse(res.body) }))
}

async function main() {
  /* ---------- 1. 鉴权边界 ---------- */
  console.log('\n【鉴权边界】')
  let r = await call('/verify', { student_no: '20260001', name: '林晨' }, '')
  assert('无 token → 401', r.statusCode === 401 && r.payload.code === 401, JSON.stringify(r.payload))

  r = await call('/verify', { student_no: '20260001', name: '林晨' }, tokenOf(uDeleted))
  assert('已软删账号 → 401', r.statusCode === 401 && r.payload.code === 401, JSON.stringify(r.payload))

  r = await call('/verify', { student_no: '20260001', name: '林晨' }, tokenOf(uDisabled))
  assert('禁用账号 → 403', r.statusCode === 403 && r.payload.code === 403, JSON.stringify(r.payload))
  assert('禁用提示含「仅可浏览」', r.payload.message.includes('仅可浏览'), r.payload.message)

  /* ---------- 2. 参数校验 ---------- */
  console.log('\n【参数校验】')
  r = await call('/verify', { name: '林晨' }, tokenOf(u1))
  assert('缺学号 → 1001', r.payload.code === 1001 && r.payload.message.includes('student_no'), JSON.stringify(r.payload))

  r = await call('/verify', { student_no: '20260001' }, tokenOf(u1))
  assert('缺姓名 → 1001', r.payload.code === 1001 && r.payload.message.includes('name'), JSON.stringify(r.payload))

  r = await call('/verify', { student_no: 'ab', name: '林晨' }, tokenOf(u1))
  assert('学号格式非法 → 1001', r.payload.code === 1001 && r.payload.message.includes('格式'), JSON.stringify(r.payload))

  r = await call('/verify', { student_no: '20260001', name: '林'.repeat(21) }, tokenOf(u1))
  assert('姓名超长 → 1001', r.payload.code === 1001, JSON.stringify(r.payload))

  /* ---------- 3. 认证四分支 ---------- */
  console.log('\n【认证分支】')
  r = await call('/verify', { student_no: '99999999', name: '林晨' }, tokenOf(u1))
  assert('未命中白名单 → 2001（reason=not_found）', r.payload.code === 2001 && r.payload.data?.reason === 'not_found', JSON.stringify(r.payload))

  r = await call('/verify', { student_no: '20260001', name: '林小晨' }, tokenOf(u1))
  assert('姓名与学号不符 → 2001（reason=name_mismatch）', r.payload.code === 2001 && r.payload.data?.reason === 'name_mismatch', JSON.stringify(r.payload))

  r = await call('/verify', { student_no: '20260001', name: '林晨', college: '伪造学院' }, tokenOf(u1))
  assert('认证成功 → code=0', r.payload.code === 0, JSON.stringify(r.payload))
  assert('返回认证态 authStatus=authenticated', r.payload.data?.authStatus === 'authenticated', JSON.stringify(r.payload.data))
  assert('换发 token 且 payload.auth_status=verified', (() => {
    const payload = club.verifyToken(r.payload.data?.token)
    return !!payload && payload.auth_status === 'verified' && payload.token_kind === 'access'
  })(), JSON.stringify(r.payload.data?.token))
  assert('学籍字段取自白名单（忽略客户端传值）', (() => {
    const u = r.payload.data?.user
    return u.student_no === '20260001' && u.name === '林晨' && u.college === '软件学院' && u.major === '软件工程'
  })(), JSON.stringify(r.payload.data?.user))

  const bound = users.find((item) => item._id === u1._id)
  assert('users 已落盘 student_no/auth_status', bound.student_no === '20260001' && bound.auth_status === 'verified', JSON.stringify(bound))
  assert('已写 updated_at', bound.updated_at instanceof Date, typeof bound.updated_at)

  r = await call('/verify', { student_no: '20260117', name: '苏晚晴' }, tokenOf(u1))
  assert('已认证账号重复认证 → 1002', r.payload.code === 1002 && r.payload.message.includes('换绑'), JSON.stringify(r.payload))

  r = await call('/verify', { student_no: '20260001', name: '林晨' }, tokenOf(u2))
  assert('学号已被其他微信绑定 → 2001（reason=occupied）', r.payload.code === 2001 && r.payload.data?.reason === 'occupied', JSON.stringify(r.payload))
  assert('占用提示引导申诉', r.payload.message.includes('申诉'), r.payload.message)
  assert('占用时未污染他人绑定', users.find((i) => i._id === u1._id).student_no === '20260001')

  r = await call('/verify', { student_no: '20260117', name: '苏晚晴' }, tokenOf(u2))
  assert('另一学号可正常绑定（一微信一学号）', r.payload.code === 0 && users.find((i) => i._id === u2._id).student_no === '20260117', JSON.stringify(r.payload).slice(0, 200))

  /* ---------- 4. 唯一索引竞态兜底 ---------- */
  console.log('\n【唯一索引竞态】')
  uniqueConflictNo = '20260452'
  r = await call('/verify', { student_no: '20260452', name: '何子轩' }, tokenOf(u3))
  assert('写入瞬间被并发抢占 → 2001（reason=occupied）', r.payload.code === 2001 && r.payload.data?.reason === 'occupied', JSON.stringify(r.payload))
  assert('竞态失败未写入 student_no', (users.find((i) => i._id === u3._id).student_no || '') === '')
  uniqueConflictNo = ''

  /* ---------- 5. 认证态与账号态正交 ---------- */
  console.log('\n【状态正交】')
  r = await call('/verify', { student_no: '20260452', name: '何子轩' }, tokenOf(u3))
  assert('竞态开关复位后可正常绑定', r.payload.code === 0 && users.find((i) => i._id === u3._id).auth_status === 'verified', JSON.stringify(r.payload).slice(0, 200))

  u3.status = 'disabled'
  r = await call('/verify', { student_no: '20260452', name: '何子轩' }, tokenOf(u3))
  assert('已认证用户被禁用后写操作被拦截（403，先于 1002）', r.statusCode === 403 && r.payload.code === 403, JSON.stringify(r.payload))
  assert('禁用不影响既有认证态', users.find((i) => i._id === u3._id).auth_status === 'verified')

  u3.status = 'normal'
  r = await call('/verify', { student_no: '20260452', name: '何子轩' }, tokenOf(u3))
  assert('解封后已认证账号仍不可重复认证（1002）', r.payload.code === 1002, JSON.stringify(r.payload))

  console.log(`\n结果：${passed} 通过 / ${failed} 失败`)
  if (failed > 0) process.exitCode = 1
}

main().catch((e) => {
  console.error('用例执行异常：', e)
  process.exitCode = 1
})
