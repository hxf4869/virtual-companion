import React, { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { Collapsible } from '@base-ui/react/collapsible';
import { Button } from '@base-ui/react/button';
import './settings.css';
import {
  CONSENT_ERROR_COPY,
  REQUIRED_CONSENTS,
  consentOutstanding,
  submitConsentGrants,
} from '../../../../extension/vc-model-settings/consent-logic.js';
import { iconSpriteUrl } from '../../../../extension/vc-model-settings/ui/icons.js';
import { useAppClient } from '../../app/providers';
import { useConsentsQuery, useExitDesktopAccount, useRecordConsentMutation } from '../../data/queries/account';
import { Icon } from '../../design/components/Icon';

export interface AppConsentGateProps {
  children?: ReactNode;
}

function isReauthError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const candidate = err as { status?: number; code?: string; kind?: string };
  return (
    candidate.status === 403 ||
    candidate.code === 'RECENT_REAUTH_REQUIRED' ||
    candidate.kind === 'forbidden'
  );
}

export function AppConsentGate({ children }: AppConsentGateProps) {
  const client = useAppClient();
  const exit = useExitDesktopAccount();
  const consentsQuery = useConsentsQuery();
  const recordConsentMutation = useRecordConsentMutation();
  const sprite = iconSpriteUrl();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reauthOpen, setReauthOpen] = useState(false);
  const [reauthError, setReauthError] = useState('');
  const [resetCounter, setResetCounter] = useState(0);

  const titleRef = useRef<HTMLHeadingElement>(null);
  const reauthInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (reauthOpen) {
      reauthInputRef.current?.focus();
    }
  }, [reauthOpen, resetCounter]);

  const records = useMemo(
    () => (Array.isArray(consentsQuery.data) ? consentsQuery.data : []),
    [consentsQuery.data],
  );

  const outstanding = useMemo(
    () => (consentsQuery.isSuccess ? consentOutstanding(records) : REQUIRED_CONSENTS),
    [consentsQuery.isSuccess, records],
  );

  const performAccept = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const res: any = await submitConsentGrants({
        record: (body: { consentType: string; version: string; granted: boolean }) =>
          recordConsentMutation.mutateAsync(body),
      });
      if (!res.ok) {
        if (res.reauth || isReauthError(res.error)) {
          setReauthError('');
          setResetCounter((c) => c + 1);
          setReauthOpen(true);
        } else {
          setError(res.error?.message || res.errorCopy || CONSENT_ERROR_COPY);
        }
        return;
      }
      await consentsQuery.refetch();
    } catch (err: any) {
      if (isReauthError(err)) {
        setReauthError('');
        setResetCounter((c) => c + 1);
        setReauthOpen(true);
      } else {
        setError(err?.message || CONSENT_ERROR_COPY);
      }
    } finally {
      setBusy(false);
    }
  }, [busy, recordConsentMutation, consentsQuery]);

  const handleLogout = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await client.go.logoutCurrent();
      exit();
    } catch {
      setError(CONSENT_ERROR_COPY);
    } finally {
      setBusy(false);
    }
  }, [busy, client.go, exit]);

  const handleVerifyReauth = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (busy) return;
      const form = e.currentTarget;
      const input = form.querySelector<HTMLInputElement>('[data-consent-reauth-password]');
      const password = input?.value ?? '';
      if (input) {
        input.value = '';
      }
      setResetCounter((c) => c + 1);
      if (!password) {
        setReauthError('请输入当前密码。');
        return;
      }
      setBusy(true);
      setReauthError('');
      try {
        await client.go.reauth(password);
        setReauthOpen(false);
        setResetCounter((c) => c + 1);
        const res: any = await submitConsentGrants({
          record: (body: { consentType: string; version: string; granted: boolean }) =>
            recordConsentMutation.mutateAsync(body),
        });
        if (!res.ok) {
          setError(res.error?.message || res.errorCopy || CONSENT_ERROR_COPY);
          return;
        }
        await consentsQuery.refetch();
      } catch (err: any) {
        setResetCounter((c) => c + 1);
        setReauthError(err?.message || '验证失败，请重试。');
      } finally {
        setBusy(false);
      }
    },
    [busy, client.go, recordConsentMutation, consentsQuery],
  );

  const handleCancelReauth = useCallback(() => {
    if (busy) return;
    if (reauthInputRef.current) {
      reauthInputRef.current.value = '';
    }
    setReauthOpen(false);
    setReauthError('');
    setResetCounter((c) => c + 1);
  }, [busy]);

  if (consentsQuery.isLoading) {
    return null;
  }

  if (consentsQuery.isSuccess && outstanding.length === 0) {
    return <>{children}</>;
  }

  const displayError =
    error || (consentsQuery.isError ? CONSENT_ERROR_COPY : '');

  return (
    <Dialog.Root
      defaultOpen
      open
      disablePointerDismissal
      onOpenChange={(open, details) => {
        if (!open) details.cancel();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop
          className="vc-consent-backdrop"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'var(--vc-sheet, Canvas)',
            zIndex: 'var(--vc-z-alert)',
          }}
        />
        <Dialog.Popup
          id="vc-consent"
          className="vc-consent"
          style={{ zIndex: 'var(--vc-z-alert, 60)' }}
          aria-labelledby="vc-consent-title"
          initialFocus={titleRef}
        >
          <div className="vc-consent-scroll" inert={reauthOpen || undefined}>
            <h1 ref={titleRef} id="vc-consent-title" className="vc-large-title" tabIndex={-1}>
              开始之前
            </h1>
            <div className="vc-group">
              {REQUIRED_CONSENTS.map((item: { type: string; label: string; icon: string; body: string }) => (
                <Collapsible.Root
                  key={item.type}
                  className={(state) => `vc-consent-item${state.open ? ' is-open' : ''}`}
                >
                  <Collapsible.Trigger className="vc-cell" data-consent-toggle={item.type}>
                    <Icon sprite={sprite} name={item.icon} size={22} />
                    <span className="vc-grow">{item.label}</span>
                    <span className="vc-consent-chevron">
                      <Icon sprite={sprite} name="chevron-right" size={18} />
                    </span>
                  </Collapsible.Trigger>
                  <Collapsible.Panel keepMounted render={<p />} className="vc-consent-copy">
                    {item.body}
                  </Collapsible.Panel>
                </Collapsible.Root>
              ))}
            </div>
            <p
              className="vc-consent-error"
              data-consent-error=""
              role="alert"
              hidden={!displayError}
            >
              {displayError}
            </p>
          </div>
          <div className="vc-consent-bar" inert={reauthOpen || undefined}>
            <Button
              className="vc-btn vc-btn-fill"
              data-consent-accept=""
              disabled={busy}
              onClick={() => void performAccept()}
            >
              同意并继续
            </Button>
            <Button
              className="vc-btn vc-btn-text"
              data-consent-logout=""
              onClick={() => void handleLogout()}
            >
              退出登录
            </Button>
          </div>
          <form
            data-consent-reauth=""
            hidden={!reauthOpen}
            onSubmit={(e) => void handleVerifyReauth(e)}
          >
            <h2>重新验证身份</h2>
            <label>
              当前密码
              <input
                ref={reauthInputRef}
                key={resetCounter}
                type="password"
                autoComplete="current-password"
                data-consent-reauth-password=""
              />
            </label>
            <p
              className="vc-consent-error"
              data-consent-reauth-status=""
              role="alert"
              hidden={!reauthError}
            >
              {reauthError}
            </p>
            <Button type="submit" className="vc-btn vc-btn-fill" disabled={busy}>
              验证并继续
            </Button>
            <Button
              className="vc-btn vc-btn-text"
              data-consent-reauth-cancel=""
              onClick={handleCancelReauth}
            >
              取消
            </Button>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export { AppConsentGate as ConsentGate };
export default AppConsentGate;
