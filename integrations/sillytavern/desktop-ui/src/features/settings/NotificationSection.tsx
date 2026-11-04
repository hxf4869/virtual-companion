import { useCallback, useState } from 'react';
import { useRouter } from '@tanstack/react-router';
import {
  notifySupported,
  requestNotifyPermission,
  systemNotifyEnabled,
  writeSystemNotifyEnabled,
} from '../../../../extension/vc-model-settings/inbox-logic.js';
import { Icon } from '../../design/components/Icon';
import { Switch } from '../../design/components/Switch';

export interface NotificationSectionProps {
  onOpenInbox?: () => void;
}

export function NotificationSection({ onOpenInbox }: NotificationSectionProps = {}) {
  const router = useRouter({ warn: false });
  const supported = notifySupported();
  const [enabled, setEnabled] = useState<boolean>(() => systemNotifyEnabled());
  const [pending, setPending] = useState(false);

  const handleToggle = useCallback(
    async (nextEnabled: boolean) => {
      if (pending) return;
      if (!nextEnabled) {
        writeSystemNotifyEnabled(false);
        setEnabled(false);
        return;
      }
      setPending(true);
      try {
        const perm = await requestNotifyPermission();
        if (perm === 'granted') {
          writeSystemNotifyEnabled(true);
          setEnabled(true);
        } else {
          writeSystemNotifyEnabled(false);
          setEnabled(false);
        }
      } finally {
        setPending(false);
      }
    },
    [pending],
  );

  const handleOpenInbox = useCallback(() => {
    if (onOpenInbox) {
      onOpenInbox();
      return;
    }
    if (router) {
      void router.navigate({ to: '/inbox' });
    }
  }, [onOpenInbox, router]);

  return (
    <section className="vc-settings-section" data-vc-notification-section="">
      <div className="vc-desk-group">
        <button
          type="button"
          className="vc-cell"
          data-open-inbox=""
          onClick={handleOpenInbox}
        >
          <span className="vc-grow">陪伴</span>
          <Icon name="chevron-right" size={16} />
        </button>
      </div>
      {supported && (
        <section className="vc-desk-group">
          <div className="vc-desk-field">
            <span>桌面通知</span>
            <Switch
              aria-label="桌面通知"
              checked={enabled}
              disabled={pending}
              onCheckedChange={(val) => {
                void handleToggle(val);
              }}
            />
          </div>
        </section>
      )}
    </section>
  );
}
export default NotificationSection;
