import React, { useState } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { AppProviders } from '../../src/app/providers';
import type { AppClient } from '../../src/data/client';
import { ReauthDialog } from '../../src/features/inbox/ReauthDialog';

describe('ReauthDialog', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('password cleared on close; failure keeps draft', async () => {
    let shouldFail = true;
    const reauth = vi.fn(async (password: string) => {
      if (shouldFail || password !== 'correct-pass') {
        const err = new Error('密码错误，请重新输入');
        (err as Error & { status?: number }).status = 401;
        throw err;
      }
      return { ok: true };
    });

    const client: AppClient = {
      initialize: vi.fn(async () => ({ characters: [], chat: [], settings: {} })),
      go: {
        captureSessionContext: vi.fn(() => ({ userId: 'u-1', sessionId: 's-1' })),
        reauth,
      },
    } as unknown as AppClient;

    const onSuccess = vi.fn();

    function ReauthHarness() {
      const [open, setOpen] = useState(true);
      const [callerDraft, setCallerDraft] = useState('待保存的敏感修改草稿');

      return (
        <AppProviders client={client}>
          <div>
            <input
              aria-label="外部草稿"
              value={callerDraft}
              onChange={(e) => setCallerDraft(e.target.value)}
            />
            <button type="button" onClick={() => setOpen(true)}>
              打开重验
            </button>
            <ReauthDialog
              open={open}
              onOpenChange={setOpen}
              onSuccess={onSuccess}
            />
          </div>
        </AppProviders>
      );
    }

    render(<ReauthHarness />);

    const pwdInput = (await waitFor(() => screen.getByLabelText('当前密码'))) as HTMLInputElement;
    fireEvent.change(pwdInput, { target: { value: 'wrong-pass' } });
    expect(pwdInput.value).toBe('wrong-pass');

    fireEvent.click(screen.getByRole('button', { name: '确认验证' }));

    await waitFor(() => {
      expect(reauth).toHaveBeenCalledWith('wrong-pass');
      expect(screen.getByText(/密码错误/)).toBeTruthy();
    });

    // Caller draft is untouched on failure
    expect((screen.getByLabelText('外部草稿') as HTMLInputElement).value).toBe('待保存的敏感修改草稿');

    // Close dialog -> password must be cleared
    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    // Reopen dialog -> password field must be empty
    fireEvent.click(screen.getByRole('button', { name: '打开重验' }));
    const reopenedInput = (await waitFor(() => screen.getByLabelText('当前密码'))) as HTMLInputElement;
    expect(reopenedInput.value).toBe('');

    // Succeed on valid password
    shouldFail = false;
    fireEvent.change(reopenedInput, { target: { value: 'correct-pass' } });
    fireEvent.click(screen.getByRole('button', { name: '确认验证' }));

    await waitFor(() => {
      expect(reauth).toHaveBeenCalledWith('correct-pass');
      expect(onSuccess).toHaveBeenCalledTimes(1);
    });
  });
});
