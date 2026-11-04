import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { AlertDialog } from '../../design/components/AlertDialog';
import { Button } from '../../design/components/Button';
import { Field } from '../../design/components/Field';
import { Textarea } from '../../design/components/Textarea';
import { useLeaveGuard } from '../../shell/useLeaveGuard';
import { useSavePersona, type PersonaFields } from '../../data/queries/characters';

export const personaSchema = z.object({
    description: z.string(),
    personality: z.string(),
    scenario: z.string(),
    first_mes: z.string(),
    mes_example: z.string(),
});

export type PersonaFormValues = z.infer<typeof personaSchema>;

export interface PersonaEditorProps {
    avatar: string;
    characterRef: string;
    characterName?: string;
    fields: PersonaFields;
    onBack: () => void;
    onClose?: () => void;
    onSaved?: (fields: PersonaFields) => void;
}

const PERSONA_FIELD_ROWS: ReadonlyArray<{
    key: keyof PersonaFields;
    label: string;
    rows: number;
}> = [
    { key: 'description', label: '介绍', rows: 5 },
    { key: 'personality', label: '性格', rows: 4 },
    { key: 'scenario', label: '情景', rows: 3 },
    { key: 'first_mes', label: '开场', rows: 3 },
    { key: 'mes_example', label: '例句', rows: 5 },
];

export function PersonaEditor({
    avatar,
    characterRef,
    fields,
    onBack,
    onClose,
    onSaved,
}: PersonaEditorProps) {
    const saveMutation = useSavePersona();
    const [baseline, setBaseline] = useState<PersonaFields>(() => ({ ...fields }));
    const [discardDialogOpen, setDiscardDialogOpen] = useState(false);
    const [saveError, setSaveError] = useState('');

    const form = useForm<PersonaFormValues>({
        defaultValues: { ...fields },
    });

    useEffect(() => {
        setBaseline({ ...fields });
        form.reset({ ...fields });
    }, [
        avatar,
        characterRef,
        fields.description,
        fields.personality,
        fields.scenario,
        fields.first_mes,
        fields.mes_example,
        form,
    ]);

    const values = form.watch();
    const isDirty =
        values.description !== baseline.description ||
        values.personality !== baseline.personality ||
        values.scenario !== baseline.scenario ||
        values.first_mes !== baseline.first_mes ||
        values.mes_example !== baseline.mes_example;

    const leaveGuardNode = useLeaveGuard(isDirty);

    const handleBackClick = () => {
        if (saveMutation.isPending) return;
        if (isDirty) {
            setDiscardDialogOpen(true);
            return;
        }
        onBack();
    };

    const handleConfirmDiscard = () => {
        setDiscardDialogOpen(false);
        form.reset({ ...baseline });
        onBack();
    };

    const onSubmit = form.handleSubmit(async (rawValues) => {
        if (saveMutation.isPending) return;
        const parsed = personaSchema.safeParse(rawValues);
        if (!parsed.success) {
            setSaveError('请检查输入内容。');
            return;
        }
        setSaveError('');
        try {
            const saved = await saveMutation.mutateAsync({
                avatar,
                fields: parsed.data,
            });
            setBaseline({ ...saved });
            form.reset({ ...saved });
            onSaved?.(saved);
        } catch (err: any) {
            setSaveError(err?.message || '没有完成，请重试。');
        }
    });

    return (
        <form
            className="vc-persona-editor"
            data-character-ref={characterRef}
            onSubmit={(e) => void onSubmit(e)}
        >
            <div className="vc-persona-editor-bar">
                <Button
                    type="button"
                    variant="text"
                    disabled={saveMutation.isPending}
                    onClick={handleBackClick}
                >
                    返回
                </Button>
                <h2>人设</h2>
                <div className="vc-characters-header-actions">
                    {onClose ? (
                        <Button
                            type="button"
                            variant="text"
                            disabled={saveMutation.isPending}
                            onClick={onClose}
                        >
                            关闭
                        </Button>
                    ) : null}
                    <Button
                        type="submit"
                        variant="filled"
                        pending={saveMutation.isPending}
                        disabled={saveMutation.isPending}
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
                            disabled={saveMutation.isPending}
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
                onConfirm={handleConfirmDiscard}
            />

            {leaveGuardNode}
        </form>
    );
}
