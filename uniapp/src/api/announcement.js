/**
 * 公告 API（P2-02 / ADM-06）
 * 详情接口公开（游客可看），仅 published 公告可见，下架 / 不存在返回 404
 */
import { request, registerMock } from '@/utils/request'

/**
 * 公告详情
 * @param {string} id 公告 _id
 * @returns {title, content, banner, status, published_at, created_at}
 */
export function getAnnouncementDetail(id) {
  return request({ path: '/announcement/detail', method: 'GET', data: { id: id || '' }, silent: true })
}

// ------- mock 数据（离线联调，与 api/home.js MOCK_BANNERS 对应） -------
const MOCK_ANNOUNCEMENTS = [
  {
    _id: 'mock-banner-1',
    title: '2026 秋季招新季开启',
    content: '本学期社团招新正式启动，百余社团等你加入。\n\n各社团将在本周内陆续发布招新岗位，同学们可前往「社团库」浏览详情并报名。报名截止后进入面试环节，请留意站内通知。',
    banner: '',
    status: 'published',
    published_at: Date.now() - 1 * 24 * 3600 * 1000,
    created_at: Date.now() - 1 * 24 * 3600 * 1000,
  },
  {
    _id: 'mock-banner-2',
    title: '百团大战倒计时',
    content: '本周六全天，操场草坪不见不散。\n\n现场将设置百余个社团摊位，支持现场咨询与报名。请携带校园卡，文明参与。',
    banner: '',
    status: 'published',
    published_at: Date.now() - 2 * 24 * 3600 * 1000,
    created_at: Date.now() - 2 * 24 * 3600 * 1000,
  },
]

registerMock('GET', '/announcement/detail', ({ data }) => {
  const id = data && data.id
  const row = MOCK_ANNOUNCEMENTS.find((item) => item._id === id)
  if (!row) return { code: 404, message: '公告不存在或已下架', data: null }
  return { code: 0, message: 'ok', data: row }
})
