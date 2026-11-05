import { Toast as BaseToast } from '@base-ui/react/toast';
import { useToastPortalContainer } from '../portal-host';
import { Icon } from './Icon';
import './Toast.css';

export type ToastKind = 'success' | 'error';

export interface ToastShowOptions {
  title: string;
  kind: ToastKind;
}

interface ToastCustomData {
  kind: ToastKind;
}

const SINGLETON_TOAST_ID = 'vc-desktop-toast';
const toastManager = BaseToast.createToastManager<ToastCustomData>();

export const toast = {
  show({ title, kind }: ToastShowOptions): string {
    toastManager.close(SINGLETON_TOAST_ID);
    return toastManager.add({
      id: SINGLETON_TOAST_ID,
      title,
      type: kind,
      timeout: kind === 'error' ? 0 : 1800,
      data: { kind },
    });
  },
  dismiss(id: string = SINGLETON_TOAST_ID): void {
    toastManager.close(id);
  },
};

export interface ToastRegionProps {
  className?: string;
}

function ToastList({ className }: ToastRegionProps) {
  const { toasts } = BaseToast.useToastManager<ToastCustomData>();
  const toastContainer = useToastPortalContainer();
  const mergedViewportClassName = ['vc-toast-viewport', className].filter(Boolean).join(' ');
  const activeToasts = toasts
    .filter((item) => !item.limited && item.transitionStatus !== 'ending')
    .slice(0, 1);

  return (
    <BaseToast.Portal container={toastContainer}>
      <BaseToast.Viewport className={mergedViewportClassName}>
        {activeToasts.map((item) => {
          const kind: ToastKind = item.data?.kind ?? (item.type === 'error' ? 'error' : 'success');
          return (
            <BaseToast.Root
              key={item.id}
              toast={item}
              className={['vc-toast', `vc-toast--${kind}`].join(' ')}
            >
              <BaseToast.Content className="vc-toast__content">
                <span className="vc-toast__icon" aria-hidden="true">
                  <Icon name={kind === 'error' ? 'circle-alert' : 'check'} size={20} />
                </span>
                <BaseToast.Title className="vc-toast__title">{item.title}</BaseToast.Title>
                {kind === 'error' ? (
                  <BaseToast.Close aria-hidden={false} aria-label="关闭提示" className="vc-toast__close">
                    <Icon name="x" size={16} />
                  </BaseToast.Close>
                ) : null}
              </BaseToast.Content>
            </BaseToast.Root>
          );
        })}
      </BaseToast.Viewport>
    </BaseToast.Portal>
  );
}

export function ToastRegion({ className }: ToastRegionProps) {
  return (
    <BaseToast.Provider toastManager={toastManager} limit={1}>
      <ToastList className={className} />
    </BaseToast.Provider>
  );
}

export { ToastRegion as Toast };
