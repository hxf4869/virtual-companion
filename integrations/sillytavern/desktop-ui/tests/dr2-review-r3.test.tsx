import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { AppProviders, createQueryClient } from '../src/app/providers';
import { createDesktopRouter } from '../src/app/router';
import { RouterProvider } from '@tanstack/react-router';
import type { AppClient } from '../src/data/client';
import { Diary } from '../src/features/memory/Diary';
import { CharactersRoute } from '../src/features/characters/CharactersRoute';
import { createSessionBridge } from '../src/runtime/session-bridge';
import { MemoryRoute } from '../src/features/memory/MemoryRoute';
import { PolicyForm } from '../src/features/inbox/PolicyForm';
import { InboxList } from '../src/features/inbox/InboxList';
import { InboxRoute } from '../src/features/inbox/InboxRoute';
import { FILTERS } from '../../extension/vc-model-settings/inbox-logic.js';
import { StoryList } from '../src/features/story/StoryList';
import { Stage } from '../src/features/story/Stage';
import { createStoryTestEnv, createStoryTestView } from './story/fixtures';

const SRC_DIR = resolve(__dirname, '../src/features');

function readFeatureCss(relPath: string): string {
  return readFileSync(resolve(SRC_DIR, relPath), 'utf8');
}

function extractRuleBlock(css: string, selectorPattern: RegExp): string {
  const match = selectorPattern.exec(css);
  if (!match) return '';
  const openIdx = css.indexOf('{', match.index);
  if (openIdx === -1) return '';
  let depth = 0;
  for (let i = openIdx; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        return css.slice(openIdx + 1, i);
      }
    }
  }
  return '';
}

describe('DR2-12-R3 regressions (F11, F12, F14, F15, F16, F17, F23)', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('F11: characters.css and story.css do not cover outer .vc-panel glass with opaque var(--vc-canvas)', () => {
    const charactersCss = readFeatureCss('characters/characters.css');
    const storyCss = readFeatureCss('story/story.css');

    const charactersRouteBlock = extractRuleBlock(
      charactersCss,
      /\.vc-characters-route\s*\{/,
    );
    const storyTabBlock = extractRuleBlock(storyCss, /\.vc-story-tab\s*\{/);

    expect(charactersRouteBlock).toBeTruthy();
    expect(charactersRouteBlock).not.toMatch(/background\s*:\s*var\(--vc-canvas\)/);
    expect(charactersRouteBlock).toMatch(/background\s*:\s*transparent/);

    expect(storyTabBlock).toBeTruthy();
    expect(storyTabBlock).not.toMatch(/background\s*:\s*var\(--vc-canvas\)/);
    expect(storyTabBlock).toMatch(/background\s*:\s*transparent/);
  });

  it('F12: characters.css does not rely on self-targeting @container vc-characters on .vc-characters-route and keeps narrow overlay reachable', async () => {
    const charactersCss = readFeatureCss('characters/characters.css');

    // A container cannot match @container vc-characters on itself (.vc-characters-route).
    const selfContainerBlock = extractRuleBlock(
      charactersCss,
      /@container\s+vc-characters\s*\(\s*min-width\s*:\s*920px\s*\)/,
    );
    expect(selfContainerBlock).toBe('');
    expect(charactersCss).not.toMatch(
      /\.vc-characters-route\.has-detail\s*\{\s*grid-template-columns\s*:\s*minmax\(0,\s*1fr\)\s+auto/,
    );
    expect(charactersCss).not.toMatch(/@container\s+vc-main\s*\(\s*max-width\s*:\s*919px\s*\)/);
    expect(charactersCss).toMatch(
      /@container\s+vc-main\s*\(\s*min-width\s*:\s*920px\s*\)\s*\{[\s\S]*?\.vc-characters-route\.has-detail\s*\{[\s\S]*?grid-template-columns\s*:\s*minmax\(0,\s*1fr\)\s+400px/,
    );

    // Narrow container (<= 919px, covering 390 and 1024 compact 906px container) preserves overlay and puts -webkit-backdrop-filter before backdrop-filter (F22)
    expect(charactersCss).toMatch(
      /@container\s+vc-characters\s*\(\s*max-width\s*:\s*919px\s*\)\s*\{[\s\S]*?\.vc-character-detail\s*\{[\s\S]*?position\s*:\s*absolute[\s\S]*?-webkit-backdrop-filter\s*:\s*blur\(var\(--vc-blur-3\)\)\s+saturate\(180%\)\s*;\s*backdrop-filter\s*:\s*blur\(var\(--vc-blur-3\)\)\s+saturate\(180%\)/,
    );

    const queryClient = createQueryClient();
    const client = {
      identity: { accountId: 'acc-1', userId: 'u-1', sessionId: 's-1' },
      headers: () => ({ 'Content-Type': 'application/json' }),
      characters: vi.fn(async () => [
        {
          avatar: 'alice.png',
          name: '阿梨',
          description: '合成角色描述',
          data: {
            description: '合成角色描述',
            extensions: { vc_character_ref: 'ref-alice' },
          },
        },
      ]),
      recent: vi.fn(async () => []),
      settings: vi.fn(async () => ({ settings: '{}' })),
      readChat: vi.fn(async () => []),
      post: vi.fn(async () => ({ ok: true })),
      request: vi.fn(async () => ({})),
      go: {
        fetchRelationships: vi.fn(async () => []),
        fetchNotifications: vi.fn(async () => ({ items: [] })),
        fetchCompanionState: vi.fn(async () => ({})),
        fetchFollowUps: vi.fn(async () => []),
        fetchMemories: vi.fn(async () => ({ items: [] })),
        storyRequest: vi.fn(async () => ({})),
      },
    } as unknown as AppClient;

    const bridge = createSessionBridge(client, { queryClient });
    const router = createDesktopRouter();

    const { container } = render(
      <AppProviders client={client} queryClient={queryClient} sessionBridge={bridge}>
        <RouterProvider router={router} />
      </AppProviders>,
    );

    await router.navigate({
      to: '/characters/$avatar',
      params: { avatar: 'alice.png' },
    });

    await waitFor(() => {
      const routeEl = container.querySelector('.vc-characters-route.has-detail');
      expect(routeEl).toBeTruthy();
      expect(routeEl?.querySelector(':scope > .vc-characters-main')).toBeTruthy();
      expect(routeEl?.querySelector(':scope > .vc-character-detail')).toBeTruthy();
    });

    const closeBtn = container.querySelector<HTMLButtonElement>(
      '.vc-character-detail .vc-character-detail-top button',
    );
    expect(closeBtn).toBeTruthy();
    fireEvent.click(closeBtn!);

    await waitFor(() => {
      expect(container.querySelector('.vc-character-detail')).toBeNull();
    });
  });

  it('F14: Diary month label does not split characters, toolbar wraps, and handwriting toggle is reachable', async () => {
    const memoryCss = readFeatureCss('memory/memory.css');
    const toolbarBlock = extractRuleBlock(memoryCss, /\.vc-memory-diary__toolbar\s*\{/);
    const monthLabelBlock = extractRuleBlock(
      memoryCss,
      /\.vc-memory-diary__month-label\s*\{/,
    );

    expect(toolbarBlock).toMatch(/flex-wrap\s*:\s*wrap/);
    expect(monthLabelBlock).toMatch(/white-space\s*:\s*nowrap/);

    const client: AppClient = {
      initialize: vi.fn(async () => ({ characters: [], chat: [], settings: {} })),
      go: {
        captureSessionContext: vi.fn(() => ({ userId: 'u-1', sessionId: 's-1' })),
        storyRequest: vi.fn(async () => ({
          items: [
            {
              diaryId: 'd-1',
              day: '2026-11-05',
              title: '秋日笔记',
              body: '今天一起整理了旧照片。',
              moments: ['旧相册'],
            },
          ],
        })),
      },
    } as unknown as AppClient;

    const { container } = render(
      <AppProviders client={client} queryClient={createQueryClient()}>
        <Diary relId="11" />
      </AppProviders>,
    );

    const monthLabel = container.querySelector('.vc-memory-diary__month-label');
    expect(monthLabel).toBeTruthy();
    expect(monthLabel?.textContent?.trim()).toMatch(/^\d+\s*月$/);

    const handBtn = screen.getByRole('button', { name: /手写体/ });
    expect(handBtn.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(handBtn);
    expect(handBtn.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('.vc-memory-diary__paper--hand')).toBeTruthy();
  });

  it('F15: PolicyForm quiet hours start/end/timezone expand in narrow containers with full editable values, and Inbox Segment prevents vertical text wrapping', async () => {
    const inboxCss = readFeatureCss('inbox/inbox.css');

    // Quiet grid must have narrow container rule expanding out of cramped 3-col layout and stacking field rows
    expect(inboxCss).toMatch(
      /\.vc-policy-form__quiet-grid\s+\.vc-field__row\s*\{[\s\S]*?grid-template-columns\s*:\s*minmax\(0,\s*1fr\)/,
    );
    expect(inboxCss).toMatch(
      /@container[\s\S]*?\.vc-policy-form__quiet-grid\s*\{[\s\S]*?grid-template-columns\s*:\s*minmax\(0,\s*1fr\)/,
    );

    // Inbox Segment must keep items nowrap and allow horizontal scrolling inside container
    expect(inboxCss).toMatch(
      /\.vc-inbox-route\s+\.vc-segment\s*\{[\s\S]*?overflow-x\s*:\s*auto/,
    );
    expect(inboxCss).toMatch(
      /\.vc-inbox-route\s+\.vc-segment__item\s*\{[\s\S]*?white-space\s*:\s*nowrap/,
    );

    const serverPolicy = {
      relationshipId: '11',
      enabled: true,
      quietHoursStart: '23:00',
      quietHoursEnd: '08:00',
      quietHoursTimezone: 'Asia/Shanghai',
      dailyLimit: 3,
      recentInteractionMinutes: 120,
      allowedModes: ['COMPANION'],
      offlineCapable: false,
      mode: 'DAILY',
      checkInAfterMinutes: 360,
    };

    const client: AppClient = {
      initialize: vi.fn(async () => ({ characters: [], chat: [], settings: {} })),
      recent: vi.fn(async () => []),
      go: {
        captureSessionContext: vi.fn(() => ({ userId: 'u-1', sessionId: 's-1' })),
        storyRequest: vi.fn(async (method: string, path: string) => {
          if (method === 'GET' && path.endsWith('/proactive-policy')) {
            return serverPolicy;
          }
          return { items: [] };
        }),
        fetchNotifications: vi.fn(async () => ({ items: [] })),
      },
    } as unknown as AppClient;

    const router = createDesktopRouter({
      routeOverrides: {
        inbox: () => (
          <div className="vc-inbox-route">
            <PolicyForm relId="11" />
            <InboxList />
          </div>
        ),
      },
    });

    const { container } = render(
      <AppProviders client={client} queryClient={createQueryClient()}>
        <RouterProvider router={router} />
      </AppProviders>,
    );

    await router.navigate({ to: '/inbox' });

    const startInput = (await waitFor(() =>
      screen.getByLabelText('静默开始'),
    )) as HTMLInputElement;
    const endInput = screen.getByLabelText('静默结束') as HTMLInputElement;
    const tzInput = screen.getByLabelText('静默时区') as HTMLInputElement;

    await waitFor(() => {
      expect(startInput.value).toBe('23:00');
      expect(endInput.value).toBe('08:00');
      expect(tzInput.value).toBe('Asia/Shanghai');
    });

    // Desktop Segment is rendered (no mobile sheet/tabbar) with all filter options
    const filterSegment = container.querySelector('[aria-label="收件箱筛选"].vc-segment');
    expect(filterSegment).toBeTruthy();
    const segmentItems = filterSegment?.querySelectorAll('.vc-segment__item') ?? [];
    expect(segmentItems.length).toBe(FILTERS.length);
  });

  it('F16 & F17: StoryList and Stage use design/Button for configure action instead of unstyled vcms-btn, and story.css styles stage controls', () => {
    const env = createStoryTestEnv({
      purposesReady: false,
      hasExistingStoryConversation: true,
    });
    const onConfigure = vi.fn();

    const { container: listContainer } = render(
      <AppProviders client={env.client} queryClient={env.queryClient} sessionBridge={env.bridge}>
        <StoryList
          configNote="剧情导演或 NPC 尚未绑定可用模型。"
          onStartOrEnter={() => {}}
          onConfigure={onConfigure}
        />
      </AppProviders>,
    );

    const listConfigBtn = listContainer.querySelector<HTMLButtonElement>(
      '[data-action="configure"]',
    );
    expect(listConfigBtn).toBeTruthy();
    expect(listConfigBtn?.classList.contains('vcms-btn')).toBe(false);
    expect(listConfigBtn?.classList.contains('vc-btn')).toBe(true);
    expect(listConfigBtn?.classList.contains('vc-btn--gray')).toBe(true);
    fireEvent.click(listConfigBtn!);
    expect(onConfigure).toHaveBeenCalledTimes(1);

    const initialView = createStoryTestView({
      runId: '11',
      branchId: '13',
      worldVersion: 1,
    });

    const { container: stageContainer } = render(
      <AppProviders client={env.client} queryClient={env.queryClient} sessionBridge={env.bridge}>
        <div className="vc-story-tab" data-view="stage">
          <Stage
            runId="11"
            branchId="13"
            worldVersion={1}
            initialView={initialView}
            configNote="剧情导演或 NPC 尚未绑定可用模型。"
            onConfigure={onConfigure}
          />
        </div>
      </AppProviders>,
    );

    const stageConfigBtn = stageContainer.querySelector<HTMLButtonElement>(
      '[data-action="configure"]',
    );
    expect(stageConfigBtn).toBeTruthy();
    expect(stageConfigBtn?.classList.contains('vcms-btn')).toBe(false);
    expect(stageConfigBtn?.classList.contains('vc-btn')).toBe(true);
    expect(stageConfigBtn?.classList.contains('vc-btn--gray')).toBe(true);

    const stepPlaceBtn = stageContainer.querySelector<HTMLButtonElement>(
      '[data-action="act"][data-step="a1"]',
    );
    const stepAccuseBtn = stageContainer.querySelector<HTMLButtonElement>(
      '[data-action="act"][data-step="a7"]',
    );
    expect(stepPlaceBtn?.classList.contains('vc-btn--gray')).toBe(true);
    expect(stepAccuseBtn?.classList.contains('vc-btn--danger')).toBe(true);

    const storyCss = readFeatureCss('story/story.css');
    expect(storyCss).toMatch(/\.vc-story-tab\s+\.vc-circle\s*\{/);
    expect(storyCss).toMatch(/\.vc-story-tab\s+\.vc-send\s*\{/);
    expect(storyCss).toMatch(/\.vc-story-tab\s+\.vc-note\s*\{/);
    expect(storyCss).toMatch(/\.vc-story-tab\s+\.vc-acts\s+\.vc-btn\[hidden\]/);
  });

  it('F23: desktop Switch consumers in MemoryRoute and InboxRoute render .vc-switch__track and .vc-switch__thumb', async () => {
    const client: AppClient = {
      initialize: vi.fn(async () => ({ characters: [], chat: [], settings: {} })),
      recent: vi.fn(async () => []),
      getContext: vi.fn(() => ({
        characters: [],
        characterId: 0,
        chatId: 'chat-a',
        chatMetadata: { vc_binding: { relationshipId: '11' } },
        chat: [],
      })),
      go: {
        captureSessionContext: vi.fn(() => ({ userId: 'u-1', sessionId: 's-1' })),
        fetchRelationships: vi.fn(async () => [
          { relationshipId: '11', companionName: '阿梨', active: true },
        ]),
        fetchMemories: vi.fn(async () => ({ items: [], nextCursor: null })),
        fetchNotifications: vi.fn(async () => ({ items: [] })),
        fetchFollowUps: vi.fn(async () => []),
        storyRequest: vi.fn(async () => ({
          relationshipId: '11',
          enabled: true,
          quietHoursStart: '23:00',
          quietHoursEnd: '08:00',
          quietHoursTimezone: 'Asia/Shanghai',
          dailyLimit: 2,
          recentInteractionMinutes: 120,
          allowedModes: ['COMPANION'],
          offlineCapable: true,
          mode: 'DAILY',
          checkInAfterMinutes: 360,
        })),
      },
    } as unknown as AppClient;

    const router = createDesktopRouter({
      routeOverrides: {
        memory: () => <MemoryRoute />,
        inbox: () => <InboxRoute />,
      },
    });

    const { container } = render(
      <AppProviders client={client} queryClient={createQueryClient()}>
        <RouterProvider router={router} />
      </AppProviders>,
    );

    await router.navigate({ to: '/memory' });
    await waitFor(() => {
      const switches = container.querySelectorAll('.vc-switch');
      expect(switches.length).toBeGreaterThan(0);
      for (const sw of switches) {
        expect(sw.querySelector('.vc-switch__track')).toBeTruthy();
        expect(sw.querySelector('.vc-switch__thumb')).toBeTruthy();
      }
    });

    await router.navigate({ to: '/inbox' });
    await waitFor(() => {
      const switches = container.querySelectorAll('.vc-switch');
      expect(switches.length).toBeGreaterThanOrEqual(2);
      for (const sw of switches) {
        expect(sw.querySelector('.vc-switch__track')).toBeTruthy();
        expect(sw.querySelector('.vc-switch__thumb')).toBeTruthy();
      }
    });
  });
});
