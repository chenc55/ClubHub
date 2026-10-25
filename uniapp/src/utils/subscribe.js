/**
 * 微信订阅消息授权封装（P1-04 / COM-02）
 *
 * 需求 2.4「订阅授权时机」（一次性订阅，用户每勾选授权一次仅允许下发一条对应消息）：
 * - 提交活动报名   → requestSubscribe('activity_signup')      // 报名结果通知 + 活动开始提醒
 * - 提交招新报名   → requestSubscribe('recruitment_signup')   // 筛选结果 / 面试通知
 * - 提交换绑申诉   → requestSubscribe('appeal_submit')        // 申诉审核结果
 * - 负责人提交审核 → requestSubscribe('club_review_submit')   // 审核结果通知
 *
 * 使用要求：
 * 1) **必须在用户点击事件中同步调用**（微信要求由用户交互触发，勿放在异步回调后再调用）；
 * 2) 调用结果**不需要**回传服务端 —— 下发时若被拒/无额度，微信返回 43101 由服务端自动降级为仅站内消息；
 * 3) 一律**不抛错、不阻塞业务**：未配置模板、非小程序端、用户拒绝、接口异常均静默返回结果对象。
 *
 * @param {string|string[]} moments 时机键（WX_SUBSCRIBE_MOMENTS 的键）
 * @returns {Promise<{skipped:boolean,reason?:string,accepted:string[],rejected:string[]}>}
 */
import { WX_SUBSCRIBE_TEMPLATES, WX_SUBSCRIBE_MOMENTS } from './config'

/** 取某时机对应的有效模板 ID（未配置的自动剔除） */
export function templatesOf(moment) {
  return (WX_SUBSCRIBE_MOMENTS[moment] || [])
    .map((key) => WX_SUBSCRIBE_TEMPLATES[key])
    .filter((id) => !!id)
}

/** 汇总微信返回的授权结果（accept / reject / ban） */
function summarize(result, tmplIds) {
  const accepted = tmplIds.filter((id) => result[id] === 'accept')
  const rejected = tmplIds.filter((id) => result[id] !== 'accept')
  return { skipped: false, accepted, rejected }
}

export function requestSubscribe(moments) {
  const keys = Array.isArray(moments) ? moments : [moments]
  const tmplIds = []
  keys.forEach((moment) => {
    templatesOf(moment).forEach((id) => {
      if (tmplIds.indexOf(id) === -1) tmplIds.push(id)
    })
  })

  if (!tmplIds.length) {
    return Promise.resolve({ skipped: true, reason: 'template_not_configured', accepted: [], rejected: [] })
  }

  // #ifdef MP-WEIXIN
  return new Promise((resolve) => {
    try {
      wx.requestSubscribeMessage({
        tmplIds,
        success: (result) => resolve(summarize(result || {}, tmplIds)),
        fail: (err) =>
          resolve({
            skipped: true,
            reason: 'request_failed',
            accepted: [],
            rejected: tmplIds,
            error: (err && err.errMsg) || '',
          }),
      })
    } catch (e) {
      resolve({ skipped: true, reason: 'request_failed', accepted: [], rejected: tmplIds })
    }
  })
  // #endif

  // #ifndef MP-WEIXIN
  // H5 / App 端无订阅消息能力；H5 微信内由公众号模板消息承担（当前不接入），仅站内消息兜底
  return Promise.resolve({ skipped: true, reason: 'platform_not_supported', accepted: [], rejected: [] })
  // #endif
}
