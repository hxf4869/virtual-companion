import { useEffect, useState } from 'react';
import { useChannels, useSaveChannel, type Channel } from '../../data/queries/inbox';
import { Button } from '../../design/components/Button';
import { Dialog } from '../../design/components/Dialog';
import { Field } from '../../design/components/Field';
import { Switch } from '../../design/components/Switch';
import { TextInput } from '../../design/components/TextInput';
import { toast } from '../../design/components/Toast';
import {
  credentialPlaceholder,
  draftsFromChannels,
} from '../../../../extension/vc-model-settings/inbox-logic.js';
import { ReauthDialog } from './ReauthDialog';

interface ChannelDraft {
  key: string;
  channelId: string;
  channel: 'EMAIL' | 'FEISHU' | string;
  exists: boolean;
  enabled: boolean;
  configuredTarget: string;
  previewBody: boolean;
  relationshipIds: string[];
  credential: string;
  credentialMode: 'keep' | 'set' | 'clear';
  credentialState: 'configured' | 'withheld' | 'missing';
}

const CHANNEL_TITLES: Record<string, string> = {
  EMAIL: '邮箱通知',
  FEISHU: '飞书通知',
};

export interface ChannelSheetProps {
  relId: string | null;
}

export function ChannelSheet({ relId }: ChannelSheetProps) {
  const channelsQuery = useChannels();
  const saveChannelMutation = useSaveChannel();

  const [drafts, setDrafts] = useState<ChannelDraft[]>([]);
  const [editingKind, setEditingKind] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reauthOpen, setReauthOpen] = useState(false);

  useEffect(() => {
    const rows = (channelsQuery.data ?? []) as Channel[];
    setDrafts(draftsFromChannels(rows, relId || '') as ChannelDraft[]);
  }, [channelsQuery.data, relId]);

  const activeDraft = drafts.find((d) => d.channel === editingKind) ?? null;

  const updateActiveDraft = (patch: Partial<ChannelDraft>) => {
    if (!editingKind) return;
    setDrafts((prev) =>
      prev.map((item) => {
        if (item.channel !== editingKind) return item;
        const next = { ...item, ...patch };
        if (Object.prototype.hasOwnProperty.call(patch, 'credential')) {
          if (patch.credential) {
            next.credential = patch.credential;
            next.credentialMode = 'set';
          } else if (item.credentialMode !== 'clear') {
            next.credential = '';
            next.credentialMode = 'keep';
          }
        }
        return next;
      }),
    );
  };

  const handleCloseSheet = (open: boolean) => {
    if (!open) {
      // Clear any unsaved secret input on close
      setDrafts((prev) =>
        prev.map((d) => ({
          ...d,
          credential: '',
          credentialMode: 'keep',
        })),
      );
      setEditingKind(null);
      setErrorMessage(null);
    }
  };

  const executeSaveChannel = async () => {
    if (!activeDraft) return;
    const target = activeDraft.configuredTarget.trim();
    if (target.toLowerCase().includes('://')) {
      setErrorMessage('地址不能是链接。');
      return;
    }
    if (!target || target.length > 320) {
      setErrorMessage('请填写收件地址或群名称。');
      return;
    }

    setErrorMessage(null);
    try {
      await saveChannelMutation.mutateAsync({
        channel: activeDraft.channel,
        enabled: activeDraft.enabled,
        configuredTarget: target,
        previewBody: activeDraft.previewBody,
        relationshipIds: activeDraft.relationshipIds,
        ...(activeDraft.credentialMode === 'set' ? { credential: activeDraft.credential } : {}),
        ...(activeDraft.credentialMode === 'clear' ? { credential: null } : {}),
      });
      toast.show({ title: '已保存通知渠道', kind: 'success' });
      handleCloseSheet(false);
    } catch (err) {
      const status = (err as { status?: number })?.status;
      const kind = (err as { kind?: string })?.kind;
      if (status === 401 || status === 403 || kind === 'forbidden') {
        setReauthOpen(true);
        return;
      }
      setErrorMessage(err instanceof Error ? err.message : '没有保存，请重试。');
    }
  };

  return (
    <section className="vc-inbox-card vc-channel-sheet" aria-label="外部通知渠道">
      <div className="vc-inbox-card__header">
        <h3 className="vc-inbox-card__title">通知渠道</h3>
      </div>

      <div className="vc-channel-sheet__list">
        {drafts.map((draft) => {
          const title = CHANNEL_TITLES[draft.channel] || draft.channel;
          const statusLabel = !draft.exists ? '未配置' : draft.enabled ? '已启用' : '已关闭';
          return (
            <div key={draft.key} className="vc-channel-sheet__row">
              <div className="vc-channel-sheet__info">
                <strong>{title}</strong>
                <span className="vc-inbox-badge">{statusLabel}</span>
                {draft.configuredTarget ? (
                  <span className="vc-channel-sheet__target">{draft.configuredTarget}</span>
                ) : null}
              </div>
              <Button
                variant="gray"
                size="sm"
                onClick={() => {
                  setErrorMessage(null);
                  setEditingKind(draft.channel);
                }}
              >
                配置
              </Button>
            </div>
          );
        })}
      </div>

      <Dialog
        open={Boolean(activeDraft)}
        onOpenChange={handleCloseSheet}
        title={activeDraft ? CHANNEL_TITLES[activeDraft.channel] || '配置渠道' : '配置渠道'}
        width={420}
        actions={
          <>
            <Button variant="gray" onClick={() => handleCloseSheet(false)}>
              取消
            </Button>
            <Button
              variant="filled"
              pending={saveChannelMutation.isPending}
              onClick={() => void executeSaveChannel()}
            >
              保存渠道
            </Button>
          </>
        }
      >
        {activeDraft ? (
          <div className="vc-channel-sheet__form">
            <Field label="启用该渠道">
              <Switch
                aria-label="启用该渠道"
                checked={activeDraft.enabled}
                onCheckedChange={(checked) => updateActiveDraft({ enabled: checked })}
              />
            </Field>
            <Field label="收件地址或标识">
              <TextInput
                aria-label="收件地址或标识"
                value={activeDraft.configuredTarget}
                onValueChange={(val) => updateActiveDraft({ configuredTarget: val })}
              />
            </Field>
            <Field label="通知中显示正文预览">
              <Switch
                aria-label="通知中显示正文预览"
                checked={activeDraft.previewBody}
                onCheckedChange={(checked) => updateActiveDraft({ previewBody: checked })}
              />
            </Field>
            <Field label="渠道凭据">
              <TextInput
                aria-label="渠道凭据"
                type="password"
                autoComplete="off"
                placeholder={credentialPlaceholder(activeDraft)}
                value={activeDraft.credential}
                onValueChange={(val) => updateActiveDraft({ credential: val })}
              />
            </Field>
            {errorMessage ? (
              <div className="vc-inbox-card__error" role="alert">
                {errorMessage}
              </div>
            ) : null}
          </div>
        ) : null}
      </Dialog>

      <ReauthDialog
        open={reauthOpen}
        onOpenChange={setReauthOpen}
        onSuccess={() => executeSaveChannel()}
      />
    </section>
  );
}
