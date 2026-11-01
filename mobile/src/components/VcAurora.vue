<template>
    <view class="vc-aurora" aria-hidden="true"><view class="vc-aurora-a"></view><view class="vc-aurora-b"></view></view>
</template>
<style>
/* 默认背景：画布 + 角色氛围色柔光（DESIGN.md §17.6）。没有角色时用强调色。 */
.vc-aurora { position: fixed; inset: 0; z-index: 0; pointer-events: none; overflow: hidden; background: var(--vc-canvas); }
.vc-aurora-a, .vc-aurora-b { position: absolute; border-radius: var(--vc-radius-pill); filter: blur(60px); opacity: var(--vc-aurora-alpha); }
.vc-aurora-a { width: 120vw; height: 60vh; left: -30vw; top: -20vh; background: rgba(var(--tint, var(--vc-tint-default)), 0.9); }
.vc-aurora-b { width: 90vw; height: 50vh; right: -30vw; top: 10vh; background: rgba(var(--tint, var(--vc-tint-default)), 0.55); }
</style>
