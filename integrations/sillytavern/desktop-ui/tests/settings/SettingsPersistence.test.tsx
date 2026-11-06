import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RouterProvider } from '@tanstack/react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppProviders, createQueryClient } from '../../src/app/providers';
import { createDesktopRouter } from '../../src/app/router';
import { SettingsRouteAdapter } from '../../src/app/SettingsRouteAdapter';
import type { AppClient } from '../../src/data/client';
import { queryKeys } from '../../src/data/queryKeys';
import { CompanionStyle } from '../../src/features/settings/CompanionStyle';
import { NotificationSection } from '../../src/features/settings/NotificationSection';
import { VoiceSection } from '../../src/features/settings/VoiceSection';
import type { SessionBridge } from '../../src/runtime/session-bridge';
import { RULES_KEY } from '../../../extension/vc-model-settings/instance-logic.js';

const voiceSettings = {
  revision: 7,
  kokoroEnabled: true,
  cosyVoiceEnabled: true,
  asrEnabled: true,
  kokoroTimeoutSeconds: 60,
  cosyVoiceTimeoutSeconds: 300,
  asrTimeoutSeconds: 30,
  dailyChatLimit: 60,
  dailyProactiveLimit: 8,
  maxRecordingSeconds: 60,
  voiceFrequency: 'STANDARD',
  cosyVoiceInstructions: {
    morning: '合成指令', night: '合成指令', care: '合成指令',
    share: '合成指令', default: '合成指令',
  },
  proactiveVoiceRates: { morning: 1, night: 1, care: 0.5, share: 0.3, default: 0 },
  kokoroMoodSpeeds: Object.fromEntries(
    ['开心', '黏人', '好奇', '得意', '懒洋洋', '有点累', '想独处', '有点烦', '困']
      .map((mood) => [mood, 1.28]),
  ),
};

const engines = { tts: [], asr: { configured: true, healthy: true } };

describe('desktop settings persistence', () => {
  afterEach(cleanup);

  it('sends the revision captured before editing even after the query refreshes', async () => {
    const queryClient = createQueryClient();
    const save = vi.fn(async () => {
      throw Object.assign(new Error('conflict'), { status: 409 });
    });
    const client = {
      go: {
        fetchVoiceSettings: async () => voiceSettings,
        fetchVoiceEngines: async () => engines,
        saveVoiceSettings: save,
      },
    } as unknown as AppClient;
    const { container } = render(
      <AppProviders client={client} queryClient={queryClient}><VoiceSection /></AppProviders>,
    );
    await screen.findByRole('switch', { name: '语音输入' });
    const limit = container.querySelector<HTMLInputElement>('[data-voice-field="dailyChatLimit"]')!;
    fireEvent.change(limit, { target: { value: '61' } });
    await act(async () => {
      queryClient.setQueryData(queryKeys.voiceSettings, {
        ...voiceSettings, revision: 8, asrEnabled: false,
      });
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByText('设置已在另一处更新。你的输入已保留。')).toBeTruthy();
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      expectedRevision: 7, dailyChatLimit: 61,
    }));
    expect(limit.value).toBe('61');
  });

  it('saves only the selected relationship voice through the relationship endpoint', async () => {
    const relationship = {
      relationshipId: '9007199254740993', companionName: '合成角色',
      remindersAllowed: true, speed: 1, proactiveVoice: false,
    };
    const saveGlobal = vi.fn();
    const patch = vi.fn(async (_method: string, _path: string, _payload: unknown) => ({
      ...relationship, speed: 0.8,
    }));
    const client = {
      go: {
        fetchVoiceSettings: async () => voiceSettings,
        fetchVoiceEngines: async () => engines,
        fetchRelationships: async () => [relationship],
        saveVoiceSettings: saveGlobal,
        storyRequest: patch,
      },
    } as unknown as AppClient;
    const { container } = render(
      <AppProviders client={client} queryClient={createQueryClient()}>
        <VoiceSection relationshipId={relationship.relationshipId} />
      </AppProviders>,
    );
    const speed = await waitFor(() => {
      const input = container.querySelector<HTMLInputElement>('[data-voice-field="speed"]');
      expect(input).toBeTruthy();
      return input!;
    });
    fireEvent.change(speed, { target: { value: '0.8' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch).toHaveBeenCalledWith(
      'PATCH', '/api/v1/relationships/9007199254740993',
      expect.objectContaining({ companionName: '合成角色', speed: 0.8 }),
    );
    expect(patch.mock.calls[0]?.[2]).not.toHaveProperty('proactiveVoice');
    expect(saveGlobal).not.toHaveBeenCalled();
  });

  it('persists a cold companion-style edit before applying it to the runtime', async () => {
    const document = { extension_settings: { [RULES_KEY]: '原有规则', unrelated: true } };
    let resolveSave!: (response: Response) => void;
    const post = vi.fn(() => new Promise<Response>((resolve) => { resolveSave = resolve; }));
    const applySettings = vi.fn(async () => {});
    const client = {
      request: async () => ({ settings: JSON.stringify(document) }), post,
    } as unknown as AppClient;
    const bridge = { applySettings } as unknown as SessionBridge;
    render(
      <AppProviders client={client} queryClient={createQueryClient()} sessionBridge={bridge}>
        <CompanionStyle />
      </AppProviders>,
    );
    const rules = screen.getByRole('textbox', { name: '陪伴风格' }) as HTMLTextAreaElement;
    await waitFor(() => expect(rules.value).toBe('原有规则'));
    fireEvent.change(rules, { target: { value: '合成新规则' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    const changes = [{
      path: ['extension_settings', RULES_KEY],
      before: { exists: true, value: '原有规则' },
      after: { exists: true, value: '合成新规则' },
    }];
    expect(post).toHaveBeenCalledWith('/api/settings/save', { vc_changes: changes });
    expect(applySettings).not.toHaveBeenCalled();
    await act(async () => resolveSave(new Response(null, { status: 200 })));
    expect(applySettings).toHaveBeenCalledWith(changes);
    expect(screen.queryByRole('button', { name: '保存' })).toBeNull();
  });

  it('decouples settings features from router/shell and wires relationshipId & inbox navigation through SettingsRouteAdapter', async () => {
    for (const relPath of [
      '../../src/features/settings/useSettingsForm.ts',
      '../../src/features/settings/SettingsRoute.tsx',
      '../../src/features/settings/NotificationSection.tsx',
      '../../src/features/settings/ModelSection.tsx',
      '../../src/features/settings/VoiceSection.tsx',
      '../../src/features/settings/CompanionStyle.tsx',
      '../../src/features/settings/AppearanceSection.tsx',
    ]) {
      const src = readFileSync(resolve(__dirname, relPath), 'utf8');
      expect(src, `${relPath} must not import @tanstack/react-router`).not.toMatch(
        /@tanstack\/react-router/,
      );
      expect(src, `${relPath} must not import shell/`).not.toMatch(/from\s+['"][^'"]*\/shell\//);
    }

    // 1) NotificationSection invokes required onOpenInbox callback directly
    const onOpenInbox = vi.fn();
    const { unmount: unmountNotif } = render(<NotificationSection onOpenInbox={onOpenInbox} />);
    fireEvent.click(screen.getByRole('button', { name: '陪伴' }));
    expect(onOpenInbox).toHaveBeenCalledTimes(1);
    unmountNotif();

    // 2) SettingsRouteAdapter forwards relationshipId to VoiceSection and navigates to /inbox from notifications
    const relationship = {
      relationshipId: '42',
      companionName: '合成角色',
      remindersAllowed: true,
      speed: 1,
      proactiveVoice: false,
    };
    const patch = vi.fn(async (_method: string, _path: string, _payload: unknown) => ({
      ...relationship,
      speed: 0.8,
    }));
    const client = {
      initialize: async () => ({ characters: [], chat: [], settings: {} }),
      go: {
        fetchVoiceSettings: async () => voiceSettings,
        fetchVoiceEngines: async () => engines,
        fetchRelationships: async () => [relationship],
        storyRequest: patch,
      },
    } as unknown as AppClient;

    const router = createDesktopRouter({
      initialEntry: '/settings/voice?relationshipId=42',
      routeOverrides: {
        settings: SettingsRouteAdapter,
      },
    });

    const { container } = render(
      <AppProviders client={client} queryClient={createQueryClient()}>
        <RouterProvider router={router} />
      </AppProviders>,
    );

    const speedInput = await waitFor(() => {
      const el = container.querySelector<HTMLInputElement>('[data-voice-field="speed"]');
      expect(el).toBeTruthy();
      return el!;
    });
    expect(container.querySelector('[data-voice-settings="relationship"]')).toBeTruthy();

    // Save relationship voice first, then verify dirty edit leave guard and notifications -> /inbox navigation
    fireEvent.change(speedInput, { target: { value: '0.8' } });
    const saveBtn = container.querySelector<HTMLButtonElement>('[data-voice-save]')!;
    expect(saveBtn.disabled).toBe(false);
    fireEvent.click(saveBtn);
    await waitFor(() => {
      expect(patch).toHaveBeenCalledTimes(1);
      expect(saveBtn.disabled).toBe(true);
    });
    expect(patch).toHaveBeenCalledWith(
      'PATCH',
      '/api/v1/relationships/42',
      expect.objectContaining({ companionName: '合成角色', speed: 0.8 }),
    );

    // Dirty edit triggers leave guard via renderLeaveGuard when switching category to notifications
    fireEvent.change(speedInput, { target: { value: '1.5' } });
    expect(saveBtn.disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '通知' }));
    expect(await screen.findByText('放弃更改？')).toBeTruthy();
    expect(router.state.location.pathname).toBe('/settings/voice');

    // Cancel keeps draft on relationship voice
    fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
    await waitFor(() => {
      expect(screen.queryByText('放弃更改？')).toBeNull();
    });
    expect(speedInput.value).toBe('1.5');

    // Confirm discard proceeds to notifications -> click 陪伴 -> navigates to /inbox
    fireEvent.click(screen.getByRole('button', { name: '通知' }));
    await screen.findByText('放弃更改？');
    fireEvent.click(screen.getByRole('button', { name: '放弃' }));
    const openInboxBtn = await waitFor(() => {
      const el = container.querySelector<HTMLElement>('[data-open-inbox]');
      expect(el).toBeTruthy();
      return el!;
    });
    fireEvent.click(openInboxBtn);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/inbox');
    });
  });
});
