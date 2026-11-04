import { useMemo, useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppClient } from '../../app/providers';
import { useSessionBridge } from '../../runtime/session-bridge';
import { queryKeys } from '../queryKeys';
import { normalizeConversationKey } from './chat';
import { chatSnapshotsFromRecent } from '../../../../extension/vc-model-settings/chat-logic.js';
import {
    IMPORT_FAILED_COPY,
    characterAvatarSrc,
    characterModel,
    formatWhen,
    inspectCharacterFile,
    instanceLabel,
    prefsBody,
    sanitizeInstanceName,
} from '../../../../extension/vc-model-settings/instance-logic.js';
import {
    ensureCharacterReferences,
    importDesktopCharacter,
} from '../../../../extension/vc-model-settings/desktop/standalone/business.js';

export interface PersonaFields {
    description: string;
    personality: string;
    scenario: string;
    first_mes: string;
    mes_example: string;
}

export interface CharacterInstanceItem {
    relationshipId: string;
    characterRef: string;
    name: string;
    label: string;
    when: string;
    lastAt: string;
    chatIdentity: string;
    file: string;
    conversationKey: string;
    rawRelationship?: Record<string, any>;
}

export interface CharacterCardItem {
    characterRef: string;
    avatar: string;
    avatarUrl: string;
    name: string;
    description: string;
    worldName: string;
    persona: PersonaFields;
    instances: CharacterInstanceItem[];
}

export interface CharactersData {
    cards: CharacterCardItem[];
    loose: CharacterInstanceItem[];
    instances: CharacterInstanceItem[];
    relationships: any[];
    rawCharacters: any[];
    isLoading: boolean;
    isError: boolean;
    error: unknown;
    refetch: () => Promise<void>;
}

function readPersonaFromCard(rawCard: any): PersonaFields {
    const readField = (key: keyof PersonaFields): string => {
        if (typeof rawCard?.[key] === 'string') return rawCard[key];
        if (typeof rawCard?.data?.[key] === 'string') return rawCard.data[key];
        return '';
    };
    return {
        description: readField('description'),
        personality: readField('personality'),
        scenario: readField('scenario'),
        first_mes: readField('first_mes'),
        mes_example: readField('mes_example'),
    };
}

export function useCharacters(): CharactersData {
    const client = useAppClient();

    const charactersQuery = useQuery({
        queryKey: queryKeys.characters,
        queryFn: async () => {
            const raw = await client.characters();
            const list = Array.isArray(raw) ? raw : [];
            await ensureCharacterReferences(client, { characters: list });
            return list;
        },
    });

    const relationshipsQuery = useQuery({
        queryKey: queryKeys.relationships,
        queryFn: async () => {
            const raw = await client.go.fetchRelationships();
            return Array.isArray(raw) ? raw : [];
        },
    });

    const recentQuery = useQuery({
        queryKey: queryKeys.recentChats,
        queryFn: async () => {
            const raw = await client.recent();
            return Array.isArray(raw) ? raw : [];
        },
    });

    const computed = useMemo(() => {
        const rawChars = Array.isArray(charactersQuery.data) ? charactersQuery.data : [];
        const rawRels = Array.isArray(relationshipsQuery.data) ? relationshipsQuery.data : [];
        const rawRecents = Array.isArray(recentQuery.data) ? recentQuery.data : [];

        const rawCardByRef = new Map<string, any>();
        const rawCardByAvatar = new Map<string, any>();
        const normalizedCards = rawChars.filter(Boolean).map((card: any) => {
            const ref =
                typeof card?.data?.extensions?.vc_character_ref === 'string'
                    ? card.data.extensions.vc_character_ref.trim()
                    : '';
            const avatar = typeof card?.avatar === 'string' ? card.avatar : '';
            if (ref) rawCardByRef.set(ref, card);
            if (avatar) rawCardByAvatar.set(avatar, card);
            const book = card?.data?.character_book?.name;
            const world = card?.data?.extensions?.world;
            return {
                characterRef: ref,
                avatar,
                name: card?.name || '未命名角色卡',
                description:
                    typeof card?.description === 'string'
                        ? card.description
                        : typeof card?.data?.description === 'string'
                          ? card.data.description
                          : '',
                worldName:
                    typeof book === 'string' ? book : typeof world === 'string' ? world : '',
            };
        });

        const rawSnapshots = chatSnapshotsFromRecent(rawRecents);
        const snapshots = rawSnapshots.map((snap: any) => {
            const av = typeof snap?.avatar === 'string' ? snap.avatar : '';
            const matchedCard = av ? rawCardByAvatar.get(av) : null;
            const cardRef =
                typeof matchedCard?.data?.extensions?.vc_character_ref === 'string'
                    ? matchedCard.data.extensions.vc_character_ref.trim()
                    : '';
            return {
                ...snap,
                characterRef: String(snap?.characterRef || cardRef || '').trim(),
            };
        });

        const snapshotByRelId = new Map<string, any>();
        for (const snap of snapshots) {
            const relId = snap?.relationshipId ? String(snap.relationshipId) : '';
            if (relId && !snapshotByRelId.has(relId)) {
                snapshotByRelId.set(relId, snap);
            }
        }

        const relById = new Map<string, any>();
        for (const rel of rawRels) {
            if (rel?.relationshipId != null) {
                relById.set(String(rel.relationshipId), rel);
            }
        }

        const model = characterModel({
            cards: normalizedCards,
            relationships: rawRels,
            bindings: snapshots,
        });

        const mapInstanceList = (
            items: any[],
            cardAvatar: string,
        ): CharacterInstanceItem[] => {
            return items.map((item: any) => {
                const relId = String(item.relationshipId ?? '');
                const rawRel = relById.get(relId);
                const snap = relId ? snapshotByRelId.get(relId) : undefined;
                const file = String(snap?.file ?? '')
                    .replace(/\.jsonl$/i, '')
                    .trim();
                const chatIdentity = String(
                    item.chatIdentity || snap?.chatIdentity || '',
                ).trim();
                const resolvedAvatar = String(cardAvatar || snap?.avatar || '').trim();
                const lastAt = String(item.lastAt || snap?.time || '');
                const conversationKey =
                    resolvedAvatar && file
                        ? normalizeConversationKey(resolvedAvatar, file)
                        : '';
                return {
                    relationshipId: relId,
                    characterRef: String(item.characterRef ?? ''),
                    name: String(item.name ?? '未命名实例'),
                    label: instanceLabel(item, items),
                    when: formatWhen(lastAt),
                    lastAt,
                    chatIdentity,
                    file,
                    conversationKey,
                    rawRelationship: rawRel,
                };
            });
        };

        const cards: CharacterCardItem[] = model.cards.map((card: any) => {
            const rawCard =
                (card.characterRef && rawCardByRef.get(card.characterRef)) ||
                (card.avatar && rawCardByAvatar.get(card.avatar)) ||
                {};
            const rawAvatar = typeof card.avatar === 'string' ? card.avatar : '';
            return {
                characterRef: String(card.characterRef || ''),
                avatar: rawAvatar,
                avatarUrl: characterAvatarSrc(rawAvatar),
                name: String(card.name || '未命名角色卡'),
                description: String(card.description || ''),
                worldName: String(card.worldName || ''),
                persona: readPersonaFromCard(rawCard),
                instances: mapInstanceList(card.instances || [], rawAvatar),
            };
        });

        const loose = mapInstanceList(model.loose || [], '');
        const allInstances = cards.flatMap((c) => c.instances).concat(loose);

        return {
            cards,
            loose,
            instances: allInstances,
            relationships: rawRels,
            rawCharacters: rawChars,
        };
    }, [charactersQuery.data, relationshipsQuery.data, recentQuery.data]);

    const refetch = useCallback(async () => {
        await Promise.all([
            charactersQuery.refetch(),
            relationshipsQuery.refetch(),
            recentQuery.refetch(),
        ]);
    }, [charactersQuery, relationshipsQuery, recentQuery]);

    return {
        ...computed,
        isLoading:
            charactersQuery.isLoading ||
            relationshipsQuery.isLoading ||
            recentQuery.isLoading,
        isError:
            charactersQuery.isError || relationshipsQuery.isError || recentQuery.isError,
        error:
            charactersQuery.error ?? relationshipsQuery.error ?? recentQuery.error ?? null,
        refetch,
    };
}

export interface ImportCharacterInput {
    name: string;
    bytes: Uint8Array;
}

export interface ImportedCharacterResult {
    avatar: string;
    characterRef: string;
    name: string;
    description: string;
    worldName: string;
}

export function useImportCharacter() {
    const client = useAppClient();
    const bridge = useSessionBridge();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({
            name,
            bytes,
        }: ImportCharacterInput): Promise<ImportedCharacterResult> => {
            const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
            const inspected = inspectCharacterFile(data, name);
            if (!inspected.ok) {
                throw new Error(IMPORT_FAILED_COPY);
            }
            const ctxHolder: { characters: any[]; characterId: number } = {
                characters: [],
                characterId: -1,
            };
            const imported = await importDesktopCharacter(client, ctxHolder, {
                name,
                bytes: data,
                format: inspected.format,
            });
            const matchedCard =
                ctxHolder.characters.find(
                    (c: any) =>
                        c?.data?.extensions?.vc_character_ref === imported.characterRef,
                ) || ctxHolder.characters.at(-1);
            const avatar = String(matchedCard?.avatar || '');
            if (avatar) {
                await bridge.reloadCharacter(avatar);
            }
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: queryKeys.characters }),
                queryClient.invalidateQueries({ queryKey: queryKeys.relationships }),
                queryClient.invalidateQueries({ queryKey: queryKeys.recentChats }),
            ]);
            return {
                avatar,
                characterRef: String(imported.characterRef || ''),
                name: String(imported.name || '未命名角色卡'),
                description: String(imported.description || ''),
                worldName: String(imported.worldName || ''),
            };
        },
    });
}

export interface CreateInstanceInput {
    characterRef: string;
    avatar?: string;
    displayName: string;
    chatIdentity?: string;
    mode?: string;
}

export interface CreatedInstanceResult {
    relationshipId: string;
    conversationId: string;
    mode: string;
    avatar: string;
    file: string;
    chatIdentity: string;
    characterRef: string;
    name: string;
    conversationKey: string;
}

export function useCreateInstance() {
    const bridge = useSessionBridge();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({
            characterRef,
            avatar = '',
            displayName,
            chatIdentity,
            mode = 'COMPANION',
        }: CreateInstanceInput): Promise<CreatedInstanceResult> => {
            const clean = sanitizeInstanceName(displayName);
            if (!clean.ok) {
                throw Object.assign(new Error(String(clean.reason || '')), {
                    code: 'INVALID_NAME',
                });
            }
            const cleanName = String(clean.value || '');
            const identity = chatIdentity || crypto.randomUUID();
            const created = await bridge.createConversation({
                characterRef,
                displayName: cleanName,
                chatIdentity: identity,
                mode,
            });
            const resolvedAvatar = String(created?.avatar || avatar || '');
            const resolvedFile = String(created?.file ?? '')
                .replace(/\.jsonl$/i, '')
                .trim();
            const conversationKey =
                resolvedAvatar && resolvedFile
                    ? normalizeConversationKey(resolvedAvatar, resolvedFile)
                    : '';

            await Promise.all([
                queryClient.invalidateQueries({ queryKey: queryKeys.characters }),
                queryClient.invalidateQueries({ queryKey: queryKeys.relationships }),
                queryClient.invalidateQueries({ queryKey: queryKeys.recentChats }),
            ]);

            return {
                relationshipId: String(created?.relationshipId ?? ''),
                conversationId: String(created?.conversationId ?? ''),
                mode: String(created?.mode ?? mode),
                avatar: resolvedAvatar,
                file: resolvedFile,
                chatIdentity: String(created?.chatIdentity ?? identity),
                characterRef,
                name: cleanName,
                conversationKey,
            };
        },
    });
}

export interface RenameInstanceInput {
    relationship: Record<string, any>;
    name: string;
}

export function useRenameInstance() {
    const client = useAppClient();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ relationship, name }: RenameInstanceInput) => {
            const clean = sanitizeInstanceName(name);
            if (!clean.ok) {
                throw Object.assign(new Error(String(clean.reason || '')), {
                    code: 'INVALID_NAME',
                });
            }
            const cleanName = String(clean.value || '');
            const id = String(relationship?.relationshipId ?? '');
            if (!id) {
                throw new Error('名称尚未保存');
            }
            const body = prefsBody(relationship, cleanName) ?? {
                companionName: cleanName,
                userAddressAs:
                    typeof relationship?.userAddressAs === 'string'
                        ? relationship.userAddressAs
                        : '',
                replyLength: relationship?.replyLength || 'MEDIUM',
                initiative: relationship?.initiative || 'MEDIUM',
                humor: relationship?.humor || 'LIGHT',
                advicePref: relationship?.advicePref || 'ASK_FIRST',
                remindersAllowed:
                    typeof relationship?.remindersAllowed === 'boolean'
                        ? relationship.remindersAllowed
                        : true,
                memoryShareScope: relationship?.memoryShareScope || 'RELATIONSHIP',
                avoidTopics: Array.isArray(relationship?.avoidTopics)
                    ? relationship.avoidTopics
                    : [],
                gender: relationship?.gender || 'FEMALE',
                avatarRef: relationship?.avatarRef || 'AVATAR_FEMALE_01',
            };
            const res = await client.go.storyRequest(
                'PATCH',
                `/api/v1/relationships/${encodeURIComponent(id)}`,
                body,
            );
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: queryKeys.relationships }),
                queryClient.invalidateQueries({ queryKey: queryKeys.recentChats }),
            ]);
            return res;
        },
    });
}

export interface DeleteCharacterInput {
    avatar: string;
    deleteChats?: boolean;
}

export function useDeleteCharacter() {
    const bridge = useSessionBridge();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ avatar, deleteChats = true }: DeleteCharacterInput) => {
            await bridge.deleteCharacter(avatar, deleteChats);
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: queryKeys.characters }),
                queryClient.invalidateQueries({ queryKey: queryKeys.relationships }),
                queryClient.invalidateQueries({ queryKey: queryKeys.recentChats }),
            ]);
        },
    });
}

export interface SavePersonaInput {
    avatar: string;
    fields: PersonaFields;
}

export function useSavePersona() {
    const client = useAppClient();
    const bridge = useSessionBridge();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ avatar, fields }: SavePersonaInput) => {
            const changes: PersonaFields = {
                description: String(fields.description ?? ''),
                personality: String(fields.personality ?? ''),
                scenario: String(fields.scenario ?? ''),
                first_mes: String(fields.first_mes ?? ''),
                mes_example: String(fields.mes_example ?? ''),
            };
            await client.post('/api/characters/merge-attributes', {
                avatar,
                ...changes,
                data: changes,
            });
            await bridge.reloadCharacter(avatar);
            await queryClient.invalidateQueries({ queryKey: queryKeys.characters });
            return changes;
        },
    });
}
