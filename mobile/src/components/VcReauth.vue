<template>
    <view v-if="state.reauth" class="vc-scrim">
        <view class="vc-alert vc-glass" role="dialog" aria-modal="true" aria-label="重新验证身份" @keydown.esc="cancel" @keydown.tab.prevent="focusNext">
            <text class="vc-alert-title">重新验证身份</text><text class="vc-alert-message">保存前，请验证当前账号的密码。</text>
            <input v-field-label class="vc-password" v-model="password" type="password" password aria-label="密码" :focus="true" @confirm="submit" />
            <text v-if="state.error" class="vc-error" role="alert">{{ state.error }}</text>
            <view class="vc-alert-actions"><button role="button" tabindex="0" class="vc-alert-btn" :disabled="state.busy" @click="cancel">取消</button><button role="button" tabindex="0" class="vc-alert-btn" :disabled="state.busy" @click="submit">{{ state.busy ? '正在验证…' : '验证并继续' }}</button></view>
        </view>
    </view>
</template>
<script>
import {writeState,verifyAction,cancelVerify} from '../ui/actions.mjs';
export default {
 data:()=>({state:writeState,password:''}),
 watch:{'state.reauth'(value){this.password='';if(value){this.opener=document.activeElement;this.$nextTick(()=>{const input=this.$el.querySelector('input');if(input?.getClientRects().length)input.focus();});}else if(this.opener?.getClientRects?.().length)this.opener.focus();}},
 methods:{
  async submit(){const p=this.password;this.password='';await verifyAction(p);},
  cancel(){if(this.state.busy)return;this.password='';cancelVerify();},
  focusNext(e){const fields=[...this.$el.querySelectorAll('input,[role="button"]')].filter(el=>!el.hasAttribute('disabled'));const i=fields.indexOf(document.activeElement);fields[(i+(e.shiftKey?-1:1)+fields.length)%fields.length]?.focus();},
 },
};
</script>
<style>
.vc-password { background: var(--vc-fill); min-height: var(--vc-touch); padding: 0 var(--vc-space-sm); border-radius: var(--vc-radius-sm); color: var(--vc-ink); font-size: var(--vc-fs-body); }
</style>
