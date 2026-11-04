import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
    avatarUrl,
    chatSnapshotsFromRecent,
    clockText,
    parseSendDate,
} from '../../../../extension/vc-model-settings/chat-logic.js';
import { listFollowUps } from '../../../../extension/vc-model-settings/inbox-client.js';
import { useAppClient } from '../../app/providers';
import { queryKeys } from '../queryKeys';

export interface ConversationRow {
    key: string;
    avatar: string;
    file: string;
    avatarUrl: string;
    title: string;
    instanceName?: string;
    preview: string;
    updatedAt: number;
    timeText?: string;
    relationshipId?: string;
    conversationId?: string;
    characterRef?: string;
    mode?: string;
    unread?: boolean;
    draft?: string;
}

export function normalizeConversationKey(avatar: string, file: string): string {
    return JSON.stringify([
        String(avatar || ''),
        String(file || '').replace(/\.jsonl$/i, ''),
    ]);
}

export function parseConversationKey(key: string): { avatar: string; file: string } | null {
    try {
        const parsed = JSON.parse(key);
        if (
            Array.isArray(parsed) &&
            typeof parsed[0] === 'string' &&
            typeof parsed[1] === 'string'
        ) {
            return {
                avatar: parsed[0],
                file: parsed[1].replace(/\.jsonl$/i, ''),
            };
        }
    } catch {
        /* invalid key */
    }
    return null;
}

export function buildConversationRows(
    recentRaw: unknown,
    relationshipsRaw: unknown,
    charactersRaw: unknown,
    readDraft?: (key: string) => string,
): ConversationRow[] {
    const snaps: any[] = chatSnapshotsFromRecent(Array.isArray(recentRaw) ? recentRaw : []);
    const characters = Array.isArray(charactersRaw) ? charactersRaw : [];
    const relMap = new Map<string, any>();
    for (const rel of Array.isArray(relationshipsRaw) ? relationshipsRaw : []) {
        if (rel?.relationshipId != null) {
            relMap.set(String(rel.relationshipId), rel);
        }
    }

    const rows: ConversationRow[] = [];
    const seenKeys = new Set<string>();

    for (const snap of snaps) {
        const card = characters.find(
            (c: any) =>
                (snap.avatar && c.avatar === snap.avatar) ||
                (snap.characterRef && c.data?.extensions?.vc_character_ref === snap.characterRef),
        );
        const rawAvatar = String(snap.avatar || card?.avatar || '');
        const rawFile = String(snap.file || '').replace(/\.jsonl$/i, '');
        if (!rawAvatar || !rawFile) continue;

        const key = normalizeConversationKey(rawAvatar, rawFile);
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);

        const rel = snap.relationshipId ? relMap.get(String(snap.relationshipId)) : undefined;
        const title = card?.name || rel?.displayName || rawAvatar.replace(/\.png$/i, '');
        const parsedMs = parseSendDate(snap.time);
        const updatedAt = parsedMs !== null ? parsedMs : 0;
        const timeText = parsedMs !== null ? clockText(parsedMs) : undefined;
        const draft = readDraft ? readDraft(key) : '';

        rows.push({
            key,
            avatar: rawAvatar,
            file: rawFile,
            avatarUrl: avatarUrl(rawAvatar),
            title,
            instanceName:
                rel?.displayName && rel.displayName !== title ? rel.displayName : undefined,
            preview: snap.preview || '暂无消息',
            updatedAt,
            timeText,
            relationshipId: snap.relationshipId ? String(snap.relationshipId) : undefined,
            conversationId: rel?.conversationId ? String(rel.conversationId) : undefined,
            characterRef: snap.characterRef || card?.data?.extensions?.vc_character_ref,
            mode: rel?.mode || 'COMPANION',
            draft: draft || undefined,
        });
    }

    return rows;
}

export function useRecentChatsQuery() {
    const client = useAppClient();
    return useQuery({
        queryKey: queryKeys.recentChats,
        queryFn: () =>
            typeof client?.recent === 'function' ? client.recent() : Promise.resolve([]),
    });
}

export function useCharactersQuery() {
    const client = useAppClient();
    return useQuery({
        queryKey: queryKeys.characters,
        queryFn: () =>
            typeof client?.characters === 'function'
                ? client.characters()
                : Promise.resolve([]),
    });
}

export function useRelationshipsQuery() {
    const client = useAppClient();
    return useQuery({
        queryKey: queryKeys.relationships,
        queryFn: () =>
            typeof client?.go?.fetchRelationships === 'function'
                ? client.go.fetchRelationships()
                : Promise.resolve([]),
    });
}

export function useConversationsQuery(readDraft?: (key: string) => string) {
    const recentQuery = useRecentChatsQuery();
    const charactersQuery = useCharactersQuery();
    const relationshipsQuery = useRelationshipsQuery();

    const rows = useMemo(
        () =>
            buildConversationRows(
                recentQuery.data,
                relationshipsQuery.data,
                charactersQuery.data,
                readDraft,
            ),
        [recentQuery.data, relationshipsQuery.data, charactersQuery.data, readDraft],
    );

    return {
        rows,
        isLoading:
            recentQuery.isLoading ||
            charactersQuery.isLoading ||
            relationshipsQuery.isLoading,
        isError:
            recentQuery.isError ||
            charactersQuery.isError ||
            relationshipsQuery.isError,
        error:
            recentQuery.error ??
            charactersQuery.error ??
            relationshipsQuery.error ??
            null,
        refetch: async () => {
            await Promise.all([
                recentQuery.refetch(),
                charactersQuery.refetch(),
                relationshipsQuery.refetch(),
            ]);
        },
    };
}

export function useCompanionStateQuery(relationshipId?: string) {
    const client = useAppClient();
    const relId = relationshipId ? String(relationshipId) : '';
    return useQuery({
        queryKey: ['companionState', relId] as const,
        enabled: Boolean(relId),
        queryFn: () =>
            typeof client?.go?.storyRequest === 'function'
                ? client.go.storyRequest('GET', `/api/v1/relationships/${relId}/companion-state`)
                : Promise.resolve(null),
    });
}

export function useFollowUpsQuery(relationshipId?: string) {
    const client = useAppClient();
    const relId = relationshipId ? String(relationshipId) : '';
    return useQuery({
        queryKey: queryKeys.followUps(relId),
        enabled: Boolean(relId),
        queryFn: () =>
            typeof client?.go?.storyRequest === 'function'
                ? listFollowUps(relId)
                : Promise.resolve([]),
    });
}

export function useRelationshipMemoriesQuery(relationshipId?: string) {
    const client = useAppClient();
    const relId = relationshipId ? String(relationshipId) : '';
    return useQuery({
        queryKey: queryKeys.memory(relId),
        enabled: Boolean(relId),
        queryFn: () =>
            typeof client?.go?.fetchMemories === 'function'
                ? client.go.fetchMemories(relId)
                : Promise.resolve([]),
    });
}
