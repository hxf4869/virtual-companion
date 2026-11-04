// 聊天与记忆页共享的既有状态和打开事件，不加载页面视图。
export {
    FORGET_NOTICE,
    MEMORY_EMPTY_DIALOG,
    MEMORY_EMPTY_TAB,
    OPEN_MEMORY_EVENT,
    OPEN_MESSAGE_EVENT,
    bindOpenMemory,
    requestOpenMemory,
    idOf,
    canEdit,
    errorText,
    createMemoryPage,
} from './memory-logic.js';
