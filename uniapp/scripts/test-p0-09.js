/**
 * P0-09 本地验收（离线，无需部署）
 * 覆盖：验证码签发与校验 / 连续失败 5 次锁定 15 分钟 / 锁定期间拒绝正确密码 / 到期自动解锁 /
 *       验证码错误不计失败次数 / 禁用账号拒绝登录 / 登录成功更新 last_login_at 并清计数 /
 *       会话校验 / 通道隔离 / demo-login 已移除
 * 运行：node scripts/test-p0-09.js
 */
'use strict'
const path = require('path')

process.env.NODE_PATH = path.join(__dirname, '..', 'uniCloud-aliyun', 'cloudfunctions', 'common')
require('module').Module._initPaths()
// 统一密钥：stub 出 uniCloud 后 jwtSecret() 会要求环境变量
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

/* ---------- admins 集合 stub（含种子超管账号的真实哈希） ---------- */
const SEED_SALT = 'portfolio_fixture_2026'
const SEED_PASSWORD = 'DemoOnly@2026'
const SEED_HASH = 'sha256$portfolio_fixture_2026$eac0a49a4b43d6292ac0effbeda4cfa44788ac655adb0907df295292fd5b1386'

let rows = []
function resetRows() {
  rows = [
    {
      _id: 'admin-1',
      username: 'admin',
      password_hash: SEED_HASH,
      role: 'super',
      name: '社联管理员',
      status: 'normal',
      failed_attempts: 0,
      created_at: 1789344000000,
      deleted: 0,
    },
    {
      _id: 'admin-2',
      username: 'blocked',
      password_hash: SEED_HASH,
      role: 'auditor',
      name: '已禁用审核员',
      status: 'disabled',
      failed_attempts: 0,
      created_at: 1789344000000,
      deleted: 0,
    },
  ]
}
resetRows()

function matchRow(row, cond) {
  return Object.keys(cond).every((key) => {
    const want = cond[key]
    const got = row[key]
    if (want instanceof Date) return new Date(got).getTime() === want.getTime()
    return got === want
  })
}

global.uniCloud = {
  database: () => ({
    collection: () => ({
      where: (cond) => ({
        limit: () => ({ get: async () => ({ data: rows.filter((r) => matchRow(r, cond)) }) }),
      }),
      doc: (id) => ({
        update: async (patch) => {
          const row = rows.find((r) => r._id === id)
          if (row) Object.assign(row, patch)
          return { updated: row ? 1 : 0 }
        },
      }),
    }),
  }),
}

const adminFn = require('../uniCloud-aliyun/cloudfunctions/admin/index.js')

function makeEvent({ method = 'POST', p = '/login', body = null, token = '' }) {
  const headers = { 'content-type': 'application/json' }
  if (token) headers.authorization = `Bearer ${token}`
  return {
    httpMethod: method,
    path: p,
    headers,
    body: body ? JSON.stringify(body) : '',
    queryStringParameters: {},
  }
}

async function call(evt) {
  const res = await adminFn.main(evt)
  return { statusCode: res.statusCode, payload: JSON.parse(res.body) }
}

/** 从验证码 SVG（base64）里解出字符——顺带印证「SVG 文本可被程序读取」的局限 */
function decodeCaptcha(imageDataUrl) {
  const base64 = String(imageDataUrl).split(',')[1] || ''
  const svg = Buffer.from(base64, 'base64').toString('utf8')
  const chars = []
  const re = /<text[^>]*>([^<])<\/text>/g
  let m = re.exec(svg)
  while (m) {
    chars.push(m[1])
    m = re.exec(svg)
  }
  return chars.join('')
}

async function getCaptcha() {
  const res = await call(makeEvent({ method: 'GET', p: '/captcha' }))
  return { ...res.payload.data, code: decodeCaptcha(res.payload.data.image) }
}

async function login(overrides = {}) {
  const captcha = await getCaptcha()
  return call(
    makeEvent({
      body: {
        username: 'admin',
        password: SEED_PASSWORD,
        captcha_id: captcha.captcha_id,
        captcha_code: captcha.code,
        ...overrides,
      },
    })
  )
}

;(async () => {
  console.log('P0-09 本地验收开始\n')

  /* ---------- 1. 验证码 ---------- */
  console.log('【图形验证码】')
  let cap = await getCaptcha()
  assert('签发验证码：返回 captcha_id / image / expires_in', !!cap.captcha_id && !!cap.image && cap.expires_in === 120)
  assert('image 为 SVG data URL', String(cap.image).indexOf('data:image/svg+xml;base64,') === 0)
  assert('验证码为 4 位字符', cap.code.length === 4, cap.code)

  let r = await login({ captcha_code: 'XXXX' })
  assert('验证码错误 → 1001 且提示重新输入', r.payload.code === 1001 && r.payload.message.includes('验证码'), JSON.stringify(r.payload))

  r = await login({ captcha_code: cap.code })
  assert('验证码错误不产生失败计数（failed_attempts 仍为 0）', Number(rows[0].failed_attempts || 0) === 0, String(rows[0].failed_attempts))

  /* ---------- 2. 登录成功 ---------- */
  console.log('\n【登录成功】')
  resetRows()
  r = await login()
  assert('种子超管登录成功 → code=0', r.payload.code === 0, JSON.stringify(r.payload))
  assert('返回 token / expires_in=7200', !!r.payload.data.token && r.payload.data.expires_in === 7200)
  assert('token 通道为 admin 且 role=super', club.verifyToken(r.payload.data.token).type === 'admin' && club.verifyToken(r.payload.data.token).role === 'super')
  assert('更新 last_login_at', !!rows[0].last_login_at, JSON.stringify(rows[0].last_login_at))
  const adminToken = r.payload.data.token

  /* ---------- 3. 连续失败 5 次锁定 ---------- */
  console.log('\n【失败锁定】')
  resetRows()
  const messages = []
  for (let i = 1; i <= 4; i += 1) {
    const res = await login({ password: 'wrong-password' })
    messages.push(res.payload.message)
  }
  assert('第 1~4 次失败 → 401 并提示剩余次数', messages[0].includes('还可尝试 4 次') && messages[3].includes('还可尝试 1 次'), messages.join(' | '))
  assert('4 次后 failed_attempts=4 且未锁定', Number(rows[0].failed_attempts) === 4 && !rows[0].locked_until)

  let locked = await login({ password: 'wrong-password' })
  assert('第 5 次失败 → 1002 并锁定 15 分钟', locked.payload.code === 1002 && locked.payload.message.includes('锁定'), JSON.stringify(locked.payload))
  const lockedUntilMs = new Date(rows[0].locked_until).getTime()
  const expectMs = Date.now() + 15 * 60 * 1000
  assert('锁定截止时间≈15 分钟后', Math.abs(lockedUntilMs - expectMs) < 5000, `${lockedUntilMs} vs ${expectMs}`)

  r = await login()
  assert('锁定期间即使密码正确也拒绝', r.payload.code === 1002 && r.payload.message.includes('已锁定'), JSON.stringify(r.payload))

  /* ---------- 4. 到期自动解锁 ---------- */
  console.log('\n【到期自动解锁】')
  rows[0].locked_until = new Date(Date.now() - 1000)
  r = await login()
  assert('锁定到期后正确密码可登录', r.payload.code === 0, JSON.stringify(r.payload))
  assert('解锁后失败计数清零、locked_until 清空', Number(rows[0].failed_attempts) === 0 && !rows[0].locked_until, JSON.stringify({ f: rows[0].failed_attempts, l: rows[0].locked_until }))

  /* ---------- 5. 禁用账号 ---------- */
  console.log('\n【禁用账号】')
  r = await call(
    makeEvent({
      body: {
        username: 'blocked',
        password: SEED_PASSWORD,
        captcha_id: (await getCaptcha()).captcha_id,
        captcha_code: 'XXXX',
      },
    })
  )
  assert('验证码先于账号状态校验（错误验证码 → 1001）', r.payload.code === 1001, JSON.stringify(r.payload))
  const cap2 = await getCaptcha()
  r = await call(
    makeEvent({
      body: { username: 'blocked', password: SEED_PASSWORD, captcha_id: cap2.captcha_id, captcha_code: cap2.code },
    })
  )
  assert('禁用账号 → 403 且提示原因', r.statusCode === 403 && r.payload.message.includes('禁用'), JSON.stringify(r.payload))

  r = await call(
    makeEvent({
      body: { username: 'ghost', password: SEED_PASSWORD, captcha_id: cap2.captcha_id, captcha_code: cap2.code },
    })
  )
  assert('账号不存在 → 401 账号或密码错误', r.statusCode === 401 && r.payload.message === '账号或密码错误', JSON.stringify(r.payload))

  /* ---------- 6. 会话校验 ---------- */
  console.log('\n【会话校验】')
  resetRows()
  r = await call(makeEvent({ method: 'GET', p: '/session', token: adminToken }))
  assert('有效 token → 200 且返回管理员信息', r.payload.code === 0 && r.payload.data.admin.username === 'admin', JSON.stringify(r.payload))
  assert('返回 expires_at', typeof r.payload.data.expires_at === 'number' && r.payload.data.expires_at > Date.now())

  r = await call(makeEvent({ method: 'GET', p: '/session' }))
  assert('无 token → 401', r.statusCode === 401)

  const studentToken = club.signToken({ type: 'student', token_kind: 'access', userId: 'u-1', openid: 'o-1' })
  r = await call(makeEvent({ method: 'GET', p: '/session', token: studentToken }))
  assert('学生 token 调管理域 → 403 通道不匹配', r.statusCode === 403, JSON.stringify(r.payload))

  /* ---------- 7. 会话超时（token 过期） ---------- */
  console.log('\n【会话超时】')
  const expired = club.signToken({ type: 'admin', adminId: 'admin-1', role: 'super' }, -10)
  r = await call(makeEvent({ method: 'GET', p: '/session', token: expired }))
  assert('过期 token → 401（前端据此登出跳登录页）', r.statusCode === 401, JSON.stringify(r.payload))

  /* ---------- 8. demo-login 已移除 ---------- */
  console.log('\n【清理 P0-05 临时接口】')
  r = await call(makeEvent({ p: '/demo-login' }))
  assert('POST /admin/demo-login → 404', r.statusCode === 404 && r.payload.code === 404, JSON.stringify(r.payload))

  console.log(`\nP0-09 本地验收：${passed} 通过 / ${failed} 失败`)
  process.exit(failed > 0 ? 1 : 0)
})().catch((e) => {
  console.error('测试执行异常：', e)
  process.exit(1)
})
