# Hify 前端

Vue 3 + TypeScript + Vite + Naive UI + Pinia。

- `npm run dev` — 开发（默认开启 MSW mock，见 `.env.development`）
- `npm run build` — 构建（产物 `dist/`，由后端打进 jar 托管）

MSW mock 账号：`admin / admin`（ADMIN），其他任意用户名密码（MEMBER）。
后端就绪后将 `VITE_ENABLE_MSW` 改为 `false`，请求走 vite 代理到 `localhost:8080`。
