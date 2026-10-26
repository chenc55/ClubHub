# 管理员权限修复记录

日期：2026-10-26。对象：公开仓库源码及 CI；未部署云函数，未接触真实账号和名单，未改变数据库集合、字段或类型。

## 已修复

1. `POST /admin/whitelist/import` 使用统一 OPS_GUARD，仅允许 super/auditor。viewer 的追加和全量重置请求均在读取/写入名单前被拒绝。
2. 公共 `requireAuth(ADMIN)` 在验证 JWT 后，逐请求从 admins 查询未软删的账号。不存在/已软删返回 401；非 normal 状态返回 403；角色非法或与 token 不同返回 401，要求重新登录。各管理业务域共享同一校验，不能绕过 session 接口继续写入。
3. 数据库不可用时操作失败，不退回仅凭 JWT 放行；学生通道仍同步返回，避免异步化破坏原有 requireActiveStudent 的状态检查。
4. 公共模块已同步到 13 个云函数的 lib 副本，不只修改 common 原文件。

账号检查针对每次请求的当前状态，并非永久 token 撤销清单或取消已在执行的请求。未启用新的生产服务；已部署的旧云函数需要另行发布该源码才会生效。

## 回归证据

`node demo/test-admin-authorization.cjs` 共 18 项通过，覆盖：

- viewer 追加与全量重置均 403，原名单保持不变；super/auditor 正常导入。
- 先签发凭证再禁用账号：session 和管理写操作均被拒绝，未修改学生状态。
- 先签发 super 凭证再降为 viewer：旧 token 返回 401；新 viewer token 可查看自身会话，不能写入。
- 软删/不存在账号不能使用旧凭证；有效审核员仍可执行其被授权的操作。
- 活动、招新、社团、内容监管、敏感词、公告、工作台、统计共 8 个其他管理域均拒绝禁用账号。
- 数据库故障不能降级放行；学生 token 校验仍保持同步。

原有 37 个离线验收脚本通过。旧测试中只签发 token、缺少真实管理员记录的夹具已补齐账号表；角色测试分别使用实际存在的对应账号，未放松生产校验。

## 主分支合并保护

当前规则要求 authentication/secrets 成功。authentication 现在依赖 build-and-browser、dependencies 矩阵和 secrets，并使用 `always()` 在前置任务结束后显式核对结果。只有三个依赖均为 success 才继续执行鉴权回归；失败、跳过、取消或结果缺失均以非零状态退出，避免必过检查被跳过后仍允许合并。

`demo/security-check.cjs` 验证全成功路径，以及逐个前置任务的 failure/skipped/cancelled、缺失单项与空结果情形。未降低依赖审计阈值，未增加 bypass 权限，未关闭任何检查。

参考：[GitHub 对必过检查与被跳过任务的说明](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks)。

本次修复关闭已发现的两项后端权限缺口及合并检查缺口，不能代替未来代码审查、账号 2FA、凭据管理或真实云环境验收。
