// W04 离线回归运行 MVU 补丁的接收回调和桌面生产正则入口。
// nf-cards 另对照原生与发运桌面的完整 formatter。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { complexCard, complexReply, isRequiredCardResource, statusPanel } from '../scripts/lib/complex-card.mjs';
import { createRegexRuntime } from '../extension/vc-model-settings/desktop/standalone/engine/regex.js';

const spec = JSON.parse(fs.readFileSync(new URL('../patches/mvu-current-message-lifecycle.json', import.meta.url), 'utf8'));
const receiveReplacement = spec.replacements.find((r) => r.from.startsWith('n=_.throttle('));

function patchedReceiver(receive) {
    assert.ok(receiveReplacement, '必须找到接收回调补丁');
    return vm.runInNewContext(`(() => { let n; ${receiveReplacement.to}; return n; })()`, { t: receive });
}

test('MVU 接收补丁：立即相继的新候选都执行，返回各自 Promise 供宿主等待', async () => {
    const calls = [];
    let finishFirst;
    const first = new Promise((resolve) => { finishFirst = resolve; });
    const second = Promise.resolve('swipe-8');
    const receive = patchedReceiver((id) => {
        calls.push(id);
        return id === 'swipe-15' ? first : second;
    });

    const p15 = receive('swipe-15');
    const p8 = receive('swipe-8');
    assert.deepEqual(calls, ['swipe-15', 'swipe-8']);
    assert.strictEqual(p15, first);
    assert.strictEqual(p8, second);
    assert.equal(await p8, 'swipe-8');
    // 上游卸载仍会调用 cancel；它不能抛错或破坏已经返回给宿主的 Promise。
    assert.doesNotThrow(() => receive.cancel());
    finishFirst('swipe-15');
    assert.equal(await p15, 'swipe-15');
});

test('MVU 接收补丁：解析失败仍沿原生异步链拒绝，不吞错误', async () => {
    const failure = new Error('synthetic parsing failure');
    const receive = patchedReceiver(() => Promise.reject(failure));
    await assert.rejects(receive('message'), (error) => error === failure);
});

test('复杂卡保留真实脚本/初始化入口；协议隐藏正则不进入提示层', () => {
    const card = complexCard('合成澄夏', '合成书店');
    const data = card.data;
    assert.equal(data.alternate_greetings.length, 1, '共两个原生开场');
    const scripts = data.extensions.tavern_helper.scripts;
    assert.equal(scripts.length, 1);
    assert.equal(scripts[0].enabled, true);
    assert.equal(scripts[0].content, "import '/user/files/mvu-bundle-d03b7dc8.js'");
    const init = data.character_book.entries.find((entry) => /\[initvar\]/i.test(entry.comment));
    assert.deepEqual(JSON.parse(init.content), {
        trust: [10, '信任度'], scene: ['bookshop', '地点'], discussed_book: [false, '已讨论旅行笔记'],
    });
    assert.ok(data.character_book.entries.some((entry) => entry.constant && entry.content.includes("getvar('stat_data.discussed_book'")), 'EJS 条件读取真实变量');

    const raw = `${complexReply(15)}\n\n<StatusPlaceHolderImpl/>`;
    const rules = data.extensions.regex_scripts;
    assert.deepEqual(rules.map(({ id, replaceString }) => [id, replaceString]), [
        ['vc04-hide-update', ''], ['vc04-status', statusPanel],
    ]);
    for (const rule of rules) {
        assert.equal(rule.markdownOnly, true, '只允许显示层执行');
        assert.equal(rule.promptOnly, false);
        assert.deepEqual(rule.placement, [2], '只处理 AI 输出');
    }
    const avatar = 'nf04-complex-card.png';
    // 此正则夹具没有宏，宿主替换端口原样返回文本。
    const preserveText = text => text;
    const { getRegexedString, regex_placement } = createRegexRuntime({
        characters: [{ ...card, avatar }],
        characterId: 0,
        extensionSettings: { disabledExtensions: [], character_allowed_regex: [avatar] },
        getPresetManager: () => null,
        substituteParams: preserveText,
        substituteParamsExtended: preserveText,
    });
    const displayed = getRegexedString(raw, regex_placement.AI_OUTPUT, { characterOverride: data.name, isMarkdown: true, depth: 0 });
    const prompt = getRegexedString(raw, regex_placement.AI_OUTPUT, { isPrompt: true, depth: 0 });
    assert.ok(raw.includes("_.set('trust', 15);\n_.set('discussed_book', true);"));
    assert.ok(!displayed.includes('<UpdateVariable>') && !displayed.includes('_.set('));
    assert.ok(displayed.includes('查看当前状态') && displayed.includes('getCurrentMessageId()'));
    assert.ok(!displayed.includes('<StatusPlaceHolderImpl/>'));
    assert.equal(prompt, raw, '显示正则不改变发往提示层的内容');
});

test('卡片验收识别动态脚本、Worker 与 iframe 运行资源', () => {
    const base = '/scripts/extensions/third-party/';
    assert.equal(isRequiredCardResource('/desktop/assets/app-ABC.js', 'script'), true);
    assert.equal(isRequiredCardResource(base + 'vc-model-settings/desktop/standalone/cards/ejs-worker.js', 'other'), true);
    assert.equal(isRequiredCardResource(base + 'vc-model-settings/desktop/locked-source/st/lib.js', 'fetch'), true);
    assert.equal(isRequiredCardResource(base + 'JS-Slash-Runner/lib/vendor/jquery-ui-1.14.2/theme.css', 'stylesheet'), true);
    assert.equal(isRequiredCardResource('/user/files/mvu-bundle-d03b7dc8.js', 'fetch'), true);
    assert.equal(isRequiredCardResource('/characters/card.png', 'image'), false);
});
