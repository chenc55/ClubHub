/**
 * 活动业务域 API 模块
 * P0-05 已开通 URL 化网关（/activity/*）；P1-10 创建与状态机、P1-12 列表详情、P1-13 报名后续接入
 */
import { request, registerMock } from '@/utils/request'

/**
 * 活动列表（学生端，公开；P1-12）
 * 失败不弹 toast，由页面呈现失败态与重试
 * @param {Object} data
 * @param {string} [data.category_id] 分类筛选（'' = 全部）
 * @param {string} [data.time] 'today' | 'week' | 'all'（服务端按本地时区算边界）
 * @param {string} [data.status] 'signup'(报名中) | 'ongoing'(进行中) | 'ended'(已结束) | 'all'
 * @param {string} [data.keyword] 关键词（≤20 字，字面匹配标题）
 * @param {boolean} [data.my] 只看我报名的（需登录态，未登录返回 401）
 * @param {number} [data.page] 页码，默认 1
 * @param {number} [data.page_size] 每页条数，默认 20（上限 50）
 */
export function getActivityList(data) {
  return request({ path: '/activity/list', method: 'GET', data, silent: true })
}

/** 活动详情（学生端，公开；含报名进度与主办社团名；P1-12） */
export function getActivityDetail(activityId) {
  return request({ path: '/activity/detail', method: 'GET', data: { activity_id: activityId }, silent: true })
}

/**
 * 创建 / 更新活动草稿（负责人端；P1-10）
 * 传 activity_id 为编辑（仅草稿可编辑）；保存不触发敏感词（提交审核走 submitActivity）
 * 失败原因（权限 / 社团状态 / 字段校验）由页面就地展示
 */
export function saveActivity(data) {
  return request({ path: '/activity/save', method: 'POST', data, silent: true })
}

/** 提交审核（draft → pending；先审后发，命中敏感词返回 1001 提示修改；P1-10） */
export function submitActivity(activityId) {
  return request({ path: '/activity/submit', method: 'POST', data: { activity_id: activityId }, silent: true })
}

/**
 * 我管理的社团的活动列表（负责人端；P1-10）
 * @param {Object} data
 * @param {string} [data.status] 'all'|'draft'|'pending'|'approved'|'signup'|'ongoing'|'ended'|'archived'|'published'(已发布=approved+signup+ongoing)|'finished'(已结束=ended+archived)
 * @param {string} [data.activity_id] 编辑回显：取单条（限定本人管理的社团）
 * @param {number} [data.page] 页码
 * @param {number} [data.page_size] 每页条数（默认 20）
 */
export function getActivityManage(data) {
  return request({ path: '/activity/manage', method: 'GET', data, silent: true })
}

/** 手动提前结束（仅 ongoing → ended；通知已报名用户；P1-10） */
export function endActivity(activityId) {
  return request({ path: '/activity/end', method: 'POST', data: { activity_id: activityId }, silent: true })
}

/**
 * 报名活动（学生端；P1-13）
 * 三路径分发：need_approval → pending（待审核）；有名额 → approved；满员且候补 → waitlist；满员无候补 → 1002
 * 失败原因（已报名 / 不在时段 / 已满）由页面就地展示
 */
export function registerActivity(data) {
  return request({ path: '/activity/register', method: 'POST', data, silent: true })
}

/** 取消报名（报名截止前；释放名额后候补自动递补；P1-13） */
export function cancelRegistration(activityId) {
  return request({ path: '/activity/cancel', method: 'POST', data: { activity_id: activityId }, silent: true })
}

/** 手动候补递补（负责人端；P1-15 名单页触发；P1-13 提供接口） */
export function promoteWaitlist(activityId) {
  return request({ path: '/activity/promote', method: 'POST', data: { activity_id: activityId }, silent: true })
}

/**
 * 我的报名列表（学生端；P1-13）
 * @param {Object} data { page?, page_size? }
 */
export function getMyRegistrations(data) {
  return request({ path: '/activity/my-registrations', method: 'GET', data, silent: true })
}

/**
 * 学生签到（P1-14；扫码 qrcode / 口令 password / 定位 geofence）
 * @param {Object} data { activity_id, method, code?（qr token 或口令）, lat?, lng? }
 */
export function checkin(data) {
  return request({ path: '/activity/checkin', method: 'POST', data, silent: true })
}

/** 签到配置（负责人端：时段 / 方式 / 口令 / 定位；P1-14） */
export function checkinConfig(data) {
  return request({ path: '/activity/checkin/config', method: 'POST', data, silent: true })
}

/** 刷新动态二维码（负责人端，60 秒轮换；P1-14） */
export function checkinQrRefresh(activityId) {
  return request({ path: '/activity/checkin/qr-refresh', method: 'POST', data: { activity_id: activityId }, silent: true })
}

/** 代签 / 补签（负责人端；P1-14） */
export function checkinManual(data) {
  return request({ path: '/activity/checkin/manual', method: 'POST', data, silent: true })
}

/** 签到名单（负责人端；P1-14） */
export function getCheckinList(data) {
  return request({ path: '/activity/checkin/list', method: 'GET', data, silent: true })
}

/**
 * 报名名单（负责人端；P1-15）
 * @param {Object} data { activity_id, status?: 'all'|'pending'|'approved'|'waitlist'|'rejected'|'cancelled', checked?: 'all'|'yes'|'no', page?, page_size? }
 */
export function getRegistrationList(data) {
  return request({ path: '/activity/registrations', method: 'GET', data, silent: true })
}

/** 报名审核（负责人端：pending → approved / rejected，驳回需理由；P1-15） */
export function reviewRegistration(data) {
  return request({ path: '/activity/review-registration', method: 'POST', data, silent: true })
}

/** 缺席标记（负责人端：attendance = present / absent / none 清空；P1-15） */
export function markAttendance(data) {
  return request({ path: '/activity/attendance', method: 'POST', data, silent: true })
}

/** 导出 CSV（负责人端，返回 { csv, count, activity_title }；P1-15） */
export function exportRegistrationCsv(activityId) {
  return request({ path: '/activity/export-csv', method: 'GET', data: { activity_id: activityId }, silent: true })
}

// ------- mock 数据（离线联调；USE_MOCK 置 true 时生效） -------
const MOCK_MANAGE_LIST = [
  {
    _id: 'mock-act-001',
    club_id: 'mock-club-001',
    club_name: '（mock）天文爱好者协会',
    title: '（mock）流星雨观测夜',
    content: '一起看流星雨，带上望远镜',
    cover: '',
    category_id: 'mock-c-1',
    start_time: Date.now() + 2 * 24 * 3600 * 1000,
    end_time: Date.now() + 2 * 24 * 3600 * 1000 + 3 * 3600 * 1000,
    location: '操场',
    signup_start: Date.now() - 3600 * 1000,
    signup_end: Date.now() + 24 * 3600 * 1000,
    capacity: 50,
    need_approval: false,
    has_waitlist: true,
    allow_onsite: false,
    signin_config: { methods: ['qrcode'] },
    status: 'signup',
    created_at: Date.now() - 3 * 24 * 3600 * 1000,
    updated_at: Date.now() - 3 * 24 * 3600 * 1000,
  },
  {
    _id: 'mock-act-002',
    club_id: 'mock-club-002',
    club_name: '（mock）街舞社',
    title: '（mock）春季团训',
    content: '每周团训，欢迎零基础',
    cover: '',
    category_id: 'mock-c-2',
    start_time: Date.now() + 5 * 24 * 3600 * 1000,
    end_time: Date.now() + 5 * 24 * 3600 * 1000 + 2 * 3600 * 1000,
    location: '舞蹈室',
    signup_start: Date.now(),
    signup_end: Date.now() + 3 * 24 * 3600 * 1000,
    capacity: 20,
    need_approval: true,
    has_waitlist: false,
    allow_onsite: false,
    signin_config: { methods: ['password'], password: '1234' },
    status: 'draft',
    created_at: Date.now() - 24 * 3600 * 1000,
    updated_at: Date.now() - 24 * 3600 * 1000,
  },
]

const MOCK_ACTIVITY_LIST = [
  {
    _id: 'mock-act-101',
    club_id: 'mock-club-001',
    club_name: '（mock）天文爱好者协会',
    title: '（mock）流星雨观测夜',
    content: '一起看流星雨，记得带望远镜',
    cover: '',
    start_time: Date.now() + 2 * 24 * 3600 * 1000,
    end_time: Date.now() + 2 * 24 * 3600 * 1000 + 3 * 3600 * 1000,
    location: '操场',
    capacity: 50,
    registered_count: 32,
    need_approval: false,
    has_waitlist: true,
    allow_onsite: false,
    status: 'signup',
    created_at: Date.now() - 3 * 24 * 3600 * 1000,
  },
  {
    _id: 'mock-act-102',
    club_id: 'mock-club-002',
    club_name: '（mock）街舞社',
    title: '（mock）春季团训',
    content: '每周团训，欢迎零基础',
    cover: '',
    start_time: Date.now() - 1 * 3600 * 1000,
    end_time: Date.now() + 2 * 3600 * 1000,
    location: '舞蹈室',
    capacity: 20,
    registered_count: 20,
    need_approval: true,
    has_waitlist: false,
    allow_onsite: false,
    signin_config: { methods: ['qrcode', 'password'], password: '1234', qr_token: 'mock-qr-102', qr_expires_at: Date.now() + 60 * 1000 },
    status: 'ongoing',
    created_at: Date.now() - 2 * 24 * 3600 * 1000,
  },
]

registerMock('GET', '/activity/list', ({ data }) => {
  const status = (data && data.status) || 'all'
  let list = MOCK_ACTIVITY_LIST
  if (status === 'signup') list = list.filter((i) => ['approved', 'signup'].indexOf(i.status) !== -1)
  else if (status === 'ongoing') list = list.filter((i) => i.status === 'ongoing')
  else if (status === 'ended') list = list.filter((i) => ['ended', 'archived'].indexOf(i.status) !== -1)
  if (data && data.my) {
    if (data.my === '1' || data.my === 'true') list = []
  }
  return { code: 0, message: 'ok', data: { list, total: list.length, page: 1, page_size: 20, has_more: false } }
})

registerMock('GET', '/activity/detail', ({ data }) => {
  const activity = MOCK_ACTIVITY_LIST.find((item) => item._id === (data && data.activity_id))
  if (!activity) return { code: 404, message: '活动不存在或已下架', data: null }
  return { code: 0, message: 'ok', data: { activity, my_registration: null } }
})

registerMock('POST', '/activity/register', ({ data }) => {
  const activity = MOCK_ACTIVITY_LIST.find((item) => item._id === (data && data.activity_id))
  if (!activity) return { code: 404, message: '活动不存在或已删除', data: null }
  return {
    code: 0,
    message: 'ok',
    data: {
      status: activity.need_approval ? 'pending' : 'approved',
      registration: { registration_id: 'mock-reg-001', activity_id: activity._id, status: activity.need_approval ? 'pending' : 'approved', remark: (data && data.remark) || '', checked_in: false, signup_at: Date.now(), activity },
    },
  }
})

registerMock('POST', '/activity/cancel', ({ data }) => {
  const activity = MOCK_ACTIVITY_LIST.find((item) => item._id === (data && data.activity_id))
  if (!activity) return { code: 404, message: '活动不存在或已删除', data: null }
  return { code: 0, message: 'ok', data: { registration: { registration_id: 'mock-reg-001', activity_id: activity._id, status: 'cancelled', remark: '', checked_in: false, signup_at: Date.now(), activity }, promoted: null } }
})

registerMock('GET', '/activity/my-registrations', () => {
  const activity = MOCK_ACTIVITY_LIST[0]
  return {
    code: 0,
    message: 'ok',
    data: {
      list: [{ registration_id: 'mock-reg-001', activity_id: activity._id, status: 'approved', remark: '', checked_in: false, signup_at: Date.now(), can_cancel: true, activity }],
      total: 1,
      page: 1,
      page_size: 20,
      has_more: false,
    },
  }
})

registerMock('GET', '/activity/manage', ({ data }) => {
  const status = (data && data.status) || 'all'
  const list = status === 'all' ? MOCK_MANAGE_LIST : MOCK_MANAGE_LIST.filter((item) => item.status === status)
  return { code: 0, message: 'ok', data: { list, total: list.length, page: 1, page_size: 20, has_more: false } }
})

registerMock('POST', '/activity/save', ({ data }) => {
  const found = MOCK_MANAGE_LIST.find((item) => item._id === (data && data.activity_id))
  if (data && data.activity_id && !found) return { code: 404, message: '活动不存在或已删除', data: null }
  const record = {
    _id: (data && data.activity_id) || `mock-act-${Date.now()}`,
    club_id: (data && data.club_id) || 'mock-club-001',
    club_name: '（mock）天文爱好者协会',
    title: (data && data.title) || '',
    content: (data && data.content) || '',
    cover: (data && data.cover) || '',
    category_id: (data && data.category_id) || '',
    start_time: (data && data.start_time) || 0,
    end_time: (data && data.end_time) || 0,
    location: (data && data.location) || '',
    signup_start: (data && data.signup_start) || 0,
    signup_end: (data && data.signup_end) || 0,
    capacity: (data && data.capacity) || 0,
    need_approval: !!(data && data.need_approval),
    has_waitlist: !!(data && data.has_waitlist),
    allow_onsite: !!(data && data.allow_onsite),
    signin_config: (data && data.signin_config) || null,
    status: 'draft',
    created_at: Date.now(),
    updated_at: Date.now(),
  }
  return { code: 0, message: 'ok', data: { activity: record, updated: !!data.activity_id } }
})

registerMock('POST', '/activity/submit', ({ data }) => {
  const found = MOCK_MANAGE_LIST.find((item) => item._id === (data && data.activity_id))
  if (!found) return { code: 404, message: '活动不存在或已删除', data: null }
  return { code: 0, message: 'ok', data: { activity: { ...found, status: 'pending' } } }
})

registerMock('POST', '/activity/end', ({ data }) => {
  const found = MOCK_MANAGE_LIST.find((item) => item._id === (data && data.activity_id))
  if (!found) return { code: 404, message: '活动不存在或已删除', data: null }
  if (found.status !== 'ongoing') {
    return { code: 1002, message: '仅「进行中」的活动可提前结束', data: null }
  }
  return { code: 0, message: 'ok', data: { activity: { ...found, status: 'ended' }, notified_count: 0 } }
})

// ------- P1-14 签到 mock（离线联调） -------
const mockSigninConfig = (activity, over = {}) => ({
  methods: ['qrcode'],
  qr_token: `mock-qr-${Date.now()}`,
  qr_expires_at: Date.now() + 60 * 1000,
  password: '',
  geo: null,
  signin_start: null,
  signin_end: null,
  ...over,
})

registerMock('POST', '/activity/checkin/config', ({ data }) => {
  const activity = MOCK_ACTIVITY_LIST.find((item) => item._id === (data && data.activity_id))
  if (!activity) return { code: 404, message: '活动不存在或已删除', data: null }
  const signin_config = mockSigninConfig(activity, {
    methods: (data && data.methods) || ['qrcode'],
    password: (data && data.password) || '',
    geo: (data && data.geo) || null,
  })
  activity.signin_config = signin_config
  return { code: 0, message: 'ok', data: { activity, signin_config } }
})

registerMock('POST', '/activity/checkin/qr-refresh', ({ data }) => {
  const activity = MOCK_ACTIVITY_LIST.find((item) => item._id === (data && data.activity_id))
  if (!activity) return { code: 404, message: '活动不存在或已删除', data: null }
  const signin_config = mockSigninConfig(activity, activity.signin_config || {})
  activity.signin_config = signin_config
  return { code: 0, message: 'ok', data: { signin_config } }
})

registerMock('POST', '/activity/checkin/manual', () => {
  return { code: 0, message: 'ok', data: { checkin: { _id: `mock-ck-${Date.now()}`, signin_method: 'manual', signin_time: Date.now() } } }
})

registerMock('GET', '/activity/checkin/list', () => {
  return {
    code: 0,
    message: 'ok',
    data: {
      list: [
        { registration_id: 'mock-reg-1', user_id: 'mock-u-1', name: '苏晚晴', student_no: '20260002', student_no_masked: '2026****02', checked_in: true, signin_time: Date.now(), signin_method: 'qrcode' },
        { registration_id: 'mock-reg-2', user_id: 'mock-u-2', name: '何子轩', student_no: '20260003', student_no_masked: '2026****03', checked_in: false, signin_time: null, signin_method: null },
      ],
      total: 2,
      checked_count: 1,
      unchecked_count: 1,
      page: 1,
      page_size: 20,
      has_more: false,
    },
  }
})

registerMock('POST', '/activity/checkin', () => {
  return { code: 0, message: 'ok', data: { checkin: { _id: `mock-ck-${Date.now()}`, signin_method: 'password', signin_time: Date.now() }, onsite: false } }
})

// ------- P1-15 报名名单与导出 mock（离线联调） -------
const MOCK_REG_ROWS = [
  { registration_id: 'mock-reg-1', user_id: 'mock-u-1', name: '苏晚晴', student_no: '20260002', student_no_masked: '2026****02', college: '计算机学院', major: '软件工程', status: 'approved', remark: '', signup_at: Date.now() - 3600 * 1000, checked_in: true, signin_time: Date.now() - 1800 * 1000, signin_method: 'qrcode', attendance: null },
  { registration_id: 'mock-reg-2', user_id: 'mock-u-2', name: '何子轩', student_no: '20260003', student_no_masked: '2026****03', college: '经管学院', major: '工商管理', status: 'pending', remark: '想参加', signup_at: Date.now() - 2700 * 1000, checked_in: false, signin_time: null, signin_method: null, attendance: null },
  { registration_id: 'mock-reg-3', user_id: 'mock-u-3', name: '赵一鸣', student_no: '20260004', student_no_masked: '2026****04', college: '', major: '', status: 'waitlist', remark: '', signup_at: Date.now() - 1800 * 1000, checked_in: false, signin_time: null, signin_method: null, attendance: null },
  { registration_id: 'mock-reg-4', user_id: 'mock-u-4', name: '陈默', student_no: '20260005', student_no_masked: '2026****05', college: '文学院', major: '汉语言文学', status: 'rejected', remark: '', signup_at: Date.now() - 900 * 1000, checked_in: false, signin_time: null, signin_method: null, attendance: null },
]

registerMock('GET', '/activity/registrations', ({ data }) => {
  const status = (data && data.status) || 'all'
  const checked = (data && data.checked) || 'all'
  let list = MOCK_REG_ROWS
  if (status !== 'all') list = list.filter((row) => row.status === status)
  if (checked === 'yes') list = list.filter((row) => row.checked_in)
  else if (checked === 'no') list = list.filter((row) => !row.checked_in)
  const statusCount = { all: MOCK_REG_ROWS.length, pending: MOCK_REG_ROWS.filter((r) => r.status === 'pending').length, approved: MOCK_REG_ROWS.filter((r) => r.status === 'approved').length, waitlist: MOCK_REG_ROWS.filter((r) => r.status === 'waitlist').length, rejected: MOCK_REG_ROWS.filter((r) => r.status === 'rejected').length, cancelled: 0 }
  const approvedCount = MOCK_REG_ROWS.filter((r) => r.status === 'approved').length
  const checkedCount = MOCK_REG_ROWS.filter((r) => r.checked_in).length
  return {
    code: 0,
    message: 'ok',
    data: {
      list,
      total: list.length,
      page: 1,
      page_size: 20,
      has_more: false,
      status_count: statusCount,
      stats: { approved_count: approvedCount, checked_count: checkedCount, unchecked_count: approvedCount - checkedCount, signin_rate: approvedCount ? Number(((checkedCount / approvedCount) * 100).toFixed(1)) : 0 },
      activity: { _id: 'mock-act-102', title: '（mock）春季团训', start_time: Date.now() - 3600 * 1000, end_time: Date.now() + 2 * 3600 * 1000, location: '舞蹈室' },
    },
  }
})

registerMock('POST', '/activity/review-registration', ({ data }) => {
  const row = MOCK_REG_ROWS.find((item) => item.registration_id === (data && data.registration_id))
  if (!row) return { code: 404, message: '报名记录不存在', data: null }
  if (row.status !== 'pending') return { code: 1002, message: '仅「待审核」状态的报名可审核', data: null }
  if ((data && data.action) === 'reject' && !String(data.reason || '').trim()) return { code: 1001, message: '驳回时请填写理由', data: null }
  const newStatus = (data && data.action) === 'reject' ? 'rejected' : 'approved'
  row.status = newStatus
  return { code: 0, message: 'ok', data: { registration_id: row.registration_id, status: newStatus, pushed: null } }
})

registerMock('POST', '/activity/attendance', ({ data }) => {
  const row = MOCK_REG_ROWS.find((item) => item.registration_id === (data && data.registration_id))
  if (!row) return { code: 404, message: '报名记录不存在', data: null }
  if (row.status !== 'approved') return { code: 1002, message: '仅报名成功者可标记参加状态', data: null }
  const value = (data && data.attendance) === 'none' ? null : (data && data.attendance)
  row.attendance = value
  return { code: 0, message: 'ok', data: { registration_id: row.registration_id, attendance: value } }
})

registerMock('GET', '/activity/export-csv', ({ data }) => {
  const activity = MOCK_ACTIVITY_LIST.find((item) => item._id === (data && data.activity_id))
  const title = (activity && activity.title) || '活动'
  const header = ['姓名', '学号', '学院专业', '报名状态', '报名时间', '签到状态', '签到时间']
  const label = { pending: '待审核', approved: '已报名', waitlist: '候补', rejected: '已驳回', cancelled: '已取消' }
  const lines = [header.join(',')]
  MOCK_REG_ROWS.forEach((row) => {
    lines.push([row.name, row.student_no, [row.college, row.major].filter(Boolean).join(' '), label[row.status] || row.status, new Date(row.signup_at).toLocaleString('zh-CN'), row.checked_in ? '已签到' : '未签到', row.signin_time ? new Date(row.signin_time).toLocaleString('zh-CN') : ''].join(','))
  })
  return { code: 0, message: 'ok', data: { csv: '\uFEFF' + lines.join('\r\n'), count: MOCK_REG_ROWS.length, activity_title: title } }
})

registerMock('POST', '/activity/promote', ({ data }) => {
  const activity = MOCK_ACTIVITY_LIST.find((item) => item._id === (data && data.activity_id))
  if (!activity) return { code: 404, message: '活动不存在或已删除', data: null }
  const row = MOCK_REG_ROWS.find((item) => item.status === 'waitlist')
  if (!row) return { code: 0, message: 'ok', data: { promoted: null } }
  row.status = 'approved'
  return { code: 0, message: 'ok', data: { promoted: { registration_id: row.registration_id } } }
})
