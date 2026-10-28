// 确定性字符串替换补丁器：用于把上游已构建产物中的少量固定字串（如 CDN URL）替换为同源路径。
// 规则：输入 SHA256 必须等于规格声明；每条替换的命中次数必须严格等于声明值；输出 SHA256（若声明）必须吻合。
// 任一条件不满足即抛错，不产出半成品。补丁规格（JSON）记录理由、上游版本与可去除条件。
import fs from 'node:fs';
import { sha256 } from './util.mjs';

function countOccurrences(hay, needle) {
    if (!needle) throw new Error('replacement.from 不能为空');
    let n = 0;
    let i = 0;
    for (;;) {
        const k = hay.indexOf(needle, i);
        if (k < 0) return n;
        n += 1;
        i = k + needle.length;
    }
}

export function validateSpec(spec) {
    const errors = [];
    for (const key of ['id', 'reason', 'upstream', 'removal_condition', 'target', 'replacements']) {
        if (spec[key] === undefined || spec[key] === null || spec[key] === '') errors.push(`缺少字段 ${key}`);
    }
    if (!/^[0-9a-f]{64}$/.test(String(spec.expected_input_sha256 || ''))) errors.push('expected_input_sha256 必须是 64 位 hex');
    if (spec.expected_output_sha256 !== undefined && !/^[0-9a-f]{64}$/.test(String(spec.expected_output_sha256))) errors.push('expected_output_sha256 必须是 64 位 hex');
    if (!Array.isArray(spec.replacements) || spec.replacements.length === 0) errors.push('replacements 必须是非空数组');
    for (const [i, r] of (spec.replacements || []).entries()) {
        if (typeof r.from !== 'string' || !r.from) errors.push(`replacements[${i}].from 必须是非空字符串`);
        if (typeof r.to !== 'string') errors.push(`replacements[${i}].to 必须是字符串`);
        if (!Number.isInteger(r.count) || r.count < 1) errors.push(`replacements[${i}].count 必须是 ≥1 的整数`);
        if (typeof r.from === 'string' && typeof r.to === 'string' && r.from === r.to) errors.push(`replacements[${i}] from 与 to 相同`);
    }
    return errors;
}

/**
 * 对文本应用规格。返回 { output, report }；report 每条含 from/to/count。
 * @param {string} input 原始文本
 * @param {object} spec 补丁规格
 */
export function applySpecToText(input, spec) {
    const errors = validateSpec(spec);
    if (errors.length) throw new Error(`补丁规格无效：${errors.join('；')}`);
    const inSha = sha256(Buffer.from(input, 'utf8'));
    if (inSha !== spec.expected_input_sha256) {
        throw new Error(`输入 SHA256 不匹配：实际 ${inSha}，规格 ${spec.expected_input_sha256}（上游产物已变化或不是锁定版本）`);
    }
    let out = input;
    const report = [];
    for (const r of spec.replacements) {
        const n = countOccurrences(out, r.from);
        if (n !== r.count) throw new Error(`替换 "${r.from}" 命中 ${n} 次，规格要求 ${r.count} 次`);
        out = out.split(r.from).join(r.to);
        if (countOccurrences(out, r.from) !== 0) throw new Error(`替换后仍残留 "${r.from}"`);
        report.push({ from: r.from, to: r.to, count: n });
    }
    const outSha = sha256(Buffer.from(out, 'utf8'));
    if (spec.expected_output_sha256 && outSha !== spec.expected_output_sha256) {
        throw new Error(`输出 SHA256 不匹配：实际 ${outSha}，规格 ${spec.expected_output_sha256}`);
    }
    return { output: out, report, inputSha256: inSha, outputSha256: outSha };
}

/** 读文件→应用→写文件（0600）。返回 report。 */
export function applySpecToFile(inputPath, outputPath, spec) {
    const input = fs.readFileSync(inputPath, 'utf8');
    const result = applySpecToText(input, spec);
    fs.writeFileSync(outputPath, result.output, { mode: 0o600 });
    fs.chmodSync(outputPath, 0o600);
    return result;
}
