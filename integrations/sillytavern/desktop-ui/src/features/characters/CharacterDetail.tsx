import { useEffect, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { AlertDialog } from '../../design/components/AlertDialog';
import { Button } from '../../design/components/Button';
import { Icon } from '../../design/components/Icon';
import { toast } from '../../design/components/Toast';
import { useSessionBridge } from '../../runtime/session-bridge';
import {
    useDeleteCharacter,
    type CharacterCardItem,
    type CharacterInstanceItem,
} from '../../data/queries/characters';
import { PersonaEditor } from './PersonaEditor';
import { InstanceDialog } from './InstanceDialog';

export interface CharacterDetailProps {
    card: CharacterCardItem;
    onClose: () => void;
    onDeleted?: (card: CharacterCardItem) => void;
}

function initialOf(name: string): string {
    const clean = String(name || '').replace(/[^\p{L}\p{N}]/gu, '');
    return [...clean][0] || '角';
}

export function CharacterDetail({ card, onClose, onDeleted }: CharacterDetailProps) {
    const navigate = useNavigate();
    const bridge = useSessionBridge();
    const deleteMutation = useDeleteCharacter();

    const [editingPersona, setEditingPersona] = useState(false);
    const [descExpanded, setDescExpanded] = useState(false);
    const [failedAvatarSrc, setFailedAvatarSrc] = useState('');
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [deleteError, setDeleteError] = useState('');
    const mountedRef = useRef(true);
    const openingRef = useRef(false);
    const openRequestRef = useRef(0);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            openRequestRef.current += 1;
            openingRef.current = false;
        };
    }, []);
    const [instanceDialogState, setInstanceDialogState] = useState<{
        open: boolean;
        mode: 'create' | 'rename';
        initialName: string;
        relationship: Record<string, any> | null;
    }>({
        open: false,
        mode: 'create',
        initialName: '',
        relationship: null,
    });

    useEffect(() => {
        setEditingPersona(false);
        setDescExpanded(false);
        setDeleteDialogOpen(false);
        setDeleteError('');
        openRequestRef.current += 1;
        openingRef.current = false;
    }, [card.characterRef, card.avatar]);

    const showAvatarImg = Boolean(
        card.avatarUrl && failedAvatarSrc !== card.avatarUrl,
    );

    const handleOpenInstance = async (inst: CharacterInstanceItem) => {
        if (openingRef.current) return;
        openingRef.current = true;
        const requestId = ++openRequestRef.current;
        try {
            const status =
                card.avatar && inst.file
                    ? await bridge.open({ avatar: card.avatar, file: inst.file })
                    : await bridge.open({
                          avatar: card.avatar,
                          relationshipId: inst.relationshipId,
                          chatIdentity: inst.chatIdentity || undefined,
                      });
            if (!mountedRef.current || requestId !== openRequestRef.current) return;
            const conversationKey = bridge.getSnapshot().key || inst.conversationKey;
            if (status === 'opened' && conversationKey) {
                await navigate({
                    to: '/chat/$conversationKey',
                    params: { conversationKey },
                });
            } else if (status === 'failed') {
                toast.show({ title: '聊天没有加载出来，请重试。', kind: 'error' });
            }
        } catch {
            if (mountedRef.current && requestId === openRequestRef.current) {
                toast.show({ title: '聊天没有加载出来，请重试。', kind: 'error' });
            }
        } finally {
            if (requestId === openRequestRef.current) {
                openingRef.current = false;
            }
        }
    };

    const handleConfirmDelete = async () => {
        if (deleteMutation.isPending) return;
        setDeleteError('');
        try {
            await deleteMutation.mutateAsync({
                avatar: card.avatar,
                deleteChats: true,
            });
            setDeleteDialogOpen(false);
            onDeleted?.(card);
        } catch (err: any) {
            setDeleteError(err?.message || '删除角色失败，请重试。');
        }
    };

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
                            onError={() => setFailedAvatarSrc(card.avatarUrl)}
                        />
                    ) : (
                        <span aria-hidden="true">{initialOf(card.name)}</span>
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
                        onClick={() =>
                            setInstanceDialogState({
                                open: true,
                                mode: 'create',
                                initialName: card.name,
                                relationship: null,
                            })
                        }
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
                        onClick={() => {
                            void navigate({
                                to: '/settings/tavern/$section',
                                params: { section: 'right-nav-panel' },
                                search: { character: card.avatar } as never,
                            });
                        }}
                    >
                        角色卡设置
                    </Button>
                    <Button
                        type="button"
                        variant="danger-soft"
                        disabled={deleteMutation.isPending}
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
                                    onClick={() => void handleOpenInstance(inst)}
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
                                        setInstanceDialogState({
                                            open: true,
                                            mode: 'rename',
                                            initialName: inst.name,
                                            relationship: inst.rawRelationship ?? {
                                                relationshipId: inst.relationshipId,
                                                characterRef: card.characterRef,
                                                companionName: inst.name,
                                            },
                                        })
                                    }
                                >
                                    改名
                                </Button>
                                <Button
                                    type="button"
                                    variant="text"
                                    onClick={() => {
                                        void navigate({
                                            to: '/settings/$category',
                                            params: { category: 'voice' },
                                            search: {
                                                relationshipId: inst.relationshipId,
                                            } as never,
                                        });
                                    }}
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
                onOpenChange={(open) =>
                    setInstanceDialogState((prev) => ({ ...prev, open }))
                }
                mode={instanceDialogState.mode}
                characterRef={card.characterRef}
                avatar={card.avatar}
                initialName={instanceDialogState.initialName}
                relationship={instanceDialogState.relationship}
            />

            <AlertDialog
                open={deleteDialogOpen}
                onOpenChange={(nextOpen) => {
                    if (!deleteMutation.isPending) {
                        setDeleteDialogOpen(nextOpen);
                    }
                }}
                title="删除角色？"
                description="删除后该角色卡将从列表中移除。"
                cancelLabel="取消"
                confirmLabel="确认删除"
                danger
                pending={deleteMutation.isPending}
                onConfirm={() => void handleConfirmDelete()}
            />
        </aside>
    );
}
