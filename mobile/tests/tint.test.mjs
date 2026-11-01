import test from 'node:test';
import assert from 'node:assert/strict';
import { weightedTint } from '../src/ui/tint.mjs';
test('没有饱和像素的占位头像不把角色氛围染成灰色',()=>{
 assert.equal(weightedTint(new Uint8Array([100,100,100,255,200,200,200,255])), '');
 assert.equal(weightedTint(new Uint8Array([100,100,100,255,230,120,100,255])), '230,120,100');
});
