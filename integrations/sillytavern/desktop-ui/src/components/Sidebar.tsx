// shadcn SidebarMenuButton / SidebarMenuBadge 的槽位组合，按现有皮肤与受控导航精简。
// https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/new-york-v4/ui/sidebar.tsx
// Copyright (c) 2023 shadcn, MIT；许可见 desktop-ui/THIRD_PARTY_LICENSES.txt。
import { Button } from '@base-ui/react/button';
import { Avatar } from './Avatar';
import { Icon } from './Icon';

export interface SidebarProps {
    items: readonly { nav: string; label: string; icon: string }[];
    sprite: string;
    active: string;
    collapsed: boolean;
    unreadCount: number;
    chatUnread: boolean;
    avatar: { src?: string; fallback: string };
}

function SidebarItem({ sprite, icon, label, active, destination, settings = false, unreadCount = 0, chatUnread = false }: {
    sprite: string; icon: string; label: string; active: boolean; destination?: string; settings?: boolean; unreadCount?: number; chatUnread?: boolean;
}) {
    return <div className="vc-side-item">
        <Button type="button" className="vc-side-link" data-nav={destination} data-settings={settings ? '' : undefined}
            aria-label={label} aria-current={active ? 'page' : undefined}>
            <Icon sprite={sprite} name={icon} size={24} />
            <span className="vc-side-label">{label}</span>
        </Button>
        {destination === 'inbox' && <span className="vc-side-badge" data-badge="inbox" hidden={unreadCount === 0}>
            {unreadCount > 0 && <span className="vc-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>}
        </span>}
        {destination === 'chat' && <i className="vc-side-dot" data-dot="chat" aria-hidden="true" hidden={!chatUnread} />}
    </div>;
}

export function Sidebar({ items, sprite, active, collapsed, unreadCount, chatUnread, avatar }: SidebarProps) {
    return <>
        <Button type="button" className="vc-side-link vc-side-collapse" data-collapse=""
            aria-label={collapsed ? '展开侧边栏' : '收起侧边栏'}>
            <Icon sprite={sprite} name={collapsed ? 'chevron-right' : 'chevron-left'} />
        </Button>
        {items.map(item => <SidebarItem key={item.nav} sprite={sprite} icon={item.icon} label={item.label}
            destination={item.nav} active={active === item.nav} unreadCount={unreadCount} chatUnread={chatUnread} />)}
        <div className="vc-side-foot">
            <div className="vc-side-avatar-slot"><Avatar {...avatar} /></div>
            <SidebarItem sprite={sprite} icon="settings" label="设置" settings active={active === 'settings'} />
        </div>
    </>;
}
