import { createElement, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import {
  useForm,
  type DefaultValues,
  type FieldValues,
  type Resolver,
  type UseFormReturn,
} from 'react-hook-form';
import { useRouter } from '@tanstack/react-router';
import type { z } from 'zod';
import { ConflictError } from '../../data/client';
import { useLeaveGuard } from '../../shell/useLeaveGuard';

function createZodResolver<TValues extends FieldValues>(
  schema: z.ZodType<TValues, any, any>,
): Resolver<TValues> {
  return async (values) => {
    const parsed = schema.safeParse(values);
    if (parsed.success) {
      return {
        values: parsed.data,
        errors: {},
      };
    }
    const fieldErrors: Record<string, { type: string; message: string }> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.map(String).join('.') || 'root';
      if (!fieldErrors[key]) {
        fieldErrors[key] = {
          type: String(issue.code || 'validation'),
          message: issue.message,
        };
      }
    }
    return {
      values: {},
      errors: fieldErrors as any,
    };
  };
}

function ActiveLeaveGuard({ dirty }: { dirty: boolean }) {
  return useLeaveGuard(dirty);
}

export interface SettingsFormQueryLike<TData = unknown> {
  data?: TData;
  isLoading?: boolean;
  error?: unknown;
  refetch?: () => Promise<{ data?: TData }>;
}

export interface SettingsFormMutationLike<TValues = unknown, TResult = unknown> {
  mutateAsync: (values: TValues) => Promise<TResult>;
  isPending?: boolean;
}

export interface SettingsConflictState<TValues> {
  message: string;
  currentRevision: number | null;
  draft: TValues;
  latest?: TValues;
  raw?: unknown;
}

export interface UseSettingsFormOptions<
  TValues extends FieldValues,
  TData = TValues,
  TResult = unknown,
> {
  defaultValues?: DefaultValues<TValues>;
  toFormValues?: (data: TData) => TValues;
  extraDirty?: boolean;
  identityKey?: string;
  onSuccess?: (result: TResult, values: TValues) => void;
  onError?: (error: unknown) => void;
}

export interface UseSettingsFormConfig<
  TValues extends FieldValues,
  TData = TValues,
  TResult = unknown,
> extends UseSettingsFormOptions<TValues, TData, TResult> {
  schema: z.ZodType<TValues, any, any>;
  query: SettingsFormQueryLike<TData>;
  mutation: SettingsFormMutationLike<TValues, TResult>;
}

export interface UseSettingsFormReturn<TValues extends FieldValues, TResult = unknown> {
  form: UseFormReturn<TValues>;
  isDirty: boolean;
  isSubmitting: boolean;
  conflict: SettingsConflictState<TValues> | null;
  stashedDraft: TValues | null;
  submit: (overrideValues?: TValues) => Promise<TResult | undefined>;
  discard: () => void;
  viewLatest: () => Promise<void>;
  adoptLatest: () => void;
  restoreStashedDraft: () => void;
  keepDraft: () => void;
  leaveGuardModal: ReactNode;
}

function isConflictError(err: unknown): boolean {
  if (err instanceof ConflictError) return true;
  if (!err || typeof err !== 'object') return false;
  const candidate = err as { status?: number; kind?: string };
  return candidate.status === 409 || candidate.kind === 'conflict-revision';
}

function extractConflictRevision(err: unknown): number | null {
  if (!err || typeof err !== 'object') return null;
  const candidate = err as {
    currentRevision?: unknown;
    details?: { currentRevision?: unknown };
    raw?: { currentRevision?: unknown; body?: { currentRevision?: unknown } };
  };
  const rev =
    candidate.currentRevision ??
    candidate.details?.currentRevision ??
    candidate.raw?.currentRevision ??
    candidate.raw?.body?.currentRevision;
  const num = Number(rev);
  return Number.isFinite(num) ? num : null;
}

export function useSettingsForm<
  TValues extends FieldValues,
  TData = TValues,
  TResult = unknown,
>(
  schemaOrConfig: z.ZodType<TValues, any, any> | UseSettingsFormConfig<TValues, TData, TResult>,
  queryArg?: SettingsFormQueryLike<TData>,
  mutationArg?: SettingsFormMutationLike<TValues, TResult>,
  optionsArg: UseSettingsFormOptions<TValues, TData, TResult> = {},
): UseSettingsFormReturn<TValues, TResult> {
  const isConfigObj =
    typeof schemaOrConfig === 'object' &&
    schemaOrConfig !== null &&
    'schema' in schemaOrConfig &&
    'query' in schemaOrConfig &&
    'mutation' in schemaOrConfig;

  const schema = isConfigObj
    ? (schemaOrConfig as UseSettingsFormConfig<TValues, TData, TResult>).schema
    : (schemaOrConfig as z.ZodType<TValues, any, any>);
  const query = isConfigObj
    ? (schemaOrConfig as UseSettingsFormConfig<TValues, TData, TResult>).query
    : queryArg!;
  const mutation = isConfigObj
    ? (schemaOrConfig as UseSettingsFormConfig<TValues, TData, TResult>).mutation
    : mutationArg!;
  const options = isConfigObj
    ? (schemaOrConfig as UseSettingsFormConfig<TValues, TData, TResult>)
    : optionsArg;

  const {
    defaultValues,
    toFormValues,
    extraDirty = false,
    identityKey = 'default',
    onSuccess,
    onError,
  } = options;

  const mapData = useCallback(
    (data: TData): TValues => {
      if (toFormValues) return toFormValues(data);
      return data as unknown as TValues;
    },
    [toFormValues],
  );

  const form = useForm<TValues>({
    resolver: createZodResolver(schema),
    defaultValues:
      query?.data !== undefined
        ? (mapData(query.data) as DefaultValues<TValues>)
        : defaultValues,
    mode: 'onChange',
  });

  const [conflict, setConflict] = useState<SettingsConflictState<TValues> | null>(null);
  const [stashedDraft, setStashedDraft] = useState<TValues | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const mountedRef = useRef(true);
  const activeIdentityRef = useRef(identityKey);
  const submitSeqRef = useRef(0);
  const lastSyncedDataRef = useRef<TData | undefined>(query?.data);
  const baselineRef = useRef<TValues | null>(
    query?.data !== undefined ? mapData(query.data) : null,
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Reset draft/baseline/conflict/stash/in-flight ownership if identity changes
  useEffect(() => {
    if (activeIdentityRef.current !== identityKey) {
      activeIdentityRef.current = identityKey;
      submitSeqRef.current += 1;
      setSubmitting(false);
      setConflict(null);
      setStashedDraft(null);
      if (query?.data !== undefined) {
        lastSyncedDataRef.current = query.data;
        const mapped = mapData(query.data);
        baselineRef.current = mapped;
        form.reset(mapped);
      } else {
        lastSyncedDataRef.current = undefined;
        baselineRef.current = null;
        const currentKeys = Object.keys(form.getValues() ?? {});
        const cleared = {
          ...Object.fromEntries(currentKeys.map((k) => [k, undefined])),
          ...(defaultValues ? structuredClone(defaultValues) : {}),
        } as DefaultValues<TValues>;
        form.reset(cleared);
      }
    }
  }, [identityKey, query?.data, mapData, defaultValues, form]);

  const formIsDirty = form.formState.isDirty;
  const isDirty = Boolean(formIsDirty || extraDirty);

  // Sync query data into form when query.data arrives or changes
  useEffect(() => {
    if (query?.data === undefined || query.data === lastSyncedDataRef.current) return;
    const hadBaseline = baselineRef.current !== null;
    lastSyncedDataRef.current = query.data;
    const nextValues = mapData(query.data);
    baselineRef.current = nextValues;
    if (!hadBaseline || (!form.formState.isDirty && !extraDirty && !conflict && !submitting)) {
      form.reset(nextValues);
    }
  }, [query?.data, mapData, extraDirty, conflict, submitting, form]);

  const router = useRouter({ warn: false });
  const leaveGuardModal = router ? createElement(ActiveLeaveGuard, { dirty: isDirty }) : null;

  const discard = useCallback(() => {
    setConflict(null);
    setStashedDraft(null);
    if (baselineRef.current) {
      form.reset(baselineRef.current);
    } else {
      const currentKeys = Object.keys(form.getValues() ?? {});
      const cleared = {
        ...Object.fromEntries(currentKeys.map((k) => [k, undefined])),
        ...(defaultValues ? structuredClone(defaultValues) : {}),
      } as DefaultValues<TValues>;
      form.reset(cleared);
    }
  }, [form, defaultValues]);

  const viewLatest = useCallback(async () => {
    const reqIdentity = activeIdentityRef.current;
    if (query?.refetch) {
      const res = await query.refetch();
      if (!mountedRef.current || activeIdentityRef.current !== reqIdentity) return;
      if (res?.data !== undefined) {
        const currentDraft = structuredClone(form.getValues());
        const latestValues = mapData(res.data);
        baselineRef.current = latestValues;
        setConflict((prev) =>
          prev ? { ...prev, draft: currentDraft, latest: latestValues } : null,
        );
      }
    }
  }, [form, query, mapData]);

  const adoptLatest = useCallback(() => {
    const currentDraft = structuredClone(form.getValues());
    const latestValues = conflict?.latest ?? baselineRef.current;
    setStashedDraft(currentDraft);
    setConflict(null);
    if (latestValues) {
      form.reset(latestValues);
    }
  }, [conflict, form]);

  const restoreStashedDraft = useCallback(() => {
    if (!stashedDraft) return;
    form.reset(stashedDraft, { keepDefaultValues: true });
    setStashedDraft(null);
  }, [form, stashedDraft]);

  const keepDraft = useCallback(() => {
    setConflict(null);
  }, []);

  const submit = useCallback(
    async (overrideValues?: TValues): Promise<TResult | undefined> => {
      if (activeIdentityRef.current !== identityKey || baselineRef.current === null) {
        return undefined;
      }
      const reqIdentity = activeIdentityRef.current;
      const submitId = ++submitSeqRef.current;
      const valuesToValidate = structuredClone(overrideValues ?? form.getValues());
      const parsed = schema.safeParse(valuesToValidate);
      if (!parsed.success) {
        await form.trigger();
        return undefined;
      }
      const submittedValues = structuredClone({
        ...valuesToValidate,
        ...parsed.data,
      }) as TValues;
      const submittedJson = JSON.stringify(valuesToValidate);

      setSubmitting(true);
      try {
        const result = await mutation.mutateAsync(parsed.data);
        if (!mountedRef.current || activeIdentityRef.current !== reqIdentity) {
          return undefined;
        }
        baselineRef.current = submittedValues;
        setConflict(null);
        setStashedDraft(null);

        if (submitId === submitSeqRef.current) {
          const currentValues = structuredClone(form.getValues());
          const hasNewerEdits =
            JSON.stringify(currentValues) !== submittedJson &&
            JSON.stringify(currentValues) !== JSON.stringify(submittedValues);
          if (hasNewerEdits) {
            form.reset(submittedValues);
            for (const [k, v] of Object.entries(currentValues)) {
              if (JSON.stringify(v) !== JSON.stringify((submittedValues as any)[k])) {
                form.setValue(k as any, v as any, { shouldDirty: true });
              }
            }
          } else {
            form.reset(submittedValues);
          }
        }

        onSuccess?.(result, parsed.data);
        return result;
      } catch (err) {
        if (!mountedRef.current || activeIdentityRef.current !== reqIdentity) {
          return undefined;
        }
        if (isConflictError(err)) {
          const message =
            err instanceof Error && err.message
              ? err.message
              : '配置已在其他窗口更新，当前草稿已保留。';
          setConflict({
            message,
            currentRevision: extractConflictRevision(err),
            draft: structuredClone(form.getValues()),
            latest: baselineRef.current ?? undefined,
            raw: err,
          });
        }
        onError?.(err);
        throw err;
      } finally {
        if (
          mountedRef.current &&
          activeIdentityRef.current === reqIdentity &&
          submitId === submitSeqRef.current
        ) {
          setSubmitting(false);
        }
      }
    },
    [form, schema, mutation, identityKey, onSuccess, onError],
  );

  return {
    form,
    isDirty,
    isSubmitting: Boolean(submitting || mutation?.isPending),
    conflict,
    stashedDraft,
    submit,
    discard,
    viewLatest,
    adoptLatest,
    restoreStashedDraft,
    keepDraft,
    leaveGuardModal,
  };
}
