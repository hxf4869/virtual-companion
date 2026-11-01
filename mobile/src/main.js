import { createSSRApp } from 'vue';
import App from './App.vue';
import './styles/base.css';

export function createApp() {
    // uni-app 的 button 在 H5 渲染为 uni-button，自定义元素需要显式键盘激活。
    // #ifdef H5
    document.addEventListener('keydown', (event) => {
        const button = event.target?.closest?.('uni-button[role="button"]');
        if (!button || !['Enter', ' '].includes(event.key) || button.hasAttribute('disabled')) return;
        event.preventDefault(); button.click();
    });
    // #endif
    const app = createSSRApp(App);
    return { app };
}
