import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@base-ui/react/button';
import { Segment } from '../../components/Segment';
import { Icon } from '../../components/Icon';

export interface InspectorProps {
    header: HTMLElement | null;
    sprite: string;
    mode: 'recall' | 'all';
    loading: boolean;
    error: string;
    busy: boolean;
    items: { id: string; summary: string }[];
    editing: boolean;
    selected: string;
    draft: string;
    events: {
        mode(value: 'recall' | 'all'): void;
        draft(value: string): void;
        retry(): void;
        edit(id: string): void;
        forget(id: string): void;
        save(): void;
        cancel(): void;
        close(): void;
        dispose(): void;
    };
}
export function MemoryInspector({
    p,
    container,
    nested,
}: {
    p: InspectorProps;
    container: HTMLElement;
    nested?: ReactNode;
}) {
    useEffect(() => p.events.dispose, [p.events]);
    const action = (label: string, run: () => void, danger = false) => (
        <Button
            type="button"
            className={`vc-btn vc-btn-text${danger ? ' is-danger' : ''}`}
            disabled={p.busy}
            onClick={run}
        >
            {label}
        </Button>
    );
    let list: ReactNode;
    if (p.loading)
        list = (
            <div className="vc-skeleton-row">
                <span className="vc-skeleton vc-skeleton-line" />
                <span className="vc-skeleton vc-skeleton-line is-short" />
            </div>
        );
    else if (p.error || !p.items.length)
        list = (
            <div className="vc-empty">
                <Icon sprite={p.sprite} name={p.error ? 'circle-alert' : 'brain'} size={32} />
                <p>{p.error || (p.mode === 'all' ? '没有相关记忆' : '这次没有召回')}</p>
                {action(p.error ? '重试' : '刷新', p.events.retry)}
            </div>
        );
    else
        list = (
            <div className="vc-group">
                {p.items.map((item) => (
                    <div key={item.id} className="vc-cell" data-memory-id={item.id}>
                        {p.editing && p.selected === item.id ? (
                            <>
                                <textarea
                                    aria-label="纠正记忆"
                                    value={p.draft}
                                    disabled={p.busy}
                                    onChange={(event) => p.events.draft(event.currentTarget.value)}
                                />
                                {action('保存', p.events.save)}
                                {action('取消', p.events.cancel)}
                            </>
                        ) : (
                            <>
                                <div className="vc-grow">{item.summary}</div>
                                {action('纠正', () => p.events.edit(item.id))}
                                {action('删除', () => p.events.forget(item.id), true)}
                            </>
                        )}
                    </div>
                ))}
            </div>
        );
    return (
        <>
            {p.header &&
                createPortal(
                    <>
                        <h2>记忆</h2>
                        {action('完成', p.events.close)}
                    </>,
                    p.header,
                )}
            {createPortal(
                <>
                    <Segment
                        label="记忆范围"
                        preference="inspector-mode"
                        value={p.mode}
                        options={[
                            { value: 'recall', label: '本次召回' },
                            { value: 'all', label: '全部' },
                        ]}
                        onValueChange={p.events.mode}
                    />
                    <div data-vc-memory-list="">{list}</div>
                </>,
                container,
            )}
            {nested}
        </>
    );
}
