# 珠珠与小花 · 私人健身 Agent

面向 `zhuzhu` 与 `xiaohua` 两个固定账号的私人 Web App。React/Vite 前端展示每日计划与实际记录；Hono 服务负责身份、文件/Git 状态、Pi 会话、图片、Exa 搜索/阅读，以及受控的前端候选检查与发布。

## 本地运行

需要 Node.js 22 或 24、pnpm 11、Git。

```bash
corepack pnpm install --frozen-lockfile
cp .env.example .env
pnpm hash-password 'your-password'
pnpm build
pnpm start
```

开发模式必须显式开启测试身份；以下账号口令只在非生产环境生效：

```bash
NODE_ENV=development DEV_AUTH=true DEV_FIXTURES=true DEV_MOCK_AGENT=true pnpm dev
```

- 珠珠：`zhuzhu`
- 小花：`xiaohua`

`DEV_FIXTURES` 只向 `.local/` 生成虚构演示计划；`DEV_MOCK_AGENT` 会明确说明没有调用真实模型，也不会假装保存数据。

## 检查

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

`pnpm test:e2e` 使用 Playwright 官方浏览器安装。若 CI 或精简 Linux 容器无法访问浏览器 CDN，可改用随 npm 包分发的 Linux Chromium：

```bash
pnpm test:e2e:bundled
```

真实图片理解、Exa Search/Contents 和 rootless Podman 沙箱需要相应凭据与部署环境，不能由替身测试代替。Pi 原生文件与 shell 工具不会在宿主进程权限下降级运行；需要配置 `AGENT_SANDBOX_IMAGE`。配置与部署见 [实现与运维说明](docs/IMPLEMENTATION.md)。产品完整规格见 [DEVELOPMENT.md](docs/DEVELOPMENT.md)。
