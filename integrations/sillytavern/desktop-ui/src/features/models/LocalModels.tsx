import { Switch } from '../../components/Switch';

interface LocalService { name: string; label: string; tone: string }
export interface LocalModelsProps {
    desktop: boolean;
    embedding: LocalService;
    rerank: LocalService & { enabled: boolean; disabled: boolean };
    onToggle: (enabled: boolean) => void;
}

export function LocalModels({ desktop, embedding, rerank, onToggle }: LocalModelsProps) {
    return <section className="vcms-local" aria-label="本机模型">
        {!desktop && <div className="vc-group-title">本机模型</div>}
        <div className="vc-group">{desktop && <h2 className="vcms-desktop-group-title">本机模型</h2>}
            <div className="vc-cell" style={{ '--vc-inset': '16px' } as React.CSSProperties}>
                <span className="vc-grow"><b>向量 · {embedding.name}</b></span><span className={`vc-status vc-status-${embedding.tone}`}><i className={`vc-dot vc-dot-${embedding.tone}`} />{embedding.label}</span>
            </div>
            <div className="vc-cell" style={{ '--vc-inset': '16px' } as React.CSSProperties}>
                <span className="vc-grow"><b>重排 · {rerank.name}</b></span><span className={`vc-status vc-status-${rerank.tone}`}><i className={`vc-dot vc-dot-${rerank.tone}`} />{rerank.label}</span>
                <Switch label="重排" action="local-rerank" checked={rerank.enabled} disabled={rerank.disabled} onCheckedChange={onToggle} />
            </div>
        </div>
    </section>;
}
