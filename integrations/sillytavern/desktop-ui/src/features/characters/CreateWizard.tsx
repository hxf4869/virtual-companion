import { Dialog } from '../../design/components/Dialog';
import { Button } from '../../design/components/Button';
import { Field } from '../../design/components/Field';
import { TextInput } from '../../design/components/TextInput';
import { Textarea } from '../../design/components/Textarea';
import type { CreatedInstanceResult } from '../../data/queries/characters';
import {
    GENDERS,
    STYLE_OPTIONS,
    WIZARD_RELATIONS,
    useCreateWizardState,
} from './useCharactersState';

export interface CreateWizardProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onOpenConversation: (conversationKey: string) => void | Promise<void>;
    onCreated?: (created: CreatedInstanceResult) => void;
}

export function CreateWizard({
    open,
    onOpenChange,
    onOpenConversation,
    onCreated,
}: CreateWizardProps) {
    const {
        step,
        totalSteps,
        name,
        setName,
        gender,
        setGender,
        relation,
        selectRelation,
        styles,
        toggleStyle,
        customPersonality,
        setCustomPersonality,
        userAddressAs,
        setUserAddressAs,
        scenario,
        setScenario,
        avoidTopicsText,
        setAvoidTopicsText,
        firstMes,
        setFirstMes,
        stepError,
        busy,
        hasImported,
        handleOpenChange,
        nextStep,
        prevStep,
        finish,
    } = useCreateWizardState({
        open,
        onOpenChange,
        onOpenConversation,
        onCreated,
    });

    return (
        <Dialog
            open={open}
            onOpenChange={handleOpenChange}
            title="新建角色"
            width={560}
            actions={
                <>
                    {step > 1 ? (
                        <Button
                            type="button"
                            variant="gray"
                            disabled={busy || hasImported}
                            onClick={prevStep}
                        >
                            上一步
                        </Button>
                    ) : (
                        <Button
                            type="button"
                            variant="gray"
                            disabled={busy}
                            onClick={() => handleOpenChange(false)}
                        >
                            取消
                        </Button>
                    )}
                    {step < totalSteps ? (
                        <Button
                            type="button"
                            variant="filled"
                            disabled={busy}
                            onClick={nextStep}
                        >
                            下一步
                        </Button>
                    ) : (
                        <Button
                            type="button"
                            variant="filled"
                            pending={busy}
                            disabled={busy}
                            onClick={() => void finish()}
                        >
                            开始聊天
                        </Button>
                    )}
                </>
            }
        >
            <div className="vc-create-wizard-body">
                <div className="vc-create-wizard-step-indicator">
                    {step} / {totalSteps}
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
                                onChange={(e) => setName(e.target.value)}
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
                                    onClick={() => selectRelation(rel)}
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
                                onChange={(e) =>
                                    setCustomPersonality(e.target.value)
                                }
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
                            onChange={(e) =>
                                setAvoidTopicsText(e.target.value)
                            }
                        />
                    </Field>
                ) : null}

                {step === 7 ? (
                    <Field label="第一句话">
                        <Textarea
                            id="vc-wizard-first-mes"
                            rows={4}
                            value={firstMes}
                            disabled={busy || hasImported}
                            onChange={(e) => setFirstMes(e.target.value)}
                        />
                    </Field>
                ) : null}
            </div>
        </Dialog>
    );
}
