// UX-33 记忆页「日记」：按天的日期条 + 纸张卡片。只在桌面记忆页里由 memory-page.js 挂载。
// 数据来自 Go：每个关系每天至多一篇，按月读取；字体偏好只存本机。
export {
    DIARY_FONT_KEY,
    DIARY_FONTS,
    DIARY_EMPTY,
    DIARY_MOMENTS,
    DIARY_FONT_BUTTON,
    localDay,
    monthOfDay,
    shiftMonth,
    monthDays,
    monthLabel,
    diaryDayTitle,
    readDiaryFont,
    writeDiaryFont,
    ensureHandwriting,
    createDiaryPage,
} from './memory-logic.js';
