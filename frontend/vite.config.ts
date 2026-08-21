import { defineConfig } from "vite";
import uni from "@dcloudio/vite-plugin-uni";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [uni()],
  // H5-HARDEN (§21.7)：uni 插件不继承 vite 默认 publicDir，显式声明让
  // public/robots.txt 进入构建产物根目录（搜索引擎收录策略）。
  publicDir: "public",
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8080",
        changeOrigin: false,
      },
      "/actuator": {
        target: "http://127.0.0.1:8080",
        changeOrigin: false,
      },
    },
  },
});
