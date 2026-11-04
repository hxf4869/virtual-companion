import React, { useRef, useState } from 'react';
import { Button } from '../../design/components/Button';
import { Icon } from '../../design/components/Icon';
import {
    useImportCharacter,
    type ImportedCharacterResult,
} from '../../data/queries/characters';
import {
    IMPORT_FAILED_COPY,
    inspectCharacterFile,
} from '../../../../extension/vc-model-settings/instance-logic.js';

export interface ImportCharacterProps {
    label?: string;
    variant?: 'filled' | 'gray' | 'text' | 'danger-soft';
    disabled?: boolean;
    onImported?: (card: ImportedCharacterResult) => void;
    onError?: (message: string) => void;
}

async function readFileBytes(file: File): Promise<Uint8Array> {
    if (typeof file.arrayBuffer === 'function') {
        return new Uint8Array(await file.arrayBuffer());
    }
    return new Uint8Array(await new Response(file).arrayBuffer());
}

export function ImportCharacter({
    label = '导入角色卡',
    variant = 'gray',
    disabled = false,
    onImported,
    onError,
}: ImportCharacterProps) {
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const importMutation = useImportCharacter();
    const [errorMessage, setErrorMessage] = useState('');

    const handleTriggerClick = () => {
        if (disabled || importMutation.isPending) return;
        fileInputRef.current?.click();
    };

    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const chosen = event.target.files?.[0];
        event.target.value = '';
        if (!chosen || disabled || importMutation.isPending) return;

        setErrorMessage('');
        try {
            const bytes = await readFileBytes(chosen);
            const inspected = inspectCharacterFile(bytes, chosen.name);
            if (!inspected.ok) {
                setErrorMessage(IMPORT_FAILED_COPY);
                onError?.(IMPORT_FAILED_COPY);
                return;
            }
            const result = await importMutation.mutateAsync({
                name: chosen.name,
                bytes,
            });
            setErrorMessage('');
            onImported?.(result);
        } catch (err: any) {
            const msg = err?.message || IMPORT_FAILED_COPY;
            setErrorMessage(msg);
            onError?.(msg);
        }
    };

    return (
        <div className="vc-import-character">
            <input
                ref={fileInputRef}
                type="file"
                accept=".json,.png,application/json,image/png"
                hidden
                onChange={(e) => void handleFileChange(e)}
            />
            <Button
                type="button"
                variant={variant}
                pending={importMutation.isPending}
                disabled={disabled || importMutation.isPending}
                onClick={handleTriggerClick}
            >
                <Icon name="plus" size={16} />
                <span>{label}</span>
            </Button>
            {errorMessage ? (
                <p className="vc-character-inline-alert" role="alert">
                    {errorMessage}
                </p>
            ) : null}
        </div>
    );
}
