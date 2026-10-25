# 本地运行与复录

## 1. 启动演示

环境：Node.js 20+，npm；首次安装依赖需要网络。

```bash
npm ci --prefix admin
npm ci --prefix uniapp
npm run demo
```

启动器同时运行学生端 5173、管理端 5174 与合成数据接口 4175，均仅监听本机。关闭时按 Ctrl+C。启动器会显式设置 `VITE_API_BASE` 和 `VITE_ENABLE_TEST_LOGIN`；前端默认不显示开发测试登录，只有演示启动器才启用。

学生端使用「我的 → 登录 / 认证 → 开发测试登录」进入演示认证态。管理端使用账号 `demo`、密码 `DemoOnly@2026`、验证码 `DEMO`。这些值仅供本地合成接口使用，不能用于任何真实云空间。

演示覆盖：首页、社团列表/详情、活动列表/详情、活动报名与我的报名、招新报名表展示与字段编辑、站内消息、管理端登录/工作台/活动审核/统计展示。演示适配器并不替代完整后端，未覆盖的写操作会返回 404。统计为固定合成样例，不代表期间实时汇总；审核通知只模拟结果反馈，未调用微信服务。

## 2. 构建与离线验证

```bash
npm run build --prefix admin
npm run build:h5 --prefix uniapp
npm run test:offline
```

云函数无需部署即可运行现有离线脚本。测试使用数据库 stub 和测试密钥，结果不能替代 uniCloud 实例与真机验收。测试记录写入被 Git 忽略的 `.recordings/offline-tests.json`。

## 3. 复录演示

保持 `npm run demo` 运行，另开终端：

```bash
npm ci
npx playwright install chromium
npm run record
```

录制脚本会重置本地演示状态，实际登录两端，然后执行真实页面点击并校验报名、审核接口结果。输出原始 WebM、截图与 `recording-report.json` 到 `.recordings/`。可通过 `CHROMIUM_PATH` 指向已有 Chromium 可执行文件。

交付 MP4 的转换方法见 `demo/export-video.py`，需要 Python 3 和 `imageio-ffmpeg`：

```bash
python -m pip install imageio-ffmpeg
python demo/export-video.py
```

成片输出到 `docs/media/clubhub-demo-60s.mp4`，使用 H.264、yuv420p、25 fps、faststart，并裁切为 60 秒。录制过程出现错误时不得把失败片段替换成交付视频。

## 4. 自有 uniCloud 空间

本次任务不部署云端。若自行连接，需要在两端 `.env.local` 配置自己的 `VITE_API_BASE`，学生端设置 `VITE_ENABLE_TEST_LOGIN=false`；在 HBuilderX 中关联自己的阿里云服务空间并填写自己的微信 AppID。

云函数源文件、schema 和索引保持原业务结构；公共模块变更后执行 `node uniapp/scripts/sync-common.js`。JWT 密钥、微信凭据与通知模板必须在云端配置，不要放入前端环境变量。

发布版移除了管理员、白名单种子。数据库初始化文件中对应数据数组为空，需自行建立管理员与合法测试名单；原开发测试账号不可用于真实环境。活动和招新定时触发器当前保持原来的暂停状态，连接云端后需按需求验证状态流转。
