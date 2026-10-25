/**
 * 首页聚合 API（STU-02 / P1-22）
 * 单接口一次返回首页各聚合模块（公开，游客可看）
 */
import { request, registerMock } from '@/utils/request'

/**
 * 首页聚合
 * @param {Object} data { page?, page_size? } 作用于精选活动（默认 5 条/页）
 * @returns { banners, categories, activities:{list,total,has_more}, clubs, recruitments }
 */
export function getHomeIndex(data) {
  return request({ path: '/home/index', method: 'GET', data, silent: true })
}

// ------- mock 数据（离线联调） -------
const MOCK_BANNERS = [
  { _id: 'mock-banner-1', title: '2026 秋季招新季开启', content: '本学期社团招新正式启动，百余社团等你加入', banner: '', created_at: Date.now() - 1 * 24 * 3600 * 1000 },
  { _id: 'mock-banner-2', title: '百团大战倒计时', content: '本周六全天，操场草坪不见不散', banner: '', created_at: Date.now() - 2 * 24 * 3600 * 1000 },
]
const MOCK_CATEGORIES = [
  { _id: 'mock-c-1', name: '学术科技', sort: 1 },
  { _id: 'mock-c-2', name: '文艺表演', sort: 2 },
  { _id: 'mock-c-3', name: '体育竞技', sort: 3 },
  { _id: 'mock-c-4', name: '公益实践', sort: 4 },
  { _id: 'mock-c-5', name: '创新创业', sort: 5 },
  { _id: 'mock-c-6', name: '国学文化', sort: 6 },
  { _id: 'mock-c-7', name: '信息技术', sort: 7 },
  { _id: 'mock-c-8', name: '摄影影视', sort: 8 },
]
const MOCK_ACTIVITIES = [
  { _id: 'mock-act-101', title: '（mock）流星雨观测夜', cover: '', club_id: 'mock-club-001', club_name: '天文爱好者协会', location: '操场草坪', start_time: Date.now() + 2 * 24 * 3600 * 1000, end_time: Date.now() + 2 * 24 * 3600 * 1000 + 3 * 3600 * 1000, status: 'signup', capacity: 50, signup_count: 32, progress: 64 },
  { _id: 'mock-act-102', title: '（mock）街舞公开课', cover: '', club_id: 'mock-club-002', club_name: '街舞社', location: '社团活动室 201', start_time: Date.now() + 1 * 24 * 3600 * 1000, end_time: Date.now() + 1 * 24 * 3600 * 1000 + 2 * 3600 * 1000, status: 'signup', capacity: 30, signup_count: 18, progress: 60 },
  { _id: 'mock-act-103', title: '（mock）编程马拉松', cover: '', club_id: 'mock-club-001', club_name: '天文爱好者协会', location: '机房 A', start_time: Date.now() + 5 * 24 * 3600 * 1000, end_time: Date.now() + 5 * 24 * 3600 * 1000 + 8 * 3600 * 1000, status: 'signup', capacity: 40, signup_count: 9, progress: 23 },
]
const MOCK_CLUBS = [
  { _id: 'mock-club-001', name: '（mock）天文爱好者协会', logo: '', intro: '每周三晚组织观星活动', category_name: '学术科技', star_level: 5, member_count: 128, activity_count: 6 },
  { _id: 'mock-club-002', name: '（mock）街舞社', logo: '', intro: '零基础也欢迎', category_name: '文艺表演', star_level: 3, member_count: 64, activity_count: 2 },
]
const MOCK_RECRUITMENTS = [
  { _id: 'mock-rc-1', title: '干事招新', club_id: 'mock-club-001', club_name: '天文爱好者协会', club_logo: '', signup_end: Date.now() + 3 * 24 * 3600 * 1000, capacity: 10, signup_count: 7, remaining: 3 },
  { _id: 'mock-rc-2', title: '舞队招募', club_id: 'mock-club-002', club_name: '街舞社', club_logo: '', signup_end: Date.now() + 6 * 24 * 3600 * 1000, capacity: null, signup_count: 5, remaining: null },
]

registerMock('GET', '/home/index', ({ data }) => {
  const page = (data && data.page) || 1
  const pageSize = (data && data.page_size) || 5
  const total = MOCK_ACTIVITIES.length
  return {
    code: 0,
    message: 'ok',
    data: {
      banners: MOCK_BANNERS,
      categories: MOCK_CATEGORIES,
      activities: {
        list: MOCK_ACTIVITIES.slice((page - 1) * pageSize, page * pageSize),
        total,
        page,
        page_size: pageSize,
        has_more: page * pageSize < total,
      },
      clubs: MOCK_CLUBS,
      recruitments: MOCK_RECRUITMENTS,
    },
  }
})