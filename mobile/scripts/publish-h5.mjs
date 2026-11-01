// 把 H5 构建产物放进服务端插件目录，由插件在 /m/ 同源提供（产物不入库）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, '../dist/build/h5');
const dst = path.resolve(here, '../../integrations/sillytavern/server-plugin/virtual-companion/mobile-dist');
if (!fs.existsSync(path.join(src, 'index.html'))) throw new Error('缺少 H5 构建产物，先运行 uni build');
fs.rmSync(dst, { recursive: true, force: true });
fs.cpSync(src, dst, { recursive: true });
console.log(`H5 已发布到 ${path.relative(process.cwd(), dst)}`);
