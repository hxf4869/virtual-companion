import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Avatar } from '../../src/design/components/Avatar';
import { Button } from '../../src/design/components/Button';
import { EmptyState } from '../../src/design/components/EmptyState';
import { Icon } from '../../src/design/components/Icon';
import { IconButton } from '../../src/design/components/IconButton';
import { Spinner } from '../../src/design/components/Spinner';

const BUTTON_CSS_PATH = resolve(__dirname, '../../src/design/components/Button.css');

afterEach(() => {
  cleanup();
});

describe('Button & basic display primitives (DR2-3)', () => {
  it('pending keeps width, retains accessible name/text, and prepends 16px spinner', () => {
    const onClick = vi.fn();
    const { rerender } = render(
      <Button variant="filled" onClick={onClick}>
        保存设置
      </Button>,
    );

    const buttonBefore = screen.getByRole('button', { name: '保存设置' }) as HTMLButtonElement;
    expect(buttonBefore.textContent).toBe('保存设置');
    vi.spyOn(buttonBefore, 'getBoundingClientRect').mockReturnValue({
      width: 116,
      height: 40,
      top: 0,
      left: 0,
      bottom: 40,
      right: 116,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    rerender(
      <Button variant="filled" pending onClick={onClick}>
        保存设置
      </Button>,
    );

    const buttonAfter = screen.getByRole('button', { name: '保存设置' }) as HTMLButtonElement;
    expect(buttonAfter).toBe(buttonBefore);
    expect(buttonAfter.disabled).toBe(true);
    expect(buttonAfter.getAttribute('aria-busy')).toBe('true');
    expect(buttonAfter.style.width).toBe('116px');
    expect(buttonAfter.textContent).toContain('保存设置');

    const spinner = buttonAfter.querySelector('.vc-spinner');
    expect(spinner).not.toBeNull();
    expect(spinner?.getAttribute('width')).toBe('16');
    expect(buttonAfter.firstElementChild).toBe(spinner);

    fireEvent.click(buttonAfter);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('matches DESIGN §16.4 button geometry and material specs', () => {
    const buttonCss = readFileSync(BUTTON_CSS_PATH, 'utf8');
    expect(buttonCss).toContain('height: 40px');
    expect(buttonCss).toContain('border-radius: var(--vc-radius-pill)');
    expect(buttonCss).toContain('font-weight: 600');
    expect(buttonCss).toContain('min-width: 88px');
    expect(buttonCss).toContain('max-width: 176px');
    expect(buttonCss).toContain('padding: 0 20px');
    expect(buttonCss).toContain('var(--vc-button-fill)');
    expect(buttonCss).toContain('var(--vc-button-danger-fill)');
    expect(buttonCss).toContain('scale(0.96)');
    expect(buttonCss).toContain('opacity: 0.4');
    expect(buttonCss).toContain('box-shadow: none');
  });

  it('supports variants, sizes, and className pass-through on Button and IconButton', () => {
    render(
      <div>
        <Button variant="danger" size="sm" className="custom-btn">
          删除
        </Button>
        <IconButton icon="settings" aria-label="打开设置" className="custom-icon-btn" />
      </div>,
    );

    const btn = screen.getByRole('button', { name: '删除' });
    expect(btn.className).toContain('vc-btn');
    expect(btn.className).toContain('vc-btn--danger');
    expect(btn.className).toContain('vc-btn--sm');
    expect(btn.className).toContain('custom-btn');

    const iconBtn = screen.getByRole('button', { name: '打开设置' });
    expect(iconBtn.className).toContain('vc-icon-button');
    expect(iconBtn.className).toContain('custom-icon-btn');
  });

  it('renders EmptyState with 48px icon box, 17/600 title, optional secondary action, and no secondary description', () => {
    const onAction = vi.fn();
    const { container } = render(
      <EmptyState
        icon="sparkles"
        title="暂无记忆条目"
        actionLabel="新建记忆"
        actionIcon="plus"
        onAction={onAction}
        className="custom-empty"
      />,
    );

    const root = container.querySelector('.vc-empty-state');
    expect(root?.className).toContain('custom-empty');
    expect(screen.getByText('暂无记忆条目')).not.toBeNull();

    const actionBtn = screen.getByRole('button', { name: '新建记忆' });
    fireEvent.click(actionBtn);
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('renders Avatar, Icon, and Spinner with className pass-through', () => {
    const { container } = render(
      <div>
        <Avatar name="林汐" size={40} glow className="custom-avatar" />
        <Icon name="check" size={18} className="custom-icon" />
        <Spinner size={16} className="custom-spinner" />
      </div>,
    );

    expect(container.querySelector('.vc-avatar.custom-avatar')).not.toBeNull();
    expect(container.querySelector('.vc-icon.custom-icon')).not.toBeNull();
    expect(container.querySelector('.vc-spinner.custom-spinner')).not.toBeNull();
    expect(screen.getByText('林')).not.toBeNull();
  });
});
