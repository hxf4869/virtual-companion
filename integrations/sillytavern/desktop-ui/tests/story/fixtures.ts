import { vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { createStoryProjection } from '../../../extension/vc-model-settings/story-projection.js';
import { commitStoryProjectionSave } from '../../../extension/vc-model-settings/projection-save.js';
import type { AppClient } from '../../src/data/client';
import type { SessionBridge, ChatSnapshot } from '../../src/runtime/session-bridge';

export interface StoryTestEnvOptions {
  purposesReady?: boolean;
  hasExistingStoryConversation?: boolean;
  hasStoryCard?: boolean;
  relationships?: Array<{
    relationshipId: string;
    displayName: string;
    mode?: string;
  }>;
  initialRun?: {
    runId: string;
    branchId: string;
    worldVersion: number;
    stage?: 'investigation' | 'resolved';
  };
  onActionRequest?: (payload: any) => Promise<any>;
  onRewindRequest?: (payload: any) => Promise<any>;
  onProjectionReadChat?: () => Promise<void> | void;
  onProjectionSaveChat?: (snapshot: any) => Promise<void> | void;
  onProjectionConfirm?: (args: { runId: string; worldEventId: string }) => Promise<any>;
}

export function createStoryTestView(overrides: Record<string, any> = {}) {
  const worldVersion = overrides.worldVersion ?? 0;
  const defaultEvents = [];
  for (let v = 0; v <= worldVersion; v += 1) {
    defaultEvents.push({
      eventId: String(500 + v),
      actorId: v === 0 ? 'player' : 'lin',
      worldVersion: v,
      body: {
        clueName: '',
        text: v === 0 ? '' : `第 ${v} 步调查记录`,
        note: v === 0 ? '煤油灯在桌角摇晃，外头雨声急促。' : '',
        qualification: '',
        phase: overrides.stage === 'resolved' ? 'resolved' : 'investigation',
      },
    });
  }
  return {
    conversationId: overrides.conversationId ?? '77',
    runId: overrides.runId ?? '11',
    branchId: overrides.branchId ?? '13',
    actorId: 'player',
    worldVersion,
    publicLore: overrides.publicLore ?? {
      setting: '雨夜，小旅馆的一枚展柜怀表失踪。玩家受邀调查。',
      locations: ['lobby', 'kitchen', 'workshop', 'workshop_cabinet'],
      knownEvent: '停电发生在晚上九点整，怀表原本放在二楼书桌上。',
    },
    participants: overrides.participants ?? [
      { actorId: 'lin', name: '林岚', publicPersona: '旅馆前台' },
      { actorId: 'zhou', name: '周澈', publicPersona: '住客' },
      { actorId: 'su', name: '苏禾', publicPersona: '厨师' },
    ],
    knowledge: overrides.knowledge ?? [
      {
        id: 'k-0',
        fact: '大堂展柜是空的',
      },
    ],
    events: overrides.events ?? defaultEvents,
  };
}

export function createStoryTestEnv(options: StoryTestEnvOptions = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: Infinity,
      },
    },
  });

  const purposesReady = options.purposesReady ?? true;
  const relationships = options.relationships ?? [
    { relationshipId: '101', displayName: '林月', mode: 'COMPANION' },
    { relationshipId: '102', displayName: '苏晴', mode: 'COMPANION' },
  ];

  const characters: any[] = [
    {
      avatar: 'linyue.png',
      name: '林月',
      description: '温和细腻的旅伴',
      data: {
        extensions: {
          vc_character_ref: 'ref-linyue',
        },
      },
    },
  ];

  if (options.hasStoryCard ?? true) {
    characters.push({
      avatar: 'rainy-inn.png',
      name: '雨夜旅馆',
      description: '雨夜旅馆剧目卡',
      data: {
        extensions: {
          vc_character_ref: 'ref-rainy-inn',
          vc_story_case: 'rainy-inn-v1',
        },
      },
    });
  }

  const contextObj: Record<string, any> = {
    characters,
    chat: [],
    chatMetadata: options.hasExistingStoryConversation
      ? {
          vc_f2: { id: 'f2-story-1', revision: 1 },
          vc_binding: {
            conversationId: '77',
            relationshipId: '301',
            mode: 'STORY',
          },
        }
      : {
          vc_f2: { id: 'f2-comp-1', revision: 1 },
          vc_binding: {
            conversationId: '12',
            relationshipId: '101',
            mode: 'COMPANION',
          },
        },
    characterId: 0,
    chatId: options.hasExistingStoryConversation ? 'story-chat-1' : 'comp-chat-1',
    name1: '你',
    name2: '林月',
  };

  let currentWorldVersion = options.initialRun?.worldVersion ?? 0;
  let currentBranchId = options.initialRun?.branchId ?? '13';
  let currentStage: 'investigation' | 'resolved' = options.initialRun?.stage ?? 'investigation';
  let nextRewindBranchNum = 19;
  let nextEventSeq = 500 + currentWorldVersion;
  const currentRunId = options.initialRun?.runId ?? '11';
  const participants: Array<{
    actorId: string;
    name: string;
    publicPersona: string;
    relationshipId?: string;
  }> = [
    { actorId: 'lin', name: '林岚', publicPersona: '旅馆前台' },
    { actorId: 'zhou', name: '周澈', publicPersona: '住客' },
    { actorId: 'su', name: '苏禾', publicPersona: '厨师' },
  ];
  const knowledge: Array<{ id: string; fact: string; worldVersion: number; branchId: string }> = [
    {
      id: 'k-0',
      fact: '大堂展柜是空的',
      worldVersion: 0,
      branchId: currentBranchId,
    },
  ];
  const events: Array<{
    eventId: string;
    actorId: string;
    worldVersion: number;
    branchId: string;
    body: {
      clueName: string;
      text: string;
      note: string;
      qualification: string;
      phase: 'investigation' | 'resolved';
    };
  }> = [];
  for (let v = 0; v <= currentWorldVersion; v += 1) {
    events.push({
      eventId: String(500 + v),
      actorId: v === 0 ? 'player' : 'lin',
      worldVersion: v,
      branchId: currentBranchId,
      body: {
        clueName: '',
        text: v === 0 ? '' : `第 ${v} 步调查记录`,
        note: v === 0 ? '煤油灯在桌角摇晃，外头雨声急促。' : '',
        qualification: '',
        phase: currentStage,
      },
    });
  }
  const recordedActions = new Map<
    string,
    { eventId: string; branchId: string; worldVersion: number }
  >();
  const pendingProjections: any[] = [];
  const storyRequests: Array<{ method: string; path: string; payload?: any }> = [];

  const storyRequest = vi.fn(async (method: string, path: string, payload?: any) => {
    storyRequests.push({ method, path, payload });

    if (method === 'GET' && path === '/api/v1/relationships') {
      return { items: relationships };
    }

    if (method === 'GET' && path.endsWith('/projections?state=PENDING')) {
      return {
        projections: pendingProjections.filter(
          (p) =>
            !p.branchId ||
            (p.branchId === currentBranchId && p.worldVersion <= currentWorldVersion),
        ),
      };
    }

    if (method === 'POST' && path.includes('/participants/')) {
      const actorId = path.split('/participants/')[1];
      const existing = participants.find((p) => p.actorId === actorId);
      const relId = String(payload?.relationshipId ?? '');
      if (existing) {
        existing.relationshipId = relId;
      }
      return { runId: currentRunId, actorId, relationshipId: relId };
    }

    if (method === 'POST' && path.endsWith('/actions')) {
      if (options.onActionRequest) {
        return options.onActionRequest(payload);
      }
      const actionId = String(payload?.actionId || '');
      const found = actionId ? recordedActions.get(actionId) : undefined;
      if (found) {
        return {
          accepted: true,
          replayed: true,
          worldVersion: found.worldVersion,
          worldEventId: found.eventId,
          branchId: found.branchId,
          stage: currentStage,
          ended: currentStage === 'resolved',
        };
      }

      currentWorldVersion += 1;
      nextEventSeq += 1;
      const worldEventId = String(nextEventSeq);
      const isAccuse = payload?.action === 'accuse';
      if (isAccuse) {
        currentStage = 'resolved';
      }
      const clueName =
        actionId === 'a1'
          ? '钥匙借用记录'
          : actionId === 'a2'
            ? '蓝色衣袖'
            : payload?.clueId === 'ledger'
              ? '登记簿'
              : '';
      const text = payload?.text
        ? `你对${payload?.target || '人物'}说：“${payload.text}”`
        : `完成了行动：${payload?.action || actionId}`;

      if (actionId) {
        recordedActions.set(actionId, {
          eventId: worldEventId,
          branchId: currentBranchId,
          worldVersion: currentWorldVersion,
        });
      }

      events.push({
        eventId: worldEventId,
        actorId: payload?.target || 'player',
        worldVersion: currentWorldVersion,
        branchId: currentBranchId,
        body: {
          clueName,
          text,
          note: '',
          qualification: '',
          phase: currentStage,
        },
      });
      pendingProjections.push({
        worldEventId,
        worldVersion: currentWorldVersion,
        branchId: currentBranchId,
        text: [clueName, text].filter(Boolean).join('\n'),
      });
      return {
        accepted: true,
        replayed: false,
        worldVersion: currentWorldVersion,
        worldEventId,
        branchId: currentBranchId,
        stage: currentStage,
        ended: isAccuse,
      };
    }

    if (method === 'POST' && path.endsWith('/rewind')) {
      if (options.onRewindRequest) {
        return options.onRewindRequest(payload);
      }
      const targetVer = Number(payload?.toWorldVersion ?? 0);
      currentWorldVersion = targetVer;
      currentBranchId = String(nextRewindBranchNum);
      nextRewindBranchNum += 4;
      currentStage = 'investigation';
      for (const ev of [...events]) {
        if (ev.worldVersion <= targetVer) {
          events.push({
            ...ev,
            branchId: currentBranchId,
          });
        }
      }
      for (const proj of pendingProjections) {
        if (proj.worldVersion <= targetVer) {
          proj.branchId = currentBranchId;
        }
      }
      return {
        runId: currentRunId,
        branchId: currentBranchId,
        worldVersion: currentWorldVersion,
        stage: currentStage,
      };
    }

    if (method === 'POST' && path.includes('/projections/') && path.endsWith('/confirm')) {
      const segs = path.split('/');
      const eventId = segs[segs.length - 2];
      const idx = pendingProjections.findIndex((p) => String(p.worldEventId) === String(eventId));
      if (idx >= 0) pendingProjections.splice(idx, 1);
      return { confirmed: true, worldEventId: eventId };
    }

    if (method === 'POST' && path.endsWith('/epilogue')) {
      return {
        runId: currentRunId,
        decision: payload?.decision,
        status: 'DECIDED',
      };
    }

    return {};
  });

  const fetchStoryActorView = vi.fn(
    async ({
      runId,
      branchId,
      worldVersion,
    }: {
      runId: string;
      branchId: string;
      worldVersion: number;
    }) => {
      const targetBranch = String(branchId);
      const targetVersion = Number(worldVersion);
      const branchEvents = events.filter(
        (e) => e.branchId === targetBranch && e.worldVersion <= targetVersion,
      );
      const effectiveEvents =
        branchEvents.length > 0
          ? branchEvents
          : events.filter((e) => e.worldVersion <= targetVersion);
      return createStoryTestView({
        runId: String(runId),
        branchId: targetBranch,
        worldVersion: targetVersion,
        stage: currentStage,
        participants: participants.map((p) => ({ ...p })),
        knowledge: knowledge
          .filter((k) => k.worldVersion <= targetVersion)
          .map((k) => ({ id: k.id, fact: k.fact })),
        events: effectiveEvents,
      });
    },
  );

  const startStoryRun = vi.fn(async (_conversationId: string) => ({
    conversationId: '77',
    runId: currentRunId,
    branchId: currentBranchId,
    caseId: 'rainy-inn-v1',
    worldVersion: currentWorldVersion,
    stage: currentStage,
    participants: [
      { actorId: 'player', name: '调查者', role: 'player', scene: 'lobby' },
      { actorId: 'lin', name: '林岚', role: 'npc', scene: 'lobby' },
      { actorId: 'zhou', name: '周澈', role: 'npc', scene: 'lobby' },
      { actorId: 'su', name: '苏禾', role: 'npc', scene: 'lobby' },
    ],
  }));

  const fetchModelPurposes = vi.fn(async () => ({
    items: [
      {
        purpose: 'STORY_DIRECTOR',
        status: purposesReady ? 'READY' : 'UNBOUND',
      },
      {
        purpose: 'NPC_DIALOGUE',
        status: purposesReady ? 'READY' : 'UNBOUND',
      },
    ],
  }));

  const captureSessionContext = vi.fn(async () => ({
    accountId: '1',
    sessionId: '1',
    userId: '1',
  }));

  const fetchRelationships = vi.fn(async () => relationships);

  const client = {
    identity: { accountId: '1', sessionId: '1' },
    headers: () => ({ 'Content-Type': 'application/json' }),
    initialize: vi.fn(async () => ({})),
    characters: vi.fn(async () => characters),
    recent: vi.fn(async () => []),
    settings: vi.fn(async () => ({ settings: '{}' })),
    readChat: vi.fn(async () => [{ chat_metadata: contextObj.chatMetadata }]),
    request: vi.fn(async () => ({})),
    post: vi.fn(async () => ({})),
    raw: vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ result: 'ok', vc_f2: { id: 'f2-story-1', revision: 1 } }),
    })),
    generate: vi.fn(async () => ({})),
    saveSettings: vi.fn(async () => ({})),
    settingsChanged: vi.fn(() => false),
    documents: {},
    go: {
      captureSessionContext,
      fetchModelPurposes,
      fetchRelationships,
      startStoryRun,
      fetchStoryActorView,
      storyRequest,
      resolveSTBinding: vi.fn(async () => ({
        conversationId: '77',
        relationshipId: '301',
        mode: 'STORY',
      })),
    },
  } as unknown as AppClient;

  let snapshot: ChatSnapshot = {
    status: 'ready',
    key: options.hasExistingStoryConversation
      ? '["rainy-inn.png","story-chat-1"]'
      : '["linyue.png","comp-chat-1"]',
    avatar: options.hasExistingStoryConversation ? '/characters/rainy-inn.png' : '/characters/linyue.png',
    characterName: options.hasExistingStoryConversation ? '雨夜旅馆' : '林月',
    characterRef: options.hasExistingStoryConversation ? 'ref-rainy-inn' : 'ref-linyue',
    relationshipId: options.hasExistingStoryConversation ? '301' : '101',
    conversationId: options.hasExistingStoryConversation ? '77' : '12',
    mode: options.hasExistingStoryConversation ? 'STORY' : 'COMPANION',
    messages: [],
    draft: '',
    busy: false,
    canSend: true,
    enterToSend: true,
    conflict: false,
    blocked: false,
    notice: '',
    error: '',
    needsSettings: false,
    historyAll: false,
    personaLock: null,
  };

  const realProjector = createStoryProjection({
    readChat: async () => {
      if (options.onProjectionReadChat) {
        await options.onProjectionReadChat();
      }
      return {
        metadata:
          contextObj.chatMetadata && typeof contextObj.chatMetadata === 'object'
            ? contextObj.chatMetadata
            : {},
        messages: Array.isArray(contextObj.chat) ? contextObj.chat.slice() : [],
      };
    },
    saveChat: async (snap: any) => {
      if (options.onProjectionSaveChat) {
        await options.onProjectionSaveChat(snap);
      }
      commitStoryProjectionSave(contextObj, snap);
    },
    confirm: async ({ runId, worldEventId }: { runId: string; worldEventId: string }) => {
      if (options.onProjectionConfirm) {
        return options.onProjectionConfirm({ runId, worldEventId });
      }
      return storyRequest(
        'POST',
        `/api/v1/story/runs/${runId}/projections/${worldEventId}/confirm`,
        {},
      );
    },
  });
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const l of listeners) l();
  };

  const bridge: SessionBridge = {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    getContext: () => contextObj,
    ensureReady: vi.fn(async () => ({}) as any),
    open: vi.fn(async (key: string) => {
      snapshot = {
        ...snapshot,
        key,
        conversationId: '77',
        relationshipId: '301',
        mode: 'STORY',
      };
      contextObj.chatMetadata = {
        vc_f2: { id: 'f2-story-1', revision: 1 },
        vc_binding: {
          conversationId: '77',
          relationshipId: '301',
          mode: 'STORY',
        },
      };
      notify();
      return 'opened';
    }),
    send: vi.fn(async () => true),
    stop: vi.fn(async () => {}),
    regenerate: vi.fn(async () => true),
    continue: vi.fn(async () => true),
    swipe: vi.fn(async () => true),
    edit: vi.fn(async () => true),
    remove: vi.fn(async () => true),
    react: vi.fn(async () => true),
    pat: vi.fn(async () => true),
    retry: vi.fn(async () => true),
    copyRejected: vi.fn(async () => ''),
    setDraft: vi.fn(),
    readDraft: vi.fn(() => ''),
    draft: {
      read: vi.fn(() => ''),
      write: vi.fn(),
    },
    setHistoryAll: vi.fn(),
    createConversation: vi.fn(async (input: any) => {
      contextObj.chatMetadata = {
        vc_f2: { id: 'f2-story-1', revision: 1 },
        vc_binding: {
          conversationId: '77',
          relationshipId: '301',
          mode: input?.mode || 'STORY',
        },
      };
      return {
        conversationId: '77',
        relationshipId: '301',
        mode: input?.mode || 'STORY',
        avatar: 'rainy-inn.png',
        file: 'story-chat-1',
        chatIdentity: 'f2-story-1',
        characterRef: input?.characterRef || 'ref-rainy-inn',
        name: input?.displayName || '雨夜旅馆',
      };
    }),
    projectStory: vi.fn(async (job: any) => realProjector.project(job)),
    story: {
      setRun: vi.fn(),
      selectActor: vi.fn(),
      advance: vi.fn(),
      clear: vi.fn(),
    },
    applySettings: vi.fn(async () => {}),
    applyPreset: vi.fn(async () => {}),
    applyWorldbook: vi.fn(async () => {}),
    reloadCharacter: vi.fn(async () => {}),
    commitMetadata: vi.fn(async () => {}),
    deleteCharacter: vi.fn(async () => {}),
    refreshCatalog: vi.fn(async () => {}),
    setBudget: vi.fn(),
    renderMessage: vi.fn(() => () => {}),
    mountCardActions: vi.fn(() => () => {}),
    mountLeaf: vi.fn(() => () => {}),
    destroy: vi.fn(),
  };

  return {
    client,
    queryClient,
    bridge,
    storyRequests,
    startStoryRun,
    fetchStoryActorView,
    storyRequest,
    fetchModelPurposes,
    captureSessionContext,
    pendingProjections,
  };
}
