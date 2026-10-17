const TZ = 'Australia/Adelaide';
const $ = id => document.getElementById(id);
const paths = {
 wave:'M2 15c3 0 4-8 9-8 4 0 5 3 4 5-1-2-4-2-4 0 0 4 6 5 11 2M2 19c4 2 7-2 11 0s6 1 9-1',
 wind:'M3 8h12a3 3 0 1 0-3-3M2 12h17a3 3 0 1 1-3 3M3 17h6a3 3 0 1 1-3 3',
 pin:'M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0ZM15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
 heart:'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z',
 refresh:'M20 7v5h-5M4 17v-5h5M5 7a8 8 0 0 1 14-1l1 6M4 12l1 6a8 8 0 0 0 14-1',
 settings:'m9 3 1-1h4l1 3 3 1 3 1-1 4v2l1 4-3 1-3 1-1 3h-4l-1-3-3-1-3-1 1-4v-2L3 7l3-1 3-1ZM16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
 sun:'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM12 2v2m0 16v2M2 12h2m16 0h2M5 5l2 2m10 10 2 2M19 5l-2 2M7 17l-2 2',
 temp:'M9 14V5a3 3 0 0 1 6 0v9a5 5 0 1 1-6 0ZM12 8v9',
 camera:'M3 6h4l2-3h6l2 3h4v15H3ZM16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z'
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.wave}"/></svg>`;
document.querySelectorAll('[data-icon]').forEach(e => e.innerHTML = icon(e.dataset.icon));
const esc = text => String(text ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num = (v, d=1) => Number.isFinite(v) ? v.toFixed(d) : '—';
const read = (key, fallback) => {try {return JSON.parse(localStorage.getItem('surfsa:'+key)) ?? fallback;} catch {return fallback;}};
const write = (key,value) => {try {localStorage.setItem('surfsa:'+key,JSON.stringify(value));} catch {}};
const savedFavorites=read('favorites',[]);
const state = {spots:[], spot:read('spot','port_noarlunga_south'), beginner:read('beginner',true)!==false, favorites:Array.isArray(savedFavorites)?savedFavorites:[], mode:'today', view:'forecast', day:'', filter:'all'};
const memory = new Map(), pending = new Map();
let renderToken = 0, map, markers=[];
function localTime(date=new Date()) {
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).map(p=>[p.type,p.value]));
 return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
function relation(dir,facing) {
 if(!Number.isFinite(dir)||!Number.isFinite(facing)) return '方向未詳 Unknown';
 const diff=Math.abs(((dir-facing+540)%360)-180);
 return diff<=50?'向岸風 Onshore':diff>=130?'離岸風 Offshore':'側風 Cross-shore';
}
function modelVerdict(row,spot) {
 if(state.beginner && spot.beginner===false) return {level:'bad',zh:'不建議新手',en:'Experienced surfers',reason:'此浪點屬進階或需留意礁石、水流，浪細亦唔代表適合新手。'};
 if(!row || ![row.wave_height,row.wave_period,row.wind_speed_10m].every(Number.isFinite)) return {level:'meh',zh:'資料不足',en:'Data unavailable',reason:'未有完整預報，請查看海灘 Cam 及現場情況。'};
 const h=row.wave_height,p=row.wave_period,w=row.wind_speed_10m*0.539957;
 const on=relation(row.wind_direction_10m,spot.beachFacingDeg).includes('Onshore');
 if(h>(state.beginner?1.5:2.2) || p>(state.beginner?13:15) || w>(state.beginner?(on?15:18):24)) return {level:'bad',zh:'浪況較強',en:'Challenging conditions',reason:'浪高、週期或風力偏強，落水風險較高。'};
 if(h>=(state.beginner?.3:.4) && h<=(state.beginner?1:1.5) && p<=(state.beginner?11:13) && w<=(state.beginner?(on?9:12):18)) return {level:'ok',zh:'浪況較溫和',en:'Milder conditions',reason:'模型顯示浪較細、風較弱，可先觀察現場。'};
 return {level:'meh',zh:'先觀察浪況',en:'Check conditions',reason:h<.3?'浪可能太細，未必適合滑浪練習。':'條件未算理想，先睇海灘 Cam 再決定。'};
}
// Local observations are user-entered, spot-specific, expire after 30 minutes,
// and never apply to another forecast hour or day. No automated rip detection.
function observation(spot,row){
 const o=read('observation:'+spot.id,null),age=o?Date.now()-o.at:Infinity;
 if(!o||age<0||age>30*60e3||!row||row.time.slice(0,13)!==localTime().slice(0,13))return null;
 return o;
}
function verdict(row,spot){
 const base=modelVerdict(row,spot),o=observation(spot,row);
 const danger=o&&(o.warning==='danger'||o.rip==='present'||(Number.isFinite(o.breaking)&&o.breaking>(state.beginner?1.5:2.2)));
 if(danger)return {level:'bad',zh:'不建議落水',en:'Do not enter',reason:'你記錄咗封灘／危險警告、離岸流，或超出本模式門檻嘅實際破浪。現場警告優先於模型。'};
 if(base.level==='bad')return base;
 if(o?.tide==='adverse')return {level:'meh',zh:'潮位不利',en:'Adverse tide / access',reason:'你記錄咗不利潮位或進出水位受阻，唔提供較佳時段建議。'};
 if(!o||o.warning!=='checked'||o.rip!=='notseen'||o.tide!=='checked'||!Number.isFinite(o.breaking))return {level:'meh',zh:'現場資料未齊',en:'Local checks needed',reason:'潮汐、離岸流、實際破浪或救生員警告仍未確認。模型較溫和亦唔代表現場安全。'};
 if(o.tide==='adverse'||o.breaking>(state.beginner?1:1.5))return {level:'meh',zh:'先觀察現場',en:'Check local conditions',reason:'現場潮位或破浪未符合本模式嘅較溫和條件。'};
 return {...base,reason:base.reason+' 現場記錄只代表你當時嘅觀察，並非安全認證。'};
}
function tideTrend(rows,row){
 const i=rows.indexOf(row),a=row?.sea_level_height_msl,b=rows[i+1]?.sea_level_height_msl;
 if(!Number.isFinite(a)||!Number.isFinite(b))return '趨勢未詳 Unknown';
 return b-a>.02?'上升 Rising':b-a<-.02?'下降 Falling':'變化不大 Steady';
}
function assessmentPanel(data,spot,row){
 const o=observation(spot,row),past=read('observation:'+spot.id,null),nowHour=row?.time.slice(0,13)===localTime().slice(0,13);
 const option=(value,text,key)=>`<option value="${value}" ${o?.[key]===value?'selected':''}>${text}</option>`;
 return `<section class="panel" id="localConditions"><h2>現場因素 <small>Local conditions</small></h2>
 <p class="caption">風浪模型：${modelVerdict(row,spot).zh} · ${modelVerdict(row,spot).en}。綜合結論另計現場因素。</p><div class="detail-grid"><div>模型海平面<small>Sea level · MSL</small><b>${num(row?.sea_level_height_msl,2)} m</b></div><div>海平面趨勢<small>Model trend</small><b>${tideTrend(data.rows,row)}</b></div></div>
 <p class="caption">包含潮汐及其他海平面變化，基準係平均海平面 MSL，唔係官方潮汐表嘅海圖基準。約 8 km 模型；唔用數值直接推算沙灘離岸流或安全潮位。</p>
 <div class="detail-grid"><div>潮汐／進出水位<small>Tide & access</small><b>${o?.tide==='checked'?'已核對 Checked':o?.tide==='adverse'?'不利 Adverse':'未確認 Unknown'}</b></div><div>離岸流<small>Rip current</small><b>${o?.rip==='present'?'已見／獲警告 Present':o?.rip==='notseen'?'未見跡象 Not observed':'未確認 Unknown'}</b></div><div>現場破浪<small>Observed breaking height</small><b>${num(o?.breaking)} m</b></div><div>救生員警告<small>Lifeguard warnings</small><b>${o?.warning==='danger'?'禁止入水 Do not enter':o?.warning==='checked'?'已詢問 Checked':'未確認 Unknown'}</b></div></div><p class="caption">${o?'你的現場記錄 Your observation · '+localTime(new Date(o.at)).replace('T',' '):past?'上次記錄已過期或不適用所選時段 · Recheck required':'未確認現場 · No local observations'}。記錄只適用此浪點目前小時，30 分鐘後失效。</p>
 <div class="links"><a class="btn" href="${tideLink(spot)}" target="_blank" rel="noopener noreferrer">官方潮汐 Tide table</a><a class="btn" href="https://beachsafe.org.au/" target="_blank" rel="noopener noreferrer">巡邏／警告 Beachsafe</a></div>
 <details><summary>點樣計算？ · Assessment rules</summary><p class="caption">新手風浪條件：浪高 0.3–1.0 m、週期 ≤11 s、風 ≤約22 km/h（向岸風 ≤約17）。浪高 >1.5 m、週期 >13 s 或風 >約33 km/h（向岸風 >約28）列為較高風險。一般模式門檻較寬。現場警告／離岸流優先；出發建議按未過時嘅日照風浪模型篩選；落水判斷另需現場資料，未確認就顯示「暫不能判斷能否落水」。這是 App 篩選規則，並非經驗證的安全評估。</p></details><p class="caption">未接入即時離岸流、破浪或封灘資料。以下由你按現場／救生員資訊填寫；「未見」唔代表不存在。</p>
 ${nowHour&&!data.stale?`<details><summary>更新現場記錄 · Record observations</summary><form id="localForm" class="local-form">
 <label>潮汐／進出水位 Tide & access<select name="tide">${option('unknown','未確認 Unknown','tide')}${option('checked','已核對潮表及進出水位 Checked','tide')}${option('adverse','潮位不利／通道受阻 Adverse','tide')}</select></label>
 <label>離岸流 Rip current<select name="rip">${option('unknown','未確認 Unknown','rip')}${option('notseen','未見明顯跡象 Not observed','rip')}${option('present','已見／獲警告離岸流 Present','rip')}</select></label>
 <label>實際破浪高度 Breaking wave height (m)<input name="breaking" type="number" step="0.1" min="0" max="30" placeholder="未量度留空 · Unknown" value="${Number.isFinite(o?.breaking)?o.breaking:''}"></label>
 <label>救生員／封灘警告 Lifeguard warnings<select name="warning">${option('unknown','未確認／無救生員 Unknown','warning')}${option('checked','已向救生員確認無禁止入水警告 Checked','warning')}${option('danger','封灘／紅旗／禁止入水 Do not enter','warning')}</select></label>
 <button class="btn" type="submit">保存並重新評估 Save & assess</button><button class="btn" type="button" id="clearLocal">清除 Clear</button></form></details>`:'<p class="caption">未來時段／離線資料不能沿用目前觀察。Future and cached forecasts require fresh checks.</p>'}
 </section>`;
}
function bindObservations(data,spot){
 const form=$('localForm');if(!form)return;
 form.onsubmit=e=>{e.preventDefault();const f=new FormData(form),raw=f.get('breaking');write('observation:'+spot.id,{at:Date.now(),tide:f.get('tide'),rip:f.get('rip'),warning:f.get('warning'),breaking:raw===''?null:Number(raw)});renderForecast(data,spot);bindObservations(data,spot);};
 $('clearLocal').onclick=()=>{write('observation:'+spot.id,null);renderForecast(data,spot);bindObservations(data,spot);};
}
async function request(url) {
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),18000);
 try {const response=await fetch(url,{signal:controller.signal});
 if(!response.ok) throw new Error(`資料服務暫不可用 (${response.status})`);
 const json=await response.json();if(!json.hourly?.time?.length) throw new Error('未收到預報資料');return json;
 }finally{clearTimeout(timer);}
}
async function getForecast(spot,force=false) {
 const candidate=memory.get(spot.id)||read('forecast:'+spot.id,null);
 const saved=candidate?.rows?.length?candidate:null;
 if(!force && saved && saved.schema===2 && !saved.stale && Date.now()-saved.at<15*60e3) {memory.set(spot.id,saved);return {...saved,stale:!navigator.onLine};}
 if(pending.has(spot.id)) return pending.get(spot.id);
 const task=(async()=>{
 try {
 const base={latitude:spot.lat,longitude:spot.lon,timezone:TZ,forecast_days:10};
 const marine=new URL('https://marine-api.open-meteo.com/v1/marine');
 marine.search=new URLSearchParams({...base,hourly:'wave_height,wave_period,wave_direction,wind_wave_height,swell_wave_height,sea_surface_temperature,sea_level_height_msl,swell_wave_period,swell_wave_direction'});
 const weather=new URL('https://api.open-meteo.com/v1/forecast');
 weather.search=new URLSearchParams({...base,hourly:'wind_speed_10m,wind_direction_10m,temperature_2m,apparent_temperature,is_day',wind_speed_unit:'kmh'});
 const [m,w]=await Promise.all([request(marine),request(weather)]);
 const wi=new Map(w.hourly.time.map((t,i)=>[t,i]));
 const rows=m.hourly.time.map((time,i)=>{const row={time};for(const [k,v] of Object.entries(m.hourly))if(k!=='time')row[k]=v[i];const j=wi.get(time);for(const [k,v]of Object.entries(w.hourly))if(k!=='time')row[k]=j===undefined?null:v[j];return row;});
 const data={rows,at:Date.now(),schema:2};memory.set(spot.id,data);write('forecast:'+spot.id,data);return data;
 }catch(error){if(saved)return {...saved,stale:true};throw error;}
 })();pending.set(spot.id,task);try{return await task;}finally{pending.delete(spot.id);}
}
function current(rows) {const now=localTime().slice(0,13)+':00';return rows.find(r=>r.time===now)||rows.find(r=>r.time>now)||null;}
function bestWindow(rows,spot) {
 const now=localTime(),candidates=[];
 for(let i=0;i<rows.length-1;i++) {const a=rows[i],b=rows[i+1];
 // UTC here measures spacing between local labels, independent of device timezone.
 if(a.time<now || a.is_day!==1 || b.is_day!==1 || Date.parse(b.time+'Z')-Date.parse(a.time+'Z')!==3600000)continue;
 if(modelVerdict(a,spot).level!=='ok'||modelVerdict(b,spot).level!=='ok')continue;
 candidates.push({a,b,wind:Math.max(a.wind_speed_10m,b.wind_speed_10m)});
 }return candidates.sort((a,b)=>a.wind-b.wind)[0];
}
function metric(name,en,value,unit,hint,ico){return `<div class="metric">${icon(ico)}<div><div class="name">${name}<small>${en}</small></div><strong>${value} <span>${unit}</span></strong><div class="caption">${hint}</div></div></div>`;}
function tideLink(spot){const south=/victor|fleurieu|south coast/i.test(spot.region);return `https://www.bom.gov.au/ntc/IDO59001/IDO59001_${localTime().slice(0,4)}_SA_${south?'TP006':'TP001'}.pdf`;}
function tripDecision(rows,spot,stale=false){
 const known=rows.map(r=>observation(spot,r)).find(Boolean);
 if(known&&(known.warning==='danger'||known.rip==='present'||known.tide==='adverse'||known.breaking>(state.beginner?1.5:2.2)))return {level:'bad',zh:'唔建議為滑浪出發',en:'Skip the surf trip',reason:'已有現場危險或不利潮位記錄，先等情況更新。',best:null};
 if(stale)return {level:'meh',zh:'資料不足，暫難判斷',en:'Fresh forecast needed',reason:'目前係舊資料，請連線更新後再決定。',best:null};
 if(state.beginner&&spot.beginner===false)return {level:'bad',zh:'唔建議為滑浪出發',en:'Not suitable for beginners',reason:'此浪點屬進階，唔適合目前選用嘅新手模式。',best:null};
 const future=rows.filter(r=>r.time>=localTime().slice(0,13)+':00');
 if(!future.length||future.some(r=>r.is_day==null))return {level:'meh',zh:'資料不足，暫難判斷',en:'Forecast incomplete',reason:'未有足夠時段或日照預報，請更新資料或選其他日期。',best:null};
 const daylight=future.filter(r=>r.is_day===1);
 if(!daylight.length)return {level:'meh',zh:'未必值得專程去',en:'No daylight window',reason:'所選日期未有剩餘日照時段可供推薦，可查看其他日期。',best:null};
 const valid=daylight.filter(r=>[r.wave_height,r.wave_period,r.wind_speed_10m].every(Number.isFinite));
 if(valid.length!==daylight.length)return {level:'meh',zh:'資料不足，暫難判斷',en:'Forecast incomplete',reason:'部分日照時段缺少浪高、週期或風力預報。',best:null};
 const best=bestWindow(daylight,spot);
 if(best)return {level:'ok',zh:'值得考慮出發',en:'Worth considering',reason:`預報 ${best.a.time.slice(11)}–${best.b.time.slice(11)} 浪高 ${num(Math.min(best.a.wave_height,best.b.wave_height))}–${num(Math.max(best.a.wave_height,best.b.wave_height))} m、風力不高於 ${num(best.wind,0)} km/h，符合所選程度嘅較溫和門檻。出發仍需預留車程。`,best};
 if(valid.every(r=>modelVerdict(r,spot).level==='bad'))return {level:'bad',zh:'唔建議為滑浪出發',en:'Skip the surf trip',reason:'剩餘日照時段嘅浪高、週期或風力均超出所選程度門檻。',best:null};
 const flat=valid.every(r=>r.wave_height<(state.beginner?.3:.4));
 return {level:'meh',zh:'未必值得專程去',en:'May not be worth the trip',reason:flat?'預報浪太細，可能唔夠浪練習；住附近可以先睇 Cam。':'未有連續兩個整點同時符合較溫和條件；可能風較強、浪唔理想或時段太短。',best:null};
}
function entryDecision(row,spot,stale=false){
 const v=verdict(row,spot),o=observation(spot,row);
 if(v.level==='bad')return {...v,zh:'不要落水',en:'Do not enter'};
 if(stale)return {level:'meh',zh:'暫不能判斷能否落水',en:'Cannot assess entry yet',reason:'預報已過時，請更新資料及重新確認現場。'};
 if(!row||row.time.slice(0,13)!==localTime().slice(0,13))return {level:'meh',zh:'到場後先確認',en:'Check on arrival',reason:'未來預報唔能夠確認當時嘅離岸流、破浪或救生員警告。'};
 if(row.is_day!==1)return {level:'meh',zh:'暫不建議落水',en:'No daylight confirmation',reason:'目前屬夜間或缺少日照資料，不能確認可見度及現場條件。'};
 if(!o||o.tide==='unknown'||o.rip==='unknown'||o.warning==='unknown'||!Number.isFinite(o.breaking))return {level:'meh',zh:'暫不能判斷能否落水',en:'Cannot assess entry yet',reason:'仍需確認潮位、離岸流、實際破浪及救生員指示。未確認唔等於危險，亦唔等於安全。'};
 if(v.level==='ok')return {level:'ok',zh:'可考慮落水，依現場指示',en:'Consider entry; follow local advice',reason:'預報及你最近嘅現場記錄未觸發本模式門檻。這不是安全保證；情況有變應停止並重新確認。'};
 return {level:'meh',zh:'先留岸觀察／問救生員',en:'Wait and ask a lifeguard',reason:v.reason};
}
function renderForecast(data,spot) {
 const days=[...new Set(data.rows.map(r=>r.time.slice(0,10)))],today=localTime().slice(0,10);
 if(!days.includes(state.day))state.day=days.includes(today)?today:days[0];
 $('daySelect').innerHTML=days.map(d=>`<option ${d===state.day?'selected':''}>${d}</option>`).join('');
 const day=state.mode==='today'?today:state.day,dayRows=data.rows.filter(r=>r.time.startsWith(day));
 const row=day===today?current(dayRows):dayRows.find(r=>r.time.endsWith('T12:00'))||dayRows[0],v=verdict(row,spot),r=row||{};
 const trip=tripDecision(dayRows,spot,data.stale),entry=entryDecision(row,spot,data.stale),best=trip.best;
 const hourly=day===today?dayRows.filter(r=>r.time>=localTime().slice(0,13)+':00'):dayRows;
 const rowHtml=x=>{const v=modelVerdict(x,spot);return `<div class="hour-row"><b>${x.time.slice(11)}<small>${x.is_day===0?'夜間 Night':''}</small></b><span>${icon('wave')}${num(x.wave_height)} m</span><span>${icon('wind')}${num(x.wind_speed_10m,0)}<small>km/h</small></span><span class="tag ${v.level}">${v.level==='ok'?'較溫和 Milder':v.level==='bad'?'較高風險 Caution':'未達理想 Fair'}</span></div>`;};
 $('forecastContent').innerHTML=`
 <section class="hero"><div class="hero-top"><span class="caption">${esc(day)} · ${r.time?esc(r.time.slice(11)):'無資料'} ${day===today?'目前 Current':'預報 Forecast'}</span><span class="tag">${state.beginner?'新手模式 Beginner':'一般模式 Standard'}</span></div><div class="decision-label">值唔值得出發？ · Surf trip</div><h1>${trip.zh}</h1><div class="status-en">${trip.en}</div><p>${trip.reason}</p></section>
 <section class="panel entry-decision"><h2>現場可唔可以落水？ <small>Water entry</small></h2><strong class="entry-title ${entry.level}">${entry.zh}</strong><div class="status-en">${entry.en}</div><p>${entry.reason}</p><a class="btn" href="#localConditions">確認現場因素 · Local checks</a></section>
 <section class="panel best">${icon('sun')}<div><div>模型候選時段 <small>Potential window</small></div><strong>${best?`${best.a.time.slice(11)}–${best.b.time.slice(11)}`:'暫未有合適時段'}</strong><div class="caption">${best?'僅風浪模型較溫和；落水另看現場判斷 · Check water-entry advice':data.stale?'舊資料不提供時段推薦 · Cached forecast':'只比較未過時嘅日照時段 · Daylight only'}</div></div></section>
 <section class="metrics">${metric('浪高','Wave height',num(r.wave_height),'m','模型有效波高 · Model waves','wave')}${metric('風力','Wind speed',num(r.wind_speed_10m,0),'km/h',relation(r.wind_direction_10m,spot.beachFacingDeg),'wind')}${metric('浪週期','Wave period',num(r.wave_period,0),'秒 s',r.wave_period>=12?'長週期 · Long period':'兩個浪峰間距 · Wave interval','wave')}${metric('水溫','Water temperature',num(r.sea_surface_temperature,0),'°C',Number.isFinite(r.sea_surface_temperature)?'留意保暖 · Wetsuit advised':'暫無水溫資料 · Unavailable','temp')}</section>
 ${assessmentPanel(data,spot,row)}
 <section class="panel hours"><h2>逐小時風浪模型 <small>Hourly model</small></h2>${hourly.length?hourly.slice(0,4).map(rowHtml).join(''):'今日未有可顯示時段'}${hourly.length>4?`<details><summary>展開其餘 ${hourly.length-4} 小時 · More hours</summary>${hourly.slice(4).map(rowHtml).join('')}</details>`:''}</section>
 <details class="panel"><summary>更多天氣資料 · Weather details</summary><div class="detail-grid">${[['氣溫','Air temperature',r.temperature_2m,'°C'],['體感溫度','Feels like',r.apparent_temperature,'°C'],['湧浪','Swell height',r.swell_wave_height,'m'],['風浪','Wind wave height',r.wind_wave_height,'m'],['湧浪週期','Swell period',r.swell_wave_period,'s'],['湧浪方向','Swell direction',r.swell_wave_direction,'°'],['浪向','Wave direction',r.wave_direction,'°'],['風向','Wind direction',r.wind_direction_10m,'°']].map(([zh,en,val,u])=>`<div>${zh}<small>${en}</small><b>${num(val,u==='m'?1:0)} ${u}</b></div>`).join('')}</div></details>
 <section class="panel"><h2>出發前確認 <small>Before you go</small></h2><p class="caption">${esc(spot.notes||'留意當地風浪、水流及救生員指示。')}</p><div class="links"><a class="btn" href="${tideLink(spot)}" target="_blank" rel="noopener noreferrer">潮汐表 Tide · BoM</a><a class="btn" href="https://auswaves.org/sa-waves/" target="_blank" rel="noopener noreferrer">實測 Observations</a></div>${spot.camUrl?`<a class="btn cam" href="${esc(spot.camUrl)}" target="_blank" rel="noopener noreferrer">${icon('camera')}查看海灘 Cam · Webcam</a>`:'<p class="caption">此浪點未有 Cam · No webcam available</p>'}</section><p class="disclaimer">模型預報，落水前確認現場 · Check local conditions</p>`;
 $('updatedAt').textContent=`${data.stale?'離線／舊資料 Cached':'已更新 Updated'} · ${localTime(new Date(data.at)).replace('T',' ')} · 南澳`;
 $('updatedAt').classList.toggle('offline',!!data.stale);$('notice').hidden=!data.stale;
 if(data.stale)$('notice').textContent='目前顯示上次儲存資料，唔代表最新浪況。Cached forecast — check the timestamp.';
}
async function showForecast(force=false) {
 const token=++renderToken,spot=state.spots.find(s=>s.id===state.spot);if(!spot)return;
 $('dayRow').hidden=state.mode!=='next10';$('favorite').innerHTML=icon('heart');$('favorite').setAttribute('aria-pressed',String(state.favorites.includes(spot.id)));
 $('forecastContent').innerHTML='<div class="loading">正在載入浪況…<br><small>Loading forecast</small></div>';$('notice').hidden=true;
 try{const data=await getForecast(spot,force);if(token!==renderToken||state.view!=='forecast')return;renderForecast(data,spot);bindObservations(data,spot);}
 catch(error){if(token!==renderToken)return;$('forecastContent').innerHTML=`<div class="panel error"><h2>暫時未能載入</h2><p class="caption">${esc(error.message)} · 請稍後再試。</p><button class="btn" id="retry">重新載入 Retry</button></div>`;$('updatedAt').textContent='資料未更新 · Update unavailable';$('retry').onclick=()=>showForecast(true);}
}
function distance(a,b){const r=Math.PI/180,x=(b.lon-a.lon)*r*Math.cos((a.lat+b.lat)*r/2),y=(b.lat-a.lat)*r;return 6371*Math.hypot(x,y);}
function visibleSpots(){let spots=state.spots;if(state.view==='favorites')spots=spots.filter(s=>state.favorites.includes(s.id));if(state.filter==='beginner')spots=spots.filter(s=>s.beginner);if(state.filter==='nearby'){const selected=state.spots.find(s=>s.id===state.spot);spots=[...spots].sort((a,b)=>distance(a,selected)-distance(b,selected)).filter(s=>distance(s,selected)<=35);}return spots;}
function renderSpotCards(){
 const spots=visibleSpots();
 $('spotCards').innerHTML=spots.length?spots.map(s=>{const data=memory.get(s.id),row=data?current(data.rows):null,v=data&&!data.failed?tripDecision(data.rows.filter(r=>r.time.startsWith(localTime().slice(0,10))),s,data.stale):null;
 return `<article class="spot-card"><div class="spot-symbol">${icon('wave')}</div><div class="spot-copy"><h2>${esc(s.name)}</h2><span class="tag ${s.beginner?'':'meh'}">${s.beginner?'新手參考 Beginner':'進階浪點 Experienced'}</span><p>${data?.failed?'暫未有資料 Unavailable':data?`${num(row?.wave_height)} m · ${num(row?.wind_speed_10m,0)} km/h${data.stale?' · 舊資料 Cached':''}`:'預報載入中 Loading…'}</p>${v?`<span class="tag ${v.level}">出發：${v.zh}<br>${v.en}</span>`:''}<p class="caption">${esc(s.notes||s.region)}</p><div class="spot-actions"><button class="btn" data-spot="${s.id}">睇詳情 Details</button><button class="icon-btn" data-save="${s.id}" aria-label="收藏 ${esc(s.name)}" aria-pressed="${state.favorites.includes(s.id)}">${icon('heart')}</button></div></div></article>`;
 }).join(''):'<div class="empty">未有符合條件嘅浪點<br><small>可切換篩選，或點擊心形加入收藏。</small></div>';
 $('spotCards').querySelectorAll('[data-spot]').forEach(b=>b.onclick=()=>{state.spot=b.dataset.spot;write('spot',state.spot);$('spotSelect').value=state.spot;switchView('forecast');});
 $('spotCards').querySelectorAll('[data-save]').forEach(b=>b.onclick=()=>{toggleFavorite(b.dataset.save);renderSpotCards();});
 if(map){markers.forEach(m=>map.removeLayer(m));markers=spots.map(s=>window.L.marker([s.lat,s.lon],{icon:window.L.divIcon({className:'map-pin',html:icon('pin'),iconSize:[30,36],iconAnchor:[15,34]})}).addTo(map).bindPopup(esc(s.name)).on('click',()=>{state.spot=s.id;write('spot',s.id);$('spotSelect').value=s.id;switchView('forecast');}));}
}
async function loadSpots(force=false){
 renderSpotCards();const todo=[...visibleSpots()];
 await Promise.all(Array.from({length:3},async()=>{while(todo.length){const s=todo.shift();try{memory.set(s.id,await getForecast(s,force));}catch{memory.set(s.id,{rows:[],at:0,failed:true});}if(['spots','favorites'].includes(state.view))renderSpotCards();}}));
}
function toggleFavorite(id){state.favorites=state.favorites.includes(id)?state.favorites.filter(x=>x!==id):[...state.favorites,id];write('favorites',state.favorites);}
function initMap(){if(!window.L){$('map').hidden=true;$('mapHint').hidden=false;return;}if(!map){map=window.L.map('map').setView([-35.3,138.57],10);window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:18,attribution:'© OpenStreetMap'}).on('tileerror',()=>{$('mapHint').hidden=false;$('mapHint').textContent='地圖底圖暫未載入，仍可點選標記或下方浪點。Map tiles unavailable.';}).addTo(map);}setTimeout(()=>map.invalidateSize(),0);}
function switchView(view){
 state.view=view;++renderToken;$('notice').hidden=true;$('forecastView').hidden=view!=='forecast';$('spotsView').hidden=!['spots','favorites'].includes(view);$('settingsView').hidden=view!=='settings';
 document.querySelectorAll('[data-view]').forEach(b=>{b.classList.toggle('active',b.dataset.view===view);b.setAttribute('aria-current',b.dataset.view===view?'page':'false');});
 if(view==='forecast')showForecast();if(['spots','favorites'].includes(view)){$('spotsTitle').textContent=view==='favorites'?'收藏浪點 · Saved spots':'揀個適合你嘅浪點';initMap();loadSpots();}window.scrollTo(0,0);
}
$('refresh').onclick=()=>state.view==='forecast'?showForecast(true):['spots','favorites'].includes(state.view)?loadSpots(true):null;
$('spotSelect').onchange=e=>{state.spot=e.target.value;write('spot',state.spot);showForecast();};
$('favorite').onclick=()=>{toggleFavorite(state.spot);$('favorite').setAttribute('aria-pressed',String(state.favorites.includes(state.spot)));};
$('compare').onclick=()=>switchView('spots');$('daySelect').onchange=e=>{state.day=e.target.value;showForecast();};
$('beginner').checked=state.beginner;$('beginner').onchange=e=>{state.beginner=e.target.checked;write('beginner',state.beginner);};
document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{state.mode=b.dataset.mode;document.querySelectorAll('[data-mode]').forEach(x=>x.classList.toggle('active',x===b));showForecast();});
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>switchView(b.dataset.view));
document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{state.filter=b.dataset.filter;document.querySelectorAll('[data-filter]').forEach(x=>x.classList.toggle('active',x===b));loadSpots();});
document.querySelector('.brand').onclick=e=>{e.preventDefault();switchView('forecast');};
async function init(){try{const r=await fetch('./spots.json');if(!r.ok)throw new Error('浪點資料未能載入');state.spots=await r.json();if(!state.spots.some(s=>s.id===state.spot))state.spot=state.spots[0].id;$('spotSelect').innerHTML=state.spots.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('');$('spotSelect').value=state.spot;await showForecast();}catch(e){$('forecastContent').innerHTML=`<div class="panel error">${esc(e.message)}<p>請重新整理頁面 · Please reload</p></div>`;}}
if('serviceWorker' in navigator){navigator.serviceWorker.register('./sw.js').catch(()=>{});let reloading=false;navigator.serviceWorker.addEventListener('controllerchange',()=>{if(!reloading){reloading=true;location.reload();}});}
init();

setInterval(()=>{if(document.visibilityState==='visible'&&state.view==='forecast'){const spot=state.spots.find(s=>s.id===state.spot),data=spot&&memory.get(spot.id);if(data?.rows?.length&&!$('localForm')?.contains(document.activeElement))showForecast();}},60000);
