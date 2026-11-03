import type { FormEvent } from 'react';
import { Button } from '@base-ui/react/button';
import { Icon } from '../../components/Icon';

export interface AccountContentsProps {
    vc: boolean; sprite: string; screen: string; title: string; busy: boolean; deleted: boolean;
    authText: string; authSummary: string; voiceStorage: string;
    sessionsLoading: boolean; sessions: readonly string[]; sessionCount: string; hasOtherSessions: boolean;
    devices: readonly { id: string; name: string; meta: string }[];
    consents: readonly { type: string; icon: string; label: string; meta: string }[];
    statuses: Record<string, string>;
    downloadVisible: boolean; deleteFormHidden: boolean; deleteOpen: boolean; deleteChecked: boolean; reauthOpen: boolean;
    passwordReset: number; reauthReset: number; deleteReset: number;
    copies: { backup: string; restore: string; sessionEmpty: string };
    onAction: (action: string, target: HTMLElement) => void;
    onSubmit: (action: string, form: HTMLFormElement, trigger: HTMLElement | null) => void;
    onDeleteToggle: (open: boolean) => void;
    onDeleteCheck: (checked: boolean) => void;
}

export function AccountContents(p: AccountContentsProps) {
    const blocked = p.busy || p.deleted;
    const status = (key: string) => <div className="vc-data-status" role="status" aria-live="polite" {...{ [`data-${key}-status`]: '' }}>{p.statuses[key] ?? ''}</div>;
    const submit = (action: string) => (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        p.onSubmit(action, event.currentTarget, (event.nativeEvent as SubmitEvent).submitter as HTMLElement | null);
    };
    const classes = (native: string, modern: string) => `${native}${p.vc ? ` ${modern}` : ''}`;
    const chevron = <Icon sprite={p.sprite} name="chevron-right" size={18} />;
    return <>
        {p.vc && <div className="vc-navbar" data-vc-account-nav="" style={{ '--vc-nav-p': '1' } as React.CSSProperties} inert={p.reauthOpen || undefined}>
            <Button type="button" className="vc-btn vc-btn-text" data-vc-account-back="" aria-label={p.screen === 'home' ? '返回设置' : '返回账户与数据'} disabled={p.busy} onClick={event => p.onAction('back', event.currentTarget)}><Icon sprite={p.sprite} name="chevron-left" size={22} /><span>{p.screen === 'home' ? '设置' : ''}</span></Button>
            <div className="vc-nav-title">{p.title}</div><div className="vc-nav-spacer" />
        </div>}
        <header className="vcms-header" inert={p.reauthOpen || undefined}><h1 id="vc-data-title" className="vcms-title" tabIndex={-1}>数据与账户</h1><Button type="button" className="vcms-btn vcms-btn-ghost" data-close="" disabled={p.busy} onClick={event => p.onAction('close', event.currentTarget)}>{p.deleted ? '返回登录' : '返回聊天'}</Button></header>
        <main className="vc-data-body" inert={p.reauthOpen || undefined}>
            {p.vc && <div data-vc-account-home="">
                <div className="vc-group">
                    <div className="vc-cell"><span className="vc-grow">语音存储</span><span className="vc-value vc-num" data-vc-voice-usage="">{p.voiceStorage}</span></div>
                    <Button type="button" className="vc-cell" data-vc-account-go="password" disabled={p.busy} onClick={event => p.onAction('password-page', event.currentTarget)}><span className="vc-grow">修改密码</span>{chevron}</Button>
                    <Button type="button" className="vc-cell" data-vc-account-go="auth" disabled={p.busy} onClick={event => p.onAction('auth-page', event.currentTarget)}><span className="vc-grow">验证器</span><span className="vc-value" data-vc-auth-summary="">{p.authSummary}</span>{chevron}</Button>
                    <Button type="button" className="vc-cell" data-vc-account-go="sessions" disabled={p.busy} onClick={event => p.onAction('sessions-page', event.currentTarget)}><span className="vc-grow">当前会话</span><span className="vc-value" data-vc-session-count="">{p.sessionCount}</span>{chevron}</Button>
                    <Button type="button" className="vc-cell" data-vc-account-go="devices" hidden={p.devices.length === 0} disabled={p.busy} onClick={event => p.onAction('devices-page', event.currentTarget)}><span className="vc-grow">已信任的设备</span>{chevron}</Button>
                    <Button type="button" className="vc-cell" data-vc-account-go="consent" disabled={p.busy} onClick={event => p.onAction('consent-page', event.currentTarget)}><span className="vc-grow">隐私与同意</span>{chevron}</Button>
                    <Button type="button" className="vc-cell" data-vc-account-go="export" disabled={p.busy} onClick={event => p.onAction('export-page', event.currentTarget)}><span className="vc-grow">导出数据</span>{chevron}</Button>
                </div>
                <div className="vc-group"><Button type="button" className="vc-cell is-danger" data-vc-account-go="delete" disabled={p.busy} onClick={event => p.onAction('delete-page', event.currentTarget)}><span className="vc-grow">删除账号及在线数据</span>{chevron}</Button></div>
            </div>}
            <div className="vc-account-cards">
                <div className="vc-account-security">
                    <section className="vc-account-card" aria-label="修改密码">
                        <h2>修改密码</h2>
                        <form data-password="" onSubmit={submit('password')}>
                            <label>新密码<input key={p.passwordReset} type="password" name="newPassword" autoComplete="new-password" required maxLength={1024} disabled={blocked} /></label>
                            <Button type="submit" className={classes('vcms-btn vcms-btn-primary', 'vc-btn vc-btn-fill')} disabled={blocked}>修改密码</Button>
                        </form>{status('password')}
                    </section>
                    <section className="vc-account-card" aria-label="验证器">
                        <h2>验证器</h2><p data-auth="">{p.authText}</p>
                        <Button type="button" className={classes('vcms-btn', 'vc-btn vc-btn-text')} data-reset="" disabled={blocked} onClick={event => p.onAction('reset', event.currentTarget)}>重置验证器</Button>{status('auth')}
                    </section>
                </div>
                <section className="vc-account-card" aria-label="当前会话">
                    <h2>当前会话</h2><div data-sessions="">
                        {p.vc && p.sessionsLoading ? <div className="vc-skeleton-row" aria-busy="true" /> : !p.sessionsLoading && p.sessions.length === 0 ? <p className={`vc-account-empty${p.vc ? ' vc-empty' : ''}`}>{p.copies.sessionEmpty}</p> : p.sessions.map((row, index) => <p key={index} className="vc-account-session">{row}</p>)}
                    </div>
                    <div className="vc-data-actions"><Button type="button" className={classes('vcms-btn', 'vc-btn vc-btn-text')} data-revoke-others="" disabled={blocked || !p.hasOtherSessions} onClick={event => p.onAction('revoke-others', event.currentTarget)}>登出其他会话</Button><Button type="button" className={classes('vcms-btn', 'vc-btn vc-btn-text')} data-logout="" disabled={blocked} onClick={event => p.onAction('logout', event.currentTarget)}>登出</Button></div>{status('session')}
                </section>
                <section className="vc-account-card" aria-label="已信任的设备" data-trusted-devices="" hidden={p.devices.length === 0}>
                    <h2>已信任的设备</h2><div data-trusted-list="">{p.devices.map(device => <div className="vc-account-device" key={device.id}>
                        <div><div className="vc-account-device-name">{device.name}</div><div className="vc-account-device-meta">{device.meta}</div></div>
                        <Button type="button" className={classes('vcms-btn', 'vc-btn vc-btn-text')} data-revoke-device={device.id} disabled={blocked} onClick={event => p.onAction('revoke-device', event.currentTarget)}>撤销</Button>
                    </div>)}</div>{status('device')}
                </section>
                <section className="vc-account-card" aria-label="隐私与同意">
                    <h2>隐私与同意</h2><div data-consent-account-list=""><div className="vc-consent-account">{p.consents.map(row => <div className="vc-consent-account-row" data-consent-type={row.type} key={row.type}>
                        <Icon sprite={p.sprite} name={row.icon} size={22} /><span className="vc-grow"><span className="vc-consent-name">{row.label}</span><span className="vc-consent-meta">{row.meta}</span></span>
                        <Button type="button" className="vc-btn vc-btn-text is-danger" data-consent-revoke={row.type} disabled={blocked} onClick={event => p.onAction('consent-revoke', event.currentTarget)}>撤回</Button>
                    </div>)}</div></div>{status('consent-account')}
                </section>
                <section className="vc-account-card" aria-label="导出数据">
                    <h2>导出数据</h2><p>包含当前聊天、角色、世界书、记忆和来源；密钥与历史备份不进入副本。</p>
                    <div className="vc-data-actions"><Button type="button" className={classes('vcms-btn vcms-btn-primary', 'vc-btn vc-btn-fill')} data-export="" disabled={blocked} onClick={event => p.onAction('export', event.currentTarget)}>生成副本</Button><Button type="button" className={classes('vcms-btn vcms-btn-ghost', 'vc-btn vc-btn-text')} data-recover="" disabled={blocked} onClick={event => p.onAction('recover', event.currentTarget)}>取回最近副本</Button></div>{status('export')}
                    <Button type="button" className={classes('vcms-btn vcms-btn-primary', 'vc-btn vc-btn-fill')} data-download="" disabled={blocked} hidden={!p.downloadVisible} onClick={event => p.onAction('download', event.currentTarget)}>下载副本</Button>
                </section>
                <section className="vc-account-card vc-data-delete" aria-label="删除账号及在线数据">
                    <details open={p.deleteOpen} onToggle={event => p.onDeleteToggle(event.currentTarget.open)}><summary>删除账号及在线数据</summary>
                        <form data-delete="" hidden={p.deleteFormHidden} onSubmit={submit('delete')}>
                            <p>在线聊天、角色、世界书、记忆、导出文件和私有备份将一并清除。离线备份另行清理。</p>
                            <label className="vc-data-confirm"><input key={p.deleteReset} type="checkbox" checked={p.deleteChecked} onChange={event => p.onDeleteCheck(event.currentTarget.checked)} required={!p.vc} disabled={blocked} />我确认删除当前账号及其在线私有数据</label>
                            <Button type="submit" className={classes('vcms-btn vcms-btn-danger', 'vc-btn vc-btn-danger')} disabled={blocked}>删除账号及在线数据</Button>
                        </form>{status('delete')}
                    </details>
                </section>
            </div>
            <p className="vc-data-scope">{p.copies.backup}</p><p className="vc-data-scope" data-restore-limit="">{p.copies.restore}</p><p className="vc-data-scope">删除长期记忆会保留聊天原文，原文仍可能用于当前对话；删除聊天不影响其他独立分支。</p>
        </main>
        <div className="vc-account-reauth" role="dialog" aria-modal="true" aria-label="重新验证身份" hidden={!p.reauthOpen}>
            <form data-reauth="" onSubmit={submit('reauth')}>
                <p>需要重新验证身份。</p><label>当前密码<input key={p.reauthReset} type="password" autoComplete="current-password" required maxLength={1024} data-reauth-password="" disabled={blocked} /></label>{status('reauth')}
                <div className="vc-data-actions"><Button type="submit" className={classes('vcms-btn vcms-btn-primary', 'vc-btn vc-btn-fill')} disabled={blocked}>验证并继续</Button><Button type="button" className={classes('vcms-btn vcms-btn-ghost', 'vc-btn vc-btn-text')} data-reauth-cancel="" disabled={blocked} onClick={event => p.onAction('reauth-cancel', event.currentTarget)}>取消</Button></div>
            </form>
        </div>
        {/* 旧 alert 的独立宿主；此节点的子树暂由原弹层模块管理，DR-4 再迁移弹层本体。 */}
        <div data-vc-account-overlays="" />
    </>;
}
