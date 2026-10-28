// Virtual Companion ST 服务端插件 — Go 桥接与三协议适配入口。
// 许可：AGPL-3.0-only（见目录 README；ADR-0009 §3）。
// 部署：<ST 安装目录>/plugins/virtual-companion/（由仓库 scripts/bootstrap 复制并
// 开启 enableServerPlugins；接线归 S1，本目录是唯一写入 owner 的源码）。
// init(router) 挂 /go 管理桥，并注册 hostAuth/F2 供集中核心补丁调用；
// hostAuth 在 app 层覆盖用户解析、静态资源与原生 API，Router 本身仍位于登录/CSRF 之后。
// 生成链与连接检查共用 globalThis[Symbol.for('virtual-companion.bridge')]：
//   ① interceptGenerate（/generate switch 分发前）② finalOutboundGuard（Chat/Claude 最终发送前）
//   ③ interceptStatus（/status 路由开头：受管标记只以真实上游模型列表应答）。

import { loadConfig } from './lib/config.js';
import { createAdminBridge } from './lib/admin-bridge.js';
import { createGenerateBridge, BRIDGE_SYMBOL } from './lib/generate-bridge.js';
import { createStatusBridge } from './lib/status-bridge.js';
import { ToolContinuationStore } from './lib/responses-adapter.js';
import { createTokenCounter } from './lib/context-guard.js';
import { log } from './lib/log.js';
import fs from 'node:fs';
import { createHostAuth } from './lib/host-auth.js';
import { createF2Hooks } from './lib/f2-routes.js';
import { createSourceBridge } from './lib/source-bridge.js';
import { attemptInboxDelivery, createInboxBridge } from './lib/inbox-bridge.js';
import { createAccountData } from './lib/account-data.js';

export const info = {
    id: 'virtual-companion',
    name: 'Virtual Companion Go Bridge',
    description: 'V2 桥接：Go 模型目录受控取用（三协议）与管理 API 代理；凭据不进浏览器。',
};

export async function init(router) {
    const config = loadConfig();
    const users = await import(new URL('../../src/users.js', import.meta.url).href);
    const storage = (await import('node-persist')).default;
    const getUser = async (handle) => (await users.getAllEnabledUsers()).find((user) => user.handle === handle);
    const accountData = createAccountData({ getUserDirectories: users.getUserDirectories,
        purgeProfile: async (handle) => {
            // Keep the required native default-profile slot disabled and empty.
            await storage.setItem(users.toKey(handle), { handle, name: '', enabled: false, admin: false, password: '', salt: '', created: 0 });
            await storage.removeItem(users.toAvatarKey(handle));
        },
    });
    const inbox = createInboxBridge({ config, getUser, getUserDirectories: users.getUserDirectories, accountData });
    const sourceBridge = createSourceBridge({ config, getUser, getUserDirectories: users.getUserDirectories, accountData, inbox });
    const hostAuth = createHostAuth({ config,
        getUser, sourceBridge, accountData,
        accountVersion: users.getAccountVersion,
        indexHtml: () => fs.readFileSync(new URL('../../public/index.html', import.meta.url), 'utf8'),
    });
    router.use('/go', createAdminBridge({ config }));

    let counter;
    try {
        // 复用 ST 服务端已有 tokenizer 入口：<ST>/src/endpoints/tokenizers.js（部署契约见 README）
        counter = createTokenCounter(await import(new URL('../../src/endpoints/tokenizers.js', import.meta.url).href));
    } catch {
        log.warn('未能加载 ST tokenizer（src/endpoints/tokenizers.js），token 预算退回 guesstimate 估算并如实标注');
        counter = createTokenCounter(null);
    }

    const bridge = createGenerateBridge({ config, continuationStore: new ToolContinuationStore(), counter });
    const { interceptStatus } = createStatusBridge({ config });
    // 补丁钩子对端：① interceptGenerate（/generate 分发前）② finalOutboundGuard（Chat/Claude 最终发送前）
    // ③ interceptStatus（/status 路由开头；受管标记用真实上游模型列表应答，不篡改 online_status）。
    const f2 = createF2Hooks({ getUserDirectories: users.getUserDirectories });
    globalThis[BRIDGE_SYMBOL] = { ...bridge, interceptStatus, hostAuth, f2, attemptInboxDelivery };
    log.info(`插件就绪：goBaseUrl=${config.goBaseUrl || '(未配置)'} 服务令牌=${config.serviceToken ? '已配置' : '缺失（受控生成不可用）'} estimator=${counter.estimator}`);
}

export function exit() {
    delete globalThis[BRIDGE_SYMBOL];
    log.info('插件卸载，生成桥已注销');
}
