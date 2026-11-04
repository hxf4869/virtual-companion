import { useEffect, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Dialog } from '../../design/components/Dialog';
import { Button } from '../../design/components/Button';
import { Field } from '../../design/components/Field';
import { TextInput } from '../../design/components/TextInput';
import { Textarea } from '../../design/components/Textarea';
import { useSessionBridge } from '../../runtime/session-bridge';
import {
    useCreateInstance,
    useImportCharacter,
    type CreatedInstanceResult,
} from '../../data/queries/characters';
import {
    GENDERS,
    RELATION_COPY,
    STYLE_OPTIONS,
    buildCharacterCard,
    sanitizeInstanceName,
} from '../../../../extension/vc-model-settings/instance-logic.js';

export interface CreateWizardProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onCreated?: (created: CreatedInstanceResult) => void;
}

const WIZARD_RELATIONS = ['好朋友', '恋人', '倾听者', '家人', '搭档', '前任'] as const;
const TOTAL_STEPS = 7;

export function CreateWizard({ open, onOpenChange, onCreated }: CreateWizardProps) {
    const navigate = useNavigate();
    const bridge = useSessionBridge();
    const importMutation = useImportCharacter();
    const createInstanceMutation = useCreateInstance();

    const [step, setStep] = useState(1);
    const [name, setName] = useState('');
    const [gender, setGender] = useState<string>('女生');
    const [relation, setRelation] = useState<string>('好朋友');
    const [styles, setStyles] = useState<string[]>([
        '口语短句，偶尔表情',
        '好奇你的生活',
    ]);
    const [customPersonality, setCustomPersonality] = useState('');
    const [userAddressAs, setUserAddressAs] = useState('');
    const [scenario, setScenario] = useState('');
    const [avoidTopicsText, setAvoidTopicsText] = useState('');
    const [firstMes, setFirstMes] = useState<string>(
        RELATION_COPY['好朋友']?.first || '',
    );
    const [firstMesCustomized, setFirstMesCustomized] = useState(false);
    const [stepError, setStepError] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const mountedRef = useRef(true);
    const openRef = useRef(open);
    openRef.current = open;
    const submitEpochRef = useRef(0);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            submitEpochRef.current += 1;
        };
    }, []);

    useEffect(() => {
        if (!open) {
            submitEpochRef.current += 1;
        }
    }, [open]);

    const busy = submitting || importMutation.isPending || createInstanceMutation.isPending;

    const resetWizard = () => {
        submitEpochRef.current += 1;
        setStep(1);
        setName('');
        setGender('女生');
        setRelation('好朋友');
        setStyles(['口语短句，偶尔表情', '好奇你的生活']);
        setCustomPersonality('');
        setUserAddressAs('');
        setScenario('');
        setAvoidTopicsText('');
        setFirstMes(RELATION_COPY['好朋友']?.first || '');
        setFirstMesCustomized(false);
        setStepError('');
    };

    const handleDialogOpenChange = (nextOpen: boolean) => {
        if (busy) return;
        if (!nextOpen) {
            resetWizard();
        }
        onOpenChange(nextOpen);
    };

    const handleRelationSelect = (nextRel: string) => {
        setRelation(nextRel);
        if (!firstMesCustomized) {
            const copy = (RELATION_COPY as Record<string, { first: string }>)[nextRel];
            if (copy?.first) {
                setFirstMes(copy.first);
            }
        }
    };

    const toggleStyle = (option: string) => {
        setStyles((prev) =>
            prev.includes(option)
                ? prev.filter((item) => item !== option)
                : [...prev, option],
        );
    };

    const handleNextStep = () => {
        if (busy) return;
        if (step === 1) {
            const clean = sanitizeInstanceName(name);
            if (!clean.ok) {
                setStepError(String(clean.reason || ''));
                return;
            }
        }
        setStepError('');
        setStep((prev) => Math.min(TOTAL_STEPS, prev + 1));
    };

    const handlePrevStep = () => {
        if (busy || step <= 1) return;
        setStepError('');
        setStep((prev) => Math.max(1, prev - 1));
    };

    const handleFinish = async () => {
        if (busy) return;
        const clean = sanitizeInstanceName(name);
        if (!clean.ok) {
            setStepError(String(clean.reason || ''));
            setStep(1);
            return;
        }
        const cleanName = String(clean.value || '');
        const ticket = ++submitEpochRef.current;
        const isAlive = () =>
            mountedRef.current && openRef.current && submitEpochRef.current === ticket;
        setSubmitting(true);
        setStepError('');
        try {
            const cardPayload = buildCharacterCard({
                name: cleanName,
                relation,
                gender,
                styles,
                customPersonality,
                scenario,
                first_mes: firstMes,
                userAddressAs,
                avoidTopicsText,
            });
            const bytes = new TextEncoder().encode(JSON.stringify(cardPayload));
            const imported = await importMutation.mutateAsync({
                name: `${cleanName}.json`,
                bytes,
            });
            if (!isAlive()) return;
            const created = await createInstanceMutation.mutateAsync({
                characterRef: imported.characterRef,
                avatar: imported.avatar,
                displayName: cleanName,
                mode: 'COMPANION',
            });
            if (!isAlive()) return;
            if (!created.avatar || !created.file) {
                setStepError('聊天没有加载出来，请重试。');
                return;
            }
            const openStatus = await bridge.open({
                avatar: created.avatar,
                file: created.file,
            });
            if (!isAlive()) return;
            if (openStatus === 'failed') {
                setStepError('聊天没有加载出来，请重试。');
                return;
            }
            if (openStatus !== 'opened') {
                return;
            }
            onCreated?.(created);
            resetWizard();
            onOpenChange(false);
            if (created.conversationKey) {
                await navigate({
                    to: '/chat/$conversationKey',
                    params: { conversationKey: created.conversationKey },
                });
            }
        } catch (err: any) {
            if (isAlive()) {
                setStepError(err?.message || '没有完成，请重试。');
            }
        } finally {
            if (mountedRef.current) {
                setSubmitting(false);
            }
        }
    };

    return (
        <Dialog
            open={open}
            onOpenChange={handleDialogOpenChange}
            title="新建角色"
            width={560}
            actions={
                <>
                    {step > 1 ? (
                        <Button
                            type="button"
                            variant="gray"
                            disabled={busy}
                            onClick={handlePrevStep}
                        >
                            上一步
                        </Button>
                    ) : (
                        <Button
                            type="button"
                            variant="gray"
                            disabled={busy}
                            onClick={() => handleDialogOpenChange(false)}
                        >
                            取消
                        </Button>
                    )}
                    {step < TOTAL_STEPS ? (
                        <Button
                            type="button"
                            variant="filled"
                            disabled={busy}
                            onClick={handleNextStep}
                        >
                            下一步
                        </Button>
                    ) : (
                        <Button
                            type="button"
                            variant="filled"
                            pending={busy}
                            disabled={busy}
                            onClick={() => void handleFinish()}
                        >
                            开始聊天
                        </Button>
                    )}
                </>
            }
        >
            <div className="vc-create-wizard-body">
                <div className="vc-create-wizard-step-indicator">
                    {step} / {TOTAL_STEPS}
                </div>

                {stepError ? (
                    <p className="vc-character-inline-alert" role="alert">
                        {stepError}
                    </p>
                ) : null}

                {step === 1 ? (
                    <>
                        <Field label="她的名字">
                            <TextInput
                                id="vc-wizard-name"
                                value={name}
                                maxLength={32}
                                placeholder="比如：林小夏"
                                disabled={busy}
                                onChange={(e) => {
                                    setName(e.target.value);
                                    if (stepError) setStepError('');
                                }}
                            />
                        </Field>
                        <div className="vc-field">
                            <span className="vc-field-label">性别</span>
                            <div
                                className="vc-create-wizard-chips"
                                role="group"
                                aria-label="性别"
                            >
                                {GENDERS.map((g) => (
                                    <button
                                        key={g}
                                        type="button"
                                        className="vc-create-wizard-chip"
                                        aria-pressed={gender === g}
                                        disabled={busy}
                                        onClick={() => setGender(g)}
                                    >
                                        {g}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </>
                ) : null}

                {step === 2 ? (
                    <div className="vc-field">
                        <span className="vc-field-label">和你是</span>
                        <div
                            className="vc-create-wizard-chips"
                            role="group"
                            aria-label="和你是"
                        >
                            {WIZARD_RELATIONS.map((rel) => (
                                <button
                                    key={rel}
                                    type="button"
                                    className="vc-create-wizard-chip"
                                    aria-pressed={relation === rel}
                                    disabled={busy}
                                    onClick={() => handleRelationSelect(rel)}
                                >
                                    {rel}
                                </button>
                            ))}
                        </div>
                    </div>
                ) : null}

                {step === 3 ? (
                    <>
                        <div className="vc-field">
                            <span className="vc-field-label">说话方式（可多选）</span>
                            <div
                                className="vc-create-wizard-chips"
                                role="group"
                                aria-label="说话方式"
                            >
                                {STYLE_OPTIONS.map((opt) => (
                                    <button
                                        key={opt}
                                        type="button"
                                        className="vc-create-wizard-chip"
                                        aria-pressed={styles.includes(opt)}
                                        disabled={busy}
                                        onClick={() => toggleStyle(opt)}
                                    >
                                        {opt}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <Field label="补充性格（选填）">
                            <Textarea
                                id="vc-wizard-personality"
                                rows={3}
                                value={customPersonality}
                                disabled={busy}
                                onChange={(e) => setCustomPersonality(e.target.value)}
                            />
                        </Field>
                    </>
                ) : null}

                {step === 4 ? (
                    <Field label="怎么称呼你">
                        <TextInput
                            id="vc-wizard-address"
                            value={userAddressAs}
                            placeholder="比如：名字、昵称"
                            disabled={busy}
                            onChange={(e) => setUserAddressAs(e.target.value)}
                        />
                    </Field>
                ) : null}

                {step === 5 ? (
                    <Field label="两个人的背景（选填）">
                        <Textarea
                            id="vc-wizard-scenario"
                            rows={4}
                            value={scenario}
                            disabled={busy}
                            onChange={(e) => setScenario(e.target.value)}
                        />
                    </Field>
                ) : null}

                {step === 6 ? (
                    <Field label="别提的话题（选填）">
                        <Textarea
                            id="vc-wizard-avoid"
                            rows={3}
                            value={avoidTopicsText}
                            disabled={busy}
                            onChange={(e) => setAvoidTopicsText(e.target.value)}
                        />
                    </Field>
                ) : null}

                {step === 7 ? (
                    <Field label="第一句话">
                        <Textarea
                            id="vc-wizard-first-mes"
                            rows={4}
                            value={firstMes}
                            disabled={busy}
                            onChange={(e) => {
                                setFirstMes(e.target.value);
                                setFirstMesCustomized(true);
                            }}
                        />
                    </Field>
                ) : null}
            </div>
        </Dialog>
    );
}
