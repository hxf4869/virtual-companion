// Base UI在模块加载时选择DOM hooks。依赖React Portal的测试须在导入生产模块前建立Window。
import { after } from 'node:test';
import { installReactDom } from './react-dom.mjs';
export const bootstrapDocument = installReactDom({ after });
