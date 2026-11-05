import { PARSER_FLAG, SlashCommandParser } from '../../locked-source/st/scripts/slash-commands/SlashCommandParser.js';
import { SlashCommand } from '../../locked-source/st/scripts/slash-commands/SlashCommand.js';
import {
  ARGUMENT_TYPE,
  SlashCommandArgument,
  SlashCommandNamedArgument,
} from '../../locked-source/st/scripts/slash-commands/SlashCommandArgument.js';
import { SlashCommandScope } from '../../locked-source/st/scripts/slash-commands/SlashCommandScope.js';
import { SlashCommandClosure } from '../../locked-source/st/scripts/slash-commands/SlashCommandClosure.js';
import { SlashCommandClosureResult } from '../../locked-source/st/scripts/slash-commands/SlashCommandClosureResult.js';
import { SlashCommandAbortController } from '../../locked-source/st/scripts/slash-commands/SlashCommandAbortController.js';
import { SlashCommandBreakController } from '../../locked-source/st/scripts/slash-commands/SlashCommandBreakController.js';
import { convertValueType } from '../../locked-source/st/scripts/desktop-slash-utils.js';

import {
  addGlobalVariable,
  addLocalVariable,
  decrementGlobalVariable,
  decrementLocalVariable,
  deleteGlobalVariable,
  deleteLocalVariable,
  existsGlobalVariable,
  existsLocalVariable,
  getGlobalVariable,
  getLocalVariable,
  incrementGlobalVariable,
  incrementLocalVariable,
  setGlobalVariable,
  setLocalVariable,
} from '../engine/st/scripts/variables.js';
import {
  extension_prompt_roles,
  extension_prompt_types,
  setExtensionPrompt,
} from '../engine/st/script.js';
import { extension_prompts } from '../engine/ports.js';
import {
  assertSlashExecutionActive,
  captureSlashExecutionSnapshot,
  createSlashAbortController,
  emitSanitizedSlashEvent,
  PARSER_FLAG_KEYS,
  resolveParserFlags,
  settleSlashExecutionPersistence,
} from '../engine/slash-ports.js';
import { getCardHost } from './ejs-host.js';
import { createChatMessages, deleteChatMessages, setChatMessages } from './helper-message.js';
import { replaceMacroLike } from './helper-util.js';

export {
  ARGUMENT_TYPE,
  PARSER_FLAG,
  SlashCommand,
  SlashCommandAbortController,
  SlashCommandArgument,
  SlashCommandBreakController,
  SlashCommandClosure,
  SlashCommandClosureResult,
  SlashCommandNamedArgument,
  SlashCommandParser,
  SlashCommandScope,
};

const EXTENSION_PROMPT_ROLE_MAP = Object.freeze({
  system: extension_prompt_roles.SYSTEM,
  user: extension_prompt_roles.USER,
  assistant: extension_prompt_roles.ASSISTANT,
});

const EXTENSION_PROMPT_POSITION_MAP = Object.freeze({
  before: extension_prompt_types.BEFORE_PROMPT,
  after: extension_prompt_types.IN_PROMPT,
  chat: extension_prompt_types.IN_CHAT,
  in_chat: extension_prompt_types.IN_CHAT,
  none: extension_prompt_types.NONE,
});

const VALID_SEND_RETURN_TYPES = new Set(['none', 'pipe', 'object']);
const VALID_BOOLEAN_LITERALS = new Set(['true', 'false', '1', '0', 'on', 'off']);
const INTERNAL_EXECUTOR_ARG_KEYS = new Set([
  '_scope',
  '_abortController',
  '_parserFlags',
  '_debugController',
  '_hasUnnamedArgument',
]);
const RESERVED_ARG_NAMES = new Set(['constructor', '__proto__', 'prototype']);

Object.setPrototypeOf(SlashCommandParser.commands, null);

const scopeExecutionContextMap = new WeakMap();
const closureExecutionContextMap = new WeakMap();
const validatedClosuresSet = new WeakSet();

function getExecutionContextFromScope(scope) {
  let cur = scope;
  const seen = new Set();
  while (cur && typeof cur === 'object' && !seen.has(cur)) {
    seen.add(cur);
    if (scopeExecutionContextMap.has(cur)) {
      return scopeExecutionContextMap.get(cur);
    }
    cur = cur.parent;
  }
  return null;
}

function findVariableOwnerScope(scope, key) {
  let cur = scope;
  const seen = new Set();
  while (cur instanceof SlashCommandScope && !seen.has(cur)) {
    seen.add(cur);
    if (cur.existsVariableInScope(key)) {
      return cur;
    }
    cur = cur.parent;
  }
  return null;
}

function cloneArgumentAssignment(arg, abortController, execCtx) {
  if (!arg || typeof arg !== 'object') {
    return arg;
  }
  const Ctor = typeof arg.constructor === 'function' ? arg.constructor : Object;
  const copy = new Ctor();
  Object.assign(copy, arg);
  if (arg.value instanceof SlashCommandClosure) {
    copy.value = cloneClosureTree(arg.value, abortController, execCtx);
  } else if (Array.isArray(arg.value)) {
    copy.value = arg.value.map(item =>
      item instanceof SlashCommandClosure ? cloneClosureTree(item, abortController, execCtx) : item,
    );
  }
  return copy;
}

function cloneExecutor(executor, abortController, execCtx) {
  if (!executor || typeof executor !== 'object') {
    return executor;
  }
  const Ctor = typeof executor.constructor === 'function' ? executor.constructor : Object;
  const copy = new Ctor(executor.start);
  copy.injectPipe = executor.injectPipe;
  copy.start = executor.start;
  copy.end = executor.end;
  copy.startNamedArgs = executor.startNamedArgs;
  copy.endNamedArgs = executor.endNamedArgs;
  copy.startUnnamedArgs = executor.startUnnamedArgs;
  copy.endUnnamedArgs = executor.endUnnamedArgs;
  copy.name = executor.name;
  copy.command = executor.command;
  copy.parserFlags = executor.parserFlags ? { ...executor.parserFlags } : executor.parserFlags;
  copy.namedArgumentList = Array.isArray(executor.namedArgumentList)
    ? executor.namedArgumentList.map(arg => cloneArgumentAssignment(arg, abortController, execCtx))
    : [];
  copy.unnamedArgumentList = Array.isArray(executor.unnamedArgumentList)
    ? executor.unnamedArgumentList.map(arg => cloneArgumentAssignment(arg, abortController, execCtx))
    : [];
  if (executor.source !== undefined) {
    copy.source = executor.source;
  }
  return copy;
}

function cloneClosureTree(closure, abortController = null, execCtx = null) {
  if (!(closure instanceof SlashCommandClosure)) {
    return closure;
  }
  const activeExecCtx =
    execCtx ?? closureExecutionContextMap.get(closure) ?? getExecutionContextFromScope(closure.scope);
  const activeAbortController = abortController ?? activeExecCtx?.abortController ?? closure.abortController;
  const copy = new SlashCommandClosure();
  copy.scope = closure.scope instanceof SlashCommandScope ? closure.scope.getCopy() : new SlashCommandScope();
  copy.executeNow = closure.executeNow;
  copy.abortController = activeAbortController;
  copy.breakController = closure.breakController;
  copy.debugController = closure.debugController;
  copy.rawText = closure.rawText;
  copy.fullText = closure.fullText;
  copy.parserContext = closure.parserContext;
  copy.onProgress = closure.onProgress;
  copy.argumentList = Array.isArray(closure.argumentList)
    ? closure.argumentList.map(arg => cloneArgumentAssignment(arg, activeAbortController, activeExecCtx))
    : [];
  copy.providedArgumentList = Array.isArray(closure.providedArgumentList)
    ? closure.providedArgumentList.map(arg => cloneArgumentAssignment(arg, activeAbortController, activeExecCtx))
    : [];
  copy.executorList = Array.isArray(closure.executorList)
    ? closure.executorList.map(exec => cloneExecutor(exec, activeAbortController, activeExecCtx))
    : [];
  if (closure.source !== undefined) {
    copy.source = closure.source;
  }
  if (activeExecCtx) {
    closureExecutionContextMap.set(copy, activeExecCtx);
    if (copy.scope instanceof SlashCommandScope) {
      scopeExecutionContextMap.set(copy.scope, activeExecCtx);
    }
  }
  if (validatedClosuresSet.has(closure)) {
    validatedClosuresSet.add(copy);
  }
  return copy;
}

const originalScopeGetCopy = SlashCommandScope.prototype.getCopy;
SlashCommandScope.prototype.getCopy = function patchedScopeGetCopy(...args) {
  const copy = originalScopeGetCopy.apply(this, args);
  const ctx = getExecutionContextFromScope(this);
  if (ctx) {
    scopeExecutionContextMap.set(copy, ctx);
  }
  return copy;
};

SlashCommandClosure.prototype.getCopy = function patchedClosureGetCopy() {
  const execCtx = closureExecutionContextMap.get(this) ?? getExecutionContextFromScope(this.scope);
  const activeAbortController = execCtx?.abortController ?? this.abortController;
  const copy = cloneClosureTree(this, activeAbortController, execCtx);
  copy.breakController = this.breakController ?? new SlashCommandBreakController();
  return copy;
};

let substituteParamsDepth = 0;
const originalClosureSubstituteParams = SlashCommandClosure.prototype.substituteParams;
SlashCommandClosure.prototype.substituteParams = function patchedSubstituteParams(...args) {
  substituteParamsDepth += 1;
  try {
    const result = originalClosureSubstituteParams.apply(this, args);
    if (substituteParamsDepth === 1) {
      if (typeof result === 'string') {
        return replaceMacroLike(result, { source: 'other' });
      }
      if (Array.isArray(result)) {
        return result.map(item => (typeof item === 'string' ? replaceMacroLike(item, { source: 'other' }) : item));
      }
    }
    return result;
  } finally {
    substituteParamsDepth -= 1;
  }
};

async function testAbortControllerFor(closure, activeAbortController) {
  if (!activeAbortController) {
    return undefined;
  }
  if (activeAbortController === closure.abortController) {
    const res = await closure.testAbortController();
    if (res) {
      res.isQuiet = Boolean(res.isQuiet ?? res.isQuietlyAborted ?? activeAbortController?.signal?.isQuiet);
    }
    return res;
  }
  while (!activeAbortController?.signal?.aborted && activeAbortController?.signal?.paused) {
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  if (activeAbortController?.signal?.aborted || activeAbortController?.isAborted) {
    const result = new SlashCommandClosureResult();
    result.isAborted = true;
    result.isQuiet = Boolean(activeAbortController?.isQuiet ?? activeAbortController?.signal?.isQuiet);
    result.isQuietlyAborted = result.isQuiet;
    result.abortReason = String(activeAbortController?.signal?.reason ?? '');
    return result;
  }
  return undefined;
}

const originalClosureExecute = SlashCommandClosure.prototype.execute;
SlashCommandClosure.prototype.execute = async function patchedClosureExecute(...args) {
  validateParsedClosureTree(this, null);
  const execCtx = closureExecutionContextMap.get(this) ?? getExecutionContextFromScope(this.scope);
  const activeAbortController = execCtx?.abortController ?? this.abortController;
  const preAbort = await testAbortControllerFor(this, activeAbortController);
  if (preAbort) {
    return preAbort;
  }
  try {
    const res = await originalClosureExecute.apply(this, args);
    if (res?.isAborted) {
      res.isQuiet = Boolean(res.isQuiet ?? res.isQuietlyAborted ?? activeAbortController?.signal?.isQuiet);
    }
    return res;
  } catch (err) {
    const causeMsg = err?.cause?.message ?? err?.message;
    if (
      causeMsg === 'VC_SLASH_ABORTED' ||
      activeAbortController?.isAborted ||
      activeAbortController?.signal?.aborted
    ) {
      const abortResult = await testAbortControllerFor(this, activeAbortController);
      if (abortResult) {
        return abortResult;
      }
      const fallbackResult = new SlashCommandClosureResult();
      fallbackResult.isAborted = true;
      fallbackResult.isQuiet = Boolean(activeAbortController?.isQuiet ?? activeAbortController?.signal?.isQuiet);
      fallbackResult.isQuietlyAborted = fallbackResult.isQuiet;
      fallbackResult.abortReason = String(activeAbortController?.signal?.reason ?? '');
      return fallbackResult;
    }
    throw err;
  }
};

function requireActiveExecution(args, fallbackAbortController = null) {
  const execCtx = getExecutionContextFromScope(args?._scope);
  const snapshot = execCtx?.snapshot ?? null;
  const abortController = args?._abortController ?? execCtx?.abortController ?? fallbackAbortController;
  assertSlashExecutionActive(snapshot, abortController);
  return {
    snapshot,
    abortController,
    assertActive: () => assertSlashExecutionActive(snapshot, abortController),
  };
}

function isStaticArgumentLiteral(val) {
  return typeof val === 'string' && !val.includes('{{') && !val.includes('/:');
}

function parseStrictBooleanOption(value, errorCode = 'VC_SLASH_INVALID_BOOLEAN_OPTION') {
  if (typeof value === 'boolean') {
    return value;
  }
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!VALID_BOOLEAN_LITERALS.has(normalized)) {
    throw new Error(errorCode);
  }
  return normalized === 'true' || normalized === '1' || normalized === 'on';
}

function parseIntegerOption(value) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return null;
  }
  const trimmed = String(value).trim();
  if (!/^-?\d+$/.test(trimmed)) {
    return null;
  }
  if (trimmed === '-0') {
    return -0;
  }
  const num = Number(trimmed);
  if (!Number.isInteger(num)) {
    return null;
  }
  return num;
}

function isDeclaredNamedArgument(command, argName) {
  if (!command || !Array.isArray(command.namedArgumentList)) {
    return false;
  }
  return command.namedArgumentList.some(
    spec => spec.name === argName || (Array.isArray(spec.aliases) && spec.aliases.includes(argName)),
  );
}

function isDeclaredClosureArgument(closure, argName) {
  if (!closure || !Array.isArray(closure.argumentList)) {
    return false;
  }
  return closure.argumentList.some(
    spec => spec.name === argName || (Array.isArray(spec.aliases) && spec.aliases.includes(argName)),
  );
}

function validateStaticCommandNamedArgument(commandName, argName, rawValue) {
  if (!isStaticArgumentLiteral(rawValue)) {
    return;
  }
  const val = rawValue.trim();
  if (commandName === 'send' || commandName === 'sys' || commandName === 'nar' || commandName === 'sendas') {
    if (argName === 'return') {
      const normalized = val.toLowerCase();
      if (!VALID_SEND_RETURN_TYPES.has(normalized)) {
        throw new Error('VC_SLASH_INVALID_SEND_RETURN');
      }
    } else if (argName === 'at') {
      if (parseIntegerOption(val) === null) {
        throw new Error('VC_SLASH_INVALID_SEND_AT');
      }
    }
  } else if (commandName === 'echo') {
    if (argName === 'raw') {
      parseStrictBooleanOption(val, 'VC_SLASH_INVALID_ECHO_RAW');
    }
  } else if (commandName === 'abort') {
    if (argName === 'quiet') {
      parseStrictBooleanOption(val, 'VC_SLASH_INVALID_ABORT_QUIET');
    }
  } else if (commandName === 'inject') {
    if (argName === 'position') {
      if (!Object.hasOwn(EXTENSION_PROMPT_POSITION_MAP, val.toLowerCase())) {
        throw new Error('VC_SLASH_INVALID_INJECT_POSITION');
      }
    } else if (argName === 'role') {
      if (!Object.hasOwn(EXTENSION_PROMPT_ROLE_MAP, val.toLowerCase())) {
        throw new Error('VC_SLASH_INVALID_INJECT_ROLE');
      }
    } else if (argName === 'scan' || argName === 'ephemeral') {
      parseStrictBooleanOption(val, 'VC_SLASH_INVALID_INJECT_BOOLEAN');
    } else if (argName === 'depth') {
      if (parseIntegerOption(val) === null) {
        throw new Error('VC_SLASH_INVALID_INJECT_DEPTH');
      }
    }
  }
}

function validateParserFlagExecutor(entry) {
  const namedList = Array.isArray(entry?.namedArgumentList) ? entry.namedArgumentList : [];
  if (namedList.length > 0) {
    throw new Error('VC_SLASH_UNKNOWN_NAMED_ARGUMENT');
  }
  const unnamedList = Array.isArray(entry?.unnamedArgumentList) ? entry.unnamedArgumentList : [];
  if (unnamedList.length === 0 || unnamedList.length > 2) {
    throw new Error('VC_SLASH_UNSUPPORTED_PARSER_FLAG');
  }
  const flagRaw = unnamedList[0]?.value;
  if (typeof flagRaw !== 'string') {
    throw new Error('VC_SLASH_UNSUPPORTED_PARSER_FLAG');
  }
  const tokens = flagRaw.trim().split(/\s+/).filter(Boolean);
  const flagName = tokens[0] ?? '';
  if (!Object.hasOwn(PARSER_FLAG_KEYS, flagName)) {
    throw new Error('VC_SLASH_UNSUPPORTED_PARSER_FLAG');
  }
  const stateCandidate = unnamedList.length > 1 ? unnamedList[1]?.value : tokens[1];
  if (stateCandidate !== undefined) {
    if (typeof stateCandidate !== 'string') {
      throw new Error('VC_SLASH_INVALID_PARSER_FLAG_STATE');
    }
    parseStrictBooleanOption(stateCandidate, 'VC_SLASH_INVALID_PARSER_FLAG_STATE');
  }
}

function validateParsedClosureTree(closure, parserInstance = null) {
  if (!(closure instanceof SlashCommandClosure)) {
    throw new Error('VC_SLASH_INVALID_CLOSURE');
  }
  if (parserInstance && Array.isArray(parserInstance.commandIndex)) {
    for (const entry of parserInstance.commandIndex) {
      if (entry?.name === 'breakpoint') {
        throw new Error('VC_SLASH_UNSUPPORTED_DEBUGGER');
      }
      if (entry?.name === 'parser-flag') {
        validateParserFlagExecutor(entry);
      }
    }
  }

  if (validatedClosuresSet.has(closure)) {
    return;
  }

  if (Array.isArray(closure.argumentList)) {
    for (const argDef of closure.argumentList) {
      const name = String(argDef?.name ?? '');
      if (!name || name.startsWith('_') || RESERVED_ARG_NAMES.has(name)) {
        throw new Error('VC_SLASH_RESERVED_ARGUMENT');
      }
      if (Array.isArray(argDef?.aliases)) {
        for (const alias of argDef.aliases) {
          if (!alias || String(alias).startsWith('_') || RESERVED_ARG_NAMES.has(String(alias))) {
            throw new Error('VC_SLASH_RESERVED_ARGUMENT');
          }
        }
      }
    }
  }

  if (Array.isArray(closure.executorList)) {
    for (const executor of closure.executorList) {
      const cmdName = String(executor?.name ?? '');
      if (cmdName === 'breakpoint') {
        throw new Error('VC_SLASH_UNSUPPORTED_DEBUGGER');
      }
      if (!cmdName || RESERVED_ARG_NAMES.has(cmdName)) {
        throw new Error('VC_SLASH_UNKNOWN_COMMAND');
      }
      if (
        cmdName !== 'closure' &&
        cmdName !== ':' &&
        (!executor.command || !Object.hasOwn(SlashCommandParser.commands, cmdName))
      ) {
        throw new Error('VC_SLASH_UNKNOWN_COMMAND');
      }

      if (cmdName === 'parser-flag') {
        validateParserFlagExecutor(executor);
      }

      if (Array.isArray(executor.namedArgumentList)) {
        for (const arg of executor.namedArgumentList) {
          const argName = String(arg?.name ?? '');
          if (!argName || argName.startsWith('_') || RESERVED_ARG_NAMES.has(argName)) {
            throw new Error('VC_SLASH_RESERVED_ARGUMENT');
          }
          if (cmdName !== 'run' && cmdName !== ':' && cmdName !== 'closure') {
            if (!isDeclaredNamedArgument(executor.command, argName)) {
              throw new Error('VC_SLASH_UNKNOWN_NAMED_ARGUMENT');
            }
            validateStaticCommandNamedArgument(cmdName, argName, arg.value);
          }
          if (arg?.value instanceof SlashCommandClosure) {
            validateParsedClosureTree(arg.value, null);
          }
        }
      }

      if (Array.isArray(executor.unnamedArgumentList)) {
        for (const arg of executor.unnamedArgumentList) {
          if (arg?.value instanceof SlashCommandClosure) {
            validateParsedClosureTree(arg.value, null);
          }
        }
      }
    }
  }

  validatedClosuresSet.add(closure);
}

const parser = new SlashCommandParser();

function registerCommand(commandProps, { unsafe = false } = {}) {
  const command = SlashCommand.fromProps(commandProps);
  if (unsafe) {
    SlashCommandParser.addCommandObjectUnsafe(command);
  } else {
    SlashCommandParser.addCommandObject(command);
  }
  return command;
}

function normalizeValueToString(value) {
  if (value === undefined || value === null) {
    return '';
  }
  return String(value);
}

function resolveIndexTarget(value, key) {
  if (key === undefined || key === null || String(key) === '') {
    return value;
  }
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return '';
    }
  }
  if (parsed === null || parsed === undefined || typeof parsed !== 'object') {
    return '';
  }
  const result = parsed[key];
  if (result === undefined || result === null) {
    return '';
  }
  return typeof result === 'object' ? JSON.stringify(result) : String(result);
}

function mutateIndexedVariable(currentRaw, index, mutator) {
  let container;
  try {
    container = JSON.parse(currentRaw || '{}');
  } catch {
    container = null;
  }
  if (!container || typeof container !== 'object') {
    const numIndex = Number(index);
    container = Number.isInteger(numIndex) && numIndex >= 0 ? [] : {};
  }
  container[index] = mutator(container[index]);
  return JSON.stringify(container);
}

function resolveOperand(val, scope = null) {
  if (val === undefined || val === null) return 0;
  const trimmed = String(val).trim();
  if (!trimmed) return 0;
  const num = Number(trimmed);
  if (!Number.isNaN(num)) return num;
  if (scope?.existsVariable?.(trimmed)) {
    const scoped = scope.getVariable(trimmed);
    return Number(scoped) || 0;
  }
  if (existsLocalVariable(trimmed)) return Number(getLocalVariable(trimmed)) || 0;
  if (existsGlobalVariable(trimmed)) return Number(getGlobalVariable(trimmed)) || 0;
  return 0;
}

function splitMathParts(value) {
  if (Array.isArray(value)) {
    return value
      .flatMap(item => String(item ?? '').trim().split(/\s+/))
      .filter(Boolean);
  }
  return String(value ?? '').trim().split(/\s+/).filter(Boolean);
}

function parseRangeBounds(rawText, chatLength) {
  const trimmed = String(rawText ?? '').trim();
  if (!trimmed) {
    return null;
  }
  const rangeMatch = /^(-?\d+)\s*-\s*(-?\d+)$/.exec(trimmed);
  if (rangeMatch) {
    let start = Number(rangeMatch[1]);
    let end = Number(rangeMatch[2]);
    if (start < 0) start = chatLength + start;
    if (end < 0) end = chatLength + end;
    if (!Number.isInteger(start) || !Number.isInteger(end)) {
      return null;
    }
    if (start > end) {
      [start, end] = [end, start];
    }
    return { start: Math.max(0, start), end: Math.min(chatLength - 1, end) };
  }
  let single = Number(trimmed);
  if (!Number.isInteger(single)) {
    return null;
  }
  if (single < 0) {
    single = chatLength + single;
  }
  if (single < 0 || single >= chatLength) {
    return null;
  }
  return { start: single, end: single };
}

async function dispatchSlashChatMessage(role, args, rawValue) {
  const { snapshot, assertActive } = requireActiveExecution(args);
  const rawText = Array.isArray(rawValue) ? rawValue.join(' ') : normalizeValueToString(rawValue);
  const text = rawText.trim();
  const returnType = String(args?.return ?? 'none')
    .trim()
    .toLowerCase();
  if (!VALID_SEND_RETURN_TYPES.has(returnType)) {
    throw new Error('VC_SLASH_INVALID_SEND_RETURN');
  }
  if (!text) {
    return '';
  }

  const hasAt = args?.at !== undefined && args?.at !== null && String(args.at).trim() !== '';
  const atIndex = hasAt ? parseIntegerOption(args.at) : null;
  if (hasAt && atIndex === null) {
    throw new Error('VC_SLASH_INVALID_SEND_AT');
  }

  const name = args?.name !== undefined && args?.name !== null ? String(args.name).trim() : undefined;
  const chat = Array.isArray(snapshot.context?.chat) ? snapshot.context.chat : null;
  if (!chat) {
    throw new Error('VC_SLASH_CHAT_UNAVAILABLE');
  }

  const insertOptions = { refresh: 'affected', insert_before: 'end' };
  if (atIndex !== null) {
    if (Object.is(atIndex, -0)) {
      insertOptions.insert_before = 'end';
    } else if (atIndex < 0) {
      const resolvedAt = chat.length + atIndex;
      insertOptions.insert_before = resolvedAt >= 0 && resolvedAt < chat.length ? resolvedAt : 'end';
    } else {
      insertOptions.insert_before = atIndex < chat.length ? atIndex : 'end';
    }
  }

  const insertedResult = await createChatMessages(
    [
      {
        role,
        message: text,
        ...(name ? { name } : {}),
      },
    ],
    insertOptions,
    {
      assertActive,
      expectedMetadata: snapshot.metadataRef,
    },
  );

  const createdMessage = Array.isArray(insertedResult) ? insertedResult[0] : null;
  if (!createdMessage || typeof createdMessage !== 'object') {
    throw new Error('VC_SLASH_SEND_RESULT_MISSING');
  }

  if (returnType === 'none') {
    return '';
  }
  if (returnType === 'pipe') {
    return String(createdMessage.mes ?? '');
  }
  return JSON.stringify(createdMessage);
}

async function runCallback(args, value) {
  const { abortController } = requireActiveExecution(args);
  const scope = args._scope;
  const execCtx = getExecutionContextFromScope(scope);

  let closure = null;
  let ownerScope = null;
  let positionalArgs = [];
  if (value instanceof SlashCommandClosure) {
    closure = value;
  } else if (Array.isArray(value) && value[0] instanceof SlashCommandClosure) {
    closure = value[0];
    positionalArgs = value.slice(1);
  } else {
    const rawTarget = Array.isArray(value) ? normalizeValueToString(value[0]).trim() : normalizeValueToString(value).trim();
    if (Array.isArray(value) && value.length > 1) {
      positionalArgs = value.slice(1);
    }
    if (!rawTarget) {
      throw new Error('VC_SLASH_RUN_TARGET_REQUIRED');
    }
    let resolved = null;
    if (scope && typeof scope.existsVariable === 'function' && scope.existsVariable(rawTarget)) {
      ownerScope = findVariableOwnerScope(scope, rawTarget);
      resolved = scope.getVariable(rawTarget);
    }
    if (!(resolved instanceof SlashCommandClosure)) {
      throw new Error('VC_SLASH_RUN_CLOSURE_REQUIRED');
    }
    closure = resolved;
  }

  validateParsedClosureTree(closure, null);

  const providedArgs = [];
  for (const [k, v] of Object.entries(args ?? {})) {
    if (INTERNAL_EXECUTOR_ARG_KEYS.has(k)) {
      continue;
    }
    if (k.startsWith('_') || RESERVED_ARG_NAMES.has(k)) {
      throw new Error('VC_SLASH_RESERVED_ARGUMENT');
    }
    if (v === undefined) {
      continue;
    }
    if (!isDeclaredClosureArgument(closure, k)) {
      throw new Error('VC_SLASH_UNKNOWN_NAMED_ARGUMENT');
    }
    const namedArg = new SlashCommandNamedArgument();
    namedArg.name = k;
    namedArg.value = v instanceof SlashCommandClosure ? cloneClosureTree(v, abortController, execCtx) : String(v);
    providedArgs.push(namedArg);
  }

  if (positionalArgs.length > 0 && Array.isArray(closure.argumentList) && closure.argumentList.length > 0) {
    const firstArgDef = closure.argumentList[0];
    if (firstArgDef && !providedArgs.some(item => item.name === firstArgDef.name)) {
      const namedArg = new SlashCommandNamedArgument();
      namedArg.name = firstArgDef.name;
      namedArg.value =
        positionalArgs.length === 1 && positionalArgs[0] instanceof SlashCommandClosure
          ? cloneClosureTree(positionalArgs[0], abortController, execCtx)
          : positionalArgs.map(item => normalizeValueToString(item)).join(' ');
      providedArgs.push(namedArg);
    }
  }

  const runClosure = cloneClosureTree(closure, abortController, execCtx);
  const lexicalParent =
    closure.scope?.parent instanceof SlashCommandScope
      ? closure.scope.parent
      : ownerScope instanceof SlashCommandScope
        ? ownerScope
        : scope instanceof SlashCommandScope
          ? scope
          : null;
  if (!(runClosure.scope instanceof SlashCommandScope)) {
    runClosure.scope = new SlashCommandScope(lexicalParent);
  } else {
    runClosure.scope.parent = lexicalParent;
  }
  if (execCtx) {
    closureExecutionContextMap.set(runClosure, execCtx);
    scopeExecutionContextMap.set(runClosure.scope, execCtx);
  }
  runClosure.providedArgumentList = providedArgs;
  runClosure.breakController = new SlashCommandBreakController();

  const subResult = await runClosure.execute();
  if (subResult.isAborted) {
    if (abortController && !abortController.isAborted) {
      abortController.abort(subResult.abortReason, subResult.isQuiet ?? subResult.isQuietlyAborted);
    }
    return '';
  }
  if (subResult.isError) {
    throw new Error('VC_SLASH_RUN_EXECUTION_FAILED');
  }
  if (subResult.isBreak && runClosure.breakController) {
    runClosure.breakController.isBreak = false;
  }
  return subResult.pipe ?? '';
}

function extractKeyAndValue(args, value) {
  let key = args.key ?? args.name;
  let val = value;
  if (key === undefined || key === null || String(key).trim() === '') {
    if (typeof value === 'string') {
      const trimmed = value.trimStart();
      const idx = trimmed.indexOf(' ');
      if (idx > 0) {
        key = trimmed.slice(0, idx).trim();
        val = trimmed.slice(idx + 1);
      } else {
        key = trimmed.trim();
        val = '';
      }
    }
  }
  return { key: String(key ?? '').trim(), val };
}

function registerBuiltInCommands() {
  registerCommand({
    name: 'pass',
    aliases: ['return'],
    callback: async (args, value) => {
      requireActiveExecution(args);
      if (value instanceof SlashCommandClosure) {
        return value;
      }
      return normalizeValueToString(value);
    },
    returns: ARGUMENT_TYPE.ANY,
    unnamedArgumentList: [
      SlashCommandArgument.fromProps({
        description: 'value to pass through pipe',
        typeList: [ARGUMENT_TYPE.ANY, ARGUMENT_TYPE.CLOSURE],
        isRequired: false,
      }),
    ],
  });

  registerCommand({
    name: 'echo',
    callback: async (args, value) => {
      requireActiveExecution(args);
      if (args?.raw !== undefined) {
        parseStrictBooleanOption(args.raw, 'VC_SLASH_INVALID_ECHO_RAW');
      }
      const text = normalizeValueToString(value);
      emitSanitizedSlashEvent('vc:slash:echo', { length: text.length });
      return text;
    },
    rawQuotes: true,
    namedArgumentList: [
      SlashCommandNamedArgument.fromProps({
        name: 'raw',
        typeList: [ARGUMENT_TYPE.BOOLEAN],
        defaultValue: 'false',
      }),
    ],
    unnamedArgumentList: [
      SlashCommandArgument.fromProps({
        description: 'text to echo',
        typeList: [ARGUMENT_TYPE.STRING],
        isRequired: false,
      }),
    ],
  });

  registerCommand({
    name: 'let',
    splitUnnamedArgument: true,
    callback: async (args, value) => {
      requireActiveExecution(args);
      const scope = args._scope;
      const items = Array.isArray(value) ? [...value] : [value];
      let key = args.key;
      let valItems = items;
      if (key === undefined) {
        key = items.shift();
        valItems = items;
      }
      if (!key || typeof key !== 'string') {
        throw new Error('VC_SLASH_LET_KEY_REQUIRED');
      }
      if (valItems.length === 0 && !args._hasUnnamedArgument) {
        scope.letVariable(key, '');
        return '';
      }
      let rawVal;
      if (valItems.length === 0) {
        rawVal = '';
      } else if (valItems.length === 1 && valItems[0] instanceof SlashCommandClosure) {
        rawVal = valItems[0];
      } else {
        rawVal = valItems.map(item => normalizeValueToString(item)).join(' ');
      }
      const finalVal =
        rawVal instanceof SlashCommandClosure
          ? rawVal
          : args.as
            ? convertValueType(rawVal, args.as)
            : rawVal;
      scope.letVariable(key, finalVal instanceof SlashCommandClosure ? finalVal : String(finalVal ?? ''));
      return finalVal instanceof SlashCommandClosure ? finalVal : String(finalVal ?? '');
    },
    returns: ARGUMENT_TYPE.ANY,
    namedArgumentList: [
      SlashCommandNamedArgument.fromProps({
        name: 'key',
        typeList: [ARGUMENT_TYPE.VARIABLE_NAME],
      }),
      SlashCommandNamedArgument.fromProps({
        name: 'as',
        typeList: [ARGUMENT_TYPE.STRING],
      }),
    ],
    unnamedArgumentList: [
      SlashCommandArgument.fromProps({
        description: 'key and value',
        typeList: [ARGUMENT_TYPE.ANY, ARGUMENT_TYPE.CLOSURE],
        isRequired: false,
        acceptsMultiple: true,
      }),
    ],
  });

  registerCommand({
    name: 'var',
    splitUnnamedArgument: true,
    callback: async (args, value) => {
      requireActiveExecution(args);
      const scope = args._scope;
      const items = Array.isArray(value) ? [...value] : [value];
      let key = args.key;
      let valItems = items;
      if (key === undefined) {
        key = items.shift();
        valItems = items;
      }
      if (!key || typeof key !== 'string') {
        throw new Error('VC_SLASH_VAR_KEY_REQUIRED');
      }
      const hasValue = args.key !== undefined ? Boolean(args._hasUnnamedArgument && valItems.length > 0 && !(valItems.length === 1 && valItems[0] === '')) : valItems.length > 0;
      if (!hasValue) {
        const got = scope.getVariable(key, args.index ?? null);
        if (got instanceof SlashCommandClosure) {
          return got;
        }
        const converted = args.as ? convertValueType(String(got ?? ''), args.as) : got;
        return String(converted ?? '');
      }
      const rawVal =
        valItems.length === 1 && valItems[0] instanceof SlashCommandClosure
          ? valItems[0]
          : valItems.map(item => normalizeValueToString(item)).join(' ');
      if (args.index !== undefined && args.index !== null) {
        scope.setVariable(key, rawVal, args.index, args.as ?? null);
        const converted = rawVal instanceof SlashCommandClosure ? rawVal : convertValueType(rawVal, args.as);
        return converted instanceof SlashCommandClosure ? converted : String(converted ?? '');
      }
      const finalVal =
        rawVal instanceof SlashCommandClosure
          ? rawVal
          : args.as
            ? convertValueType(rawVal, args.as)
            : rawVal;
      scope.setVariable(key, finalVal instanceof SlashCommandClosure ? finalVal : String(finalVal ?? ''));
      return finalVal instanceof SlashCommandClosure ? finalVal : String(finalVal ?? '');
    },
    returns: ARGUMENT_TYPE.ANY,
    namedArgumentList: [
      SlashCommandNamedArgument.fromProps({
        name: 'key',
        typeList: [ARGUMENT_TYPE.VARIABLE_NAME],
      }),
      SlashCommandNamedArgument.fromProps({
        name: 'index',
        typeList: [ARGUMENT_TYPE.STRING, ARGUMENT_TYPE.NUMBER],
      }),
      SlashCommandNamedArgument.fromProps({
        name: 'as',
        typeList: [ARGUMENT_TYPE.STRING],
      }),
    ],
    unnamedArgumentList: [
      SlashCommandArgument.fromProps({
        description: 'key and value',
        typeList: [ARGUMENT_TYPE.ANY, ARGUMENT_TYPE.CLOSURE],
        isRequired: false,
        acceptsMultiple: true,
      }),
    ],
  });

  registerCommand({
    name: 'setvar',
    aliases: ['setchatvar'],
    callback: async (args, value) => {
      requireActiveExecution(args);
      const scope = args._scope;
      const { key, val } = extractKeyAndValue(args, value);
      if (!key) {
        throw new Error('VC_SLASH_VAR_KEY_REQUIRED');
      }
      if (scope?.existsVariable(key)) {
        if (args.index !== undefined && args.index !== null && String(args.index) !== '') {
          scope.setVariable(key, normalizeValueToString(val), args.index, args.as ?? null);
          return normalizeValueToString(val);
        }
        const nextVal =
          val instanceof SlashCommandClosure
            ? val
            : args.as
              ? String(convertValueType(normalizeValueToString(val), args.as) ?? '')
              : normalizeValueToString(val);
        scope.setVariable(key, nextVal);
        return nextVal;
      }

      if (args.index !== undefined && args.index !== null && String(args.index) !== '') {
        const current = getLocalVariable(key);
        const nextItem = args.as ? convertValueType(normalizeValueToString(val), args.as) : normalizeValueToString(val);
        const updated = mutateIndexedVariable(current, args.index, () => nextItem);
        setLocalVariable(key, updated);
        return String(nextItem ?? '');
      }

      const finalValue = args.as
        ? String(convertValueType(normalizeValueToString(val), args.as) ?? '')
        : normalizeValueToString(val);
      setLocalVariable(key, finalValue);
      return finalValue;
    },
    returns: ARGUMENT_TYPE.ANY,
    namedArgumentList: [
      SlashCommandNamedArgument.fromProps({
        name: 'key',
        aliases: ['name'],
        typeList: [ARGUMENT_TYPE.VARIABLE_NAME],
      }),
      SlashCommandNamedArgument.fromProps({
        name: 'index',
        typeList: [ARGUMENT_TYPE.STRING, ARGUMENT_TYPE.NUMBER],
      }),
      SlashCommandNamedArgument.fromProps({
        name: 'as',
        typeList: [ARGUMENT_TYPE.STRING],
      }),
    ],
    unnamedArgumentList: [
      SlashCommandArgument.fromProps({
        description: 'value',
        typeList: [ARGUMENT_TYPE.ANY, ARGUMENT_TYPE.CLOSURE],
        isRequired: false,
      }),
    ],
  });

  registerCommand({
    name: 'getvar',
    aliases: ['getchatvar'],
    callback: async (args, value) => {
      requireActiveExecution(args);
      const scope = args._scope;
      const key = String(args.key ?? args.name ?? value ?? '').trim();
      if (!key) {
        throw new Error('VC_SLASH_VAR_KEY_REQUIRED');
      }
      if (scope?.existsVariable(key)) {
        const scopedVal = scope.getVariable(key, args.index ?? null);
        if (scopedVal instanceof SlashCommandClosure) {
          return scopedVal;
        }
        return String(scopedVal ?? '');
      }
      const raw = getLocalVariable(key);
      return String(resolveIndexTarget(raw, args.index) ?? '');
    },
    returns: ARGUMENT_TYPE.ANY,
    namedArgumentList: [
      SlashCommandNamedArgument.fromProps({
        name: 'key',
        aliases: ['name'],
        typeList: [ARGUMENT_TYPE.VARIABLE_NAME],
      }),
      SlashCommandNamedArgument.fromProps({
        name: 'index',
        typeList: [ARGUMENT_TYPE.STRING, ARGUMENT_TYPE.NUMBER],
      }),
    ],
    unnamedArgumentList: [
      SlashCommandArgument.fromProps({
        description: 'variable key',
        typeList: [ARGUMENT_TYPE.VARIABLE_NAME],
        isRequired: false,
      }),
    ],
  });

  registerCommand({
    name: 'addvar',
    aliases: ['addchatvar'],
    callback: async (args, value) => {
      requireActiveExecution(args);
      const scope = args._scope;
      const { key, val } = extractKeyAndValue(args, value);
      if (!key) {
        throw new Error('VC_SLASH_VAR_KEY_REQUIRED');
      }
      const operand = normalizeValueToString(val);
      if (scope?.existsVariable(key)) {
        const cur = scope.getVariable(key);
        const curNum = Number(cur);
        const addNum = Number(operand);
        const next =
          !Number.isNaN(curNum) && !Number.isNaN(addNum) && String(cur).trim() !== '' && operand.trim() !== ''
            ? String(curNum + addNum)
            : `${cur ?? ''}${operand}`;
        scope.setVariable(key, next);
        return next;
      }
      return String(addLocalVariable(key, operand) ?? '');
    },
    namedArgumentList: [
      SlashCommandNamedArgument.fromProps({
        name: 'key',
        aliases: ['name'],
        typeList: [ARGUMENT_TYPE.VARIABLE_NAME],
      }),
    ],
    unnamedArgumentList: [
      SlashCommandArgument.fromProps({
        description: 'value to add',
        typeList: [ARGUMENT_TYPE.ANY],
        isRequired: false,
      }),
    ],
  });

  registerCommand({
    name: 'incvar',
    aliases: ['incchatvar'],
    callback: async (args, value) => {
      requireActiveExecution(args);
      const scope = args._scope;
      const key = String(args.key ?? args.name ?? value ?? '').trim();
      if (!key) {
        throw new Error('VC_SLASH_VAR_KEY_REQUIRED');
      }
      if (scope?.existsVariable(key)) {
        const next = String((Number(scope.getVariable(key)) || 0) + 1);
        scope.setVariable(key, next);
        return next;
      }
      return String(incrementLocalVariable(key) ?? '');
    },
    namedArgumentList: [
      SlashCommandNamedArgument.fromProps({
        name: 'key',
        aliases: ['name'],
        typeList: [ARGUMENT_TYPE.VARIABLE_NAME],
      }),
    ],
    unnamedArgumentList: [
      SlashCommandArgument.fromProps({
        description: 'variable key',
        typeList: [ARGUMENT_TYPE.VARIABLE_NAME],
        isRequired: false,
      }),
    ],
  });

  registerCommand({
    name: 'decvar',
    aliases: ['decchatvar'],
    callback: async (args, value) => {
      requireActiveExecution(args);
      const scope = args._scope;
      const key = String(args.key ?? args.name ?? value ?? '').trim();
      if (!key) {
        throw new Error('VC_SLASH_VAR_KEY_REQUIRED');
      }
      if (scope?.existsVariable(key)) {
        const next = String((Number(scope.getVariable(key)) || 0) - 1);
        scope.setVariable(key, next);
        return next;
      }
      return String(decrementLocalVariable(key) ?? '');
    },
    namedArgumentList: [
      SlashCommandNamedArgument.fromProps({
        name: 'key',
        aliases: ['name'],
        typeList: [ARGUMENT_TYPE.VARIABLE_NAME],
      }),
    ],
    unnamedArgumentList: [
      SlashCommandArgument.fromProps({
        description: 'variable key',
        typeList: [ARGUMENT_TYPE.VARIABLE_NAME],
        isRequired: false,
      }),
    ],
  });

  registerCommand({
    name: 'flushvar',
    aliases: ['flushchatvar', 'delvar', 'delchatvar'],
    callback: async (args, value) => {
      const { assertActive } = requireActiveExecution(args);
      const key = String(args.key ?? args.name ?? value ?? '').trim();
      if (!key) {
        throw new Error('VC_SLASH_VAR_KEY_REQUIRED');
      }
      await deleteLocalVariable(key);
      assertActive();
      return '';
    },
    namedArgumentList: [
      SlashCommandNamedArgument.fromProps({
        name: 'key',
        aliases: ['name'],
        typeList: [ARGUMENT_TYPE.VARIABLE_NAME],
      }),
    ],
    unnamedArgumentList: [
      SlashCommandArgument.fromProps({
        description: 'variable key',
        typeList: [ARGUMENT_TYPE.VARIABLE_NAME],
        isRequired: false,
      }),
    ],
  });

  registerCommand({
    name: 'setglobalvar',
    callback: async (args, value) => {
      requireActiveExecution(args);
      const { key, val } = extractKeyAndValue(args, value);
      if (!key) {
        throw new Error('VC_SLASH_VAR_KEY_REQUIRED');
      }
      if (args.index !== undefined && args.index !== null && String(args.index) !== '') {
        const current = getGlobalVariable(key);
        const nextItem = args.as ? convertValueType(normalizeValueToString(val), args.as) : normalizeValueToString(val);
        const updated = mutateIndexedVariable(current, args.index, () => nextItem);
        setGlobalVariable(key, updated);
        return String(nextItem ?? '');
      }
      const finalValue = args.as
        ? String(convertValueType(normalizeValueToString(val), args.as) ?? '')
        : normalizeValueToString(val);
      setGlobalVariable(key, finalValue);
      return finalValue;
    },
    namedArgumentList: [
      SlashCommandNamedArgument.fromProps({
        name: 'key',
        aliases: ['name'],
        typeList: [ARGUMENT_TYPE.VARIABLE_NAME],
      }),
      SlashCommandNamedArgument.fromProps({
        name: 'index',
        typeList: [ARGUMENT_TYPE.STRING, ARGUMENT_TYPE.NUMBER],
      }),
      SlashCommandNamedArgument.fromProps({
        name: 'as',
        typeList: [ARGUMENT_TYPE.STRING],
      }),
    ],
    unnamedArgumentList: [
      SlashCommandArgument.fromProps({
        description: 'value',
        typeList: [ARGUMENT_TYPE.ANY],
        isRequired: false,
      }),
    ],
  });

  registerCommand({
    name: 'getglobalvar',
    callback: async (args, value) => {
      requireActiveExecution(args);
      const key = String(args.key ?? args.name ?? value ?? '').trim();
      if (!key) {
        throw new Error('VC_SLASH_VAR_KEY_REQUIRED');
      }
      const raw = getGlobalVariable(key);
      return String(resolveIndexTarget(raw, args.index) ?? '');
    },
    namedArgumentList: [
      SlashCommandNamedArgument.fromProps({
        name: 'key',
        aliases: ['name'],
        typeList: [ARGUMENT_TYPE.VARIABLE_NAME],
      }),
      SlashCommandNamedArgument.fromProps({
        name: 'index',
        typeList: [ARGUMENT_TYPE.STRING, ARGUMENT_TYPE.NUMBER],
      }),
    ],
    unnamedArgumentList: [
      SlashCommandArgument.fromProps({
        description: 'global variable key',
        typeList: [ARGUMENT_TYPE.VARIABLE_NAME],
        isRequired: false,
      }),
    ],
  });

  registerCommand({
    name: 'addglobalvar',
    callback: async (args, value) => {
      requireActiveExecution(args);
      const { key, val } = extractKeyAndValue(args, value);
      if (!key) {
        throw new Error('VC_SLASH_VAR_KEY_REQUIRED');
      }
      return String(addGlobalVariable(key, normalizeValueToString(val)) ?? '');
    },
    namedArgumentList: [
      SlashCommandNamedArgument.fromProps({
        name: 'key',
        aliases: ['name'],
        typeList: [ARGUMENT_TYPE.VARIABLE_NAME],
      }),
    ],
    unnamedArgumentList: [
      SlashCommandArgument.fromProps({
        description: 'value to add',
        typeList: [ARGUMENT_TYPE.ANY],
        isRequired: false,
      }),
    ],
  });

  registerCommand({
    name: 'incglobalvar',
    callback: async (args, value) => {
      requireActiveExecution(args);
      const key = String(args.key ?? args.name ?? value ?? '').trim();
      if (!key) {
        throw new Error('VC_SLASH_VAR_KEY_REQUIRED');
      }
      return String(incrementGlobalVariable(key) ?? '');
    },
    namedArgumentList: [
      SlashCommandNamedArgument.fromProps({
        name: 'key',
        aliases: ['name'],
        typeList: [ARGUMENT_TYPE.VARIABLE_NAME],
      }),
    ],
    unnamedArgumentList: [
      SlashCommandArgument.fromProps({
        description: 'global variable key',
        typeList: [ARGUMENT_TYPE.VARIABLE_NAME],
        isRequired: false,
      }),
    ],
  });

  registerCommand({
    name: 'decglobalvar',
    callback: async (args, value) => {
      requireActiveExecution(args);
      const key = String(args.key ?? args.name ?? value ?? '').trim();
      if (!key) {
        throw new Error('VC_SLASH_VAR_KEY_REQUIRED');
      }
      return String(decrementGlobalVariable(key) ?? '');
    },
    namedArgumentList: [
      SlashCommandNamedArgument.fromProps({
        name: 'key',
        aliases: ['name'],
        typeList: [ARGUMENT_TYPE.VARIABLE_NAME],
      }),
    ],
    unnamedArgumentList: [
      SlashCommandArgument.fromProps({
        description: 'global variable key',
        typeList: [ARGUMENT_TYPE.VARIABLE_NAME],
        isRequired: false,
      }),
    ],
  });

  registerCommand({
    name: 'flushglobalvar',
    aliases: ['delglobalvar'],
    callback: async (args, value) => {
      const { assertActive } = requireActiveExecution(args);
      const key = String(args.key ?? args.name ?? value ?? '').trim();
      if (!key) {
        throw new Error('VC_SLASH_VAR_KEY_REQUIRED');
      }
      await deleteGlobalVariable(key);
      assertActive();
      return '';
    },
    namedArgumentList: [
      SlashCommandNamedArgument.fromProps({
        name: 'key',
        aliases: ['name'],
        typeList: [ARGUMENT_TYPE.VARIABLE_NAME],
      }),
    ],
    unnamedArgumentList: [
      SlashCommandArgument.fromProps({
        description: 'global variable key',
        typeList: [ARGUMENT_TYPE.VARIABLE_NAME],
        isRequired: false,
      }),
    ],
  });

  registerCommand({
    name: 'add',
    splitUnnamedArgument: true,
    callback: async (args, value) => {
      requireActiveExecution(args);
      const parts = splitMathParts(value);
      const sum = parts.reduce((acc, item) => acc + resolveOperand(item, args._scope), 0);
      return String(sum);
    },
    unnamedArgumentList: [
      SlashCommandArgument.fromProps({
        description: 'numbers to add',
        typeList: [ARGUMENT_TYPE.NUMBER],
        acceptsMultiple: true,
      }),
    ],
  });

  registerCommand({
    name: 'sub',
    splitUnnamedArgument: true,
    callback: async (args, value) => {
      requireActiveExecution(args);
      const parts = splitMathParts(value);
      if (!parts.length) return '0';
      const nums = parts.map(item => resolveOperand(item, args._scope));
      return String(nums.slice(1).reduce((acc, n) => acc - n, nums[0]));
    },
    unnamedArgumentList: [
      SlashCommandArgument.fromProps({
        description: 'numbers to subtract',
        typeList: [ARGUMENT_TYPE.NUMBER],
        acceptsMultiple: true,
      }),
    ],
  });

  registerCommand({
    name: 'mul',
    splitUnnamedArgument: true,
    callback: async (args, value) => {
      requireActiveExecution(args);
      const parts = splitMathParts(value);
      if (!parts.length) return '0';
      return String(parts.reduce((acc, item) => acc * resolveOperand(item, args._scope), 1));
    },
    unnamedArgumentList: [
      SlashCommandArgument.fromProps({
        description: 'numbers to multiply',
        typeList: [ARGUMENT_TYPE.NUMBER],
        acceptsMultiple: true,
      }),
    ],
  });

  registerCommand({
    name: 'div',
    splitUnnamedArgument: true,
    callback: async (args, value) => {
      requireActiveExecution(args);
      const parts = splitMathParts(value);
      if (parts.length < 2) return '0';
      const a = resolveOperand(parts[0], args._scope);
      const b = resolveOperand(parts[1], args._scope);
      return b === 0 ? '0' : String(a / b);
    },
    unnamedArgumentList: [
      SlashCommandArgument.fromProps({
        description: 'numbers to divide',
        typeList: [ARGUMENT_TYPE.NUMBER],
        acceptsMultiple: true,
      }),
    ],
  });

  registerCommand({
    name: 'mod',
    splitUnnamedArgument: true,
    callback: async (args, value) => {
      requireActiveExecution(args);
      const parts = splitMathParts(value);
      if (parts.length < 2) return '0';
      const a = resolveOperand(parts[0], args._scope);
      const b = resolveOperand(parts[1], args._scope);
      return b === 0 ? '0' : String(a % b);
    },
    unnamedArgumentList: [
      SlashCommandArgument.fromProps({
        description: 'numbers to modulo',
        typeList: [ARGUMENT_TYPE.NUMBER],
        acceptsMultiple: true,
      }),
    ],
  });

  registerCommand({
    name: 'len',
    aliases: ['length'],
    callback: async (args, value) => {
      requireActiveExecution(args);
      const str = normalizeValueToString(value);
      try {
        const parsed = JSON.parse(str);
        if (Array.isArray(parsed)) return String(parsed.length);
        if (parsed && typeof parsed === 'object') return String(Object.keys(parsed).length);
      } catch {
        // fall through to string length
      }
      return String(str.length);
    },
    unnamedArgumentList: [
      SlashCommandArgument.fromProps({
        description: 'target string, list, or dictionary',
        typeList: [ARGUMENT_TYPE.ANY],
      }),
    ],
  });

  registerCommand({
    name: 'run',
    callback: runCallback,
    returns: ARGUMENT_TYPE.ANY,
    splitUnnamedArgument: true,
    unnamedArgumentList: [
      SlashCommandArgument.fromProps({
        description: 'closure or closure variable name',
        typeList: [ARGUMENT_TYPE.CLOSURE, ARGUMENT_TYPE.VARIABLE_NAME, ARGUMENT_TYPE.ANY],
        isRequired: true,
        acceptsMultiple: true,
      }),
    ],
  });

  registerCommand({
    name: 'abort',
    callback: async (args, value) => {
      const { abortController } = requireActiveExecution(args);
      const isQuiet =
        args.quiet !== undefined ? parseStrictBooleanOption(args.quiet, 'VC_SLASH_INVALID_ABORT_QUIET') : false;
      const reason = normalizeValueToString(value);
      abortController?.abort(reason, isQuiet);
      return reason;
    },
    namedArgumentList: [
      SlashCommandNamedArgument.fromProps({
        name: 'quiet',
        typeList: [ARGUMENT_TYPE.BOOLEAN],
        defaultValue: 'false',
      }),
    ],
    unnamedArgumentList: [
      SlashCommandArgument.fromProps({
        description: 'abort reason',
        typeList: [ARGUMENT_TYPE.STRING],
        isRequired: false,
      }),
    ],
  });

  registerCommand({
    name: 'break',
    callback: async (args, value) => {
      requireActiveExecution(args);
      return value ?? '';
    },
    returns: ARGUMENT_TYPE.ANY,
    unnamedArgumentList: [
      SlashCommandArgument.fromProps({
        description: 'return value on break',
        typeList: [ARGUMENT_TYPE.ANY, ARGUMENT_TYPE.CLOSURE],
        isRequired: false,
      }),
    ],
  });

  registerCommand(
    {
      name: 'parser-flag',
      splitUnnamedArgument: true,
      callback: async (args, value) => {
        requireActiveExecution(args);
        const items = Array.isArray(value)
          ? value.map(item => normalizeValueToString(item).trim()).filter(Boolean)
          : normalizeValueToString(value)
              .trim()
              .split(/\s+/)
              .filter(Boolean);
        const flagName = items[0] ?? '';
        const rawState = items[1] ?? 'on';
        if (!Object.hasOwn(PARSER_FLAG_KEYS, flagName)) {
          throw new Error('VC_SLASH_UNSUPPORTED_PARSER_FLAG');
        }
        const flagEnum = PARSER_FLAG[flagName];
        const enabled = parseStrictBooleanOption(rawState, 'VC_SLASH_INVALID_PARSER_FLAG_STATE');
        args._parserFlags[flagEnum] = enabled;
        return '';
      },
      unnamedArgumentList: [
        SlashCommandArgument.fromProps({
          description: 'flag name and state',
          typeList: [ARGUMENT_TYPE.ENUM, ARGUMENT_TYPE.BOOLEAN],
          isRequired: true,
          acceptsMultiple: true,
        }),
      ],
    },
    { unsafe: true },
  );

  registerCommand({
    name: 'send',
    callback: async (args, value) => dispatchSlashChatMessage('user', args, value),
    namedArgumentList: [
      SlashCommandNamedArgument.fromProps({
        name: 'at',
        typeList: [ARGUMENT_TYPE.NUMBER],
      }),
      SlashCommandNamedArgument.fromProps({
        name: 'name',
        typeList: [ARGUMENT_TYPE.STRING],
      }),
      SlashCommandNamedArgument.fromProps({
        name: 'return',
        typeList: [ARGUMENT_TYPE.ENUM],
        defaultValue: 'none',
      }),
    ],
    unnamedArgumentList: [
      SlashCommandArgument.fromProps({
        description: 'message text',
        typeList: [ARGUMENT_TYPE.STRING],
        isRequired: false,
      }),
    ],
  });

  registerCommand({
    name: 'sys',
    aliases: ['nar', 'sendas'],
    callback: async (args, value) => dispatchSlashChatMessage('system', args, value),
    namedArgumentList: [
      SlashCommandNamedArgument.fromProps({
        name: 'at',
        typeList: [ARGUMENT_TYPE.NUMBER],
      }),
      SlashCommandNamedArgument.fromProps({
        name: 'name',
        typeList: [ARGUMENT_TYPE.STRING],
      }),
      SlashCommandNamedArgument.fromProps({
        name: 'return',
        typeList: [ARGUMENT_TYPE.ENUM],
        defaultValue: 'none',
      }),
    ],
    unnamedArgumentList: [
      SlashCommandArgument.fromProps({
        description: 'system message text',
        typeList: [ARGUMENT_TYPE.STRING],
        isRequired: false,
      }),
    ],
  });

  registerCommand({
    name: 'hide',
    callback: async (args, value) => {
      const { snapshot, assertActive } = requireActiveExecution(args);
      const chat = Array.isArray(snapshot.context?.chat) ? snapshot.context.chat : null;
      if (!chat || chat.length === 0) {
        return '';
      }
      const bounds = parseRangeBounds(args.range ?? value ?? chat.length - 1, chat.length);
      if (!bounds) {
        throw new Error('VC_SLASH_INVALID_MESSAGE_RANGE');
      }
      const updates = [];
      for (let i = bounds.start; i <= bounds.end; i += 1) {
        updates.push({ message_id: i, is_hidden: true });
      }
      if (updates.length > 0) {
        await setChatMessages(
          updates,
          { refresh: 'affected' },
          { assertActive, expectedMetadata: snapshot.metadataRef },
        );
      }
      return '';
    },
    namedArgumentList: [
      SlashCommandNamedArgument.fromProps({
        name: 'range',
        typeList: [ARGUMENT_TYPE.STRING, ARGUMENT_TYPE.NUMBER],
      }),
    ],
    unnamedArgumentList: [
      SlashCommandArgument.fromProps({
        description: 'message index or range',
        typeList: [ARGUMENT_TYPE.STRING, ARGUMENT_TYPE.NUMBER],
        isRequired: false,
      }),
    ],
  });

  registerCommand({
    name: 'unhide',
    callback: async (args, value) => {
      const { snapshot, assertActive } = requireActiveExecution(args);
      const chat = Array.isArray(snapshot.context?.chat) ? snapshot.context.chat : null;
      if (!chat || chat.length === 0) {
        return '';
      }
      const bounds = parseRangeBounds(args.range ?? value ?? chat.length - 1, chat.length);
      if (!bounds) {
        throw new Error('VC_SLASH_INVALID_MESSAGE_RANGE');
      }
      const updates = [];
      for (let i = bounds.start; i <= bounds.end; i += 1) {
        updates.push({ message_id: i, is_hidden: false });
      }
      if (updates.length > 0) {
        await setChatMessages(
          updates,
          { refresh: 'affected' },
          { assertActive, expectedMetadata: snapshot.metadataRef },
        );
      }
      return '';
    },
    namedArgumentList: [
      SlashCommandNamedArgument.fromProps({
        name: 'range',
        typeList: [ARGUMENT_TYPE.STRING, ARGUMENT_TYPE.NUMBER],
      }),
    ],
    unnamedArgumentList: [
      SlashCommandArgument.fromProps({
        description: 'message index or range',
        typeList: [ARGUMENT_TYPE.STRING, ARGUMENT_TYPE.NUMBER],
        isRequired: false,
      }),
    ],
  });

  registerCommand({
    name: 'del',
    aliases: ['delete'],
    callback: async (args, value) => {
      const { snapshot, assertActive } = requireActiveExecution(args);
      const chat = Array.isArray(snapshot.context?.chat) ? snapshot.context.chat : null;
      if (!chat || chat.length === 0) {
        return '';
      }
      const rawCount = value === undefined || value === null || String(value).trim() === '' ? '1' : value;
      const count = parseIntegerOption(rawCount);
      if (count === null || count <= 0 || Object.is(count, -0)) {
        throw new Error('VC_SLASH_INVALID_DELETE_COUNT');
      }
      const start = Math.max(0, chat.length - count);
      const ids = [];
      for (let i = start; i < chat.length; i += 1) {
        ids.push(i);
      }
      if (ids.length > 0) {
        await deleteChatMessages(
          ids,
          { refresh: 'all' },
          { assertActive, expectedMetadata: snapshot.metadataRef },
        );
      }
      return '';
    },
    unnamedArgumentList: [
      SlashCommandArgument.fromProps({
        description: 'number of tail messages to delete',
        typeList: [ARGUMENT_TYPE.NUMBER],
        isRequired: false,
      }),
    ],
  });

  registerCommand({
    name: 'inject',
    callback: async (args, value) => {
      const { snapshot } = requireActiveExecution(args);
      const ctx = snapshot.context;
      const id = String(args.id ?? '').trim();
      if (!id) {
        throw new Error('VC_SLASH_INJECT_ID_REQUIRED');
      }
      const text = normalizeValueToString(value);
      const posKey = String(args.position ?? 'chat')
        .trim()
        .toLowerCase();
      if (!Object.hasOwn(EXTENSION_PROMPT_POSITION_MAP, posKey)) {
        throw new Error('VC_SLASH_INVALID_INJECT_POSITION');
      }
      const roleKey = String(args.role ?? 'system')
        .trim()
        .toLowerCase();
      if (!Object.hasOwn(EXTENSION_PROMPT_ROLE_MAP, roleKey)) {
        throw new Error('VC_SLASH_INVALID_INJECT_ROLE');
      }
      const hasDepth = args.depth !== undefined && args.depth !== null && String(args.depth).trim() !== '';
      const depth = hasDepth ? parseIntegerOption(args.depth) : 4;
      if (hasDepth && depth === null) {
        throw new Error('VC_SLASH_INVALID_INJECT_DEPTH');
      }
      const scan =
        args.scan !== undefined ? parseStrictBooleanOption(args.scan, 'VC_SLASH_INVALID_INJECT_BOOLEAN') : false;
      const ephemeral =
        args.ephemeral !== undefined
          ? parseStrictBooleanOption(args.ephemeral, 'VC_SLASH_INVALID_INJECT_BOOLEAN')
          : false;

      if (typeof ctx?.setExtensionPrompt === 'function') {
        ctx.setExtensionPrompt(
          id,
          text,
          EXTENSION_PROMPT_POSITION_MAP[posKey],
          depth,
          scan,
          EXTENSION_PROMPT_ROLE_MAP[roleKey],
        );
      } else {
        setExtensionPrompt(
          id,
          text,
          EXTENSION_PROMPT_POSITION_MAP[posKey],
          depth,
          scan,
          EXTENSION_PROMPT_ROLE_MAP[roleKey],
        );
        if (ephemeral && ctx?.extensionPrompts?.[id]) {
          ctx.extensionPrompts[id].ephemeral = true;
        }
      }
      return '';
    },
    namedArgumentList: [
      SlashCommandNamedArgument.fromProps({ name: 'id', typeList: [ARGUMENT_TYPE.STRING], isRequired: true }),
      SlashCommandNamedArgument.fromProps({ name: 'position', typeList: [ARGUMENT_TYPE.ENUM], defaultValue: 'chat' }),
      SlashCommandNamedArgument.fromProps({ name: 'depth', typeList: [ARGUMENT_TYPE.NUMBER], defaultValue: '4' }),
      SlashCommandNamedArgument.fromProps({ name: 'role', typeList: [ARGUMENT_TYPE.ENUM], defaultValue: 'system' }),
      SlashCommandNamedArgument.fromProps({ name: 'scan', typeList: [ARGUMENT_TYPE.BOOLEAN], defaultValue: 'false' }),
      SlashCommandNamedArgument.fromProps({
        name: 'ephemeral',
        typeList: [ARGUMENT_TYPE.BOOLEAN],
        defaultValue: 'false',
      }),
    ],
    unnamedArgumentList: [
      SlashCommandArgument.fromProps({
        description: 'prompt text to inject',
        typeList: [ARGUMENT_TYPE.STRING],
        isRequired: false,
      }),
    ],
  });

  registerCommand({
    name: 'flushinject',
    aliases: ['flushinjects'],
    callback: async (args, value) => {
      const { snapshot } = requireActiveExecution(args);
      const ctx = snapshot.context;
      const id = String(args.id ?? value ?? '').trim();
      const prompts = ctx?.extensionPrompts ?? extension_prompts;
      if (!prompts || typeof prompts !== 'object') {
        return '';
      }
      if (!id) {
        for (const k of Object.keys(prompts)) {
          delete prompts[k];
        }
      } else {
        delete prompts[id];
      }
      return '';
    },
    namedArgumentList: [SlashCommandNamedArgument.fromProps({ name: 'id', typeList: [ARGUMENT_TYPE.STRING] })],
    unnamedArgumentList: [
      SlashCommandArgument.fromProps({
        description: 'inject id to flush',
        typeList: [ARGUMENT_TYPE.STRING],
        isRequired: false,
      }),
    ],
  });

  registerCommand({
    name: 'ejs',
    callback: async (args, value) => {
      const { assertActive } = requireActiveExecution(args);
      const host = getCardHost();
      const commands = host?.ejs?.commands ?? host?.ejs?.desktopCommands ?? host?.commands;
      const ejsFn = commands?.ejs ?? commands?.run;
      if (typeof ejsFn !== 'function') {
        throw new Error('VC_SLASH_EJS_HOST_UNAVAILABLE');
      }
      const code = normalizeValueToString(value);
      const output = await ejsFn(args, code);
      assertActive();
      return normalizeValueToString(output);
    },
    namedArgumentList: [
      SlashCommandNamedArgument.fromProps({
        name: 'ctx',
        typeList: [ARGUMENT_TYPE.DICTIONARY],
      }),
      SlashCommandNamedArgument.fromProps({
        name: 'block',
        typeList: [ARGUMENT_TYPE.BOOLEAN],
      }),
    ],
    unnamedArgumentList: [
      SlashCommandArgument.fromProps({
        description: 'EJS template or script block',
        typeList: [ARGUMENT_TYPE.STRING],
        isRequired: false,
      }),
    ],
  });

  registerCommand({
    name: 'ejs-refresh',
    callback: async (args, value) => {
      const { assertActive } = requireActiveExecution(args);
      const host = getCardHost();
      const commands = host?.ejs?.commands ?? host?.ejs?.desktopCommands ?? host?.commands;
      const refreshFn = commands?.['ejs-refresh'] ?? commands?.refresh;
      if (typeof refreshFn !== 'function') {
        throw new Error('VC_SLASH_EJS_HOST_UNAVAILABLE');
      }
      const output = await refreshFn(args, normalizeValueToString(value));
      assertActive();
      return normalizeValueToString(output);
    },
  });
}

registerBuiltInCommands();

function validateScopeOption(scope) {
  if (scope === undefined || scope === null) {
    return null;
  }
  if (!(scope instanceof SlashCommandScope)) {
    throw new Error('Invalid scope: expected SlashCommandScope');
  }
  return scope;
}

const ALLOWED_EXECUTION_OPTION_KEYS = new Set([
  'handleParserErrors',
  'handleExecutionErrors',
  'scope',
  'parserFlags',
  'abortController',
  'onProgress',
  'source',
]);

function validateAllowedExecutionOptions(options) {
  if (options === undefined || options === null) {
    return {};
  }
  if (typeof options !== 'object' || Array.isArray(options)) {
    throw new Error('VC_SLASH_INVALID_OPTIONS');
  }
  if (options.debugController !== undefined && options.debugController !== null) {
    throw new Error('Slash command debugger (debugController) is not supported');
  }
  if (options.signal !== undefined && options.signal !== null) {
    throw new Error('Native AbortSignal is not supported; pass SlashCommandAbortController');
  }
  for (const key of Object.keys(options)) {
    if (key === 'debugController' || key === 'signal') {
      continue;
    }
    if (!ALLOWED_EXECUTION_OPTION_KEYS.has(key)) {
      throw new Error(`Unsupported slash execution option: ${key}`);
    }
  }
  if (options.handleExecutionErrors !== undefined && typeof options.handleExecutionErrors !== 'boolean') {
    throw new Error('VC_SLASH_INVALID_OPTIONS');
  }
  if (options.handleParserErrors !== undefined && typeof options.handleParserErrors !== 'boolean') {
    throw new Error('VC_SLASH_INVALID_OPTIONS');
  }
  if (options.onProgress !== undefined && options.onProgress !== null && typeof options.onProgress !== 'function') {
    throw new Error('VC_SLASH_INVALID_ON_PROGRESS');
  }
  if (options.source !== undefined && options.source !== null && typeof options.source !== 'string') {
    throw new Error('VC_SLASH_INVALID_OPTIONS');
  }
  return options;
}

export async function executeSlashCommandsWithOptions(text, options = {}) {
  const validatedOptions = validateAllowedExecutionOptions(options);
  const {
    handleParserErrors = true,
    handleExecutionErrors = true,
    scope = null,
    parserFlags = null,
    abortController: rawAbortController = null,
    onProgress = null,
    source = undefined,
  } = validatedOptions;

  const parentScope = validateScopeOption(scope);
  const abortController = createSlashAbortController(rawAbortController, validatedOptions);
  const snapshot = captureSlashExecutionSnapshot();

  const rawScript = String(text ?? '');
  if (!rawScript.trim()) {
    try {
      resolveParserFlags(parserFlags);
      assertSlashExecutionActive(snapshot, abortController);
    } catch {
      if (!handleParserErrors || !handleExecutionErrors) {
        throw new Error('Slash command parse error');
      }
      const errResult = new SlashCommandClosureResult();
      errResult.isError = true;
      errResult.errorMessage = 'Slash command parse error';
      return errResult;
    }
    const emptyResult = new SlashCommandClosureResult();
    emptyResult.pipe = '';
    return emptyResult;
  }

  let closure;
  try {
    const resolvedFlags = resolveParserFlags(parserFlags);
    closure = parser.parse(rawScript, true, resolvedFlags, abortController);
    validateParsedClosureTree(closure, parser);
  } catch {
    emitSanitizedSlashEvent('vc:slash:parse-error', { code: 'VC_SLASH_PARSE_FAILED' });
    if (handleParserErrors && handleExecutionErrors) {
      const errResult = new SlashCommandClosureResult();
      errResult.isError = true;
      errResult.errorMessage = 'Slash command parse error';
      return errResult;
    }
    throw new Error('Slash command parse error');
  }

  if (parentScope) {
    closure.scope.parent = parentScope;
  }
  closure.onProgress = onProgress ?? null;
  if (source !== undefined && source !== null) {
    closure.source = source;
  }

  const execCtx = { snapshot, abortController };
  closureExecutionContextMap.set(closure, execCtx);
  scopeExecutionContextMap.set(closure.scope, execCtx);

  let result;
  try {
    result = await closure.execute();
  } catch {
    result = new SlashCommandClosureResult();
    result.isError = true;
    result.errorMessage = 'Slash command execution failed';
  }

  if (result.isAborted) {
    if (snapshot?.context?.metadataDirty || snapshot?.context?.settingsDirty) {
      try {
        await settleSlashExecutionPersistence(snapshot, abortController, { allowAborted: true });
      } catch {
        emitSanitizedSlashEvent('vc:slash:commit-error', { code: 'VC_SLASH_COMMIT_FAILED' });
        if (!handleExecutionErrors) {
          throw new Error('Slash command commit failed');
        }
        result.isError = true;
        result.errorMessage = 'Slash command commit failed';
      }
    }
    return result;
  }

  if (result.isError) {
    emitSanitizedSlashEvent('vc:slash:execution-error', { code: 'VC_SLASH_EXECUTION_FAILED' });
    if (!handleExecutionErrors) {
      throw new Error('Slash command execution failed');
    }
    return result;
  }

  try {
    await settleSlashExecutionPersistence(snapshot, abortController);
  } catch {
    emitSanitizedSlashEvent('vc:slash:commit-error', { code: 'VC_SLASH_COMMIT_FAILED' });
    if (!handleExecutionErrors) {
      throw new Error('Slash command commit failed');
    }
    result.isError = true;
    result.errorMessage = 'Slash command commit failed';
    return result;
  }

  return result;
}

export async function executeSlashCommands(
  text,
  handleParserErrors = true,
  scope = null,
  handleExecutionErrors = false,
  parserFlags = null,
  abortController = null,
  onProgress = null,
) {
  return executeSlashCommandsWithOptions(text, {
    handleParserErrors,
    scope,
    handleExecutionErrors,
    parserFlags,
    abortController,
    onProgress,
  });
}

export async function triggerSlash(commandText, options = {}) {
  const result = await executeSlashCommandsWithOptions(commandText, {
    ...options,
    handleParserErrors: false,
    handleExecutionErrors: false,
  });
  if (result?.isAborted) {
    throw new Error('Slash command aborted');
  }
  if (result?.isError) {
    throw new Error('Slash command execution failed');
  }
  return result?.pipe ?? '';
}

export const triggerSlashWithResult = triggerSlash;
export const _triggerSlash = triggerSlash;
export const _triggerSlashWithResult = triggerSlash;
