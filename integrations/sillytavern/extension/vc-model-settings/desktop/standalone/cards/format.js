// 桌面消息格式化薄端口：绑定当前会话 regex/accountStorage/toastr/t，复用 locked-source 上游实现。
import {
    converter,
    mesForShowdownParse,
    systemUserName,
    reloadMarkdownProcessor,
    messageFormatting,
} from '../../locked-source/st/scripts/desktop-formatting.js';
import {
    encodeStyleTags,
    decodeStyleTags,
    getCurrentEntityId,
    isExternalMediaAllowed,
    addDOMPurifyHooks,
} from '../../locked-source/st/scripts/chats.js';
import {
    formatting_stage,
    hook_order,
    MessageFormatter,
} from '../../locked-source/st/scripts/message-formatter.js';

export let getRegexedString, regex_placement, accountStorage, toastr, t;

export const renderMarkdown = text => converter.makeHtml(String(text ?? ''));

export function configureFormatting(options) {
    ({ getRegexedString, regex_placement, accountStorage, toastr, t } = options);
    reloadMarkdownProcessor();
    addDOMPurifyHooks();
    return { messageFormatting, reloadMarkdownProcessor };
}

export {
    converter,
    mesForShowdownParse,
    systemUserName,
    reloadMarkdownProcessor,
    messageFormatting,
    encodeStyleTags,
    decodeStyleTags,
    getCurrentEntityId,
    isExternalMediaAllowed,
    addDOMPurifyHooks,
    formatting_stage,
    hook_order,
    MessageFormatter,
};
