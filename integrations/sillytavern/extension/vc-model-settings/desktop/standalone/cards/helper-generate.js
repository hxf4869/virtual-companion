// Helper生成接入桌面唯一聊天owner；不追加消息，也不建立第二个传输/模型连接。
import { getCardHost } from './ejs-host.js';
export const generate = config => getCardHost().context.generateHelper('generate',config);
export const generateRaw = config => getCardHost().context.generateHelper('generateRaw',config);
export const stopGenerationById = id => getCardHost().context.stopHelperGenerationById(id);
export const stopAllGeneration = () => getCardHost().context.stopAllHelperGeneration();
