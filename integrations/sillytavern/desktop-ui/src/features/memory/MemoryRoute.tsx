import type { ReactNode } from 'react';
import { Select } from '../../design/components/Select';
import { Switch } from '../../design/components/Switch';
import { Tabs } from '../../design/components/Tabs';
import {
  idOf,
  INCOGNITO_LABEL,
} from '../../../../extension/vc-model-settings/memory-logic.js';
import { MemoryFilters } from './MemoryFilters';
import { MemoryTimeline } from './MemoryTimeline';
import { MemoryItemDetail, type LocateMessagePayload } from './MemoryItemDetail';
import { Diary } from './Diary';
import { Favorites } from './Favorites';
import { ReauthDialog } from '../inbox/ReauthDialog';
import {
  FILTER_STORAGE_KEY,
  MEMORY_ROUTE_TABS,
  parseStoredMemoryRouteState,
  useMemoryRouteState,
  type StoredMemoryRouteState,
} from './useMemoryState';
import './memory.css';

export { FILTER_STORAGE_KEY, type LocateMessagePayload, type StoredMemoryRouteState };

export function readStoredRouteState(): StoredMemoryRouteState {
  try {
    const raw = window.localStorage?.getItem(FILTER_STORAGE_KEY);
    return parseStoredMemoryRouteState(raw);
  } catch {
    return parseStoredMemoryRouteState(null);
  }
}

export function writeStoredRouteState(state: StoredMemoryRouteState): void {
  try {
    window.localStorage?.setItem(FILTER_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage failures
  }
}

export interface MemoryRouteProps {
  initialRelationshipId?: string | null;
  onNavigateToMessage: (payload: LocateMessagePayload) => void | Promise<void>;
  renderLeaveGuard: (dirty: boolean) => ReactNode;
}

export function MemoryRoute({
  initialRelationshipId = null,
  onNavigateToMessage,
  renderLeaveGuard,
}: MemoryRouteProps) {
  const {
    relOptions,
    selectedRelId,
    selectRelationship,
    activeTab,
    setActiveTab,
    filters,
    setFilters,
    resetFilters,
    memoryQuery,
    items,
    selectedItemId,
    setSelectedItemId,
    selectedItem,
    incognitoEnabled,
    reauthOpen,
    setReauthOpen,
    handleToggleIncognito,
    handleReauthSuccess,
  } = useMemoryRouteState({
    initialRelationshipId,
    initialStoredState: readStoredRouteState(),
    onPersistState: writeStoredRouteState,
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
                selectRelationship(val);
              }}
            />
          ) : null}
          <Tabs
            value={activeTab}
            tabs={MEMORY_ROUTE_TABS}
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
            onReset={resetFilters}
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
            renderLeaveGuard={renderLeaveGuard}
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
        onSuccess={handleReauthSuccess}
      />
    </div>
  );
}
