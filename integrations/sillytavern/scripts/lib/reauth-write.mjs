// 写操作前走现有重新认证。不放宽服务端 15 分钟新鲜度窗口。
// 账号维度对 reauth 每 15 分钟只放行 5 次（含种子里的那一次）。
// 4 分钟内复用刚成功的结果，既盖过长场景，也不会在默认集里打出 429。

export const REAUTH_REFRESH_MS = 4 * 60 * 1000;

let lastOkAt = 0;
let now = () => Date.now();

export function resetReauthCache() {
    lastOkAt = 0;
}

export function setReauthClock(fn) {
    now = typeof fn === 'function' ? fn : () => Date.now();
}

export async function reauthForWrite(ctx) {
    if (lastOkAt && now() - lastOkAt < REAUTH_REFRESH_MS) return { ok: true, status: 200 };
    const password = ctx?.secrets?.password;
    if (!password || typeof ctx?.admin?.reauth !== 'function') throw new Error('重新认证材料缺失');
    const result = await ctx.admin.reauth(password);
    if (!result?.ok) throw new Error(`重新认证失败 HTTP ${result?.status ?? '无'}`);
    lastOkAt = now();
    return result;
}
