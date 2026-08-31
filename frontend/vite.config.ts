import { defineConfig } from "vite";
import uni from "@dcloudio/vite-plugin-uni";

const proxyTarget = process.env.VITE_PROXY_TARGET ?? "http://127.0.0.1:8080";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [uni()],
  // H5-HARDEN (§21.7)：uni 插件不继承 vite 默认 publicDir，显式声明让
  // public/robots.txt 进入构建产物根目录（搜索引擎收录策略）。
  publicDir: "public",
  server: {
    // S0-23 E2E：显式绑定 IPv4 回环，Playwright/代理的 127.0.0.1 解析与
    // vite 默认（可能落在 ::1）保持一致；本地开发不受影响。
    host: "127.0.0.1",
    proxy: {
      "/api": {
        target: proxyTarget,
        changeOrigin: false,
      },
      "/actuator": {
        target: proxyTarget,
        changeOrigin: false,
      },
    },
  },
});
