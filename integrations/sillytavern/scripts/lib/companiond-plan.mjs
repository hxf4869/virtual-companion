// 受管验收只编译一次 companiond，migrate / bootstrap / HTTP 服务复用同一二进制。

export function companiondPlan(binary) {
    if (typeof binary !== 'string' || binary.length === 0) throw new Error('companiond 输出路径缺失');
    return {
        build: ['go', 'build', '-C', 'backend', '-mod=vendor', '-o', binary, './cmd/companiond'],
        migrate: [binary, 'migrate'],
        bootstrap: [binary, 'bootstrap'],
        serve: [binary],
    };
}
