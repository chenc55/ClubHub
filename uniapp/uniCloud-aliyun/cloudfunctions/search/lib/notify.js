/**
 * notify 公共模块（P1-04 / COM-02 通知触达引擎）
 *
 * 职责：
 * 1) 站内消息写入（**所有通知必写**，需求 2.4）——含 biz_type + biz_id 供消息中心跳转；
 * 2) 微信小程序订阅消息下发（一次性订阅），未配置模板 / 无 openid / 用户拒绝 / 额度用尽 / 下发失败
 *    一律**降级为仅站内消息，不抛错、不阻断业务**（需求 2.4 降级规则）；
 * 3) 去重：同一事件同一用户不重复推送，去重键 = 事件场景(scene) + 业务 ID(biz_id)，
 *    并由 messages 的复合唯一索引 (user_id, scene, biz_id) 保证并发原子性。
 *
 * 使用方式（各业务云函数，已由 scripts/sync-common.js 内联为 lib/notify.js）：
 *   const notify = require('./lib/notify')
 *   await notify.send({ userId, scene: 'activity_signup_success', bizId: activityId, vars: { activity_title, activity_time, activity_place, activity_id } })
 *
 * 环境变量：
 *   WX_APPID / WX_SECRET         小程序凭据（与登录共用）
 *   WX_TPL_<场景>                订阅消息模板 ID（微信公众平台申请；未配置 = 自动降级仅站内）
 *   WX_MINIPROGRAM_STATE         跳转小程序版本 developer / trial / formal（默认 formal，dev 空间联调建议 developer）
 *
 * 注意：本模块的“场景表”是前端 utils/subscribe.js 订阅授权时机的后端镜像，
 * 双方以 需求 2.4 场景清单为准，改动需同步（scripts/test-p1-04.js 有一致性守卫）。
 */
'use strict'

/* ============================================================
 * 常亮与场景表（需求 2.4 消息模板场景清单）
 * ============================================================ */
const PUSH_STATUS = {
  SITE_ONLY: 'site_only', // 仅站内（未配置模板 / 无 openid / 非云端环境）
  SENT: 'sent', // 订阅消息已下发
  SKIPPED: 'skipped', // 用户拒绝订阅或额度用尽
  FAILED: 'failed', // 下发失败（模板参数错误、access_token 失败等）
}

/** 微信模板字段类型的最大长度（超出会被微信拒绝，故先截断） */
const KIND_MAX = {
  thing: 20,
  time: 24,
  date: 24,
  phrase: 5,
  character_string: 32,
  number: 32,
  amount: 12,
  letter: 32,
}

/**
 * 场景表：scene => 站内文案模板 + 微信模板配置
 * - type       站内消息分类（messages.type）
 * - biz_type   关联业务类型（messages.biz_type，供跳转）
 * - title/content 站内文案模板，{key} 用 vars 渲染
 * - page       订阅消息点击跳转的小程序路径（可含 {key}）
 * - templateEnv 微信模板 ID 的环境变量名
 * - wechat     订阅消息 data 组装规则（key = 模板字段名，field = vars 取值字段，kind = 字段类型）
 */
const SCENES = {
  /* ---------- 活动 ---------- */
  activity_signup_success: {
    type: 'activity',
    biz_type: 'activity',
    title: '报名成功：{activity_title}',
    content: '你已成功报名「{activity_title}」。活动时间：{activity_time}；地点：{activity_place}。',
    page: 'pages/subpages/activity-detail/index?id={activity_id}',
    templateEnv: 'WX_TPL_ACTIVITY_SIGNUP',
    wechat: [
      { key: 'thing1', field: 'activity_title', kind: 'thing' },
      { key: 'time2', field: 'activity_time', kind: 'time' },
      { key: 'thing3', field: 'activity_place', kind: 'thing' },
    ],
  },
  activity_signup_waitlist: {
    type: 'activity',
    biz_type: 'activity',
    title: '已进入候补：{activity_title}',
    content: '「{activity_title}」名额已满，你已进入候补队列；如有名额释放将按报名时间顺序转正。',
    page: 'pages/subpages/activity-detail/index?id={activity_id}',
    templateEnv: 'WX_TPL_ACTIVITY_SIGNUP',
    wechat: [
      { key: 'thing1', field: 'activity_title', kind: 'thing' },
      { key: 'time2', field: 'activity_time', kind: 'time' },
      { key: 'thing3', field: 'activity_place', kind: 'thing' },
    ],
  },
  activity_waitlist_promoted: {
    type: 'activity',
    biz_type: 'activity',
    title: '候补转正：{activity_title}',
    content: '你已从候补转为正式报名「{activity_title}」。活动时间：{activity_time}；地点：{activity_place}。',
    page: 'pages/subpages/activity-detail/index?id={activity_id}',
    templateEnv: 'WX_TPL_ACTIVITY_SIGNUP',
    wechat: [
      { key: 'thing1', field: 'activity_title', kind: 'thing' },
      { key: 'time2', field: 'activity_time', kind: 'time' },
      { key: 'thing3', field: 'activity_place', kind: 'thing' },
    ],
  },
  activity_signup_result: {
    type: 'activity',
    biz_type: 'activity',
    title: '报名审核结果：{activity_title}',
    content: '{result_text}｜活动：{activity_title}{reason_text}',
    page: 'pages/subpages/activity-detail/index?id={activity_id}',
    templateEnv: 'WX_TPL_ACTIVITY_RESULT',
    wechat: [
      { key: 'thing1', field: 'activity_title', kind: 'thing' },
      { key: 'phrase2', field: 'result', kind: 'phrase' },
      { key: 'thing3', field: 'reason', kind: 'thing' },
    ],
  },
  activity_reminder: {
    type: 'activity',
    biz_type: 'activity',
    title: '活动即将开始：{activity_title}',
    content: '「{activity_title}」将于 {activity_time} 开始，地点：{activity_place}，请准时参加。',
    page: 'pages/subpages/activity-detail/index?id={activity_id}',
    templateEnv: 'WX_TPL_ACTIVITY_REMIND',
    wechat: [
      { key: 'thing1', field: 'activity_title', kind: 'thing' },
      { key: 'time2', field: 'activity_time', kind: 'time' },
      { key: 'thing3', field: 'activity_place', kind: 'thing' },
    ],
  },
  /* 活动提前结束（P1-10 手动提前结束时通知已报名用户；字段结构与 activity_reminder 同构，复用同一模板） */
  activity_ended: {
    type: 'activity',
    biz_type: 'activity',
    title: '活动已结束：{activity_title}',
    content: '「{activity_title}」已提前结束。活动时间：{activity_time}；地点：{activity_place}。',
    page: 'pages/subpages/activity-detail/index?id={activity_id}',
    templateEnv: 'WX_TPL_ACTIVITY_REMIND',
    wechat: [
      { key: 'thing1', field: 'activity_title', kind: 'thing' },
      { key: 'time2', field: 'activity_time', kind: 'time' },
      { key: 'thing3', field: 'activity_place', kind: 'thing' },
    ],
  },

  /* ---------- 招新 ---------- */
  recruitment_result: {
    type: 'recruitment',
    biz_type: 'recruitment',
    title: '招新进展：{recruitment_title}',
    content: '{result_text}｜岗位：{recruitment_title}{interview_text}{reason_text}',
    page: 'pages/subpages/recruitment-detail/index?id={recruitment_id}',
    templateEnv: 'WX_TPL_RECRUITMENT_RESULT',
    wechat: [
      { key: 'thing1', field: 'recruitment_title', kind: 'thing' },
      { key: 'phrase2', field: 'result', kind: 'phrase' },
      { key: 'thing3', field: 'interview', kind: 'thing' },
    ],
  },
  // P1-18：面试安排单独成场景（与 recruitment_result 去重键分开，保证「面试→录取」链路两段通知都能到达，
  // 对齐 notify 既有「按结果拆分场景绕过同键去重」的先例；微信模板仍复用 WX_TPL_RECRUITMENT_RESULT）
  recruitment_interview: {
    type: 'recruitment',
    biz_type: 'recruitment',
    title: '面试安排：{recruitment_title}',
    content: '你已通过「{recruitment_title}」初筛，请按时参加面试。{interview_text}',
    page: 'pages/subpages/recruitment-detail/index?id={recruitment_id}',
    templateEnv: 'WX_TPL_RECRUITMENT_RESULT',
    wechat: [
      { key: 'thing1', field: 'recruitment_title', kind: 'thing' },
      { key: 'phrase2', field: 'result', kind: 'phrase' },
      { key: 'thing3', field: 'interview', kind: 'thing' },
    ],
  },

  /* ---------- 申诉 / 审核结果（通知本人或负责人） ---------- */
  appeal_review_result: {
    type: 'system',
    biz_type: 'appeal',
    title: '申诉结果：{appeal_type_text}',
    content: '你的{appeal_type_text}审核{result_text}。{reason_text}',
    page: 'pages/subpages/rebind-appeal/index?type={appeal_type}',
    templateEnv: 'WX_TPL_APPEAL_RESULT',
    wechat: [
      { key: 'thing1', field: 'appeal_type_text', kind: 'thing' },
      { key: 'phrase2', field: 'result', kind: 'phrase' },
      { key: 'thing3', field: 'reason', kind: 'thing' },
    ],
  },
  club_activity_review: {
    type: 'activity',
    biz_type: 'activity',
    title: '活动审核{result_text}：{activity_title}',
    content: '你提交的活动「{activity_title}」审核{result_text}。{reason_text}',
    page: 'pages/subpages/club-admin/index',
    templateEnv: 'WX_TPL_CLUB_REVIEW',
    wechat: [
      { key: 'thing1', field: 'activity_title', kind: 'thing' },
      { key: 'phrase2', field: 'result', kind: 'phrase' },
      { key: 'thing3', field: 'reason', kind: 'thing' },
    ],
  },
  club_recruitment_review: {
    type: 'recruitment',
    biz_type: 'recruitment',
    title: '招新审核{result_text}：{recruitment_title}',
    content: '你提交的招新岗位「{recruitment_title}」审核{result_text}。{reason_text}',
    page: 'pages/subpages/club-admin/index',
    templateEnv: 'WX_TPL_CLUB_REVIEW',
    wechat: [
      { key: 'thing1', field: 'recruitment_title', kind: 'thing' },
      { key: 'phrase2', field: 'result', kind: 'phrase' },
      { key: 'thing3', field: 'reason', kind: 'thing' },
    ],
  },

  /* ---------- 社团入驻（P1-06） ----------
   * 按审核结果拆成两个场景：驳回后允许修改重提，若共用一个场景，
   * 「驳回 → 重提 → 通过」的第二条会因去重键 (user_id + scene + biz_id) 相同而被拦掉。
   * 拆分为通过 / 驳回后，两种结果各自只通知一次（连续两轮相同结果仍按需求去重）。
   */
  club_apply_approved: {
    type: 'system',
    biz_type: 'club',
    title: '入驻审核已通过：{club_name}',
    content: '你申请的社团「{club_name}」已通过审核。你已成为该社团社长，可进入「我的社团」开始管理。',
    page: 'pages/subpages/club-apply/index',
    // 需求 2.4 的订阅授权四时机不含「提交入驻申请」，故本场景无模板时恒降级为仅站内消息
    templateEnv: 'WX_TPL_CLUB_APPLY',
    wechat: [
      { key: 'thing1', field: 'club_name', kind: 'thing' },
      { key: 'phrase2', field: 'result', kind: 'phrase' },
      { key: 'thing3', field: 'reason', kind: 'thing' },
    ],
  },
  club_apply_rejected: {
    type: 'system',
    biz_type: 'club',
    title: '入驻审核已驳回：{club_name}',
    content: '你申请的社团「{club_name}」审核未通过。驳回理由：{reason}',
    page: 'pages/subpages/club-apply/index',
    templateEnv: 'WX_TPL_CLUB_APPLY',
    wechat: [
      { key: 'thing1', field: 'club_name', kind: 'thing' },
      { key: 'phrase2', field: 'result', kind: 'phrase' },
      { key: 'thing3', field: 'reason', kind: 'thing' },
    ],
  },

  /* ---------- 公告 ---------- */
  announcement_published: {
    type: 'system',
    biz_type: 'announcement',
    title: '新公告：{announcement_title}',
    content: '{announcement_title}｜{announcement_summary}',
    page: 'pages/subpages/announcement-detail/index?id={announcement_id}',
    templateEnv: 'WX_TPL_ANNOUNCEMENT',
    wechat: [
      { key: 'thing1', field: 'announcement_title', kind: 'thing' },
      { key: 'thing2', field: 'announcement_summary', kind: 'thing' },
    ],
  },

  /* ---------- 社团动态（P1-26 内容监管下架通知；数据源 P2-01） ----------
   * 需求 4.3.3：下架 / 违规复核后通知社团负责人（社长 / 干部）。
   * 动态详情页随 P2-01 落地；消息中心 biz_type 映射见 uniapp/src/pages/messages/index.vue（post 暂未映射，点击仅标已读）。
   */
  club_post_taken_down: {
    type: 'system',
    biz_type: 'post',
    title: '动态已被下架：{club_name}',
    content: '社团「{club_name}」的 1 条动态因内容违规已被管理员下架。请检查后合规发布，如有疑问请联系管理员。',
    page: 'pages/subpages/club-admin/index',
    templateEnv: 'WX_TPL_CLUB_POST',
    wechat: [
      { key: 'thing1', field: 'club_name', kind: 'thing' },
      { key: 'thing2', field: 'post_id', kind: 'thing' },
    ],
  },

  /* ---------- 账号注销（P3-02 / 需求 8.4） ----------
   * 管理端处理注销申请后通知申请人；biz_type=deletion。需求 2.4 订阅授权时机无注销场景，无模板时恒降级站内。
   */
  account_deletion_result: {
    type: 'system',
    biz_type: 'deletion',
    title: '注销申请{result_text}',
    content: '你的账号注销申请{result_text}。{reason_text}',
    page: 'pages/subpages/settings/index',
    templateEnv: 'WX_TPL_DELETION',
    wechat: [
      { key: 'thing1', field: 'result', kind: 'phrase' },
      { key: 'thing2', field: 'reason', kind: 'thing' },
    ],
  },
}

/**
 * 订阅授权时机表（需求 2.4「订阅授权时机」）
 * 前端 utils/subscribe.js 的 MOMENTS 与此保持一致（test-p1-04.js 有守卫）
 */
const SUBSCRIBE_MOMENTS = {
  activity_signup: ['WX_TPL_ACTIVITY_SIGNUP', 'WX_TPL_ACTIVITY_REMIND'],
  recruitment_signup: ['WX_TPL_RECRUITMENT_RESULT'],
  appeal_submit: ['WX_TPL_APPEAL_RESULT'],
  club_review_submit: ['WX_TPL_CLUB_REVIEW'],
}

/* ============================================================
 * 工具
 * ============================================================ */
function truncate(text, max) {
  const value = String(text == null ? '' : text)
  return value.length > max ? value.slice(0, max) : value
}

/** 模板渲染：{key} → vars[key]（缺失以空串替代） */
function render(template, vars) {
  const source = vars || {}
  return String(template || '').replace(/\{(\w+)\}/g, (match, key) =>
    source[key] === undefined || source[key] === null ? '' : String(source[key])
  )
}

function sceneOf(scene) {
  return SCENES[scene] || null
}

function templateIdOf(scene) {
  const conf = SCENES[scene]
  if (!conf) return ''
  return process.env[conf.templateEnv] || ''
}

/** 场景清单（自检接口用）：含环境变量名与「是否已配置模板」 */
function listScenes() {
  return Object.keys(SCENES).map((scene) => ({
    scene,
    type: SCENES[scene].type,
    biz_type: SCENES[scene].biz_type,
    template_env: SCENES[scene].templateEnv,
    template_configured: !!templateIdOf(scene),
  }))
}

function buildWechatData(conf, vars) {
  const source = vars || {}
  const data = {}
  for (const item of conf.wechat || []) {
    const max = KIND_MAX[item.kind] || 20
    data[item.key] = { value: truncate(source[item.field], max) }
  }
  return data
}

/* ============================================================
 * 微信 access_token（进程内缓存，过期前 60s 重新获取）
 * ============================================================ */
let tokenCache = { value: '', expiresAt: 0 }

function clearTokenCache() {
  tokenCache = { value: '', expiresAt: 0 }
}

async function getAccessToken(appid, secret) {
  const now = Date.now()
  if (tokenCache.value && tokenCache.expiresAt > now + 60 * 1000) return tokenCache.value
  const res = await uniCloud.httpclient.request('https://api.weixin.qq.com/cgi-bin/token', {
    method: 'GET',
    data: { grant_type: 'client_credential', appid, secret },
    dataType: 'json',
    timeout: 10000,
  })
  const body = (res && res.data) || {}
  if (!body.access_token) {
    throw new Error(`access_token ${body.errcode || 'unknown'}:${body.errmsg || ''}`)
  }
  tokenCache = {
    value: body.access_token,
    expiresAt: now + Number(body.expires_in || 7200) * 1000,
  }
  return tokenCache.value
}

/* ============================================================
 * 订阅消息下发（失败即降级，绝不抛错）
 * ============================================================ */
async function pushSubscribe({ userId, conf, vars, bizId }) {
  const templateId = process.env[conf.templateEnv] || ''
  if (!templateId) return { status: PUSH_STATUS.SITE_ONLY, reason: 'template_missing' }

  const appid = process.env.WX_APPID
  const secret = process.env.WX_SECRET
  if (!appid || !secret) return { status: PUSH_STATUS.SITE_ONLY, reason: 'wechat_credential_missing' }
  if (typeof uniCloud === 'undefined' || !uniCloud.httpclient || !uniCloud.database) {
    return { status: PUSH_STATUS.SITE_ONLY, reason: 'cloud_unavailable' }
  }

  const found = await uniCloud
    .database()
    .collection('users')
    .where({ _id: userId, deleted: 0 })
    .field({ openid: true })
    .limit(1)
    .get()
  const openid = (found.data && found.data[0] && found.data[0].openid) || ''
  if (!openid) return { status: PUSH_STATUS.SITE_ONLY, reason: 'openid_missing' }

  let token = ''
  try {
    token = await getAccessToken(appid, secret)
  } catch (e) {
    return { status: PUSH_STATUS.FAILED, error: String((e && e.message) || 'access_token_failed') }
  }

  try {
    const res = await uniCloud.httpclient.request(
      `https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${token}`,
      {
        method: 'POST',
        contentType: 'json',
        dataType: 'json',
        timeout: 10000,
        data: {
          touser: openid,
          template_id: templateId,
          page: render(conf.page, vars),
          miniprogram_state: process.env.WX_MINIPROGRAM_STATE || 'formal',
          lang: 'zh_CN',
          data: buildWechatData(conf, vars),
        },
      }
    )
    const body = (res && res.data) || {}
    if (body.errcode === 0) return { status: PUSH_STATUS.SENT }
    // 43101 用户拒绝接收 / 无订阅额度；43104 用户未订阅该模板 → 计为「跳过」而非失败
    const skipped = body.errcode === 43101 || body.errcode === 43104
    return {
      status: skipped ? PUSH_STATUS.SKIPPED : PUSH_STATUS.FAILED,
      error: `${body.errcode}:${body.errmsg || ''}`,
    }
  } catch (e) {
    return { status: PUSH_STATUS.FAILED, error: `request_failed:${String((e && e.message) || '')}` }
  }
}

/* ============================================================
 * 对外主入口：写入站内消息（必写）+ 尝试订阅消息（可降级）
 * @param {Object} params
 * @param {string} params.userId   接收人 users._id
 * @param {string} params.scene    事件场景（SCENES 键）
 * @param {string} [params.bizId]  业务 ID（去重维度之一，默认空串）
 * @param {Object} [params.vars]   文案与模板变量
 * @returns {Promise<{duplicate:boolean,message_id:string,scene:string,channel:string,pushed:boolean,push_status:string,reason:string}>}
 * ============================================================ */
async function send({ userId, scene, bizId = '', vars = {} }) {
  const conf = sceneOf(scene)
  if (!conf) throw new Error(`unknown notify scene: ${scene}`)
  if (!userId) throw new Error('notify.send requires userId')

  const biz = String(bizId || '')
  const messages = uniCloud.database().collection('messages')

  // 1) 去重预查（唯一索引兜底并发）
  const existed = await messages
    .where({ user_id: userId, scene, biz_id: biz })
    .field({ _id: true })
    .limit(1)
    .get()
  if (existed.data && existed.data[0]) {
    return {
      duplicate: true,
      message_id: existed.data[0]._id,
      scene,
      channel: 'site_only',
      pushed: false,
      push_status: PUSH_STATUS.SITE_ONLY,
      reason: 'duplicate',
    }
  }

  // 2) 站内消息必写
  const record = {
    user_id: userId,
    type: conf.type,
    scene,
    title: render(conf.title, vars),
    content: render(conf.content, vars),
    biz_type: conf.biz_type,
    biz_id: biz,
    push_status: PUSH_STATUS.SITE_ONLY,
    push_error: '',
    pushed_at: null,
    is_read: false,
    created_at: new Date(),
    deleted: 0,
  }

  let messageId = ''
  try {
    const added = await messages.add(record)
    messageId = added.id
  } catch (e) {
    // 唯一索引冲突：并发下同事件已写入 → 视为重复，不重复推送
    return {
      duplicate: true,
      message_id: '',
      scene,
      channel: 'site_only',
      pushed: false,
      push_status: PUSH_STATUS.SITE_ONLY,
      reason: 'duplicate',
    }
  }

  // 3) 订阅消息：未配置 / 被拒 / 失败一律降级，不影响站内消息与业务流程
  const push = await pushSubscribe({ userId, conf, vars, bizId: biz })
  if (push.status !== PUSH_STATUS.SITE_ONLY) {
    try {
      await messages.doc(messageId).update({
        push_status: push.status,
        push_error: push.error || '',
        pushed_at: push.status === PUSH_STATUS.SENT ? new Date() : null,
      })
    } catch (e) {
      // 状态回写失败不影响业务
    }
  }

  return {
    duplicate: false,
    message_id: messageId,
    scene,
    channel: push.status === PUSH_STATUS.SENT ? 'both' : 'site_only',
    pushed: push.status === PUSH_STATUS.SENT,
    push_status: push.status,
    reason: push.reason || push.error || '',
  }
}

module.exports = {
  PUSH_STATUS,
  SCENES,
  SUBSCRIBE_MOMENTS,
  send,
  sceneOf,
  listScenes,
  templateIdOf,
  render,
  truncate,
  buildWechatData,
  clearTokenCache,
}
