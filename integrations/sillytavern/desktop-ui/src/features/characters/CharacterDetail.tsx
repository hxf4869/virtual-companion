import type { ReactNode } from 'react';
import { AlertDialog } from '../../design/components/AlertDialog';
import { Button } from '../../design/components/Button';
import { Icon } from '../../design/components/Icon';
import { toast } from '../../design/components/Toast';
import type { CharacterCardItem } from '../../data/queries/characters';
import { PersonaEditor } from './PersonaEditor';
import { InstanceDialog } from './InstanceDialog';
import {
    characterInitial,
    useCharacterDetailState,
} from './useCharactersState';

export interface CharacterDetailProps {
    card: CharacterCardItem;
    onClose: () => void;
    onDeleted: (card: CharacterCardItem) => void;
    onOpenConversation: (conversationKey: string) => void | Promise<void>;
    onEditCharacterCard: (avatar: string) => void | Promise<void>;
    onOpenVoiceSettings: (relationshipId: string) => void | Promise<void>;
    renderLeaveGuard: (dirty: boolean) => ReactNode;
}

export function CharacterDetail({
    card,
    onClose,
    onDeleted,
    onOpenConversation,
    onEditCharacterCard,
    onOpenVoiceSettings,
    renderLeaveGuard,
}: CharacterDetailProps) {
    const {
        editingPersona,
        setEditingPersona,
        descExpanded,
        setDescExpanded,
        showAvatarImg,
        markAvatarFailed,
        deleteDialogOpen,
        setDeleteDialogOpen,
        handleDeleteDialogOpenChange,
        deleteError,
        deletePending,
        confirmDelete,
        instanceDialogState,
        openCreateInstanceDialog,
        openRenameInstanceDialog,
        setInstanceDialogOpen,
        openInstance,
        editCharacterCard,
        openVoiceSettings,
    } = useCharacterDetailState({
        card,
        onDeleted,
        onOpenConversation,
        onEditCharacterCard,
        onOpenVoiceSettings,
        onOpenInstanceError: (message) =>
            toast.show({ title: message, kind: 'error' }),
    });

    if (editingPersona) {
        return (
            <aside className="vc-character-detail" aria-label="角色详情">
                <PersonaEditor
                    avatar={card.avatar}
                    characterRef={card.characterRef}
                    characterName={card.name}
                    fields={card.persona}
                    onBack={() => setEditingPersona(false)}
                    onClose={onClose}
                    onSaved={() => setEditingPersona(false)}
                    renderLeaveGuard={renderLeaveGuard}
                />
            </aside>
        );
    }

    return (
        <aside className="vc-character-detail" aria-label="角色详情">
            <div className="vc-character-detail-top">
                <Button type="button" variant="text" onClick={onClose}>
                    关闭
                </Button>
            </div>

            {deleteError ? (
                <p className="vc-character-inline-alert" role="alert">
                    {deleteError}
                </p>
            ) : null}

            <div className="vc-character-poster">
                <span className="vc-character-poster-avatar">
                    {showAvatarImg ? (
                        <img
                            src={card.avatarUrl}
                            alt=""
                            onError={markAvatarFailed}
                        />
                    ) : (
                        <span aria-hidden="true">
                            {characterInitial(card.name)}
                        </span>
                    )}
                </span>
                <h2>{card.name}</h2>
                {card.description ? (
                    <>
                        <p
                            className={`vc-character-poster-desc${descExpanded ? ' is-expanded' : ''}`}
                        >
                            {card.description}
                        </p>
                        {card.description.length > 90 ? (
                            <Button
                                type="button"
                                variant="text"
                                onClick={() => setDescExpanded((v) => !v)}
                            >
                                {descExpanded ? '收起' : '展开'}
                            </Button>
                        ) : null}
                    </>
                ) : null}

                <div className="vc-character-detail-actions">
                    <Button
                        type="button"
                        variant="filled"
                        onClick={openCreateInstanceDialog}
                    >
                        <Icon name="plus" size={16} />
                        <span>新建实例</span>
                    </Button>
                    <Button
                        type="button"
                        variant="gray"
                        onClick={() => setEditingPersona(true)}
                    >
                        人设
                    </Button>
                    <Button
                        type="button"
                        variant="gray"
                        data-action="edit-card"
                        onClick={editCharacterCard}
                    >
                        角色卡设置
                    </Button>
                    <Button
                        type="button"
                        variant="danger-soft"
                        disabled={deletePending}
                        onClick={() => setDeleteDialogOpen(true)}
                    >
                        删除角色
                    </Button>
                </div>
            </div>

            <section className="vc-character-instances-section">
                <div className="vc-character-instances-head">
                    <h3>实例</h3>
                </div>
                {card.instances.length > 0 ? (
                    <div className="vc-character-instance-list" role="list">
                        {card.instances.map((inst) => (
                            <div
                                key={inst.relationshipId}
                                role="listitem"
                                className="vc-character-instance-row"
                                data-relationship-id={inst.relationshipId}
                            >
                                <button
                                    type="button"
                                    className="vc-character-instance-open"
                                    onClick={() => void openInstance(inst)}
                                >
                                    <span className="vc-character-instance-name">
                                        {inst.label}
                                    </span>
                                    {inst.when ? (
                                        <time className="vc-character-instance-when">
                                            {inst.when}
                                        </time>
                                    ) : null}
                                </button>
                                <Button
                                    type="button"
                                    variant="text"
                                    onClick={() =>
                                        openRenameInstanceDialog(inst)
                                    }
                                >
                                    改名
                                </Button>
                                <Button
                                    type="button"
                                    variant="text"
                                    onClick={() => openVoiceSettings(inst)}
                                >
                                    声音
                                </Button>
                            </div>
                        ))}
                    </div>
                ) : (
                    <p className="vc-character-instance-when">
                        还没有陪伴实例，点击「新建实例」即可开始。
                    </p>
                )}
            </section>

            <InstanceDialog
                open={instanceDialogState.open}
                onOpenChange={setInstanceDialogOpen}
                mode={instanceDialogState.mode}
                characterRef={card.characterRef}
                avatar={card.avatar}
                initialName={instanceDialogState.initialName}
                relationship={instanceDialogState.relationship}
            />

            <AlertDialog
                open={deleteDialogOpen}
                onOpenChange={handleDeleteDialogOpenChange}
                title="删除角色？"
                description="删除后该角色卡将从列表中移除。"
                cancelLabel="取消"
                confirmLabel="确认删除"
                danger
                pending={deletePending}
                onConfirm={() => void confirmDelete()}
            />
        </aside>
    );
}
