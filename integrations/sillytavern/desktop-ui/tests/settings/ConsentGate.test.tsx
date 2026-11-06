import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { AppProviders, createQueryClient, queryClient } from '../../src/app/providers';
import type { AppClient } from '../../src/data/client';
import { AppConsentGate } from '../../src/features/settings/AppConsentGate';
import type { SessionBridge } from '../../src/runtime/session-bridge';
import { CONSENT_VERSION, REQUIRED_CONSENTS } from '../../../extension/vc-model-settings/consent-logic.js';

const APP_CONSENT_GATE_SRC = resolve(__dirname, '../../src/features/settings/AppConsentGate.tsx');
const SETTINGS_CSS_SRC = resolve(__dirname, '../../src/features/settings/settings.css');

describe('AppConsentGate', () => {
  beforeEach(() => {
    window.localStorage.clear();
    queryClient.clear();
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
    vi.restoreAllMocks();
  });

  it('destroys the private session and returns to login after logout succeeds', async () => {
    const client = { go: {
      listConsents: async () => [],
      logoutCurrent: vi.fn(async () => ({ ok: true })),
    } } as unknown as AppClient;
    const destroy = vi.fn();
    const replace = vi.spyOn(window.location, 'replace').mockImplementation(() => {});
    const cache = createQueryClient();
    cache.setQueryData(['private-test'], { loaded: true });
    render(
      <AppProviders client={client} queryClient={cache} sessionBridge={{ destroy } as unknown as SessionBridge}>
        <AppConsentGate />
      </AppProviders>,
    );
    fireEvent.click(await screen.findByRole('button', { name: '退出登录' }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/auth/'));
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(cache.getQueryData(['private-test'])).toBeUndefined();
  });

  it('AccountSection and useExitDesktopAccount preserve exact logout order and do not clear session on failure', async () => {
    const accountQuerySrc = readFileSync(
      resolve(__dirname, '../../src/data/queries/account.ts'),
      'utf8',
    );
    expect(accountQuerySrc).not.toMatch(/\b(window\.|document\.|localStorage|sessionStorage|HTMLElement)\b/);

    const { AccountSection } = await import('../../src/features/settings/AccountSection');
    const order: string[] = [];
    let shouldFail = true;

    const logoutCurrent = vi.fn(async () => {
      order.push('logoutCurrent');
      if (shouldFail) {
        throw new Error('logout network error');
      }
      return { ok: true };
    });
    const client = {
      go: {
        logoutCurrent,
      },
    } as unknown as AppClient;

    const destroy = vi.fn(() => {
      order.push('bridge.destroy');
    });
    const cache = createQueryClient();
    cache.setQueryData(['private-account-cache'], { secret: true });
    const origClear = cache.clear.bind(cache);
    vi.spyOn(cache, 'clear').mockImplementation(() => {
      order.push('queryClient.clear');
      origClear();
    });
    const onNavigateAuth = vi.fn((url: string) => {
      order.push(`navigate:${url}`);
    });

    render(
      <AppProviders
        client={client}
        queryClient={cache}
        sessionBridge={{ destroy, getContext: () => ({ name1: 'Owner' }) } as unknown as SessionBridge}
      >
        <AccountSection onNavigateAuth={onNavigateAuth} />
      </AppProviders>,
    );

    const logoutBtn = screen.getByRole('button', { name: '退出当前会话' });

    // 1) Failure must NOT destroy bridge, clear query cache, or redirect
    fireEvent.click(logoutBtn);
    await waitFor(() => {
      expect(logoutCurrent).toHaveBeenCalledTimes(1);
    });
    expect(destroy).not.toHaveBeenCalled();
    expect(onNavigateAuth).not.toHaveBeenCalled();
    expect(cache.getQueryData(['private-account-cache'])).toEqual({ secret: true });
    expect(order).toEqual(['logoutCurrent']);

    // 2) Subsequent success executes logoutCurrent -> bridge.destroy -> queryClient.clear -> navigate:/auth/
    order.length = 0;
    shouldFail = false;
    fireEvent.click(logoutBtn);
    await waitFor(() => {
      expect(onNavigateAuth).toHaveBeenCalledWith('/auth/');
    });
    expect(order).toEqual([
      'logoutCurrent',
      'bridge.destroy',
      'queryClient.clear',
      'navigate:/auth/',
    ]);
    expect(cache.getQueryData(['private-account-cache'])).toBeUndefined();
  });

  it('blocks app until required consents granted', async () => {
    const records: {
      consentType: string;
      version: string;
      granted: boolean;
      grantedAt: string;
    }[] = [];

    const listConsents = vi.fn(async () => [...records]);

    const recordConsent = vi.fn(
      async (body: { consentType: string; version: string; granted: boolean }) => {
        const entry = {
          consentType: body.consentType,
          version: body.version,
          granted: body.granted,
          grantedAt: '2026-11-04T09:00:00Z',
        };
        records.push(entry);
        return entry;
      },
    );

    const logoutCurrent = vi.fn(async () => ({ ok: true }));

    const client = {
      go: {
        captureSessionContext: vi.fn(async () => ({ accountId: '1', userId: 'u-1', sessionId: 's-1' })),
        listConsents,
        recordConsent,
        reauth: vi.fn(async () => ({ ok: true })),
        logoutCurrent,
      },
    } as unknown as AppClient;

    render(
      <AppProviders client={client}>
        <AppConsentGate>
          <div data-testid="protected-app-content">Protected App Workspace</div>
        </AppConsentGate>
      </AppProviders>,
    );

    // Gate must appear and protected content must be blocked while required consents are outstanding
    expect(await screen.findByText('开始之前')).toBeTruthy();
    expect(screen.queryByTestId('protected-app-content')).toBeNull();

    for (const item of REQUIRED_CONSENTS) {
      expect(screen.getByText(item.label)).toBeTruthy();
    }

    // Grant all 5 required consents
    const submitBtn = screen.getByRole('button', { name: '同意并继续' });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(recordConsent).toHaveBeenCalledTimes(REQUIRED_CONSENTS.length);
    });
    expect(recordConsent.mock.calls.map((c) => c[0])).toEqual(
      REQUIRED_CONSENTS.map((item: { type: string }) => ({
        consentType: item.type,
        version: CONSENT_VERSION,
        granted: true,
      })),
    );

    await waitFor(() => {
      expect(screen.getByTestId('protected-app-content')).toBeTruthy();
      expect(screen.queryByText('开始之前')).toBeNull();
    });
  });

  it('loads standalone consent styles and handles uncontrolled reauth overlay with parent inert', async () => {
    const gateSrc = readFileSync(APP_CONSENT_GATE_SRC, 'utf8');
    const settingsCss = readFileSync(SETTINGS_CSS_SRC, 'utf8');
    expect(gateSrc).toContain("import './settings.css'");
    expect(settingsCss).toMatch(/#vc-consent,\s*\.vc-consent\s*\{[\s\S]*?position:\s*fixed/);
    expect(settingsCss).toMatch(/\.vc-consent-scroll\s*\{[\s\S]*?overflow-y:\s*auto/);
    expect(settingsCss).toMatch(/\[data-consent-accept\][\s\S]*?height:\s*50px/);
    expect(settingsCss).toMatch(/\[data-consent-reauth\]\s*\{[\s\S]*?position:\s*absolute/);

    const records: {
      consentType: string;
      version: string;
      granted: boolean;
      grantedAt: string;
    }[] = [];
    let requireReauth = true;
    let reauthAttempt = 0;

    const listConsents = vi.fn(async () => [...records]);
    const recordConsent = vi.fn(
      async (body: { consentType: string; version: string; granted: boolean }) => {
        if (requireReauth) {
          throw Object.assign(new Error('需要重新验证身份'), {
            status: 403,
            code: 'RECENT_REAUTH_REQUIRED',
          });
        }
        const entry = {
          consentType: body.consentType,
          version: body.version,
          granted: body.granted,
          grantedAt: '2026-11-04T09:05:00Z',
        };
        records.push(entry);
        return entry;
      },
    );
    const reauth = vi.fn(async (_pwd: string) => {
      reauthAttempt += 1;
      if (reauthAttempt === 1) {
        throw new Error('密码错误');
      }
      requireReauth = false;
      return { ok: true };
    });

    const client = {
      go: {
        captureSessionContext: vi.fn(async () => ({ accountId: '1', userId: 'u-1', sessionId: 's-1' })),
        listConsents,
        recordConsent,
        reauth,
        logoutCurrent: vi.fn(async () => ({ ok: true })),
      },
    } as unknown as AppClient;

    render(
      <AppProviders client={client}>
        <AppConsentGate>
          <div data-testid="protected-app-content">Protected App Workspace</div>
        </AppConsentGate>
      </AppProviders>,
    );

    expect(await screen.findByText('开始之前')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '同意并继续' }));

    await waitFor(() => {
      const reauthForm = document.querySelector<HTMLFormElement>('[data-consent-reauth]');
      expect(reauthForm?.hidden).toBe(false);
    });

    const scrollEl = document.querySelector('.vc-consent-scroll');
    const barEl = document.querySelector('.vc-consent-bar');
    expect(scrollEl?.hasAttribute('inert')).toBe(true);
    expect(barEl?.hasAttribute('inert')).toBe(true);

    // Uncontrolled password input: typing does not write secret to static value attribute, and failure clears it
    let pwdInput = document.querySelector<HTMLInputElement>('[data-consent-reauth-password]')!;
    pwdInput.value = 'wrong-pass';
    expect(pwdInput.getAttribute('value')).toBeNull();
    fireEvent.submit(document.querySelector<HTMLFormElement>('[data-consent-reauth]')!);

    await waitFor(() => {
      expect(reauth).toHaveBeenCalledTimes(1);
    });
    pwdInput = document.querySelector<HTMLInputElement>('[data-consent-reauth-password]')!;
    expect(pwdInput.value).toBe('');

    // Cancel clears error and closes reauth layer
    fireEvent.click(document.querySelector<HTMLElement>('[data-consent-reauth-cancel]')!);
    expect(document.querySelector<HTMLFormElement>('[data-consent-reauth]')?.hidden).toBe(true);
    expect(scrollEl?.hasAttribute('inert')).toBe(false);

    // Re-trigger and succeed
    fireEvent.click(screen.getByRole('button', { name: '同意并继续' }));
    await waitFor(() => {
      expect(document.querySelector<HTMLFormElement>('[data-consent-reauth]')?.hidden).toBe(false);
    });
    pwdInput = document.querySelector<HTMLInputElement>('[data-consent-reauth-password]')!;
    pwdInput.value = 'correct-pass';
    fireEvent.submit(document.querySelector<HTMLFormElement>('[data-consent-reauth]')!);

    await waitFor(() => {
      expect(screen.getByTestId('protected-app-content')).toBeTruthy();
      expect(document.querySelector('#vc-consent')).toBeNull();
    });
  });
});
