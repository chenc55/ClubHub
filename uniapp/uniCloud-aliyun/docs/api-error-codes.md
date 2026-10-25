# 统一错误码文档（API Error Codes）

> 权威版本：`cloudfunctions/common/club-common/index.js` 的 `ERROR_CODE`（P0-05 落地，P0-06 扩展鉴权语义）。
> 前端统一处理：[uniapp/src/utils/config.js](../../src/utils/config.js) 的 `ERROR_CODE`（与本表对齐）。
> 约定：`code=0` 为成功；HTTP 层错误码（400/401/403/404/500）同步携带对应 HTTP 状态码；业务码（1001+）HTTP 状态恒为 200，客户端以 `code` 为准。

## 错误码表

| code | 常量 | HTTP | 含义 | 前端处理 |
| --- | --- | --- | --- | --- |
| 0 | SUCCESS | 200 | 成功 | 正常取 data |
| 400 | BAD_REQUEST | 400 | 请求格式错误（body 非 JSON 等） | toast「请求格式错误」 |
| 401 | UNAUTHORIZED | 401 | 未认证：token 缺失/无效/过期 | 清登录态 → 跳登录页 |
| 403 | FORBIDDEN | 403 | 已认证但无权限（含学生 token 调管理域） | toast「暂无权限执行该操作」 |
| 404 | NOT_FOUND | 404 | 资源不存在 / 路由未注册 | toast「资源不存在」 |
| 500 | INTERNAL | 500 | 服务器内部错误 | toast「服务内部错误」 |
| 1001 | PARAM_INVALID | 200 | 参数缺失或非法 | toast 具体 message（含字段名） |
| 1002 | STATUS_INVALID | 200 | 业务状态不允许（状态机冲突，如已截止后报名） | toast 具体 message |
| 2001 | WHITELIST_FAIL | 200 | 白名单校验失败（学号认证） | 认证页提示 + 申诉入口 |

> 前端网络层错误（请求未到达服务端）由客户端本地生成：`code = -1`（NETWORK），HTTP 语义无对应。

### 401 / 403 的细分 message（同一 code 对应多种场景）

| code | message | 触发场景 |
| --- | --- | --- |
| 401 | 未登录或登录已过期 | 未携带 token / 签名不匹配 / `exp` 已过期 |
| 401 | 请使用有效的访问凭证 | 学生通道拿到 `token_kind !== 'access'` 的 token（如用 refresh token 冒充） |
| 401 | 账号不可用，请重新登录 | token 合法但 `users` 记录不存在或 `deleted !== 0` |
| 401 | 刷新凭证无效或已过期 | `POST /user/session/refresh` 的 `refresh_token` 非法/过期/类型不符 |
| 401 | 微信登录凭证无效，请重新登录 | `POST /user/login` 的 `code` 换取 openid 失败 |
| 403 | token 通道不匹配 | 学生 token 调 `/admin/*`，或管理员 token 调学生通道接口 |
| 403 | 账号已被禁用 | token 合法但 `users.status !== 'normal'`（P0-06 登录/刷新时，及 `/user/profile`） |
| 403 | 账号已被禁用，仅可浏览，请联系管理员处理 | 学生**写操作**（`club.requireActiveStudent`，P1-02）：报名 / 签到 / 招新 / 上传等被拦截 |
| 403 | 当前角色无权执行该操作 | 管理通道角色越权（`club.requireRole`，如 `viewer` 调用户管理接口） |
| 404 | 用户不存在或已注销 | `POST /admin/users/disable` / `/admin/users/enable` 的目标不存在或 `deleted = 1` |
| 1002 | 该用户已被禁用 | 对已 `disabled` 的用户重复禁用（幂等保护） |
| 1002 | 该用户当前为正常状态 | 对 `normal` 的用户重复解封（幂等保护） |
| 401 | 账号或密码错误（还可尝试 N 次） | 管理端登录密码错误且未达锁定阈值（计数 +1） |
| 401 | 账号或密码错误 | 管理端登录账号不存在（无对应记录，不计数） |
| 403 | 账号已被禁用，请联系超级管理员 | 管理端登录 `admins.status = disabled` |
| 1001 | 验证码错误或已过期，请重新输入 | 管理端图形验证码不对或票据过期（**不计失败次数**） |
| 1002 | 连续失败 5 次，账号已锁定 15 分钟 | 触发锁定的那一次登录 |
| 1002 | 账号已锁定，请 X 分 Y 秒后重试 | 锁定期间登录（即使密码正确也拒绝，到期自动解锁） |

## 统一响应结构

```json
{ "code": 0, "message": "ok", "data": { } }
```

- 成功：`code=0`，`data` 为业务数据（无数据时 `null`）
- 失败：`code` 为上表错误码，`data` 恒 `null`，`message` 面向用户可展示

## 双通道 Token（JWT）

- 算法：HS256，密钥取环境变量 `CLUBHUB_JWT_SECRET`。
  - **云端不提供默认值**：未配置该环境变量时，`club-common` 会拒绝签发与校验（属刻意「失败即暴露」设计）。6 个域云函数都需单独配置（详见 `../README.md` 第七节）。
  - 本地离线脚本（无 `uniCloud` 全局对象）仍走开发密钥 `clubhub-dev-secret-2026`，便于 `scripts/test-p0-0x.js` 无网络运行。
- 分类字段：`type`（`student` / `admin`）+ `token_kind`（`access` / `refresh`）。
  - 学生通道：`type="student"`，`token_kind="access"`，payload 含 `userId`、`openid`、`auth_status`（P0-06 登录签发）
  - 管理通道：`type="admin"`，payload 含 `adminId`、`role`（super/auditor/viewer）（P0-09 登录签发）
  - 学生通道的受保护接口**只接受 `token_kind="access"`**；refresh token 调业务接口 → 401「请使用有效的访问凭证」
- 有效期：access token **2 小时**（`/user/login` 返回 `expires_in=7200`）；refresh token **30 天**
- 通道隔离：学生 token 访问 `/admin/*` 受保护接口 → 403；反之亦然
- 刷新：`POST /user/session/refresh` 用 `refresh_token` 换新 access token（前端 `src/utils/request.js` 在收到 401 时自动调用并重试，含并发去重与账号切换保护）
- 联调签发：学生端 `/user/demo-login` 已在 P0-06 移除、管理端 `/admin/demo-login` 已在 P0-09 移除（均改为真实登录）


## 路由与鉴权矩阵

> **线上地址**：`https://YOUR-SPACE.example.invalid`（前端 `uniapp/src/utils/config.js` 的 `API_BASE`）
> **前缀规则**：每个域云函数的「URL 化 PATH」分别为 `/user`、`/club`、`/activity`、`/recruitment`、`/message`、`/admin`；网关会**剥离该前缀**后透传 `event.path`，因此云函数内路由按**相对路径**注册（`/ping` ⇔ 对外 `GET /user/ping`）。

| 域 | 对外前缀 | 公开接口 | 学生通道 | 管理通道 |
| --- | --- | --- | --- | --- |
| user | /user | GET /user/ping、POST /user/login、POST /user/session/refresh | 读：GET /user/me、GET /user/profile、GET /user/appeals/current；写：POST /user/upload、POST /user/verify、POST /user/appeals（均需账号 `normal`） | — |
| club | /club | GET /club/ping、GET /club/categories | GET /club/me-example；写：POST /club/apply（需账号 `normal`）、GET /club/apply/current | POST /club/query、POST /club/review、POST /club/import（均 super/auditor） |
| activity | /activity | GET /activity/ping | GET /activity/me-example | — |
| recruitment | /recruitment | GET /recruitment/ping | GET /recruitment/me-example | — |
| message | /message | GET /message/ping | GET /message/me-example | GET /message/scenes（super/auditor）、POST /message/test-send（super）、POST /message/logs（super） |
| admin | /admin | GET /admin/ping、GET /admin/captcha、POST /admin/login | — | GET /admin/session、GET /admin/dashboard-example、POST /admin/whitelist/import、POST /admin/users/query、POST /admin/users/disable、POST /admin/users/enable、POST /admin/appeals/query、POST /admin/appeals/review |

> **学生端鉴权分档（P1-02 起）**
> - **读接口** → `club.requireAuth('student')`：只校验 token，禁用用户仍可浏览（需求「仅可浏览」）。
> - **写接口** → `club.requireActiveStudent()`：token + 实时回查 `users`（存在且 `status = normal`），否则 403「账号已被禁用，仅可浏览，请联系管理员处理」。后续报名 / 签到 / 招新 / 动态等写接口一律沿用。
> - **管理接口** → `club.requireAuth('admin')` + `club.requireRole([...])`：角色越权 403（服务端独立校验，不依赖前端路由守卫）。

### 用户域接口明细（P0-06）

| 接口 | 鉴权 | 入参 | 返回 |
| --- | --- | --- | --- |
| `POST /user/login` | 公开 | `code`（必填，微信登录码）、`platform`（`mp-weixin` / `h5-wechat`）、`nickname`、`avatar` | `token`、`refresh_token`、`expires_in`、`user`、`authStatus` |
| `POST /user/session/refresh` | 公开（凭 refresh_token） | `refresh_token` | 同 login（不含 `refresh_token`，沿用原值） |
| `GET /user/me` | 学生通道 | — | 当前 token 的 payload（`type`/`userId`/`openid`/`auth_status`） |
| `GET /user/profile` | 学生通道 | — | 按 `userId + openid` 回查 `users` 的公开字段 |
| `POST /user/upload` | 学生通道（写，需账号 `normal`） | `scene`、`base64`、`filename`、`mime` | `{ fileID, url, size, ext, scene }` |
| `POST /user/verify` | 学生通道（写，需账号 `normal`） | `student_no`（4~20 位字母/数字）、`name`（与花名册一致的实名） | 成功：`token`（换发，`auth_status=verified`）、`expires_in`、`user`（含学籍字段）、`authStatus='authenticated'` |

- **上传通道（P0-07）**：走 JSON + base64（阿里云 URL 化网关由 Spring 侧自行消费 multipart 且不透传原始 body，`uni.uploadFile` 不可用）。压缩后单张上限 950KB（网关 JSON 请求体上限实测约 1.43MB，base64 膨胀 33%），详见 `../README.md` 第 8 节。
- `scene` 取值与规格见《功能需求.md》2.6（`moments` / `activity_cover` / `club_logo` / `club_cover` / `announcement_banner` / `appeal_proof`）；超限（场景/格式/体积）统一 1001，前端在选图阶段即拦截、不发起上传。
- `POST /user/login` 会校验 `platform` 枚举，并**拒绝客户端直传 `openid`**（仅接受微信授权码换取），违者 1001。
- 微信换取 openid 依赖环境变量 `WX_APPID` / `WX_SECRET`（小程序）与 `H5_WECHAT_APPID` / `H5_WECHAT_SECRET`（H5 微信内）；未配置时返回 500「登录暂不可用，请稍后重试」。
- 首登按 `users.openid` 唯一索引创建记录（`auth_status='unverified'`），并发首登由唯一索引兜底后转为更新。

#### 学号认证明细（P1-03 / STU-01）

`POST /user/verify` 用 `openid + 学号 + 姓名` 与 `whitelist` 比对（需求 4.1.1），成功即绑定并**换发 access token**（payload 带 `auth_status='verified'`），前端据此从游客态切到认证态。

| 场景 | code | message | data |
| --- | --- | --- | --- |
| 认证成功 | 0 | ok | `token` / `expires_in` / `user`（含 `student_no`·`name`·`college`·`major`）/ `authStatus='authenticated'` |
| 学号不在白名单 | 2001 | 学号不在白名单内，请核对后重试或提交申诉 | `{ reason: 'not_found' }` |
| 姓名与学号不符 | 2001 | 姓名与学号不匹配，请核对后重试或提交申诉 | `{ reason: 'name_mismatch' }` |
| 学号已被其他微信绑定（含唯一索引并发兜底） | 2001 | 该学号已绑定其他微信，可提交学号占用申诉 | `{ reason: 'occupied' }` |
| 已认证账号重复认证 | 1002 | 该账号已完成认证，如需更换学号请提交换绑申诉 | — |
| 学号格式非法 | 1001 | 学号格式不正确（4~20 位字母或数字） | — |
| 账号被禁用 / 已注销 | 403 / 401 | 账号已被禁用，仅可浏览… / 账号不可用，请重新登录 | — |

- `data.reason` 让前端精准选择申诉类型：`occupied` → `appeal_type = occupy`；其余 → `rebind`（需求 4.1.1 / 4.1.2）。
- 学籍字段取自 `whitelist` 记录，**不信任客户端多余入参**；`users.student_no` 唯一索引保证「一微信一学号」。
- 认证态不可回退（`unverified → verified` 单向），换绑必须走申诉（P1-05）。

### 管理域接口明细（P0-09）

| 接口 | 鉴权 | 入参 | 返回 |
| --- | --- | --- | --- |
| `GET /admin/captcha` | 公开 | — | `captcha_id`（无状态签名票据，2 分钟有效）、`image`（SVG data URL）、`expires_in` |
| `POST /admin/login` | 公开 | `username`、`password`、`captcha_id`、`captcha_code` | `token`、`expires_in`（7200）、`admin` |
| `GET /admin/session` | 管理通道 | — | `admin`、`expires_at`（供前端超时判断） |
| `POST /admin/whitelist/import` | 管理通道 | `mode`（`append`/`full`）、`batch_no`、`chunk_index`、`chunk_total`、`reset`（全量首块传 true）、`rows[{row_no,student_no,name,college,major}]` | `batch_no`、`mode`、`chunk_index`、`success`、`skipped[{row_no,student_no,reason}]`、`failed[{row_no,reason}]` |

- 白名单导入为**分块提交**（≤1000 行/块，单批 ≤20000 行）：Excel 由管理端浏览器解析，服务端逐行复校并跳过库内重复；`row_no` 为 Excel 行号，回执可直接对应到原文件。超限与非法参数统一 1001（含「请拆分文件后分批导入」等明确提示）。

### 管理域接口明细（P1-02 · ADM-01②）

| 接口 | 鉴权 | 入参 | 返回 |
| --- | --- | --- | --- |
| `POST /admin/users/query` | 管理通道 + `super`/`auditor` | `keyword`（姓名 / 学号模糊，≤32）、`status`（`all`/`normal`/`disabled`）、`auth_status`（`all`/`verified`/`unverified`）、`page`（≥1）、`page_size`（1~100，默认 20） | `list[]{_id,name,student_no,college,major,nickname,avatar,auth_status,status,openid_masked,openid_bound,created_at,updated_at}`、`total`、`page`、`page_size`、`keyword` |
| `POST /admin/users/disable` | 管理通道 + `super`/`auditor` | `user_id` | `{ user }`（最新状态） |
| `POST /admin/users/enable` | 管理通道 + `super`/`auditor` | `user_id` | `{ user }`（最新状态） |

- 查询语句为 `command.and([{deleted:0}, 筛选…, command.or([{name:re},{student_no:re}])])`，按 `created_at` 倒序；模糊入参经 `club.escapeRegExp` 转义后构 `RegExp(…, 'i')`，**输入 `.*` 不会命中全表**。
- 脱敏口径：仅回传 `openid_masked`（前 4 + `***` + 后 4）与 `openid_bound`，不回传原始 `openid`；学号完整返回（管理端查询需要）。
- 状态机：`users.status: normal ⇄ disabled`，变更同时写 `updated_at`；重复操作 1002、目标不存在/已软删 404；禁用对已签发 access token 的写操作**立即生效**（`requireActiveStudent` 实时回查）。

- 登录校验顺序（4.3.6）：**图形验证码 → 账号 → 锁定 → 禁用 → 密码**；连续失败 5 次锁定 15 分钟，锁定期间即使密码正确也拒绝，到期自动解锁并清零计数；登录成功写 `last_login_at` 并清零计数。
- 验证码票据内**不含明文答案**（仅存「服务端密钥加盐哈希」），避免票据被解码/离线枚举；但 SVG 图像本身为文本渲染，属轻量级实现 —— 真正的防护依赖失败锁定，上线前如需更强图形验证码可替换为位图或行为验证。
- 会话有效期 2 小时（需求未规定具体时长）；`admin/src/utils/request.js` 收到 401 会清会话并跳登录页，路由守卫另按 `expires_at` 本地判断（超时跳登录页并提示「登录已过期」）。

## 通知域接口明细（P1-04 · COM-02）

引擎主体是公共模块 `common/notify`（各业务云函数内联调用，非 HTTP 接口）；本域只暴露运维自检接口，走管理通道。

| 接口 | 鉴权 | 入参 | 返回 |
| --- | --- | --- | --- |
| `GET /message/scenes` | 管理通道 + `super`/`auditor` | — | `scenes[]{scene,type,biz_type,template_env,template_configured}`、`moments`（四个订阅时机 → 模板环境变量）、`push_status` 取值表 |
| `POST /message/test-send` | 管理通道 + `super` | `user_id`、`scene`、`biz_id`、`vars`（文案与模板变量） | `{ duplicate, message_id, scene, channel, pushed, push_status, reason }` |
| `POST /message/logs` | 管理通道 + `super` | `user_id`、`limit`（1~50，默认 20） | `list[]{_id,type,scene,title,content,biz_type,biz_id,push_status,push_error,pushed_at,is_read,created_at}` |

- `notify.send()` **不抛错**：任何推送异常都降级为仅站内消息（`push_status = site_only / skipped / failed`），站内消息一定写入并返回 `message_id`；只有「场景不存在」这种调用方错误才抛错。
- 去重：`(user_id, scene, biz_id)` 命中即返回 `duplicate: true`（不新增记录、不重复推送），并由 `messages` 复合唯一索引兜住并发。
- 降级原因码（`reason`）：`template_missing` / `wechat_credential_missing` / `openid_missing` / `duplicate`；微信侧错误记在 `push_error`（如 `43101:user refuse to accept the msg`）。
- 参数校验：未知场景与缺参 → `1001`；接收人不存在或已注销 → `404`；角色不符（如 `viewer` 调 `/test-send`）→ `403`。

## 社团接口明细（P1-06 · 4.2.1 + ADM-02①）

入驻双轨：线上申请（学生端 club 域）+ 管理员批量导入（同一域的管理接口）。

| 接口 | 鉴权 | 入参 | 返回 |
| --- | --- | --- | --- |
| `GET /club/categories` | 公开 | — | `list[]{_id,name,sort}`（8 类种子，按 sort 升序） |
| `POST /club/apply` | 学生写通道 | `name`（2~30）、`intro`（≤500）、`category_id`、`contact`（≤50） | `{ club, resubmitted }`（`resubmitted=true` 表示驳回后重提、复用原记录） |
| `GET /club/apply/current` | 学生通道（读） | — | `{ list（最近 5 条）, pending, approved }` |
| `POST /club/query` | 管理通道 + `super`/`auditor` | `status`（`all`/`pending`/`normal`/`rejected`/`banned`）、`page`、`page_size`（1~100） | `list[]{…club, category_name, applicant_name}`, `total`, `pending_total`, `page`, `page_size` |
| `POST /club/review` | 管理通道 + `super`/`auditor` | `club_id`、`action`（`approve`/`reject`）、`reason`（驳回必填 ≥2 字 ≤200） | `{ club, member_created, notify }` |
| `POST /club/import` | 管理通道 + `super`/`auditor` | `batch_no`、`chunk_index`、`chunk_total`、`rows[{row_no,name,intro,category,contact}]`（`category` 用分类**名**，服务端解析） | `{ batch_no, chunk_index, success, skipped[{row_no,name,reason}], failed[{row_no,name,reason}] }` |

- **申请约束**：名称重复（与他人或库内已通过社团同名）→ `1001`；同一用户已有 `pending` → `1002` 并回传该社团；`pending → rejected → pending` 的重提**复用原记录**（ID 稳定，`review_*` 与 `reject_reason` 清空）。
- **审核通过**：`pending → normal`，若为线上申请（`create_type=applied` 且有 `applicant_id`）则创建/复活 `club_members`（`role=president`、`status=active`）；导入社团（`imported`）无申请人，不建成员也不发通知。
- **审核驳回**：`reason` 必填 → 写 `reject_reason` 与 `review_by` / `review_at`，并通知申请人。
- **通知**：`club_apply_approved` / `club_apply_rejected` 两个场景（共用模板变量 `WX_TPL_CLUB_APPLY`，`biz_type=club`）—— 拆成两个场景是为了让「驳回 → 重提 → 通过」的第二条通知不被去重键 `(user_id, scene, biz_id)` 拦掉。
- **导入**：`create_type=imported`、`status=normal`（无需审核）、`star_level=0`（未评定，P1-07 评定）；分类名不存在 / 名称为空 / 超长 / 同批重复 / 库内重复分别记入 `failed` 或 `skipped`；`clubs.name` 唯一索引冲突时降级逐条写入并把冲突行计入回执。单批 ≤2000 行、单块 ≤500 行。

## 申诉接口明细（P1-05 · COM-01② + ADM-10）

申诉能力按既有业务域划分：**学生端在 user 域、审核在 admin 域**（不新增云函数域，见 AGENTS.md 二·云函数按业务域拆分）。

| 接口 | 鉴权 | 入参 | 返回 |
| --- | --- | --- | --- |
| `POST /user/appeals` | 学生写通道 | `appeal_type`（`rebind`/`occupy`）、`new_student_no`（4~20 位字母/数字）、`proof`（说明，≤200）、`proof_images`（≤3 张 URL） | `{ appeal }` |
| `GET /user/appeals/current` | 学生通道（读，禁用用户也可查看进度） | — | `{ list（最近 5 条）, pending（进行中申诉或 null） }` |
| `POST /admin/appeals/query` | 管理通道 + `super`/`auditor` | `status`（`all`/`pending`/`approved`/`rejected`）、`page`、`page_size`（1~100） | `list[]{…appeal, applicant_name, applicant_nickname, applicant_auth_status, applicant_current_no, new_student_no_status}`、`total`、`pending_total`、`page`、`page_size` |
| `POST /admin/appeals/review` | 管理通道 + `super`/`auditor` | `appeal_id`、`action`（`approve`/`reject`）、`reason`（驳回必填，≥2 字且 ≤200） | `{ appeal, notify }`（notify 为通知引擎回执） |

- **提交约束**：同用户同时仅一条 `pending`（应用层校验，命中返回 `1002` 并回传该进行中申诉）；新学号格式非法 / 与当前学号相同 / 证明图超 3 张 → `1001`；禁用账号 → `403`（学生写通道）。
- **`new_student_no_status`**（待审行附带，供审核页直接提示）：`ok` 可绑定 / `not_in_whitelist` 不在白名单 / `occupied` 已被他人绑定。
- **通过（approve）**：审核时再校验「新学号在白名单内且未被他人绑定」，不满足则拒绝通过并提示驳回（申诉状态保持 `pending`）；通过后覆盖 `users.student_no`（**旧学号即解绑**）并同步 `name/college/major`（取自白名单）与 `auth_status=verified`；`users.student_no` 唯一索引冲突 → `1001` 提示绑定冲突。
- **驳回（reject）**：`reason` 必填（≥2 字）落 `appeals.reject_reason`；审核人写 `review_by`（管理员用户名）与 `review_at`。
- **通知**：两种结果都调用 `notify.send({ scene: 'appeal_review_result', bizId: appeal_id })` → 站内消息必写 + 订阅消息按规则降级；`notify.duplicate = true` 表示该事件此前已通知过（去重生效）。
- 已处理申诉重复审核 → `1002`；申诉不存在/已软删 → `404`。

## 跨域（CORS）

- 云函数**不要自行设置** `access-control-allow-origin`：uniCloud 网关会按请求 `Origin` 回显该头（并附 `access-control-allow-credentials: true`），重复设置会出现两个 ACAO 头，浏览器判定 CORS 失败（`net::ERR_FAILED`）。
- 预检（OPTIONS）由网关直接响应 200，`access-control-allow-headers` 回显请求头，无需在云函数内处理。
