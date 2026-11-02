import test from 'node:test';
import assert from 'node:assert/strict';
import { weightedTint,avatarUrl } from '../src/ui/tint.mjs';
test('宿主头像使用当前同源绝对地址，避免 uni-H5 自动加 /m/',()=>{
 assert.equal(avatarUrl('role.png','https://vc.example.test'),'https://vc.example.test/thumbnail?type=avatar&file=role.png');assert.equal(avatarUrl('','https://vc.example.test'),'');
});
test('没有饱和像素的占位头像不把角色氛围染成灰色',()=>{
 assert.equal(weightedTint(new Uint8Array([100,100,100,255,200,200,200,255])), '');
 assert.equal(weightedTint(new Uint8Array([100,100,100,255,230,120,100,255])), '230,120,100');
});
