// RQ-3 offline policy / lexical-recall regression. Uses the locked, patched
// extractor and real SQLite/FTS. LLM output is synthetic fixture data; no model
// endpoint is called. Temporary databases and derived modules are always removed.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { memorycoreBuild } from '../integrations/sillytavern/scripts/lib/memorycore-managed.mjs';
import { INTEG } from '../integrations/sillytavern/scripts/lib/paths.mjs';
import { createNativeFactory } from '../integrations/sillytavern/memorycore-service/native-engine.mjs';
const datasetFile = new URL('./fixtures/memory-eval.json', import.meta.url);
// Fixed synthetic vectors exercise the real cosine/FTS gates without a model.
const vocabulary=['上海','徐汇','茉莉花茶','妹妹','小芙','苏州','婚礼','乌龙茶','累','困','杭州','茶'];
function vector(text){const result=new Float32Array(16);vocabulary.forEach((word,i)=>{result[i]=text.includes(word)?(word==='茶'?3:1):0;});if(!result.some(Boolean))result[15]=1;return result;}
const baselineFile = new URL('./fixtures/memory-eval-baseline.json', import.meta.url);

export function compareBaseline(report, baseline) {
    const failures = [];
    for (const [category, expected] of Object.entries(baseline.categories)) {
        const actual=report.categories[category];
        if (!actual || actual.passed/actual.total < expected.passed/expected.total) failures.push(category);
    }
    for (const expected of baseline.cases) {
        const actual=report.cases.find((row)=>row.id===expected.id);
        if (!actual || ['extraction','recall'].some((key)=>expected[key] && !actual[key])) failures.push(expected.id);
    }
    return [...new Set(failures)];
}

export async function evaluateMemory() {
    const dataset=JSON.parse(await fs.readFile(datasetFile,'utf8'));
    const root=await fs.mkdtemp(path.join(os.tmpdir(),'vc-rq-memory-eval-'));
    const interrupt=()=>{void fs.rm(root,{recursive:true,force:true}).finally(()=>process.exit(130));};
    process.once('SIGINT',interrupt);process.once('SIGTERM',interrupt);
    try {
        const build=memorycoreBuild();
        for (const [rel,content] of Object.entries(build.files)) {
            const file=path.join(root,rel);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,content,{mode:0o600});
        }
        await fs.symlink(path.join(INTEG,'node_modules'),path.join(root,'node_modules'));
        const api=await import(pathToFileURL(path.join(root,'upstream-api.mjs')).href);
        const factory=await createNativeFactory(api);const results=[];
        for (const sample of dataset.cases) {
            const dir=path.join(root,'case-'+sample.id);await fs.mkdir(dir);
            const native=await factory(dir);
            try {
                const scope={teamId:'owner:1',userId:'1',agentId:'instance:7:mode:COMPANION',sessionId:'daily-7',sessionKey:'daily-7'};
                native.configureSpace('offline-16',16);native.finishSpaceRebuild('offline-16',0);
                const embedding={embed:async(text)=>vector(text),embedQuery:async(text)=>vector(text)};
                let old=[];
                async function extract(content, memory, operation) {
                    const source=sample.id+'-'+operation;
                    const runner={run:async({taskId,prompt})=>{
                        if(taskId==='l1-conflict-detection') {
                            const ids=[...prompt.matchAll(/### 第 \d+ 条新记忆 \(record_id: ([^)]+)\)/gu)].map((match)=>match[1]);
                            if(!ids.length)throw new Error('EVAL_DEDUP_SCHEMA');
                            return JSON.stringify(ids.map((id)=>({record_id:id,action:old.length?'update':'store',target_ids:old,
                                ...(old.length?{merged_content:memory,merged_type:'persona',merged_priority:70}:{})})));
                        }
                        return JSON.stringify([{scene_name:'synthetic',message_ids:[source],memories:[{
                            content:memory,type:sample.type||'persona',priority:70,source_message_ids:[source],metadata:sample.metadata||{},
                        }]}]);
                    }};
                    const proposal=await native.prepare({messages:[{id:source,role:'user',content,timestamp:dataset.recordedAt}],
                        scope,allowedRecordIds:old,runner,embedding,recordedAt:dataset.recordedAt,sourceTime:sample.sourceTime});
                    native.commitPrepared({operationId:operation,scopeKey:'7:COMPANION:daily-7:main',revision:0,spaceId:'offline-16',filter:scope,targets:proposal.targets,
                        l0Records:[{id:source,...scope,role:'user',messageText:content,recordedAt:dataset.recordedAt,timestamp:Date.parse(dataset.recordedAt)}],
                        records:proposal.records.map((record)=>({record,embedding:vector(record.content)}))});
                    return proposal.records;
                }
                if(sample.previous)old=(await extract(sample.previous,sample.previous,'old')).map((r)=>r.id);
                const records=await extract(sample.source,sample.candidate,'new');
                const extraction=sample.expectStore===false?records.length===0:
                    records.length>0 && sample.required.every((word)=>records.some((r)=>r.content.includes(word)));
                const active=native.list().map((r)=>r.id);
                const hits=await native.search({query:sample.query,topK:5,scope,allowedRecordIds:active,rerank:false,embedding,
                    ...(sample.eventDate?{eventDate:sample.eventDate}:{})});
                const strings=hits.map((h)=>h.content||'');
                const recall=sample.expectRecall===false?hits.length===0:
                    sample.required.every((word)=>strings.some((s)=>s.includes(word))) && !(sample.forbidden||[]).some((word)=>strings.some((s)=>s.includes(word)));
                results.push({id:sample.id,category:sample.category,extraction,recall});
            } finally {await native.close();}
        }
        const categories={};
        for(const row of results){const total=categories[row.category]||={passed:0,total:0};total.total+=2;total.passed+=Number(row.extraction)+Number(row.recall);}
        return {schemaVersion:1,mode:'offline-synthetic-llm-vectors-sqlite',categories,cases:results};
    } finally {process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',interrupt);await fs.rm(root,{recursive:true,force:true});}
}

async function main(){
    const report=await evaluateMemory();
    if(process.argv.includes('--record-baseline'))await fs.writeFile(baselineFile,JSON.stringify(report,null,2)+'\n');
    const baseline=JSON.parse(await fs.readFile(baselineFile,'utf8'));const regressions=compareBaseline(report,baseline);
    console.log(JSON.stringify({...report,regressions}));if(regressions.length)process.exitCode=1;
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error('MEMORY_EVAL_FAILED');process.exitCode=1;});
