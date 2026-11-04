import { useEffect, useState } from 'react';
import { z } from 'zod';
import { Dialog } from '../../design/components/Dialog';
import { Field } from '../../design/components/Field';
import { TextInput } from '../../design/components/TextInput';
import { Button } from '../../design/components/Button';
import { useReauth } from '../../data/queries/inbox';

const reauthSchema = z.object({
  password: z.string().min(1, '请输入当前密码'),
});

export interface ReauthDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void | Promise<void>;
  title?: string;
  description?: string;
}

export function ReauthDialog({
  open,
  onOpenChange,
  onSuccess,
  title = '验证身份',
  description = '为保护敏感数据，请输入当前登录密码以继续此操作。',
}: ReauthDialogProps) {
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const reauthMutation = useReauth();

  useEffect(() => {
    if (!open) {
      setPassword('');
      setErrorMessage(null);
    }
  }, [open]);

  const handleClose = (nextOpen: boolean) => {
    if (!nextOpen) {
      setPassword('');
      setErrorMessage(null);
    }
    onOpenChange(nextOpen);
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const parsed = reauthSchema.safeParse({ password });
    if (!parsed.success) {
      setErrorMessage(parsed.error.issues[0]?.message ?? '请输入当前密码');
      return;
    }
    setErrorMessage(null);
    try {
      await reauthMutation.mutateAsync(parsed.data.password);
      setPassword('');
      onOpenChange(false);
      await onSuccess?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '身份验证未完成，请检查密码后重试。';
      setErrorMessage(msg || '身份验证未完成，请检查密码后重试。');
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={handleClose}
      title={title}
      description={description}
      width={420}
      actions={
        <>
          <Button
            variant="gray"
            disabled={reauthMutation.isPending}
            onClick={() => handleClose(false)}
          >
            取消
          </Button>
          <Button
            variant="filled"
            pending={reauthMutation.isPending}
            onClick={() => void handleSubmit()}
          >
            确认验证
          </Button>
        </>
      }
    >
      <form
        className="vc-reauth-form"
        onSubmit={(e) => {
          void handleSubmit(e);
        }}
      >
        <Field label="当前密码" error={errorMessage ?? undefined}>
          <TextInput
            aria-label="当前密码"
            type="password"
            autoComplete="current-password"
            value={password}
            onValueChange={(val) => {
              setPassword(val);
              if (errorMessage) setErrorMessage(null);
            }}
            disabled={reauthMutation.isPending}
          />
        </Field>
      </form>
    </Dialog>
  );
}
