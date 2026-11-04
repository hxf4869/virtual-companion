import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { AppProviders } from '../../src/app/providers';
import type { AppClient } from '../../src/data/client';
import { AppConsentGate } from '../../src/features/settings/AppConsentGate';
import { CONSENT_VERSION, REQUIRED_CONSENTS } from '../../../extension/vc-model-settings/consent-logic.js';

describe('AppConsentGate', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
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
});
