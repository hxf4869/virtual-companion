import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';

export function App() {
    useEffect(() => {
        document.documentElement.dataset.vcApp = 'booting';
    }, []);
    return (
        <div data-vc-app="booting">
            <p id="vc-desktop-startup" role="status">正在打开聊天…</p>
        </div>
    );
}

export function mountApp(container: HTMLElement | null = typeof document !== 'undefined' ? document.getElementById('root') : null) {
    if (typeof document !== 'undefined') {
        document.documentElement.dataset.vcApp = 'booting';
    }
    if (!container) return null;
    const root = createRoot(container);
    root.render(<App />);
    return root;
}

if (typeof document !== 'undefined') {
    mountApp();
}
