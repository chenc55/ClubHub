# GitHub 公开交付安全复核

日期：2026-10-26。范围：`chenc55/ClubHub` 当前源码、全部已获取 Git 历史、依赖锁文件、本地演示及可见的公开仓库信息。

## 检查结论

- Gitleaks 8.30.1 扫描全部现有提交（初次检查共 2 个提交）和当前工作目录，均未发现匹配的密钥泄漏。工具来自官方 Release，下载后核对 SHA-256。此结果不代表能够识别所有自定义凭据。
- 未发布原云服务空间地址、微信 AppID、管理员种子和真实学生名单。公开演示账号与测试密钥只服务于本地合成接口或离线测试。
- GitHub 公开 API 显示仓库为 public，GitHub Pages 未启用，`main` 分支 `protected=false`。未获取到账户 2FA、协作者清单、Actions 默认权限、Secret scanning 或 Push protection 的认证状态，不能声称这些开关已经开启。

## 已落实的加固

1. 云函数移除 `TEST_CODE2OPENID` 测试身份映射，即使环境变量误配也不会跳过微信身份验证；本地演示继续使用独立的合成数据服务。
2. JWT 签发、校验与验证码摘要不再使用公开默认密钥。缺少服务端环境变量时拒绝签发/校验。离线测试显式使用测试专用密钥。
3. 为以上两种行为新增独立进程回归测试：缺少 JWT 密钥不能签发或校验；旧测试映射不能绕过微信验证。两项通过，原有 37 个离线验收脚本通过。
4. 扩展 Git 忽略规则，排除私钥、证书、凭据文件及数据库导出。
5. 新增每周及 push/PR 触发的安全工作流：Gitleaks 历史扫描、鉴权回归和依赖锁审计。工作流使用只读权限、固定 Action 提交 SHA、不保留 checkout 凭据，不安装或执行 PR 中的 npm 生命周期脚本，不部署云资源。依赖审计达到 high 时会失败，不隐藏现有告警。
6. 新增 Dependabot 更新配置及 SECURITY.md。Dependabot 配置不等于已启用仓库级告警或推送保护，需要维护者在 GitHub 核对开关。

## 依赖审计及未关闭项

使用 npm 官方 registry 执行 `npm audit --package-lock-only`。计数为受影响依赖节点，可能包含同一漏洞沿依赖链的传播，不等于独立漏洞数或已被利用次数。

| 锁文件 | 初次检查 | 补丁锁定后的检查 |
| --- | --- | --- |
| 根目录 | 0 告警 | 0 告警 |
| admin | 3 high / 4 moderate | 2 high / 4 moderate |
| uniapp | 1 critical / 29 high / 16 moderate / 27 low | 0 critical / 24 high / 18 moderate / 29 low |

已将 `source-map-js` 锁定升级到 1.2.2，将 uni-app 的 `proxy-addr` 锁定升级到 2.0.8；两者原有依赖图不变，版本和完整性值来自 npm 官方 registry。管理端 `postcss-selector-parser` 同分支更新到 6.1.5，仍有另一个需要较新主版本的告警。uni-app 自动修复时遇到 registry 超时，因此仅对已确认的两个补丁做定向锁文件更新。

**依赖问题尚未全部关闭。** 包括 Vite、SheetJS `xlsx` 和 uni-app 构建工具链的历史依赖。SheetJS 的 npm 包没有可直接自动修复的版本；Vite/uni-app 等升级需要配套迁移和完整交互回归。本次没有使用 `npm audit fix --force`，也没有声称这些依赖已达到生产安全标准。

依赖补丁目前已写入锁文件并重新审计；当前本地 `node_modules` 仍复用原工作区安装版本，未进行完整干净安装验收。不要将本地演示服务暴露到公网，不要处理来源不明的 Excel、源码或构建输入。GitHub 仓库公开存放源码本身不会启动业务服务；自动安全工作流也不运行项目依赖安装脚本。

## 维护者仍需操作

- 在 GitHub 账号 Settings → Password and authentication 启用 2FA，并妥善保存恢复码。
- 在仓库 Settings 的安全设置中确认 Secret scanning、Push protection、Dependabot alerts / security updates 和私密漏洞报告。
- 在 Settings → Rules / Branches 为 main 设置保护，禁止强制推送和删除，要求安全检查通过；不要授权未知协作者。
- 检查连接应用与访问令牌的权限，仅保留需要的仓库范围。此项为人工核对要求，不代表本次发现了越权授权或账号入侵。

官方说明：

- [GitHub 仓库安全设置](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-security-and-analysis-settings-for-your-repository)
- [proxy-addr 补丁公告](https://github.com/advisories/GHSA-jqcg-44mw-7w3h)
- [source-map-js 补丁公告](https://github.com/advisories/GHSA-68fv-2mgg-jv7q)

本报告是有限范围的检查与加固记录，不能承诺零漏洞或杜绝所有安全事件。当前仓库适用于求职源码和本地合成演示展示；对外部署之前仍需完成依赖升级及云端安全验收。
