import { useState } from 'react';
import { Button } from '@base-ui/react/button';
import { Icon } from '../../design/components/Icon';
import { DesktopAccountDialog } from './DesktopAccountDialog';

export interface DataSectionProps {
  onNavigateAuth?: (url: string) => void;
}

export function DataSection({ onNavigateAuth }: DataSectionProps = {}) {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <div className="vc-settings-overview">
      <div className="vc-group">
        <Button
          type="button"
          className="vc-cell"
          data-open-data=""
          onClick={() => setDialogOpen(true)}
        >
          <span className="vc-grow">
            <span className="vc-cell-title">账户、会话与数据导出</span>
            <span className="vc-cell-sub">密码、两步验证、活跃会话、数据副本与删除账户</span>
          </span>
          <span className="vc-chevron">
            <Icon name="chevron-right" size={16} />
          </span>
        </Button>
      </div>
      <DesktopAccountDialog
        open={dialogOpen}
        initialScreen="home"
        onOpenChange={setDialogOpen}
        onNavigateAuth={onNavigateAuth}
      />
    </div>
  );
}
