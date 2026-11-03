import { Button } from '@base-ui/react/button';
import { Icon } from '../../components/Icon';
import { Switch } from '../../components/Switch';

export type SettingsOverviewProps = { sprite: string } & (
    { kind: 'account'; name: string; avatar?: string; onOpen: (screen: string, target: HTMLElement) => void }
    | { kind: 'data'; onOpen: (target: HTMLElement) => void }
    | { kind: 'notifications'; supported: boolean; enabled: boolean; pending: boolean; onToggle: (enabled: boolean) => void; onInbox: () => void }
);

export function SettingsOverview(p: SettingsOverviewProps) {
    const chevron = <Icon sprite={p.sprite} name="chevron-right" size={16} />;
    if (p.kind === 'account') return <div className="vc-desk-group vc-settings-profile">
        <div className="vc-cell vc-settings-profile-head"><span data-who-avatar="">{p.avatar ? <img alt="" src={p.avatar} /> : [...p.name][0] || ''}</span><strong>{p.name}</strong></div>
        {([['password', '密码'], ['auth', '身份验证器']] as const).map(([screen, label]) => <Button key={screen} type="button" className="vc-cell" data-account-go={screen} onClick={event => p.onOpen(screen, event.currentTarget)}><span className="vc-grow">{label}</span>{chevron}</Button>)}
    </div>;
    if (p.kind === 'data') return <div className="vc-desk-group"><Button type="button" className="vc-cell vc-settings-open-account" onClick={event => p.onOpen(event.currentTarget)}><span className="vc-grow">账户与数据</span>{chevron}</Button></div>;
    return <>
        <div className="vc-desk-group"><Button type="button" className="vc-cell" data-open-inbox="" onClick={p.onInbox}><span className="vc-grow">陪伴</span>{chevron}</Button></div>
        {p.supported && <section className="vc-desk-group"><div className="vc-desk-field"><span>桌面通知</span><Switch label="桌面通知" checked={p.enabled} disabled={p.pending} onCheckedChange={p.onToggle} /></div></section>}
    </>;
}
