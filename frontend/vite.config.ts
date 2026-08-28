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
        // round9/round10 E2E：客户端中止流式请求（取消生成、页面离开）时，
        // http-proxy 默认不关闭上游连接。此钩子恢复断开传播语义并打日志——
        // E2E（Journey04）读取 vite dev server 日志作为"浏览器 abort → 代理
        // 端及时销毁上游"的真实链路证据。runtime 侧 SSE 租约的释放缺陷
        // （controller 在 async 启动前 complete，onCompletion 回调不触发，
        // 租约滞留至 130s TTL）属后端问题，本轮不动后端，见 Journey04 注释。
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq, req, res) => {
            res.on("close", () => {
              if (!res.writableEnded) {
                console.info(
                  `[vite-proxy] client disconnected before response end; upstream destroyed: ${req.url}`,
                );
                proxyReq.destroy();
              }
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
