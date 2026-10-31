// Metadata-only distribution of persisted actual tiers; never infer old tiers.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { postProcess } from '../integrations/sillytavern/extension/vc-model-settings/reply-pipeline.js';
const TIERS=['极短','简短','正常','长'];
export function replyLengthStats(rows) {
    const values=Object.fromEntries(TIERS.map(tier=>[tier,[]]));let untagged=0;
    for(const row of rows) {
        if(row.is_user!==false || row.is_system || typeof row.mes!=='string')continue;
        const tier=row.extra?.vc_reply_length_tier;if(!TIERS.includes(tier)){untagged++;continue;}
        const text=postProcess(row.mes).text.replace(/<sticker\s+tag="[^"]*"\s*\/>|<voice\s*\/>|\s/gu,'');
        values[tier].push([...text].length);
    }
    const tiers={};
    for(const [tier,counts] of Object.entries(values)) {
        counts.sort((a,b)=>a-b);const n=counts.length;
        tiers[tier]={count:n,min:n?counts[0]:null,p50:n?counts[Math.ceil(n*.5)-1]:null,p90:n?counts[Math.ceil(n*.9)-1]:null,max:n?counts[n-1]:null,
            mean:n?Math.round(counts.reduce((a,b)=>a+b,0)/n*10)/10:null};
    }
    return {unit:'Unicode characters including punctuation, excluding whitespace and control markers',tiers,untagged,rawTextPersisted:false};
}
async function main() {
    const target=process.argv[2];if(!target)throw Error('path required');
    const stat=await fs.stat(target);let files=[target];
    if(stat.isDirectory())files=(await fs.readdir(target,{withFileTypes:true})).filter(e=>e.isFile()&&e.name.endsWith('.jsonl')).slice(0,30).map(e=>path.join(target,e.name));
    const rows=[];
    for(const file of files){if((await fs.stat(file)).size>2*1024*1024)throw Error('file too large');for(const line of (await fs.readFile(file,'utf8')).split('\n'))if(line.trim())rows.push(JSON.parse(line));}
    console.log(JSON.stringify(replyLengthStats(rows)));
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error('REPLY_LENGTH_STATS_FAILED');process.exitCode=1;});
