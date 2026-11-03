import { Button } from '@base-ui/react/button';
import { Icon } from '../../components/Icon';
export interface QuoteProps {
    label: string;
    text: string;
    sprite: string;
    close(): void;
}
export function QuoteBar(p: QuoteProps) {
    return (
        <>
            <span className="vc-quote-label">{p.label}</span>
            <span className="vc-quote-text">{p.text}</span>
            <Button type="button" className="vc-quote-close" aria-label="关闭引用" onClick={p.close}>
                <Icon sprite={p.sprite} name="x" size={16} />
            </Button>
        </>
    );
}
export interface MessageToolsProps {
    sprite: string;
    character: boolean;
    read: boolean;
    pager: { at: string; n: string; prev: string; next: string } | null;
    voice: { busy: boolean; playing: boolean; failed: boolean };
    retry: { failed: string; label: string; run(): void } | null;
}
export function MessageTools(p: MessageToolsProps) {
    const action = (id: string, label: string, glyph: string) => (
        <Button type="button" data-vc-act={id} aria-label={label}>
            <Icon sprite={p.sprite} name={glyph} size={18} />
        </Button>
    );
    return (
        <>
            {p.pager && (
                <div className="vc-mes-pager" data-vc-pager="">
                    {action('swipe-prev', p.pager.prev, 'chevron-left')}
                    <span className="vc-num">{`${p.pager.at}/${p.pager.n}`}</span>
                    {action('swipe-next', p.pager.next, 'chevron-right')}
                </div>
            )}
            <span className="vc-mes-gap" />
            {p.character && action('regen', '重新生成', 'refresh-cw')}
            {action('edit', '编辑', 'pencil')}
            {action('copy', '复制', 'copy')}
            {p.read && (
                <Button
                    type="button"
                    data-vc-act="read"
                    aria-label={p.voice.busy ? '正在生成语音…' : p.voice.playing ? '暂停语音' : '朗读'}
                    aria-busy={p.voice.busy || undefined}
                    aria-pressed={p.voice.playing}
                    disabled={p.voice.busy}
                    title={p.voice.failed ? '没有完成，请重试。' : undefined}
                >
                    <Icon sprite={p.sprite} name={p.voice.playing ? 'pause' : 'volume-2'} size={18} />
                </Button>
            )}
            {p.retry && (
                <Button type="button" className="vc-send-retry" onClick={p.retry.run}>
                    <span>{p.retry.failed}</span>
                    <span aria-hidden="true">·</span>
                    <span className="vc-send-retry-act">{p.retry.label}</span>
                </Button>
            )}
        </>
    );
}
