// AGPL-3.0-only. SillyTavern 7e8663cd9 / Generate 的受控 Chat Completion 计算段。
// 不含发送、按钮、消息DOM、原生启动或第二条生成流程；原状态/宏/事件顺序保留。
import { chat, chat_metadata, characters, this_chid, selected_group, groups, name1, name2, power_user, extension_settings, extension_prompts, main_api } from './ports.js';
import { substituteParams, baseChatReplace, getCharacterCardFields, parseMesExamples, setExtensionPrompt, getExtensionPromptRoleByName, removeDepthPrompts, flushWIInjections, getExtensionPromptByName, getExtensionPrompt, getBiasStrings, extension_prompt_types, extension_prompt_roles, MAX_INJECTION_DEPTH } from './st/script.js';
import { inject_ids, persona_description_positions } from './st/constants.js';
import { getGroupDepthPrompts } from './st/scripts/group-chats.js';
import { createWorldInfoRuntime } from './world-info.js';
import { getCustomStoppingStrings } from './st/scripts/stopping.js';
import { collapseNewlines, trimToEndSentence, escapeRegex, isOdd, countOccurrences } from './st/scripts/utils.js';
import { quietConsole } from './diagnostics.js';
export function createChatComputation(dependencies) {
 const { context, settings, regex, prompt, tokenizer, ToolManager, loadWorldInfo, appendFileContent, runGenerationInterceptors, event_types, eventSource,
 getCharaFilename, getMaxPromptTokens, Handlebars, toast, t, generationTriggers } = dependencies;
 const console=quietConsole, toastr=toast, getContext=()=>context;
 const getRegexedString=regex.getRegexedString, regex_placement=regex.regex_placement, getTokenCountAsync=tokenizer.getTokenCountAsync;
 const NOTE_MODULE_NAME='2_floating_prompt';
 const MODULE_NAME = '2_floating_prompt';

const metadata_keys = {
    prompt: 'note_prompt',
    interval: 'note_interval',
    depth: 'note_depth',
    position: 'note_position',
    role: 'note_role',
};

const chara_note_position = {
    replace: 0,
    before: 1,
    after: 2,
};
let shouldWIAddPrompt=false;

 const depth_prompt_depth_default = 4;

const depth_prompt_role_default = 'system';
 function setFloatingPrompt() {
    const context = getContext();
    if (!context.groupId && context.characterId === undefined) {
        console.debug('setFloatingPrompt: Not in a chat. Skipping.');
        shouldWIAddPrompt = false;
        return;
    }

    // take the count of messages
    let lastMessageNumber = Array.isArray(context.chat) && context.chat.length ? context.chat.filter(m => m.is_user).length : 0;

    console.debug(`
    setFloatingPrompt entered
    ------
    lastMessageNumber = ${lastMessageNumber}
    metadata_keys.interval = ${chat_metadata[metadata_keys.interval]}
    metadata_keys.position = ${chat_metadata[metadata_keys.position]}
    metadata_keys.depth = ${chat_metadata[metadata_keys.depth]}
    metadata_keys.role = ${chat_metadata[metadata_keys.role]}
    ------
    `);

    // interval 1 should be inserted no matter what
    if (chat_metadata[metadata_keys.interval] === 1) {
        lastMessageNumber = 1;
    }

    if (lastMessageNumber <= 0 || chat_metadata[metadata_keys.interval] <= 0) {
        context.setExtensionPrompt(MODULE_NAME, '', extension_prompt_types.NONE, MAX_INJECTION_DEPTH);

        shouldWIAddPrompt = false;
        return;
    }

    const messagesTillInsertion = lastMessageNumber >= chat_metadata[metadata_keys.interval]
        ? (lastMessageNumber % chat_metadata[metadata_keys.interval])
        : (chat_metadata[metadata_keys.interval] - lastMessageNumber);
    const shouldAddPrompt = messagesTillInsertion == 0;
    shouldWIAddPrompt = shouldAddPrompt;

    let prompt = shouldAddPrompt ? readAuthorNote() : '';
    if (shouldAddPrompt && extension_settings.note.chara && getContext().characterId !== undefined) {
        const charaNote = extension_settings.note.chara.find((e) => e.name === getCharaFilename());

        // Only replace with the chara note if the user checked the box
        if (charaNote && charaNote.useChara) {
            switch (charaNote.position) {
                case chara_note_position.before:
                    prompt = charaNote.prompt + '\n' + prompt;
                    break;
                case chara_note_position.after:
                    prompt = prompt + '\n' + charaNote.prompt;
                    break;
                default:
                    prompt = charaNote.prompt;
                    break;
            }
        }
    }
    context.setExtensionPrompt(
        MODULE_NAME,
        String(prompt),
        chat_metadata[metadata_keys.position],
        chat_metadata[metadata_keys.depth],
        extension_settings.note.allowWIScan,
        chat_metadata[metadata_keys.role],
    );

}
 const cfgType = {
    chat: 0,
    chara: 1,
    global: 2,
};

const metadataKeys = {
    guidance_scale: 'cfg_guidance_scale',
    negative_prompt: 'cfg_negative_prompt',
    positive_prompt: 'cfg_positive_prompt',
    prompt_combine: 'cfg_prompt_combine',
    groupchat_individual_chars: 'cfg_groupchat_individual_chars',
    prompt_insertion_depth: 'cfg_prompt_insertion_depth',
    prompt_separator: 'cfg_prompt_separator',
};

function getGuidanceScale() {
    if (!extension_settings.cfg) {
        console.warn('CFG extension is not enabled. Skipping CFG guidance.');
        return;
    }

    const charaCfg = extension_settings.cfg.chara?.find((e) => e.name === getCharaFilename(this_chid));
    const chatGuidanceScale = chat_metadata[metadataKeys.guidance_scale];
    const groupchatCharOverride = chat_metadata[metadataKeys.groupchat_individual_chars] ?? false;

    if (chatGuidanceScale && chatGuidanceScale !== 1 && !groupchatCharOverride) {
        return {
            type: cfgType.chat,
            value: chatGuidanceScale,
        };
    }

    if ((!selected_group && charaCfg || groupchatCharOverride) && charaCfg?.guidance_scale !== 1) {
        return {
            type: cfgType.chara,
            value: charaCfg.guidance_scale,
        };
    }

    if (extension_settings.cfg.global && extension_settings.cfg.global?.guidance_scale !== 1) {
        return {
            type: cfgType.global,
            value: extension_settings.cfg.global.guidance_scale,
        };
    }
}

function getCustomSeparator() {
    const defaultSeparator = '\n';

    try {
        if (chat_metadata[metadataKeys.prompt_separator]) {
            return JSON.parse(chat_metadata[metadataKeys.prompt_separator]);
        }

        return defaultSeparator;
    } catch {
        console.warn('Invalid JSON detected for prompt separator. Using default separator.');
        return defaultSeparator;
    }
}

function getCfgPrompt(guidanceScale, isNegative, quiet = false) {
    let splitCfgPrompt = [];

    const cfgPromptCombine = chat_metadata[metadataKeys.prompt_combine] ?? [];
    if (guidanceScale.type === cfgType.chat || cfgPromptCombine.includes(cfgType.chat)) {
        splitCfgPrompt.unshift(
            substituteParams(
                chat_metadata[isNegative ? metadataKeys.negative_prompt : metadataKeys.positive_prompt],
            ),
        );
    }

    const charaCfg = extension_settings.cfg.chara?.find((e) => e.name === getCharaFilename(this_chid));
    if (guidanceScale.type === cfgType.chara || cfgPromptCombine.includes(cfgType.chara)) {
        splitCfgPrompt.unshift(
            substituteParams(
                isNegative ? charaCfg.negative_prompt : charaCfg.positive_prompt,
            ),
        );
    }

    if (guidanceScale.type === cfgType.global || cfgPromptCombine.includes(cfgType.global)) {
        splitCfgPrompt.unshift(
            substituteParams(
                isNegative ? extension_settings.cfg.global.negative_prompt : extension_settings.cfg.global.positive_prompt,
            ),
        );
    }

    const customSeparator = getCustomSeparator();
    const combinedCfgPrompt = splitCfgPrompt.filter((e) => e.length > 0).join(customSeparator);
    const insertionDepth = chat_metadata[metadataKeys.prompt_insertion_depth] ?? 1;
    !quiet && console.log(`Setting CFG with guidance scale: ${guidanceScale.value}, negatives: ${combinedCfgPrompt}`);

    return {
        value: combinedCfgPrompt,
        depth: insertionDepth,
    };
}
 class PromptReasoning {
    /**
     * An instance initiated during the latest prompt processing.
     * @type {PromptReasoning}
     * */
    static #LATEST = null;
    /**
     * @readonly Zero-width space character used as a placeholder for reasoning.
     * @type {string}
    */
    static REASONING_PLACEHOLDER = '\u200B';

    /**
     * Returns the latest formatted reasoning prefix if the prefix is incomplete.
     * @returns {string} Formatted reasoning prefix
     */
    static getLatestPrefix() {
        if (!PromptReasoning.#LATEST) {
            return '';
        }

        if (!PromptReasoning.#LATEST.prefixIncomplete) {
            return '';
        }

        return PromptReasoning.#LATEST.prefixReasoningFormatted;
    }

    /**
     * Free the latest reasoning instance.
     * To be called when the generation has ended or stopped.
     */
    static clearLatest() {
        PromptReasoning.#LATEST = null;
    }

    constructor() {
        PromptReasoning.#LATEST = this;

        /** @type {number} */
        this.counter = 0;
        /** @type {number} */
        this.prefixLength = -1;
        /** @type {string} */
        this.prefixReasoning = '';
        /** @type {string} */
        this.prefixReasoningFormatted = '';
        /** @type {number?} */
        this.prefixDuration = null;
        /** @type {boolean} */
        this.prefixIncomplete = false;
    }

    /**
     * Checks if the limit of reasoning additions has been reached.
     * @returns {boolean} True if the limit of reasoning additions has been reached, false otherwise.
     */
    isLimitReached() {
        if (!power_user.reasoning.add_to_prompts) {
            return true;
        }

        return this.counter >= power_user.reasoning.max_additions;
    }

    /**
     * Add reasoning to a message according to the power user settings.
     * @param {string} content Message content
     * @param {string} reasoning Message reasoning
     * @param {boolean} isPrefix Whether this is the last message prefix
     * @param {number?} duration Duration of the reasoning
     * @returns {string} Message content with reasoning
     */
    addToMessage(content, reasoning, isPrefix, duration) {
        // Disabled or reached limit of additions
        if (!isPrefix && (!power_user.reasoning.add_to_prompts || this.counter >= power_user.reasoning.max_additions)) {
            return content;
        }

        // No reasoning provided or a legacy placeholder
        if (!reasoning || reasoning === PromptReasoning.REASONING_PLACEHOLDER) {
            return content;
        }

        // Increment the counter
        this.counter++;

        // Substitute macros in variable parts
        const prefix = substituteParams(power_user.reasoning.prefix || '');
        const separator = substituteParams(power_user.reasoning.separator || '');
        const suffix = substituteParams(power_user.reasoning.suffix || '');

        // Combine parts with reasoning only
        if (isPrefix && !content) {
            const formattedReasoning = `${prefix}${reasoning}`;
            if (isPrefix) {
                this.prefixReasoning = reasoning;
                this.prefixReasoningFormatted = formattedReasoning;
                this.prefixLength = formattedReasoning.length;
                this.prefixDuration = duration;
                this.prefixIncomplete = true;
            }
            return formattedReasoning;
        }

        // Combine parts with reasoning and content
        const formattedReasoning = `${prefix}${reasoning}${suffix}${separator}`;
        if (isPrefix) {
            this.prefixReasoning = reasoning;
            this.prefixReasoningFormatted = formattedReasoning;
            this.prefixLength = formattedReasoning.length;
            this.prefixDuration = duration;
            this.prefixIncomplete = false;
        }
        return `${formattedReasoning}${content}`;
    }

    /**
     * Removes the reasoning prefix from the content.
     * @param {string} content Content with the reasoning prefix
     * @returns {string} Content without the reasoning prefix
     */
    removePrefix(content) {
        if (this.prefixLength > 0) {
            return content.slice(this.prefixLength);
        }
        return content;
    }
}
 function renderStoryString(params, { customStoryString = null, customInstructSettings = null, customContextSettings = null } = {}) {
    try {
        const instructSettings = structuredClone(customInstructSettings ?? power_user.instruct);
        const contextSettings = structuredClone(customContextSettings ?? power_user.context);
        const storyString = customStoryString ?? contextSettings.story_string;
        const storyStringPosition = contextSettings.story_string_position ?? extension_prompt_types.IN_PROMPT;

        // Validate and log possible warnings/errors
        // 缺字段提示和警告缓存属于设置页面；模板解析/宏求值及渲染错误仍走原算法。

        // compile the story string template into a function, with no HTML escaping
        const compiledTemplate = Handlebars.compile(storyString, { noEscape: true });

        // render the story string template with the given params
        let output = compiledTemplate(params);

        // substitute {{macro}} params that are not defined in the story string
        output = substituteParams(output, params.user, params.char);

        // remove leading newlines
        output = output.replace(/^\n+/, '');

        // add a newline to the end of the story string if it doesn't have one
        if (output.length > 0 && !output.endsWith('\n') && storyStringPosition !== extension_prompt_types.IN_CHAT) {
            if (!instructSettings.enabled || (instructSettings.wrap && !instructSettings.story_string_suffix)) {
                output += '\n';
            }
        }

        return output;
    } catch (e) {
        toastr.error('Check the story string template for validity', 'Error rendering story string');
        console.error('Error rendering story string', e);
        throw e; // rethrow the error
    }
}
 function addPersonaDescriptionExtensionPrompt() {
    const INJECT_TAG = 'PERSONA_DESCRIPTION';
    setExtensionPrompt(INJECT_TAG, '', extension_prompt_types.IN_PROMPT, 0);

    if (!power_user.persona_description || power_user.persona_description_position === persona_description_positions.NONE) {
        return;
    }

    const promptPositions = [persona_description_positions.BOTTOM_AN, persona_description_positions.TOP_AN];

    if (promptPositions.includes(power_user.persona_description_position) && shouldWIAddPrompt) {
        const originalAN = extension_prompts[NOTE_MODULE_NAME].value;
        const ANWithDesc = power_user.persona_description_position === persona_description_positions.TOP_AN
            ? `${power_user.persona_description}\n${originalAN}`
            : `${originalAN}\n${power_user.persona_description}`;

        setExtensionPrompt(NOTE_MODULE_NAME, ANWithDesc, chat_metadata[metadata_keys.position], chat_metadata[metadata_keys.depth], extension_settings.note.allowWIScan, chat_metadata[metadata_keys.role]);
    }

    if (power_user.persona_description_position === persona_description_positions.AT_DEPTH) {
        setExtensionPrompt(INJECT_TAG, power_user.persona_description, extension_prompt_types.IN_CHAT, power_user.persona_description_depth, true, power_user.persona_description_role);
    }
}
 function initializeAuthorNote() {
const DEFAULT_DEPTH = 4;
const DEFAULT_POSITION = 1;
const DEFAULT_INTERVAL = 1;
const DEFAULT_ROLE = extension_prompt_roles.SYSTEM;
if (extension_settings.note.defaultPosition === undefined) {
        extension_settings.note.defaultPosition = DEFAULT_POSITION;
    }
if (extension_settings.note.defaultDepth === undefined) {
        extension_settings.note.defaultDepth = DEFAULT_DEPTH;
    }
if (extension_settings.note.defaultInterval === undefined) {
        extension_settings.note.defaultInterval = DEFAULT_INTERVAL;
    }
if (extension_settings.note.defaultRole === undefined) {
        extension_settings.note.defaultRole = DEFAULT_ROLE;
    }
chat_metadata[metadata_keys.prompt] = chat_metadata[metadata_keys.prompt] ?? extension_settings.note.default ?? '';
chat_metadata[metadata_keys.interval] = chat_metadata[metadata_keys.interval] ?? extension_settings.note.defaultInterval ?? DEFAULT_INTERVAL;
chat_metadata[metadata_keys.position] = chat_metadata[metadata_keys.position] ?? extension_settings.note.defaultPosition ?? DEFAULT_POSITION;
chat_metadata[metadata_keys.depth] = chat_metadata[metadata_keys.depth] ?? extension_settings.note.defaultDepth ?? DEFAULT_DEPTH;
chat_metadata[metadata_keys.role] = chat_metadata[metadata_keys.role] ?? extension_settings.note.defaultRole ?? DEFAULT_ROLE;
}
 const readAuthorNote=()=>chat_metadata[metadata_keys.prompt] ?? extension_settings.note.default ?? '';
 async function prepare({type='normal',dryRun=false,input='',bias=null,quiet_prompt='',quietImage=null,skipWIAN=false,jsonSchema=null}={}) {
 initializeAuthorNote();
 const isContinue=type==='continue',isImpersonate=type==='impersonate',isInstruct=false,depth=0;
 let force_name2=false;
 const {messageBias,promptBias,isUserPromptBias}=bias || getBiasStrings(input,type);

 const world_info_include_names=settings.world_info_include_names ?? true;
 const {wi_anchor_position}=dependencies;
 const getWorldInfoPrompt=(...args)=>createWorldInfoRuntime({settings,context,loadWorldInfo,substituteParams,getTokenCountAsync,getRegexedString,regex_placement,eventSource,event_types,getExtensionPromptByName,shouldWIAddPrompt,warning:toast.warning}).getWorldInfoPrompt(...args);
 const GENERATION_TYPE_TRIGGERS=generationTriggers;
 const setOpenAIMessages=prompt.setOpenAIMessages,setOpenAIMessageExamples=prompt.setOpenAIMessageExamples;

    let { description, personality, persona, scenario, mesExamples, system, jailbreak, charDepthPrompt, creatorNotes, } = getCharacterCardFields();
    // Depth prompt (character-specific A/N)
    removeDepthPrompts();
    const groupDepthPrompts = getGroupDepthPrompts(selected_group, Number(this_chid));
    if (selected_group && Array.isArray(groupDepthPrompts) && groupDepthPrompts.length > 0) {
        groupDepthPrompts.forEach((value, index) => {
            const role = getExtensionPromptRoleByName(value.role);
            setExtensionPrompt(inject_ids.DEPTH_PROMPT_INDEX(index), value.text, extension_prompt_types.IN_CHAT, value.depth, extension_settings.note.allowWIScan, role);
        });
    }
    else {
        const depthPromptText = charDepthPrompt || '';
        const depthPromptDepth = characters[this_chid]?.data?.extensions?.depth_prompt?.depth ?? depth_prompt_depth_default;
        const depthPromptRole = getExtensionPromptRoleByName(characters[this_chid]?.data?.extensions?.depth_prompt?.role ?? depth_prompt_role_default);
        setExtensionPrompt(inject_ids.DEPTH_PROMPT, depthPromptText, extension_prompt_types.IN_CHAT, depthPromptDepth, extension_settings.note.allowWIScan, depthPromptRole);
    }
    // First message in fresh 1-on-1 chat reacts to user/character settings changes
    if (chat.length) {
        chat[0].mes = substituteParams(chat[0].mes);
    }
    // Collect messages with usable content
    const canUseTools = ToolManager.isToolCallingSupported();
    const canPerformToolCalls = !dryRun && ToolManager.canPerformToolCalls(type) && depth < ToolManager.RECURSE_LIMIT;
    let coreChat = chat.filter(x => !x.is_system || (canUseTools && Array.isArray(x.extra?.tool_invocations)));
    if (type === 'swipe') {
        coreChat.pop();
    }
    coreChat = await Promise.all(coreChat.map(async (/** @type {ChatMessage} */ chatItem, index) => {
        let message = chatItem.mes;
        let regexType = chatItem.is_user ? regex_placement.USER_INPUT : regex_placement.AI_OUTPUT;
        let options = { isPrompt: true, depth: (coreChat.length - index - (isContinue ? 2 : 1)) };
        let regexedMessage = getRegexedString(message, regexType, options);
        regexedMessage = await appendFileContent(chatItem, regexedMessage);
        const titles = [];
        if (chatItem?.extra?.append_title && chatItem?.extra?.title) {
            titles.push(chatItem.extra.title);
        }
        if (Array.isArray(chatItem?.extra?.media)) {
            for (const mediaItem of chatItem.extra.media) {
                if (mediaItem?.title && mediaItem?.append_title) {
                    titles.push(mediaItem.title);
                }
            }
        }
        if (titles.length > 0) {
            regexedMessage = `${regexedMessage}\n\n${titles.join('\n\n')}`;
        }
        return {
            ...chatItem,
            mes: regexedMessage,
            index,
        };
    }));
    const promptReasoning = new PromptReasoning();
    for (let i = coreChat.length - 1; i >= 0; i--) {
        const depth = coreChat.length - i - (isContinue ? 2 : 1);
        const isPrefix = isContinue && i === coreChat.length - 1;
        // In group chats, only include reasoning from the currently generating character
        const isOtherGroupMember = selected_group && coreChat[i].name !== name2;
        coreChat[i] = {
            ...coreChat[i],
            mes: isOtherGroupMember
                ? coreChat[i].mes
                : promptReasoning.addToMessage(coreChat[i].mes, getRegexedString(String(coreChat[i].extra?.reasoning ?? ''), regex_placement.REASONING, { isPrompt: true, depth: depth }), isPrefix, coreChat[i].extra?.reasoning_duration),
        };
        if (promptReasoning.isLimitReached()) {
            break;
        }
    }
    // Determine token limit
    let this_max_context = getMaxPromptTokens();
    if (!dryRun) {
        console.debug('Running extension interceptors');
        const aborted = await runGenerationInterceptors(coreChat, this_max_context, type);
        if (aborted) {
            console.debug('Generation aborted by extension interceptors');

            return Promise.resolve();
        }
    }
    else {
        console.debug('Skipping extension interceptors for dry run');
    }
    // Adjust token limit for Horde
    let adjustedParams;
    ;
    // Fetches the combined prompt for both negative and positive prompts
    const cfgGuidanceScale = getGuidanceScale();
    const useCfgPrompt = cfgGuidanceScale && cfgGuidanceScale.value !== 1;
    // Adjust max context based on CFG prompt to prevent overfitting
    if (useCfgPrompt) {
        const negativePrompt = getCfgPrompt(cfgGuidanceScale, true, true)?.value || '';
        const positivePrompt = getCfgPrompt(cfgGuidanceScale, false, true)?.value || '';
        if (negativePrompt || positivePrompt) {
            const previousMaxContext = this_max_context;
            const [negativePromptTokenCount, positivePromptTokenCount] = await Promise.all([getTokenCountAsync(negativePrompt), getTokenCountAsync(positivePrompt)]);
            const decrement = Math.max(negativePromptTokenCount, positivePromptTokenCount);
            this_max_context -= decrement;
            console.log(`Max context reduced by ${decrement} tokens of CFG prompt (${previousMaxContext} -> ${this_max_context})`);
        }
    }
    console.log(`Core/all messages: ${coreChat.length}/${chat.length}`);
    if ((promptBias && !isUserPromptBias) || power_user.always_force_name2 || main_api == 'novel') {
        force_name2 = true;
    }
    if (isImpersonate) {
        force_name2 = false;
    }
    let mesExamplesArray = parseMesExamples(mesExamples, isInstruct);
    // Set non-WI AN
    setFloatingPrompt();
    // Add WI to prompt (and also inject WI to AN value via hijack)
    // Make quiet prompt available for WIAN
    setExtensionPrompt(inject_ids.QUIET_PROMPT, quiet_prompt || '', extension_prompt_types.IN_PROMPT, 0, true);
    const chatForWI = coreChat.map(x => world_info_include_names ? `${x.name}: ${x.mes}` : x.mes).reverse();
    /** @type {import('./scripts/world-info.js').WIGlobalScanData} */
    const globalScanData = {
        personaDescription: persona,
        characterDescription: description,
        characterPersonality: personality,
        characterDepthPrompt: charDepthPrompt,
        scenario: scenario,
        creatorNotes: creatorNotes,
        trigger: GENERATION_TYPE_TRIGGERS.includes(type) ? type : 'normal',
    };
    const { worldInfoString, worldInfoBefore, worldInfoAfter, worldInfoExamples, worldInfoDepth, outletEntries } = await getWorldInfoPrompt(chatForWI, this_max_context, dryRun, globalScanData);
    setExtensionPrompt(inject_ids.QUIET_PROMPT, '', extension_prompt_types.IN_PROMPT, 0, true);
    // Add message example WI
    for (const example of worldInfoExamples) {
        const exampleMessage = example.content;
        if (exampleMessage.length === 0) {
            continue;
        }
        const formattedExample = baseChatReplace(exampleMessage);
        const cleanedExample = parseMesExamples(formattedExample, isInstruct);
        // Insert depending on before or after position
        if (example.position === wi_anchor_position.before) {
            mesExamplesArray.unshift(...cleanedExample);
        }
        else {
            mesExamplesArray.push(...cleanedExample);
        }
    }
    // At this point, the raw message examples can be created
    const mesExamplesRawArray = [...mesExamplesArray];
    ;
    if (skipWIAN !== true) {
        console.log('skipWIAN not active, adding WIAN');
        // Add all depth WI entries to prompt
        flushWIInjections();
        if (Array.isArray(worldInfoDepth)) {
            worldInfoDepth.forEach((e) => {
                const joinedEntries = e.entries.join('\n');
                setExtensionPrompt(inject_ids.CUSTOM_WI_DEPTH_ROLE(e.depth, e.role), joinedEntries, extension_prompt_types.IN_CHAT, e.depth, false, e.role);
            });
        }
        if (outletEntries && typeof outletEntries === 'object' && Object.keys(outletEntries).length > 0) {
            Object.entries(outletEntries).forEach(([key, value]) => {
                setExtensionPrompt(inject_ids.CUSTOM_WI_OUTLET(key), value.join('\n'), extension_prompt_types.NONE, 0);
            });
        }
    }
    else {
        console.log('skipping WIAN');
    }
    // Add persona description to prompt
    addPersonaDescriptionExtensionPrompt();
    ;
    // Collect before / after story string injections
    const beforeScenarioAnchor = await getExtensionPrompt(extension_prompt_types.BEFORE_PROMPT);
    const afterScenarioAnchor = await getExtensionPrompt(extension_prompt_types.IN_PROMPT);
    const storyStringParams = {
        description: description,
        personality: personality,
        persona: power_user.persona_description_position == persona_description_positions.IN_PROMPT ? persona : '',
        scenario: scenario,
        system: system,
        char: name2,
        user: name1,
        wiBefore: worldInfoBefore,
        wiAfter: worldInfoAfter,
        loreBefore: worldInfoBefore,
        loreAfter: worldInfoAfter,
        anchorBefore: beforeScenarioAnchor.trim(),
        anchorAfter: afterScenarioAnchor.trim(),
        mesExamples: mesExamplesArray.join(''),
        mesExamplesRaw: mesExamplesRawArray.join(''),
    };
    // Render the story string and combine with injections
    const storyString = renderStoryString(storyStringParams);
    let combinedStoryString = storyString;
    // Inject the story string as in-chat prompt (if needed)
    const applyStoryStringInject = main_api !== 'openai' && power_user.context.story_string_position === extension_prompt_types.IN_CHAT;
    if (applyStoryStringInject) {
        const depth = power_user.context.story_string_depth ?? 1;
        const role = power_user.context.story_string_role ?? extension_prompt_roles.SYSTEM;
        setExtensionPrompt(inject_ids.STORY_STRING, combinedStoryString, extension_prompt_types.IN_CHAT, depth, false, role);
        // Remove to prevent duplication
        combinedStoryString = '';
    }
    else {
        setExtensionPrompt(inject_ids.STORY_STRING, '', extension_prompt_types.IN_CHAT, 0);
    }
    // Story string rendered, safe to remove
    if (power_user.strip_examples) {
        mesExamplesArray = [];
    }
    // Inject all Depth prompts. Chat Completion does it separately
    let injectedIndices = [];
    ;
    ;
    let chat2 = [];
    let continue_mag = '';
    let userMessageIndices = [];
    const lastUserMessageIndex = coreChat.findLastIndex(x => x.is_user);
    for (let i = coreChat.length - 1, j = 0; i >= 0; i--, j++) {
    chat2[i] = coreChat[j].mes;
    if (i === 0 && isContinue) {
        chat2[i] = chat2[i].slice(0, chat2[i].lastIndexOf(coreChat[j].mes) + coreChat[j].mes.length);
        continue_mag = coreChat[j].mes;
    }
    continue;
}
    let addUserAlignment = isInstruct && power_user.instruct.user_alignment_message;
    let userAlignmentMessage = '';
    ;
    let oaiMessages = [];
    let oaiMessageExamples = [];
    {
        oaiMessages = setOpenAIMessages(coreChat);
        oaiMessageExamples = setOpenAIMessageExamples(mesExamplesArray);
    }

 if (chat2.length===0)chat2.push('');
 let cyclePrompt='';
 if(isContinue)cyclePrompt=chat2.shift();
 // 原 Chat Completion 的 getCombinedPrompt 提前返回空串；仍 await 合并后事件，
 // 其 prompt 不进入 OpenAI messages，监听器对变量/设置的副作用则必须发生在预算前。
 await eventSource.emit(event_types.GENERATE_AFTER_COMBINE_PROMPTS, { prompt: '', dryRun });
 const [messages,counts]=await prompt.prepareOpenAIMessages({name2,charDescription:description,charPersonality:personality,scenario,worldInfoBefore,worldInfoAfter,extensionPrompts:extension_prompts,bias:promptBias,type,quietPrompt:quiet_prompt,quietImage,cyclePrompt,systemPromptOverride:system,jailbreakPromptOverride:jailbreak,messages:oaiMessages,messageExamples:oaiMessageExamples},dryRun);
 if (!dryRun) {
     const count = prompt.messageCount + (['swipe', 'regenerate', 'continue'].includes(type) ? 1 : 0);
     chat_metadata.lastInContextMessageId = Math.max(0, chat.length - count);
 }
 if(prompt.manager.error)throw new Error(prompt.manager.error);
 const data={prompt:messages};
 await eventSource.emit(event_types.GENERATE_AFTER_DATA,data,dryRun);
 const packet=await prompt.createGenerationParameters(settings.oai_settings,dependencies.model,type,data.prompt,{jsonSchema});
 await eventSource.emit(event_types.CHAT_COMPLETION_SETTINGS_READY,packet.generate_data);
 return {method:'POST',url:'/api/backends/chat-completions/generate',body:JSON.parse(JSON.stringify(packet.generate_data)),stream:packet.stream,canMultiSwipe:packet.canMultiSwipe,counts,world:{worldInfoBefore,worldInfoAfter},metadata:context.chatMetadata};
 }

function cleanGroupMessage(getMessage) {
    if (power_user.disable_group_trimming) {
        return getMessage;
    }

    const group = groups.find((x) => x.id == selected_group);

    if (group && Array.isArray(group.members) && group.members) {
        for (let member of group.members) {
            const character = characters.find(x => x.avatar == member);

            if (!character) {
                continue;
            }

            const name = character.name;

            // Skip current speaker.
            if (name === name2) {
                continue;
            }

            const regex = new RegExp(`(^|\n)${escapeRegex(name)}:`);
            const nameMatch = getMessage.match(regex);
            if (nameMatch) {
                getMessage = getMessage.substring(0, nameMatch.index);
            }
        }
    }
    return getMessage;
}
function fixMarkdown(text, forDisplay) {
    // Find pairs of formatting characters and capture the text in between them
    const format = /([*_]{1,2})([\s\S]*?)\1/gm;
    let matches = [];
    let match;
    while ((match = format.exec(text)) !== null) {
        matches.push(match);
    }

    // Iterate through the matches and replace adjacent spaces immediately beside formatting characters
    let newText = text;
    for (let i = matches.length - 1; i >= 0; i--) {
        let matchText = matches[i][0];
        let replacementText = matchText.replace(/(\*|_)([\t \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000\ufeff]+)|([\t \u00a0\u1680\u2000-\u200a\u202f\u205f\u3000\ufeff]+)(\*|_)/g, '$1$4');
        newText = newText.slice(0, matches[i].index) + replacementText + newText.slice(matches[i].index + matchText.length);
    }

    // Don't auto-fix asterisks if this is a message clean-up procedure.
    // It botches the continue function. Apply this to display only.
    if (!forDisplay) {
        return newText;
    }

    const splitText = newText.split('\n');

    // Fix asterisks, and quotes that are not paired
    for (let index = 0; index < splitText.length; index++) {
        const line = splitText[index];
        const charsToCheck = ['*', '"'];
        for (const char of charsToCheck) {
            if (line.includes(char) && isOdd(countOccurrences(line, char))) {
                splitText[index] = line.trimEnd() + char;
            }
        }
    }

    newText = splitText.join('\n');

    return newText;
}
function getStoppingStrings() { return getCustomStoppingStrings(); }
function cleanUpMessage({ getMessage, isImpersonate, isContinue, displayIncompleteSentences = false, stoppingStrings = null, includeUserPromptBias = true, trimNames = true, trimWrongNames = true } = {}) {
    if (arguments.length > 0 && typeof arguments[0] !== 'object') {
        console.trace('cleanUpMessage called with positional arguments. Please use an object instead.');
        [getMessage, isImpersonate, isContinue, displayIncompleteSentences, stoppingStrings, includeUserPromptBias, trimNames, trimWrongNames] = arguments;
    }
    if (!getMessage) {
        return '';
    }
    // Add the prompt bias before anything else
    if (includeUserPromptBias &&
        power_user.user_prompt_bias &&
        !isImpersonate &&
        !isContinue &&
        power_user.user_prompt_bias.length !== 0) {
        getMessage = substituteParams(power_user.user_prompt_bias) + getMessage;
    }
    // Allow for caching of stopping strings. getStoppingStrings is an expensive function, especially with macros
    // enabled, so for streaming, we call it once and then pass it into each cleanUpMessage call.
    if (!stoppingStrings) {
        stoppingStrings = getStoppingStrings(isImpersonate, isContinue, main_api);
    }
    for (const stoppingString of stoppingStrings) {
        if (stoppingString.length) {
            for (let j = stoppingString.length; j > 0; j--) {
                if (getMessage.slice(-j) === stoppingString.slice(0, j)) {
                    getMessage = getMessage.slice(0, -j);
                    break;
                }
            }
        }
    }
    // Regex uses vars, so add before formatting
    getMessage = getRegexedString(getMessage, isImpersonate ? regex_placement.USER_INPUT : regex_placement.AI_OUTPUT);
    if (power_user.collapse_newlines) {
        getMessage = collapseNewlines(getMessage);
    }
    // trailing invisible whitespace before every newlines, on a multiline string
    // "trailing whitespace on newlines       \nevery line of the string    \n?sample text" ->
    // "trailing whitespace on newlines\nevery line of the string\nsample text"
    getMessage = getMessage.replace(/[^\S\r\n]+$/gm, '');
    if (trimWrongNames) {
        // If this is an impersonation, delete the entire response if it starts with "{{char}}:"
        // If this isn't an impersonation, delete the entire response if it starts with "{{user}}:"
        // Also delete any trailing text that starts with the wrong name.
        // This only occurs if the corresponding "power_user.allow_nameX_display" is false.
        let wrongName = isImpersonate
            ? (!power_user.allow_name2_display ? name2 : '') // char
            : (!power_user.allow_name1_display ? name1 : ''); // user
        if (wrongName) {
            // If the message starts with the wrong name, delete the entire response
            let startIndex = getMessage.indexOf(`${wrongName}:`);
            if (startIndex === 0) {
                getMessage = '';
                console.debug(`Message started with the wrong name: "${wrongName}" - response was deleted.`);
            }
            // If there is trailing text starting with the wrong name, trim it off.
            startIndex = getMessage.indexOf(`\n${wrongName}:`);
            if (startIndex >= 0) {
                getMessage = getMessage.substring(0, startIndex);
            }
        }
    }
    if (getMessage.indexOf('<|endoftext|>') != -1) {
        getMessage = getMessage.substring(0, getMessage.indexOf('<|endoftext|>'));
    }
    const isInstruct = power_user.instruct.enabled && main_api !== 'openai';
    const isNotEmpty = (str) => str && str.trim() !== '';
    // clean-up group message from excessive generations
    if (selected_group) {
        getMessage = cleanGroupMessage(getMessage);
    }
    if (!power_user.allow_name2_display) {
        const name2Escaped = escapeRegex(name2);
        getMessage = getMessage.replace(new RegExp(`(^|\n)${name2Escaped}:\\s*`, 'g'), '$1');
    }
    if (isImpersonate) {
        getMessage = getMessage.trim();
    }
    if (power_user.auto_fix_generated_markdown) {
        getMessage = fixMarkdown(getMessage, false);
    }
    if (trimNames) {
        // If this is an impersonation, trim "{{user}}:" from the beginning
        // If this isn't an impersonation, trim "{{char}}:" from the beginning.
        // Only applied when the corresponding "power_user.allow_nameX_display" is false.
        const nameToTrim2 = isImpersonate
            ? (!power_user.allow_name1_display ? name1 : '') // user
            : (!power_user.allow_name2_display ? name2 : ''); // char
        if (nameToTrim2 && getMessage.startsWith(nameToTrim2 + ':')) {
            getMessage = getMessage.replace(nameToTrim2 + ':', '');
            getMessage = getMessage.trimStart();
        }
    }
    if (isImpersonate) {
        getMessage = getMessage.trim();
    }
    if (!displayIncompleteSentences && power_user.trim_sentences) {
        getMessage = trimToEndSentence(getMessage);
    }
    if (power_user.trim_spaces && !PromptReasoning.getLatestPrefix()) {
        getMessage = getMessage.trim();
    }
    return getMessage;
}

 return {prepare, cleanUpMessage, getStoppingStrings};
}
