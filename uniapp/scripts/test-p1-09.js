/**
 * P1-09 本地验收（离线，无需部署）
 * 覆盖：负责人端「我的社团」（角色过滤 / 成员状态 / 多社团排序 / join 与计数 / 软删与封禁口径）/
 *       资料编辑（权限矩阵「仅社长」、封禁拦截、重名与自身同名、长度校验、只读字段不生效、落库与 updated_at）/
 *       鉴权与通道校验
 * 运行：node scripts/test-p1-09.js
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
const stores = { clubs: [], club_members: [], categories: [], users: [], activities: [] }

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
    limit: (n) => {
      result = result.slice(0, n)
      return query
    },
    get: async () => ({ data: result.slice() }),
    count: async () => ({ total: result.length }),
  }
  return query
}

/** 聚合 stub（简化）：仅支持本任务用到的 match + group({ _id: '$club_id', total: $.sum(1) }) 按 club_id 计数 */
function aggregateStub(name) {
  const state = { match: null }
  const chain = {
    match(cond) {
      state.match = cond
      return chain
    },
    group() {
      return chain
    },
    end: async () => {
      const rows = (stores[name] || []).filter((row) => !state.match || matchCond(row, state.match))
      const map = new Map()
      rows.forEach((row) => map.set(row.club_id, (map.get(row.club_id) || 0) + 1))
      return { data: [...map.entries()].map(([key, total]) => ({ _id: key, total })) }
    },
  }
  return chain
}

function collectionFor(name) {
  const rowsOf = () => stores[name] || []
  return {
    where: (cond) => makeQuery(rowsOf().filter((row) => matchCond(row, cond))),
    aggregate: () => aggregateStub(name),
    add: async (doc) => {
      const list = Array.isArray(doc) ? doc : [doc]
      let lastId = ''
      list.forEach((item) => {
        lastId = `${name}-${++seq}`
        stores[name].push({ _id: lastId, ...item })
      })
      return { id: lastId }
    },
    doc: (id) => ({
      update: async (patch) => {
        const row = rowsOf().find((item) => item._id === id)
        if (!row) return { updated: 0 }
        if (name === 'clubs' && patch.name) {
          const holder = stores.clubs.find((item) => item.name === patch.name && item._id !== id && item.deleted === 0)
          if (holder) throw new Error('duplicate key: clubs.name')
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
      gte: (value) => ({ __gte: value }),
      aggregate: { sum: (value) => ({ __sum: value }) },
    },
  }),
  httpclient: { request: async () => ({ data: { access_token: 'T', expires_in: 7200 } }) },
}

/* ---------- 种子数据 ---------- */
const DAY = 24 * 3600 * 1000
const daysAgo = (n) => new Date(Date.now() - n * DAY)

function user(over) {
  seq += 1
  return {
    _id: `u-${seq}`,
    openid: `openid-${seq}`,
    name: `用户${seq}`,
    auth_status: 'verified',
    status: 'normal',
    deleted: 0,
    ...over,
  }
}
const uPresident = user({ name: '林晨', student_no: '20260001' })
const uOfficer = user({ name: '苏晚晴' })
const uMember = user({ name: '何子轩' })
const uOutsider = user({ name: '路人甲' })
const uDisabled = user({ name: '被禁用者', status: 'disabled' })
const uDeleted = user({ name: '已注销者', deleted: 1 })
const uRemoved = user({ name: '已移出者' })
stores.users.push(uPresident, uOfficer, uMember, uOutsider, uDisabled, uDeleted, uRemoved)

stores.categories.push(
  { _id: 'c-1', name: '学术科技', sort: 1, deleted: 0 },
  { _id: 'c-2', name: '文艺表演', sort: 2, deleted: 0 }
)

function clubRow(over) {
  return {
    intro: '简介',
    logo: '',
    cover: '',
    contact: '联系方式',
    star_level: 0,
    status: 'normal',
    create_type: 'imported',
    applicant_id: '',
    reject_reason: '',
    review_by: '',
    review_at: null,
    batch_no: '',
    created_at: daysAgo(60),
    updated_at: daysAgo(60),
    deleted: 0,
    ...over,
  }
}
stores.clubs.push(
  clubRow({ _id: 'club-a', name: '天文社', intro: '旧简介', contact: '旧联系方式', category_id: 'c-1', star_level: 4, logo: 'https://cdn.example.com/a.png' }),
  clubRow({ _id: 'club-b', name: '街舞社', intro: '每周团训', contact: '微信 street', category_id: 'c-2' }),
  clubRow({ _id: 'club-c', name: '违规社团', category_id: 'c-1', status: 'banned' }),
  clubRow({ _id: 'club-d', name: '已删社团', category_id: 'c-1', deleted: 1 })
)

function member(over) {
  return { role: 'member', status: 'active', joined_at: daysAgo(30), ...over }
}
stores.club_members.push(
  member({ _id: 'm-1', club_id: 'club-a', user_id: uPresident._id, role: 'president', joined_at: daysAgo(30) }),
  member({ _id: 'm-2', club_id: 'club-b', user_id: uPresident._id, role: 'president', joined_at: daysAgo(20) }),
  member({ _id: 'm-3', club_id: 'club-a', user_id: uOfficer._id, role: 'officer' }),
  member({ _id: 'm-4', club_id: 'club-a', user_id: uMember._id, role: 'member' }),
  member({ _id: 'm-5', club_id: 'club-c', user_id: uPresident._id, role: 'president' }),
  member({ _id: 'm-6', club_id: 'club-d', user_id: uPresident._id, role: 'president' }),
  member({ _id: 'm-7', club_id: 'club-d', user_id: uMember._id, role: 'president', status: 'removed' }),
  member({ _id: 'm-8', club_id: 'club-b', user_id: uDisabled._id, role: 'president' }),
  // 曾被设为社长但已被移出（status = removed）：不应出现在我的社团，也不可编辑
  member({ _id: 'm-9', club_id: 'club-a', user_id: uRemoved._id, role: 'president', status: 'removed' })
)

stores.activities.push({ _id: 'act-1', club_id: 'club-a', title: '观星夜', status: 'signup', deleted: 0, start_time: daysAgo(1) })

const clubFn = require('../uniCloud-aliyun/cloudfunctions/club/index.js')

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
  const res = await clubFn.main({
    httpMethod: method,
    path: pathname.replace(/^\/club/, ''),
    headers,
    body: body ? JSON.stringify(body) : '',
    queryStringParameters: query || {},
  })
  return { statusCode: res.statusCode, payload: JSON.parse(res.body) }
}

const clubRowOf = (id) => stores.clubs.find((row) => row._id === id)

async function main() {
  /* ---------- 1. 我的社团 · 鉴权与角色口径 ---------- */
  console.log('\n【我的社团 · 鉴权与角色】')
  let r = await call('/club/my-clubs', { method: 'GET' })
  assert('无 token → 401', r.statusCode === 401 && r.payload.code === 401, JSON.stringify(r.payload))

  r = await call('/club/my-clubs', { method: 'GET', token: adminToken })
  assert('管理通道 token → 403（通道不匹配）', r.payload.code === 403, JSON.stringify(r.payload))

  r = await call('/club/my-clubs', { method: 'GET', token: studentToken(uOutsider) })
  assert('无成员记录 → 空列表', r.payload.code === 0 && r.payload.data.list.length === 0, JSON.stringify(r.payload))

  r = await call('/club/my-clubs', { method: 'GET', token: studentToken(uDeleted) })
  assert('读接口仅校验 token：已软删用户返回空列表（写操作由 requireActiveStudent 拦截，见下）', r.payload.code === 0 && r.payload.data.list.length === 0, JSON.stringify(r.payload))

  r = await call('/club/my-clubs', { method: 'GET', token: studentToken(uMember) })
  assert('普通成员（role=member）不返回', r.payload.code === 0 && r.payload.data.list.length === 0, JSON.stringify(r.payload))

  /* ---------- 2. 我的社团 · 社长 / 干部 ---------- */
  console.log('\n【我的社团 · 社长与干部】')
  r = await call('/club/my-clubs', { method: 'GET', token: studentToken(uPresident) })
  const list = r.payload.data.list
  assert('社长返回其管理社团（多社团含被封禁的 club-c）', r.payload.code === 0 && list.length === 3, JSON.stringify(list.map((i) => i.club._id)))
  assert('按入团时间升序（最早入团在前，同时间以 club_id 兜底）', list.map((i) => i.club._id).join(',') === 'club-a,club-c,club-b', JSON.stringify(list.map((i) => i.club._id)))
  assert('已软删社团（club-d）不返回', list.every((i) => i.club._id !== 'club-d'), JSON.stringify(list.map((i) => i.club._id)))

  const itemA = list.find((i) => i.club._id === 'club-a')
  assert('社长 · 正常社团 can_edit=true', itemA.role === 'president' && itemA.can_edit === true, JSON.stringify(itemA).slice(0, 200))
  assert('join 字段完整（分类名 / 星级 / Logo / 计数 / 标签）',
    itemA.club.category_name === '学术科技' && itemA.club.star_level === 4 && itemA.club.logo === 'https://cdn.example.com/a.png' &&
    itemA.club.member_count === 3 && itemA.club.activity_count === 1 && itemA.club.tags.indexOf('4 星社团') !== -1,
    JSON.stringify(itemA.club).slice(0, 260))

  const itemC = list.find((i) => i.club._id === 'club-c')
  assert('社长 · 封禁社团仍返回但 can_edit=false', itemC.club.status === 'banned' && itemC.can_edit === false, JSON.stringify(itemC).slice(0, 200))

  r = await call('/club/my-clubs', { method: 'GET', token: studentToken(uOfficer) })
  const officerItem = r.payload.data.list[0]
  assert('干部返回其管理社团且 can_edit=false', r.payload.data.list.length === 1 && officerItem.role === 'officer' && officerItem.can_edit === false, JSON.stringify(officerItem).slice(0, 220))

  /* ---------- 3. 资料编辑 · 鉴权与校验 ---------- */
  console.log('\n【资料编辑 · 鉴权与参数校验】')
  const UPDATE_BASE = { club_id: 'club-a', name: '天文社', intro: '新简介', contact: '新联系方式', logo: 'https://cdn.example.com/new.png', cover: '' }
  r = await call('/club/update', { body: UPDATE_BASE })
  assert('无 token → 401', r.statusCode === 401, JSON.stringify(r.payload))

  r = await call('/club/update', { body: UPDATE_BASE, token: studentToken(uDisabled) })
  assert('禁用用户 → 403（仅可浏览）', r.statusCode === 403 && r.payload.code === 403, JSON.stringify(r.payload))

  r = await call('/club/update', { body: { club_id: 'club-a' }, token: studentToken(uPresident) })
  assert('缺参 → 1001', r.payload.code === 1001, JSON.stringify(r.payload))

  r = await call('/club/update', { body: { ...UPDATE_BASE, name: '星' }, token: studentToken(uPresident) })
  assert('名称过短 → 1001', r.payload.code === 1001 && r.payload.message.includes('至少'), JSON.stringify(r.payload))

  r = await call('/club/update', { body: { ...UPDATE_BASE, intro: '   ' }, token: studentToken(uPresident) })
  assert('简介为空 → 1001', r.payload.code === 1001, JSON.stringify(r.payload))

  r = await call('/club/update', { body: { ...UPDATE_BASE, contact: '' }, token: studentToken(uPresident) })
  assert('联系方式为空 → 1001', r.payload.code === 1001, JSON.stringify(r.payload))

  r = await call('/club/update', { body: { ...UPDATE_BASE, logo: 'x'.repeat(501) }, token: studentToken(uPresident) })
  assert('Logo URL 超长 → 1001', r.payload.code === 1001, JSON.stringify(r.payload))

  r = await call('/club/update', { body: { ...UPDATE_BASE, club_id: 'not-exist' }, token: studentToken(uPresident) })
  assert('社团不存在 → 404', r.payload.code === 404, JSON.stringify(r.payload))

  /* ---------- 4. 资料编辑 · 权限矩阵 ---------- */
  console.log('\n【资料编辑 · 权限矩阵】')
  r = await call('/club/update', { body: UPDATE_BASE, token: studentToken(uOutsider) })
  assert('非社团成员 → 403', r.payload.code === 403 && r.payload.message.includes('负责人'), JSON.stringify(r.payload))

  r = await call('/club/update', { body: UPDATE_BASE, token: studentToken(uOfficer) })
  assert('干部（officer）→ 403（仅社长可编辑）', r.payload.code === 403 && r.payload.message.includes('仅社长'), JSON.stringify(r.payload))

  r = await call('/club/update', { body: UPDATE_BASE, token: studentToken(uRemoved) })
  assert('成员记录已移除（status=removed）→ 403', r.payload.code === 403 && r.payload.message.includes('负责人'), JSON.stringify(r.payload))

  r = await call('/club/update', { body: { ...UPDATE_BASE, club_id: 'club-c' }, token: studentToken(uPresident) })
  assert('社团被封禁 → 1002', r.payload.code === 1002 && r.payload.message.includes('仅正常状态'), JSON.stringify(r.payload))

  r = await call('/club/update', { body: UPDATE_BASE, token: studentToken(uMember) })
  assert('普通成员 → 403', r.payload.code === 403, JSON.stringify(r.payload))

  /* ---------- 5. 资料编辑 · 名称与落库 ---------- */
  console.log('\n【资料编辑 · 名称与落库】')
  r = await call('/club/update', { body: { ...UPDATE_BASE, name: '街舞社' }, token: studentToken(uPresident) })
  assert('改为他人已用名称 → 1001', r.payload.code === 1001 && r.payload.message.includes('已被使用'), JSON.stringify(r.payload))

  r = await call('/club/update', { body: UPDATE_BASE, token: studentToken(uPresident) })
  assert('与自身同名可保存（不算重名）', r.payload.code === 0, JSON.stringify(r.payload).slice(0, 220))

  // 便于断言：先把 updated_at 退回 60 天前（避免连续请求落在同一毫秒导致比较失真）
  clubRowOf('club-a').updated_at = daysAgo(60)
  const beforeUpdated = clubRowOf('club-a').updated_at
  const renamed = { ...UPDATE_BASE, name: '天文爱好者协会', intro: '全新的社团简介', contact: 'QQ群 999', cover: 'https://cdn.example.com/cover.png' }
  r = await call('/club/update', { body: renamed, token: studentToken(uPresident) })
  assert('保存成功 → 返回 can_edit 与最新资料',
    r.payload.code === 0 && r.payload.data.can_edit === true && r.payload.data.club.name === '天文爱好者协会' && r.payload.data.club.cover === 'https://cdn.example.com/cover.png',
    JSON.stringify(r.payload).slice(0, 260))
  assert('落库：名称 / 简介 / 联系方式 / Logo / 封面',
    clubRowOf('club-a').name === '天文爱好者协会' && clubRowOf('club-a').intro === '全新的社团简介' &&
    clubRowOf('club-a').contact === 'QQ群 999' && clubRowOf('club-a').logo === 'https://cdn.example.com/new.png' &&
    clubRowOf('club-a').cover === 'https://cdn.example.com/cover.png',
    JSON.stringify(clubRowOf('club-a')).slice(0, 260))
  assert('刷新 updated_at', new Date(clubRowOf('club-a').updated_at).getTime() > new Date(beforeUpdated).getTime())

  /* ---------- 6. 只读字段（分类 / 星级 / 状态）不可写 ---------- */
  console.log('\n【只读字段白名单】')
  r = await call('/club/update', {
    body: { ...UPDATE_BASE, category_id: 'c-2', star_level: 1, status: 'banned', applicant_id: 'u-hack' },
    token: studentToken(uPresident),
  })
  assert('传入 category_id / star_level / status 等仍返回成功（被忽略）', r.payload.code === 0, JSON.stringify(r.payload).slice(0, 200))
  assert('分类未被改动', clubRowOf('club-a').category_id === 'c-1')
  assert('星级未被改动', clubRowOf('club-a').star_level === 4)
  assert('状态未被改动', clubRowOf('club-a').status === 'normal')
  assert('返回结构中的分类名 / 星级来自库内（只读展示一致）',
    r.payload.data.club.category_name === '学术科技' && r.payload.data.club.star_level === 4,
    JSON.stringify({ category_name: r.payload.data.club.category_name, star_level: r.payload.data.club.star_level }))

  console.log(`\n通过 ${passed} 项，失败 ${failed} 项`)
  if (failed > 0) process.exitCode = 1
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
