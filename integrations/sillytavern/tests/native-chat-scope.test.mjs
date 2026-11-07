import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createNativeChatScopeResolver } from '../server-plugin/virtual-companion/lib/native-chat-scope.js';

async function fixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vc-native-scope-'));
    const directories = { root, characters: path.join(root, 'characters'), groups: path.join(root, 'groups') };
    await fs.mkdir(directories.characters); await fs.mkdir(directories.groups);
    await fs.writeFile(path.join(directories.characters, 'synthetic.png'), JSON.stringify({ data: { extensions: { vc_character_ref: 'stable-character' } } }));
    await fs.writeFile(path.join(directories.groups, '42.json'), JSON.stringify({ id: '42', chat_id: 'group-chat', chats: ['group-chat'] }));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    return { root, directories, req: { vcIdentity: { accountId: '1', handle: 'owner' }, user: { profile: { handle: 'owner' }, directories } },
        resolve: createNativeChatScopeResolver({ decodeCharacter: bytes => JSON.parse(bytes.toString()) }) };
}

test('native scope resolves authenticated resource bytes and ignores uploaded binding identities', async t => {
    const f = await fixture(t);
    const out = await f.resolve({ req: f.req, path: '/api/chats/save', body: { avatar_url: 'synthetic.png', chat: [{ chat_metadata: { vc_binding: { characterRef: 'foreign', relationshipId: '999', conversationId: '999', mode: 'STORY' } } }] } });
    assert.deepEqual(out, { scope: { kind: 'SINGLE', characterRef: 'stable-character' }, avatar: 'synthetic.png', mode: 'STORY' });
    f.req.user.profile.handle = 'foreign';
    await assert.rejects(f.resolve({ req: f.req, path: '/api/chats/get', body: { avatar_url: 'synthetic.png' } }), { code: 'ACCESS_DENIED' });
});

test('native group scope comes from the actual owned group resource and ambiguous membership refuses', async t => {
    const f = await fixture(t);
    const out = await f.resolve({ req: f.req, path: '/api/chats/group/get', body: { id: 'group-chat', groupRef: 'foreign' } });
    assert.deepEqual(out.scope, { kind: 'GROUP', groupRef: '42' });
    await fs.writeFile(path.join(f.directories.groups, '43.json'), JSON.stringify({ id: '43', chats: ['group-chat'] }));
    await assert.rejects(f.resolve({ req: f.req, path: '/api/chats/group/save', body: { id: 'group-chat' } }), { code: 'REVISION_CONFLICT' });
});

test('native owner-wide recent scopes use only stable owned resources, with no uploaded scopes', async t => {
    const f = await fixture(t);
    await fs.writeFile(path.join(f.directories.characters, 'unbound.png'), '{}');
    const out = await f.resolve({ req: f.req, path: '/api/chats/recent', body: { scopes: [{ kind: 'SINGLE', characterRef: 'foreign' }] } });
    assert.deepEqual(out.scopes, [{ kind: 'SINGLE', characterRef: 'stable-character' }, { kind: 'GROUP', groupRef: '42' }]);
    assert.equal(out.avatars['stable-character'], 'synthetic.png');
    assert.equal(out.groupIds['42'], '42');
});

test('native resource resolution rejects traversal and symbolic links before decoding', async t => {
    const f = await fixture(t);
    for (const avatar_url of ['../synthetic.png', '/synthetic.png', 'x\\synthetic.png', '\0synthetic.png']) {
        await assert.rejects(f.resolve({ req: f.req, path: '/api/chats/get', body: { avatar_url } }), { code: 'INVALID_REQUEST' });
    }
    await fs.symlink(path.join(f.directories.characters, 'synthetic.png'), path.join(f.directories.characters, 'link.png'));
    await assert.rejects(f.resolve({ req: f.req, path: '/api/chats/get', body: { avatar_url: 'link.png' } }), { code: 'ACCESS_DENIED' });
});
