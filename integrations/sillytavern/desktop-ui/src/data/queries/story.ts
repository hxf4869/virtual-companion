import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  ensureCharacterReferences,
  importDesktopCharacter,
} from '../../../../extension/vc-model-settings/desktop/standalone/business.js';
import {
  ACTOR_ID,
  CASE_TITLE,
  CASTABLE,
  CHAT_IDENTITY,
  DECIMAL_ID,
  allowRun,
  allowView,
  decimalOf,
  shown,
} from '../../../../extension/vc-model-settings/story-logic.js';
import { useAppClient } from '../../app/providers';
import type { SessionBridge } from '../../runtime/session-bridge';
import { ApiError, type AppClient } from '../client';
import { queryKeys } from '../queryKeys';
import { normalizeConversationKey } from './chat';

export interface StoryRunRecord {
  runId: string;
  branchId: string;
  worldVersion: number;
  conversationId: string;
  caseId: string;
  title: string;
  stage: 'investigation' | 'resolved' | '';
  participants: Array<{ actorId: string; name: string; role: string }>;
  actorId?: string;
  mapped?: Record<string, string>;
  epilogue?: string;
}

export interface StoryActorView {
  setting: string;
  knownEvent: string;
  locations: string[];
  knowledge: string[];
  events: Array<{
    worldEventId: string;
    worldVersion: number | null;
    phase: 'investigation' | 'resolved';
    line: string;
    clueName: string;
  }>;
  participants: Array<{
    actorId: string;
    name: string;
    persona: string;
    relationshipId?: string;
  }>;
}

export interface StoryCompanionRow {
  relationshipId: string;
  name: string;
}

function invalidStoryAction(): never {
  throw new ApiError('invalid', '请求内容未通过校验，请检查表单。', {
    status: 0,
    code: 'INVALID_REQUEST',
  });
}

function requireDecimal(value: unknown): string {
  if (typeof value !== 'string' || !DECIMAL_ID.test(value)) invalidStoryAction();
  return value;
}

function requireActor(value: unknown): string {
  if (typeof value !== 'string' || !ACTOR_ID.test(value)) invalidStoryAction();
  return value;
}

function requireVersion(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    invalidStoryAction();
  }
  return value;
}

function requireActionId(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value === '' ||
    value !== value.trim() ||
    [...value].length > 128
  ) {
    invalidStoryAction();
  }
  return value;
}

export async function commitStoryActionWithClient(
  client: AppClient,
  {
    runId,
    branchId,
    expectedWorldVersion,
    actionId,
    actorId,
    action = '',
    target = '',
    clueId = '',
    text = '',
  }: {
    runId: string;
    branchId: string;
    expectedWorldVersion: number;
    actionId: string;
    actorId: string;
    action?: string;
    target?: string;
    clueId?: string;
    text?: string;
  },
): Promise<any> {
  const body: Record<string, any> = {
    branchId: requireDecimal(branchId),
    expectedWorldVersion: requireVersion(expectedWorldVersion),
    actionId: requireActionId(actionId),
    actorId: requireActor(actorId),
  };
  if (action) body.action = requireActor(action);
  if (target) body.target = requireActor(target);
  if (clueId) body.clueId = requireActor(clueId);
  if (text) {
    if (typeof text !== 'string' || [...text].length > 4000) invalidStoryAction();
    body.text = text;
  }
  return client.go.storyRequest('POST', `/api/v1/story/runs/${requireDecimal(runId)}/actions`, body);
}

export async function rewindStoryWithClient(
  client: AppClient,
  {
    runId,
    toWorldVersion,
    chatIdentity,
  }: {
    runId: string;
    toWorldVersion: number;
    chatIdentity: string;
  },
): Promise<any> {
  if (typeof chatIdentity !== 'string' || !CHAT_IDENTITY.test(chatIdentity)) {
    invalidStoryAction();
  }
  return client.go.storyRequest('POST', `/api/v1/story/runs/${requireDecimal(runId)}/rewind`, {
    toWorldVersion: requireVersion(toWorldVersion),
    chatIdentity,
  });
}

export async function mapStoryParticipantWithClient(
  client: AppClient,
  {
    runId,
    actorId,
    relationshipId,
  }: {
    runId: string;
    actorId: string;
    relationshipId: string;
  },
): Promise<any> {
  if (!CASTABLE.includes(actorId)) invalidStoryAction();
  return client.go.storyRequest(
    'POST',
    `/api/v1/story/runs/${requireDecimal(runId)}/participants/${requireActor(actorId)}`,
    {
      relationshipId: requireDecimal(relationshipId),
    },
  );
}

export async function decideStoryEpilogueWithClient(
  client: AppClient,
  {
    runId,
    decision,
    relationshipId = '',
    summary = '',
  }: {
    runId: string;
    decision: 'save' | 'discard';
    relationshipId?: string;
    summary?: string;
  },
): Promise<any> {
  const path = `/api/v1/story/runs/${requireDecimal(runId)}/epilogue`;
  if (decision === 'discard') {
    if (relationshipId || summary) invalidStoryAction();
    return client.go.storyRequest('POST', path, { decision: 'discard' });
  }
  if (decision !== 'save') invalidStoryAction();
  if (typeof summary !== 'string' || summary.trim() === '' || [...summary].length > 2000) {
    invalidStoryAction();
  }
  return client.go.storyRequest('POST', path, {
    decision: 'save',
    relationshipId: requireDecimal(relationshipId),
    summary,
  });
}

export function normalizeStoryView(raw: any): StoryActorView {
  if (
    raw &&
    typeof raw === 'object' &&
    !('publicLore' in raw) &&
    typeof raw.setting === 'string' &&
    typeof raw.knownEvent === 'string' &&
    Array.isArray(raw.locations) &&
    Array.isArray(raw.knowledge) &&
    raw.knowledge.every((k: any) => typeof k === 'string') &&
    Array.isArray(raw.events) &&
    raw.events.every((e: any) => typeof e?.line === 'string') &&
    Array.isArray(raw.participants)
  ) {
    return raw as StoryActorView;
  }
  return allowView(raw) as StoryActorView;
}

export function upsertStoryRunCache(queryClient: QueryClient, run: StoryRunRecord): void {
  queryClient.setQueryData(queryKeys.storyRun(run.runId), run);
  queryClient.setQueryData<StoryRunRecord[]>(queryKeys.storyRuns, (prev) => {
    const list = Array.isArray(prev) ? [...prev] : [];
    const idx = list.findIndex((item) => String(item.runId) === String(run.runId));
    if (idx >= 0) {
      list[idx] = run;
      return list;
    }
    return [run, ...list];
  });
}

export function useStoryRuns() {
  const queryClient = useQueryClient();
  return useQuery<StoryRunRecord[]>({
    queryKey: queryKeys.storyRuns,
    queryFn: async () => queryClient.getQueryData<StoryRunRecord[]>(queryKeys.storyRuns) ?? [],
    initialData: () => queryClient.getQueryData<StoryRunRecord[]>(queryKeys.storyRuns) ?? [],
    staleTime: Infinity,
  });
}

export function useStoryRun(runId?: string) {
  const queryClient = useQueryClient();
  const cleanId = decimalOf(runId);
  return useQuery<StoryRunRecord | null>({
    queryKey: queryKeys.storyRun(cleanId),
    enabled: Boolean(cleanId),
    queryFn: async () => {
      const direct = queryClient.getQueryData<StoryRunRecord>(queryKeys.storyRun(cleanId));
      if (direct) return direct;
      const list = queryClient.getQueryData<StoryRunRecord[]>(queryKeys.storyRuns) ?? [];
      return list.find((item) => String(item.runId) === cleanId) ?? null;
    },
    initialData: () => {
      if (!cleanId) return null;
      const direct = queryClient.getQueryData<StoryRunRecord>(queryKeys.storyRun(cleanId));
      if (direct) return direct;
      const list = queryClient.getQueryData<StoryRunRecord[]>(queryKeys.storyRuns) ?? [];
      return list.find((item) => String(item.runId) === cleanId) ?? null;
    },
    staleTime: Infinity,
  });
}

export function useStoryView(
  runId?: string,
  actorId: string = 'player',
  branchId?: string,
  worldVersion?: number,
) {
  const client = useAppClient();
  const runQuery = useStoryRun(runId);
  const effectiveRunId = decimalOf(runId || runQuery.data?.runId);
  const effectiveBranchId = decimalOf(branchId ?? runQuery.data?.branchId);
  const effectiveVersion =
    typeof worldVersion === 'number' && Number.isSafeInteger(worldVersion) && worldVersion >= 0
      ? worldVersion
      : typeof runQuery.data?.worldVersion === 'number'
        ? runQuery.data.worldVersion
        : undefined;
  const effectiveActor = actorId || 'player';

  return useQuery<StoryActorView>({
    queryKey: queryKeys.storyView(
      effectiveRunId,
      effectiveActor,
      effectiveBranchId,
      effectiveVersion,
    ),
    enabled: Boolean(
      effectiveRunId && effectiveBranchId && typeof effectiveVersion === 'number',
    ),
    queryFn: async () => {
      const raw = await client.go.fetchStoryActorView({
        runId: effectiveRunId,
        branchId: effectiveBranchId,
        worldVersion: effectiveVersion!,
      });
      return normalizeStoryView(raw);
    },
  });
}

export function useStoryModelPurposes(enabled: boolean = true) {
  const client = useAppClient();
  return useQuery({
    queryKey: queryKeys.purposes,
    enabled,
    queryFn: async () => {
      const raw: any = await client.go.fetchModelPurposes();
      const rows = Array.isArray(raw) ? raw : Array.isArray(raw?.items) ? raw.items : [];
      const missing = ['STORY_DIRECTOR', 'NPC_DIALOGUE'].some((id) => {
        const row = rows.find((item: any) => item?.purpose === id);
        return !row || row.status !== 'READY';
      });
      return {
        rows,
        ready: !missing,
      };
    },
  });
}

export function useStoryCompanions(enabled: boolean = true) {
  const client = useAppClient();
  return useQuery<StoryCompanionRow[]>({
    queryKey: queryKeys.relationships,
    enabled,
    select: (raw: any) => {
      const list = Array.isArray(raw) ? raw : Array.isArray(raw?.items) ? raw.items : [];
      const rows: StoryCompanionRow[] = [];
      for (const item of list) {
        if (item?.mode === 'STORY' || item?.displayName === '雨夜旅馆') continue;
        const relationshipId = decimalOf(item?.relationshipId);
        const name =
          shown(item?.companionName) ||
          shown(item?.displayName) ||
          shown(item?.name) ||
          shown(item?.personaRef);
        if (!relationshipId || !name) continue;
        rows.push({ relationshipId, name });
      }
      return rows;
    },
    queryFn: async () => client.go.fetchRelationships(),
  });
}

export async function ensureStoryConversation({
  client,
  bridge,
  queryClient,
}: {
  client: AppClient;
  bridge: SessionBridge;
  queryClient: QueryClient;
}): Promise<{ conversationId: string; chatIdentity: string; key?: string }> {
  const context = bridge.getContext() || {};
  const binding = context.chatMetadata?.vc_binding || {};
  const snap = bridge.getSnapshot();

  if (binding.mode === 'STORY' && DECIMAL_ID.test(String(binding.conversationId || ''))) {
    return {
      conversationId: String(binding.conversationId),
      chatIdentity: String(context.chatMetadata?.vc_f2?.id || ''),
      key: snap.key || undefined,
    };
  }

  if (snap.mode === 'STORY' && DECIMAL_ID.test(String(snap.conversationId || ''))) {
    return {
      conversationId: String(snap.conversationId),
      chatIdentity: String(context.chatMetadata?.vc_f2?.id || ''),
      key: snap.key || undefined,
    };
  }

  context.characters ||= [];
  if (!context.characters.length) {
    const loaded = await client.characters();
    if (Array.isArray(loaded)) {
      context.characters.splice(0, context.characters.length, ...loaded);
    }
  }
  await ensureCharacterReferences(client, context);

  let card = context.characters.find(
    (c: any) => c.data?.extensions?.vc_story_case === 'rainy-inn-v1',
  );
  if (!card) {
    const imported = await importDesktopCharacter(client, context, {
      name: 'rainy-inn.json',
      format: 'json',
      bytes: new TextEncoder().encode(
        JSON.stringify({
          spec: 'chara_card_v2',
          spec_version: '2.0',
          data: {
            name: '雨夜旅馆',
            description: '',
            personality: '',
            scenario: '',
            first_mes: '',
            mes_example: '',
            extensions: { vc_story_case: 'rainy-inn-v1' },
          },
        }),
      ),
    });
    card = context.characters.find(
      (c: any) => c.data?.extensions?.vc_character_ref === imported.characterRef,
    );
    if (card?.avatar) {
      await bridge.reloadCharacter(card.avatar);
    }
  }

  const characterRef =
    card?.data?.extensions?.vc_character_ref ||
    context.characters[0]?.data?.extensions?.vc_character_ref ||
    '';

  const created = await bridge.createConversation({
    characterRef,
    displayName: '雨夜旅馆',
    mode: 'STORY',
  });
  if (!created?.avatar || !created?.file) {
    throw new Error('source-unavailable');
  }

  const key = normalizeConversationKey(created.avatar, created.file);
  const openStatus = await bridge.open(key);
  if (openStatus === 'failed') {
    throw new Error('source-unavailable');
  }

  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.recentChats }),
    queryClient.invalidateQueries({ queryKey: queryKeys.characters }),
    queryClient.invalidateQueries({ queryKey: queryKeys.relationships }),
  ]);

  const updatedCtx = bridge.getContext() || {};
  const convId =
    decimalOf(created?.conversationId) ||
    decimalOf(updatedCtx.chatMetadata?.vc_binding?.conversationId);
  if (!convId) {
    throw new Error('missing story conversationId');
  }

  return {
    conversationId: convId,
    chatIdentity: String(
      created?.chatIdentity || updatedCtx.chatMetadata?.vc_f2?.id || '',
    ),
    key,
  };
}

export function buildStoryRunRecord(
  rawRun: any,
  conversationId: string,
  prev?: Partial<StoryRunRecord> | null,
): StoryRunRecord {
  const allowed = allowRun(rawRun);
  const runId = decimalOf(rawRun?.runId || prev?.runId);
  const branchId = decimalOf(rawRun?.branchId || prev?.branchId);
  const worldVersion =
    typeof rawRun?.worldVersion === 'number' && Number.isSafeInteger(rawRun.worldVersion)
      ? rawRun.worldVersion
      : (prev?.worldVersion ?? 0);

  return {
    runId,
    branchId,
    worldVersion,
    conversationId: decimalOf(rawRun?.conversationId || conversationId || prev?.conversationId),
    caseId: allowed.caseId || prev?.caseId || 'rainy-inn-v1',
    title: CASE_TITLE,
    stage: (allowed.stage || prev?.stage || 'investigation') as StoryRunRecord['stage'],
    participants: allowed.participants?.length ? allowed.participants : (prev?.participants ?? []),
    actorId: prev?.actorId ?? '',
    mapped: prev?.mapped ? { ...prev.mapped } : {},
    epilogue: prev?.epilogue ?? '',
  };
}
