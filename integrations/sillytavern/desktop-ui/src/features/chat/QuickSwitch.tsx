import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Autocomplete } from '@base-ui/react/autocomplete';
import { Dialog } from '@base-ui/react/dialog';

export interface QuickRow {
    id: string;
    name: string;
    preview: string;
    avatar: string;
    letter: string;
}
export interface QuickSwitchProps {
    rows: QuickRow[];
    opener: HTMLElement | null;
    filter(rows: QuickRow[], query: string): QuickRow[];
    pick(id: string): void;
    close(): void;
    returnFocus(): HTMLElement | null;
    dispose(): void;
}
export function QuickSwitch({
    p,
    host,
    onPopup,
    nested,
}: {
    p: QuickSwitchProps;
    host: HTMLElement;
    onPopup(node: HTMLElement): void;
    nested?: ReactNode;
}) {
    const [query, setQuery] = useState('');
    const input = useRef<HTMLInputElement>(null);
    const visible = p.filter(p.rows, query);
    useEffect(() => p.dispose, [p.dispose]);
    return (
        <Dialog.Root
            defaultOpen
            onOpenChange={(open) => {
                if (!open) p.close();
            }}
        >
            <Dialog.Portal container={host} style={{ display: 'contents' }}>
                <Dialog.Backdrop forceRender className="vc-quick-scrim" onClick={p.close} />
                <Dialog.Popup
                    ref={node => { if (node) onPopup(node); }}
                    className="vc-quick-panel vc-glass"
                    aria-label="搜索会话"
                    initialFocus={input}
                    finalFocus={p.returnFocus}
                >
                    <Autocomplete.Root
                        inline
                        open
                        autoHighlight="always"
                        items={p.rows}
                        filteredItems={visible}
                        value={query}
                        onValueChange={setQuery}
                        onOpenChange={(open) => {
                            if (!open) p.close();
                        }}
                        itemToStringValue={(row) => `${row.name} ${row.preview}`}
                    >
                        <Autocomplete.Input
                            ref={input}
                            type="text"
                            autoComplete="off"
                            className="vc-quick-input"
                            placeholder="搜索会话"
                            aria-label="搜索会话"
                        />
                        <Autocomplete.List className="vc-quick-list">
                            {visible.length ? (
                                visible.map((row, index) => (
                                    <Autocomplete.Item
                                        key={row.id}
                                        index={index}
                                        value={row}
                                        nativeButton
                                        className="vc-quick-row"
                                        render={(props, state) => (
                                            <button {...props} aria-selected={state.highlighted} />
                                        )}
                                        onClick={() => p.pick(row.id)}
                                    >
                                        {row.avatar ? (
                                            <img className="vc-quick-avatar" alt="" src={row.avatar} />
                                        ) : (
                                            <span className="vc-quick-avatar">
                                                {row.letter || [...row.name][0] || ''}
                                            </span>
                                        )}
                                        <span className="vc-quick-name">{row.name}</span>
                                        <span className="vc-quick-preview">{row.preview}</span>
                                    </Autocomplete.Item>
                                ))
                            ) : (
                                <p className="vc-quick-empty">没有找到</p>
                            )}
                        </Autocomplete.List>
                    </Autocomplete.Root>
                </Dialog.Popup>
            </Dialog.Portal>
            {nested}
        </Dialog.Root>
    );
}
