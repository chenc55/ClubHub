# uniCloud 后端源码

云端方案：uniCloud 阿里云版云函数（JavaScript）+ JSON 文档数据库 + 云存储。此仓库包含源码，不连接或重新部署原服务空间。

## 业务域

`user`、`club`、`activity`、`recruitment`、`message`、`admin`、`home`、`search`、`sensitive_words`、`moderation`、`dashboard`、`announcement`、`stats` 共 13 个业务域。

云函数 `package.json` 中的 URL 化路径和 `index.js` 路由表定义接口；客户端通过同一基地址调用各域。公共模块位于 `cloudfunctions/common/`，各域 `lib/` 是同步副本。

```bash
node uniapp/scripts/sync-common.js
npm run test:offline
```

## 数据库

`database/` 包含 schema 与索引。字段和状态机以根目录 `功能需求.md` 为准，保留 snake_case、`deleted`、`created_at` / `updated_at` 约定。

发布整理版删除原管理员和白名单初始化数据，`db_init.json` 对应数组为空；分类与敏感词样例仍保留。自行部署时需按 schema 建立自己的账号和名单。

## 自行接入

1. 使用 HBuilderX 关联自己的 uniCloud 阿里云服务空间。
2. 上传 schema、索引、业务云函数与已同步的公共模块。
3. 按各域路由配置 URL 化入口；为前端设置自己的 `VITE_API_BASE`。
4. 云端配置共享 `CLUBHUB_JWT_SECRET`、自己的微信 AppID / Secret 和需要的通知模板变量。变量读取位置以源码 `process.env` 为准，禁止把服务端密钥放入前端。
5. 学生端真实环境使用 `VITE_ENABLE_TEST_LOGIN=false`。公开版云函数已经移除 `TEST_CODE2OPENID` 测试映射，即使误配环境变量也不会启用。
6. 活动与招新的定时触发器保留原来的暂停设置，需要自行配置并验证时间驱动的状态流转。

本地 `demo/server.cjs` 是合成数据展示适配器，不是 uniCloud 模拟运行器，不应部署为后端服务。
