import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor, act } from '@testing-library/react';
import { RouterProvider } from '@tanstack/react-router';
import { AppProviders } from '../../src/app/providers';
import { createDesktopRouter } from '../../src/app/router';
import { RewindDialog } from '../../src/features/story/RewindDialog';
import { StoryRoute } from '../../src/features/story/StoryRoute';
import { useStoryRewind } from '../../src/features/story/useStory';
import { queryKeys } from '../../src/data/queryKeys';
import { createStoryTestEnv, createStoryTestView } from './fixtures';

describe('RewindDialog', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('confirm creates branch and navigates', async () => {
    expect(typeof useStoryRewind).toBe('function');
    const env = createStoryTestEnv({
      hasExistingStoryConversation: true,
      initialRun: { runId: '11', branchId: '13', worldVersion: 3 },
    });

    const onRewound = vi.fn();
    const { container, getByText } = render(
      <AppProviders client={env.client} queryClient={env.queryClient} sessionBridge={env.bridge}>
        <RewindDialog
          open={true}
          runId="11"
          targetVersion={2}
          chatIdentity="f2-story-1"
          onOpenChange={() => {}}
          onRewound={onRewound}
        />
      </AppProviders>,
    );

    expect(getByText('回到版本 2？')).toBeTruthy();
    expect(
      getByText(
        '回到世界版本 2，阶段为调查中。此版本之后的行动不会留在当前分支，需要重新提交才会再次发生。该阶段之后形成的分支记忆会失效，不会并入当前进度。',
      ),
    ).toBeTruthy();

    fireEvent.click(container.querySelector('[data-action="confirm-rewind"]')!);

    await waitFor(() => {
      expect(env.storyRequest).toHaveBeenCalledWith('POST', '/api/v1/story/runs/11/rewind', {
        toWorldVersion: 2,
        chatIdentity: 'f2-story-1',
      });
      expect(env.fetchStoryActorView).toHaveBeenCalledWith({
        runId: '11',
        branchId: '19',
        worldVersion: 2,
      });
      expect(env.bridge.story.advance).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: '11',
          branchId: '19',
          worldVersion: 2,
        }),
      );
      expect(onRewound).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: '11',
          branchId: '19',
          worldVersion: 2,
        }),
      );
    });
  });

  it('rewinds active run inside StoryRoute and updates router location', async () => {
    const env = createStoryTestEnv({
      hasExistingStoryConversation: true,
      initialRun: { runId: '11', branchId: '13', worldVersion: 3 },
    });

    const initialView = createStoryTestView({
      runId: '11',
      branchId: '13',
      worldVersion: 3,
    });

    env.queryClient.setQueryData(queryKeys.storyRuns, [
      {
        runId: '11',
        branchId: '13',
        worldVersion: 3,
        conversationId: '77',
        caseId: 'rainy-inn-v1',
        title: '雨夜旅馆：失踪的怀表',
      },
    ]);
    env.queryClient.setQueryData(queryKeys.storyRun('11'), {
      runId: '11',
      branchId: '13',
      worldVersion: 3,
      conversationId: '77',
      caseId: 'rainy-inn-v1',
      title: '雨夜旅馆：失踪的怀表',
    });
    env.queryClient.setQueryData(queryKeys.storyView('11', 'player', '13', 3), initialView);

    const router = createDesktopRouter({
      initialEntry: '/story/11',
      routeOverrides: {
        story: StoryRoute,
        chat: () => null,
      },
    });

    const { container } = render(
      <AppProviders client={env.client} queryClient={env.queryClient} sessionBridge={env.bridge}>
        <RouterProvider router={router} />
      </AppProviders>,
    );

    await waitFor(() => {
      expect(container.querySelector('.vc-story')?.getAttribute('data-world-version')).toBe('3');
    });

    fireEvent.click(container.querySelector('[data-action="ask-rewind"][data-version="2"]')!);

    await waitFor(() => {
      expect(container.querySelector('.vc-story-tab')?.textContent).toContain('回到版本 2？');
    });

    fireEvent.click(container.querySelector('.vc-story-tab [data-action="confirm-rewind"]')!);

    await waitFor(() => {
      expect(container.querySelector('.vc-story')?.getAttribute('data-world-version')).toBe('2');
      expect(router.state.location.pathname).toBe('/story/11');
    });
  });

  it('deduplicates concurrent rewind confirm clicks and blocks router leave when epilogue summary is uncommitted', async () => {
    let resolveRewind: ((val: any) => void) | null = null;
    const env = createStoryTestEnv({
      hasExistingStoryConversation: true,
      initialRun: { runId: '11', branchId: '13', worldVersion: 3 },
    });
    const baseStoryRequest = env.storyRequest.getMockImplementation()!;
    env.storyRequest.mockImplementation(async (method: string, path: string, payload?: any) => {
      if (method === 'POST' && path === '/api/v1/story/runs/11/rewind') {
        return new Promise((resolve) => {
          resolveRewind = () => resolve(baseStoryRequest(method, path, payload));
        });
      }
      return baseStoryRequest(method, path, payload);
    });

    const onRewound = vi.fn();
    const { container: dialogContainer, unmount: unmountDialog } = render(
      <AppProviders client={env.client} queryClient={env.queryClient} sessionBridge={env.bridge}>
        <RewindDialog
          open={true}
          runId="11"
          targetVersion={2}
          chatIdentity="f2-story-1"
          onOpenChange={() => {}}
          onRewound={onRewound}
        />
      </AppProviders>,
    );

    const confirmBtn = dialogContainer.querySelector<HTMLButtonElement>(
      '[data-action="confirm-rewind"]',
    )!;
    fireEvent.click(confirmBtn);
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(resolveRewind).toBeTypeOf('function');
    });
    expect(
      env.storyRequest.mock.calls.filter(
        ([m, p]) => m === 'POST' && p === '/api/v1/story/runs/11/rewind',
      ).length,
    ).toBe(1);

    await act(async () => {
      resolveRewind?.(undefined);
    });

    await waitFor(() => {
      expect(onRewound).toHaveBeenCalledTimes(1);
    });
    unmountDialog();

    // Part 2: Uncommitted epilogue summary leave guard via StoryRouteAdapter
    const leaveEnv = createStoryTestEnv({
      hasExistingStoryConversation: true,
      initialRun: { runId: '11', branchId: '13', worldVersion: 7, stage: 'resolved' },
    });
    const resolvedView = createStoryTestView({
      runId: '11',
      branchId: '13',
      worldVersion: 7,
      stage: 'resolved',
    });
    resolvedView.participants = [
      { actorId: 'lin', name: '林岚', persona: '账房助手', relationshipId: '101' },
      { actorId: 'zhou', name: '周澈', persona: '当班旅馆伙计' },
      { actorId: 'su', name: '苏禾', persona: '当晚住客' },
    ];

    leaveEnv.queryClient.setQueryData(queryKeys.storyRuns, [
      {
        runId: '11',
        branchId: '13',
        worldVersion: 7,
        conversationId: '77',
        caseId: 'rainy-inn-v1',
        title: '雨夜旅馆：失踪的怀表',
        stage: 'resolved',
        mapped: { lin: '101' },
      },
    ]);
    leaveEnv.queryClient.setQueryData(queryKeys.storyRun('11'), {
      runId: '11',
      branchId: '13',
      worldVersion: 7,
      conversationId: '77',
      caseId: 'rainy-inn-v1',
      title: '雨夜旅馆：失踪的怀表',
      stage: 'resolved',
      mapped: { lin: '101' },
    });
    leaveEnv.queryClient.setQueryData(
      queryKeys.storyView('11', 'player', '13', 7),
      resolvedView,
    );

    const router = createDesktopRouter({
      initialEntry: '/story/11',
      routeOverrides: {
        chat: () => <div data-testid="chat-page">Chat</div>,
      },
    });

    const { container, getByText } = render(
      <AppProviders
        client={leaveEnv.client}
        queryClient={leaveEnv.queryClient}
        sessionBridge={leaveEnv.bridge}
      >
        <RouterProvider router={router} />
      </AppProviders>,
    );

    await waitFor(() => {
      expect(container.querySelector('[data-field="summary"]')).toBeTruthy();
    });

    fireEvent.change(container.querySelector('[data-field="summary"]')!, {
      target: { value: '未保存的结局摘要' },
    });

    await act(async () => {
      void router.navigate({ to: '/chat' });
    });

    await waitFor(() => {
      expect(getByText('放弃更改？')).toBeTruthy();
      expect(router.state.location.pathname).toBe('/story/11');
    });

    // Cancel leaving -> stays on /story/11
    fireEvent.click(getByText('继续编辑'));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/story/11');
    });

    // Save epilogue -> clears dirty state -> navigation to /chat succeeds
    fireEvent.click(container.querySelector('[data-action="save-epilogue"]')!);
    await waitFor(() => {
      expect(container.textContent).toContain(
        '已保存共同游玩摘要，请到记忆页确认后才会写入日常记忆。',
      );
    });

    await act(async () => {
      await router.navigate({ to: '/chat' });
    });
    expect(router.state.location.pathname).toBe('/chat');
  });
});
