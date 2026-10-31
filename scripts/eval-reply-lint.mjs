// RQ-7: labelled synthetic false-positive check; optional private local JSONL
// scan prints counts only. Never writes raw conversations or report files.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { postProcess } from '../integrations/sillytavern/extension/vc-model-settings/reply-pipeline.js';
export const LINT_CASES = [
    ...['希望对你有帮助','有什么可以帮你','作为人工智能，我不能答应','总的来说就是这样','综上所述就是这个结论','生活就像一场旅行','你吃了吗？睡了吗？','但是甲。然而乙。不过丙。'].map(text=>({text,bad:true})),
    ...['我在，慢慢说','你先睡，醒了再聊','我也喜欢小猫','当然可以呀','其实我也有点不开心','好像是周五来着','太好了，你终于休息了','有空再聊','不想说也没关系','我今天也困了','我一时也不知道怎么办','他原话是「希望对你有帮助」','你说的“作为人工智能”很奇怪','他问「你吃了吗？睡了吗？」','我的生活就像一场旅行','我很难过，但是还好，然而没事，不过算了'].map(text=>({text,bad:false})),
];
export function evaluateLint(cases=LINT_CASES) {
    let truePositive=0,falsePositive=0,positive=0,negative=0;
    for(const row of cases){const flagged=postProcess(row.text).violations.some(item=>item.hard);if(row.bad){positive++;truePositive+=Number(flagged);}else{negative++;falsePositive+=Number(flagged);}}
    return {positive,negative,truePositive,falsePositive,falsePositiveRate:negative?falsePositive/negative:null};
}
async function privateScan(root) {
    const files=[];
    async function walk(dir,depth){if(depth>2)return;for(const item of await fs.readdir(dir,{withFileTypes:true})){
        const file=path.join(dir,item.name);if(item.isDirectory())await walk(file,depth+1);
        else if(item.isFile() && item.name.endsWith('.jsonl')){const stat=await fs.stat(file);if(stat.size<=2*1024*1024)files.push({file,mtime:stat.mtimeMs});}
    }}
    await walk(root,0);files.sort((a,b)=>b.mtime-a.mtime);const samples=[];
    for(const item of files.slice(0,30)){for(const line of (await fs.readFile(item.file,'utf8')).split('\n').slice(-100)){
        if(!line.trim())continue;const row=JSON.parse(line);if(row.is_user===false && !row.is_system && typeof row.mes==='string')samples.push(row.mes);
    }}
    const selected=samples.slice(-300),hits={};
    for(const text of selected)for(const item of postProcess(text).violations)hits[item.code]=(hits[item.code]||0)+1;
    return {files:Math.min(files.length,30),assistantSamples:selected.length,hits,humanLabelled:false,falsePositiveRate:null,rawTextPersisted:false};
}
async function main(){
    const result={synthetic:evaluateLint()};const flag=process.argv.indexOf('--private-dir');
    if(flag>=0)result.private=await privateScan(process.argv[flag+1]);
    console.log(JSON.stringify(result));if(result.synthetic.falsePositive || result.synthetic.truePositive!==result.synthetic.positive)process.exitCode=1;
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error('LINT_EVAL_FAILED');process.exitCode=1;});
