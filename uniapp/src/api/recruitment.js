/**
 * 招新业务域 API 模块
 * P0-05 已开通 URL 化网关（/recruitment/*）；P1-16 岗位创建与审核、P1-17 报名、P1-18 筛选录取接入
 */
import { request, registerMock } from '@/utils/request'

/**
 * 我管理的社团的招新岗位列表（负责人端；P1-16）
 * @param {Object} data { status?: 'all'|'draft'|'pending'|'open'|'closed', recruitment_id?（编辑回显单条）, page?, page_size? }
 */
export function getRecruitmentManage(data) {
  return request({ path: '/recruitment/manage', method: 'GET', data, silent: true })
}

/**
 * 创建 / 更新招新岗位草稿（负责人端；P1-16）
 * 传 recruitment_id 为编辑（仅草稿可编辑）；保存不触发敏感词（提交审核走 submitRecruitment）
 * @param {Object} data { recruitment_id?, club_id, title, content, signup_end, capacity?, multi_step, form_fields }
 */
export function saveRecruitment(data) {
  return request({ path: '/recruitment/save', method: 'POST', data, silent: true })
}

/** 提交审核（draft → pending；先审后发，命中敏感词返回 1001 提示修改；P1-16） */
export function submitRecruitment(recruitmentId) {
  return request({ path: '/recruitment/submit', method: 'POST', data: { recruitment_id: recruitmentId }, silent: true })
}

/** 手动提前关闭（open → closed；P1-16） */
export function closeRecruitment(recruitmentId) {
  return request({ path: '/recruitment/close', method: 'POST', data: { recruitment_id: recruitmentId }, silent: true })
}

/** 招新岗位详情（公开；open / closed 可见；P1-16 提供，P1-17 报名页使用） */
export function getRecruitmentDetail(recruitmentId) {
  return request({ path: '/recruitment/detail', method: 'GET', data: { recruitment_id: recruitmentId }, silent: true })
}

/**
 * 招新聚合列表（学生端，公开；P1-17）
 * @param {Object} data { club_id?, keyword?, page?, page_size? } 仅返回 open 在招岗位
 */
export function getRecruitmentList(data) {
  return request({ path: '/recruitment/list', method: 'GET', data, silent: true })
}

/**
 * 招新报名（学生端；P1-17）
 * @param {Object} data { recruitment_id, form_data（自定义字段值，key 对应 form_fields.key）, self_intro? }
 * 失败原因（closed / 截止 / 重复报名 / 已是成员 / 已录取同社团其它岗位 / 名额已满 / 必填缺失）由页面就地展示
 */
export function signupRecruitment(data) {
  return request({ path: '/recruitment/signup', method: 'POST', data, silent: true })
}

/** 我的招新状态（学生端；P1-17；含岗位快照 / 面试时间地点 / 录取时间） */
export function getMyRecruitments(data) {
  return request({ path: '/recruitment/my-status', method: 'GET', data, silent: true })
}

/**
 * 招新申请人列表（负责人端；P1-18）
 * @param {Object} data { recruitment_id, status?: 'all'|'pending'|'interview'|'accepted'|'rejected', page?, page_size? }
 * 返回 list（join 姓名/学号/学院专业 + form_data 报名表 + interview）+ status_count + 岗位 form_fields
 */
export function getApplicants(data) {
  return request({ path: '/recruitment/applicants', method: 'GET', data, silent: true })
}

/**
 * 招新筛选操作（负责人端；P1-18；批量）
 * @param {Object} data { recruitment_id, registration_ids: [], action: 'approve'|'interview'|'accept'|'reject', interview?: { time, place } }
 * approve=进面试（面试通知）；interview=标记/更新面试时间地点；accept=录取（自动入团 + 录取通知）；reject=淘汰
 */
export function screenApplicants(data) {
  return request({ path: '/recruitment/screen', method: 'POST', data, silent: true })
}

/** 一键通知（负责人端；按当前状态发面试安排 / 结果通知；P1-18） */
export function notifyApplicants(data) {
  return request({ path: '/recruitment/notify', method: 'POST', data, silent: true })
}

/** 导出申请人 CSV（负责人端；命名方式与报名名单导出一致；P1-18） */
export function exportApplicantsCsv(recruitmentId) {
  return request({ path: '/recruitment/export-csv', method: 'GET', data: { recruitment_id: recruitmentId }, silent: true })
}

// ------- mock 数据（离线联调；USE_MOCK 置 true 时生效） -------
const MOCK_RECRUITMENTS = [
  {
    _id: 'mock-rc-001',
    club_id: 'mock-club-001',
    club_name: '（mock）天文爱好者协会',
    title: '（mock）干事招新',
    content: '负责活动策划与执行，欢迎有热情的同学',
    form_fields: [
      { key: 'f1', label: '意向部门', type: 'single', required: true, options: ['活动部', '宣传部'] },
      { key: 'f2', label: '擅长技能', type: 'multi', required: false, options: ['设计', '策划'] },
      { key: 'f3', label: '自我介绍', type: 'text', required: true, options: [] },
    ],
    multi_step: true,
    signup_end: Date.now() + 7 * 24 * 3600 * 1000,
    capacity: null,
    status: 'open',
    reject_reason: '',
    created_at: Date.now() - 2 * 24 * 3600 * 1000,
    updated_at: Date.now() - 1 * 24 * 3600 * 1000,
  },
  {
    _id: 'mock-rc-002',
    club_id: 'mock-club-001',
    club_name: '（mock）天文爱好者协会',
    title: '（mock）部长招新',
    content: '需要有管理经验的骨干',
    form_fields: [{ key: 'f1', label: '擅长方向', type: 'multi', required: false, options: ['策划', '外联', '技术'] }],
    multi_step: true,
    signup_end: Date.now() + 3 * 24 * 3600 * 1000,
    capacity: 5,
    status: 'pending',
    reject_reason: '',
    created_at: Date.now() - 1 * 24 * 3600 * 1000,
    updated_at: Date.now() - 1 * 24 * 3600 * 1000,
  },
  {
    _id: 'mock-rc-003',
    club_id: 'mock-club-001',
    club_name: '（mock）天文爱好者协会',
    title: '（mock）新媒体组',
    content: '负责公众号与视频号运营',
    form_fields: [{ key: 'f1', label: '岗位意向', type: 'single', required: true, options: ['公众号', '视频号'] }],
    multi_step: false,
    signup_end: Date.now() + 10 * 24 * 3600 * 1000,
    capacity: 3,
    status: 'draft',
    reject_reason: '',
    created_at: Date.now() - 5 * 24 * 3600 * 1000,
    updated_at: Date.now() - 5 * 24 * 3600 * 1000,
  },
  {
    _id: 'mock-rc-004',
    club_id: 'mock-club-002',
    club_name: '（mock）街舞社',
    title: '（mock）街舞队招新',
    content: '欢迎零基础同学，定期团训与演出',
    form_fields: [{ key: 'f1', label: '舞种意向', type: 'single', required: true, options: ['Breaking', 'Popping'] }],
    multi_step: false,
    signup_end: Date.now() + 5 * 24 * 3600 * 1000,
    capacity: 10,
    status: 'open',
    reject_reason: '',
    created_at: Date.now() - 1 * 24 * 3600 * 1000,
    updated_at: Date.now() - 1 * 24 * 3600 * 1000,
  },
]

registerMock('GET', '/recruitment/manage', ({ data }) => {
  if (data && data.recruitment_id) {
    const row = MOCK_RECRUITMENTS.find((item) => item._id === data.recruitment_id)
    if (!row) return { code: 404, message: '岗位不存在或已删除', data: null }
    return { code: 0, message: 'ok', data: { recruitment: row } }
  }
  const status = (data && data.status) || 'all'
  const list = status === 'all' ? MOCK_RECRUITMENTS : MOCK_RECRUITMENTS.filter((item) => item.status === status)
  return { code: 0, message: 'ok', data: { list, total: list.length, page: 1, page_size: 20, has_more: false } }
})

registerMock('POST', '/recruitment/save', ({ data }) => {
  const found = MOCK_RECRUITMENTS.find((item) => item._id === (data && data.recruitment_id))
  if (data && data.recruitment_id && !found) return { code: 404, message: '岗位不存在或已删除', data: null }
  if (found && found.status !== 'draft') return { code: 1002, message: '仅「草稿」状态的岗位可编辑', data: null }
  const record = {
    _id: (data && data.recruitment_id) || `mock-rc-${Date.now()}`,
    club_id: (data && data.club_id) || 'mock-club-001',
    club_name: '（mock）天文爱好者协会',
    title: (data && data.title) || '',
    content: (data && data.content) || '',
    form_fields: (data && data.form_fields) || [],
    multi_step: !!(data && data.multi_step),
    signup_end: (data && data.signup_end) || 0,
    capacity: (data && data.capacity) || null,
    status: found ? found.status : 'draft',
    reject_reason: '',
    created_at: Date.now(),
    updated_at: Date.now(),
  }
  if (found) Object.assign(found, record)
  else MOCK_RECRUITMENTS.push(record)
  return { code: 0, message: 'ok', data: { recruitment: record, updated: !!data.recruitment_id } }
})

registerMock('POST', '/recruitment/submit', ({ data }) => {
  const found = MOCK_RECRUITMENTS.find((item) => item._id === (data && data.recruitment_id))
  if (!found) return { code: 404, message: '岗位不存在或已删除', data: null }
  if (found.status !== 'draft') return { code: 1002, message: '仅「草稿」状态的岗位可提交审核', data: null }
  found.status = 'pending'
  return { code: 0, message: 'ok', data: { recruitment: { ...found, status: 'pending' } } }
})

registerMock('POST', '/recruitment/close', ({ data }) => {
  const found = MOCK_RECRUITMENTS.find((item) => item._id === (data && data.recruitment_id))
  if (!found) return { code: 404, message: '岗位不存在或已删除', data: null }
  if (found.status !== 'open') return { code: 1002, message: '仅「开放中」的岗位可手动关闭', data: null }
  found.status = 'closed'
  return { code: 0, message: 'ok', data: { recruitment: { ...found, status: 'closed' } } }
})

registerMock('GET', '/recruitment/detail', ({ data }) => {
  const found = MOCK_RECRUITMENTS.find((item) => item._id === (data && data.recruitment_id))
  if (!found || found.status === 'draft' || found.status === 'pending') {
    return { code: 404, message: '岗位不存在或已删除', data: null }
  }
  return { code: 0, message: 'ok', data: { recruitment: found } }
})

// ------- P1-17 报名与我的状态 mock（离线联调） -------
const MOCK_MY_RECRUITMENTS = [
  { registration_id: 'mock-rr-1', recruitment_id: 'mock-rc-001', recruitment_title: '（mock）干事招新', club_name: '（mock）天文爱好者协会', status: 'pending', form_data: { f1: '活动部', f2: ['策划'], f3: '有社团经验' }, self_intro: '热爱天文，想为社团出力', interview: null, applied_at: Date.now() - 2 * 24 * 3600 * 1000, accept_at: null },
  { registration_id: 'mock-rr-2', recruitment_id: 'mock-rc-001', recruitment_title: '（mock）部长招新', club_name: '（mock）天文爱好者协会', status: 'interview', form_data: { f1: ['策划'] }, self_intro: '', interview: { time: new Date(Date.now() + 24 * 3600 * 1000).toISOString(), place: '活动室 101' }, applied_at: Date.now() - 3 * 24 * 3600 * 1000, accept_at: null },
]

registerMock('GET', '/recruitment/list', ({ data }) => {
  const keyword = (data && data.keyword) || ''
  const clubId = (data && data.club_id) || ''
  let list = MOCK_RECRUITMENTS.filter((item) => item.status === 'open')
  if (keyword) list = list.filter((item) => item.title.indexOf(keyword) !== -1)
  if (clubId) list = list.filter((item) => item.club_id === clubId)
  const rows = list.map((item) => ({
    _id: item._id,
    club_id: item.club_id,
    club_name: item.club_name,
    title: item.title,
    content: item.content,
    multi_step: item.multi_step,
    signup_end: item.signup_end,
    deadline_passed: false,
    capacity: item.capacity,
    remaining: item.capacity == null ? null : Math.max(0, item.capacity - 1),
    full: item.capacity != null && item.capacity <= 1,
    form_fields_count: item.form_fields ? item.form_fields.length : 0,
  }))
  return { code: 0, message: 'ok', data: { list: rows, total: rows.length, page: 1, page_size: 20, has_more: false } }
})

registerMock('POST', '/recruitment/signup', ({ data }) => {
  const found = MOCK_RECRUITMENTS.find((item) => item._id === (data && data.recruitment_id))
  if (!found) return { code: 404, message: '岗位不存在或已删除', data: null }
  if (found.status !== 'open') return { code: 1002, message: '该岗位已关闭，无法报名', data: null }
  if (MOCK_MY_RECRUITMENTS.some((r) => r.recruitment_id === found._id && r.status !== 'rejected')) {
    return { code: 1002, message: '你已报名该岗位，请勿重复提交', data: null }
  }
  const formData = (data && data.form_data) || {}
  const fields = found.form_fields || []
  for (const f of fields) {
    if (f.required && (formData[f.key] == null || String(formData[f.key]).trim() === '' || (Array.isArray(formData[f.key]) && formData[f.key].length === 0))) {
      return { code: 1001, message: `请填写「${f.label}」`, data: null }
    }
  }
  return { code: 0, message: 'ok', data: { registration: { registration_id: `mock-rr-${Date.now()}`, recruitment_id: found._id, status: 'pending', form_data: formData, interview: null, applied_at: Date.now() }, status: 'pending' } }
})

registerMock('GET', '/recruitment/my-status', () => {
  return { code: 0, message: 'ok', data: { list: MOCK_MY_RECRUITMENTS, total: MOCK_MY_RECRUITMENTS.length, page: 1, page_size: 20, has_more: false } }
})

// ------- P1-18 申请人 mock（离线联调） -------
const MOCK_APPLICANTS = [
  { registration_id: 'mock-app-1', user_id: 'mock-u-1', name: '苏晚晴', student_no: '20260002', student_no_masked: '2026****02', college: '计算机学院', major: '软件工程', status: 'pending', form_data: { f1: '活动部', f2: ['策划'], f3: '有社团活动经验' }, interview: null, applied_at: Date.now() - 2 * 3600 * 1000, accept_at: null },
  { registration_id: 'mock-app-2', user_id: 'mock-u-2', name: '何子轩', student_no: '20260003', student_no_masked: '2026****03', college: '', major: '', status: 'pending', form_data: { f1: '宣传部', f2: ['设计'], f3: '会做海报' }, interview: null, applied_at: Date.now() - 1 * 3600 * 1000, accept_at: null },
  { registration_id: 'mock-app-3', user_id: 'mock-u-3', name: '赵一鸣', student_no: '20260004', student_no_masked: '2026****04', college: '经管学院', major: '工商管理', status: 'interview', form_data: { f1: '活动部' }, interview: { time: new Date(Date.now() + 24 * 3600 * 1000).toISOString(), place: '活动室 101' }, applied_at: Date.now() - 3 * 3600 * 1000, accept_at: null },
]

registerMock('GET', '/recruitment/applicants', ({ data }) => {
  const status = (data && data.status) || 'all'
  let list = MOCK_APPLICANTS
  if (status !== 'all') list = list.filter((row) => row.status === status)
  const statusCount = { all: MOCK_APPLICANTS.length, pending: MOCK_APPLICANTS.filter((r) => r.status === 'pending').length, interview: MOCK_APPLICANTS.filter((r) => r.status === 'interview').length, accepted: MOCK_APPLICANTS.filter((r) => r.status === 'accepted').length, rejected: MOCK_APPLICANTS.filter((r) => r.status === 'rejected').length }
  return {
    code: 0,
    message: 'ok',
    data: { list, total: list.length, page: 1, page_size: 20, has_more: false, status_count: statusCount, activity: { _id: 'mock-rc-001', title: '（mock）干事招新', club_id: 'mock-club-001', form_fields: [{ key: 'f1', label: '意向部门', type: 'single', required: true, options: ['活动部', '宣传部'] }, { key: 'f2', label: '擅长技能', type: 'multi', required: false, options: ['设计', '策划'] }, { key: 'f3', label: '自我介绍', type: 'text', required: true, options: [] }] } },
  }
})

registerMock('POST', '/recruitment/screen', ({ data }) => {
  const ids = (data && data.registration_ids) || []
  const results = []
  for (const id of ids) {
    const row = MOCK_APPLICANTS.find((x) => x.registration_id === id)
    if (!row) return { code: 404, message: '部分申请人记录不存在', data: null }
    const action = (data && data.action) || ''
    if ((action === 'approve' || action === 'interview') && row.status === 'accepted') return { code: 1002, message: '已录取者不可再设面试', data: null }
    if (action === 'reject' && row.status === 'accepted') return { code: 1002, message: '已录取者不可淘汰', data: null }
    if (action === 'accept' && row.status === 'rejected') return { code: 1002, message: '已淘汰者不可录取', data: null }
    if (action === 'approve') { row.status = 'interview'; row.interview = null }
    else if (action === 'interview') { row.status = 'interview'; row.interview = (data && data.interview) || row.interview }
    else if (action === 'accept') { row.status = 'accepted'; row.accept_at = Date.now() }
    else if (action === 'reject') { row.status = 'rejected' }
    results.push({ registration_id: id, status: row.status })
  }
  return { code: 0, message: 'ok', data: { results, pushed: results.length } }
})

registerMock('POST', '/recruitment/notify', () => {
  return { code: 0, message: 'ok', data: { sent: 1, total: 1 } }
})

registerMock('GET', '/recruitment/export-csv', () => {
  const header = ['姓名', '学号', '学院专业', '状态', '报名时间']
  const label = { pending: '待审核', interview: '面试', accepted: '已录取', rejected: '已淘汰' }
  const lines = [header.join(',')]
  MOCK_APPLICANTS.forEach((row) => {
    lines.push([row.name, row.student_no, [row.college, row.major].filter(Boolean).join(' '), label[row.status] || row.status, new Date(row.applied_at).toLocaleString('zh-CN')].join(','))
  })
  return { code: 0, message: 'ok', data: { csv: '\uFEFF' + lines.join('\r\n'), count: MOCK_APPLICANTS.length, recruitment_title: '（mock）干事招新' } }
})
