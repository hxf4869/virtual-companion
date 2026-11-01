import test from 'node:test';import assert from 'node:assert/strict';
import {labelNativeField} from '../src/ui/field-label.mjs';
test('uni 输入框更新后仍保留原来的可访问名称，不被外层短标签覆盖',()=>{
 let outer='静默开始';let inner='';
 const input={setAttribute:(k,v)=>{inner=v}};
 const el={matches:()=>false,querySelector:()=>input,getAttribute:()=>outer,removeAttribute:()=>{outer=null},closest:()=>({textContent:'开始'})};
 labelNativeField(el);assert.equal(inner,'静默开始');
 labelNativeField(el);assert.equal(inner,'静默开始');
 outer='静默结束';labelNativeField(el);assert.equal(inner,'静默结束');
});
