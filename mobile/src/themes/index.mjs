// 主题注册表：加主题 = 新增一个主题文件并在这里登记，不改页面代码（ADR-0011 §7.1）。
import aurora from './aurora.mjs';

export const THEMES = [aurora];
export const DEFAULT_THEME_ID = 'aurora';
