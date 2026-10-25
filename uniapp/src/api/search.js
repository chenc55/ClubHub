/**
 * 全局搜索 API（COM-05 / P1-23）
 * 关键词精确匹配（不做模糊/拼音）；结果分组「活动 / 社团」，招新岗位挂靠社团条目
 */
import { request, registerMock } from '@/utils/request'

/**
 * 全局搜索
 * @param {Object} data { keyword, page?, page_size? }（page/page_size 作用于活动组，默认 10）
 * @returns { activities:{list,total,has_more}, clubs:[{..., recruitments:[...]}] }
 */
export function globalSearch(data) {
  return request({ path: '/search/global', method: 'GET', data, silent: true })
}

// ------- mock 数据（离线联调） -------
const MOCK_SEARCH_CLUBS = [
  {
    _id: 'mock-club-001',
    name: '（mock）天文爱好者协会',
    logo: '',
    intro: '每周三晚组织观星活动，一起看流星雨',
    category_name: '学术科技',
    star_level: 5,
    member_count: 128,
    activity_count: 6,
    recruitments: [
      { _id: 'mock-rc-1', title: '干事招新', signup_end: Date.now() + 3 * 24 * 3600 * 1000, capacity: 10, signup_count: 7, remaining: 3 },
    ],
  },
  {
    _id: 'mock-club-002',
    name: '（mock）街舞社',
    logo: '',
    intro: '每周团训，欢迎零基础同学加入',
    category_name: '文艺表演',
    star_level: 3,
    member_count: 64,
    activity_count: 2,
    recruitments: [
      { _id: 'mock-rc-2', title: '舞队招募', signup_end: Date.now() + 6 * 24 * 3600 * 1000, capacity: null, signup_count: 5, remaining: null },
    ],
  },
]
const MOCK_SEARCH_ACTS = [
  { _id: 'mock-act-101', title: '（mock）流星雨观测夜', cover: '', club_id: 'mock-club-001', club_name: '天文爱好者协会', location: '操场草坪', start_time: Date.now() + 2 * 24 * 3600 * 1000, end_time: Date.now() + 2 * 24 * 3600 * 1000 + 3 * 3600 * 1000, status: 'signup', signup_count: 32, progress: 64 },
  { _id: 'mock-act-102', title: '（mock）春季团训', cover: '', club_id: 'mock-club-002', club_name: '街舞社', location: '舞蹈室', start_time: Date.now() + 1 * 24 * 3600 * 1000, end_time: Date.now() + 1 * 24 * 3600 * 1000 + 2 * 3600 * 1000, status: 'signup', signup_count: 18, progress: 60 },
]

registerMock('GET', '/search/global', ({ data }) => {
  const keyword = String((data && data.keyword) || '').trim()
  if (!keyword) return { code: 1001, message: '请输入搜索关键词', data: null }
  const page = (data && data.page) || 1
  const pageSize = (data && data.page_size) || 10
  const hits = MOCK_SEARCH_ACTS.filter((a) => a.title.indexOf(keyword) !== -1)
  const clubHits = MOCK_SEARCH_CLUBS.filter(
    (c) => c.name.indexOf(keyword) !== -1 || c.intro.indexOf(keyword) !== -1
  )
  return {
    code: 0,
    message: 'ok',
    data: {
      keyword,
      activities: { list: hits.slice((page - 1) * pageSize, page * pageSize), total: hits.length, page, page_size: pageSize, has_more: page * pageSize < hits.length },
      clubs: clubHits,
    },
  }
})