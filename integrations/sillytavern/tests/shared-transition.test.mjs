import assert from 'node:assert/strict';
import test from 'node:test';

// 浏览器推迟视图过渡回调时（后台窗口 / 渲染被节流），宽限期后跳过动画直接更新，且只更新一次。
test('共享元素过渡：回调迟迟不开始时宽限后直接更新且只执行一次', async () => {
    globalThis.matchMedia = () => ({ matches: false });
    let pending = null;
    let skipped = false;
    const doc = {
        visibilityState: 'visible',
        documentElement: { dataset: { vcLayout: 'desktop', vcReducedMotion: 'false' } },
        startViewTransition(callback) {
            pending = callback;
            return { finished: new Promise(() => {}), skipTransition() { skipped = true; } };
        },
    };
    globalThis.document = doc;
    const { sharedTransition, TRANSITION_START_GRACE_MS } = await import('../extension/vc-model-settings/desktop/transition.js');
    let updates = 0;
    void sharedTransition(() => { updates += 1; }, { from: { ownerDocument: doc, style: {} } });
    assert.equal(updates, 0);
    await new Promise((resolve) => setTimeout(resolve, TRANSITION_START_GRACE_MS + 30));
    assert.equal(updates, 1);
    assert.equal(skipped, true);
    await pending();
    assert.equal(updates, 1, '浏览器之后再调用回调也不重复更新');
});

test('共享元素过渡：页面隐藏时直接同步更新', async () => {
    globalThis.matchMedia = () => ({ matches: false });
    const doc = { visibilityState: 'hidden', documentElement: { dataset: { vcLayout: 'desktop' } }, startViewTransition() { throw new Error('不应调用'); } };
    globalThis.document = doc;
    const { sharedTransition } = await import('../extension/vc-model-settings/desktop/transition.js');
    let updates = 0;
    await sharedTransition(() => { updates += 1; }, { from: { ownerDocument: doc, style: {} } });
    assert.equal(updates, 1);
});
