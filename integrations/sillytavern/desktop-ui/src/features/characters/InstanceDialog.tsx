import React, { useEffect, useState } from 'react';
import { Dialog } from '../../design/components/Dialog';
import { Button } from '../../design/components/Button';
import { Field } from '../../design/components/Field';
import { TextInput } from '../../design/components/TextInput';
import {
    useCreateInstance,
    useRenameInstance,
    type CreatedInstanceResult,
} from '../../data/queries/characters';
import { sanitizeInstanceName } from '../../../../extension/vc-model-settings/instance-logic.js';

export interface InstanceDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    mode: 'create' | 'rename';
    characterRef: string;
    avatar?: string;
    initialName?: string;
    relationship?: Record<string, any> | null;
    onCreated?: (result: CreatedInstanceResult) => void;
    onRenamed?: (newName: string) => void;
}

export function InstanceDialog({
    open,
    onOpenChange,
    mode,
    characterRef,
    avatar = '',
    initialName = '',
    relationship = null,
    onCreated,
    onRenamed,
}: InstanceDialogProps) {
    const createMutation = useCreateInstance();
    const renameMutation = useRenameInstance();

    const [draftName, setDraftName] = useState(initialName);
    const [nameError, setNameError] = useState('');

    useEffect(() => {
        if (open) {
            setDraftName(initialName);
            setNameError('');
        }
    }, [open, initialName, mode, characterRef]);

    const busy = createMutation.isPending || renameMutation.isPending;

    const handleSave = async (e?: React.FormEvent) => {
        e?.preventDefault();
        if (busy) return;
        const clean = sanitizeInstanceName(draftName);
        if (!clean.ok) {
            setNameError(String(clean.reason || ''));
            return;
        }
        const cleanName = String(clean.value || '');
        setNameError('');
        try {
            if (mode === 'create') {
                const created = await createMutation.mutateAsync({
                    characterRef,
                    avatar,
                    displayName: cleanName,
                    mode: 'COMPANION',
                });
                onCreated?.(created);
                onOpenChange(false);
            } else {
                if (!relationship) {
                    setNameError('名称尚未保存');
                    return;
                }
                await renameMutation.mutateAsync({
                    relationship,
                    name: cleanName,
                });
                onRenamed?.(cleanName);
                onOpenChange(false);
            }
        } catch (err: any) {
            setNameError(err?.message || '名称尚未保存');
        }
    };

    return (
        <Dialog
            open={open}
            onOpenChange={(nextOpen) => {
                if (!busy) {
                    onOpenChange(nextOpen);
                }
            }}
            title={mode === 'create' ? '新建实例' : '修改名称'}
            width={420}
            actions={
                <>
                    <Button
                        type="button"
                        variant="gray"
                        disabled={busy}
                        onClick={() => onOpenChange(false)}
                    >
                        取消
                    </Button>
                    <Button
                        type="button"
                        variant="filled"
                        pending={busy}
                        disabled={busy}
                        onClick={() => void handleSave()}
                    >
                        保存
                    </Button>
                </>
            }
        >
            <form onSubmit={(e) => void handleSave(e)}>
                <Field label="实例名称" error={nameError || undefined}>
                    <TextInput
                        id="vc-instance-dialog-name"
                        name="displayName"
                        value={draftName}
                        maxLength={32}
                        placeholder="给这个实例起个名字"
                        disabled={busy}
                        onChange={(e) => {
                            setDraftName(e.target.value);
                            if (nameError) setNameError('');
                        }}
                    />
                </Field>
            </form>
        </Dialog>
    );
}
