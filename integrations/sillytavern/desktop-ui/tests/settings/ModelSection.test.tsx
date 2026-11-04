import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { RouterProvider } from '@tanstack/react-router';
import { z } from 'zod';
import { AppProviders, queryClient } from '../../src/app/providers';
import { createDesktopRouter } from '../../src/app/router';
import { ConflictError, type AppClient } from '../../src/data/client';
import { SettingsRoute, useSettingsForm } from '../../src/features/settings/SettingsRoute';
import { ModelSection } from '../../src/features/settings/ModelSection';

function installMatchMedia() {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string): MediaQueryList => ({
      media: query,
      matches: query.includes('744') || query.includes('1180'),
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    } as unknown as MediaQueryList)),
  );
}

function makeProviderDto(overrides: Record<string, unknown> = {}) {
  return {
    providerId: 'openai-main',
    displayName: 'OpenAI 主服务',
    protocol: 'OPENAI_CHAT_COMPLETIONS',
    baseUrl: 'https://api.openai.com',
    endpointUrl: 'https://api.openai.com/v1/chat/completions',
    state: 'ENABLED',
    credentialConfigured: true,
    revision: 3,
    updatedAt: '2026-11-04T08:00:00Z',
    models: [
      {
        profileKey: 'gpt-4o',
        modelId: 'gpt-4o',
        displayName: 'GPT-4o',
        contextWindowTokens: 128000,
        maxOutputTokens: 4096,
        state: 'ENABLED',
        reasoningLevels: [],
        generationParams: {
          reasoningEffort: '',
          temperature: 0.7,
          topP: 1,
        },
        capabilities: {
          imageInput: 'UNSUPPORTED',
          videoInput: 'UNSUPPORTED',
          pdfInput: 'UNSUPPORTED',
          structuredOutput: 'UNSUPPORTED',
          toolCalls: 'DECLARED',
          nativeWebSearch: 'UNSUPPORTED',
          systemMessage: 'DECLARED',
          temperature: 'DECLARED',
          topP: 'DECLARED',
        },
        pricing: {
          currency: 'USD',
          inputPerMillionTokens: 2.5,
          outputPerMillionTokens: 10,
        },
      },
    ],
    ...overrides,
  };
}

function createModelTestClient(overrides: Partial<AppClient['go']> = {}): AppClient {
  let storedProviders = [makeProviderDto()];
  return {
    characters: vi.fn(async () => []),
    recent: vi.fn(async () => []),
    go: {
      captureSessionContext: vi.fn(async () => ({ accountId: '1', sessionId: '2' })),
      fetchProviders: vi.fn(async () => storedProviders),
      fetchModelPurposes: vi.fn(async () => [
        {
          purpose: 'FOREGROUND_CHAT',
          providerId: 'openai-main',
          profileKey: 'gpt-4o',
          state: 'ENABLED',
          status: 'READY',
          revision: 1,
          updatedAt: '2026-11-04T08:00:00Z',
        },
      ]),
      fetchLocalModels: vi.fn(async () => ({
        embedding: { model: 'qwen3-embedding:0.6b', healthy: true },
        rerank: { model: 'bge-reranker-v2-m3', healthy: true, enabled: true, revision: 1 },
      })),
      fetchUsageSummary: vi.fn(async (month: string) => ({
        month,
        purposes: [],
      })),
      saveProvider: vi.fn(async (providerId: string, body: Record<string, unknown>) => {
        const nextRevision = Number(body.expectedRevision || 3) + 1;
        storedProviders = storedProviders.map((p) =>
          p.providerId === providerId
            ? makeProviderDto({
                ...p,
                displayName: body.displayName,
                baseUrl: body.baseUrl,
                state: body.state,
                revision: nextRevision,
                credentialConfigured: body.clearCredential
                  ? false
                  : Boolean(body.credential) || p.credentialConfigured,
              })
            : p,
        );
        return { ok: true, revision: nextRevision };
      }),
      saveModelPurpose: vi.fn(async () => ({})),
      saveLocalModelRerank: vi.fn(async ({ enabled }: { enabled: boolean }) => ({
        enabled,
        revision: 2,
      })),
      discoverProviderModels: vi.fn(async () => []),
      verifyModelToolCalls: vi.fn(async () => ({})),
      reauth: vi.fn(async () => ({ ok: true })),
      ...overrides,
    },
  } as unknown as AppClient;
}

describe('ModelSection & SettingsRoute', () => {
  beforeEach(() => {
    installMatchMedia();
    queryClient.clear();
    window.localStorage.clear();
    window.history.replaceState(null, '', '/');
    window.location.hash = '';
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('unsaved provider edit blocks category switch', async () => {
    const client = createModelTestClient();
    const router = createDesktopRouter({
      routeOverrides: {
        settings: SettingsRoute,
      },
    });

    render(
      <AppProviders client={client}>
        <RouterProvider router={router} />
      </AppProviders>,
    );

    await act(async () => {
      await router.navigate({ to: '/settings/$category', params: { category: 'model' } });
    });

    const displayInput = (await screen.findByLabelText('显示名称')) as HTMLInputElement;
    expect(displayInput.value).toBe('OpenAI 主服务');

    fireEvent.change(displayInput, { target: { value: '未保存的新名称' } });
    expect(displayInput.value).toBe('未保存的新名称');

    // Attempt to switch category to 'appearance' via SettingsNav
    const appearanceNavBtn = screen.getByRole('button', { name: '外观' });
    fireEvent.click(appearanceNavBtn);

    // Leave guard AlertDialog must block navigation
    const alertTitle = await screen.findByText('放弃更改？');
    expect(alertTitle).toBeTruthy();
    expect(router.state.location.pathname).toBe('/settings/model');

    // Stay on page ("继续编辑") keeps draft
    fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
    await waitFor(() => {
      expect(screen.queryByText('放弃更改？')).toBeNull();
    });
    expect(router.state.location.pathname).toBe('/settings/model');
    expect((screen.getByLabelText('显示名称') as HTMLInputElement).value).toBe('未保存的新名称');

    // Confirm discard ("放弃") proceeds to /settings/appearance
    fireEvent.click(screen.getByRole('button', { name: '外观' }));
    await screen.findByText('放弃更改？');
    fireEvent.click(screen.getByRole('button', { name: '放弃' }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/settings/appearance');
    });
  });

  it('409 keeps draft', async () => {
    const saveProvider = vi.fn(async () => {
      throw new ConflictError('配置已在其他窗口更新', {
        kind: 'conflict-revision',
        code: 'REVISION_CONFLICT',
        details: { currentRevision: 5 },
      });
    });
    const client = createModelTestClient({ saveProvider });

    render(
      <AppProviders client={client}>
        <ModelSection />
      </AppProviders>,
    );

    const displayInput = (await screen.findByLabelText('显示名称')) as HTMLInputElement;
    expect(displayInput.value).toBe('OpenAI 主服务');

    fireEvent.change(displayInput, { target: { value: '我的冲突草稿名称' } });

    const saveBtn = document.getElementById('vcms-save')!;
    expect(saveBtn).toBeTruthy();
    fireEvent.click(saveBtn);

    const conflictAlert = await screen.findByText(/配置已在其他窗口更新|已在另一处更新/);
    expect(conflictAlert).toBeTruthy();
    expect(screen.getByText(/v5/)).toBeTruthy();

    // User's draft must remain intact and NOT be overwritten
    expect((screen.getByLabelText('显示名称') as HTMLInputElement).value).toBe('我的冲突草稿名称');
    expect(client.go.discoverProviderModels).not.toHaveBeenCalled();
  });

  it('key tri-state: unset/configured/clear', async () => {
    let providerRows = [
      makeProviderDto({
        providerId: 'provider-unset',
        displayName: '未配密钥服务',
        state: 'DISABLED',
        credentialConfigured: false,
      }),
      makeProviderDto({
        providerId: 'provider-configured',
        displayName: '已配密钥服务',
        state: 'ENABLED',
        credentialConfigured: true,
      }),
    ];

    const saveProvider = vi.fn(async (providerId: string, body: Record<string, unknown>) => {
      const nextRevision = Number(body.expectedRevision || 3) + 1;
      providerRows = providerRows.map((p) =>
        p.providerId === providerId
          ? makeProviderDto({
              ...p,
              displayName: body.displayName as string,
              baseUrl: body.baseUrl as string,
              state: body.state as string,
              revision: nextRevision,
              credentialConfigured: body.clearCredential
                ? false
                : Boolean(body.credential) || p.credentialConfigured,
            })
          : p,
      );
      return { ok: true, revision: nextRevision };
    });

    const client = createModelTestClient({
      fetchProviders: vi.fn(async () => providerRows),
      saveProvider,
    });

    const { container } = render(
      <AppProviders client={client}>
        <ModelSection />
      </AppProviders>,
    );

    // 1. Unset state on provider-unset: saving disabled draft without key sends neither credential nor clearCredential
    const displayInput = (await screen.findByLabelText('显示名称')) as HTMLInputElement;
    expect(displayInput.value).toBe('未配密钥服务');
    const keyInputUnset = container.querySelector<HTMLInputElement>('#vcms-f-key');
    expect(keyInputUnset).toBeTruthy();

    fireEvent.change(displayInput, { target: { value: '未配密钥服务-草稿' } });
    fireEvent.click(container.querySelector<HTMLElement>('#vcms-save')!);

    await waitFor(() => {
      expect(saveProvider).toHaveBeenCalledTimes(1);
    });
    expect(saveProvider.mock.calls[0][1]).not.toHaveProperty('credential');
    expect(saveProvider.mock.calls[0][1]).not.toHaveProperty('clearCredential');
    expect(client.go.discoverProviderModels).not.toHaveBeenCalled();

    // 2. Select provider-configured: shows configured state ('已配置'), replace & clear actions
    const configuredCard = container.querySelector<HTMLElement>(
      '[data-action="select-provider"][data-id="provider-configured"]',
    )!;
    fireEvent.click(configuredCard);

    await waitFor(() => {
      expect((screen.getByLabelText('显示名称') as HTMLInputElement).value).toBe('已配密钥服务');
    });
    expect(container.querySelector('#vcms-f-key')).toBeNull();

    // Replace key -> enters will-replace state, undo returns to keep
    fireEvent.click(container.querySelector<HTMLElement>('[data-action="key-replace"]')!);
    const replaceInput = container.querySelector<HTMLInputElement>('#vcms-f-key')!;
    expect(replaceInput).toBeTruthy();
    fireEvent.change(replaceInput, { target: { value: 'sk-new-secret-12345' } });
    fireEvent.click(container.querySelector<HTMLElement>('[data-action="key-undo"]')!);
    expect(container.querySelector('#vcms-f-key')).toBeNull();

    // 3. Clear key -> confirm clear -> will-clear state -> save sends clearCredential: true and state: DISABLED
    fireEvent.click(container.querySelector<HTMLElement>('[data-action="key-clear"]')!);
    const confirmClearBtn = container.querySelector<HTMLElement>('[data-action="key-clear-confirm"]')!;
    expect(confirmClearBtn).toBeTruthy();
    fireEvent.click(confirmClearBtn);

    expect(screen.getByText('保存后清除密钥')).toBeTruthy();

    fireEvent.click(container.querySelector<HTMLElement>('#vcms-save')!);
    await waitFor(() => {
      expect(saveProvider).toHaveBeenCalledTimes(2);
    });
    expect(saveProvider.mock.calls[1][0]).toBe('provider-configured');
    expect(saveProvider.mock.calls[1][1]).toMatchObject({
      clearCredential: true,
      state: 'DISABLED',
    });
    expect(saveProvider.mock.calls[1][1]).not.toHaveProperty('credential');
    expect(client.go.discoverProviderModels).not.toHaveBeenCalled();
  });

  it('purpose save uses returned revision when providers refetch resolves after purposes', async () => {
    let currentPurpose = {
      purpose: 'FOREGROUND_CHAT',
      providerId: 'openai-main',
      profileKey: 'gpt-4o',
      state: 'ENABLED',
      status: 'READY',
      revision: 1,
      updatedAt: '2026-11-04T08:00:00Z',
    };

    let fetchProvidersCallCount = 0;
    const fetchProviders = vi.fn(async () => {
      fetchProvidersCallCount += 1;
      if (fetchProvidersCallCount > 1) {
        await new Promise((r) => setTimeout(r, 35));
      }
      return [makeProviderDto()];
    });

    const fetchModelPurposes = vi.fn(async () => [{ ...currentPurpose }]);

    const saveModelPurpose = vi.fn(async (purpose: string, body: Record<string, unknown>) => {
      if (Number(body.expectedRevision) !== currentPurpose.revision) {
        throw new ConflictError('用途绑定已在另一处更新', {
          kind: 'conflict-revision',
          code: 'REVISION_CONFLICT',
          details: { currentRevision: currentPurpose.revision },
        });
      }
      currentPurpose = {
        ...currentPurpose,
        purpose,
        providerId: String(body.providerId ?? ''),
        profileKey: String(body.profileKey ?? ''),
        state: String(body.state ?? 'ENABLED'),
        revision: currentPurpose.revision + 1,
        updatedAt: '2026-11-04T09:00:00Z',
      };
      return { ...currentPurpose };
    });

    const client = createModelTestClient({
      fetchProviders,
      fetchModelPurposes,
      saveModelPurpose,
    });

    const { container } = render(
      <AppProviders client={client}>
        <ModelSection />
      </AppProviders>,
    );

    await screen.findByLabelText('显示名称');

    // Switch to bindings tab
    const bindingsTab = container.querySelector<HTMLElement>(
      '[data-action="tab"][data-tab="bindings"]',
    )!;
    fireEvent.click(bindingsTab);

    const stateCheckbox = (await waitFor(() => {
      const el = container.querySelector<HTMLInputElement>(
        'input[data-bind="bindingState.FOREGROUND_CHAT"]',
      );
      expect(el).toBeTruthy();
      return el!;
    })) as HTMLInputElement;
    expect(stateCheckbox.checked).toBe(true);

    // First edit & save (revision 1 -> 2)
    fireEvent.click(stateCheckbox);
    expect(stateCheckbox.checked).toBe(false);

    const saveBindingsBtn = container.querySelector<HTMLElement>('[data-action="save-bindings"]')!;
    fireEvent.click(saveBindingsBtn);

    await waitFor(() => {
      expect(saveModelPurpose).toHaveBeenCalledTimes(1);
      expect(container.querySelector('[data-action="save-bindings"]')).toBeNull();
    });
    expect(saveModelPurpose.mock.calls[0][1]).toMatchObject({
      expectedRevision: 1,
      state: 'DISABLED',
    });

    // Second edit & save (must use revision 2, not stale revision 1)
    const stateCheckboxAfter = container.querySelector<HTMLInputElement>(
      'input[data-bind="bindingState.FOREGROUND_CHAT"]',
    )!;
    fireEvent.click(stateCheckboxAfter);
    expect(stateCheckboxAfter.checked).toBe(true);

    const saveBindingsBtn2 = container.querySelector<HTMLElement>('[data-action="save-bindings"]')!;
    fireEvent.click(saveBindingsBtn2);

    await waitFor(() => {
      expect(saveModelPurpose).toHaveBeenCalledTimes(2);
      expect(container.querySelector('[data-action="save-bindings"]')).toBeNull();
    });
    expect(saveModelPurpose.mock.calls[1][1]).toMatchObject({
      expectedRevision: 2,
      state: 'ENABLED',
    });
    expect(container.querySelector('.vcms-binding-errorrow')).toBeNull();
  });

  it('409 conflict-view-latest preserves edits made while refetch is pending', async () => {
    let fetchCount = 0;
    let resolveRefetch!: (rows: any[]) => void;

    const fetchProviders = vi.fn(() => {
      fetchCount += 1;
      if (fetchCount === 1) {
        return Promise.resolve([makeProviderDto({ revision: 3 })]);
      }
      return new Promise<any[]>((resolve) => {
        resolveRefetch = resolve;
      });
    });

    const saveProvider = vi.fn(async () => {
      throw new ConflictError('配置已在其他窗口更新', {
        kind: 'conflict-revision',
        code: 'REVISION_CONFLICT',
        details: { currentRevision: 5 },
      });
    });

    const client = createModelTestClient({
      fetchProviders,
      saveProvider,
    });

    const { container } = render(
      <AppProviders client={client}>
        <ModelSection />
      </AppProviders>,
    );

    const displayInput = (await screen.findByLabelText('显示名称')) as HTMLInputElement;
    fireEvent.change(displayInput, { target: { value: '草稿V1' } });
    fireEvent.click(container.querySelector<HTMLElement>('#vcms-save')!);

    await screen.findByText(/v5/);

    // Click "查看最新" -> starts async refetch
    const viewLatestBtn = container.querySelector<HTMLElement>(
      '[data-action="conflict-view-latest"]',
    )!;
    fireEvent.click(viewLatestBtn);

    // While refetch is pending, user edits displayName and model displayName
    fireEvent.change(screen.getByLabelText('显示名称'), {
      target: { value: '等待期间继续修改的草稿V2' },
    });
    const modelDisplayInput = container.querySelector<HTMLInputElement>('#vcms-m-display')!;
    fireEvent.change(modelDisplayInput, {
      target: { value: '等待期间模型名V2' },
    });

    // Now resolve the refetch with server's revision 5
    await act(async () => {
      resolveRefetch([
        makeProviderDto({
          displayName: '远端最新名称',
          revision: 5,
        }),
      ]);
    });

    await waitFor(() => {
      expect((screen.getByLabelText('显示名称') as HTMLInputElement).value).toBe('远端最新名称');
    });

    // Click "恢复未保存的草稿" -> must restore the latest draft ('等待期间继续修改的草稿V2' & '等待期间模型名V2')
    const restoreBtn = container.querySelector<HTMLElement>('[data-action="restore-stash"]')!;
    expect(restoreBtn).toBeTruthy();
    fireEvent.click(restoreBtn);

    expect((screen.getByLabelText('显示名称') as HTMLInputElement).value).toBe(
      '等待期间继续修改的草稿V2',
    );
    expect(container.querySelector<HTMLInputElement>('#vcms-m-display')!.value).toBe(
      '等待期间模型名V2',
    );
  });

  it('useSettingsForm preserves in-flight edits on save ACK and discards late ACK after identity switch', async () => {
    const schema = z.object({
      title: z.string().min(1),
    });
    type FormValues = z.infer<typeof schema>;

    let resolveSave!: (res: { ok: boolean }) => void;
    const mutateAsync = vi.fn(
      () =>
        new Promise<{ ok: boolean }>((resolve) => {
          resolveSave = resolve;
        }),
    );

    function TestFormHarness({
      data,
      identityKey,
    }: {
      data: FormValues;
      identityKey: string;
    }) {
      const sf = useSettingsForm(
        schema,
        { data },
        { mutateAsync },
        { identityKey },
      );
      const val = sf.form.watch('title') ?? '';
      return (
        <div>
          <input
            aria-label="表单标题"
            value={val}
            onChange={(e) =>
              sf.form.setValue('title', e.currentTarget.value, { shouldDirty: true })
            }
          />
          <span data-testid="dirty-flag">{String(sf.isDirty)}</span>
          <button type="button" onClick={() => void sf.submit()}>
            提交表单
          </button>
          <button type="button" onClick={() => sf.discard()}>
            放弃表单
          </button>
        </div>
      );
    }

    const client = createModelTestClient();
    const { rerender } = render(
      <AppProviders client={client}>
        <TestFormHarness data={{ title: '初始标题' }} identityKey="acc-1" />
      </AppProviders>,
    );

    const input = screen.getByLabelText('表单标题') as HTMLInputElement;
    expect(input.value).toBe('初始标题');
    expect(screen.getByTestId('dirty-flag').textContent).toBe('false');

    // Edit to '第一次提交值' and start submit
    fireEvent.change(input, { target: { value: '第一次提交值' } });
    expect(screen.getByTestId('dirty-flag').textContent).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '提交表单' }));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({ title: '第一次提交值' });
    });

    // While submit is pending, user types a newer value
    fireEvent.change(input, { target: { value: '保存期间的新输入' } });
    expect(input.value).toBe('保存期间的新输入');

    // Resolve the first save ACK
    await act(async () => {
      resolveSave({ ok: true });
    });

    // Newer input must remain visible and dirty must stay true
    expect((screen.getByLabelText('表单标题') as HTMLInputElement).value).toBe('保存期间的新输入');
    expect(screen.getByTestId('dirty-flag').textContent).toBe('true');

    // Discarding now resets to the newly confirmed baseline ('第一次提交值'), not '初始标题'
    fireEvent.click(screen.getByRole('button', { name: '放弃表单' }));
    await waitFor(() => {
      expect((screen.getByLabelText('表单标题') as HTMLInputElement).value).toBe('第一次提交值');
      expect(screen.getByTestId('dirty-flag').textContent).toBe('false');
    });

    // Now test late ACK after identity switch
    fireEvent.change(screen.getByLabelText('表单标题'), {
      target: { value: '旧账号待保存草稿' },
    });
    fireEvent.click(screen.getByRole('button', { name: '提交表单' }));
    const resolveOldIdentitySave = resolveSave;

    rerender(
      <AppProviders client={client}>
        <TestFormHarness data={{ title: '新账号初始值' }} identityKey="acc-2" />
      </AppProviders>,
    );

    await waitFor(() => {
      expect((screen.getByLabelText('表单标题') as HTMLInputElement).value).toBe('新账号初始值');
      expect(screen.getByTestId('dirty-flag').textContent).toBe('false');
    });

    await act(async () => {
      resolveOldIdentitySave({ ok: true });
    });

    expect((screen.getByLabelText('表单标题') as HTMLInputElement).value).toBe('新账号初始值');
    expect(screen.getByTestId('dirty-flag').textContent).toBe('false');
  });

  it('useSettingsForm clears old draft and blocks submit when switching identity into loading state (data=undefined)', async () => {
    const schema = z.object({
      title: z.string().min(1),
    });
    type FormValues = z.infer<typeof schema>;

    const pendingResolvers: Array<(res: { ok: boolean }) => void> = [];
    const mutateAsync = vi.fn(
      () =>
        new Promise<{ ok: boolean }>((resolve) => {
          pendingResolvers.push(resolve);
        }),
    );

    function TestLoadingIdentityHarness({
      data,
      isLoading = false,
      identityKey,
    }: {
      data?: FormValues;
      isLoading?: boolean;
      identityKey: string;
    }) {
      const sf = useSettingsForm(
        schema,
        { data, isLoading },
        { mutateAsync },
        { identityKey },
      );
      const val = sf.form.watch('title') ?? '';
      return (
        <div>
          <input
            aria-label="跨账号表单标题"
            value={val}
            onChange={(e) =>
              sf.form.setValue('title', e.currentTarget.value, { shouldDirty: true })
            }
          />
          <span data-testid="loading-dirty-flag">{String(sf.isDirty)}</span>
          <button type="button" onClick={() => void sf.submit()}>
            提交跨账号表单
          </button>
        </div>
      );
    }

    const client = createModelTestClient();
    const { rerender } = render(
      <AppProviders client={client}>
        <TestLoadingIdentityHarness
          data={{ title: '账号1基线' }}
          isLoading={false}
          identityKey="acc-1"
        />
      </AppProviders>,
    );

    const input = screen.getByLabelText('跨账号表单标题') as HTMLInputElement;
    expect(input.value).toBe('账号1基线');

    // Make acc-1 dirty and start an in-flight save on acc-1, then edit acc-1 again
    fireEvent.change(input, { target: { value: '账号1在途提交值' } });
    fireEvent.click(screen.getByRole('button', { name: '提交跨账号表单' }));
    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(mutateAsync).toHaveBeenLastCalledWith({ title: '账号1在途提交值' });

    fireEvent.change(input, { target: { value: '账号1未提交脏草稿' } });
    expect(input.value).toBe('账号1未提交脏草稿');
    expect(screen.getByTestId('loading-dirty-flag').textContent).toBe('true');

    // Switch to acc-2 where TanStack Query first frame has data=undefined, isLoading=true
    rerender(
      <AppProviders client={client}>
        <TestLoadingIdentityHarness
          data={undefined}
          isLoading={true}
          identityKey="acc-2"
        />
      </AppProviders>,
    );

    // Immediately: old acc-1 draft must NOT be visible and dirty must be false
    expect((screen.getByLabelText('跨账号表单标题') as HTMLInputElement).value).toBe('');
    expect(screen.getByTestId('loading-dirty-flag').textContent).toBe('false');

    // Attempting to submit while acc-2 has no real baseline yet must NOT call mutation
    fireEvent.click(screen.getByRole('button', { name: '提交跨账号表单' }));
    expect(mutateAsync).toHaveBeenCalledTimes(1);

    // Late ACK from acc-1 arrives while acc-2 is still loading -> must NOT pollute acc-2
    await act(async () => {
      pendingResolvers[0]({ ok: true });
    });
    expect((screen.getByLabelText('跨账号表单标题') as HTMLInputElement).value).toBe('');
    expect(screen.getByTestId('loading-dirty-flag').textContent).toBe('false');

    // Now acc-2 data arrives -> must initialize acc-2 baseline reliably
    rerender(
      <AppProviders client={client}>
        <TestLoadingIdentityHarness
          data={{ title: '账号2真实初始值' }}
          isLoading={false}
          identityKey="acc-2"
        />
      </AppProviders>,
    );

    await waitFor(() => {
      expect((screen.getByLabelText('跨账号表单标题') as HTMLInputElement).value).toBe(
        '账号2真实初始值',
      );
      expect(screen.getByTestId('loading-dirty-flag').textContent).toBe('false');
    });

    // Submitting on acc-2 now submits only acc-2 value
    fireEvent.change(screen.getByLabelText('跨账号表单标题'), {
      target: { value: '账号2新修改值' },
    });
    fireEvent.click(screen.getByRole('button', { name: '提交跨账号表单' }));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledTimes(2);
      expect(mutateAsync).toHaveBeenLastCalledWith({ title: '账号2新修改值' });
    });
  });
});
