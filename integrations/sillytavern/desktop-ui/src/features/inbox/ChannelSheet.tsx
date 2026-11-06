import { Button } from '../../design/components/Button';
import { Checkbox } from '../../design/components/Checkbox';
import { Dialog } from '../../design/components/Dialog';
import { Field } from '../../design/components/Field';
import { Switch } from '../../design/components/Switch';
import { TextInput } from '../../design/components/TextInput';
import { toast } from '../../design/components/Toast';
import { credentialPlaceholder } from '../../../../extension/vc-model-settings/inbox-logic.js';
import { ReauthDialog } from './ReauthDialog';
import {
  CHANNEL_TITLES,
  useChannelSheet,
  type ChannelDraft,
  type UseChannelSheetOptions,
} from './useInbox';

export {
  CHANNEL_TITLES,
  useChannelSheet,
  type ChannelDraft,
  type UseChannelSheetOptions,
};

export interface ChannelSheetProps {
  relId: string | null;
}

export function ChannelSheet({ relId }: ChannelSheetProps) {
  const {
    saveChannelMutation,
    drafts,
    relationshipOptions,
    activeDraft,
    errorMessage,
    reauthOpen,
    setReauthOpen,
    openDraft,
    updateActiveDraft,
    setClearCredential,
    toggleRelationship,
    handleCloseSheet,
    executeSaveChannel,
  } = useChannelSheet({
    relId,
    onSaved: () => {
      toast.show({ title: '已保存通知渠道', kind: 'success' });
    },
  });

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
                onClick={() => openDraft(draft)}
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
            <Field label="关联关系">
              <div role="group" aria-label="关联关系">
                {[...relationshipOptions].map(([id, label]) => (
                  <Checkbox
                    key={id}
                    label={label}
                    checked={activeDraft.relationshipIds.includes(id)}
                    onCheckedChange={(checked) => toggleRelationship(id, checked)}
                  />
                ))}
              </div>
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
            <Field label="清除凭据">
              <Switch
                aria-label="清除凭据"
                checked={activeDraft.credentialMode === 'clear'}
                onCheckedChange={setClearCredential}
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
