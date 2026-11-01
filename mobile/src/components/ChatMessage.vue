<template>
    <view class="vc-message-group" :class="{ 'is-user': row.user }">
        <VcAvatar v-if="!row.user" :avatar="avatar" :name="row.name" size="var(--vc-avatar-sm)" />
        <view class="vc-group-bubbles">
            <view v-for="m in row.messages" :key="m.id" :id="`message-${m.id}`" class="vc-message" :class="{ 'is-match': matches.includes(m.id) }">
                <view v-if="hasCard(m)" class="vc-card-link vc-glass" role="button" tabindex="0" @click="$emit('card', m.id)" @keydown.enter="$emit('card', m.id)">
                    <VcIcon name="layout-grid" /><text>{{ copy.card }}</text><text class="vc-open-label">{{ copy.open }}</text><VcIcon name="chevron-right" size="var(--vc-icon-sm)" />
                </view>
                <view v-else-if="ready && hasVoice(m)" class="vc-bubble" @longpress="$emit('menu',m)" @contextmenu.prevent="$emit('menu',m)"><VcVoice :message="m" /></view>
                <template v-else>
                    <view v-for="(part, i) in parts(m).parts" :key="i" class="vc-bubble" :class="{ 'is-sticker': part.type === 'sticker' }"
                        @longpress="$emit('menu', m)" @contextmenu.prevent="$emit('menu', m)">
                        <text v-if="i === 0 && parts(m).quote" class="vc-quote">{{ parts(m).quote }}</text>
                        <template v-if="part.type === 'sticker'">
                            <image v-if="m.extra?.vc_sticker?.src" :src="m.extra.vc_sticker.src" class="vc-sticker" mode="aspectFit" />
                            <text v-else>{{ m.extra?.vc_sticker?.text || copy.stickerPreview }}</text>
                        </template>
                        <div v-else-if="ready" class="vc-markdown" v-html="html(m, part.text)" @click="imageClick"></div>
                        <text v-else class="vc-bubble-text" selectable>{{ part.text }}</text>
                    </view>
                </template>
                <button v-if="long(m)" role="button" tabindex="0" class="vc-plain-btn" :aria-expanded="Boolean(expanded[m.id])" @click="expanded[m.id] = !expanded[m.id]">{{ expanded[m.id] ? '收起' : '展开全文' }}</button>
                <view v-if="m.swipes > 1" class="vc-candidates">
                    <button role="button" tabindex="0" class="vc-plain-btn" aria-label="上一个候选" :disabled="busy || m.id !== lastId || m.swipe === 0" :aria-disabled="busy || m.id !== lastId || m.swipe === 0" @click="$emit('swipe', 'left')">‹</button>
                    <text>{{ m.swipe + 1 }} / {{ m.swipes }}</text>
                    <button role="button" tabindex="0" class="vc-plain-btn" aria-label="下一个候选" :disabled="busy || m.id !== lastId" :aria-disabled="busy || m.id !== lastId" @click="$emit('swipe', 'right')">›</button>
                </view>
                <view v-if="interrupted && m.id === lastId && !m.user" class="vc-message-meta"><text>{{ copy.unfinished }}</text><button role="button" tabindex="0" class="vc-plain-btn" @click="$emit('continue')">{{ copy.continue }}</button></view>
                <text v-if="m.id === lastUser" class="vc-sent">{{ copy.sent }}</text>
            </view>
        </view>
    </view>
</template>
<script>
import VcAvatar from './VcAvatar.vue';
import VcIcon from './VcIcon.vue';
import VcVoice from './VcVoice.vue';
import { COPY } from '../copy.mjs';
import { segments } from '../chat/format.mjs';
import { getEngine } from '../engine/index.mjs';
export default {
    components: { VcAvatar, VcIcon, VcVoice },
    props: { row: Object, avatar: String, ready: Boolean, busy: Boolean, interrupted: Boolean, lastUser: Number, lastId: Number, matches: { type: Array, default: () => [] } },
    emits: ['menu', 'card', 'image', 'swipe', 'continue'],
    data: () => ({ copy: COPY, expanded: {} }),
    methods: {
        hasVoice(m) { return m.user ? Boolean(m.extra?.vc_voice_input) : ['queued','running','ready'].includes(m.extra?.vc_voice?.status); },
        long(m) { return m.text.length > 360 && !/```|<img\b|!\[|<iframe\b/.test(m.text); },
        parts(m) { return segments(this.long(m) && !this.expanded[m.id] ? { ...m, text: [...m.text].slice(0,180).join('') + '…' } : m); },
        hasCard(m) { return /```(?:html|xml)\b|<iframe\b/i.test(m.text) || (this.ready && getEngine().hasCardFrontend(m.id)); },
        html(m, text) { return getEngine().formatMessage(m.id, text); },
        imageClick(e) { const img = e.target?.closest?.('img'); if (img?.src) this.$emit('image', img.src); },
    },
};
</script>
<style>
.vc-message-group { display: flex; align-items: flex-end; gap: var(--vc-space-xs); margin: var(--vc-space-sm) 0; }
.vc-message-group.is-user { flex-direction: row-reverse; }
.vc-group-bubbles { max-width: var(--vc-bubble-max); min-width: 0; display: flex; flex-direction: column; gap: var(--vc-space-xxs); align-items: flex-start; }
.is-user .vc-group-bubbles { align-items: flex-end; }
.vc-message { display: flex; min-width: 0; max-width: 100%; flex-direction: column; align-items: flex-start; gap: var(--vc-space-xxs); }
.is-user .vc-message { align-items: flex-end; }
.vc-bubble { box-sizing: border-box; padding: var(--vc-space-xs) var(--vc-space-sm); margin-bottom: var(--vc-space-xxs); max-width: 100%; border-radius: var(--vc-radius-bubble); background: var(--vc-bubble-char); color: var(--vc-ink); backdrop-filter: blur(var(--vc-blur-glass)); font-size: var(--vc-fs-bubble); line-height: var(--vc-lh-bubble); overflow-wrap: anywhere; }
.is-user .vc-bubble { background: var(--vc-bubble-user); color: var(--vc-on-accent); }
.vc-message:not(:first-child) .vc-bubble:first-child { border-top-left-radius: var(--vc-radius-join); }
.is-user .vc-message:not(:first-child) .vc-bubble:first-child { border-top-left-radius: var(--vc-radius-bubble); border-top-right-radius: var(--vc-radius-join); }
.vc-bubble :deep(p) { margin: 0; } .vc-bubble :deep(p + p) { margin-top: var(--vc-space-xs); }
.vc-bubble :deep(img) { max-width: 100%; height: auto; border-radius: var(--vc-radius-md); cursor: zoom-in; }
.vc-bubble :deep(pre), .vc-bubble :deep(table) { max-width: 100%; overflow-x: auto; }
.vc-bubble :deep(a) { color: inherit; text-decoration: underline; }
.vc-bubble-text { white-space: pre-wrap; }
.vc-quote { display: block; border-left: 2px solid currentColor; padding-left: var(--vc-space-xs); font-size: var(--vc-fs-footnote); opacity: .8; margin-bottom: var(--vc-space-xs); }
.vc-bubble.is-sticker { background: none; backdrop-filter: none; padding: 0; }
.vc-sticker { width: var(--vc-sticker-size); height: var(--vc-sticker-size); }
.vc-sent, .vc-message-meta, .vc-candidates { color: var(--vc-ink-2); font-size: var(--vc-fs-footnote); display: flex; align-items: center; gap: var(--vc-space-xs); }
.vc-candidates button { padding: 0 var(--vc-space-xs); }
.vc-card-link { display: flex; align-items: center; gap: var(--vc-space-xs); padding: var(--vc-space-xs) var(--vc-space-sm); min-height: var(--vc-touch); border-radius: var(--vc-radius-md); font-size: var(--vc-fs-subhead); }
.vc-open-label { color: var(--vc-accent-text); }
.is-match .vc-bubble { outline: 2px solid var(--vc-accent); outline-offset: 2px; }
</style>
