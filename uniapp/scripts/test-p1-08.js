/**
 * P1-08 本地验收（离线，无需部署）
 * 覆盖：学生端社团列表（公开访问、normal 口径、分类 / 星级 / 关键词筛选、综合与最新排序、分页稳定性）/
 *       聚合计数（成员数只计 active、活动数排除 draft-pending）/ 派生标签 /
 *       社团详情（参数与 404 分支、封禁不可见、最近活动取数与顺序）/ 参数校验
 * 运行：node scripts/test-p1-08.js
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
const stores = { clubs: [], club_members: [], activities: [], categories: [], users: [] }

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

/**
 * 聚合 stub（简化实现）：仅支持本任务用到的 match + group({ _id: '$club_id', total: $.sum(1) })，
 * 即按 club_id 分组计数；真实环境走 uniCloud 聚合管道。
 */
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
const now = Date.now()
const daysAgo = (n) => new Date(now - n * DAY)
const daysLater = (n) => new Date(now + n * DAY)

stores.categories.push(
  { _id: 'c-1', name: '学术科技', sort: 1, deleted: 0 },
  { _id: 'c-2', name: '文艺表演', sort: 2, deleted: 0 },
  { _id: 'c-3', name: '体育竞技', sort: 3, deleted: 0 }
)

function clubRow(over) {
  return {
    intro: '',
    logo: '',
    cover: '',
    contact: '',
    star_level: 0,
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
  clubRow({ _id: 'club-a', name: '天文社', intro: '一起观测星空', category_id: 'c-1', star_level: 5, status: 'normal', logo: 'https://cdn.example.com/a.png', created_at: daysAgo(100) }),
  clubRow({ _id: 'club-b', name: '街舞社', intro: '每周一起跳舞', category_id: 'c-2', star_level: 3, status: 'normal', created_at: daysAgo(10) }),
  clubRow({ _id: 'club-c', name: '篮球社', intro: '周末约球', category_id: 'c-3', star_level: 0, status: 'normal', created_at: daysAgo(200) }),
  clubRow({ _id: 'club-d', name: '摄影社', intro: '记录校园光影', category_id: 'c-2', star_level: 4, status: 'normal', created_at: daysAgo(5) }),
  clubRow({ _id: 'club-pending', name: '待审社团', category_id: 'c-1', status: 'pending', create_type: 'applied', applicant_id: 'u-1' }),
  clubRow({ _id: 'club-rejected', name: '驳回社团', category_id: 'c-1', status: 'rejected', create_type: 'applied', applicant_id: 'u-1' }),
  clubRow({ _id: 'club-banned', name: '封禁社团', category_id: 'c-1', status: 'banned' })
)

function memberRow(clubId, status) {
  return { _id: `m-${++seq}`, club_id: clubId, user_id: `u-${seq}`, role: 'member', status, joined_at: daysAgo(1), deleted: 0 }
}
stores.club_members.push(
  memberRow('club-a', 'active'),
  memberRow('club-a', 'active'),
  memberRow('club-a', 'active'),
  memberRow('club-a', 'removed'), // 已移除成员不计入
  memberRow('club-b', 'active'),
  memberRow('club-b', 'active'),
  memberRow('club-b', 'active'),
  memberRow('club-b', 'active'),
  memberRow('club-b', 'active'),
  memberRow('club-d', 'active')
)

function activityRow(over) {
  return {
    club_id: 'club-a',
    title: '活动',
    cover: '',
    location: '体育馆',
    start_time: daysLater(1),
    end_time: daysLater(2),
    status: 'signup',
    deleted: 0,
    ...over,
  }
}
stores.activities.push(
  activityRow({ _id: 'act-1', title: '观测月球', start_time: daysLater(2), status: 'signup' }),
  activityRow({ _id: 'act-2', title: '已结束的观星夜', start_time: daysAgo(1), end_time: daysAgo(1), status: 'ended' }),
  activityRow({ _id: 'act-3', title: '草稿活动', start_time: daysLater(3), status: 'draft' }),
  activityRow({ _id: 'act-4', title: '即将开放的讲座', start_time: daysLater(1), status: 'approved' }),
  activityRow({ _id: 'act-5', title: '正在进行的天象直播', start_time: daysLater(3), status: 'ongoing' }),
  activityRow({ _id: 'act-6', title: '已结束的路边天文', start_time: daysAgo(10), end_time: daysAgo(10), status: 'ended' }),
  activityRow({ _id: 'act-7', title: '待审活动', start_time: daysLater(5), status: 'pending' }),
  activityRow({ _id: 'act-8', title: '归档活动', start_time: daysLater(4), status: 'signup' }),
  activityRow({ _id: 'act-9', title: '天文摄影展', start_time: daysLater(5), status: 'signup' }),
  activityRow({ _id: 'act-10', title: '星轨拍摄课', start_time: daysLater(6), status: 'signup' }),
  activityRow({ _id: 'act-11', club_id: 'club-c', title: '篮球赛（待审）', start_time: daysLater(2), status: 'pending' })
)

const clubFn = require('../uniCloud-aliyun/cloudfunctions/club/index.js')

async function call(pathname, { method = 'GET', query, token } = {}) {
  const headers = { 'content-type': 'application/json' }
  if (token) headers.authorization = `Bearer ${token}`
  const res = await clubFn.main({
    httpMethod: method,
    path: pathname.replace(/^\/club/, ''),
    headers,
    body: '',
    queryStringParameters: query || {},
  })
  return { statusCode: res.statusCode, payload: JSON.parse(res.body) }
}

const idsOf = (payload) => payload.data.list.map((item) => item._id)

async function main() {
  /* ---------- 1. 公开访问与默认排序 ---------- */
  console.log('\n【列表 · 公开访问与默认综合排序】')
  let r = await call('/club/list')
  assert('无 token 可访问（游客态可浏览，需求 4.1）', r.payload.code === 0, JSON.stringify(r.payload).slice(0, 200))
  assert('仅返回 normal 社团（待审 / 驳回 / 封禁不可见）', r.payload.data.total === 4, JSON.stringify(r.payload.data.total))
  assert('默认综合排序：星级 × 20 + 成员数加权', idsOf(r.payload).join(',') === 'club-a,club-d,club-b,club-c', JSON.stringify(idsOf(r.payload)))
  assert('默认每页 20 条且 has_more 为 false', r.payload.data.page_size === 20 && r.payload.data.has_more === false, JSON.stringify({ page_size: r.payload.data.page_size, has_more: r.payload.data.has_more }))

  const cardA = r.payload.data.list[0]
  assert('聚合计数：成员数只计 active（3 人，已移除不计）', cardA.member_count === 3, JSON.stringify(cardA))
  assert(
    '聚合计数：活动数排除 draft / pending（10 条中 8 条已发布）',
    cardA.activity_count === 8 && stores.activities.filter((item) => item.club_id === 'club-a').length === 10,
    JSON.stringify(cardA)
  )
  assert('派生标签：分类 + 星级 + 活跃（100 天前入驻无「新入驻」）', cardA.tags.join('|') === '学术科技|5 星社团|活跃', JSON.stringify(cardA.tags))
  const cardB = r.payload.data.list.find((item) => item._id === 'club-b')
  assert('新入驻（30 天内）派生标签生效', cardB.tags.indexOf('新入驻') !== -1, JSON.stringify(cardB.tags))
  const cardC = r.payload.data.list.find((item) => item._id === 'club-c')
  assert('未评定社团无星级标签且活动数不含待审活动', cardC.star_level === 0 && cardC.activity_count === 0 && cardC.tags.indexOf('活跃') === -1, JSON.stringify(cardC))

  /* ---------- 2. 排序切换 ---------- */
  console.log('\n【列表 · 最新排序】')
  r = await call('/club/list', { query: { sort: 'latest' } })
  assert('latest：入驻时间倒序', idsOf(r.payload).join(',') === 'club-d,club-b,club-a,club-c', JSON.stringify(idsOf(r.payload)))

  /* ---------- 3. 筛选 ---------- */
  console.log('\n【列表 · 筛选】')
  r = await call('/club/list', { query: { category_id: 'c-2' } })
  assert('分类筛选（单选）', idsOf(r.payload).join(',') === 'club-d,club-b', JSON.stringify(idsOf(r.payload)))

  r = await call('/club/list', { query: { star_min: 4 } })
  assert('星级筛选：4 星及以上', idsOf(r.payload).join(',') === 'club-a,club-d', JSON.stringify(idsOf(r.payload)))

  r = await call('/club/list', { query: { star_min: 1 } })
  assert('星级筛选：已排除未评定社团', idsOf(r.payload).indexOf('club-c') === -1, JSON.stringify(idsOf(r.payload)))

  r = await call('/club/list', { query: { category_id: 'c-2', star_min: 4 } })
  assert('分类 + 星级组合筛选', idsOf(r.payload).join(',') === 'club-d', JSON.stringify(idsOf(r.payload)))

  r = await call('/club/list', { query: { keyword: '天文' } })
  assert('关键词命中社团名称', idsOf(r.payload).join(',') === 'club-a', JSON.stringify(idsOf(r.payload)))

  r = await call('/club/list', { query: { keyword: '跳舞' } })
  assert('关键词命中社团简介', idsOf(r.payload).join(',') === 'club-b', JSON.stringify(idsOf(r.payload)))

  r = await call('/club/list', { query: { keyword: '.*' } })
  assert('关键词正则元字符被转义（不命中全表）', r.payload.data.total === 0, JSON.stringify(r.payload.data.total))

  r = await call('/club/list', { query: { keyword: '天文', category_id: 'c-2' } })
  assert('关键词 + 分类组合无结果时 total 为 0', r.payload.code === 0 && r.payload.data.total === 0, JSON.stringify(r.payload.data.total))

  /* ---------- 4. 分页 ---------- */
  console.log('\n【列表 · 分页】')
  r = await call('/club/list', { query: { page: 1, page_size: 2 } })
  const page1 = idsOf(r.payload)
  assert('第一页切片正确且 has_more=true', page1.join(',') === 'club-a,club-d' && r.payload.data.has_more === true, JSON.stringify({ page1, has_more: r.payload.data.has_more }))

  r = await call('/club/list', { query: { page: 2, page_size: 2 } })
  const page2 = idsOf(r.payload)
  assert('第二页切片正确且 has_more=false', page2.join(',') === 'club-b,club-c' && r.payload.data.has_more === false, JSON.stringify({ page2, has_more: r.payload.data.has_more }))

  r = await call('/club/list', { query: { page: 3, page_size: 2 } })
  assert('越界页码返回空列表', r.payload.data.list.length === 0 && r.payload.data.total === 4, JSON.stringify(r.payload.data))

  const again = await call('/club/list', { query: { page: 1, page_size: 2 } })
  assert('重复请求分页顺序稳定', idsOf(again.payload).join(',') === page1.join(','), JSON.stringify(idsOf(again.payload)))

  /* ---------- 5. 参数校验 ---------- */
  console.log('\n【列表 · 参数校验】')
  r = await call('/club/list', { query: { page: '0' } })
  assert('page=0 → 1001', r.payload.code === 1001, JSON.stringify(r.payload))
  r = await call('/club/list', { query: { page: 'abc' } })
  assert('page 非数字 → 1001', r.payload.code === 1001, JSON.stringify(r.payload))
  r = await call('/club/list', { query: { page_size: 51 } })
  assert('page_size 超上限 → 1001', r.payload.code === 1001, JSON.stringify(r.payload))
  r = await call('/club/list', { query: { sort: 'bogus' } })
  assert('sort 非法 → 1001', r.payload.code === 1001, JSON.stringify(r.payload))
  r = await call('/club/list', { query: { star_min: 6 } })
  assert('star_min 越界 → 1001', r.payload.code === 1001, JSON.stringify(r.payload))
  r = await call('/club/list', { query: { keyword: '一二三四五六七八九十一二三四五六七八九十一' } })
  assert('关键词超长 → 1001', r.payload.code === 1001 && r.payload.message.includes('20'), JSON.stringify(r.payload))

  /* ---------- 6. 详情 ---------- */
  console.log('\n【详情】')
  r = await call('/club/detail')
  assert('缺 club_id → 1001', r.payload.code === 1001, JSON.stringify(r.payload))

  r = await call('/club/detail', { query: { club_id: 'not-exist' } })
  assert('社团不存在 → 404', r.statusCode === 404 && r.payload.code === 404, JSON.stringify(r.payload))

  r = await call('/club/detail', { query: { club_id: 'club-banned' } })
  assert('封禁社团 → 404（学生端不可见）', r.payload.code === 404, JSON.stringify(r.payload))

  r = await call('/club/detail', { query: { club_id: 'club-pending' } })
  assert('待审社团 → 404', r.payload.code === 404, JSON.stringify(r.payload))

  r = await call('/club/detail', { query: { club_id: 'club-a' } })
  const detail = r.payload.data
  assert('正常社团返回基础信息与计数', r.payload.code === 0 && detail.club.name === '天文社' && detail.club.category_name === '学术科技' && detail.club.member_count === 3 && detail.club.activity_count === 8 && detail.club.logo === 'https://cdn.example.com/a.png', JSON.stringify(detail.club).slice(0, 260))

  const acts = detail.activities
  assert('详情活动：最多 5 条', acts.length === 5, JSON.stringify(acts.map((i) => i._id)))
  assert('详情活动：未结束优先且按开始时间升序', acts.slice(0, 5).map((i) => i._id).join(',') === 'act-4,act-1,act-5,act-8,act-9', JSON.stringify(acts.map((i) => i._id)))
  assert('详情活动：草稿 / 待审活动不出现', acts.every((i) => ['act-3', 'act-7'].indexOf(i._id) === -1), JSON.stringify(acts.map((i) => i._id)))
  assert('详情活动字段为精简结构', acts[0].title === '即将开放的讲座' && acts[0].status === 'approved' && acts[0].location === '体育馆', JSON.stringify(acts[0]))

  r = await call('/club/detail', { query: { club_id: 'club-b' } })
  assert('无活动社团返回空活动列表', r.payload.code === 0 && r.payload.data.activities.length === 0, JSON.stringify(r.payload.data.activities))

  console.log(`\n通过 ${passed} 项，失败 ${failed} 项`)
  if (failed > 0) process.exitCode = 1
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
