import { installReactDom } from './react-dom.mjs';

// 账户组件的真实 DOM 夹具；关闭敏感流程后再释放 Window，保留原生表单语义。
export async function accountFixture(t, { vc = false } = {}) {
    let cleanup;
    const document = installReactDom({ after: fn => { cleanup = fn; } });
    if (vc) document.body.classList.add('vc-ui');
    const { mountDataRights } = await import('../extension/vc-model-settings/data-rights.js');
    const account = mountDataRights();
    const root = document.querySelector('.vc-data-root');
    t.after(async () => { account.destroy(); await cleanup(); });
    return { document, account, root };
}
