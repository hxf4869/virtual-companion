function isMultipart(req) {
    // ST runs multer after host admission. Multipart fields are still unknown here.
    return /^\s*multipart\//i.test(req.headers['content-type'] || '');
}

function needsCharacterChatStats(req) {
    return req.body?.vc_resource_only !== true;
}

// Cookie-session entries that can touch the old chat store in the locked ST
// runtime, including F2 patches. Upstream deprecated aliases only redirect here.
export const LEGACY_CHAT_ROUTES = [
    ['POST', '/api/chats/get'],
    ['POST', '/api/chats/save'],
    ['POST', '/api/chats/recent'],
    ['POST', '/api/chats/search'],
    ['POST', '/api/chats/rename'],
    ['POST', '/api/chats/delete'],
    ['POST', '/api/chats/import'],
    ['POST', '/api/chats/export'],
    ['POST', '/api/chats/group/get'],
    ['POST', '/api/chats/group/info'],
    ['POST', '/api/chats/group/save'],
    ['POST', '/api/chats/group/delete'],
    ['POST', '/api/chats/group/import'],
    ['POST', '/api/characters/chats'],
    ['POST', '/api/characters/all', needsCharacterChatStats],
    ['POST', '/api/characters/get', needsCharacterChatStats],
    ['POST', '/api/characters/create'], // Creates a chat directory.
    ['POST', '/api/characters/rename'], // Moves the chat directory.
    // Match ST's loose comparison, including urlencoded delete_chats=1.
    ['POST', '/api/characters/delete', (req) => isMultipart(req) || req.body?.delete_chats == true],
    ['POST', '/api/characters/import', isMultipart], // A BYAF upload can create chats.
    ['POST', '/api/groups/all'],
    ['POST', '/api/groups/delete'],
    ['POST', '/api/stats/recreate'],
    ['POST', '/api/data-maid/report'],
    ['GET', '/api/data-maid/view'],
    ['POST', '/api/data-maid/delete'],
    ['POST', '/api/backups/chat/get'],
    ['POST', '/api/backups/chat/download'],
    ['POST', '/api/backups/chat/delete'],
];

export function normalizeNativeApiPath(pathname) {
    // Express 4 ignores case and a trailing slash. A mounted router also
    // accepts an extra slash between the mount and its first route segment.
    return pathname.toLowerCase().replace(/^(\/api\/[^/]+)\/\/(?=[^/])/, '$1/').replace(/\/$/, '');
}

export function isLegacyChatRoute(req, pathname) {
    const method = req.method === 'HEAD' ? 'GET' : req.method;
    return LEGACY_CHAT_ROUTES.some(([routeMethod, routePath, usesChat]) =>
        routeMethod === method && routePath === pathname && (!usesChat || usesChat(req)));
}
