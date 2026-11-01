<script>
import { startTheme } from './theme/store.mjs';
import { startEngine } from './engine/index.mjs';

export default {
    onLaunch() {
        // 先用本机缓存的主题上色，同时在后台启动引擎；就绪后与服务器设置对齐。
        startTheme();
        // #ifdef H5
        startEngine().catch(() => { /* 状态与错误已写入 engineState，由界面显示 */ });
        // #endif
    },
};
</script>
