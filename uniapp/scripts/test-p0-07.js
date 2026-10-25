/**
 * P0-07 本地验收（离线，无需部署）
 * 覆盖：上传路由（JSON + base64）/ 场景与格式校验 / 体积越界 / 成功路径（stub uniCloud）
 *       规格一致性（前端 utils/upload.js 与云端 user/index.js 的 UPLOAD_SCENES 不得漂移）
 * 运行：node scripts/test-p0-07.js
 */
'use strict'
const fs = require('fs')
const path = require('path')

// 公共模块可解析：NODE_PATH 指向 cloudfunctions/common
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

/** 从上到下扫描出第一个完整的对象字面量（用于规格一致性比对） */
function extractObjectLiteral(source, marker) {
  const start = source.indexOf(marker)
  if (start === -1) return null
  const open = source.indexOf('{', start)
  let depth = 0
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    else if (source[i] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(open, i + 1)
    }
  }
  return null
}

function readSpec(file, marker) {
  const literal = extractObjectLiteral(fs.readFileSync(file, 'utf8'), marker)
  // eslint-disable-next-line no-eval
  return literal ? eval(`(${literal})`) : null
}

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('fake-png-body'),
])

function makeEvent(body) {
  return {
    httpMethod: 'POST',
    path: '/upload',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    queryStringParameters: {},
  }
}

;(async () => {
  console.log('P0-07 本地验收开始\n')

  /* ---------- 1. 规格一致性 ---------- */
  console.log('【规格一致性】')
  const clientSpec = readSpec(path.join(__dirname, '..', 'src', 'utils', 'upload.js'), 'UPLOAD_SCENES =')
  const serverSpec = readSpec(
    path.join(__dirname, '..', 'uniCloud-aliyun', 'cloudfunctions', 'user', 'index.js'),
    'UPLOAD_SCENES ='
  )
  const pick = (spec) => {
    const out = {}
    for (const key of Object.keys(spec || {})) {
      const s = spec[key]
      out[key] = { count: s.count, maxMB: s.maxMB, gifMaxMB: s.gifMaxMB, accept: s.accept }
    }
    return out
  }
  assert('前端与云端规格表结构一致', !!clientSpec && !!serverSpec)
  assert(
    'accept / maxMB / gifMaxMB 逐场景一致',
    JSON.stringify(pick(clientSpec)) === JSON.stringify(pick(serverSpec)),
    `\n    client=${JSON.stringify(pick(clientSpec))}\n    server=${JSON.stringify(pick(serverSpec))}`
  )

  /* ---------- 2. 扩展名归一 ---------- */
  console.log('\n【扩展名归一】')
  assert('由文件名取', club.fileExt('a.jpg', '') === 'jpg')
  assert('大小写归一', club.fileExt('A.PNG', '') === 'png')
  assert('回退 mime', club.fileExt('noext', 'image/webp') === 'webp')
  assert('无法识别返回空', club.fileExt('noext', 'text/plain') === '')

  /* ---------- 3. 上传路由（stub uniCloud） ---------- */
  console.log('\n【上传路由】')
  const uploads = []
  global.uniCloud = {
    // P1-02 起 /user/upload 走 requireActiveStudent，需回查 users（此处给「正常态」用户）
    database: () => ({
      collection: () => ({
        where: () => ({
          limit: () => ({ get: async () => ({ data: [{ _id: 'u-1', openid: 'o-1', status: 'normal', deleted: 0 }] }) }),
        }),
      }),
    }),
    uploadFile: async (opts) => {
      uploads.push(opts)
      return { fileID: `cloud://test/space/${opts.cloudPath}` }
    },
    getTempFileURL: async ({ fileList }) => ({
      fileList: fileList.map((id) => ({ fileID: id, tempFileURL: `https://cdn.example.com/${id.split('/').pop()}` })),
    }),
  }
  const user = require('../uniCloud-aliyun/cloudfunctions/user/index.js')
  const token = club.signToken({ type: 'student', token_kind: 'access', userId: 'u-1', openid: 'o-1' })

  async function call(body, withToken = true) {
    const event = makeEvent(body)
    if (withToken) event.headers.authorization = `Bearer ${token}`
    const res = await user.main(event)
    return { statusCode: res.statusCode, payload: JSON.parse(res.body) }
  }

  const ok = {
    scene: 'club_logo',
    filename: 'logo.png',
    mime: 'image/png',
    base64: PNG.toString('base64'),
  }

  let r = await call(ok, false)
  assert('未携带 token → 401', r.statusCode === 401 && r.payload.code === 401, JSON.stringify(r.payload))

  r = await call({ scene: 'club_logo' })
  assert('缺 base64 → 1001', r.payload.code === 1001, JSON.stringify(r.payload))

  r = await call({ ...ok, scene: 'bogus' })
  assert('场景不合法 → 1001', r.payload.code === 1001 && r.payload.message.includes('场景'), JSON.stringify(r.payload))

  r = await call({ ...ok, filename: 'a.txt', mime: 'text/plain' })
  assert('格式不符 → 1001', r.payload.code === 1001 && r.payload.message.includes('仅支持'), JSON.stringify(r.payload))

  r = await call({ ...ok, base64: '!!!!' })
  assert('base64 非法/为空 → 1001', r.payload.code === 1001, JSON.stringify(r.payload))

  const bigBase64 = Buffer.concat([PNG, Buffer.alloc(1024 * 1024)]).toString('base64')
  r = await call({ ...ok, base64: bigBase64 })
  assert('体积越界 → 1001', r.payload.code === 1001 && r.payload.message.includes('体积'), JSON.stringify(r.payload))

  uploads.length = 0
  r = await call(ok)
  assert('上传成功 → code=0', r.payload.code === 0, JSON.stringify(r.payload))
  assert(
    '返回可访问 URL',
    !!(r.payload.data && typeof r.payload.data.url === 'string' && r.payload.data.url.indexOf('https://') === 0),
    JSON.stringify(r.payload)
  )
  assert(
    '返回 fileID / size / ext / scene',
    !!(r.payload.data && r.payload.data.fileID && r.payload.data.size === PNG.length && r.payload.data.ext === 'png' && r.payload.data.scene === 'club_logo'),
    JSON.stringify(r.payload)
  )
  assert(
    'cloudPath 规则 clubhub/{scene}/{yyyymmdd}/{userId}-*',
    uploads.length === 1 && /^clubhub\/club_logo\/\d{8}\/u-1-\d+-[a-z0-9]+\.png$/.test(uploads[0].cloudPath),
    uploads[0] && uploads[0].cloudPath
  )
  assert('启用 cloudPathAsRealPath', uploads.length === 1 && uploads[0].cloudPathAsRealPath === true)

  console.log(`\nP0-07 本地验收：${passed} 通过 / ${failed} 失败`)
  process.exit(failed > 0 ? 1 : 0)
})().catch((e) => {
  console.error('测试执行异常：', e)
  process.exit(1)
})
