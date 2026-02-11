const TZ = 'Australia/Adelaide';

const els = {
  spotSelect: document.getElementById('spotSelect'),
  btnRefresh: document.getElementById('btnRefresh'),
  updatedAt: document.getElementById('updatedAt'),
  summary: document.getElementById('summary'),
  pills: document.getElementById('pills'),
  chartTitle: document.getElementById('chartTitle'),
  table: document.getElementById('table'),
  camCard: document.getElementById('camCard'),
  camWrap: document.getElementById('camWrap'),
  toggleBeginner: document.getElementById('toggleBeginner'),
  learnBox: document.getElementById('learnBox'),
  compareCard: document.getElementById('compareCard'),
  compareTable: document.getElementById('compareTable'),
  dayRow: document.getElementById('dayRow'),
  daySelect: document.getElementById('daySelect'),
  mapEl: document.getElementById('map'),
};

let spots = [];
let mode = 'now';
let beginnerMode = true;
let selectedDay = null; // YYYY-MM-DD (used by next10)
let bomTides = null; // loaded from ./tides_bom.json (offline)

let map = null;
let markers = [];

function fmtDateTime(iso) {
  // iso is local-time string from Open-Meteo when timezone is set
  const d = new Date(iso);
  // when timezone is in request, times are local, but JS Date treats as UTC if no offset.
  // So we display iso substring instead for clarity.
  return iso.replace('T', ' ');
}

function degToDir(deg) {
  if (deg == null || Number.isNaN(deg)) return '—';
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  const i = Math.round(((deg % 360) / 22.5)) % 16;
  return dirs[i];
}

function mkPill(text, level) {
  const d = document.createElement('div');
  d.className = `pill ${level}`;
  d.textContent = text;
  return d;
}

function kmhToKnots(kmh) {
  if (kmh == null || Number.isNaN(kmh)) return null;
  return kmh * 0.539957;
}

function angDiff(a, b) {
  // minimal absolute difference between degrees
  const d = Math.abs(((a - b + 540) % 360) - 180);
  return d;
}

function windRelation(windDirDeg, beachFacingDeg) {
  // beachFacingDeg is the direction from beach toward open water.
  // Onshore wind comes from sea toward beach -> windDir approximately equals beachFacingDeg.
  if (windDirDeg == null || beachFacingDeg == null) return null;
  const dOn = angDiff(windDirDeg, beachFacingDeg);
  const dOff = angDiff(windDirDeg, (beachFacingDeg + 180) % 360);
  if (dOn <= 50) return 'onshore';
  if (dOff <= 50) return 'offshore';
  return 'cross';
}

function verdictGoNo({ waveH, periodS, windKmh, windDirDeg, beachFacingDeg, beginner }) {
  // Conservative beginner rubric inspired by common surf coaching guidance.
  // Also shows why: longer period = more energy; individual waves can exceed the "average".
  const windKt = kmhToKnots(windKmh);

  const rel = windRelation(windKmh!=null?windDirDeg:null, beachFacingDeg);

  // Defaults: beginner conservative, intermediate slightly looser
  const th = beginner ? {
    go:   { hMin: 0.3, hMax: 1.0, pMax: 11, windMaxKt: 12 },
    maybe:{ hMax: 1.5, pMax: 13, windMaxKt: 18 },
  } : {
    go:   { hMin: 0.4, hMax: 1.5, pMax: 13, windMaxKt: 18 },
    maybe:{ hMax: 2.2, pMax: 15, windMaxKt: 24 },
  };

  // If we know onshore/offshore, be more strict for beginners.
  if (beginner && rel === 'onshore') {
    th.go.windMaxKt = Math.min(th.go.windMaxKt, 9);
    th.maybe.windMaxKt = Math.min(th.maybe.windMaxKt, 15);
  }

  const missing = (waveH == null || periodS == null || windKt == null);
  if (missing) return { level: 'meh', label: '資料不足（Maybe）', reasons: ['模型資料未齊，建議睇 cam / 現場。'], wind: rel };

  const reasons = [];

  // NO-GO triggers
  if (waveH > th.maybe.hMax) reasons.push(`浪高過大（>${th.maybe.hMax.toFixed(1)}m）`);
  if (periodS >= 14 && beginner) reasons.push('周期偏長（Long period = more energy）');
  if (periodS > th.maybe.pMax) reasons.push(`周期偏長（>${th.maybe.pMax}s）`);
  if (windKt > th.maybe.windMaxKt) reasons.push(`風太大（>${Math.round(th.maybe.windMaxKt)}kt）`);

  if (reasons.length) {
    return { level: 'bad', label: beginner ? 'No‑Go（新手唔建議）' : 'No‑Go（風險較高）', reasons, wind: rel };
  }

  // GO conditions
  const okWave = waveH >= th.go.hMin && waveH <= th.go.hMax;
  const okPeriod = periodS <= th.go.pMax;
  const okWind = windKt <= th.go.windMaxKt;

  if (okWave && okPeriod && okWind) {
    return { level: 'ok', label: beginner ? 'Go（新手可玩）' : 'Go（可玩）', reasons: [], wind: rel };
  }

  // Otherwise Maybe
  if (!okWave) reasons.push(`浪高未落入理想範圍（${th.go.hMin.toFixed(1)}–${th.go.hMax.toFixed(1)}m）`);
  if (!okPeriod) reasons.push(`周期偏長（>${th.go.pMax}s → 能量較大）`);
  if (!okWind) reasons.push(`風偏大（>${Math.round(th.go.windMaxKt)}kt → 較亂）`);

  return { level: 'meh', label: beginner ? 'Maybe（睇 cam 再決定）' : 'Maybe（可考慮）', reasons, wind: rel };
}

async function fetchMarine(lat, lon) {
  const url = new URL('https://marine-api.open-meteo.com/v1/marine');
  url.searchParams.set('latitude', String(lat));
  url.searchParams.set('longitude', String(lon));
  url.searchParams.set('timezone', TZ);
  url.searchParams.set('hourly', [
    'wave_height',
    'wave_period',
    'wave_direction',
    'wind_wave_height',
    'swell_wave_height',
    'sea_surface_temperature',
    'sea_level_height_msl',
  ].join(','));
  url.searchParams.set('forecast_days', '10');

  const r = await fetch(url);
  if (!r.ok) throw new Error(`Marine API ${r.status}`);
  return await r.json();
}

async function fetchWeather(lat, lon) {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(lat));
  url.searchParams.set('longitude', String(lon));
  url.searchParams.set('timezone', TZ);
  url.searchParams.set('hourly', [
    'wind_speed_10m',
    'wind_direction_10m',
    'temperature_2m',
    'apparent_temperature'
  ].join(','));
  url.searchParams.set('forecast_days', '10');

  const r = await fetch(url);
  if (!r.ok) throw new Error(`Weather API ${r.status}`);
  return await r.json();
}

function zipHourly(marine, weather) {
  const t = marine.hourly.time;
  const out = [];
  const wIndex = new Map(weather.hourly.time.map((x,i)=>[x,i]));

  for (let i = 0; i < t.length; i++) {
    const ti = t[i];
    const j = wIndex.get(ti);
    out.push({
      time: ti,
      wave_height: marine.hourly.wave_height?.[i],
      wave_period: marine.hourly.wave_period?.[i],
      wave_direction: marine.hourly.wave_direction?.[i],
      wind_wave_height: marine.hourly.wind_wave_height?.[i],
      swell_wave_height: marine.hourly.swell_wave_height?.[i],
      sea_surface_temperature: marine.hourly.sea_surface_temperature?.[i],
      sea_level_height_msl: marine.hourly.sea_level_height_msl?.[i],
      wind_speed_10m: j != null ? weather.hourly.wind_speed_10m?.[j] : null,
      wind_direction_10m: j != null ? weather.hourly.wind_direction_10m?.[j] : null,
      temperature_2m: j != null ? weather.hourly.temperature_2m?.[j] : null,
      apparent_temperature: j != null ? weather.hourly.apparent_temperature?.[j] : null,
    });
  }
  return out;
}

function pickNow(rows) {
  // choose closest time >= now (local). Since rows' time is local string, compare string against local iso.
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth()+1).padStart(2,'0');
  const dd = String(now.getDate()).padStart(2,'0');
  const hh = String(now.getHours()).padStart(2,'0');
  const localIso = `${yyyy}-${mm}-${dd}T${hh}:00`;
  return rows.find(r => r.time >= localIso) || rows[0];
}

function filterToday(rows) {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  const prefix = `${yyyy}-${mm}-${dd}T`;
  return rows.filter(r => r.time.startsWith(prefix));
}

function filterNext3(rows) {
  // keep 72 hours from now
  const now = new Date();
  const end = new Date(now.getTime() + 72*3600*1000);
  // Compare using Date parsing best effort
  return rows.filter(r => {
    const dt = new Date(r.time);
    return dt >= now && dt <= end;
  });
}

function hourLabel(timeIso) {
  return timeIso.slice(11, 16);
}

function surfHeightLabel(m) {
  // Simple “shin/knee/waist/chest/head/overhead” scale for beginners
  if (m == null || Number.isNaN(m)) return '—';
  if (m < 0.3) return 'ankle';
  if (m < 0.6) return 'shin';
  if (m < 0.9) return 'knee';
  if (m < 1.2) return 'waist';
  if (m < 1.5) return 'chest';
  if (m < 1.8) return 'head';
  return 'overhead';
}

function modelConfidence(nowRow) {
  // crude confidence score for beginners (not scientific): penalize high wind, long period, big wave.
  let score = 100;
  const windKt = kmhToKnots(nowRow.wind_speed_10m) ?? 0;
  const p = nowRow.wave_period ?? 0;
  const h = nowRow.wave_height ?? 0;
  if (windKt > 18) score -= 25;
  else if (windKt > 12) score -= 15;
  if (p >= 14) score -= 20;
  else if (p >= 12) score -= 10;
  if (h > 1.8) score -= 20;
  else if (h > 1.2) score -= 10;
  if (score < 40) return { label: '低', score };
  if (score < 70) return { label: '中', score };
  return { label: '高', score };
}

function tideBand(rows, tideM) {
  if (!rows || !rows.length || tideM == null) return null;
  const vals = rows.map(r => r.sea_level_height_msl).filter(v => v != null).sort((a,b)=>a-b);
  if (!vals.length) return null;
  const min = vals[0], max = vals[vals.length-1];
  const span = max - min;
  if (span < 0.05) return { band: 'mid', pct: 0.5 };
  const pct = Math.max(0, Math.min(1, (tideM - min) / span));
  const band = pct < 0.33 ? 'low' : pct < 0.66 ? 'mid' : 'high';
  return { band, pct };
}

function tidePrefOk(pref, band) {
  if (!pref || !band) return null;
  const p = pref;
  if (p === 'any') return true;
  if (p === 'low') return band === 'low';
  if (p === 'mid') return band === 'mid';
  if (p === 'high') return band === 'high';
  if (p === 'mid-high') return band === 'mid' || band === 'high';
  if (p === 'mid-low') return band === 'mid' || band === 'low';
  return null;
}

function renderLearnBox() {
  els.learnBox.innerHTML = `
    <div><b>術語（Glossary）</b></div>
    <ul style="margin:6px 0 10px;padding-left:18px">
      <li><b>Surf height（shin/knee/waist…）</b>：將 Wave(m) 翻譯成身體高度，方便新手理解。</li>
      <li><b>Wave height</b>：模型嘅浪高（近似「有效浪高」概念），現場 sets 可能更大。</li>
      <li><b>Period（周期）</b>：時間越長 → 能量通常越大；常見 <b>sets / lulls</b>。</li>
      <li><b>風對岸（Wind relation）</b>：<b>Offshore</b>=由岸吹向海（通常更乾淨）；<b>Onshore</b>=由海吹向岸（通常更碎/亂）；<b>Cross</b>=側風。</li>
      <li><b>Air / Feels</b>：氣溫 / 體感（含風寒等）。</li>
      <li><b>Water</b>：水溫（決定 wetsuit 厚度）。</li>
      <li><b>Tide（潮汐）</b>：<b>Rising</b>=漲潮、<b>Falling</b>=退潮、<b>Slack</b>=轉潮/接近平水。每個浪點都有偏好潮位（tidePref）。</li>
    </ul>

    <div><b>30 秒決定去唔去（新手版）</b></div>
    <ol style="margin:6px 0 10px;padding-left:18px">
      <li><b>先睇結論</b>：Go / Maybe / No‑Go</li>
      <li><b>再睇 4 個數字</b>（最重要）：Wave / Period / Wind / Tide</li>
      <li><b>最後一關：Cam</b>（見到乾淨、有線先去；白花/亂就換點或唔去）</li>
    </ol>

    <div><b>最直覺解讀（只睇呢幾行就夠）</b></div>
    <ul style="margin:6px 0 10px;padding-left:18px">
      <li><b>Wave（m）+ 身高</b>：<b>shin/knee</b> 新手舒服；<b>waist</b> 開始有力要小心；<b>chest+</b> 新手多數太大。</li>
      <li><b>Period（秒）</b>：≤10s 通常溫和；11–13s 有 sets；<b>≥14s</b> sets 可能突然大一截（新手保守）。</li>
      <li><b>Wind（kt）+ Offshore/Onshore</b>：≤10kt 理想；10–15kt 尚可；<b>>15kt</b> 多數亂。<b>Offshore ✅</b> 加分；<b>Onshore ⚠️</b> 扣分。</li>
      <li><b>Tide</b>：本頁 Low/Mid/High 係模型 proxy（趨勢用）；要精準時間請按 <b>官方潮汐（BoM）</b>。</li>
    </ul>

    <div><b>潮汐點先叫好？（超簡版）</b></div>
    <ul style="margin:6px 0 10px;padding-left:18px">
      <li><b>沙灘浪（beach break）</b>：通常中潮較穩；太低易 closeout/刮底，太高可能變散無力。</li>
      <li><b>礁石浪（reef）</b>：太低更危險；通常需要唔同於沙灘浪嘅潮位（依 spot 而定）。</li>
      <li>所以我用 <b>Low/Mid/High</b> + <b>tidePref</b>（偏好）去提示：✅/⚠️。</li>
    </ul>

    <div><b>顏色（Colour）</b></div>
    <ul style="margin:6px 0 10px;padding-left:18px">
      <li><span class="badge ok">綠</span> = 較適合；<span class="badge meh">黃</span> = 普通/可考慮；<span class="badge bad">紅</span> = 不適合/風險高。</li>
      <li><b>信心（Confidence）</b>：係「我對呢個模型判斷有幾放心」，唔係「越大越適合」。信心高＝變數少/較乾淨；信心低＝風大/浪大/長周期，請更依賴 cam/現場。</li>
    </ul>

    <div><b>新手判斷（Beginner Go/Maybe/No‑Go）</b></div>
    <ul style="margin:6px 0 0;padding-left:18px">
      <li><b>Go</b>：Wave 約 0.3–1.0m、Period ≤11s、Wind ≤12kt（偏乾淨、易練）。</li>
      <li><b>Maybe</b>：1.0–1.5m 或 Period 11–13s 或 Wind 12–18kt（建議先睇 cam）。</li>
      <li><b>No‑Go</b>：Wave >1.5m 或 Period >13s（尤其 ≥14s）或 Wind >18kt（對新手風險高）。</li>
    </ul>

    <div style="margin-top:8px">提示：結果係 Maybe/No‑Go → 先睇 <b>Cam</b>；同時留意救生員/警告/離岸流（rip）。</div>
  `;
}

function groupByDay(rows) {
  const map = new Map();
  for (const r of rows) {
    const day = r.time.slice(0, 10);
    if (!map.has(day)) map.set(day, []);
    map.get(day).push(r);
  }
  return map;
}

function tideTrend(rows, idx) {
  // Use last 3 hours slope to infer rising/falling (tide proxy)
  const here = rows[idx]?.sea_level_height_msl;
  const prev = rows[Math.max(0, idx - 3)]?.sea_level_height_msl;
  if (here == null || prev == null) return null;
  const d = here - prev;
  if (Math.abs(d) < 0.02) return 'slack';
  return d > 0 ? 'rising' : 'falling';
}

function nextTideExtrema(rows, startIdx) {
  // Estimate next high/low tide times from sea_level_height_msl turning points.
  // This is NOT official tide tables — purely derived from the model proxy series.
  const out = { nextHigh: null, nextLow: null };
  if (!rows || !rows.length) return out;

  for (let i = Math.max(1, startIdx + 1); i < rows.length - 1; i++) {
    const a = rows[i - 1]?.sea_level_height_msl;
    const b = rows[i]?.sea_level_height_msl;
    const c = rows[i + 1]?.sea_level_height_msl;
    if (a == null || b == null || c == null) continue;

    // simple local max/min
    if (!out.nextHigh && b >= a && b >= c && (b - Math.min(a, c)) >= 0.02) {
      out.nextHigh = { time: rows[i].time, height: b };
    }
    if (!out.nextLow && b <= a && b <= c && (Math.max(a, c) - b) >= 0.02) {
      out.nextLow = { time: rows[i].time, height: b };
    }
    if (out.nextHigh && out.nextLow) break;
  }
  return out;
}

function bomStationForSpot(spot) {
  const r = (spot.region || '').toLowerCase();
  // Adelaide metro / Port Noarlunga region -> Port Adelaide tide table
  if (r.includes('adelaide')) return 'bom_port_adelaide_outer_harbor';
  // Victor Harbor / Fleurieu / South Coast -> Victor Harbor tide table
  if (r.includes('victor') || r.includes('fleurieu') || r.includes('south coast')) return 'bom_victor_harbor';
  // fallback
  return 'bom_port_adelaide_outer_harbor';
}

function parseLocalIsoTime(iso) {
  // iso like YYYY-MM-DDTHH:MM
  return new Date(iso.replace(' ', 'T'));
}

function bomNextHighLow(spot, isoTime) {
  // returns nextHigh/nextLow events from BoM JSON (official tables)
  if (!bomTides?.stations) return null;
  const sid = bomStationForSpot(spot);
  const station = bomTides.stations[sid];
  if (!station?.days) return null;

  const date = isoTime.slice(0, 10);
  const timeHHMM = isoTime.slice(11, 16);

  function nextFromDate(d) {
    const evs = station.days[d];
    if (!evs) return [];
    // ensure sorted
    return [...evs].sort((a,b)=>a.time.localeCompare(b.time));
  }

  const today = nextFromDate(date);
  const tomorrow = nextFromDate(addDays(date, 1));
  const all = [];
  for (const e of today) all.push({ ...e, date });
  for (const e of tomorrow) all.push({ ...e, date: addDays(date, 1) });

  const upcoming = all.filter(e => (e.date > date) || (e.date === date && e.time >= timeHHMM));
  if (!upcoming.length) return null;

  const nextHigh = upcoming.find(e => e.type === 'high') || null;
  const nextLow = upcoming.find(e => e.type === 'low') || null;
  return { sid, nextHigh, nextLow };
}

function addDays(yyyyMMdd, delta) {
  const d = new Date(yyyyMMdd + 'T00:00:00');
  d.setDate(d.getDate() + delta);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function wetsuitHint(waterC, feelsC) {
  // Beginner-friendly wetsuit suggestion (mm) based on common brand charts.
  // Use water temp primarily; falls back to feels-like.
  const t = waterC ?? feelsC;
  if (t == null) return null;

  // Rough mapping (C):
  // 23-21: 1-2mm jacket; 20-19: 2mm spring; 18-16: 3/2 full; 15-13: 4/3 full; 12-10: 4/3-5/4 hooded.
  if (t >= 21) return '建議：Jacket 1–2mm / rashie（視風）';
  if (t >= 19) return '建議：Spring 2mm 或薄 full suit';
  if (t >= 16) return '建議：Full suit 3/2mm';
  if (t >= 13) return '建議：Full suit 4/3mm（可加 boots）';
  if (t >= 10) return '建議：Hooded 4/3 或 5/4mm（加 boots / gloves）';
  return '建議：厚 suit（5/4+）+ boots/gloves（非常凍）';
}

function bestBlocks(rows, topN = 2, minLen = 2) {
  // rows: sorted by time
  // Create contiguous blocks where verdict is ok/meh; rank by ok>meh, low wind, decent wave
  const blocks = [];
  let cur = null;

  const rank = { ok: 2, meh: 1, bad: 0 };

  function pushCur() {
    if (cur && cur.len >= minLen) blocks.push(cur);
    cur = null;
  }

  for (const r of rows) {
    const vv = verdictGoNo({
      waveH: r.wave_height,
      periodS: r.wave_period,
      windKmh: r.wind_speed_10m,
      windDirDeg: r.wind_direction_10m,
      beachFacingDeg: r._beachFacingDeg,
      beginner: beginnerMode,
    });
    const okish = vv.level !== 'bad';
    if (!okish) {
      pushCur();
      continue;
    }
    if (!cur) {
      cur = { start: r.time, end: r.time, len: 1, bestLevel: vv.level, bestRank: rank[vv.level], minWindKt: kmhToKnots(r.wind_speed_10m) ?? 99, maxWave: r.wave_height ?? 0 };
    } else {
      cur.end = r.time;
      cur.len += 1;
      cur.bestRank = Math.max(cur.bestRank, rank[vv.level]);
      cur.bestLevel = cur.bestRank === 2 ? 'ok' : 'meh';
      cur.minWindKt = Math.min(cur.minWindKt, kmhToKnots(r.wind_speed_10m) ?? 99);
      cur.maxWave = Math.max(cur.maxWave, r.wave_height ?? 0);
    }
  }
  pushCur();

  blocks.sort((a,b) => {
    if (b.bestRank !== a.bestRank) return b.bestRank - a.bestRank;
    if (a.minWindKt !== b.minWindKt) return a.minWindKt - b.minWindKt;
    return b.maxWave - a.maxWave;
  });

  return blocks.slice(0, topN);
}

function renderSummary(spot, nowRow, todayRows, next3Rows) {
  const waveH = nowRow.wave_height;
  const periodS = nowRow.wave_period;
  const windKmh = nowRow.wind_speed_10m;
  const windKt = kmhToKnots(windKmh);
  const windDir = nowRow.wind_direction_10m;
  const waveDir = nowRow.wave_direction;

  const v = verdictGoNo({ waveH, periodS, windKmh, windDirDeg: windDir, beachFacingDeg: spot.beachFacingDeg, beginner: beginnerMode });

  function rankRows(rows) {
    const scored = (rows || []).map(r => {
      const vv = verdictGoNo({
        waveH: r.wave_height,
        periodS: r.wave_period,
        windKmh: r.wind_speed_10m,
        windDirDeg: r.wind_direction_10m,
        beachFacingDeg: spot.beachFacingDeg,
        beginner: beginnerMode,
      });
      return { time: r.time, ...vv, waveH: r.wave_height, periodS: r.wave_period, windKmh: r.wind_speed_10m };
    });
    scored.sort((a,b) => {
      const rank = { ok: 2, meh: 1, bad: 0 };
      if (rank[b.level] !== rank[a.level]) return rank[b.level] - rank[a.level];
      // tiebreak: prefer cleaner wind then a bit more wave
      const aw = kmhToKnots(a.windKmh) ?? 99;
      const bw = kmhToKnots(b.windKmh) ?? 99;
      if (aw !== bw) return aw - bw;
      return (b.waveH ?? 0) - (a.waveH ?? 0);
    });
    return scored;
  }

  // best 3 hours today
  const best = rankRows(todayRows).slice(0, 3);

  // (下一步可加：未來 3 日每日最佳時段；而家先保持簡潔)

  const windRel = v.wind ? (v.wind === 'offshore' ? 'Offshore ✅' : v.wind === 'onshore' ? 'Onshore ⚠️' : 'Cross') : '—';
  const reasonLine = v.reasons?.length ? `<div class="tiny" style="margin-top:6px">原因：${v.reasons.join('；')}</div>` : '';

  const ws = wetsuitHint(nowRow.sea_surface_temperature, nowRow.apparent_temperature);
  const wetsuitLine = ws ? `<div class="tiny" style="margin-top:6px">保暖：${ws}</div>` : '';

  // Tide trend near now (proxy)
  const idxNow = todayRows && todayRows.length ? todayRows.findIndex(x=>x.time===nowRow.time) : -1;
  const tTrend = idxNow >= 0 ? tideTrend(todayRows, idxNow) : null;
  const tideLabel = tTrend === 'rising' ? 'Rising tide' : tTrend === 'falling' ? 'Falling tide' : tTrend === 'slack' ? 'Slack tide' : '—';

  const tideM = nowRow.sea_level_height_msl;
  const tb = tideBand(todayRows, tideM);
  const bandLabel = tb ? (tb.band === 'low' ? 'Low' : tb.band === 'mid' ? 'Mid' : 'High') : '—';
  const prefOk = tidePrefOk(spot.tidePref, tb?.band);
  const prefText = spot.tidePref ? spot.tidePref : '—';
  const tidePrefLine = spot.tidePref ? `<div class="tiny" style="margin-top:6px">潮位：<b>${bandLabel}</b>（偏好：${prefText}${prefOk===true?' ✅':prefOk===false?' ⚠️':''}）</div>` : '';

  // Next high/low tide times
  // Prefer BoM official (offline JSON from your PDFs). Fallback to model proxy estimate.
  let tideTimesLine = '';
  const bom = bomNextHighLow(spot, nowRow.time);
  if (bom?.nextHigh || bom?.nextLow) {
    const nh = bom.nextHigh ? `${bom.nextHigh.date} ${bom.nextHigh.time} (${bom.nextHigh.height.toFixed(2)}m)` : '—';
    const nl = bom.nextLow ? `${bom.nextLow.date} ${bom.nextLow.time} (${bom.nextLow.height.toFixed(2)}m)` : '—';
    tideTimesLine = `<div class="tiny" style="margin-top:6px">潮汐時間來源：<b>BoM 官方預測表</b></div><div class="tiny" style="margin-top:4px">下一次高潮/低潮：High ${nh} · Low ${nl}</div>`;
  } else {
    const ex = nextTideExtrema(todayRows, Math.max(0, idxNow));
    const nh = ex.nextHigh ? `${hourLabel(ex.nextHigh.time)} (${ex.nextHigh.height.toFixed(2)}m)` : '—';
    const nl = ex.nextLow ? `${hourLabel(ex.nextLow.time)} (${ex.nextLow.height.toFixed(2)}m)` : '—';
    tideTimesLine = `<div class="tiny" style="margin-top:6px">潮汐時間來源：<b>模型（Open‑Meteo sea_level_height_msl）</b></div><div class="tiny" style="margin-top:4px">下一次高潮/低潮（估算）：High ${nh} · Low ${nl}　<span class="tiny">（按 BoM 睇官方時間）</span></div>`;
  }

  const conf = modelConfidence(nowRow);
  const confLine = `<div class=\"tiny\" style=\"margin-top:6px\">信心：<b>${conf.label}</b>（越大風/越長周期/越大浪 → 越難估）</div>`;

  // warnings (Surfline style)
  const warns = [];
  if (beginnerMode && nowRow.wave_period >= 14) warns.push('Long period：sets 可能更大（小心誤判）');
  if (beginnerMode && (kmhToKnots(nowRow.wind_speed_10m) ?? 0) > 18) warns.push('風偏大：較 choppy / 容易亂');
  if (beginnerMode && (nowRow.wave_height ?? 0) > 1.5) warns.push('浪偏大：新手風險高');
  const warnLine = warns.length ? `<div class=\"tiny\" style=\"margin-top:6px;color:var(--meh)\">⚠️ ${warns.join('；')}</div>` : '';

  // Next 3 days: best blocks (2-hour+) each day
  let next3Line = '';
  if (next3Rows && next3Rows.length) {
    const byDay = groupByDay(next3Rows);
    const days = Array.from(byDay.keys()).sort().slice(0, 3);
    const parts = [];
    for (const day of days) {
      const rows = byDay.get(day).map(r => ({...r, _beachFacingDeg: spot.beachFacingDeg}));
      const blocks = bestBlocks(rows, 1, 2);
      if (!blocks.length) continue;
      const b = blocks[0];
      const shortDay = day.slice(5);
      const start = hourLabel(b.start);
      const end = hourLabel(b.end);
      parts.push(`${shortDay} ${start}–${end} ${b.bestLevel==='ok'?'Go':'Maybe'}`);
    }
    if (parts.length) next3Line = `<div class="tiny" style="margin-top:6px">未來 3 日最佳（window）：${parts.join(' · ')}</div>`;
  }

  const notesLine = spot.notes ? `<div class=\"tiny\" style=\"margin-top:6px\">Spot：${spot.notes}</div>` : '';

  els.summary.innerHTML = `
    <div class="big">
      <strong>${v.label}</strong>
      <div class="tiny">${spot.name} · ${fmtDateTime(nowRow.time)}（${TZ}）</div>
      ${notesLine}
      ${refButtons(spot)}
      <div class="tiny" style="margin-top:6px">風對岸：<b>${windRel}</b>　潮汐：<b>${tideLabel}</b></div>
      ${best.length ? `<div class="tiny" style="margin-top:6px">今日較好時間：${best.map(x=>`${hourLabel(x.time)} ${x.level==='ok'?'Go':x.level==='meh'?'Maybe':'No'}`).join(' · ')}</div>` : ''}
      ${next3Line}
      ${reasonLine}
      ${warnLine}
      ${confLine}
      ${tidePrefLine}
      ${tideTimesLine}
      ${wetsuitLine}
    </div>
  `;

  els.pills.innerHTML = '';
  const p1 = mkPill(`Wave ${waveH?.toFixed?.(1) ?? '—'} m`, v.level);
  const p2 = mkPill(`Period ${periodS?.toFixed?.(0) ?? '—'} s`, v.level);
  const p3 = mkPill(`Wave dir ${degToDir(waveDir)} (${Math.round(waveDir??0)}°)`, 'meh');
  const p4 = mkPill(`Wind ${windKt!=null?windKt.toFixed(0):'—'} kt (${windRel.split(' ')[0]})`, v.level);
  const p5 = mkPill(`Wind dir ${degToDir(windDir)} (${Math.round(windDir??0)}°)`, 'meh');

  const airT = nowRow.temperature_2m;
  const feelT = nowRow.apparent_temperature;
  const waterT = nowRow.sea_surface_temperature;
  const p6 = mkPill(`Air ${airT!=null?airT.toFixed(0):'—'}°C`, 'meh');
  const p7 = mkPill(`Feels ${feelT!=null?feelT.toFixed(0):'—'}°C`, 'meh');
  const p8 = mkPill(`Water ${waterT!=null?waterT.toFixed(0):'—'}°C`, 'meh');
  const p9 = mkPill(`Tide ${tideM!=null?tideM.toFixed(2):'—'} m`, 'meh');

  [p1,p2,p4,p3,p5,p6,p7,p8,p9].forEach(p=>els.pills.appendChild(p));
  renderLearnBox();
}

function tempLevelC(tempC) {
  if (tempC == null || Number.isNaN(tempC)) return 'meh';
  if (tempC <= 13) return 'bad';
  if (tempC <= 16) return 'meh';
  return 'ok';
}

function waterTempLevelC(waterC) {
  // Based on common wetsuit guidance. E.g. Vissla: 18–16°C -> 3/2; 15–13°C -> 4/3.
  if (waterC == null || Number.isNaN(waterC)) return 'meh';
  if (waterC <= 13) return 'bad';
  if (waterC <= 16) return 'meh';
  return 'ok';
}

function tidePrefLevel(spot, band) {
  if (!spot?.tidePref || !band) return 'meh';
  const ok = tidePrefOk(spot.tidePref, band);
  if (ok === true) return 'ok';
  if (ok === false) return 'bad';
  return 'meh';
}

function metricLevel({ waveH, periodS, windKt }) {
  // metric-only coloring (rough) for beginners
  const beginner = beginnerMode;
  const go = beginner ? { hMin: 0.3, hMax: 1.0, pMax: 11, wMax: 12 } : { hMin: 0.4, hMax: 1.5, pMax: 13, wMax: 18 };
  const maybe = beginner ? { hMax: 1.5, pMax: 13, wMax: 18 } : { hMax: 2.2, pMax: 15, wMax: 24 };

  const wave = waveH == null ? 'meh' : (waveH >= go.hMin && waveH <= go.hMax) ? 'ok' : (waveH <= maybe.hMax ? 'meh' : 'bad');
  const period = periodS == null ? 'meh' : (periodS <= go.pMax) ? 'ok' : (periodS <= maybe.pMax ? 'meh' : 'bad');
  const wind = windKt == null ? 'meh' : (windKt <= go.wMax) ? 'ok' : (windKt <= maybe.wMax ? 'meh' : 'bad');
  return { wave, period, wind };
}

function verdictBadge(level) {
  const text = level==='ok' ? 'Go' : level==='meh' ? 'Maybe' : 'No';
  return `<span class="badge ${level}">${text}</span>`;
}

function renderTable(title, rows, spot) {
  els.chartTitle.textContent = title;

  const head = `
    <tr>
      <th>Verdict</th>
      <th>時間</th>
      <th>Wave(m)</th>
      <th>Period(s)</th>
      <th>Wind(kt)</th>
      <th>Air(°C)</th>
      <th>Feels(°C)</th>
      <th>Water(°C)</th>
      <th>Tide</th>
    </tr>
  `;

  const body = rows.map(r => {
    const windKt = kmhToKnots(r.wind_speed_10m);
    const v = verdictGoNo({
      waveH: r.wave_height,
      periodS: r.wave_period,
      windKmh: r.wind_speed_10m,
      windDirDeg: r.wind_direction_10m,
      beachFacingDeg: spot?.beachFacingDeg,
      beginner: beginnerMode,
    });

    const m = metricLevel({ waveH: r.wave_height, periodS: r.wave_period, windKt });

    const air = r.temperature_2m;
    const feel = r.apparent_temperature;
    const water = r.sea_surface_temperature;

    const airLv = tempLevelC(air);
    const feelLv = tempLevelC(feel);
    const waterLv = waterTempLevelC(water);

    // Tide band + preference coloring (if spot has tidePref)
    const dayRows = rows.filter(x => x.time.slice(0,10) === r.time.slice(0,10));
    const tb = tideBand(dayRows, r.sea_level_height_msl);
    const tideBandLabel = tb ? (tb.band === 'low' ? 'Low' : tb.band === 'mid' ? 'Mid' : 'High') : '—';
    const tideLv = tidePrefLevel(spot, tb?.band);

    return `
      <tr>
        <td>${verdictBadge(v.level)}</td>
        <td>${fmtDateTime(r.time).slice(5,16)}</td>
        <td class="cell ${m.wave}">${r.wave_height?.toFixed?.(1) ?? '—'} <span class="tiny">(${surfHeightLabel(r.wave_height)})</span></td>
        <td class="cell ${m.period}">${r.wave_period?.toFixed?.(0) ?? '—'}</td>
        <td class="cell ${m.wind}">${windKt!=null?windKt.toFixed(0):'—'}</td>
        <td class="cell ${airLv}">${air!=null?air.toFixed(0):'—'}</td>
        <td class="cell ${feelLv}">${feel!=null?feel.toFixed(0):'—'}</td>
        <td class="cell ${waterLv}">${water!=null?water.toFixed(0):'—'}</td>
        <td class="cell ${tideLv}">${tideBandLabel}</td>
      </tr>
    `;
  }).join('');

  els.table.innerHTML = head + body;
}

function refButtons(spot) {
  // Tide (BoM) + Observations (buoy)
  const bomPortAdelaide = 'https://www.bom.gov.au/ntc/IDO59001/IDO59001_2026_SA_TP001.pdf';
  const bomVictorHarbor = 'https://www.bom.gov.au/ntc/IDO59001/IDO59001_2026_SA_TP006.pdf';
  const auswavesSA = 'https://auswaves.org/sa-waves/';

  // crude region mapping (can refine per-spot later)
  const r = (spot.region || '').toLowerCase();
  const tideUrl = (r.includes('victor') || r.includes('fleurieu') || r.includes('south coast')) ? bomVictorHarbor : bomPortAdelaide;
  const obsUrl = auswavesSA;

  return `
    <div class="row" style="gap:8px;flex-wrap:wrap;margin:0 0 10px">
      <a class="btn" href="${tideUrl}" target="_blank" rel="noreferrer">官方潮汐（BoM）</a>
      <a class="btn" href="${obsUrl}" target="_blank" rel="noreferrer">實測浪況（AusWaves）</a>
    </div>
    <div class="tiny" style="margin:-4px 0 10px">提示：本頁數值係模型預報；建議用 Cam + 官方潮汐 + 實測作最後核對。</div>
  `;
}

function renderCam(spot) {
  // If the current spot has no cam, show nearby alternatives that do.
  if (!spot.camUrl) {
    const alts = (spots || []).filter(s => s.camUrl).slice(0, 3);
    if (!alts.length) {
      els.camCard.hidden = true;
      els.camWrap.innerHTML = '';
      return;
    }

    els.camCard.hidden = false;
    els.camWrap.innerHTML = `
      ${refButtons(spot)}
      <div class="tiny" style="margin-bottom:10px">此浪點暫時冇免費 cam（或唔可嵌入）。你可以用附近 cam 作參考：</div>
      ${alts.map(s => `<div style="margin:8px 0"><a class="btn" href="${s.camUrl}" target="_blank" rel="noreferrer">開啟 ${s.name} Cam</a></div>`).join('')}
      <div class="tiny">想加返本點 cam：要搵到公開可嵌入來源（好多付費/有防盜鏈）。</div>
    `;
    return;
  }

  const url = spot.camUrl;
  const isIvideon = url.includes('open.ivideon.com/embed');
  const isYouTube = url.includes('youtube.com/embed') || url.includes('youtube.com/live') || url.includes('youtu.be');

  els.camCard.hidden = false;

  // Only embed when we are reasonably sure it is meant to be embedded.
  if (isIvideon || isYouTube) {
    els.camWrap.innerHTML = `${refButtons(spot)}<iframe referrerpolicy="no-referrer" src="${url}" allow="autoplay; fullscreen"></iframe>`;
  } else {
    // Default: link-out (Windy / Panomax / surf-forecast pages often block iframes)
    els.camWrap.innerHTML = `
      ${refButtons(spot)}
      <div class="tiny" style="margin-bottom:8px">此 cam 來源可能唔支援第三方 iframe；已改用「跳出開啟」更穩。</div>
      <a class="btn" href="${url}" target="_blank" rel="noreferrer">開啟 Cam（新視窗）</a>
    `;
  }
}

function initMap() {
  if (!els.mapEl || map) return;
  if (!window.L) return;

  map = L.map('map', { zoomControl: true });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  markers = [];
  for (const s of spots) {
    const m = L.marker([s.lat, s.lon]).addTo(map);
    m.bindPopup(`<b>${s.name}</b><br/>${s.region}`);
    m.on('click', () => {
      els.spotSelect.value = s.id;
      refresh().catch(err => alert(err.message));
    });
    markers.push({ id: s.id, marker: m });
  }

  // fit bounds
  const latlngs = spots.map(s => [s.lat, s.lon]);
  const b = L.latLngBounds(latlngs);
  map.fitBounds(b.pad(0.2));
}

function focusMarker(spotId) {
  if (!map) return;
  const m = markers.find(x => x.id === spotId)?.marker;
  const s = spots.find(x => x.id === spotId);
  if (m && s) {
    map.setView([s.lat, s.lon], Math.max(map.getZoom(), 11));
    m.openPopup();
  }
}

async function load() {
  spots = await (await fetch('./spots.json')).json();
  // BoM tide tables (offline JSON generated from PDFs)
  try {
    bomTides = await (await fetch('./tides_bom.json')).json();
  } catch (e) {
    bomTides = null;
  }
  els.spotSelect.innerHTML = '';
  for (const s of spots) {
    const o = document.createElement('option');
    o.value = s.id;
    o.textContent = `${s.name} — ${s.region}`;
    els.spotSelect.appendChild(o);
  }

  // restore
  const savedSpot = localStorage.getItem('spotId');
  const savedMode = localStorage.getItem('mode');
  const savedBeginner = localStorage.getItem('beginnerMode');
  const savedDay = localStorage.getItem('selectedDay');

  if (savedSpot && spots.some(s=>s.id===savedSpot)) els.spotSelect.value = savedSpot;
  if (savedMode) mode = savedMode;
  if (savedBeginner != null) beginnerMode = savedBeginner === 'true';
  if (savedDay) selectedDay = savedDay;

  if (els.toggleBeginner) els.toggleBeginner.checked = beginnerMode;

  for (const b of document.querySelectorAll('.segBtn')) {
    b.classList.toggle('active', b.dataset.mode === mode);
  }

  initMap();
  await refresh();
}

async function refresh() {
  const spotId = els.spotSelect.value;
  const spot = spots.find(s=>s.id===spotId);
  if (!spot) return;

  localStorage.setItem('spotId', spotId);
  localStorage.setItem('mode', mode);

  els.updatedAt.textContent = '更新中…';

  // UI: day selector only for next3
  if (els.dayRow) els.dayRow.hidden = !(mode === 'next10');

  // compare mode: load minimal now snapshot for all spots
  if (mode === 'compare') {
    if (els.compareCard) els.compareCard.hidden = false;
    if (els.dayRow) els.dayRow.hidden = true;
    // hide chart in compare mode
    const chart = document.getElementById('chartCard');
    if (chart) chart.hidden = true;

    // fetch all spots in parallel (small list)
    const results = await Promise.all(spots.map(async (s) => {
      try {
        const [marine, weather] = await Promise.all([
          fetchMarine(s.lat, s.lon),
          fetchWeather(s.lat, s.lon)
        ]);
        const rows = zipHourly(marine, weather);
        const nowRow = pickNow(rows);
        const v = verdictGoNo({
          waveH: nowRow.wave_height,
          periodS: nowRow.wave_period,
          windKmh: nowRow.wind_speed_10m,
          windDirDeg: nowRow.wind_direction_10m,
          beachFacingDeg: s.beachFacingDeg,
          beginner: beginnerMode,
        });
        const windRel = v.wind ? (v.wind === 'offshore' ? 'Offshore' : v.wind === 'onshore' ? 'Onshore' : 'Cross') : '—';
        return { ok: true, spot: s, nowRow, v, windRel };
      } catch (e) {
        return { ok: false, spot: s, err: e?.message || String(e) };
      }
    }));

    // sort best first (Beginner-first recommendation)
    // Priority: Verdict (Go > Maybe > No) → Offshore > Cross > Onshore → lower wind → smaller wave.
    const rank = { ok: 2, meh: 1, bad: 0 };
    const wRank = { offshore: 2, cross: 1, onshore: 0, undefined: 1, null: 1 };

    results.sort((a,b) => {
      const av = rank[a.v?.level || 'bad'];
      const bv = rank[b.v?.level || 'bad'];
      if (bv !== av) return bv - av;

      const aw = wRank[a.v?.wind] ?? 1;
      const bw = wRank[b.v?.wind] ?? 1;
      if (bw !== aw) return bw - aw;

      const aWind = kmhToKnots(a.nowRow?.wind_speed_10m) ?? 99;
      const bWind = kmhToKnots(b.nowRow?.wind_speed_10m) ?? 99;
      if (aWind !== bWind) return aWind - bWind;

      // wave sweet spot for beginners: prefer around ~0.7m (not too small to catch)
      const target = beginnerMode ? 0.7 : 1.2;
      const aWave = a.nowRow?.wave_height;
      const bWave = b.nowRow?.wave_height;
      const aDist = aWave==null ? 99 : Math.abs(aWave - target);
      const bDist = bWave==null ? 99 : Math.abs(bWave - target);
      if (aDist !== bDist) return aDist - bDist;
      // tiebreak: slightly prefer a bit more wave over less
      if (aWave != null && bWave != null) return bWave - aWave;
      return 0;
    });

    const head = `
      <tr>
        <th>Spot</th>
        <th>Verdict</th>
        <th>Wave</th>
        <th>Period</th>
        <th>Wind</th>
        <th>Wind rel</th>
        <th>Note</th>
      </tr>
    `;

    const body = results.map(r => {
      if (!r.ok) {
        return `<tr><td>${r.spot.name}</td><td colspan="6">載入失敗：${r.err}</td></tr>`;
      }
      const h = r.nowRow.wave_height;
      const p = r.nowRow.wave_period;
      const wk = kmhToKnots(r.nowRow.wind_speed_10m);
      const verdict = r.v.level==='ok'?'Go':r.v.level==='meh'?'Maybe':'No';
      const note = r.spot.notes ? r.spot.notes : '';
      return `
        <tr>
          <td>${r.spot.name}</td>
          <td><b>${verdict}</b></td>
          <td>${h!=null?h.toFixed(1):'—'}m</td>
          <td>${p!=null?p.toFixed(0):'—'}s</td>
          <td>${wk!=null?wk.toFixed(0):'—'}kt</td>
          <td>${r.windRel}</td>
          <td>${note}</td>
        </tr>
      `;
    }).join('');

    if (els.compareTable) els.compareTable.innerHTML = head + body;

    // still render summary for currently selected spot (so user can tap into details)
    const [marine, weather] = await Promise.all([
      fetchMarine(spot.lat, spot.lon),
      fetchWeather(spot.lat, spot.lon)
    ]);
    const rows = zipHourly(marine, weather);
    const nowRow = pickNow(rows);
    const todayRows = filterToday(rows);
    const next3Rows = filterNext3(rows);
    renderSummary(spot, nowRow, todayRows, next3Rows);
    renderCam(spot);

    const ts = new Date().toISOString().replace('T',' ').slice(0,16) + ' UTC';
    els.updatedAt.textContent = `已更新：${ts}`;
    return;
  }

  // non-compare modes
  if (els.compareCard) els.compareCard.hidden = true;
  const chart = document.getElementById('chartCard');
  if (chart) chart.hidden = false;

  const [marine, weather] = await Promise.all([
    fetchMarine(spot.lat, spot.lon),
    fetchWeather(spot.lat, spot.lon)
  ]);

  const rows = zipHourly(marine, weather);
  const todayRows = filterToday(rows);
  const next3Rows = filterNext3(rows);

  // default summary uses "now" (or closest)
  let summaryRow = pickNow(rows);
  let summaryDayRows = todayRows;

  // if user is viewing a specific day in next10 mode, summary should follow that day
  if (mode === 'next10' && selectedDay) {
    const dayRows = next3Rows.filter(r => r.time.startsWith(selectedDay));
    if (dayRows.length) {
      // if selected day is today, show closest-to-now; else show the first hour of that day
      const todayStr = new Date().toISOString().slice(0,10);
      summaryRow = (selectedDay === todayStr) ? pickNow(dayRows) : dayRows[0];
      summaryDayRows = dayRows;
    }
  }

  renderSummary(spot, summaryRow, summaryDayRows, next3Rows);

  let show = rows;
  let title = '時間表';
  if (mode === 'now') {
    show = rows.slice(rows.indexOf(nowRow), rows.indexOf(nowRow)+12);
    title = '而家起計（未來 12 小時）';
  } else if (mode === 'today') {
    show = filterToday(rows);
    title = '今日（逐小時）';
  } else if (mode === 'next10') {
    const n10 = rows; // full forecast window from API
    // populate daySelect with available dates
    const days = Array.from(new Set(n10.map(r => r.time.slice(0,10)))).sort().slice(0, 10);
    if (els.daySelect) {
      els.daySelect.innerHTML = '';
      for (const d of days) {
        const o = document.createElement('option');
        o.value = d;
        o.textContent = d;
        els.daySelect.appendChild(o);
      }
      if (!selectedDay || !days.includes(selectedDay)) selectedDay = days[0];
      els.daySelect.value = selectedDay;
      localStorage.setItem('selectedDay', selectedDay);
    }
    show = n10.filter(r => r.time.startsWith(selectedDay || days[0] || ''));
    title = `未來 10 日：${(selectedDay||'')}`;
  }

  renderTable(title, show, spot);
  renderCam(spot);
  focusMarker(spotId);

  const ts = new Date().toISOString().replace('T',' ').slice(0,16) + ' UTC';
  els.updatedAt.textContent = `已更新：${ts}`;
}

// events
els.btnRefresh.addEventListener('click', () => refresh().catch(err => alert(err.message)));
els.spotSelect.addEventListener('change', () => refresh().catch(err => alert(err.message)));
if (els.daySelect) {
  els.daySelect.addEventListener('change', () => {
    selectedDay = els.daySelect.value;
    localStorage.setItem('selectedDay', selectedDay);
    refresh().catch(err => alert(err.message));
  });
}
if (els.toggleBeginner) {
  els.toggleBeginner.addEventListener('change', () => {
    beginnerMode = !!els.toggleBeginner.checked;
    localStorage.setItem('beginnerMode', String(beginnerMode));
    refresh().catch(err => alert(err.message));
  });
}
for (const b of document.querySelectorAll('.segBtn')) {
  b.addEventListener('click', () => {
    mode = b.dataset.mode;
    for (const x of document.querySelectorAll('.segBtn')) x.classList.toggle('active', x === b);
    refresh().catch(err => alert(err.message));
  });
}

// SW
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // cache-bust SW on iOS
    navigator.serviceWorker.register('./sw.js?v=2026-02-07-1150').catch(()=>{});
  });
}

load().catch(err => {
  console.error(err);
  alert('載入失敗：' + err.message);
});
