import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Button } from '@base-ui/react/button';
import { Collapsible } from '@base-ui/react/collapsible';
import { Icon } from '../../components/Icon';
interface PlayerInfo {
    currentTime: number;
    duration: number;
    ended?: boolean;
}
interface Player {
    toggle(
        id: string | undefined,
        events: { onState(playing: boolean): void; onPlayed(): void; onError(): void },
    ): Promise<unknown>;
    peek?(id: string | undefined): PlayerInfo | null;
    isCurrent?(id: string | undefined): boolean;
    seek?(id: string | undefined, time: number): boolean;
    setRate?(rate: number): void;
}
export interface VoiceBubbleProps {
    input: boolean;
    desktop: boolean;
    text: string;
    seconds: number;
    width: number;
    heights: number[];
    clipId?: string;
    played: boolean;
    sprite: string;
    player: Player;
    readRate(): number;
    rateText(rate: number): string;
    cycleRate(): void;
    onPlayed(): void;
    onPlaying(playing: boolean): void;
}
export function VoiceBubble(p: VoiceBubbleProps) {
    const [open, setOpen] = useState(p.input),
        [playing, setPlaying] = useState(false),
        [unread, setUnread] = useState(!p.input && !p.played);
    const [progress, setProgress] = useState(0),
        [rate, setRate] = useState(p.readRate);
    const group = useRef<HTMLDivElement>(null);
    const alive = useRef(true),
        dragged = useRef(false),
        resetDrag = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const fraction = () => {
        const info = p.player.peek?.(p.clipId);
        if (!info || info.ended) return 0;
        const total = info.duration || p.seconds;
        return total ? info.currentTime / total : 0;
    };
    const paint = () => setProgress(Math.round(Math.min(1, Math.max(0, fraction())) * p.heights.length));
    useEffect(() => {
        alive.current = true;
        return () => {
            alive.current = false;
            clearTimeout(resetDrag.current);
        };
    }, []);
    useEffect(() => {
        if (!p.desktop || p.input) return;
        p.player.setRate?.(p.readRate());
        const changed = () => setRate(p.readRate());
        const win = group.current!.ownerDocument.defaultView!;
        win.addEventListener('vc-voice-rate', changed);
        return () => win.removeEventListener('vc-voice-rate', changed);
    }, [p.desktop, p.input, p.player, p.readRate]);
    useEffect(() => {
        if (!p.desktop) return;
        const win = group.current!.ownerDocument.defaultView!;
        let frame = 0;
        const loop = () => {
            paint();
            if (playing) frame = win.requestAnimationFrame(loop);
        };
        loop();
        return () => win.cancelAnimationFrame(frame);
    }, [playing, p.desktop]);
    const seek = (time: number) => {
        if (p.player.seek?.(p.clipId, time)) paint();
    };
    const seekPointer = (x: number, wave: HTMLElement) => {
        const rect = wave.getBoundingClientRect(),
            ratio = rect.width ? Math.min(1, Math.max(0, (x - rect.left) / rect.width)) : 0;
        seek(ratio * (p.player.peek?.(p.clipId)?.duration || p.seconds));
    };
    const contents = (
        <>
            <span className="vc-voice-glyph">
                <Icon sprite={p.sprite} name={p.input ? 'mic' : playing ? 'pause' : 'play'} />
            </span>
            <span
                className="vc-voice-wave"
                aria-hidden="true"
                onPointerDown={(e) => {
                    if (!p.desktop || p.input || !p.player.isCurrent?.(p.clipId)) return;
                    dragged.current = true;
                    e.currentTarget.setPointerCapture?.(e.pointerId);
                    seekPointer(e.clientX, e.currentTarget);
                }}
                onPointerMove={(e) => {
                    if (dragged.current) seekPointer(e.clientX, e.currentTarget);
                }}
                onPointerUp={() => {
                    resetDrag.current = setTimeout(() => {
                        dragged.current = false;
                    }, 0);
                }}
                onPointerCancel={() => {
                    resetDrag.current = setTimeout(() => {
                        dragged.current = false;
                    }, 0);
                }}
            >
                {p.heights.map((height, index) => (
                    <i
                        key={index}
                        className={p.desktop && index < progress ? 'on' : undefined}
                        style={p.desktop ? ({ '--h': `${height}%` } as CSSProperties) : undefined}
                    />
                ))}
            </span>
            <span className="vc-voice-duration">{`${p.seconds}″`}</span>
            {unread && <span className="vc-voice-unread" role="img" aria-label="未播放" />}
        </>
    );
    return (
        <Collapsible.Root ref={group} open={open} onOpenChange={setOpen} style={{ display: 'contents' }}>
            {p.input ? (
                <div
                    className="vc-voice-bar"
                    aria-label="语音消息"
                    style={{ '--vc-voice-width': `${p.width}%` } as CSSProperties}
                >
                    {contents}
                </div>
            ) : (
                <Button
                    type="button"
                    className="vc-voice-bar"
                    style={{ '--vc-voice-width': `${p.width}%` } as CSSProperties}
                    aria-label={playing ? '暂停语音' : '播放语音'}
                    aria-pressed={playing}
                    onKeyDown={(e) => {
                        if (
                            !p.desktop ||
                            (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') ||
                            !p.player.isCurrent?.(p.clipId)
                        )
                            return;
                        const info = p.player.peek?.(p.clipId);
                        if (!info) return;
                        e.preventDefault();
                        seek(info.currentTime + (e.key === 'ArrowRight' ? 1 : -1));
                    }}
                    onClick={() => {
                        if (dragged.current) return;
                        void p.player.toggle(p.clipId, {
                            onState(value) {
                                if (!alive.current) return;
                                setPlaying(value);
                                p.onPlaying(value);
                            },
                            onPlayed() {
                                p.onPlayed();
                                if (alive.current) setUnread(false);
                            },
                            onError() {
                                if (alive.current) setOpen(true);
                            },
                        });
                    }}
                >
                    {contents}
                </Button>
            )}
            {p.desktop && !p.input && (
                <Button type="button" className="vc-voice-speed" aria-label="播放速度" onClick={p.cycleRate}>
                    {p.rateText(rate)}
                </Button>
            )}
            <Collapsible.Trigger className="vc-voice-transcribe">{open ? '收起文字' : '转文字'}</Collapsible.Trigger>
            <Collapsible.Panel keepMounted className="vc-voice-transcript">
                <p className="vc-voice-text">{p.text}</p>
            </Collapsible.Panel>
        </Collapsible.Root>
    );
}
