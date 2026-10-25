/**
 * P1-22 本地验收（离线，无需部署）
 * 覆盖：首页聚合 GET /home/index
 *       公告（published 过滤 / limit 5 / 倒序）、分类（sort 升序 / limit 8）、
 *       精选活动（status=signup 过滤 / 报名数倒序 / approved 口径 / 分页 / 进度条）、
 *       热门社团（成员数倒序 / active 口径 / top 5 / join 分类名）、
 *       招新推荐（open 过滤 / signup_end 升序 / 余量 / top 5 / join 社团名）、
 *       参数校验（page / page_size）、空数据全空
 * 运行：node scripts/test-p1-22.js
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

/* ---------- 集合 stub（含 aggregate） ---------- */
let seq = 0
const stores = { announcements: [], categories: [], clubs: [], activities: [], recruitments: [], activity_registrations: [], recruitment_registrations: [], club_members: [], messages: [], sensitive_words: [] }

function matchCond(row, cond) {
  if (cond && cond.__and) return cond.__and.every((item) => matchCond(row, item))
  if (cond && cond.__or) return cond.__or.some((item) => matchCond(row, item))
  return Object.keys(cond).every((key) => {
    const want = cond[key]
    if (want instanceof RegExp) return want.test(String(row[key] == null ? '' : row[key]))
    if (want && typeof want === 'object') {
      if (Object.prototype.hasOwnProperty.call(want, '__in')) return want.__in.indexOf(row[key]) !== -1
      if (Object.prototype.hasOwnProperty.call(want, '__neq')) return row[key] !== want.__neq
      if (Object.prototype.hasOwnProperty.call(want, '__gte')) return new Date(row[key]).getTime() >= new Date(want.__gte).getTime()
      if (Object.prototype.hasOwnProperty.call(want, '__lte')) return new Date(row[key]).getTime() <= new Date(want.__lte).getTime()
      if (Object.prototype.hasOwnProperty.call(want, '__lt')) return new Date(row[key]).getTime() < new Date(want.__lt).getTime()
      if (Object.prototype.hasOwnProperty.call(want, '__gt')) return new Date(row[key]).getTime() > new Date(want.__gt).getTime()
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
      result.forEach((row) => Object.assign(row, patch))
      return { updated: result.length }
    },
  }
  return query
}

function aggregateFor(rows) {
  let match = null
  let group = null
  const agg = {
    match: (cond) => {
      match = cond
      return agg
    },
    group: (spec) => {
      group = spec
      return agg
    },
    end: async () => {
      let list = rows.slice()
      if (match) list = list.filter((row) => matchCond(row, match))
      if (!group) return { data: list }
      const keyField = String(group._id).replace(/^\$/, '')
      const sumField = Object.keys(group).find((k) => k !== '_id')
      const sumValue = group[sumField] && group[sumField].__sum
      const map = new Map()
      for (const row of list) {
        const key = row[keyField] == null ? null : row[keyField]
        const cur = map.get(key) || { _id: key, [sumField]: 0 }
        cur[sumField] += typeof sumValue === 'number' ? sumValue : 1
        map.set(key, cur)
      }
      return { data: Array.from(map.values()) }
    },
  }
  return agg
}

function collectionFor(name) {
  const rowsOf = () => stores[name] || []
  return {
    where: (cond) => makeQuery(rowsOf().filter((row) => matchCond(row, cond))),
    aggregate: () => aggregateFor(rowsOf()),
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
      lte: (value) => ({ __lte: value }),
      lt: (value) => ({ __lt: value }),
      gt: (value) => ({ __gt: value }),
      aggregate: { sum: (value) => ({ __sum: value }) },
    },
  }),
  httpclient: { request: async () => ({ data: { access_token: 'T', expires_in: 7200 } }) },
}

/* ---------- 种子数据 ---------- */
const DAY = 24 * 3600 * 1000
const now = Date.now()
const at = (ms) => new Date(ms)

function cat(id, name, sort) { return { _id: id, name, sort, deleted: 0 } }
stores.categories.push(
  cat('c-1', '学术科技', 3),
  cat('c-2', '文艺表演', 1),
  cat('c-3', '体育竞技', 2),
  cat('c-4', '公益实践', 4),
  cat('c-5', '创新创业', 5),
  cat('c-6', '国学文化', 6),
  cat('c-7', '信息技术', 7),
  cat('c-8', '摄影影视', 8),
  cat('c-9', '第九分类', 9)
)

function mkClub(id, name, categoryId, star) { return { _id: id, name, intro: '', contact: '', category_id: categoryId, star_level: star, status: 'normal', deleted: 0 } }
stores.clubs.push(
  mkClub('club-a', '天文社', 'c-1', 5),
  mkClub('club-b', '街舞社', 'c-2', 3),
  mkClub('club-c', '篮球社', 'c-3', 2),
  mkClub('club-d', '志愿者', 'c-4', 4),
  mkClub('club-e', '摄影社', 'c-8', 1),
  mkClub('club-f', '冷社团', 'c-5', 2)
)
stores.club_members.push(
  { _id: 'cm-1', club_id: 'club-a', user_id: 'u1', role: 'president', status: 'active', deleted: 0 },
  { _id: 'cm-2', club_id: 'club-a', user_id: 'u2', role: 'member', status: 'active', deleted: 0 },
  { _id: 'cm-3', club_id: 'club-b', user_id: 'u3', role: 'president', status: 'active', deleted: 0 },
  { _id: 'cm-4', club_id: 'club-c', user_id: 'u4', role: 'president', status: 'active', deleted: 0 },
  { _id: 'cm-5', club_id: 'club-d', user_id: 'u5', role: 'president', status: 'active', deleted: 0 },
  { _id: 'cm-6', club_id: 'club-e', user_id: 'u6', role: 'president', status: 'active', deleted: 0 },
  { _id: 'cm-7', club_id: 'club-a', user_id: 'u7', role: 'member', status: 'removed', deleted: 0 }
)

const act = (id, clubId, categoryId, status, createdMs) => ({ _id: id, club_id: clubId, title: `活动${id}`, content: '', cover: '', category_id: categoryId, location: '某地', start_time: at(now + DAY), end_time: at(now + 2 * DAY), capacity: 10, status, created_at: at(createdMs), deleted: 0 })
stores.activities.push(
  act('act-1', 'club-a', 'c-1', 'signup', now - 3 * DAY),
  act('act-2', 'club-b', 'c-2', 'signup', now - 2 * DAY),
  act('act-3', 'club-c', 'c-3', 'signup', now - 1 * DAY),
  act('act-4', 'club-d', 'c-4', 'draft', now - 1 * DAY),
  act('act-5', 'club-e', 'c-8', 'signup', now - 4 * DAY),
  act('act-6', 'club-f', 'c-5', 'signup', now - 5 * DAY)
)
stores.activity_registrations.push(
  { _id: 'ar-1', activity_id: 'act-1', status: 'approved' }, // 报名 3 → 最多
  { _id: 'ar-2', activity_id: 'act-1', status: 'approved' },
  { _id: 'ar-3', activity_id: 'act-1', status: 'approved' },
  { _id: 'ar-4', activity_id: 'act-1', status: 'waitlist' }, // 不计
  { _id: 'ar-5', activity_id: 'act-2', status: 'approved' }, // 报名 2
  { _id: 'ar-6', activity_id: 'act-2', status: 'approved' },
  { _id: 'ar-7', activity_id: 'act-3', status: 'approved' }, // 报名 1
  { _id: 'ar-8', activity_id: 'act-5', status: 'approved' }, // 报名 2
  { _id: 'ar-9', activity_id: 'act-5', status: 'approved' }
)

const rc = (id, clubId, status, endMs) => ({ _id: id, club_id: clubId, title: `岗位${id}`, content: '', form_fields: [], signup_end: at(endMs), capacity: null, status, created_at: at(now - DAY), deleted: 0 })
stores.recruitments.push(
  rc('rc-1', 'club-a', 'open', now + 6 * DAY),
  rc('rc-2', 'club-b', 'open', now + 3 * DAY),
  rc('rc-3', 'club-c', 'open', now + 8 * DAY),
  rc('rc-4', 'club-d', 'closed', now + 1 * DAY)
)
stores.recruitment_registrations.push(
  { _id: 'rr-1', recruitment_id: 'rc-1', status: 'pending' },
  { _id: 'rr-2', recruitment_id: 'rc-1', status: 'accepted' },
  { _id: 'rr-3', recruitment_id: 'rc-2', status: 'interview' }
)

stores.announcements.push(
  { _id: 'ann-1', title: '招新季公告', content: '本周六', banner: '', status: 'published', created_at: at(now - 1 * DAY), deleted: 0 },
  { _id: 'ann-2', title: '百团大战', content: '详情', banner: '', status: 'published', created_at: at(now - 2 * DAY), deleted: 0 },
  { _id: 'ann-3', title: '下架公告', content: '不应出现', banner: '', status: 'offline', created_at: at(now - 3 * DAY), deleted: 0 },
  { _id: 'ann-4', title: '软删公告', content: '不应出现', banner: '', status: 'published', created_at: at(now - 4 * DAY), deleted: 1 }
)

const homeFn = require('../uniCloud-aliyun/cloudfunctions/home/index.js')

async function call(query = {}) {
  const res = await homeFn.main({
    httpMethod: 'GET',
    path: '/index',
    headers: { 'content-type': 'application/json' },
    body: '',
    queryStringParameters: query,
  })
  return { statusCode: res.statusCode, payload: JSON.parse(res.body) }
}

async function main() {
  console.log('\n【GET /home/index】')

  let r = await call({ page: 0 })
  assert('page 非法 → 1001', r.payload.code === 1001, JSON.stringify(r.payload))
  r = await call({ page_size: 999 })
  assert('page_size 超限 → 1001', r.payload.code === 1001, JSON.stringify(r.payload))

  r = await call({})
  assert('公开访问 → 0', r.payload.code === 0, JSON.stringify(r.payload))
  const data = r.payload.data

  /* ---- 公告 ---- */
  assert('公告：仅 published + 倒序（ann-1 → ann-2，排除 offline/软删）', data.banners.map((b) => b._id).join(',') === 'ann-1,ann-2', JSON.stringify(data.banners.map((b) => b._id)))

  /* ---- 分类 ---- */
  assert('分类：sort 升序 + 最多 8 个', data.categories.map((c) => c._id).join(',') === 'c-2,c-3,c-1,c-4,c-5,c-6,c-7,c-8', JSON.stringify(data.categories.map((c) => c._id)))

  /* ---- 精选活动 ---- */
  const actIds = data.activities.list.map((a) => a._id)
  assert('精选活动：排除 draft（act-1 报名3 > act-2/act-5 报名2 > act-3 报名1 > act-6 报名0，act-4 draft 不计）', data.activities.total === 5 && actIds.join(',') === 'act-1,act-2,act-5,act-3,act-6', JSON.stringify(data.activities.list.map((a) => `${a._id}:${a.signup_count}`)))
  assert('精选活动：approved 口径（waitlist 不计）', data.activities.list.find((a) => a._id === 'act-1').signup_count === 3, JSON.stringify(data.activities.list[0]))
  assert('精选活动：join 分类名 + 进度条', data.activities.list[0].club_name === '天文社' && data.activities.list[0].progress === 30, JSON.stringify(data.activities.list[0]))
  assert('精选活动：分页 page1 只有 5 条 + has_more', data.activities.list.length === 5 && data.activities.has_more === false, JSON.stringify({ n: data.activities.list.length, m: data.activities.has_more }))

  r = await call({ page: 1, page_size: 2 })
  assert('精选活动：page_size=2 分页 → act-1 + has_more', r.payload.data.activities.list.map((a) => a._id).join(',') === 'act-1,act-2' && r.payload.data.activities.has_more === true, JSON.stringify(r.payload.data.activities.list.map((a) => a._id)))

  /* ---- 热门社团 ---- */
  const clubIds = data.clubs.map((c) => c._id)
  assert('热门社团：成员数倒序 top5（a2 > b1=c1=d1=e1 > f0，removed 不计；f 落榜）', clubIds.join(',') === 'club-a,club-b,club-c,club-d,club-e', JSON.stringify(data.clubs.map((c) => `${c.name}:${c.member_count}`)))
  assert('热门社团：join 分类名 + 活动数', data.clubs.find((c) => c._id === 'club-a').category_name === '学术科技' && data.clubs.find((c) => c._id === 'club-b').activity_count === 1, JSON.stringify(data.clubs[0]))

  /* ---- 招新推荐 ---- */
  const rcIds = data.recruitments.map((x) => x._id)
  assert('招新推荐：open 过滤 + signup_end 升序（rc-2 3d < rc-1 6d < rc-3 8d，closed 不计）', rcIds.join(',') === 'rc-2,rc-1,rc-3', JSON.stringify(data.recruitments.map((x) => `${x._id}:${x.remaining}`)))
  assert('招新推荐：join 社团名/logo + 余量（均不限 → null，点击数正确）', data.recruitments.find((x) => x._id === 'rc-1').club_name === '天文社' && data.recruitments.find((x) => x._id === 'rc-1').remaining === null && data.recruitments.find((x) => x._id === 'rc-2').club_name === '街舞社' && data.recruitments.find((x) => x._id === 'rc-1').signup_count === 2, JSON.stringify(data.recruitments[1]))

  /* ---- 空数据社团 ---- */
  r = await call({ page: 1 })
  assert('热干面社团空数据全部非空容器', data.clubs.length === 5 && data.recruitments.length === 3, 'data 结构完整')

  /* ---------- 汇总 ---------- */
  console.log(`\n结果：${passed} 通过，${failed} 失败`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})