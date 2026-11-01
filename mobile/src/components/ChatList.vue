<template>
    <view class="vc-chatlist">
        <view class="vc-search vc-glass">
            <VcIcon name="search" size="var(--vc-icon-sm)" />
            <input v-field-label class="vc-search-input" v-model="query" :placeholder="copy.search" :aria-label="copy.search" confirm-type="search" />
        </view>
        <view v-if="loading" class="vc-rows" aria-busy="true">
            <view v-for="n in 3" :key="n" class="vc-row vc-skeleton"></view>
        </view>
        <view v-else-if="error" class="vc-empty">
            <VcIcon name="circle-alert" size="var(--vc-icon-xl)" />
            <text>{{ copy.error }}</text>
            <button role="button" tabindex="0" class="vc-text-btn" @click="load">{{ copy.retry }}</button>
        </view>
        <view v-else-if="!shown.length" class="vc-empty">
            <VcIcon name="message-circle" size="var(--vc-icon-xl)" />
            <text>{{ copy.noChats }}</text>
        </view>
        <view v-else class="vc-rows">
            <view v-for="row in shown" :key="row.key" class="vc-row-wrap">
                <view class="vc-row-actions" :style="{ width: `${Math.max(0, -offset(row))}px` }" :aria-hidden="swiped !== row.key">
                    <button role="button" tabindex="0" class="vc-action is-neutral" :tabindex="swiped === row.key ? 0 : -1" @click="togglePin(row)"><VcIcon name="layout-grid" size="var(--vc-icon-sm)" /><text>{{ row.pinned ? copy.unpin : copy.pin }}</text></button>
                    <button role="button" tabindex="0" class="vc-action is-danger" :tabindex="swiped === row.key ? 0 : -1" @click="remove(row)"><VcIcon name="trash-2" size="var(--vc-icon-sm)" /><text>{{ copy.remove }}</text></button>
                </view>
                <view class="vc-row" :data-chat-file="row.file" :style="{ transform: `translateX(${offset(row)}px)` }" role="button" tabindex="0"
                    :aria-label="`${row.name} ${row.instance}`"
                    @touchstart="swipeStart($event, row)" @touchmove="swipeMove($event, row)" @touchend="swipeEnd(row)"
                    @click="open(row)" @keydown.enter="open(row)" @keydown.delete="remove(row)" @contextmenu.prevent="swiped = row.key">
                    <VcAvatar :avatar="row.avatar" :name="row.name" />
                    <view class="vc-row-main">
                        <view class="vc-row-top">
                            <text class="vc-row-name">{{ row.name }}</text>
                            <text v-if="row.instance" class="vc-chip">{{ row.instance }}</text>
                            <text class="vc-row-time">{{ row.time }}</text>
                        </view>
                        <text class="vc-row-preview" :class="{ 'is-draft': row.draft }">{{ row.draft ? copy.draftPrefix + row.draft : row.preview }}</text>
                    </view>
                </view>
            </view>
        </view>
    </view>
</template>
<script>
import VcIcon from './VcIcon.vue';
import VcAvatar from './VcAvatar.vue';
import { COPY } from '../copy.mjs';
import { getEngine, getServer, engineState } from '../engine/index.mjs';
import { listTime, previewText, readDraft } from '../chat/format.mjs';
import { confirmAlert, showToast } from '../ui/feedback.mjs';

const ACTIONS_WIDTH = 176; // 两个操作块（各 88）

export default {
    components: { VcIcon, VcAvatar },
    data() { return { copy: COPY, rows: [], loading: true, error: false, query: '', swiped: '', drag: null, engine: engineState }; },
    computed: {
        shown() {
            const q = this.query.trim();
            const list = q ? this.rows.filter((r) => r.name.includes(q) || r.preview.includes(q)) : this.rows;
            return [...list].sort((a, b) => (b.pinned - a.pinned) || (b.updated - a.updated));
        },
    },
    watch: { 'engine.state'(s) { if (s === 'ready') this.applyPins(); } },
    mounted() { this.load(); },
    methods: {
        async load() {
            this.loading = true; this.error = false;
            try {
                const server = getServer();
                const [chats, characters] = await Promise.all([server.recentChats(50), server.characters()]);
                const names = new Map((characters || []).map((c) => [c.avatar, c.name]));
                this.rows = chats.filter((c) => names.has(c.avatar)).map((c) => ({
                    key: `${c.avatar}/${c.file}`, avatar: c.avatar, file: c.file, name: names.get(c.avatar),
                    instance: c.binding?.displayName || '', preview: previewText(c.preview), updated: c.updated,
                    time: listTime(c.updated), draft: readDraft(`${c.avatar}/${c.file}`), pinned: false,
                }));
                if (engineState.state === 'ready') await this.applyPins();
            } catch { this.error = true; }
            this.loading = false;
        },
        async applyPins() {
            try {
                const pins = await getEngine().pinnedChats();
                for (const r of this.rows) r.pinned = Boolean(pins[`char_${r.avatar}_${r.file}.jsonl`]);
            } catch { /* 置顶读不到时按时间排序 */ }
        },
        offset(row) { if (this.drag?.key === row.key) return this.drag.dx; return this.swiped === row.key ? -ACTIONS_WIDTH : 0; },
        swipeStart(e, row) { const t = e.touches[0]; this.drag = { key: row.key, x: t.clientX, y: t.clientY, dx: this.swiped === row.key ? -ACTIONS_WIDTH : 0, base: this.swiped === row.key ? -ACTIONS_WIDTH : 0, moved: false }; },
        swipeMove(e, row) {
            if (this.drag?.key !== row.key) return;
            const t = e.touches[0]; const dx = t.clientX - this.drag.x; const dy = t.clientY - this.drag.y;
            if (!this.drag.moved && Math.abs(dy) > Math.abs(dx)) { this.drag = null; return; }
            this.drag.moved = Math.abs(dx) > 6 || this.drag.moved;
            this.drag.dx = Math.min(0, Math.max(-ACTIONS_WIDTH, this.drag.base + dx));
        },
        swipeEnd(row) {
            if (this.drag?.key !== row.key) return;
            const open = this.drag.dx < -ACTIONS_WIDTH / 2;
            this.swiped = open ? row.key : '';
            this.suppressClick = this.drag.moved;
            this.drag = null;
        },
        open(row) {
            if (this.suppressClick) { this.suppressClick = false; return; }
            if (this.swiped) { this.swiped = ''; return; }
            uni.navigateTo({ url: `/pages/chat/conversation?avatar=${encodeURIComponent(row.avatar)}&file=${encodeURIComponent(row.file)}&name=${encodeURIComponent(row.name)}` });
        },
        async togglePin(row) {
            this.swiped = '';
            if (engineState.state !== 'ready') { showToast(COPY.connecting); return; }
            try { await getEngine().setPinned(row.avatar, row.file, !row.pinned); row.pinned = !row.pinned; } catch { showToast(COPY.error, { error: true }); }
        },
        async remove(row) {
            this.swiped = '';
            const ok = await confirmAlert({ title: COPY.deleteChatTitle, message: COPY.deleteBody, action: COPY.remove });
            if (!ok) return;
            if (engineState.state !== 'ready') { showToast(COPY.connecting); return; }
            try { await getEngine().deleteChat(row.avatar, row.file); this.rows = this.rows.filter((r) => r.key !== row.key); showToast(COPY.deleted); } catch { showToast(COPY.error, { error: true }); }
        },
    },
};
</script>
<style>
.vc-chatlist { display: flex; flex-direction: column; gap: var(--vc-space-sm); }
.vc-search { display: flex; align-items: center; gap: var(--vc-space-xs); height: var(--vc-touch); padding: 0 var(--vc-space-md); border-radius: var(--vc-radius-pill); color: var(--vc-ink-2); }
.vc-search-input { flex: 1; font-size: var(--vc-fs-body); color: var(--vc-ink); }
.vc-rows { display: flex; flex-direction: column; gap: var(--vc-space-sm); }
.vc-row-wrap { position: relative; border-radius: var(--vc-radius-lg); overflow: hidden; }
.vc-row-actions { position: absolute; inset: 0 0 0 auto; display: flex; gap: var(--vc-space-xxs); align-items: stretch; justify-content: flex-end; overflow: hidden; }
.vc-action { flex: none; width: 86px; border: 0; border-radius: var(--vc-radius-lg); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--vc-space-xxs);
    font-size: var(--vc-fs-footnote); color: var(--vc-on-accent); }
.vc-action.is-neutral { background: var(--vc-fill-2); color: var(--vc-ink); }
.vc-action.is-danger { background: var(--vc-danger-fill); }
.vc-row { position: relative; display: flex; align-items: center; gap: var(--vc-space-sm); padding: var(--vc-space-md); border-radius: var(--vc-radius-lg);
    background: var(--vc-card); transition: transform var(--vc-dur-quick) var(--vc-spring); }
.vc-row:active { transform: scale(.98); }
.vc-row:focus-visible { outline: 2px solid var(--vc-accent); }
.vc-row-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: var(--vc-space-xxs); }
.vc-row-top { display: flex; align-items: center; gap: var(--vc-space-xs); }
.vc-row-name { font-size: var(--vc-fs-headline); font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.vc-chip { font-size: var(--vc-fs-footnote); padding: 0 var(--vc-space-xs); border-radius: var(--vc-radius-pill); background: var(--vc-chip); color: var(--vc-ink-2); white-space: nowrap; }
.vc-row-time { margin-left: auto; font-size: var(--vc-fs-footnote); color: var(--vc-ink-2); white-space: nowrap; }
.vc-row-preview { font-size: var(--vc-fs-subhead); color: var(--vc-ink-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.vc-row-preview.is-draft { color: var(--vc-danger); }
.vc-skeleton { height: 84px; background: var(--vc-card); opacity: .6; }
.vc-empty { display: flex; flex-direction: column; align-items: center; gap: var(--vc-space-sm); padding: var(--vc-space-xxl) 0; color: var(--vc-ink-2); }
.vc-text-btn { border: 0; background: none; color: var(--vc-accent-text); font-size: var(--vc-fs-body); min-height: var(--vc-touch); }
</style>
