<template>
    <view class="vc-aurora" aria-hidden="true"><view class="vc-aurora-a"></view><view class="vc-aurora-b"></view>
        <view v-if="url && !failed" class="vc-scene" :class="{'is-ready':ready}"><image :src="url" class="vc-scene-image" mode="aspectFill" @load="loaded" @error="unavailable" /><view class="vc-scene-top"></view><view class="vc-scene-bottom"></view></view>
    </view>
</template>
<script>
import {backgroundUrl} from '../theme/background.mjs';
export default {props:{background:String},emits:['scene'],data:()=>({ready:false,failed:false}),computed:{url(){return backgroundUrl(this.background);}},watch:{url:{immediate:true,handler(){this.ready=false;this.failed=false;this.$emit('scene',false);}}},methods:{loaded(){this.ready=true;this.$emit('scene',true);},unavailable(){this.ready=false;this.failed=true;this.$emit('scene',false);}}};
</script>
<style>
/* 默认背景：画布 + 角色氛围色柔光（DESIGN.md §17.6）。没有角色时用强调色。 */
.vc-aurora { position: fixed; inset: 0; z-index: 0; pointer-events: none; overflow: hidden; background: var(--vc-canvas); }
.vc-aurora-a, .vc-aurora-b { position: absolute; border-radius: var(--vc-radius-pill); filter: blur(60px); opacity: var(--vc-aurora-alpha); }
.vc-aurora-a { width: 120vw; height: 60vh; left: -30vw; top: -20vh; background: rgba(var(--tint, var(--vc-tint-default)), 0.9); }
.vc-aurora-b { width: 90vw; height: 50vh; right: -30vw; top: 10vh; background: rgba(var(--tint, var(--vc-tint-default)), 0.55); }
.vc-scene { position: absolute; inset: 0; opacity: 0; }
.vc-scene.is-ready { opacity: 1; }
.vc-scene-image { display: block; width: 100%; height: 100%; filter: blur(var(--vc-scene-blur)) brightness(var(--vc-scene-dim)); transform: scale(1.08); }
.vc-scene-top,.vc-scene-bottom { position: absolute; left: 0; right: 0; pointer-events: none; }
.vc-scene-top { top: 0; height: var(--vc-scene-top-height); background: linear-gradient(var(--vc-canvas),transparent); opacity: var(--vc-scene-top-alpha); }
.vc-scene-bottom { bottom: 0; height: var(--vc-scene-bottom-height); background: linear-gradient(transparent,var(--vc-canvas)); opacity: var(--vc-scene-bottom-alpha); }
</style>
