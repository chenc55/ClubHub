/**
 * P1-24 本地验收（离线，无需部署）
 * 覆盖：学生端「我的社团」GET /club/memberships
 *       无 token 401、join 社团数据（名称/分类/星级/成员数）、含 member 角色、removed 同步消失、
 *       入团时间倒序、空数据、已软删社团过滤
 * 运行：node scripts/test-p1-24.js
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
const stores = { clubs: [], categories: [], club_members: [], activities: [], activity_registrations: [], messages: [], sensitive_words: [] }

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

function cat(id, name) { return { _id: id, name, sort: 1, deleted: 0 } }
stores.categories.push(cat('c-1', '学术科技'), cat('c-2', '文艺表演'))

function mkClub(id, name, categoryId) { return { _id: id, name, intro: '', contact: '', category_id: categoryId, star_level: 3, status: 'normal', deleted: 0 } }
stores.clubs.push(
  mkClub('club-a', '天文社', 'c-1'),
  mkClub('club-b', '街舞社', 'c-2'),
  mkClub('club-c', '软删社', 'c-1')
)
stores.clubs[2].deleted = 1

const uA = { _id: 'u-a', openid: 'openid-a', name: '林同学', status: 'normal', deleted: 0 }
const uB = { _id: 'u-b', openid: 'openid-b', name: '陈同学', status: 'normal', deleted: 0 }
stores.users = [uA, uB]

stores.club_members.push(
  { _id: 'm-1', club_id: 'club-a', user_id: uA._id, role: 'president', status: 'active', joined_at: at(now - 30 * DAY), deleted: 0 },
  { _id: 'm-2', club_id: 'club-b', user_id: uA._id, role: 'member', status: 'active', joined_at: at(now - 5 * DAY), deleted: 0 },
  // 被移除（removed）→ 我的社团同步消失；软删社团记录同样不计
  { _id: 'm-3', club_id: 'club-a', user_id: uA._id, role: 'member', status: 'removed', joined_at: at(now - 1 * DAY), deleted: 0 },
  { _id: 'm-4', club_id: 'club-c', user_id: uA._id, role: 'member', status: 'active', joined_at: at(now - 2 * DAY), deleted: 0 },
  { _id: 'm-5', club_id: 'club-a', user_id: uB._id, role: 'member', status: 'active', joined_at: at(now - 10 * DAY), deleted: 0 }
)
stores.club_members.forEach((m, i) => { if (i === 3) m.deleted = 0 })

const clubFn = require('../uniCloud-aliyun/cloudfunctions/club/index.js')

function studentToken(userRow) {
  return club.signToken({
    type: club.TOKEN_TYPES.STUDENT,
    token_kind: 'access',
    userId: userRow._id,
    openid: userRow.openid,
    auth_status: 'verified',
  })
}

async function call(token) {
  const headers = { 'content-type': 'application/json' }
  if (token) headers.authorization = `Bearer ${token}`
  const res = await clubFn.main({
    httpMethod: 'GET',
    path: '/memberships',
    headers,
    body: '',
    queryStringParameters: {},
  })
  return { statusCode: res.statusCode, payload: JSON.parse(res.body) }
}

async function main() {
  console.log('\n【GET /club/memberships】')

  let r = await call()
  assert('无 token → 401', r.payload.code === 401, JSON.stringify(r.payload))

  r = await call(studentToken(uB))
  assert('成员身份可见自己的社团（club-a 普通成员）', r.payload.code === 0 && r.payload.data.list.length === 1 && r.payload.data.list[0].club_id === 'club-a' && r.payload.data.list[0].role === 'member', JSON.stringify(r.payload.data))

  r = await call(studentToken(uA))
  const list = r.payload.data.list
  assert('含 member 角色（区别于 /my-clubs 管理视图）', r.payload.code === 0 && list.map((m) => m.role).includes('member'), JSON.stringify(r.payload.data))
  assert('removed 成员记录不出现在列表（club-a removed 不计）', list.filter((m) => m.club_id === 'club-a').length === 1, JSON.stringify(r.payload.data))
  assert('已软删社团不计（club-c 缺）', !list.some((m) => m.club_id === 'club-c'), JSON.stringify(r.payload.data))
  assert('入团时间倒序（club-b 5d 前 > club-a 30d 前）', list.map((m) => m.club_id).join(',') === 'club-b,club-a', JSON.stringify(r.payload.data.list.map((m) => `${m.club_id}:${m.joined_at}`)))
  assert('join 社团（名称/分类名/星级/成员数 active）', list.find((m) => m.club_id === 'club-a').club.name === '天文社' && list.find((m) => m.club_id === 'club-a').club.category_name === '学术科技' && list.find((m) => m.club_id === 'club-a').club.star_level === 3 && list.find((m) => m.club_id === 'club-b').club.member_count === 1, JSON.stringify(list[1]))

  /* ---------- 汇总 ---------- */
  console.log(`\n结果：${passed} 通过，${failed} 失败`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})