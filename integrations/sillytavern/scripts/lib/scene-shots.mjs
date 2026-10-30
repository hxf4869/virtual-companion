// 非走查截图场景只落盘 1440 与 390 各一张。断言循环不受这层限制。

export function createShotBudget() {
    const used = new Set();
    return {
        allow(fileName) {
            const name = String(fileName);
            let slot = null;
            if (name.includes('1440')) slot = '1440';
            else if (name.includes('390')) slot = '390';
            if (!slot || used.has(slot)) return false;
            used.add(slot);
            return true;
        },
        slots() {
            return [...used];
        },
    };
}

export function keepSceneShot(budget, fileName) {
    const name = String(fileName);
    if (name.includes('1440') || name.includes('390') || name.includes('360')) return budget.allow(name);
    return true;
}
