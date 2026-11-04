import { mountTavernEditorView } from './build/index.js';
import { confirmAlert, confirmDiscard } from '../ui/alert.js';
import { showToast } from '../ui/toast.js';
import { openSheet } from '../ui/sheet.js';
import { createTavernController, portablePreset } from './tavern-controller.js';

export { portablePreset };

/** Thin DOM wrapper over pure createTavernController for legacy shell consumers. */
export function mountTavernSettings(container, opts = {}) {
    let view = null;
    let sheet = null;
    let codeEditor = null;
    let destroyed = false;

    const controller = createTavernController({
        ...opts,
        checkValidity: () => Boolean(container.querySelector('form')?.reportValidity() ?? true),
        onNotify: message => {
            if (!destroyed) showToast(message);
        },
        onConfirm: req =>
            confirmAlert({
                title: req.title,
                message: req.message,
                owner: container,
            }),
        onConfirmDiscard: () =>
            confirmDiscard({
                opener: container.ownerDocument?.activeElement,
                owner: container,
            }),
        onAskName: ({ title, initial, validate, onConfirm }) => {
            if (destroyed) return;
            const doc = container.ownerDocument;
            const body = doc.createElement('form');
            body.className = 'vc-tavern-name';
            const label = doc.createElement('label');
            label.textContent = '名称';
            const input = doc.createElement('input');
            input.required = true;
            input.value = initial || '';
            input.maxLength = 120;
            label.append(input);
            body.append(label);
            let accepted = false;
            sheet = openSheet({
                title,
                body,
                owner: container,
                onSubmit: () => {
                    if (destroyed || !body.reportValidity()) return false;
                    const name = input.value.trim();
                    const err = validate(name);
                    if (err) {
                        input.setCustomValidity(err);
                        input.reportValidity();
                        return false;
                    }
                    accepted = true;
                    queueMicrotask(() => {
                        if (!destroyed) onConfirm(name);
                    });
                    return true;
                },
                onDone: () => {
                    sheet = null;
                },
                isDirty: () => !accepted,
            });
            input.addEventListener('input', () => input.setCustomValidity(''));
            body.addEventListener('submit', event => {
                event.preventDefault();
                sheet?.done?.click();
            });
        },
        onChooseCharacterDeletion: ({ onSelect }) => {
            if (destroyed) return;
            const doc = container.ownerDocument;
            const body = doc.createElement('div');
            body.className = 'vc-column';
            sheet = openSheet({
                title: '删除角色卡',
                body,
                owner: container,
                onDone: () => {
                    sheet = null;
                },
            });
            for (const [deleteChats, label] of [
                [false, '仅删除角色卡'],
                [true, '同时删除聊天'],
            ]) {
                const button = doc.createElement('button');
                button.type = 'button';
                button.className = 'vc-btn vc-btn-danger';
                button.textContent = label;
                button.addEventListener('click', () => {
                    sheet?.dismiss();
                    sheet = null;
                    void onSelect(deleteChats, label);
                });
                body.append(button);
            }
        },
        onOpenCodeEditor: ({ value, onApply, onDone }) => {
            const handle = {
                isDirty: () => Boolean(codeEditor?.isDirty?.()),
                requestLeave: () => (codeEditor ? codeEditor.requestLeave() : Promise.resolve(true)),
                destroy: () => {
                    codeEditor?.destroy?.();
                    codeEditor = null;
                },
            };
            void import('./code-editor.js').then(({ openCodeEditor }) => {
                if (destroyed) return;
                codeEditor = openCodeEditor({
                    owner: container,
                    value,
                    onApply,
                    onDone: () => {
                        codeEditor = null;
                        onDone();
                    },
                });
            });
            return handle;
        },
        onUpdate: state => {
            if (destroyed) return;
            if (!view) view = mountTavernEditorView(container, state);
            else view.update(state);
        },
    });

    return {
        isDirty: () => controller.isDirty(),
        working: () => controller.working(),
        requestLeave: () => controller.requestLeave(),
        refreshContext: () => controller.refreshContext(),
        destroy() {
            if (destroyed) return;
            destroyed = true;
            codeEditor?.destroy?.();
            codeEditor = null;
            sheet?.dismiss?.();
            sheet = null;
            controller.destroy();
            view?.unmount();
            view = null;
        },
    };
}
