import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react';
import { RouterProvider } from '@tanstack/react-router';
import { AppProviders, createQueryClient } from '../../src/app/providers';
import { createDesktopRouter } from '../../src/app/router';
import { ConflictError, type AppClient } from '../../src/data/client';
import { PolicyForm } from '../../src/features/inbox/PolicyForm';
import { InboxRoute } from '../../src/features/inbox/InboxRoute';

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

describe('PolicyForm', () => {
  beforeEach(() => {
    setupMatchMedia(1440);
    window.localStorage.clear();
    window.history.replaceState(null, '', '/');
    window.location.hash = '';
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('sends complete real proactive-policy PUT payload and on 409 shows mine/latest and load latest replaces form', async () => {
    let serverPolicy = {
      relationshipId: '11',
      enabled: true,
      quietHoursStart: '23:00',
      quietHoursEnd: '07:00',
      quietHoursTimezone: 'Asia/Shanghai',
      dailyLimit: 2,
      recentInteractionMinutes: 120,
      allowedModes: ['COMPANION'],
      offlineCapable: false,
      mode: 'DAILY',
      checkInAfterMinutes: 360,
    };

    let shouldConflict = true;
    const putBodies: Array<Record<string, unknown>> = [];

    const storyRequest = vi.fn(async (method: string, path: string, body?: Record<string, unknown>) => {
      if (path === '/api/v1/relationships/11/proactive-policy' && method === 'GET') {
        return serverPolicy;
      }
      if (path === '/api/v1/relationships/11/proactive-policy' && method === 'PUT') {
        const payload = body ?? {};
        putBodies.push(payload);
        if (shouldConflict) {
          serverPolicy = {
            ...serverPolicy,
            mode: 'FOLLOW_UP',
            dailyLimit: 1,
            quietHoursStart: '22:00',
            quietHoursEnd: '08:00',
          };
          throw new ConflictError('版本冲突 (409)，请刷新后重试', {
            code: 'REVISION_CONFLICT',
          });
        }
        serverPolicy = {
          ...serverPolicy,
          ...(payload as typeof serverPolicy),
        };
        return serverPolicy;
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

    const router = createDesktopRouter({
      routeOverrides: {
        inbox: () => <PolicyForm relId="11" />,
      },
    });

    render(
      <AppProviders client={client} queryClient={createQueryClient()}>
        <RouterProvider router={router} />
      </AppProviders>,
    );

    await act(async () => {
      await router.navigate({ to: '/inbox' });
    });

    const capInput = (await waitFor(() => screen.getByLabelText('每日上限'))) as HTMLInputElement;
    await waitFor(() => {
      expect(capInput.value).toBe('2');
    });

    // User modifies dailyLimit to 5 in their draft
    fireEvent.change(capInput, { target: { value: '5' } });
    expect(capInput.value).toBe('5');

    // Submit triggers PUT with real followup.go fields and receives 409 ConflictError
    fireEvent.click(screen.getByRole('button', { name: '保存策略' }));

    await waitFor(() => {
      expect(putBodies.length).toBe(1);
    });
    expect(putBodies[0]).toEqual({
      enabled: true,
      quietHoursStart: '23:00',
      quietHoursEnd: '07:00',
      quietHoursTimezone: 'Asia/Shanghai',
      dailyLimit: 5,
      recentInteractionMinutes: 120,
      allowedModes: ['COMPANION'],
      offlineCapable: false,
      mode: 'DAILY',
      checkInAfterMinutes: 360,
    });
    expect(Object.prototype.hasOwnProperty.call(putBodies[0], 'dailyCap')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(putBodies[0], 'quietHoursTz')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(putBodies[0], 'expectedVersion')).toBe(false);

    await waitFor(() => {
      expect(screen.getByText('我的草稿')).toBeTruthy();
      expect(screen.getByText('最新版本')).toBeTruthy();
    });

    // User's draft is still preserved in the form before clicking "加载最新"
    expect((screen.getByLabelText('每日上限') as HTMLInputElement).value).toBe('5');

    // Clicking "加载最新" replaces the form with the latest server version
    fireEvent.click(screen.getByRole('button', { name: '加载最新' }));

    await waitFor(() => {
      expect((screen.getByLabelText('每日上限') as HTMLInputElement).value).toBe('1');
    });
    expect(screen.queryByText('我的草稿')).toBeNull();
  });

  it('InboxRoute renders follow-ups, inbox events, channels, deliveries, and system notify toggle', async () => {
    const storyRequest = vi.fn(async (method: string, path: string, body?: Record<string, unknown>) => {
      if (path.endsWith('/proactive-policy') && method === 'GET') {
        return {
          relationshipId: '101',
          enabled: true,
          mode: 'DAILY',
          dailyLimit: 2,
          quietHoursStart: '23:00',
          quietHoursEnd: '07:00',
          quietHoursTimezone: 'Asia/Shanghai',
          version: 1,
        };
      }
      if (path.endsWith('/follow-ups') && method === 'GET') {
        return [
          {
            followUpId: '201',
            relationshipId: '101',
            status: 'SCHEDULED',
            eventId: 'evt-1',
            body: '明早提醒带伞',
          },
        ];
      }
      if (path === '/api/v1/inbox' && method === 'GET') {
        return [
          {
            eventId: 'evt-1',
            relationshipId: '101',
            conversationId: '301',
            linkStatus: 'present',
            intent: 'BODY',
            body: '早安，记得带伞哦',
            stDelivered: false,
            read: false,
          },
        ];
      }
      if (path === '/api/v1/notification-channels' && method === 'GET') {
        return [
          {
            channelId: '401',
            channel: 'EMAIL',
            configuredTarget: 'owner@example.com',
            relationshipIds: ['101'],
            enabled: true,
            previewBody: false,
          },
        ];
      }
      if (path === '/api/v1/notification-channels' && method === 'PUT') {
        return {
          channelId: '401',
          ...body,
        };
      }
      if (path === '/api/v1/notification-deliveries' && method === 'GET') {
        return [
          {
            deliveryId: '501',
            eventId: 'evt-1',
            channel: 'EMAIL',
            configuredTarget: 'owner@example.com',
            status: 'accepted',
          },
        ];
      }
      return {};
    });

    const client: AppClient = {
      initialize: vi.fn(async () => ({ characters: [], chat: [], settings: {} })),
      go: {
        captureSessionContext: vi.fn(() => ({ userId: 'u-1', sessionId: 's-1' })),
        fetchRelationships: vi.fn(async () => [
          { relationshipId: '9', personaRef: 'gentle-listener', companionName: null },
          { relationshipId: '101', personaRef: 'st-character', companionName: '阿梨', mode: 'COMPANION' },
        ]),
        storyRequest,
        reauth: vi.fn(async () => ({ ok: true })),
      },
    } as unknown as AppClient;

    const router = createDesktopRouter({
      routeOverrides: {
        inbox: () => <InboxRoute />,
      },
    });

    render(
      <AppProviders client={client} queryClient={createQueryClient()}>
        <RouterProvider router={router} />
      </AppProviders>,
    );

    await act(async () => {
      await router.navigate({ to: '/inbox' });
    });

    await waitFor(() => {
      expect(storyRequest).toHaveBeenCalledWith('GET', '/api/v1/relationships/101/proactive-policy');
      expect(storyRequest).toHaveBeenCalledWith('GET', '/api/v1/relationships/101/follow-ups');
      expect(screen.getByText('明早提醒带伞')).toBeTruthy();
      expect(screen.getByText('早安，记得带伞哦')).toBeTruthy();
      expect(screen.getByText('渠道已接受')).toBeTruthy();
    });

    // Open channel configuration and verify URL target is rejected
    fireEvent.click(screen.getAllByRole('button', { name: '配置' })[0]);
    const targetInput = await screen.findByLabelText('收件地址或标识');
    fireEvent.change(targetInput, { target: { value: 'https://malicious.example.com' } });
    fireEvent.click(screen.getByRole('button', { name: '保存渠道' }));

    await waitFor(() => {
      expect(screen.getByText('地址不能是链接。')).toBeTruthy();
    });
  });
});
