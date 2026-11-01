import test from 'node:test';
import assert from 'node:assert/strict';
import { ADMIN_BRIDGE_ROUTES } from '../server-plugin/virtual-companion/lib/admin-bridge.js';

const allowed = (method, path) => ADMIN_BRIDGE_ROUTES.some((r) => r.method === method && r.path.test(path));

test('UX-28/31/32/33 routes are allowed with exact methods', () => {
    for (const [method, path] of [
        ['POST', '/api/v1/relationships/7/reply-suggestions'],
        ['PUT', '/api/v1/memories/12/pin'],
        ['DELETE', '/api/v1/memories/12/pin'],
        ['GET', '/api/v1/relationships/7/favorites'],
        ['POST', '/api/v1/relationships/7/favorites'],
        ['DELETE', '/api/v1/favorites/3'],
        ['GET', '/api/v1/relationships/7/reminders'],
        ['POST', '/api/v1/relationships/7/reminders'],
        ['DELETE', '/api/v1/reminders/3'],
        ['GET', '/api/v1/relationships/7/diary'],
        ['GET', '/api/v1/diary/3'],
        ['GET', '/api/v1/incognito-pref'],
        ['PUT', '/api/v1/incognito-pref'],
    ]) assert.equal(allowed(method, path), true, `${method} ${path}`);
});

test('unrelated methods and traversal stay rejected', () => {
    for (const [method, path] of [
        ['GET', '/api/v1/relationships/7/reply-suggestions'],
        ['PATCH', '/api/v1/reminders/3'],
        ['PUT', '/api/v1/relationships/7/diary'],
        ['DELETE', '/api/v1/diary/3'],
        ['PUT', '/api/v1/memories/0/pin'],
        ['DELETE', '/api/v1/incognito-pref'],
        ['GET', '/api/v1/relationships/7/favorites/../diary'],
    ]) assert.equal(allowed(method, path), false, `${method} ${path}`);
});
