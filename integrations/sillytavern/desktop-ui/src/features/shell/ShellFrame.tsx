import type { CSSProperties } from 'react';
import { Button } from '@base-ui/react/button';
import { Icon } from '../../components/Icon';
interface Destination { nav: string; label: string; icon: string }
export interface ShellFrameProps { items: readonly Destination[]; sprite: string; active: string; entering: string; listLabel: string; searchOpen: boolean; labels: Record<string, string>; characterImport?: () => void }
export function ShellFrame(p: ShellFrameProps) {
    const settings = <Button className="vc-circle vc-glass" aria-label="设置" data-settings=""><Icon sprite={p.sprite} name="user-round" size={22} /></Button>;
    return <>
        <div className="vc-shell-pages">{p.items.map(item => <section key={item.nav} className={`vc-shell-page${p.active === item.nav ? ' is-on' : ''}${p.entering === item.nav ? ' is-enter' : ''}`} data-page={item.nav}>
            <header className="vc-navbar"><span className="vc-nav-spacer" /><span className="vc-nav-title">{p.labels[item.nav] || item.label}</span>{item.nav === 'characters' && p.characterImport && <Button type="button" className="vc-circle vc-glass" data-action="import" data-vc-character-import="" aria-label="导入角色卡" onClick={p.characterImport}><Icon sprite={p.sprite} name="plus" /></Button>}{settings}</header>
            <div className="vc-shell-scroll" />
        </section>)}</div>
        <section className="vc-shell-chat" aria-label="对话" data-search={p.searchOpen ? 'open' : undefined}><header className="vc-navbar">
            <Button className="vc-circle vc-glass vc-chat-back" aria-label="返回" data-back=""><Icon sprite={p.sprite} name="chevron-left" size={22} /></Button>
            <Button className="vc-circle vc-glass vc-list-toggle" aria-label={p.listLabel} data-list-toggle=""><Icon sprite={p.sprite} name="message-circle" size={22} /></Button>
            <div className="vc-who-slot" /><span className="vc-nav-spacer" /><div className="vc-capsule vc-glass"><span className="vc-chat-search-tools" style={{ display: 'contents' }} /><span className="vc-capsule-tools" style={{ display: 'contents' }} /><Button aria-label="记忆" data-memory=""><Icon sprite={p.sprite} name="brain" size={22} /></Button><Button aria-label="更多" data-more=""><Icon sprite={p.sprite} name="ellipsis" size={22} /></Button></div>
        <div className="vc-chat-toolbar-views" style={{ display: 'contents' }} /></header><div className="vc-shell-chat-body" /></section>
        <section className="vc-shell-settings" aria-label="设置"><header className="vc-navbar"><Button className="vc-btn vc-btn-text" data-settings-done="">完成</Button><span className="vc-nav-title">设置</span><span className="vc-nav-spacer" /></header><div className="vc-shell-scroll" /></section>
        <div className="vc-shell-extensions" style={{ display: 'contents' }} />
    </>;
}
export function Tabbar(p: { items: readonly Destination[]; sprite: string; active: string; unreadCount: number }) {
    return <><i className="vc-tab-lens" />{p.items.map(item => <Button key={item.nav} className="vc-tab" data-nav={item.nav} aria-current={p.active === item.nav ? 'page' : undefined}><Icon sprite={p.sprite} name={item.icon} size={24} /><span>{item.label}</span>{item.nav === 'inbox' && <span data-badge="inbox">{p.unreadCount > 0 && <span className="vc-badge">{p.unreadCount > 99 ? '99+' : p.unreadCount}</span>}</span>}</Button>)}</>;
}
export interface ChatIdentityProps { sprite: string; name: string; instance: string; avatar?: string; subtitle: string; tint?: string; interactive: boolean; expanded: boolean }
export function ChatIdentity(p: ChatIdentityProps) {
    return <div className="vc-who vc-glass" aria-label={p.name || '对话'} style={p.tint ? { background: p.tint } as CSSProperties : undefined}>
        <span data-who-avatar="" role={p.interactive ? 'button' : undefined} tabIndex={p.interactive ? 0 : undefined} aria-haspopup={p.interactive ? 'dialog' : undefined} aria-expanded={p.interactive ? p.expanded : undefined}>{p.avatar ? <img className="vc-convo-avatar" alt="" src={p.avatar} data-fly-target="" /> : <span className="vc-convo-avatar" data-fly-target="">{[...p.name][0] || ''}</span>}</span>
        <span className="vc-who-copy"><b data-who-name="">{p.name}</b><small data-who-sub="" hidden={!p.subtitle}>{p.subtitle}</small><small data-who-inst="" hidden={!p.instance}>{p.instance}</small></span>
    </div>;
}
