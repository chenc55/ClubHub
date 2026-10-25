# 依赖漏洞修复与回归

日期：2026-10-26。修复范围为公开作品集仓库的依赖、锁文件、构建验证及回归脚本，未修改业务集合、状态机和页面流程，未部署云函数或接触原云端数据。

## 修复结果

| 锁文件 | 修复前 | 修复后 |
| --- | --- | --- |
| 根目录 | 0 告警 | 0 告警 |
| admin | 2 high / 4 moderate | 0 告警 |
| uniapp | 24 high / 18 moderate / 29 low | 0 告警 |

使用 npm 官方 registry 执行 `npm audit --package-lock-only`，没有降低 CI 的 high 阈值，也没有添加漏洞忽略项。计数为受影响依赖节点，并非独立漏洞数。

## 管理端

- Vite 从 5.x 更新到受安全维护的 6.4.4，保留现有 Vue 插件及页面代码。
- SheetJS 从 npm 的旧版 0.18.5 切换到官方 CDN 发布的 0.20.3。保留 `xlsx` 包名和原 API，因此模板下载、`.xlsx/.xls` 解析、行级校验与分块载荷不变。锁文件记录 tarball 完整性值。
- PostCSS selector parser 更新到 7.1.6，移除选择器解析告警。

## uni-app

- 工程范围明确为需求中的 H5 + 微信小程序，移除脚手架中未使用的其他平台包、构建命令及 uni-automator。Playwright 回归由根目录统一管理。
- 保留 uni-app 编译器基线，通过显式 npm overrides 升级其固定的旧传递依赖，包括 Vite 6.4.4、Rollup 4.65.0、Vue / server renderer 3.5.44、Intlify 9.14.5、Babel core 7.29.7、PostCSS 8.5.31、Express 4.22.3、ws 8.22.0、adm-zip 0.6.1 等。
- DCloud 插件上游 peer 仍固定 Vite 5.2.8；本项目使用受测的 override 选择 6.4.4，因此增加了 H5、微信构建和实际浏览器回归，而没有声称该组合已获上游完整认证。
- 图片处理使用保留旧 Jimp 调用方式的 0.22.12，修复 JPEG 解码依赖。其旧 file-type 依赖改由 `compat/file-type-cjs` 提供 `fromBuffer` 兼容入口，内部调用官方 `file-type` 21.3.4 的修复版 ESM 解析器。适配器不复制旧解析代码，也不跳过图片检测。
- `file-type-modern` 为 npm 官方 `file-type@21.3.4` 的安装别名，纳入正常审计。使用直接本地依赖及 `$file-type` override 保证 `npm ci` 可以在干净环境解析兼容入口。

Vue I18n 9 与 phin 仍会显示上游弃用提示；弃用提示不等于 npm 漏洞告警。后续仍应随框架支持继续维护，不能把本次结果理解为永久零漏洞。

## 验证

- 独立 worktree 全新安装，未覆盖原项目的 node_modules。
- 管理端生产构建、H5 构建、微信小程序构建通过。
- 原有 37 个离线验收脚本与两项鉴权回归通过。
- `npm run test:browser` 包含 9 项回归：PNG/JPEG 解码及 HTTP 图片加载、学生登录/报名/结果查询、招新字段交互、管理端登录/审核/筛选、白名单模板与去重/非法行过滤、`.xls` 与缺列表头、20,000 行上限、社团模板与分类校验/载荷、统计时间切换；无页面运行异常。
- Excel 上传接口使用测试专用合成回执，未写入真实云端名单；未将本地合成测试当作云端或真机验收。
- GitHub Actions 新增独立安装、三端构建及浏览器回归任务，继续保留原鉴权、密钥扫描与依赖审计任务。

官方依据：[SheetJS 安装说明](https://docs.sheetjs.com/docs/getting-started/installation/frameworks/)、[Vite 安全维护版本](https://vite.dev/releases)。
