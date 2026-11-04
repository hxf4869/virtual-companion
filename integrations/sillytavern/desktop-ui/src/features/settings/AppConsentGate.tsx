import React, { type ReactNode, useCallback, useMemo, useRef, useState } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { Collapsible } from '@base-ui/react/collapsible';
import { Button } from '@base-ui/react/button';
import {
  CONSENT_ERROR_COPY,
  REQUIRED_CONSENTS,
  consentOutstanding,
  submitConsentGrants,
} from '../../../../extension/vc-model-settings/consent-logic.js';
import { iconSpriteUrl } from '../../../../extension/vc-model-settings/ui/icons.js';
import { useAppClient } from '../../app/providers';
import { useConsentsQuery, useRecordConsentMutation } from '../../data/queries/account';
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
  const consentsQuery = useConsentsQuery();
  const recordConsentMutation = useRecordConsentMutation();
  const sprite = iconSpriteUrl();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reauthOpen, setReauthOpen] = useState(false);
  const [reauthError, setReauthError] = useState('');
  const [reauthPassword, setReauthPassword] = useState('');
  const [resetCounter, setResetCounter] = useState(0);

  const titleRef = useRef<HTMLHeadingElement>(null);

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
          setReauthOpen(true);
          setReauthError('');
          setReauthPassword('');
          setResetCounter((c) => c + 1);
        } else {
          setError(res.error?.message || res.errorCopy || CONSENT_ERROR_COPY);
        }
        return;
      }
      await consentsQuery.refetch();
    } catch (err: any) {
      if (isReauthError(err)) {
        setReauthOpen(true);
        setReauthError('');
        setReauthPassword('');
        setResetCounter((c) => c + 1);
      } else {
        setError(err?.message || CONSENT_ERROR_COPY);
      }
    } finally {
      setBusy(false);
    }
  }, [busy, recordConsentMutation, consentsQuery]);

  const handleLogout = useCallback(async () => {
    try {
      await client.go.logoutCurrent?.();
    } catch {
      // ignore logout error
    }
  }, [client.go]);

  const handleVerifyReauth = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (busy) return;
      if (!reauthPassword) {
        setReauthError('请输入当前密码。');
        return;
      }
      setBusy(true);
      setReauthError('');
      try {
        await client.go.reauth(reauthPassword);
        setReauthPassword('');
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
        setReauthPassword('');
        setResetCounter((c) => c + 1);
        setReauthError(err?.message || '验证失败，请重试。');
      } finally {
        setBusy(false);
      }
    },
    [busy, reauthPassword, client.go, recordConsentMutation, consentsQuery],
  );

  const handleCancelReauth = useCallback(() => {
    setReauthOpen(false);
    setReauthError('');
    setReauthPassword('');
    setResetCounter((c) => c + 1);
  }, []);

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
                key={resetCounter}
                type="password"
                autoComplete="current-password"
                data-consent-reauth-password=""
                value={reauthPassword}
                onChange={(e) => setReauthPassword(e.target.value)}
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
