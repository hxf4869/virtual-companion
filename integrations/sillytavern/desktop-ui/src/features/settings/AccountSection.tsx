import { useState } from 'react';
import { Button } from '@base-ui/react/button';
import { useAppClient } from '../../app/providers';
import { useExitDesktopAccount } from '../../data/queries/account';
import { Avatar } from '../../design/components/Avatar';
import { Icon } from '../../design/components/Icon';
import { toast } from '../../design/components/Toast';
import { useSessionBridge } from '../../runtime/session-bridge';
import { DesktopAccountDialog } from './DesktopAccountDialog';

const ACCOUNT_ITEMS = [
  ['account', '账户', '显示名称与登录状态', 'home'],
  ['password', '登录密码', '修改当前账户密码', 'password'],
  ['totp', '身份验证器', '重新绑定两步验证', 'auth'],
] as const;

export function AccountSection() {
  const client = useAppClient();
  const exit = useExitDesktopAccount();
  const bridge = useSessionBridge();
  const context = bridge.getContext() || {};
  const name = String(context.name1 || '').trim() || '账户';
  const personaFile = String(context.userAvatar || '').trim();
  const avatarUrl = personaFile
    ? `/thumbnail?type=persona&file=${encodeURIComponent(personaFile)}`
    : undefined;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogScreen, setDialogScreen] = useState<string>('home');
  const [signingOut, setSigningOut] = useState(false);

  const logout = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await client.go.logoutCurrent();
      exit();
    } catch {
      toast.show({ title: '没有完成，请重试。', kind: 'error' });
    } finally {
      setSigningOut(false);
    }
  };

  const openScreen = (screen: string) => {
    setDialogScreen(screen);
    setDialogOpen(true);
  };

  return (
    <div className="vc-settings-overview">
      <div className="vc-group">
        {ACCOUNT_ITEMS.map(([key, label, sub, targetScreen], i) => (
          <Button
            key={key}
            type="button"
            className="vc-cell"
            data-open-account={key}
            onClick={() => openScreen(targetScreen)}
          >
            {i === 0 ? (
              <Avatar src={avatarUrl} name={name} size={44} className="vc-account-avatar" />
            ) : null}
            <span className="vc-grow">
              <span className="vc-cell-title">{label}</span>
              <span className="vc-cell-sub">{i === 0 ? name : sub}</span>
            </span>
            <span className="vc-chevron">
              <Icon name="chevron-right" size={16} />
            </span>
          </Button>
        ))}
      </div>
      <div className="vc-group">
        <Button
          type="button"
          className="vc-cell is-danger"
          data-action="logout"
          disabled={signingOut}
          onClick={() => void logout()}
        >
          <span className="vc-grow">退出当前会话</span>
        </Button>
      </div>
      <DesktopAccountDialog
        open={dialogOpen}
        initialScreen={dialogScreen}
        onOpenChange={setDialogOpen}
      />
    </div>
  );
}
