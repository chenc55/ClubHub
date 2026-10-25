/**
 * 管理端全局配置（P0-09）
 */
export const API_CONFIG = {
  // uniCloud 云函数 URL 化基地址；管理端接口统一走 /admin 前缀
  API_BASE: import.meta.env.VITE_API_BASE || 'http://127.0.0.1:4175',
  // 管理员会话在 localStorage 中的键名
  SESSION_KEY: 'clubhub_admin_session',
  // 请求超时（ms）
  TIMEOUT: 15000,
}

/**
 * 统一错误码表（与管理端云函数 / uniCloud-aliyun/docs/api-error-codes.md 对齐）
 */
export const ERROR_CODE = {
  SUCCESS: 0,
  NETWORK: -1,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INTERNAL: 500,
  PARAM_INVALID: 1001,
  STATUS_INVALID: 1002,
}
