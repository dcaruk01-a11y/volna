'use strict';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const NOTES=['C','C♯','D','E♭','E','F','F♯','G','A♭','A','B♭','B'];
const PRESETS={
  tape:{name:'WARM TAPE',num:'01',type:'sawtooth',second:'triangle',attack:.055,decay:.8,sustain:.58,release:.9,detune:5,cutoff:2600},
  keys:{name:'SOFT KEYS',num:'02',type:'sine',second:'triangle',attack:.012,decay:1.5,sustain:.2,release:.65,detune:2,cutoff:4200},
  cloud:{name:'CLOUD PAD',num:'03',type:'triangle',second:'sine',attack:.18,decay:.8,sustain:.72,release:1.35,detune:8,cutoff:1900},
  bell:{name:'MOON BELL',num:'04',type:'sine',second:'sine',attack:.008,decay:1.8,sustain:.13,release:1,detune:0,cutoff:6500}
};
let saved={};try{saved=JSON.parse(localStorage.getItem('volna-settings')||'{}')||{};}catch{}
const setting=(name,def,a,b)=>Number.isFinite(saved[name])?clamp(saved[name],a,b):def;
const state={voice:PRESETS[saved.voice]?saved.voice:'tape',theme:['mint','sand','lilac','ink'].includes(saved.theme)?saved.theme:'mint',root:Math.round(setting('root',0,0,11)),scale:saved.scale==='minor'?'minor':'major',volume:setting('volume',65,0,100),reverb:setting('reverb',40,0,100),tempo:Math.round(setting('tempo',84,40,200)),tail:setting('tail',1.8,.2,4),echo:saved.echo!==false,echoAmount:setting('echoAmount',28,0,70),sensitivity:setting('sensitivity',160,50,250),joyMode:['color','echo','motion'].includes(saved.joyMode)?saved.joyMode:'color',octave:0,hold:false,arp:false,haptics:saved.haptics!==false};
function saveSettings(){try{localStorage.setItem('volna-settings',JSON.stringify(state));}catch{}}
let toastTimer;function toast(message){$('#toast').textContent=message;$('#toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),4500);}
function setPressed(el,value){el.setAttribute('aria-pressed',String(value));}
function chord(index){const scale=state.scale==='major'?[0,2,4,5,7,9,11]:[0,2,3,5,7,8,10];const intervals=[0,2,4,6].map(step=>{const n=index+step;return scale[n%7]+12*Math.floor(n/7)-scale[index];});const root=(state.root+scale[index])%12;const quality=intervals[1]===3?(intervals[2]===6?'m7♭5':'m7'):(intervals[3]===11?'maj7':'7');return{root,quality,intervals,midi:48+state.root+scale[index]+state.octave*12,roman:['I','II','III','IV','V','VI','VII'][index]};}
function renderPads(){const host=$('#pads');host.replaceChildren();for(let i=0;i<7;i++){const c=chord(i),el=document.createElement('button');el.type='button';el.className='pad';el.dataset.index=i;el.setAttribute('aria-label',`${NOTES[c.root]} ${c.quality}, аккорд ${i+1}`);setPressed(el,false);el.innerHTML=`<span class="degree">${c.roman}</span><span class="pad-root">${NOTES[c.root]}</span><span class="quality">${c.quality}</span><span class="key-hint">${'ASDFGHJ'[i]}</span>`;host.append(el);}showChord(0);}
function showChord(i){const c=chord(i);$('#chord-root').textContent=NOTES[c.root];$('#chord-quality').textContent=c.quality;$('#display-notes').textContent=c.intervals.map(n=>NOTES[(c.root+n)%12]).join(' · ');}

class Synth{
  constructor(){this.ctx=null;this.voices=new Set();}
  async ensure(){
    if(!this.ctx){
      const AC=window.AudioContext||window.webkitAudioContext;if(!AC)throw new Error('Открой Волну в Safari или Chrome — здесь нет поддержки звука.');
      this.ctx=new AC({latencyHint:'interactive'});const c=this.ctx;
      this.bus=c.createGain();this.filter=c.createBiquadFilter();this.filter.type='lowpass';this.filter.frequency.value=PRESETS[state.voice].cutoff;this.filter.Q.value=.65;
      this.dry=c.createGain();this.dry.gain.value=.82;this.wet=c.createGain();this.wet.gain.value=state.reverb/100*.85;
      this.reverb=c.createConvolver();const length=Math.floor(c.sampleRate*2.8),impulse=c.createBuffer(2,length,c.sampleRate);for(let ch=0;ch<2;ch++){const d=impulse.getChannelData(ch);for(let i=0;i<length;i++)d[i]=(Math.random()*2-1)*Math.pow(1-i/length,2.6)*.7;}this.reverb.buffer=impulse;
      this.delay=c.createDelay(1.6);this.delay.delayTime.value=this.beatDelay();this.feedback=c.createGain();this.feedback.gain.value=.34;this.echoTone=c.createBiquadFilter();this.echoTone.type='lowpass';this.echoTone.frequency.value=3400;this.echoWet=c.createGain();this.echoWet.gain.value=state.echo?state.echoAmount/100:0;this.echoSend=c.createGain();this.echoSend.gain.value=state.echo?1:0;
      this.tremolo=c.createGain();this.tremolo.gain.value=1;this.lfo=c.createOscillator();this.lfo.frequency.value=state.tempo/30;this.lfoAmount=c.createGain();this.lfoAmount.gain.value=0;this.lfo.connect(this.lfoAmount);this.lfoAmount.connect(this.tremolo.gain);this.lfo.start();
      this.master=c.createGain();this.master.gain.value=this.volumeGain();this.compressor=c.createDynamicsCompressor();this.compressor.threshold.value=-16;this.compressor.knee.value=18;this.compressor.ratio.value=5;this.compressor.attack.value=.008;this.compressor.release.value=.2;
      this.analyser=c.createAnalyser();this.analyser.fftSize=1024;this.recordDest=c.createMediaStreamDestination();
      this.bus.connect(this.filter);this.filter.connect(this.dry);this.dry.connect(this.tremolo);this.tremolo.connect(this.master);this.filter.connect(this.reverb);this.reverb.connect(this.wet);this.wet.connect(this.master);
      this.filter.connect(this.echoSend);this.echoSend.connect(this.delay);this.delay.connect(this.echoTone);this.echoTone.connect(this.feedback);this.feedback.connect(this.delay);this.echoTone.connect(this.echoWet);this.echoWet.connect(this.master);
      this.master.connect(this.compressor);this.compressor.connect(this.analyser);this.analyser.connect(c.destination);this.compressor.connect(this.recordDest);
    }
    if(this.ctx.state==='suspended'||this.ctx.state==='interrupted')await this.ctx.resume();return this;
  }
  volumeGain(){return .55*Math.pow(state.volume/100,1.5);}
  beatDelay(){return clamp(60/state.tempo*.75,.12,1.4);}
  target(param,value,time=.055){if(this.ctx)param.setTargetAtTime(value,this.ctx.currentTime,time);}
  setVolume(){if(this.ctx)this.target(this.master.gain,this.volumeGain());}
  setSpace(amount){if(this.ctx)this.target(this.wet.gain,clamp(amount,0,1)*.85,.12);}
  setTone(value,q=.65){if(this.ctx){this.target(this.filter.frequency,clamp(value,70,Math.min(18000,this.ctx.sampleRate*.45)));this.target(this.filter.Q,q);}}
  setEcho(amount=state.echoAmount/100,feedback=.34,delay=this.beatDelay()){if(this.ctx){this.target(this.echoSend.gain,state.echo?1:0);this.target(this.echoWet.gain,state.echo?clamp(amount,0,.75):0);this.target(this.feedback.gain,clamp(feedback,0,.6));this.target(this.delay.delayTime,clamp(delay,.06,1.4),.12);}}
  setMotion(depth=0){if(this.ctx){depth=clamp(depth,0,.75);this.target(this.tremolo.gain,1-depth/2);this.target(this.lfoAmount.gain,depth/2);}}
  setTempo(){if(this.ctx){this.target(this.lfo.frequency,state.tempo/30);this.setEcho();}}
  note(midi){
    if(this.voices.size>=40){const oldest=[...this.voices].find(v=>v.ended)||this.voices.values().next().value;this.stop(oldest,true);this.voices.delete(oldest);}
    const p=PRESETS[state.voice],c=this.ctx,t=c.currentTime,freq=440*Math.pow(2,(midi-69)/12),env=c.createGain(),oscs=[];
    env.gain.setValueAtTime(.0001,t);env.gain.exponentialRampToValueAtTime(.135,t+p.attack);env.gain.exponentialRampToValueAtTime(Math.max(.0001,.135*p.sustain),t+p.attack+p.decay);env.connect(this.bus);
    const mix=c.createGain();mix.gain.value=.5;mix.connect(env);
    for(let i=0;i<2;i++){const o=c.createOscillator();o.type=i?p.second:p.type;o.frequency.value=freq*(state.voice==='bell'&&i?2.003:1);o.detune.value=i?p.detune:-p.detune;o.connect(mix);o.start(t);oscs.push(o);}
    const voice={env,oscs,mix,release:p.release,ended:false,cleanup:null};this.voices.add(voice);return voice;
  }
  stop(voice,fast=false){if(!voice||(voice.ended&&!fast))return;voice.ended=true;const c=this.ctx,t=c.currentTime,duration=fast?.035:clamp(state.tail*voice.release,.16,5.4);const gain=voice.env.gain;if(gain.cancelAndHoldAtTime)gain.cancelAndHoldAtTime(t);else{const current=gain.value;gain.cancelScheduledValues(t);gain.setValueAtTime(Math.max(.0001,current),t);}gain.exponentialRampToValueAtTime(.0001,t+duration);for(const o of voice.oscs){try{o.stop(t+duration+.025);}catch{}}clearTimeout(voice.cleanup);voice.cleanup=setTimeout(()=>{voice.oscs.forEach(o=>o.disconnect());voice.mix.disconnect();voice.env.disconnect();this.voices.delete(voice);},(duration+.06)*1000);}
  panic(){if(!this.ctx)return;for(const v of this.voices)this.stop(v,true);this.target(this.feedback.gain,0,.01);this.target(this.echoSend.gain,0,.01);this.target(this.echoWet.gain,0,.01);this.target(this.wet.gain,0,.01);clearTimeout(this.restoreTimer);this.restoreTimer=setTimeout(()=>applyJoy(joyX,joyY),90);}
  countTick(last){if(!this.ctx||state.volume===0)return;const c=this.ctx,t=c.currentTime,o=c.createOscillator(),g=c.createGain();o.frequency.value=last?880:560;g.gain.setValueAtTime(.04*state.volume/100,t);g.gain.exponentialRampToValueAtTime(.0001,t+.07);o.connect(g);g.connect(c.destination);o.start(t);o.stop(t+.08);o.onended=()=>{o.disconnect();g.disconnect();};}
}
const synth=new Synth();
const active=new Map(),sources=new Map(),pointers=new Map();let pendingToken=0;
function updateActivity(){const playing=active.size>0;$('.power').classList.toggle('playing',playing);$('#power-label').textContent=playing?'PLAYING':'READY';$('#display-mode').textContent=state.arp?'ARPEGGIO':state.hold?'HOLD MODE':'CHORD MODE';}
function lightPad(i,on){const p=$(`.pad[data-index="${i}"]`);if(p){p.classList.toggle('pressed',on);setPressed(p,on);}}
async function startChord(i,source){
  sources.set(source,i);if(state.hold&&active.has(i)){stopChord(i);sources.delete(source);return;}if(active.has(i))return;
  const g={id:++pendingToken,voices:[],timer:null,step:0};active.set(i,g);lightPad(i,true);showChord(i);updateActivity();if(state.haptics&&navigator.vibrate)navigator.vibrate(6);
  try{await synth.ensure();if(active.get(i)!==g)return;const c=chord(i);
    if(state.arp){const tick=()=>{if(active.get(i)!==g)return;g.voices.forEach(v=>synth.stop(v));g.voices=[synth.note(c.midi+c.intervals[g.step++%4])];};tick();g.timer=setInterval(tick,60000/state.tempo/2);}
    else g.voices=c.intervals.map(n=>synth.note(c.midi+n));
    $('#play-hint').textContent='Проводи пальцем. Лови свою волну.';
  }catch(e){stopChord(i);toast(e.message||'Не получилось включить звук. Попробуй ещё раз.');}
}
function stopChord(i,fast=false){const g=active.get(i);if(!g)return;clearInterval(g.timer);g.voices.forEach(v=>synth.stop(v,fast));active.delete(i);lightPad(i,false);updateActivity();}
function endSource(source,force=false){const i=sources.get(source);sources.delete(source);if(i===undefined||(state.hold&&!force))return;if(![...sources.values()].includes(i))stopChord(i);}
function stopAll(fast=false){for(const i of [...active.keys()])stopChord(i,fast);sources.clear();pointers.clear();if(fast)synth.panic();}
function padAt(x,y){const host=$('#pads'),r=host.getBoundingClientRect();if(x<r.left||x>r.right||y<r.top-2||y>r.bottom+7)return null;const el=document.elementFromPoint(x,y)?.closest('.pad');if(el&&host.contains(el))return +el.dataset.index;return clamp(Math.floor((x-r.left)/r.width*7),0,6);}
function releasePointer(id,cancel=false){const source='p'+id;if(pointers.has(id)){pointers.delete(id);endSource(source,cancel);}}
$('#pads').addEventListener('pointerdown',e=>{if(e.button>0)return;const i=padAt(e.clientX,e.clientY);if(i===null)return;e.preventDefault();window.getSelection()?.removeAllRanges();pointers.set(e.pointerId,i);$('#pads').setPointerCapture(e.pointerId);startChord(i,'p'+e.pointerId);});
$('#pads').addEventListener('pointermove',e=>{if(!pointers.has(e.pointerId))return;e.preventDefault();if(e.pointerType==='mouse'&&e.buttons===0){releasePointer(e.pointerId,true);return;}const next=padAt(e.clientX,e.clientY),old=pointers.get(e.pointerId);if(next===old)return;endSource('p'+e.pointerId,true);pointers.set(e.pointerId,next);if(next!==null)startChord(next,'p'+e.pointerId);});
window.addEventListener('pointerup',e=>releasePointer(e.pointerId));
window.addEventListener('pointercancel',e=>releasePointer(e.pointerId,true));
$('#pads').addEventListener('lostpointercapture',e=>releasePointer(e.pointerId,true));
$('#pads').addEventListener('click',e=>{if(e.detail!==0)return;const p=e.target.closest('.pad');if(!p)return;const source='assist'+p.dataset.index;startChord(+p.dataset.index,source);setTimeout(()=>endSource(source),450);});
document.addEventListener('contextmenu',e=>{if(e.target instanceof Element&&e.target.closest('.instrument,.site-header,.preset-bar'))e.preventDefault();});
document.addEventListener('selectstart',e=>{if(e.target instanceof Element&&e.target.closest('.app,.portrait-tip')&&!e.target.closest('input,textarea'))e.preventDefault();});
function toggleHold(){state.hold=!state.hold;setPressed($('#hold'),state.hold);if(!state.hold)stopAll();updateActivity();toast(state.hold?'HOLD: аккорд остаётся. Повторное нажатие отпускает его.':'Удержание выключено. Шлейф мягко затихнет.');}
$('#hold').onclick=toggleHold;
$('#arp').onclick=()=>{stopAll();state.arp=!state.arp;setPressed($('#arp'),state.arp);updateActivity();toast(state.arp?'ARP: удерживай клавишу — ноты звучат по очереди.':'Режим аккордов');};
function setVoice(voice){stopAll();state.voice=voice;$$('[data-voice]').forEach(el=>{const yes=el.dataset.voice===voice;el.classList.toggle('active',yes);setPressed(el,yes);});$('#display-voice').textContent=PRESETS[voice].num+' / '+PRESETS[voice].name;applyJoy(0,0);saveSettings();}
$$('[data-voice]').forEach(b=>b.onclick=()=>setVoice(b.dataset.voice));
$('#volume').value=state.volume;$('#volume-value').textContent=state.volume;$('#volume').oninput=e=>{state.volume=+e.target.value;$('#volume-value').textContent=state.volume;synth.setVolume();saveSettings();};
function setOctave(value){stopAll();state.octave=clamp(value,-2,2);$('#octave-value').textContent=state.octave>0?'+'+state.octave:state.octave;$('#octave-down').disabled=state.octave===-2;$('#octave-up').disabled=state.octave===2;}
$('#octave-down').onclick=()=>setOctave(state.octave-1);$('#octave-up').onclick=()=>setOctave(state.octave+1);
$('#root-key').selectedIndex=state.root;$('#root-key').onchange=e=>{stopAll();state.root=e.target.selectedIndex;renderPads();saveSettings();};
$('#scale').value=state.scale;$('#scale').onchange=e=>{stopAll();state.scale=e.target.value;renderPads();saveSettings();};
function setTempo(value){state.tempo=clamp(Math.round(value),40,200);$('#tempo').textContent=state.tempo;$('#tempo').setAttribute('aria-valuenow',state.tempo);synth.setTempo();if(state.arp)for(const [i,g]of active){clearInterval(g.timer);const c=chord(i);g.timer=setInterval(()=>{g.voices.forEach(v=>synth.stop(v));g.voices=[synth.note(c.midi+c.intervals[g.step++%4])];},60000/state.tempo/2);}saveSettings();}
let tempoDrag=null;
$('#tempo').addEventListener('pointerdown',e=>{if(e.button>0)return;e.preventDefault();tempoDrag={id:e.pointerId,x:e.clientX,y:e.clientY,value:state.tempo};e.currentTarget.setPointerCapture(e.pointerId);e.currentTarget.classList.add('dragging');});
$('#tempo').addEventListener('pointermove',e=>{if(!tempoDrag||e.pointerId!==tempoDrag.id)return;const dx=e.clientX-tempoDrag.x,dy=tempoDrag.y-e.clientY;setTempo(tempoDrag.value+(Math.abs(dx)>Math.abs(dy)?dx:dy)*.5);});
function endTempo(){tempoDrag=null;$('#tempo').classList.remove('dragging');}
$('#tempo').addEventListener('pointerup',endTempo);$('#tempo').addEventListener('pointercancel',endTempo);$('#tempo').addEventListener('lostpointercapture',endTempo);
$('#tempo').onkeydown=e=>{let n=state.tempo;if(['ArrowUp','ArrowRight'].includes(e.key))n++;else if(['ArrowDown','ArrowLeft'].includes(e.key))n--;else if(e.key==='PageUp')n+=10;else if(e.key==='PageDown')n-=10;else if(e.key==='Home')n=40;else if(e.key==='End')n=200;else return;e.preventDefault();setTempo(n);};
$('#tempo-down').onclick=()=>setTempo(state.tempo-1);$('#tempo-up').onclick=()=>setTempo(state.tempo+1);
function bindRange(id,output,key,format){const el=$(id);el.value=state[key];$(output).textContent=format(state[key]);el.oninput=()=>{state[key]=+el.value;$(output).textContent=format(state[key]);applyJoy(joyX,joyY);saveSettings();};}
bindRange('#reverb','#reverb-value','reverb',n=>n+'%');bindRange('#tail','#tail-value','tail',n=>n.toFixed(1)+' с');bindRange('#echo-amount','#echo-value','echoAmount',n=>n+'%');bindRange('#joy-sensitivity','#sensitivity-value','sensitivity',n=>n+'%');
function toggleEcho(){state.echo=!state.echo;setPressed($('#echo'),state.echo);$('#echo-enabled').checked=state.echo;applyJoy(joyX,joyY);saveSettings();}
$('#echo').onclick=toggleEcho;$('#echo-enabled').checked=state.echo;$('#echo-enabled').onchange=toggleEcho;
$('#haptics').checked=state.haptics;$('#haptics').onchange=e=>{state.haptics=e.target.checked;saveSettings();};
function setTheme(theme){state.theme=theme;document.documentElement.dataset.theme=theme;$$('.theme-choice').forEach(b=>b.classList.toggle('selected',b.dataset.theme===theme));saveSettings();}
$$('.theme-choice').forEach(b=>b.onclick=()=>setTheme(b.dataset.theme));

let joyPointer=null,joyX=0,joyY=0;
const response=n=>clamp(Math.sign(n)*Math.pow(Math.abs(n),.75)*state.sensitivity/100,-1,1);
function applyJoy(x,y){joyX=clamp(x,-1,1);joyY=clamp(y,-1,1);const radius=$('#joystick').clientWidth*.23,len=Math.max(1,Math.hypot(joyX,joyY));$('#joystick-knob').style.transform=`translate(${joyX/len*radius}px,${joyY/len*radius}px)`;const a=response(joyX),b=response(-joyY);$('#joystick').setAttribute('aria-valuenow',Math.round(a*100));$('#joystick').setAttribute('aria-valuetext',`Горизонталь ${Math.round(a*100)}, вертикаль ${Math.round(b*100)}`);
  synth.setTone(PRESETS[state.voice].cutoff*Math.pow(2,a*4));synth.setSpace(clamp(state.reverb/100+b*.75,0,1));synth.setEcho();synth.setMotion();
  if(state.joyMode==='echo'){synth.setTone(PRESETS[state.voice].cutoff);synth.setEcho(clamp(state.echoAmount/100+Math.max(0,b)*.4,0,.72),clamp(.34+b*.24,.06,.58),synth.beatDelay()*Math.pow(2,a*1.2));}
  if(state.joyMode==='motion'){synth.setTone(PRESETS[state.voice].cutoff*Math.pow(2,a*4),.7+Math.abs(a)*4);synth.setMotion(Math.abs(b)*.7);synth.setSpace(state.reverb/100);}
  const labels={color:['ЯРКОСТЬ','ПРОСТРАНСТВО'],echo:['ВРЕМЯ ЭХА','ПОВТОРЫ'],motion:['ФИЛЬТР','ПУЛЬСАЦИЯ']};$('#joy-readout').textContent=labels[state.joyMode].join(' / ');$('#joy-horizontal').textContent=labels[state.joyMode][0];$('#joy-vertical').textContent=labels[state.joyMode][1];
}
$('#joy-mode').value=state.joyMode;$('#joy-mode').onchange=e=>{state.joyMode=e.target.value;applyJoy(0,0);saveSettings();};
function moveJoy(e){const r=$('#joystick').getBoundingClientRect(),radius=r.width*.3;applyJoy((e.clientX-r.left-r.width/2)/radius,(e.clientY-r.top-r.height/2)/radius);}
$('#joystick').addEventListener('pointerdown',e=>{if(e.button>0||joyPointer!==null)return;e.preventDefault();joyPointer=e.pointerId;e.currentTarget.setPointerCapture(e.pointerId);moveJoy(e);synth.ensure().then(()=>applyJoy(joyX,joyY)).catch(e=>toast(e.message));});
$('#joystick').addEventListener('pointermove',e=>{if(e.pointerId===joyPointer){e.preventDefault();moveJoy(e);}});
function resetJoy(){joyPointer=null;$('#joystick-knob').style.transition='transform .18s';applyJoy(0,0);setTimeout(()=>$('#joystick-knob').style.transition='',200);}
$('#joystick').addEventListener('pointerup',resetJoy);$('#joystick').addEventListener('pointercancel',resetJoy);$('#joystick').addEventListener('lostpointercapture',()=>{if(joyPointer!==null)resetJoy();});
$('#joystick').onkeydown=e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home'].includes(e.key)){e.preventDefault();if(e.key==='Home')applyJoy(0,0);else applyJoy(joyX+(e.key==='ArrowRight'?.12:e.key==='ArrowLeft'?-.12:0),joyY+(e.key==='ArrowDown'?.12:e.key==='ArrowUp'?-.12:0));}};

const settings=$('#settings'),welcome=$('#welcome');
function selectTab(name){$$('[data-tab]').forEach(b=>b.classList.toggle('selected',b.dataset.tab===name));$$('.tab-panel').forEach(p=>p.hidden=p.id!=='tab-'+name);if(name==='recordings')renderRecordings();}
function openSettings(tab='sound'){stopAll();resetJoy();selectTab(tab);if(welcome.open)welcome.close();if(!settings.open)settings.showModal();}
$$('.menu-action').forEach(b=>b.onclick=()=>openSettings());$('.close-settings').onclick=()=>settings.close();
settings.addEventListener('click',e=>{if(e.target===settings){const r=settings.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)settings.close();}});
$$('[data-tab]').forEach(b=>b.onclick=()=>selectTab(b.dataset.tab));
$('#dismiss-portrait').onclick=()=>$('#portrait-tip').classList.add('dismissed');
const lessons=[
  {title:'Проведи пальцем — уже музыка',text:'Нажимай клавиши или скользи по ним, как по пианино. Можно играть несколькими пальцами. Все аккорды уже подобраны в одной тональности.',kind:'keys'},
  {title:'Отпусти. Пусть звук останется',text:'Мягкий шлейф соединяет аккорды, а ЭХО добавляет затухающие повторы. HOLD удерживает аккорд, ARP играет его ноты по очереди. Длину шлейфа можно настроить в меню.',kind:'tail'},
  {title:'Джойстик добавляет характер',text:'Влево и вправо — темнее или ярче. Вверх — больше пространства, вниз — суше. В меню есть чувствительность и три простых режима эффектов.',kind:'joystick'},
  {title:'Поймай момент и сохрани',text:'Потяни число TEMPO вбок или вверх. Для записи нажми REC: 3, 2, 1 — и играй. Нажми ещё раз, чтобы сохранить сессию в меню «Записи».',kind:'record'}
];let lessonIndex=0;
function renderLesson(){const l=lessons[lessonIndex];$('#lesson-step').textContent=`${lessonIndex+1} / ${lessons.length}`;$('#lesson-title').textContent=l.title;$('#lesson-text').textContent=l.text;$('#lesson-art').dataset.kind=l.kind;$('#lesson-next').textContent=lessonIndex===lessons.length-1?'Начать играть':'Дальше';$('#lesson-back').disabled=lessonIndex===0;$$('.lesson-dot').forEach((el,i)=>el.classList.toggle('current',i===lessonIndex));}
function openTutorial(){stopAll();if(settings.open)settings.close();lessonIndex=0;renderLesson();document.body.classList.add('learning');if(!welcome.open)welcome.showModal();}
function finishTutorial(){try{localStorage.setItem('volna-onboarding-v2','seen');}catch{}welcome.close();document.body.classList.remove('learning');}
$('#lesson-next').onclick=()=>{if(lessonIndex===lessons.length-1)finishTutorial();else{lessonIndex++;renderLesson();}};
$('#lesson-back').onclick=()=>{lessonIndex=Math.max(0,lessonIndex-1);renderLesson();};$('#lesson-skip').onclick=finishTutorial;
welcome.addEventListener('cancel',()=>{try{localStorage.setItem('volna-onboarding-v2','seen');}catch{}document.body.classList.remove('learning');});
$('#help').onclick=openTutorial;$('#replay-tutorial').onclick=openTutorial;
document.addEventListener('keydown',e=>{if(e.key==='Escape'){stopAll(true);cancelCountIn();return;}if(e.defaultPrevented||settings.open||welcome.open||/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)||e.ctrlKey||e.metaKey||e.altKey)return;const code=e.key.toLowerCase(),i='asdfghj'.indexOf(code),num='1234567'.indexOf(code);if(i!==-1||num!==-1){e.preventDefault();if(!e.repeat)startChord(i!==-1?i:num,'k'+code);}else if(e.code==='Space'&&e.target.id!=='tempo'){e.preventDefault();if(!e.repeat)toggleHold();}else if(code==='r'&&!e.repeat)toggleRecording();});
document.addEventListener('keyup',e=>endSource('k'+e.key.toLowerCase()));
function releaseControls(){stopAll(true);resetJoy();endTempo();cancelCountIn();}
window.addEventListener('blur',releaseControls);window.addEventListener('pagehide',releaseControls);window.addEventListener('resize',()=>{if(pointers.size)stopAll();resetJoy();endTempo();});
document.addEventListener('visibilitychange',()=>{if(document.hidden){releaseControls();if(recorder?.state==='recording'){recordStopping=true;recorder.stop();toast('Запись сохранена при сворачивании.');}}});

let countIn=null;
function hideCountIn(){$('#count-in').hidden=true;$('#record').classList.remove('counting');$('#record-label').textContent='REC';$('#record').title='Начать запись';$('#display-status').textContent=micStream?'MIC ON':'STEREO';}
function cancelCountIn(){if(!countIn)return;const job=countIn;countIn=null;clearTimeout(job.timer);hideCountIn();job.resolve(false);}
function startCountIn(){return new Promise(resolve=>{const job={resolve,timer:null,remaining:3};countIn=job;$('#count-in').hidden=false;$('#record').classList.add('counting');$('#record').title='Отменить отсчёт';$('#display-status').textContent='COUNT IN';const tick=()=>{if(countIn!==job)return;if(job.remaining===0){countIn=null;hideCountIn();resolve(true);return;}$('#count-number').textContent=job.remaining;$('#record-label').textContent=job.remaining;$('#count-in').setAttribute('aria-label',`До записи ${job.remaining}`);synth.countTick(job.remaining===1);job.remaining--;job.timer=setTimeout(tick,1000);};tick();});}
async function toggleRecording(){
  if(countIn){cancelCountIn();toast('Отсчёт отменён.');return;}
  if(recordBusy||recordStopping)return;
  if(recorder?.state==='recording'){recordStopping=true;recorder.stop();return;}
  if(!window.MediaRecorder){toast('Запись не поддерживается этим браузером. Попробуй Safari или Chrome.');return;}
  recordBusy=true;try{await synth.ensure();if(!await startCountIn())return;
    const mime=['audio/webm;codecs=opus','audio/mp4','audio/ogg;codecs=opus','audio/webm'].find(t=>MediaRecorder.isTypeSupported(t)),chunks=[];
    const current=new MediaRecorder(synth.recordDest.stream,mime?{mimeType:mime}:undefined);recorder=current;
    let started=performance.now();const voiceName=PRESETS[state.voice].name;
    current.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
    current.onerror=()=>{recordUI(false);recordBusy=false;recordStopping=false;toast('Запись прервалась. Попробуй ещё раз.');};
    current.onstop=async()=>{recordUI(false);const duration=(performance.now()-started)/1000,blob=new Blob(chunks,{type:current.mimeType||mime||'audio/webm'});recorder=null;recordStopping=false;if(!blob.size){toast('Не удалось сохранить звук. Попробуй ещё раз.');return;}const session={id:Date.now()+'-'+Math.random().toString(36).slice(2,7),name:'Сессия '+String(++sessionNumber).padStart(2,'0'),date:new Date().toISOString(),duration,blob,mime:blob.type,voice:voiceName};recordings.unshift(session);try{await dbAction('readwrite',store=>store.put(session));toast('Сессия сохранена в меню → Записи.');}catch{toast('Скачай сессию в меню → Записи до закрытия страницы.');}$('#recording-count').textContent=recordings.length;if(settings.open&&!$('#tab-recordings').hidden)renderRecordings();};
    current.start(500);started=performance.now();recordStarted=started;recordUI(true);recordTimer=setInterval(()=>{const sec=(performance.now()-started)/1000;$('#record-label').textContent=formatTime(sec);if(sec>=1800&&current.state==='recording'){recordStopping=true;current.stop();}},250);toast(micStream?'Записываются инструмент и микрофон.':'Запись началась. REC — сохранить сессию.');
  }catch{hideCountIn();toast('Не удалось начать запись. Попробуй ещё раз.');}finally{recordBusy=false;}
}


let micStream=null,micSource=null,micGain=null,micPending=false;
async function toggleMic(){
  if(micPending)return;
  if(micStream){disableMic();return;}
  if(!navigator.mediaDevices?.getUserMedia){toast('Микрофон доступен в Safari или Chrome по защищённой ссылке.');return;}
  micPending=true;$('#mic-toggle').disabled=true;
  try{await synth.ensure();micStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false},video:false});micSource=synth.ctx.createMediaStreamSource(micStream);micGain=synth.ctx.createGain();micGain.gain.value=+$('#mic-gain').value/100;micSource.connect(micGain);micGain.connect(synth.recordDest);micStream.getAudioTracks().forEach(track=>track.onended=disableMic);$('#mic-status').textContent='Включён · только для записи';$('#mic-toggle').innerHTML='<svg><use href="#i-mic"/></svg>Выключить';$('.mic-gain-row').hidden=false;$('#display-status').textContent='MIC ON';await refreshDevices();toast('Микрофон включён. Его звук будет в записи.');}
  catch(e){const messages={NotAllowedError:'Доступ к микрофону не разрешён. Измени разрешение в настройках сайта.',NotFoundError:'Микрофон не найден. Проверь подключение.',NotReadableError:'Микрофон занят другим приложением.'};toast(messages[e.name]||'Не удалось включить микрофон. Проверь настройки браузера.');if(micStream)disableMic();}
  finally{micPending=false;$('#mic-toggle').disabled=false;}
}
function disableMic(){const stream=micStream;micStream=null;if(micSource)micSource.disconnect();if(micGain)micGain.disconnect();micSource=null;micGain=null;if(stream)stream.getTracks().forEach(t=>{t.onended=null;t.stop();});$('#mic-status').textContent='Выключен';$('#mic-toggle').innerHTML='<svg><use href="#i-mic"/></svg>Включить';$('.mic-gain-row').hidden=true;$('#display-status').textContent=recorder?.state==='recording'?'RECORDING':'STEREO';}
$('#mic-toggle').onclick=toggleMic;$('#mic-gain').oninput=e=>{if(micGain)micGain.gain.setTargetAtTime(+e.target.value/100,synth.ctx.currentTime,.03);};
async function refreshDevices(){const select=$('#audio-output');if(!navigator.mediaDevices?.enumerateDevices)return;try{const list=await navigator.mediaDevices.enumerateDevices(),old=select.value;select.replaceChildren(new Option('Системное','default'));for(const d of list.filter(d=>d.kind==='audiooutput'&&d.deviceId&&d.deviceId!=='default'))select.add(new Option(d.label||'Аудиоустройство',d.deviceId));if([...select.options].some(o=>o.value===old))select.value=old;const supported=!!(window.AudioContext||window.webkitAudioContext)?.prototype?.setSinkId;select.disabled=!supported;if(!supported)$('#output-note').textContent='В этом браузере выход выбирается в настройках телефона. Подключи наушники — система направит звук в них. Bluetooth может добавлять задержку.';}catch{toast('Браузер не предоставил список устройств. Используй системный выбор звука.');}}
$('#refresh-devices').onclick=async()=>{await refreshDevices();toast('Список устройств обновлён.');};
$('#audio-output').onchange=async e=>{try{await synth.ensure();if(synth.ctx.setSinkId){await synth.ctx.setSinkId(e.target.value==='default'?'':e.target.value);toast('Устройство вывода изменено.');}}catch{e.target.value='default';toast('Не удалось переключить устройство. Выбери выход через систему.');}};
navigator.mediaDevices?.addEventListener?.('devicechange',refreshDevices);

let databasePromise=null;function getDB(){if(!databasePromise)databasePromise=new Promise((resolve,reject)=>{if(!window.indexedDB){reject(new Error('Хранилище недоступно'));return;}const request=indexedDB.open('volna-sessions',1);request.onupgradeneeded=()=>request.result.createObjectStore('sessions',{keyPath:'id'});request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});return databasePromise;}
async function dbAction(mode,action){const db=await getDB();return new Promise((resolve,reject)=>{const tx=db.transaction('sessions',mode),request=action(tx.objectStore('sessions'));let result;request.onsuccess=()=>result=request.result;tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}
let recorder=null,recordStarted=0,recordTimer=null,recordBusy=false,recordStopping=false,sessionNumber=0,recordings=[],objectUrls=[];
function recordUI(on){setPressed($('#record'),on);$('#record').title=on?'Остановить запись':'Начать запись';$('#record-label').textContent=on?'00:00':'REC';$('#display-status').textContent=on?'RECORDING':micStream?'MIC ON':'STEREO';if(!on){clearInterval(recordTimer);recordTimer=null;}if(settings.open&&$('#tab-recordings').hidden===false)renderRecordings();}
function formatTime(seconds){return Math.floor(seconds/60).toString().padStart(2,'0')+':'+Math.floor(seconds%60).toString().padStart(2,'0');}
$('#record').onclick=toggleRecording;
function renderRecordings(){const host=$('#recordings-list');objectUrls.forEach(URL.revokeObjectURL);objectUrls=[];host.replaceChildren();if(recorder?.state==='recording'){const note=document.createElement('div');note.className='recording-active-note';note.textContent='● Сейчас идёт запись. Останови её кнопкой REC на инструменте.';host.append(note);}if(!recordings.length){const empty=document.createElement('div');empty.className='empty-recordings';empty.textContent='Пока тихо. Первая мелодия ждёт тебя — нажми REC и сыграй что-нибудь.';host.append(empty);return;}for(const r of recordings){const url=URL.createObjectURL(r.blob);objectUrls.push(url);const item=document.createElement('article');item.className='recording-item';const top=document.createElement('div'),name=document.createElement('strong'),time=document.createElement('small');name.textContent=r.name;time.textContent=formatTime(r.duration);top.append(name,time);const date=document.createElement('div');date.className='record-date';date.textContent=new Date(r.date).toLocaleString('ru-RU',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})+' · '+r.voice;const audio=document.createElement('audio');audio.controls=true;audio.preload='metadata';audio.src=url;audio.setAttribute('aria-label',r.name);const actions=document.createElement('div');actions.className='recording-actions';const download=document.createElement('a');download.href=url;download.download='volna-'+r.date.slice(0,19).replace(/[T:]/g,'-')+(r.mime.includes('mp4')?'.m4a':r.mime.includes('ogg')?'.ogg':'.webm');download.textContent='↓ Скачать';const del=document.createElement('button');del.textContent='Удалить';del.onclick=async()=>{try{await dbAction('readwrite',store=>store.delete(r.id));}catch{}recordings=recordings.filter(s=>s.id!==r.id);$('#recording-count').textContent=recordings.length;renderRecordings();};actions.append(download,del);item.append(top,date,audio,actions);host.append(item);}}
getDB().then(()=>dbAction('readonly',store=>store.getAll())).then(data=>{recordings=data.sort((a,b)=>b.date.localeCompare(a.date));sessionNumber=recordings.length;$('#recording-count').textContent=recordings.length;}).catch(()=>{});

function showInstallInstructions(){const el=$('#installation-instructions');el.scrollIntoView({behavior:'smooth',block:'start'});el.focus({preventScroll:true});}
function installedUI(){const yes=matchMedia('(display-mode: standalone)').matches||navigator.standalone;if(yes){$('.install-action').textContent='Уже на главном экране';$('.install-action').disabled=true;}}
let installPrompt=null;installedUI();
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;});
window.addEventListener('appinstalled',()=>{installPrompt=null;$('.install-action').textContent='Установлено';$('.install-action').disabled=true;toast('Волна установлена. Запускай её с главного экрана.');});
$$('.install-action').forEach(b=>b.onclick=async()=>{if(installPrompt){try{await installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;}catch{showInstallInstructions();}}else{showInstallInstructions();toast(/iPhone|iPad|iPod/.test(navigator.userAgent)?'В Safari: «Поделиться» → «На экран “Домой”».':'Открой меню браузера → «Установить приложение» или «Добавить на главный экран».');}});
$('#fullscreen').onclick=async()=>{try{if(document.fullscreenElement){await document.exitFullscreen();return;}if(document.documentElement.requestFullscreen){await document.documentElement.requestFullscreen();if(screen.orientation?.lock)await screen.orientation.lock('landscape').catch(()=>{});}else{openSettings('app');toast('Чтобы убрать адресную строку, добавь Волну на главный экран и запускай с иконки.');}}catch{openSettings('app');toast('Открой Волну с главного экрана для режима без адресной строки.');}};
document.addEventListener('fullscreenchange',()=>$('#fullscreen').setAttribute('aria-label',document.fullscreenElement?'Выйти из полного экрана':'На весь экран'));
if('serviceWorker' in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}).catch(()=>{}));

const canvas=$('#scope'),ctx=canvas.getContext('2d');let scopeData=new Uint8Array(1024),lastFrame=0;
function drawScope(time){requestAnimationFrame(drawScope);if(time-lastFrame<32||document.hidden)return;lastFrame=time;const r=canvas.getBoundingClientRect();if(r.width===0||r.height===0)return;const dpr=Math.min(window.devicePixelRatio||1,2),w=Math.round(r.width*dpr),h=Math.round(r.height*dpr);if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}ctx.clearRect(0,0,w,h);ctx.strokeStyle='#35503c';ctx.lineWidth=dpr;ctx.globalAlpha=.13;ctx.beginPath();ctx.moveTo(0,h/2);ctx.lineTo(w,h/2);ctx.stroke();ctx.globalAlpha=.75;ctx.beginPath();if(synth.analyser){synth.analyser.getByteTimeDomainData(scopeData);for(let i=0;i<w;i++){const v=(scopeData[Math.floor(i/w*scopeData.length)]-128)/128,y=h/2+v*h*1.7;i?ctx.lineTo(i,y):ctx.moveTo(i,y);}}else{for(let i=0;i<w;i++){const x=i/w,y=h/2+Math.sin(x*15)*Math.sin(x*Math.PI)*h*.08;i?ctx.lineTo(i,y):ctx.moveTo(i,y);}}ctx.stroke();ctx.globalAlpha=1;}
renderPads();setVoice(state.voice);setTheme(state.theme);setTempo(state.tempo);setPressed($('#echo'),state.echo);refreshDevices();requestAnimationFrame(drawScope);
try{if(!localStorage.getItem('volna-onboarding-v2'))openTutorial();}catch{openTutorial();}

