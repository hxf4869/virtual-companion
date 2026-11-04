import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { AppProviders } from '../../src/app/providers';
import { StartWizard } from '../../src/features/story/StartWizard';
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
    const env = createStoryTestEnv({
      hasExistingStoryConversation: false,
      hasStoryCard: true,
      relationships: [
        { relationshipId: '101', displayName: '林月', mode: 'COMPANION' },
        { relationshipId: '102', displayName: '苏晴', mode: 'COMPANION' },
      ],
    });
    const onStarted = vi.fn();

    const { container, getByText } = render(
      <AppProviders client={env.client} queryClient={env.queryClient} sessionBridge={env.bridge}>
        <StartWizard onStarted={onStarted} />
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
    const { container } = render(
      <AppProviders client={env.client} queryClient={env.queryClient} sessionBridge={env.bridge}>
        <StartWizard onStarted={onStarted} />
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
});
