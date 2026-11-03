// 与页面启动解耦的聊天准备入口；后续聊天计算/生成只在此模块接线，保存设置不会触发它。
import { fetchModelPurposes, fetchProviders } from '../../api.js';

export async function prepareChatRuntime() {
    const [purposes, providers] = await Promise.all([fetchModelPurposes(), fetchProviders()]);
    const binding = purposes.find(row => row.purpose === 'FOREGROUND_CHAT');
    const provider = providers.find(row => row.providerId === binding?.providerId);
    return { binding, provider };
}
