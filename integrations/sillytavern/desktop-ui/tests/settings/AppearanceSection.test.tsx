import React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { AppProviders } from '../../src/app/providers';
import { usePreferences } from '../../src/shell/usePreferences';
import { createTestChatEnv } from '../chat/fixtures';
import { AppearanceSection } from '../../src/features/settings/AppearanceSection';

const TEST_THEMES = [
  { id: 'aurora', name: '极光' },
  { id: 'warm-paper', name: '暖纸' },
  { id: 'midnight-ink', name: '夜墨' },
] as const;

describe('AppearanceSection', () => {
  beforeEach(() => {
    window.localStorage.clear();
    usePreferences.getState().resetForTest?.();
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    usePreferences.getState().resetForTest?.();
  });

  it('character theme targets current conversation character after switching', async () => {
    const env = createTestChatEnv({
      conversations: [
        {
          key: '["alice.png","chat-alice"]',
          avatar: 'alice.png',
          file: 'chat-alice',
          title: 'Alice',
          relationshipId: 'rel-alice',
          characterRef: 'char-ref-alice',
        },
        {
          key: '["bob.png","chat-bob"]',
          avatar: 'bob.png',
          file: 'chat-bob',
          title: 'Bob',
          relationshipId: 'rel-bob',
          characterRef: 'char-ref-bob',
        },
      ],
    });

    // Open conversation 1 (Alice)
    await act(async () => {
      await env.bridge.open({ avatar: 'alice.png', file: 'chat-alice' });
    });

    const { unmount } = render(
      <AppProviders client={env.client} queryClient={env.queryClient} sessionBridge={env.bridge}>
        <AppearanceSection themes={TEST_THEMES} />
      </AppProviders>,
    );

    // Select character theme for Alice
    const aliceThemeSelect = screen.getByLabelText('当前角色主题') as HTMLSelectElement;
    expect(aliceThemeSelect.value).toBe('');
    fireEvent.change(aliceThemeSelect, { target: { value: 'warm-paper' } });

    expect(usePreferences.getState().desktopThemePrefs.characters['char-ref-alice']).toBe(
      'warm-paper',
    );

    // Unmount AppearanceSection, switch active conversation to Bob, and re-enter AppearanceSection (B11)
    unmount();

    await act(async () => {
      await env.bridge.open({ avatar: 'bob.png', file: 'chat-bob' });
    });

    render(
      <AppProviders client={env.client} queryClient={env.queryClient} sessionBridge={env.bridge}>
        <AppearanceSection themes={TEST_THEMES} />
      </AppProviders>,
    );

    await waitFor(() => {
      const bobThemeSelect = screen.getByLabelText('当前角色主题') as HTMLSelectElement;
      expect(bobThemeSelect.value).toBe('');
    });

    // Selecting character theme now must target Bob ('char-ref-bob'), NOT Alice
    const bobThemeSelect = screen.getByLabelText('当前角色主题') as HTMLSelectElement;
    fireEvent.change(bobThemeSelect, { target: { value: 'midnight-ink' } });

    const prefs = usePreferences.getState().desktopThemePrefs;
    expect(prefs.characters['char-ref-bob']).toBe('midnight-ink');
    expect(prefs.characters['char-ref-alice']).toBe('warm-paper');
  });
});
