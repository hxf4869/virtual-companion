import {INCOMING_COPY} from '../copy.mjs';

// Deadline comes from the persisted inbox. No microphone or system notification before an explicit answer.
export function createIncomingCalls({state,list,respond,canRing=()=>true,now=Date.now,uuid=()=>crypto.randomUUID(),interval=5000}) {
 Object.assign(state,{event:null,events:[],busy:false,error:''});let alive=true,running=false,generation=0,timer,expiry,polling=false,request=null;const handled=new Set();
 const ringing=e=>e?.call?.state==='RINGING'&&e.stDelivered===true&&e.linkStatus==='present'&&Date.parse(e.call.expiresAt)>now();
 const api={
  async poll(){
   if(!alive||polling)return;polling=true;const token=generation;
   if(state.event&&(!ringing(state.event)||!canRing()))state.event=null;
   try {const rows=await list();if(!alive||token!==generation)return;state.events=rows;for(const id of handled)if(!rows.some(e=>e.eventId===id&&ringing(e)))handled.delete(id);
    if(!state.busy){state.event=canRing()?rows.find(e=>ringing(e)&&!handled.has(e.eventId))||null:null;clearTimeout(expiry);const event=state.event;if(event)expiry=setTimeout(()=>{if(state.event?.eventId===event.eventId)state.event=null;},Math.max(0,Date.parse(event.call.expiresAt)-now()));}
   }catch{/* Poll failures do not repeat or discard an explicit response. */}finally{polling=false;}
  },
  async reply(action){
   const event=state.event;if(!alive||state.busy||!ringing(event)){state.event=null;state.error=INCOMING_COPY.handled;return null;}
   if(!request||request.eventId!==event.eventId||request.action!==action)request={eventId:event.eventId,action,requestId:uuid()};
   state.busy=true;state.error='';const token=generation;
   try {const saved=await respond(event.eventId,action,request.requestId);if(!alive||token!==generation)return null;handled.add(event.eventId);state.events=state.events.map(e=>e.eventId===event.eventId?saved.event:e);state.event=null;request=null;if(!saved.applied){state.error=INCOMING_COPY.handled;return null;}return saved.event;
   }catch{if(alive&&token===generation)state.error=INCOMING_COPY.failed;return null;}finally{state.busy=false;}
  },
  start(){if(running)return;alive=true;running=true;const token=generation;const tick=async()=>{await api.poll();if(alive&&generation===token)timer=setTimeout(tick,interval);};void tick();},
  stop(){alive=false;running=false;generation++;clearTimeout(timer);clearTimeout(expiry);timer=null;state.event=null;},
 };
 return api;
}

let pendingCall=null;
export function prepareIncomingCall(event){pendingCall=event;}
export function takeIncomingCall(eventId){const event=pendingCall;pendingCall=null;return event?.eventId===eventId?event:null;}
