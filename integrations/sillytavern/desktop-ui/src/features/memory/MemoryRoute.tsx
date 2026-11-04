import { useEffect, useState } from 'react';
import {
  useIncognitoPref,
  useMemoryItems,
  useRelationships,
  useSetIncognitoPref,
  type MemoryFilters as MemoryFilterValues,
  type MemoryItem,
} from '../../data/queries/memory';
import { Select } from '../../design/components/Select';
import { Switch } from '../../design/components/Switch';
import { Tabs } from '../../design/components/Tabs';
import { useChatSnapshot } from '../../runtime/session-bridge';
import {
  idOf,
  INCOGNITO_LABEL,
  relationshipLabel,
} from '../../../../extension/vc-model-settings/memory-logic.js';
import { MemoryFilters } from './MemoryFilters';
import { MemoryTimeline } from './MemoryTimeline';
import { MemoryItemDetail, type LocateMessagePayload } from './MemoryItemDetail';
import { Diary } from './Diary';
import { Favorites } from './Favorites';
import { ReauthDialog } from '../inbox/ReauthDialog';
import './memory.css';

const FILTER_STORAGE_KEY = 'vc_desktop_memory_filters';

interface StoredMemoryRouteState {
  relId: string | null;
  tab: 'timeline' | 'diary' | 'favorites';
  filters: MemoryFilterValues;
}

function readStoredRouteState(): StoredMemoryRouteState {
  const fallback: StoredMemoryRouteState = {
    relId: null,
    tab: 'timeline',
    filters: { type: '', source: '', date: '', status: '', q: '' },
  };
  try {
    const raw = window.localStorage?.getItem(FILTER_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<StoredMemoryRouteState>;
    const relId =
      typeof parsed.relId === 'string' &&
      parsed.relId.trim() !== '' &&
      parsed.relId !== 'undefined'
        ? parsed.relId.trim()
        : null;
    return {
      relId,
      tab:
        parsed.tab === 'diary' || parsed.tab === 'favorites' ? parsed.tab : 'timeline',
      filters: {
        type: String(parsed.filters?.type ?? ''),
        source: String(parsed.filters?.source ?? ''),
        date: String(parsed.filters?.date ?? ''),
        status: String(parsed.filters?.status ?? ''),
        q: String(parsed.filters?.q ?? ''),
      },
    };
  } catch {
    return fallback;
  }
}

function writeStoredRouteState(state: StoredMemoryRouteState): void {
  try {
    window.localStorage?.setItem(FILTER_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage failures
  }
}

const ROUTE_TABS = [
  { value: 'timeline', label: '时间线' },
  { value: 'diary', label: '日记' },
  { value: 'favorites', label: '收藏' },
] as const;

export interface MemoryRouteProps {
  initialRelationshipId?: string | null;
  onNavigateToMessage?: (payload: LocateMessagePayload) => void | Promise<void>;
}

export function MemoryRoute({
  initialRelationshipId = null,
  onNavigateToMessage,
}: MemoryRouteProps) {
  const activeChatRelId = useChatSnapshot((s) => s.relationshipId);
  const initialStored = readStoredRouteState();
  const [selectedRelId, setSelectedRelId] = useState<string | null>(
    initialRelationshipId ??
      (activeChatRelId ? String(activeChatRelId) : null) ??
      initialStored.relId,
  );
  const [activeTab, setActiveTab] = useState<'timeline' | 'diary' | 'favorites'>(
    initialStored.tab,
  );
  const [filters, setFilters] = useState<MemoryFilterValues>(initialStored.filters);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [reauthOpen, setReauthOpen] = useState(false);
  const [pendingIncognito, setPendingIncognito] = useState<boolean | null>(null);

  const relationshipsQuery = useRelationships();
  const relationships = relationshipsQuery.data ?? [];

  useEffect(() => {
    if (relationships.length === 0) return;
    const valid =
      selectedRelId &&
      relationships.some((rel) => String(rel.relationshipId) === selectedRelId);
    if (!valid) {
      const fromChat =
        activeChatRelId &&
        relationships.some((rel) => String(rel.relationshipId) === String(activeChatRelId))
          ? String(activeChatRelId)
          : String(relationships[0].relationshipId);
      setSelectedRelId(fromChat);
    }
  }, [relationships, selectedRelId, activeChatRelId]);

  useEffect(() => {
    writeStoredRouteState({
      relId: selectedRelId,
      tab: activeTab,
      filters,
    });
  }, [selectedRelId, activeTab, filters]);

  const memoryQuery = useMemoryItems(selectedRelId, filters);
  const items: MemoryItem[] = memoryQuery.data?.items ?? [];

  useEffect(() => {
    if (items.length === 0) {
      setSelectedItemId(null);
      return;
    }
    if (!selectedItemId || !items.some((it) => idOf(it) === selectedItemId)) {
      setSelectedItemId(idOf(items[0]));
    }
  }, [items, selectedItemId]);

  const selectedItem = items.find((it) => idOf(it) === selectedItemId) ?? null;

  const incognitoQuery = useIncognitoPref();
  const setIncognitoMutation = useSetIncognitoPref();
  const incognitoEnabled = Boolean(incognitoQuery.data?.incognito);

  const handleToggleIncognito = async (next: boolean) => {
    try {
      await setIncognitoMutation.mutateAsync(next);
      setPendingIncognito(null);
    } catch (err) {
      const status = (err as { status?: number })?.status;
      if (status === 401 || status === 403) {
        setPendingIncognito(next);
        setReauthOpen(true);
      }
    }
  };

  const relOptions = relationships.map((rel) => {
    const id = String(rel.relationshipId);
    return {
      value: id,
      label: relationshipLabel(rel, relationships),
    };
  });

  return (
    <div className="vc-memory-route" data-vc-page="memory">
      <header className="vc-memory-route__header">
        <div className="vc-memory-route__title-bar">
          <h1 className="vc-memory-route__title">记忆与日记</h1>
          {relOptions.length > 0 ? (
            <Select
              aria-label="选择角色关系"
              value={selectedRelId ?? ''}
              options={relOptions}
              onValueChange={(val) => {
                setSelectedRelId(val);
                setSelectedItemId(null);
              }}
            />
          ) : null}
          <Tabs
            value={activeTab}
            tabs={ROUTE_TABS}
            onValueChange={(next) => setActiveTab(next)}
          />
        </div>

        <div className="vc-memory-route__incognito">
          <span>{INCOGNITO_LABEL}</span>
          <Switch
            aria-label={INCOGNITO_LABEL}
            checked={incognitoEnabled}
            onCheckedChange={(checked) => void handleToggleIncognito(checked)}
          />
        </div>
      </header>

      {activeTab === 'timeline' ? (
        <div className="vc-memory-route__columns">
          <MemoryFilters
            filters={filters}
            onChange={(next) => setFilters(next)}
            onReset={() =>
              setFilters({ type: '', source: '', date: '', status: '', q: '' })
            }
          />
          <MemoryTimeline
            items={items}
            selectedId={selectedItemId}
            loading={memoryQuery.isLoading}
            hasNextPage={Boolean(memoryQuery.hasNextPage)}
            isFetchingNextPage={memoryQuery.isFetchingNextPage}
            onSelect={(item) => setSelectedItemId(idOf(item))}
            onLoadMore={() => {
              void memoryQuery.fetchNextPage();
            }}
          />
          <MemoryItemDetail
            item={selectedItem}
            onItemUpdated={(updated) => {
              setSelectedItemId(idOf(updated));
            }}
            onNavigateToMessage={onNavigateToMessage}
          />
        </div>
      ) : activeTab === 'diary' ? (
        <Diary relId={selectedRelId} />
      ) : (
        <Favorites
          relId={selectedRelId}
          onNavigateToMessage={onNavigateToMessage}
        />
      )}

      <ReauthDialog
        open={reauthOpen}
        onOpenChange={setReauthOpen}
        onSuccess={() => {
          if (pendingIncognito !== null) {
            return handleToggleIncognito(pendingIncognito);
          }
        }}
      />
    </div>
  );
}
