import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor, act } from '@testing-library/react';
import { AppProviders } from '../../src/app/providers';
import { Stage } from '../../src/features/story/Stage';
import { ClueWall } from '../../src/features/story/ClueWall';
import { usePreferences } from '../../src/shell/usePreferences';
import { createStoryTestEnv, createStoryTestView } from './fixtures';

describe('Stage & ClueWall', () => {
  beforeEach(() => {
    window.localStorage.clear();
    usePreferences.getState().setReducedMotion(false);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('committing action disables bar until response and ignores late response after rewind', async () => {
    let resolveLateAction: ((val: any) => void) | null = null;
    const env = createStoryTestEnv({
      hasExistingStoryConversation: true,
      initialRun: { runId: '11', branchId: '13', worldVersion: 1 },
      onActionRequest: () =>
        new Promise((resolve) => {
          resolveLateAction = resolve;
        }),
    });

    const initialView = createStoryTestView({
      runId: '11',
      branchId: '13',
      worldVersion: 1,
    });

    const { container } = render(
      <AppProviders client={env.client} queryClient={env.queryClient} sessionBridge={env.bridge}>
        <Stage
          runId="11"
          branchId="13"
          worldVersion={1}
          initialView={initialView}
          conversationId="77"
          chatIdentity="f2-story-1"
        />
      </AppProviders>,
    );

    const stepBtn = container.querySelector<HTMLButtonElement>(
      '[data-action="act"][data-step="a2"]',
    )!;
    const sayInput = container.querySelector<HTMLInputElement>('[data-field="say"]')!;
    const sayBtn = container.querySelector<HTMLButtonElement>('[data-action="say"]')!;

    expect(stepBtn.disabled).toBe(false);
    expect(sayInput.disabled).toBe(false);

    // Commit step a2 -> enters generating state and disables action bar
    fireEvent.click(stepBtn);

    await waitFor(() => {
      expect(resolveLateAction).toBeTypeOf('function');
      expect(container.querySelector('.vc-story')?.getAttribute('data-state')).toBe('generating');
      expect(
        container.querySelector<HTMLButtonElement>('[data-action="act"][data-step="a2"]')?.disabled,
      ).toBe(true);
      expect(container.querySelector<HTMLInputElement>('[data-field="say"]')?.disabled).toBe(true);
      expect(sayBtn.disabled).toBe(true);
    });

    // Trigger rewind to worldVersion 0 while action is still in-flight
    const askRewindBtn = container.querySelector<HTMLButtonElement>(
      '[data-action="ask-rewind"][data-version="0"]',
    )!;
    fireEvent.click(askRewindBtn);

    await waitFor(() => {
      expect(container.querySelector('[data-action="confirm-rewind"]')).toBeTruthy();
    });
    fireEvent.click(container.querySelector('[data-action="confirm-rewind"]')!);

    await waitFor(() => {
      expect(container.querySelector('.vc-story')?.getAttribute('data-world-version')).toBe('0');
      expect(container.querySelector('.vc-story')?.getAttribute('data-state')).not.toBe(
        'generating',
      );
    });

    // Now resolve the late action response from before the rewind
    await act(async () => {
      resolveLateAction?.({
        accepted: true,
        replayed: false,
        runId: '11',
        branchId: '13',
        worldVersion: 2,
        worldEventId: '999',
        stage: 'investigation',
        ended: false,
      });
    });

    // Stage must remain at rewound worldVersion 0 on branch 19 and must NOT project the late response
    expect(container.querySelector('.vc-story')?.getAttribute('data-world-version')).toBe('0');
    expect(container.textContent).not.toContain('迟到的旧分支行动结果');
    expect(env.bridge.projectStory).not.toHaveBeenCalledWith(
      expect.objectContaining({ worldEventId: '999' }),
    );
  });

  it('projects accepted event via real createStoryProjection (boolean job.cancelled, append + confirm once), keeps syncPending when a1 fails and a2 succeeds until a1 is later confirmed, and cancels on rewind', async () => {
    let releaseReadChat: (() => void) | null = null;
    let blockNextReadChat = false;
    const failConfirmEventIds = new Set<string>(['501']);

    const env = createStoryTestEnv({
      hasExistingStoryConversation: true,
      initialRun: { runId: '11', branchId: '13', worldVersion: 0 },
      onProjectionReadChat: () => {
        if (blockNextReadChat) {
          blockNextReadChat = false;
          return new Promise<void>((resolve) => {
            releaseReadChat = resolve;
          });
        }
        return undefined;
      },
      onProjectionConfirm: async ({ runId, worldEventId }) => {
        if (failConfirmEventIds.has(String(worldEventId))) {
          return { confirmed: false };
        }
        return env.storyRequest(
          'POST',
          `/api/v1/story/runs/${runId}/projections/${worldEventId}/confirm`,
          {},
        );
      },
    });

    const initialView = createStoryTestView({
      runId: '11',
      branchId: '13',
      worldVersion: 0,
    });

    const { container } = render(
      <AppProviders client={env.client} queryClient={env.queryClient} sessionBridge={env.bridge}>
        <Stage
          runId="11"
          branchId="13"
          worldVersion={0}
          initialView={initialView}
          conversationId="77"
          chatIdentity="f2-story-1"
        />
      </AppProviders>,
    );

    // 1. Action a1 (501): saveChat appends message, but confirm fails -> syncPending must be true
    fireEvent.click(container.querySelector('[data-action="act"][data-step="a1"]')!);

    await waitFor(() => {
      expect(container.querySelector('.vc-story')?.getAttribute('data-world-version')).toBe('1');
      expect(env.bridge.projectStory).toHaveBeenCalledTimes(1);
    });

    const firstJob = (env.bridge.projectStory as any).mock.calls[0][0];
    expect(typeof firstJob.cancelled).toBe('boolean');

    await waitFor(() => {
      expect(container.querySelector('.vc-story-sync')?.textContent).toContain(
        '行动已生效，聊天记录待同步',
      );
    });

    // 2. Action a2 (502): confirm for 502 succeeds, while 501 is STILL unconfirmed -> syncPending MUST remain visible!
    fireEvent.click(container.querySelector('[data-action="act"][data-step="a2"]')!);

    await waitFor(() => {
      expect(container.querySelector('.vc-story')?.getAttribute('data-world-version')).toBe('2');
      const chat = env.bridge.getContext().chat;
      expect(
        chat.filter(
          (m: any) =>
            m.extra?.type === 'vc_story_projection' && m.extra?.world_event_id === '502',
        ).length,
      ).toBe(1);
      expect(
        env.storyRequests.filter(
          (r) => r.method === 'POST' && r.path === '/api/v1/story/runs/11/projections/502/confirm',
        ).length,
      ).toBe(1);
    });
    expect(container.querySelector('.vc-story-sync')?.textContent).toContain(
      '行动已生效，聊天记录待同步',
    );

    // 3. Now allow 501 to confirm and trigger reconciliation (e.g. re-clicking a1 -> reloadHead + syncPendingProjections)
    // 501 is already in chat so createStoryProjection does not duplicate message, confirms 501 once, and clears syncPending
    failConfirmEventIds.delete('501');
    fireEvent.click(container.querySelector('[data-action="act"][data-step="a1"]')!);

    await waitFor(() => {
      expect(
        env.storyRequests.filter(
          (r) => r.method === 'POST' && r.path === '/api/v1/story/runs/11/projections/501/confirm',
        ).length,
      ).toBe(1);
      expect(container.querySelector('.vc-story-sync')).toBeNull();
    });
    expect(
      env.bridge
        .getContext()
        .chat.filter(
          (m: any) =>
            m.extra?.type === 'vc_story_projection' && m.extra?.world_event_id === '501',
        ).length,
    ).toBe(1);

    // 4. In-flight projection cancelled by rewind via boolean job.cancelled = true -> does not append or confirm, and does not pollute new branch
    blockNextReadChat = true;
    fireEvent.click(container.querySelector('[data-action="act"][data-step="a3"]')!);

    await waitFor(() => {
      expect(releaseReadChat).toBeTypeOf('function');
    });

    const inFlightJob = (env.bridge.projectStory as any).mock.calls.at(-1)[0];
    expect(inFlightJob.cancelled).toBe(false);

    fireEvent.click(container.querySelector('[data-action="ask-rewind"][data-version="1"]')!);
    await waitFor(() => {
      expect(container.querySelector('[data-action="confirm-rewind"]')).toBeTruthy();
    });
    fireEvent.click(container.querySelector('[data-action="confirm-rewind"]')!);

    expect(inFlightJob.cancelled).toBe(true);

    await act(async () => {
      releaseReadChat?.();
    });

    await waitFor(() => {
      expect(container.querySelector('.vc-story')?.getAttribute('data-world-version')).toBe('1');
    });
    expect(container.querySelector('.vc-story-sync')).toBeNull();
    expect(
      env.bridge
        .getContext()
        .chat.some((m: any) => m.extra?.world_event_id === inFlightJob.worldEventId),
    ).toBe(false);
    expect(
      env.storyRequests.some(
        (r) =>
          r.method === 'POST' &&
          r.path === `/api/v1/story/runs/11/projections/${inFlightJob.worldEventId}/confirm`,
      ),
    ).toBe(false);
  });

  it('reloads current run head on replayed action (a1 -> a2 -> a1, and rewind -> previously executed a2) without jumping to old branch/version', async () => {
    const env = createStoryTestEnv({
      hasExistingStoryConversation: true,
      initialRun: { runId: '11', branchId: '13', worldVersion: 0 },
    });

    const initialView = createStoryTestView({
      runId: '11',
      branchId: '13',
      worldVersion: 0,
    });

    const { container } = render(
      <AppProviders client={env.client} queryClient={env.queryClient} sessionBridge={env.bridge}>
        <Stage
          runId="11"
          branchId="13"
          worldVersion={0}
          initialView={initialView}
          conversationId="77"
          chatIdentity="f2-story-1"
        />
      </AppProviders>,
    );

    // Execute a1 -> v1 on branch 13
    fireEvent.click(container.querySelector('[data-action="act"][data-step="a1"]')!);
    await waitFor(() => {
      expect(container.querySelector('.vc-story')?.getAttribute('data-world-version')).toBe('1');
    });

    // Execute a2 -> v2 on branch 13
    fireEvent.click(container.querySelector('[data-action="act"][data-step="a2"]')!);
    await waitFor(() => {
      expect(container.querySelector('.vc-story')?.getAttribute('data-world-version')).toBe('2');
    });

    const projectCallsBeforeReplay = (env.bridge.projectStory as any).mock.calls.length;
    const startRunCallsBeforeReplay = env.startStoryRun.mock.calls.length;

    // Sequence 1: Click a1 again while at v2 -> server returns replayed:true with old worldVersion:1, branchId:'13'
    // Stage must reloadHead (stays at branch 13, worldVersion 2) and must NOT regress to worldVersion 1 or project again
    fireEvent.click(container.querySelector('[data-action="act"][data-step="a1"]')!);
    await waitFor(() => {
      expect(env.startStoryRun.mock.calls.length).toBeGreaterThan(startRunCallsBeforeReplay);
      expect(container.querySelector('.vc-story')?.getAttribute('data-state')).toBe('playing');
    });
    expect(container.querySelector('.vc-story')?.getAttribute('data-world-version')).toBe('2');
    expect((env.bridge.projectStory as any).mock.calls.length).toBe(projectCallsBeforeReplay);
    expect(env.bridge.story.advance).toHaveBeenLastCalledWith(
      expect.objectContaining({
        runId: '11',
        branchId: '13',
        worldVersion: 2,
      }),
    );

    // Sequence 2: Rewind to worldVersion 1 -> creates new branch 19 at worldVersion 1
    fireEvent.click(container.querySelector('[data-action="ask-rewind"][data-version="1"]')!);
    await waitFor(() => {
      expect(container.querySelector('[data-action="confirm-rewind"]')).toBeTruthy();
    });
    fireEvent.click(container.querySelector('[data-action="confirm-rewind"]')!);
    await waitFor(() => {
      expect(container.querySelector('.vc-story')?.getAttribute('data-world-version')).toBe('1');
      expect(env.bridge.story.advance).toHaveBeenLastCalledWith(
        expect.objectContaining({
          runId: '11',
          branchId: '19',
          worldVersion: 1,
        }),
      );
    });

    // Now on branch 19 at worldVersion 1, click a2 (which was previously executed on branch 13 at worldVersion 2)
    // Server returns replayed:true with old branchId:'13', worldVersion:2
    // Stage must reloadHead (stays on branch 19, worldVersion 1) and must NOT jump back to old branch 13 / worldVersion 2
    const startRunCallsBeforeBranchReplay = env.startStoryRun.mock.calls.length;
    fireEvent.click(container.querySelector('[data-action="act"][data-step="a2"]')!);
    await waitFor(() => {
      expect(env.startStoryRun.mock.calls.length).toBeGreaterThan(startRunCallsBeforeBranchReplay);
      expect(container.querySelector('.vc-story')?.getAttribute('data-state')).toBe('playing');
    });
    expect(container.querySelector('.vc-story')?.getAttribute('data-world-version')).toBe('1');
    expect(env.bridge.story.advance).toHaveBeenLastCalledWith(
      expect.objectContaining({
        runId: '11',
        branchId: '19',
        worldVersion: 1,
      }),
    );
    expect((env.bridge.projectStory as any).mock.calls.length).toBe(projectCallsBeforeReplay);

    // Sequence 3: Late replayed response arriving after rewind to worldVersion 0 (branch 23) does not pollute new branch
    let resolveLateReplayHead: ((val: any) => void) | null = null;
    env.startStoryRun.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveLateReplayHead = resolve;
        }),
    );
    fireEvent.click(container.querySelector('[data-action="act"][data-step="a1"]')!);
    await waitFor(() => {
      expect(resolveLateReplayHead).toBeTypeOf('function');
    });

    fireEvent.click(container.querySelector('[data-action="ask-rewind"][data-version="0"]')!);
    await waitFor(() => {
      expect(container.querySelector('[data-action="confirm-rewind"]')).toBeTruthy();
    });
    fireEvent.click(container.querySelector('[data-action="confirm-rewind"]')!);
    await waitFor(() => {
      expect(container.querySelector('.vc-story')?.getAttribute('data-world-version')).toBe('0');
      expect(env.bridge.story.advance).toHaveBeenLastCalledWith(
        expect.objectContaining({
          runId: '11',
          branchId: '23',
          worldVersion: 0,
        }),
      );
    });

    await act(async () => {
      resolveLateReplayHead?.({
        conversationId: '77',
        runId: '11',
        branchId: '19',
        caseId: 'rainy-inn-v1',
        worldVersion: 1,
        stage: 'investigation',
        participants: [],
      });
    });

    expect(container.querySelector('.vc-story')?.getAttribute('data-world-version')).toBe('0');
    expect(env.bridge.story.advance).toHaveBeenLastCalledWith(
      expect.objectContaining({
        runId: '11',
        branchId: '23',
        worldVersion: 0,
      }),
    );
  });

  it('ClueWall flips discovered evidence and skips flip animation when reduced motion is enabled', () => {
    const viewWithLedger = createStoryTestView({
      worldVersion: 2,
      knowledge: [
        {
          id: 'k-2',
          fact: '登记簿',
        },
      ],
    });

    usePreferences.getState().setReducedMotion(false);
    const { container, rerender } = render(
      <ClueWall view={viewWithLedger} freshClueName="登记簿" />,
    );

    const ledgerCard = container.querySelector('[data-clue-name="登记簿"]');
    expect(ledgerCard).toBeTruthy();
    expect(ledgerCard?.getAttribute('data-flipped')).toBe('true');
    expect(ledgerCard?.classList.contains('is-flipping')).toBe(true);

    // Enable reduced motion -> renders directly in final state without flip animation
    act(() => {
      usePreferences.getState().setReducedMotion(true);
    });
    rerender(<ClueWall view={viewWithLedger} freshClueName="登记簿" />);

    const reducedCard = container.querySelector('[data-clue-name="登记簿"]');
    expect(reducedCard?.getAttribute('data-flipped')).toBe('true');
    expect(reducedCard?.getAttribute('data-motion')).toBe('reduced');
    expect(reducedCard?.classList.contains('is-flipping')).toBe(false);
  });
});
