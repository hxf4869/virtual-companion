import assert from 'node:assert/strict';
import test from 'node:test';
import { timeOfDayShift } from '../extension/vc-model-settings/desktop/aurora.js';

test('本地时段划分：早 6–10、午 10–17、晚 17–20、夜 20–6', () => {
    const at = (h) => timeOfDayShift(new Date(2026, 10, 2, h, 30));
    assert.deepEqual([5, 6, 9, 10, 16, 17, 19, 20, 23, 0].map(at),
        ['night', 'morning', 'morning', 'noon', 'noon', 'evening', 'evening', 'night', 'night', 'night']);
});
