/**
 * 用户域云函数（P0-05 骨架）
 * URL 化前缀 /user（网关会把该前缀剥离后透传 event.path），
 * 因此此处路由按相对路径注册：路由 '/ping' ⇔ 对外 GET /user/ping
 * P0-06 接入：微信 openid 登录、游客态；P1-02 接入：禁用态写操作拦截；P1-03 接入：学号认证
 */
'use strict'
const club = require('./lib/club-common')

const ACCESS_TTL = 2 * 3600
const REFRESH_TTL = 30 * 24 * 3600
const localUsers = new Map()

/**
 * 上传场景规格（与《功能需求.md》2.6 对齐）
 * 本表为「前端 src/utils/upload.js 中 UPLOAD_SCENES 的镜像」，字段须保持一致
 * （scripts/test-p0-07.js 有一致性守卫，改动需两侧同步）。
 * count 单次张数；maxMB 用户可选原图上限；gifMaxMB 动图专项上限（GIF 不可压缩，见偏差说明）。
 */
const UPLOAD_SCENES = {
  moments: { count: 9, maxMB: 5, gifMaxMB: 0.93, accept: ['jpg', 'jpeg', 'png', 'gif', 'webp'] },
  activity_cover: { count: 1, maxMB: 5, accept: ['jpg', 'jpeg', 'png', 'webp'] },
  club_logo: { count: 1, maxMB: 2, accept: ['jpg', 'jpeg', 'png'] },
  club_cover: { count: 1, maxMB: 5, accept: ['jpg', 'jpeg', 'png', 'webp'] },
  announcement_banner: { count: 1, maxMB: 5, accept: ['jpg', 'jpeg', 'png', 'webp'] },
  appeal_proof: { count: 3, maxMB: 5, accept: ['jpg', 'jpeg', 'png'] },
}

// 单张图片体积上限：URL 化网关请求体上限实测约 1.43MB（JSON），
// base64 膨胀约 33%，留余量后取 950KB 原图上限
const UPLOAD_MAX_BYTES = 950 * 1024

function dateKey() {
  const d = now()
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}

/** 取云存储可访问 URL（阿里云云存储文件按路径公开可读） */
async function storageUrl(fileID) {
  try {
    const res = await uniCloud.getTempFileURL({ fileList: [fileID] })
    const item = res && res.fileList && res.fileList[0]
    return (item && (item.tempFileURL || item.download_url)) || ''
  } catch (e) {
    return ''
  }
}

function now() {
  return new Date()
}

/**
 * 活跃打点（P2-03 / ADM-07 DAU·MAU 数据源）
 * 登录 / 会话刷新 / 学号认证时写入 users.last_active_at（P2-03 经确认新增字段）；
 * 写失败不阻断业务主流程。
 */
async function touchActive(userId) {
  if (!userId || typeof uniCloud === 'undefined' || !uniCloud.database) return
  try {
    await uniCloud.database().collection('users').doc(userId).update({ last_active_at: now() })
  } catch (e) {
    // 打点失败不影响登录 / 刷新 / 认证
  }
}

async function resolveOpenid(body) {
  const code = body.code.trim()
  const h5 = body.platform === 'h5-wechat'
  // 开发测试登录通道（非需求功能）：环境变量 TEST_CODE2OPENID 配置逗号分隔的 `code:openid` 映射，
  // 命中即返回映射 openid，用于未配置微信凭据（E-01/E-02）时 H5 客户端登录联调；
  // 不配置该变量时本分支全跳过，线上行为与之前完全一致。
  const testMap = (process.env.TEST_CODE2OPENID || '').trim()
  if (testMap) {
    for (const entry of testMap.split(',')) {
      const [testCode, testOpenid] = entry.split(':').map((s) => (s || '').trim())
      if (testCode && testOpenid && code === testCode) {
        return { openid: testOpenid }
      }
    }
  }
  const appid = h5 ? process.env.H5_WECHAT_APPID : process.env.WX_APPID
  const secret = h5 ? process.env.H5_WECHAT_SECRET : process.env.WX_SECRET

  if (typeof uniCloud === 'undefined') return { openid: `dev-openid-${code.slice(0, 48)}` }
  if (!appid || !secret || !process.env.CLUBHUB_JWT_SECRET) {
    return { error: club.fail(club.ERROR_CODE.INTERNAL, '登录暂不可用，请稍后重试') }
  }
  try {
    const url = h5 ? 'https://api.weixin.qq.com/sns/oauth2/access_token' : 'https://api.weixin.qq.com/sns/jscode2session'
    const data = h5
      ? { appid, secret, code, grant_type: 'authorization_code' }
      : { appid, secret, js_code: code, grant_type: 'authorization_code' }
    const res = await uniCloud.httpclient.request(url, { method: 'GET', data, dataType: 'json' })
    if (res && res.data && !res.data.errcode && typeof res.data.openid === 'string' && res.data.openid.trim()) {
      return { openid: res.data.openid }
    }
  } catch (e) {
    // 不记录请求对象，避免日志泄漏 app secret / 微信会话凭证。
    return { error: club.fail(club.ERROR_CODE.INTERNAL, '登录暂不可用，请稍后重试') }
  }
  return { error: club.fail(club.ERROR_CODE.UNAUTHORIZED, '微信登录凭证无效，请重新登录') }
}

/**
 * 未认证用户唯一 student_no 占位（P3-02 同源索引坑的登录侧兜底）：
 * users 的 student_no_unique 为**非稀疏**唯一索引，而 MongoDB 对缺失字段按 null 建索引，
 * 集合内已有无学号文档时，登录建号若不写 student_no 会撞 E11000（2026-09-26 真实云端复现）。
 * 占位为仅字母数字、足够唯一（哈希 + 尾时间戳），/verify 认证成功时会被真实学号整体覆盖，
 * 注销匿名化则复用 deleted-{id} 占位（P3-02 已约定），互不影响。
 */
function studentPlaceholder(openid) {
  let h = 0
  const str = String(openid)
  for (let i = 0; i < str.length; i += 1) h = (h * 31 + str.charCodeAt(i)) | 0
  return `u${(h >>> 0).toString(16)}${Date.now().toString(16).slice(-4)}`
}

async function upsertUser(openid, body) {
  if (typeof uniCloud === 'undefined' || !uniCloud.database) {
    const old = localUsers.get(openid)
    if (old) {
      if (typeof body.nickname === 'string') old.nickname = body.nickname.slice(0, 20)
      if (typeof body.avatar === 'string') old.avatar = body.avatar
      old.updated_at = now()
      return old
    }
    const timestamp = now()
    const created = { _id: `local-${openid}`, openid, nickname: body.nickname || '', avatar: body.avatar || '', auth_status: 'unverified', status: 'normal', deleted: 0, created_at: timestamp, updated_at: timestamp }
    localUsers.set(openid, created)
    return created
  }
  const users = uniCloud.database().collection('users')
  const find = async () => (await users.where({ openid }).limit(1).get()).data[0]
  const update = async (user) => {
    if (user.deleted !== 0 || user.status !== 'normal') return user
    const changes = { updated_at: now() }
    if (typeof body.nickname === 'string') changes.nickname = body.nickname
    if (typeof body.avatar === 'string') changes.avatar = body.avatar
    await users.doc(user._id).update(changes)
    return { ...user, ...changes }
  }
  const user = await find()
  if (user) return update(user)
  const timestamp = now()
  const record = {
    openid, nickname: body.nickname || '', avatar: body.avatar || '',
    // 未认证前写唯一占位，规避 student_no 非稀疏唯一索引的 null 冲突；认证时整体覆盖
    student_no: studentPlaceholder(openid),
    auth_status: 'unverified', status: 'normal', deleted: 0,
    created_at: timestamp, updated_at: timestamp,
  }
  try {
    const created = await users.add(record)
    return { _id: created.id, ...record }
  } catch (e) {
    // 并发首登由既有 openid 唯一索引保证只创建一个用户。
    const existing = await find()
    if (existing) return update(existing)
    throw e
  }
}

function accountError(user) {
  if (!user || user.deleted !== 0) return club.fail(club.ERROR_CODE.UNAUTHORIZED, '账号不可用，请重新登录')
  if (user.status !== 'normal') return club.fail(club.ERROR_CODE.FORBIDDEN, '账号已被禁用')
  return null
}

function sessionData(user) {
  return {
    token: club.signToken({
      type: club.TOKEN_TYPES.STUDENT, token_kind: 'access',
      userId: user._id, openid: user.openid, auth_status: user.auth_status,
    }, ACCESS_TTL),
    expires_in: ACCESS_TTL,
    user: publicUser(user),
    authStatus: user.auth_status === 'verified' ? 'authenticated' : 'guest',
  }
}

async function findSessionUser(payload) {
  if (!payload || typeof payload.userId !== 'string' || typeof payload.openid !== 'string') return null
  if (typeof uniCloud === 'undefined' || !uniCloud.database) {
    const user = localUsers.get(payload.openid)
    return user && user._id === payload.userId ? user : null
  }
  const result = await uniCloud.database().collection('users')
    .where({ _id: payload.userId, openid: payload.openid, deleted: 0 }).limit(1).get()
  return result.data[0] || null
}

function publicUser(user) {
  return {
    _id: user._id,
    openid: user.openid,
    nickname: user.nickname || '',
    avatar: user.avatar || '',
    auth_status: user.auth_status || 'unverified',
    status: user.status || 'normal',
    // 学籍信息（P1-03 认证写入；未认证为空串，供「我的资料」等页面展示）
    student_no: user.student_no || '',
    name: user.name || '',
    college: user.college || '',
    major: user.major || '',
  }
}

/* ============================================================
 * 学号认证与绑定（P1-03 / STU-01）
 * 规则（需求 4.1.1）：openid + 学号 + 姓名 与 whitelist 比对；
 * 命中且未被绑定 → auth_status = verified 并写入 student_no（唯一索引保证一学号一微信）；
 * 命中但已被其他微信绑定 → 引导 occupy 申诉；未命中 / 姓名不符 → 引导申诉。
 * 账号状态机（4.1.1）：auth_status 不可回退（已认证重复认证 → 1002）；
 * 组合约束「verified + normal」才能写操作，由 club.requireActiveStudent 承担账号态部分。
 * ============================================================ */
const STUDENT_NO_RE = /^[0-9A-Za-z]{4,20}$/
/** 2001 的结构化原因，供前端区分申诉类型（occupy 学号占用 / 其余为一般认证失败） */
const VERIFY_REASON = {
  NOT_FOUND: 'not_found',
  NAME_MISMATCH: 'name_mismatch',
  OCCUPIED: 'occupied',
}

/** 白名单比对：按学号取花名册记录 */
async function findWhitelist(studentNo) {
  const res = await uniCloud.database().collection('whitelist').where({ student_no: studentNo }).limit(1).get()
  return (res && res.data && res.data[0]) || null
}

/** 该学号是否已被其他用户绑定（user_id 除外） */
async function findBoundUser(studentNo, exceptUserId) {
  const res = await uniCloud
    .database()
    .collection('users')
    .where({ student_no: studentNo, deleted: 0, _id: uniCloud.database().command.neq(exceptUserId) })
    .limit(1)
    .get()
  return (res && res.data && res.data[0]) || null
}

/* ============================================================
 * 换绑 / 占用申诉（P1-05 / COM-01② + ADM-10）
 * 学生端：提交申诉 + 进度查看；审核在管理端（admin 域 /admin/appeals/*）。
 * 规则（需求 4.1.2 / 4.3.5）：同用户同时仅一条 pending（应用层校验）；
 * 新学号是否在白名单 / 是否已被他人绑定由**审核时**判定并驳回，提交时仅做格式校验。
 * ============================================================ */
const APPEAL_TYPES = { REBIND: 'rebind', OCCUPY: 'occupy' }
const APPEAL_STATUS = { PENDING: 'pending', APPROVED: 'approved', REJECTED: 'rejected' }
const APPEAL_MAX_PROOF_IMAGES = 3
const APPEAL_PROOF_MAX = 200
const APPEAL_IMAGE_URL_MAX = 512

function appeals() {
  return uniCloud.database().collection('appeals')
}

function publicAppeal(row) {
  return {
    _id: row._id,
    appeal_type: row.appeal_type,
    old_student_no: row.old_student_no || '',
    new_student_no: row.new_student_no || '',
    proof: row.proof || '',
    proof_images: row.proof_images || [],
    status: row.status,
    reject_reason: row.reject_reason || '',
    review_at: row.review_at || null,
    created_at: row.created_at || null,
  }
}

/** 该用户是否已有进行中的申诉（需求 7.3：同用户同时间仅一条 pending） */
async function findPendingAppeal(userId) {
  const res = await appeals().where({ user_id: userId, status: APPEAL_STATUS.PENDING, deleted: 0 }).limit(1).get()
  return (res.data && res.data[0]) || null
}

exports.main = async (event) => {
  const api = club.createRouter(event)

  // 健康检查（无需鉴权）
  api.get('/ping', () => club.ok({ pong: 'user', time: Date.now() }))

  // 学生 token 通道示例（P0-06 起真实使用）
  api.get('/me', club.requireAuth(club.TOKEN_TYPES.STUDENT), (ctx) => club.ok(ctx.auth))

  api.post('/login', async (ctx) => {
    const err = club.checkParams(ctx.body, {
      code: { type: 'string', required: true, maxLen: 256 },
      platform: { type: 'string', enum: ['mp-weixin', 'h5-wechat'] },
      nickname: { type: 'string', maxLen: 20 }, avatar: { type: 'string', maxLen: 2048 },
    })
    if (err) return err
    if (!ctx.body.code.trim() || Object.prototype.hasOwnProperty.call(ctx.body, 'openid')) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, '请使用微信登录授权码')
    }
    const { openid, error } = await resolveOpenid(ctx.body)
    if (error) return error
    const user = await upsertUser(openid, ctx.body || {})
    const unavailable = accountError(user)
    if (unavailable) return unavailable
    await touchActive(user._id)
    const refresh_token = club.signToken({
      type: club.TOKEN_TYPES.STUDENT, token_kind: 'refresh', userId: user._id, openid,
    }, REFRESH_TTL)
    return club.ok({ ...sessionData(user), refresh_token })
  })

  api.post('/session/refresh', async (ctx) => {
    const refreshToken = ctx.body && ctx.body.refresh_token
    const payload = club.verifyToken(refreshToken)
    if (!payload || payload.type !== club.TOKEN_TYPES.STUDENT || payload.token_kind !== 'refresh') {
      return club.fail(club.ERROR_CODE.UNAUTHORIZED, '刷新凭证无效或已过期')
    }
    const user = await findSessionUser(payload)
    const unavailable = accountError(user)
    if (unavailable) return unavailable
    await touchActive(user._id)
    return club.ok(sessionData(user))
  })

  api.get('/profile', club.requireAuth(club.TOKEN_TYPES.STUDENT), async (ctx) => {
    const user = await findSessionUser(ctx.auth)
    return accountError(user) || club.ok(publicUser(user))
  })

  // 学号认证与绑定（P1-03 / STU-01）
  // 鉴权：写操作 → requireActiveStudent（账号不存在/已软删 → 401；已禁用 → 403「仅可浏览」）
  api.post('/verify', club.requireActiveStudent(), async (ctx) => {
    const err = club.checkParams(ctx.body, {
      student_no: { type: 'string', required: true, maxLen: 20 },
      name: { type: 'string', required: true, maxLen: 20 },
    })
    if (err) return err

    const studentNo = String(ctx.body.student_no).trim()
    const inputName = String(ctx.body.name).trim()
    if (!STUDENT_NO_RE.test(studentNo)) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, '学号格式不正确（4~20 位字母或数字）')
    }

    const user = ctx.user
    if (user.auth_status === 'verified') {
      return club.fail(club.ERROR_CODE.STATUS_INVALID, '该账号已完成认证，如需更换学号请提交换绑申诉')
    }

    // 1) 白名单命中
    const matched = await findWhitelist(studentNo)
    if (!matched) {
      return club.fail(
        club.ERROR_CODE.WHITELIST_FAIL,
        '学号不在白名单内，请核对后重试或提交申诉',
        { reason: VERIFY_REASON.NOT_FOUND }
      )
    }
    // 2) 姓名一致
    if (String(matched.name || '').trim() !== inputName) {
      return club.fail(
        club.ERROR_CODE.WHITELIST_FAIL,
        '姓名与学号不匹配，请核对后重试或提交申诉',
        { reason: VERIFY_REASON.NAME_MISMATCH }
      )
    }
    // 3) 一学号一微信：命中但已被其他微信绑定
    const occupied = await findBoundUser(studentNo, user._id)
    if (occupied) {
      return club.fail(
        club.ERROR_CODE.WHITELIST_FAIL,
        '该学号已绑定其他微信，可提交学号占用申诉',
        { reason: VERIFY_REASON.OCCUPIED }
      )
    }

    // 4) 绑定：学籍字段取自白名单（不信任客户端其余入参）
    const patch = {
      student_no: studentNo,
      name: matched.name,
      college: matched.college || '',
      major: matched.major || '',
      auth_status: 'verified',
      verified_at: now(), // P2-03：认证时间（「新增用户数」数据源）
      last_active_at: now(), // P2-03：活跃打点
      updated_at: now(),
    }
    try {
      await uniCloud.database().collection('users').doc(user._id).update(patch)
    } catch (e) {
      // users.student_no 唯一索引兜底：认证瞬间被并发抢占
      return club.fail(
        club.ERROR_CODE.WHITELIST_FAIL,
        '该学号已绑定其他微信，可提交学号占用申诉',
        { reason: VERIFY_REASON.OCCUPIED }
      )
    }

    const bound = { ...user, ...patch }
    return club.ok({
      // 认证态写入 token：前端据此切到认证态（refresh_token 沿用原值）
      token: club.signToken(
        {
          type: club.TOKEN_TYPES.STUDENT,
          token_kind: 'access',
          userId: user._id,
          openid: user.openid,
          auth_status: 'verified',
        },
        ACCESS_TTL
      ),
      expires_in: ACCESS_TTL,
      user: publicUser(bound),
      authStatus: 'authenticated',
    })
  })

  // 账号注销 / 个人数据删除申请（P3-02 / 需求 8.4）
  // 站内提交 → 管理端人工处理（admin 域 /deletion-review）；通过后 users 软删 + 个人可识别字段匿名化
  api.post('/deletion-request', club.requireActiveStudent(), async (ctx) => {
    const err = club.checkParams(ctx.body, {
      reason: { type: 'string', maxLen: 200 },
    })
    if (err) return err

    const reason = String(ctx.body.reason || '').trim()
    const user = ctx.user
    const requests = uniCloud.database().collection('account_deletion_requests')
    const pendingRes = await requests.where({ user_id: user._id, status: 'pending', deleted: 0 }).limit(1).get()
    if (pendingRes.data && pendingRes.data[0]) {
      return club.fail(club.ERROR_CODE.STATUS_INVALID, '你已提交过注销申请，请等待管理员处理')
    }

    const timestamp = now()
    const added = await requests.add({
      user_id: user._id,
      reason,
      status: 'pending',
      created_at: timestamp,
      deleted: 0,
    })
    return club.ok({ _id: added.id, status: 'pending', created_at: timestamp })
  })

  // 提交换绑 / 占用申诉（P1-05 / STU-01②）
  api.post('/appeals', club.requireActiveStudent(), async (ctx) => {
    const err = club.checkParams(ctx.body, {
      appeal_type: { type: 'string', required: true, enum: [APPEAL_TYPES.REBIND, APPEAL_TYPES.OCCUPY] },
      new_student_no: { type: 'string', required: true, maxLen: 20 },
      proof: { type: 'string', maxLen: APPEAL_PROOF_MAX },
      proof_images: { type: 'array' },
    })
    if (err) return err

    const newStudentNo = String(ctx.body.new_student_no).trim()
    if (!STUDENT_NO_RE.test(newStudentNo)) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, '学号格式不正确（4~20 位字母或数字）')
    }
    const images = Array.isArray(ctx.body.proof_images) ? ctx.body.proof_images : []
    if (images.length > APPEAL_MAX_PROOF_IMAGES) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, `证明材料最多 ${APPEAL_MAX_PROOF_IMAGES} 张`)
    }
    if (!images.every((url) => typeof url === 'string' && url.length > 0 && url.length <= APPEAL_IMAGE_URL_MAX)) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, '证明材料图片地址不合法')
    }

    const user = ctx.user
    if (newStudentNo === (user.student_no || '')) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, '新学号与当前学号相同，无需申诉')
    }

    // 同用户同时仅一条进行中申诉（需求 7.3）
    const pending = await findPendingAppeal(user._id)
    if (pending) {
      return club.fail(club.ERROR_CODE.STATUS_INVALID, '已有进行中的申诉，请等待审核结果后再提交', {
        appeal: publicAppeal(pending),
      })
    }

    const record = {
      user_id: user._id,
      appeal_type: ctx.body.appeal_type,
      // occupy（学号被他人占用）无旧学号；rebind 记录当前已绑定学号
      old_student_no: ctx.body.appeal_type === APPEAL_TYPES.REBIND ? user.student_no || '' : '',
      new_student_no: newStudentNo,
      proof: String(ctx.body.proof || '').trim(),
      proof_images: images,
      status: APPEAL_STATUS.PENDING,
      reject_reason: '',
      review_by: '',
      review_at: null,
      created_at: now(),
      deleted: 0,
    }
    try {
      const added = await appeals().add(record)
      return club.ok({ appeal: publicAppeal({ _id: added.id, ...record }) })
    } catch (e) {
      return club.fail(club.ERROR_CODE.INTERNAL, '申诉提交失败，请稍后重试')
    }
  })

  // 申诉进度查看（P1-05）：进行中申诉 + 最近记录
  api.get('/appeals/current', club.requireAuth(club.TOKEN_TYPES.STUDENT), async (ctx) => {
    const user = await findSessionUser(ctx.auth)
    const unavailable = accountError(user)
    if (unavailable) return unavailable
    const res = await appeals()
      .where({ user_id: user._id, deleted: 0 })
      .orderBy('created_at', 'desc')
      .limit(5)
      .get()
    const list = (res.data || []).map(publicAppeal)
    const pending = list.find((item) => item.status === APPEAL_STATUS.PENDING) || null
    return club.ok({ list, pending })
  })

  // 图片上传（P0-07 / COM-03）
  // 通道说明：阿里云 URL 化网关由 Spring 侧自行消费 multipart 且不透传原始 body，
  // 故统一走 JSON（base64）通道：{ scene, filename, mime, base64 }
  // 鉴权：写操作使用 requireActiveStudent（P1-02）—— 被禁用用户在此被拦截（403，仅可浏览）
  api.post('/upload', club.requireActiveStudent(), async (ctx) => {
    const err = club.checkParams(ctx.body, {
      scene: { type: 'string', required: true, maxLen: 32 },
      base64: { type: 'string', required: true },
      filename: { type: 'string', maxLen: 128 },
      mime: { type: 'string', maxLen: 64 },
    })
    if (err) return err

    const sceneKey = ctx.body.scene
    const scene = UPLOAD_SCENES[sceneKey]
    if (!scene) return club.fail(club.ERROR_CODE.PARAM_INVALID, '上传场景不合法')

    const ext = club.fileExt(ctx.body.filename, ctx.body.mime)
    if (!ext || scene.accept.indexOf(ext) === -1) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, `仅支持 ${scene.accept.join(' / ')} 格式`)
    }

    let file
    try {
      file = Buffer.from(ctx.body.base64, 'base64')
    } catch (e) {
      file = null
    }
    if (!file || !file.length) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, '图片内容为空或格式不正确')
    }
    if (file.length > UPLOAD_MAX_BYTES) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, '图片体积超出上限，请更换图片后重试')
    }

    const rand = Math.random().toString(36).slice(2, 8)
    const cloudPath = `clubhub/${sceneKey}/${dateKey()}/${ctx.auth.userId}-${Date.now()}-${rand}.${ext}`
    let uploaded
    try {
      uploaded = await uniCloud.uploadFile({
        cloudPath,
        fileContent: file,
        cloudPathAsRealPath: true,
      })
    } catch (e) {
      console.error('[user] uploadFile failed', e && e.message)
      return club.fail(club.ERROR_CODE.INTERNAL, '上传失败，请稍后重试')
    }
    const url = await storageUrl(uploaded.fileID)
    if (!url) return club.fail(club.ERROR_CODE.INTERNAL, '上传成功但获取访问地址失败，请稍后重试')
    return club.ok({ fileID: uploaded.fileID, url, size: file.length, ext, scene: sceneKey })
  })

  // 参数校验演示：非法入参返回 1001（P1 业务接口照此使用 club.checkParams）
  api.post('/demo-validate', (ctx) => {
    const err = club.checkParams(ctx.body, {
      name: { type: 'string', required: true, maxLen: 20 },
      age: { type: 'int' },
    })
    if (err) return err
    return club.ok({ name: ctx.body.name, age: ctx.body.age })
  })

  return api.run()
}
