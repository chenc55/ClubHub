/**
 * 管理工作台聚合域云函数（P1-28 / 待办概览）
 *
 * URL 化前缀 /dashboard（网关剥离前缀后透传 event.path），路由按相对路径注册：
 *   GET /summary → 对外 GET /dashboard/summary
 *
 * 说明：
 * - 管理通道 requireAuth(ADMIN)：工作台概览三角色（super / auditor / viewer）均可见（需求 2.3）；
 * - 待办口径（需求 4.3.x）：待审社团 = clubs.status=pending；待审活动 = activities.status=pending；
 *   待审招新 = recruitments.status=pending；待审申诉 = appeals.status=pending；疑似动态 = club_posts.flagged（先发后审送审队列）；
 * - 平台概览：认证用户数（users.auth_status=verified）、正常社团数（clubs.status=normal）、
 *   活动总数、开放招新数（recruitments.status=open）；
 * - 软删口径统一 deleted=0。
 */
'use strict'
const club = require('./lib/club-common')

/** 管理通道：工作台三角色均可看，无需 requireRole */
const DASH_GUARD = [club.requireAuth(club.TOKEN_TYPES.ADMIN)]

/** 按条件统计集合记录数（deleted=0 兜底） */
async function countBy(collectionName, where) {
  const res = await uniCloud
    .database()
    .collection(collectionName)
    .where({ deleted: 0, ...where })
    .count()
  return Number((res && res.total) || 0)
}

exports.main = async (event) => {
  const api = club.createRouter(event)

  // 健康检查（无需鉴权）
  api.get('/ping', () => club.ok({ pong: 'dashboard', time: Date.now() }))

  // 工作台聚合（管理通道）
  api.get('/summary', ...DASH_GUARD, async () => {
    const [pendingClubs, pendingActivities, pendingRecruitments, pendingAppeals, flaggedPosts, verifiedUsers, normalClubs, totalActivities, openRecruitments] =
      await Promise.all([
        countBy('clubs', { status: 'pending' }),
        countBy('activities', { status: 'pending' }),
        countBy('recruitments', { status: 'pending' }),
        countBy('appeals', { status: 'pending' }),
        countBy('club_posts', { flagged: true }),
        countBy('users', { auth_status: 'verified' }),
        countBy('clubs', { status: 'normal' }),
        countBy('activities', {}),
        countBy('recruitments', { status: 'open' }),
      ])

    const pending = {
      clubs: pendingClubs,
      activities: pendingActivities,
      recruitments: pendingRecruitments,
      appeals: pendingAppeals,
      flagged_posts: flaggedPosts,
      total: pendingClubs + pendingActivities + pendingRecruitments + pendingAppeals,
    }
    const overview = {
      verified_users: verifiedUsers,
      normal_clubs: normalClubs,
      total_activities: totalActivities,
      open_recruitments: openRecruitments,
    }
    return club.ok({ pending, overview })
  })

  return api.run()
}