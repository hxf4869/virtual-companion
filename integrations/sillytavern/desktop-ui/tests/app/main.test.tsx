import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from '../../src/app/main';

describe('desktop app entry', () => {
    beforeEach(() => {
        delete document.documentElement.dataset.vcApp;
    });

    it('renders startup status then app root', () => {
        render(<App />);
        const status = screen.getByRole('status');
        expect(status.textContent).toBe('正在打开聊天…');
        expect(document.documentElement.dataset.vcApp).toBe('booting');
    });
});
