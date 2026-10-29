// W15-2 浏览器需放行的 inbox / 跟进 / 渠道路由。子任务 4 并入管理桥白名单。
// 只导出常量。领取与 ACK 由服务端 inbox 桥处理，不放进浏览器白名单。

const ID = '[1-9][0-9]{0,18}';
const EVENT = '[A-Za-z0-9_.:-]{1,128}';

export const INBOX_UI_ROUTES = [
    { method: 'GET', path: new RegExp(`^/api/v1/relationships/${ID}/proactive-policy$`), where: 'W15 读取主动开关与静默时段' },
    { method: 'PUT', path: new RegExp(`^/api/v1/relationships/${ID}/proactive-policy$`), where: 'W15 保存主动开关与静默时段' },
    { method: 'GET', path: new RegExp(`^/api/v1/relationships/${ID}/follow-ups$`), where: 'W15 跟进队列' },
    { method: 'POST', path: new RegExp(`^/api/v1/follow-ups/${ID}/cancel$`), where: 'W15 取消跟进' },
    { method: 'GET', path: /^\/api\/v1\/inbox$/, where: 'W15 inbox 列表' },
    { method: 'POST', path: new RegExp(`^/api/v1/inbox/${EVENT}/read$`), where: 'W15 应用已读' },
    { method: 'GET', path: /^\/api\/v1\/notification-channels$/, where: 'W15 读取邮箱与飞书渠道' },
    { method: 'PUT', path: /^\/api\/v1\/notification-channels$/, where: 'W15 保存邮箱与飞书渠道' },
    { method: 'GET', path: /^\/api\/v1\/notification-deliveries$/, where: 'W15 投递状态' },
];
