import {
  queryOptions,
  type FetchQueryOptions,
  type QueryClient,
} from '@tanstack/react-query';
import {
  TAVERN_SECTIONS,
  createTavernController,
  normalizeTavernSection,
  portablePreset,
  tavernSectionTitle,
  validateTavernName,
} from '../../../../extension/vc-model-settings/desktop/tavern-controller.js';
import type { AppClient } from '../client';
import { queryKeys } from '../queryKeys';

export {
  TAVERN_SECTIONS,
  createTavernController,
  normalizeTavernSection,
  portablePreset,
  tavernSectionTitle,
  validateTavernName,
};

export interface TavernOption {
  value: string;
  label: string;
}

export interface TavernResource {
  key: string;
  label: string;
  value: string;
  options: TavernOption[];
}

export interface TavernAction {
  id: string;
  label: string;
  accept?: string;
  disabled?: boolean;
}

export interface TavernField {
  key: string;
  name?: string;
  label: string;
  kind?: string;
  value: unknown;
  options?: TavernOption[];
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  nullableBoolean?: boolean;
  error?: string;
}

export interface TavernGroup {
  id: string;
  title: string;
  fields: TavernField[];
  actions?: TavernAction[];
}

export interface TavernListItem {
  id: string;
  name: string;
  selected?: boolean;
}

export interface TavernOrderItem {
  id: string;
  name: string;
  enabled: boolean;
}

export interface TavernGalleryItem {
  id: string;
  name: string;
  src: string;
  selected?: boolean;
}

export interface TavernControllerState {
  key: string;
  sprite: string;
  loading: boolean;
  busy: boolean;
  dirty: boolean;
  error: string;
  conflict: boolean;
  resources: TavernResource[];
  actions: TavernAction[];
  groups: TavernGroup[];
  items?: TavernListItem[];
  order?: TavernOrderItem[];
  gallery?: TavernGalleryItem[];
  selectedTemplate: string;
  selectedPresets: Record<string, string>;
  selectedWorld: string;
  selectedPersona: string;
  selectedCharacter: string;
  selectedPrompt: string;
  selectedScope: string;
  worlds: string[];
  avatars: string[];
  backgrounds: Array<{ filename: string; isAnimated?: boolean }>;
  characters: Array<{ avatar: string; name?: string }>;
  projection: unknown;
  projectionError: string;
  canMetadata: boolean;
  onField: (id: string, value: unknown) => void;
  onAction: (action: string, value?: unknown) => void;
}

export interface TavernConfirmRequest {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

export interface TavernAskNameRequest {
  title: string;
  initial: string;
  validate: (raw: string) => string;
  onConfirm: (name: string) => void;
}

export interface TavernCharacterDeletionRequest {
  avatar: string;
  onSelect: (deleteChats: boolean, label: string) => void;
}

export interface TavernCodeEditorHandle {
  isDirty: () => boolean;
  requestLeave: () => Promise<boolean>;
  destroy: () => void;
}

export interface TavernCodeEditorRequest {
  value: string;
  onApply: (value: string) => void;
  onDone: () => void;
}

export interface TavernAskNameDialogState {
  open: boolean;
  title: string;
  value: string;
  error: string;
  setValue: (value: string) => void;
  submit: () => void;
  close: () => void;
}

export interface TavernConfirmDialogState {
  open: boolean;
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel: string;
  danger: boolean;
  confirm: () => void;
  cancel: () => void;
}

export interface TavernCharDeleteDialogState {
  open: boolean;
  avatar: string;
  select: (deleteChats: boolean, label: string) => void;
  close: () => void;
}

export interface TavernCodeEditorDialogState {
  open: boolean;
  initialValue: string;
  setDirty: (dirty: boolean) => void;
  apply: (value: string) => void;
  close: () => void;
}

export interface UseTavernControllerOptions {
  initialCharacter?: string;
  onOpenModels?: () => void;
  onOpenAppearance?: () => void;
  checkValidity?: () => boolean;
  onDownload?: (value: unknown, name: string) => void;
  onNotify?: (message: string) => void;
  onConfirm?: (req: TavernConfirmRequest) => Promise<boolean>;
  onConfirmDiscard?: () => Promise<boolean>;
  onAskName?: (req: TavernAskNameRequest) => void;
  onChooseCharacterDeletion?: (req: TavernCharacterDeletionRequest) => void;
  onOpenCodeEditor?: (req: TavernCodeEditorRequest) => TavernCodeEditorHandle;
}

export interface UseTavernControllerResult {
  sectionKey: string;
  title: string;
  state: TavernControllerState;
  loading: boolean;
  busy: boolean;
  dirty: boolean;
  error: string;
  conflict: boolean;
  setCheckValidity: (fn: (() => boolean) | null) => void;
  save: () => Promise<boolean>;
  discard: () => Promise<boolean>;
  reload: () => Promise<void>;
  requestLeave: () => Promise<boolean>;
  onField: (id: string, value: unknown) => void;
  onAction: (action: string, value?: unknown) => void;
  reorderPrompts: (orderedIds: string[]) => void;
  askNameDialog: TavernAskNameDialogState;
  confirmDialog: TavernConfirmDialogState;
  charDeleteDialog: TavernCharDeleteDialogState;
  codeEditorDialog: TavernCodeEditorDialogState;
}

export interface TavernSectionProps {
  controller: UseTavernControllerResult;
}

export const tavernQueryKeys = {
  settingsDoc: queryKeys.settingsDoc,
  characters: queryKeys.characters,
  characterDetail: (avatar: string) => [...queryKeys.characters, avatar] as const,
  worldbookList: ['settingsDoc', 'worldbookList'] as const,
  worldbook: (name: string) => queryKeys.worldbook(name),
  avatars: ['settingsDoc', 'avatars'] as const,
  backgrounds: ['settingsDoc', 'backgrounds'] as const,
  purposes: queryKeys.purposes,
  providers: queryKeys.providers,
} as const;

export function settingsDocQueryOptions(client: AppClient) {
  return queryOptions({
    queryKey: queryKeys.settingsDoc,
    queryFn: ({ signal }) => client.request('/api/settings/get', {}, { signal }),
  });
}

export function tavernCharactersQueryOptions(client: AppClient) {
  return queryOptions({
    queryKey: queryKeys.characters,
    queryFn: ({ signal }) => client.request('/api/characters/all', {}, { signal }),
  });
}

export function tavernCharacterDetailQueryOptions(client: AppClient, avatar: string) {
  return queryOptions({
    queryKey: tavernQueryKeys.characterDetail(avatar),
    queryFn: ({ signal }) =>
      client.request('/api/characters/get', { avatar_url: avatar }, { signal }),
  });
}

export function tavernWorldbookListQueryOptions(client: AppClient) {
  return queryOptions({
    queryKey: tavernQueryKeys.worldbookList,
    queryFn: ({ signal }) => client.request('/api/worldinfo/list', {}, { signal }),
  });
}

export function tavernWorldbookQueryOptions(client: AppClient, name: string) {
  return queryOptions({
    queryKey: queryKeys.worldbook(name),
    queryFn: ({ signal }) => client.request('/api/worldinfo/get', { name }, { signal }),
  });
}

export function tavernAvatarsQueryOptions(client: AppClient) {
  return queryOptions({
    queryKey: tavernQueryKeys.avatars,
    queryFn: ({ signal }) => client.request('/api/avatars/get', {}, { signal }),
  });
}

export function tavernBackgroundsQueryOptions(client: AppClient) {
  return queryOptions({
    queryKey: tavernQueryKeys.backgrounds,
    queryFn: ({ signal }) => client.request('/api/backgrounds/all', {}, { signal }),
  });
}

export function tavernPurposesQueryOptions(client: AppClient) {
  return queryOptions({
    queryKey: queryKeys.purposes,
    queryFn: () => client.go.fetchModelPurposes(),
  });
}

export function tavernProvidersQueryOptions(client: AppClient) {
  return queryOptions({
    queryKey: queryKeys.providers,
    queryFn: () => client.go.fetchProviders(),
  });
}

export async function fetchTavernQuery<TData, TQueryKey extends readonly unknown[]>(
  queryClient: QueryClient,
  options: FetchQueryOptions<TData, Error, TData, TQueryKey>,
  fresh = false,
): Promise<TData> {
  if (fresh) {
    await queryClient.invalidateQueries({
      queryKey: options.queryKey,
      exact: true,
      refetchType: 'none',
    });
    return queryClient.fetchQuery({ ...options, staleTime: 0 });
  }
  return queryClient.fetchQuery(options);
}

export function createTavernReads(queryClient: QueryClient, client: AppClient) {
  return {
    settingsDoc: ({ fresh = false }: { fresh?: boolean } = {}) =>
      fetchTavernQuery(queryClient, settingsDocQueryOptions(client), fresh),
    characters: ({ fresh = false }: { fresh?: boolean } = {}) =>
      fetchTavernQuery(queryClient, tavernCharactersQueryOptions(client), fresh),
    characterDetail: (avatar: string, { fresh = false }: { fresh?: boolean } = {}) =>
      fetchTavernQuery(queryClient, tavernCharacterDetailQueryOptions(client, avatar), fresh),
    worldbookList: ({ fresh = false }: { fresh?: boolean } = {}) =>
      fetchTavernQuery(queryClient, tavernWorldbookListQueryOptions(client), fresh),
    worldbook: (name: string, { fresh = false }: { fresh?: boolean } = {}) =>
      fetchTavernQuery(queryClient, tavernWorldbookQueryOptions(client, name), fresh),
    avatars: ({ fresh = false }: { fresh?: boolean } = {}) =>
      fetchTavernQuery(queryClient, tavernAvatarsQueryOptions(client), fresh),
    backgrounds: ({ fresh = false }: { fresh?: boolean } = {}) =>
      fetchTavernQuery(queryClient, tavernBackgroundsQueryOptions(client), fresh),
    purposes: ({ fresh = false }: { fresh?: boolean } = {}) =>
      fetchTavernQuery(queryClient, tavernPurposesQueryOptions(client), fresh),
    providers: ({ fresh = false }: { fresh?: boolean } = {}) =>
      fetchTavernQuery(queryClient, tavernProvidersQueryOptions(client), fresh),
  };
}
