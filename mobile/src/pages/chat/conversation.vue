<template>
    <view class="vc-conversation">
        <VcAurora />
        <view class="vc-conv-nav">
            <button role="button" tabindex="0" class="vc-round vc-glass" aria-label="返回" @click="back"><VcIcon name="chevron-left" /></button>
            <button role="button" tabindex="0" v-if="!searching" class="vc-identity vc-glass" @click="character"><VcAvatar :avatar="chat.target?.avatar" :name="chat.target?.name" size="var(--vc-avatar-nav)" /><text>{{ chat.target?.name }}</text><VcIcon name="chevron-right" size="var(--vc-icon-sm)" /></button>
            <input v-field-label v-else class="vc-chat-search vc-glass" v-model="query" :placeholder="copy.search" :aria-label="copy.search" focus />
            <button role="button" tabindex="0" class="vc-round vc-glass" :aria-label="searching ? '完成' : copy.search" @click="toggleSearch"><VcIcon :name="searching ? 'x' : 'search'" /></button>
        </view>
        <view v-if="searching" class="vc-search-results"><text>{{ matches.length ? `${matchIndex + 1} / ${matches.length}` : '没有找到' }}</text><button role="button" tabindex="0" class="vc-plain-btn" aria-label="上一条" :disabled="!matches.length" :aria-disabled="!matches.length" @click="jump(-1)">‹</button><button role="button" tabindex="0" class="vc-plain-btn" aria-label="下一条" :disabled="!matches.length" :aria-disabled="!matches.length" @click="jump(1)">›</button></view>
        <view v-if="!chat.ready || chat.error" class="vc-connection vc-glass" role="status">
            <text>{{ status }}</text><button role="button" tabindex="0" v-if="chat.error" class="vc-plain-btn" @click="retry">{{ copy.retry }}</button>
        </view>
        <div class="vc-thread" ref="thread" @scroll="scrolled">
            <view v-if="chat.loading" class="vc-chat-loading" aria-busy="true"><view v-for="n in 3" :key="n" class="vc-history-skeleton"></view></view>
            <template v-for="row in groups" :key="row.key">
                <view v-if="row.type === 'pill'" class="vc-date-row"><text>{{ row.text }}</text></view>
                <ChatMessage v-else :row="row" :avatar="chat.target?.avatar" :ready="chat.ready" :busy="chat.busy" :interrupted="chat.interrupted"
                    :last-user="lastUser" :last-id="lastId" :matches="matches" @menu="menu = $event" @card="openCard" @image="image = $event" @swipe="swipe" @continue="session.generate('continueReply')" />
            </template>
            <view v-if="chat.busy" class="vc-typing" role="status"><VcAvatar :avatar="chat.target?.avatar" :name="chat.target?.name" size="var(--vc-avatar-sm)" /><view class="vc-typing-bubble">··· <text>{{ copy.typing }}</text></view></view>
            <text v-if="chat.interrupted && !chat.busy" class="vc-chat-note">{{ copy.stopped }}</text>
        </div>
        <button role="button" tabindex="0" v-if="!atBottom" class="vc-jump vc-glass" aria-label="回到最新" @click="latest(true)"><VcIcon name="arrow-down" /></button>
        <view class="vc-composer-wrap">
            <view v-if="voice.phase!=='idle' || voice.error" class="vc-recording-note vc-glass" role="status"><text>{{ voice.error || (voice.phase==='transcribing'?'正在听…':voice.phase==='requesting'?'正在连接…':`${voice.seconds}″ · ${voice.cancelled?'松开取消':'松开发送，上滑取消'}`) }}</text><view v-if="voice.phase==='recording'" class="vc-recording-meter" :style="{transform:`scaleX(${voice.level})`}" aria-hidden="true"></view></view>
            <view v-if="chat.quote" class="vc-compose-quote vc-glass"><text>{{ copy.quote }} {{ chat.quote.name }}：{{ summary(chat.quote.text) }}</text><button role="button" tabindex="0" class="vc-round" :aria-label="copy.cancelQuote" @click="chat.quote = null"><VcIcon name="x" size="var(--vc-icon-sm)" /></button></view>
            <view v-if="more" class="vc-composer-more vc-glass"><button role="button" tabindex="0" class="vc-plain-btn" :disabled="!chat.ready || chat.busy" :aria-disabled="!chat.ready || chat.busy" @click="generate('regenerate')">{{ copy.regenerate }}</button><button role="button" tabindex="0" class="vc-plain-btn" :disabled="!chat.ready || chat.busy" :aria-disabled="!chat.ready || chat.busy" @click="generate('continueReply')">{{ copy.continue }}</button></view>
            <view class="vc-composer vc-glass">
                <button role="button" tabindex="0" class="vc-round" aria-label="更多" :aria-expanded="more" @click="more = !more"><VcIcon name="plus" /></button>
                <textarea v-field-label class="vc-chat-input" :value="chat.draft" :disabled="voice.phase!=='idle'" :placeholder="copy.placeholder" :aria-label="copy.placeholder" auto-height :maxlength="-1" :adjust-position="false" @input="session.draft($event.detail.value)" @confirm="send" />
                <button role="button" tabindex="0" v-if="chat.busy" class="vc-round vc-send" :aria-label="copy.stop" @click="session.stop()"><VcIcon name="square" size="var(--vc-icon-sm)" /></button>
                <!-- H5 原生元素保留 PointerEvent；uni-button 的事件规范化不保留 pointerType / 指针捕获。 -->
                <div role="button" tabindex="0" v-else-if="voiceAvailable && !chat.draft?.trim()" class="vc-round vc-microphone" :aria-label="voice.phase==='recording'?'结束录音':'开始录音'" :aria-pressed="voice.phase==='recording'" :aria-disabled="!chat.ready || voice.phase==='transcribing'" title="按住说话" @pointerdown="recordDown" @pointermove="recordMove" @pointerup="recordUp" @pointercancel="recordCancel" @click="recordClick" @keydown.enter.prevent="recordClick" @keydown.space.prevent="recordClick" @keydown.esc="recorder?.cancel()"><VcIcon :name="voice.phase==='recording'?'square':'mic'" /></div>
                <button role="button" tabindex="0" v-else class="vc-round vc-send" :aria-label="copy.send" :disabled="!chat.ready || chat.error === 'save' || !chat.draft.trim()" :aria-disabled="!chat.ready || chat.error === 'save' || !chat.draft.trim()" @click="send"><VcIcon name="arrow-up" /></button>
            </view>
        </view>
        <view v-if="menu" class="vc-menu-scrim" @click.self="menu = null">
            <view class="vc-message-menu vc-glass" role="menu" :aria-label="'消息操作'">
                <button v-for="action in actions" :key="action.id" role="menuitem" :class="{ 'is-danger': action.id === 'remove' }" @click="act(action.id)"><text>{{ action.label }}</text><VcIcon :name="action.icon" size="var(--vc-icon-sm)" /></button>
            </view>
        </view>
        <view v-if="editing" class="vc-menu-scrim" @click.self="editing = null">
            <view class="vc-edit-sheet vc-glass" role="dialog" :aria-label="copy.editTitle"><view class="vc-edit-head"><button role="button" tabindex="0" class="vc-plain-btn" @click="editing = null">{{ copy.cancel }}</button><text>{{ copy.editTitle }}</text><button role="button" tabindex="0" class="vc-plain-btn" :disabled="saving" :aria-disabled="saving" @click="saveEdit">{{ copy.save }}</button></view><textarea v-field-label v-model="editText" :maxlength="-1" :aria-label="copy.editTitle" /></view>
        </view>
        <view v-if="selectedText !== null" class="vc-menu-scrim" @click.self="selectedText = null"><view class="vc-edit-sheet vc-glass" role="dialog"><button role="button" tabindex="0" class="vc-plain-btn" @click="selectedText = null">完成</button><text class="vc-select-text" selectable>{{ selectedText }}</text></view></view>
        <view v-if="image" class="vc-image-viewer" role="dialog" aria-modal="true" aria-label="图片预览" @click="image = ''"> <button role="button" tabindex="0" class="vc-round vc-glass vc-image-close" aria-label="关闭图片" @click.stop="image = ''"><VcIcon name="x" /></button><image :src="image" mode="aspectFit" /></view>
        <VcOverlays />
    </view>
</template>
<script>
import VcAurora from '../../components/VcAurora.vue';
import VcAvatar from '../../components/VcAvatar.vue';
import VcIcon from '../../components/VcIcon.vue';
import VcOverlays from '../../components/VcOverlays.vue';
import ChatMessage from '../../components/ChatMessage.vue';
import { getEngine, getServer, showStView } from '../../engine/index.mjs';
import { createChatSession } from '../../chat/session.mjs';
import { groupMessages, quoteSummary } from '../../chat/format.mjs';
import { setCharacterTheme } from '../../theme/store.mjs';
import { tintOf, avatarUrl } from '../../ui/tint.mjs';
import { COPY } from '../../copy.mjs';
import { createVoiceInput } from '../../voice/input.mjs';
import { confirmAlert, showToast } from '../../ui/feedback.mjs';

export default {
    components: { VcAurora, VcAvatar, VcIcon, ChatMessage, VcOverlays },
    data: () => ({ copy: COPY, chat: {}, session: null, menu: null, more: false, editing: null, editText: '', selectedText: null, saving: false, image: '', atBottom: true, searching: false, query: '', matchIndex: 0,voice:{phase:'idle'},voiceAvailable:false,readAvailable:false,recorder:null }),
    computed: {
        groups() { return groupMessages(this.chat.messages || []); },
        lastId() { return this.chat.messages?.at(-1)?.id ?? -1; },
        lastUser() { return this.chat.messages?.findLast(m=>m.user)?.id ?? -1; },
        matches() { return this.query ? (this.chat.messages || []).filter(m=>m.text.toLocaleLowerCase().includes(this.query.toLocaleLowerCase())).map(m=>m.id) : []; },
        status() { return this.chat.error === 'send' ? COPY.failed : this.chat.error === 'save' ? COPY.saveFailed : this.chat.error === 'reply' ? COPY.error : this.chat.error ? COPY.connectFailed : COPY.connecting; },
        actions() { const a = [{id:'quote',label:COPY.quote,icon:'quote'},{id:'copy',label:COPY.copy,icon:'copy'},{id:'select',label:COPY.selectText,icon:'text-cursor'}]; if(this.readAvailable&&!this.menu?.user&&!this.chat.busy)a.push({id:'read',label:'朗读',icon:'volume-2'});if(!this.chat.busy) a.push({id:'edit',label:COPY.edit,icon:'pencil'}); if(!this.chat.busy && !this.menu?.user && this.menu?.id === this.lastId) a.push({id:'regenerate',label:COPY.regenerate,icon:'refresh-cw'}); return this.chat.busy ? a : [...a,{id:'remove',label:COPY.remove,icon:'trash-2'}]; },
    },
    watch: { query() { this.matchIndex = 0; this.jump(0); } },
    onLoad(options) {
        this.live = true;
        this.session = createChatSession({ state: this.chat, engine: getEngine(), server: getServer(), changed: () => this.latest() });
        const target = { avatar: options.avatar || '', file: options.file || '', name: options.name || '' };
        this.session.open(target).then(async()=>{ if(!this.live) return; const ch=getEngine().character(); const tint=await tintOf(avatarUrl(target.avatar)); if(!this.live) return; setCharacterTheme(ch?.theme, tint); this.latest(true);await this.setupVoice(); });
        this.resize = () => document.documentElement.style.setProperty('--vc-vh', `${window.visualViewport?.height || window.innerHeight}px`);
        window.visualViewport?.addEventListener('resize', this.resize); this.resize();
    },
    onHide() { this.recorder?.cancel();getEngine().stopVoice().catch(()=>{}); },
    onUnload() { this.live=false; this.recorder?.dispose();this.session?.dispose(); setCharacterTheme(); window.visualViewport?.removeEventListener('resize', this.resize); document.documentElement.style.removeProperty('--vc-vh'); },
    methods: {
        async setupVoice(){
            const engine=getEngine(),policy=await engine.voicePolicy();if(!this.live)return;
            this.readAvailable=Boolean(policy?.available)&&policy.relationship.voiceFrequency!=='OFF';
            this.voiceAvailable=Boolean(policy?.engines?.asr?.enabled&&policy.engines.asr.healthy&&navigator.mediaDevices?.getUserMedia&&globalThis.MediaRecorder);
            if(this.voiceAvailable)this.recorder=createVoiceInput({state:this.voice,maxSeconds:policy.settings.maxRecordingSeconds,convert:(...args)=>engine.call('voiceInput','recordingWAV',...args),transcribe:wav=>engine.call('api','transcribeVoice',wav),onText:async(text,metadata)=>{this.session.draft(text);await this.session.send({voiceInput:metadata});this.latest(true);}});
        },
        recordDown(e){if(e.pointerType!=='touch'||!this.chat.ready||this.voice.phase==='transcribing')return;e.preventDefault();this.recordTouch=true;this.recordY=e.clientY;e.currentTarget.setPointerCapture(e.pointerId);void this.recorder.start();},
        recordMove(e){if(this.recordTouch)this.recorder.move(this.recordY-e.clientY>64);},
        recordUp(e){if(!this.recordTouch)return;e.preventDefault();this.recordTouch=false;this.recorder.finish();},
        recordCancel(){this.recordTouch=false;this.recorder.cancel();},
        recordClick(e){if(e.pointerType==='touch'||!this.chat.ready||this.voice.phase==='transcribing')return;if(this.voice.phase==='recording')this.recorder.finish();else void this.recorder.start();},
        summary: quoteSummary,
        toggleSearch() { this.searching=!this.searching; if(!this.searching) this.query=''; },
        back() { uni.navigateBack({ fail: () => uni.reLaunch({ url: '/pages/main/index' }) }); },
        character() { uni.navigateTo({ url: `/pages/character/detail?avatar=${encodeURIComponent(this.chat.target.avatar)}` }); },
        scrolled(e) { const el=e.target; this.atBottom=el.scrollHeight - el.scrollTop - el.clientHeight < 100; },
        latest(force=false) { this.$nextTick(()=>{ if(!force && !this.atBottom) return; const el=this.$refs.thread?.$el || this.$refs.thread; if(el) { el.scrollTop=el.scrollHeight; this.atBottom=true; } }); },
        async send() { this.more=false; await this.session.send(); this.latest(true); },
        retry() { if(this.chat.error==='save') showStView(true); else if(this.chat.error==='send') this.send(); else if(this.chat.error==='reply') this.session.generate(); else this.session.open(this.chat.target); },
        generate(kind) { this.more=false; this.session.generate(kind); },
        openCard(id) { showStView(true,{messageId:id}); },
        async swipe(dir) { try { getEngine().swipe(dir); this.session.sync(); } catch { showToast(COPY.error,{error:true}); } },
        jump(delta) { if(!this.matches.length) return; this.matchIndex=(this.matchIndex+delta+this.matches.length)%this.matches.length; this.$nextTick(()=>document.getElementById(`message-${this.matches[this.matchIndex]}`)?.scrollIntoView({block:'center'})); },
        async act(id) {
            const m=this.menu; this.menu=null;
            if(id==='quote') this.chat.quote={name:m.name,text:m.text};
            else if(id==='select') this.selectedText=m.text;
            else if(id==='copy') { try { await navigator.clipboard.writeText(m.text); showToast(COPY.copied); } catch { this.selectedText=m.text; } }
            else if(id==='edit') { this.editing=m; this.editText=m.text; }
            else if(id==='read') { try {await getEngine().readAloud(m.id);} catch {showToast(COPY.error,{error:true});} }
            else if(id==='regenerate') this.generate('regenerate');
            else if(id==='remove' && await confirmAlert({title:COPY.deleteMessageTitle,message:COPY.deleteBody,action:COPY.remove})) {
                try { await getEngine().remove(m.id); this.session.sync(); showToast(COPY.deleted); } catch { showToast(COPY.error,{error:true}); }
            }
        },
        async saveEdit() { if(this.saving) return; this.saving=true; try { await getEngine().edit(this.editing.id,this.editText); this.editing=null; this.session.sync(); } catch { showToast(COPY.error,{error:true}); } finally { this.saving=false; } },
    },
};
</script>
<style>
.vc-microphone { touch-action: none; user-select: none; }
.vc-recording-note { padding: var(--vc-space-xs) var(--vc-space-md); border-radius: var(--vc-radius-pill); font-size: var(--vc-fs-footnote); margin-bottom: var(--vc-space-xs); text-align: center; }
.vc-recording-meter { height: 3px; background: var(--vc-accent); transform-origin: center; margin-top: var(--vc-space-xxs); border-radius: var(--vc-radius-pill); }
.vc-conversation { position: fixed; inset: 0; height: var(--vc-vh, 100dvh); display: flex; flex-direction: column; color: var(--vc-ink); }
.vc-conv-nav { flex: none; display: flex; align-items: center; justify-content: space-between; gap: var(--vc-space-xs); padding: calc(env(safe-area-inset-top) + var(--vc-space-xs)) var(--vc-space-md) var(--vc-space-xs); position: relative; z-index: var(--vc-z-content); }
.vc-identity { min-width: 0; max-width: 70%; display: flex; gap: var(--vc-space-xs); align-items: center; border: 0; border-radius: var(--vc-radius-pill); min-height: var(--vc-touch); color: var(--vc-ink); font-size: var(--vc-fs-headline); font-weight: 600; }
.vc-identity text { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.vc-chat-search { flex: 1; min-width: 0; border-radius: var(--vc-radius-pill); padding: var(--vc-space-xs); font-size: var(--vc-fs-body); }
.vc-connection { position: relative; z-index: var(--vc-z-content); align-self: center; display: flex; align-items: center; gap: var(--vc-space-xs); border-radius: var(--vc-radius-pill); padding: var(--vc-space-xxs) var(--vc-space-sm); font-size: var(--vc-fs-footnote); }
.vc-thread { align-self: center; width: 100%; max-width: var(--vc-reading-max); box-sizing: border-box; position: relative; z-index: var(--vc-z-content); flex: 1; min-height: 0; overflow: auto; overscroll-behavior: contain; padding: 0 var(--vc-space-md) var(--vc-space-sm); }
.vc-date-row { text-align: center; margin: var(--vc-space-lg) 0 var(--vc-space-sm); font-size: var(--vc-fs-footnote); color: var(--vc-ink-2); }
.vc-date-row text { background: var(--vc-chip); padding: var(--vc-space-xxs) var(--vc-space-sm); border-radius: var(--vc-radius-pill); }
.vc-typing { display: flex; align-items: flex-end; gap: var(--vc-space-xs); margin-top: var(--vc-space-sm); }
.vc-typing-bubble { background: var(--vc-bubble-char); padding: var(--vc-space-xs) var(--vc-space-sm); border-radius: var(--vc-radius-bubble); color: var(--vc-ink-2); }
.vc-typing-bubble text { font-size: var(--vc-fs-footnote); }
.vc-chat-note { display: block; text-align: center; color: var(--vc-ink-2); font-size: var(--vc-fs-footnote); }
.vc-composer-wrap { position: relative; z-index: var(--vc-z-content); margin: 0 var(--vc-space-md) calc(var(--vc-space-xs) + env(safe-area-inset-bottom)); }
.vc-composer { display: flex; align-items: flex-end; padding: var(--vc-space-xxs); gap: var(--vc-space-xxs); border-radius: var(--vc-radius-sheet); }
.vc-chat-input { flex: 1; min-width: 0; min-height: var(--vc-touch); max-height: var(--vc-composer-max); box-sizing: border-box; padding: var(--vc-space-xs) 0; font-size: var(--vc-fs-body); line-height: var(--vc-lh-bubble); color: var(--vc-ink); }
.vc-send { background: var(--vc-accent); color: var(--vc-on-accent); }
.vc-compose-quote { display: flex; align-items: center; justify-content: space-between; padding-left: var(--vc-space-sm); border-radius: var(--vc-radius-md); margin-bottom: var(--vc-space-xxs); font-size: var(--vc-fs-footnote); }
.vc-compose-quote > text { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.vc-composer-more, .vc-search-results { display: flex; align-items: center; justify-content: center; gap: var(--vc-space-sm); position: relative; z-index: var(--vc-z-content); }
.vc-composer-more { border-radius: var(--vc-radius-md); margin-bottom: var(--vc-space-xs); }
.vc-search-results { font-size: var(--vc-fs-footnote); }
.vc-jump { color: var(--vc-ink); position: absolute; right: var(--vc-space-md); bottom: calc(var(--vc-touch) + var(--vc-space-xxl) + env(safe-area-inset-bottom)); z-index: var(--vc-z-content); width: var(--vc-touch); height: var(--vc-touch); display: flex; align-items: center; justify-content: center; border-radius: var(--vc-radius-pill); }
.vc-menu-scrim { position: fixed; inset: 0; z-index: var(--vc-z-menu); background: var(--vc-scrim); backdrop-filter: blur(var(--vc-space-xxs)); display: flex; align-items: center; justify-content: center; }
.vc-message-menu { min-width: 220px; max-width: calc(100vw - var(--vc-space-xxl)); padding: var(--vc-space-xs); border-radius: var(--vc-radius-md); }
.vc-message-menu button { display: flex; justify-content: space-between; align-items: center; width: 100%; min-height: var(--vc-touch); background: none; border: 0; color: var(--vc-ink); font-size: var(--vc-fs-body); }
.vc-message-menu .is-danger { color: var(--vc-danger); }
.vc-edit-sheet { background: var(--vc-sheet); width: calc(100vw - var(--vc-space-xxl)); max-width: 560px; padding: var(--vc-space-md); border-radius: var(--vc-radius-sheet); }
.vc-edit-head { display: flex; justify-content: space-between; align-items: center; font-size: var(--vc-fs-headline); font-weight: 600; }
.vc-edit-sheet textarea { width: 100%; min-height: 160px; font-size: var(--vc-fs-body); color: var(--vc-ink); }
.vc-select-text { display: block; user-select: text; white-space: pre-wrap; max-height: 60vh; overflow: auto; }
.vc-image-viewer { position: fixed; inset: 0; z-index: var(--vc-z-alert); background: var(--vc-canvas); display: flex; align-items: center; justify-content: center; }
.vc-image-close { position: absolute; right: var(--vc-space-md); top: var(--vc-space-md); z-index: var(--vc-z-content); }
.vc-image-viewer image { width: 100%; height: 100%; }
.vc-history-skeleton { width: 60%; height: var(--vc-touch); margin: var(--vc-space-md) 0; background: var(--vc-card); border-radius: var(--vc-radius-md); }
</style>
