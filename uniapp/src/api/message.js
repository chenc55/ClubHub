/**
 * 消息中心 API（STU-07 / P1-21）
 * 站内消息中心：分类列表 / 单条已读 / 全部已读 / 未读数
 */
import { request, registerMock } from '@/utils/request'

/**
 * 消息列表（分页 + 分类过滤；回执含 unread_total）
 * @param {Object} data { type?: 'all'|'system'|'activity'|'recruitment', page?, page_size? }
 */
export function getMessageList(data) {
  return request({ path: '/message/list', method: 'GET', data, silent: true })
}

/** 单条已读（幂等；返回 { updated, unread_total }） */
export function readMessage(data) {
  return request({ path: '/message/read', method: 'POST', data, silent: true })
}

/** 全部已读（可按分类；返回 { updated, unread_total }） */
export function readAllMessages(data) {
  return request({ path: '/message/read-all', method: 'POST', data, silent: true })
}

/** 未读数（含分类计数，供 Tab 徽标） */
export function getUnreadCount() {
  return request({ path: '/message/unread', method: 'GET', silent: true })
}

// ------- mock 数据（离线联调；状态保存在内存，供红点 / 已读 / 全部已读联动） -------
const MOCK_MESSAGES = [
  { _id: 'm-1', type: 'activity', scene: 'activity_signup_success', title: '报名成功：观星夜活动', content: '你已成功报名「观星夜活动」。活动时间：今晚 19:30；地点：操场草坪。', biz_type: 'activity', biz_id: 'mock-act-101', is_read: false, created_at: Date.now() - 2 * 3600 * 1000 },
  { _id: 'm-2', type: 'recruitment', scene: 'recruitment_interview', title: '面试安排：干事招新', content: '你已通过「干事招新」初筛，请按时参加面试。时间：明天 14:00；地点：活动室 101。', biz_type: 'recruitment', biz_id: 'mock-rc-1', is_read: false, created_at: Date.now() - 5 * 3600 * 1000 },
  { _id: 'm-3', type: 'system', scene: 'club_apply_approved', title: '入驻审核已通过：天文爱好者协会', content: '你申请的社团「天文爱好者协会」已通过审核。你已成为该社团社长。', biz_type: 'club', biz_id: '', is_read: false, created_at: Date.now() - 1 * 24 * 3600 * 1000 },
  { _id: 'm-4', type: 'system', scene: 'announcement_published', title: '新公告：社团招新季开启', content: '本学期社团招新季正式开启，欢迎同学们踊跃报名。', biz_type: 'announcement', biz_id: 'mock-ann-1', is_read: true, created_at: Date.now() - 2 * 24 * 3600 * 1000 },
  { _id: 'm-5', type: 'activity', scene: 'activity_reminder', title: '活动即将开始：街舞公开课', content: '「街舞公开课」将于明天 18:00 开始，地点：体育馆，请准时参加。', biz_type: 'activity', biz_id: 'mock-act-102', is_read: true, created_at: Date.now() - 3 * 24 * 3600 * 1000 },
  { _id: 'm-6', type: 'recruitment', scene: 'recruitment_result', title: '招新进展：宣传部干事', content: '你的「宣传部干事」申请已通过初筛。', biz_type: 'recruitment', biz_id: 'mock-rc-2', is_read: true, created_at: Date.now() - 4 * 24 * 3600 * 1000 },
]

function mockUnread() {
  const count = { total: 0, system: 0, activity: 0, recruitment: 0 }
  MOCK_MESSAGES.forEach((m) => {
    if (m.is_read) return
    count.total += 1
    count[m.type] = (count[m.type] || 0) + 1
  })
  return count
}

registerMock('GET', '/message/list', ({ data }) => {
  const type = (data && data.type) || 'all'
  const page = (data && data.page) || 1
  const pageSize = (data && data.page_size) || 20
  let rows = MOCK_MESSAGES.slice().sort((a, b) => b.created_at - a.created_at)
  if (type !== 'all') rows = rows.filter((m) => m.type === type)
  const total = rows.length
  const list = rows.slice((page - 1) * pageSize, page * pageSize)
  return { code: 0, message: 'ok', data: { list, total, page, page_size: pageSize, has_more: page * pageSize < total, unread_total: mockUnread().total } }
})

registerMock('POST', '/message/read', ({ data }) => {
  const row = MOCK_MESSAGES.find((m) => m._id === (data && data.message_id))
  if (!row) return { code: 404, message: '消息不存在', data: null }
  let updated = 0
  if (!row.is_read) {
    row.is_read = true
    updated = 1
  }
  return { code: 0, message: 'ok', data: { updated, unread_total: mockUnread().total } }
})

registerMock('POST', '/message/read-all', ({ data }) => {
  const type = (data && data.type) || 'all'
  let updated = 0
  MOCK_MESSAGES.forEach((m) => {
    if (m.is_read) return
    if (type !== 'all' && m.type !== type) return
    m.is_read = true
    updated += 1
  })
  return { code: 0, message: 'ok', data: { updated, unread_total: mockUnread().total } }
})

registerMock('GET', '/message/unread', () => ({ code: 0, message: 'ok', data: mockUnread() }))
