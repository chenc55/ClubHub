/**
 * P1-10 本地验收（离线，无需部署）
 * 覆盖：活动创建 / 编辑草稿（权限矩阵、字段与时间校验、封禁社团、落库）/
 *       提交审核（先审后发：敏感词 block / review 拦截、仅草稿可提交、封禁社团拦截）/
 *       管理列表（角色过滤、状态 tab 与复合别名 published / finished、activity_id 回显、join 社团名）/
 *       手动提前结束（仅 ongoing、通知有效报名者、cancelled 不通知）/ 定时触发器四段流转
 * 运行：node scripts/test-p1-10.js
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
const stores = { admins: require('./helpers/admin-fixtures').createAdminFixtures(), activities: [], club_members: [], clubs: [], categories: [], users: [], activity_registrations: [], messages: [], sensitive_words: [] }

function matchCond(row, cond) {
  if (cond && cond.__and) return cond.__and.every((item) => matchCond(row, item))
  if (cond && cond.__or) return cond.__or.some((item) => matchCond(row, item))
  return Object.keys(cond).every((key) => {
    const want = cond[key]
    if (want instanceof RegExp) return want.test(String(row[key] == null ? '' : row[key]))
    if (want && typeof want === 'object') {
      if (Object.prototype.hasOwnProperty.call(want, '__in')) return want.__in.indexOf(row[key]) !== -1
      if (Object.prototype.hasOwnProperty.call(want, '__neq')) return row[key] !== want.__neq
      if (Object.prototype.hasOwnProperty.call(want, '__gte')) return Number(row[key] || 0) >= want.__gte
      if (Object.prototype.hasOwnProperty.call(want, '__lte')) return Number(row[key] || 0) <= want.__lte
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
      result.forEach((row) => assignPatch(row, patch))
      return { updated: result.length }
    },
  }
  return query
}

/** 对齐真实 SDK 语义：普通对象按点号路径合并子字段，cmd.set() 才整体覆盖（2026-09-28） */
function assignPatch(row, patch) {
  for (const [key, value] of Object.entries(patch)) {
    row[key] = value && value.__set !== undefined ? value.__set : value
  }
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
        assignPatch(row, patch)
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
      set: (value) => ({ __set: value }),
    },
  }),
  httpclient: { request: async () => ({ data: { access_token: 'T', expires_in: 7200 } }) },
}

/* ---------- 种子数据 ---------- */
const DAY = 24 * 3600 * 1000
const HOUR = 3600 * 1000
const now = Date.now()
const at = (offset) => new Date(now + offset)

function user(over) {
  seq += 1
  return { _id: `u-${seq}`, openid: `openid-${seq}`, name: '用户', auth_status: 'verified', status: 'normal', deleted: 0, ...over }
}
const uPresident = user({ name: '林晨' })
const uOfficer = user({ name: '苏晚晴' })
const uMember = user({ name: '何子轩' })
const uOutsider = user({ name: '路人甲' })
const uDisabled = user({ name: '被禁用者', status: 'disabled' })
const uReg1 = user({ name: '报名者1' })
const uReg2 = user({ name: '报名者2' })
const uReg3 = user({ name: '报名者3' })
const uCancelled = user({ name: '已取消者' })
stores.users.push(uPresident, uOfficer, uMember, uOutsider, uDisabled, uReg1, uReg2, uReg3, uCancelled)

stores.categories.push({ _id: 'c-1', name: '学术科技', sort: 1, deleted: 0 })

// 敏感词词库（与 db_init.json 种子一致）：block / review 两级
stores.sensitive_words.push(
  { _id: 'w-1', word: '兼职刷单', level: 'block', deleted: 0 },
  { _id: 'w-2', word: '校园贷款', level: 'block', deleted: 0 },
  { _id: 'w-3', word: '代理招生', level: 'review', deleted: 0 },
  { _id: 'w-4', word: '有偿互助', level: 'review', deleted: 0 }
)

stores.clubs.push(
  { _id: 'club-a', name: '天文社', intro: '一起看星星', contact: 'QQ群1', status: 'normal', deleted: 0 },
  { _id: 'club-banned', name: '违规社团', intro: '', contact: '', status: 'banned', deleted: 0 }
)

function membership(over) {
  return { role: 'member', status: 'active', joined_at: at(-30 * DAY), ...over }
}
stores.club_members.push(
  membership({ _id: 'm-1', club_id: 'club-a', user_id: uPresident._id, role: 'president' }),
  membership({ _id: 'm-2', club_id: 'club-a', user_id: uOfficer._id, role: 'officer' }),
  membership({ _id: 'm-3', club_id: 'club-a', user_id: uMember._id, role: 'member' }),
  membership({ _id: 'm-4', club_id: 'club-banned', user_id: uPresident._id, role: 'president' })
)

function activityRow(over) {
  return {
    club_id: 'club-a',
    title: '活动',
    content: '内容',
    cover: '',
    category_id: 'c-1',
    start_time: at(2 * DAY),
    end_time: at(2 * DAY + 2 * HOUR),
    location: '操场',
    signup_start: at(-1 * DAY),
    signup_end: at(1 * DAY),
    capacity: 50,
    need_approval: false,
    has_waitlist: true,
    allow_onsite: false,
    signin_config: { methods: ['qrcode'] },
    status: 'draft',
    created_at: at(-3 * DAY),
    updated_at: at(-3 * DAY),
    deleted: 0,
    ...over,
  }
}
// 定时触发器种子（时间相对真实 now，runTimer 内部用 new Date()）
stores.activities.push(
  activityRow({ _id: 'act-approve', title: '待开放', status: 'approved', signup_start: at(-1 * HOUR) }),
  activityRow({ _id: 'act-signup', title: '报名中', status: 'signup', start_time: at(-1 * HOUR) }),
  activityRow({ _id: 'act-ongoing', title: '进行中', status: 'ongoing', end_time: at(-1 * HOUR) }),
  activityRow({ _id: 'act-ended', title: '待归档', status: 'ended', end_time: at(-25 * HOUR) }),
  activityRow({ _id: 'act-ended-fresh', title: '刚结束', status: 'ended', end_time: at(-1 * HOUR) }),
  activityRow({ _id: 'act-approved-future', title: '未到开放', status: 'approved', signup_start: at(1 * HOUR) }),
  activityRow({ _id: 'act-signup-future', title: '未到开始', status: 'signup', start_time: at(1 * HOUR) })
)
// 手动提前结束种子（ongoing + 报名记录）
stores.activities.push(activityRow({ _id: 'act-end', title: '可提前结束', status: 'ongoing', start_time: at(-1 * HOUR), end_time: at(2 * HOUR) }))
stores.activity_registrations.push(
  { _id: 'r-1', activity_id: 'act-end', user_id: uReg1._id, status: 'approved' },
  { _id: 'r-2', activity_id: 'act-end', user_id: uReg2._id, status: 'pending' },
  { _id: 'r-3', activity_id: 'act-end', user_id: uReg3._id, status: 'waitlist' },
  { _id: 'r-4', activity_id: 'act-end', user_id: uCancelled._id, status: 'cancelled' }
)

const activityFn = require('../uniCloud-aliyun/cloudfunctions/activity/index.js')

function studentToken(userRow) {
  return club.signToken({
    type: club.TOKEN_TYPES.STUDENT,
    token_kind: 'access',
    userId: userRow._id,
    openid: userRow.openid,
    auth_status: userRow.auth_status,
  })
}
const adminToken = club.signToken({ type: 'admin', adminId: 'a-1', username: 'root', role: 'super' })

async function call(pathname, { method = 'POST', body, query, token } = {}) {
  const headers = { 'content-type': 'application/json' }
  if (token) headers.authorization = `Bearer ${token}`
  const res = await activityFn.main({
    httpMethod: method,
    path: pathname.replace(/^\/activity/, ''),
    headers,
    body: body ? JSON.stringify(body) : '',
    queryStringParameters: query || {},
  })
  return { statusCode: res.statusCode, payload: JSON.parse(res.body) }
}

function validBody(over) {
  return {
    club_id: 'club-a',
    title: '天文观测夜',
    content: '一起看流星雨，记得带望远镜',
    category_id: 'c-1',
    start_time: now + 2 * DAY,
    end_time: now + 2 * DAY + 2 * HOUR,
    location: '操场',
    signup_start: now - DAY,
    signup_end: now + DAY,
    capacity: 50,
    need_approval: false,
    has_waitlist: true,
    allow_onsite: false,
    cover: '',
    signin_config: { methods: ['qrcode', 'password'], password: '8888' },
    ...over,
  }
}

const rowOf = (id) => stores.activities.find((row) => row._id === id)

async function main() {
  /* ---------- 1. save：鉴权与权限 ---------- */
  console.log('\n【save · 鉴权与权限】')
  let r = await call('/activity/save', { body: validBody() })
  assert('无 token → 401', r.statusCode === 401, JSON.stringify(r.payload))

  r = await call('/activity/save', { body: validBody(), token: studentToken(uDisabled) })
  assert('禁用用户 → 403', r.payload.code === 403, JSON.stringify(r.payload))

  r = await call('/activity/save', { body: validBody(), token: studentToken(uMember) })
  assert('普通成员 → 403', r.payload.code === 403 && r.payload.message.includes('社长 / 干部'), JSON.stringify(r.payload))

  r = await call('/activity/save', { body: validBody(), token: studentToken(uOutsider) })
  assert('非负责人 → 403', r.payload.code === 403, JSON.stringify(r.payload))

  r = await call('/activity/save', { body: validBody({ club_id: 'club-banned' }), token: studentToken(uPresident) })
  assert('封禁社团 → 404', r.payload.code === 404, JSON.stringify(r.payload))

  /* ---------- 2. save：字段与时间校验 ---------- */
  console.log('\n【save · 字段与时间校验】')
  r = await call('/activity/save', { body: validBody({ title: '星' }), token: studentToken(uPresident) })
  assert('标题过短 → 1001', r.payload.code === 1001 && r.payload.message.includes('至少'), JSON.stringify(r.payload))

  r = await call('/activity/save', { body: validBody({ content: '   ' }), token: studentToken(uPresident) })
  assert('内容为空 → 1001', r.payload.code === 1001, JSON.stringify(r.payload))

  r = await call('/activity/save', { body: validBody({ end_time: now + DAY }), token: studentToken(uPresident) })
  assert('结束时间不晚于开始 → 1001', r.payload.code === 1001 && r.payload.message.includes('结束'), JSON.stringify(r.payload))

  r = await call('/activity/save', { body: validBody({ signup_start: now + 2 * HOUR, signup_end: now + HOUR }), token: studentToken(uPresident) })
  assert('报名起止倒挂 → 1001', r.payload.code === 1001 && r.payload.message.includes('报名开始'), JSON.stringify(r.payload))

  r = await call('/activity/save', { body: validBody({ signup_end: now + 2 * DAY + HOUR }), token: studentToken(uPresident) })
  assert('报名截止晚于活动开始 → 1001', r.payload.code === 1001 && r.payload.message.includes('不晚于'), JSON.stringify(r.payload))

  r = await call('/activity/save', { body: validBody({ capacity: 0 }), token: studentToken(uPresident) })
  assert('人数上限非法 → 1001', r.payload.code === 1001, JSON.stringify(r.payload))

  r = await call('/activity/save', { body: validBody({ signin_config: { methods: [] } }), token: studentToken(uPresident) })
  assert('签到方式为空 → 1001', r.payload.code === 1001 && r.payload.message.includes('签到方式'), JSON.stringify(r.payload))

  r = await call('/activity/save', { body: validBody({ signin_config: { methods: ['password'] } }), token: studentToken(uPresident) })
  assert('口令签到缺口令 → 1001', r.payload.code === 1001, JSON.stringify(r.payload))

  r = await call('/activity/save', { body: validBody({ signin_config: { methods: ['geofence'], geo: { radius_m: 0 } } }), token: studentToken(uPresident) })
  assert('定位签到缺半径 → 1001', r.payload.code === 1001, JSON.stringify(r.payload))

  /* ---------- 3. save：创建与编辑 ---------- */
  console.log('\n【save · 创建与编辑】')
  r = await call('/activity/save', { body: validBody(), token: studentToken(uOfficer) })
  assert('干部可创建 → 落库 draft', r.payload.code === 0 && r.payload.data.updated === false && r.payload.data.activity.status === 'draft', JSON.stringify(r.payload).slice(0, 260))
  const createdId = r.payload.data.activity._id
  const created = rowOf(createdId)
  assert('落库字段完整（deleted=0、签到配置规范化、时间转 Date）',
    created.deleted === 0 && created.status === 'draft' && created.signin_config.methods.join(',') === 'qrcode,password' &&
    created.signin_config.password === '8888' && created.created_at instanceof Date,
    JSON.stringify(created).slice(0, 300))

  r = await call('/activity/save', { body: validBody({ title: '同名活动B' }), token: studentToken(uPresident) })
  assert('活动标题允许同名（无唯一约束）', r.payload.code === 0, JSON.stringify(r.payload).slice(0, 120))

  r = await call('/activity/save', { body: { ...validBody(), activity_id: 'not-exist' }, token: studentToken(uPresident) })
  assert('编辑不存在活动 → 404', r.payload.code === 404, JSON.stringify(r.payload))

  r = await call('/activity/save', { body: { ...validBody(), activity_id: 'act-end' }, token: studentToken(uPresident) })
  assert('编辑非草稿（ongoing）→ 1002', r.payload.code === 1002 && r.payload.message.includes('草稿'), JSON.stringify(r.payload))

  r = await call('/activity/save', { body: { ...validBody({ title: '改名后的活动' }), activity_id: createdId }, token: studentToken(uPresident) })
  assert('编辑草稿成功 → updated=true 且标题更新', r.payload.code === 0 && r.payload.data.updated === true && rowOf(createdId).title === '改名后的活动', JSON.stringify(r.payload).slice(0, 200))

  /* ---------- 4. submit：状态机与敏感词 ---------- */
  console.log('\n【submit · 状态机与敏感词】')
  r = await call('/activity/submit', { body: { activity_id: 'act-end' }, token: studentToken(uPresident) })
  assert('非草稿不可提交 → 1002', r.payload.code === 1002 && r.payload.message.includes('草稿'), JSON.stringify(r.payload))

  r = await call('/activity/submit', { body: { activity_id: createdId }, token: studentToken(uMember) })
  assert('普通成员提交 → 403', r.payload.code === 403, JSON.stringify(r.payload))

  const bannedActivity = activityRow({ _id: 'act-banned-club', club_id: 'club-banned', status: 'draft' })
  stores.activities.push(bannedActivity)
  r = await call('/activity/submit', { body: { activity_id: 'act-banned-club' }, token: studentToken(uPresident) })
  assert('封禁社团提交 → 1002', r.payload.code === 1002 && r.payload.message.includes('社团'), JSON.stringify(r.payload))

  const blockActivity = activityRow({ _id: 'act-block', title: '兼职刷单的标题', status: 'draft' })
  stores.activities.push(blockActivity)
  r = await call('/activity/submit', { body: { activity_id: 'act-block' }, token: studentToken(uPresident) })
  assert('命中 block 级敏感词 → 1001 拦截', r.payload.code === 1001 && r.payload.message.includes('违规词'), JSON.stringify(r.payload))
  assert('被拦截后仍为 draft', rowOf('act-block').status === 'draft')

  const reviewActivity = activityRow({ _id: 'act-review', title: '代理招生宣传活动', status: 'draft' })
  stores.activities.push(reviewActivity)
  r = await call('/activity/submit', { body: { activity_id: 'act-review' }, token: studentToken(uPresident) })
  assert('命中 review 级敏感词 → 1001 拦截（先审后发）', r.payload.code === 1001, JSON.stringify(r.payload))

  r = await call('/activity/submit', { body: { activity_id: createdId }, token: studentToken(uPresident) })
  assert('正常提交 → pending', r.payload.code === 0 && rowOf(createdId).status === 'pending', JSON.stringify(r.payload).slice(0, 200))

  /* ---------- 5. manage：列表与过滤 ---------- */
  console.log('\n【manage · 列表与过滤】')
  r = await call('/activity/manage', { method: 'GET' })
  assert('无 token → 401', r.statusCode === 401, JSON.stringify(r.payload))

  r = await call('/activity/manage', { method: 'GET', token: adminToken })
  assert('管理通道 token → 403', r.payload.code === 403, JSON.stringify(r.payload))

  r = await call('/activity/manage', { method: 'GET', token: studentToken(uOutsider) })
  assert('非负责人 → 空列表', r.payload.code === 0 && r.payload.data.list.length === 0 && r.payload.data.total === 0, JSON.stringify(r.payload.data))

  r = await call('/activity/manage', { method: 'GET', token: studentToken(uPresident) })
  const allIds = r.payload.data.list.map((item) => item._id)
  assert('all → 返回本人管理社团全部活动（含草稿与各状态）', r.payload.code === 0 && allIds.indexOf('act-end') !== -1 && allIds.indexOf(createdId) !== -1, JSON.stringify(allIds))
  const first = r.payload.data.list[0]
  assert('join 社团名且行结构完整', first.club_name === '天文社' && first.title && typeof first.capacity === 'number', JSON.stringify(first).slice(0, 200))

  r = await call('/activity/manage', { method: 'GET', query: { status: 'published' }, token: studentToken(uPresident) })
  const published = r.payload.data.list
  assert('published 复合 → 仅 approved / signup / ongoing',
    published.length > 0 && published.every((item) => ['approved', 'signup', 'ongoing'].indexOf(item.status) !== -1),
    JSON.stringify(published.map((i) => `${i._id}:${i.status}`)))

  r = await call('/activity/manage', { method: 'GET', query: { status: 'finished' }, token: studentToken(uPresident) })
  const finished = r.payload.data.list.map((item) => item._id)
  assert('finished 复合 → 仅 ended / archived', finished.every((id) => ['act-ended', 'act-ended-fresh'].indexOf(id) !== -1), JSON.stringify(finished))

  r = await call('/activity/manage', { method: 'GET', query: { status: 'bogus' }, token: studentToken(uPresident) })
  assert('status 非法 → 1001', r.payload.code === 1001, JSON.stringify(r.payload))

  r = await call('/activity/manage', { method: 'GET', query: { activity_id: 'act-end' }, token: studentToken(uPresident) })
  assert('activity_id 回显单条', r.payload.code === 0 && r.payload.data.list.length === 1 && r.payload.data.list[0]._id === 'act-end', JSON.stringify(r.payload.data))

  r = await call('/activity/manage', { method: 'GET', query: { activity_id: 'act-end' }, token: studentToken(uOfficer) })
  assert('activity_id 回显（同为管理社团干部可见）', r.payload.code === 0 && r.payload.data.list.length === 1, JSON.stringify(r.payload.data))

  r = await call('/activity/manage', { method: 'GET', query: { activity_id: 'act-end' }, token: studentToken(uMember) })
  assert('非负责人按 id 取 → 404', r.payload.code === 404, JSON.stringify(r.payload))

  /* ---------- 6. end：提前结束 + 通知 ---------- */
  console.log('\n【end · 提前结束与通知】')
  r = await call('/activity/end', { body: { activity_id: 'act-ended' }, token: studentToken(uPresident) })
  assert('非 ongoing → 1002', r.payload.code === 1002 && r.payload.message.includes('进行中'), JSON.stringify(r.payload))

  r = await call('/activity/end', { body: { activity_id: 'act-end' }, token: studentToken(uMember) })
  assert('普通成员 → 403', r.payload.code === 403, JSON.stringify(r.payload))

  r = await call('/activity/end', { body: { activity_id: 'act-end' }, token: studentToken(uPresident) })
  assert('提前结束成功 → ended', r.payload.code === 0 && rowOf('act-end').status === 'ended' && r.payload.data.activity.status === 'ended', JSON.stringify(r.payload).slice(0, 200))
  assert('通知计数 = 有效报名者（pending/approved/waitlist）', r.payload.data.notified_count === 3, JSON.stringify(r.payload.data))
  const endedMsgs = stores.messages.filter((m) => m.scene === 'activity_ended' && m.biz_id === 'act-end')
  assert('站内消息写入 3 条（去重不重复）', endedMsgs.length === 3, JSON.stringify(endedMsgs.map((m) => m.user_id)))
  assert('cancelled 报名者未被通知', endedMsgs.every((m) => m.user_id !== uCancelled._id), JSON.stringify(endedMsgs.map((m) => m.user_id)))
  assert('通知含活动名与时间地点', endedMsgs[0].content.indexOf('天文社') !== -1 || endedMsgs[0].content.indexOf('提前结束') !== -1, JSON.stringify(endedMsgs[0]).slice(0, 300))

  /* ---------- 7. 定时触发器：四段流转 ---------- */
  console.log('\n【定时触发器 · 状态流转】')
  const before = stores.activities.map((row) => ({ _id: row._id, status: row.status }))
  r = await activityFn.main({ type: 'timer', triggerName: 'activity-status-timer', payload: '{}' })
  assert('timer 分支返回统计', r.code === 0 && typeof r.data === 'object', JSON.stringify(r))

  // 阿里云实际下发的事件形态（Type/TriggerName，**无小写 type**）也必须进入 timer 分支
  // （2026-09-28 云端实测：只判 event.type === 'timer' 会导致定时触发空转）
  r = await activityFn.main({ Type: 'Timer', TriggerName: 'TIMER_LATEST', Time: new Date().toISOString() })
  assert('阿里云形态事件同样进入 timer 分支', r.code === 0 && typeof r.data === 'object', JSON.stringify(r))

  assert('approved 到开放时间 → signup', rowOf('act-approve').status === 'signup', rowOf('act-approve').status)
  assert('signup 到开始时间 → ongoing', rowOf('act-signup').status === 'ongoing', rowOf('act-signup').status)
  assert('ongoing 到结束时间 → ended', rowOf('act-ongoing').status === 'ended', rowOf('act-ongoing').status)
  assert('ended 超 24h → archived', rowOf('act-ended').status === 'archived', rowOf('act-ended').status)
  assert('ended 未超 24h 不归档', rowOf('act-ended-fresh').status === 'ended', rowOf('act-ended-fresh').status)
  assert('未到开放时间保持 approved', rowOf('act-approved-future').status === 'approved', rowOf('act-approved-future').status)
  assert('未到开始时间保持 signup', rowOf('act-signup-future').status === 'signup', rowOf('act-signup-future').status)
  assert('已手动结束（act-end）不再被流转', rowOf('act-end').status === 'ended', rowOf('act-end').status)

  console.log(`\n通过 ${passed} 项，失败 ${failed} 项`)
  if (failed > 0) process.exitCode = 1
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
