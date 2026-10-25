/**
 * 管理域云函数（P0-05 骨架 / P0-09 管理端登录与会话安全）
 *
 * URL 化前缀 /admin（网关会把该前缀剥离后透传 event.path），因此此处路由按相对路径注册：
 * 路由 '/login' ⇔ 对外 POST /admin/login
 * 管理员 token 通道：type=admin，payload 含 adminId / username / role / name
 *
 * 登录规则（需求 4.3.6）：图形验证码 → 账号 → 锁定 → 禁用 → 密码；连续失败 5 次锁定 15 分钟，到期自动解锁；
 * 验证码错误不计入失败次数。P1-01~P1-28 各管理菜单接口在此扩展。
 */
'use strict'
const crypto = require('crypto')
const club = require('./lib/club-common')
const notify = require('./lib/notify')

/** 会话有效期（需求未规定具体时长，取 2 小时；前端在 401 或到期时自动登出） */
const SESSION_TTL = 2 * 3600
/** 图形验证码有效期 */
const CAPTCHA_TTL = 2 * 60
/** 连续失败上限与锁定时长 */
const MAX_FAILED = 5
const LOCK_MS = 15 * 60 * 1000

/** 验证码字符集（去掉 0/O/1/I/Z 等易混淆字符） */
const CAPTCHA_CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXY'
const CAPTCHA_COLORS = ['#2F80ED', '#F43F5E', '#06D6A0', '#0EA5E9', '#0F172A']

/** 白名单导入（P1-01） */
const WHITELIST_MODES = { APPEND: 'append', FULL: 'full' }
const WHITELIST_MAX_ROWS = 20000
const WHITELIST_MAX_CHUNK = 1000
const STUDENT_NO_RE = /^[0-9A-Za-z]{4,20}$/

function admins() {
  return uniCloud.database().collection('admins')
}

async function findAdminByUsername(username) {
  const res = await admins().where({ username, deleted: 0 }).limit(1).get()
  return (res.data && res.data[0]) || null
}

async function findAdminById(adminId) {
  const res = await admins().where({ _id: adminId, deleted: 0 }).limit(1).get()
  return (res.data && res.data[0]) || null
}

function publicAdmin(admin) {
  return {
    _id: admin._id,
    username: admin.username,
    name: admin.name || '',
    role: admin.role,
    status: admin.status,
    last_login_at: admin.last_login_at || null,
  }
}

/* ============================================================
 * 白名单导入（P1-01 / ADM-01①）
 * Excel 由管理端在浏览器解析（URL 化网关不透传 multipart，且 JSON 请求体上限约 1.43MB），
 * 按 ≤1000 行/块提交；服务端逐行复校、跳过库内重复，成功行写 batch_no。
 * ============================================================ */
function whitelist() {
  return uniCloud.database().collection('whitelist')
}

/** 行级校验（服务端复校，不信任客户端解析结果） */
function normalizeWhitelistRow(raw) {
  const studentNo = String((raw && raw.student_no) == null ? '' : raw.student_no).trim()
  const name = String((raw && raw.name) == null ? '' : raw.name).trim()
  const college = String((raw && raw.college) == null ? '' : raw.college).trim().slice(0, 30)
  const major = String((raw && raw.major) == null ? '' : raw.major).trim().slice(0, 30)
  if (!studentNo) return { error: '学号为空' }
  if (!STUDENT_NO_RE.test(studentNo)) return { error: `学号格式不合法（${studentNo}）` }
  if (!name) return { error: '姓名为空' }
  if (name.length > 20) return { error: '姓名超长' }
  return { row: { student_no: studentNo, name, college, major } }
}

/* ============================================================
 * 用户查询与账号管理（P1-02 / ADM-01②）
 * 需求 2.2.3：按姓名 / 学号查询、禁用 / 解封、查看学号绑定状态；
 * 需求 4.4：users.status 与 auth_status 双字段正交，禁用态仅可浏览。
 * 权限：2.3 权限矩阵「用户白名单（sp, au）」→ 服务端同样校验角色（不依赖前端路由守卫）。
 * ============================================================ */
const USER_STATUS = { NORMAL: 'normal', DISABLED: 'disabled' }
const USER_PAGE_SIZE = { DEFAULT: 20, MAX: 100 }
const USER_KEYWORD_MAX = 32

/** 管理端用户管理权限：超管 / 审核员（viewer 数据查看员无此菜单） */
const OPS_GUARD = [club.requireAuth(club.TOKEN_TYPES.ADMIN), club.requireRole(['super', 'auditor'])]
/** 管理员账号管理权限：仅超管（需求 2.3 权限矩阵「管理员账号与角色管理」✔ 仅 super） */
const SUPER_GUARD = [club.requireAuth(club.TOKEN_TYPES.ADMIN), club.requireRole(['super'])]

function users() {
  return uniCloud.database().collection('users')
}

/** 管理端可见字段：openid 只回传脱敏值；学号完整返回（管理端查询需要） */
function publicUserRow(user) {
  return {
    _id: user._id,
    name: user.name || '',
    student_no: user.student_no || '',
    college: user.college || '',
    major: user.major || '',
    nickname: user.nickname || '',
    avatar: user.avatar || '',
    auth_status: user.auth_status || 'unverified',
    status: user.status || USER_STATUS.NORMAL,
    openid_masked: club.maskOpenid(user.openid),
    openid_bound: !!user.openid,
    created_at: user.created_at || null,
    updated_at: user.updated_at || null,
  }
}

async function findUserById(userId) {
  const res = await users().where({ _id: userId, deleted: 0 }).limit(1).get()
  return (res.data && res.data[0]) || null
}

/** 禁用 / 解封（幂等保护：同状态重复操作返回 1002） */
async function changeUserStatus(userId, nextStatus) {
  const user = await findUserById(userId)
  if (!user) return club.fail(club.ERROR_CODE.NOT_FOUND, '用户不存在或已注销')
  if (user.status === nextStatus) {
    return club.fail(
      club.ERROR_CODE.STATUS_INVALID,
      nextStatus === USER_STATUS.DISABLED ? '该用户已被禁用' : '该用户当前为正常状态'
    )
  }
  const updatedAt = new Date()
  await users().doc(user._id).update({ status: nextStatus, updated_at: updatedAt })
  return club.ok({ user: publicUserRow({ ...user, status: nextStatus, updated_at: updatedAt }) })
}

/* ============================================================
 * 换绑申诉审核（P1-05 / ADM-10）
 * 需求 4.3.5：待审列表 → 通过（解绑旧学号、绑定新学号，更新 users.student_no）/ 驳回（必填理由）
 *            → 结果自动通知申请人（订阅消息 + 站内消息，走 notify 引擎）。
 * 异常分支：新学号不在白名单 / 已被他人绑定 → 不通过（引导驳回并说明理由）。
 * ============================================================ */
const APPEAL_STATUS = { PENDING: 'pending', APPROVED: 'approved', REJECTED: 'rejected' }
const APPEAL_ACTION = { APPROVE: 'approve', REJECT: 'reject' }
const APPEAL_REASON_MAX = 200
const APPEAL_REASON_MIN = 2
/** 待审申诉额外标记：ok 可绑定 / not_in_whitelist 不在白名单 / occupied 已被他人绑定 */
const APPEAL_NEW_NO_STATUS = { OK: 'ok', NOT_IN_WHITELIST: 'not_in_whitelist', OCCUPIED: 'occupied' }

function appeals() {
  return uniCloud.database().collection('appeals')
}

function publicAppealRow(appeal) {
  return {
    _id: appeal._id,
    user_id: appeal.user_id,
    appeal_type: appeal.appeal_type,
    old_student_no: appeal.old_student_no || '',
    new_student_no: appeal.new_student_no || '',
    proof: appeal.proof || '',
    proof_images: appeal.proof_images || [],
    status: appeal.status,
    reject_reason: appeal.reject_reason || '',
    review_by: appeal.review_by || '',
    review_at: appeal.review_at || null,
    created_at: appeal.created_at || null,
  }
}

async function findAppealById(appealId) {
  const res = await appeals().where({ _id: appealId, deleted: 0 }).limit(1).get()
  return (res.data && res.data[0]) || null
}

async function findWhitelistRow(studentNo) {
  const res = await whitelist().where({ student_no: studentNo }).limit(1).get()
  return (res.data && res.data[0]) || null
}

/** 该学号是否已被其他人绑定 */
async function findBoundUser(studentNo, exceptUserId) {
  const cmd = uniCloud.database().command
  const res = await users()
    .where({ student_no: studentNo, deleted: 0, _id: cmd.neq(exceptUserId) })
    .limit(1)
    .get()
  return (res.data && res.data[0]) || null
}

/**
 * 批量判定待审申诉的新学号可用性（供审核页直接展示提示）
 * @returns {Promise<Map<string, string>>} student_no → APPEAL_NEW_NO_STATUS
 */
async function judgeNewStudentNos(rows) {
  const result = new Map()
  const list = rows.filter((row) => row.status === APPEAL_STATUS.PENDING && row.new_student_no)
  if (!list.length) return result
  const cmd = uniCloud.database().command
  const nos = [...new Set(list.map((row) => row.new_student_no))]

  const wlRes = await whitelist().where({ student_no: cmd.in(nos) }).field({ student_no: true }).get()
  const inWhitelist = new Set((wlRes.data || []).map((item) => item.student_no))

  const userRes = await users()
    .where({ student_no: cmd.in(nos), deleted: 0 })
    .field({ _id: true, student_no: true })
    .get()
  const ownerMap = new Map()
  for (const item of userRes.data || []) {
    if (!ownerMap.has(item.student_no)) ownerMap.set(item.student_no, [])
    ownerMap.get(item.student_no).push(item._id)
  }

  for (const row of list) {
    const no = row.new_student_no
    if (!inWhitelist.has(no)) result.set(no, APPEAL_NEW_NO_STATUS.NOT_IN_WHITELIST)
    else if ((ownerMap.get(no) || []).some((id) => id !== row.user_id)) result.set(no, APPEAL_NEW_NO_STATUS.OCCUPIED)
    else result.set(no, APPEAL_NEW_NO_STATUS.OK)
  }
  return result
}

/* ============================================================
 * 密码校验（admins.password_hash 格式：sha256$salt$sha256(salt+明文)）
 * ============================================================ */
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a))
  const bufB = Buffer.from(String(b))
  if (bufA.length !== bufB.length) return false
  return crypto.timingSafeEqual(bufA, bufB)
}

function verifyPassword(password, hash) {
  const parts = String(hash || '').split('$')
  if (parts.length !== 3 || parts[0] !== 'sha256' || !parts[1] || !parts[2]) return false
  const expect = crypto.createHash('sha256').update(parts[1] + password).digest('hex')
  return safeEqual(expect, parts[2])
}

/** 生成密码哈希（sha256$salt$sha256(salt+明文)，与 verifyPassword 配对） */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.createHash('sha256').update(salt + password).digest('hex')
  return `sha256$${salt}$${hash}`
}

/* ============================================================
 * 图形验证码（无状态：答案以「服务端密钥加盐哈希」存入签名票据，票据内不含明文答案）
 * 说明：轻量级实现，用于拦截脚本化暴力尝试；真正的防护依赖失败锁定。
 * ============================================================ */
function randomCode(length = 4) {
  let code = ''
  for (let i = 0; i < length; i += 1) {
    code += CAPTCHA_CHARS[crypto.randomInt(0, CAPTCHA_CHARS.length)]
  }
  return code
}

/** 答案哈希：加服务端密钥，避免票据被离线暴力枚举（4 位字符空间很小） */
function answerDigest(code) {
  const secret = process.env.CLUBHUB_JWT_SECRET
  if (!secret) throw new Error('CLUBHUB_JWT_SECRET is required')
  return crypto
    .createHmac('sha256', secret)
    .update(String(code).toUpperCase())
    .digest('hex')
}

function pick(list) {
  return list[crypto.randomInt(0, list.length)]
}

function captchaSvg(code) {
  const width = 132
  const height = 44
  const parts = [`<rect width="${width}" height="${height}" fill="#F8F9FF"/>`]

  // 干扰线
  for (let i = 0; i < 3; i += 1) {
    parts.push(
      `<line x1="${crypto.randomInt(0, width)}" y1="${crypto.randomInt(0, height)}" ` +
        `x2="${crypto.randomInt(0, width)}" y2="${crypto.randomInt(0, height)}" ` +
        `stroke="${pick(CAPTCHA_COLORS)}" stroke-width="1" opacity="0.45"/>`
    )
  }
  // 字符（轻微旋转错位）
  for (let i = 0; i < code.length; i += 1) {
    const x = 20 + i * 26
    const rotate = crypto.randomInt(-16, 16)
    parts.push(
      `<text x="${x}" y="31" font-size="26" font-family="monospace" font-weight="bold" ` +
        `fill="${pick(CAPTCHA_COLORS)}" transform="rotate(${rotate} ${x} 24)">${code[i]}</text>`
    )
  }
  // 噪点
  for (let i = 0; i < 18; i += 1) {
    parts.push(
      `<circle cx="${crypto.randomInt(0, width)}" cy="${crypto.randomInt(0, height)}" r="1" ` +
        `fill="${pick(CAPTCHA_COLORS)}" opacity="0.5"/>`
    )
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${parts.join('')}</svg>`
}

function issueCaptcha() {
  const code = randomCode()
  const captchaId = club.signToken(
    { type: 'captcha', h: answerDigest(code), n: crypto.randomBytes(6).toString('hex') },
    CAPTCHA_TTL
  )
  return {
    captcha_id: captchaId,
    image: `data:image/svg+xml;base64,${Buffer.from(captchaSvg(code)).toString('base64')}`,
    expires_in: CAPTCHA_TTL,
  }
}

function verifyCaptcha(captchaId, input) {
  const payload = club.verifyToken(captchaId)
  if (!payload || payload.type !== 'captcha') return false
  return safeEqual(payload.h, answerDigest(String(input || '').trim()))
}

function formatLockRemain(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return minutes > 0 ? `${minutes} 分 ${seconds} 秒` : `${seconds} 秒`
}

exports.main = async (event) => {
  const api = club.createRouter(event)

  // 健康检查（无需鉴权）
  api.get('/ping', () => club.ok({ pong: 'admin', time: Date.now() }))

  // 图形验证码（无需鉴权）
  api.get('/captcha', () => club.ok(issueCaptcha()))

  // 管理员登录（无需鉴权）
  api.post('/login', async (ctx) => {
    const err = club.checkParams(ctx.body, {
      username: { type: 'string', required: true, maxLen: 32 },
      password: { type: 'string', required: true, maxLen: 64 },
      captcha_id: { type: 'string', required: true, maxLen: 1024 },
      captcha_code: { type: 'string', required: true, maxLen: 8 },
    })
    if (err) return err

    // 1) 图形验证码：错误不计入失败次数
    if (!verifyCaptcha(ctx.body.captcha_id, ctx.body.captcha_code)) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, '验证码错误或已过期，请重新输入')
    }

    // 2) 账号
    const admin = await findAdminByUsername(ctx.body.username)
    if (!admin) {
      return club.fail(club.ERROR_CODE.UNAUTHORIZED, '账号或密码错误')
    }

    // 3) 锁定（锁定期间即使密码正确也拒绝；到期自动解锁）
    const now = Date.now()
    const lockedUntil = admin.locked_until ? new Date(admin.locked_until).getTime() : 0
    if (lockedUntil > now) {
      return club.fail(
        club.ERROR_CODE.STATUS_INVALID,
        `账号已锁定，请 ${formatLockRemain(lockedUntil - now)} 后重试`
      )
    }
    const lockExpired = lockedUntil > 0 && lockedUntil <= now
    const failedBefore = lockExpired ? 0 : Number(admin.failed_attempts || 0)
    const unlockPatch = lockExpired ? { locked_until: null } : {}

    // 4) 账号状态
    if (admin.status !== 'normal') {
      return club.fail(club.ERROR_CODE.FORBIDDEN, '账号已被禁用，请联系超级管理员')
    }

    // 5) 密码
    if (!verifyPassword(ctx.body.password, admin.password_hash)) {
      const attempts = failedBefore + 1
      if (attempts >= MAX_FAILED) {
        await admins()
          .doc(admin._id)
          .update({ ...unlockPatch, failed_attempts: MAX_FAILED, locked_until: new Date(now + LOCK_MS) })
        return club.fail(
          club.ERROR_CODE.STATUS_INVALID,
          `连续失败 ${MAX_FAILED} 次，账号已锁定 ${LOCK_MS / 60000} 分钟`
        )
      }
      await admins()
        .doc(admin._id)
        .update({ ...unlockPatch, failed_attempts: attempts })
      return club.fail(
        club.ERROR_CODE.UNAUTHORIZED,
        `账号或密码错误，还可尝试 ${MAX_FAILED - attempts} 次`
      )
    }

    // 6) 登录成功：更新最近登录、清空失败计数与锁定
    const loginAt = new Date()
    await admins()
      .doc(admin._id)
      .update({ last_login_at: loginAt, failed_attempts: 0, locked_until: null })

    const token = club.signToken(
      {
        type: club.TOKEN_TYPES.ADMIN,
        adminId: admin._id,
        username: admin.username,
        role: admin.role,
        name: admin.name || '',
      },
      SESSION_TTL
    )
    return club.ok({
      token,
      expires_in: SESSION_TTL,
      admin: { ...publicAdmin(admin), last_login_at: loginAt },
    })
  })

  // 会话校验（供前端路由守卫与超时检测）
  api.get('/session', club.requireAuth(club.TOKEN_TYPES.ADMIN), async (ctx) => {
    const admin = await findAdminById(ctx.auth.adminId)
    if (!admin) return club.fail(club.ERROR_CODE.UNAUTHORIZED, '会话已失效，请重新登录')
    if (admin.status !== 'normal') {
      return club.fail(club.ERROR_CODE.FORBIDDEN, '账号已被禁用，请联系超级管理员')
    }
    return club.ok({ admin: publicAdmin(admin), expires_at: (ctx.auth.exp || 0) * 1000 })
  })

  // 白名单导入（P1-01 / ADM-01①）：管理端解析 Excel 后按 ≤1000 行/块提交
  api.post('/whitelist/import', club.requireAuth(club.TOKEN_TYPES.ADMIN), async (ctx) => {
    const err = club.checkParams(ctx.body, {
      mode: { type: 'string', required: true, enum: [WHITELIST_MODES.APPEND, WHITELIST_MODES.FULL] },
      batch_no: { type: 'string', required: true, maxLen: 40 },
      chunk_index: { type: 'int', required: true },
      rows: { type: 'array', required: true },
    })
    if (err) return err

    const mode = ctx.body.mode
    const batchNo = ctx.body.batch_no
    const chunkIndex = ctx.body.chunk_index
    const rows = ctx.body.rows
    const chunkTotal = Number(ctx.body.chunk_total || 0)

    if (chunkIndex < 0) return club.fail(club.ERROR_CODE.PARAM_INVALID, 'chunk_index 不合法')
    if (chunkTotal > Math.ceil(WHITELIST_MAX_ROWS / WHITELIST_MAX_CHUNK)) {
      return club.fail(
        club.ERROR_CODE.PARAM_INVALID,
        `单批最多 ${WHITELIST_MAX_ROWS} 行，请拆分文件后分批导入`
      )
    }
    if (!rows.length) return club.fail(club.ERROR_CODE.PARAM_INVALID, '本块无数据')
    if (rows.length > WHITELIST_MAX_CHUNK) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, `单块最多 ${WHITELIST_MAX_CHUNK} 行`)
    }

    // 全量更新：首块先清空现有花名册。
    // 注意：只影响后续认证比对，不触碰 users.auth_status，因此不会追溯解绑已认证账号（需求 4.3.1）。
    if (mode === WHITELIST_MODES.FULL && chunkIndex === 0 && ctx.body.reset === true) {
      await whitelist().where({}).remove()
    }

    const failed = []
    const prepared = []
    for (const raw of rows) {
      const rowNo = Number((raw && raw.row_no) || 0)
      const checked = normalizeWhitelistRow(raw)
      if (checked.error) failed.push({ row_no: rowNo, reason: checked.error })
      else prepared.push({ row_no: rowNo, ...checked.row })
    }

    // 库内查重（唯一索引兜底见下方逐条插入分支）
    const existing = new Set()
    if (prepared.length) {
      const cmd = uniCloud.database().command
      const found = await whitelist()
        .where({ student_no: cmd.in(prepared.map((row) => row.student_no)) })
        .field({ student_no: true })
        .limit(WHITELIST_MAX_CHUNK)
        .get()
      for (const item of found.data || []) existing.add(item.student_no)
    }

    const skipped = []
    const seen = new Set()
    const pending = []
    for (const row of prepared) {
      if (existing.has(row.student_no)) {
        skipped.push({ row_no: row.row_no, student_no: row.student_no, reason: '库内已存在' })
        continue
      }
      if (seen.has(row.student_no)) {
        skipped.push({ row_no: row.row_no, student_no: row.student_no, reason: '同批重复' })
        continue
      }
      seen.add(row.student_no)
      pending.push(row)
    }

    const now = new Date()
    const docs = pending.map((row) => ({
      student_no: row.student_no,
      name: row.name,
      college: row.college,
      major: row.major,
      batch_no: batchNo,
      created_at: now,
    }))

    let success = 0
    if (docs.length) {
      try {
        await whitelist().add(docs)
        success = docs.length
      } catch (e) {
        // 唯一索引冲突兜底：逐条写入，冲突行计入回执
        for (let i = 0; i < docs.length; i += 1) {
          try {
            await whitelist().add(docs[i])
            success += 1
          } catch (inner) {
            skipped.push({
              row_no: pending[i].row_no,
              student_no: pending[i].student_no,
              reason: '写入冲突（可能已被并发导入）',
            })
          }
        }
      }
    }

    return club.ok({
      batch_no: batchNo,
      mode,
      chunk_index: chunkIndex,
      success,
      skipped,
      failed,
    })
  })

  // 用户查询（P1-02 / ADM-01②）：按姓名 / 学号模糊查询 + 账号态 / 认证态筛选 + 分页
  api.post('/users/query', ...OPS_GUARD, async (ctx) => {
    const err = club.checkParams(ctx.body, {
      keyword: { type: 'string', maxLen: USER_KEYWORD_MAX },
      status: { type: 'string', enum: ['all', USER_STATUS.NORMAL, USER_STATUS.DISABLED] },
      auth_status: { type: 'string', enum: ['all', 'verified', 'unverified'] },
      page: { type: 'int' },
      page_size: { type: 'int' },
    })
    if (err) return err

    const page = ctx.body.page === undefined ? 1 : Number(ctx.body.page)
    const pageSize = ctx.body.page_size === undefined ? USER_PAGE_SIZE.DEFAULT : Number(ctx.body.page_size)
    if (page < 1) return club.fail(club.ERROR_CODE.PARAM_INVALID, 'page 不合法')
    if (pageSize < 1 || pageSize > USER_PAGE_SIZE.MAX) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, `page_size 需在 1~${USER_PAGE_SIZE.MAX} 之间`)
    }

    const keyword = String(ctx.body.keyword || '').trim()
    const db = uniCloud.database()
    const cmd = db.command
    const wheres = [{ deleted: 0 }]
    if (ctx.body.status && ctx.body.status !== 'all') wheres.push({ status: ctx.body.status })
    if (ctx.body.auth_status && ctx.body.auth_status !== 'all') wheres.push({ auth_status: ctx.body.auth_status })
    if (keyword) {
      // 姓名或学号模糊匹配；入参已转义，避免正则注入（如 `.*` 命中全表）
      const pattern = new RegExp(club.escapeRegExp(keyword), 'i')
      wheres.push(cmd.or([{ name: pattern }, { student_no: pattern }]))
    }
    const where = wheres.length === 1 ? wheres[0] : cmd.and(wheres)

    const counted = await users().where(where).count()
    const total = Number((counted && counted.total) || 0)
    const found = await users()
      .where(where)
      .orderBy('created_at', 'desc')
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .get()

    return club.ok({
      list: (found.data || []).map(publicUserRow),
      total,
      page,
      page_size: pageSize,
      keyword,
    })
  })

  // 禁用用户（P1-02）：禁用后在学生端仅可浏览，写操作一律 403
  api.post('/users/disable', ...OPS_GUARD, async (ctx) => {
    const err = club.checkParams(ctx.body, { user_id: { type: 'string', required: true, maxLen: 64 } })
    if (err) return err
    return changeUserStatus(ctx.body.user_id, USER_STATUS.DISABLED)
  })

  // 解封用户（P1-02）：恢复正常后写操作立即生效
  api.post('/users/enable', ...OPS_GUARD, async (ctx) => {
    const err = club.checkParams(ctx.body, { user_id: { type: 'string', required: true, maxLen: 64 } })
    if (err) return err
    return changeUserStatus(ctx.body.user_id, USER_STATUS.NORMAL)
  })

  // 换绑申诉审核：待审 / 已审列表（P1-05 / ADM-10）
  api.post('/appeals/query', ...OPS_GUARD, async (ctx) => {
    const err = club.checkParams(ctx.body, {
      status: { type: 'string', enum: ['all', APPEAL_STATUS.PENDING, APPEAL_STATUS.APPROVED, APPEAL_STATUS.REJECTED] },
      page: { type: 'int' },
      page_size: { type: 'int' },
    })
    if (err) return err

    const page = ctx.body.page === undefined ? 1 : Number(ctx.body.page)
    const pageSize = ctx.body.page_size === undefined ? USER_PAGE_SIZE.DEFAULT : Number(ctx.body.page_size)
    if (page < 1) return club.fail(club.ERROR_CODE.PARAM_INVALID, 'page 不合法')
    if (pageSize < 1 || pageSize > USER_PAGE_SIZE.MAX) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, `page_size 需在 1~${USER_PAGE_SIZE.MAX} 之间`)
    }

    const cmd = uniCloud.database().command
    const wheres = [{ deleted: 0 }]
    if (ctx.body.status && ctx.body.status !== 'all') wheres.push({ status: ctx.body.status })
    const where = wheres.length === 1 ? wheres[0] : cmd.and(wheres)

    const counted = await appeals().where(where).count()
    const total = Number((counted && counted.total) || 0)
    const found = await appeals()
      .where(where)
      .orderBy('created_at', 'desc')
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .get()
    const rows = found.data || []

    // 申请人信息（一次批量查，避免 N+1）
    const userIds = [...new Set(rows.map((row) => row.user_id))]
    const applicantMap = new Map()
    if (userIds.length) {
      const userRes = await users().where({ _id: cmd.in(userIds) }).get()
      for (const item of userRes.data || []) applicantMap.set(item._id, item)
    }
    // 待审申诉的新学号可用性标记
    const newNoStatus = await judgeNewStudentNos(rows)

    const pendingCounted = await appeals().where({ status: APPEAL_STATUS.PENDING, deleted: 0 }).count()

    return club.ok({
      list: rows.map((row) => {
        const applicant = applicantMap.get(row.user_id) || {}
        return {
          ...publicAppealRow(row),
          applicant_name: applicant.name || applicant.nickname || '',
          applicant_nickname: applicant.nickname || '',
          applicant_auth_status: applicant.auth_status || 'unverified',
          applicant_current_no: applicant.student_no || '',
          new_student_no_status: newNoStatus.get(row.new_student_no) || '',
        }
      }),
      total,
      pending_total: Number((pendingCounted && pendingCounted.total) || 0),
      page,
      page_size: pageSize,
    })
  })

  // 换绑申诉审核：通过（解绑旧 / 绑定新）/ 驳回（必填理由）+ 自动通知（P1-05 / ADM-10）
  api.post('/appeals/review', ...OPS_GUARD, async (ctx) => {
    const err = club.checkParams(ctx.body, {
      appeal_id: { type: 'string', required: true, maxLen: 64 },
      action: { type: 'string', required: true, enum: [APPEAL_ACTION.APPROVE, APPEAL_ACTION.REJECT] },
      reason: { type: 'string', maxLen: APPEAL_REASON_MAX },
    })
    if (err) return err

    const appeal = await findAppealById(ctx.body.appeal_id.trim())
    if (!appeal) return club.fail(club.ERROR_CODE.NOT_FOUND, '申诉不存在或已删除')
    if (appeal.status !== APPEAL_STATUS.PENDING) {
      return club.fail(club.ERROR_CODE.STATUS_INVALID, '该申诉已处理，无法重复审核')
    }

    const approving = ctx.body.action === APPEAL_ACTION.APPROVE
    const reason = String(ctx.body.reason || '').trim()
    if (!approving && reason.length < APPEAL_REASON_MIN) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, `请填写驳回理由（至少 ${APPEAL_REASON_MIN} 个字）`)
    }

    const reviewedAt = new Date()
    const reviewer = ctx.auth.username

    if (approving) {
      // 审核时再校验：新学号必须在白名单内且未被他人绑定（需求 4.3.5 异常分支）
      const newNo = appeal.new_student_no
      const matched = await findWhitelistRow(newNo)
      if (!matched) {
        return club.fail(club.ERROR_CODE.PARAM_INVALID, '新学号不在白名单内，无法通过；请驳回并说明理由')
      }
      const bound = await findBoundUser(newNo, appeal.user_id)
      if (bound) {
        return club.fail(
          club.ERROR_CODE.PARAM_INVALID,
          `新学号已被其他用户绑定（${bound.name || bound.nickname || '未知用户'}），无法通过；请驳回并说明理由`
        )
      }
      const applicant = await findUserById(appeal.user_id)
      if (!applicant) return club.fail(club.ERROR_CODE.NOT_FOUND, '申请人账号不存在或已注销')

      // 解绑旧学号 = 覆盖 users.student_no；绑定新学号 + 学籍字段以白名单为准
      const patch = {
        student_no: newNo,
        name: matched.name,
        college: matched.college || '',
        major: matched.major || '',
        auth_status: 'verified',
        updated_at: reviewedAt,
      }
      try {
        await users().doc(applicant._id).update(patch)
      } catch (e) {
        // users.student_no 唯一索引兜底：审核瞬间被并发抢占
        return club.fail(club.ERROR_CODE.PARAM_INVALID, '新学号已被其他用户绑定，无法通过；请驳回并说明理由')
      }
      await appeals().doc(appeal._id).update({
        status: APPEAL_STATUS.APPROVED,
        reject_reason: '',
        review_by: reviewer,
        review_at: reviewedAt,
      })
    } else {
      await appeals().doc(appeal._id).update({
        status: APPEAL_STATUS.REJECTED,
        reject_reason: reason,
        review_by: reviewer,
        review_at: reviewedAt,
      })
    }

    const typeText = appeal.appeal_type === 'occupy' ? '学号占用申诉' : '换绑申诉'
    const resultText = approving ? '已通过' : '已驳回'
    const pushed = await notify.send({
      userId: appeal.user_id,
      scene: 'appeal_review_result',
      bizId: appeal._id,
      vars: {
        appeal_type: appeal.appeal_type,
        appeal_type_text: typeText,
        result: resultText,
        result_text: resultText,
        reason: approving ? '' : reason,
        reason_text: approving ? '新学号已绑定，请重新登录查看。' : `驳回理由：${reason}`,
      },
    })

    const updated = await findAppealById(appeal._id)
    return club.ok({ appeal: publicAppealRow(updated || appeal), notify: pushed })
  })

  /* ============================================================
   * 账号注销 / 个人数据删除管理（P3-02 / 需求 8.4）
   * 学生端提交（user 域 /deletion-request）→ 管理端人工处理；
   * 通过 = users 软删（deleted=1）+ 个人可识别字段匿名化（openid 占位唯一、学号清空、姓名昵称「已注销」）；
   * 驳回 = 附理由 + 通知申请人（场景 account_deletion_result，biz_type=deletion）。
   * 权限：OPS_GUARD（super / auditor；需求 2.3 换绑/申诉类审核通道）。
   * ============================================================ */
  const DELETION_STATUS = { PENDING: 'pending', APPROVED: 'approved', REJECTED: 'rejected' }
  const DELETION_ACTION = { APPROVE: 'approve', REJECT: 'reject' }
  const DELETION_REASON_MAX = 200

  function deletionRequests() {
    return uniCloud.database().collection('account_deletion_requests')
  }

  async function findDeletionRequestById(id) {
    const res = await deletionRequests().where({ _id: id, deleted: 0 }).limit(1).get()
    return (res.data && res.data[0]) || null
  }

  /** 注销申请行（join 申请人脱敏信息） */
  function publicDeletionRow(row, applicant) {
    return {
      _id: row._id,
      user_id: row.user_id,
      reason: row.reason || '',
      status: row.status,
      review_by: row.review_by || '',
      review_at: row.review_at || null,
      reject_reason: row.reject_reason || '',
      created_at: row.created_at || null,
      applicant_name: (applicant && (applicant.name || applicant.nickname)) || '已注销',
      applicant_nickname: (applicant && applicant.nickname) || '',
      applicant_auth_status: (applicant && applicant.auth_status) || 'unverified',
      applicant_no_masked: applicant ? club.maskStudentNo(applicant.student_no) : '',
    }
  }

  api.post('/deletion-requests/query', ...OPS_GUARD, async (ctx) => {
    const err = club.checkParams(ctx.body, {
      status: { type: 'string', enum: ['all', DELETION_STATUS.PENDING, DELETION_STATUS.APPROVED, DELETION_STATUS.REJECTED] },
      page: { type: 'int' },
      page_size: { type: 'int' },
    })
    if (err) return err

    const page = ctx.body.page === undefined ? 1 : Number(ctx.body.page)
    const pageSize = ctx.body.page_size === undefined ? USER_PAGE_SIZE.DEFAULT : Number(ctx.body.page_size)
    if (page < 1) return club.fail(club.ERROR_CODE.PARAM_INVALID, 'page 不合法')
    if (pageSize < 1 || pageSize > USER_PAGE_SIZE.MAX) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, `page_size 需在 1~${USER_PAGE_SIZE.MAX} 之间`)
    }

    const cmd = uniCloud.database().command
    const wheres = [{ deleted: 0 }]
    if (ctx.body.status && ctx.body.status !== 'all') wheres.push({ status: ctx.body.status })
    const where = wheres.length === 1 ? wheres[0] : cmd.and(wheres)

    const counted = await deletionRequests().where(where).count()
    const total = Number((counted && counted.total) || 0)
    const found = await deletionRequests()
      .where(where)
      .orderBy('created_at', 'desc')
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .get()
    const rows = found.data || []

    const userIds = [...new Set(rows.map((row) => row.user_id))]
    const applicantMap = new Map()
    if (userIds.length) {
      const userRes = await users().where({ _id: cmd.in(userIds) }).get()
      for (const item of userRes.data || []) applicantMap.set(item._id, item)
    }
    const pendingCounted = await deletionRequests().where({ status: DELETION_STATUS.PENDING, deleted: 0 }).count()

    return club.ok({
      list: rows.map((row) => publicDeletionRow(row, applicantMap.get(row.user_id))),
      total,
      pending_total: Number((pendingCounted && pendingCounted.total) || 0),
      page,
      page_size: pageSize,
    })
  })

  api.post('/deletion-requests/review', ...OPS_GUARD, async (ctx) => {
    const err = club.checkParams(ctx.body, {
      id: { type: 'string', required: true, maxLen: 64 },
      action: { type: 'string', required: true, enum: [DELETION_ACTION.APPROVE, DELETION_ACTION.REJECT] },
      reason: { type: 'string', maxLen: DELETION_REASON_MAX },
    })
    if (err) return err

    const request = await findDeletionRequestById(ctx.body.id.trim())
    if (!request) return club.fail(club.ERROR_CODE.NOT_FOUND, '注销申请不存在或已删除')
    if (request.status !== DELETION_STATUS.PENDING) {
      return club.fail(club.ERROR_CODE.STATUS_INVALID, '该申请已处理，无法重复审核')
    }

    const approving = ctx.body.action === DELETION_ACTION.APPROVE
    const reason = String(ctx.body.reason || '').trim()
    if (!approving && !reason) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, '请填写驳回理由')
    }

    const reviewedAt = new Date()
    const reviewer = ctx.auth.username

    if (approving) {
      // 软删 + 匿名化：个人可识别字段清空/占位，关联业务记录保留供审计（需求 8.4「个人数据删除」）
      // student_no 不用 null：users.student_no 有唯一索引，null 值仅允许一条（缺失字段按 null 建索引），
      // 集合内已存在无学号文档时置 null 会触发重复键 → 云端 500；改用唯一占位同时释放真实学号。
      const patch = {
        deleted: 1,
        openid: `deleted-${request.user_id}`,
        student_no: `deleted-${request.user_id}`,
        name: '已注销',
        nickname: '已注销',
        avatar: '',
        auth_status: 'unverified',
        last_active_at: null,
        updated_at: reviewedAt,
      }
      try {
        await users().doc(request.user_id).update(patch)
      } catch (e) {
        // users 唯一索引兜底（对齐 appeals 审核先例）：并发/占位冲突时明确报错而非 500
        return club.fail(club.ERROR_CODE.PARAM_INVALID, '注销处理失败，请稍后重试或联系管理员')
      }
      await deletionRequests().doc(request._id).update({
        status: DELETION_STATUS.APPROVED,
        reject_reason: '',
        review_by: reviewer,
        review_at: reviewedAt,
      })
    } else {
      await deletionRequests().doc(request._id).update({
        status: DELETION_STATUS.REJECTED,
        reject_reason: reason,
        review_by: reviewer,
        review_at: reviewedAt,
      })
    }

    const resultText = approving ? '已通过' : '未通过'
    const pushed = await notify.send({
      userId: request.user_id,
      scene: 'account_deletion_result',
      bizId: request._id,
      vars: {
        result: resultText,
        result_text: resultText,
        reason_text: approving ? '你的账号已注销，相关个人数据已完成匿名化处理。' : `驳回理由：${reason}`,
      },
    })

    return club.ok({
      status: approving ? DELETION_STATUS.APPROVED : DELETION_STATUS.REJECTED,
      review_by: reviewer,
      review_at: reviewedAt,
      notify: pushed,
    })
  })

  /* ============================================================
   * 管理员账号与权限（P1-27 / ADM-08②）
   * 需求 2.3 权限矩阵：「管理员账号与角色管理」仅 super；auditor / viewer 一律 403。
   * - 超管：创建账号（账号/密码/角色/姓名）、禁用/启用、重置密码、列表查询；
   * - 任意管理员：自助修改密码（需校验旧密码）。
   * ============================================================ */
  const ADMIN_ROLES = ['super', 'auditor', 'viewer']
  const ADMIN_STATUS = { NORMAL: 'normal', DISABLED: 'disabled' }
  const ADMIN_USERNAME_RE = /^[A-Za-z][A-Za-z0-9_]{2,31}$/
  const ADMIN_PASSWORD_MIN = 6
  const ADMIN_PASSWORD_MAX = 64
  const ADMIN_NAME_MAX = 20

  // 管理员列表（分页 + 关键词 username/name + 状态筛选；按创建时间倒序）
  api.post('/admins/query', ...SUPER_GUARD, async (ctx) => {
    const err = club.checkParams(ctx.body, {
      keyword: { type: 'string', maxLen: 32 },
      status: { type: 'string', enum: ['all', ADMIN_STATUS.NORMAL, ADMIN_STATUS.DISABLED] },
      page: { type: 'int' },
      page_size: { type: 'int' },
    })
    if (err) return err
    const page = ctx.body.page === undefined ? 1 : Number(ctx.body.page)
    const pageSize = ctx.body.page_size === undefined ? 20 : Number(ctx.body.page_size)
    if (!Number.isInteger(page) || page < 1) return club.fail(club.ERROR_CODE.PARAM_INVALID, 'page 不合法')
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, 'page_size 需在 1~100 之间')
    }

    const keyword = String((ctx.body.keyword || '')).trim()
    const db = uniCloud.database()
    const cmd = db.command
    const wheres = [{ deleted: 0 }]
    if (ctx.body.status && ctx.body.status !== 'all') wheres.push({ status: ctx.body.status })
    if (keyword) {
      const re = new RegExp(club.escapeRegExp(keyword), 'i')
      wheres.push(cmd.or([{ username: re }, { name: re }]))
    }
    const where = wheres.length === 1 ? wheres[0] : cmd.and(wheres)

    const totalRes = await admins().where(where).count()
    const total = totalRes.total || 0
    const listRes = await admins()
      .where(where)
      .orderBy('created_at', 'desc')
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .get()
    return club.ok({
      list: (listRes.data || []).map(publicAdmin),
      total,
      page,
      page_size: pageSize,
      has_more: page * pageSize < total,
    })
  })

  // 创建账号（超管）：username 唯一；初始 status = normal
  api.post('/admins/create', ...SUPER_GUARD, async (ctx) => {
    const err = club.checkParams(ctx.body, {
      username: { type: 'string', required: true, maxLen: 32 },
      password: { type: 'string', required: true, maxLen: ADMIN_PASSWORD_MAX },
      role: { type: 'string', required: true, enum: ADMIN_ROLES },
      name: { type: 'string', maxLen: ADMIN_NAME_MAX },
    })
    if (err) return err

    const username = String(ctx.body.username).trim()
    if (!ADMIN_USERNAME_RE.test(username)) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, '账号需以字母开头，3~32 位字母 / 数字 / 下划线')
    }
    const password = String(ctx.body.password)
    if (password.length < ADMIN_PASSWORD_MIN) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, `密码至少 ${ADMIN_PASSWORD_MIN} 位`)
    }
    const name = String((ctx.body.name || '')).trim().slice(0, ADMIN_NAME_MAX)

    const existed = await findAdminByUsername(username)
    if (existed) return club.fail(club.ERROR_CODE.PARAM_INVALID, '该账号已存在')

    const now = new Date()
    try {
      const added = await admins().add({
        username,
        password_hash: hashPassword(password),
        role: ctx.body.role,
        name,
        status: ADMIN_STATUS.NORMAL,
        last_login_at: null,
        failed_attempts: 0,
        locked_until: null,
        created_at: now,
        deleted: 0,
      })
      const row = { _id: added.id, username, role: ctx.body.role, name, status: ADMIN_STATUS.NORMAL, last_login_at: null, created_at: now }
      return club.ok({ admin: publicAdmin(row) })
    } catch (e) {
      // username 唯一索引兜底并发
      return club.fail(club.ERROR_CODE.PARAM_INVALID, '该账号已存在')
    }
  })

  // 禁用 / 启用（超管）：禁止禁用自己（防止锁死）；同状态幂等 1002
  api.post('/admins/status', ...SUPER_GUARD, async (ctx) => {
    const err = club.checkParams(ctx.body, {
      admin_id: { type: 'string', required: true, maxLen: 64 },
      action: { type: 'string', required: true, enum: ['disable', 'enable'] },
    })
    if (err) return err
    if (ctx.body.admin_id === ctx.auth.adminId) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, '不能禁用当前登录账号')
    }
    const target = await findAdminById(ctx.body.admin_id)
    if (!target) return club.fail(club.ERROR_CODE.NOT_FOUND, '管理员不存在或已删除')
    const disabling = ctx.body.action === 'disable'
    if (target.status === (disabling ? ADMIN_STATUS.DISABLED : ADMIN_STATUS.NORMAL)) {
      return club.fail(
        club.ERROR_CODE.STATUS_INVALID,
        disabling ? '该账号已禁用' : '该账号当前为正常状态'
      )
    }
    await admins().doc(target._id).update({
      status: disabling ? ADMIN_STATUS.DISABLED : ADMIN_STATUS.NORMAL,
      locked_until: disabling ? null : target.locked_until,
    })
    return club.ok({ admin: publicAdmin({ ...target, status: disabling ? ADMIN_STATUS.DISABLED : ADMIN_STATUS.NORMAL }) })
  })

  // 重置密码（超管）：对任意账号（含自己）重置为新密码，并清锁定/失败计数
  api.post('/admins/reset-password', ...SUPER_GUARD, async (ctx) => {
    const err = club.checkParams(ctx.body, {
      admin_id: { type: 'string', required: true, maxLen: 64 },
      new_password: { type: 'string', required: true, maxLen: ADMIN_PASSWORD_MAX },
    })
    if (err) return err
    const newPassword = String(ctx.body.new_password)
    if (newPassword.length < ADMIN_PASSWORD_MIN) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, `新密码至少 ${ADMIN_PASSWORD_MIN} 位`)
    }
    const target = await findAdminById(ctx.body.admin_id)
    if (!target) return club.fail(club.ERROR_CODE.NOT_FOUND, '管理员不存在或已删除')
    await admins().doc(target._id).update({
      password_hash: hashPassword(newPassword),
      failed_attempts: 0,
      locked_until: null,
    })
    return club.ok({ admin: publicAdmin(target), reset: true })
  })

  // 自助修改密码（任意管理员）：需校验旧密码
  api.post('/admins/change-password', club.requireAuth(club.TOKEN_TYPES.ADMIN), async (ctx) => {
    const err = club.checkParams(ctx.body, {
      old_password: { type: 'string', required: true, maxLen: ADMIN_PASSWORD_MAX },
      new_password: { type: 'string', required: true, maxLen: ADMIN_PASSWORD_MAX },
    })
    if (err) return err
    const oldPassword = String(ctx.body.old_password)
    const newPassword = String(ctx.body.new_password)
    if (newPassword.length < ADMIN_PASSWORD_MIN) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, `新密码至少 ${ADMIN_PASSWORD_MIN} 位`)
    }
    const self = await findAdminById(ctx.auth.adminId)
    if (!self) return club.fail(club.ERROR_CODE.UNAUTHORIZED, '会话已失效，请重新登录')
    if (!verifyPassword(oldPassword, self.password_hash)) {
      return club.fail(club.ERROR_CODE.PARAM_INVALID, '原密码不正确')
    }
    await admins().doc(self._id).update({
      password_hash: hashPassword(newPassword),
      failed_attempts: 0,
      locked_until: null,
    })
    return club.ok({ admin: publicAdmin(self), changed: true })
  })

  // 管理通道受保护接口示例（学生 token 调本接口会被 403 拦截：channel 不匹配）
  api.get('/dashboard-example', club.requireAuth(club.TOKEN_TYPES.ADMIN), (ctx) =>
    club.ok({ channel: 'admin', auth: ctx.auth })
  )

  return api.run()
}
