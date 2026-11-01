import { defineConfig } from 'vite';
import uni from '@dcloudio/vite-plugin-uni';

// H5 由服务端插件在 /m/ 同源提供（ADR-0011 §3）。
export default defineConfig({
    base: '/m/',
    plugins: [uni()],
});
