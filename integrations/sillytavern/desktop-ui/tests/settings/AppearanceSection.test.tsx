import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { AppProviders } from '../../src/app/providers';
import { PINNED_CONVERSATIONS_KEY, usePreferences } from '../../src/shell/usePreferences';
import { createTestChatEnv } from '../chat/fixtures';
import {
  AppearanceSection,
  type AppearanceThemeOption,
} from '../../src/features/settings/AppearanceSection';

const TEST_THEMES = [
  { id: 'aurora', name: '极光' },
  { id: 'warm-paper', name: '暖纸' },
  { id: 'midnight-ink', name: '夜墨' },
] as const;

function DesktopAppearanceHarness({ themes }: { themes?: readonly AppearanceThemeOption[] }) {
  const preferences = usePreferences();
  return <AppearanceSection preferences={preferences} themes={themes} />;
}

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

  it('does not import desktop shell directly and updates injected preferences state', () => {
    const src = readFileSync(
      resolve(__dirname, '../../src/features/settings/AppearanceSection.tsx'),
      'utf8',
    );
    expect(src).not.toMatch(/from\s+['"][^'"]*\/shell\//);
    expect(src).not.toMatch(/@tanstack\/react-router/);
    expect(src).not.toMatch(/writeThemeMode|readThemeMode|readThemePreferences|dataset\.vcTheme/);
    expect(src).not.toMatch(/fallbackThemeMode|readReplyStyleFallback|readReducedMotionFallback/);

    const env = createTestChatEnv();
    render(
      <AppProviders client={env.client} queryClient={env.queryClient} sessionBridge={env.bridge}>
        <DesktopAppearanceHarness themes={TEST_THEMES} />
      </AppProviders>,
    );

    fireEvent.click(screen.getByRole('radio', { name: '深色' }));
    expect(usePreferences.getState().themeMode).toBe('dark');

    fireEvent.click(screen.getByRole('radio', { name: '铺开' }));
    expect(usePreferences.getState().replyStyle).toBe('spread');

    fireEvent.click(screen.getByRole('switch', { name: '减弱动态效果' }));
    expect(usePreferences.getState().reducedMotion).toBe(true);
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
        <DesktopAppearanceHarness themes={TEST_THEMES} />
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
        <DesktopAppearanceHarness themes={TEST_THEMES} />
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

  it('manages pinnedConversationKeys in usePreferences with localStorage persistence, syncFromStorage, resetForTest, and in-memory fallback when storage throws', () => {
    expect(PINNED_CONVERSATIONS_KEY).toBe('vc-pinned-conversations');
    expect(usePreferences.getState().pinnedConversationKeys).toEqual([]);

    const keyAlice = '["alice.png","chat-alice"]';
    const keyBob = '["bob.png","chat-bob"]';
    const initialThemeAttr = document.documentElement.dataset.vcTheme;
    const initialThemeIdAttr = document.documentElement.dataset.vcThemeId;

    // 1. Toggle pins on and persists to independent localStorage key
    act(() => {
      usePreferences.getState().togglePinnedConversation(keyAlice);
    });
    expect(usePreferences.getState().pinnedConversationKeys).toEqual([keyAlice]);
    expect(JSON.parse(window.localStorage.getItem(PINNED_CONVERSATIONS_KEY) || '[]')).toEqual([
      keyAlice,
    ]);

    act(() => {
      usePreferences.getState().togglePinnedConversation(keyBob);
    });
    expect(usePreferences.getState().pinnedConversationKeys).toEqual([keyAlice, keyBob]);
    expect(JSON.parse(window.localStorage.getItem(PINNED_CONVERSATIONS_KEY) || '[]')).toEqual([
      keyAlice,
      keyBob,
    ]);

    // Toggling existing key unpins it
    act(() => {
      usePreferences.getState().togglePinnedConversation(keyAlice);
    });
    expect(usePreferences.getState().pinnedConversationKeys).toEqual([keyBob]);
    expect(JSON.parse(window.localStorage.getItem(PINNED_CONVERSATIONS_KEY) || '[]')).toEqual([
      keyBob,
    ]);

    // Desktop DOM attributes must not change
    expect(document.documentElement.dataset.vcTheme).toBe(initialThemeAttr);
    expect(document.documentElement.dataset.vcThemeId).toBe(initialThemeIdAttr);

    // 2. syncFromStorage reads back persisted keys and sanitizes invalid entries
    const keyClaire = '["claire.png","chat-claire"]';
    window.localStorage.setItem(
      PINNED_CONVERSATIONS_KEY,
      JSON.stringify([keyClaire, keyAlice, keyClaire, '', null]),
    );
    act(() => {
      usePreferences.getState().syncFromStorage();
    });
    expect(usePreferences.getState().pinnedConversationKeys).toEqual([keyClaire, keyAlice]);

    // resetForTest syncs from cleared storage
    window.localStorage.clear();
    act(() => {
      usePreferences.getState().resetForTest?.();
    });
    expect(usePreferences.getState().pinnedConversationKeys).toEqual([]);

    // 3. Fallback to in-memory state when localStorage throws on read/write
    const origStorageDesc = Object.getOwnPropertyDescriptor(window, 'localStorage');
    const throwingStorage = {
      getItem() {
        throw new Error('SecurityError: storage read blocked');
      },
      setItem() {
        throw new Error('QuotaExceededError: storage write blocked');
      },
      removeItem() {
        throw new Error('SecurityError');
      },
      clear() {},
      key() {
        return null;
      },
      length: 0,
    } as Storage;

    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: throwingStorage,
    });
    try {
      act(() => {
        usePreferences.getState().togglePinnedConversation(keyAlice);
      });
      expect(usePreferences.getState().pinnedConversationKeys).toEqual([keyAlice]);

      // syncFromStorage during storage failure must preserve in-memory pinned state
      act(() => {
        usePreferences.getState().syncFromStorage('alice.png');
      });
      expect(usePreferences.getState().pinnedConversationKeys).toEqual([keyAlice]);

      act(() => {
        usePreferences.getState().togglePinnedConversation(keyAlice);
      });
      expect(usePreferences.getState().pinnedConversationKeys).toEqual([]);
    } finally {
      if (origStorageDesc) {
        Object.defineProperty(window, 'localStorage', origStorageDesc);
      }
    }
  });
});
