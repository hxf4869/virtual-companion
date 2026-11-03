import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { Button } from '@base-ui/react/button';
export interface StatusCardProps {
    label: string;
    name: string;
    instance: string;
    avatar: string;
    letter: string;
    reducedMotion: boolean;
    style: CSSProperties;
    mood: string;
    line: string;
    activity: string;
    bars: { label: string; value: number }[];
    day: string;
    next: string;
    close(restore: boolean): void;
    pat(): void;
    memory(): void;
    dispose(): void;
    returnFocus(): HTMLElement | false;
    anchor: HTMLElement;
}
export function StatusCard({
    p,
    host,
    popup,
    onPopup,
    nested,
}: {
    p: StatusCardProps;
    host: HTMLElement;
    popup: RefObject<HTMLDivElement | null>;
    onPopup(node: HTMLElement): void;
    nested: ReactNode;
}) {
    const [face, setFace] = useState({ src: p.avatar, old: null as string | null });
    const current = useRef(p.avatar);
    useEffect(() => p.dispose, [p.dispose]);
    useEffect(() => {
        if (current.current === p.avatar) return;
        const old = current.current;
        current.current = p.avatar;
        setFace({ src: p.avatar, old: p.reducedMotion ? null : old });
        const timer = setTimeout(() => setFace({ src: p.avatar, old: null }), 700);
        return () => clearTimeout(timer);
    }, [p.avatar, p.reducedMotion]);
    const image = (src: string, incoming = false) =>
        src ? (
            <img
                className={`vc-sc-face${incoming ? ' is-incoming' : ''}`}
                src={src}
                alt=""
                draggable={false}
                onAnimationEnd={() => setFace({ src: p.avatar, old: null })}
            />
        ) : (
            <span className={`vc-sc-face${incoming ? ' is-incoming' : ''}`}>{p.letter}</span>
        );
    return (
        <Dialog.Root
            defaultOpen
            modal={false}
            onOpenChange={(open, details) => {
                if (open) return;
                if (
                    details.reason === 'focus-out' ||
                    (details.reason === 'outside-press' && p.anchor.contains(details.event.target as Node))
                )
                    details.cancel();
                else p.close(details.reason === 'escape-key');
            }}
        >
            <Dialog.Portal container={host} style={{ display: 'contents' }}>
                <Dialog.Popup
                    id="vc-status-card"
                    className="vc-glass"
                    aria-label={p.label}
                    tabIndex={-1}
                    style={p.style}
                    ref={(node) => {
                        popup.current = node;
                        if (node) onPopup(node);
                    }}
                    initialFocus={popup}
                    finalFocus={p.returnFocus}
                >
                    <div className="vc-sc-head">
                        <span className="vc-sc-avatar">
                            {face.old !== null && image(face.old)}
                            {image(face.src, face.old !== null)}
                        </span>
                        <div>
                            <b>{p.name}</b>
                            {p.instance && <small>{p.instance}</small>}
                        </div>
                    </div>
                    {p.mood && (
                        <div className="vc-sc-mood">
                            <p className="vc-sc-title">{p.mood}</p>
                            {p.line && <p className="vc-sc-sub">{p.line}</p>}
                        </div>
                    )}
                    {p.activity && (
                        <div className="vc-sc-doing">
                            <p className="vc-sc-label">在做什么</p>
                            <p className="vc-sc-text">{p.activity}</p>
                        </div>
                    )}
                    {p.bars.length > 0 && (
                        <div className="vc-sc-bars">
                            {p.bars.map((bar) => (
                                <div key={bar.label} className="vc-sc-bar">
                                    <span>{bar.label}</span>
                                    <i
                                        role="progressbar"
                                        aria-label={bar.label}
                                        aria-valuemin={0}
                                        aria-valuemax={100}
                                        aria-valuenow={bar.value}
                                    >
                                        <b style={{ '--v': bar.value } as CSSProperties} />
                                    </i>
                                </div>
                            ))}
                        </div>
                    )}
                    {p.day && (
                        <div className="vc-sc-days">
                            <p className="vc-sc-title">{p.day}</p>
                            <p className="vc-sc-next">{p.next}</p>
                        </div>
                    )}
                    <div className="vc-sc-actions">
                        <Button type="button" className="vc-btn vc-sc-action" onClick={p.pat}>
                            拍一拍
                        </Button>
                        <Button type="button" className="vc-btn vc-sc-action" onClick={p.memory}>
                            查看记忆
                        </Button>
                    </div>
                </Dialog.Popup>
            </Dialog.Portal>
            {nested}
        </Dialog.Root>
    );
}
