/**
 * P1-04 本地验收（离线，无需部署）
 * 覆盖：场景表与订阅时机一致性守卫 / 站内消息必写 / 去重（含唯一索引竞态）/
 *       订阅消息下发成功与各类降级（模板未配置、无凭据、无 openid、用户拒绝、模板错误、token 失败）/
 *       access_token 缓存 / 模板字段截断与页面路径渲染 / 自检接口鉴权与参数校验
 * 运行：node scripts/test-p1-04.js
 */
'use strict'
const fs = require('fs')
const path = require('path')

process.env.NODE_PATH = path.join(__dirname, '..', 'uniCloud-aliyun', 'cloudfunctions', 'common')
require('module').Module._initPaths()
process.env.CLUBHUB_JWT_SECRET = 'clubhub-test-secret'

const notify = require('../uniCloud-aliyun/cloudfunctions/common/notify')

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

/* ---------- 集合 stub（含 messages 唯一索引语义） ---------- */
let seq = 0
let messages = []
let users = []
/** 竞态开关：模拟「预查重之后、写入之前」被并发写入 */
let conflictOnAdd = false
/** 微信接口响应开关 */
let tokenResponse = { access_token: 'TOKEN-001', expires_in: 7200 }
let sendResponse = { errcode: 0, errmsg: 'ok' }
let tokenCalls = 0
let sendCalls = []

function matchCond(row, cond) {
  return Object.keys(cond).every((key) => row[key] === cond[key])
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
        const av = new Date(a[field]).getTime()
        const bv = new Date(b[field]).getTime()
        return dir === 'desc' ? bv - av : av - bv
      })
      return query
    },
    limit: (n) => {
      result = result.slice(0, n)
      return query
    },
    get: async () => ({ data: result.slice() }),
  }
  return query
}

function dupKey(doc) {
  return `${doc.user_id}|${doc.scene}|${doc.biz_id}`
}

const messagesCollection = {
  where: (cond) => makeQuery(messages.filter((row) => matchCond(row, cond))),
  add: async (doc) => {
    const list = Array.isArray(doc) ? doc : [doc]
    if (conflictOnAdd) throw new Error('duplicate key: user_scene_biz_unique')
    for (const item of list) {
      if (messages.some((row) => dupKey(row) === dupKey(item))) {
        throw new Error('duplicate key: user_scene_biz_unique')
      }
    }
    let lastId = ''
    list.forEach((item) => {
      lastId = `m-${++seq}`
      messages.push({ _id: lastId, ...item })
    })
    return { id: lastId, inserted: list.length }
  },
  doc: (id) => ({
    update: async (patch) => {
      const row = messages.find((item) => item._id === id)
      if (!row) return { updated: 0 }
      Object.assign(row, patch)
      return { updated: 1 }
    },
  }),
}

global.uniCloud = {
  database: () => ({
    collection: (name) => name === 'admins' ? require('./helpers/admin-fixtures').adminCollection() : (name === 'users' ? { where: (cond) => makeQuery(users.filter((row) => matchCond(row, cond))) } : messagesCollection),
    command: {},
  }),
  httpclient: {
    request: async (url, options) => {
      if (String(url).indexOf('/cgi-bin/token') !== -1) {
        tokenCalls += 1
        return { data: tokenResponse }
      }
      sendCalls.push(options.data)
      return { data: sendResponse }
    },
  },
}

const messageFn = require('../uniCloud-aliyun/cloudfunctions/message/index.js')
const club = require('../uniCloud-aliyun/cloudfunctions/common/club-common')

const superToken = club.signToken({ type: 'admin', adminId: 'a-1', username: 'root', role: 'super' })
const auditorToken = club.signToken({ type: 'admin', adminId: 'a-2', username: 'audit', role: 'auditor' })
const studentToken = club.signToken({ type: 'student', token_kind: 'access', userId: 'u-1', openid: 'o-1' })
const adminFnToken = club.signToken({ type: 'admin', adminId: 'a-3', username: 'x', role: 'viewer' })

function resetEnv(extra = {}) {
  Object.keys(process.env)
    .filter((key) => key.indexOf('WX_TPL_') === 0)
    .forEach((key) => delete process.env[key])
  delete process.env.WX_APPID
  delete process.env.WX_SECRET
  delete process.env.WX_MINIPROGRAM_STATE
  Object.assign(process.env, extra)
  notify.clearTokenCache()
}

async function callMessage(path, body, token) {
  const headers = { 'content-type': 'application/json' }
  if (token) headers.authorization = `Bearer ${token}`
  const res = await messageFn.main({
    httpMethod: body === null ? 'GET' : 'POST',
    path,
    headers,
    body: body === null ? '' : JSON.stringify(body),
    queryStringParameters: {},
  })
  return { statusCode: res.statusCode, payload: JSON.parse(res.body) }
}

async function main() {
  /* 订阅消息下发所需的完整环境（模板 ID + 小程序凭据） */
  const PUSH_ENV = {
    WX_TPL_ACTIVITY_SIGNUP: 'TPL-SIGNUP',
    WX_TPL_ACTIVITY_RESULT: 'TPL-RESULT',
    WX_APPID: 'wx-app',
    WX_SECRET: 'wx-secret',
  }

  /* ---------- 1. 场景表与订阅时机守卫 ---------- */
  console.log('\n【场景表与订阅时机】')
  const scenes = Object.keys(notify.SCENES)
  assert('场景清单 = 需求 2.4 的 10 个 + P1-06 社团入驻 2 个 + P1-10 活动结束 1 个 + P1-18 面试拆分 1 个 + P1-26 动态下架 1 个 + P3-02 注销 1 个', scenes.length === 16, scenes.join(','))
  assert('社团入驻场景按结果拆分且共用同一模板变量（biz_type=club）',
    notify.SCENES.club_apply_approved && notify.SCENES.club_apply_rejected &&
    notify.SCENES.club_apply_approved.biz_type === 'club' && notify.SCENES.club_apply_rejected.biz_type === 'club' &&
    notify.SCENES.club_apply_approved.templateEnv === 'WX_TPL_CLUB_APPLY' &&
    notify.SCENES.club_apply_rejected.templateEnv === 'WX_TPL_CLUB_APPLY',
    JSON.stringify(Object.keys(notify.SCENES).filter((s) => s.indexOf('club_apply') === 0)))
  assert('每个场景字段完整', scenes.every((s) => {
    const c = notify.SCENES[s]
    return c.type && c.biz_type && c.title && c.content && c.templateEnv && c.wechat && c.wechat.length
  }), JSON.stringify(notify.listScenes().filter((s) => !s.type)))
  assert('站内类型取值合法', scenes.every((s) => ['system', 'activity', 'recruitment'].indexOf(notify.SCENES[s].type) !== -1))
  assert('业务类型取值合法', scenes.every((s) => ['activity', 'recruitment', 'announcement', 'appeal', 'club', 'post', 'deletion'].indexOf(notify.SCENES[s].biz_type) !== -1))

  const moments = notify.SUBSCRIBE_MOMENTS
  assert('四个订阅授权时机齐备', Object.keys(moments).length === 4, Object.keys(moments).join(','))
  assert('时机内模板均存在于场景表', Object.keys(moments).every((m) =>
    moments[m].every((env) => scenes.some((s) => notify.SCENES[s].templateEnv === env))
  ), JSON.stringify(moments))

  const configText = fs.readFileSync(path.join(__dirname, '..', 'src', 'utils', 'config.js'), 'utf8')
  const frontendEnvs = new Set(configText.match(/WX_TPL_[A-Z_]+/g) || [])
  const backendEnvs = new Set(Object.keys(notify.SCENES).map((s) => notify.SCENES[s].templateEnv))
  assert('前后端模板环境变量一致（前端 config 无多余项）',
    [...frontendEnvs].every((env) => backendEnvs.has(env)), [...frontendEnvs].join(','))
  assert('前后端模板环境变量一致（后端无遗漏项）',
    [...backendEnvs].every((env) => frontendEnvs.has(env)), [...backendEnvs].join(','))
  assert('前端订阅时机键与后端一致',
    Object.keys(moments).every((m) => configText.indexOf(`${m}: [`) !== -1), Object.keys(moments).join(','))

  const subscribeText = fs.readFileSync(path.join(__dirname, '..', 'src', 'utils', 'subscribe.js'), 'utf8')
  assert('订阅封装含四时机说明与 requestSubscribe 导出',
    subscribeText.indexOf('requestSubscribe') !== -1 && subscribeText.indexOf('activity_signup') !== -1 &&
    subscribeText.indexOf('recruitment_signup') !== -1 && subscribeText.indexOf('appeal_submit') !== -1 &&
    subscribeText.indexOf('club_review_submit') !== -1)

  /* ---------- 2. 站内消息必写 + 去重 ---------- */
  console.log('\n【站内消息与去重】')
  resetEnv()
  messages = []
  users = [{ _id: 'u-1', openid: 'o-1', deleted: 0 }]

  const vars = {
    activity_title: '迎新杯篮球赛',
    activity_time: '2026-10-08 15:00',
    activity_place: '东区体育馆',
    activity_id: 'act-1',
  }
  let r = await notify.send({ userId: 'u-1', scene: 'activity_signup_success', bizId: 'act-1', vars })
  assert('返回 message_id 且非重复', !!r.message_id && r.duplicate === false, JSON.stringify(r))
  assert('无模板时降级为仅站内', r.push_status === 'site_only' && r.reason === 'template_missing' && r.channel === 'site_only', JSON.stringify(r))

  const row = messages[0]
  assert('站内消息字段完整（含 scene / biz_type / biz_id）',
    row.user_id === 'u-1' && row.type === 'activity' && row.scene === 'activity_signup_success' &&
    row.biz_type === 'activity' && row.biz_id === 'act-1' && row.is_read === false && row.deleted === 0 &&
    row.created_at instanceof Date, JSON.stringify(row))
  assert('文案变量已渲染', row.title === '报名成功：迎新杯篮球赛' && row.content.indexOf('东区体育馆') !== -1, row.title + '|' + row.content)

  r = await notify.send({ userId: 'u-1', scene: 'activity_signup_success', bizId: 'act-1', vars })
  assert('同事件同业务去重 → duplicate', r.duplicate === true && r.reason === 'duplicate', JSON.stringify(r))
  assert('去重未新增记录', messages.length === 1, String(messages.length))

  r = await notify.send({ userId: 'u-1', scene: 'activity_reminder', bizId: 'act-1', vars })
  assert('同业务不同场景可分别推送', r.duplicate === false && messages.length === 2, JSON.stringify(r))

  users.push({ _id: 'u-2', openid: 'o-2', deleted: 0 })
  r = await notify.send({ userId: 'u-2', scene: 'activity_signup_success', bizId: 'act-1', vars })
  assert('不同用户同事件可分别推送', r.duplicate === false && messages.length === 3, JSON.stringify(r))

  r = await notify.send({ userId: 'u-1', scene: 'announcement_published', vars: { announcement_title: '国庆放假通知', announcement_summary: '详见正文', announcement_id: 'ann-1' } })
  r = await notify.send({ userId: 'u-1', scene: 'announcement_published', vars: { announcement_title: '国庆放假通知', announcement_summary: '详见正文', announcement_id: 'ann-1' } })
  assert('biz_id 缺省时按空串去重', r.duplicate === true && messages.filter((m) => m.scene === 'announcement_published').length === 1, JSON.stringify(r))

  conflictOnAdd = true
  r = await notify.send({ userId: 'u-1', scene: 'activity_signup_result', bizId: 'act-9', vars: { activity_title: 'X', result: '已通过', result_text: '已通过', reason: '', reason_text: '' } })
  assert('唯一索引并发兜底 → duplicate（不抛错）', r.duplicate === true && r.reason === 'duplicate', JSON.stringify(r))
  conflictOnAdd = false

  /* ---------- 3. 订阅消息下发 ---------- */
  console.log('\n【订阅消息下发】')
  resetEnv(PUSH_ENV)
  messages = []
  sendCalls = []
  tokenCalls = 0

  r = await notify.send({ userId: 'u-1', scene: 'activity_signup_success', bizId: 'act-1', vars })
  assert('推送成功 → push_status=sent / channel=both', r.pushed === true && r.push_status === 'sent' && r.channel === 'both', JSON.stringify(r))
  assert('落库回写 sent + pushed_at', messages[0].push_status === 'sent' && messages[0].pushed_at instanceof Date, JSON.stringify(messages[0]))
  assert('模板 data 按场景表组装（thing/time/thing）',
    sendCalls[0].data.thing1.value === '迎新杯篮球赛' && sendCalls[0].data.time2.value === '2026-10-08 15:00' && sendCalls[0].data.thing3.value === '东区体育馆',
    JSON.stringify(sendCalls[0].data))
  assert('点击跳转 page 已渲染业务 ID', sendCalls[0].page === 'pages/subpages/activity-detail/index?id=act-1', sendCalls[0].page)
  assert('touser 取用户 openid', sendCalls[0].touser === 'o-1')
  assert('miniprogram_state 默认 formal', sendCalls[0].miniprogram_state === 'formal', sendCalls[0].miniprogram_state)

  r = await notify.send({ userId: 'u-1', scene: 'activity_reminder', bizId: 'act-1', vars })
  assert('access_token 进程内缓存（第二次不再取 token）', tokenCalls === 1, `tokenCalls=${tokenCalls}`)

  process.env.WX_MINIPROGRAM_STATE = 'developer'
  r = await notify.send({ userId: 'u-1', scene: 'activity_signup_waitlist', bizId: 'act-2', vars })
  assert('miniprogram_state 可由环境变量覆盖', sendCalls[sendCalls.length - 1].miniprogram_state === 'developer', sendCalls[sendCalls.length - 1].miniprogram_state)

  sendResponse = { errcode: 43101, errmsg: 'user refuse to accept the msg' }
  r = await notify.send({ userId: 'u-1', scene: 'activity_signup_result', bizId: 'act-3', vars: { activity_title: 'X', result: '已通过', result_text: '已通过', reason: '', reason_text: '' } })
  assert('用户拒绝/无额度 → skipped 且不抛错', r.push_status === 'skipped' && r.pushed === false, JSON.stringify(r))
  assert('skipped 记录 push_error', String(messages[messages.length - 1].push_error).indexOf('43101') === 0, messages[messages.length - 1].push_error)
  assert('skipped 时站内消息仍已写入', messages[messages.length - 1].title.indexOf('报名审核结果') === 0, messages[messages.length - 1].title)

  sendResponse = { errcode: 40037, errmsg: 'invalid template_id' }
  r = await notify.send({ userId: 'u-1', scene: 'activity_waitlist_promoted', bizId: 'act-4', vars })
  assert('模板/参数错误 → failed 且记录原因', r.push_status === 'failed' && String(messages[messages.length - 1].push_error).indexOf('40037') === 0, JSON.stringify(r))

  resetEnv({ WX_TPL_ACTIVITY_SIGNUP: 'TPL-SIGNUP' })
  r = await notify.send({ userId: 'u-1', scene: 'activity_signup_success', bizId: 'act-5', vars })
  assert('缺微信凭据 → site_only（wechat_credential_missing）', r.push_status === 'site_only' && r.reason === 'wechat_credential_missing', JSON.stringify(r))

  resetEnv(PUSH_ENV)
  users = [{ _id: 'u-1', openid: '', deleted: 0 }]
  r = await notify.send({ userId: 'u-1', scene: 'activity_signup_success', bizId: 'act-6', vars })
  assert('用户无 openid → site_only', r.push_status === 'site_only' && r.reason === 'openid_missing', JSON.stringify(r))

  users = [{ _id: 'u-1', openid: 'o-1', deleted: 0 }]
  tokenResponse = { errcode: 40001, errmsg: 'invalid credential' }
  notify.clearTokenCache()
  r = await notify.send({ userId: 'u-1', scene: 'activity_signup_success', bizId: 'act-7', vars })
  assert('access_token 获取失败 → failed 且不抛错', r.push_status === 'failed' && String(r.reason).indexOf('access_token') === 0, JSON.stringify(r))
  tokenResponse = { access_token: 'TOKEN-001', expires_in: 7200 }

  /* ---------- 4. 模板字段截断 ---------- */
  console.log('\n【模板字段截断】')
  resetEnv(PUSH_ENV)
  notify.clearTokenCache()
  sendCalls = []
  const longTitle = '这是一个非常非常长的活动名称用于验证微信模板字段截断行为是否生效'
  await notify.send({
    userId: 'u-1',
    scene: 'activity_signup_result',
    bizId: 'act-8',
    vars: { activity_title: longTitle, result: '已通过', result_text: '已通过', reason: '材料不齐', reason_text: '驳回理由：材料不齐' },
  })
  const sent = sendCalls[sendCalls.length - 1]
  assert('thing 字段截断至 20 字', sent.data.thing1.value.length === 20, String(sent.data.thing1.value.length))
  assert('phrase 字段按 5 字上限截断', sent.data.phrase2.value === '已通过', sent.data.phrase2.value)
  assert('站内 content 保留完整文案（不截断）',
    messages[messages.length - 1].content.indexOf('驳回理由：材料不齐') !== -1, messages[messages.length - 1].content)

  /* ---------- 5. 异常与自检接口 ---------- */
  console.log('\n【异常与自检接口】')
  let threw = ''
  try {
    await notify.send({ userId: 'u-1', scene: 'not_exist_scene', bizId: 'x' })
  } catch (e) {
    threw = String(e && e.message)
  }
  assert('未知场景直接抛错（不静默吞掉）', threw.indexOf('unknown notify scene') === 0, threw)

  let res = await callMessage('/scenes', null, '')
  assert('GET /message/scenes 无 token → 401', res.statusCode === 401 && res.payload.code === 401, JSON.stringify(res.payload))

  res = await callMessage('/scenes', null, studentToken)
  assert('GET /message/scenes 学生 token → 403', res.payload.code === 403, JSON.stringify(res.payload))

  res = await callMessage('/scenes', null, auditorToken)
  assert('GET /message/scenes 审核员 → 返回场景与时机', res.payload.code === 0 && res.payload.data.scenes.length === 16 && !!res.payload.data.moments, JSON.stringify(res.payload).slice(0, 200))
  assert('自检返回模板配置状态', res.payload.data.scenes.every((s) => typeof s.template_configured === 'boolean' && s.template_env), JSON.stringify(res.payload.data.scenes[0]))

  res = await callMessage('/test-send', { scene: 'activity_signup_success' }, superToken)
  assert('POST /test-send 缺参数 → 1001', res.payload.code === 1001 && res.payload.message.indexOf('user_id') !== -1, JSON.stringify(res.payload))

  res = await callMessage('/test-send', { user_id: 'u-1', scene: 'bogus' }, superToken)
  assert('POST /test-send 未知场景 → 1001', res.payload.code === 1001 && res.payload.message.indexOf('未知通知场景') !== -1, JSON.stringify(res.payload))

  res = await callMessage('/test-send', { user_id: 'nobody', scene: 'activity_signup_success' }, superToken)
  assert('POST /test-send 接收人不存在 → 404', res.payload.code === 404, JSON.stringify(res.payload))

  res = await callMessage('/test-send', { user_id: 'u-1', scene: 'activity_signup_success', biz_id: 'act-e2e', vars: { activity_title: '联调活动', activity_time: '2026-10-01 10:00', activity_place: '主楼报告厅', activity_id: 'act-e2e' } }, superToken)
  assert('POST /test-send 放行 → 返回推送结果', res.payload.code === 0 && res.payload.data.scene === 'activity_signup_success' && !!res.payload.data.message_id, JSON.stringify(res.payload).slice(0, 220))

  res = await callMessage('/test-send', { user_id: 'u-1', scene: 'activity_signup_success', biz_id: 'act-e2e', vars: {} }, superToken)
  assert('重复触发同事件 → duplicate', res.payload.code === 0 && res.payload.data.duplicate === true, JSON.stringify(res.payload).slice(0, 220))

  res = await callMessage('/test-send', { user_id: 'u-1', scene: 'activity_signup_success', biz_id: 'act-x' }, adminFnToken)
  assert('viewer 调 /test-send → 403', res.payload.code === 403, JSON.stringify(res.payload))

  res = await callMessage('/logs', { user_id: 'u-1' }, superToken)
  assert('POST /logs 返回最近消息（含推送状态）', res.payload.code === 0 && res.payload.data.list.length > 0 && typeof res.payload.data.list[0].push_status === 'string', JSON.stringify(res.payload).slice(0, 220))

  res = await callMessage('/logs', { user_id: 'u-1', limit: 51 }, superToken)
  assert('POST /logs limit 越界 → 1001', res.payload.code === 1001, JSON.stringify(res.payload))

  res = await callMessage('/logs', { user_id: 'u-1' }, studentToken)
  assert('学生 token 调管理自检接口 → 403', res.payload.code === 403, JSON.stringify(res.payload))

  console.log(`\n结果：${passed} 通过 / ${failed} 失败`)
  if (failed > 0) process.exitCode = 1
}

main().catch((e) => {
  console.error('用例执行异常：', e)
  process.exitCode = 1
})
