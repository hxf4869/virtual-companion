// 受管验收场景注册表。入口只消费这份列表，不再 push，也不再维护实现对照表。
import { memoryRealModelScene } from './w08-real-accept.mjs';
import { memoryRealEvalScene } from './w08-real-eval.mjs';
import { memorycoreNativeScene } from './w08-native-accept.mjs';
import { memorycoreFoundationScene } from './w08-foundation-accept.mjs';
import { loginShapeScene, catalogAdminScene, zeroUpstreamOnSaveScene, serviceResolveScene, e2eChatScene, e2eResponsesScene, e2eAnthropicScene, toolRoundScene, cancelStreamScene, contextBudgetScene, nativeDriftScene, keyRevokeScene, revisionConflictScene, continuationHygieneScene, ui04BrowserScene, storyViewBrowserScene, w11ToolMeterScene } from './w03-protocol-accept.mjs';
import { ui03BrowserScene } from './ui03-browser-accept.mjs';
import { authBrowserScene, f2NativeScene, f2BrowserScene } from './w05-accept.mjs';
import { sourceNativeScene, rightsBrowserScene, rightsNativeScene } from './w06-accept.mjs';
import { memoryBrowserScene } from './w07-accept.mjs';
import { memoryExtractProdScene } from './mem-extract-accept.mjs';
import { w10InboxNotifyScene } from './w10-accept.mjs';
import { hlProactiveScene } from './hl-proactive-accept.mjs';
import { storyOutboundScene } from './story-outbound-accept.mjs';
import { storyPlayScene } from './story-play-accept.mjs';
import { storyRealScene } from './story-real-accept.mjs';
import { w15UiScene } from './w15-ui-accept.mjs';
import { fe4aUiScene } from './fe4a-ui-accept.mjs';
import { fe4bUiScene } from './fe4b-ui-accept.mjs';
import { f3SettingsScene } from './f3-settings-accept.mjs';
import { vcUiShellScene } from './vc-ui-shell-accept.mjs';
import { vcUiWalkthroughScene } from './vc-ui-walkthrough.mjs';
import { f2ChatUiScene } from './f2-chat-accept.mjs';
import { consentUiScene } from './consent-accept.mjs';

export const ACCEPT_SCENES = [
    memoryRealModelScene,
    memoryRealEvalScene,
    memorycoreNativeScene,
    memorycoreFoundationScene,
    loginShapeScene,
    catalogAdminScene,
    zeroUpstreamOnSaveScene,
    serviceResolveScene,
    e2eChatScene,
    e2eResponsesScene,
    e2eAnthropicScene,
    toolRoundScene,
    cancelStreamScene,
    contextBudgetScene,
    nativeDriftScene,
    keyRevokeScene,
    revisionConflictScene,
    continuationHygieneScene,
    ui03BrowserScene,
    ui04BrowserScene,
    authBrowserScene,
    sourceNativeScene,
    f2NativeScene,
    f2BrowserScene,
    rightsBrowserScene,
    rightsNativeScene,
    memoryBrowserScene,
    memoryExtractProdScene,
    storyViewBrowserScene,
    w11ToolMeterScene,
    w10InboxNotifyScene,
    hlProactiveScene,
    storyOutboundScene,
    storyPlayScene,
    storyRealScene,
    w15UiScene,
    fe4aUiScene,
    fe4bUiScene,
    f3SettingsScene,
    vcUiShellScene,
    vcUiWalkthroughScene,
    f2ChatUiScene,
    consentUiScene,
];
