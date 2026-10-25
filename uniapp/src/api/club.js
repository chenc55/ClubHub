/**
 * 社团业务域 API 模块
 * P0-05 已开通 URL 化网关（/club/*）；P1-06 入驻双轨、P1-07 管理端分类星级、P1-08 学生端列表详情
 */
import { request, registerMock } from '@/utils/request'

/**
 * 社团列表（学生端，公开；P1-08）
 * 失败不弹 toast，由页面呈现失败态与重试
 * @param {Object} data
 * @param {string} [data.category_id] 分类筛选（'' = 全部）
 * @param {number} [data.star_min] 星级筛选：X 星及以上（0 = 不限）
 * @param {string} [data.keyword] 关键词（≤20 字，字面匹配名称 / 简介）
 * @param {'comprehensive'|'latest'} [data.sort] 综合（默认）/ 最新
 * @param {number} [data.page] 页码，默认 1
 * @param {number} [data.page_size] 每页条数，默认 20（上限 50）
 */
export function getClubList(data) {
  return request({ path: '/club/list', method: 'GET', data, silent: true })
}

/** 社团详情（学生端，公开；含成员数 / 活动数与最近活动；P1-08） */
export function getClubDetail(clubId) {
  return request({ path: '/club/detail', method: 'GET', data: { club_id: clubId }, silent: true })
}

/**
 * 我管理的社团（负责人端；P1-09）
 * 返回 [{ role, joined_at, can_edit, club }]：president / officer 均返回，can_edit 由服务端判定（仅社长 + 社团正常）
 */
export function getMyClubs() {
  return request({ path: '/club/my-clubs', method: 'GET', silent: true })
}

/**
 * 编辑社团资料（负责人端；P1-09）
 * 可写字段：name / intro / contact / logo / cover；分类与星级由管理员设定，传了也不生效
 * 失败原因（重名 / 非社长 / 社团被封禁等）由页面就地展示
 */
export function updateClub(data) {
  return request({ path: '/club/update', method: 'POST', data, silent: true })
}

/** 分类字典（公开；P1-06 入驻表单与后续筛选共用） */
export function getCategories() {
  return request({ path: '/club/categories', method: 'GET' })
}

/**
 * 社团成员列表（负责人端 / CLB-05 / P1-19）
 * 返回 { list, total, page, page_size, role_count, viewer_role }：
 * viewer_role 为当前操作者在本社团的角色（president / officer），前端据此决定是否展示管理操作
 */
export function getClubMembers(data) {
  return request({ path: '/club/members', method: 'GET', data, silent: true })
}

/** 设置 / 撤销干部（officer ⇄ member，仅社长；P1-19） */
export function setClubMemberRole(data) {
  return request({ path: '/club/members/role', method: 'POST', data, silent: true })
}

/** 移除成员（status → removed，仅社长；P1-19） */
export function removeClubMember(data) {
  return request({ path: '/club/members/remove', method: 'POST', data, silent: true })
}

/**
 * 社团统计（负责人端 / CLB-03④ / CLB-04③ / P1-20）
 * 返回 { club, range, activity:{published,signups,signin_count,signin_rate,status_dist},
 *        recruitment:{posts,signups,accepted}, member:{total,president,officer,member} }
 * @param {Object} data { club_id, range?: 'all'|'7d'|'30d' }（默认 all）
 */
export function getClubStats(data) {
  return request({ path: '/club/stats', method: 'GET', data, silent: true })
}

/**
 * 我加入的社团（学生端 / STU-08 / P1-24）
 * 返回 [{ club_id, role, joined_at, club }]——全部 active 成员关系（含 member 角色）；
 * 被移除成员（removed）后列表同步消失
 */
export function getMyMemberships() {
  return request({ path: '/club/memberships', method: 'GET', silent: true })
}

/**
 * 提交 / 重新提交入驻申请（P1-06）
 * silent：失败原因（名称重复 / 已有进行中申请等）由页面就地展示
 */
export function applyClub(data) {
  return request({ path: '/club/apply', method: 'POST', data, silent: true })
}

/** 我的入驻申请进度：进行中 + 已通过 + 历史记录（P1-06） */
export function getClubApplyCurrent() {
  return request({ path: '/club/apply/current', method: 'GET', silent: true })
}

// ------- mock 数据（离线联调；USE_MOCK 置 true 时生效） -------
const MOCK_CLUB_LIST = [
  {
    _id: 'mock-club-001',
    name: '（mock）天文爱好者协会',
    intro: '每周三晚组织观星活动，一起看流星雨',
    logo: '',
    cover: '',
    contact: 'QQ群 123456',
    category_id: 'mock-c-1',
    category_name: '学术科技',
    star_level: 5,
    member_count: 128,
    activity_count: 6,
    tags: ['学术科技', '5 星社团', '活跃'],
    created_at: Date.now() - 90 * 24 * 3600 * 1000,
  },
  {
    _id: 'mock-club-002',
    name: '（mock）街舞社',
    intro: '每周团训，欢迎零基础同学加入',
    logo: '',
    cover: '',
    contact: '微信 streetdance',
    category_id: 'mock-c-2',
    category_name: '文艺表演',
    star_level: 3,
    member_count: 64,
    activity_count: 2,
    tags: ['文艺表演', '3 星社团', '活跃'],
    created_at: Date.now() - 10 * 24 * 3600 * 1000,
  },
]

registerMock('GET', '/club/list', () => ({
  code: 0,
  message: 'ok',
  data: {
    list: MOCK_CLUB_LIST,
    total: MOCK_CLUB_LIST.length,
    page: 1,
    page_size: 20,
    has_more: false,
  },
}))

registerMock('GET', '/club/detail', ({ data }) => {
  const club = MOCK_CLUB_LIST.find((item) => item._id === (data && data.club_id))
  if (!club) return { code: 404, message: '社团不存在或已下架', data: null }
  return { code: 0, message: 'ok', data: { club, activities: [] } }
})

registerMock('GET', '/club/my-clubs', () => ({
  code: 0,
  message: 'ok',
  data: {
    list: [
      { role: 'president', joined_at: Date.now() - 30 * 24 * 3600 * 1000, can_edit: true, club: MOCK_CLUB_LIST[0] },
      { role: 'officer', joined_at: Date.now() - 10 * 24 * 3600 * 1000, can_edit: false, club: MOCK_CLUB_LIST[1] },
    ],
  },
}))

registerMock('POST', '/club/update', ({ data }) => {
  const index = MOCK_CLUB_LIST.findIndex((item) => item._id === (data && data.club_id))
  if (index === -1) return { code: 404, message: '社团不存在或已删除', data: null }
  const club = { ...MOCK_CLUB_LIST[index], ...data }
  MOCK_CLUB_LIST[index] = club
  return { code: 0, message: 'ok', data: { role: 'president', can_edit: true, club } }
})

registerMock('GET', '/club/categories', () => ({
  code: 0,
  message: 'ok',
  data: {
    list: [
      { _id: 'mock-c-1', name: '学术科技', sort: 1 },
      { _id: 'mock-c-2', name: '文艺表演', sort: 2 },
    ],
  },
}))

registerMock('POST', '/club/apply', () => ({
  code: 0,
  message: 'ok',
  data: {
    club: {
      _id: 'mock-club-001',
      name: '（mock）天文爱好者协会',
      intro: '一起观测星空',
      contact: 'QQ群 123456',
      category_id: 'mock-c-1',
      category_name: '学术科技',
      star_level: 0,
      status: 'pending',
      create_type: 'applied',
      reject_reason: '',
      created_at: Date.now(),
    },
    resubmitted: false,
  },
}))

registerMock('GET', '/club/apply/current', () => ({ code: 0, message: 'ok', data: { list: [], pending: null, approved: null } }))

// ------- P1-19 成员管理 mock（状态保存在内存，供页面反复操作） -------
const MOCK_MEMBERS = {
  'mock-club-001': [
    { user_id: 'mock-user-1', role: 'president', joined_at: Date.now() - 300 * 24 * 3600 * 1000, name: '林一', student_no_masked: '2021****34', avatar: '' },
    { user_id: 'mock-user-2', role: 'officer', joined_at: Date.now() - 200 * 24 * 3600 * 1000, name: '陈二', student_no_masked: '2022****45', avatar: '' },
    { user_id: 'mock-user-3', role: 'member', joined_at: Date.now() - 100 * 24 * 3600 * 1000, name: '王三', student_no_masked: '2023****56', avatar: '' },
    { user_id: 'mock-user-4', role: 'member', joined_at: Date.now() - 50 * 24 * 3600 * 1000, name: '赵四', student_no_masked: '2024****67', avatar: '' },
  ],
  'mock-club-002': [
    { user_id: 'mock-user-5', role: 'president', joined_at: Date.now() - 400 * 24 * 3600 * 1000, name: '孙社长', student_no_masked: '2020****12', avatar: '' },
    { user_id: 'mock-user-1', role: 'officer', joined_at: Date.now() - 300 * 24 * 3600 * 1000, name: '林一', student_no_masked: '2021****34', avatar: '' },
    { user_id: 'mock-user-6', role: 'member', joined_at: Date.now() - 30 * 24 * 3600 * 1000, name: '周五', student_no_masked: '2025****78', avatar: '' },
  ],
}
const MOCK_MEMBER_VIEWER = { 'mock-club-001': 'president', 'mock-club-002': 'officer' }
const mockRoleCount = (list) => {
  const rc = { total: list.length, president: 0, officer: 0, member: 0 }
  list.forEach((m) => { rc[m.role] += 1 })
  return rc
}

registerMock('GET', '/club/members', ({ data }) => {
  const list = MOCK_MEMBERS[data && data.club_id]
  if (!list) return { code: 404, message: '社团不存在或已删除', data: null }
  return { code: 0, message: 'ok', data: { list: list.slice(), total: list.length, page: 1, page_size: 20, role_count: mockRoleCount(list), viewer_role: MOCK_MEMBER_VIEWER[data.club_id] || 'member' } }
})

registerMock('POST', '/club/members/role', ({ data }) => {
  const list = MOCK_MEMBERS[data && data.club_id]
  if (!list) return { code: 404, message: '社团不存在或已删除', data: null }
  const member = list.find((m) => m.user_id === data.user_id)
  if (!member) return { code: 404, message: '该用户不是社团成员', data: null }
  if (member.role === 'president') return { code: 403, message: '社长不可被设为干部或降为普通成员', data: null }
  member.role = data.role === 'officer' ? 'officer' : 'member'
  return { code: 0, message: 'ok', data: { member, role_count: mockRoleCount(list) } }
})

registerMock('POST', '/club/members/remove', ({ data }) => {
  const list = MOCK_MEMBERS[data && data.club_id]
  if (!list) return { code: 404, message: '社团不存在或已删除', data: null }
  const idx = list.findIndex((m) => m.user_id === data.user_id)
  if (idx === -1) return { code: 404, message: '该用户不是社团成员', data: null }
  if (list[idx].role === 'president') return { code: 403, message: '社长不可被移除（需平台管理员介入）', data: null }
  list.splice(idx, 1)
  return { code: 0, message: 'ok', data: { user_id: data.user_id, role_count: mockRoleCount(list) } }
})

// ------- P1-20 社团统计 mock -------
const MOCK_STATS = {
  'mock-club-001': {
    club: { _id: 'mock-club-001', name: '（mock）天文爱好者协会', status: 'normal' },
    activity: {
      published: 6,
      signups: 48,
      signin_count: 33,
      signin_rate: 0.69,
      status_dist: { draft: 1, pending: 2, approved: 0, signup: 2, ongoing: 1, ended: 3, archived: 1 },
    },
    recruitment: { posts: 3, signups: 15, accepted: 5 },
    member: { total: 128, president: 1, officer: 4, member: 123 },
  },
  'mock-club-002': {
    club: { _id: 'mock-club-002', name: '（mock）街舞社', status: 'normal' },
    activity: {
      published: 2,
      signups: 12,
      signin_count: 10,
      signin_rate: 0.83,
      status_dist: { draft: 0, pending: 0, approved: 1, signup: 1, ongoing: 0, ended: 1, archived: 0 },
    },
    recruitment: { posts: 1, signups: 6, accepted: 3 },
    member: { total: 64, president: 1, officer: 2, member: 61 },
  },
}

registerMock('GET', '/club/stats', ({ data }) => {
  const stats = MOCK_STATS[data && data.club_id]
  if (!stats) return { code: 404, message: '社团不存在或已删除', data: null }
  return { code: 0, message: 'ok', data: { ...stats, range: (data && data.range) || 'all' } }
})

// ------- P1-24 我的社团 mock（含 member 角色与社长/干部） -------
const MOCK_MEMBERSHIPS = [
  { club_id: 'mock-club-001', role: 'president', joined_at: Date.now() - 30 * 24 * 3600 * 1000, club: MOCK_CLUB_LIST[0] },
  { club_id: 'mock-club-002', role: 'member', joined_at: Date.now() - 10 * 24 * 3600 * 1000, club: MOCK_CLUB_LIST[1] },
]

registerMock('GET', '/club/memberships', () => ({
  code: 0,
  message: 'ok',
  data: { list: MOCK_MEMBERSHIPS },
}))

// ------- P2-01 社团动态 mock -------
const MOCK_POSTS = [
  {
    _id: 'mock-post-1',
    club_id: 'mock-club-001',
    author_id: 'mock-user-1',
    content: '本周三晚观星活动报名开启，操场草坪集合，记得穿厚一点～',
    images: [],
    status: 'published',
    flagged: false,
    published_at: Date.now() - 2 * 24 * 3600 * 1000,
  },
  {
    _id: 'mock-post-2',
    club_id: 'mock-club-001',
    author_id: 'mock-user-2',
    content: '新社员破冰会圆满结束，感谢大家的热情参与！',
    images: [],
    status: 'published',
    flagged: false,
    published_at: Date.now() - 5 * 24 * 3600 * 1000,
  },
]

/** 发布动态（负责人端；P2-01） */
export function savePost(data) {
  return request({ path: '/club/posts/save', method: 'POST', data, silent: true })
}

/** 我的动态列表（负责人端；P2-01） */
export function getMyPosts(data) {
  return request({ path: '/club/posts/my', method: 'GET', data, silent: true })
}

/** 学生端社团动态流（公开；P2-01） */
export function getClubPosts(data) {
  return request({ path: '/club/posts/list', method: 'GET', data, silent: true })
}

registerMock('POST', '/club/posts/save', ({ data }) => {
  const content = String((data && data.content) || '')
  if (content.indexOf('代考') !== -1) return { code: 1001, message: '内容含违规词（代考），请修改后重新发布', data: null }
  const flagged = content.indexOf('烟花') !== -1
  const post = {
    _id: `mock-post-${MOCK_POSTS.length + 1}`,
    club_id: data && data.club_id,
    author_id: 'mock-user-1',
    content,
    images: (data && data.images) || [],
    status: 'published',
    flagged,
    published_at: Date.now(),
  }
  MOCK_POSTS.unshift(post) // 新发布进列表头部（我的动态 / 社团详情即时可见）
  return {
    code: 0,
    message: 'ok',
    data: { post, flagged, queued_for_review: flagged },
  }
})

registerMock('GET', '/club/posts/my', () => ({
  code: 0,
  message: 'ok',
  data: {
    list: MOCK_POSTS.map((p) => ({ ...p, club_name: '（mock）天文爱好者协会' })),
    total: MOCK_POSTS.length,
    page: 1,
    page_size: 10,
    has_more: false,
  },
}))

registerMock('GET', '/club/posts/list', ({ data }) => {
  const list = MOCK_POSTS.filter((p) => p.club_id === data.club_id && p.status === 'published')
  return { code: 0, message: 'ok', data: { list, total: list.length, page: 1, page_size: 10, has_more: false } }
})
