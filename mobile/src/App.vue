<script>
import { startTheme } from './theme/store.mjs';

export default {
    onLaunch() {
        // 先用本机缓存的主题上色；服务器设置在引擎就绪后对齐（MB-3）。
        startTheme();
    },
};
</script>
