import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { EXTENSION_SRC, INTEG } from './paths.mjs';
import { desktopSourceModules } from './desktop-source-modules.mjs';

const desktopUi = path.join(INTEG, 'desktop-ui');
const desktopSrc = path.join(desktopUi, 'src');
const npmDir = path.join(INTEG, 'node_modules');
const standalone = path.join(EXTENSION_SRC, 'desktop/standalone');
const sourceIdentity = '/scripts/vc-runtime/source-identity.js';
const require = createRequire(path.join(INTEG, 'package.json'));

const EXACT_WHITELIST = new Set([
    // Plan §2 显式列出的扩展模块
    'settings-documents.js',
    'desktop/tavern-defaults.js',
    'desktop/tavern-fields.js',
    'desktop/themes/index.js',
    'desktop/tavern-controller.js',
    'api.js',
    'inbox-client.js',
    'account-logic.js',
    'model-logic.js',
    'conversations.js',
    'instance-queries.js',
    'companion-prompt.js',
    'companion-tools.js',
    'user-expressions.js',
    'prompt-history.js',
    'reply-pipeline.js',
    'reply-planner.js',
    'story-action.js',
    'story-context.js',
    'story-projection.js',
    'projection-save.js',
    'ui/icons.js',
    'ui/tint.js',
    // api.js 直接复用的内部依赖（本次核对确认保留）；注意该模块不是纯函数集合（含显式 DOM 通知函数 noteCompanionBound），本任务不改其行为
    'instance-binding.js',
    // Plan §1 表中全部 *-logic.js
    'chat-logic.js',
    'voice-logic.js',
    'stickers-logic.js',
    'f2-logic.js',
    'instance-logic.js',
    'memory-logic.js',
    'inbox-logic.js',
    'story-logic.js',
    'consent-logic.js',
    'theme-logic.js',
    'status-logic.js',
    'projection-logic.js',
    'memory-injection-logic.js',
    // Plan §2 desktop/standalone/** 允许集合
    'desktop/standalone/client.js',
    'desktop/standalone/business.js',
    'desktop/standalone/personas.js',
    'desktop/standalone/input-markdown.js',
    'desktop/standalone/runtime.js',
    'desktop/standalone/session.js',
    'desktop/standalone/cards/account-storage.js',
    'desktop/standalone/cards/ejs-host.js',
    'desktop/standalone/cards/format.js',
    'desktop/standalone/cards/helper-character.js',
    'desktop/standalone/cards/helper-event.js',
    'desktop/standalone/cards/helper-generate.js',
    'desktop/standalone/cards/helper-global.js',
    'desktop/standalone/cards/helper-host.js',
    'desktop/standalone/cards/helper-inject.js',
    'desktop/standalone/cards/helper-message.js',
    'desktop/standalone/cards/helper-persona.js',
    'desktop/standalone/cards/helper-preset.js',
    'desktop/standalone/cards/helper-regex.js',
    'desktop/standalone/cards/helper-script.js',
    'desktop/standalone/cards/helper-slash.js',
    'desktop/standalone/cards/helper-util.js',
    'desktop/standalone/cards/helper-variables.js',
    'desktop/standalone/cards/helper-worldbook.js',
    'desktop/standalone/cards/index.js',
    'desktop/standalone/cards/klona.js',
    'desktop/standalone/cards/message-formatter.js',
    'desktop/standalone/cards/reply-bubbles.js',
    'desktop/standalone/engine/computation.js',
    'desktop/standalone/engine/defaults.js',
    'desktop/standalone/engine/diagnostics.js',
    'desktop/standalone/engine/events.js',
    'desktop/standalone/engine/helper-computation.js',
    'desktop/standalone/engine/helper-config.js',
    'desktop/standalone/engine/helper-types.js',
    'desktop/standalone/engine/ports.js',
    'desktop/standalone/engine/regex.js',
    'desktop/standalone/engine/resources.js',
    'desktop/standalone/engine/response-core.js',
    'desktop/standalone/engine/response.js',
    'desktop/standalone/engine/runtime.js',
    'desktop/standalone/engine/slash-ports.js',
    'desktop/standalone/engine/sse.js',
    'desktop/standalone/engine/st/constants.js',
    'desktop/standalone/engine/st/events.js',
    'desktop/standalone/engine/st/lib.js',
    'desktop/standalone/engine/st/script.js',
    'desktop/standalone/engine/st/scripts/PromptManager.js',
    'desktop/standalone/engine/st/scripts/group-chats.js',
    'desktop/standalone/engine/st/scripts/instruct-mode.js',
    'desktop/standalone/engine/st/scripts/macros.js',
    'desktop/standalone/engine/st/scripts/openai.js',
    'desktop/standalone/engine/st/scripts/stopping.js',
    'desktop/standalone/engine/st/scripts/utils.js',
    'desktop/standalone/engine/st/scripts/variables.js',
    'desktop/standalone/engine/tokenizers.js',
    'desktop/standalone/engine/tools.js',
    'desktop/standalone/engine/world-info.js',
]);

function toPosix(filePath) {
    return filePath.split(path.sep).join('/');
}

export function isWhitelistedExtensionModule(relPath) {
    const normalized = toPosix(relPath).replace(/^\/+/, '');
    if (EXACT_WHITELIST.has(normalized)) return true;
    const generated = normalized.match(/^desktop\/locked-source\/(.+)$/)?.[1];
    return generated === 'st/lib.js' || Object.hasOwn(desktopSourceModules, generated);
}


// Direct package imports from app sources. Vite resolves and verifies their
// package-module paths independently. The JSX transform supplies its own runtime.
const appPackages = {
    'app/main.tsx': ['@tanstack/react-router', 'react', 'react-dom/client'],
    'app/providers.tsx': ['@tanstack/react-query', 'react'],
    'app/router.tsx': ['@tanstack/react-router', 'react'],
    'features/memory/useMemoryState.ts': ['react', 'react-hook-form', 'zod'],
    'app/MemoryRouteAdapter.tsx': ['@tanstack/react-router', 'react'],
    'components/Icon.tsx': ['react'],
    'components/IconButton.tsx': ['@base-ui/react/button'],
    'components/Switch.tsx': ['@base-ui/react/switch'],
    'data/queries/account.ts': ['@tanstack/react-query', 'react'],
    'data/queries/characters.ts': ['@tanstack/react-query', 'react'],
    'data/queries/chat.ts': ['@tanstack/react-query', 'react'],
    'data/queries/inbox.ts': ['@tanstack/react-query'],
    'data/queries/memory.ts': ['@tanstack/react-query'],
    'data/queries/models.ts': ['@tanstack/react-query'],
    'data/queries/story.ts': ['@tanstack/react-query'],
    'data/queries/tavern.ts': ['@tanstack/react-query', 'react'],
    'data/queries/voice.ts': ['@tanstack/react-query'],
    'design/components/AlertDialog.tsx': ['@base-ui/react/alert-dialog', 'react'],
    'design/components/Avatar.tsx': ['@base-ui/react/avatar', 'react'],
    'design/components/Button.tsx': ['react'],
    'design/components/Checkbox.tsx': ['@base-ui/react/checkbox', 'react'],
    'design/components/Dialog.tsx': ['@base-ui/react/dialog', 'react'],
    'design/components/EmptyState.tsx': ['react'],
    'design/components/Field.tsx': ['@base-ui/react/field', 'react'],
    'design/components/Icon.tsx': ['react'],
    'design/components/IconButton.tsx': ['react'],
    'design/components/Menu.tsx': ['@base-ui/react/menu', 'react'],
    'design/components/Segment.tsx': ['@base-ui/react/radio', '@base-ui/react/radio-group', 'react'],
    'design/components/Select.tsx': ['@base-ui/react/select', 'react'],
    'design/components/Spinner.tsx': ['react'],
    'design/components/Switch.tsx': ['@base-ui/react/switch'],
    'design/components/Tabs.tsx': ['@base-ui/react/tabs', 'react'],
    'design/components/TextInput.tsx': ['@base-ui/react/input', 'react'],
    'design/components/Textarea.tsx': ['@base-ui/react/field', 'react'],
    'design/components/Toast.tsx': ['@base-ui/react/toast'],
    'design/portal-host.tsx': ['react'],
    'features/characters/CharacterDetail.tsx': ['react'],
    'features/characters/CharacterGrid.tsx': ['react'],
    'features/characters/CharactersRoute.tsx': ['react'],
    'features/characters/CreateWizard.tsx': ['react'],
    'features/characters/ImportCharacter.tsx': ['react'],
    'features/characters/InstanceDialog.tsx': ['react'],
    'features/characters/PersonaEditor.tsx': ['react'],
    'features/characters/useCharactersState.ts': ['react', 'react-hook-form', 'zod'],
    'features/chat/ChatCharacterPanel.tsx': ['@tanstack/react-query', '@tanstack/react-router', 'react', 'react-hook-form', 'zod'],
    'features/chat/ChatRoute.tsx': ['@tanstack/react-router', 'react'],
    'features/chat/ChatSearch.tsx': ['react'],
    'features/chat/ChatStatusCard.tsx': ['@base-ui/react/popover', 'react'],
    'features/chat/Composer.tsx': ['react', 'react-hook-form', 'zod'],
    'features/chat/ConflictSheet.tsx': ['@base-ui/react/dialog'],
    'features/chat/EmojiPicker.tsx': ['@base-ui/react/popover', '@emoji-mart/data', 'emoji-mart', 'react'],
    'features/chat/MessageItem.tsx': ['react'],
    'features/chat/MessageLeaf.tsx': ['react'],
    'features/chat/MessageList.tsx': ['react', 'react-hook-form', 'yet-another-react-lightbox', 'yet-another-react-lightbox/plugins/zoom', 'yet-another-react-lightbox/styles.css', 'zod'],
    'features/chat/MessageMenu.tsx': ['@base-ui/react/menu', 'react'],
    'features/chat/ReactionBar.tsx': ['@base-ui/react/toolbar'],
    'features/chat/VoiceBubble.tsx': ['@base-ui/react/collapsible', 'react', 'wavesurfer.js'],
    'features/chat/VoiceRecorder.tsx': ['react'],
    'features/chat/useChatUi.tsx': ['react'],
    'features/chat/useComposer.ts': ['react', 'react-hook-form', 'zod'],
    'features/chat/useMessageActions.ts': ['react', 'react-hook-form', 'zod'],
    'features/chat/useReadingPosition.ts': ['react'],
    'features/inbox/ChannelSheet.tsx': ['react'],
    'features/inbox/FollowUps.tsx': ['react'],
    'features/inbox/InboxList.tsx': ['@tanstack/react-router', 'react'],
    'features/inbox/InboxRoute.tsx': ['react'],
    'features/inbox/PolicyForm.tsx': ['react', 'react-hook-form', 'zod'],
    'features/inbox/ReauthDialog.tsx': ['react', 'zod'],
    'features/memory/CorrectMemory.tsx': ['react'],
    'features/memory/Diary.tsx': ['react'],
    'features/memory/MemoryItemDetail.tsx': ['react'],
    'features/memory/MemoryRoute.tsx': ['react'],
    'features/models/Bindings.tsx': ['react'],
    'features/models/ModelForm.tsx': ['react'],
    'features/models/ProviderPane.tsx': ['@base-ui/react/button'],
    'features/models/Providers.tsx': ['@base-ui/react/button'],
    'features/models/Usage.tsx': ['@base-ui/react/button'],
    'features/models/fields.tsx': ['@base-ui/react/button', 'react'],
    'features/settings/AccountContents.tsx': ['@base-ui/react/button', 'react'],
    'features/settings/AccountSection.tsx': ['@base-ui/react/button', 'react'],
    'features/settings/AppConsentGate.tsx': ['@base-ui/react/button', '@base-ui/react/collapsible', '@base-ui/react/dialog', 'react'],
    'features/settings/AppearanceSection.tsx': ['react'],
    'features/settings/CompanionStyle.tsx': ['@tanstack/react-query', '@tanstack/react-router', 'react'],
    'features/settings/DataSection.tsx': ['@base-ui/react/button', 'react'],
    'features/settings/DesktopAccountDialog.tsx': ['react'],
    'features/settings/DesktopVoiceForm.tsx': ['react'],
    'features/settings/ModelSection.tsx': ['@tanstack/react-router', 'react'],
    'features/settings/NotificationSection.tsx': ['@tanstack/react-router', 'react'],
    'features/settings/SettingsRoute.tsx': ['@tanstack/react-router', 'react'],
    'features/settings/StickerSettings.tsx': ['react'],
    'features/settings/VoiceForm.tsx': ['@base-ui/react/button', 'react'],
    'features/settings/VoiceSection.tsx': ['@tanstack/react-query', '@tanstack/react-router', 'react'],
    'features/settings/useSettingsForm.ts': ['@tanstack/react-router', 'react', 'react-hook-form', 'zod'],
    'features/story/ClueWall.tsx': ['react'],
    'features/story/EpilogueMemories.tsx': ['@tanstack/react-router'],
    'features/story/RewindDialog.tsx': ['@tanstack/react-query', 'react'],
    'features/story/Stage.tsx': ['@tanstack/react-query', 'react'],
    'features/story/StartWizard.tsx': ['@tanstack/react-query', 'react'],
    'features/story/StoryRoute.tsx': ['@tanstack/react-query', '@tanstack/react-router', 'react'],
    'features/tavern/CodeField.tsx': ['@monaco-editor/react', 'react'],
    'features/tavern/PromptOrder.tsx': ['@dnd-kit/core', '@dnd-kit/sortable', 'react'],
    'features/tavern/TavernRoute.tsx': ['@tanstack/react-router', 'react'],
    'mobile/app/MobileApp.tsx': ['@tanstack/react-query', 'react'],
    'mobile/app/main.tsx': ['react', 'react-dom/client'],
    'runtime/session-bridge.ts': ['@tanstack/react-query', 'react'],
    'shell/AppShell.tsx': ['react'],
    'shell/Aurora.tsx': ['react'],
    'shell/DesktopPreferences.tsx': ['@tanstack/react-query', 'react'],
    'shell/OverlayHost.tsx': ['react'],
    'shell/QuickSwitch.tsx': ['@base-ui/react/dialog', 'cmdk', 'react'],
    'shell/Sidebar.tsx': ['react'],
    'shell/useChrome.ts': ['react'],
    'shell/useLeaveGuard.ts': ['@tanstack/react-router', 'react'],
    'shell/usePreferences.ts': ['zustand'],
    'shell/useReducedMotion.ts': ['react'],
};

export function isDesktopPackageImport(importer, specifier) {
    const rel = toPosix(path.relative(desktopSrc, importer));
    if (!appPackages[rel]?.includes(specifier)) return false;
    return fs.existsSync(require.resolve(specifier));
}

function isFirstPartyModule(id) {
    return id?.startsWith(`${desktopSrc}${path.sep}`) || id?.startsWith(`${EXTENSION_SRC}${path.sep}`);
}

function allowsDesktopExternal(importer, specifier) {
    return importer === path.join(standalone, 'runtime.js') && specifier === sourceIdentity;
}

export function desktopResolvedGraph() {
    return {
        name: 'vc-desktop-resolved-graph',
        enforce: 'pre',
        resolveId(specifier, importer) {
            const file = importer?.split('?')[0];
            if (!isFirstPartyModule(file)) return null;
            if (specifier.startsWith('./') || specifier.startsWith('../')) return null;
            if (allowsDesktopExternal(file, specifier)) return null;
            if (specifier === '\0vite/preload-helper.js') return null;
            if (specifier === 'virtual:vc-app.css' && file === path.join(desktopSrc, 'app/main.tsx')) return null;
            if (file.startsWith(`${desktopSrc}${path.sep}`)) {
                if (specifier === 'react/jsx-runtime' && /\.[jt]sx$/.test(file)) return null;
                if (isDesktopPackageImport(file, specifier)) return null;
            }
            this.error(`Unexpected desktop import ${specifier} from ${importer}`);
        },
        moduleParsed(module) {
            const raw = module.id.replace(/^\0/, '').split('?')[0];
            if (!path.isAbsolute(raw)) return;
            const resolved = fs.realpathSync(raw, { encoding: 'utf8' });
            const extRelative = toPosix(path.relative(EXTENSION_SRC, resolved));
            const inExtension = resolved.startsWith(`${EXTENSION_SRC}${path.sep}`);
            const inUi = resolved.startsWith(`${desktopUi}${path.sep}`);
            const inNpm = resolved.startsWith(`${npmDir}${path.sep}`);
            const srcRelative = toPosix(path.relative(desktopSrc, resolved));
            if ((!inExtension && !inUi && !inNpm) || srcRelative.startsWith('bridge/') ||
                (inExtension && !isWhitelistedExtensionModule(extRelative))) {
                this.error(`Unexpected desktop build module ${raw}`);
            }
        },
        buildEnd(error) {
            if (error) return;
            for (const id of this.getModuleIds()) {
                const file = id.split('?')[0];
                if (!isFirstPartyModule(file)) continue;
                const module = this.getModuleInfo(id);
                const importerRel = file.startsWith(`${desktopSrc}${path.sep}`)
                    ? toPosix(path.relative(desktopSrc, file))
                    : '';
                const importerIsMobile = importerRel === 'mobile' || importerRel.startsWith('mobile/');
                for (const target of [...module.importedIds, ...module.dynamicallyImportedIds]) {
                    const targetFile = target.split('?')[0];
                    if (targetFile.startsWith(`${desktopSrc}${path.sep}`)) {
                        const targetRel = toPosix(path.relative(desktopSrc, targetFile));
                        if ((targetRel === 'mobile' || targetRel.startsWith('mobile/')) && !importerIsMobile) {
                            this.error(`Unexpected desktop-imports-mobile ${targetRel} from ${file}`);
                        }
                    }
                    // Rolldown exposes external modules as graph nodes with no loaded code.
                    if (this.getModuleInfo(target)?.code == null && !allowsDesktopExternal(file, target)) {
                        this.error(`Unexpected desktop external import ${target} from ${file}`);
                    }
                }
            }
        },
    };
}
