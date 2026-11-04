import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { AppProviders, queryClient } from '../../src/app/providers';
import { createTestChatEnv } from '../chat/fixtures';
import { StickerSettings } from '../../src/features/settings/StickerSettings';

function createStickerTestClient() {
  const env = createTestChatEnv();
  const request = vi.fn(async (url: string, body?: Record<string, unknown>) => {
    if (url === '/api/images/upload') {
      return { path: `/user/images/ companion/${String(body?.filename || 'sticker.png')}` };
    }
    if (url === '/api/images/delete') {
      return { ok: true };
    }
    return {};
  });

  env.client.request = request as any;

  return { env, client: env.client, bridge: env.bridge, request };
}

describe('StickerSettings (B7)', () => {
  beforeEach(() => {
    queryClient.clear();
    window.localStorage.clear();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ items: [] }),
      })),
    );
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('upload requires 2-4 Chinese chars', async () => {
    const { client, bridge, request } = createStickerTestClient();

    const { container } = render(
      <AppProviders client={client} sessionBridge={bridge}>
        <StickerSettings />
      </AppProviders>,
    );

    const tagInput = (await screen.findByPlaceholderText('2–4字中文标签')) as HTMLInputElement;
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(tagInput).toBeTruthy();
    expect(fileInput).toBeTruthy();

    const validPng = new File([new Uint8Array([137, 80, 78, 71])], 'happy.png', {
      type: 'image/png',
    });

    // 1. Invalid tag (ASCII 'abc') -> rejects with Chinese 2-4 chars validation error, does NOT call upload
    fireEvent.change(tagInput, { target: { value: 'abc' } });
    fireEvent.change(fileInput, { target: { files: [validPng] } });

    expect(await screen.findByText('标签需为2–4个中文字')).toBeTruthy();
    expect(request).not.toHaveBeenCalledWith('/api/images/upload', expect.anything());

    // 2. Invalid tag (1 Chinese char '笑') -> rejects
    fireEvent.change(tagInput, { target: { value: '笑' } });
    fireEvent.change(fileInput, { target: { files: [validPng] } });

    expect(await screen.findByText('标签需为2–4个中文字')).toBeTruthy();
    expect(request).not.toHaveBeenCalledWith('/api/images/upload', expect.anything());

    // 3. Valid tag (2-4 Chinese chars '开心转圈') -> uploads and adds custom sticker row
    fireEvent.change(tagInput, { target: { value: '开心转圈' } });
    fireEvent.change(fileInput, { target: { files: [validPng] } });

    await waitFor(() => {
      expect(request).toHaveBeenCalledWith(
        '/api/images/upload',
        expect.objectContaining({
          filename: 'happy.png',
        }),
      );
    });

    const customStickerImg = await screen.findByAltText('开心转圈');
    expect(customStickerImg).toBeTruthy();
  });
});
