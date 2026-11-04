// PolyForm-Noncommercial-1.0.0. JS-Slash-Runner 437412b20c8c33bcd4dbbe1ffaeae5abebfd2fb6 / src/function/slash.ts
// 结合现有 engine/st/scripts/variables.js 与 engine/st/script.js 端口实现轻量 Slash 执行器与命令注册表。
import {
    getLocalVariable,
    setLocalVariable,
    addLocalVariable,
    incrementLocalVariable,
    decrementLocalVariable,
    existsLocalVariable,
    deleteLocalVariable,
    getGlobalVariable,
    setGlobalVariable,
    addGlobalVariable,
    incrementGlobalVariable,
    decrementGlobalVariable,
    existsGlobalVariable,
    deleteGlobalVariable,
} from '../engine/st/scripts/variables.js';
import {
    substituteParams,
    setExtensionPrompt,
    extension_prompt_types,
    extension_prompt_roles,
} from '../engine/st/script.js';
import { chat, extension_prompts } from '../engine/ports.js';
import { replaceMacroLike } from './helper-util.js';
import { createChatMessages, deleteChatMessages, setChatMessages } from './helper-message.js';

export const ARGUMENT_TYPE = {
    STRING: 'string',
    NUMBER: 'number',
    BOOLEAN: 'boolean',
    VARIABLE_NAME: 'varname',
    LIST: 'list',
    DICTIONARY: 'dictionary',
    CLOSURE: 'closure',
    SUBCOMMAND: 'subcommand',
};

export class SlashCommand {
    static fromProps(props) {
        return { ...props };
    }
}

export class SlashCommandArgument {
    constructor(description, typeList, isRequired = false, acceptsMultiple = false, defaultValue = null, enumList = []) {
        this.description = description;
        this.typeList = typeList;
        this.isRequired = isRequired;
        this.acceptsMultiple = acceptsMultiple;
        this.defaultValue = defaultValue;
        this.enumList = enumList;
    }
    static fromProps(props) {
        return { ...props };
    }
}

export class SlashCommandNamedArgument extends SlashCommandArgument {
    constructor(name, description, typeList, isRequired = false, acceptsMultiple = false, defaultValue = null, enumList = []) {
        super(description, typeList, isRequired, acceptsMultiple, defaultValue, enumList);
        this.name = name;
    }
    static fromProps(props) {
        return { ...props };
    }
}

const commandRegistry = new Map();

function registerCommand(cmd) {
    if (!cmd || !cmd.name || typeof cmd.callback !== 'function') return;
    commandRegistry.set(String(cmd.name).toLowerCase(), cmd);
    if (Array.isArray(cmd.aliases)) {
        for (const alias of cmd.aliases) {
            if (alias) commandRegistry.set(String(alias).toLowerCase(), cmd);
        }
    }
}

export const SlashCommandParser = {
    commands: commandRegistry,
    addCommandObject(cmd) {
        registerCommand(cmd);
    },
    addCommand(name, callback, aliases = [], helpString = '') {
        registerCommand({ name, callback, aliases, helpString });
    },
};

function resolveOperand(val) {
    if (val === undefined || val === null) return '';
    const num = Number(val);
    if (String(val).trim() !== '' && !Number.isNaN(num)) return num;
    if (existsLocalVariable(val)) return getLocalVariable(val);
    if (existsGlobalVariable(val)) return getGlobalVariable(val);
    return val;
}

function registerBuiltinCommands() {
    registerCommand({
        name: 'setvar',
        aliases: ['setchatvar'],
        callback: (args, value) => {
            let key = args.key ?? args.name;
            let val = value;
            if (!key && typeof value === 'string') {
                const idx = value.indexOf(' ');
                if (idx > 0) {
                    key = value.slice(0, idx).trim();
                    val = value.slice(idx + 1);
                } else {
                    key = value.trim();
                    val = '';
                }
            }
            return String(setLocalVariable(key, val, args) ?? '');
        },
    });
    registerCommand({
        name: 'getvar',
        aliases: ['getchatvar'],
        callback: (args, value) => String(getLocalVariable(value, args) ?? ''),
    });
    registerCommand({
        name: 'addvar',
        aliases: ['addchatvar'],
        callback: (args, value) => {
            let key = args.key ?? args.name;
            let val = value;
            if (!key && typeof value === 'string') {
                const idx = value.indexOf(' ');
                if (idx > 0) {
                    key = value.slice(0, idx).trim();
                    val = value.slice(idx + 1);
                }
            }
            return String(addLocalVariable(key, val) ?? '');
        },
    });
    registerCommand({
        name: 'incvar',
        aliases: ['incchatvar'],
        callback: (args, value) => String(incrementLocalVariable(args.key ?? args.name ?? value) ?? ''),
    });
    registerCommand({
        name: 'decvar',
        aliases: ['decchatvar'],
        callback: (args, value) => String(decrementLocalVariable(args.key ?? args.name ?? value) ?? ''),
    });
    registerCommand({
        name: 'flushvar',
        aliases: ['flushchatvar', 'delvar', 'delchatvar'],
        callback: (args, value) => String(deleteLocalVariable(args.key ?? args.name ?? value) ?? ''),
    });
    registerCommand({
        name: 'setglobalvar',
        callback: (args, value) => {
            let key = args.key ?? args.name;
            let val = value;
            if (!key && typeof value === 'string') {
                const idx = value.indexOf(' ');
                if (idx > 0) {
                    key = value.slice(0, idx).trim();
                    val = value.slice(idx + 1);
                } else {
                    key = value.trim();
                    val = '';
                }
            }
            return String(setGlobalVariable(key, val, args) ?? '');
        },
    });
    registerCommand({
        name: 'getglobalvar',
        callback: (args, value) => String(getGlobalVariable(value, args) ?? ''),
    });
    registerCommand({
        name: 'addglobalvar',
        callback: (args, value) => {
            let key = args.key ?? args.name;
            let val = value;
            if (!key && typeof value === 'string') {
                const idx = value.indexOf(' ');
                if (idx > 0) {
                    key = value.slice(0, idx).trim();
                    val = value.slice(idx + 1);
                }
            }
            return String(addGlobalVariable(key, val) ?? '');
        },
    });
    registerCommand({
        name: 'incglobalvar',
        callback: (args, value) => String(incrementGlobalVariable(args.key ?? args.name ?? value) ?? ''),
    });
    registerCommand({
        name: 'decglobalvar',
        callback: (args, value) => String(decrementGlobalVariable(args.key ?? args.name ?? value) ?? ''),
    });
    registerCommand({
        name: 'flushglobalvar',
        aliases: ['delglobalvar'],
        callback: (args, value) => String(deleteGlobalVariable(args.key ?? args.name ?? value) ?? ''),
    });
    registerCommand({
        name: 'var',
        aliases: ['let'],
        callback: (args, value) => {
            const key = args.key;
            if (key) {
                return String(setLocalVariable(key, value, args) ?? '');
            }
            const text = String(value ?? '').trim();
            const spaceIdx = text.indexOf(' ');
            if (spaceIdx === -1) {
                return String(getLocalVariable(text, args) ?? '');
            }
            const varName = text.slice(0, spaceIdx).trim();
            const varVal = text.slice(spaceIdx + 1);
            return String(setLocalVariable(varName, varVal, args) ?? '');
        },
    });
    registerCommand({
        name: 'echo',
        callback: (_args, value) => String(value ?? ''),
    });
    registerCommand({
        name: 'pass',
        callback: (_args, value) => String(value ?? ''),
    });
    registerCommand({
        name: 'return',
        callback: (_args, value) => String(value ?? ''),
    });
    registerCommand({
        name: 'comment',
        aliases: ['//', 'note'],
        callback: () => '',
    });
    registerCommand({
        name: 'add',
        callback: (_args, value) => {
            const parts = String(value ?? '').trim().split(/\s+/).filter(Boolean);
            const sum = parts.reduce((acc, item) => acc + Number(resolveOperand(item) || 0), 0);
            return String(sum);
        },
    });
    registerCommand({
        name: 'sub',
        callback: (_args, value) => {
            const parts = String(value ?? '').trim().split(/\s+/).filter(Boolean);
            if (!parts.length) return '0';
            const nums = parts.map(item => Number(resolveOperand(item) || 0));
            return String(nums.slice(1).reduce((acc, n) => acc - n, nums[0]));
        },
    });
    registerCommand({
        name: 'mul',
        callback: (_args, value) => {
            const parts = String(value ?? '').trim().split(/\s+/).filter(Boolean);
            if (!parts.length) return '0';
            return String(parts.reduce((acc, item) => acc * Number(resolveOperand(item) || 0), 1));
        },
    });
    registerCommand({
        name: 'div',
        callback: (_args, value) => {
            const parts = String(value ?? '').trim().split(/\s+/).filter(Boolean);
            if (parts.length < 2) return '0';
            const a = Number(resolveOperand(parts[0]) || 0);
            const b = Number(resolveOperand(parts[1]) || 0);
            return b === 0 ? '0' : String(a / b);
        },
    });
    registerCommand({
        name: 'mod',
        callback: (_args, value) => {
            const parts = String(value ?? '').trim().split(/\s+/).filter(Boolean);
            if (parts.length < 2) return '0';
            const a = Number(resolveOperand(parts[0]) || 0);
            const b = Number(resolveOperand(parts[1]) || 0);
            return b === 0 ? '0' : String(a % b);
        },
    });
    registerCommand({
        name: 'len',
        aliases: ['length'],
        callback: (_args, value) => {
            const str = String(value ?? '');
            try {
                const parsed = JSON.parse(str);
                if (Array.isArray(parsed)) return String(parsed.length);
                if (parsed && typeof parsed === 'object') return String(Object.keys(parsed).length);
            } catch {}
            return String(str.length);
        },
    });
    registerCommand({
        name: 'inject',
        callback: (args, value) => {
            const id = args.id || `slash_inject_${Date.now()}`;
            const posMap = {
                before: extension_prompt_types.BEFORE_PROMPT,
                after: extension_prompt_types.IN_PROMPT,
                chat: extension_prompt_types.IN_CHAT,
                none: extension_prompt_types.NONE,
            };
            const roleMap = {
                system: extension_prompt_roles.SYSTEM,
                user: extension_prompt_roles.USER,
                assistant: extension_prompt_roles.ASSISTANT,
            };
            const position = posMap[String(args.position || 'chat').toLowerCase()] ?? extension_prompt_types.IN_CHAT;
            const depth = Number(args.depth ?? 4);
            const role = roleMap[String(args.role || 'system').toLowerCase()] ?? extension_prompt_roles.SYSTEM;
            const scan = String(args.scan ?? 'false') === 'true';
            setExtensionPrompt(id, String(value ?? ''), position, depth, scan, role);
            return '';
        },
    });
    registerCommand({
        name: 'flushinject',
        callback: (args, value) => {
            const id = args.id || String(value ?? '').trim();
            if (id && extension_prompts) delete extension_prompts[id];
            return '';
        },
    });
    registerCommand({
        name: 'hide',
        callback: async (_args, value) => {
            const idx = Number(value);
            if (Number.isInteger(idx) && chat?.[idx]) {
                await setChatMessages([{ message_id: idx, is_hidden: true }]);
            }
            return '';
        },
    });
    registerCommand({
        name: 'unhide',
        callback: async (_args, value) => {
            const idx = Number(value);
            if (Number.isInteger(idx) && chat?.[idx]) {
                await setChatMessages([{ message_id: idx, is_hidden: false }]);
            }
            return '';
        },
    });
    registerCommand({
        name: 'send',
        callback: async (args, value) => {
            const text = String(value ?? '');
            await createChatMessages([{ role: 'user', name: args.name, message: text }]);
            return text;
        },
    });
    registerCommand({
        name: 'sys',
        aliases: ['nar'],
        callback: async (args, value) => {
            const text = String(value ?? '');
            await createChatMessages([{ role: 'system', name: args.name, message: text }]);
            return text;
        },
    });
    registerCommand({
        name: 'del',
        aliases: ['delete'],
        callback: async (_args, value) => {
            const count = Math.max(1, Number(value || 1));
            const start = Math.max(0, (chat?.length ?? 0) - count);
            const ids = [];
            for (let i = start; i < (chat?.length ?? 0); i++) ids.push(i);
            await deleteChatMessages(ids);
            return '';
        },
    });
}

registerBuiltinCommands();

function splitPipeline(script) {
    const stages = [];
    let current = '';
    let quote = null;
    let braceDepth = 0;
    for (let i = 0; i < script.length; i++) {
        const ch = script[i];
        const next = script[i + 1];
        if (ch === '\\' && i + 1 < script.length) {
            current += ch + next;
            i++;
            continue;
        }
        if (quote) {
            if (ch === quote) quote = null;
            current += ch;
            continue;
        }
        if (ch === '"' || ch === "'") {
            quote = ch;
            current += ch;
            continue;
        }
        if ((ch === '{' && (next === '{' || next === ':')) || (ch === '<' && next === '%')) {
            braceDepth++;
            current += ch + next;
            i++;
            continue;
        }
        if ((ch === '}' && (script[i - 1] === '}' || script[i - 1] === ':')) || (ch === '>' && script[i - 1] === '%')) {
            if (braceDepth > 0) braceDepth--;
            current += ch;
            continue;
        }
        if (ch === '|' && next === '|') {
            stages.push(current.trim());
            current = '';
            i++;
            continue;
        }
        if (ch === '|' && braceDepth === 0) {
            stages.push(current.trim());
            current = '';
            continue;
        }
        current += ch;
    }
    if (current.trim()) stages.push(current.trim());
    return stages;
}

function parseStage(rawStage) {
    const trimmed = rawStage.trim();
    if (!trimmed.startsWith('/')) {
        return { name: null, namedArgs: {}, unnamedValue: trimmed };
    }
    const body = trimmed.slice(1);
    const nameMatch = body.match(/^([^\s]+)/);
    const name = nameMatch ? nameMatch[1].toLowerCase() : '';
    let rest = body.slice(name.length).trim();
    const namedArgs = {};

    while (rest.length > 0) {
        const namedMatch = rest.match(/^([a-zA-Z0-9_.-]+)=/);
        if (!namedMatch) break;
        const key = namedMatch[1];
        rest = rest.slice(namedMatch[0].length);
        if (rest.startsWith('"') || rest.startsWith("'")) {
            const q = rest[0];
            let val = '';
            let i = 1;
            for (; i < rest.length; i++) {
                if (rest[i] === '\\' && i + 1 < rest.length) {
                    val += rest[i + 1];
                    i++;
                } else if (rest[i] === q) {
                    i++;
                    break;
                } else {
                    val += rest[i];
                }
            }
            namedArgs[key] = val;
            rest = rest.slice(i).trimStart();
        } else {
            const tokenMatch = rest.match(/^([^\s]+)/);
            const val = tokenMatch ? tokenMatch[1] : '';
            namedArgs[key] = val;
            rest = rest.slice(val.length).trimStart();
        }
    }

    if ((rest.startsWith('"') && rest.endsWith('"')) || (rest.startsWith("'") && rest.endsWith("'"))) {
        rest = rest.slice(1, -1);
    }

    return { name, namedArgs, unnamedValue: rest };
}

function expandStepMacros(text, pipe) {
    if (typeof text !== 'string' || !text) return '';
    let out = text.replace(/\{\{pipe\}\}/gi, String(pipe ?? ''));
    out = replaceMacroLike(out, { source: 'other' });
    out = substituteParams(out);
    return out;
}

export async function executeSlashCommandsWithOptions(text, options = {}) {
    const raw = String(text ?? '').trim();
    if (!raw) {
        return { pipe: '', isError: false, isAborted: false, errorMessage: '' };
    }
    const stages = splitPipeline(raw);
    let pipe = '';
    for (const stage of stages) {
        if (!stage) continue;
        const { name, namedArgs, unnamedValue } = parseStage(stage);
        if (!name) continue;
        if (name === '//' || name === 'comment' || name === 'note') continue;
        const cmd = commandRegistry.get(name);
        if (!cmd) {
            const errorMessage = `Unknown slash command: /${name}`;
            if (options?.handleExecutionErrors === false) {
                throw new Error(errorMessage);
            }
            return { pipe: '', isError: true, isAborted: false, errorMessage };
        }
        const resolvedArgs = {};
        for (const [k, v] of Object.entries(namedArgs)) {
            resolvedArgs[k] = expandStepMacros(String(v), pipe);
        }
        const expandedUnnamed = unnamedValue !== '' ? expandStepMacros(unnamedValue, pipe) : pipe;
        try {
            const result = await cmd.callback(resolvedArgs, expandedUnnamed);
            pipe = result === undefined || result === null ? '' : typeof result === 'string' ? result : JSON.stringify(result);
            if (name === 'return') break;
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            if (options?.handleExecutionErrors === false) {
                throw err;
            }
            return { pipe: '', isError: true, isAborted: false, errorMessage };
        }
    }
    return { pipe, isError: false, isAborted: false, errorMessage: '' };
}

export async function executeSlashCommands(text, handleParserErrors = true, scope = null, handleExecutionErrors = false, parserFlags = null, abortController = null, onProgress = null) {
    return executeSlashCommandsWithOptions(text, {
        handleParserErrors,
        scope,
        handleExecutionErrors,
        parserFlags,
        abortController,
        onProgress,
    });
}

export async function triggerSlash(command) {
    const result = await executeSlashCommandsWithOptions(command);
    if (result?.isError) {
        throw new Error(`运行 Slash 命令 '${command}' 时出错: ${result.errorMessage}`);
    }
    return result?.pipe ?? '';
}

export const triggerSlashWithResult = triggerSlash;
export const _triggerSlash = triggerSlash;
export const _triggerSlashWithResult = triggerSlashWithResult;
