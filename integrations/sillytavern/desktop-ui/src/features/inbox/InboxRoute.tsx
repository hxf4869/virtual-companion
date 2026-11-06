import { useState } from 'react';
import { AlertDialog } from '../../design/components/AlertDialog';
import { Select } from '../../design/components/Select';
import { Switch } from '../../design/components/Switch';
import {
  notifySupported,
  requestNotifyPermission,
  systemNotifyEnabled,
  writeSystemNotifyEnabled,
} from '../../../../extension/vc-model-settings/inbox-logic.js';
import { PolicyForm, type LeaveGuardProp } from './PolicyForm';
import { FollowUps } from './FollowUps';
import { InboxList, type OpenInboxConversationHandler } from './InboxList';
import { ChannelSheet } from './ChannelSheet';
import { Deliveries } from './Deliveries';
import {
  useInboxRelationship,
  type InboxRelationshipOption,
  type UseInboxRelationshipOptions,
} from './useInbox';
import './inbox.css';

export {
  useInboxRelationship,
  type InboxRelationshipOption,
  type UseInboxRelationshipOptions,
};

export interface InboxRouteProps {
  initialRelationshipId?: string | null;
  onOpenConversation: OpenInboxConversationHandler;
  guard?: LeaveGuardProp;
}

export function InboxRoute({
  initialRelationshipId = null,
  onOpenConversation,
  guard,
}: InboxRouteProps) {
  const {
    relOptions,
    selectedRelId,
    setPolicyDirty,
    confirmDiscardOpen,
    selectRelationship,
    confirmSwitchRelationship,
    cancelSwitchRelationship,
  } = useInboxRelationship({ initialRelationshipId });

  const [desktopNotify, setDesktopNotify] = useState<boolean>(() => systemNotifyEnabled());

  const handleToggleNotify = async (next: boolean) => {
    if (next && notifySupported()) {
      const perm = await requestNotifyPermission();
      if (perm === 'denied') {
        setDesktopNotify(writeSystemNotifyEnabled(false));
        return;
      }
    }
    setDesktopNotify(writeSystemNotifyEnabled(next));
  };

  return (
    <div className="vc-inbox-route" data-vc-page="inbox">
      <header className="vc-inbox-route__header">
        <div className="vc-inbox-route__title-group">
          <h1 className="vc-inbox-route__title">主动陪伴</h1>
          {relOptions.length > 0 ? (
            <Select
              aria-label="选择角色关系"
              value={selectedRelId ?? ''}
              options={relOptions}
              onValueChange={selectRelationship}
            />
          ) : null}
        </div>
        <div className="vc-inbox-route__notify-toggle">
          <span>桌面系统通知</span>
          <Switch
            aria-label="桌面系统通知"
            checked={desktopNotify}
            onCheckedChange={(checked) => void handleToggleNotify(checked)}
          />
        </div>
      </header>

      <div className="vc-inbox-route__grid">
        <div className="vc-inbox-route__main">
          <PolicyForm
            key={selectedRelId ?? 'none'}
            relId={selectedRelId}
            onDirtyChange={setPolicyDirty}
            guard={guard}
          />
          <FollowUps relId={selectedRelId} />
          <InboxList onOpenConversation={onOpenConversation} />
        </div>
        <aside className="vc-inbox-route__aside">
          <ChannelSheet relId={selectedRelId} />
          <Deliveries relId={selectedRelId} />
        </aside>
      </div>

      <AlertDialog
        open={confirmDiscardOpen}
        onOpenChange={(open) => {
          if (!open) {
            cancelSwitchRelationship();
          }
        }}
        title="放弃更改？"
        description="切换后本次输入将丢失。"
        confirmLabel="放弃"
        cancelLabel="继续编辑"
        danger
        onConfirm={confirmSwitchRelationship}
      />
    </div>
  );
}
