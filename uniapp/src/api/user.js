/**
 * 用户业务域 API 模块
 * P0-05 已开通 URL 化网关（/user/*）；P0-06 登录基础、P1-03 学号认证后续接入
 */
import { request, registerMock } from '@/utils/request'

/** 云函数网关健康检查（P0-05 联调用，公开接口） */
export function ping() {
  return request({ path: '/user/ping', method: 'GET' })
}

/** 微信 openid 登录（P0-06 实现） */
export function login(data) {
  return request({ path: '/user/login', method: 'POST', data, silent: true })
}

export function refreshSession(refresh_token) {
  return request({ path: '/user/session/refresh', method: 'POST', data: { refresh_token } })
}

/** 获取当前用户资料 */
export function getProfile() {
  return request({ path: '/user/profile', method: 'GET' })
}

/**
 * 学号认证与绑定（P1-03 实现）
 * silent：失败原因由认证页就地展示（含 2001 的 data.reason 用于区分申诉类型），不弹全局 toast
 */
export function verifyStudent(data) {
  return request({ path: '/user/verify', method: 'POST', data, silent: true })
}

/**
 * 提交换绑 / 学号占用申诉（P1-05 实现）
 * silent：失败原因由申诉页就地展示（如 1002 已有进行中申诉并带回该申诉）
 */
export function submitAppeal(data) {
  return request({ path: '/user/appeals', method: 'POST', data, silent: true })
}

/** 申诉进度：进行中申诉 + 最近记录（P1-05 实现） */
export function getCurrentAppeal() {
  return request({ path: '/user/appeals/current', method: 'GET', silent: true })
}

/** 账号注销 / 个人数据删除申请（P3-02 / 需求 8.4）：{ reason? } → { _id, status: pending } */
export function submitDeletionRequest(data) {
  return request({ path: '/user/deletion-request', method: 'POST', data, silent: true })
}

// ------- mock 数据（服务空间创建前） -------
registerMock('POST', '/user/deletion-request', () => ({
  code: 0,
  message: 'ok',
  data: { _id: 'mock-deletion-1', status: 'pending', created_at: new Date().toISOString() },
}))
registerMock('POST', '/user/login', () => ({
  code: 0,
  message: 'ok',
  data: {
    token: 'mock-token-2f80ed',
    refresh_token: 'mock-refresh-token-2f80ed',
    expires_in: 7200,
    authStatus: 'guest',
    user: { _id: 'mock-user-001', openid: 'mock-openid', nickname: '星球访客', avatar: '', auth_status: 'unverified', status: 'normal' },
  },
}))

registerMock('POST', '/user/session/refresh', () => ({ code: 0, message: 'ok', data: { token: 'mock-token-refreshed', expires_in: 7200 } }))

registerMock('GET', '/user/profile', () => ({
  code: 0,
  message: 'ok',
  data: {
    _id: 'mock-user-001',
    nickname: '星球访客',
    avatar: '',
    auth_status: 'unverified',
    status: 'normal',
    student_no: '',
    name: '',
    college: '',
    major: '',
  },
}))

registerMock('POST', '/user/verify', () => ({
  code: 2001,
  message: '学号不在白名单内，请核对后重试或提交申诉',
  data: { reason: 'not_found' },
}))

registerMock('POST', '/user/appeals', () => ({
  code: 0,
  message: 'ok',
  data: {
    appeal: {
      _id: 'mock-appeal-001',
      appeal_type: 'rebind',
      old_student_no: '',
      new_student_no: '20260001',
      proof: '（mock）已上传学生证照片',
      proof_images: [],
      status: 'pending',
      reject_reason: '',
      review_at: null,
      created_at: Date.now(),
    },
  },
}))

registerMock('GET', '/user/appeals/current', () => ({ code: 0, message: 'ok', data: { list: [], pending: null } }))
