import { defineConfig } from "vite";
import uni from "@dcloudio/vite-plugin-uni";

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
        target: process.env.VITE_PROXY_TARGET ?? "http://127.0.0.1:8080",
        changeOrigin: false,
        // round9 E2E 排障：客户端中止流式请求（取消生成、页面离开）时，
        // http-proxy 默认不关闭上游连接——runtime 的 SSE 并发租约（上限 3、
        // TTL 130s）要等写失败或超时才释放，期间同 owner 的新订阅一律 429。
        // 生产环境客户端直连 runtime，断开立即可见；此钩子让代理层恢复
        // 同等的断开传播语义。
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq, _req, res) => {
            res.on("close", () => {
              if (!res.writableEnded) proxyReq.destroy();
            });
          });
        },
      },
      "/actuator": {
        target: process.env.VITE_PROXY_TARGET ?? "http://127.0.0.1:8080",
        changeOrigin: false,
      },
    },
  },
});
