// 收集浏览器 pageerror。结束时非空即失败，不把页面正文写进错误。

export function trackPageErrors(page) {
    const errors = [];
    page.on('pageerror', (error) => {
        errors.push(String(error?.message || 'pageerror').slice(0, 180));
    });
    return {
        errors,
        assertNone() {
            if (errors.length) throw new Error(`页面错误 ${errors.length}`);
        },
    };
}
