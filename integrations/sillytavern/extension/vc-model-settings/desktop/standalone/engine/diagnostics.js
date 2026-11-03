// 原计算中的调试参数可能包含私有正文。新运行模块不输出这些参数。
const silent = () => {};
export const quietConsole = Object.freeze({ debug: silent, info: silent, warn: silent, error: silent, log: silent, trace: silent, table: silent });
