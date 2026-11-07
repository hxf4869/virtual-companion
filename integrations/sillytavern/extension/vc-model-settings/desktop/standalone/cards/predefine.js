// Vendor-adapted from JS-Slash-Runner 0af421068 / src/iframe/predefine.js
// 保留本地拷贝：维持 B6 过期 iframe 守卫（将 _bind 绑定后的方法同步覆盖至 window.TavernHelper 并用 /^_/ 仅替换前缀）及离线单测源码校验。
window._ = window.parent._;
const iframeId = window.frameElement?.id || window.name;
if (iframeId) {
  // Cache the iframe id in case frameElement disappears (e.g., Firefox removing srcdoc iframes on navigation)
  // and also put it on window.name so it survives DOM removal.
  window.__TH_IFRAME_ID = iframeId;
  if (!window.name) {
    window.name = iframeId;
  }
}
const parentHelper = _.get(window.parent, 'TavernHelper');
const { _createRawCharacter, ...frameMethods } = parentHelper._bind;
const boundMethods = Object.fromEntries(
  Object.entries(frameMethods).map(([key, value]) => [key.replace(/^_/, ''), value.bind(window)]),
);
boundMethods.RawCharacter = _createRawCharacter.call(window);
let result = _(window);
result = result.merge(_.pick(window.parent, ['EjsTemplate', 'YAML', 'showdown', 'toastr', 'z']));
result = result.merge(_.omit(parentHelper, '_bind'));
result = result.merge(boundMethods);
result.value();
window.TavernHelper = {
  ..._.omit(parentHelper, '_bind'),
  ...boundMethods,
  _bind: parentHelper._bind,
};

// pinia 4.0.0+ 必须设置这个, 考虑到影响了非常多脚本/前端, 直接在这里统一设置
_.set(window, '__VUE_PROD_DEVTOOLS__', true);  // 不使用 vue devtools 时不会有性能开销, 默认启用即可
_.set(window, '__VUE_OPTIONS_API__', true);
_.set(window, '__VUE_PROD_HYDRATION_MISMATCH_DETAILS__', false);

Object.defineProperty(window, 'SillyTavern', {
  get: () => {
    const SillyTavern = _.get(window.parent, 'SillyTavern');
    const getContext = () => {
      return { ...SillyTavern.getContext(), writeExtensionField: _th_impl.writeExtensionField };
    };
    return { ...getContext(), getContext };
  },
});

// 其实应该用 waitGlobalInitialized 来等待 Mvu 初始化完毕, 这里设置 window.Mvu 只是为了兼容性
if (_.has(window.parent, 'Mvu')) {
  Object.defineProperty(window, 'Mvu', {
    get: () => _.get(window.parent, 'Mvu'),
    // Mvu 脚本自己还会 `_.set()` 自己的变量, 所以这里设置一个空 set
    set: () => {},
    configurable: true,
  });
}

$(window).on('pagehide', () => {
  eventClearAll();
});
