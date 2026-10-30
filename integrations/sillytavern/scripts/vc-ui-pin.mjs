// 在页面脚本读取 vc-ui 之前写入开关。只接受 on / off。
export async function pinVcUi(context, value) {
    const flag = value === 'off' ? 'off' : 'on';
    await context.addInitScript((stored) => {
        try { localStorage.setItem('vc-ui', stored); } catch { /* 打开页面前写失败时不中断场景 */ }
    }, flag);
}
