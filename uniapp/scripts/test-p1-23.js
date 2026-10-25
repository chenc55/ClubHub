/**
 * P1-23 本地验收（离线，无需部署）
 * 覆盖：关键词校验（空关键词 / 超长）、三路检索（社团名/简介、活动标题、招新标题）、
 *       状态过滤（非 normal 社团 / 未发布活动 / closed 岗位）、正则元字符转义、活动排序（时间升序 + ended 沉底）、
 *       招新按 club 挂靠 + 截止升序、社团综合排序（星级×20 + 成员数）、分页
 * 运行：node scripts/test-p1-23.js
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

/* ---------- 集合 stub（含 aggregate + 正则） ---------- */
let seq = 0
const stores = { clubs: [], categories: [], activities: [], recruitments: [], activity_registrations: [], recruitment_registrations: [], club_members: [], messages: [], sensitive_words: [] }

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
    limit: () => agg,
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

function cat(id, name) { return { _id: id, name, sort: 1, deleted: 0 } }
stores.categories.push(cat('c-1', '学术科技'), cat('c-2', '文艺表演'))

function mkClub(id, name, intro, star, status) { return { _id: id, name, intro, contact: '', category_id: id === 'club-a' ? 'c-1' : 'c-2', star_level: star, status, deleted: 0 } }
stores.clubs.push(
  mkClub('club-a', '天文社', '一起看流星雨', 5, 'normal'),
  mkClub('club-b', '摄影社', '天文摄影爱好者', 2, 'normal'),
  mkClub('club-c', '封禁社', '天文相关被封', 1, 'banned')
)
stores.club_members.push(
  { _id: 'cm-1', club_id: 'club-a', user_id: 'u1', role: 'president', status: 'active', deleted: 0 },
  { _id: 'cm-2', club_id: 'club-a', user_id: 'u2', role: 'member', status: 'active', deleted: 0 },
  { _id: 'cm-3', club_id: 'club-b', user_id: 'u3', role: 'president', status: 'active', deleted: 0 },
  { _id: 'cm-4', club_id: 'club-a', user_id: 'u4', role: 'member', status: 'removed', deleted: 0 }
)

const act = (id, clubId, title, status, startMs) => ({ _id: id, club_id: clubId, title, content: '', cover: '', category_id: 'c-1', location: '某地', start_time: at(startMs), end_time: at(startMs + 2 * 3600 * 1000), capacity: 10, status, created_at: at(now - DAY), deleted: 0 })
stores.activities.push(
  act('act-1', 'club-a', '观星天文夜', 'signup', now + 2 * DAY),
  act('act-2', 'club-b', '天文摄影展', 'ended', now + 1 * DAY),
  act('act-3', 'club-a', '天文科普讲座', 'signup', now + 3 * DAY),
  act('act-4', 'club-b', '游泳课', 'draft', now + 1 * DAY)
)
stores.activity_registrations.push(
  { _id: 'ar-1', activity_id: 'act-1', status: 'approved' },
  { _id: 'ar-2', activity_id: 'act-1', status: 'approved' },
  { _id: 'ar-3', activity_id: 'act-2', status: 'approved' }
)

const mkRc = (id, clubId, title, status) => ({ _id: id, club_id: clubId, title, content: '', form_fields: [], signup_end: at(now + 3 * DAY), capacity: 10, status, created_at: at(now - DAY), deleted: 0 })
stores.recruitments.push(
  mkRc('rc-1', 'club-a', '天文干事招新', 'open'),
  mkRc('rc-2', 'club-b', '天文摄影师', 'open'),
  mkRc('rc-3', 'club-a', '天文志愿者', 'closed')
)
stores.recruitment_registrations.push(
  { _id: 'rr-1', recruitment_id: 'rc-1', status: 'pending' },
  { _id: 'rr-2', recruitment_id: 'rc-1', status: 'accepted' },
  { _id: 'rr-3', recruitment_id: 'rc-2', status: 'interview' }
)

const searchFn = require('../uniCloud-aliyun/cloudfunctions/search/index.js')

async function call(query = {}) {
  const res = await searchFn.main({
    httpMethod: 'GET',
    path: '/global',
    headers: { 'content-type': 'application/json' },
    body: '',
    queryStringParameters: query,
  })
  return { statusCode: res.statusCode, payload: JSON.parse(res.body) }
}

async function main() {
  console.log('\n【GET /search/global】')

  let r = await call({})
  assert('空关键词 → 1001', r.payload.code === 1001, JSON.stringify(r.payload))
  r = await call({ keyword: '   ' })
  assert('纯空格关键词 → 1001', r.payload.code === 1001, JSON.stringify(r.payload))
  r = await call({ keyword: 'x'.repeat(21) })
  assert('超长关键词 → 1001', r.payload.code === 1001, JSON.stringify(r.payload))
  r = await call({ keyword: '天文', page: 0 })
  assert('page 非法 → 1001', r.payload.code === 1001, JSON.stringify(r.payload))

  r = await call({ keyword: '天文' })
  const data = r.payload.data
  assert('公开访问 → 0', r.payload.code === 0, JSON.stringify(r.payload.message))

  /* ---- 社团 ---- */
  const clubNames = data.clubs.map((c) => c._id)
  assert('社团：名称/简介命中（club-a 名称 + club-b 简介「天文」，banned club-c 不含）', clubNames.join(',') === 'club-a,club-b', JSON.stringify(data.clubs.map((c) => `${c._id}:${c.name}`)))
  assert('社团：综合排序 星级×20+成员（club-a 5×20+2=102 > club-b 2×20+1=41）', clubNames[0] === 'club-a', JSON.stringify(data.clubs.map((c) => `${c.name}:${c.star_level * 20 + c.member_count}`)))
  assert('社团：join 分类名/成员数（removed 不计）', data.clubs.find((c) => c._id === 'club-a').category_name === '学术科技' && data.clubs.find((c) => c._id === 'club-a').member_count === 2, JSON.stringify(data.clubs[0]))

  /* ---- 招新挂靠 ---- */
  assert('招新挂靠：club-a 挂 rc-1（open 命中）、rc-3 closed 不计；club-b 挂 rc-2', data.clubs.find((c) => c._id === 'club-a').recruitments.map((x) => x._id).join(',') === 'rc-1' && data.clubs.find((c) => c._id === 'club-b').recruitments.map((x) => x._id).join(',') === 'rc-2', JSON.stringify(data.clubs.map((c) => [c._id, c.recruitments.map((x) => x._id)])))
  assert('招新余量：rc-1 报名2 容量10 → 剩 8', data.clubs.find((c) => c._id === 'club-a').recruitments[0].remaining === 8, JSON.stringify(data.clubs.find((c) => c._id === 'club-a').recruitments[0]))

  /* ---- 活动 ---- */
  const actIds = data.activities.list.map((a) => a._id)
  assert('活动：标题命中 3 条（act-1/2/3，draft act-4 不计）+ 时间升序 + ended 沉底（act-2 排末尾）', data.activities.total === 3 && actIds.join(',') === 'act-1,act-3,act-2', JSON.stringify(data.activities.list.map((a) => `${a._id}:${a.status}`)))
  assert('活动：join 社团名 + 报名 approved 口径（act-1 报 2）', data.activities.list.find((a) => a._id === 'act-1').club_name === '天文社' && data.activities.list.find((a) => a._id === 'act-1').signup_count === 2, JSON.stringify(data.activities.list[0]))

  /* ---- 正则元字符转义 ---- */
  r = await call({ keyword: 'a.b' })
  assert('正则元字符转义：a.b 不误伤（无匹配 → 全空）', r.payload.code === 0 && r.payload.data.activities.total === 0 && r.payload.data.clubs.length === 0, JSON.stringify(r.payload.data).slice(0, 120))

  /* ---- 分页 ---- */
  r = await call({ keyword: '天文', page: 1, page_size: 2 })
  assert('活动分页 page_size=2 → 前 2 条 + has_more', r.payload.data.activities.list.map((a) => a._id).join(',') === 'act-1,act-3' && r.payload.data.activities.has_more === true, JSON.stringify(r.payload.data.activities))

  /* ---------- 汇总 ---------- */
  console.log(`\n结果：${passed} 通过，${failed} 失败`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})