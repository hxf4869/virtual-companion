import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AUTH_RESET_COPY,
  BACKUP_COPY,
  EXPORT_PARTIAL_COPY,
  PASSWORD_CHANGED_COPY,
  RESTORE_LIMIT_COPY,
  SESSION_EMPTY_COPY,
  authenticatorStatusText,
  deletionProgressText,
  otherSessions,
  sessionRowText,
} from '../../../../extension/vc-model-settings/account-logic.js';
import {
  EXPORT_POLL_INTERVAL_MS,
  REQUIRED_CONSENTS,
  consentStatusText,
  effectiveConsents,
  executeSensitiveAction,
  formatTrustedDeviceLine,
  formatVoiceStorage,
} from '../../../../extension/vc-model-settings/consent-logic.js';
import { iconSpriteUrl } from '../../../../extension/vc-model-settings/ui/icons.js';
import { useAppClient } from '../../app/providers';
import {
  useConsentsQuery,
  useSessionQuery,
  useSessionsQuery,
  useTrustedDevicesQuery,
} from '../../data/queries/account';
import { useVoiceUsageQuery } from '../../data/queries/voice';
import { AlertDialog } from '../../design/components/AlertDialog';
import { Dialog } from '../../design/components/Dialog';
import { AccountContents } from './AccountContents';

export interface DesktopAccountDialogProps {
  open: boolean;
  initialScreen?: string;
  inline?: boolean;
  onOpenChange: (open: boolean) => void;
}

interface PendingSensitiveAction {
  action: 'password' | 'reset' | 'export' | 'recover' | 'delete' | 'consent-revoke';
  newPassword?: string;
  consentType?: string;
}

interface ConfirmPromptState {
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
}

function accountTitle(screen: string): string {
  return (
    ({
      home: '账户与数据',
      password: '修改密码',
      auth: '验证器',
      sessions: '当前会话',
      devices: '已信任的设备',
      consent: '隐私与同意',
      export: '导出数据',
      delete: '删除账号及在线数据',
    } as Record<string, string>)[screen] || '账户与数据'
  );
}

function errorCopyFor(error: unknown): string {
  const kind = (error as { kind?: string } | null)?.kind;
  if (kind === 'unauthenticated') return '请重新登录后重试。';
  if (kind === 'context-changed') return '登录状态已变化，请重新加载页面。';
  return '操作尚未完成，请稍后重试。';
}

export function DesktopAccountDialog({
  open,
  initialScreen = 'home',
  inline = false,
  onOpenChange,
}: DesktopAccountDialogProps) {
  const client = useAppClient();
  const active = open || inline;

  const sessionQuery = useSessionQuery(active);
  const sessionsQuery = useSessionsQuery(active);
  const devicesQuery = useTrustedDevicesQuery(active);
  const consentsQuery = useConsentsQuery(active);
  const voiceUsageQuery = useVoiceUsageQuery(active);

  const [screen, setScreen] = useState<string>(initialScreen);
  const [busy, setBusy] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [downloadVisible, setDownloadVisible] = useState(false);
  const [deleteFormHidden, setDeleteFormHidden] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteChecked, setDeleteChecked] = useState(false);
  const [reauthOpen, setReauthOpen] = useState(false);
  const [passwordReset, setPasswordReset] = useState(0);
  const [reauthReset, setReauthReset] = useState(0);
  const [deleteReset, setDeleteReset] = useState(0);
  const [pending, setPending] = useState<PendingSensitiveAction | null>(null);
  const [confirmPrompt, setConfirmPrompt] = useState<ConfirmPromptState | null>(null);

  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const epochRef = useRef(0);

  const clearTimers = useCallback(() => {
    if (pollTimerRef.current !== null) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const clearSecrets = useCallback(() => {
    setPasswordReset((n) => n + 1);
    setReauthReset((n) => n + 1);
    setDeleteReset((n) => n + 1);
  }, []);

  useEffect(() => {
    if (active) {
      epochRef.current += 1;
      setScreen(initialScreen || 'home');
      if (initialScreen === 'delete') {
        setDeleteOpen(true);
      }
      clearSecrets();
    } else {
      epochRef.current += 1;
      clearTimers();
      clearSecrets();
      setPending(null);
      setReauthOpen(false);
      setStatuses({});
      setDownloadUrl(null);
      setDownloadVisible(false);
      setConfirmPrompt(null);
    }
    return () => {
      clearTimers();
    };
  }, [active, initialScreen, clearSecrets, clearTimers]);

  const closeDialog = useCallback(() => {
    if (busy) return;
    if (reauthOpen) {
      setPending(null);
      clearSecrets();
      setStatuses((prev) => ({ ...prev, reauth: '' }));
      setReauthOpen(false);
      return;
    }
    epochRef.current += 1;
    clearTimers();
    clearSecrets();
    setPending(null);
    setReauthOpen(false);
    setStatuses({});
    setDownloadUrl(null);
    setDownloadVisible(false);
    onOpenChange(false);
  }, [busy, reauthOpen, clearTimers, clearSecrets, onOpenChange]);

  const authText = useMemo(
    () => authenticatorStatusText(sessionQuery.data),
    [sessionQuery.data],
  );
  const authSummary = authText.includes('未启用')
    ? '未启用'
    : authText.includes('已启用')
      ? '已启用'
      : authText;

  const voiceStorage = useMemo(() => {
    if (voiceUsageQuery.isError) return '暂不可用';
    if (!voiceUsageQuery.data) return '';
    return formatVoiceStorage(
      (voiceUsageQuery.data as { storageBytes?: number })?.storageBytes,
    );
  }, [voiceUsageQuery.data, voiceUsageQuery.isError]);

  const rawSessions = useMemo(
    () => (Array.isArray(sessionsQuery.data) ? sessionsQuery.data : []),
    [sessionsQuery.data],
  );
  const sessionLines = useMemo(
    () => rawSessions.map((row: unknown) => sessionRowText(row)),
    [rawSessions],
  );
  const hasOtherSessions = useMemo(
    () => otherSessions(rawSessions).length > 0,
    [rawSessions],
  );

  const devices = useMemo(() => {
    const list = Array.isArray(devicesQuery.data) ? devicesQuery.data : [];
    return list
      .filter((item: { id?: unknown }) => /^[1-9][0-9]*$/.test(String(item?.id || '')))
      .map((item: { id: unknown; displayName?: string; lastUsedAt?: string; expiresAt?: string }) => {
        const line = formatTrustedDeviceLine(item);
        return {
          id: String(item.id),
          name: line.name,
          meta: `最近使用 ${line.lastUsed} · 到期 ${line.expires}`,
        };
      });
  }, [devicesQuery.data]);

  const consents = useMemo(() => {
    const raw = Array.isArray(consentsQuery.data)
      ? consentsQuery.data
      : Array.isArray((consentsQuery.data as { items?: unknown[] } | undefined)?.items)
        ? (consentsQuery.data as { items: unknown[] }).items
        : [];
    const map = effectiveConsents(raw);
    return REQUIRED_CONSENTS.map((item) => ({
      type: item.type,
      icon: item.icon,
      label: item.label,
      meta: consentStatusText(map.get(item.type)),
    }));
  }, [consentsQuery.data]);

  const showExport = useCallback(
    (result: Record<string, any>, epoch: number) => {
      if (epoch !== epochRef.current) return;
      if (result?.downloadUrl) {
        setDownloadUrl(String(result.downloadUrl));
      }
      setDownloadVisible(result?.status === 'READY' && Boolean(result?.downloadUrl));
      if (result?.status === 'PARTIAL') {
        setStatuses((prev) => ({ ...prev, export: EXPORT_PARTIAL_COPY }));
      } else if (result?.status === 'READY') {
        const expires = result.expiresAt
          ? new Intl.DateTimeFormat('zh-CN', {
              dateStyle: 'short',
              timeStyle: 'short',
            }).format(new Date(result.expiresAt))
          : '';
        setStatuses((prev) => ({
          ...prev,
          export: `副本已生成，下载链接仅可使用一次。${expires ? `有效至 ${expires}。` : ''}`,
        }));
      } else if (result?.status === 'PENDING') {
        const copy =
          result.errorMessage === 'ST_UNAVAILABLE'
            ? '聊天存储暂不可用，恢复后会继续生成。你可以稍后取回最近副本。'
            : '副本生成中。关闭页面后任务会继续，你可以稍后取回最近副本。';
        setStatuses((prev) => ({ ...prev, export: copy }));
        clearTimers();
        pollTimerRef.current = setTimeout(async () => {
          try {
            const next = await client.go.getDataExport(result.exportId);
            showExport(next, epoch);
          } catch (err) {
            if (epoch === epochRef.current) {
              setStatuses((prev) => ({ ...prev, export: errorCopyFor(err) }));
            }
          }
        }, EXPORT_POLL_INTERVAL_MS);
      } else {
        const copy =
          result?.errorMessage === 'ST_EXPORT_TOO_LARGE'
            ? '当前私有内容超过导出上限，未生成副本。请减少文件数量或大小后重试。'
            : '副本未完成或已失效，请重新生成。';
        setStatuses((prev) => ({ ...prev, export: copy }));
      }
    },
    [clearTimers, client.go],
  );

  const openReauth = useCallback(
    (
      action: PendingSensitiveAction['action'],
      extra: { newPassword?: string; consentType?: string } = {},
    ) => {
      setPending({
        action,
        newPassword: extra.newPassword,
        consentType: extra.consentType,
      });
      setStatuses((prev) => ({ ...prev, reauth: '' }));
      setReauthReset((n) => n + 1);
      setReauthOpen(true);
    },
    [],
  );

  const handleSubmit = useCallback(
    async (action: string, form: HTMLFormElement) => {
      if (busy || deleted) return;
      if (action === 'password') {
        const input = form.elements.namedItem('newPassword') as HTMLInputElement | null;
        const newPassword = input?.value || '';
        if (input) input.value = '';
        setPasswordReset((n) => n + 1);
        if (!newPassword) return;
        openReauth('password', { newPassword });
        return;
      }

      if (action === 'delete') {
        setConfirmPrompt({
          title: '删除账号及在线数据',
          description:
            '在线聊天、角色、世界书、记忆、导出文件和私有备份将一并清除。离线备份另行清理。',
          confirmLabel: '删除',
          danger: true,
          onConfirm: () => {
            openReauth('delete');
          },
        });
        return;
      }

      if (action !== 'reauth' || !pending) return;

      const pwdInput = form.querySelector<HTMLInputElement>('[data-reauth-password]');
      const password = pwdInput?.value || '';
      if (pwdInput) pwdInput.value = '';
      setReauthReset((n) => n + 1);
      if (!password) return;

      const epoch = epochRef.current;
      const currentPending = pending;
      setStatuses((prev) => ({ ...prev, reauth: '正在验证…' }));
      setBusy(true);

      try {
        const sessionCtx = await client.go.captureSessionContext();
        const accountId = String(sessionCtx?.accountId || '');
        const result = await executeSensitiveAction({
          action: currentPending.action,
          password,
          newPassword: currentPending.newPassword,
          accountId,
          consentType: currentPending.consentType,
          deps: {
            reauth: client.go.reauth,
            changePassword: client.go.changePassword,
            resetAuthenticator: client.go.resetAuthenticator,
            createDataExport: client.go.createDataExport,
            recoverDataExport: client.go.recoverDataExport,
            deleteOwnAccount: client.go.deleteOwnAccount,
            recordConsent: client.go.recordConsent,
          },
        });

        if (epoch !== epochRef.current) return;
        setPending(null);
        setReauthOpen(false);
        setStatuses((prev) => ({ ...prev, reauth: '' }));

        if (currentPending.action === 'password') {
          setStatuses((prev) => ({ ...prev, password: PASSWORD_CHANGED_COPY }));
        } else if (currentPending.action === 'reset') {
          setStatuses((prev) => ({ ...prev, auth: AUTH_RESET_COPY }));
          void sessionQuery.refetch();
        } else if (
          currentPending.action === 'export' ||
          currentPending.action === 'recover'
        ) {
          showExport(result || {}, epoch);
        } else if (currentPending.action === 'delete') {
          if (result?.ok === true && result?.status !== 'PENDING') {
            setDeleted(true);
            setDownloadVisible(false);
            setStatuses((prev) => ({
              ...prev,
              delete: '在线数据已删除。离线备份按保留策略另行清理。',
            }));
          } else {
            const domains = Array.isArray(result?.pendingDomains)
              ? result.pendingDomains
              : [];
            setDeleteFormHidden(true);
            setDeleteOpen(true);
            setStatuses((prev) => ({
              ...prev,
              delete: deletionProgressText({ pendingDomains: domains }),
            }));
          }
        } else if (currentPending.action === 'consent-revoke') {
          await consentsQuery.refetch();
        }
      } catch (err) {
        if (epoch !== epochRef.current) return;
        setStatuses((prev) => ({ ...prev, reauth: errorCopyFor(err) }));
      } finally {
        if (epoch === epochRef.current) {
          setReauthReset((n) => n + 1);
          setBusy(false);
        }
      }
    },
    [
      busy,
      deleted,
      pending,
      openReauth,
      client.go,
      sessionQuery,
      consentsQuery,
      showExport,
    ],
  );

  const handleAction = useCallback(
    async (action: string, target: HTMLElement) => {
      if (busy) return;
      if (action.endsWith('-page')) {
        const nextScreen = action.slice(0, -5);
        setScreen(nextScreen);
        if (nextScreen === 'delete') {
          setDeleteOpen(true);
        }
        return;
      }
      if (action === 'back') {
        if (screen && screen !== 'home') {
          setScreen('home');
        } else {
          closeDialog();
        }
        return;
      }
      if (action === 'close') {
        closeDialog();
        return;
      }
      if (action === 'reauth-cancel') {
        setPending(null);
        clearSecrets();
        setStatuses((prev) => ({ ...prev, reauth: '' }));
        setReauthOpen(false);
        return;
      }
      if (action === 'reset' || action === 'export' || action === 'recover') {
        openReauth(action);
        return;
      }
      if (action === 'download') {
        if (!downloadUrl) return;
        const epoch = epochRef.current;
        setBusy(true);
        try {
          const blob = await client.go.downloadDataExport(downloadUrl);
          if (epoch !== epochRef.current) return;
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = 'virtual-companion-data.json';
          link.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          setDownloadUrl(null);
          setDownloadVisible(false);
          setStatuses((prev) => ({
            ...prev,
            export: '副本已下载；请妥善保存。',
          }));
        } catch (err) {
          if (epoch === epochRef.current) {
            setStatuses((prev) => ({ ...prev, export: errorCopyFor(err) }));
          }
        } finally {
          if (epoch === epochRef.current) {
            setBusy(false);
          }
        }
        return;
      }
      if (action === 'revoke-others') {
        const ids = otherSessions(rawSessions).map((item: { id: string }) => item.id);
        if (!ids.length) return;
        const epoch = epochRef.current;
        setBusy(true);
        try {
          for (const id of ids) {
            await client.go.revokeSession(id);
          }
          if (epoch !== epochRef.current) return;
          await sessionsQuery.refetch();
          setStatuses((prev) => ({ ...prev, session: '其他会话已登出' }));
        } catch (err) {
          if (epoch === epochRef.current) {
            setStatuses((prev) => ({ ...prev, session: errorCopyFor(err) }));
          }
        } finally {
          if (epoch === epochRef.current) {
            setBusy(false);
          }
        }
        return;
      }
      if (action === 'revoke-device') {
        const id = target.getAttribute('data-revoke-device') || '';
        if (!/^[1-9][0-9]*$/.test(id)) return;
        setConfirmPrompt({
          title: '撤销此设备',
          description: '此设备下次登录需要验证码。',
          confirmLabel: '撤销',
          danger: true,
          onConfirm: async () => {
            const epoch = epochRef.current;
            setBusy(true);
            try {
              await client.go.revokeTrustedDevice(id);
              if (epoch !== epochRef.current) return;
              await devicesQuery.refetch();
            } catch (err) {
              if (epoch === epochRef.current) {
                setStatuses((prev) => ({ ...prev, device: errorCopyFor(err) }));
              }
            } finally {
              if (epoch === epochRef.current) {
                setBusy(false);
              }
            }
          },
        });
        return;
      }
      if (action === 'consent-revoke') {
        const consentType = target.getAttribute('data-consent-revoke') || '';
        if (!REQUIRED_CONSENTS.some((item) => item.type === consentType)) return;
        setConfirmPrompt({
          title: '撤回这项同意',
          description: '撤回后，下次进入需要重新同意。',
          confirmLabel: '撤回',
          danger: true,
          onConfirm: () => {
            openReauth('consent-revoke', { consentType });
          },
        });
        return;
      }
      if (action === 'logout') {
        setBusy(true);
        try {
          await client.go.logoutCurrent();
        } catch (err) {
          setStatuses((prev) => ({ ...prev, session: errorCopyFor(err) }));
        } finally {
          setBusy(false);
        }
      }
    },
    [
      busy,
      screen,
      closeDialog,
      clearSecrets,
      openReauth,
      downloadUrl,
      client.go,
      rawSessions,
      sessionsQuery,
      devicesQuery,
    ],
  );

  const contents = (
    <div className="vc-data-dialog" data-vc-screen={screen}>
      <AccountContents
        vc={true}
        sprite={iconSpriteUrl()}
        screen={screen}
        title={accountTitle(screen)}
        busy={busy}
        deleted={deleted}
        authText={authText}
        authSummary={authSummary}
        voiceStorage={voiceStorage}
        sessionsLoading={sessionsQuery.isLoading}
        sessions={sessionLines}
        sessionCount={sessionsQuery.isLoading ? '' : `${rawSessions.length} 个`}
        hasOtherSessions={hasOtherSessions}
        devices={devices}
        consents={consents}
        statuses={statuses}
        downloadVisible={downloadVisible}
        deleteFormHidden={deleteFormHidden}
        deleteOpen={deleteOpen}
        deleteChecked={deleteChecked}
        reauthOpen={reauthOpen}
        passwordReset={passwordReset}
        reauthReset={reauthReset}
        deleteReset={deleteReset}
        copies={{
          backup: BACKUP_COPY,
          restore: RESTORE_LIMIT_COPY,
          sessionEmpty: SESSION_EMPTY_COPY,
        }}
        onAction={(action, target) => void handleAction(action, target)}
        onSubmit={(action, form) => void handleSubmit(action, form)}
        onDeleteToggle={setDeleteOpen}
        onDeleteCheck={setDeleteChecked}
      />
      {confirmPrompt ? (
        <AlertDialog
          open={true}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) setConfirmPrompt(null);
          }}
          title={confirmPrompt.title}
          description={confirmPrompt.description}
          confirmLabel={confirmPrompt.confirmLabel}
          cancelLabel="取消"
          danger={confirmPrompt.danger}
          onConfirm={() => {
            const fn = confirmPrompt.onConfirm;
            setConfirmPrompt(null);
            fn();
          }}
        />
      ) : null}
    </div>
  );

  if (inline) {
    return contents;
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) closeDialog();
      }}
      title={accountTitle(screen)}
      width={720}
    >
      {contents}
    </Dialog>
  );
}

export { DesktopAccountDialog as AccountDialog };
