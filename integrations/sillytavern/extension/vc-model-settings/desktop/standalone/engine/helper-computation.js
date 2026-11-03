// AGPL-3.0-only. Locked Helper 0af421068e4 generate data/preset/raw algorithms.
// Explicit computation ports replace native author-note controls and preset-manager DOM.
import { chat, chat_metadata, characters, this_chid, name1, name2, power_user, extension_settings, extension_prompts, oai_settings } from './ports.js';
import { baseChatReplace, substituteParams, getBiasStrings, getCharacterCardFields, getExtensionPromptRoleByName, setExtensionPrompt, extension_prompt_types, getExtensionPromptByName, MAX_INJECTION_DEPTH } from './st/script.js';
import { persona_description_positions } from './st/constants.js';
import { isImageInliningSupported } from './st/scripts/openai.js';
import { createWorldInfoRuntime, wi_anchor_position } from './world-info.js';
import { extension_prompt_roles, character_names_behavior, placeholder_prompt_default_order, default_order } from './helper-types.js';
export function createHelperPromptRuntime({context,settings,regex,prompt,tokenizer,computation,loadWorldInfo,getMaxContextSize}) {
const {ChatCompletion,Message,MessageCollection,Prompt,PromptCollection,setOpenAIMessages,setOpenAIMessageExamples,prepareOpenAIMessages}=prompt;
const getContext=()=>context, eventSource=context.eventSource,event_types=context.eventTypes;
const getRegexedString=regex.getRegexedString,regex_placement=regex.regex_placement,world_info_include_names=settings.world_info_include_names;
const uuidv4=()=>crypto.randomUUID(),setupChatCompletionPromptManager=()=>prompt.manager;
const NOTE_MODULE_NAME='2_floating_prompt',metadata_keys={prompt:'note_prompt',interval:'note_interval',depth:'note_depth',position:'note_position',role:'note_role'};
computation.prepareAuthorNote();const shouldWIAddPrompt=computation.shouldWIAddPrompt;
const getWorldInfoPrompt=(...args)=>createWorldInfoRuntime({settings,context,loadWorldInfo,substituteParams,getTokenCountAsync:tokenizer.getTokenCountAsync,getRegexedString,regex_placement,eventSource,event_types,getExtensionPromptByName,shouldWIAddPrompt}).getWorldInfoPrompt(...args);
const saveChatConditionalDebounced=()=>{context.metadataDirty=true;};
const getBase64Async=file=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);});
const isDataURL=value=>/^data:/.test(value);
const injectPrompts=prompts=>{for(const item of prompts)setExtensionPrompt(item.id,item.content,item.position==='none'?-1:1,item.depth??4,item.scan??false,({system:0,user:1,assistant:2})[item.role??'system'],item.filter);};
async function convertFileToBase64(img) {
    const isDataUrl = typeof img === 'string' && isDataURL(img);
    let processedImg;
    if (!isDataUrl) {
        try {
            if (typeof img === 'string') {
                const response = await fetch(img, { method: 'GET', cache: 'force-cache' });
                if (!response.ok)
                    throw new Error('Failed to fetch image');
                const blob = await response.blob();
                processedImg = await getBase64Async(blob);
            }
            else {
                processedImg = await getBase64Async(img);
            }
        }
        catch (err) {
            return undefined;
        }
    }
    else {
        processedImg = img;
    }
    return processedImg;
}
function parseMesExamples(examplesStr) {
    if (examplesStr.length === 0 || examplesStr === '<START>') {
        return [];
    }
    if (!examplesStr.startsWith('<START>')) {
        examplesStr = '<START>\n' + examplesStr.trim();
    }
    const blockHeading = '<START>\n';
    const splitExamples = examplesStr
        .split(/<START>/gi)
        .slice(1)
        .map(block => `${blockHeading}${block.trim()}\n`);
    return splitExamples;
}
function processUserInput(user_input) {
    if (user_input === '') {
        user_input = oai_settings.send_if_empty.trim();
    }
    return getRegexedString(user_input, regex_placement.USER_INPUT, {
        isPrompt: true,
        depth: 0,
    });
}
function getPromptRole(role) {
    switch (role) {
        case extension_prompt_roles.SYSTEM:
            return 'system';
        case extension_prompt_roles.USER:
            return 'user';
        case extension_prompt_roles.ASSISTANT:
            return 'assistant';
        default:
            return 'system';
    }
}
function isPromptFiltered(promptId, config) {
    if (!config.overrides) {
        return false;
    }
    if (promptId === 'with_depth_entries') {
        return config.overrides.with_depth_entries === false;
    }
    // 特殊处理 chat_history
    if (promptId === 'chat_history') {
        const prompts = config.overrides.chat_history;
        return prompts !== undefined && prompts.length === 0;
    }
    // 对于普通提示词，只有当它在 overrides 中存在且为空字符串时才被过滤
    const override = config.overrides[promptId];
    return override !== undefined && override === '';
}
function addTemporaryUserMessage(userContent) {
    setExtensionPrompt('TEMP_USER_MESSAGE', userContent, extension_prompt_types.IN_PROMPT, 0, true, 1);
}
function removeTemporaryUserMessage() {
    setExtensionPrompt('TEMP_USER_MESSAGE', '', extension_prompt_types.IN_PROMPT, 0, true, 1);
}
async function clearInjectionPrompts(prefixes) {
    const prompts = getContext().extensionPrompts;
    Object.keys(prompts)
        .filter(key => prefixes.some(prefix => key.startsWith(prefix)))
        .forEach(key => delete prompts[key]);
    saveChatConditionalDebounced();
}
async function processImageArrayDirectly(processedUserInput, image) {
    const quality = oai_settings.inline_image_quality || 'low';
    const imageContents = await Promise.all(image.map(async (img) => {
        try {
            const processedImg = await convertFileToBase64(img);
            if (!processedImg) {
                console.warn('[TavernHelper][Generate:图片数组处理] 图片处理失败，跳过该图片');
                return null;
            }
            return {
                type: 'image_url',
                image_url: { url: processedImg, detail: quality },
            };
        }
        catch (imgError) {
            console.warn('[TavernHelper][Generate:图片数组处理] 图片处理失败，跳过该图片');
            return null;
        }
    }));
    const validImageContents = imageContents.filter(content => content !== null);
    const textContent = {
        type: 'text',
        text: processedUserInput,
    };
    return [textContent, ...validImageContents];
}
function setupImageArrayProcessing(processedUserInput, image) {
    const imageMarker = `__IMG_ARRAY_MARKER_`;
    const userInputWithMarker = processedUserInput + imageMarker;
    let resolveImageProcessing;
    let rejectImageProcessing;
    const imageProcessingPromise = new Promise((resolve, reject) => {
        resolveImageProcessing = resolve;
        rejectImageProcessing = reject;
    });
    let timeoutId = null;
    let isHandlerRegistered = true;
    const imageArrayHandler = async (eventData) => {
        try {
            // 添加超时保护
            timeoutId = setTimeout(() => {
                console.warn('[TavernHelper][Generate:图片数组处理] 图片处理超时');
                rejectImageProcessing(new Error('图片处理超时'));
            }, 30000);
            for (let i = eventData.chat.length - 1; i >= 0; i--) {
                const message = eventData.chat[i];
                const contentStr = typeof message.content === 'string' ? message.content : '';
                if (message.role === 'user' && contentStr.includes(imageMarker)) {
                    try {
                        const quality = oai_settings.inline_image_quality || 'low';
                        const imageContents = await Promise.all(image.map(async (img) => {
                            try {
                                const processedImg = await convertFileToBase64(img);
                                if (!processedImg) {
                                    console.warn('[TavernHelper][Generate:图片数组处理] 图片处理失败，跳过该图片');
                                    return null;
                                }
                                return {
                                    type: 'image_url',
                                    image_url: { url: processedImg, detail: quality },
                                };
                            }
                            catch (imgError) {
                                console.warn('[TavernHelper][Generate:图片数组处理] 单个图片处理失败:', imgError);
                                return null;
                            }
                        }));
                        const validImageContents = imageContents.filter(content => content !== null);
                        const cleanContent = contentStr.replace(imageMarker, '');
                        const textContent = {
                            type: 'text',
                            text: cleanContent,
                        };
                        message.content = [textContent, ...validImageContents];
                        if (timeoutId) {
                            clearTimeout(timeoutId);
                            timeoutId = null;
                        }
                        resolveImageProcessing();
                        return;
                    }
                    catch (error) {
                        if (timeoutId) {
                            clearTimeout(timeoutId);
                            timeoutId = null;
                        }
                        console.error('[TavernHelper][Generate:图片数组处理] 处理图片时出错:', error);
                        rejectImageProcessing(error);
                        return;
                    }
                }
            }
            console.warn('[TavernHelper][Generate:图片数组处理] 未找到包含图片标记的用户消息');
            resolveImageProcessing();
        }
        catch (error) {
            console.error('[TavernHelper][Generate:图片数组处理] imageArrayHandler 异常:', error);
            rejectImageProcessing(error);
        }
    };
    eventSource.once('chat_completion_prompt_ready', imageArrayHandler);
    const cleanup = () => {
        if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
        }
        if (isHandlerRegistered) {
            try {
                eventSource.removeListener('chat_completion_prompt_ready', imageArrayHandler);
                isHandlerRegistered = false;
            }
            catch (error) {
                console.warn('[TavernHelper][Generate:图片数组处理] 清理事件监听器时出错:', error);
            }
        }
    };
    return {
        userInputWithMarker,
        imageProcessingPromise,
        resolveImageProcessing: resolveImageProcessing,
        rejectImageProcessing: rejectImageProcessing,
        cleanup,
    };
}
async function prepareAndOverrideData(config, processedUserInput) {
    const getOverrideContent = (identifier) => {
        if (!config.overrides)
            return undefined;
        const value = config.overrides[identifier];
        if (typeof value === 'boolean')
            return undefined;
        return value;
    };
    // 1. 处理角色卡高级定义角色备注 - 仅在chat_history未被过滤时执行
    if (!isPromptFiltered('chat_history', config)) {
        handleCharDepthPrompt();
    }
    // 2. 设置作者注释 - 仅在chat_history未被过滤时执行
    if (!isPromptFiltered('chat_history', config) && !isPromptFiltered('author_note', config)) {
        setAuthorNotePrompt(config);
    }
    // 3. 处理user角色描述 - 仅在chat_history和persona_description都未被过滤时执行
    if (!isPromptFiltered('chat_history', config) && !isPromptFiltered('persona_description', config)) {
        setPersonaDescriptionExtensionPrompt();
    }
    const character = characters.at(this_chid);
    // 4. 获取角色卡基础字段
    const charDepthPrompt = baseChatReplace(character?.data?.extensions?.depth_prompt?.prompt?.trim(), name1, name2);
    const creatorNotes = baseChatReplace(character?.data?.creator_notes?.trim(), name1, name2);
    const { description: rawDescription, personality: rawPersonality, persona: rawPersona, scenario: rawScenario, mesExamples: rawMesExamples, system, jailbreak, } = getCharacterCardFields();
    // 判断是否被过滤,如果被过滤返回空字符串,否则返回override的值或原始值
    const description = isPromptFiltered('char_description', config)
        ? ''
        : (getOverrideContent('char_description') ?? rawDescription);
    const personality = isPromptFiltered('char_personality', config)
        ? ''
        : (getOverrideContent('char_personality') ?? rawPersonality);
    const persona = isPromptFiltered('persona_description', config)
        ? ''
        : (getOverrideContent('persona_description') ?? rawPersona);
    const scenario = isPromptFiltered('scenario', config) ? '' : (getOverrideContent('scenario') ?? rawScenario);
    const mesExamples = isPromptFiltered('dialogue_examples', config)
        ? ''
        : (getOverrideContent('dialogue_examples') ?? rawMesExamples);
    const mesExamplesArray = parseMesExamples(mesExamples);
    const oaiMessageExamples = setOpenAIMessageExamples(mesExamplesArray);
    // 5. 获取偏置字符串
    const { promptBias } = getBiasStrings(processedUserInput, 'normal');
    // 6. 处理自定义注入的提示词
    if (config.inject) {
        await handleInjectedPrompts(config);
    }
    // 7. 处理聊天记录
    let oaiMessages;
    if (config.overrides?.chat_history) {
        oaiMessages = [...config.overrides.chat_history].reverse();
    }
    else {
        oaiMessages = setOpenAIMessages(await processChatHistory(chat));
        if (config.max_chat_history !== undefined) {
            oaiMessages = oaiMessages.slice(0, config.max_chat_history);
        }
    }
    // 添加临时消息用于激活世界书
    addTemporaryUserMessage(processedUserInput);
    // 8. 处理世界信息
    const worldInfo = await processWorldInfo(oaiMessages, config, {
        description: rawDescription,
        personality: rawPersonality,
        persona: rawPersona,
        scenario: rawScenario,
        charDepthPrompt,
        creatorNotes,
    });
    // 移除临时消息
    removeTemporaryUserMessage();
    // 9. 处理世界书消息示例
    if (!isPromptFiltered('dialogue_examples', config)) {
        await processMessageExamples(mesExamplesArray, worldInfo.worldInfoExamples);
    }
    return {
        characterInfo: {
            description,
            personality,
            persona,
            scenario,
            system: system,
            jailbreak: jailbreak,
        },
        chatContext: {
            oaiMessages,
            oaiMessageExamples,
            promptBias,
        },
        worldInfo,
    };
}
function handleCharDepthPrompt() {
    const character = characters.at(this_chid);
    const depthPromptText = baseChatReplace(character?.data?.extensions?.depth_prompt?.prompt?.trim(), name1, name2) || '';
    const depthPromptDepth = character?.data?.extensions?.depth_prompt?.depth ?? 4;
    const depthPromptRole = getExtensionPromptRoleByName(character?.data?.extensions?.depth_prompt?.role ?? 'system');
    setExtensionPrompt('DEPTH_PROMPT', depthPromptText, extension_prompt_types.IN_CHAT, depthPromptDepth, 
    // @ts-expect-error 类型正确
    extension_settings.note.allowWIScan, depthPromptRole);
}
function setAuthorNotePrompt(config) {
    const authorNoteOverride = config?.overrides?.author_note;
    const prompt = authorNoteOverride ?? (chat_metadata.note_prompt ?? '');
    setExtensionPrompt(NOTE_MODULE_NAME, prompt, chat_metadata[metadata_keys.position], chat_metadata[metadata_keys.depth], 
    // @ts-expect-error 类型正确
    extension_settings.note.allowWIScan, chat_metadata[metadata_keys.role]);
}
function setPersonaDescriptionExtensionPrompt() {
    const description = power_user.persona_description;
    const INJECT_TAG = 'PERSONA_DESCRIPTION';
    setExtensionPrompt(INJECT_TAG, '', extension_prompt_types.IN_PROMPT, 0);
    if (!description || power_user.persona_description_position === persona_description_positions.NONE) {
        return;
    }
    //当user信息在作者注释前后 - 仅在作者注释未被过滤时执行
    const promptPositions = [persona_description_positions.BOTTOM_AN, persona_description_positions.TOP_AN];
    if (promptPositions.includes(power_user.persona_description_position) && shouldWIAddPrompt) {
        const originalAN = _.get(extension_prompts, NOTE_MODULE_NAME);
        const ANWithDesc = power_user.persona_description_position === persona_description_positions.TOP_AN
            ? `${description}\n${originalAN}`
            : `${originalAN}\n${description}`;
        setExtensionPrompt(NOTE_MODULE_NAME, ANWithDesc, chat_metadata[metadata_keys.position], chat_metadata[metadata_keys.depth], 
        // @ts-expect-error 类型正确
        extension_settings.note.allowWIScan, chat_metadata[metadata_keys.role]);
    }
    // user信息深度注入不依赖于作者注释的状态，直接应用
    if (power_user.persona_description_position === persona_description_positions.AT_DEPTH) {
        setExtensionPrompt(INJECT_TAG, description, extension_prompt_types.IN_CHAT, power_user.persona_description_depth, true, power_user.persona_description_role);
    }
}
async function handleInjectedPrompts(promptConfig) {
    // generateRaw 的注入提示词会由代码自行注入, 不必在此注入
    if (!promptConfig || !Array.isArray(promptConfig.inject) || !promptConfig.use_preset)
        return;
    injectPrompts(promptConfig.inject.map(prompt => ({ id: `TH-CustomInjects-${uuidv4()}`, ...prompt })), { once: true });
}
async function processChatHistory(chatHistory) {
    const coreChat = chatHistory.filter(x => !x.is_system);
    return await Promise.all(coreChat.map(async (chatItem, index) => {
        const message = chatItem.mes;
        const regexType = chatItem.is_user ? regex_placement.USER_INPUT : regex_placement.AI_OUTPUT;
        const regexedMessage = getRegexedString(message, regexType, {
            isPrompt: true,
            depth: coreChat.length - index - 1,
        });
        return {
            ...chatItem,
            mes: regexedMessage,
            index,
        };
    }));
}
async function processWorldInfo(oaiMessages, config, characterInfo) {
    const chatForWI = oaiMessages
        .filter(x => x.role !== 'system')
        .map(x => {
        const name = x.role === 'user' ? name1 : name2;
        return world_info_include_names ? `${name}: ${x.content}` : x.content;
    })
        .reverse();
    const this_max_context = getMaxContextSize();
    const globalScanData = {
        personaDescription: config.overrides?.persona_description ?? characterInfo.persona,
        characterDescription: config.overrides?.char_description ?? characterInfo.description,
        characterPersonality: config.overrides?.char_personality ?? characterInfo.personality,
        characterDepthPrompt: characterInfo.charDepthPrompt,
        scenario: config.overrides?.scenario ?? characterInfo.scenario,
        creatorNotes: characterInfo.creatorNotes,
    };
    const { worldInfoString, worldInfoBefore, worldInfoAfter, worldInfoExamples, worldInfoDepth } = 
    // @ts-expect-error 不考虑新的 trigger 字段
    await getWorldInfoPrompt(chatForWI, this_max_context, false, globalScanData);
    await clearInjectionPrompts(['customDepthWI']);
    if (!isPromptFiltered('with_depth_entries', config)) {
        processWorldInfoDepth(worldInfoDepth);
    }
    // 先检查是否被过滤，如果被过滤直接返回null
    const finalWorldInfoBefore = isPromptFiltered('world_info_before', config)
        ? null
        : config.overrides?.world_info_before !== undefined
            ? config.overrides.world_info_before
            : worldInfoBefore;
    const finalWorldInfoAfter = isPromptFiltered('world_info_after', config)
        ? null
        : config.overrides?.world_info_after !== undefined
            ? config.overrides.world_info_after
            : worldInfoAfter;
    return {
        worldInfoString,
        worldInfoBefore: finalWorldInfoBefore,
        worldInfoAfter: finalWorldInfoAfter,
        worldInfoExamples,
        worldInfoDepth: !isPromptFiltered('with_depth_entries', config) ? worldInfoDepth : [],
    };
}
function processWorldInfoDepth(worldInfoDepth) {
    if (Array.isArray(worldInfoDepth)) {
        worldInfoDepth.forEach(entry => {
            const joinedEntries = entry.entries.join('\n');
            setExtensionPrompt(`customDepthWI-${entry.depth}-${entry.role}`, joinedEntries, extension_prompt_types.IN_CHAT, entry.depth, false, entry.role);
        });
    }
}
async function processMessageExamples(mesExamplesArray, worldInfoExamples) {
    // 处理世界信息中的示例
    for (const example of worldInfoExamples) {
        if (!example.content.length)
            continue;
        const formattedExample = baseChatReplace(example.content, name1, name2);
        const cleanedExample = parseMesExamples(formattedExample);
        if (example.position === wi_anchor_position.before) {
            mesExamplesArray.unshift(...cleanedExample);
        }
        else {
            mesExamplesArray.push(...cleanedExample);
        }
    }
    return mesExamplesArray;
}
const dryRun = false;
async function handlePresetPath(baseData, processedUserInput, config) {
    // prepareOpenAIMessages会从设置里读取场景因此临时覆盖
    let originalScenario = null;
    const character = characters.at(this_chid);
    try {
        const scenarioOverride = config?.overrides?.scenario;
        if (scenarioOverride && character) {
            // 保存原始场景
            originalScenario = character.scenario || null;
            character.scenario = scenarioOverride;
        }
        // 添加user消息(一次性)
        const userMessageTemp = {
            role: 'user',
            content: processedUserInput,
            image: config.image,
        };
        if (config.image) {
            if (Array.isArray(config.image)) {
                delete userMessageTemp.image;
            }
            else {
                userMessageTemp.image = await convertFileToBase64(config.image);
            }
        }
        baseData.chatContext.oaiMessages.unshift(userMessageTemp);
        const messageData = {
            name2,
            charDescription: baseData.characterInfo.description,
            charPersonality: baseData.characterInfo.personality,
            Scenario: baseData.characterInfo.scenario,
            worldInfoBefore: baseData.worldInfo.worldInfoBefore,
            worldInfoAfter: baseData.worldInfo.worldInfoAfter,
            extensionPrompts: getContext().extensionPrompts,
            bias: baseData.chatContext.promptBias,
            type: 'normal',
            quietPrompt: '',
            quietImage: null,
            cyclePrompt: '',
            systemPromptOverride: baseData.characterInfo.system,
            jailbreakPromptOverride: baseData.characterInfo.jailbreak,
            personaDescription: baseData.characterInfo.persona,
            messages: baseData.chatContext.oaiMessages,
            messageExamples: baseData.chatContext.oaiMessageExamples,
        };
        const [prompt] = await prepareOpenAIMessages(messageData, dryRun);
        return { prompt };
    }
    finally {
        // 恢复原始场景
        if (originalScenario !== null && character) {
            character.scenario = originalScenario;
        }
    }
}
async function convertSystemPromptsToCollection(baseData, promptConfig) {
    const promptCollection = new PromptCollection();
    const examplesCollection = new MessageCollection('dialogue_examples');
    const orderArray = promptConfig.order || placeholder_prompt_default_order;
    const builtinPromptContents = {
        world_info_before: baseData.worldInfo.worldInfoBefore,
        persona_description: power_user.persona_description &&
            power_user.persona_description_position === persona_description_positions.IN_PROMPT
            ? baseData.characterInfo.persona
            : null,
        char_description: baseData.characterInfo.description,
        char_personality: baseData.characterInfo.personality,
        scenario: baseData.characterInfo.scenario,
        world_info_after: baseData.worldInfo.worldInfoAfter,
    };
    for (const [index, item] of orderArray.entries()) {
        if (typeof item === 'string') {
            // 处理内置提示词
            const content = builtinPromptContents[item];
            if (content) {
                promptCollection.add(new Prompt({
                    identifier: item,
                    role: 'system',
                    content: content,
                    system_prompt: true,
                }));
            }
        }
        else if (typeof item === 'object' && item.role && item.content) {
            // 处理自定义注入
            const identifier = `custom_prompt_${index}`;
            promptCollection.add(new Prompt({
                identifier: identifier,
                role: item.role,
                content: item.content,
                system_prompt: item.role === 'system',
            }));
        }
    }
    if (baseData.chatContext.oaiMessageExamples.length > 0) {
        // 遍历所有对话示例
        for (const dialogue of [...baseData.chatContext.oaiMessageExamples]) {
            const dialogueIndex = baseData.chatContext.oaiMessageExamples.indexOf(dialogue);
            const chatMessages = [];
            for (let promptIndex = 0; promptIndex < dialogue.length; promptIndex++) {
                const prompt = dialogue[promptIndex];
                const role = 'system';
                const content = prompt.content || '';
                const identifier = `dialogue_examples ${dialogueIndex}-${promptIndex}`;
                const chatMessage = await Message.createAsync(role, content, identifier);
                await chatMessage.setName(prompt.name);
                chatMessages.push(chatMessage);
            }
            for (const message of chatMessages) {
                examplesCollection.add(message);
            }
        }
    }
    return {
        systemPrompts: promptCollection,
        dialogue_examples: examplesCollection,
    };
}
async function processChatHistoryAndInject(baseData, promptConfig, chatCompletion, processedUserInput, processedImageArray) {
    const orderArray = promptConfig.order || default_order;
    const chatHistoryIndex = orderArray.findIndex(item => typeof item === 'string' && item.toLowerCase() === 'chat_history');
    const userInputIndex = orderArray.findIndex(item => typeof item === 'string' && item.toLowerCase() === 'user_input');
    const hasUserInput = userInputIndex !== -1;
    const hasChatHistory = chatHistoryIndex !== -1;
    const isChatHistoryFiltered = isPromptFiltered('chat_history', promptConfig);
    // 创建用户输入消息
    let userMessage;
    if (processedImageArray && hasUserInput) {
        // 如果有处理后的图片数组，直接使用数组格式创建消息
        userMessage = await Message.createAsync('user', processedImageArray, 'user_input');
    }
    else {
        // 否则使用原有逻辑
        userMessage = await Message.createAsync('user', processedUserInput, 'user_input');
        if (promptConfig.image && hasUserInput) {
            if (!Array.isArray(promptConfig.image)) {
                const img = await convertFileToBase64(promptConfig.image);
                if (img) {
                    await userMessage.addImage(img);
                }
            }
        }
    }
    // 如果聊天记录被过滤或不在order中，只处理用户输入
    if (isChatHistoryFiltered || !hasChatHistory) {
        const insertIndex = hasUserInput ? userInputIndex : orderArray.length;
        chatCompletion.add(new MessageCollection('user_input', userMessage), insertIndex);
        return;
    }
    // 处理聊天记录
    const chatCollection = new MessageCollection('chat_history');
    // 为新聊天指示预留token
    const newChat = oai_settings.new_chat_prompt;
    const newChatMessage = await Message.createAsync('system', substituteParams(newChat), 'newMainChat');
    chatCompletion.reserveBudget(newChatMessage);
    // 添加新聊天提示词到集合的最前面
    chatCollection.add(newChatMessage);
    // 处理空消息替换
    const lastChatPrompt = baseData.chatContext.oaiMessages[baseData.chatContext.oaiMessages.length - 1];
    const emptyMessage = await Message.createAsync('user', oai_settings.send_if_empty, 'emptyUserMessageReplacement');
    if (lastChatPrompt &&
        lastChatPrompt.role === 'assistant' &&
        oai_settings.send_if_empty &&
        chatCompletion.canAfford(emptyMessage)) {
        chatCollection.add(emptyMessage);
    }
    // 将用户消息添加到消息数组中准备处理注入
    if (!hasUserInput) {
        let userPrompt;
        if (processedImageArray) {
            // 如果有处理后的图片数组，使用数组格式
            userPrompt = {
                role: 'user',
                content: processedImageArray,
                identifier: 'user_input',
            };
        }
        else {
            // 否则使用原有逻辑
            userPrompt = {
                role: 'user',
                content: processedUserInput,
                identifier: 'user_input',
                image: promptConfig.image && !Array.isArray(promptConfig.image)
                    ? await convertFileToBase64(promptConfig.image)
                    : undefined,
            };
        }
        baseData.chatContext.oaiMessages.unshift(userPrompt);
    }
    // 处理注入和添加消息
    const messages = (await populationInjectionPrompts(baseData, baseData.chatContext.oaiMessages, promptConfig.inject, promptConfig)).reverse();
    const imageInlining = isImageInliningSupported();
    // 添加聊天记录
    const chatPool = [...messages];
    for (const chatPrompt of chatPool) {
        const prompt = new Prompt(chatPrompt);
        prompt.identifier = `chat_history-${messages.length - chatPool.indexOf(chatPrompt)}`;
        prompt.content = substituteParams(prompt.content);
        const chatMessage = await Message.fromPromptAsync(prompt);
        const promptManager = setupChatCompletionPromptManager(oai_settings);
        if (promptManager) {
            // @ts-expect-error 类型正确
            if (promptManager.serviceSettings.names_behavior === character_names_behavior.COMPLETION && prompt.name) {
                const messageName = promptManager.isValidName(prompt.name)
                    ? prompt.name
                    : promptManager.sanitizeName(prompt.name);
                await chatMessage.setName(messageName);
            }
        }
        if (imageInlining && chatPrompt.image) {
            await chatMessage.addImage(chatPrompt.image);
        }
        if (chatCompletion.canAfford(chatMessage)) {
            chatCollection.add(chatMessage);
        }
        else {
            break;
        }
    }
    // 释放新聊天提示词的预留token
    chatCompletion.freeBudget(newChatMessage);
    if (hasUserInput) {
        // 按各自在order中的位置添加聊天记录和用户输入
        chatCompletion.add(chatCollection, chatHistoryIndex);
        chatCompletion.add(new MessageCollection('user_input', userMessage), userInputIndex);
    }
    else {
        // 聊天记录中已包含用户输入，直接添加到chat_history位置
        chatCompletion.add(chatCollection, chatHistoryIndex);
    }
}
async function populationInjectionPrompts(baseData, messages, customInjects = [], config) {
    const processedMessages = [...messages];
    let totalInsertedMessages = 0;
    const injectionPrompts = [];
    const authorsNote = _.get(extension_prompts, '2_floating_prompt', {});
    if (authorsNote && authorsNote.value) {
        injectionPrompts.push({
            role: getPromptRole(authorsNote.role),
            content: authorsNote.value,
            identifier: 'authorsNote',
            injection_depth: authorsNote.depth,
            injected: true,
        });
    }
    if (power_user.persona_description &&
        power_user.persona_description_position === persona_description_positions.AT_DEPTH) {
        injectionPrompts.push({
            role: 'system',
            content: power_user.persona_description,
            identifier: 'persona_description',
            injection_depth: power_user.persona_description_depth,
            injected: true,
        });
    }
    // 处理世界书里的深度条目
    if (!isPromptFiltered('char_depth_prompt', config)) {
        const wiDepthPrompt = baseData.worldInfo.worldInfoDepth;
        if (wiDepthPrompt) {
            for (const entry of wiDepthPrompt) {
                injectionPrompts.push({
                    role: getPromptRole(entry.role),
                    content: entry.entries.join('\n'),
                    injection_depth: entry.depth,
                    injected: true,
                });
            }
        }
    }
    // 处理自定义注入
    if (Array.isArray(customInjects)) {
        for (const inject of customInjects) {
            injectionPrompts.push({
                identifier: `INJECTION-${inject.role}-${inject.depth}`,
                role: inject.role,
                content: inject.content,
                injection_depth: inject.depth || 0,
                injected: true,
            });
        }
    }
    const knownExtensionPrompts = [
        '1_memory',
        '2_floating_prompt',
        '3_vectors',
        '4_vectors_data_bank',
        'chromadb',
        'PERSONA_DESCRIPTION',
        'QUIET_PROMPT',
        'DEPTH_PROMPT',
    ];
    // Anything that is not a known extension prompt
    for (const key in extension_prompts) {
        if (Object.hasOwn(extension_prompts, key)) {
            // @ts-expect-error 类型正确
            const prompt = extension_prompts[key];
            if (knownExtensionPrompts.includes(key))
                continue;
            if (!prompt.value)
                continue;
            if (![extension_prompt_types.BEFORE_PROMPT, extension_prompt_types.IN_PROMPT].includes(prompt.position))
                continue;
            const hasFilter = typeof prompt.filter === 'function';
            if (hasFilter && !(await prompt.filter()))
                continue;
            injectionPrompts.push({
                identifier: key.replace(/\W/g, '_'),
                role: getPromptRole(prompt.role),
                content: prompt.value,
                injection_depth: prompt.depth || 0,
                injected: true,
            });
        }
    }
    const roleTypes = {
        system: extension_prompt_roles.SYSTEM,
        user: extension_prompt_roles.USER,
        assistant: extension_prompt_roles.ASSISTANT,
    };
    for (let i = 0; i <= MAX_INJECTION_DEPTH; i++) {
        const depthPrompts = injectionPrompts.filter(prompt => prompt.injection_depth === i && prompt.content);
        const roles = ['system', 'user', 'assistant'];
        const roleMessages = [];
        const separator = '\n';
        for (const role of roles) {
            const rolePrompts = depthPrompts
                .filter(prompt => prompt.role === role)
                .map(x => x.content)
                .join(separator);
            const extensionPrompt = await filteredGetExtensionPrompt(extension_prompt_types.IN_CHAT, i, separator, roleTypes[role], false);
            const jointPrompt = [rolePrompts, extensionPrompt]
                .filter(x => x)
                .map(x => x.trim())
                .join(separator);
            if (jointPrompt && jointPrompt.length) {
                roleMessages.push({ role: role, content: jointPrompt, injected: true });
            }
        }
        if (roleMessages.length) {
            const injectIdx = i + totalInsertedMessages;
            processedMessages.splice(injectIdx, 0, ...roleMessages);
            totalInsertedMessages += roleMessages.length;
        }
    }
    return processedMessages;
}
async function filteredGetExtensionPrompt(position = extension_prompt_types.IN_PROMPT, depth = undefined, separator = '\n', role = undefined, wrap = true) {
    // @ts-expect-error 无视类型
    const filterByFunction = async (prompt) => {
        const hasFilter = typeof prompt.filter === 'function';
        if (hasFilter && !(await prompt.filter())) {
            return false;
        }
        return true;
    };
    const promptPromises = Object.keys(extension_prompts)
        .sort()
        .filter(x => x !== '2_floating_prompt' && !/customDepthWI-\d+-\d+/.test(x) && !/TH-CustomInjects-.+/.test(x))
        // @ts-expect-error 无视类型
        .map(x => extension_prompts[x])
        .filter(x => x.position == position && x.value)
        .filter(x => depth === undefined || x.depth === undefined || x.depth === depth)
        .filter(x => role === undefined || x.role === undefined || x.role === role)
        .filter(filterByFunction);
    const prompts = await Promise.all(promptPromises);
    // @ts-expect-error 无视类型
    let values = prompts.map(x => x.value.trim()).join(separator);
    if (wrap && values.length && !values.startsWith(separator)) {
        values = separator + values;
    }
    if (wrap && values.length && !values.endsWith(separator)) {
        values = values + separator;
    }
    if (values.length) {
        values = substituteParams(values);
    }
    return values;
}
async function handleCustomPath(baseData, config, processedUserInput) {
    const chatCompletion = new ChatCompletion();
    chatCompletion.setTokenBudget(oai_settings.openai_max_context, oai_settings.openai_max_tokens);
    chatCompletion.reserveBudget(3);
    const orderArray = config.order || default_order;
    const positionMap = orderArray.reduce((acc, item, index) => {
        if (typeof item === 'string') {
            acc[item.toLowerCase()] = index;
        }
        else if (typeof item === 'object') {
            acc[`custom_prompt_${index}`] = index;
        }
        return acc;
    }, {});
    //转换为集合
    const { systemPrompts, dialogue_examples } = await convertSystemPromptsToCollection(baseData, config);
    const addToChatCompletionInOrder = async (source, index) => {
        if (typeof source === 'object') {
            // 处理自定义注入
            const collection = new MessageCollection(`custom_prompt_${index}`);
            const message = await Message.createAsync(source.role, source.content, `custom_prompt_${index}`);
            collection.add(message);
            chatCompletion.add(collection, index);
        }
        else if (systemPrompts.has(source)) {
            // 处理普通提示词
            const prompt = systemPrompts.get(source);
            const collection = new MessageCollection(source);
            const message = await Message.fromPromptAsync(prompt);
            collection.add(message);
            chatCompletion.add(collection, positionMap[source]);
        }
    };
    // 处理所有类型的提示词
    for (const [index, item] of orderArray.entries()) {
        if (typeof item === 'string') {
            if (!isPromptFiltered(item, config)) {
                await addToChatCompletionInOrder(item, index);
            }
        }
        else if (typeof item === 'object' && item.role && item.content) {
            await addToChatCompletionInOrder(item, index);
        }
    }
    const dialogue_examplesIndex = orderArray.findIndex(item => typeof item === 'string' && item.toLowerCase() === 'dialogue_examples');
    if (dialogue_examplesIndex !== -1 && !isPromptFiltered('dialogue_examples', config)) {
        chatCompletion.add(dialogue_examples, dialogue_examplesIndex);
    }
    //给user输入预留token
    const userInputMessage = await Message.createAsync('user', processedUserInput, 'user_input');
    chatCompletion.reserveBudget(userInputMessage);
    await processChatHistoryAndInject(baseData, config, chatCompletion, processedUserInput, config.processedImageArray);
    chatCompletion.freeBudget(userInputMessage);
    //根据当前预设决定是否合并连续系统role消息
    if (oai_settings.squash_system_messages) {
        await chatCompletion.squashSystemMessages();
    }
    const prompt = chatCompletion.getChat();
    eventSource.emit(event_types.CHAT_COMPLETION_PROMPT_READY, { chat: prompt, dryRun: false });
    return { prompt };
}
function processInitialUserInput(user_input = '') {
    // 1. 处理宏替换
    const substitutedInput = substituteParams(user_input);
    // 2. 处理正则和其他预处理
    const processedUserInput = processUserInput(substitutedInput) || '';
    return processedUserInput;
}
async function processUserInputWithImages(user_input = '', use_preset = true, image = undefined) {
    // 1. 处理用户输入（正则，宏）
    let processedUserInput = processInitialUserInput(user_input);
    // 处理可能的图片数组的情况
    let imageProcessingSetup = undefined;
    let processedImageArray = undefined;
    if (Array.isArray(image) && image.length > 0) {
        if (use_preset) {
            // 使用预设时，采用事件监听方式处理图片数组
            imageProcessingSetup = setupImageArrayProcessing(processedUserInput, image);
            processedUserInput = imageProcessingSetup.userInputWithMarker;
        }
        else {
            // 使用原始模式时，直接处理图片数组
            processedImageArray = await processImageArrayDirectly(processedUserInput, image);
            // 保持原始用户输入不变，图片数组将在后续步骤中直接使用
        }
    }
    return {
        processedUserInput,
        imageProcessingSetup,
        processedImageArray,
    };
}

return { async prepare(config) {
 const input=await processUserInputWithImages(config.user_input,config.use_preset,config.image);
 try {
  await eventSource.emit(event_types.GENERATION_AFTER_COMMANDS,'normal',{},false);
  const base=await prepareAndOverrideData(config,input.processedUserInput);
  const data=config.use_preset?await handlePresetPath(base,input.processedUserInput,config):await handleCustomPath(base,{...config,processedImageArray:input.processedImageArray},input.processedUserInput);
  await eventSource.emit(event_types.GENERATE_AFTER_DATA,data,false);
  await input.imageProcessingSetup?.imageProcessingPromise;
  return data;
 }finally{input.imageProcessingSetup?.cleanup();removeTemporaryUserMessage();}
}};
}
