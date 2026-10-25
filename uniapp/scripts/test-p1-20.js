/**
 * P1-20 本地验收（离线，无需部署）
 * 覆盖：统计权限（缺参 / range 非法 / 非负责人 403 / 干部可看）、活动口径（发布数排除 draft/pending/软删、
 *       报名数 approved 口径、签到数与签到率、0 人报名签到率 null、状态分布）、
 *       招新口径（岗位数 / 报名数 / 录取数）、成员计数（removed 不计入）、
 *       时间范围过滤（7d / 30d 只计范围内活动与岗位，成员存量不变）、空数据全零
 * 运行：node scripts/test-p1-20.js
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

/* ---------- 集合 stub（含 aggregate：match + group($field, sum) + end） ---------- */
let seq = 0
const stores = { clubs: [], club_members: [], users: [], categories: [], activities: [], activity_registrations: [], recruitments: [], recruitment_registrations: [], checkins: [], messages: [], sensitive_words: [] }

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
const now = new Date()
const at = (ms) => new Date(ms)

function user(over) {
  seq += 1
  return { _id: `u-${seq}`, openid: `openid-${seq}`, name: '用户', student_no: `2026010${seq}01`, auth_status: 'verified', status: 'normal', deleted: 0, ...over }
}
const uP = user({ name: '林社长' })
const uO = user({ name: '何干部' })
const uM1 = user({ name: '苏成员' })
const uM2 = user({ name: '赵成员' })
const uRm = user({ name: '被移除' })
const uOutsider = user({ name: '路人' })
stores.users.push(uP, uO, uM1, uM2, uRm, uOutsider)

stores.clubs.push(
  { _id: 'club-a', name: '天文社', intro: '', contact: '', status: 'normal', deleted: 0 },
  { _id: 'club-empty', name: '空社团', intro: '', contact: '', status: 'normal', deleted: 0 }
)
stores.club_members.push(
  { _id: 'm-p', club_id: 'club-a', user_id: uP._id, role: 'president', status: 'active', joined_at: at(now.getTime() - 30 * DAY), deleted: 0 },
  { _id: 'm-o', club_id: 'club-a', user_id: uO._id, role: 'officer', status: 'active', joined_at: at(now.getTime() - 20 * DAY), deleted: 0 },
  { _id: 'm-1', club_id: 'club-a', user_id: uM1._id, role: 'member', status: 'active', joined_at: at(now.getTime() - 10 * DAY), deleted: 0 },
  { _id: 'm-2', club_id: 'club-a', user_id: uM2._id, role: 'member', status: 'active', joined_at: at(now.getTime() - 5 * DAY), deleted: 0 },
  { _id: 'm-rm', club_id: 'club-a', user_id: uRm._id, role: 'member', status: 'removed', joined_at: at(now.getTime() - 1 * DAY), deleted: 0 },
  { _id: 'm-ep', club_id: 'club-empty', user_id: uP._id, role: 'president', status: 'active', joined_at: at(now.getTime() - 1 * DAY), deleted: 0 }
)

const reg = (id, clubId, status, createdMs) => ({ _id: id, club_id: clubId, title: id, status, created_at: at(createdMs), deleted: 0 })
const ar = (id, activityId, status) => ({ _id: id, activity_id: activityId, status, deleted: 0 })
const rr = (id, recruitmentId, status) => ({ _id: id, recruitment_id: recruitmentId, status, deleted: 0 })

stores.activities.push(
  reg('a1', 'club-a', 'ended', now.getTime() - 1 * DAY),
  reg('a2', 'club-a', 'signup', now.getTime() - 2 * DAY),
  reg('a3', 'club-a', 'draft', now.getTime() - 3 * DAY),
  reg('a4', 'club-a', 'pending', now.getTime() - 3 * DAY),
  reg('a5', 'club-a', 'ended', now.getTime() - 40 * DAY),
  reg('a6', 'club-a', 'ended', now.getTime() - 1 * DAY) // 软删，不计
)
stores.activities[5].deleted = 1

stores.activity_registrations.push(
  ar('ar-1', 'a1', 'approved'),
  ar('ar-2', 'a1', 'approved'),
  ar('ar-3', 'a1', 'approved'),
  ar('ar-4', 'a1', 'waitlist'),
  ar('ar-5', 'a1', 'cancelled'),
  ar('ar-6', 'a2', 'approved'),
  ar('ar-7', 'a2', 'approved'),
  ar('ar-8', 'a5', 'approved')
)
stores.checkins.push(
  { _id: 'ci-1', activity_id: 'a1', user_id: 'x1', signin_time: at(now.getTime() - 1 * DAY), deleted: 0 },
  { _id: 'ci-2', activity_id: 'a1', user_id: 'x2', signin_time: at(now.getTime() - 1 * DAY), deleted: 0 },
  { _id: 'ci-3', activity_id: 'a2', user_id: 'x3', signin_time: at(now.getTime() - 1 * DAY), deleted: 0 },
  { _id: 'ci-4', activity_id: 'a2', user_id: 'x4', signin_time: at(now.getTime() - 1 * DAY), deleted: 0 }
)
stores.recruitments.push(
  reg('r1', 'club-a', 'open', now.getTime() - 1 * DAY),
  reg('r2', 'club-a', 'closed', now.getTime() - 50 * DAY)
)
stores.recruitment_registrations.push(
  rr('rr-1', 'r1', 'accepted'),
  rr('rr-2', 'r1', 'accepted'),
  rr('rr-3', 'r1', 'pending'),
  rr('rr-4', 'r1', 'rejected'),
  rr('rr-5', 'r2', 'accepted')
)

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

async function call(query, token) {
  const headers = { 'content-type': 'application/json' }
  if (token) headers.authorization = `Bearer ${token}`
  const res = await clubFn.main({
    httpMethod: 'GET',
    path: '/stats',
    headers,
    body: '',
    queryStringParameters: query || {},
  })
  return { statusCode: res.statusCode, payload: JSON.parse(res.body) }
}

async function main() {
  console.log('\n【GET /stats】')
  let r = await call({}, studentToken(uP))
  assert('缺 club_id → 1001', r.payload.code === 1001, JSON.stringify(r.payload))

  r = await call({ club_id: 'club-a', range: 'bad' }, studentToken(uP))
  assert('range 非法 → 1001', r.payload.code === 1001, JSON.stringify(r.payload))

  r = await call({ club_id: 'club-a' }, studentToken(uOutsider))
  assert('非负责人 → 403', r.payload.code === 403, JSON.stringify(r.payload))

  r = await call({ club_id: 'club-a' }, studentToken(uM1))
  assert('普通成员 → 403', r.payload.code === 403, JSON.stringify(r.payload))

  r = await call({ club_id: 'club-a' }, studentToken(uO))
  assert('干部可查看统计 → 0', r.payload.code === 0, JSON.stringify(r.payload))

  r = await call({ club_id: 'club-a' }, studentToken(uP))
  const data = r.payload.data
  assert('all：发布数排除 draft/pending/软删（ended+signup+ended=3）', r.payload.code === 0 && data.activity.published === 3, JSON.stringify(data.activity.published))
  assert('all：状态分布', data.activity.status_dist.draft === 1 && data.activity.status_dist.pending === 1 && data.activity.status_dist.signup === 1 && data.activity.status_dist.ended === 2 && data.activity.status_dist.archived === 0, JSON.stringify(data.activity.status_dist))
  assert('all：报名数 approved 口径（3+2+1=6，waitlist/cancelled 不计）', data.activity.signups === 6, JSON.stringify(data.activity.signups))
  assert('all：签到数与签到率（4/6=0.67）', data.activity.signin_count === 4 && data.activity.signin_rate === 0.67, JSON.stringify({ c: data.activity.signin_count, r: data.activity.signin_rate }))
  assert('all：招新岗位/报名/录取（2 岗，报名 4+1=5，录取 2+1=3）', data.recruitment.posts === 2 && data.recruitment.signups === 5 && data.recruitment.accepted === 3, JSON.stringify(data.recruitment))
  assert('all：成员计数（removed 不计入）', data.member.total === 4 && data.member.president === 1 && data.member.officer === 1 && data.member.member === 2, JSON.stringify(data.member))
  assert('返回 club 信息与 range', data.club && data.club._id === 'club-a' && data.range === 'all', JSON.stringify(data.club))

  r = await call({ club_id: 'club-a', range: '7d' }, studentToken(uP))
  const d7 = r.payload.data
  assert('7d：发布数只计 7 天内活动（a1+a2=2，a5 40d 不计）', d7.activity.published === 2, JSON.stringify(d7.activity.published))
  assert('7d：报名数只计范围内活动（3+2=5）', d7.activity.signups === 5, JSON.stringify(d7.activity.signups))
  assert('7d：招新只计范围内岗位（r1）', d7.recruitment.posts === 1 && d7.recruitment.signups === 4 && d7.recruitment.accepted === 2, JSON.stringify(d7.recruitment))
  assert('7d：成员为存量不受范围影响', d7.member.total === 4, JSON.stringify(d7.member))

  r = await call({ club_id: 'club-a', range: '30d' }, studentToken(uP))
  const d30 = r.payload.data
  assert('30d：a5 在 40d 前仍不计入', d30.activity.published === 2 && d30.activity.signups === 5, JSON.stringify({ p: d30.activity.published, s: d30.activity.signups }))

  r = await call({ club_id: 'club-empty' }, studentToken(uP))
  const empty = r.payload.data
  assert('空社团：活动/招新归零 + 签到率 null + 成员仅社长', r.payload.code === 0 && empty.activity.published === 0 && empty.activity.signups === 0 && empty.activity.signin_rate === null && empty.recruitment.posts === 0 && empty.recruitment.accepted === 0 && empty.member.total === 1 && empty.member.president === 1, JSON.stringify(empty))

  /* ---------- 汇总 ---------- */
  console.log(`\n结果：${passed} 通过，${failed} 失败`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
