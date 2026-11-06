import { Dialog } from '../../design/components/Dialog';
import { Button } from '../../design/components/Button';
import { Field } from '../../design/components/Field';
import { TextInput } from '../../design/components/TextInput';
import type { CreatedInstanceResult } from '../../data/queries/characters';
import { useInstanceDialogState } from './useCharactersState';

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
    const {
        draftName,
        setDraftName,
        nameError,
        busy,
        handleOpenChange,
        save,
    } = useInstanceDialogState({
        open,
        onOpenChange,
        mode,
        characterRef,
        avatar,
        initialName,
        relationship,
        onCreated,
        onRenamed,
    });

    return (
        <Dialog
            open={open}
            onOpenChange={handleOpenChange}
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
                        onClick={() => void save()}
                    >
                        保存
                    </Button>
                </>
            }
        >
            <form onSubmit={(e) => void save(e)}>
                <Field label="实例名称" error={nameError || undefined}>
                    <TextInput
                        id="vc-instance-dialog-name"
                        name="displayName"
                        value={draftName}
                        maxLength={32}
                        placeholder="给这个实例起个名字"
                        disabled={busy}
                        onChange={(e) => setDraftName(e.target.value)}
                    />
                </Field>
            </form>
        </Dialog>
    );
}
