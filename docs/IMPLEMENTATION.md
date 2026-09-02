# 实现与运维说明

## 已实现的运行切片

1. 两个固定账号使用 scrypt 派生值登录；登录态由服务端内存令牌维护，Cookie 为 HttpOnly、host-only、SameSite=Strict。
2. “今天”固定读取一个 data-repo commit：计划与实际日志分开，未知值不显示为零，筛选不会改变登录 actor。
3. 全局单任务队列与 `runtime/requests/*.json` 持久化请求状态。幂等摘要覆盖登录者、正文、有序附件 ID 与附件哈希。
4. 每轮从 app/data 当前 main 创建独立 Git 副本和只读 inbox。Agent 直接修改副本；宿主 Finalizer 校验白名单路径、Schema、人物/日期、符号链接和附件来源，覆盖新记录的操作身份后一次 fast-forward commit。
5. 图片通过 assistant-ui 附件适配上传；服务端真实解码 JPEG/PNG/静态 WebP，限制 10 MiB/2000 万像素，旋转、去元数据、重编码并保存哈希。模型接收 Base64 图片内容，不接收私有 URL 或路径。
6. Pi SDK 使用当前锁定包 `@earendil-works/pi-coding-agent@0.84.4`。每个账号独立会话目录；正常加载工作区 `AGENTS.md`，开放 `read/write/edit/bash/grep/find/ls` 原生工具定义，执行统一转发到无网络 rootless Podman。
7. Exa 只提供固定 `web_search` 与 `web_read`：Search=`auto`/5 条/highlights，Contents=单 URL/text/maxAgeHours 24 或 0。响应按流限制为 2 MiB，正文截断为 20,000 字符。
8. 联网调用先在请求元数据写入微美元预留，再发 HTTP；两人和 UI 任务共用 $8 提醒/$9 停止线。超时、取消或缺失成本不会按零计费。
9. Agent 可在隔离 app 副本中检视全仓，Finalizer 只接收 `web/src` 与 `web/public` diff，其他路径不可发布。允许 diff 进入 Git worktree；检查在 rootless Podman 中以断网、无密钥、无个人数据、受限资源方式运行。发布绑定源码哈希和产物哈希；`/ops` 独立提供回滚。

## 部署步骤

必须先执行以下顺序，重要前提放在操作之前：

1. 准备 Node 22/24、pnpm 11、Git、rootless Podman，以及现有 HTTPS 反向代理。不要先公开 Agent 接口。
2. 创建 `/srv/fitness/{app-repo,data-repo,runtime,uploads,releases}`，将目录所有权交给专用非 root 服务账号；代码仓库和数据仓库必须分开。
3. 在 app-repo 运行 `corepack pnpm install --frozen-lockfile && pnpm typecheck && pnpm test && pnpm build`。
4. 用 `pnpm hash-password` 分别生成两个 scrypt 值，放入 systemd EnvironmentFile。不得保存明文密码或将环境文件提交到 Git。
5. 配置支持图片和工具调用的 `MODEL_PROVIDER`、`MODEL_ID`、`MODEL_API_KEY`。未实测视觉输入前，不得宣称图片理解已验收。
6. 配置专用 `EXA_API_KEY`；在 Exa 账号中保持免费方案、不绑定支付方式，并真正关闭自动充值。核对当前定价与免费额度，应用内数字只是本地估算。
7. 使用 `deploy/Containerfile.ui-check` 构建固定工具/检查镜像，记录不可变 digest，设置 `AGENT_SANDBOX_IMAGE` 和 `UI_SANDBOX_IMAGE`（可指向同一 digest）。若 Agent 沙箱不可用，已保存页面仍可读，但不得降级为在宿主机执行 Pi 工具。
8. 安装 `deploy/fitness-agent.service`，替换服务账号和 EnvironmentFile 路径；启动后先从回环地址验证 `/api/health`。
9. 配置反向代理，精确设置生产 origin；SSE 路径关闭代理缓冲。确认 Cookie、CSP、登录限速与 Origin 检查后才能公开。
10. 用虚构营养标签执行一次真实视觉模型测试；执行一次真实 Exa Search 和一次 Contents；核对来源、正文、Exa 后台用量和本地预留。
11. 用替身完成预算、402/429、超时、取消、重启和跨月测试。不得通过真实耗尽免费额度验证停止线。
12. 构建一个 UI 候选，确认沙箱内看不到密钥、data-repo、runtime、主仓库 `.git` 或容器 socket；完成检查、隔离预览、发布和 `/ops` 回滚。
13. 完成异机加密备份与恢复演练后，才导入两人确认归属的真实资料。

## 未配置时的降级

- 模型缺失：已保存计划和日志可读；Agent 返回实际配置错误，不假装回答。
- Exa 缺失或达到预算：本地记录功能继续；联网工具明确不可用。
- Podman/Agent 固定镜像缺失：已保存页面继续可读；Agent 明确不可用，不降级到宿主工具。仅 UI 检查镜像缺失时，数据 Agent 继续而前端候选关闭。
- 服务重启：登录需要重新进行；运行中的请求标为 `interrupted`，不会自动重放副作用。

## 真实集成验收

仓库测试默认使用虚构数据与替身。发布前仍须在目标 VPS 记录下列结果：模型/模型 ID、单图与整轮限制、Pi 会话恢复、真实标签读数、Search request ID、Contents URL 状态、本地与上游用量差异、Podman 版本、镜像 digest、预览 origin、发布 revision 与回滚结果。
