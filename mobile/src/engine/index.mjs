// 引擎与服务端读取的单例，以及给界面用的响应式状态。
import { reactive } from 'vue';
import { createEngine } from './engine.mjs';
import { createServer } from './server.mjs';
import { syncThemeFromServer } from '../theme/store.mjs';
import {createIncomingCalls} from '../voice/incoming.mjs';

export const engineState = reactive({ state: 'idle', error: '', stView: false, popup: null });
export const incomingState=reactive({event:null,busy:false,error:'',view:null});
let incoming=null;
export function getIncomingCalls(){return incoming||(incoming=createIncomingCalls({state:incomingState,
 list:()=>getEngine().call('inbox','listInbox'),respond:(eventId,action,requestId)=>getEngine().call('api','storyRequest','POST',`/api/v1/inbox/${eventId}/call`,{action,requestId}),
 canRing:()=>!document.hidden&&!engineState.stView&&!engineState.callActive&&!engineState.voiceInputActive&&!getEngine().generating(),
}));}
let engine = null;
let server = null;

export function getServer() { return server || (server = createServer()); }

export function getEngine() {
    if (engine) return engine;
    engine = createEngine({ onState: (s, detail) => { engineState.state = s; engineState.error = s === 'error' ? String(detail || '') : ''; } });
    // 宿主确认框（导入内嵌世界书、启用脚本、首次引导）不自动同意：切到 ST 视图由用户处理。
    engine.on('popup', (p) => { engineState.popup = p; showStView(true); });
    if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('vcdebug') === '1') globalThis.__vcEngine = engine;
    return engine;
}

export async function startEngine() {
    const e = getEngine();
    await e.start();
    syncThemeFromServer(e.themeSettings());
    getIncomingCalls().start();
    if(globalThis.__vcEngine===e)globalThis.__vcIncoming=getIncomingCalls();
    return e;
}

export async function showStView(on, opts) {
    engineState.stView = Boolean(on);
    if (!on) engineState.popup = null;
    await getEngine().showStView(on, opts);
}
