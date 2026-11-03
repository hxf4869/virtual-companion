import type { CSSProperties, RefObject } from 'react';
import { Button } from '@base-ui/react/button';
import { Icon } from '../../components/Icon';
import { IconButton } from '../../components/IconButton';
export interface SettingsFrameProps {
    sprite: string; categories: readonly (readonly string[])[]; tavern: readonly { panel: string; label: string; icon: string; tile: string }[];
    current: string; title: string; model?: HTMLElement; detailHidden?: boolean;
    voice?: { dirty: boolean; working: boolean; disabled: boolean; style?: CSSProperties; onDiscard: (trigger: HTMLElement) => void; onSave: () => void };
    onSelect: (key: string) => void; onCategories: (trigger: HTMLElement) => void;
}
export function SettingsFrame(p: SettingsFrameProps & { bodyRef: RefObject<HTMLDivElement | null>; contentRef: RefObject<HTMLDivElement | null> }) {
    const row = (key: string, title: string, glyph: string, tile: string) => <Button key={key} data-category={key} data-vc-light="" aria-current={p.current === key ? 'page' : 'false'} onClick={() => p.onSelect(key)}><span className={`vc-tile vc-tile-${tile}`}><Icon sprite={p.sprite} name={glyph} size={18} /></span><span>{title}</span></Button>;
    return <><nav className="vc-settings-categories vc-desk-panel" aria-label="设置分类"><h1>设置</h1>{p.categories.map(([key, title, icon, tile]) => row(key, title, icon, tile))}<h2>酒馆</h2>{p.tavern.map(item => row(item.panel, item.label, item.icon, item.tile))}</nav>
        {p.current === 'model' ? <ModelSlot key="model" node={p.model!} contentRef={p.contentRef} /> : <div key={p.current} ref={p.contentRef} className="vc-settings-content vc-desk-panel">
            {p.current && <header className="vc-settings-header" hidden={p.detailHidden}><span className="vc-settings-category-control"><IconButton sprite={p.sprite} icon="settings" label="设置" className="vc-settings-category-toggle" data-settings-categories="" onClick={event => p.onCategories(event.currentTarget)} /></span><h1 tabIndex={-1}>{p.title}</h1>
                {p.voice && <><Button className="vc-btn vc-btn-text" hidden={!p.voice.dirty} disabled={p.voice.working} onClick={event => p.voice!.onDiscard(event.currentTarget)}>放弃修改</Button><Button className="vc-btn vc-btn-fill" data-voice-save="" disabled={p.voice.disabled} style={p.voice.style} onClick={p.voice.onSave}>{p.voice.working ? <><Icon sprite={p.sprite} name="refresh-cw" size={16} />保存中…</> : '保存'}</Button></>}
            </header>}
            <div className="vc-settings-body" ref={p.bodyRef} />
        </div>}
    </>;
}
import { useCallback } from 'react';
function ModelSlot({ node, contentRef }: { node: HTMLElement; contentRef: RefObject<HTMLDivElement | null> }) {
    const slot = useCallback((el: HTMLDivElement | null) => { contentRef.current = el; if (!el) return; el.append(node); return () => { if (node.parentElement === el) node.remove(); }; }, [node, contentRef]);
    return <div ref={slot} className="vc-settings-content vc-desk-panel" />;
}
export function DrawerEntry({ title, sprite, onOpen }: { title: string; sprite: string; onOpen: () => void }) {
    return <div className="vc-desk-group"><Button className="vc-cell" onClick={onOpen}><span className="vc-grow">{title}</span><Icon sprite={sprite} name="chevron-right" size={16} /></Button></div>;
}
