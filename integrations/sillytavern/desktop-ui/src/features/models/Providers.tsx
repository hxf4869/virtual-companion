import { Button } from '@base-ui/react/button';
import { Icon } from '../../components/Icon';

export interface ProvidersProps {
    vc: boolean;
    heading: boolean;
    sprite: string;
    creatingNew: boolean;
    rows: readonly {
        id: string; name: string; selected: boolean; enabled: boolean; disabled: boolean; credentialConfigured: boolean;
        stateLabel: string; tone: string; status: string; protocol: string; modelCount: number;
    }[];
    onAction: (action: string, target: HTMLElement) => void;
}

export function Providers({ vc, heading, sprite, creatingNew, rows, onAction }: ProvidersProps) {
    return <>
        {heading && <h2 className="vcms-providers-title">供应商</h2>}
        {rows.length === 0 && !creatingNew ? <div className={`vcms-empty-providers${vc ? ' vc-empty' : ''}`}>
            <p>还没有供应商。</p>
            <p className="vcms-muted">新建供应商，选择一种接口协议并填写 Base URL 与密钥，再添加模型配置。</p>
            <Button className="vcms-btn vcms-btn-primary vcms-btn-sm" data-action="new-provider" onClick={event => onAction('new-provider', event.currentTarget)}><i className="fa-solid fa-plus" /> 新建供应商</Button>
        </div> : <>
            {rows.map(row => <Button key={row.id} className={`vcms-provider-card${vc ? ' vc-cell' : ''} ${row.selected ? 'is-selected' : ''} ${row.disabled ? 'is-disabled' : ''}`}
                data-action="select-provider" data-id={row.id} onClick={event => onAction('select-provider', event.currentTarget)}>
                <span className="vcms-provider-name">{row.name}</span>
                {vc && <><span className={`vc-status vc-status-${row.tone}`}><i className={`vc-dot vc-dot-${row.tone}`} />{row.status}</span><span className="vc-chevron"><Icon sprite={sprite} name="chevron-right" size={16} /></span></>}
                <span className="vcms-provider-meta">
                    <span className={`vcms-badge ${row.enabled ? 'vcms-badge-ok' : 'vcms-badge-muted'}`}>{row.stateLabel}</span>
                    <span className={`vcms-badge ${row.credentialConfigured ? 'vcms-badge-ok' : 'vcms-badge-warn'}`}>{row.credentialConfigured ? '密钥已配置' : '缺密钥'}</span>
                </span>
                <span className="vcms-provider-sub">{row.protocol} · {row.modelCount} 个模型</span>
            </Button>)}
            {creatingNew && <Button className="vcms-provider-card is-selected is-new" data-action="select-provider" data-id="" onClick={event => onAction('select-provider', event.currentTarget)}>
                <span className="vcms-provider-name">新建供应商（未保存）</span>
                <span className="vcms-provider-sub">草稿</span>
            </Button>}
            {vc && !creatingNew && <Button className="vcms-provider-card vc-cell" data-action="new-provider" onClick={event => onAction('new-provider', event.currentTarget)}><span className="vcms-provider-name">新建供应商</span></Button>}
        </>}
    </>;
}
