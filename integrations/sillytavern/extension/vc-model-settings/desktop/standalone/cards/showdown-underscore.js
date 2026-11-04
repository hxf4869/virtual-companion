// AGPL-3.0-only. SillyTavern 7e8663cd9 / scripts/showdown-underscore.js
// 保留本地拷贝：原生HTTP ESM诊断路径与Node/Vite消费者共同使用，不能直接引用仓库文件系统upstream路径。
// Showdown extension that replaces words surrounded by singular underscores with <em> tags
export const markdownUnderscoreExt = () => {
    try {
        if (!canUseNegativeLookbehind()) {
            console.log('Showdown-underscore extension: Negative lookbehind not supported. Skipping.');
            return [];
        }

        return [{
            type: 'output',
            regex: new RegExp('(<code(?:\\s+[^>]*)?>[\\s\\S]*?<\\/code>|<style(?:\\s+[^>]*)?>[\\s\\S]*?<\\/style>)|\\b(?<!_)_(?!_)(.*?)(?<!_)_(?!_)\\b', 'gi'),
            replace: function (match, tagContent, italicContent) {
                if (tagContent) {
                    // If it's inside <code> or <style> tags, return unchanged
                    return match;
                } else if (italicContent) {
                    // If it's an italic group, apply the replacement
                    return '<em>' + italicContent + '</em>';
                }
                // If none of the conditions are met, return the original match
                return match;
            },
        }];
    } catch (e) {
        console.error('Error in Showdown-underscore extension:', e);
        return [];
    }
};

function canUseNegativeLookbehind() {
    try {
        new RegExp('(?<!_)');
        return true;
    } catch (e) {
        return false;
    }
}
