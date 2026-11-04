import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { AppProviders } from '../../src/app/providers';
import { StoryRoute } from '../../src/features/story/StoryRoute';
import { createStoryTestEnv } from './fixtures';

describe('StoryRoute full business flow', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows model configuration prompt when STORY_DIRECTOR or NPC_DIALOGUE is not ready', async () => {
    const env = createStoryTestEnv({
      purposesReady: false,
      hasExistingStoryConversation: true,
    });
    const onConfigure = vi.fn();

    const { container, getByText } = render(
      <AppProviders client={env.client} queryClient={env.queryClient} sessionBridge={env.bridge}>
        <StoryRoute onConfigure={onConfigure} />
      </AppProviders>,
    );

    fireEvent.click(container.querySelector('.vc-story-tab [data-action="start"]')!);

    await waitFor(() => {
      expect(getByText('剧情导演或 NPC 尚未绑定可用模型。')).toBeTruthy();
      expect(container.querySelector('[data-action="configure"]')).toBeTruthy();
    });

    fireEvent.click(container.querySelector('[data-action="configure"]')!);
    expect(onConfigure).toHaveBeenCalled();
  });

  it('completes start, step action, say projection via bridge.projectStory, companion mapping, accuse, and epilogue save', async () => {
    const env = createStoryTestEnv({
      hasExistingStoryConversation: true,
    });

    const { container } = render(
      <AppProviders client={env.client} queryClient={env.queryClient} sessionBridge={env.bridge}>
        <StoryRoute />
      </AppProviders>,
    );

    expect(container.querySelector('.vc-story-tab')?.getAttribute('data-view')).toBe('gate');
    fireEvent.click(container.querySelector('.vc-story-tab [data-action="start"]')!);

    await waitFor(() => {
      expect(container.querySelector('.vc-story-tab')?.getAttribute('data-view')).toBe('stage');
      expect(container.querySelector('.vc-story')?.getAttribute('data-world-version')).toBe('0');
    });

    // Step a1
    fireEvent.click(container.querySelector('.vc-story-tab [data-action="act"][data-step="a1"]')!);
    await waitFor(() => {
      expect(container.querySelector('.vc-story')?.getAttribute('data-world-version')).toBe('1');
      expect(env.bridge.projectStory).toHaveBeenCalled();
    });

    // Select actor zhou and say
    fireEvent.click(
      container.querySelector('.vc-story-tab [data-action="select-actor"][data-actor="zhou"]')!,
    );
    const sayInput = container.querySelector<HTMLInputElement>('.vc-story-tab [data-field="say"]')!;
    fireEvent.change(sayInput, { target: { value: '请周澈说说怀表。' } });
    fireEvent.click(container.querySelector('.vc-story-tab [data-action="say"]')!);

    await waitFor(() => {
      expect(container.querySelector('.vc-story')?.getAttribute('data-world-version')).toBe('2');
    });

    // Map companion on stage
    fireEvent.click(container.querySelector('.vc-story-tab [data-action="show-companions"]')!);
    await waitFor(() => {
      expect(container.querySelector('.vc-story-tab [data-action="map-companion"]')).toBeTruthy();
    });
    fireEvent.click(container.querySelector('.vc-story-tab [data-action="map-companion"]')!);
    await waitFor(() => {
      expect(container.querySelector('.vc-story-tab')?.textContent).toContain('以林岚入局');
    });

    // Accuse step a7 -> confirm danger button -> epilogue ready -> save epilogue
    fireEvent.click(container.querySelector('.vc-story-tab [data-action="act"][data-step="a7"]')!);
    await waitFor(() => {
      expect(document.querySelector('.vc-alert__btn--danger')).toBeTruthy();
    });
    fireEvent.click(document.querySelector('.vc-alert__btn--danger')!);

    await waitFor(() => {
      expect(container.querySelector('.vc-story')?.getAttribute('data-state')).toBe('ended');
      expect(container.querySelector('.vc-story-tab [data-field="summary"]')).toBeTruthy();
    });

    const summaryInput = container.querySelector<HTMLTextAreaElement>(
      '.vc-story-tab [data-field="summary"]',
    )!;
    fireEvent.change(summaryInput, {
      target: { value: '雨夜旅馆的怀表真相已经查清。' },
    });
    fireEvent.click(container.querySelector('.vc-story-tab [data-action="save-epilogue"]')!);

    await waitFor(() => {
      expect(container.querySelector('.vc-story-tab')?.textContent).toContain(
        '已保存共同游玩摘要，请到记忆页确认后才会写入日常记忆。',
      );
    });
  });
});
