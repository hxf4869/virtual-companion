// 字符串合同读取真实 React 挂载；不在生产保留旧 renderer 或全表单 DOM 解析器。
import { bootstrapDocument } from './react-dom-bootstrap.mjs';
import {
    mountInboxListView,
    mountInboxContentsView,
    mountInboxChannelView,
} from '../extension/vc-model-settings/desktop/build/index.js';
import { createInboxPage, inboxViewProps } from '../extension/vc-model-settings/inbox-page.js';
import { createVoiceBubble } from '../extension/vc-model-settings/voice.js';
function render(state, kind, channelKey) {
    const host = bootstrapDocument.createElement('div');
    bootstrapDocument.body.append(host);
    const initial = createInboxPage().state;
    const current = { ...initial, ...state, reauth: { ...initial.reauth, ...state.reauth } };
    const events = {
        action() {},
        policy() {},
        channel() {},
        relationship() {},
        filter() {},
        mode() {},
        authenticate() {},
        layerDismiss() {},
        returnFocus: () => null,
        readSecret: (key) => current.channelDrafts.find((row) => row.key === key)?.credential || '',
        voice: (id) => {
            const item = current.inbox.find((row) => row.eventId === id);
            return item?.voice
                ? createVoiceBubble({ document: bootstrapDocument, text: item.body, voice: item.voice })
                : null;
        },
    };
    const props = inboxViewProps(current, host, events);
    const view =
        kind === 'page'
            ? mountInboxContentsView(host, props)
            : kind === 'channel'
              ? mountInboxChannelView(host, { ...props, channelKey })
              : mountInboxListView(host, props);
    try {
        return kind === 'tab' ? host.querySelector('.vc-scroll > .vc-column').outerHTML : host.innerHTML;
    } finally {
        view.unmount();
        host.remove();
    }
}
export const renderInboxPage = (state) => render(state, 'page');
export const renderInboxTab = (state) => render(state, 'tab');
export const renderInboxChannel = (state, key) => render(state, 'channel', key);
