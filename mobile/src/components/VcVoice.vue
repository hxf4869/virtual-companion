<template><view class="vc-mobile-voice"></view></template>
<script>
import {getEngine} from '../engine/index.mjs';
export default {
 props:{message:Object},data:()=>({version:0}),
 mounted(){this.render();},beforeUnmount(){this.version++;},
 watch:{message:{handler(){this.render();},deep:true}},
 methods:{async render(){
  const version=++this.version,m=this.message;
  const node=await getEngine().voiceBubble(m,document);
  if(version!==this.version)return;
  const wave=node.querySelector('.vc-voice-wave');if(wave)while(wave.children.length<12)wave.append(document.createElement('i'));
  this.$el.replaceChildren(node);
 }},
};
</script>
<style>
.vc-mobile-voice { width: min(56vw,240px); max-width: 100%; }
.vc-mobile-voice :deep(.vc-voice) { width: 100%; }
.vc-mobile-voice :deep(.vc-voice-bar) { display: flex; align-items: center; gap: var(--vc-space-xs); min-height: var(--vc-touch); width: 100%; min-width: 136px; padding: 0; border: 0; background: none; color: inherit; }
.vc-mobile-voice :deep(.vc-voice-glyph) { display: flex; width: var(--vc-avatar-sm); height: var(--vc-avatar-sm); align-items: center; justify-content: center; flex: none; }
.vc-mobile-voice :deep(.vc-voice-glyph svg) { width: var(--vc-icon-md); height: var(--vc-icon-md); }
.vc-mobile-voice :deep(.vc-voice-wave) { display: flex; align-items: center; gap: 2px; height: 28px; flex: 1; }
.vc-mobile-voice :deep(.vc-voice-wave i) { width: 2px; height: 10px; border-radius: var(--vc-radius-pill); background: currentColor; }
.vc-mobile-voice :deep(.vc-voice-wave i:nth-child(3n)) { height: 24px; }.vc-mobile-voice :deep(.vc-voice-wave i:nth-child(3n+1)) { height: 16px; }
.vc-mobile-voice :deep(.vc-voice-playing .vc-voice-wave) { color: var(--vc-accent); }
.vc-mobile-voice :deep(.vc-voice-playing .vc-voice-wave i) { animation: vc-voice-wave var(--vc-dur-emphasized) var(--vc-ease-in-out) infinite alternate; }
.vc-mobile-voice :deep(.vc-voice-playing .vc-voice-wave i:nth-child(2n)) { animation-direction: alternate-reverse; }
.vc-mobile-voice :deep(.vc-voice-duration) { white-space: nowrap; font-size: var(--vc-fs-body); font-variant-numeric: tabular-nums; }
.vc-mobile-voice :deep(.vc-voice-unread) { width: 5px; height: 5px; border-radius: var(--vc-radius-pill); background: var(--vc-danger); flex: none; }
.vc-mobile-voice :deep(.vc-voice-transcribe) { display: block; min-height: var(--vc-touch); border: 0; background: none; color: inherit; font-size: var(--vc-fs-subhead); padding: 0; }
.vc-mobile-voice :deep(.vc-voice-text) { margin: 0; font-size: var(--vc-fs-subhead); opacity: .82; white-space: pre-wrap; }
.vc-mobile-voice :deep(.vc-voice-text[hidden]) { display: none; }
.vc-mobile-voice :deep(.vc-voice-pending) { font-size: var(--vc-fs-subhead); }
@keyframes vc-voice-wave { to { transform: scaleY(.45); } }
</style>
