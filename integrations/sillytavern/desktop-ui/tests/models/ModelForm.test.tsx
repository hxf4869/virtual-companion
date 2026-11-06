import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ModelForm } from '../../src/features/models/ModelForm';
import {
  REASONING_LEVELS,
  extraReasoningLevels,
  reasoningLevelLabel,
  reasoningLevelPresets,
} from '../../../extension/vc-model-settings/model-logic.js';
import { resolveForegroundProjection } from '../../../extension/vc-model-settings/projection.js';
import { projectModelSettings } from '../../../extension/vc-model-settings/desktop/standalone/engine/runtime.js';

function makeModelDraft(overrides: Record<string, unknown> = {}) {
  return {
    profileKey: 'gpt-4o',
    modelId: 'gpt-4o',
    displayName: 'GPT-4o',
    contextWindowTokens: 128000,
    maxOutputTokens: 4096,
    reasoningLevels: ['low', 'high'],
    generationParams: {
      reasoningEffort: 'high',
      temperature: 0.7,
      topP: 1,
    },
    pricing: {
      currency: 'USD',
      inputPerMillionTokens: 2.5,
      outputPerMillionTokens: 10,
    },
    ...overrides,
  };
}

describe('ModelForm reasoning levels (MB2-2a)', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders 可用思考档位, 思考深度, 模型默认, and 5 presets for standard models', () => {
    const model = makeModelDraft();
    const presets = reasoningLevelPresets(model);
    const { container } = render(
      <ModelForm
        desktop={true}
        sprite=""
        model={model}
        errors={{}}
        ledger={{ status: 'OK', copy: '' }}
        shared=""
        contextMissing={false}
        advancedOpen={true}
        reasoning={presets.map((id: string) => ({ id, label: reasoningLevelLabel(id) }))}
        extraReasoning={extraReasoningLevels(model.reasoningLevels, presets)}
        capabilities={[]}
        capabilityStates={[]}
        currencies={[]}
        pricingLabel="未配置"
        verification={{
          busy: false,
          error: '',
          verifiedNote: '',
          note: '',
          hint: '',
          action: '',
        }}
        deleting={false}
        deleteDisabled={false}
        events={{
          disabled: false,
          onAction: vi.fn(),
          onEdit: vi.fn(),
        }}
        onAdvancedChange={vi.fn()}
      />,
    );

    expect(screen.getByText('可用思考档位')).toBeTruthy();
    expect(screen.getByLabelText('思考深度')).toBeTruthy();

    const presetInputs = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[data-bind="model.reasoningLevels"]'),
    );
    expect(presetInputs.map((el) => el.value)).toEqual(['none', 'low', 'medium', 'high', 'max']);
    expect(presetInputs.map((el) => el.parentElement?.textContent?.trim())).toEqual([
      '不思考',
      '低',
      '中',
      '高',
      '最高',
    ]);

    const effortSelect = container.querySelector<HTMLSelectElement>('#vcms-m-effort')!;
    expect(effortSelect.options[0]?.value).toBe('');
    expect(effortSelect.options[0]?.textContent).toBe('模型默认');
  });

  it('excludes medium preset for the three DeepSeek model IDs while preserving saved extended levels', () => {
    for (const modelId of ['deepseek-v4-pro', 'deepseek-flash', 'relay/deepseek-v4.1-flash-1017']) {
      const model = makeModelDraft({
        profileKey: 'ds',
        modelId,
        reasoningLevels: ['none', 'high', 'medium', 'minimal'],
      });
      const onEdit = vi.fn();
      const { container, unmount } = render(
        <ModelForm
          desktop={true}
          sprite=""
          model={model}
          errors={{}}
          ledger={{ status: 'OK', copy: '' }}
          shared=""
          contextMissing={false}
          advancedOpen={true}
          reasoning={REASONING_LEVELS.map((id: string) => ({ id, label: reasoningLevelLabel(id) }))}
          extraReasoning={extraReasoningLevels(model.reasoningLevels)}
          capabilities={[]}
          capabilityStates={[]}
          currencies={[]}
          pricingLabel="未配置"
          verification={{
            busy: false,
            error: '',
            verifiedNote: '',
            note: '',
            hint: '',
            action: '',
          }}
          deleting={false}
          deleteDisabled={false}
          events={{
            disabled: false,
            onAction: vi.fn(),
            onEdit,
          }}
          onAdvancedChange={vi.fn()}
        />,
      );

      const presetInputs = Array.from(
        container.querySelectorAll<HTMLInputElement>('input[data-bind="model.reasoningLevels"]'),
      );
      expect(presetInputs.map((el) => el.value)).toEqual(['none', 'low', 'high', 'max']);

      const disabledExtras = Array.from(
        container.querySelectorAll<HTMLInputElement>('.vcms-check input[disabled][checked]'),
      );
      expect(disabledExtras.map((el) => el.parentElement?.textContent?.trim())).toEqual([
        'medium',
        'minimal',
      ]);

      const highCheckbox = container.querySelector<HTMLInputElement>(
        'input[data-bind="model.reasoningLevels"][value="high"]',
      )!;
      fireEvent.click(highCheckbox);
      expect(onEdit).toHaveBeenCalledWith('model.reasoningLevels', 'high', false);
      unmount();
    }
  });

  it('projects custom model reasoning_effort as pinned.reasoningEffort ?? auto in standalone engine projectModelSettings', () => {
    const oai = {
      chat_completion_source: 'openai',
      custom_url: '',
      reverse_proxy: '',
      custom_model: '',
      claude_model: '',
      openai_max_context: 4096,
      openai_max_tokens: 512,
      temp_openai: 1,
      top_p_openai: 1,
      reasoning_effort: 'none',
    };
    const providers = [
      {
        providerId: 'main-relay',
        displayName: '主中转',
        protocol: 'OPENAI_CHAT_COMPLETIONS',
        baseUrl: 'https://relay.example.com/v1',
        credentialConfigured: true,
        state: 'ENABLED',
        revision: 12,
        models: [
          {
            profileKey: 'daily-chat',
            modelId: 'vendor/daily-chat',
            displayName: '日常对话',
            contextWindowTokens: 128000,
            maxOutputTokens: 8192,
            state: 'ENABLED',
            generationParams: {
              temperature: 0.8,
              topP: 0.95,
              reasoningEffort: 'max',
            } as Record<string, unknown>,
          },
        ],
      },
    ];
    const purposes = [
      {
        purpose: 'FOREGROUND_CHAT',
        providerId: 'main-relay',
        profileKey: 'daily-chat',
        state: 'ENABLED',
        status: 'READY',
        revision: 8,
      },
    ];

    let decision = resolveForegroundProjection(purposes, providers);
    projectModelSettings({ main_api: 'koboldhorde', oai_settings: oai }, decision);
    expect(oai.reasoning_effort).toBe('max');

    delete providers[0].models[0].generationParams.reasoningEffort;
    decision = resolveForegroundProjection(purposes, providers);
    projectModelSettings({ main_api: 'openai', oai_settings: oai }, decision);
    expect(oai.reasoning_effort).toBe('auto');
  });
});
