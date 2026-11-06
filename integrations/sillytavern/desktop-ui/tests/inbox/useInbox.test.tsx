import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, renderHook, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppProviders, createQueryClient } from '../../src/app/providers';
import type { AppClient } from '../../src/data/client';
import {
  useInboxRelationship,
  usePolicyForm,
  useFollowUpsState,
  useInboxList,
  useChannelSheet,
  useReauthDialog,
} from '../../src/features/inbox/useInbox';
import { InboxRoute } from '../../src/features/inbox/InboxRoute';
import { PolicyForm } from '../../src/features/inbox/PolicyForm';
import { InboxList } from '../../src/features/inbox/InboxList';
import { FollowUps } from '../../src/features/inbox/FollowUps';
import { ChannelSheet } from '../../src/features/inbox/ChannelSheet';

const INBOX_FEATURE_DIR = resolve(__dirname, '../../src/features/inbox');

describe('MB2-4 inbox shared hooks and decoupled views', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('features/inbox shared hooks and route/list/form views do not import router, shell leave guard, Toast, or DOM globals in useInbox.ts', () => {
    const hookSource = readFileSync(resolve(INBOX_FEATURE_DIR, 'useInbox.ts'), 'utf8');
    expect(hookSource).not.toMatch(/@tanstack\/react-router/);
    expect(hookSource).not.toMatch(/shell\/useLeaveGuard/);
    expect(hookSource).not.toMatch(/design\/components\/Toast/);
    expect(hookSource).not.toMatch(/\b(document|window|HTMLElement|localStorage|Notification)\b/);
    expect(hookSource).not.toMatch(/\.css['"]/);

    for (const file of [
      'InboxRoute.tsx',
      'PolicyForm.tsx',
      'InboxList.tsx',
      'FollowUps.tsx',
      'ChannelSheet.tsx',
      'ReauthDialog.tsx',
    ]) {
      const src = readFileSync(resolve(INBOX_FEATURE_DIR, file), 'utf8');
      expect(src).not.toMatch(/@tanstack\/react-router/);
      expect(src).not.toMatch(/shell\/useLeaveGuard/);
    }
  });

  it('useInboxRelationship & InboxRoute handle relationship selection and switch confirmation when PolicyForm has unsaved draft', async () => {
    const storyRequest = vi.fn(async (method: string, path: string) => {
      if (path === '/api/v1/relationships/101/proactive-policy' && method === 'GET') {
        return {
          relationshipId: '101',
          enabled: true,
          mode: 'DAILY',
          dailyLimit: 2,
          recentInteractionMinutes: 120,
          quietHoursStart: '23:00',
          quietHoursEnd: '07:00',
          quietHoursTimezone: 'Asia/Shanghai',
          allowedModes: ['COMPANION'],
          offlineCapable: false,
        };
      }
      if (path === '/api/v1/relationships/202/proactive-policy' && method === 'GET') {
        return {
          relationshipId: '202',
          enabled: false,
          mode: 'OFF',
          dailyLimit: 4,
          recentInteractionMinutes: 180,
          quietHoursStart: '22:30',
          quietHoursEnd: '06:30',
          quietHoursTimezone: 'Asia/Shanghai',
          allowedModes: ['COMPANION'],
          offlineCapable: true,
        };
      }
      if (path.endsWith('/follow-ups') && method === 'GET') return [];
      if (path === '/api/v1/inbox' && method === 'GET') return [];
      if (path === '/api/v1/notification-channels' && method === 'GET') return [];
      if (path === '/api/v1/notification-deliveries' && method === 'GET') return [];
      return {};
    });

    const client: AppClient = {
      initialize: vi.fn(async () => ({ characters: [], chat: [], settings: {} })),
      go: {
        captureSessionContext: vi.fn(() => ({ userId: 'u-1', sessionId: 's-1' })),
        fetchRelationships: vi.fn(async () => [
          { relationshipId: '101', personaRef: 'st-character', companionName: '阿梨', mode: 'COMPANION' },
          { relationshipId: '202', personaRef: 'st-character', companionName: '小夏', mode: 'STORY' },
        ]),
        storyRequest,
      },
    } as unknown as AppClient;

    const queryClient = createQueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AppProviders client={client} queryClient={queryClient}>
        {children}
      </AppProviders>
    );

    const { result } = renderHook(() => useInboxRelationship({ initialRelationshipId: null }), {
      wrapper,
    });

    await waitFor(() => {
      expect(result.current.selectedRelId).toBe('101');
      expect(result.current.relOptions).toEqual([
        { value: '101', label: '阿梨' },
        { value: '202', label: '小夏' },
      ]);
    });

    // Clean switch without dirty draft switches immediately
    act(() => {
      result.current.selectRelationship('202');
    });
    expect(result.current.selectedRelId).toBe('202');
    expect(result.current.pendingRelId).toBeNull();

    // Mark policy dirty -> switching relationship sets pendingRelId instead of switching immediately
    act(() => {
      result.current.setPolicyDirty(true);
    });
    act(() => {
      result.current.selectRelationship('101');
    });
    expect(result.current.selectedRelId).toBe('202');
    expect(result.current.pendingRelId).toBe('101');

    // Cancel switch keeps current relationship and dirty flag
    act(() => {
      result.current.cancelSwitchRelationship();
    });
    expect(result.current.selectedRelId).toBe('202');
    expect(result.current.pendingRelId).toBeNull();
    expect(result.current.policyDirty).toBe(true);

    // Request switch again and confirm discard -> switches relationship and clears dirty flag
    act(() => {
      result.current.selectRelationship('101');
    });
    expect(result.current.pendingRelId).toBe('101');
    act(() => {
      result.current.confirmSwitchRelationship();
    });
    expect(result.current.selectedRelId).toBe('101');
    expect(result.current.pendingRelId).toBeNull();
    expect(result.current.policyDirty).toBe(false);

    // Also verify InboxRoute UI relationship switch confirmation with dirty PolicyForm draft
    render(
      <AppProviders client={client} queryClient={createQueryClient()}>
        <InboxRoute onOpenConversation={vi.fn()} />
      </AppProviders>,
    );

    const capInput = (await waitFor(() => screen.getByLabelText('每日上限'))) as HTMLInputElement;
    await waitFor(() => {
      expect(capInput.value).toBe('2');
    });

    fireEvent.change(capInput, { target: { value: '9' } });
    expect(capInput.value).toBe('9');

    // Open relationship Select and pick 小夏
    const user = userEvent.setup();
    const relTrigger = screen.getByLabelText('选择角色关系');
    await user.click(relTrigger);
    const xiaOption = await waitFor(() => screen.getByRole('option', { name: '小夏' }));
    await user.click(xiaOption);

    // Confirm dialog appears; clicking "继续编辑" keeps 阿梨 and dirty draft '9'
    const keepEditBtn = await waitFor(() => screen.getByRole('button', { name: '继续编辑' }));
    await user.click(keepEditBtn);
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: '继续编辑' })).toBeNull();
    });
    expect((screen.getByLabelText('每日上限') as HTMLInputElement).value).toBe('9');

    // Pick 小夏 again and confirm "放弃" -> switches to relationship 202 (dailyLimit 4)
    await user.click(screen.getByLabelText('选择角色关系'));
    await user.click(await waitFor(() => screen.getByRole('option', { name: '小夏' })));
    await user.click(await waitFor(() => screen.getByRole('button', { name: '放弃' })));

    await waitFor(() => {
      expect((screen.getByLabelText('每日上限') as HTMLInputElement).value).toBe('4');
    });
  });

  it('usePolicyForm & PolicyForm preserve dirty draft on validation/server error, reset on save success, and invoke injected guard', async () => {
    let shouldFailSave = true;
    const putPayloads: Array<Record<string, unknown>> = [];

    const storyRequest = vi.fn(async (method: string, path: string, body?: Record<string, unknown>) => {
      if (path === '/api/v1/relationships/11/proactive-policy' && method === 'GET') {
        return {
          relationshipId: '11',
          enabled: true,
          mode: 'DAILY',
          checkInAfterMinutes: 360,
          dailyLimit: 2,
          recentInteractionMinutes: 120,
          quietHoursStart: '23:00',
          quietHoursEnd: '07:00',
          quietHoursTimezone: 'Asia/Shanghai',
          allowedModes: ['COMPANION'],
          offlineCapable: false,
        };
      }
      if (path === '/api/v1/relationships/11/proactive-policy' && method === 'PUT') {
        putPayloads.push(body ?? {});
        if (shouldFailSave) {
          throw new Error('服务器暂时不可用');
        }
        return {
          relationshipId: '11',
          ...(body ?? {}),
        };
      }
      return {};
    });

    const client: AppClient = {
      initialize: vi.fn(async () => ({ characters: [], chat: [], settings: {} })),
      go: {
        captureSessionContext: vi.fn(() => ({ userId: 'u-1', sessionId: 's-1' })),
        storyRequest,
      },
    } as unknown as AppClient;

    const guardCalls: boolean[] = [];
    const onSaved = vi.fn();

    render(
      <AppProviders client={client} queryClient={createQueryClient()}>
        <PolicyForm
          relId="11"
          onSaved={onSaved}
          guard={(dirty) => {
            guardCalls.push(dirty);
            return dirty ? <div data-testid="injected-guard">dirty-guard</div> : null;
          }}
        />
      </AppProviders>,
    );

    const capInput = (await waitFor(() => screen.getByLabelText('每日上限'))) as HTMLInputElement;
    await waitFor(() => {
      expect(capInput.value).toBe('2');
    });
    expect(screen.queryByTestId('injected-guard')).toBeNull();

    // Edit dailyLimit -> becomes dirty, injected guard renders
    fireEvent.change(capInput, { target: { value: '6' } });
    expect(capInput.value).toBe('6');
    await waitFor(() => {
      expect(screen.getByTestId('injected-guard')).toBeTruthy();
    });

    // Trigger validation failure by clearing only quietHoursEnd
    const endInput = screen.getByLabelText('静默结束') as HTMLInputElement;
    fireEvent.change(endInput, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '保存策略' }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('静默时段需要同时填写开始、结束和时区。');
    });
    expect(putPayloads.length).toBe(0);
    expect(capInput.value).toBe('6');
    expect(screen.getByTestId('injected-guard')).toBeTruthy();

    // Fix quietHoursEnd and trigger server failure -> draft '6' and dirty state must be preserved
    fireEvent.change(endInput, { target: { value: '07:30' } });
    fireEvent.click(screen.getByRole('button', { name: '保存策略' }));

    await waitFor(() => {
      expect(putPayloads.length).toBe(1);
      expect(screen.getByRole('alert').textContent).toContain('服务器暂时不可用');
    });
    expect(capInput.value).toBe('6');
    expect(endInput.value).toBe('07:30');
    expect(screen.getByTestId('injected-guard')).toBeTruthy();
    expect(onSaved).toHaveBeenCalledTimes(0);

    // Succeed on retry -> form resets to new baseline, isDirty becomes false, guard disappears
    shouldFailSave = false;
    fireEvent.click(screen.getByRole('button', { name: '保存策略' }));

    await waitFor(() => {
      expect(putPayloads.length).toBe(2);
      expect(onSaved).toHaveBeenCalledTimes(1);
    });
    expect(capInput.value).toBe('6');
    expect(endInput.value).toBe('07:30');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByTestId('injected-guard')).toBeNull();
  });

  it('useInboxList & InboxList mark unread event read, resolve conversationKey, and invoke injected onOpenConversation', async () => {
    const readCalls: string[] = [];
    const storyRequest = vi.fn(async (method: string, path: string) => {
      if (path === '/api/v1/inbox' && method === 'GET') {
        return [
          {
            eventId: 'evt-unread',
            relationshipId: '101',
            conversationId: '301',
            linkStatus: 'present',
            intent: 'BODY',
            body: '今晚想吃什么？',
            stDelivered: true,
            read: false,
          },
        ];
      }
      if (path === '/api/v1/inbox/evt-unread/read' && method === 'POST') {
        readCalls.push('evt-unread');
        return {
          eventId: 'evt-unread',
          relationshipId: '101',
          conversationId: '301',
          linkStatus: 'present',
          intent: 'BODY',
          body: '今晚想吃什么？',
          stDelivered: true,
          read: true,
        };
      }
      return {};
    });

    const client: AppClient = {
      initialize: vi.fn(async () => ({ characters: [], chat: [], settings: {} })),
      recent: vi.fn(async () => [
        {
          avatar: 'alice.png',
          file_name: 'chat-301.jsonl',
          chat_metadata: {
            vc_binding: { relationshipId: '101', conversationId: '301' },
          },
        },
      ]),
      go: {
        captureSessionContext: vi.fn(() => ({ userId: 'u-1', sessionId: 's-1' })),
        storyRequest,
      },
    } as unknown as AppClient;

    const onOpenConversation = vi.fn();

    render(
      <AppProviders client={client} queryClient={createQueryClient()}>
        <InboxList onOpenConversation={onOpenConversation} />
      </AppProviders>,
    );

    const openBtn = await waitFor(() => screen.getByRole('button', { name: '打开对话' }));
    fireEvent.click(openBtn);

    await waitFor(() => {
      expect(readCalls).toEqual(['evt-unread']);
      expect(onOpenConversation).toHaveBeenCalledTimes(1);
    });

    expect(onOpenConversation.mock.calls[0][0]).toBe('["alice.png","chat-301"]');
    expect(onOpenConversation.mock.calls[0][1]).toMatchObject({
      eventId: 'evt-unread',
      relationshipId: '101',
      conversationId: '301',
    });
  });

  it('useChannelSheet & ChannelSheet preserve draft on 401/403, support credential set and clear, and retry save after ReauthDialog succeeds', async () => {
    let requireReauth = true;
    const putBodies: Array<Record<string, unknown>> = [];
    const reauthCalls: string[] = [];

    const storyRequest = vi.fn(async (method: string, path: string, body?: Record<string, unknown>) => {
      if (path === '/api/v1/notification-channels' && method === 'GET') {
        return [
          {
            channelId: '401',
            channel: 'EMAIL',
            configuredTarget: 'owner@example.com',
            relationshipIds: ['101'],
            enabled: true,
            previewBody: false,
            credentialState: 'withheld',
          },
        ];
      }
      if (path === '/api/v1/notification-channels' && method === 'PUT') {
        putBodies.push(body ?? {});
        if (requireReauth) {
          const err = new Error('需要重新验证') as Error & { status?: number; kind?: string };
          err.status = 403;
          err.kind = 'forbidden';
          throw err;
        }
        return {
          channelId: '401',
          ...(body ?? {}),
        };
      }
      return {};
    });

    const client: AppClient = {
      initialize: vi.fn(async () => ({ characters: [], chat: [], settings: {} })),
      go: {
        captureSessionContext: vi.fn(() => ({ userId: 'u-1', sessionId: 's-1' })),
        fetchRelationships: vi.fn(async () => [
          { relationshipId: '101', personaRef: 'st-character', companionName: '阿梨', mode: 'COMPANION' },
          { relationshipId: '202', personaRef: 'st-character', companionName: '小夏', mode: 'STORY' },
        ]),
        storyRequest,
        reauth: vi.fn(async (pwd: string) => {
          reauthCalls.push(pwd);
          requireReauth = false;
          return { ok: true };
        }),
      },
    } as unknown as AppClient;

    render(
      <AppProviders client={client} queryClient={createQueryClient()}>
        <ChannelSheet relId="101" />
      </AppProviders>,
    );

    await waitFor(() => {
      expect(screen.getByText('owner@example.com')).toBeTruthy();
    });
    const configButtons = screen.getAllByRole('button', { name: '配置' });
    fireEvent.click(configButtons[0]);

    const targetInput = (await screen.findByLabelText('收件地址或标识')) as HTMLInputElement;
    expect(targetInput.value).toBe('owner@example.com');

    // Update target, enter credential, then toggle "清除凭据"
    fireEvent.change(targetInput, { target: { value: 'updated@example.com' } });
    const credInput = screen.getByLabelText('渠道凭据') as HTMLInputElement;
    fireEvent.change(credInput, { target: { value: 'temp-secret' } });
    expect(credInput.value).toBe('temp-secret');

    const clearSwitch = screen.getByRole('switch', { name: '清除凭据' });
    fireEvent.click(clearSwitch);
    expect(credInput.value).toBe('');

    // Save channel -> receives 403 forbidden, opens ReauthDialog while keeping ChannelSheet draft open
    fireEvent.click(screen.getByRole('button', { name: '保存渠道' }));

    const pwdInput = await waitFor(() => screen.getByLabelText('当前密码'));
    expect(putBodies.length).toBe(1);
    expect(putBodies[0]).toEqual({
      channel: 'EMAIL',
      enabled: true,
      configuredTarget: 'updated@example.com',
      previewBody: false,
      relationshipIds: ['101'],
      credential: null,
    });

    // Complete reauth -> automatically retries channel PUT with preserved draft (including credential: null)
    fireEvent.change(pwdInput, { target: { value: 'my-password' } });
    fireEvent.click(screen.getByRole('button', { name: '确认验证' }));

    await waitFor(() => {
      expect(reauthCalls).toEqual(['my-password']);
      expect(putBodies.length).toBe(2);
    });
    expect(putBodies[1]).toEqual({
      channel: 'EMAIL',
      enabled: true,
      configuredTarget: 'updated@example.com',
      previewBody: false,
      relationshipIds: ['101'],
      credential: null,
    });
  });

  it('useFollowUpsState & FollowUps retry cancel after 403 reauth', async () => {
    let requireReauth = true;
    const cancelCalls: string[] = [];

    const storyRequest = vi.fn(async (method: string, path: string) => {
      if (path === '/api/v1/relationships/101/follow-ups' && method === 'GET') {
        return [
          {
            followUpId: '901',
            relationshipId: '101',
            status: 'SCHEDULED',
            eventId: 'evt-901',
            body: '周末一起看展',
          },
        ];
      }
      if (path === '/api/v1/follow-ups/901/cancel' && method === 'POST') {
        cancelCalls.push('901');
        if (requireReauth) {
          const err = new Error('需要重新验证') as Error & { status?: number; kind?: string };
          err.status = 403;
          err.kind = 'forbidden';
          throw err;
        }
        return {
          followUpId: '901',
          relationshipId: '101',
          status: 'CANCELLED',
          eventId: 'evt-901',
          body: '周末一起看展',
        };
      }
      return {};
    });

    const client: AppClient = {
      initialize: vi.fn(async () => ({ characters: [], chat: [], settings: {} })),
      go: {
        captureSessionContext: vi.fn(() => ({ userId: 'u-1', sessionId: 's-1' })),
        storyRequest,
        reauth: vi.fn(async () => {
          requireReauth = false;
          return { ok: true };
        }),
      },
    } as unknown as AppClient;

    render(
      <AppProviders client={client} queryClient={createQueryClient()}>
        <FollowUps relId="101" />
      </AppProviders>,
    );

    const cancelBtn = await waitFor(() => screen.getByRole('button', { name: '取消跟进' }));
    fireEvent.click(cancelBtn);

    // Confirm in AlertDialog
    const confirmBtns = await waitFor(() => screen.getAllByRole('button', { name: '取消跟进' }));
    fireEvent.click(confirmBtns[confirmBtns.length - 1]);

    // 403 triggers ReauthDialog
    const pwdInput = await waitFor(() => screen.getByLabelText('当前密码'));
    expect(cancelCalls).toEqual(['901']);

    fireEvent.change(pwdInput, { target: { value: 'valid-pass' } });
    fireEvent.click(screen.getByRole('button', { name: '确认验证' }));

    await waitFor(() => {
      expect(cancelCalls).toEqual(['901', '901']);
    });
  });
});
