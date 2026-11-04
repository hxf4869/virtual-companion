import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AlertDialog } from '../../src/design/components/AlertDialog';
import { Button } from '../../src/design/components/Button';
import { Dialog } from '../../src/design/components/Dialog';

afterEach(() => {
  cleanup();
});

describe('AlertDialog & Dialog (DR2-3)', () => {
  it('Esc cancels, defaults initial focus to primary safe cancel button, styles danger confirm as danger-soft, and returns focus to trigger', async () => {
    const onConfirm = vi.fn();

    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <div>
          <Button onClick={() => setOpen(true)}>删除对话</Button>
          <AlertDialog
            open={open}
            onOpenChange={setOpen}
            title="确认删除该对话？"
            description="删除后无法恢复历史消息。"
            cancelLabel="取消"
            confirmLabel="确认删除"
            danger
            onConfirm={onConfirm}
          />
        </div>
      );
    }

    render(<Harness />);

    const trigger = screen.getByRole('button', { name: '删除对话' });
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).not.toBeNull();
    expect(screen.getByText('确认删除该对话？')).not.toBeNull();
    expect(screen.getByText('删除后无法恢复历史消息。')).not.toBeNull();

    const cancelBtn = screen.getByRole('button', { name: '取消' });
    const confirmBtn = screen.getByRole('button', { name: '确认删除' });

    // DESIGN §16.5: Safe cancel is primary filled button and receives initial focus; danger confirm is danger-soft
    expect(cancelBtn.className).toContain('vc-btn--filled');
    expect(confirmBtn.className).toContain('vc-btn--danger-soft');
    await waitFor(() => {
      expect(document.activeElement).toBe(cancelBtn);
    });

    fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    expect(onConfirm).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(document.activeElement).toBe(trigger);
    });
  });

  it('invokes onConfirm and closes when confirm button is clicked', async () => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();

    render(
      <AlertDialog
        open
        onOpenChange={onOpenChange}
        title="清空缓存？"
        cancelLabel="取消"
        confirmLabel="清空"
        danger
        onConfirm={onConfirm}
      />,
    );

    const confirmBtn = await screen.findByRole('button', { name: '清空' });
    fireEvent.click(confirmBtn);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('renders Dialog with configured width tier and actions', async () => {
    const onOpenChange = vi.fn();
    render(
      <Dialog
        open
        onOpenChange={onOpenChange}
        title="新建供应商"
        width={560}
        className="custom-dialog"
        actions={<Button variant="filled">保存</Button>}
      >
        <div>表单内容</div>
      </Dialog>,
    );

    const dialog = await screen.findByRole('dialog');
    expect(dialog.className).toContain('vc-dialog');
    expect(dialog.className).toContain('custom-dialog');
    expect(dialog.getAttribute('data-width')).toBe('560');
    expect(dialog.style.width).toBe('');
    expect(screen.getByText('新建供应商')).not.toBeNull();
    expect(screen.getByText('表单内容')).not.toBeNull();
    expect(screen.getByRole('button', { name: '保存' })).not.toBeNull();
  });
});
