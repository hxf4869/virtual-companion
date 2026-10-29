// W15-1 需要子任务 4 并入管理桥的路由。
// GET /api/v1/relationships 与 POST /api/v1/st/bindings 已在白名单，不在这里重复。

const REL = '[1-9][0-9]*';

export const CHAT_UI_ROUTES = [
    { method: 'GET', path: /^\/api\/v1\/inbox$/, where: 'W15 聊天页待写入会话条' },
    { method: 'PATCH', path: new RegExp(`^/api/v1/relationships/${REL}$`), where: 'W15 陪伴实例名称' },
];
