import './react-dom-bootstrap.mjs';
import { stickerViewProps } from '../extension/vc-model-settings/stickers.js';
import { mountStickerContentsView } from '../extension/vc-model-settings/desktop/build/index.js';
export function renderStickerPage(doc, options, t) {
    const page = doc.createElement('div'); page.className = 'vc-sticker-page'; page.setAttribute('data-vc-sticker-page', ''); doc.body.append(page);
    const view = mountStickerContentsView(page, stickerViewProps(options));
    t.after(() => { view.unmount(); page.remove(); });
    return page;
}
