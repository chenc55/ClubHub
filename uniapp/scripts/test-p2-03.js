/**
 * P2-03 本地验收（离线，无需部署）
 * 覆盖：数据统计 ADM-07 四维指标全口径
 *   - 管理通道：无 token 401 / super·auditor·viewer 三角色均可访问（需求 2.3 矩阵）
 *   - 用户：累计注册数（verified 总数）/ 新增用户数（周期内 verified_at）/ DAU（周期内 last_active_at）/ MAU（近 30 天）
 *   - 社团：入驻总数（normal）/ 活跃社团占比（周期内有动态 published_at 或有活动 created_at 非草稿）/ 分类分布（join 分类名）
 *   - 活动：发布数（周期内 created_at 非 draft）/ 报名数（approved）/ 签到率（checked_in ÷ approved）
 *   - 招新：岗位数 / 报名数 / 录取数（accepted）
 *   - 时间范围：today / 7d / 30d / custom（校验非法值与缺参）
 *   - 导出：CSV 内容（BOM / 指标行 / 分类分布行）
 * 运行：node scripts/test-p2-03.js
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
const stores = {
  users: [], clubs: [], categories: [], activities: [], activity_registrations: [],
  club_posts: [], recruitments: [], recruitment_registrations: [], admins: [],
}

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
      if (Object.prototype.hasOwnProperty.call(want, '__lt')) return new Date(row[key]).getTime() < new Date(want.__lt).getTime()
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
    limit: (n) => {
      result = result.slice(0, n)
      return query
    },
    orderBy: (field, dir) => {
      result = result.slice().sort((a, b) => {
        const at = new Date(a[field]).getTime()
        const bt = new Date(b[field]).getTime()
        return dir === 'desc' ? bt - at : at - bt
      })
      return query
    },
    get: async () => ({ data: result.slice() }),
    count: async () => ({ total: result.length }),
  }
  return query
}

function collectionFor(name) {
  const rowsOf = () => stores[name] || []
  return {
    where: (cond) => makeQuery(rowsOf().filter((row) => matchCond(row, cond))),
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
      lt: (value) => ({ __lt: value }),
      lte: (value) => ({ __lte: value }),
    },
  }),
}

/* ---------- 种子数据 ---------- */
const DAY = 24 * 3600 * 1000
const now = Date.now()
const at = (ms) => new Date(ms)

stores.admins.push(
  { _id: 'a-super', username: 'root', name: '超管', role: 'super', status: 'normal', deleted: 0 },
  { _id: 'a-aud', username: 'auditor1', name: '审核员', role: 'auditor', status: 'normal', deleted: 0 },
  { _id: 'a-view', username: 'viewer1', name: '数据员', role: 'viewer', status: 'normal', deleted: 0 }
)
stores.users.push(
  { _id: 'u1', auth_status: 'verified', status: 'normal', verified_at: at(now - 1 * DAY), last_active_at: at(now - 1 * DAY), deleted: 0 },
  { _id: 'u2', auth_status: 'verified', status: 'normal', verified_at: at(now - 10 * DAY), last_active_at: at(now - 10 * DAY), deleted: 0 },
  { _id: 'u3', auth_status: 'verified', status: 'normal', verified_at: at(now - 40 * DAY), last_active_at: at(now - 40 * DAY), deleted: 0 },
  { _id: 'u4', auth_status: 'unverified', status: 'normal', verified_at: null, last_active_at: null, deleted: 0 },
  { _id: 'u5', auth_status: 'verified', status: 'normal', verified_at: at(now - 2 * DAY), last_active_at: at(now - 2 * DAY), deleted: 1 }
)
stores.categories.push(
  { _id: 'cat-a', name: '学术科技', sort: 1, deleted: 0 },
  { _id: 'cat-b', name: '文艺表演', sort: 2, deleted: 0 }
)
stores.clubs.push(
  { _id: 'c1', name: '天文社', status: 'normal', category_id: 'cat-a', deleted: 0 },
  { _id: 'c2', name: '街舞社', status: 'normal', category_id: 'cat-b', deleted: 0 },
  { _id: 'c3', name: '摄影社', status: 'normal', category_id: 'cat-a', deleted: 0 },
  { _id: 'c4', name: '封禁社', status: 'banned', category_id: 'cat-a', deleted: 0 }
)
stores.club_posts.push(
  { _id: 'post1', club_id: 'c1', published_at: at(now - 1 * DAY), deleted: 0 },
  { _id: 'post2', club_id: 'c3', published_at: at(now - 20 * DAY), deleted: 0 } // 7d 外、30d 内：30d 窗口计入 c3
)
stores.activities.push(
  { _id: 'act1', club_id: 'c2', title: '公开课', created_at: at(now - 2 * DAY), status: 'signup', deleted: 0 },
  { _id: 'act2', club_id: 'c2', title: '草稿', created_at: at(now - 1 * DAY), status: 'draft', deleted: 0 } // draft 不计发布数
)
stores.activity_registrations.push(
  { _id: 'reg1', activity_id: 'act1', status: 'approved', checked_in: true, created_at: at(now - 1 * DAY), deleted: 0 },
  { _id: 'reg2', activity_id: 'act1', status: 'approved', checked_in: false, created_at: at(now - 1 * DAY), deleted: 0 },
  { _id: 'reg3', activity_id: 'act1', status: 'approved', checked_in: true, created_at: at(now - 12 * DAY), deleted: 0 }, // 7d 外
  { _id: 'reg4', activity_id: 'act1', status: 'waitlist', created_at: at(now - 1 * DAY), deleted: 0 } // 非 approved 不计
)
stores.recruitments.push(
  { _id: 'rc1', title: '干事招新', created_at: at(now - 1 * DAY), deleted: 0 },
  { _id: 'rc2', title: '老岗位', created_at: at(now - 40 * DAY), deleted: 0 }
)
stores.recruitment_registrations.push(
  { _id: 'rr1', recruitment_id: 'rc1', status: 'accepted', created_at: at(now - 1 * DAY), deleted: 0 },
  { _id: 'rr2', recruitment_id: 'rc1', status: 'pending', created_at: at(now - 1 * DAY), deleted: 0 }
)

const fn = require('../uniCloud-aliyun/cloudfunctions/stats/index.js')

function adminToken(adminRow) {
  return club.signToken({
    type: club.TOKEN_TYPES.ADMIN,
    adminId: adminRow._id,
    username: adminRow.username,
    role: adminRow.role,
    name: adminRow.name || '',
  })
}
const superToken = adminToken(stores.admins[0])
const audToken = adminToken(stores.admins[1])
const viewToken = adminToken(stores.admins[2])

async function call({ method = 'GET', path, qs = {}, token = null }) {
  const headers = { 'content-type': 'application/json' }
  if (token) headers.authorization = `Bearer ${token}`
  const res = await fn.main({
    httpMethod: method,
    path,
    headers,
    body: '',
    queryStringParameters: qs,
  })
  const payload = JSON.parse(res.body)
  return { statusCode: res.statusCode, payload, code: payload.code, data: payload.data, message: payload.message }
}

async function main() {
  console.log('\n【GET /ping · 健康检查】')
  let r = await call({ path: '/ping' })
  assert('公开 ping → 200', r.code === 0 && r.data.pong === 'stats', JSON.stringify(r))

  console.log('\n【管理通道鉴权与角色】')
  r = await call({ path: '/overview' })
  assert('overview 无 token → 401', r.code === 401, JSON.stringify(r))
  r = await call({ path: '/overview', token: superToken })
  assert('super → 200', r.code === 0, JSON.stringify(r))
  r = await call({ path: '/overview', token: audToken })
  assert('auditor → 200（三角色可见）', r.code === 0, JSON.stringify(r))
  r = await call({ path: '/overview', token: viewToken })
  assert('viewer → 200（数据查看员可查看）', r.code === 0, JSON.stringify(r))

  console.log('\n【range 参数校验】')
  r = await call({ path: '/overview', qs: { range: 'bogus' }, token: superToken })
  assert('非法 range → 1001', r.code === 1001, JSON.stringify(r))
  r = await call({ path: '/overview', qs: { range: 'custom' }, token: superToken })
  assert('custom 缺 start_at/end_at → 1001', r.code === 1001, JSON.stringify(r))
  r = await call({ path: '/overview', qs: { range: 'custom', start_at: '500', end_at: '100' }, token: superToken })
  assert('custom end_at <= start_at → 1001', r.code === 1001, JSON.stringify(r))

  console.log('\n【GET /overview · 近 7 天（默认口径验证）】')
  r = await call({ path: '/overview', qs: { range: '7d' }, token: superToken })
  assert('返回 range/start_at/end_at', r.code === 0 && r.data.range === '7d' && !!r.data.start_at && !!r.data.end_at, JSON.stringify(r.data && r.data.range))
  assert('用户：累计 3（verified 总数，软删 u5 不计）', r.data.users.total_verified === 3, JSON.stringify(r.data.users))
  assert('用户：新增 1（周期内 verified_at，仅 u1）', r.data.users.new_verified === 1, JSON.stringify(r.data.users))
  assert('用户：DAU 1（周期内 last_active_at，仅 u1）', r.data.users.dau === 1, JSON.stringify(r.data.users))
  assert('用户：MAU 2（近 30 天 last_active_at，u1+u2）', r.data.users.mau === 2, JSON.stringify(r.data.users))
  assert('社团：入驻总数 3（normal，banned c4 不计）', r.data.clubs.total === 3, JSON.stringify(r.data.clubs))
  assert('社团：活跃 2（c1 有动态 / c2 有活动非草稿；c3 无）', r.data.clubs.active_count === 2, JSON.stringify(r.data.clubs))
  assert('社团：活跃占比 0.6667', r.data.clubs.active_rate === 0.6667, JSON.stringify(r.data.clubs.active_rate))
  const dist = r.data.clubs.category_distribution
  assert('社团：分类分布 2 类且 join 分类名（学术科技 2 / 文艺表演 1）', dist.length === 2 && dist.find((d) => d.category_name === '学术科技').count === 2 && dist.find((d) => d.category_name === '文艺表演').count === 1, JSON.stringify(dist))
  assert('活动：发布数 1（周期内非草稿；draft act2 不计）', r.data.activities.published_count === 1, JSON.stringify(r.data.activities))
  assert('活动：报名数 2（approved 周期内；waitlist/7d 外不计）', r.data.activities.signup_count === 2, JSON.stringify(r.data.activities))
  assert('活动：签到率 0.5（周期内 checked_in 1 / approved 2）', r.data.activities.signin_rate === 0.5, JSON.stringify(r.data.activities))
  assert('招新：岗位数 1（周期内 created_at）', r.data.recruitments.count === 1, JSON.stringify(r.data.recruitments))
  assert('招新：报名数 2 / 录取 1（accepted）', r.data.recruitments.signup_count === 2 && r.data.recruitments.accepted_count === 1, JSON.stringify(r.data.recruitments))

  console.log('\n【时间范围切换】')
  r = await call({ path: '/overview', qs: { range: '30d' }, token: superToken })
  assert('30d 新增用户 2（u1+u2，40 天前 u3 不计）', r.data.users.new_verified === 2, JSON.stringify(r.data.users))
  assert('30d DAU 2（u1+u2）', r.data.users.dau === 2, JSON.stringify(r.data.users))
  assert('30d 活跃社团 3（post2 在 30d 内计入 c3）', r.data.clubs.active_count === 3, JSON.stringify(r.data.clubs))
  assert('30d 招新岗位 1（rc2 40 天前仍不计）', r.data.recruitments.count === 1, JSON.stringify(r.data.recruitments))
  r = await call({ path: '/overview', qs: { range: 'today' }, token: superToken })
  assert('today 新增 0（种子数据均不在今天）', r.data.users.new_verified === 0, JSON.stringify(r.data.users))
  assert('today 发布数 0 / 报名 0', r.data.activities.published_count === 0 && r.data.activities.signup_count === 0, JSON.stringify(r.data.activities))
  r = await call({ path: '/overview', qs: { range: 'custom', start_at: String(now - 45 * DAY), end_at: String(now) }, token: superToken })
  assert('custom（近 45 天）新增 3（u1+u2+u3）', r.data.users.new_verified === 3, JSON.stringify(r.data.users))
  assert('custom 招新岗位 2（rc1+rc2）', r.data.recruitments.count === 2, JSON.stringify(r.data.recruitments))

  console.log('\n【GET /export · CSV 导出】')
  r = await call({ path: '/export' })
  assert('export 无 token → 401', r.code === 401, JSON.stringify(r))
  r = await call({ path: '/export', qs: { range: '7d' }, token: viewToken })
  assert('viewer 可导出 → 200', r.code === 0 && !!r.data.filename && r.data.filename.indexOf('.csv') !== -1, JSON.stringify(r.data && r.data.filename))
  const csv = r.data.csv
  assert('CSV 含 BOM（Excel 中文）', typeof csv === 'string' && csv.charCodeAt(0) === 0xfeff, 'BOM 缺失')
  assert('CSV 含指标行（累计注册数 3 / 签到率 50%）', csv.indexOf('累计注册数,3') !== -1 && csv.indexOf('签到率（7d）,50.00%') !== -1, csv.split('\n').slice(0, 6).join('|'))
  assert('CSV 含分类分布行（学术科技,2 / 文艺表演,1）', csv.indexOf('学术科技,2,') !== -1 && csv.indexOf('文艺表演,1,') !== -1, csv.split('\n').slice(-4).join('|'))

  /* ---------- 汇总 ---------- */
  console.log(`\n结果：${passed} 通过，${failed} 失败`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
