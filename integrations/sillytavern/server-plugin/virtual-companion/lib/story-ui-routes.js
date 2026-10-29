// W15-3 剧情页要走的桥路径。只导出常量；子任务 4 并入 ADMIN_BRIDGE_ROUTES，这里不注册。
const RUN = '[1-9][0-9]*';
const ACTOR = '[a-z][a-z0-9_-]{0,63}';

export const STORY_UI_ROUTES = Object.freeze([
    { method: 'POST', path: new RegExp(`^/api/v1/story/runs/${RUN}/actions$`), where: 'W15 剧情行动' },
    { method: 'POST', path: new RegExp(`^/api/v1/story/runs/${RUN}/rewind$`), where: 'W15 剧情回档' },
    { method: 'GET', path: new RegExp(`^/api/v1/story/runs/${RUN}/projections$`), where: 'W16 未确认投影只读补写' },
    { method: 'POST', path: new RegExp(`^/api/v1/story/runs/${RUN}/projections/${RUN}/confirm$`), where: 'W15 投影确认' },
    { method: 'POST', path: new RegExp(`^/api/v1/story/runs/${RUN}/participants/${ACTOR}$`), where: 'W15 陪伴入局' },
    { method: 'POST', path: new RegExp(`^/api/v1/story/runs/${RUN}/epilogue$`), where: 'W15 结局摘要' },
    { method: 'GET', path: /^\/api\/v1\/admin\/model-purposes$/, where: 'W15 剧情缺配置：导演与 NPC 用途' },
]);
