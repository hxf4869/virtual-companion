import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { Button } from '@base-ui/react/button';
import { Icon } from '../../components/Icon';
export interface LightboxProps {
    src: string;
    alt: string;
    index: number;
    total: number;
    sprite: string;
    idle: boolean;
    zoomed: boolean;
    scale: number;
    origin: string;
    close(): void;
    previous(): void;
    next(): void;
    download(): void;
    copy(): void;
    wake(): void;
    zoom(x: number, y: number): void;
    dispose(): void;
    returnFocus(): HTMLElement | false;
}
export function Lightbox({
    p,
    host,
    popup,
    img,
    onPopup,
    nested,
}: {
    p: LightboxProps;
    host: HTMLElement;
    popup: RefObject<HTMLDivElement | null>;
    img: RefObject<HTMLImageElement | null>;
    onPopup(node: HTMLElement): void;
    nested: ReactNode;
}) {
    const close = useRef<HTMLButtonElement>(null);
    useEffect(() => p.dispose, [p.dispose]);
    const button = (className: string, name: string, label: string, run: () => void, disabled = false) => (
        <Button type="button" className={`vc-lb-btn ${className}`} aria-label={label} onClick={run} disabled={disabled}>
            <Icon sprite={p.sprite} name={name} size={22} />
        </Button>
    );
    return (
        <Dialog.Root
            defaultOpen
            onOpenChange={(open) => {
                if (!open) p.close();
            }}
        >
            <Dialog.Portal container={host} style={{ display: 'contents' }}>
                <Dialog.Popup
                    className={`vc-lightbox${p.idle ? ' is-idle' : ''}`}
                    aria-label="图片查看"
                    ref={(node) => {
                        popup.current = node;
                        if (node) onPopup(node);
                    }}
                    initialFocus={close}
                    finalFocus={p.returnFocus}
                    onPointerMove={p.wake}
                    onPointerDown={p.wake}
                    onKeyDown={(e) => {
                        p.wake();
                        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                            e.preventDefault();
                            e.stopPropagation();
                            if (e.key === 'ArrowLeft') p.previous();
                            else p.next();
                        }
                    }}
                >
                    <div
                        className="vc-lb-stage"
                        onClick={(e) => {
                            if (e.target === e.currentTarget) p.close();
                        }}
                    >
                        <img
                            ref={img}
                            className="vc-lb-img"
                            src={p.src}
                            alt={p.alt}
                            style={{
                                transform: p.zoomed ? `scale(${p.scale})` : undefined,
                                transformOrigin: p.origin || undefined,
                            }}
                            onDoubleClick={(e) => p.zoom(e.clientX, e.clientY)}
                        />
                    </div>
                    <div className="vc-lb-bar">
                        <span className="vc-lb-page">{`${p.index + 1} / ${p.total}`}</span>
                        {button('vc-lb-download', 'download', '下载', p.download)}
                        {button('vc-lb-copy', 'copy', '复制', p.copy)}
                        <Button
                            ref={close}
                            type="button"
                            className="vc-lb-btn vc-lb-close"
                            aria-label="关闭"
                            onClick={p.close}
                        >
                            <Icon sprite={p.sprite} name="x" size={22} />
                        </Button>
                    </div>
                    {button('vc-lb-nav vc-lb-prev', 'chevron-left', '上一张', p.previous, p.index === 0)}
                    {button('vc-lb-nav vc-lb-next', 'chevron-right', '下一张', p.next, p.index === p.total - 1)}
                </Dialog.Popup>
            </Dialog.Portal>
            {nested}
        </Dialog.Root>
    );
}
