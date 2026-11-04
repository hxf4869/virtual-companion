import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { z } from 'zod';
import { recalledItems } from '../../../../extension/vc-model-settings/chat-logic.js';
import { useAppClient } from '../../app/providers';
import { queryKeys } from '../../data/queryKeys';
import {
    useCompanionStateQuery,
    useFollowUpsQuery,
    useRelationshipMemoriesQuery,
    useRelationshipsQuery,
} from '../../data/queries/chat';
import { AlertDialog } from '../../design/components/AlertDialog';
import { Avatar } from '../../design/components/Avatar';
import { Button } from '../../design/components/Button';
import { Dialog } from '../../design/components/Dialog';
import { Icon } from '../../design/components/Icon';
import { toast } from '../../design/components/Toast';
import { useChatSnapshot } from '../../runtime/session-bridge';
import { useShellLayout } from '../../shell/AppShell';

const correctMemorySchema = z.object({
    summary: z.string().refine(val => val.trim().length > 0, {
        message: '请输入纠正内容',
    }),
});

type CorrectMemoryFormValues = z.infer<typeof correctMemorySchema>;

export function ChatCharacterPanel() {
    const client = useAppClient();
    const queryClient = useQueryClient();
    const navigate = useNavigate();
    const { setCharacterPanelOpen } = useShellLayout();

    const relationshipId = useChatSnapshot(s => s.relationshipId);
    const characterName = useChatSnapshot(s => s.characterName);
    const avatarUrl = useChatSnapshot(s => s.avatarUrl);
    const recalledPrompt = useChatSnapshot(s => s.recalledPrompt);

    const relationshipsQuery = useRelationshipsQuery();
    const companionStateQuery = useCompanionStateQuery(relationshipId);
    const followUpsQuery = useFollowUpsQuery(relationshipId);
    const memoriesQuery = useRelationshipMemoriesQuery(relationshipId);

    const [editingMemory, setEditingMemory] = useState<{
        id: string;
        summary: string;
        version: number;
    } | null>(null);
    const [editBusy, setEditBusy] = useState(false);
    const [editError, setEditError] = useState('');

    const memoryForm = useForm<CorrectMemoryFormValues>({
        defaultValues: { summary: '' },
    });
    const editDraft = memoryForm.watch('summary');

    const [deletingMemoryId, setDeletingMemoryId] = useState<string | null>(null);
    const [deleteBusy, setDeleteBusy] = useState(false);

    const relationship = useMemo(() => {
        if (!relationshipId || !Array.isArray(relationshipsQuery.data)) return null;
        return (
            relationshipsQuery.data.find(
                (r: any) => String(r.relationshipId) === String(relationshipId),
            ) ?? null
        );
    }, [relationshipId, relationshipsQuery.data]);

    const displayName =
        relationship?.displayName && relationship.displayName !== characterName
            ? String(relationship.displayName)
            : '';

    const mood = String((companionStateQuery.data as any)?.mood?.vibe ?? '');

    const recalled = useMemo(() => {
        const rawItems = Array.isArray((memoriesQuery.data as any)?.items)
            ? (memoriesQuery.data as any).items
            : Array.isArray(memoriesQuery.data)
              ? memoriesQuery.data
              : [];
        return recalledItems(rawItems, recalledPrompt).map((item: any) => ({
            id: String(item.memoryId),
            summary: String(item.summary || ''),
            version: Number(item.version ?? 1),
        }));
    }, [memoriesQuery.data, recalledPrompt]);

    const followups = useMemo(() => {
        const rawList = Array.isArray(followUpsQuery.data) ? followUpsQuery.data : [];
        return rawList
            .filter((row: any) => row.status !== 'CANCELLED')
            .map((row: any) => ({
                id: String(row.followUpId),
                body: String(row.body || ''),
                time: [row.eventDate, row.eventTime].filter(Boolean).join(' '),
            }));
    }, [followUpsQuery.data]);

    const handleOpenEdit = async (memoryId: string, fallbackSummary: string) => {
        setEditError('');
        try {
            const detail: any = await client.go.fetchMemory(memoryId);
            const summary = String(detail?.summary ?? fallbackSummary);
            const version = Number(detail?.version ?? 1);
            setEditingMemory({ id: memoryId, summary, version });
            memoryForm.reset({ summary });
        } catch {
            toast.show({ title: '没有完成，请重试。', kind: 'error' });
        }
    };

    const handleSaveEdit = memoryForm.handleSubmit(async values => {
        if (!editingMemory || editBusy) return;
        const parsed = correctMemorySchema.safeParse(values);
        if (!parsed.success || parsed.data.summary === editingMemory.summary) {
            return;
        }
        setEditBusy(true);
        setEditError('');
        try {
            await client.go.correctMemory(editingMemory.id, {
                summary: parsed.data.summary,
                expectedVersion: editingMemory.version,
            });
            if (relationshipId) {
                await queryClient.invalidateQueries({
                    queryKey: queryKeys.memory(relationshipId),
                });
            }
            setEditingMemory(null);
            toast.show({ title: '已保存', kind: 'success' });
        } catch (err: any) {
            setEditError(err?.message || '没有完成，请重试。');
        } finally {
            setEditBusy(false);
        }
    });

    const handleConfirmDelete = async () => {
        if (!deletingMemoryId || deleteBusy) return;
        setDeleteBusy(true);
        try {
            await client.go.forgetMemory(deletingMemoryId);
            if (relationshipId) {
                await queryClient.invalidateQueries({
                    queryKey: queryKeys.memory(relationshipId),
                });
            }
            setDeletingMemoryId(null);
        } catch {
            toast.show({ title: '没有完成，请重试。', kind: 'error' });
        } finally {
            setDeleteBusy(false);
        }
    };

    return (
        <div className="vc-desk-character" id="vc-desktop-character-panel">
            <button
                type="button"
                className="vc-icon-btn vc-desk-character-close"
                aria-label="关闭角色面板"
                onClick={() => setCharacterPanelOpen(false)}
            >
                <Icon name="close" size={18} />
            </button>

            <div className="vc-desk-character-identity">
                {characterName ? (
                    <>
                        <span className="vc-desk-character-avatar">
                            <Avatar src={avatarUrl} name={characterName} size={64} />
                        </span>
                        <h1>{characterName}</h1>
                        {displayName ? <p className="vc-meta">{displayName}</p> : null}
                        {mood ? <p className="vc-desk-character-mood">{mood}</p> : null}
                    </>
                ) : null}
            </div>

            {characterName ? (
                <div className="vc-desk-character-actions">
                    <div>
                        <button
                            type="button"
                            className="vc-icon-btn vc-circle"
                            aria-label="声音"
                            onClick={() => {
                                void navigate({
                                    to: '/settings/$category',
                                    params: { category: 'voice' },
                                });
                            }}
                        >
                            <Icon name="volume-2" size={20} />
                        </button>
                        <span>声音</span>
                    </div>
                    <div>
                        <button
                            type="button"
                            className="vc-icon-btn vc-circle"
                            aria-label="记忆"
                            onClick={() => {
                                void navigate({ to: '/memory' });
                            }}
                        >
                            <Icon name="brain" size={20} />
                        </button>
                        <span>记忆</span>
                    </div>
                    <div>
                        <button
                            type="button"
                            className="vc-icon-btn vc-circle"
                            aria-label="设置"
                            onClick={() => {
                                void navigate({ to: '/characters' });
                            }}
                        >
                            <Icon name="settings" size={20} />
                        </button>
                        <span>设置</span>
                    </div>
                </div>
            ) : null}

            <section className="vc-desk-character-section" hidden={recalled.length === 0}>
                {recalled.length > 0 ? (
                    <>
                        <h2>本次想起</h2>
                        {recalled.map(row => (
                            <article
                                key={row.id}
                                className="vc-desk-recalled"
                                data-memory-id={row.id}
                            >
                                <p>{row.summary}</p>
                                <div className="vc-desk-recalled-actions">
                                    <Button
                                        type="button"
                                        variant="text"
                                        onClick={() => void handleOpenEdit(row.id, row.summary)}
                                    >
                                        纠正
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="danger-soft"
                                        onClick={() => setDeletingMemoryId(row.id)}
                                    >
                                        删除
                                    </Button>
                                </div>
                            </article>
                        ))}
                    </>
                ) : null}
            </section>

            <section className="vc-desk-character-section" hidden={followups.length === 0}>
                {followups.length > 0 ? (
                    <>
                        <h2>跟进</h2>
                        {followups.map(row => (
                            <article key={row.id} className="vc-desk-recalled">
                                <p>{row.body}</p>
                                {row.time ? <time className="vc-meta">{row.time}</time> : null}
                            </article>
                        ))}
                    </>
                ) : null}
            </section>

            <Dialog
                open={Boolean(editingMemory)}
                onOpenChange={nextOpen => {
                    if (!nextOpen && !editBusy) {
                        setEditingMemory(null);
                    }
                }}
                title="纠正记忆"
                width={420}
                actions={
                    <>
                        <Button
                            type="button"
                            variant="gray"
                            disabled={editBusy}
                            onClick={() => setEditingMemory(null)}
                        >
                            取消
                        </Button>
                        <Button
                            type="button"
                            variant="filled"
                            pending={editBusy}
                            disabled={
                                editBusy ||
                                !editDraft.trim() ||
                                editDraft === editingMemory?.summary
                            }
                            onClick={() => void handleSaveEdit()}
                        >
                            保存
                        </Button>
                    </>
                }
            >
                <div className="vc-desk-memory-editor">
                    <label htmlFor="vc-desk-recall-draft">纠正记忆</label>
                    <textarea
                        id="vc-desk-recall-draft"
                        className="vc-input"
                        rows={4}
                        disabled={editBusy}
                        {...memoryForm.register('summary')}
                    />
                    {editError ? (
                        <p className="vc-desk-error" role="alert">
                            {editError}
                        </p>
                    ) : null}
                </div>
            </Dialog>

            <AlertDialog
                open={Boolean(deletingMemoryId)}
                onOpenChange={nextOpen => {
                    if (!nextOpen && !deleteBusy) {
                        setDeletingMemoryId(null);
                    }
                }}
                title="删除这条记忆？"
                description="删除后不会再被想起，也无法恢复。"
                confirmLabel="删除"
                cancelLabel="取消"
                danger
                pending={deleteBusy}
                onConfirm={() => void handleConfirmDelete()}
            />
        </div>
    );
}
