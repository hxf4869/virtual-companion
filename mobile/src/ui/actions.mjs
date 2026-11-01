// 写入统一保留调用者草稿；需要 fresh reauth 时由界面显式验证后继续原动作。
import { reactive } from 'vue';
import { getEngine } from '../engine/index.mjs';
import { showToast } from './feedback.mjs';
import { COPY } from '../copy.mjs';
export const writeState = reactive({ reauth: null, busy: false, error: '' });
export function errorText(e) {
    if(e?.kind === 'conflict-revision' || e?.code === 'REVISION_CONFLICT') return '设置已在另一处更新，草稿已保留。';
    if(e?.kind === 'context-changed' || e?.status === 401) return '登录状态已变化，请重新加载页面后再试。';
    if(e?.kind === 'invalid') return e.message || COPY.error;
    return COPY.error;
}
export async function writeAction(action) {
    try { return await action(); }
    catch(e) {
        if(e?.kind==='forbidden' && e?.code==='ACCESS_DENIED') {
            return new Promise((resolve,reject)=>{ writeState.reauth={action,resolve,reject};writeState.error=''; });
        }
        throw e;
    }
}
export async function verifyAction(password) {
    if(writeState.busy) return;
    const pending=writeState.reauth;writeState.busy=true;writeState.error='';
    try { await getEngine().call('api','reauth',password); const result=await pending.action();writeState.reauth=null;pending.resolve(result); }
    catch(e) { writeState.error=errorText(e); }
    finally {writeState.busy=false;}
}
export function cancelVerify() { const p=writeState.reauth;writeState.reauth=null;p?.reject(new Error('cancelled')); }
export function reportError(e) { showToast(errorText(e),{error:true}); }
