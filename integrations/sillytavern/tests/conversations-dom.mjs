import { bootstrapDocument as doc } from './react-dom-bootstrap.mjs';
import { conversationViewItems } from '../extension/vc-model-settings/conversations.js';
import { mountConversationsView } from '../extension/vc-model-settings/desktop/build/index.js';
export function renderConversationRows(rows) {
    const host = doc.createElement('div'); doc.body.append(host);
    const view = mountConversationsView(host, { rows: conversationViewItems(rows), status: 'ready', sprite: '/icons.svg' });
    try { return host.innerHTML; } finally { view.unmount(); host.remove(); }
}
export const renderConversationRow = row => renderConversationRows([row]);
