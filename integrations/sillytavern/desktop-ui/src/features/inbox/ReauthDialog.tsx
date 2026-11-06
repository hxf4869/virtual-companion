import { type FormEvent } from 'react';
import { Dialog } from '../../design/components/Dialog';
import { Field } from '../../design/components/Field';
import { TextInput } from '../../design/components/TextInput';
import { Button } from '../../design/components/Button';
import {
  reauthSchema,
  useReauthDialog,
  type UseReauthDialogOptions,
} from './useInbox';

export { reauthSchema, useReauthDialog, type UseReauthDialogOptions };

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
  const {
    password,
    setPassword,
    errorMessage,
    isPending,
    handleClose,
    submit,
  } = useReauthDialog({ open, onOpenChange, onSuccess });

  const handleSubmit = async (e?: FormEvent) => {
    e?.preventDefault();
    await submit();
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
            disabled={isPending}
            onClick={() => handleClose(false)}
          >
            取消
          </Button>
          <Button
            variant="filled"
            pending={isPending}
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
            onValueChange={setPassword}
            disabled={isPending}
          />
        </Field>
      </form>
    </Dialog>
  );
}
