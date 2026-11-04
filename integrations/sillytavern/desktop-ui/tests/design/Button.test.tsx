import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Avatar } from '../../src/design/components/Avatar';
import { Button } from '../../src/design/components/Button';
import { EmptyState } from '../../src/design/components/EmptyState';
import { Icon } from '../../src/design/components/Icon';
import { IconButton } from '../../src/design/components/IconButton';
import { Spinner } from '../../src/design/components/Spinner';

afterEach(() => {
  cleanup();
});

describe('Button & basic display primitives (DR2-3)', () => {
  it('pending keeps width and shows spinner', () => {
    const onClick = vi.fn();
    const { rerender } = render(
      <Button variant="filled" onClick={onClick}>
        保存设置
      </Button>,
    );

    const button = screen.getByRole('button', { name: '保存设置' }) as HTMLButtonElement;
    vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({
      width: 116,
      height: 36,
      top: 0,
      left: 0,
      bottom: 36,
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

    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.style.width).toBe('116px');
    expect(button.querySelector('.vc-spinner')).not.toBeNull();

    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
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
