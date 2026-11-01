<template>
    <svg class="vc-icon" :style="{ '--vc-icon-size': size }" :aria-hidden="label ? undefined : 'true'" :role="label ? 'img' : undefined" :aria-label="label || undefined">
        <use :href="href"></use>
    </svg>
</template>
<script>
// Lucide 图标（静态 sprite，见 static/icons/SOURCE.txt）。
import sprite from '../static/icons/lucide.svg?url';

export default {
    props: { name: { type: String, required: true }, size: { type: String, default: 'var(--vc-icon-md)' }, label: { type: String, default: '' } },
    computed: { href() { return `${sprite}#${this.name}`; } },
};
</script>
<style>
.vc-icon { width: var(--vc-icon-size); height: var(--vc-icon-size); flex: none; stroke-width: 1.75; stroke-linecap: round; stroke-linejoin: round; }
</style>
