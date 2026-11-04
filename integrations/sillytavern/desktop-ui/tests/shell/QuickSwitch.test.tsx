import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { QuickSwitch, type QuickSwitchItem } from '../../src/shell/QuickSwitch';

const SAMPLE_ITEMS: QuickSwitchItem[] = [
  {
    key: 'conv-alice',
    title: '艾莉丝 Alice',
    preview: '今晚去看星星吗？',
    avatar: 'alice.png',
    relationshipId: 'rel-alice',
  },
  {
    key: 'conv-lin',
    title: '林深 Lin',
    preview: '咖啡已经煮好了。',
    avatar: 'lin.png',
    relationshipId: 'rel-lin',
  },
];

describe('QuickSwitch (cmdk)', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('Ctrl+K opens, typing filters conversations, Enter navigates', async () => {
    const onSelectConversation = vi.fn();

    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <div>
          <QuickSwitch
            open={open}
            onOpenChange={setOpen}
            items={SAMPLE_ITEMS}
            onSelect={(item) => {
              onSelectConversation(item.key);
              setOpen(false);
            }}
          />
        </div>
      );
    }

    render(<Harness />);

    expect(document.getElementById('vc-quick-switch')).toBeNull();

    // Press Ctrl+K -> opens QuickSwitch
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });

    const input = (await screen.findByPlaceholderText('搜索会话')) as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(document.getElementById('vc-quick-switch')).toBeTruthy();

    // Both items initially visible
    expect(screen.getByText('艾莉丝 Alice')).toBeTruthy();
    expect(screen.getByText('林深 Lin')).toBeTruthy();

    // Typing filters conversations
    fireEvent.change(input, { target: { value: '林深' } });

    await waitFor(() => {
      expect(screen.queryByText('艾莉丝 Alice')).toBeNull();
      expect(screen.getByText('林深 Lin')).toBeTruthy();
    });

    // Pressing Enter selects the filtered conversation and navigates
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    await waitFor(() => {
      expect(onSelectConversation).toHaveBeenCalledWith('conv-lin');
    });
  });
});
