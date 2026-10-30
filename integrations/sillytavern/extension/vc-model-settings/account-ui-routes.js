// W15-4c 账户页路径。只导出常量。
// 删除账号不进管理桥：api.js 把 DELETE /api/v1/auth/account 转到宿主 /auth/api/account。
const ID = '[1-9][0-9]*';

export const ACCOUNT_UI_ROUTES = Object.freeze([
    { method: 'POST', path: /^\/api\/v1\/auth\/reauth$/, sample: '/api/v1/auth/reauth', where: 'W15 重新验证身份' },
    { method: 'GET', path: /^\/api\/v1\/consents$/, sample: '/api/v1/consents', where: '同意状态' },
    { method: 'PUT', path: /^\/api\/v1\/consents$/, sample: '/api/v1/consents', where: '同意与撤回' },
    { method: 'POST', path: /^\/api\/v1\/auth\/password$/, sample: '/api/v1/auth/password', where: 'W15 修改密码' },
    { method: 'GET', path: /^\/api\/v1\/auth\/session$/, sample: '/api/v1/auth/session', where: 'W15 当前登录' },
    { method: 'GET', path: /^\/api\/v1\/auth\/sessions$/, sample: '/api/v1/auth/sessions', where: 'W15 会话列表' },
    { method: 'DELETE', path: new RegExp(`^/api/v1/auth/sessions/${ID}$`), sample: '/api/v1/auth/sessions/12', where: 'W15 逐条登出其他会话' },
    { method: 'POST', path: /^\/api\/v1\/auth\/logout$/, sample: '/api/v1/auth/logout', where: 'W15 登出当前会话' },
    { method: 'GET', path: /^\/api\/v1\/auth\/trusted-devices$/, sample: '/api/v1/auth/trusted-devices', where: 'LOGIN-UX 已信任设备列表' },
    { method: 'DELETE', path: new RegExp(`^/api/v1/auth/trusted-devices/${ID}$`), sample: '/api/v1/auth/trusted-devices/12', where: 'LOGIN-UX 撤销已信任设备' },
    { method: 'POST', path: /^\/api\/v1\/exports$/, sample: '/api/v1/exports', where: 'W15 生成副本' },
    { method: 'POST', path: /^\/api\/v1\/exports\/recover$/, sample: '/api/v1/exports/recover', where: 'W15 取回最近副本' },
    { method: 'DELETE', path: /^\/api\/v1\/auth\/account$/, sample: '/api/v1/auth/account', where: 'W15 删除账号；浏览器走 /auth/api/account' },
    { method: 'POST', path: new RegExp(`^/api/v1/admin/accounts/${ID}/authenticator-reset$`), sample: '/api/v1/admin/accounts/7/authenticator-reset', where: 'W15 重置验证器' },
]);
