import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@base-ui/react/button';
import { Switch } from '../../components/Switch';
import { Segment } from '../../components/Segment';
import { Icon } from '../../components/Icon';
interface StickerRow { id: string; tag: string; src?: string; builtin?: boolean; attribution?: string }
export interface StickersProps {
    enabled: boolean; frequency: string; frequencies: { value: string; label: string }[]; rows: StickerRow[]; sprite: string;
    enabledChange(value: boolean): void; frequencyChange(value: string): void; tag(id: string, value: string): void;
    remove(id: string, opener: HTMLElement): void; upload(file: File): void; back(): void; dispose(): void;
}
function Tag({ row, commit }: { row: StickerRow; commit(id: string, value: string): void }) {
    const [value, setValue] = useState(row.tag);
    useEffect(() => setValue(row.tag), [row.tag]);
    return <input className="vc-sticker-tag" data-vc-sticker-tag="" aria-label="标签" value={value} readOnly={row.builtin}
        onChange={e => setValue(e.target.value)} onBlur={() => { if (!row.builtin && value !== row.tag) commit(row.id, value); }} />;
}
export function Stickers({ p, container, nested }: { p: StickersProps; container: HTMLElement; nested: ReactNode }) {
    const file = useRef<HTMLInputElement>(null);
    useEffect(() => p.dispose, [p.dispose]);
    const upload = <Button type="button" className="vc-btn vc-btn-fill vc-sticker-upload" data-vc-sticker-upload="" onClick={() => file.current?.click()}>上传</Button>;
    const notes = [...new Set(p.rows.map(row => row.attribution?.trim() || '').filter(Boolean))];
    return <>{createPortal(<>
        <div className="vc-navbar"><Button type="button" className="vc-btn vc-btn-text" data-vc-sticker-back="" aria-label="返回设置" onClick={p.back}>设置</Button><div className="vc-nav-title" data-vc-sticker-title="">表情包</div></div>
        <div className="vc-group"><div className="vc-cell vc-sticker-row"><span className="vc-grow">发送</span><Switch label="发送" data-vc-sticker-enabled="" checked={p.enabled} onCheckedChange={p.enabledChange} /></div></div>
        <div className="vc-group-title">频率</div><Segment label="频率" preference="sticker-frequency" value={p.frequency} options={p.frequencies} onValueChange={p.frequencyChange} />
        <div className="vc-group" data-vc-sticker-list="">{p.rows.length ? <><div className="vc-cell vc-sticker-actions">{upload}</div>{p.rows.map(row => <div key={row.id} className="vc-cell vc-sticker-row" data-vc-sticker-id={row.id}>{row.src && <img className="vc-sticker-thumb" alt="" src={row.src} />}<Tag row={row} commit={p.tag} />{!row.builtin && <Button type="button" className="vc-btn vc-btn-text" data-vc-sticker-delete="" aria-label="删除" onClick={e => p.remove(row.id, e.currentTarget)}><Icon sprite={p.sprite} name="trash-2" size={18} /></Button>}</div>)}</> : <div className="vc-empty" data-vc-sticker-empty=""><span><Icon sprite={p.sprite} name="image" size={32} /></span><p>还没有表情包</p>{upload}</div>}</div>
        {notes.map(note => <p key={note} className="vc-footnote" data-vc-sticker-attribution="">{note}</p>)}
        <input ref={file} className="vc-sticker-file" type="file" data-vc-sticker-file="" accept="image/png,image/jpeg,image/webp,image/gif" onChange={e => { const picked = e.target.files?.[0]; if (picked) p.upload(picked); e.target.value = ''; }} />
    </>, container)}{nested}</>;
}
export function StickerEntry({ host, sprite, open, button, nested }: { host: HTMLElement; sprite: string; open(button: HTMLElement): void; button: RefObject<HTMLButtonElement | null>; nested: ReactNode }) {
    return <>{createPortal(<Button ref={button} type="button" className="vc-cell" data-vc-sticker-entry="" data-action="stickers" onClick={e => { e.stopPropagation(); open(e.currentTarget); }}><span className="vc-tile vc-tile-orange"><Icon sprite={sprite} name="image" size={18} /></span><span className="vc-grow">表情包</span></Button>, host)}{nested}</>;
}
