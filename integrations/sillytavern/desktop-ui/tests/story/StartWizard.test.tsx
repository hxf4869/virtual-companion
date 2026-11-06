import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor, act } from '@testing-library/react';
import { AppProviders } from '../../src/app/providers';
import { StartWizard } from '../../src/features/story/StartWizard';
import { useStartWizard } from '../../src/features/story/useStory';
import { createStoryTestEnv } from './fixtures';

describe('StartWizard', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('five steps create run with selected companion', async () => {
    expect(typeof useStartWizard).toBe('function');
    const env = createStoryTestEnv({
      hasExistingStoryConversation: false,
      hasStoryCard: true,
      relationships: [
        { relationshipId: '101', displayName: '林月', mode: 'COMPANION' },
        { relationshipId: '102', displayName: '苏晴', mode: 'COMPANION' },
      ],
    });
    const onStarted = vi.fn();
    const onConfigure = vi.fn();

    const { container, getByText } = render(
      <AppProviders client={env.client} queryClient={env.queryClient} sessionBridge={env.bridge}>
        <StartWizard onStarted={onStarted} onConfigure={onConfigure} />
      </AppProviders>,
    );

    // Step 1: 选择剧目 (rainy-inn-v1)
    expect(container.querySelector('[data-wizard-step="1"]')).toBeTruthy();
    expect(getByText('雨夜旅馆：失踪的怀表')).toBeTruthy();
    fireEvent.click(container.querySelector('[data-action="wizard-next"]')!);

    // Step 2: 选择同行陪伴与入局角色
    await waitFor(() => {
      expect(container.querySelector('[data-wizard-step="2"]')).toBeTruthy();
      expect(container.querySelector('[data-companion-id="101"]')).toBeTruthy();
    });
    fireEvent.click(container.querySelector('[data-companion-id="101"]')!);
    fireEvent.click(container.querySelector('[data-cast-actor="lin"]')!);
    fireEvent.click(container.querySelector('[data-action="wizard-next"]')!);

    // Step 3: 公开设定与现场预览
    expect(container.querySelector('[data-wizard-step="3"]')).toBeTruthy();
    expect(getByText(/大堂：煤油灯还亮着/)).toBeTruthy();
    fireEvent.click(container.querySelector('[data-action="wizard-next"]')!);

    // Step 4: 调查与回档说明
    expect(container.querySelector('[data-wizard-step="4"]')).toBeTruthy();
    fireEvent.click(container.querySelector('[data-action="wizard-next"]')!);

    // Step 5: 确认开局并启动运行
    expect(container.querySelector('[data-wizard-step="5"]')).toBeTruthy();
    expect(getByText(/林月/)).toBeTruthy();
    fireEvent.click(container.querySelector('[data-action="wizard-start"]')!);

    await waitFor(() => {
      expect(env.bridge.createConversation).toHaveBeenCalledWith(
        expect.objectContaining({
          characterRef: 'ref-rainy-inn',
          displayName: '雨夜旅馆',
          mode: 'STORY',
        }),
      );
      expect(env.bridge.open).toHaveBeenCalledWith('["rainy-inn.png","story-chat-1"]');
      expect(env.startStoryRun).toHaveBeenCalledWith('77');
      expect(env.storyRequest).toHaveBeenCalledWith(
        'POST',
        '/api/v1/story/runs/11/participants/lin',
        { relationshipId: '101' },
      );
      expect(env.fetchStoryActorView).toHaveBeenCalledWith({
        runId: '11',
        branchId: '13',
        worldVersion: 0,
      });
      expect(env.bridge.story.setRun).toHaveBeenCalled();
      expect(onStarted).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: '11',
          branchId: '13',
          worldVersion: 0,
        }),
      );
    });
  });

  it('imports story card and calls bridge.reloadCharacter when story card is missing', async () => {
    const env = createStoryTestEnv({
      hasExistingStoryConversation: false,
      hasStoryCard: false,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/api/characters/import') {
          env.bridge.getContext().characters.push({
            avatar: 'rainy-inn.png',
            name: '雨夜旅馆',
            description: '',
            data: {
              extensions: {
                vc_character_ref: 'ref-imported-inn',
                vc_story_case: 'rainy-inn-v1',
              },
            },
          });
          return {
            ok: true,
            status: 200,
            json: async () => ({ file_name: 'rainy-inn.png' }),
          };
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );

    const onStarted = vi.fn();
    const onConfigure = vi.fn();
    const { container } = render(
      <AppProviders client={env.client} queryClient={env.queryClient} sessionBridge={env.bridge}>
        <StartWizard onStarted={onStarted} onConfigure={onConfigure} />
      </AppProviders>,
    );

    for (let i = 0; i < 4; i += 1) {
      fireEvent.click(container.querySelector('[data-action="wizard-next"]')!);
    }
    fireEvent.click(container.querySelector('[data-action="wizard-start"]')!);

    await waitFor(() => {
      expect(env.bridge.reloadCharacter).toHaveBeenCalledWith('rainy-inn.png');
      expect(env.bridge.createConversation).toHaveBeenCalledWith(
        expect.objectContaining({
          characterRef: 'ref-imported-inn',
          displayName: '雨夜旅馆',
          mode: 'STORY',
        }),
      );
      expect(onStarted).toHaveBeenCalled();
    });
  });

  it('preserves companion and cast actor draft on start failure, invokes injected onConfigure, and succeeds on retry', async () => {
    let failFirstStart = true;
    const env = createStoryTestEnv({
      hasExistingStoryConversation: true,
      hasStoryCard: true,
      purposesReady: false,
      relationships: [
        { relationshipId: '101', displayName: '林月', mode: 'COMPANION' },
        { relationshipId: '102', displayName: '苏晴', mode: 'COMPANION' },
      ],
    });
    const baseStartStoryRun = env.startStoryRun.getMockImplementation()!;
    env.startStoryRun.mockImplementation(async (convId: string) => {
      if (failFirstStart) {
        failFirstStart = false;
        throw new Error('network error');
      }
      return baseStartStoryRun(convId);
    });

    const onStarted = vi.fn();
    const onConfigure = vi.fn();
    const onError = vi.fn();

    const { container, getByText } = render(
      <AppProviders client={env.client} queryClient={env.queryClient} sessionBridge={env.bridge}>
        <StartWizard onStarted={onStarted} onConfigure={onConfigure} onError={onError} />
      </AppProviders>,
    );

    fireEvent.click(container.querySelector('[data-action="wizard-next"]')!);
    await waitFor(() => {
      expect(container.querySelector('[data-companion-id="101"]')).toBeTruthy();
    });
    fireEvent.click(container.querySelector('[data-companion-id="101"]')!);
    fireEvent.click(container.querySelector('[data-cast-actor="zhou"]')!);
    fireEvent.click(container.querySelector('[data-action="wizard-next"]')!);
    fireEvent.click(container.querySelector('[data-action="wizard-next"]')!);
    fireEvent.click(container.querySelector('[data-action="wizard-next"]')!);

    expect(container.querySelector('[data-wizard-step="5"]')).toBeTruthy();
    expect(getByText(/林月（以周澈入局）/)).toBeTruthy();

    // First attempt fails
    fireEvent.click(container.querySelector('[data-action="wizard-start"]')!);

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({
          message: '开局未完成，请重试。',
          needsModelConfig: true,
        }),
      );
      expect(container.querySelector('[data-action="configure"]')).toBeTruthy();
    });

    // Draft step and companion/actor selection remain intact
    expect(container.querySelector('[data-wizard-step="5"]')).toBeTruthy();
    expect(getByText(/林月（以周澈入局）/)).toBeTruthy();
    expect(onStarted).not.toHaveBeenCalled();

    fireEvent.click(container.querySelector('[data-action="configure"]')!);
    expect(onConfigure).toHaveBeenCalledTimes(1);

    // Retry succeeds with preserved draft
    fireEvent.click(container.querySelector('[data-action="wizard-start"]')!);

    await waitFor(() => {
      expect(env.storyRequest).toHaveBeenCalledWith(
        'POST',
        '/api/v1/story/runs/11/participants/zhou',
        { relationshipId: '101' },
      );
      expect(onStarted).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: '11',
          branchId: '13',
          worldVersion: 0,
        }),
      );
    });
  });

  it('ignores late start completion after unmount', async () => {
    let resolveStartRun: ((val: any) => void) | null = null;
    const env = createStoryTestEnv({
      hasExistingStoryConversation: true,
      hasStoryCard: true,
    });
    env.startStoryRun.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveStartRun = resolve;
        }),
    );

    const onStarted = vi.fn();
    const { container, unmount } = render(
      <AppProviders client={env.client} queryClient={env.queryClient} sessionBridge={env.bridge}>
        <StartWizard onStarted={onStarted} onConfigure={vi.fn()} />
      </AppProviders>,
    );

    for (let i = 0; i < 4; i += 1) {
      fireEvent.click(container.querySelector('[data-action="wizard-next"]')!);
    }
    fireEvent.click(container.querySelector('[data-action="wizard-start"]')!);

    await waitFor(() => {
      expect(resolveStartRun).toBeTypeOf('function');
    });

    unmount();

    await act(async () => {
      resolveStartRun?.({
        conversationId: '77',
        runId: '11',
        branchId: '13',
        caseId: 'rainy-inn-v1',
        worldVersion: 0,
        stage: 'investigation',
        participants: [],
      });
    });

    expect(onStarted).not.toHaveBeenCalled();
    expect(env.bridge.story.setRun).not.toHaveBeenCalled();
  });
});
