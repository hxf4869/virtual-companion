import './react-dom-bootstrap.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createInstancePage } from '../extension/vc-model-settings/instance-page.js';
const card = { characterRef: 'synthetic-card', name: '合成角色' };
const row = { relationshipId: '11', characterRef: card.characterRef, personaRef: 'st-character', companionName: '旧名称' };

test('实例保存等待只提交一次并保留请求所属身份', async () => {
    let resume, calls = 0;
    const page = createInstancePage({ loadRelationships: async () => [row], getCards: () => [card], saveName: () => { calls++; return new Promise(resolve => { resume = resolve; }); } });
    await page.open(); page.setName('合成新名称');
    const saving = page.save();
    page.setName('不应接受的等待输入');
    page.startCreate();
    const repeated = page.save();
    assert.equal(calls, 1);
    assert.equal(page.state.draftName, '合成新名称');
    assert.equal(page.state.selectedRelationshipId, '11');
    resume(); await saving; await repeated;
    assert.equal(page.state.savedName, '合成新名称');
});

test('新增实例保留所选角色作用域，销毁入口拒绝后续写入', async () => {
    let writes = 0, emissions = 0;
    const page = createInstancePage({ loadRelationships: async () => [], getCards: () => [card, { characterRef: 'other', name: '另一个角色' }], createBinding: async () => { writes++; return { relationshipId: '12' }; }, onChange: () => { emissions++; } });
    await page.open(); page.startCreate(); page.setName('合成实例'); await page.save();
    assert.equal(page.state.relationships[0].characterRef, card.characterRef);
    page.destroy(); const before = emissions;
    page.setName('卸载后的旧输入'); await page.save(); await page.open();
    assert.equal(writes, 1); assert.equal(emissions, before);
});
