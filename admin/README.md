# 社团星球 ClubHub · Web 运营管理端（admin）

P0-03 产物：Vue 3 + Vite + Element Plus + Tailwind CSS 管理端工程骨架（布局 + 主题 + 角色路由守卫）。
P0-09 追加：真实登录（账号 + 密码 + 图形验证码）、登录失败锁定、会话超时自动登出。

## 连接的后端

管理端不带任何后端代码，全部通过 **uniCloud 云函数 URL 化** 调用 `/admin/*` 接口：

- 基地址在 `src/utils/config.js` 的 `API_CONFIG.API_BASE`（可用环境变量 `VITE_API_BASE` 覆盖）；
- 接口前缀固定 `/admin`（如 `POST /admin/login`、`GET /admin/session`）；
- 本仓库不包含云端管理员种子。使用 `npm run demo` 时，本地演示账号为 `demo` / `DemoOnly@2026`，验证码为 `DEMO`；连接自有云空间时须自行初始化管理员。

## 运行方式

```bash
npm install       # 安装依赖
npm run dev       # 本地开发（http://127.0.0.1:5174）
npm run build     # 生产构建
npm run preview   # 预览构建产物
```

## 目录规范

```text
admin/
├── tailwind.config.js      # 主题扩展：颜色令牌 / 字体栈 / memphis-xs~lg 硬投影（design.md 4.1 + 2.1）
├── vite.config.js          # 端口 5174，别名 @ -> src
└── src/
    ├── main.js             # 入口（Pinia + Router + Element Plus + material-symbols + 全局样式）
    ├── App.vue
    ├── styles/
    │   ├── index.css       # Tailwind 入口 + m-card / m-pressable / 表格铁律工具类
    │   └── element-override.css  # Element Plus 主题令牌覆盖（design.md 2.1）
    ├── config/semester.js  # 学期常量（顶栏学期胶囊）
    ├── utils/
    │   ├── config.js       # API 基地址、会话存储键名、超时、错误码表（P0-09）
    │   ├── session.js      # 会话持久化（localStorage 读写，避免 request ⇄ store 循环依赖）
    │   └── request.js      # fetch 封装：token 注入 + 统一 code/data/message + 401 清会话跳登录页
    ├── store/auth.js       # 管理员登录态（P0-09 真实登录：登录/登出/会话校验/过期判断）
    ├── router/index.js     # 路由表（meta.roles 权限矩阵 2.3）+ 角色与超时守卫
    ├── layouts/AdminLayout.vue    # 布局骨架：侧边栏 + 顶栏
    ├── components/
    │   ├── SideBar.vue     # 240px 侧边栏（品牌区 + 分组导航 + 计数徽章，菜单由路由表生成）
    │   ├── TopBar.vue      # 顶栏（面包屑 + 学期胶囊 + 全局搜索 + 通知铃 + 头像角色下拉）
    │   ├── WhitelistImport.vue   # 白名单导入（模板下载 / 上传解析 / 模式 / 分块进度 / 回执）
    │   ├── UserList.vue          # 用户查询与账号管理（模糊查询 / 筛选 / 分页 / 禁用解封 / 绑定状态）
    │   └── ClubImport.vue        # 社团批量导入（模板下载 / 上传解析 / 分类校验 / 分块进度 / 回执）
    └── views/
        ├── login/index.vue       # 登录页（账号 + 密码 + 图形验证码；失败展示剩余次数/锁定时间/禁用原因）
        ├── dashboard/index.vue   # 工作台（KPI 卡 + 表格铁律演示）
        ├── users/index.vue       # 用户与白名单（P1-01 导入 + P1-02 查询与禁用解封）
        ├── clubs/index.vue       # 社团管理：入驻审核 + 社团列表 + 批量导入（P1-06；P1-07 追加分类与星级）
        ├── review/index.vue      # 审核中心：换绑申诉审核（P1-05；活动/招新审核后续追加）
        ├── content/index.vue     # 内容监管（P1-26：动态监管 + 社团封禁双 Tab）
        ├── announcements/index.vue # 公告管理（P2-02：发布/列表/下架/Banner 上传）
        ├── stats/index.vue         # 数据统计（P2-03：四维指标/时间范围/分类分布/CSV 导出）
        ├── deletions/index.vue     # 注销管理（P3-02：注销申请列表/通过/驳回）
        ├── admins/index.vue      # 管理员账号（P1-27：创建/角色/禁用启用/重置密码/自助改密）
        ├── sensitive-words/index.vue # 敏感词库（P1-25：新增/改等级/搜索/删除）
        ├── StubPage.vue          # 通用占位页（P1 任务逐个替换）
        └── error/Forbidden.vue   # 403 无权限页
```

## 角色权限矩阵（需求 2.3）

| 模块 | 超级管理员 | 审核员 | 数据查看员 |
| --- | --- | --- | --- |
| 工作台概览 | ✔ | ✔ | ✔ |
| 用户与白名单 | ✔ | ✔ | — |
| 社团管理（入驻审核/分类/星级） | ✔ | ✔ | — |
| 审核中心（活动/招新/申诉） | ✔ | ✔ | — |
| 内容监管 | ✔ | ✔ | — |
| 公告管理 | ✔ | ✔ | — |
| 敏感词库 | ✔ | ✔ | — |
| 数据统计 | ✔ | ✔ | ✔（仅查看） |
| 管理员账号 | ✔ | — | — |

实现方式：路由 `meta.roles`（`super` / `auditor` / `viewer`，**与数据库 `admins.role` 枚举一致**）+ `router.beforeEach` 守卫；
未登录 → `/login`，角色不符 → `/403`；会话已过期（`expires_at` 早于当前时间）→ 清会话并跳 `/login?reason=expired`。

## 登录与会话（P0-09）

- **校验顺序**（需求 4.3.6）：图形验证码 → 账号 → 锁定 → 禁用 → 密码。
- **失败锁定**：连续失败 5 次锁定 15 分钟；锁定期间即使密码正确也拒绝；到期自动解锁并清零计数；登录成功写 `last_login_at` 并清零计数。
- **验证码**：`GET /admin/captcha` 返回 SVG 图 + 无状态签名票据（2 分钟有效，答案以服务端密钥加盐哈希存放）；登录失败后前端自动刷新，**验证码错误不计入失败次数**。
- **会话超时**：token 有效期 2 小时；`request.js` 收到 401 立即清会话跳登录页；路由守卫另按 `expires_at` 本地判断，超时跳登录页并提示「登录已过期，请重新登录」。

## 白名单导入（P1-01）

页面：`/users`（用户与白名单）；组件：[WhitelistImport.vue](src/components/WhitelistImport.vue)。

- **Excel 在前端解析**（依赖 `xlsx`，SheetJS）：URL 化网关不透传 multipart 且 JSON 请求体上限约 1.43MB，xlsx 二进制无法送入云函数，因此由浏览器解析 → 行级校验 → **按 1000 行/块**提交 `POST /admin/whitelist/import`，并显示分块进度。
- 校验规则：仅 `.xlsx` / `.xls`；表头必须含 **学号、姓名**（缺列拦截）；逐行校验学号格式与姓名必填；文件内重复按「跳过并记入回执」处理；**超过 20,000 行直接拦截**并提示拆分。
- 两种模式：**增量追加**（已存在跳过）/ **全量更新**（首块清空花名册后重写；仅影响后续认证比对，不解绑已认证学生）。
- 回执：成功 / 跳过 / 失败三档计数 + 明细表（Excel 行号、学号、类型、原因），失败与跳过原因直接可对应到原文件行。
- 服务端会**复校**每一行（不信任前端解析结果），故前端校验只是体验优化。
- 模板下载：`sheet 名「花名册」`，四列 `学号 / 姓名 / 学院 / 专业` + 一行示例（需删除后填写真实数据）。

## 用户查询与账号管理（P1-02）

页面：`/users`（用户与白名单）；组件：[UserList.vue](src/components/UserList.vue)。

- **查询**：`POST /admin/users/query`，支持姓名 / 学号**模糊匹配**（≤32 字，前端回车即可查询）、账号态（全部/正常/已禁用）与认证态（全部/已认证/未认证）筛选、分页（每页 20，上限 100），按注册时间倒序。
- **列表列**（design.md 3.3 表格铁律）：用户（头像 + 姓名 + 认证徽标，副行学院 · 专业）、学号（等宽字体）、微信绑定（openid **脱敏**值 + 已绑定药丸）、注册时间、账号态药丸、操作。
- **禁用 / 解封**：`POST /admin/users/disable` / `/enable`，均需**二次确认**（`ElMessageBox.confirm`）；禁用后学生端仅可浏览，报名 / 签到 / 招新等写操作被 `requireActiveStudent` 拦截并提示；解封立即恢复。重复操作、目标不存在等由服务端返回 1002 / 404 并 toast 具体原因。
- **状态反馈**：加载态为整行骨架条、空态为孟菲斯大眼睛 + 黄色「暂无内容」胶囊、错误为珊瑚红提示条（design.md §5 UI 状态矩阵）；末页被清空时自动回退一页。
- **脱敏口径**：openid 只展示 `openid_masked`（前 4 + `***` + 后 4）；学号完整展示以支撑管理端查询（成员列表的学号脱敏属 CLB 侧口径）。

## 审核中心 · 换绑申诉（P1-05 / ADM-10）

页面：`/review`（审核中心）；组件即为页面 [views/review/index.vue](src/views/review/index.vue)。

- **待办徽标**：标题旁显示 `pending_total`（待审条数，来自 `POST /admin/appeals/query`）；侧边栏「审核中心」的静态徽标由 P1-28 工作台接入真实数据。
- **列表**（design.md 3.3 表格铁律）：申请人（头像 + 姓名 + 已认证徽标，副行当前学号）、类型（换绑 / 学号占用）、学号变更（旧 → 新 + 可用性药丸）、证明材料（首图缩略，点击可多图预览 + 说明文本）、提交时间、状态（待审核 / 已通过 / 已驳回 + 审核人与时间 + 驳回理由）、操作。
- **新学号可用性提示**（服务端计算，审核页直接用）：`可绑定` / `不在白名单` / `已被他人绑定` —— 后两种即使点通过也会被服务端拒绝。
- **通过**：`ElMessageBox.confirm` 二次确认（明确提示「旧学号立即解绑」）→ 成功后 toast「已通过，结果已通知申请人」。
- **驳回**：`ElMessageBox.prompt` 输入理由（`inputValidator` 校验 ≥2 字）→ 理由会随通知一起发给申请人。
- **状态反馈**：加载态整行骨架条、空态孟菲斯大眼睛 + 黄色胶囊、错误珊瑚红提示条；翻页与末页回退逻辑同用户列表页。
- 权限：`super` / `auditor`（服务端 `requireRole` 二次校验，`viewer` 调用返回 403 且菜单不可见）。

## 审核中心 · 活动审核（P1-11 / ADM-03）

页面：`/review`（审核中心，顶部「申诉审核 / 活动审核」tab 切换）；活动审核组件：[ActivityReview.vue](src/components/ActivityReview.vue)。

- **列表**（design.md 3.3 表格铁律）：活动（标题 + 内容摘要）、主办社团、发起人（姓名 + 已认证徽标）、活动时间、提交时间、状态（待审核 / 已通过 / 已驳回回退 + 审核人与时间 + 驳回理由）、操作。
- **详情抽屉**：活动信息（时间 / 报名时段 / 地点 / 人数 / 报名审核 / 候补 / 现场补报 / 签到方式口令半径时段 / 提交与审核时间）+ 图文全文 + 封面 + 驳回理由；抽屉底部可直接通过 / 驳回。
- **通过**：`ElMessageBox.confirm` 二次确认（提示到报名开始时间自动开放报名、结果通知发起人）→ `approved`。
- **驳回**：`ElMessageBox.prompt` 输入理由（≥2 字）→ 活动回退 `draft`（发起人可在「活动管理」草稿箱修改重提），理由随通知发给发起人。
- **状态语义**：驳回后活动是 `draft`（回退草稿）而非独立「已驳回」态，列表用「已驳回回退」标识。
- **通知发起人**：发给 `activities.submitter_id`（实际提交审核的负责人，多负责人社团由提交者接收），场景 `club_activity_review` 跳负责人端管理主页。
- 权限：`super` / `auditor`；接口 `POST /activity/review-query`、`POST /activity/review`（服务端 `requireRole` 二次校验）。

## 社团管理 · 入驻审核与批量导入（P1-06 / ADM-02①）

页面：`/clubs`（社团管理）；导入组件：[ClubImport.vue](src/components/ClubImport.vue)。

- **双轨入口同页**：上方为社团列表（含审核操作），下方为「批量导入社团」卡片。
- **列表**（design.md 3.3 表格铁律）：社团（名称 + `[分类]` 药丸 + 「线上申请 / 管理员导入」徽标，副行星级与导入批次）、简介（超长截断）、联系方式、申请人（导入社团显示 `—`）、提交时间、状态（待审 / 正常 / 已驳回含理由 / 已封禁 + 审核人与时间）、操作。
- **待审徽标**：标题旁显示 `pending_total`（待审个数）。
- **通过**：`ElMessageBox.confirm` 二次确认（提示申请人会自动成为社长）→ 成功后 toast 会补充「申请人已设为社长」。
- **驳回**：`ElMessageBox.prompt` 输入理由（≥2 字）→ 理由随通知发给申请人，申请人可修改后重提。
- **批量导入**（`ClubImport.vue`）：`.xlsx` 模板四列 `社团名称 / 简介 / 分类 / 联系方式`；**分类须与系统分类名完全一致**（页面会列出可用分类，前端先校验、服务端再解析）；按 500 行/块提交（单批 ≤2,000 行）；回执区分成功 / 跳过（库内已存在、同批重复、写入冲突）/ 失败（名称为空、超长、分类为空或不存在）。
- 权限：`super` / `auditor`（服务端 `requireRole` 二次校验）。

## 社团管理 · 分类维护与星级评定（P1-07 / ADM-02②）

页面：`/clubs`（同页扩展，不新增菜单，对齐需求 2.3 权限矩阵「社团入驻审核 / 分类维护 / 星级评定」同一行）；分类抽屉组件：[CategoryManager.vue](src/components/CategoryManager.vue)。

- **列表扩展**：社团副行星级改为黄色 5 星徽章（`★`×n + `☆` 补齐，未评定为灰色「未评定」药丸）；操作列按状态展开 —— `pending` 详情 / 通过 / 驳回，`normal` 详情 / 评星 / 封禁，`banned` 详情 / 解封。
- **详情抽屉**：Logo 头像 + 名称 + 状态 / 分类 / 创建方式徽标，基础信息（分类、星级、状态、创建方式、申请人、联系方式、审核人、审核时间、驳回理由、导入批次、提交 / 更新时间）、社团简介、社团封面；底部按状态提供「星级评定」「封禁 / 停用」「解封」入口。
- **星级评定**：弹窗内 1~5 星点选（黄色实心星）+「清除评定」（0 星 = 取消评定）；仅 `normal` 社团可评（服务端二次校验，其它状态返回 1002）。
- **封禁 / 停用**：`ElMessageBox.confirm` 二次确认（需求 4.3.3，提示「学生端不再展示、不可再发布活动与招新」）→ `normal ⇄ banned`。
- **分类维护抽屉**：新增（名称 2~10 字）、重命名（`ElMessageBox.prompt` 带校验）、上移 / 下移（相邻交换，服务端归一 `sort` 为 1..n）、删除。
  - **删除兜底**：分类下仍有社团时删除按钮禁用并显示「该分类下仍有 N 个社团」；服务端同样拒绝（1002 + `club_count`），保证已有社团数据完整；至少保留一个分类。
  - 抽屉内每次变更成功后向父页发 `changed`，父页重载列表（分类名与归属数量会变）。
- 权限：`super` / `auditor`（`viewer` 菜单不可见，服务端 `requireRole` 返回 403）。

## 管理工作台（P1-28 / 待办概览）

页面：`/dashboard`（工作台，三角色默认落点）；页面即组件 [views/dashboard/index.vue](src/views/dashboard/index.vue)。

- **接口**：`GET /dashboard/summary`（管理通道，**三角色均可见**——工作台概览在需求 2.3 矩阵为 all）。
- **待办卡**（5 张，点击跳转）：待审社团 → `/clubs`；待审活动 → `/review?tab=activity`；待审招新 → `/review?tab=recruitment`；待审申诉 → `/review?tab=appeal`；疑似动态 → `/content?tab=posts`（审核中心与内容监管页均已支持 URL tab 参数）。
- **平台概览 KPI**：认证用户 / 正常社团 / 活动总数 / 开放招新（soft-delete 口径）。
- **SideBar 徽标**：[SideBar.vue](src/components/SideBar.vue) 拉取 `/dashboard/summary`，将「审核中心」徽标显示为 `pending.total`（四类待审之和；静态 badge 兜底）。
- 加载态骨架 / 错误提示条 / 空数据（全部 0）均按 design.md §5 状态矩阵实现。

## 管理员账号（P1-27 / ADM-08②）

页面：`/admins`（管理员账号，系统分组）；页面即组件 [views/admins/index.vue](src/views/admins/index.vue)。

- **接口**：`POST /admin/admins/query|create|status|reset-password|change-password`（query/create/status/reset **仅 super**，服务端 `SUPER_GUARD` 二次校验；change-password 任意管理员自助）。
- **列表**（design.md 3.3 表格铁律）：账号（头像 + username + 姓名副行）、角色药丸（超管 / 审核员 / 数据查看员）、状态（正常 / 已禁用）、最近登录、创建时间、操作；关键词（账号 / 姓名）+ 状态筛选 + 分页。
- **创建账号**：弹窗（账号 3~32 位字母开头 / 密码 ≥6 位 / 角色三选 / 姓名可选）；重名服务端 1001。
- **禁用 / 启用**：二次确认；**当前登录账号不显示禁用按钮**（服务端同样拦截「不能禁用当前登录账号」）。
- **重置密码**：超管对任意账号（含自己）重置，清除失败计数与锁定。
- **修改我的密码**：任意管理员自助，需校验原密码；改密后清失败计数与锁定。
- **权限隔离**：前端路由 `meta.roles: SUPER`（菜单对 auditor / viewer 不可见）+ 后端 `requireRole(['super'])` 双重保障；viewer 仅工作台 / 数据统计（只读）。
- 密码哈希 `sha256$salt$sha256(salt+明文)`（P0-09 同构）；新增账号初始 `status=normal`。

## 内容监管（P1-26 / ADM-05）

页面：`/content`（内容监管）；页面即组件 [views/content/index.vue](src/views/content/index.vue)，双 Tab：「动态监管」+「社团封禁」。

- **动态监管**：接口 `GET /moderation/list`、`POST /moderation/review`、`/take-down`、`/restore`、`/delete`（独立云函数域 `/moderation`，管理通道 + super/auditor 服务端二次校验）。
  - 视图筛选：全部动态（含回收）/ 疑似队列 / 已下架 / 回收站 + 内容关键词（子串匹配）+ 分页（每页 20）。
  - 表格（design.md 3.3 表格铁律）：动态内容（正文摘要 + 图数 + 已删除标记）、社团、状态（已发布 / 已下架 / 已删除 + ⚠ 疑似药丸）、发布时间、操作。
  - 操作按状态展开：疑似 →「合规放行」（仅移除标记）/「违规下架」（下架 + 通知社团负责人）；已发布 →「下架」/「删除」；已下架 →「恢复」/「删除」；回收站 →「还原」。删除与违规下架均二次确认。
  - 动态数据源依赖 P2-01（社团动态发布）写入 `club_posts`，当前 dev 空集合显示空态属正常。
- **社团封禁**：复用 club 域 `POST /club/query` + `POST /club/ban`（P1-07 已实现状态机）；关键词查询 + 状态药丸 + 封禁 / 解封（二次确认，需求 4.3.3）。
- **云端依赖**：moderation 云函数须配置 `CLUBHUB_JWT_SECRET` 环境变量（缺失时动态列表恒 401 导致整页被弹回登录页）。

## 公告管理（P2-02 / ADM-06）

页面：`/announcements`（公告管理）；页面即组件 [views/announcements/index.vue](src/views/announcements/index.vue)。

- **接口**：`GET /announcement/list`、`POST /announcement/publish`、`POST /announcement/offline`、`POST /announcement/upload`（独立云函数域，前缀 `/announcement`，管理通道 + super/auditor 服务端二次校验）。
- **列表**（design.md 3.3 表格铁律）：标题（标题 + 正文预览截断）、Banner 缩略图（16:9）、状态药丸（已发布 / 已下架）、发布时间、发布人（join admins）、操作（详情 / 下架）；状态筛选（全部 / 已发布 / 已下架）+ 标题关键词 + 分页（每页 10）。
- **发布弹窗**：标题（≤60 字）+ 内容（≤5000 字，字数计数）+ Banner 可选（`<input type=file>` → 读 base64 → `/announcement/upload`，前端校验 ≤5MB / jpg·png·webp，预览与移除）；**先审后发**——标题 + 内容命中敏感词（block / review）就地提示「内容含违规词…」，不落库（需求 2.5）。
- **详情预览**：`ElMessageBox.alert` 富文本（Banner 大图 + 正文 + 发布时间 / 发布人，HTML 转义）。
- **下架**：`ElMessageBox.confirm` 二次确认（提示实时移出首页 Banner、不可恢复发布）；幂等（已下架直接成功）；下架后 published 筛选 / 首页 Banner 实时消失。
- **发布成功联动**：toast「已发布，已通知 N 位用户」（服务端返回 `notified`）。
- **权限**：super / auditor（viewer 菜单不可见，服务端 `requireRole` 返回 403）。
- **云端依赖**：announcement 云函数须在控制台配置 URL 化 PATH `/announcement` 与 `CLUBHUB_JWT_SECRET` 环境变量（缺失时列表恒 401 / 网关 404）。

## 数据统计（P2-03 / ADM-07）

页面：`/stats`（数据统计）；页面即组件 [views/stats/index.vue](src/views/stats/index.vue)。

- **接口**：`GET /stats/overview`、`GET /stats/export`（独立云函数域，前缀 `/stats`，管理通道 + **三角色 super / auditor / viewer 均可查看与导出**，服务端 `requireRole` 二次校验）。
- **时间范围**：今天 / 近 7 天 / 近 30 天 / 自定义区间（date 输入 → 毫秒时间戳 `start_at` / `end_at`，左闭右开）；MAU 固定近 30 天窗口。
- **四维指标卡**（design.md Display 级大数字）：用户（累计注册 / 新增 verified_at / DAU / MAU）、社团（入驻总数 / 活跃数 / 活跃占比）、活动（发布数 / 报名 approved / 签到率）、招新（岗位 / 报名 / 录取 accepted）。
- **社团分类分布**：CSS 进度条（无图表库依赖），按社团数倒序 + join 分类名。
- **CSV 导出**：fetch 拿 `data.csv`（含 BOM）→ Blob 下载 `clubhub-stats-<range>-<ts>.csv`；指标汇总 + 分类分布明细。
- **权限**：三角色菜单均可见（需求 2.3 矩阵「数据统计与导出 ✔ ✔ ✔（仅查看/导出）」）。
- **云端依赖**：stats 云函数须在控制台配置 URL 化 PATH `/stats` 与 `CLUBHUB_JWT_SECRET` 环境变量（缺失时恒 401 / 网关 404）。

## 注销管理（P3-02 / 需求 8.4）

页面：`/deletions`（注销管理）；页面即组件 [views/deletions/index.vue](src/views/deletions/index.vue)。

- **接口**：`POST /admin/deletion-requests/query`、`POST /admin/deletion-requests/review`（管理通道 + super / auditor，服务端 `requireRole` 二次校验；viewer 菜单不可见、直达 403）。
- **列表**：申请人（姓名 + 脱敏学号）、注销理由、状态药丸（待处理 / 已注销 / 已驳回）、提交时间、处理人、操作（待处理 → 通过 / 驳回）；状态筛选 + 分页（每页 20）。
- **通过**：`ElMessageBox.confirm` 二次确认（提示软删 + 匿名化 + 业务记录保留审计）→ users 软删（`deleted=1`）+ openid / 学号置唯一占位 `deleted-{userId}`（释放真实学号；`student_no` 不用 `null`——users.student_no 唯一索引下 null 仅允许一条，集合内已有无学号文档时置 null 会触发重复键 500，2026-09-24 真实云端 E2E 修复）、姓名/昵称「已注销」/ auth_status 重置；申请记录保留。
- **驳回**：`ElMessageBox.prompt` 理由必填（≤200 字）→ 站内通知申请人（场景 `account_deletion_result`，biz_type=deletion）。
- **云端 E2E 已闭环（2026-09-24）**：真实数据「提交 → 列表 → 通过/驳回 → 注销后 401 / 站内通知」全链路验证通过（详见 `../待解决.md` V-42）。
- **云端依赖**：`account_deletion_requests` 集合 schema 已上传（HBuilderX 上传 DB Schema）。

## 敏感词库（P1-25 / ADM-09）

页面：`/sensitive-words`（敏感词库）；页面即组件 [views/sensitive-words/index.vue](src/views/sensitive-words/index.vue)。

- **接口**：`GET /sensitive_words/list`、`POST /sensitive_words/save`、`POST /sensitive_words/delete`（独立云函数域，前缀 `/sensitive_words`，管理通道 + super/auditor 服务端二次校验）。
- **列表**（design.md 3.3 表格铁律）：词条（mono 字重）、等级（`block` 拦截 / `review` 送审药丸 + 语义说明）、创建时间、操作（改等级 / 删除）；关键词精确子串匹配 + 分页（每页 20）。
- **新增 / 改等级**：弹窗表单；词条 ≤30 字必填；等级为 block/review 双卡选择；**编辑态词条输入框只读**（word 唯一，提示「需先删除再新增」）。
- **删除**：`ElMessageBox.confirm` 二次确认（提示软删除、不影响已发布内容）；服务端幂等（不存在 / 已软删不报错）。
- **即时生效**：写成功后云函数调用 `refreshSensitiveWords()`，当前实例立即生效，其余最长 10s（P0-08 引擎缓存策略）；页面提示「已新增…立即生效」。
- **权限**：super / auditor（viewer 菜单不可见，服务端 `requireRole` 返回 403）。
- **云端依赖**：sensitive_words 云函数须配置 `CLUBHUB_JWT_SECRET` 环境变量（缺失时列表恒 401）。

## 关键约定

- **设计令牌**：颜色一律用 tailwind 语义类（`bg-primary` / `text-memphis-dark` / `bg-warning-light` 等），禁止私设 hex；Element Plus 组件配色统一收敛到 `styles/element-override.css`。
- **孟菲斯组件样式**：卡片用 `m-card`（白底 2px 黑边 3px 硬投影）；可点元素加 `m-pressable`（按压位移 + 投影收窄归零）。
- **表格铁律**（design.md 3.3）：表头与单元格主体 `tbl-nowrap`（禁单字折行）；复杂表格 `tbl-scroll` 包裹（min-w-1280 横向滚动）；姓名/认证标/学号/社团与分类胶囊一律单行水平平铺。
- **图标**：material-symbols 本地字体，`<span class="material-symbols-outlined">icon_name</span>`，与设计稿 1:1。
- **页面归属**：每个 StubPage 由 SPRINT.md 对应子任务实现真实页面后替换。
- **浏览器端验收约定（R-02）**：表格内按钮若落在 `tbl-scroll` 横向滚动区之外，坐标点击（`browser_click`）会**静默失效且不报错**；验收统一改为「先把目标列滚动到可视区 → 页内 `element.click()` → 断言 DOM 文本/状态」，不要依赖坐标点击的返回值。
