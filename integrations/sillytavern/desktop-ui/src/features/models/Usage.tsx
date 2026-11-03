import { Button } from '@base-ui/react/button';
import { IconButton } from '../../components/IconButton';

export interface UsageProps {
    vc: boolean;
    sprite: string;
    month: string;
    loading: boolean;
    error?: string;
    rows: readonly { purpose: string; label: string; calls: number; unpriced: number; input: string; output: string; cached: string; rate: string; fee: string; meta: string }[];
    onAction: (action: string, target: HTMLElement) => void;
}

export function Usage({ vc, sprite, month, loading, error, rows, onAction }: UsageProps) {
    const table = rows.length === 0 ? <p className="vcms-muted">这个月还没有用量。</p> : <table className="vcms-usage-table">
        <thead><tr><th>用途</th><th>调用</th><th>未定价</th><th>输入</th><th>输出</th><th>缓存命中</th><th>命中率</th><th>费用</th></tr></thead>
        <tbody>{rows.map(row => <tr key={row.purpose}>
            <td>{row.label}</td><td>{row.calls}</td><td>{row.unpriced}</td><td>{row.input}</td><td>{row.output}</td><td>{row.cached}</td><td>{row.rate}</td><td>{row.fee}</td>
        </tr>)}</tbody>
    </table>;
    return <section className="vcms-usage" aria-label="用量">
        <div className="vcms-usage-head">
            <span className="vcms-section-label">用量</span>
            <div className="vcms-usage-month">{vc ? <>
                <IconButton sprite={sprite} icon="chevron-left" label="上个月" data-action="usage-month" data-delta="-1" onClick={event => onAction('usage-month', event.currentTarget)} />
                <span className="vc-num" data-usage-month-label="">{month}</span>
                <IconButton sprite={sprite} icon="chevron-right" label="下个月" data-action="usage-month" data-delta="1" onClick={event => onAction('usage-month', event.currentTarget)} />
            </> : <>
                <Button className="vcms-btn vcms-btn-ghost vcms-btn-sm" data-action="usage-month" data-delta="-1" onClick={event => onAction('usage-month', event.currentTarget)}>上个月</Button>
                <span data-usage-month-label="">{month}</span>
                <Button className="vcms-btn vcms-btn-ghost vcms-btn-sm" data-action="usage-month" data-delta="1" onClick={event => onAction('usage-month', event.currentTarget)}>下个月</Button>
            </>}</div>
        </div>
        <p className="vcms-muted vcms-usage-note">未配置单价时仍会发送，费用显示为未知。</p>
        {loading ? <p className="vcms-muted">正在读取用量…</p> : error ? <p className="vcms-callout vcms-callout-warn" role="status">{error}</p> : vc ? <>
            <div className="vc-group vcms-usage-cards">{rows.map(row => <div key={row.purpose} className="vc-cell vcms-usage-card"><span className="vc-grow"><b>{row.label}</b><span className="vcms-usage-meta">{row.meta}</span></span></div>)}</div>
            <div className="vcms-usage-scroll">{table}</div>
        </> : table}
    </section>;
}
