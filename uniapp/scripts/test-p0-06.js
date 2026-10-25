/**
 * P0-06 本地验收：登录游客态、users upsert 降级、学生 token、刷新 token、过期 token。
 * 运行：node scripts/test-p0-06.js
 */
'use strict'
const path = require('path')
process.env.CLUBHUB_JWT_SECRET = 'clubhub-offline-test-fixture-only'
process.env.NODE_PATH = path.join(__dirname, '..', 'uniCloud-aliyun', 'cloudfunctions', 'common')
require('module').Module._initPaths()

const user = require('../uniCloud-aliyun/cloudfunctions/user/index.js')
const club = require('../uniCloud-aliyun/cloudfunctions/user/lib/club-common.js')

function event({ method = 'GET', path = '/', headers = {}, body = null }) {
  return { httpMethod: method, path, headers, body: body === null ? '' : JSON.stringify(body), queryStringParameters: {} }
}

async function call(evt) {
  const res = await user.main(evt)
  return { statusCode: res.statusCode, payload: JSON.parse(res.body) }
}

let passed = 0
let failed = 0
function assert(name, ok, detail = '') {
  if (ok) { passed++; console.log(`  ✔ ${name}`) }
  else { failed++; console.log(`  ✘ ${name} ${detail}`) }
}

;(async () => {
  console.log('P0-06 本地验收开始\n')
  let r = await call(event({ method: 'POST', path: '/login', body: { code: 'local-code-001', nickname: '测试访客' } }))
  assert('登录返回 200/code=0', r.statusCode === 200 && r.payload.code === 0, JSON.stringify(r.payload))
  assert('返回游客态用户与 refresh_token', r.payload.data.authStatus === 'guest' && !!r.payload.data.user && !!r.payload.data.refresh_token)
  const token = r.payload.data.token
  const refresh = r.payload.data.refresh_token

  r = await call(event({ path: '/me', headers: { authorization: `Bearer ${token}` } }))
  assert('游客会话仍可通过学生 token 鉴权', r.statusCode === 200 && r.payload.code === 0 && r.payload.data.openid, JSON.stringify(r.payload))

  r = await call(event({ method: 'POST', path: '/session/refresh', body: { refresh_token: refresh } }))
  assert('refresh_token 可换取新 access token', r.statusCode === 200 && r.payload.code === 0 && !!r.payload.data.token)

  r = await call(event({ method: 'POST', path: '/login', body: {} }))
  assert('缺少 code/openid 返回 1001', r.payload.code === 1001)

  r = await call(event({ method: 'POST', path: '/login', body: { openid: 'client-forged-openid' } }))
  assert('客户端直传 openid 被拒绝', r.payload.code === 1001)

  r = await call(event({ method: 'POST', path: '/session/refresh', body: { refresh_token: token } }))
  assert('access token 不能充当 refresh_token', r.statusCode === 401 && r.payload.code === 401)

  const expired = club.signToken({ type: club.TOKEN_TYPES.STUDENT, userId: 'expired', token_kind: 'access' }, -1)
  r = await call(event({ path: '/me', headers: { authorization: `Bearer ${expired}` } }))
  assert('过期 access token 返回 401', r.statusCode === 401 && r.payload.code === 401, JSON.stringify(r.payload))

  r = await call(event({ method: 'POST', path: '/session/refresh', body: { refresh_token: 'bad-token' } }))
  assert('非法 refresh_token 返回 401', r.statusCode === 401 && r.payload.code === 401)

  console.log(`\nP0-06 本地验收：${passed} 通过 / ${failed} 失败`)
  process.exit(failed ? 1 : 0)
})().catch((err) => { console.error(err); process.exit(1) })
