import type { ReactNode } from 'react';
import { AlertDialog } from '../../design/components/AlertDialog';
import { Button } from '../../design/components/Button';
import { Field } from '../../design/components/Field';
import { Textarea } from '../../design/components/Textarea';
import type { PersonaFields } from '../../data/queries/characters';
import {
    PERSONA_FIELD_ROWS,
    personaSchema,
    usePersonaEditorState,
    type PersonaFormValues,
} from './useCharactersState';

export { personaSchema, type PersonaFormValues };

export interface PersonaEditorProps {
    avatar: string;
    characterRef: string;
    characterName?: string;
    fields: PersonaFields;
    onBack: () => void;
    onClose?: () => void;
    onSaved?: (fields: PersonaFields) => void;
    renderLeaveGuard: (dirty: boolean) => ReactNode;
}

export function PersonaEditor({
    avatar,
    characterRef,
    fields,
    onBack,
    onClose,
    onSaved,
    renderLeaveGuard,
}: PersonaEditorProps) {
    const {
        form,
        isDirty,
        isSaving,
        saveError,
        discardDialogOpen,
        setDiscardDialogOpen,
        requestBack,
        confirmDiscard,
        submit,
    } = usePersonaEditorState({
        avatar,
        characterRef,
        fields,
        onBack,
        onSaved,
    });

    const leaveGuardNode = renderLeaveGuard(isDirty);

    return (
        <form
            className="vc-persona-editor"
            data-character-ref={characterRef}
            onSubmit={(e) => void submit(e)}
        >
            <div className="vc-persona-editor-bar">
                <Button
                    type="button"
                    variant="text"
                    disabled={isSaving}
                    onClick={requestBack}
                >
                    返回
                </Button>
                <h2>人设</h2>
                <div className="vc-characters-header-actions">
                    {onClose ? (
                        <Button
                            type="button"
                            variant="text"
                            disabled={isSaving}
                            onClick={onClose}
                        >
                            关闭
                        </Button>
                    ) : null}
                    <Button
                        type="submit"
                        variant="filled"
                        pending={isSaving}
                        disabled={isSaving}
                    >
                        保存
                    </Button>
                </div>
            </div>

            {saveError ? (
                <p className="vc-character-inline-alert" role="alert">
                    {saveError}
                </p>
            ) : null}

            <div className="vc-persona-editor-fields">
                {PERSONA_FIELD_ROWS.map(({ key, label, rows }) => (
                    <Field key={key} label={label}>
                        <Textarea
                            id={`vc-persona-${key}`}
                            rows={rows}
                            disabled={isSaving}
                            {...form.register(key)}
                        />
                    </Field>
                ))}
            </div>

            <AlertDialog
                open={discardDialogOpen}
                onOpenChange={setDiscardDialogOpen}
                title="放弃更改？"
                description="关闭后本次输入将丢失。"
                cancelLabel="继续编辑"
                confirmLabel="放弃"
                danger
                onConfirm={confirmDiscard}
            />

            {leaveGuardNode}
        </form>
    );
}
