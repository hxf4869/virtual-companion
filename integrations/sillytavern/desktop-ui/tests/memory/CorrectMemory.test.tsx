import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react';
import { RouterProvider } from '@tanstack/react-router';
import { AppProviders, createQueryClient } from '../../src/app/providers';
import { createDesktopRouter } from '../../src/app/router';
import { ConflictError, type AppClient } from '../../src/data/client';
import { MemoryRoute } from '../../src/features/memory/MemoryRoute';

function setupMatchMedia(initialWidth = 1440) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string): MediaQueryList => {
      const match = query.match(/\(min-width:\s*(\d+)px\)/);
      const matches = match ? initialWidth >= Number(match[1]) : false;
      return {
        media: query,
        matches,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      } as unknown as MediaQueryList;
    }),
  );
}

describe('CorrectMemory & MemoryDetail actions', () => {
  beforeEach(() => {
    setupMatchMedia(1440);
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.history.replaceState(null, '', '/');
    window.location.hash = '';
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('saving correction replaces item and keeps draft on 409', async () => {
    let serverItem = {
      memoryId: 'mem-1',
      relationshipId: '11',
      type: 'FACT',
      sourceStatus: 'VALID',
      lifecycle: 'ACTIVE',
      summary: '旧摘要：喜欢美式咖啡',
      version: 1,
      pinnedAt: null,
      time: { recordedAt: '2026-11-01T10:30:00Z' },
      createdAt: '2026-11-01T10:30:00Z',
    };

    let shouldConflict = true;
    const correctMemory = vi.fn(async (memoryId: string, body: { summary: string; expectedVersion: number }) => {
      if (shouldConflict) {
        serverItem = {
          ...serverItem,
          summary: '服务端并发更新：喜欢冰美式',
          version: 2,
        };
        throw new ConflictError('版本冲突 (409)，请刷新后重试', {
          code: 'MEMORY_VERSION_CONFLICT',
          details: { current: serverItem },
        });
      }
      serverItem = {
        ...serverItem,
        memoryId,
        summary: body.summary,
        lifecycle: 'ACTIVE',
        sourceStatus: 'VALID',
        version: body.expectedVersion + 1,
      };
      return serverItem;
    });

    const client: AppClient = {
      initialize: vi.fn(async () => ({ characters: [], chat: [], settings: {} })),
      recent: vi.fn(async () => []),
      go: {
        captureSessionContext: vi.fn(() => ({ userId: 'u-1', sessionId: 's-1' })),
        fetchRelationships: vi.fn(async () => [
          { relationshipId: '11', personaRef: 'st-character', companionName: '阿梨', active: true },
        ]),
        fetchMemories: vi.fn(async () => ({ items: [serverItem], nextCursor: '' })),
        fetchMemory: vi.fn(async () => serverItem),
        fetchMemoryEvidence: vi.fn(async () => []),
        correctMemory,
        forgetMemory: vi.fn(async () => ({ ok: true })),
        pinMemory: vi.fn(async () => ({ ...serverItem, pinnedAt: '2026-11-01T11:00:00Z' })),
        unpinMemory: vi.fn(async () => ({ ...serverItem, pinnedAt: null })),
        listFavorites: vi.fn(async () => ({ items: [], nextCursor: '' })),
        listReminders: vi.fn(async () => ({ items: [] })),
        fetchDiaryMonth: vi.fn(async () => []),
        getIncognitoPref: vi.fn(async () => ({ incognito: false })),
        reauth: vi.fn(async () => ({ ok: true })),
      },
    } as unknown as AppClient;

    const router = createDesktopRouter({
      routeOverrides: {
        memory: () => <MemoryRoute />,
      },
    });

    render(
      <AppProviders client={client} queryClient={createQueryClient()}>
        <RouterProvider router={router} />
      </AppProviders>,
    );

    await act(async () => {
      await router.navigate({ to: '/memory' });
    });

    await waitFor(() => {
      expect(screen.getAllByText('旧摘要：喜欢美式咖啡').length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getAllByText('旧摘要：喜欢美式咖啡')[0]);

    const editBtn = await waitFor(() => screen.getByRole('button', { name: '纠正' }));
    fireEvent.click(editBtn);

    const textarea = (await waitFor(() => screen.getByLabelText('记忆内容'))) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '我的草稿：其实只喝热燕麦拿铁' } });

    const saveBtn = screen.getByRole('button', { name: '保存纠正' });
    fireEvent.click(saveBtn);

    // First attempt returns 409 ConflictError -> must keep draft!
    await waitFor(() => {
      expect(correctMemory).toHaveBeenCalledWith('mem-1', {
        summary: '我的草稿：其实只喝热燕麦拿铁',
        expectedVersion: 1,
      });
    });

    expect((screen.getByLabelText('记忆内容') as HTMLTextAreaElement).value).toBe(
      '我的草稿：其实只喝热燕麦拿铁',
    );
    expect(screen.getByText(/版本冲突/)).toBeTruthy();

    // Now resolve conflict and save again with updated version
    shouldConflict = false;
    fireEvent.click(screen.getByRole('button', { name: '保存纠正' }));

    await waitFor(() => {
      expect(correctMemory).toHaveBeenCalledTimes(2);
    });

    await waitFor(() => {
      expect(screen.getAllByText('我的草稿：其实只喝热燕麦拿铁').length).toBeGreaterThan(0);
    });
  });

  it('supports pin toggle and forget confirmation with FORGET_NOTICE', async () => {
    const serverItem = {
      memoryId: 'mem-1',
      relationshipId: '11',
      type: 'FACT',
      sourceStatus: 'VALID',
      lifecycle: 'ACTIVE',
      summary: '周末早起跑步',
      version: 1,
      pinnedAt: null,
      time: { recordedAt: '2026-11-01T10:30:00Z' },
      createdAt: '2026-11-01T10:30:00Z',
    };

    const pinMemory = vi.fn(async () => ({ ...serverItem, pinnedAt: '2026-11-01T11:00:00Z' }));
    const forgetMemory = vi.fn(async () => ({ ok: true }));

    const client: AppClient = {
      initialize: vi.fn(async () => ({ characters: [], chat: [], settings: {} })),
      recent: vi.fn(async () => []),
      go: {
        captureSessionContext: vi.fn(() => ({ userId: 'u-1', sessionId: 's-1' })),
        fetchRelationships: vi.fn(async () => [
          { relationshipId: '11', personaRef: 'st-character', companionName: '阿梨', active: true },
        ]),
        fetchMemories: vi.fn(async () => ({ items: [serverItem], nextCursor: '' })),
        fetchMemory: vi.fn(async () => serverItem),
        fetchMemoryEvidence: vi.fn(async () => []),
        correctMemory: vi.fn(),
        forgetMemory,
        pinMemory,
        unpinMemory: vi.fn(async () => ({ ...serverItem, pinnedAt: null })),
        listFavorites: vi.fn(async () => ({ items: [], nextCursor: '' })),
        listReminders: vi.fn(async () => ({ items: [] })),
        fetchDiaryMonth: vi.fn(async () => []),
        getIncognitoPref: vi.fn(async () => ({ incognito: false })),
        reauth: vi.fn(async () => ({ ok: true })),
      },
    } as unknown as AppClient;

    const router = createDesktopRouter({
      routeOverrides: {
        memory: () => <MemoryRoute />,
      },
    });

    render(
      <AppProviders client={client} queryClient={createQueryClient()}>
        <RouterProvider router={router} />
      </AppProviders>,
    );

    await act(async () => {
      await router.navigate({ to: '/memory' });
    });

    await waitFor(() => {
      expect(screen.getAllByText('周末早起跑步').length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByRole('button', { name: '置顶' }));
    await waitFor(() => {
      expect(pinMemory).toHaveBeenCalledWith('mem-1');
    });

    fireEvent.click(screen.getByRole('button', { name: '遗忘' }));
    const confirmBtn = await screen.findByRole('button', { name: '确认遗忘' });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(forgetMemory).toHaveBeenCalledWith('mem-1');
      expect(screen.getByText(/聊天原文仍保留/)).toBeTruthy();
    });
  });
});
