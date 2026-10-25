/**
 * 全局配置
 * 说明：云函数按业务域拆分（用户/社团/活动/招新/通知/管理），统一走 URL 化 API 入口
 */
export const APP_CONFIG = {
  // uniCloud 云函数 URL 化基地址（P0-05 已开通；各域云函数 URL 化 path 为 /user、/club…，由网关剥离后透传云函数）
  API_BASE: import.meta.env.VITE_API_BASE || 'http://127.0.0.1:4175',
  // 云函数已上线，走真实接口；本地 mock 处理器仍保留（置 true 可离线联调）
  USE_MOCK: false,
  // 登录态 token 在本地存储中的键名
  TOKEN_KEY: 'clubhub_token',
  REFRESH_TOKEN_KEY: 'clubhub_refresh_token',
  USER_KEY: 'clubhub_user',
  AUTH_STATUS_KEY: 'clubhub_auth_status',
  // H5 微信公众号网页授权配置；留空时登录页保持游客态并给出引导。
  H5_WECHAT_APPID: '',
  H5_OAUTH_REDIRECT: '',
  // H5 开发测试登录（无微信凭据联调用，非需求功能）：置 true 后登录页显示「开发测试登录」按钮，
  // 仅配合本机 demo/server.cjs 使用；公开版云函数不支持测试身份映射。
  ENABLE_TEST_LOGIN: import.meta.env.VITE_ENABLE_TEST_LOGIN === 'true',
  TEST_LOGIN_CODE: 'devtest',
  // 请求超时时间（ms）
  TIMEOUT: 10000,
}

/**
 * 微信订阅消息模板 ID（P1-04 / COM-02）
 * 键名与云函数侧 notify 模块的环境变量一一对应（`uniCloud-aliyun/cloudfunctions/common/notify/index.js` 的 templateEnv）；
 * 需在微信公众平台「订阅消息」中申请后填入，**留空即自动跳过授权请求**（不阻断业务，服务端降级为仅站内消息）。
 */
export const WX_SUBSCRIBE_TEMPLATES = {
  WX_TPL_ACTIVITY_SIGNUP: '', // 报名结果通知（报名成功 / 候补 / 候补转正）
  WX_TPL_ACTIVITY_RESULT: '', // 报名审核结果（选拔类，含理由）
  WX_TPL_ACTIVITY_REMIND: '', // 活动开始提醒
  WX_TPL_RECRUITMENT_RESULT: '', // 招新筛选结果 / 面试通知
  WX_TPL_APPEAL_RESULT: '', // 申诉审核结果
  WX_TPL_CLUB_REVIEW: '', // 活动 / 招新审核结果（通知负责人）
  WX_TPL_CLUB_APPLY: '', // 社团入驻审核结果（P1-06；2.4 的订阅四时机不含入驻申请，通常仅走站内消息）
  WX_TPL_ANNOUNCEMENT: '', // 公告发布
  WX_TPL_CLUB_POST: '', // 动态下架通知（P1-26 内容监管；通知社团负责人，通常仅站内消息）
  WX_TPL_DELETION: '', // 注销申请结果（P3-02；2.4 订阅时机不含注销申请，通常仅走站内消息）
}

/**
 * 订阅授权时机表（需求 2.4「订阅授权时机」）——与 notify.SUBSCRIBE_MOMENTS 保持一致
 * 调用方式：用户点击提交时同步调用 `requestSubscribe('activity_signup')`
 */
export const WX_SUBSCRIBE_MOMENTS = {
  activity_signup: ['WX_TPL_ACTIVITY_SIGNUP', 'WX_TPL_ACTIVITY_REMIND'],
  recruitment_signup: ['WX_TPL_RECRUITMENT_RESULT'],
  appeal_submit: ['WX_TPL_APPEAL_RESULT'],
  club_review_submit: ['WX_TPL_CLUB_REVIEW'],
}

/**
 * 统一错误码表（前端）
 * 与云端权威表保持一致：uniCloud-aliyun/docs/api-error-codes.md
 * 约定：HTTP 层错误码（400/401/403/404/500）HTTP 状态同步；业务码（1001+）HTTP 状态恒为 200
 */
export const ERROR_CODE = {
  SUCCESS: 0, // 成功
  NETWORK: -1, // 网络错误（客户端本地生成，非服务端返回）
  BAD_REQUEST: 400, // 请求格式错误（body 非 JSON 等）
  UNAUTHORIZED: 401, // 未登录 / 登录已过期
  FORBIDDEN: 403, // 无权限执行该操作（含通道不匹配）
  NOT_FOUND: 404, // 资源不存在 / 路由未注册
  INTERNAL: 500, // 服务器内部错误
  PARAM_INVALID: 1001, // 参数缺失或非法
  STATUS_INVALID: 1002, // 业务状态不允许（状态机冲突，如已截止后报名）
  WHITELIST_FAIL: 2001, // 白名单校验失败（学号认证）
}
