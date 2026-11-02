<template>
    <view>
        <VcFeedback /><VcReauth />
        <Teleport v-if="incoming.view===viewId" to="body"><VcIncoming v-if="incoming.event" :key="incoming.event.eventId" /></Teleport>
        <view v-if="engine.stView" class="vc-stview-bar"><button role="button" tabindex="0" class="vc-st-back vc-glass" aria-label="返回" @click="close"><VcIcon name="chevron-left" /><text>返回聊天</text></button></view>
    </view>
</template>
<script>
import VcFeedback from './VcFeedback.vue';
import VcReauth from './VcReauth.vue';
import VcIcon from './VcIcon.vue';
import VcIncoming from './VcIncoming.vue';
import { engineState, incomingState, showStView } from '../engine/index.mjs';
export default { components: { VcFeedback, VcIcon, VcReauth, VcIncoming }, data(){return {engine:engineState,incoming:incomingState,viewId:this.$.uid};},
 mounted(){if(this.incoming.view===null)this.incoming.view=this.viewId;},beforeUnmount(){if(this.incoming.view===this.viewId)this.incoming.view=null;},
 watch:{'incoming.view'(value){if(value===null)this.incoming.view=this.viewId;}},methods: { close() { showStView(false); } } };
</script>
<style>
.vc-stview-bar { position: fixed; z-index: var(--vc-z-stview-bar); bottom: calc(var(--vc-space-xs) + env(safe-area-inset-bottom)); left: var(--vc-space-md); }
.vc-st-back { display: flex; align-items: center; gap: var(--vc-space-xxs); min-height: var(--vc-touch); border-radius: var(--vc-radius-pill); color: var(--vc-ink); font-size: var(--vc-fs-subhead); }
</style>
