# 社团星球（ClubHub）· uni-app 主工程

P0-01 产物：uni-app（Vue 3 + Vite）工程，可编译到微信小程序 + H5 两端。

## 工程类型（重要，先读这条）

本工程是 **uni-app CLI（Vite）工程**，不是 HBuilderX 型工程：

| | 本工程（CLI/Vite） | HBuilderX 型工程 |
| --- | --- | --- |
| `manifest.json` / `pages.json` 位置 | `src/` 下 | 工程根目录 |
| 编译方式 | `npm run dev:*` / `build:*` | HBuilderX 菜单「运行 / 发行」 |
| 小程序调试 | 编译产物用**微信开发者工具**打开 | HBuilderX「运行到小程序模拟器」 |

所以：**HBuilderX 的「运行到小程序模拟器」对本工程无效**（会提示「本项目类型无法运行至小程序模拟器」）。HBuilderX 在本工程中的唯一用途是 **uniCloud 云函数的上传部署**；前端调试一律走 npm + 微信开发者工具。

## 运行方式

```bash
npm install                # 安装依赖
npm run dev:h5             # H5 开发（浏览器访问 http://localhost:5173）
npm run dev:mp-weixin      # 小程序开发态构建（产物 dist/dev/mp-weixin，watch 模式）
npm run build:h5           # H5 生产构建
npm run build:mp-weixin    # 小程序生产构建（产物 dist/build/mp-weixin）
```

**小程序调试流程**：`npm run dev:mp-weixin` → 打开微信开发者工具 →「导入项目」→ 目录选 `dist/dev/mp-weixin`（AppID 已在 `src/manifest.json` 的 `mp-weixin.appid` 配好，工具会自动带出）→ 扫码登录（微信号需为该小程序开发者/体验成员）→ 建议在「详情 → 本地设置」勾选「不校验合法域名…」以便直连 uniCloud URL 化域名。

## 目录规范

```text
src/
├── pages.json            # 路由骨架：5 个 Tab 页 + 18 个二级页占位（easycom 已开启）
├── manifest.json         # 应用配置（mp-weixin.appid 已配为 ）
├── App.vue               # 应用入口（全局样式）
├── main.js               # 入口（已接入 Pinia）
├── uni.scss              # Neo-Memphis 设计令牌最小集（完整令牌由 P0-02 落地）
├── pages/
│   ├── home/             # 首页 Tab（P1-22 已实现：搜索 / 公告轮播 / 金刚区 / 精选活动 / 热门社团 / 招新推荐）
│   ├── activities/       # 活动 Tab（P1-12 已实现：筛选 / 搜索 / 我的报名 / 进度条卡片）
│   ├── clubs/            # 社团 Tab（P1-08 已实现：筛选 / 搜索 / 排序 / 卡片分页）
│   ├── messages/         # 消息 Tab（P1-21 已实现：分类 / 红点 / 全部已读 / 跳转）
│   ├── profile/          # 我的 Tab（P1-24 已实现：登录引导 / 头像昵称 / 五入口 / 隐私弹窗）
│   └── subpages/         # 二级页（18 个，均为路由占位，由对应子任务逐个实现）
│       ├── login/                    # 登录/学号认证（P0-06、P1-03）
│       ├── activity-detail/          # 活动详情（P1-12 已实现）
│       ├── activity-register/        # 活动报名（P1-13 已实现）
│       ├── activity-manage/          # 活动管理（P1-10 已实现：状态 tab / 新建 / 编辑 / 提交审核 / 提前结束）
│       ├── activity-edit/            # 活动创建/编辑（P1-10）
│       ├── checkin/                  # 签到（P1-14）
│       ├── club-detail/              # 社团详情（P1-08 已实现）
│       ├── recruitment/              # 招新聚合（P1-17）
│       ├── recruitment-register/     # 招新报名（P1-17）
│       ├── my-recruitments/          # 我的招新状态（P1-17）
│       ├── rebind-appeal/            # 换绑申诉（P1-05）
│       ├── search/                    # 搜索结果（P1-23 已实现：防抖搜索 / 活动社团分组 / 招新挂靠）
│       ├── announcement-detail/      # 公告详情（P2-02）
│       ├── my-activities/            # 我的活动（P1-13、P1-14）
│       ├── my-registrations/         # 我的报名（P1-13 已实现）
│       ├── my-clubs/                 # 我的社团（P1-19；P1-06 提供入驻申请入口）
│       ├── club-apply/               # 社团入驻申请（P1-06）
│       ├── my-profile/               # 我的资料（P1-24）
│       ├── settings/                 # 设置与帮助（P1-24）
│       ├── static-page/              # 隐私政策/用户协议/关于（P1-24）
│       └── club-admin/               # 社团管理主页（P1-09 已实现：社团切换 + 资料卡 + 管理入口）
│       ├── members/                   # 成员管理（P1-19：成员列表 + 设/撤干部 + 移除）
│       ├── stats/                     # 社团统计（P1-20：活动/招新/成员卡片 + 状态分布条形图）
│       └── club-profile/             # 社团资料编辑（P1-09）
│       └── design-demo/              # 设计系统 Demo 页（P0-02 验收用）
├── components/
│   ├── sb-skeleton/      # 骨架屏（加载态）
│   ├── sb-empty/         # 空态（复用 sb-illustration + 黄色胶囊）
│   ├── sb-error/         # 加载失败重试（复用 sb-illustration + 重试 CTA）
│   ├── sb-illustration/  # 孟菲斯空态插画底座（波点圆 + 黑线图标，唯一插画实现）
│   ├── sb-button/        # 按钮四式：primary/approve/reject/ghost + loading/disabled + 按压微动
│   ├── sb-tag/           # 状态胶囊：pending/approved/rejected
│   ├── sb-verified-badge/# 白名单认证徽章
│   ├── sb-card/          # 卡片（硬投影可配、虚线空态卡变体）
│   ├── sb-search-bar/    # 胶囊搜索栏（extra 插槽）
│   ├── sb-image-picker/  # 图片选择/上传（单图与多图共用，规格拦截 + 压缩 + 上传，P0-07）
│   └── page-stub/        # 二级页路由占位组件（页面功能落地后移除）
├── api/                  # 业务域 API 模块（user/club/activity/recruitment/message），内置 mock
├── store/
│   └── user.js           # Pinia：游客态/认证态/社团角色（干部/社长）
├── styles/
│   └── theme.css         # Neo-Memphis 主题 CSS 自定义属性 + 安全区工具类（P0-02）
├── utils/
│   ├── config.js         # API 基地址、MOCK 开关、存储键名、统一错误码表、订阅消息模板 ID + 订阅时机表
│   ├── session.js        # 会话读写：token / refresh_token / userInfo / authStatus
│   ├── subscribe.js      # 微信订阅消息授权封装（P1-04，四时机调用，失败静默不阻断业务）
│   ├── upload.js         # 上传公共能力：2.6 规格表 + 校验拦截 + 本地压缩（长边 ≤2000px）+ JSON base64 上传
│   └── request.js        # 请求封装：URL 化入口 + token 注入 + 统一 code/data/message + 401 自动刷新重试
└── static/
    └── tabbar/           # 原生 TabBar 图标（几何孟菲斯风，脚本生成）
```

> 工程级脚本在 `uniapp/scripts/`（不在 `src/` 内）：`gen-tabbar-icons.cjs`（生成 TabBar 图标）、`sync-common.js`（把 `uniCloud-aliyun/cloudfunctions/common/` 下的公共模块同步到各云函数 `lib/`）、`test-p0-0x.js` / `test-p1-0x.js`（离线验收脚本，含 P0-07 的规格一致性守卫）。

## 登录与学号认证（P1-03 / STU-01）

页面：[pages/subpages/login/index.vue](src/pages/subpages/login/index.vue)（`?reason=need_auth` 为敏感操作引导入口）。

- **四态**由「登录态 + 账号态」推导，不额外存储：`guest` 未登录（微信授权登录）→ `form` 已登录待认证（学号 + 姓名表单）→ `done` 已认证（认证徽标 + 姓名 + 学号脱敏 + 学院专业 + 换绑申诉入口）→ `disabled` 已禁用（仅可浏览说明）。
- **认证接口**：`POST /user/verify`（学生写通道 `requireActiveStudent`），后端用 `openid + 学号 + 姓名` 与 `whitelist` 比对；成功后写 `student_no / name / college / major / auth_status=verified` 并**换发 access token**（`auth_status=verified`），前端据此切到认证态，`refresh_token` 沿用原值。
- **失败四分支**（`code=2001`，`data.reason` 区分，认证页就地展示提示 + 申诉入口）：
  - `not_found` 学号不在白名单 → 一般申诉（`rebind`）
  - `name_mismatch` 姓名与学号不符 → 一般申诉（`rebind`）
  - `occupied` 学号已被其他微信绑定 → 学号占用申诉（`occupy`，需求 4.1.1）
- **一微信一学号**：`users.student_no` 唯一索引兜底（认证瞬间并发抢占也返回 `occupied`）；已认证账号重复认证返回 `1002`（认证态不可回退，换绑走申诉）。
- **禁用态**：`status=disabled` 的账号认证返回 `403`「仅可浏览」，前端展示禁用说明卡。
- **申诉跳转**：认证页跳 `/pages/subpages/rebind-appeal/index?type=rebind|occupy&student_no=xxx`（页面已在 P1-05 实现，见下节）。

> **敏感操作引导约定（P1-13 起的报名 / 签到 / 招新等写页面）**：写操作前判断 `useUserStore()` 的 `hasSession` / `isGuest`，未登录或未认证时 `uni.navigateTo({ url: '/pages/subpages/login/index?reason=need_auth' })`；服务端兜底为 `401`（会话失效）——`utils/request.js` 会自动清态并跳登录页。

## 通知与订阅授权（P1-04 / COM-02）

服务端引擎在公共模块 `common/notify`（站内消息必写 + 微信订阅消息 + 降级 + 去重），前端只负责**在正确的时机请求订阅授权**。

- **四个授权时机**（需求 2.4）：提交活动报名 `activity_signup`、提交招新报名 `recruitment_signup`、提交换绑申诉 `appeal_submit`、负责人提交活动/招新审核 `club_review_submit`。
- **调用方式**（必须在用户点击事件中**同步**调用，微信要求由用户交互触发）：

```javascript
import { requestSubscribe } from '@/utils/subscribe'

async function onSubmit() {
  requestSubscribe('activity_signup') // 不 await 也不影响后续业务
  const res = await submitSignup(form)
}
```

- **模板 ID 配置**：填 `utils/config.js` 的 `WX_SUBSCRIBE_TEMPLATES`（键名与服务端环境变量一一对应）；**留空即自动跳过授权请求**，服务端会降级为仅站内消息，不影响业务（与「拒绝订阅」同一套降级路径）。
- **返回值**：`{ skipped, reason, accepted[], rejected[] }`；`skipped` 为 true 表示未发起（未配置模板 / 非小程序端）。**调用结果无需回传服务端** —— 下发时若被拒/额度用尽，微信返回 43101 由服务端 `notify.send` 自动记录 `push_status = skipped` 并降级。
- **平台差异**：仅微信小程序支持；H5/App 端静默跳过（H5 微信内为公众号模板消息，当前不接入），站内消息中心全端兜底。
- **一致性守卫**：`scripts/test-p1-04.js` 会比对前端 `WX_SUBSCRIBE_TEMPLATES` / `WX_SUBSCRIBE_MOMENTS` 与服务端场景表，避免两侧漂移。

## 换绑申诉（P1-05 / COM-01②）

页面：[pages/subpages/rebind-appeal/index.vue](src/pages/subpages/rebind-appeal/index.vue)（`?type=rebind|occupy&student_no=xxx`，由认证页带参进入）。

- **进度卡**：`GET /user/appeals/current` → 优先展示进行中（`pending`），否则展示最近一条；三态用 `sb-tag` 表达（待审核黄 / 已通过绿 / 已驳回红 + 驳回理由）；已驳回时可「重新提交申诉」。
- **表单**：申诉类型（换绑 / 学号被占用，可按 URL 参数与认证态自动预选并可切换）、新学号（等宽字体，本地正则先校验）、证明材料（`sb-image-picker` + `appeal_proof` 场景，≤3 图）、情况说明（≤200 字）；**说明与证明图至少填其一**才允许提交。
- **提交**：点击时**先同步调用** `requestSubscribe('appeal_submit')`（P1-04 订阅四时机之一，失败静默不阻断）→ `POST /user/appeals`。
- **约束与提示**：同用户同时仅一条进行中申诉；命中时服务端返回 `1002` 并带回该申诉，页面据此提示「已有进行中的申诉」。会话失效（401）→ 清态并提示重新登录。
- **接口封装**：`api/user.js` 的 `submitAppeal` / `getCurrentAppeal`（均 `silent: true`，失败原因在页面内展示）。
- 审核链路的服务端规则与通知口径见 `uniCloud-aliyun/README.md` §7.13。

## 社团入驻申请（P1-06 / 4.2.1）

页面：[pages/subpages/club-apply/index.vue](src/pages/subpages/club-apply/index.vue)（入口在「我的社团」页的「申请入驻」卡片）。

- **状态卡**：优先展示进行中（`pending`）→ 已通过（`normal`，附「去我的社团」）→ 最近一条；三态用 `sb-tag`；**驳回时展示驳回理由并预填上次填写内容**，便于「修改后重新提交」（`pending ⇄ rejected` 状态机）。
- **表单**：社团名称（2~30 字）、所属分类（`picker`，选项来自公开的 `GET /club/categories`）、社团简介（≤500 字）、联系方式（≤50 字）；四者齐备才允许提交。
- **前置条件**：需已完成学号认证（未认证时展示「去登录 / 认证」引导，跳转认证页并带 `reason=need_auth`）。
- **接口封装**：`api/club.js` 的 `getCategories` / `applyClub` / `getClubApplyCurrent`（后两个 `silent: true`，失败原因在页面内展示）。
- 服务端规则（名称重复拦截、同用户仅一条进行中、驳回后重提复用原记录、导入重名跳过）见 `uniCloud-aliyun/README.md` §7.14。

## 社团列表与详情（P1-08 / STU-03）

页面：[pages/clubs/index.vue](src/pages/clubs/index.vue)（社团 Tab）、[pages/subpages/club-detail/index.vue](src/pages/subpages/club-detail/index.vue)（详情）。

- **列表筛选**：分类（横滑胶囊单选，选项来自公开 `GET /club/categories`）+ 星级（「X 星及以上」：不限 / 3★+ / 4★+ / 5★+）+ 关键词（300ms 防抖，≤20 字，服务端按字面匹配名称 / 简介，转义正则元字符，不做模糊 / 拼音）。
- **排序**：综合（默认，`星级 × 20 + 成员数`）/ 最新（入驻时间倒序）；两者都以 `_id` 兜底，保证分页顺序稳定。
- **社团卡**（对照 `design-assets/screen-mobile-clubs`）：彩色图标块（Logo / 名称首字）+ 名称 + 星级徽章（未评定为灰底「未评定」）+ 数据条「成员 N · 活动 N」+ 引号式简介 + 派生标签 + 双按钮（白幽灵「招新信息」/ 主色「查看详情」）。
- **派生标签**：由现有字段推导（分类名 / N 星社团 / 新入驻（30 天内）/ 活跃（有已发布活动）），**不新增数据库字段**；口径见 `uniCloud-aliyun/README.md` §7.16。
- **分页与状态**：每页 20 条，下拉刷新（`enablePullDownRefresh`）+ 触底加载更多 + 首屏骨架 + 失败重试；空态为虚线描边卡（无筛选时给「申请创建新社团」引导至入驻申请页，有筛选时给「重置筛选条件」）。
- **详情内容**：头部（Logo / 名称 / 星级 / 分类 / 数据条 / 标签）→ 简介与联系方式 → 招新入口（在招岗位由 P1-16 / P1-17 接入，本轮为空态 + 跳招新专区）→ 社团活动（最近 5 条已发布活动，完整列表与排序由 P1-12 落地）→ 动态 / 风采槽位（P2-01 接入）。
- **可见性**：封禁 / 待审 / 驳回社团在学生端列表不可见，详情返回 404（承接 P1-07 的封禁能力）；游客态可浏览（需求 4.1 主流程 2）。
- **接口封装**：`api/club.js` 的 `getClubList` / `getClubDetail`（均 `silent: true`，失败态由页面渲染 + 重试）。

## 社团资料管理（P1-09 / CLB-01）

页面：[pages/subpages/club-admin/index.vue](src/pages/subpages/club-admin/index.vue)（管理主页）、[pages/subpages/club-profile/index.vue](src/pages/subpages/club-profile/index.vue)（资料编辑）。

- **权限**：社长（`president`）与干部（`officer`）都能进入管理主页；**资料编辑仅社长**（需求 2.3 权限矩阵，任务文档已同步修订）。管理主页与编辑页的可用性均由服务端 `can_edit` 判定，前端不自行推导。
- **管理主页**：未认证 → 引导认证；无管理社团 → 虚线空态卡（「申请创建新社团」跳入驻申请，并提示可联系社联指定身份）；有社团 → 多社团时显示横滑**社团切换器** + 资料卡（Logo / 名称 / 角色徽标 / 星级只读 / 分类只读 / 状态 / 成员数与活动数）+「编辑资料」入口 + 「查看学生端展示效果」+ **管理入口列表**。
- **管理入口列表**：动态 / 活动 / 招新 / 成员 / 统计五项按设计稿保留，对应页面由后续任务（P2-01、P1-10~P1-15、P1-16~P1-18、P1-19、P1-20）接入，当前置灰并提示所属任务编号。
- **封禁态**：社团被管理员封禁后管理主页仍展示（状态徽标「已封禁」），编辑入口替换为只读说明，避免负责人误以为社团消失。
- **资料编辑**：可编辑名称（2~30 字、不可重名）/ 简介（≤500）/ 联系方式（≤50）/ Logo（`club_logo`：≤2MB、jpg/png）/ 封面（`club_cover`：≤5MB、jpg/png/webp），图片走 `sb-image-picker` + P0-07 上传；**分类与星级只读展示**并注明「由管理员设定」；干部或被封禁社团进入时展示只读说明且表单禁用。
- **保存**：失败原因（重名 / 非社长 / 社团状态）就地展示；成功后返回管理主页并刷新，学生端列表与详情即时同步。
- **全局状态**：管理主页加载后调用 `store/user.js` 的 `setClubRoles()` 写入真实负责关系（`role` 取值与库表对齐 `president` / `officer`），供后续负责人端页面复用。
- 服务端规则（权限矩阵、只读字段白名单、封禁拦截、计数口径）见 `uniCloud-aliyun/README.md` §7.17。

## 活动创建与状态机（P1-10 / CLB-03①）

页面：[pages/subpages/activity-manage/index.vue](src/pages/subpages/activity-manage/index.vue)（活动管理）、[pages/subpages/activity-edit/index.vue](src/pages/subpages/activity-edit/index.vue)（创建/编辑）。

- **入口**：社团管理主页「活动管理」入口已接线（P1-09 时置灰的 toast 改为跳转）。
- **活动管理**：状态 tab（全部 / 草稿 / 待审核 / 已发布 / 已结束）+ 新建 + 触底分页；行操作按状态：草稿 → 编辑 / 提交审核，进行中 → 提前结束（`uni.showModal` 二次确认，成功后 toast 含通知人数）；待审核行提示「审核结果将通知你」。
- **创建/编辑**：归属（管理社团 `picker`，编辑时锁定）+ 分类（复用 `getCategories`）+ 标题（2~50）/ 图文内容（≤5000）/ 封面（`activity_cover` 上传）/ 地点 + 日期时间（`picker` date + time 四组）+ 人数上限 + 三个开关（需审核 / 候补 / 现场补报）+ 签到配置（方式胶囊多选：扫码 / 口令 / 定位；口令、定位半径、签到时段偏移按所选方式显隐）。
- **两个提交按钮**：保存草稿（`saveActivity`，不触发敏感词）/ 提交审核（先保存取 id 再 `submitActivity`；**先审后发**——服务端命中 `block`/`review` 级敏感词返回 1001 就地提示；提交前同步调用 `requestSubscribe('club_review_submit')`，对应 V-11 的订阅授权时机）。
- **校验**：前端即时校验（标题/内容/分类/地点/人数/至少一种签到方式/口令/半径）+ 服务端二次校验（时间约束、签到配置、权限、社团状态、敏感词）。
- **状态机**：`draft → pending → approved → signup → ongoing → ended → archived`；时间自动流转由 activity 云函数**定时触发器**每分钟执行（`event.type === 'timer'` 分支），手动提前结束（仅 `ongoing`）会通知全部有效报名者。
- **接口封装**：`api/activity.js` 的 `saveActivity` / `submitActivity` / `getActivityManage` / `endActivity`（均 `silent: true`，失败原因就地展示）。
- 服务端规则（校验顺序、签到配置约束、敏感词拦截、定时触发器格式）见 `uniCloud-aliyun/README.md` §7.18。

## 活动列表与详情（P1-12 / STU-04①）

页面：[pages/activities/index.vue](src/pages/activities/index.vue)（活动 Tab）、[pages/subpages/activity-detail/index.vue](src/pages/subpages/activity-detail/index.vue)（详情）。

- **筛选**：分类（胶囊单选，复用 `getCategories`）+ 时间（今天 / 本周 / 全部，服务端按本地时区算边界）+ 状态（报名中 / 进行中 / 已结束 / 全部）+ 关键词（300ms 防抖，匹配标题）+ **「我报名的」开关**（未登录弹窗引导认证，登录后按我的有效报名过滤）。
- **排序（需求 2.7）**：服务端返回——未结束按开始时间升序（最近优先），已结束沉底（刚结束的靠前）；下拉刷新 + 触底分页。
- **活动卡**（对照需求 4.1.3）：16:9 封面（无图用渐变占位块 + 标题首字）+ 左上状态标签（待开放 / 报名中 / 进行中 / 已结束）+ 标题 + 社团·时间·地点元信息 + **报名进度条**（已报 / 上限，满员显示「已满」）。
- **活动详情**：封面 + 状态标签 + 标题 + 主办社团（点击跳社团详情）+ 报名进度条 + 活动信息（时间 / 地点 / 需审核·候补·现场补报标签）+ 图文正文 + **报名按钮多态**（待开放禁用 / 报名中「去报名」/ 已满禁用 / 进行中「签到入口」/ 已结束禁用）——报名与签到动作由 P1-13 / P1-14 落地，本轮点击给出指引。
- **可见性**：`draft` / `pending` 活动列表不可见、详情返回 404；游客态可浏览（需求 4.1 主流程 2）。
- **接口封装**：`api/activity.js` 的 `getActivityList` / `getActivityDetail`（均 `silent: true`，失败态由页面渲染 + 重试）。
- 服务端规则（可见口径、排序、报名进度口径、我的报名可选 token）见 `uniCloud-aliyun/README.md` §7.20。

## 活动报名闭环（P1-13 / STU-04②）

页面：[pages/subpages/activity-register/index.vue](src/pages/subpages/activity-register/index.vue)（报名）、[pages/subpages/my-registrations/index.vue](src/pages/subpages/my-registrations/index.vue)（我的报名）。

- **报名页**：活动摘要（含已报/上限）+ **自动带出基础信息**（姓名 / 学号 / 学院专业，来自 `getProfile`）+ 备注（≤200 字）；提交前 `requestSubscribe('activity_signup')`（V-11 订阅时机）；结果反馈（报名成功 / 已进入候补 / 待审核 / 已满）。
- **我的报名页**：报名历史 + 活动快照（标题/社团/时间/地点）+ **状态标签**（待审核 / 已报名 / 候补中 / 已驳回 / 已取消）+ 签到结果（已签到）+ 可取消时「取消报名」（二次确认，释放名额后候补按报名顺序自动递补）；点活动跳详情。
- **详情页接线**：`signup` 且未报名 → 「去报名」跳报名页；已报名 → 展示我的报名状态（待审核 / 候补中 / 已报名）点击跳我的报名页。
- **接口封装**：`api/activity.js` 的 `registerActivity` / `cancelRegistration` / `promoteWaitlist` / `getMyRegistrations`（均 `silent: true`，失败原因就地展示）。
- 服务端规则（三路径分发、占用名额口径、取消-递补-再报、重复拦截）见 `uniCloud-aliyun/README.md` §7.21。

## 签到闭环（P1-14 / STU-05）

页面：[pages/subpages/checkin/index.vue](src/pages/subpages/checkin/index.vue)（学生签到）、[pages/subpages/checkin-manage/index.vue](src/pages/subpages/checkin-manage/index.vue)（负责人签到管理）。

- **学生签到页**：三种方式（扫码 / 口令 / 定位）按活动 `signin_config.methods` 过滤展示；扫码调 `uni.scanCode`（H5 降级提示走口令/定位）、定位 `uni.getLocation`；成功后 toast + 成功卡 + 自动返回；现场补报成功提示「现场补报成功并签到」。
- **签到管理页**（负责人）：动态二维码（`uqrcodejs` 4.x 绘制，`new uQRCode({data,size,errorCorrectLevel}).make()` + 遍历 `modules[i][j].isBlack`）**60s 倒计时自动刷新** + 手动刷新；签到配置（方式 / 口令 / 定位半径）保存即生成二维码；代签 / 补签（按学号或用户，进行中 + 结束后 24h 内）；签到名单（已签 / 未签统计 + join 姓名学号 + 分页）。
- **入口接线**：活动详情页 `ongoing` 显示「签到」跳签到页；活动管理 `ongoing` 行操作新增「签到管理」跳管理页。
- **接口封装**：`api/activity.js` 的 `checkin` / `checkinConfig` / `checkinQrRefresh` / `checkinManual` / `getCheckinList`（均 `silent: true`）。
- **uqrcodejs 注意**：4.x 为实例 API（无 `create`/`ErrorCorrectLevel`，静态枚举是 `errorCorrectLevel`）；H5 下 uni-app 把 canvas 编译为 `<uni-canvas>` 外层 + 内层真实 canvas，取 `#ck-qr-canvas canvas` 才有 `getContext`；小程序端 `type="2d"` + `createSelectorQuery` node。
- 服务端规则（方式校验、60s token、时段/半径、现场补报、代签宽限、重复拦截）见 `uniCloud-aliyun/README.md` §7.22。

## 报名名单与导出（P1-15 / CLB-03②）

页面：[pages/subpages/registration-list/index.vue](src/pages/subpages/registration-list/index.vue)（报名名单）。

- **名单页**：活动摘要 + 统计卡（报名成功 / 已签 / 未签 / 签到率）+ 状态筛选胶囊（带计数）+ 签到筛选（已签 / 未签）+ 名单行（姓名 / 学号脱敏 `2026****02` / 学院专业 / 报名状态 / 签到状态 / 缺席徽标 / 备注 / 报名时间）。
- **行操作**：`pending` → 通过 / 驳回（驳回内联填理由，均通知 `activity_signup_result`）；`waitlist` → 手动递补（`promoteWaitlist`）；`approved` 未签到 → 标记缺席 / 取消标记（`markAttendance`）。
- **导出 CSV**：`exportRegistrationCsv` 返回 UTF-8 BOM 文本；H5 Blob 下载，小程序写临时文件 + `uni.shareFileMessage` 发送；导出列 = 姓名/学号(完整)/学院专业/报名状态/报名时间/签到状态/签到时间。
- **入口接线**：活动管理行操作「报名名单」（`approved`/`signup`/`ongoing`/`ended`/`archived` 均显示；ongoing 额外有签到管理/提前结束）。
- **接口封装**：`api/activity.js` 的 `getRegistrationList` / `reviewRegistration` / `markAttendance` / `exportRegistrationCsv`（均 `silent: true`）。
- 服务端规则（口径、审核、缺席、CSV 格式）见 `uniCloud-aliyun/README.md` §7.23。

## 招新岗位创建与审核（P1-16 / CLB-04①）

页面：[pages/subpages/recruitment-manage/index.vue](src/pages/subpages/recruitment-manage/index.vue)（招新管理列表）、[pages/subpages/recruitment-edit/index.vue](src/pages/subpages/recruitment-edit/index.vue)（岗位创建/编辑 + 表单构建器）。

- **招新管理列表**：状态 tab（全部/草稿/待审核/开放中/已关闭）+ 分页 + 新建；行操作：草稿 → 编辑 / 提交审核；开放中 → 手动关闭；驳回草稿展示驳回理由。
- **岗位编辑页**：岗位信息（标题/内容/报名截止日期+时间/招聘人数[空=不限]/多步开关）+ **自定义报名表构建器**（字段类型单选/多选/问答，可编辑标签、选项增删、必填开关、删除字段；保存前前端校验与服务端兜底一致）。
- **入口接线**：社团管理主页「招新管理」→ 列表页（携带当前社团 id）→ 新建/编辑页；编辑回显走 `getRecruitmentManage({ recruitment_id })`。
- **接口封装**：`api/recruitment.js` 的 `getRecruitmentManage` / `saveRecruitment` / `submitRecruitment` / `closeRecruitment` / `getRecruitmentDetail`（均 `silent: true`）。
- **管理端**：审核中心新增「招新审核」tab（`RecruitmentReview.vue`，待审/已审 + 详情抽屉含报名表字段预览 + 通过/驳回）。
- 服务端规则（状态机、form_fields 结构、审核通知、定时关闭）见 `uniCloud-aliyun/README.md` §7.24。

## 招新报名与我的状态（P1-17 / STU-06）

页面：[pages/subpages/recruitment/index.vue](src/pages/subpages/recruitment/index.vue)（招新聚合）、[pages/subpages/recruitment-register/index.vue](src/pages/subpages/recruitment-register/index.vue)（招新报名）、[pages/subpages/my-recruitments/index.vue](src/pages/subpages/my-recruitments/index.vue)（我的招新状态）。

- **聚合页**：在招岗位卡（标题 / 社团 / 报名截止 / 剩余名额[已满/已截止标签] / 多步标记 / 报名表项数）+ 关键词搜索 + club_id 过滤（社团详情 → 招新入口复用）+ 上拉分页。
- **报名页**：岗位摘要 + 基础信息（姓名/学号自动带出）+ 自荐/意向 + **自定义字段按 `form_fields` 动态渲染**（单选胶囊 / 多选胶囊 / 问答 input）+ 必填校验；`closed` / 已满 / 已截止 / 未认证均禁用提交。
- **我的招新状态页**：状态 tab（全部/待审核/面试/已录取/已淘汰）+ 岗位快照 + 面试时间地点（interview）+ 录取时间（accept_at）。
- **入口接线**：首页「招新聚合」快捷入口、社团详情「招新专区」、社团列表「招新信息」→ 聚合页（`?club_id=`）；聚合页点岗位 → 报名页。
- **接口封装**：`api/recruitment.js` 的 `getRecruitmentList` / `signupRecruitment` / `getMyRecruitments`（均 `silent: true`）。
- **认证门槛**：报名需 `auth_status==='verified'`（与服务端 `requireActiveStudent` 对齐；未认证显示「先登录 / 学号认证」，不可用 `!profile` 判——mock 的 getProfile 恒返回 guest 对象）。
- 服务端规则（前置/拦截、form_data 校验、my-status join）见 `uniCloud-aliyun/README.md` §7.25。

## 招新筛选与录取（P1-18 / CLB-04②）

页面：[pages/subpages/applicants/index.vue](src/pages/subpages/applicants/index.vue)（申请人管理）。

- **申请人页**：岗位标题 + 状态 tab（带计数）+ 多选批量操作 chips（全选本页/清空/**进面试**/**录取**/**淘汰**/**通知**）+ 导出 CSV；名单卡（姓名/学号脱敏/学院专业/报名时间/面试信息提示）+ 行操作（报名表抽屉 / 设面试-重设面试 / 录取 / 淘汰）。
- **报名表抽屉**：按岗位 `form_fields` 动态渲染字段值（单选文本 / 多选顿号连接 / 问答）。
- **面试设置抽屉**：时间（`YYYY-MM-DD HH:mm`）+ 地点输入，`screenApplicants` action=interview 保存并通知。
- **入口接线**：招新管理列表 open / closed 岗位行操作「申请人」。
- **接口封装**：`api/recruitment.js` 的 `getApplicants` / `screenApplicants` / `notifyApplicants` / `exportApplicantsCsv`（均 `silent: true`）。
- **通知场景**：面试安排走 `recruitment_interview`、录取/淘汰走 `recruitment_result`（notify 去重键含 scene，两段独立可到达）。
- 服务端规则（状态机、自动入团与复活、通知、CSV）见 `uniCloud-aliyun/README.md` §7.26。

## 成员管理（P1-19 / CLB-05）

页面：[pages/subpages/members/index.vue](src/pages/subpages/members/index.vue)（成员管理）。

- **成员页**：计数摘要（社长 / 干部 / 成员，来自服务端 `role_count`）+ 成员列表卡（头像 / 姓名 / 角色徽标 / **后端脱敏学号** / 入团日期）；`viewer_role` 判定操作区——社长行内展示「设干部 / 撤干部 / 移除」（二次确认弹窗），干部视图顶部只读提示且无操作按钮。
- **操作语义**：设 / 撤干部（`officer ⇄ member`）与移除均**仅社长**；移除仅置 `status = removed`（历史报名 / 签到保留），社长不可被自身 / 干部移除；被移除成员再次被招新录取由服务端自动复活。
- **H5 弹窗竞态**：`uni.showModal` 确认后若紧接更新列表数据，H5 端遮罩会滞留不关闭；本页在确认后先让出当前帧（`await setTimeout(50)`）再请求与刷新。
- **接口封装**：`api/club.js` 的 `getClubMembers` / `setClubMemberRole` / `removeClubMember`（均 `silent: true`）；mock 数据内存态支持反复设撤 / 移除联调。
- **入口接线**：社团管理主页「成员管理」入口（携带 `club_id`）。
- 服务端规则（权限矩阵、脱敏、角色计数、封禁拦截）见 `uniCloud-aliyun/README.md` §7.27。

## 社团统计（P1-20 / CLB-03④ + CLB-04③）

页面：[pages/subpages/stats/index.vue](src/pages/subpages/stats/index.vue)（社团统计）。

- **统计页**：时间范围切换（全部 / 近 7 天 / 近 30 天）+ 三组数据卡片——活动（发布数 / 报名数 / 签到率）、招新（岗位数 / 报名数 / 录取数）、成员（总数 / 社长 / 干部）；活动状态分布**纯 CSS 条形图**（7 状态，宽度与数值成比例，无第三方图表依赖）。
- **口径**：签到率 = 签到人数 / 报名成功人数（对齐 ADM-07，0 人报名显示「—」）；成员为存量、不受时间范围影响；空态提示「该时间段暂无统计数据」。
- **接口封装**：`api/club.js` 的 `getClubStats({ club_id, range })`（`silent: true`）；mock 按社团返回两套数据。
- **入口接线**：社团管理主页「社团统计」入口（携带 `club_id`）。
- 服务端统计口径与聚合实现见 `uniCloud-aliyun/README.md` §7.28。

## 消息中心（P1-21 / STU-07）

页面：[pages/messages/index.vue](src/pages/messages/index.vue)（消息 Tab）。

- **消息页**：分类 Tab（全部 / 系统 / 活动 / 招新，带未读数徽标）+ 消息列表（未读红点 + 加粗标题 / 摘要两行省略 / 时间）+ 下拉刷新 + 触底分页 + 「全部已读」（全局全量，二次确认）+ 空态「暂无消息」。
- **点击跳转**：标记已读后按 `biz_type` 映射——activity→活动详情、recruitment→我的招新状态页、announcement→公告详情（P2-02 落地）、appeal→换绑申诉、club→入驻申请页；无映射仅标已读。
- **接口封装**：`api/message.js` 的 `getMessageList` / `readMessage` / `readAllMessages` / `getUnreadCount`（均 `silent: true`）；mock 内存态支持红点 / 已读 / 全部已读联动。
- 服务端接口与未读口径见 `uniCloud-aliyun/README.md` §7.29。

## 首页聚合（P1-22 / STU-02）

页面：[pages/home/index.vue](src/pages/home/index.vue)（首页 Tab）。

- **首页**：品牌栏（Logo + 社团星球 + 「我」头像）+ 胶囊搜索（→ P1-23 搜索结果页）+ 公告 Banner 轮播（自实现 swiper 3s 自动 + 指示点；P2-02 接入数据，空数据隐藏）+ 八大分类金刚区（4×2 彩色方块，→ 活动 Tab 带分类筛选）+ 精选活动卡（封面 / 状态标签 / 标题 / 时间地点 / 报名进度条）+ 热门社团榜（序号 / Logo / 星级 / 成员活动数）+ 招新推荐行（社团 + 剩余名额 / 截止时间）+ 首屏骨架屏 + 下拉刷新 + 上拉加载（精选活动分页）+ 空态。
- **金刚区跳分类**：Tab 页 `switchTab` 不支持 query，通过 `uni.setStorageSync('home_category_id')` 暂存、活动 Tab 页 `onLoad` 一次性消费（见 `activities/index.vue`）。
- **接口封装**：`api/home.js` 的 `getHomeIndex({ page, page_size })`（`silent: true`）；mock 提供五大区块样本数据。
- 排序口径与聚合实现见 `uniCloud-aliyun/README.md` §7.30。

## 全局搜索与排序（P1-23 / COM-05）

页面：[pages/subpages/search/index.vue](src/pages/subpages/search/index.vue)（搜索结果）。

- **搜索页**：顶部搜索框（300ms 防抖 / 空关键词不发请求 / × 清空复位）+ 分组结果——「活动」组（封面/标题/时间地点/报名进度）+「社团」组（Logo/星级/成员活动数，**招新岗位挂靠社团条目**，按截止时间升序）+ 骨架 / 空态「未找到相关内容」/ 失败重试；点击跳活动详情/社团详情/招新聚合。
- **精确匹配**（需求 2.7 不做模糊/拼音）由服务端实现（正则转义后子串匹配，关键词含 `.*` 等元字符不误伤）。
- **接口封装**：`api/search.js` 的 `globalSearch({ keyword, page, page_size })`（`silent: true`）；mock 支持多关键词命中。
- 服务端三路检索、状态过滤与排序口径见 `uniCloud-aliyun/README.md` §7.31。

## 个人中心与合规页面（P1-24 / STU-08 + 8.4）

页面：[pages/profile/index.vue](src/pages/profile/index.vue)（我的 Tab）、[pages/subpages/my-profile](src/pages/subpages/my-profile/index.vue)（资料）、[pages/subpages/my-clubs](src/pages/subpages/my-clubs/index.vue)（我的社团）、[pages/subpages/my-activities](src/pages/subpages/my-activities/index.vue)（我的活动）、[pages/subpages/my-registrations](src/pages/subpages/my-registrations/index.vue)（报名双 Tab）、[pages/subpages/settings](src/pages/subpages/settings/index.vue)（设置）、[pages/subpages/static-page](src/pages/subpages/static-page/index.vue)（静态页）。

- **我的 Tab**：游客 →「登录 / 认证」引导卡；认证 → 头像/昵称/「已认证」徽标 + 五入口列表。
- **我的资料**：头像/昵称/姓名/**学号脱敏（2026\*\*\*\*01）**/学院专业，全字段只读，取自登录态 userInfo。
- **我的社团**：`api/club.js` 的 `getMyMemberships()`——全部 active 成员关系（**含 member 角色**，区别于负责人端 my-clubs）；列表（Logo/名称/角色徽标/入团时间）→ 跳社团详情；空态「去看看招新」；被移除成员后同步消失。
- **我的报名双 Tab**：`my-registrations` 升级为「活动报名 / 招新报名」——活动 Tab（快照 + 状态 + 签到 + 取消，P1-13）；招新 Tab 复用 `getMyRecruitments`（recruitment/my-status：状态 + 面试/录取）。
- **我的活动**：`my-activities` 我报名的活动 + **签到标记**（已签到/未签到）。
- **设置与帮助**：换绑申诉（P1-05）/隐私政策/用户协议/关于 + **退出登录（二次确认 → userStore.logout）**。
- **隐私合规**：`components/sb-privacy-popup`（easycom）全局弹窗，挂在 home（首次自动）与 login（登录前校验）；storage 键 `clubhub_privacy_agreed`；**同意幂等不弹；不同意仅游客浏览**（可再次弹出）。
- 服务端 `GET /club/memberships` 见 `uniCloud-aliyun/README.md` §7.32。

## Web 用户端（H5）适配与全链路冒烟（P1-29）

H5 端（uni-app 同一套代码编译）平台差异适配与冒烟结论：

- **桌面响应式**（`App.vue` 全局样式）：`@media (min-width: 640px)` 将 `uni-page-body` 与 `uni-tabbar` 限宽 **480px 居中**（`margin: 0 auto` / `translateX(-50%)`），平板 / PC 浏览器两侧留 canvas 底色——移动端优先布局不随窗口拉宽拉伸。
- **登录降级**（既有，复核）：外部浏览器登录页提示「当前浏览器支持游客浏览，请在微信中打开或使用微信小程序登录」；微信内浏览器跳公众号网页授权 `snsapi_base`（`H5_WECHAT_APPID` / `H5_OAUTH_REDIRECT` 未配置时提示暂不可用，见待解决 E-01）。
- **签到降级**（既有，复核）：H5 下扫码入口点击提示「H5 环境请使用口令或定位签到（真机扫码走小程序）」并自动切口令；定位 / 口令正常（见 P1-14 章节）。
- **分享降级**（P1-29 新增）：活动详情 CTA 上方「复制链接分享」、社团详情「复制链接分享该社团」卡片——`#ifdef H5` 编译隔离，`uni.setClipboardData` 复制当前页链接（`location.origin + pathname + ?id`）。小程序端转发能力留待 P3-01。
- **全链路冒烟**（2026-09-24，mock 模式，`docs/H5全链路冒烟测试报告-P1-29.md`）：浏览（首页→活动/社团详情）→ 游客认证引导 → 活动报名 → 签到（口令降级）→ 招新报名（动态表单）→ 消息中心（跳转 + 已读）——**8 项全部通过，控制台零报错**；遗留：微信内授权认证（E-01）、桌面真机 1200px+ 观感、真接口全链路（依赖造数据）。

## 社团动态（P2-01 / CLB-02 + ADM-05 动态部分）

页面：[pages/subpages/post-create/index.vue](src/pages/subpages/post-create/index.vue)（发布）、[pages/subpages/my-posts/index.vue](src/pages/subpages/my-posts/index.vue)（我的动态）；社团详情「动态 / 风采」Tab 接入 `GET /club/posts/list`。

- **发布页**：社团选择（多社团负责人）+ 正文（≤1000 字，字数计数）+ 配图（`sb-image-picker` scene=moments，≤9 张）；**先发后审**——命中 block 级敏感词就地提示「内容含违规词…请修改后重新发布」；命中 review 级 toast「已发布（命中疑似词，已送审）」；正常发布 toast「发布成功」，均跳「我的动态」。顶部说明卡 +「查看我的动态」入口。
- **我的动态列表**：状态 Tab（全部 / 已发布 / 已下架）+ 疑似标记「⚠ 疑似（送审中）」+ 社团名 / 正文 / 图 / 时间 + 分页；下架后此处同步显示「已下架」（需求 CLB-02）。
- **社团详情动态流**：published 且未删动态（正文 + 图 + 时间），下架 / 删除后学生端同步消失。
- **接口封装**：`api/club.js` 的 `savePost` / `getMyPosts` / `getClubPosts`（均 `silent: true`）。
- 服务端规则（先发后审、负责人权限、author_id 落库、公开流口径）见 `uniCloud-aliyun/README.md` §7.37；管理端疑似队列复核见 §7.34。

## 公告（P2-02 / ADM-06）

页面：[pages/subpages/announcement-detail/index.vue](src/pages/subpages/announcement-detail/index.vue)（公告详情）；首页 Banner 轮播（P1-22 已实现）与消息中心公告通知（biz_type=announcement）均点击进此页。

- **详情页**：Banner 图（16:9 圆角 + 硬轮廓）+ 标题 + 发布时间 + 正文；加载骨架 / 已下架或不存在错误态（「公告可能已下架或不存在」+ 返回）；数据源 `GET /announcement/detail`（公开，游客可看，仅 published 可见）。
- **接口封装**：`api/announcement.js` 的 `getAnnouncementDetail(id)`（`silent: true`）；mock 数据与 `api/home.js` MOCK_BANNERS 对应（离线联调）。
- 服务端规则（先审后发敏感词拦截、发布 → 站内通知全体已认证用户 + 首页 Banner、下架实时移出）见 `uniCloud-aliyun/README.md` §7.38；管理端发布 / 列表 / 下架 / Banner 上传见 `../admin/README.md` 公告管理章节。

## 分享转发（P3-01 / COM-06）

- **小程序转发**：活动详情（[activity-detail](src/pages/subpages/activity-detail/index.vue)）/ 社团详情（[club-detail](src/pages/subpages/club-detail/index.vue)）/ 招新岗位详情（[recruitment-register](src/pages/subpages/recruitment-register/index.vue)）均配置 `onShareAppMessage`——卡片 = 标题 + 封面（活动 cover / 社团 logo），无封面兜底 `/static/logo.png`；path 带 id（如 `/pages/subpages/activity-detail/index?id=xxx`）。右上角胶囊菜单「转发」触发。
- **Web（H5）降级**：不支持转发，详情页提供「⧉ 复制链接分享」按钮（`uni.setClipboardData` 复制 `location.origin + pathname + ?id=`，toast「链接已复制」）。活动 / 社团页 P1-29 已有，招新页 P3-01 补齐。
- 小程序转发卡片真实渲染需微信开发者工具 / 真机验证（见 `../待解决.md` V-41）。

## 注销账号与脱敏（P3-02 / 需求 8.4）

- **注销申请**：设置 →「注销账号」→ [deletion-apply](src/pages/subpages/deletion-apply/index.vue)（后果说明 3 条 + 选填理由 + 二次确认）→ `POST /user/deletion-request` → 成功态（待管理员处理）。通过后账号不可再登录、个人可识别字段匿名化；驳回后收到站内通知（场景 `account_deletion_result`）。管理端处理入口见 `../admin/README.md` 注销管理章节。
- **学号脱敏（服务端落实）**：报名名单 / 签到名单 / 招新申请人列表服务端返回 `student_no_masked`（不再下发完整学号，统一规则保留前 4 后 2）；本人资料页与管理端例外可见完整学号；导出 CSV 保留完整（业务验收点）。审计结论见 `../docs/脱敏与合规审计报告-P3-02.md`。

## 关键约定

- **请求封装**：所有接口统一走 `utils/request.js` 的 `request({ path, method, data })`，返回 `{ code, data, message }`；token 自动注入，401 自动用 `refresh_token` 换发并重试（含并发去重与账号切换保护），仍失败则清登录态跳登录页。`utils/config.js` 的 `API_BASE` 已指向 dev 服务空间 URL 化域名、`USE_MOCK=false`（置 true 可离线联调）。
- **云函数改动后的部署**：见 `uniCloud-aliyun/README.md` 第 7 节 —— 改任一公共模块后**必须先 `node scripts/sync-common.js`**，再用 HBuilderX CLI 上传 13 个云函数（**必须带 `--force`**，否则同名会被静默跳过）。
- **图片上传**：一律走 `utils/upload.js` + `<sb-image-picker>`（场景由 `scene` 决定张数/大小/格式，规格见《功能需求.md》2.6）。超限在选图阶段拦截、不发起上传；上传前本地压缩至长边 ≤2000px。**不要用 `uni.uploadFile`** —— URL 化网关会自行消费 multipart 且不透传 body，详见 `uniCloud-aliyun/README.md` 第八节。
- **全局状态**：`store/user.js`（Pinia）维护 authStatus（guest/authenticated）、userInfo（含实名与学籍字段）、clubRoles；P0-06 接入微信登录、P1-03 接入学号认证。
- **组件使用**：easycom 自动注册，组件名即目录名（如 `<sb-empty text="暂无内容" />`）。
- **样式令牌**（P0-02 起强制）：页面/组件**禁止私设 hex**，一律引用 `uni.scss` 令牌（SCSS 编译期）或 `styles/theme.css` 的 CSS 变量（运行时）；硬轮廓、硬投影、按压微动分别用 mixin `memphis-border` / `memphis-shadow` / `press-active`；安全区用 `safe-top` / `safe-bottom` 或工具类 `sb-safe-top` / `sb-safe-bottom`。完整组件清单与 demo 见「设计系统 Demo」页。
- **页面归属**：每个二级页由 SPRINT.md 中对应子任务实现，实现时替换 `page-stub` 内容。