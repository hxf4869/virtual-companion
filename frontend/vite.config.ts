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
        // round11（P1-1）：客户端中止流式请求（取消生成、页面离开）时，
        // http-proxy 默认不关闭上游连接。此钩子恢复断开传播语义。日志是
        // 敏感面：SSE 订阅 URL 的查询串携带 ticketId/secret 等一次性凭据，
        // 因此【禁止】记录 req.url、查询串或任何业务/稳定标识——只在
        // E2E_PROXY_TRACE=1（e2e-stack.sh 专用开关）下输出一条固定事件，
        // 且必须在 destroy() 之后（即 transport 实际开始关闭之后）产生。
        // runtime 侧 SSE 租约滞留至 130s TTL 属后端缺陷，本轮不动后端，
        // 见 Journey04 注释与 READY_FOR_OWNER 记录。
        configure: (proxy) => {
          const traceDisconnect =
            process.env.E2E_PROXY_TRACE === "1"
              ? (): void => {
                  console.info(
                    "[vite-proxy] upstream transport closed after client disconnect",
                  );
                }
              : null;
          proxy.on("proxyReq", (proxyReq, req, res) => {
            res.on("close", () => {
              if (!res.writableEnded) {
                proxyReq.destroy();
                traceDisconnect?.();
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
