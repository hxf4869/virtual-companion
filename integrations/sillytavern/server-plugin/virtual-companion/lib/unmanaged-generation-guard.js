// Virtual Companion ST 桥接插件 — 未受校验文本生成出口的统一拒绝。
// 许可：AGPL-3.0-only（见目录 README；ADR-0009 §3）。
// 与 patches/st-*-vc-guard.json 配对：text-completions、kobold、koboldhorde（horde
// /generate-text）、novel 各在空 body 判断之后（该路由若无空 body 判断，则在处理函数
// 入口）、联系上游之前调用本方法。插件未装载时补丁看不到桥，钩子为空操作。
// 插件已装载即受管：这些出口没有三协议最终核对，一律拒绝，不回显请求正文。

import { writeErrorResponse } from './errors.js';
import { log } from './log.js';

export const UNVALIDATED_GENERATION_CODE = 'VC_UNVALIDATED_GENERATION';
const UNVALIDATED_GENERATION_MESSAGE = '受管宿主未开放未挂最终核对的生成路由';

/**
 * 未受校验生成路由的桥接钩子。
 * 补丁在桥对象存在时调用；返回 true 表示已写出拒绝响应，调用方不得再联系上游。
 * 不读取 request.body，响应只含固定状态、错误码与固定文案。
 * @param {import('express').Request} _request 保留与补丁调用点一致的签名；不得回显其正文
 * @param {import('express').Response} response
 * @returns {Promise<boolean>}
 */
export async function guardUnmanagedGeneration(_request, response) {
    writeErrorResponse(response, 409, UNVALIDATED_GENERATION_CODE, UNVALIDATED_GENERATION_MESSAGE);
    log.warn(`未受校验生成出口已拒绝：${UNVALIDATED_GENERATION_CODE}`);
    return true;
}
