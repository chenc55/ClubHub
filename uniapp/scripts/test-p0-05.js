/**
 * P0-05 本地验收脚本（无需部署，直接驱动云函数 main 逻辑）
 * 运行：node scripts/test-p0-05.js（Windows 下自动注入 NODE_PATH）
 * 覆盖：统一格式 / 401 / 403 通道隔离 / 1001 参数校验 / 404 路由 / JWT 过期
 *
 * 注意：云函数内路由按「相对路径」注册（URL 化前缀由网关剥离后透传 event.path），
 * 故此处 event.path 传相对路径，例如 '/ping' 对应对外 GET /user/ping。
 */
'use strict'
const path = require('path')

// 公共模块可解析：NODE_PATH 指向 cloudfunctions/common
process.env.NODE_PATH = path.join(__dirname, '..', 'uniCloud-aliyun', 'cloudfunctions', 'common')
require('module').Module._initPaths()

const user = require('../uniCloud-aliyun/cloudfunctions/user/index.js')
const admin = require('../uniCloud-aliyun/cloudfunctions/admin/index.js')
const club = require('../uniCloud-aliyun/cloudfunctions/user/lib/club-common')

function makeEvent({ method = 'GET', path = '/', headers = {}, body = null, query = {} }) {
  return {
    httpMethod: method,
    path,
    headers,
    body: body === null ? '' : JSON.stringify(body),
    queryStringParameters: query,
    isBase64Encoded: false,
  }
}

async function call(mod, evt) {
  const res = await mod.main(evt)
  return { statusCode: res.statusCode, payload: JSON.parse(res.body) }
}

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

;(async () => {
  console.log('P0-05 本地验收开始\n')

  // 1. 公开 ping：统一格式 code=0
  let r = await call(user, makeEvent({ path: '/ping' }))
  assert('GET /user/ping → 200 & code=0 统一格式', r.statusCode === 200 && r.payload.code === 0, JSON.stringify(r.payload))
  assert('成功响应含 data 字段', 'data' in r.payload)

  // 2. 未认证访问受保护接口 → 401
  r = await call(user, makeEvent({ path: '/me' }))
  assert('GET /user/me 无 token → 401 且 code=401', r.statusCode === 401 && r.payload.code === 401, JSON.stringify(r.payload))

  // 3. 非法 token → 401
  r = await call(user, makeEvent({ path: '/me', headers: { authorization: 'Bearer bad.token.here' } }))
  assert('伪造 token → 401', r.statusCode === 401 && r.payload.code === 401)

  // 4. P0-06 已删除学生 demo-login；回归测试本地签发隔离夹具。
  r = await call(user, makeEvent({ method: 'POST', path: '/demo-login', body: { nickname: '测试学员' } }))
  assert('POST /user/demo-login 已移除 → 404', r.payload.code === 404)
  const studentToken = club.signToken({ type: 'student', token_kind: 'access', userId: 'test-student', openid: 'test-openid' })

  // 5. 学生 token 访问学生接口 → 通过
  r = await call(user, makeEvent({ path: '/me', headers: { authorization: `Bearer ${studentToken}` } }))
  assert('学生 token GET /user/me → code=0，payload.type=student', r.payload.code === 0 && r.payload.data.type === 'student', JSON.stringify(r.payload))

  // 6. 学生 token 访问管理域 → 403 通道隔离
  r = await call(admin, makeEvent({ path: '/dashboard-example', headers: { authorization: `Bearer ${studentToken}` } }))
  assert('学生 token 调管理域 → 403', r.statusCode === 403 && r.payload.code === 403, JSON.stringify(r.payload))

  // 7. P0-09 已删除管理端 demo-login；回归测试本地签发管理通道夹具
  r = await call(admin, makeEvent({ method: 'POST', path: '/demo-login', body: { role: 'auditor' } }))
  assert('POST /admin/demo-login 已移除 → 404', r.payload.code === 404)
  const adminToken = club.signToken({ type: 'admin', adminId: 'test-admin', role: 'auditor' })
  r = await call(admin, makeEvent({ path: '/dashboard-example', headers: { authorization: `Bearer ${adminToken}` } }))
  assert('管理员 token 调管理域 → code=0 且 role=auditor', r.payload.code === 0 && r.payload.data.auth.role === 'auditor', JSON.stringify(r.payload))

  // 8. 管理员 token 访问学生域 → 403
  r = await call(user, makeEvent({ path: '/me', headers: { authorization: `Bearer ${adminToken}` } }))
  assert('管理员 token 调学生域 → 403', r.statusCode === 403 && r.payload.code === 403)

  // 9. 参数校验：缺 name → 1001
  r = await call(user, makeEvent({ method: 'POST', path: '/demo-validate', body: { age: 20 } }))
  assert('缺 required 参数 → code=1001 含字段名', r.statusCode === 200 && r.payload.code === 1001 && r.payload.message.includes('name'), r.payload.message)

  // 10. 参数校验：enum/类型
  r = await call(user, makeEvent({ method: 'POST', path: '/demo-validate', body: { name: '张三', age: 'x' } }))
  assert('参数类型非法 → code=1001', r.payload.code === 1001)

  // 11. 参数合法 → 通过
  r = await call(user, makeEvent({ method: 'POST', path: '/demo-validate', body: { name: '张三', age: 20 } }))
  assert('参数合法 → code=0 且回显', r.payload.code === 0 && r.payload.data.name === '张三')

  // 12. 未知路由 → 404
  r = await call(user, makeEvent({ path: '/not-exist' }))
  assert('未知路由 → 404', r.statusCode === 404 && r.payload.code === 404)

  // 13. body 非法 JSON → 400
  {
    const evt = { httpMethod: 'POST', path: '/demo-validate', headers: {}, body: '{bad json', queryStringParameters: {} }
    const res = await user.main(evt)
    assert('非法 JSON body → 400', res.statusCode === 400 && JSON.parse(res.body).code === 400)
  }

  console.log(`\nP0-05 本地验收：${passed} 通过 / ${failed} 失败`)
  process.exit(failed > 0 ? 1 : 0)
})().catch((e) => {
  console.error('测试执行异常：', e)
  process.exit(1)
})
