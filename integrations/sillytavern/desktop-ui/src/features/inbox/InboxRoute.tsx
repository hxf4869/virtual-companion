import { useEffect, useState } from 'react';
import { useRelationships } from '../../data/queries/memory';
import { Select } from '../../design/components/Select';
import { Switch } from '../../design/components/Switch';
import { relationshipLabel } from '../../../../extension/vc-model-settings/memory-logic.js';
import {
  notifySupported,
  requestNotifyPermission,
  systemNotifyEnabled,
  writeSystemNotifyEnabled,
} from '../../../../extension/vc-model-settings/inbox-logic.js';
import { PolicyForm } from './PolicyForm';
import { FollowUps } from './FollowUps';
import { InboxList } from './InboxList';
import { ChannelSheet } from './ChannelSheet';
import { Deliveries } from './Deliveries';
import './inbox.css';

export interface InboxRouteProps {
  initialRelationshipId?: string | null;
}

export function InboxRoute({ initialRelationshipId = null }: InboxRouteProps) {
  const relationshipsQuery = useRelationships();
  const relationships = relationshipsQuery.data ?? [];

  const [selectedRelId, setSelectedRelId] = useState<string | null>(initialRelationshipId);
  const [desktopNotify, setDesktopNotify] = useState<boolean>(() => systemNotifyEnabled());

  useEffect(() => {
    if (relationships.length === 0) return;
    if (!selectedRelId || !relationships.some((rel) => String(rel.relationshipId) === selectedRelId)) {
      setSelectedRelId(String(relationships[0].relationshipId));
    }
  }, [relationships, selectedRelId]);

  const relOptions = relationships.map((rel) => {
    const id = String(rel.relationshipId);
    return {
      value: id,
      label: relationshipLabel(rel, relationships),
    };
  });

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
              onValueChange={(val) => setSelectedRelId(val)}
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
          <PolicyForm relId={selectedRelId} />
          <FollowUps relId={selectedRelId} />
          <InboxList />
        </div>
        <aside className="vc-inbox-route__aside">
          <ChannelSheet relId={selectedRelId} />
          <Deliveries relId={selectedRelId} />
        </aside>
      </div>
    </div>
  );
}
