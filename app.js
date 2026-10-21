'use strict';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const NOTES=['C','C♯','D','E♭','E','F','F♯','G','A♭','A','B♭','B'];
const PRESETS={
  tape:{name:'WARM TAPE',num:'01',type:'sawtooth',second:'triangle',attack:.035,decay:.65,sustain:.62,release:.7,detune:5,cutoff:2600},
  keys:{name:'SOFT KEYS',num:'02',type:'sine',second:'triangle',attack:.008,decay:1.25,sustain:.17,release:.5,detune:2,cutoff:4200},
  cloud:{name:'CLOUD PAD',num:'03',type:'triangle',second:'sine',attack:.32,decay:.7,sustain:.8,release:1.65,detune:8,cutoff:1800},
  bell:{name:'MOON BELL',num:'04',type:'sine',second:'sine',attack:.006,decay:1.8,sustain:.1,release:1.1,detune:0,cutoff:6500}
};
let saved={};try{saved=JSON.parse(localStorage.getItem('volna-settings')||'{}')||{};}catch{}
const state={voice:PRESETS[saved.voice]?saved.voice:'tape',theme:['mint','sand','lilac','ink'].includes(saved.theme)?saved.theme:'mint',root:Number.isInteger(saved.root)&&saved.root>=0&&saved.root<12?saved.root:0,scale:saved.scale==='minor'?'minor':'major',volume:Number.isFinite(saved.volume)?Math.max(0,Math.min(100,saved.volume)):65,reverb:Number.isFinite(saved.reverb)?Math.max(0,Math.min(100,saved.reverb)):30,tempo:Number.isFinite(saved.tempo)?Math.max(40,Math.min(200,saved.tempo)):84,octave:0,hold:false,arp:false,haptics:saved.haptics!==false};
function saveSettings(){try{localStorage.setItem('volna-settings',JSON.stringify(state));}catch{}}
let toastTimer;function toast(message){$('#toast').textContent=message;$('#toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),4200);}
function setPressed(el,value){el.setAttribute('aria-pressed',String(value));}
function chord(index){const scale=state.scale==='major'?[0,2,4,5,7,9,11]:[0,2,3,5,7,8,10];const intervals=[0,2,4,6].map(step=>{const n=index+step;return scale[n%7]+12*Math.floor(n/7)-scale[index];});const root=(state.root+scale[index])%12;const quality=intervals[1]===3?(intervals[2]===6?'m7♭5':'m7'):(intervals[3]===11?'maj7':'7');return{root,quality,intervals,midi:48+state.root+scale[index]+state.octave*12,roman:['I','II','III','IV','V','VI','VII'][index]};}
function renderPads(){const host=$('#pads');host.replaceChildren();for(let i=0;i<7;i++){const c=chord(i),el=document.createElement('button');el.type='button';el.className='pad';el.dataset.index=i;el.setAttribute('aria-label',`${NOTES[c.root]} ${c.quality}, аккорд ${i+1}`);el.setAttribute('aria-pressed','false');el.innerHTML=`<span class="degree">${c.roman}</span><span class="pad-root">${NOTES[c.root]}</span><span class="quality">${c.quality}</span><span class="key-hint">${'ASDFGHJ'[i]}</span>`;host.append(el);}showChord(0);}
function showChord(i){const c=chord(i);$('#chord-root').textContent=NOTES[c.root];$('#chord-quality').textContent=c.quality;$('#display-notes').textContent=c.intervals.map(n=>NOTES[(c.root+n)%12]).join(' · ');}

class Synth{
  constructor(){this.ctx=null;this.voices=new Set();}
  async ensure(){
    if(!this.ctx){
      const AC=window.AudioContext||window.webkitAudioContext;if(!AC)throw new Error('В этом браузере нет поддержки звука. Открой сайт в Safari или Chrome.');
      this.ctx=new AC({latencyHint:'interactive'});const c=this.ctx;
      this.bus=c.createGain();this.filter=c.createBiquadFilter();this.filter.type='lowpass';this.filter.frequency.value=PRESETS[state.voice].cutoff;this.filter.Q.value=.6;
      this.dry=c.createGain();this.dry.gain.value=.85;this.wet=c.createGain();this.wet.gain.value=state.reverb/100*.75;
      this.reverb=c.createConvolver();const length=Math.floor(c.sampleRate*2.3),impulse=c.createBuffer(2,length,c.sampleRate);for(let ch=0;ch<2;ch++){const d=impulse.getChannelData(ch);for(let i=0;i<length;i++)d[i]=(Math.random()*2-1)*Math.pow(1-i/length,3)*.8;}this.reverb.buffer=impulse;
      this.master=c.createGain();this.master.gain.value=this.volumeGain();this.compressor=c.createDynamicsCompressor();this.compressor.threshold.value=-14;this.compressor.knee.value=18;this.compressor.ratio.value=5;this.compressor.attack.value=.005;this.compressor.release.value=.15;
      this.analyser=c.createAnalyser();this.analyser.fftSize=1024;this.analyser.smoothingTimeConstant=.75;this.recordDest=c.createMediaStreamDestination();
      this.bus.connect(this.filter);this.filter.connect(this.dry);this.dry.connect(this.master);this.filter.connect(this.reverb);this.reverb.connect(this.wet);this.wet.connect(this.master);this.master.connect(this.compressor);this.compressor.connect(this.analyser);this.analyser.connect(c.destination);this.compressor.connect(this.recordDest);
    }
    if(this.ctx.state==='suspended')await this.ctx.resume();return this;
  }
  volumeGain(){return .65*Math.pow(state.volume/100,1.5);}
  setVolume(){if(this.ctx)this.master.gain.setTargetAtTime(this.volumeGain(),this.ctx.currentTime,.035);}
  setSpace(amount){if(this.ctx)this.wet.gain.setTargetAtTime(amount*.75,this.ctx.currentTime,.08);}
  setTone(value){if(this.ctx)this.filter.frequency.setTargetAtTime(value,this.ctx.currentTime,.04);}
  note(midi){
    const p=PRESETS[state.voice],c=this.ctx,t=c.currentTime,freq=440*Math.pow(2,(midi-69)/12),env=c.createGain(),oscs=[];
    env.gain.value=.0001;env.gain.setValueAtTime(.0001,t);env.gain.exponentialRampToValueAtTime(.16,t+p.attack);env.gain.exponentialRampToValueAtTime(Math.max(.0001,.16*p.sustain),t+p.attack+p.decay);env.connect(this.bus);
    const mix=c.createGain();mix.gain.value=.5;mix.connect(env);
    for(let i=0;i<2;i++){const o=c.createOscillator();o.type=i?p.second:p.type;o.frequency.value=freq*(state.voice==='bell'&&i?2.003:1);o.detune.value=i?p.detune:-p.detune;o.connect(mix);o.start(t);oscs.push(o);}
    const voice={env,oscs,mix,release:p.release,ended:false};this.voices.add(voice);return voice;
  }
  stop(voice,fast=false){if(!voice||voice.ended)return;voice.ended=true;const c=this.ctx,t=c.currentTime,duration=fast?.04:voice.release;const gain=voice.env.gain;if(gain.cancelAndHoldAtTime)gain.cancelAndHoldAtTime(t);else{const current=gain.value;gain.cancelScheduledValues(t);gain.setValueAtTime(Math.max(.0001,current),t);}gain.exponentialRampToValueAtTime(.0001,t+duration);for(const o of voice.oscs)o.stop(t+duration+.04);setTimeout(()=>{for(const o of voice.oscs)o.disconnect();voice.mix.disconnect();voice.env.disconnect();this.voices.delete(voice);},(duration+.1)*1000);}
}
const synth=new Synth();
const active=new Map(),sources=new Map();let pendingToken=0;
function updateActivity(){const playing=active.size>0;$('.power').classList.toggle('playing',playing);$('#power-label').textContent=playing?'PLAYING':'READY';$('#display-mode').textContent=state.arp?'ARPEGGIO':state.hold?'HOLD MODE':'CHORD MODE';}
function lightPad(i,on){const p=$(`.pad[data-index="${i}"]`);if(p){p.classList.toggle('pressed',on);setPressed(p,on);}}
async function startChord(i,source){
  sources.set(source,i);if(state.hold&&active.has(i)){stopChord(i);sources.delete(source);return;}if(active.has(i))return;
  const g={id:++pendingToken,voices:[],timer:null,step:0};active.set(i,g);lightPad(i,true);showChord(i);updateActivity();if(state.haptics&&navigator.vibrate)navigator.vibrate(7);
  try{await synth.ensure();if(active.get(i)!==g)return;const c=chord(i);
    if(state.arp){const tick=()=>{if(active.get(i)!==g)return;g.voices.forEach(v=>synth.stop(v,true));g.voices=[synth.note(c.midi+c.intervals[g.step++%4])];};tick();g.timer=setInterval(tick,60000/state.tempo/2);}
    else g.voices=c.intervals.map(n=>synth.note(c.midi+n));
    $('#play-hint').textContent='Есть только ты, звук и этот момент.';
  }catch(e){stopChord(i);toast(e.message||'Не получилось включить звук. Попробуй ещё раз.');}
}
function stopChord(i,fast=false){const g=active.get(i);if(!g)return;clearInterval(g.timer);g.voices.forEach(v=>synth.stop(v,fast));active.delete(i);lightPad(i,false);updateActivity();}
function endSource(source){const i=sources.get(source);sources.delete(source);if(i===undefined||state.hold)return;if(![...sources.values()].includes(i))stopChord(i);}
function stopAll(fast=false){for(const i of [...active.keys()])stopChord(i,fast);sources.clear();}
$('#pads').addEventListener('pointerdown',e=>{const p=e.target.closest('.pad');if(!p||e.button>0)return;e.preventDefault();p.setPointerCapture(e.pointerId);startChord(+p.dataset.index,'p'+e.pointerId);});
$('#pads').addEventListener('pointerup',e=>endSource('p'+e.pointerId));
$('#pads').addEventListener('pointercancel',e=>endSource('p'+e.pointerId));
$('#pads').addEventListener('lostpointercapture',e=>endSource('p'+e.pointerId));
$('#pads').addEventListener('contextmenu',e=>e.preventDefault());
// Assistive-technology activation without a pointer still produces a short chord.
$('#pads').addEventListener('click',e=>{if(e.detail!==0)return;const p=e.target.closest('.pad');if(!p)return;const source='assist'+p.dataset.index;startChord(+p.dataset.index,source);setTimeout(()=>endSource(source),450);});
function toggleHold(){state.hold=!state.hold;setPressed($('#hold'),state.hold);if(!state.hold)stopAll();updateActivity();toast(state.hold?'HOLD: аккорд звучит после отпускания. Нажми клавишу ещё раз, чтобы выключить.':'Удержание выключено');}
$('#hold').onclick=toggleHold;
$('#arp').onclick=()=>{stopAll();state.arp=!state.arp;setPressed($('#arp'),state.arp);updateActivity();toast(state.arp?'Арпеджиатор включён. Удерживай аккорд.':'Режим аккордов');};
function setVoice(voice){stopAll();state.voice=voice;$$('[data-voice]').forEach(el=>{const yes=el.dataset.voice===voice;el.classList.toggle('active',yes);setPressed(el,yes);});$('#display-voice').textContent=PRESETS[voice].num+' / '+PRESETS[voice].name;synth.setTone(PRESETS[voice].cutoff);saveSettings();}
$$('[data-voice]').forEach(b=>b.onclick=()=>setVoice(b.dataset.voice));
$('#volume').value=state.volume;$('#volume-value').textContent=state.volume;$('#volume').oninput=e=>{state.volume=+e.target.value;$('#volume-value').textContent=state.volume;synth.setVolume();saveSettings();};
function setOctave(value){stopAll();state.octave=Math.max(-2,Math.min(2,value));$('#octave-value').textContent=state.octave>0?'+'+state.octave:state.octave;$('#octave-down').disabled=state.octave===-2;$('#octave-up').disabled=state.octave===2;}
$('#octave-down').onclick=()=>setOctave(state.octave-1);$('#octave-up').onclick=()=>setOctave(state.octave+1);
$('#root-key').selectedIndex=state.root;$('#root-key').onchange=e=>{stopAll();state.root=e.target.selectedIndex;renderPads();saveSettings();};
$('#scale').value=state.scale;$('#scale').onchange=e=>{stopAll();state.scale=e.target.value;renderPads();saveSettings();};
$('#tempo').value=state.tempo;$('#tempo').onchange=e=>{state.tempo=Math.round(Math.max(40,Math.min(200,+e.target.value||84)));e.target.value=state.tempo;if(state.arp)stopAll();saveSettings();};
$('#reverb').value=state.reverb;$('#reverb-value').textContent=state.reverb+'%';$('#reverb').oninput=e=>{state.reverb=+e.target.value;$('#reverb-value').textContent=state.reverb+'%';synth.setSpace(state.reverb/100);saveSettings();};
$('#haptics').checked=state.haptics;$('#haptics').onchange=e=>{state.haptics=e.target.checked;saveSettings();};
function setTheme(theme){state.theme=theme;document.documentElement.dataset.theme=theme;$$('.theme-choice').forEach(b=>b.classList.toggle('selected',b.dataset.theme===theme));saveSettings();}
$$('.theme-choice').forEach(b=>b.onclick=()=>setTheme(b.dataset.theme));

let joyPointer=null,joyX=0,joyY=0;
function applyJoy(x,y){joyX=Math.max(-1,Math.min(1,x));joyY=Math.max(-1,Math.min(1,y));const radius=$('#joystick').clientWidth*.22;$('#joystick-knob').style.transform=`translate(${joyX*radius}px,${joyY*radius}px)`;$('#joystick').setAttribute('aria-valuenow',Math.round(joyX*100));$('#joystick').setAttribute('aria-valuetext',`Яркость ${Math.round((joyX+1)*50)}%, пространство ${Math.round(Math.max(0,Math.min(1,state.reverb/100-joyY*.5))*100)}%`);synth.setTone(PRESETS[state.voice].cutoff*Math.pow(3,joyX));synth.setSpace(Math.max(0,Math.min(1,state.reverb/100-joyY*.5)));}
function moveJoy(e){const r=$('#joystick').getBoundingClientRect(),radius=r.width*.32;applyJoy((e.clientX-r.left-r.width/2)/radius,(e.clientY-r.top-r.height/2)/radius);}
$('#joystick').addEventListener('pointerdown',e=>{if(e.button>0)return;e.preventDefault();joyPointer=e.pointerId;e.currentTarget.setPointerCapture(e.pointerId);moveJoy(e);synth.ensure().then(()=>applyJoy(joyX,joyY)).catch(e=>toast(e.message));});
$('#joystick').addEventListener('pointermove',e=>{if(e.pointerId===joyPointer)moveJoy(e);});
function resetJoy(){joyPointer=null;$('#joystick-knob').style.transition='transform .2s';applyJoy(0,0);setTimeout(()=>$('#joystick-knob').style.transition='',220);}
$('#joystick').addEventListener('pointerup',resetJoy);$('#joystick').addEventListener('pointercancel',resetJoy);$('#joystick').addEventListener('lostpointercapture',()=>{if(joyPointer!==null)resetJoy();});
$('#joystick').onkeydown=e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home'].includes(e.key)){e.preventDefault();if(e.key==='Home')applyJoy(0,0);else applyJoy(joyX+(e.key==='ArrowRight'?.2:e.key==='ArrowLeft'?-.2:0),joyY+(e.key==='ArrowDown'?.2:e.key==='ArrowUp'?-.2:0));}};

const settings=$('#settings');
function selectTab(name){$$('[data-tab]').forEach(b=>b.classList.toggle('selected',b.dataset.tab===name));$$('.tab-panel').forEach(p=>p.hidden=p.id!=='tab-'+name);if(name==='recordings')renderRecordings();}
function openSettings(tab='sound'){stopAll();selectTab(tab);if(!settings.open)settings.showModal();}
$$('.menu-action').forEach(b=>b.onclick=()=>openSettings());$('.close-settings').onclick=()=>settings.close();
settings.addEventListener('click',e=>{if(e.target===settings){const r=settings.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)settings.close();}});
$$('[data-tab]').forEach(b=>b.onclick=()=>selectTab(b.dataset.tab));
$('#help').onclick=()=>openSettings('app');$('#dismiss-portrait').onclick=()=>$('#portrait-tip').classList.add('dismissed');
document.addEventListener('keydown',e=>{if(e.key==='Escape'){stopAll(true);return;}if(settings.open||/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)||e.ctrlKey||e.metaKey||e.altKey)return;const code=e.key.toLowerCase(),i='asdfghj'.indexOf(code),num='1234567'.indexOf(code);if(i!==-1||num!==-1){e.preventDefault();if(!e.repeat)startChord(i!==-1?i:num,'k'+code);}else if(e.code==='Space'){e.preventDefault();if(!e.repeat)toggleHold();}else if(code==='r'&&!e.repeat)toggleRecording();});
document.addEventListener('keyup',e=>endSource('k'+e.key.toLowerCase()));
window.addEventListener('blur',()=>stopAll(true));document.addEventListener('visibilitychange',()=>{if(document.hidden){stopAll(true);if(recorder?.state==='recording'){recorder.stop();toast('Запись остановлена при сворачивании.');}}});

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
async function toggleRecording(){
  if(recordBusy||recordStopping)return;
  if(recorder&&recorder.state==='recording'){recordStopping=true;recorder.stop();return;}
  if(!window.MediaRecorder){toast('Запись не поддерживается этим браузером. Попробуй актуальный Safari или Chrome.');return;}
  recordBusy=true;try{await synth.ensure();const mime=['audio/webm;codecs=opus','audio/mp4','audio/ogg;codecs=opus','audio/webm'].find(t=>MediaRecorder.isTypeSupported(t));const chunks=[];const current=new MediaRecorder(synth.recordDest.stream,mime?{mimeType:mime}:undefined);recorder=current;
    current.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
    current.onerror=()=>{recordUI(false);recordBusy=false;recordStopping=false;toast('Запись прервалась. Попробуй записать ещё раз.');};
    current.onstop=async()=>{recordUI(false);const duration=(performance.now()-recordStarted)/1000;const blob=new Blob(chunks,{type:current.mimeType||mime||'audio/webm'});recorder=null;recordStopping=false;if(!blob.size){toast('Не удалось сохранить звук. Попробуй ещё раз.');return;}const session={id:Date.now()+'-'+Math.random().toString(36).slice(2,7),name:'Сессия '+String(++sessionNumber).padStart(2,'0'),date:new Date().toISOString(),duration,blob,mime:blob.type,voice:PRESETS[state.voice].name};recordings.unshift(session);try{await dbAction('readwrite',store=>store.put(session));toast('Сессия сохранена. Открой «Записи», чтобы послушать и скачать.');}catch{toast('Сессия доступна до закрытия страницы. Скачай её в разделе «Записи».');}$('#recording-count').textContent=recordings.length;if(settings.open&&$('#tab-recordings').hidden===false)renderRecordings();};
    current.start(500);recordStarted=performance.now();recordUI(true);recordTimer=setInterval(()=>{const sec=(performance.now()-recordStarted)/1000;$('#record-label').textContent=formatTime(sec);if(sec>=1800){current.stop();toast('Сессия длиной 30 минут сохранена. Можно начать следующую.');}},250);toast(micStream?'Идёт запись инструмента и микрофона. REC — остановить.':'Идёт запись инструмента. REC — остановить.');
  }catch{toast('Не удалось начать запись. Попробуй обновить браузер.');}finally{recordBusy=false;}
}
$('#record').onclick=toggleRecording;
function renderRecordings(){const host=$('#recordings-list');objectUrls.forEach(URL.revokeObjectURL);objectUrls=[];host.replaceChildren();if(recorder?.state==='recording'){const note=document.createElement('div');note.className='recording-active-note';note.textContent='● Сейчас идёт запись. Останови её кнопкой REC на инструменте.';host.append(note);}if(!recordings.length){const empty=document.createElement('div');empty.className='empty-recordings';empty.textContent='Пока тихо. Первая мелодия ждёт тебя — нажми REC и сыграй что-нибудь.';host.append(empty);return;}for(const r of recordings){const url=URL.createObjectURL(r.blob);objectUrls.push(url);const item=document.createElement('article');item.className='recording-item';const top=document.createElement('div'),name=document.createElement('strong'),time=document.createElement('small');name.textContent=r.name;time.textContent=formatTime(r.duration);top.append(name,time);const date=document.createElement('div');date.className='record-date';date.textContent=new Date(r.date).toLocaleString('ru-RU',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})+' · '+r.voice;const audio=document.createElement('audio');audio.controls=true;audio.preload='metadata';audio.src=url;audio.setAttribute('aria-label',r.name);const actions=document.createElement('div');actions.className='recording-actions';const download=document.createElement('a');download.href=url;download.download='volna-'+r.date.slice(0,19).replace(/[T:]/g,'-')+(r.mime.includes('mp4')?'.m4a':r.mime.includes('ogg')?'.ogg':'.webm');download.textContent='↓ Скачать';const del=document.createElement('button');del.textContent='Удалить';del.onclick=async()=>{try{await dbAction('readwrite',store=>store.delete(r.id));}catch{}recordings=recordings.filter(s=>s.id!==r.id);$('#recording-count').textContent=recordings.length;renderRecordings();};actions.append(download,del);item.append(top,date,audio,actions);host.append(item);}}
getDB().then(()=>dbAction('readonly',store=>store.getAll())).then(data=>{recordings=data.sort((a,b)=>b.date.localeCompare(a.date));sessionNumber=recordings.length;$('#recording-count').textContent=recordings.length;}).catch(()=>{});

let installPrompt=null;
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;});
window.addEventListener('appinstalled',()=>{installPrompt=null;toast('Волна установлена. Запускай её с главного экрана.');});
$$('.install-action').forEach(b=>b.onclick=async()=>{if(installPrompt){try{await installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;}catch{openSettings('app');}}else{openSettings('app');toast(/iPhone|iPad|iPod/.test(navigator.userAgent)?'В Safari: «Поделиться» → «На экран “Домой”».':'Открой меню браузера → «Установить приложение» или «Добавить на главный экран».');}});
$('#fullscreen').onclick=async()=>{try{if(document.fullscreenElement){await document.exitFullscreen();return;}if(document.documentElement.requestFullscreen){await document.documentElement.requestFullscreen();if(screen.orientation?.lock)await screen.orientation.lock('landscape').catch(()=>{});}else{openSettings('app');toast('Чтобы убрать адресную строку, добавь Волну на главный экран и запускай с иконки.');}}catch{openSettings('app');toast('Открой Волну с главного экрана для режима без адресной строки.');}};
document.addEventListener('fullscreenchange',()=>$('#fullscreen').setAttribute('aria-label',document.fullscreenElement?'Выйти из полного экрана':'На весь экран'));
if('serviceWorker' in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));

const canvas=$('#scope'),ctx=canvas.getContext('2d');let scopeData=new Uint8Array(1024),lastFrame=0;
function drawScope(time){requestAnimationFrame(drawScope);if(time-lastFrame<32||document.hidden)return;lastFrame=time;const r=canvas.getBoundingClientRect();if(r.width===0||r.height===0)return;const dpr=Math.min(window.devicePixelRatio||1,2),w=Math.round(r.width*dpr),h=Math.round(r.height*dpr);if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}ctx.clearRect(0,0,w,h);ctx.strokeStyle='#35503c';ctx.lineWidth=dpr;ctx.globalAlpha=.13;ctx.beginPath();ctx.moveTo(0,h/2);ctx.lineTo(w,h/2);ctx.stroke();ctx.globalAlpha=.75;ctx.beginPath();if(synth.analyser){synth.analyser.getByteTimeDomainData(scopeData);for(let i=0;i<w;i++){const v=(scopeData[Math.floor(i/w*scopeData.length)]-128)/128,y=h/2+v*h*1.7;i?ctx.lineTo(i,y):ctx.moveTo(i,y);}}else{for(let i=0;i<w;i++){const x=i/w,y=h/2+Math.sin(x*15)*Math.sin(x*Math.PI)*h*.08;i?ctx.lineTo(i,y):ctx.moveTo(i,y);}}ctx.stroke();ctx.globalAlpha=1;}
renderPads();setVoice(state.voice);setTheme(state.theme);refreshDevices();requestAnimationFrame(drawScope);
