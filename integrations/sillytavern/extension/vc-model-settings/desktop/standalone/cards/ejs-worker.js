// 与锁定EJS compileTemplate的原消息协议相同，直接用其原库编译client函数。
// 上游发布树缺少调用者指定的 ejs.workers.js；这里不加载任何页面或宿主模块。
importScripts('/scripts/extensions/third-party/ST-Prompt-Template/src/3rdparty/ejs.js');
self.onmessage = ({ data: { id, template, options } }) => {
    try { self.postMessage({ id, code: self.ejs.compile(template, options).toString() }); }
    catch (error) { self.postMessage({ id, error: error.message }); }
};
