/**
 * P2-01 本地验收（离线，无需部署）
 * 覆盖：社团动态先发后审 /club/posts/save、/posts/my、/posts/list
 *       鉴权（无 token 401 / 非负责人 403 / member 403 / president·officer 可发布）、
 *       先发后审（block 拦截 / review 放行置 flagged 进疑似队列 / 正常发布）、
 *       正文与图片上限校验、封禁社团不可发布、我的动态（author_id 过滤 + join 社团名 + 分页）、
 *       公开动态流（published 且未删 / 按社团过滤 / 下架不可见）
 * 运行：node scripts/test-p2-01.js
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
const stores = { club_posts: [], clubs: [], club_members: [], users: [], categories: [], activities: [], sensitive_words: [] }

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

stores.sensitive_words.push(
  { _id: 'sw-1', word: '代考', level: 'block', deleted: 0 },
  { _id: 'sw-2', word: '烟花', level: 'review', deleted: 0 }
)
stores.clubs.push(
  { _id: 'club-a', name: '天文社', status: 'normal', deleted: 0 },
  { _id: 'club-b', name: '封禁社', status: 'banned', deleted: 0 }
)
stores.users.push(
  { _id: 'u-pres', openid: 'o-1', name: '社长', status: 'normal', deleted: 0 },
  { _id: 'u-off', openid: 'o-2', name: '干部', status: 'normal', deleted: 0 },
  { _id: 'u-mem', openid: 'o-3', name: '成员', status: 'normal', deleted: 0 },
  { _id: 'u-other', openid: 'o-4', name: '外人', status: 'normal', deleted: 0 }
)
stores.club_members.push(
  { _id: 'm-1', club_id: 'club-a', user_id: 'u-pres', role: 'president', status: 'active', deleted: 0 },
  { _id: 'm-2', club_id: 'club-a', user_id: 'u-off', role: 'officer', status: 'active', deleted: 0 },
  { _id: 'm-3', club_id: 'club-a', user_id: 'u-mem', role: 'member', status: 'active', deleted: 0 },
  { _id: 'm-4', club_id: 'club-b', user_id: 'u-other', role: 'president', status: 'active', deleted: 0 }
)

const fn = require('../uniCloud-aliyun/cloudfunctions/club/index.js')

function studentToken(userRow) {
  return club.signToken({
    type: club.TOKEN_TYPES.STUDENT,
    token_kind: 'access',
    userId: userRow._id,
    openid: userRow.openid,
    auth_status: 'verified',
  })
}
const presToken = studentToken(stores.users[0])
const offToken = studentToken(stores.users[1])
const memToken = studentToken(stores.users[2])
const otherToken = studentToken(stores.users[3])

async function call({ method = 'GET', path, qs = {}, body = null, token = null }) {
  const headers = { 'content-type': 'application/json' }
  if (token) headers.authorization = `Bearer ${token}`
  const res = await fn.main({
    httpMethod: method,
    path,
    headers,
    body: body ? JSON.stringify(body) : '',
    queryStringParameters: qs,
  })
  const payload = JSON.parse(res.body)
  return { statusCode: res.statusCode, payload, code: payload.code, data: payload.data, message: payload.message }
}

async function main() {
  console.log('\n【POST /club/posts/save · 鉴权与权限】')
  let r = await call({ method: 'POST', path: '/posts/save', body: { club_id: 'club-a', content: '测试动态' } })
  assert('无 token → 401', r.code === 401, JSON.stringify(r))

  r = await call({ method: 'POST', path: '/posts/save', body: { club_id: 'club-a', content: '测试动态' }, token: otherToken })
  assert('非该社团成员 → 403', r.code === 403, JSON.stringify(r))

  r = await call({ method: 'POST', path: '/posts/save', body: { club_id: 'club-a', content: '测试动态' }, token: memToken })
  assert('普通 member → 403（仅社长 / 干部可发布）', r.code === 403, JSON.stringify(r))

  console.log('\n【POST /club/posts/save · 先发后审】')
  r = await call({ method: 'POST', path: '/posts/save', body: { club_id: 'club-a', content: '今晚观星活动欢迎参加' }, token: presToken })
  assert('正常发布 → 成功且 flagged=false、queued_for_review=false', r.code === 0 && r.data.post.status === 'published' && r.data.flagged === false && r.data.queued_for_review === false && r.data.post.author_id === 'u-pres', JSON.stringify(r.data))

  r = await call({ method: 'POST', path: '/posts/save', body: { club_id: 'club-a', content: '需要代考服务的请联系' }, token: presToken })
  assert('block 词「代考」→ 拦截发布 1001', r.code === 1001 && r.message.indexOf('违规词') !== -1, JSON.stringify(r))

  r = await call({ method: 'POST', path: '/posts/save', body: { club_id: 'club-a', content: '今晚操场放烟花活动' }, token: offToken })
  assert('review 词「烟花」→ 放行 + flagged=true + queued_for_review=true（进监管疑似队列）', r.code === 0 && r.data.post.status === 'published' && r.data.flagged === true && r.data.queued_for_review === true, JSON.stringify(r.data))

  console.log('\n【POST /club/posts/save · 参数与状态校验】')
  r = await call({ method: 'POST', path: '/posts/save', body: { club_id: 'club-a', content: '   ' }, token: presToken })
  assert('空白正文 → 1001', r.code === 1001, JSON.stringify(r))
  r = await call({ method: 'POST', path: '/posts/save', body: { club_id: 'club-a', content: 'x'.repeat(1001) }, token: presToken })
  assert('正文超长（1001 字）→ 1001', r.code === 1001, JSON.stringify(r))
  r = await call({ method: 'POST', path: '/posts/save', body: { club_id: 'club-a', content: '九图', images: Array(10).fill('https://x/1.jpg') }, token: presToken })
  assert('图片超 9 张 → 1001', r.code === 1001, JSON.stringify(r))
  r = await call({ method: 'POST', path: '/posts/save', body: { club_id: 'club-b', content: '封禁社团动态' }, token: otherToken })
  assert('封禁社团 → 1002（不可发布）', r.code === 1002, JSON.stringify(r))

  console.log('\n【GET /club/posts/my · 我的动态】')
  r = await call({ path: '/posts/my', token: presToken })
  const presPosts = r.data.list
  assert('社长仅见自己 1 条（author_id 过滤，干部那条不计）', r.code === 0 && r.data.total === 1 && presPosts.length === 1 && presPosts[0].author_id === 'u-pres', JSON.stringify(r.data))
  assert('join 社团名（天文社）', presPosts[0].club_name === '天文社', JSON.stringify(presPosts[0]))

  r = await call({ path: '/posts/my', token: offToken })
  assert('干部仅见自己 1 条（review 词那条）且 flagged=true 可展示', r.data.total === 1 && r.data.list[0].flagged === true, JSON.stringify(r.data))

  console.log('\n【GET /club/posts/list · 公开动态流】')
  r = await call({ path: '/posts/list', qs: { club_id: 'club-a' } })
  assert('公开流 = 该社团 2 条（published 未删，含 flagged 疑似）', r.code === 0 && r.data.total === 2, JSON.stringify(r.data))
  assert('动态流无需登录（游客可看）', r.code === 0 && typeof r.data.list[0].content === 'string', JSON.stringify(r.data))

  r = await call({ path: '/posts/list', qs: { club_id: 'club-b' } })
  assert('封禁社团动态流为空（其无发布记录）', r.data.total === 0, JSON.stringify(r.data))

  // 下架同步学生端：模拟 moderation 下架（status=taken_down）后公开流不再返回
  stores.club_posts.find((p) => p.author_id === 'u-pres').status = 'taken_down'
  r = await call({ path: '/posts/list', qs: { club_id: 'club-a' } })
  assert('下架后学生端动态流同步消失（验收点）', r.data.total === 1, JSON.stringify(r.data))
  // 回收站（deleted=1）同样不可见
  stores.club_posts.find((p) => p.author_id === 'u-off').deleted = 1
  r = await call({ path: '/posts/list', qs: { club_id: 'club-a' } })
  assert('软删动态不出现在公开流', r.data.total === 0, JSON.stringify(r.data))

  /* ---------- 汇总 ---------- */
  console.log(`\n结果：${passed} 通过，${failed} 失败`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})