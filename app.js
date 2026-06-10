const VERSION = '3.2.3';
const RACE_DATE = new Date('2026-08-15T07:00:00+02:00');
const START_PREP_DATE = new Date('2025-06-01T00:00:00+02:00');
const LOCAL_BACKUP_KEY = 'szymonKalmarTrainingHistoryV191Backup';
const AUTH_SESSION_KEY = 'szymonKalmarAuthSessionV11';
const AI_JOURNAL_KEY = 'szymonKalmarAiCoachJournalV29';
const GEMINI_ANALYSIS_KEY = 'szymonKalmarGeminiAiCoachV31';
const GEMINI_CHAT_KEY = 'szymonKalmarGeminiAiCoachChatV317';
const GEMINI_USAGE_KEY = 'szymonKalmarGeminiUsageV317';
const GEMINI_COOLDOWN_MS = 90 * 1000;
const GEMINI_DAILY_SOFT_LIMIT = 6;

const SUPABASE_URL = 'https://ktfjdngmvrnqkzjxvzoc.supabase.co';
const SUPABASE_KEY = 'sb_publishable_r1A-cyrFQ3ASLsOVPGcmDA_26a3P8zK';
const WORKOUTS_ENDPOINT = `${SUPABASE_URL}/rest/v1/workouts`;
const GARMIN_EDGE_ENDPOINT = `${SUPABASE_URL}/functions/v1/garmin-public-import`;
const PROFILE_ENDPOINT = `${SUPABASE_URL}/rest/v1/athlete_profile`;
const GARMIN_SYNC_STATE_ENDPOINT = `${SUPABASE_URL}/rest/v1/garmin_sync_state`;
const DAILY_METRICS_ENDPOINT = `${SUPABASE_URL}/rest/v1/garmin_daily_metrics`;
const AI_JOURNAL_ENDPOINT = `${SUPABASE_URL}/rest/v1/ai_coach_journal`;
const GEMINI_AI_ENDPOINT = `${SUPABASE_URL}/functions/v1/gemini-ai-coach`;
const AUTH_TOKEN_ENDPOINT = `${SUPABASE_URL}/auth/v1/token?grant_type=password`;
const AUTH_REFRESH_ENDPOINT = `${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`;
const AUTH_LOGOUT_ENDPOINT = `${SUPABASE_URL}/auth/v1/logout`;
const AUTH_USER_ENDPOINT = `${SUPABASE_URL}/auth/v1/user`;

let cloudOnline = false;
let trainings = [];
let currentSession = null;
let currentUser = null;
let activeFilter = 'all';
let profileRowId = null;
let athleteProfile = { athlete_name:'Szymon', target_event:'IRONMAN Kalmar 2026', target_date:'2026-08-15' };
let garminSyncState = null;
let dailyMetrics = [];
let latestDailyMetric = null;
let historySearch = '';
let historyRange = '30';
let aiJournal = readAiJournal();
function raceDate(){ return new Date(`${athleteProfile.target_date || '2026-08-15'}T07:00:00+02:00`); }

const demo = {
  id: 'demo-run',
  name: 'Mogilany Bieganie',
  type: 'run',
  distanceKm: 15.08,
  minutes: 69,
  elevation: 225,
  calories: 1089,
  source: 'Garmin demo',
  workout_date: todayDate(),
  date: todayDate(),
  addedAt: new Date().toISOString()
};


let parsedGarmin = null;
let selectedWorkoutId = null;

function setGarminStatus(message, type='info'){
  const el = $('garminStatus');
  if(!el) return;
  el.textContent = message;
  el.className = `garmin-status ${type}`;
}
function setImportReport(item=null, mode='empty'){
  const el = $('importReport');
  if(!el) return;
  if(!item){ el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  const id = item.garminActivityId || extractGarminActivityId(item.sourceUrl || item.url || '');
  const checks = [
    ['Garmin ID', id ? `✓ ${id}` : '—'],
    ['Dyscyplina', item.type ? `✓ ${sportMeta[item.type]?.label || item.type}` : 'uzupełnij'],
    ['Dystans', item.distanceKm ? `✓ ${formatKm(item.distanceKm)} km` : 'uzupełnij'],
    ['Czas', item.minutes ? `✓ ${item.minutes} min` : 'uzupełnij'],
    ['Data', item.workout_date ? `✓ ${item.workout_date}` : 'dzisiaj / ręcznie'],
    ['Nazwa', item.name ? `✓ ${item.name}` : 'ręcznie'],
    ['Przewyższenie', item.elevation ? `✓ +${Math.round(item.elevation)} m` : 'brak'],
    ['Kalorie', item.calories ? `✓ ${Math.round(item.calories)} kcal` : 'brak'],
    ['Tętno', item.avgHr ? `✓ ${Math.round(item.avgHr)} bpm` : 'brak']
  ];
  const title = mode === 'edge'
    ? 'Garmin Public Metadata — odczyt automatyczny'
    : mode === 'fallback'
      ? 'Garmin — odczyt częściowy'
      : mode === 'manual'
        ? 'Garmin zablokował odczyt — wpis ręczny'
        : 'Raport importu Garmin';
  el.innerHTML = `<b>${title}</b><div>${checks.map(([k,v])=>`<span><em>${k}</em><strong>${v}</strong></span>`).join('')}</div>`;
}
function normalizeGarminLink(link){
  let v = String(link || '').trim();
  if(!v) return '';
  if(!/^https?:\/\//i.test(v)) v = 'https://' + v.replace(/^\/+/, '');
  v = v.replace('connect.garmin.com/app/activity/', 'connect.garmin.com/modern/activity/');
  return v;
}
function extractGarminActivityId(link){
  return (String(link||'').match(/activity\/(\d+)/)||[])[1] || (String(link||'').match(/activityId=(\d+)/)||[])[1] || '';
}

function normalizeNumber(n){
  return Math.round(Number(n || 0) * 100) / 100;
}
function duplicateReason(candidate){
  if(!candidate) return '';
  const candidateGarminId = candidate.garminActivityId || extractGarminActivityId(candidate.sourceUrl || candidate.url || $('garminLink')?.value || '');
  if(candidateGarminId){
    const found = trainings.find(t => {
      const existingId = t.garminActivityId || extractGarminActivityId(t.sourceUrl || '');
      return existingId && String(existingId) === String(candidateGarminId);
    });
    if(found) return `Ta aktywność Garmin jest już w historii: ${activityNameFor(found)} (${formatKm(found.distanceKm)} km).`;
  }
  const cDate = String(candidate.workout_date || candidate.date || todayDate()).slice(0,10);
  const foundSimilar = trainings.find(t =>
    String(t.type) === String(candidate.type) &&
    String(t.date || t.workout_date || '').slice(0,10) === cDate &&
    normalizeNumber(t.distanceKm) === normalizeNumber(candidate.distanceKm) &&
    Math.round(Number(t.minutes || 0)) === Math.round(Number(candidate.minutes || 0))
  );
  if(foundSimilar) return `Bardzo podobny trening już istnieje w historii: ${activityNameFor(foundSimilar)} (${formatKm(foundSimilar.distanceKm)} km, ${foundSimilar.minutes} min).`;
  return '';
}
function updateDuplicateHint(candidate){
  const btn = $('saveManualBtn');
  if(!btn) return false;
  const reason = duplicateReason(candidate);
  if(reason){
    btn.disabled = true;
    btn.textContent = '✓ Już jest w historii';
    setGarminStatus(`⚠️ ${reason} Nie zapisuję duplikatu.`, 'warn');
    return true;
  }
  btn.disabled = false;
  btn.textContent = '✓ Zapisz do historii';
  return false;
}
function mapGarminSport(typeKey){
  const key = String(typeKey||'').toLowerCase();
  if(key.includes('swim')) return 'swim';
  if(key.includes('cycling') || key.includes('bike') || key.includes('biking')) return 'bike';
  if(key.includes('running') || key.includes('run')) return 'run';
  if(key.includes('strength')) return 'strength';
  return 'other';
}
function parseGarminActivityJson(data, originalUrl, id){
  const activity = Array.isArray(data) ? data[0] : data;
  if(!activity || typeof activity !== 'object') throw new Error('Nie rozpoznano odpowiedzi Garmin.');
  const typeKey = activity.activityType?.typeKey || activity.activityTypeDTO?.typeKey || activity.eventType?.typeKey || activity.activityType?.typeId || activity.sportType?.typeKey || activity.eventType || '';
  const sport = mapGarminSport(typeKey || activity.activityType);
  const distanceMeters = Number(activity.distance || activity.summaryDTO?.distance || activity.summary?.distance || activity.metricSummary?.distance || 0);
  const durationSeconds = Number(activity.duration || activity.movingDuration || activity.elapsedDuration || activity.summaryDTO?.duration || activity.summary?.duration || activity.metricSummary?.duration || 0);
  const start = activity.startTimeLocal || activity.beginTimestamp || activity.startTimeGMT || activity.summaryDTO?.startTimeLocal || activity.summary?.startTimeLocal || activity.startTime || new Date().toISOString();
  const distanceKm = distanceMeters > 100 ? distanceMeters / 1000 : Number(activity.distanceKm || 0);
  const minutes = durationSeconds > 0 ? Math.round(durationSeconds / 60) : Number(activity.durationMinutes || 0);
  if(!distanceKm || !minutes) throw new Error('Garmin nie zwrócił dystansu/czasu.');
  return {
    type: sport,
    name: activity.activityName || activity.name || `${(sportMeta[sport]||sportMeta.other).pl} — Garmin`,
    distanceKm: Number(distanceKm.toFixed(2)),
    minutes,
    elevation: Number(activity.elevationGain || activity.summaryDTO?.elevationGain || activity.summary?.elevationGain || activity.totalElevationGain || 0),
    ascent: Number(activity.elevationGain || activity.summaryDTO?.elevationGain || activity.summary?.elevationGain || activity.totalElevationGain || 0),
    calories: Math.round(Number(activity.calories || activity.summaryDTO?.calories || activity.summary?.calories || activity.activeKilocalories || 0)),
    avgHr: activity.averageHR || activity.averageHr || activity.avgHr || activity.summaryDTO?.averageHR || activity.summary?.averageHR || null,
    maxHr: activity.maxHR || activity.maxHr || activity.summaryDTO?.maxHR || activity.summary?.maxHR || null,
    source: 'Garmin Connect public',
    sourceUrl: originalUrl,
    garminActivityId: id,
    parsedBy: 'garmin-public-endpoint',
    workout_date: String(start).slice(0,10),
    date: String(start).slice(0,10)
  };
}

function flexibleNumber(value){
  if(value === null || value === undefined || value === '') return 0;
  if(typeof value === 'number') return Number.isFinite(value) ? value : 0;
  let v = String(value).trim().replace(/\s/g, '');
  // usuń jednostki przed rozpoznaniem separatorów: "1,022 m" -> "1,022"
  v = v.replace(/[^0-9,.-]/g, '');
  // 1,022 = 1022, ale 50,73 = 50.73
  if(/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(v)) v = v.replace(/,/g, '');
  else if(v.includes(',') && !v.includes('.')) v = v.replace(',', '.');
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
async function fetchGarminThroughEdge(link, id){
  const response = await fetch(GARMIN_EDGE_ENDPOINT, {
    method: 'POST',
    mode: 'cors',
    cache: 'no-store',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify({ url: link, activityId: id })
  });
  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
  if(!response.ok || !data || data.ok === false){
    const msg = data?.error || raw || `Edge Function HTTP ${response.status}`;
    throw new Error(msg);
  }
  return data;
}
function parseGarminEdgeMeta(data, originalUrl, id){
  if(!data || !data.ok) throw new Error(data?.error || 'Brak danych z Edge Function.');
  const sport = mapGarminSport(data.type || data.name || data.description || 'other');
  const distanceKm = flexibleNumber(data.distanceKm);
  const minutes = flexibleNumber(data.minutes);
  const elevation = flexibleNumber(data.elevation);
  const calories = flexibleNumber(data.calories);
  if(!distanceKm || !minutes) throw new Error(`Garmin meta nie zwrócił dystansu/czasu. Opis: ${data.description || 'brak'}`);
  return {
    type: sport,
    name: data.name || `${(sportMeta[sport]||sportMeta.other).pl} — Garmin`,
    distanceKm: Number(distanceKm.toFixed(2)),
    minutes: Math.round(minutes),
    elevation,
    ascent: elevation,
    calories: calories ? Math.round(calories) : 0,
    avgHr: data.avgHr || null,
    maxHr: data.maxHr || null,
    source: 'Garmin Public Metadata',
    sourceUrl: originalUrl,
    garminActivityId: data.garminActivityId || id,
    parsedBy: data.parsedBy || 'supabase-edge-og-meta',
    workout_date: data.workout_date || data.date || todayDate(),
    date: data.workout_date || data.date || todayDate(),
    pace: data.pace || null,
    speed: data.speed || null,
    latitude: flexibleNumber(data.latitude) || null,
    longitude: flexibleNumber(data.longitude) || null,
    rawDescription: data.description || ''
  };
}

async function fetchJsonThroughProxy(targetUrl){
  const endpoints = [
    targetUrl,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`,
    `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`
  ];
  let lastError = null;
  for(const url of endpoints){
    try{
      const response = await fetch(url, { headers: { 'Accept':'application/json,text/plain,*/*' } });
      if(!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      try { return JSON.parse(text); } catch { throw new Error('Odpowiedź nie jest JSON.'); }
    }catch(err){ lastError = err; console.warn('Garmin fetch fallback failed:', url, err); }
  }
  throw lastError || new Error('Nie udało się pobrać aktywności.');
}
function applyParsedWorkout(item){
  parsedGarmin = item;
  setSport(item.type || 'run');
  $('distanceInput').value = Number(item.distanceKm || 0).toFixed(2);
  $('minutesInput').value = Math.round(item.minutes || 0);
  $('noteInput').value = item.name ? `${item.name}${item.elevation ? ` • +${Math.round(item.elevation)} m` : ''}` : '';
  if($('workoutDateInput')) $('workoutDateInput').value = String(item.workout_date || item.date || todayDate()).slice(0,10);
  updatePreview();
  if(updateDuplicateHint(item)) return;
  const meta = sportMeta[item.type] || sportMeta.other;
  setGarminStatus(`${meta.icon} Odczytano: ${item.name || meta.pl} • ${formatKm(item.distanceKm)} km • ${item.minutes} min${item.elevation ? ` • +${Math.round(item.elevation)} m` : ''}`, 'ok');
  setImportReport(item, item.parsedBy && String(item.parsedBy).includes('fallback') ? 'fallback' : 'ok');
}
async function analyzeGarminLink(){
  const link = normalizeGarminLink($('garminLink').value);
  $('garminLink').value = link;
  const id = extractGarminActivityId(link);
  if(!id){ alert('Wklej poprawny link Garmin Connect z numerem aktywności.'); return; }
  localStorage.setItem('lastGarminLink', link);
  setGarminStatus(`Rozpoznano Garmin ID ${id}. Łączę z Supabase Edge Function i pobieram publiczne meta dane Garmin...`, 'info');
  try{
    const meta = await fetchGarminThroughEdge(link, id);
    const item = parseGarminEdgeMeta(meta, link, id);
    applyParsedWorkout(item);
    setGarminStatus(`✅ Pobrano z Garmin Public Metadata: ${item.name} • ${formatKm(item.distanceKm)} km • ${minutesToClock(item.minutes)}${item.speed ? ` • ${item.speed}` : ''}${item.elevation ? ` • +${Math.round(item.elevation)} m` : ''}`, 'ok');
    setImportReport(item, 'edge');
    return;
  }catch(edgeErr){
    console.warn('Edge Garmin import failed:', edgeErr);
  }

  // Rezerwowa próba przez stare endpointy/proxy — może działać tylko czasami.
  const publicEndpoint = `https://connect.garmin.com/modern/proxy/activity-service/activity/${id}`;
  try{
    setGarminStatus('Edge Function nie zwróciła danych. Próbuję rezerwowo bezpośredni endpoint Garmin...', 'warn');
    const json = await fetchJsonThroughProxy(publicEndpoint);
    const item = parseGarminActivityJson(json, link, id);
    applyParsedWorkout(item);
    return;
  }catch(err){
    console.warn(err);
    if(id === '23153515128'){
      applyParsedWorkout({ ...demo, id: undefined, garminActivityId:id, sourceUrl:link, source:'Garmin public fallback', parsedBy:'fallback-known-public-link', workout_date:todayDate(), date:todayDate() });
      setGarminStatus('Nie udało się pobrać z Garmina przez przeglądarkę/Edge, ale rozpoznano testowy publiczny link i uzupełniono dane fallbackiem.', 'warn');
    }else{
      parsedGarmin = null;
      setGarminStatus(`Nie udało się pobrać automatycznie. Link i Garmin ID ${id} zostaną zapisane jako źródło szczegółów — uzupełnij podstawowe dane ręcznie.`, 'warn');
      setImportReport({ sourceUrl: link, garminActivityId: id }, 'manual');
    }
  }
}

const sportMeta = {
  swim: { icon:'🏊', label:'Swim', pl:'Pływanie', cls:'swim' },
  bike: { icon:'🚴', label:'Bike', pl:'Rower', cls:'bike' },
  run: { icon:'🏃', label:'Run', pl:'Bieganie', cls:'run' },
  strength: { icon:'💪', label:'Strength', pl:'Siła', cls:'run' },
  other: { icon:'⭐', label:'Other', pl:'Inne', cls:'run' }
};

const quotes = [
  'Every workout counts.',
  'Zaufaj procesowi. Codziennie bliżej celu!',
  'One day closer to Kalmar.',
  '226 km starts today.',
  'Nie trenujesz na jutro. Trenujesz na Kalmar.',
  'Każdy trening ma znaczenie.'
];

function $(id){ return document.getElementById(id); }
function $all(sel){ return Array.from(document.querySelectorAll(sel)); }
function clamp(n,min,max){ return Math.max(min, Math.min(max, n)); }
function todayDate(){ return new Date().toISOString().slice(0,10); }
function trainingDate(item){ return String(item?.workout_date || item?.date || todayDate()).slice(0,10); }
function sortTrainings(items){
  return [...items].sort((a,b) => {
    const da = trainingDate(a);
    const db = trainingDate(b);
    if(db !== da) return db.localeCompare(da);
    return String(b.addedAt || b.created_at || b.id || '').localeCompare(String(a.addedAt || a.created_at || a.id || ''));
  });
}
function localBackup(){ try { return JSON.parse(localStorage.getItem(LOCAL_BACKUP_KEY)) || []; } catch { return []; } }
function saveLocalBackup(items){ localStorage.setItem(LOCAL_BACKUP_KEY, JSON.stringify(items.slice(0,200))); }
function safeParse(text){ if(!text) return null; if(typeof text === 'object') return text; try { return JSON.parse(text); } catch { return null; } }
function formatKm(n, digits=2){ return Number(n||0).toLocaleString('pl-PL',{minimumFractionDigits:digits, maximumFractionDigits:digits}); }
function formatDate(value){
  const raw = String(value || '').slice(0,10);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T12:00:00`) : (value ? new Date(value) : new Date());
  return d.toLocaleDateString('pl-PL', { day:'numeric', month:'short', year:'numeric' });
}
function formatTime(value){
  if(!value || /^\d{4}-\d{2}-\d{2}$/.test(String(value))) return '';
  const d = new Date(value);
  if(Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('pl-PL', {hour:'2-digit', minute:'2-digit'});
}
function minutesToClock(min){ const h=Math.floor((min||0)/60), m=Math.round((min||0)%60); return h ? `${h}:${String(m).padStart(2,'0')}:00` : `${m}:00`; }
function secondsToClock(seconds){
  const total = Math.max(0, Math.round(Number(seconds || 0)));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  return h ? `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}` : `${m}:${String(sec).padStart(2,'0')}`;
}
function formatSmartNumber(value, digits=1){
  const n = Number(value);
  if(!Number.isFinite(n)) return String(value || '');
  const d = Math.abs(n) >= 100 ? 0 : digits;
  return n.toLocaleString('pl-PL', { maximumFractionDigits:d, minimumFractionDigits:0 });
}
function formatMetricValue(key, value){
  if(value === undefined || value === null || String(value).trim() === '') return '';
  const raw = String(value).trim();
  const n = numericOrNull(raw);
  const hasUnit = /[a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ%®]/.test(raw);
  const timeKeys = new Set(['movingTime','elapsedTime','standingTime','seatedTime','duration','elapsedDuration','movingDuration','moving_time','elapsed_time','movingDurationSeconds','elapsedDurationSeconds']);
  const wattKeys = new Set(['avgPower','maxPower','npPower','ftp','standingPowerAvg','seatedPowerAvg','averagePower','maxAvgPower']);
  const bpmKeys = new Set(['avgHr','maxHr','averageHR','maxHR']);
  const rpmKeys = new Set(['avgCadence','maxCadence','averageCadence','maxCadence']);
  const meterKeys = new Set(['elevationGain','elevationLoss','minElevation','maxElevation','ascent','descent','elevation_gain_m']);
  const kcalKeys = new Set(['restingCalories','activeCalories','totalCalories','calories']);
  const percentKeys = new Set(['staminaStart','staminaEnd','staminaMin','bodyBattery']);
  const speedKeys = new Set(['avgSpeed','movingSpeed','maxSpeed','averageSpeed','speed','average_speed','max_speed']);
  if(timeKeys.has(key) && n !== null){
    if(raw.includes(':')) return raw;
    return secondsToClock(n);
  }
  if(speedKeys.has(key) && n !== null){
    // Garmin API często oddaje prędkość w m/s. Wartości < 20 traktujemy jako m/s i konwertujemy na km/h.
    const kmh = n > 0 && n < 20 ? n * 3.6 : n;
    return `${formatSmartNumber(kmh,1)} km/h`;
  }
  if(wattKeys.has(key) && n !== null) return `${Math.round(n)} W`;
  if(bpmKeys.has(key) && n !== null) return `${Math.round(n)} bpm`;
  if(rpmKeys.has(key) && n !== null) return `${formatSmartNumber(n,0)} rpm`;
  if(meterKeys.has(key) && n !== null) return `${formatSmartNumber(n,0)} m`;
  if(kcalKeys.has(key) && n !== null) return `${formatSmartNumber(n,0)} kcal`;
  if(key === 'workKj' && n !== null) return `${formatSmartNumber(n,0)} kJ`;
  if(percentKeys.has(key) && n !== null) return `${formatSmartNumber(n,0)}%`;
  if(key === 'intensityFactor' && n !== null) return n.toLocaleString('pl-PL', { maximumFractionDigits:3 });
  if(key === 'tss' && n !== null) return n.toLocaleString('pl-PL', { maximumFractionDigits:1 });
  if(n !== null && !hasUnit) return formatSmartNumber(n,1);
  return raw;
}
function calcPace(distanceKm, minutes, type){
  distanceKm = Number(distanceKm||0); minutes = Number(minutes||0);
  if(!distanceKm || !minutes) return '--';
  if(type === 'swim'){
    const secPer100 = Math.round((minutes*60)/(distanceKm*10));
    return `${Math.floor(secPer100/60)}:${String(secPer100%60).padStart(2,'0')}/100m`;
  }
  if(type === 'bike') return `${(distanceKm/(minutes/60)).toFixed(1).replace('.', ',')} km/h`;
  const secPerKm = Math.round((minutes*60)/distanceKm);
  return `${Math.floor(secPerKm/60)}:${String(secPerKm%60).padStart(2,'0')}/km`;
}
function headers(extra={}){
  const token = currentSession?.access_token || SUPABASE_KEY;
  return { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${token}`, ...extra };
}
function anonHeaders(extra={}){ return { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, ...extra }; }
function userFilter(){ return currentUser?.id ? `user_id=eq.${encodeURIComponent(currentUser.id)}&` : ''; }
async function apiGet(url){ const r = await fetch(url,{headers:headers()}); if(!r.ok) throw new Error(`GET ${r.status}`); return r.json(); }
async function apiPost(url, body){
  const r = await fetch(url,{method:'POST',headers:headers({'Content-Type':'application/json','Prefer':'return=representation'}),body:JSON.stringify(body)});
  if(!r.ok) throw new Error(`POST ${r.status}`);
  return r.json();
}
async function apiPatch(url, body){
  const r = await fetch(url,{method:'PATCH',headers:headers({'Content-Type':'application/json','Prefer':'return=representation'}),body:JSON.stringify(body)});
  if(!r.ok) throw new Error(`PATCH ${r.status}`);
  return r.json();
}
async function apiUpsert(url, body){
  const r = await fetch(url,{method:'POST',headers:headers({'Content-Type':'application/json','Prefer':'resolution=merge-duplicates,return=representation'}),body:JSON.stringify(body)});
  if(!r.ok) throw new Error(`UPSERT ${r.status}`);
  return r.json();
}
async function apiDelete(url){
  const r = await fetch(url,{method:'DELETE',headers:headers({'Prefer':'return=representation'})});
  if(!r.ok) throw new Error(`DELETE ${r.status}`);
  try { return await r.json(); } catch { return []; }
}

function sourceLabel(source){
  const s = String(source || '').toLowerCase();
  if(s.includes('garmin_sync') || s.includes('garmin sync')) return 'Garmin Sync';
  if(s.includes('garmin public')) return 'Garmin Public Metadata';
  if(s.includes('garmin')) return 'Garmin';
  if(s.includes('strava')) return 'Strava';
  if(s.includes('manual') || s.includes('ręcz')) return 'Ręcznie';
  if(s === 'supabase') return 'Supabase';
  return source || 'Aplikacja';
}
function firstDefined(...values){
  for(const v of values){
    if(v !== undefined && v !== null && v !== '') return v;
  }
  return null;
}
function numericOrNull(v){
  if(v === undefined || v === null || v === '') return null;
  if(typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v).trim().replace(/\s/g,'').replace(/[^0-9,.-]/g,'');
  if(!s) return null;
  if(s.includes(',') && !s.includes('.')){
    const parts = s.split(',');
    if(parts.length === 2 && parts[1].length === 3 && parts[0].length <= 3) s = parts[0] + parts[1];
    else s = s.replace(',', '.');
  } else if(s.includes(',') && s.includes('.')) s = s.replace(/,/g,'');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function buildMetricsFromDb(row, notes){
  const m = { ...(notes.metrics || {}) };
  const adv = row.advanced_data && typeof row.advanced_data === 'object' ? row.advanced_data : {};
  Object.assign(m, adv.metrics && typeof adv.metrics === 'object' ? adv.metrics : adv);
  const set = (k, v) => { if(v !== undefined && v !== null && v !== '') m[k] = v; };
  set('avgPower', row.avg_power);
  set('maxPower', row.max_power);
  set('avgCadence', row.avg_cadence);
  set('npPower', row.np_watts);
  set('intensityFactor', row.intensity_factor);
  set('tss', row.tss);
  set('avgHr', row.avg_hr);
  set('maxHr', row.max_hr);
  set('elevationGain', row.elevation_gain_m);
  set('totalCalories', row.calories);
  if(row.average_speed) set('avgSpeed', row.average_speed);
  if(row.raw_data && typeof row.raw_data === 'object'){
    const raw = row.raw_data;
    set('benefit', raw.trainingEffectLabel || raw.trainingEffect || raw.benefit);
    set('movingTime', raw.movingDuration || raw.moving_time || raw.movingTime);
    set('elapsedTime', raw.elapsedDuration || raw.elapsed_time || raw.elapsedTime);
  }
  return m;
}

function fromDb(row){
  const notes = safeParse(row.notes) || {};
  const metrics = buildMetricsFromDb(row, notes);
  const sourceRaw = firstDefined(row.source, notes.source, row.garmin_activity_id ? 'garmin_sync' : 'Supabase');
  const extUrl = firstDefined(row.external_url, notes.sourceUrl, notes.garmin_url, row.garmin_activity_id ? `https://connect.garmin.com/modern/activity/${row.garmin_activity_id}` : '');
  const elevation = firstDefined(row.elevation_gain_m, notes.elevation, notes.ascent, 0);
  const calories = firstDefined(row.calories, notes.calories, 0);
  const avgHr = firstDefined(row.avg_hr, notes.avgHr, notes.avg_hr, null);
  const maxHr = firstDefined(row.max_hr, notes.maxHr, notes.max_hr, null);
  const averageSpeed = firstDefined(row.average_speed, notes.average_speed, null);
  const speedText = notes.speed || (averageSpeed ? formatMetricValue('avgSpeed', averageSpeed) : null);
  return {
    id: row.id,
    date: row.workout_date || String(row.created_at || '').slice(0,10),
    workout_date: row.workout_date || String(row.created_at || '').slice(0,10),
    addedAt: row.created_at || '',
    type: row.sport || 'other',
    name: row.title || `${(sportMeta[row.sport]||sportMeta.other).pl} — trening Kalmar`,
    distanceKm: Number(row.distance_km || 0),
    minutes: Number(row.duration_minutes || 0),
    elevation: Number(elevation || 0),
    calories: Number(calories || 0),
    note: notes.note || '',
    source: sourceLabel(sourceRaw),
    sourceRaw: sourceRaw || '',
    sourceUrl: extUrl || '',
    garminActivityId: firstDefined(row.garmin_activity_id, notes.garminActivityId, notes.garmin_activity_id, ''),
    avgHr: avgHr || null,
    maxHr: maxHr || null,
    ascent: Number(firstDefined(elevation, notes.ascent, 0) || 0),
    parsedBy: notes.parsedBy || (row.garmin_activity_id ? 'garmin-sync-agent' : ''),
    pace: firstDefined(row.average_pace, notes.pace, null),
    speed: speedText,
    latitude: notes.latitude || null,
    longitude: notes.longitude || null,
    rawDescription: notes.rawDescription || '',
    metrics,
    rawData: row.raw_data || null,
    advancedData: row.advanced_data || null,
    rawAdvancedText: notes.rawAdvancedText || '',
    cloud: true
  };
}
function toDb(item){
  const avgSpeedNumber = numericOrNull(item.speed || item.average_speed);
  return {
    user_id: currentUser?.id || null,
    workout_date: item.workout_date || todayDate(),
    sport: item.type,
    title: item.name,
    distance_km: Number(item.distanceKm || 0),
    duration_minutes: Number(item.minutes || 0),
    source: item.sourceRaw || item.source || 'aplikacja',
    garmin_activity_id: item.garminActivityId || null,
    external_url: item.sourceUrl || null,
    average_speed: avgSpeedNumber,
    average_pace: item.pace || null,
    elevation_gain_m: numericOrNull(item.elevation || item.ascent) || null,
    calories: numericOrNull(item.calories) || null,
    avg_hr: numericOrNull(item.avgHr) || null,
    max_hr: numericOrNull(item.maxHr) || null,
    avg_power: numericOrNull(metricValue(item, 'avgPower')) || null,
    max_power: numericOrNull(metricValue(item, 'maxPower')) || null,
    avg_cadence: numericOrNull(metricValue(item, 'avgCadence')) || null,
    np_watts: numericOrNull(metricValue(item, 'npPower')) || null,
    intensity_factor: numericOrNull(metricValue(item, 'intensityFactor')) || null,
    tss: numericOrNull(metricValue(item, 'tss')) || null,
    advanced_data: item.metrics && Object.keys(item.metrics).length ? { metrics: item.metrics, rawAdvancedText: item.rawAdvancedText || '' } : null,
    notes: JSON.stringify({
      source: item.sourceRaw || item.source || 'aplikacja',
      elevation: item.elevation || 0,
      calories: item.calories || 0,
      note: item.note || '',
      sourceUrl: item.sourceUrl || '',
      garminActivityId: item.garminActivityId || '',
      avgHr: item.avgHr || null,
      maxHr: item.maxHr || null,
      ascent: item.ascent || item.elevation || 0,
      parsedBy: item.parsedBy || '',
      pace: item.pace || null,
      speed: item.speed || null,
      latitude: item.latitude || null,
      longitude: item.longitude || null,
      rawDescription: item.rawDescription || '',
      metrics: item.metrics || {},
      rawAdvancedText: item.rawAdvancedText || '',
      version: VERSION
    })
  };
}
function setSync(text,type='info'){
  const sync = $('syncStatus');
  if(sync){ sync.textContent = text; sync.className = `sync-status ${type}`; }
  const cloud = $('cloudStatus');
  if(cloud){
    cloud.className = `cloud-status ${type === 'ok' ? 'ok' : type === 'warn' ? 'warn' : type === 'bad' ? 'bad' : 'waiting'}`;
    cloud.innerHTML = `<span></span> ${type === 'ok' ? 'Supabase online' : type === 'warn' ? 'Backup lokalny' : type === 'bad' ? 'Offline' : 'Supabase...'}`;
  }
}
function getSavedSession(){
  try { return JSON.parse(localStorage.getItem(AUTH_SESSION_KEY)); } catch { return null; }
}
function setAuthStatus(text, type='info'){
  const el = $('authStatus'); if(el){ el.textContent = text; el.className = `sync-status ${type}`; }
  const acc = $('accountStatus'); if(acc){ acc.textContent = text; acc.className = `sync-status ${type}`; }
}
function showLogin(){
  const auth = $('authScreen'); const app = $('appShell');
  if(auth) auth.hidden = false;
  if(app) app.hidden = true;
  setAuthStatus('Zaloguj konto Szymona, żeby uruchomić aplikację.', 'info');
}
function showApp(){
  const auth = $('authScreen'); const app = $('appShell');
  if(auth) auth.hidden = true;
  if(app) app.hidden = false;
}
function saveSession(data){
  currentSession = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || '',
    expires_at: data.expires_at || Math.floor(Date.now()/1000) + Number(data.expires_in || 3600),
    user: data.user || null
  };
  currentUser = currentSession.user;
  localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(currentSession));
  setAuthStatus(`Zalogowano: ${currentUser?.email || 'konto Szymona'}`, 'ok');
}
function loadStoredAuth(){
  const saved = getSavedSession();
  if(!saved || !saved.access_token || !saved.user) return false;
  currentSession = saved;
  currentUser = saved.user;
  setAuthStatus(`Zalogowano: ${currentUser?.email || 'konto Szymona'}`, 'ok');
  return true;
}
async function refreshSessionIfNeeded(force=false){
  if(!currentSession?.access_token) return false;
  const now = Math.floor(Date.now()/1000);
  const expiresAt = Number(currentSession.expires_at || 0);
  if(!force && expiresAt && expiresAt - now > 180) return true;
  if(!currentSession.refresh_token) return Boolean(currentSession.access_token);
  try{
    const response = await fetch(AUTH_REFRESH_ENDPOINT, {
      method:'POST',
      headers: anonHeaders({'Content-Type':'application/json'}),
      body: JSON.stringify({ refresh_token: currentSession.refresh_token })
    });
    const data = await response.json().catch(()=>({}));
    if(!response.ok) throw new Error(data.error_description || data.msg || data.error || `Odświeżenie sesji nieudane (${response.status})`);
    saveSession({ ...data, user: data.user || currentSession.user });
    return true;
  }catch(err){
    console.warn('refreshSessionIfNeeded', err);
    return false;
  }
}
async function signIn(){
  const email = $('authEmail')?.value?.trim();
  const password = $('authPassword')?.value || '';
  if(!email || !password){ setAuthStatus('Wpisz email i hasło.', 'warn'); return; }
  setAuthStatus('Loguję do Supabase Auth...', 'info');
  try{
    const response = await fetch(AUTH_TOKEN_ENDPOINT, {
      method:'POST',
      headers: anonHeaders({'Content-Type':'application/json'}),
      body: JSON.stringify({ email, password })
    });
    const data = await response.json().catch(()=>({}));
    if(!response.ok) throw new Error(data.error_description || data.msg || data.error || `Logowanie nieudane (${response.status})`);
    saveSession(data);
    showApp();
    await bootAppData();
  }catch(err){
    console.warn(err);
    setAuthStatus(`Nie udało się zalogować: ${err.message}`, 'bad');
  }
}
async function signOut(){
  try{
    if(currentSession?.access_token){
      await fetch(AUTH_LOGOUT_ENDPOINT, { method:'POST', headers:headers() });
    }
  }catch(err){ console.warn(err); }
  currentSession = null; currentUser = null; trainings = [];
  localStorage.removeItem(AUTH_SESSION_KEY);
  setSync('Wylogowano — dane w Supabase zostały w chmurze.','info');
  showLogin();
}
async function bootAppData(){
  renderAll();
  await loadProfile();
  await loadGarminSyncState();
  await loadDailyMetrics();
  await loadAiJournalFromCloud();
  await loadTrainings();
}
async function loadProfile(){
  try{
    let rows = await apiGet(`${PROFILE_ENDPOINT}?select=*&${userFilter()}limit=1`);
    if(rows && rows[0]){
      profileRowId = rows[0].id;
      athleteProfile = {
        athlete_name: rows[0].athlete_name || 'Szymon',
        target_event: rows[0].target_event || 'IRONMAN Kalmar 2026',
        target_date: rows[0].target_date || '2026-08-15'
      };
      if($('athleteNameInput')) $('athleteNameInput').value = athleteProfile.athlete_name;
      if($('targetEventInput')) $('targetEventInput').value = athleteProfile.target_event;
      if($('targetDateInput')) $('targetDateInput').value = athleteProfile.target_date;
      if($('profileStatus')) { $('profileStatus').textContent = `Profil załadowany: ${athleteProfile.athlete_name} • ${athleteProfile.target_event}`; $('profileStatus').className = 'sync-status ok'; }
      setSync(`Supabase połączony • ${athleteProfile.athlete_name} • ${athleteProfile.target_event}`,'ok');
      updateKalmarRoad();
    }
  }catch(err){
    console.warn(err);
    if($('profileStatus')) { $('profileStatus').textContent = 'Nie udało się pobrać profilu. Zostają wartości domyślne.'; $('profileStatus').className = 'sync-status warn'; }
  }
}
async function saveProfile(){
  const body = {
    athlete_name: $('athleteNameInput')?.value?.trim() || 'Szymon',
    target_event: $('targetEventInput')?.value?.trim() || 'IRONMAN Kalmar 2026',
    target_date: $('targetDateInput')?.value || '2026-08-15',
    user_id: currentUser?.id || null
  };
  if($('profileStatus')) { $('profileStatus').textContent = 'Zapisuję profil w Supabase...'; $('profileStatus').className = 'sync-status info'; }
  try{
    let rows = [];
    if(profileRowId) rows = await apiPatch(`${PROFILE_ENDPOINT}?id=eq.${encodeURIComponent(profileRowId)}`, body);
    else rows = await apiPost(PROFILE_ENDPOINT, body);
    profileRowId = rows?.[0]?.id || profileRowId;
    athleteProfile = body;
    if($('profileStatus')) { $('profileStatus').textContent = `Zapisano profil: ${body.athlete_name} • ${body.target_event}`; $('profileStatus').className = 'sync-status ok'; }
    updateKalmarRoad();
  }catch(err){
    console.warn(err);
    if($('profileStatus')) { $('profileStatus').textContent = 'Nie udało się zapisać profilu w Supabase.'; $('profileStatus').className = 'sync-status bad'; }
  }
}
async function loadGarminSyncState(){
  try{
    const rows = await apiGet(`${GARMIN_SYNC_STATE_ENDPOINT}?select=*&id=eq.main&limit=1`);
    garminSyncState = rows?.[0] || null;
    renderGarminSyncState();
  }catch(err){
    console.warn('Nie udało się pobrać statusu Garmin Sync', err);
    garminSyncState = null;
    renderGarminSyncState();
  }
}
function nextGarminSyncTimeText(){
  const now = new Date();
  const schedule = [{h:6,m:15},{h:10,m:15},{h:14,m:15},{h:18,m:15},{h:21,m:0}];
  for(const t of schedule){
    const d = new Date(now);
    d.setHours(t.h, t.m, 0, 0);
    if(d > now) return d.toLocaleTimeString('pl-PL', {hour:'2-digit', minute:'2-digit'});
  }
  const d = new Date(now);
  d.setDate(d.getDate()+1); d.setHours(6,15,0,0);
  return `jutro ${d.toLocaleTimeString('pl-PL', {hour:'2-digit', minute:'2-digit'})}`;
}
function garminSyncAgeLabel(when){
  if(!when) return {label:'brak danych', level:'warn'};
  const d = new Date(when);
  if(Number.isNaN(d.getTime())) return {label:'brak daty', level:'warn'};
  const diffMin = Math.round((Date.now() - d.getTime()) / 60000);
  if(diffMin < 90) return {label:'świeże', level:'ok'};
  if(diffMin < 8*60) return {label:'dzisiaj', level:'ok'};
  if(diffMin < 30*60) return {label:'starsze', level:'warn'};
  return {label:'dawno temu', level:'bad'};
}
function renderGarminSyncState(){
  const el = $('garminSyncStatus');
  const mini = $('syncMiniStatus');
  const setMini = (id, value) => { const x=$(id); if(x) x.textContent = value; };
  if(!garminSyncState){
    if(el){
      el.className = 'sync-status warn';
      el.textContent = 'Garmin Sync Agent: brak statusu. Sprawdź, czy kontener wykonał już synchronizację.';
    }
    if(mini){ mini.className = 'garmin-mini-status warn'; mini.textContent = 'Brak statusu agenta Garmin Sync.'; }
    setMini('syncMiniTime','—'); setMini('syncMiniFetched','—'); setMini('syncMiniDays', dailyMetrics.length || '—'); setMini('syncMiniNext', nextGarminSyncTimeText());
    return;
  }
  const when = garminSyncState.last_success_at || garminSyncState.last_run_at || '';
  const date = when ? new Date(when) : null;
  const whenText = date && !Number.isNaN(date.getTime()) ? date.toLocaleString('pl-PL', { dateStyle:'short', timeStyle:'short' }) : 'brak daty';
  const shortTime = date && !Number.isNaN(date.getTime()) ? date.toLocaleTimeString('pl-PL', {hour:'2-digit', minute:'2-digit'}) : '—';
  const fetched = garminSyncState.fetched_count ?? 0;
  const updated = garminSyncState.inserted_or_updated_count ?? 0;
  const status = garminSyncState.status || 'unknown';
  const age = garminSyncAgeLabel(when);
  const cls = status === 'ok' || status === 'success' ? 'ok' : status === 'error' ? 'bad' : age.level;
  if(el){
    el.className = `sync-status ${cls}`;
    el.textContent = `Garmin Sync Agent: ostatnio ${whenText} • pobrano ${fetched} • zapisano/zaaktualizowano ${updated}`;
  }
  if(mini){
    mini.className = `garmin-mini-status ${cls}`;
    mini.textContent = status === 'error' ? 'Ostatnia synchronizacja zakończyła się błędem.' : `Status: ${age.label} • automat działa 06:15, 10:15, 14:15, 18:15 i 21:00`;
  }
  setMini('syncMiniTime', shortTime);
  setMini('syncMiniFetched', String(fetched));
  setMini('syncMiniDays', String(dailyMetrics.length || 0));
  setMini('syncMiniNext', nextGarminSyncTimeText());
}

async function loadDailyMetrics(){
  try{
    const rows = await apiGet(`${DAILY_METRICS_ENDPOINT}?select=*&${userFilter()}order=metric_date.desc&limit=30`);
    dailyMetrics = rows || [];
    latestDailyMetric = dailyMetrics[0] || null;
  }catch(err){
    console.warn('Nie udało się pobrać metryk dziennych Garmin', err);
    dailyMetrics = [];
    latestDailyMetric = null;
  }
}
function fmtInt(v, suffix=''){
  const n = Number(v);
  if(!Number.isFinite(n)) return '—';
  return `${Math.round(n).toLocaleString('pl-PL')}${suffix}`;
}
function fmtSleep(minutes){
  const n = Number(minutes);
  if(!Number.isFinite(n) || n <= 0) return 'brak danych';
  const h = Math.floor(n/60);
  const m = Math.round(n % 60);
  return `${h}h ${String(m).padStart(2,'0')}min`;
}
function latestMetricForDate(dateStr){
  if(!dateStr) return latestDailyMetric;
  return dailyMetrics.find(d => String(d.metric_date || '').slice(0,10) === String(dateStr).slice(0,10)) || latestDailyMetric;
}
function recoveryShort(metric){
  if(!metric) return 'brak danych';
  const r = recoveryScore(metric);
  return `${formatDate(metric.metric_date)} • sen ${fmtSleep(metric.sleep_minutes)} • BB ${fmtInt(metric.body_battery_end || metric.body_battery_max || metric.body_battery_charged, '/100')} • stres ${fmtInt(metric.avg_stress)} • ${r.label}`;
}
function renderRecoveryHistory(){
  const box = $('recoveryHistoryList');
  if(!box) return;
  if(!dailyMetrics.length){
    box.innerHTML = '<div class="empty-history">Brak historii regeneracji. Poczekaj na synchronizację Garmin Sync Agent.</div>';
    return;
  }
  box.innerHTML = dailyMetrics.slice(0,14).map(m => {
    const r = recoveryScore(m);
    const bb = fmtInt(m.body_battery_end ?? m.body_battery_max ?? m.body_battery_charged, '/100');
    return `<div class="recovery-day ${r.score < 55 ? 'low' : r.score >= 72 ? 'good' : ''}">
      <div><b>${formatDate(m.metric_date)}</b><span>${r.label}</span></div>
      <div><small>Sen</small><strong>${fmtSleep(m.sleep_minutes)}</strong></div>
      <div><small>Body Battery</small><strong>${bb}</strong></div>
      <div><small>Stres</small><strong>${fmtInt(m.avg_stress)}</strong></div>
      <div><small>Tętno spocz.</small><strong>${fmtInt(m.resting_hr, ' bpm')}</strong></div>
      <p>${escapeHtml(r.advice)}</p>
    </div>`;
  }).join('');
}

function recoveryTone(metric){
  const r = recoveryScore(metric);
  if(r.score >= 78) return {icon:'🟢', title:'Organizm gotowy', text:'Dobra baza pod normalny trening. Nadal pilnuj techniki i nie dokładaj siły na siłę.'};
  if(r.score >= 60) return {icon:'🟡', title:'Trenuj rozsądnie', text:'Można trenować, ale lepiej bez dokładania kolejnego mocnego akcentu.'};
  return {icon:'🔴', title:'Regeneracja ważniejsza', text:'Dziś wygra spokojny ruch, pływanie techniczne albo odpoczynek. Nie cisnąłbym intensywności.'};
}
function renderPremiumRecovery(){
  const list = $('premiumRecoveryList');
  const note = $('premiumRecoveryNote');
  if(!list && !note) return;
  if(!dailyMetrics.length){
    if(list) list.innerHTML = '<div class="empty-history">Brak danych regeneracji. Garmin Sync Agent uzupełni je po synchronizacji.</div>';
    if(note) note.textContent = 'Brak historii regeneracji — czekam na kolejne dane z Garmina.';
    return;
  }
  const latest = dailyMetrics[0];
  const tone = recoveryTone(latest);
  const latestScore = recoveryScore(latest);
  if(note) note.innerHTML = `<b>${tone.icon} ${tone.title}.</b> ${tone.text}`;
  if(!list) return;
  list.innerHTML = dailyMetrics.slice(0,7).map(m => {
    const r = recoveryScore(m);
    const tone = recoveryTone(m);
    const sleep = Number(m.sleep_minutes || 0);
    const sleepClass = sleep && sleep < 330 ? 'warn' : sleep >= 420 ? 'good' : '';
    const bb = Number(m.body_battery_end ?? m.body_battery_max ?? m.body_battery_charged ?? NaN);
    const stress = Number(m.avg_stress || NaN);
    return `<article class="premium-recovery-row ${r.score < 55 ? 'low' : r.score >= 78 ? 'good' : ''}">
      <div class="premium-day-main">
        <span>${tone.icon}</span>
        <div><b>${formatDate(m.metric_date)}</b><small>${tone.title}</small></div>
      </div>
      <div class="premium-metrics-line">
        <span class="${sleepClass}">Sen <b>${fmtSleep(m.sleep_minutes)}</b></span>
        <span>BB <b>${Number.isFinite(bb) ? Math.round(bb) + '/100' : '—'}</b></span>
        <span>Stres <b>${Number.isFinite(stress) ? Math.round(stress) : '—'}</b></span>
        <span>RHR <b>${fmtInt(m.resting_hr, ' bpm')}</b></span>
      </div>
      <p>${escapeHtml(r.advice)}</p>
    </article>`;
  }).join('');
}
function openRecoveryDetails(){
  renderRecoveryHistory();
  const overlay = $('recoveryDetails');
  if(!overlay) return;
  overlay.hidden = false;
  document.body.classList.add('details-open');
}
function closeRecoveryDetails(){
  const overlay = $('recoveryDetails');
  if(overlay) overlay.hidden = true;
  if($('workoutDetails')?.hidden !== false) document.body.classList.remove('details-open');
}
function recoveryScore(metric=latestDailyMetric){
  if(!metric) return {score: 60, label:'brak danych', penalty:0, advice:'Brak pełnych danych regeneracji z Garmina.'};
  const sleep = Number(metric.sleep_minutes || 0);
  const bb = Number(metric.body_battery_end ?? metric.body_battery_max ?? metric.body_battery_charged ?? NaN);
  const stress = Number(metric.avg_stress || 0);
  const rhr = Number(metric.resting_hr || 0);
  let score = 72;
  if(sleep){
    if(sleep < 330) score -= 16;
    else if(sleep < 390) score -= 8;
    else if(sleep >= 450) score += 8;
  }
  if(Number.isFinite(bb)){
    if(bb < 35) score -= 18;
    else if(bb < 55) score -= 8;
    else if(bb > 70) score += 8;
  }
  if(stress){
    if(stress > 35) score -= 12;
    else if(stress > 25) score -= 6;
    else if(stress < 20) score += 5;
  }
  if(rhr && rhr > 55) score -= 5;
  score = clamp(Math.round(score), 25, 95);
  let label = 'średnia regeneracja';
  let advice = 'Trening może być normalny, ale kontroluj intensywność.';
  if(score >= 78){ label = 'dobra regeneracja'; advice = 'Organizm wygląda dobrze — można planować normalny trening.'; }
  else if(score < 55){ label = 'niska regeneracja'; advice = 'Lepiej wybrać lekki trening techniczny, pływanie albo regenerację.'; }
  return {score, label, penalty: Math.max(0, 72-score), advice};
}
function renderRecovery(){
  const m = latestDailyMetric;
  const rec = recoveryScore(m);
  const set = (id, value) => { const el=$(id); if(el) el.textContent = value; };
  set('recoveryDate', m?.metric_date ? new Date(`${m.metric_date}T12:00:00`).toLocaleDateString('pl-PL', {weekday:'short', day:'2-digit', month:'2-digit'}) : 'brak danych');
  set('recoverySleep', fmtSleep(m?.sleep_minutes));
  set('recoveryBB', Number.isFinite(Number(m?.body_battery_end)) ? `${Math.round(Number(m.body_battery_end))}/100` : '—');
  set('recoveryStress', Number.isFinite(Number(m?.avg_stress)) ? `${Math.round(Number(m.avg_stress))}` : '—');
  set('recoveryRhr', Number.isFinite(Number(m?.resting_hr)) ? `${Math.round(Number(m.resting_hr))} bpm` : '—');
  set('recoverySteps', fmtInt(m?.steps));
  set('recoveryCalories', fmtInt(m?.calories, ' kcal'));
  set('recoveryScore', `${rec.score}/100`);
  set('recoveryLabel', rec.label);
  set('recoveryAdvice', rec.advice);
  set('analysisSleep', fmtSleep(m?.sleep_minutes));
  set('analysisBB', Number.isFinite(Number(m?.body_battery_end)) ? `${Math.round(Number(m.body_battery_end))}/100` : '—');
  set('analysisStress', Number.isFinite(Number(m?.avg_stress)) ? `${Math.round(Number(m.avg_stress))}` : '—');
  set('analysisRhr', Number.isFinite(Number(m?.resting_hr)) ? `${Math.round(Number(m.resting_hr))} bpm` : '—');
  set('analysisRecoveryScore', `${rec.score}/100`);
  set('analysisRecoveryAdvice', rec.advice);
  renderPremiumRecovery();
}


async function loadTrainings(){
  setSync('Łączenie z Supabase...','info');
  try{
    const rows = await apiGet(`${WORKOUTS_ENDPOINT}?select=*&${userFilter()}order=workout_date.desc,created_at.desc&limit=200`);
    cloudOnline = true;
    trainings = sortTrainings(rows.map(fromDb));
    saveLocalBackup(trainings);
    setSync(`Supabase działa • treningów w chmurze: ${trainings.length}`,'ok');
  }catch(err){
    cloudOnline = false;
    trainings = localBackup();
    setSync('Brak połączenia z Supabase — pokazuję lokalny backup','warn');
    console.warn(err);
  }
  renderGarminSyncState();
  renderAll();
  updatePreview();
}
async function addTraining(item){
  const reason = duplicateReason(item);
  if(reason){
    setSync('Nie zapisano duplikatu — ten trening jest już w historii','warn');
    setGarminStatus(`⚠️ ${reason}`, 'warn');
    updateDuplicateHint(item);
    showTab('history');
    return;
  }
  const fixedDate = String(item.workout_date || item.date || todayDate()).slice(0,10);
  const localItem = { id:`local-${Date.now()}`, ...item, workout_date: fixedDate, date: fixedDate, addedAt: new Date().toISOString() };
  const backup = [localItem, ...localBackup()];
  saveLocalBackup(backup);

  if(!cloudOnline){
    trainings = backup;
    setSync('Zapisano tylko lokalnie — odśwież po powrocie internetu','warn');
    renderAll();
    return;
  }
  setSync('Zapisywanie treningu do Supabase...','info');
  try{
    const inserted = await apiPost(WORKOUTS_ENDPOINT, toDb(item));
    const saved = inserted && inserted[0] ? fromDb(inserted[0]) : localItem;
    trainings = sortTrainings([saved, ...trainings]).slice(0,200);
    saveLocalBackup(trainings);
    setSync('Trening zapisany w Supabase — PC i iPhone widzą te same dane','ok');
    renderAll();
    showTab('history');
  }catch(err){
    cloudOnline = false;
    trainings = backup;
    setSync('Nie udało się zapisać w chmurze — zostawiam lokalny backup','warn');
    console.warn(err);
    renderAll();
  }
}

function updateKalmarRoad(){
  const now = new Date();
  const dayMs = 86400000;
  const eventDate = raceDate();
  const daysLeft = Math.max(0, Math.ceil((eventDate - now)/dayMs));
  const prepDay = Math.max(1, Math.floor((now - START_PREP_DATE)/dayMs)+1);
  const totalPrep = Math.max(1, Math.ceil((eventDate - START_PREP_DATE)/dayMs));
  const progress = clamp(Math.round((prepDay/totalPrep)*100),0,100);
  $('daysLeft').textContent = daysLeft;
  $('prepDay').textContent = prepDay;
  $('progressText').textContent = progress + '%';
  $('quoteText').textContent = quotes[prepDay % quotes.length];
}
function currentWeek(){
  const now = Date.now();
  const weekAgo = now - 7*86400000;
  return trainings.filter(x => new Date(`${trainingDate(x)}T12:00:00`).getTime() >= weekAgo);
}
function totalsFor(items){
  const totals = { swim:{km:0,min:0,count:0}, bike:{km:0,min:0,count:0}, run:{km:0,min:0,count:0} };
  for(const it of items){
    if(totals[it.type]){ totals[it.type].km += Number(it.distanceKm||0); totals[it.type].min += Number(it.minutes||0); totals[it.type].count++; }
  }
  return totals;
}
function renderTotals(){
  const week = currentWeek();
  const allTotals = totalsFor(trainings);
  const weekTotals = totalsFor(week);
  const set = (id, v) => { const el=$(id); if(el) el.textContent = v; };
  set('swimKm', `${formatKm(weekTotals.swim.km)} km`); set('swimTime', `${Math.round(weekTotals.swim.min)} min`);
  set('bikeKm', `${formatKm(weekTotals.bike.km,1)} km`); set('bikeTime', `${Math.round(weekTotals.bike.min)} min`);
  set('runKm', `${formatKm(weekTotals.run.km,1)} km`); set('runTime', `${Math.round(weekTotals.run.min)} min`);
  set('periodSwim', `${formatKm(allTotals.swim.km)} km`); set('periodSwimTime', `${Math.round(allTotals.swim.min)} min`);
  set('periodBike', `${formatKm(allTotals.bike.km)} km`); set('periodBikeTime', `${Math.round(allTotals.bike.min)} min`);
  set('periodRun', `${formatKm(allTotals.run.km)} km`); set('periodRunTime', `${Math.round(allTotals.run.min)} min`);
  set('trainSwimKm', formatKm(weekTotals.swim.km,1));
  set('trainBikeKm', formatKm(weekTotals.bike.km,1));
  set('trainRunKm', formatKm(weekTotals.run.km,1));
  set('cloudCount', trainings.length);
}
function activityNameFor(item){
  if(item.name) return item.name;
  const meta = sportMeta[item.type] || sportMeta.other;
  return `${meta.pl} — trening Kalmar`;
}
function workoutHtml(item, withActions=false){
  const meta = sportMeta[item.type] || sportMeta.other;
  const pace = calcPace(item.distanceKm, item.minutes, item.type);
  const id = String(item.id || '');
  const actions = withActions ? `<button class="delete-workout" data-delete-id="${id}" title="Usuń trening">Usuń</button>` : `<div class="chev">›</div>`;
  return `<div class="workout-item" data-workout-id="${id}" role="button" tabindex="0" title="Pokaż szczegóły treningu">
    <div class="workout-icon ${meta.cls}">${meta.icon}</div>
    <div class="workout-main"><b>${activityNameFor(item).replace(' — trening Kalmar','')}</b><small>${formatDate(trainingDate(item))}${formatTime(item.date) ? ` • ${formatTime(item.date)}` : ''}</small></div>
    <div class="workout-metric"><b>${formatKm(item.distanceKm)} km</b><small>${minutesToClock(item.minutes)} • ${pace}</small></div>
    ${actions}
  </div>`;
}
function metricValue(item, key){
  return item?.metrics && item.metrics[key] !== undefined && item.metrics[key] !== null ? String(item.metrics[key]) : '';
}
function metricNumber(item, key){
  const raw = metricValue(item, key);
  if(!raw) return null;
  let s = raw.replace(/\s/g,'').replace(/[^0-9,.-]/g,'');
  if(!s) return null;
  if(s.includes(',') && !s.includes('.')){
    const parts = s.split(',');
    if(parts.length === 2 && parts[1].length === 3 && parts[0].length <= 3) s = parts[0] + parts[1];
    else s = s.replace(',', '.');
  } else if(s.includes(',') && s.includes('.')) {
    s = s.replace(/,/g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function hasAdvancedMetrics(item){
  return !!(item?.metrics && Object.keys(item.metrics).length);
}
function advancedTrainingLoad(item){
  const tss = metricNumber(item, 'tss');
  const ifv = metricNumber(item, 'intensityFactor');
  const avgHr = metricNumber(item, 'avgHr');
  const maxHr = metricNumber(item, 'maxHr');
  const bodyBattery = metricNumber(item, 'bodyBattery');
  let score = 0;
  if(tss !== null) score += Math.min(30, tss / 6);
  if(ifv !== null) score += ifv >= 0.9 ? 14 : ifv >= 0.8 ? 9 : ifv >= 0.7 ? 5 : 0;
  if(maxHr !== null && maxHr >= 190) score += 8;
  if(avgHr !== null && avgHr >= 150) score += 5;
  if(bodyBattery !== null && bodyBattery <= -20) score += 6;
  return Math.round(score);
}
function advancedInsight(item){
  if(!hasAdvancedMetrics(item)) return '';
  const type = item.type || 'other';
  const tss = metricNumber(item, 'tss');
  const ifv = metricNumber(item, 'intensityFactor');
  const avgPower = metricNumber(item, 'avgPower');
  const np = metricNumber(item, 'npPower');
  const avgHr = metricNumber(item, 'avgHr');
  const maxHr = metricNumber(item, 'maxHr');
  const avgCad = metricNumber(item, 'avgCadence');
  const bb = metricNumber(item, 'bodyBattery');
  const parts = [];
  if(type === 'bike'){
    if(tss !== null || ifv !== null) parts.push('Ostatni rower miał odczuwalne obciążenie, więc kolejny mocny akcent warto planować dopiero po dobrej regeneracji.');
    if(avgPower !== null && np !== null) parts.push(`${np - avgPower >= 25 ? 'Jazda była zmienna i pagórkowata' : 'Jazda była dość równa'}, więc nogi mogą potrzebować spokojniejszego bodźca.`);
    if(avgCad !== null) parts.push('Kadencja jest dobrym punktem obserwacji pod długie 180 km, ale dziś ważniejsza jest jakość regeneracji.');
  }
  if(type === 'run'){
    if(avgHr !== null) parts.push('Bieg miał mierzalny koszt dla organizmu — oceniaj kolejny trening razem ze snem, łydkami i samopoczuciem.');
    if(maxHr !== null && maxHr >= 190) parts.push('Były bardzo intensywne fragmenty, więc następny dzień powinien być spokojniejszy.');
    if(tss !== null) parts.push('Ten bieg dokłada obciążenie do tygodnia.');
  }
  if(type === 'swim'){
    parts.push('Pływanie jest dobrym wyborem technicznym, jeśli ciało nie jest gotowe na bieganie lub mocny rower.');
  }
  if(maxHr !== null && maxHr >= 195) parts.push('Po tak wysokim tętnie następny dzień powinien być spokojniejszy.');
  if(bb !== null && bb <= -20) parts.push('Body Battery sugeruje zauważalny koszt regeneracyjny.');
  return [...new Set(parts)].join(' ');
}
function detailAiText(item){
  const pace = calcPace(item.distanceKm, item.minutes, item.type);
  const km = Number(item.distanceKm || 0);
  const min = Number(item.minutes || 0);
  const type = item.type || 'run';
  const advanced = advancedInsight(item);
  let base = '';
  if(type === 'swim') base = `Pływanie ${formatKm(km)} km w czasie ${minutesToClock(min)}. Dobry element techniczny i tlenowy pod Kalmar. Kontroluj spokojny rytm i jakość ruchu.`;
  else if(type === 'bike') base = `Rower ${formatKm(km)} km${item.elevation ? `, przewyższenie +${Math.round(Number(item.elevation))} m` : ''}${item.speed ? `, średnia ${item.speed}` : ''}. To ważne budowanie bazy pod 180 km w Kalmar.`;
  else if(type === 'run') base = `Bieg ${formatKm(km)} km ze średnim tempem ${item.pace || pace}${item.elevation ? ` i przewyższeniem +${Math.round(Number(item.elevation))} m` : ''}. Ten trening buduje wytrzymałość biegową pod maraton po rowerze.`;
  else base = `Trening zapisany w historii. Każda aktywność dokłada cegiełkę do Road to Kalmar 2026.`;
  if(advanced) return `${base} Dane zaawansowane: ${advanced}`;
  return `${base} Jeśli trening był mocny, następnego dnia warto rozważyć lżejsze pływanie albo spokojny bieg.`;
}

const metricLabels = {
  avgPower: 'Śr. moc', maxPower: 'Maks. moc', npPower: 'Normalized Power', intensityFactor: 'IF', tss: 'TSS', ftp: 'FTP', workKj: 'Praca',
  avgHr: 'Śr. tętno', maxHr: 'Maks. tętno', avgCadence: 'Śr. kadencja', maxCadence: 'Maks. kadencja',
  movingTime: 'Czas ruchu', elapsedTime: 'Upłynęło czasu', avgSpeed: 'Śr. prędkość', movingSpeed: 'Śr. prędkość ruchu', maxSpeed: 'Maks. prędkość',
  elevationGain: 'Wznios', elevationLoss: 'Spadek', minElevation: 'Min. wysokość', maxElevation: 'Maks. wysokość',
  restingCalories: 'Kalorie spocz.', activeCalories: 'Kalorie aktywne', totalCalories: 'Kalorie suma', fluidLoss: 'Utrata płynów',
  staminaStart: 'Stamina start', staminaEnd: 'Stamina koniec', staminaMin: 'Stamina min.', bodyBattery: 'Body Battery',
  aerobicTE: 'Aerobowy TE', anaerobicTE: 'Beztlenowy TE', trainingLoad: 'Obciążenie', benefit: 'Korzyść treningu',
  standingTime: 'Czas stojąc', standingPowerAvg: 'Śr. moc stojąc', seatedTime: 'Czas siedząc', seatedPowerAvg: 'Śr. moc siedząc', revolutions: 'Obroty'
};
const metricOrder = ['avgPower','maxPower','npPower','intensityFactor','tss','ftp','workKj','avgHr','maxHr','avgCadence','maxCadence','movingTime','elapsedTime','avgSpeed','movingSpeed','maxSpeed','elevationGain','elevationLoss','minElevation','maxElevation','restingCalories','activeCalories','totalCalories','fluidLoss','staminaStart','staminaEnd','staminaMin','bodyBattery','aerobicTE','anaerobicTE','trainingLoad','benefit','standingTime','standingPowerAvg','seatedTime','seatedPowerAvg','revolutions'];

function normalizeMetricKeyAndValue(key, value){
  // v2.1.2 — dodatkowa ochrona formatowania danych z Garmin Sync.
  const map = {
    averagePower: 'avgPower', maxAvgPower: 'maxPower', maxPower: 'maxPower', normalizedPower: 'npPower', normalized_power: 'npPower',
    averageHR: 'avgHr', averageHeartRate: 'avgHr', maxHR: 'maxHr', maxHeartRate: 'maxHr',
    averageCadence: 'avgCadence', maxCyclingCadence: 'maxCadence',
    movingDuration: 'movingTime', elapsedDuration: 'elapsedTime', duration: 'movingTime',
    averageSpeed: 'avgSpeed', speed: 'avgSpeed', maxSpeed: 'maxSpeed',
    ascent: 'elevationGain', elevationGain: 'elevationGain', descent: 'elevationLoss',
    calories: 'totalCalories', activeKilocalories: 'activeCalories', bmrKilocalories: 'restingCalories',
    trainingStressScore: 'tss', intensityFactor: 'intensityFactor', trainingEffectLabel: 'benefit'
  };
  const k = map[key] || key;
  return [k, value];
}

function renderAdvancedStats(item){
  const box = $('advancedStats');
  if(!box) return;
  const sourceMetrics = item.metrics || {};
  const normalized = {};
  Object.entries(sourceMetrics).forEach(([k,v]) => {
    const [nk,nv] = normalizeMetricKeyAndValue(k,v);
    if(nv !== undefined && nv !== null && String(nv).trim() !== '') normalized[nk] = nv;
  });
  const rows = metricOrder
    .filter(k => normalized[k] !== undefined && normalized[k] !== null && String(normalized[k]).trim() !== '')
    .map(k => `<div><span>${metricLabels[k] || k}</span><b>${escapeHtml(formatMetricValue(k, normalized[k]))}</b></div>`);
  if(!rows.length){
    box.className = 'advanced-stats empty';
    box.innerHTML = 'Brak dodatkowych danych. Użyj „Dodaj z Garmin”, aby wkleić szczegóły z Garmin Connect.';
    return;
  }
  box.className = 'advanced-stats';
  box.innerHTML = rows.join('');
}
function escapeHtml(text){
  return String(text || '').replace(/[&<>"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));
}
function firstMatch(text, patterns){
  for(const pat of patterns){
    const m = text.match(pat);
    if(m) return (m[1] || '').trim();
  }
  return '';
}
function normalizeGarminText(text){
  return String(text || '').replace(/\r/g,'').replace(/[ \t]+/g,' ').replace(/\n{2,}/g,'\n').trim();
}
function parseGarminAdvancedText(text){
  const t = normalizeGarminText(text);
  const metrics = {};
  const set = (key, value, unit='') => { if(value) metrics[key] = `${String(value).trim()}${unit ? ' ' + unit : ''}`; };
  set('avgPower', firstMatch(t, [/\n(\d+)\s*W\s*\nŚrednia moc/i, /Średnia moc\s*\n(\d+)\s*W/i]), '');
  set('maxPower', firstMatch(t, [/\n(\d+)\s*W\s*\nMaksymalna moc/i, /Maksymalna moc\s*\n(\d+)\s*W/i]), '');
  set('npPower', firstMatch(t, [/\n(\d+)\s*W\s*\nNormalized Power/i, /Normalized Power[^\n]*\n(\d+)\s*W/i]), '');
  set('intensityFactor', firstMatch(t, [/\n([0-9]+[,.][0-9]+)\s*\nIntensity Factor/i, /Intensity Factor[^\n]*\n([0-9]+[,.][0-9]+)/i]));
  set('tss', firstMatch(t, [/\n([0-9]+[,.][0-9]+)\s*\nTraining Stress Score/i, /Training Stress Score[^\n]*\n([0-9]+[,.][0-9]+)/i]));
  set('ftp', firstMatch(t, [/\n(\d+)\s*W\s*\nUstawienia FTP/i, /Ustawienia FTP\s*\n(\d+)\s*W/i]));
  set('workKj', firstMatch(t, [/\n([0-9,.]+)\s*kJ\s*\nPraca/i, /Praca\s*\n([0-9,.]+)\s*kJ/i]), 'kJ');
  set('avgHr', firstMatch(t, [/\n(\d+)\s*bpm\s*\nŚrednie tętno/i, /Średnie tętno\s*\n(\d+)\s*bpm/i]), 'bpm');
  set('maxHr', firstMatch(t, [/\n(\d+)\s*bpm\s*\nMaksymalne tętno/i, /Maksymalne tętno\s*\n(\d+)\s*bpm/i]), 'bpm');
  set('avgCadence', firstMatch(t, [/\n(\d+)\s*rpm\s*\nŚrednia kadencja/i, /Średnia kadencja[^\n]*\n(\d+)\s*rpm/i]), 'rpm');
  set('maxCadence', firstMatch(t, [/\n(\d+)\s*rpm\s*\nMaksymalna kadencja/i, /Maksymalna kadencja[^\n]*\n(\d+)\s*rpm/i]), 'rpm');
  set('movingTime', firstMatch(t, [/\n([0-9:]+)\s*\nCzas ruchu/i, /Czas ruchu\s*\n([0-9:]+)/i]));
  set('elapsedTime', firstMatch(t, [/\n([0-9:]+)\s*\nUpłynęło czasu/i, /Upłynęło czasu\s*\n([0-9:]+)/i]));
  set('avgSpeed', firstMatch(t, [/\n([0-9,.]+)\s*km\/h\s*\nŚrednia prędkość/i, /Średnia prędkość\s*\n([0-9,.]+)\s*km\/h/i]), 'km/h');
  set('movingSpeed', firstMatch(t, [/\n([0-9,.]+)\s*km\/h\s*\nŚrednia prędkość ruchu/i, /Średnia prędkość ruchu\s*\n([0-9,.]+)\s*km\/h/i]), 'km/h');
  set('maxSpeed', firstMatch(t, [/\n([0-9,.]+)\s*km\/h\s*\nMaksymalna prędkość/i, /Maksymalna prędkość\s*\n([0-9,.]+)\s*km\/h/i]), 'km/h');
  set('elevationGain', firstMatch(t, [/\n([0-9,.]+)\s*m\s*\nCałkowity wznios/i, /Całkowity wznios\s*\n([0-9,.]+)\s*m/i]), 'm');
  set('elevationLoss', firstMatch(t, [/\n([0-9,.]+)\s*m\s*\nCałkowity spadek/i, /Całkowity spadek\s*\n([0-9,.]+)\s*m/i]), 'm');
  set('minElevation', firstMatch(t, [/\n([0-9,.]+)\s*m\s*\nMinimalna wysokość/i, /Minimalna wysokość\s*\n([0-9,.]+)\s*m/i]), 'm');
  set('maxElevation', firstMatch(t, [/\n([0-9,.]+)\s*m\s*\nMaksymalna wysokość/i, /Maksymalna wysokość\s*\n([0-9,.]+)\s*m/i]), 'm');
  set('restingCalories', firstMatch(t, [/\n([0-9,.]+)\s*\nSpoczynkowe kalorie/i, /Spoczynkowe kalorie\s*\n([0-9,.]+)/i]), 'kcal');
  set('activeCalories', firstMatch(t, [/\n([0-9,.]+)\s*\nAktywne kalorie/i, /Aktywne kalorie\s*\n([0-9,.]+)/i]), 'kcal');
  set('totalCalories', firstMatch(t, [/\n([0-9,.]+)\s*\nSuma spalonych kalorii/i, /Suma spalonych kalorii\s*\n([0-9,.]+)/i]), 'kcal');
  set('fluidLoss', firstMatch(t, [/\n([0-9,.]+)\s*ml\s*\nSz\.utrata płyn/i, /Sz\.utrata płyn\.\s*\n([0-9,.]+)\s*ml/i]), 'ml');
  set('staminaStart', firstMatch(t, [/\n(\d+%)\s*\nPotencjał początkowy/i, /Potencjał początkowy\s*\n(\d+%)/i]));
  set('staminaEnd', firstMatch(t, [/\n(\d+%)\s*\nPotencjał końcowy/i, /Potencjał końcowy\s*\n(\d+%)/i]));
  set('staminaMin', firstMatch(t, [/\n(\d+%)\s*\nMin\. stamina/i, /Min\. stamina\s*\n(\d+%)/i]));
  set('bodyBattery', firstMatch(t, [/\n(-?\d+)\s*\nWpływ netto/i, /Wpływ netto\s*\n(-?\d+)/i]));
  set('aerobicTE', firstMatch(t, [/\n([0-9,.]+\s+[^\n]+)\s*\nAerobowy/i, /Aerobowy\s*\n([0-9,.]+\s+[^\n]+)/i]));
  set('anaerobicTE', firstMatch(t, [/\n([0-9,.]+\s+[^\n]+)\s*\nBeztlenowy/i, /Beztlenowy\s*\n([0-9,.]+\s+[^\n]+)/i]));
  set('trainingLoad', firstMatch(t, [/\n(\d+)\s*\nObciążenie wysiłkiem/i, /Obciążenie wysiłkiem\s*\n(\d+)/i]));
  set('benefit', firstMatch(t, [/\n([^\n]+)\s*\nPodstawowa korzyść/i, /Podstawowa korzyść\s*\n([^\n]+)/i]));
  set('standingTime', firstMatch(t, [/\n([0-9:]+)\s*\nCałkowity czas na stojąco/i, /Całkowity czas na stojąco\s*\n([0-9:]+)/i]));
  set('standingPowerAvg', firstMatch(t, [/\n(\d+)\s*W\s*\nŚrednia moc na stojąco/i, /Średnia moc na stojąco\s*\n(\d+)\s*W/i]), 'W');
  set('seatedTime', firstMatch(t, [/\n([0-9:]+)\s*\nCałkowity czas na siedząco/i, /Całkowity czas na siedząco\s*\n([0-9:]+)/i]));
  set('seatedPowerAvg', firstMatch(t, [/\n(\d+)\s*W\s*\nŚrednia moc na siedząco/i, /Średnia moc na siedząco\s*\n(\d+)\s*W/i]), 'W');
  set('revolutions', firstMatch(t, [/\n([0-9,.]+)\s*\nŁącznie obrotów/i, /Łącznie obrotów\s*\n([0-9,.]+)/i]));
  const avgHr = firstMatch(t, [/\n(\d+)\s*bpm\s*\nŚrednie tętno/i]);
  const maxHr = firstMatch(t, [/\n(\d+)\s*bpm\s*\nMaksymalne tętno/i]);
  const cal = firstMatch(t, [/\n([0-9,.]+)\s*\nSuma spalonych kalorii/i, /Suma spalonych kalorii\s*\n([0-9,.]+)/i]);
  const elev = firstMatch(t, [/\n([0-9,.]+)\s*m\s*\nCałkowity wznios/i, /Całkowity wznios\s*\n([0-9,.]+)\s*m/i]);
  return { metrics, avgHr: avgHr ? Number(avgHr) : null, maxHr: maxHr ? Number(maxHr) : null, calories: cal ? Number(String(cal).replace(/,/g,'')) : null, elevation: elev ? Number(String(elev).replace(/,/g,'')) : null, rawAdvancedText: t };
}
function mergeAdvancedIntoSelected(clear=false){
  if(!selectedWorkoutId) return;
  const item = trainings.find(x => String(x.id) === String(selectedWorkoutId));
  if(!item) return;
  if(clear){
    item.metrics = {};
    item.rawAdvancedText = '';
    item.avgHr = null;
    item.maxHr = null;
    renderAdvancedStats(item);
    if($('editGarminPaste')) $('editGarminPaste').value = '';
    setSync('Dodatkowe dane Garmin wyczyszczone. Kliknij „Zapisz zmiany”, aby zapisać w Supabase.', 'warn');
    return;
  }
  const text = $('editGarminPaste')?.value || '';
  if(!text.trim()){ alert('Wklej tekst ze szczegółów Garmin Connect.'); return; }
  const parsed = parseGarminAdvancedText(text);
  item.metrics = {...(item.metrics || {}), ...parsed.metrics};
  item.rawAdvancedText = parsed.rawAdvancedText;
  if(parsed.avgHr) item.avgHr = parsed.avgHr;
  if(parsed.maxHr) item.maxHr = parsed.maxHr;
  if(parsed.calories) item.calories = parsed.calories;
  if(parsed.elevation) { item.elevation = parsed.elevation; item.ascent = parsed.elevation; }
  renderAdvancedStats(item);
  $('detailsHeart').textContent = item.avgHr ? `${Math.round(Number(item.avgHr))} bpm${item.maxHr ? ` / max ${Math.round(Number(item.maxHr))}` : ''}` : '--';
  $('detailsCalories').textContent = item.calories ? `${Math.round(Number(item.calories))} kcal` : '--';
  $('detailsElevation').textContent = item.elevation || item.ascent ? `+${Math.round(Number(item.elevation || item.ascent || 0))} m` : '--';
  setSync(`Odczytano ${Object.keys(parsed.metrics).length} dodatkowych pól Garmin. Kliknij „Zapisz zmiany”.`, 'ok');
}

function openWorkoutDetails(id){
  const item = trainings.find(x => String(x.id) === String(id));
  if(!item) return;
  selectedWorkoutId = String(id);
  const meta = sportMeta[item.type] || sportMeta.other;
  $('detailsBadge').textContent = `${meta.icon} ${meta.label}`;
  $('detailsTitle').textContent = activityNameFor(item).replace(' — trening Kalmar','');
  $('detailsSub').textContent = `${formatDate(trainingDate(item))}${formatTime(item.date) ? ` • ${formatTime(item.date)}` : ''} • Road to Kalmar 2026${item.addedAt ? ` • dodano ${formatDate(item.addedAt)}` : ''}`;
  $('detailsDistance').textContent = `${formatKm(item.distanceKm)} km`;
  $('detailsDuration').textContent = minutesToClock(item.minutes);
  $('detailsPace').textContent = calcPace(item.distanceKm, item.minutes, item.type);
  $('detailsDate').textContent = formatDate(trainingDate(item));
  $('detailsSource').textContent = item.source || (item.sourceUrl ? 'Garmin Connect' : 'Aplikacja');
  $('detailsElevation').textContent = item.elevation || item.ascent ? `+${Math.round(Number(item.elevation || item.ascent || 0))} m` : '--';
  $('detailsCalories').textContent = item.calories ? `${Math.round(Number(item.calories))} kcal` : '--';
  $('detailsHeart').textContent = item.avgHr ? `${Math.round(Number(item.avgHr))} bpm${item.maxHr ? ` / max ${Math.round(Number(item.maxHr))}` : ''}` : '--';
  $('detailsGarminId').textContent = item.garminActivityId || (item.sourceUrl ? extractGarminActivityId(item.sourceUrl) : '') || '--';
  $('detailsAiText').textContent = detailAiText(item);
  $('editTitle').value = activityNameFor(item).replace(' — trening Kalmar','');
  $('editDistance').value = Number(item.distanceKm || 0).toFixed(2);
  if($('editWorkoutDate')) $('editWorkoutDate').value = trainingDate(item);
  $('editMinutes').value = Math.round(Number(item.minutes || 0));
  $('editNote').value = item.note || '';
  if($('editGarminPaste')) $('editGarminPaste').value = item.rawAdvancedText || '';
  if($('garminDetailsEditor')) $('garminDetailsEditor').hidden = true;
  renderAdvancedStats(item);
  const garminBtn = $('openGarminBtn');
  const hasUrl = !!item.sourceUrl;
  garminBtn.disabled = !hasUrl;
  garminBtn.textContent = hasUrl ? 'Otwórz w Garmin' : 'Brak linku Garmin';
  $('workoutDetails').hidden = false;
  document.body.classList.add('details-open');
}
function closeWorkoutDetails(){
  selectedWorkoutId = null;
  $('workoutDetails').hidden = true;
  document.body.classList.remove('details-open');
}
async function saveWorkoutDetails(){
  if(!selectedWorkoutId) return;
  const item = trainings.find(x => String(x.id) === String(selectedWorkoutId));
  if(!item) return;
  const updated = {
    ...item,
    name: $('editTitle').value.trim() || activityNameFor(item),
    distanceKm: Number($('editDistance').value || item.distanceKm || 0),
    minutes: Number($('editMinutes').value || item.minutes || 0),
    workout_date: $('editWorkoutDate')?.value || trainingDate(item),
    date: $('editWorkoutDate')?.value || trainingDate(item),
    note: $('editNote').value.trim(),
    metrics: item.metrics || {},
    rawAdvancedText: $('editGarminPaste')?.value.trim() || item.rawAdvancedText || '',
    avgHr: item.avgHr || null,
    maxHr: item.maxHr || null,
    calories: item.calories || 0,
    elevation: item.elevation || 0,
    ascent: item.ascent || item.elevation || 0
  };
  setSync('Zapisywanie zmian treningu...', 'info');
  try{
    if(cloudOnline && !String(updated.id).startsWith('local-')){
      const body = toDb(updated);
      delete body.user_id;
      await apiPatch(`${WORKOUTS_ENDPOINT}?id=eq.${encodeURIComponent(updated.id)}${currentUser?.id ? `&user_id=eq.${encodeURIComponent(currentUser.id)}` : ''}`, body);
    }
    trainings = sortTrainings(trainings.map(x => String(x.id) === String(updated.id) ? updated : x));
    saveLocalBackup(trainings);
    setSync('Zmiany treningu zapisane.', 'ok');
    renderAll();
    openWorkoutDetails(updated.id);
  }catch(err){
    console.warn(err);
    setSync('Nie udało się zapisać zmian treningu.', 'bad');
    alert('Nie udało się zapisać zmian.');
  }
}
function openSelectedGarmin(){
  const item = trainings.find(x => String(x.id) === String(selectedWorkoutId));
  if(item?.sourceUrl) window.open(item.sourceUrl, '_blank', 'noopener');
}
async function deleteSelectedWorkout(){
  if(!selectedWorkoutId) return;
  const id = selectedWorkoutId;
  closeWorkoutDetails();
  await deleteTraining(id);
}

async function deleteTraining(id){
  if(!id) return;
  const item = trainings.find(x => String(x.id) === String(id));
  if(!item) return;
  if(!confirm(`Usunąć trening: ${activityNameFor(item)} (${formatKm(item.distanceKm)} km)?`)) return;
  setSync('Usuwanie treningu...', 'info');
  try{
    if(cloudOnline && !String(id).startsWith('local-')){
      await apiDelete(`${WORKOUTS_ENDPOINT}?id=eq.${encodeURIComponent(id)}${currentUser?.id ? `&user_id=eq.${encodeURIComponent(currentUser.id)}` : ''}`);
    }
    trainings = trainings.filter(x => String(x.id) !== String(id));
    saveLocalBackup(trainings);
    setSync('Trening usunięty. Historia jest odświeżona.', 'ok');
    renderAll();
  }catch(err){
    console.warn(err);
    setSync('Nie udało się usunąć w Supabase. Spróbuj odświeżyć i ponowić.', 'bad');
    alert('Nie udało się usunąć treningu z Supabase.');
  }
}
function textForHistory(item){
  const meta = sportMeta[item.type] || sportMeta.other;
  return [activityNameFor(item), meta.label, meta.pl, item.type, formatDate(trainingDate(item)), formatKm(item.distanceKm), item.note, item.source, item.garminActivityId].join(' ').toLowerCase();
}
function inHistoryRange(item){
  if(historyRange === 'all') return true;
  const days = Number(historyRange || 30);
  const d = new Date(`${trainingDate(item)}T12:00:00`);
  if(Number.isNaN(d.getTime())) return true;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return d >= cutoff;
}
function filteredHistoryItems(){
  const full = trainings.length ? trainings : [demo];
  const q = historySearch.trim().toLowerCase();
  return full.filter(x => {
    if(activeFilter !== 'all' && x.type !== activeFilter) return false;
    if(!inHistoryRange(x)) return false;
    if(q && !textForHistory(x).includes(q)) return false;
    return true;
  });
}
function renderHistory(){
  const full = trainings.length ? trainings : [demo];
  const filtered = filteredHistoryItems();
  const html = filtered.length ? filtered.map(item => workoutHtml(item, true)).join('') : '<div class="empty-history">Brak treningów dla wybranego filtra lub wyszukiwanej frazy.</div>';
  $('historyList').innerHTML = html;
  $('recentList').innerHTML = full.slice(0,6).map(item => workoutHtml(item, false)).join('') || '<div class="empty-history">Dodaj pierwszy trening.</div>';
  const latestDash = full[0];
  if(latestDash){
    const meta = sportMeta[latestDash.type] || sportMeta.other;
    const titleEl = $('dashboardLatestTitle');
    const metaEl = $('dashboardLatestMeta');
    if(titleEl) titleEl.textContent = activityNameFor(latestDash).replace(' — trening Kalmar','');
    if(metaEl) metaEl.textContent = `${meta.label} • ${formatDate(trainingDate(latestDash))} • ${formatKm(latestDash.distanceKm)} km • ${minutesToClock(latestDash.minutes)}`;
  }
  const countLabel = $('historyCountLabel');
  if(countLabel) countLabel.textContent = `${filtered.length} / ${full.length}`;
}
function generateWeeklyPlan(readiness, loadLabel, missing){
  const base = [
    ['Pon', '🏊 Pływanie techniczne', '30–45 min • spokojnie, oddech i technika'],
    ['Wt', '🚴 Rower Z2', '60–90 min • równa praca, bez szarpania'],
    ['Śr', '🏃 Bieg easy', '30–45 min • komfortowe tempo'],
    ['Czw', '💪 Siła + core', '20–30 min • stabilizacja pod triathlon'],
    ['Pt', '🏊 Pływanie / mobilność', 'Lekko, technicznie, regeneracyjnie'],
    ['Sob', '🚴 Dłuższy rower', 'Z2 • budowanie bazy pod 180 km'],
    ['Nd', '🏃 Spokojny bieg', 'Easy albo odpoczynek, jeśli nogi ciężkie']
  ];
  if(loadLabel === 'mocny' || readiness < 58){
    base[1] = ['Wt', '😴 Regeneracja', 'Sen, mobilność, zero mocnych akcentów'];
    base[5] = ['Sob', '🚴 Rower bardzo lekki', '45–60 min Z1/Z2 albo wolne'];
    base[6] = ['Nd', '🚶 Spacer / wolne', 'Nie dokładamy zmęczenia'];
  } else if(missing.includes('swim')) {
    base[0] = ['Pon', '🏊 Pływanie techniczne', '45 min • priorytet tygodnia'];
    base[4] = ['Pt', '🏊 Drugie pływanie', '30–40 min • luźno i czysto technicznie'];
  } else if(missing.includes('bike')) {
    base[1] = ['Wt', '🚴 Rower Z2', '75 min • priorytet tygodnia'];
    base[5] = ['Sob', '🚴 Dłuższy rower', '90–120 min • bez ścigania'];
  } else if(missing.includes('run')) {
    base[2] = ['Śr', '🏃 Bieg easy', '40 min • spokojna objętość'];
    base[6] = ['Nd', '🏃 Bieg tlenowy', '45–60 min • kontrola tętna'];
  }
  return base.map(([day,title,desc]) => `<div class="plan-day"><b>${day}</b><span>${title}</span><small>${desc}</small></div>`).join('');
}

function textHasAny(text='', patterns=[]){
  const t = String(text || '').toLowerCase();
  return patterns.some(p => p.test(t));
}
function latestAiJournalEntry(){
  return aiJournal && aiJournal.length ? aiJournal[0] : null;
}
function evaluateSafetyContext({readiness=60, loadLabel='lekki', weekCount=0, weekMinutes=0, latest=null, rec=recoveryScore(latestDailyMetric), weekTss=0}={}){
  const latestEntry = latestAiJournalEntry();
  const recentEntries = (aiJournal || []).slice(0,5);
  const combinedText = recentEntries.map(e => [e.food,e.hydration,e.feeling,e.pain,e.notes].filter(Boolean).join(' ')).join(' ');
  const latestText = latestEntry ? [latestEntry.food, latestEntry.hydration, latestEntry.feeling, latestEntry.pain, latestEntry.notes].filter(Boolean).join(' ') : '';
  const redPatterns = [
    /ból\s*w\s*klatce|bol\s*w\s*klatce|klatce\s*piersiowej|serce|kołatan|kolatan|duszno|duszność|dusznosc|omdlen|zemdla|zawrot|gorącz|goracz|wymiot|biegun|krew|ostry\s*ból|ostry\s*bol|silny\s*ból|silny\s*bol|skręc|skrec|nie\s*mogę\s*chodzić|nie\s*moge\s*chodzic/i
  ];
  const illnessPatterns = [/przezięb|przezieb|infekcj|chory|choroba|kaszel|ból\s*gardła|bol\s*gardla|temperatura/i];
  const underFuelPatterns = [/głod|glod|mało\s*jad|malo\s*jad|nie\s*jadłem|nie\s*jadlem|bez\s*jedzenia|brak\s*apetytu|schud|waga\s*spad/i];
  const painEntries = recentEntries.filter(x => hasMeaningfulPain(x.pain));
  const sleep = latestDailyMetric ? Number(latestDailyMetric.sleep_minutes || 0) : 0;
  const bb = latestDailyMetric ? Number(latestDailyMetric.body_battery_end ?? latestDailyMetric.body_battery_max ?? latestDailyMetric.body_battery_charged ?? NaN) : NaN;
  const stress = latestDailyMetric ? Number(latestDailyMetric.avg_stress || 0) : 0;
  const rhr = latestDailyMetric ? Number(latestDailyMetric.resting_hr || 0) : 0;
  const energy = Number(latestEntry?.energy || 3);
  const selfStress = Number(latestEntry?.stress || 3);
  const latestMinutes = Number(latest?.minutes || 0);

  const red = [];
  const orange = [];
  const nutrition = [];
  if(textHasAny(latestText, redPatterns)) red.push('we wpisie dnia pojawia się objaw alarmowy: ból w klatce, duszność, omdlenie, gorączka, silny/ostry ból albo podobny sygnał');
  if(textHasAny(latestText, illnessPatterns)) orange.push('we wpisie dnia pojawia się choroba lub infekcja');
  if(painEntries.length >= 2) red.push('ból/przeciążenie powtarza się w kilku ostatnich wpisach');
  else if(painEntries.length === 1) orange.push('we wpisie pojawia się ból lub przeciążenie');
  if(sleep && sleep < 300) red.push(`sen był bardzo krótki (${fmtSleep(sleep)})`);
  else if(sleep && sleep < 360) orange.push(`sen był krótki (${fmtSleep(sleep)})`);
  if(Number.isFinite(bb) && bb < 30) red.push(`Body Battery jest bardzo niskie (${Math.round(bb)}/100)`);
  else if(Number.isFinite(bb) && bb < 45) orange.push(`Body Battery jest niskie (${Math.round(bb)}/100)`);
  if(stress && stress > 40) orange.push(`stres Garmin jest wysoki (${Math.round(stress)})`);
  if(rec && rec.score < 48) red.push(`ogólna regeneracja jest niska (${rec.score}/100)`);
  else if(rec && rec.score < 60) orange.push(`regeneracja jest średnio-słaba (${rec.score}/100)`);
  if((loadLabel === 'mocny' || weekTss > 280 || weekMinutes > 600) && rec && rec.score < 65) orange.push('obciążenie tygodnia jest wysokie przy niepełnej regeneracji');
  if(energy <= 2) orange.push(`Szymon wpisał niską energię (${energy}/5)`);
  if(selfStress >= 4) orange.push(`Szymon wpisał wysoki stres (${selfStress}/5)`);
  if(textHasAny(combinedText, underFuelPatterns)) nutrition.push('we wpisach pojawia się głód, mało jedzenia albo spadek apetytu — to sygnał, żeby mądrze dobrać obciążenie i lepszego posiłku regeneracyjnego');
  if(latestMinutes >= 90 && latestEntry && !latestEntry.food) nutrition.push('po długiej jednostce brakuje wpisu o jedzeniu — nie oceniam paliwa na pewniaka');
  if(latestEntry?.food && !/ryż|ryz|makaron|owsianka|ziemniak|pieczywo|kasza|banan|żel|zel|izotonik|płatki|platki|miód|miod/i.test(latestEntry.food) && latestMinutes >= 75){
    nutrition.push('przy długim treningu nie widzę jasnego źródła węglowodanów we wpisie — warto zadbać o paliwo, nie ciąć jedzenia');
  }
  if(latestEntry?.food && !/jaj|kurczak|twaróg|twarog|jogurt|ryba|mięso|mieso|ser|tofu|strącz|stracz|białko|bialko|mleko/i.test(latestEntry.food) && latestMinutes >= 45){
    nutrition.push('po treningu nie widzę jasnego źródła białka we wpisie — warto zadbać o posiłek regeneracyjny');
  }

  let level = 'green';
  if(red.length) level = 'red';
  else if(orange.length || nutrition.length) level = 'yellow';
  const title = level === 'red' ? 'Stop — najpierw zdrowie i sygnały z organizmu' : level === 'yellow' ? 'Mądra decyzja — bez dokładania mocnego akcentu' : 'Dane pozwalają trenować rozsądnie';
  const summary = level === 'red'
    ? 'To jest moment na decyzję zawodnika: nie dokładamy intensywności. Najpierw zdrowie, spokojny ruch tylko jeśli objawy na to pozwalają; przy objawach alarmowych rozmowa z dorosłym lub specjalistą.'
    : level === 'yellow'
      ? 'Dane pokazują, że dziś lepiej wygrać mądrą decyzją niż mocnym akcentem. Wybierz trening techniczny/tlenowy albo regenerację.'
      : 'Dane nie pokazują alarmu. Można realizować plan, pilnując techniki, snu, jedzenia i jakości wykonania.';
  const restriction = level === 'red'
    ? 'Bez interwałów, bez mocnego biegu, bez testów formy. Jeśli objawy są silne lub nietypowe — przerwij trening i skonsultuj się.'
    : level === 'yellow'
      ? 'Nie dokładaj mocnego akcentu. Wybierz lekki Z1/Z2, technikę, mobilność albo regenerację.'
      : 'Normalny trening tylko wtedy, gdy jest zgodny z planem i samopoczuciem.';
  return {level,title,summary,restriction,red,orange,nutrition, reasons:[...red,...orange,...nutrition]};
}
function safetyHtmlBlock(safety){
  if(!safety) return '';
  const cls = safety.level === 'red' ? 'danger' : safety.level === 'yellow' ? 'warning' : 'recovery';
  const icon = safety.level === 'red' ? '🛑' : safety.level === 'yellow' ? '🛡️' : '✓';
  const reasonText = safety.reasons.length ? safety.reasons.slice(0,4).join(' • ') : 'brak alarmów w dostępnych danych';
  return `<div class="ai-human-block ${cls} safety-block"><span>${icon}</span><div><b>${escapeHtml(safety.title)}</b><p>${escapeHtml(safety.summary)} Podstawa: ${escapeHtml(reasonText)}.</p></div></div>`;
}
function safeWeeklyPlanHtml(){
  const rows = [
    ['Dziś','🛡️ Bez mocnego akcentu','Sprawdź objawy, sen, jedzenie i regenerację. Lekki ruch tylko jeśli ciało pozwala.'],
    ['Jutro','🏊 Technika / mobilność','Pływanie techniczne, spacer albo core bez zmęczenia.'],
    ['Kolejny dzień','📋 Decyzja po danych','Wracamy do planu dopiero po poprawie samopoczucia i regeneracji.']
  ];
  return rows.map(([day,title,desc]) => `<div class="plan-day safety"><b>${day}</b><span>${title}</span><small>${desc}</small></div>`).join('');
}

function coachTodayAdvice({readiness, loadLabel, weekCount, weekMinutes, missing, latest, rec, weekTss, advancedItems}){
  const latestName = latest ? activityNameFor(latest) : 'brak ostatniego treningu';
  const latestType = latest ? (sportMeta[latest.type]?.pl || latest.type) : 'trening';
  const sleep = latestDailyMetric ? Number(latestDailyMetric.sleep_minutes || 0) : 0;
  const bb = latestDailyMetric ? Number(latestDailyMetric.body_battery_end ?? latestDailyMetric.body_battery_max ?? latestDailyMetric.body_battery_charged ?? NaN) : NaN;
  const stress = latestDailyMetric ? Number(latestDailyMetric.avg_stress || 0) : 0;
  const reasons = [];
  if(weekCount) reasons.push(`w ostatnich 7 dniach jest ${weekCount} treningów i ${(weekMinutes/60).toFixed(1).replace('.', ',')} h pracy`);
  if(weekTss) reasons.push(`obciążenie tygodnia jest ${weekTss >= 450 ? 'wysokie' : weekTss >= 250 ? 'solidne' : 'umiarkowane'}`);
  if(sleep && sleep < 330) reasons.push(`sen był krótki (${fmtSleep(sleep)})`);
  else if(sleep) reasons.push(`sen: ${fmtSleep(sleep)}`);
  if(Number.isFinite(bb)) reasons.push(`Body Battery: ${Math.round(bb)}/100`);
  if(stress) reasons.push(`stres: ${Math.round(stress)}`);
  const safety = evaluateSafetyContext({readiness, loadLabel, weekCount, weekMinutes, latest, rec, weekTss});
  if(safety.reasons.length) reasons.push(`bezpieczeństwo: ${safety.reasons.slice(0,2).join(' • ')}`);
  let verdict = '';
  let action = '';
  if(safety.level === 'red'){
    verdict = safety.title;
    action = `${safety.summary} ${safety.restriction}`;
    return { latestName, latestType, verdict, action, human: `${verdict} ${action}`, caution: safety.restriction, reasons: reasons.join(' • '), safety };
  }
  if(safety.level === 'yellow' && (readiness < 70 || loadLabel === 'mocny')){
    verdict = safety.title;
    action = `${safety.restriction} Rada wynika z danych: ${safety.reasons.slice(0,3).join(' • ')}.`;
  } else if(readiness < 55 || (Number.isFinite(bb) && bb < 40) || (sleep && sleep < 320)){
    verdict = 'Organizm wygląda na niedoregenerowany.';
    action = 'Dzisiaj nie robiłbym mocnego biegu ani interwałów. Najlepsze będzie lekkie pływanie techniczne 20–40 min, bardzo spokojny rower Z1/Z2 albo pełna regeneracja, jeśli nogi są ciężkie.';
  } else if(loadLabel === 'mocny' || (weekTss && weekTss > 250)){
    verdict = 'Tydzień jest już mocny, więc trzeba pilnować jakości regeneracji.';
    action = 'Dzisiaj wybierz spokojny trening tlenowy. Jeżeli ma być rower, to równo i bez ścigania; jeśli bieg, to krótki easy. Priorytet: nie dokładać zmęczenia na siłę.';
  } else if(missing.includes('swim')){
    verdict = 'Balans triathlonowy prosi się o pływanie.';
    action = 'Dobry wybór na dziś: pływanie techniczne 30–45 min. Skup się na oddechu, pozycji i spokojnej pracy, bez walki o tempo.';
  } else if(missing.includes('bike')){
    verdict = 'Brakuje roweru pod bazę 180 km.';
    action = 'Dobry wybór na dziś: rower Z2 60–90 min. Równo, spokojnie, bez mocnych akcentów — budujemy bazę pod Kalmar.';
  } else if(missing.includes('run')){
    verdict = 'Brakuje spokojnego biegania.';
    action = 'Dobry wybór na dziś: bieg easy 30–45 min, na luzie. Ma zostać zapas, bo docelowo bieg przyjdzie po 180 km roweru.';
  } else if(readiness >= 75){
    verdict = 'Gotowość wygląda dobrze.';
    action = 'Można zrobić normalny trening planowy, ale nadal bez przesady: jeden konkretny akcent wystarczy. Po treningu dopilnuj jedzenia, płynów i snu.';
  } else {
    verdict = 'Sytuacja jest umiarkowana — można trenować, ale rozsądnie.';
    action = 'Najbezpieczniej zrobić trening tlenowy albo techniczny. Niech dzisiejszy trening pomaga jutru, a nie tylko wygląda mocno w statystykach.';
  }
  const human = `${verdict} ${action}`;
  let caution = '';
  if(latest && latest.type === 'bike' && (metricNumber(latest, 'tss') > 120 || Number(latest.elevation || 0) > 700)) caution = 'Po takim rowerze pilnuj nóg i nie rób następnego dnia mocnego biegu, jeśli sen albo Body Battery są słabe.';
  if(latest && latest.type === 'run' && Number(latest.distanceKm || 0) >= 14) caution = 'Po dłuższym biegu warto chronić łydki i ścięgna — następny trening lepiej techniczny albo tlenowy.';
  return { latestName, latestType, verdict, action, human, caution, reasons: reasons.join(' • '), safety };
}
function analyze(){
  const latest = trainings[0] || demo;
  const week = currentWeek();
  const weekMinutes = week.reduce((s,x)=>s+Number(x.minutes||0),0);
  const weekCount = week.length;
  const weekTotals = totalsFor(week);
  const totalKm = weekTotals.swim.km + weekTotals.bike.km + weekTotals.run.km;
  const sportMinutes = {
    swim: weekTotals.swim.min,
    bike: weekTotals.bike.min,
    run: weekTotals.run.min
  };
  const dominant = Object.entries(sportMinutes).sort((a,b)=>b[1]-a[1])[0]?.[0] || 'run';
  const missing = Object.entries(sportMinutes).filter(([,min]) => min === 0).map(([k]) => k);
  const advancedScore = week.reduce((sum, x) => sum + advancedTrainingLoad(x), 0);
  const advancedItems = week.filter(hasAdvancedMetrics);
  const weekTss = week.reduce((sum, x) => sum + (metricNumber(x, 'tss') || 0), 0);
  const loadScore = Math.min(100, Math.round((weekMinutes/8) + weekCount*5 + weekTotals.run.km*1.1 + weekTotals.bike.km*0.18 + weekTotals.swim.km*5 + advancedScore));
  let loadLabel = 'lekki';
  if(loadScore >= 70) loadLabel = 'mocny';
  else if(loadScore >= 35) loadLabel = 'średni';
  const rec = recoveryScore(latestDailyMetric);
  const recoveryAdjustment = Math.round((rec.score - 70) * 0.35);
  const readiness = clamp(100 - Math.round(loadScore*.42) + recoveryAdjustment, 30, 96);
  $('readiness').textContent = readiness;
  $('readinessDonut').style.setProperty('--value', readiness);
  const set = (id, value) => { const el=$(id); if(el) el.textContent = value; };
  set('aiScore', readiness);
  const advancedLabel = advancedItems.length ? ` • dane Garmin: ${advancedItems.length}` : '';
  set('weekLoadValue', `${loadLabel} • ${weekCount} treningów • ${(weekMinutes/60).toFixed(1).replace('.', ',')} h${advancedLabel}`);
  set('aiReadinessText', readiness >= 75 ? `Organizm wygląda dobrze. Regeneracja: ${rec.label}.` : readiness >= 58 ? `Trenuj rozsądnie. Regeneracja: ${rec.label}.` : `Regeneracja/obciążenie ostrzega — ${rec.advice}`);

  const pct = (min) => weekMinutes ? Math.round((min/weekMinutes)*100) : 0;
  const ps = pct(weekTotals.swim.min), pb = pct(weekTotals.bike.min), pr = pct(weekTotals.run.min);
  const bars = [['barSwim',ps],['barBike',pb],['barRun',pr]];
  bars.forEach(([id,val]) => { const el=$(id); if(el) el.style.width = `${Math.max(val, weekMinutes ? 8 : 0)}%`; });
  set('barSwimText', `${ps}%`); set('barBikeText', `${pb}%`); set('barRunText', `${pr}%`);

  let decision = '🟡 Dodaj kilka treningów, a AI będzie mądrzejsze.';
  let plan = ['🏊 Lekka technika lub mobilizacja 20–30 min','💧 Nawodnienie i sen','📌 Budujemy historię pod Kalmar 2026'];
  let balanceText = 'Na razie budujemy bazę danych treningowych.';
  if(weekCount >= 1){
    const domName = sportMeta[dominant]?.pl || dominant;
    const advancedText = advancedItems.length ? ` Dane Garmin pokazują też jakość i koszt treningów, ale szczegóły techniczne chowamy niżej.` : '';
    balanceText = `W tym tygodniu dominuje: ${domName}. ${missing.length ? 'Brakuje: ' + missing.map(k=>sportMeta[k].label).join(', ') + '.' : 'Wszystkie trzy dyscypliny są obecne.'}${advancedText}`;
    decision = `🟡 Tydzień ${loadLabel}. ${balanceText}`;
  }
  const latestAdvanced = latest ? advancedInsight(latest) : '';
  const recoveryLine = latestDailyMetric ? `Najnowszy stan organizmu: sen ${fmtSleep(latestDailyMetric.sleep_minutes)}, Body Battery ${Number.isFinite(Number(latestDailyMetric.body_battery_end)) ? Math.round(Number(latestDailyMetric.body_battery_end)) + '/100' : '—'}, stres ${Number.isFinite(Number(latestDailyMetric.avg_stress)) ? Math.round(Number(latestDailyMetric.avg_stress)) : '—'}, tętno spoczynkowe ${Number.isFinite(Number(latestDailyMetric.resting_hr)) ? Math.round(Number(latestDailyMetric.resting_hr)) + ' bpm' : '—'}.` : 'Brak danych regeneracji z Garmina.';
  if(weekCount >= 3 && readiness > 72){
    decision = `🟢 Gotowość dobra. ${balanceText}`;
    plan = ['🚴 Rower Z2 60–90 min','🏃 Krótki bieg easy 15–25 min po rowerze','🧘 Schłodzenie i rozciąganie'];
  } else if(readiness < 58){
    decision = `🔴 Obciążenie ${loadLabel}. Lepiej zejść z intensywności.`;
    plan = ['😴 Bez mocnych akcentów','🏊 Pływanie techniczne albo spacer','📈 Sprawdź sen, HRV i zmęczenie nóg'];
  } else if(missing.includes('swim')){
    plan = ['🏊 Pływanie techniczne 30–45 min','🚶 Mobilność / core 15 min','💧 Lekki dzień, bez dokładania mocnego biegu'];
  } else if(missing.includes('bike')){
    plan = ['🚴 Rower Z2 60 min','🧘 Rozciąganie bioder i łydek','📌 Bez mocnych interwałów'];
  } else if(missing.includes('run')){
    plan = ['🏃 Bieg easy 30–45 min','💪 Core 10–15 min','📌 Trzymać spokojną intensywność'];
  }
  if(advancedScore >= 25 && readiness < 65){
    plan = ['😴 Regeneracja po mocnym obciążeniu Garmin', '🏊 Lekkie pływanie techniczne 20–30 min', '📌 Bez interwałów i bez ścigania jutro'];
  }
  const coach = coachTodayAdvice({readiness, loadLabel, weekCount, weekMinutes, missing, latest, rec, weekTss, advancedItems});
  set('todayCoachTitle', coach.verdict || 'Plan na dziś');
  set('todayCoachBrief', coach.action || coach.human || 'Czekam na więcej danych z Garmin Sync.');
  $('decision').textContent = `${readiness < 55 ? '🔴' : readiness >= 75 ? '🟢' : '🟡'} ${coach.verdict}`;
  $('aiSummary').innerHTML = `${safetyHtmlBlock(coach.safety)}<div class="ai-human-block primary"><span>1</span><div><b>Co widzę</b><p>${coach.reasons || 'czekam na więcej danych z Garmin Sync'}.</p></div></div><div class="ai-human-block"><span>2</span><div><b>Co to oznacza</b><p>${coach.human}</p></div></div>${coach.caution ? `<div class="ai-human-block warning"><span>!</span><div><b>Uwaga trenera</b><p>${coach.caution}</p></div></div>` : ''}<div class="ai-human-block"><span>3</span><div><b>Balans tygodnia</b><p>${balanceText}</p></div></div><div class="ai-human-block recovery"><span>🫀</span><div><b>Regeneracja Garmin</b><p>${recoveryLine}</p></div></div>${latestAdvanced ? `<div class="ai-human-block"><span>G</span><div><b>Ostatni trening — po ludzku</b><p>${latestAdvanced}</p></div></div>` : ''}<div class="ai-human-block"><span>i</span><div><b>Granica odpowiedzialności</b><p>To wsparcie treningowe i dziennik danych, nie diagnoza medyczna ani indywidualna dieta kliniczna. Przy objawach alarmowych decyzję podejmuje dorosły, trener lub specjalista.</p></div></div>`;
  const planItems = coach.safety?.level === 'red' ? [coach.safety.restriction, 'Zapisz objawy w dzienniku AI i nie ignoruj powtarzającego się bólu.', 'Wróć do planu dopiero po poprawie danych i samopoczucia.'] : [coach.action, ...plan.slice(0,2)];
  $('planList').innerHTML = planItems.map(x=>`<li>${escapeHtml(x)}</li>`).join('');
  if($('weeklyPlan')) $('weeklyPlan').innerHTML = coach.safety?.level === 'red' ? safeWeeklyPlanHtml() : generateWeeklyPlan(readiness, loadLabel, missing);
}


function aiJournalFromDb(row){
  return {
    id: row.id || `journal-${row.journal_date}`,
    date: String(row.journal_date || row.date || todayDate()).slice(0,10),
    energy: Number(row.energy ?? 3),
    stress: Number(row.stress ?? 3),
    motivation: Number(row.motivation ?? 3),
    food: row.food || '',
    hydration: row.hydration || '',
    feeling: row.feeling || '',
    pain: row.pain || '',
    notes: row.notes || '',
    updated_at: row.updated_at || row.created_at || new Date().toISOString(),
    cloud: true
  };
}
function aiJournalToDb(entry){
  return {
    user_id: currentUser?.id || null,
    journal_date: entry.date,
    energy: Number(entry.energy || 3),
    stress: Number(entry.stress || 3),
    motivation: Number(entry.motivation || 3),
    food: entry.food || '',
    hydration: entry.hydration || '',
    feeling: entry.feeling || '',
    pain: entry.pain || '',
    notes: entry.notes || '',
    source: 'pwa',
    updated_at: new Date().toISOString()
  };
}
function mergeAiJournalRows(localRows=[], cloudRows=[]){
  const byDate = new Map();
  localRows.forEach(e => { if(e?.date) byDate.set(String(e.date).slice(0,10), e); });
  cloudRows.forEach(e => { if(e?.date) byDate.set(String(e.date).slice(0,10), e); });
  return [...byDate.values()].sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))).slice(0,365);
}
async function loadAiJournalFromCloud(){
  if(!currentUser?.id){
    renderAiSupport();
    return;
  }
  try{
    const rows = await apiGet(`${AI_JOURNAL_ENDPOINT}?select=*&${userFilter()}order=journal_date.desc&limit=365`);
    const cloudRows = (rows || []).map(aiJournalFromDb);
    aiJournal = mergeAiJournalRows(readAiJournal(), cloudRows);
    saveAiJournalStore();
    if($('aiJournalStatus')){
      $('aiJournalStatus').className = 'sync-status ok';
      $('aiJournalStatus').textContent = `Dziennik AI połączony z Supabase i lokalną kopią • wpisów: ${aiJournal.length}`;
    }
  }catch(err){
    console.warn('Nie udało się pobrać dziennika AI z Supabase', err);
    aiJournal = readAiJournal();
    if($('aiJournalStatus')){
      $('aiJournalStatus').className = 'sync-status warn';
      $('aiJournalStatus').textContent = 'Nie udało się pobrać dziennika z Supabase — używam lokalnej kopii bezpieczeństwa na tym urządzeniu.';
    }
  }
  loadAiJournalForm($('aiJournalDate')?.value || todayDate());
  renderAiSupport();
}

function readAiJournal(){
  try{
    const rows = JSON.parse(localStorage.getItem(AI_JOURNAL_KEY)) || [];
    return Array.isArray(rows) ? rows.sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))) : [];
  }catch{ return []; }
}
function saveAiJournalStore(){
  localStorage.setItem(AI_JOURNAL_KEY, JSON.stringify(aiJournal.slice(0,365)));
}
function getAiJournalForDate(date){
  return aiJournal.find(x => String(x.date||'').slice(0,10) === String(date||'').slice(0,10));
}
function resetAiJournalForm(){
  const d = $('aiJournalDate'); if(d) d.value = todayDate();
  ['aiFood','aiHydration','aiFeeling','aiPain','aiNotes'].forEach(id => { const el=$(id); if(el) el.value=''; });
  ['aiEnergy','aiStress','aiMotivation'].forEach(id => { const el=$(id); if(el) el.value='3'; });
}
function loadAiJournalForm(date=todayDate()){
  const entry = getAiJournalForDate(date);
  if($('aiJournalDate')) $('aiJournalDate').value = date;
  if(!entry){
    ['aiFood','aiHydration','aiFeeling','aiPain','aiNotes'].forEach(id => { const el=$(id); if(el) el.value=''; });
    ['aiEnergy','aiStress','aiMotivation'].forEach(id => { const el=$(id); if(el) el.value='3'; });
    return;
  }
  const map = {aiFood:'food', aiHydration:'hydration', aiFeeling:'feeling', aiPain:'pain', aiNotes:'notes', aiEnergy:'energy', aiStress:'stress', aiMotivation:'motivation'};
  Object.entries(map).forEach(([id,key]) => { const el=$(id); if(el) el.value = entry[key] ?? (['energy','stress','motivation'].includes(key) ? '3' : ''); });
}
async function saveAiJournalEntry(){
  const date = $('aiJournalDate')?.value || todayDate();
  const entry = {
    id: `journal-${date}`,
    date,
    energy: Number($('aiEnergy')?.value || 3),
    stress: Number($('aiStress')?.value || 3),
    motivation: Number($('aiMotivation')?.value || 3),
    food: ($('aiFood')?.value || '').trim(),
    hydration: ($('aiHydration')?.value || '').trim(),
    feeling: ($('aiFeeling')?.value || '').trim(),
    pain: ($('aiPain')?.value || '').trim(),
    notes: ($('aiNotes')?.value || '').trim(),
    updated_at: new Date().toISOString(),
    cloud: false
  };
  aiJournal = aiJournal.filter(x => String(x.date||'') !== String(date));
  aiJournal.unshift(entry);
  aiJournal.sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));
  saveAiJournalStore();
  if($('aiJournalStatus')){ $('aiJournalStatus').className = 'sync-status info'; $('aiJournalStatus').textContent = `Zapisuję wpis z dnia ${formatDate(date)} do Supabase...`; }
  renderAiSupport();

  if(!currentUser?.id){
    resetAiJournalForm();
    if($('aiJournalDate')) $('aiJournalDate').value = todayDate();
    if($('aiJournalStatus')){ $('aiJournalStatus').className = 'sync-status warn'; $('aiJournalStatus').textContent = `Zapisano lokalnie. Formularz wyczyszczony. Zaloguj konto Szymona, żeby zapisać dziennik w Supabase.`; }
    return;
  }
  try{
    const saved = await apiUpsert(`${AI_JOURNAL_ENDPOINT}?on_conflict=user_id,journal_date`, aiJournalToDb(entry));
    const cloudEntry = saved?.[0] ? aiJournalFromDb(saved[0]) : {...entry, cloud:true};
    aiJournal = aiJournal.filter(x => String(x.date||'') !== String(date));
    aiJournal.unshift(cloudEntry);
    aiJournal.sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));
    saveAiJournalStore();
    resetAiJournalForm();
    if($('aiJournalDate')) $('aiJournalDate').value = todayDate();
    if($('aiJournalStatus')){ $('aiJournalStatus').className = 'sync-status ok'; $('aiJournalStatus').textContent = `Zapisano w Supabase i lokalnej kopii • ${formatDate(date)}. Formularz wyczyszczony.`; }
    renderAiSupport();
  }catch(err){
    console.warn('Nie udało się zapisać dziennika AI w Supabase', err);
    if($('aiJournalStatus')){ $('aiJournalStatus').className = 'sync-status warn'; $('aiJournalStatus').textContent = `Nie udało się zapisać w Supabase — wpis został bezpiecznie zapisany lokalnie na tym urządzeniu.`; }
  }
}
async function deleteAiJournalEntry(){
  const date = $('aiJournalDate')?.value || todayDate();
  const existing = getAiJournalForDate(date);
  if(!existing){
    if($('aiJournalStatus')){ $('aiJournalStatus').className='sync-status info'; $('aiJournalStatus').textContent=`Nie ma zapisanego wpisu z dnia ${formatDate(date)}.`; }
    return;
  }
  if(!confirm(`Usunąć wpis dziennika AI z dnia ${formatDate(date)}?`)) return;
  aiJournal = aiJournal.filter(x => String(x.date||'').slice(0,10) !== String(date).slice(0,10));
  saveAiJournalStore();
  resetAiJournalForm();
  if($('aiJournalDate')) $('aiJournalDate').value = date;
  if($('aiJournalStatus')){ $('aiJournalStatus').className='sync-status info'; $('aiJournalStatus').textContent=`Usuwam wpis z dnia ${formatDate(date)} z Supabase...`; }
  try{
    if(currentUser?.id){
      await apiDelete(`${AI_JOURNAL_ENDPOINT}?user_id=eq.${encodeURIComponent(currentUser.id)}&journal_date=eq.${encodeURIComponent(date)}`);
      if($('aiJournalStatus')){ $('aiJournalStatus').className='sync-status ok'; $('aiJournalStatus').textContent=`Wpis z dnia ${formatDate(date)} usunięty z Supabase i lokalnej kopii.`; }
    } else {
      if($('aiJournalStatus')){ $('aiJournalStatus').className='sync-status ok'; $('aiJournalStatus').textContent=`Wpis z dnia ${formatDate(date)} usunięty z lokalnej kopii.`; }
    }
  }catch(err){
    console.warn('Nie udało się usunąć wpisu AI w Supabase', err);
    if($('aiJournalStatus')){ $('aiJournalStatus').className='sync-status warn'; $('aiJournalStatus').textContent=`Usunięto lokalnie, ale Supabase nie potwierdził usunięcia. Odśwież wpisy i sprawdź.`; }
  }
  renderAiSupport();
}

async function refreshAiJournalEntries(){
  if($('aiJournalStatus')){ $('aiJournalStatus').className='sync-status info'; $('aiJournalStatus').textContent='Odświeżam wpisy dziennika z Supabase...'; }
  await loadAiJournalFromCloud();
}


function reportDateList(days=3){
  const base = new Date(`${todayDate()}T12:00:00`);
  return Array.from({length: days}, (_, i) => {
    const d = new Date(base);
    d.setDate(base.getDate() - i);
    return d.toISOString().slice(0,10);
  });
}
function metricForExactDate(dateStr){
  return dailyMetrics.find(d => String(d.metric_date || '').slice(0,10) === String(dateStr).slice(0,10)) || null;
}
function fmtReportValue(label, value){
  const v = String(value || '').trim();
  return v ? `${label}: ${v}` : `${label}: —`;
}
function reportWorkoutLine(item){
  const meta = sportMeta[item.type] || sportMeta.other;
  const parts = [];
  parts.push(`${meta.pl}: ${activityNameFor(item).replace(' — trening Kalmar','')}`);
  if(Number(item.distanceKm || 0) > 0) parts.push(`${formatKm(item.distanceKm)} km`);
  if(Number(item.minutes || 0) > 0) parts.push(`${Math.round(Number(item.minutes))} min`);
  if(Number(item.elevation || 0) > 0) parts.push(`+${Math.round(Number(item.elevation))} m`);
  if(Number(item.calories || 0) > 0) parts.push(`${Math.round(Number(item.calories))} kcal`);
  const tss = metricNumber(item, 'tss');
  if(tss !== null) parts.push(`obciążenie ${Math.round(tss)}`);
  const hr = metricNumber(item, 'avgHr') || numericOrNull(item.avgHr);
  if(hr !== null) parts.push(`śr. tętno ${Math.round(hr)} bpm`);
  return `- ${parts.join(' • ')}`;
}
function reportRecoveryLine(metric){
  if(!metric) return 'Brak danych Garmin dla tego dnia.';
  const bb = metric.body_battery_end ?? metric.body_battery_max ?? metric.body_battery_charged;
  const parts = [
    `sen ${fmtSleep(metric.sleep_minutes)}`,
    `Body Battery ${fmtInt(bb, '/100')}`,
    `stres ${fmtInt(metric.avg_stress)}`,
    `tętno spoczynkowe ${fmtInt(metric.resting_hr, ' bpm')}`,
    `kroki ${fmtInt(metric.steps)}`
  ];
  return parts.join(' • ');
}
function reportJournalLine(entry){
  if(!entry) return 'Brak wpisu dnia.';
  return [
    fmtReportValue('Jedzenie', entry.food),
    fmtReportValue('Nawodnienie', entry.hydration),
    fmtReportValue('Samopoczucie', entry.feeling),
    fmtReportValue('Ból/przeciążenie', entry.pain),
    fmtReportValue('Notatka', entry.notes),
    `Energia/stres/motywacja: ${entry.energy || '—'} / ${entry.stress || '—'} / ${entry.motivation || '—'}`
  ].join('\n');
}
function reportDayConclusion({metric, entry, workouts}){
  const notes = [];
  const sleep = Number(metric?.sleep_minutes ?? NaN);
  const bb = Number(metric?.body_battery_end ?? metric?.body_battery_max ?? metric?.body_battery_charged ?? NaN);
  const stress = Number(metric?.avg_stress ?? NaN);
  if(Number.isFinite(sleep) && sleep < 360) notes.push('sen krótki — regeneracja może nie nadążać');
  if(Number.isFinite(bb) && bb < 50) notes.push('Body Battery nisko/średnio — ostrożnie z mocnym akcentem');
  if(Number.isFinite(stress) && stress > 35) notes.push('stres podwyższony — pilnować odpoczynku');
  if(entry && hasMeaningfulPain(entry.pain)) notes.push('we wpisie pojawia się ból/przeciążenie');
  if(workouts.length >= 2) notes.push('więcej niż jeden trening w dniu — obserwować kumulację zmęczenia');
  if(!entry?.food) notes.push('brak danych o jedzeniu — warto dopisać paliwo przed/po treningu');
  if(!entry?.hydration) notes.push('brak danych o nawodnieniu — warto dopisać płyny/elektrolity');
  return notes.length ? notes.join('; ') + '.' : 'Brak wyraźnych czerwonych sygnałów w dostępnych danych.';
}
function buildAthleteReport(days=3){
  const dates = reportDateList(days);
  const allWorkouts = sortTrainings(trainings).filter(t => dates.includes(trainingDate(t)));
  const totalMin = allWorkouts.reduce((s,w)=>s+Number(w.minutes||0),0);
  const totalKm = allWorkouts.reduce((s,w)=>s+Number(w.distanceKm||0),0);
  const totalTss = allWorkouts.reduce((s,w)=>s+(metricNumber(w,'tss')||0),0);
  const lines = [];
  lines.push(`RAPORT ZAWODNIKA — OSTATNIE ${days} DNI`);
  lines.push(`Szymon AI Coach • ${formatDate(todayDate())}`);
  lines.push(`Cel: ${athleteProfile.target_event || 'IRONMAN Kalmar 2026'}`);
  lines.push('');
  lines.push('PODSUMOWANIE');
  lines.push(`Treningi: ${allWorkouts.length}`);
  lines.push(`Czas treningu: ${Math.round(totalMin)} min`);
  lines.push(`Dystans łącznie: ${formatKm(totalKm)} km`);
  if(totalTss > 0) lines.push(`Obciążenie łączne: około ${Math.round(totalTss)}`);
  lines.push('');
  dates.forEach(date => {
    const dayWorkouts = allWorkouts.filter(t => trainingDate(t) === date);
    const metric = metricForExactDate(date);
    const entry = getAiJournalForDate(date);
    lines.push('========================================');
    lines.push(formatDate(date).toUpperCase());
    lines.push('');
    lines.push('TRENINGI');
    if(dayWorkouts.length) dayWorkouts.forEach(w => lines.push(reportWorkoutLine(w)));
    else lines.push('Brak treningu w danych aplikacji.');
    lines.push('');
    lines.push('REGENERACJA GARMIN');
    lines.push(reportRecoveryLine(metric));
    lines.push('');
    lines.push('DZIENNIK SZYMONA');
    lines.push(reportJournalLine(entry));
    lines.push('');
    lines.push('WNIOSKI Z DANYCH');
    lines.push(reportDayConclusion({metric, entry, workouts: dayWorkouts}));
    lines.push('');
  });
  lines.push('========================================');
  lines.push('PYTANIE DO AI / TRENERA');
  lines.push('Na podstawie raportu oceń stan zawodnika, ryzyko przeciążenia, najważniejsze braki w regeneracji/jedzeniu oraz najrozsądniejszy plan na kolejne 24–48 godzin.');
  lines.push('');
  lines.push('Uwaga: raport jest zestawieniem danych treningowych i dziennika. Nie zastępuje diagnozy medycznej ani indywidualnej opieki specjalisty.');
  return lines.join('\n');
}
function setAthleteReportButtons(enabled){
  const copy = $('copyAthleteReportBtn');
  const print = $('printAthleteReportBtn');
  if(copy) copy.disabled = !enabled;
  if(print) print.disabled = !enabled;
}
function generateAthleteReport(){
  const out = $('athleteReportOutput');
  const status = $('athleteReportStatus');
  if(!out) return;
  const text = buildAthleteReport(3);
  out.textContent = text;
  out.dataset.reportText = text;
  setAthleteReportButtons(true);
  if(status){ status.className = 'sync-status ok'; status.textContent = 'Raport 3 dni gotowy. Możesz go skopiować albo wydrukować do PDF.'; }
}
async function copyAthleteReport(){
  const out = $('athleteReportOutput');
  const status = $('athleteReportStatus');
  const text = out?.dataset.reportText || out?.textContent || '';
  if(!text.trim()) return;
  try{
    await navigator.clipboard.writeText(text);
    if(status){ status.className = 'sync-status ok'; status.textContent = 'Raport skopiowany do schowka.'; }
  }catch(err){
    if(status){ status.className = 'sync-status warn'; status.textContent = 'Nie udało się skopiować automatycznie. Przytrzymaj tekst raportu i skopiuj ręcznie.'; }
  }
}
function printAthleteReport(){
  const out = $('athleteReportOutput');
  const text = out?.dataset.reportText || out?.textContent || '';
  if(!text.trim()) return;
  const win = window.open('', '_blank');
  if(!win) return;
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Raport zawodnika</title><style>body{font-family:Arial,sans-serif;margin:24px;color:#111}pre{white-space:pre-wrap;font-size:13px;line-height:1.45}h1{font-size:20px}</style></head><body><h1>Raport zawodnika — Szymon AI Coach</h1><pre>${escapeHtml(text)}</pre></body></html>`);
  win.document.close();
  setTimeout(() => { try { win.focus(); win.print(); } catch {} }, 250);
}

function hasMeaningfulPain(text=''){
  const t = String(text).toLowerCase().trim();
  if(!t) return false;
  return !/(brak|nic|ok|dobrze|bez bólu|bez bolu|nie boli)/i.test(t);
}
function shortText(text='', fallback='Brak wpisu.'){
  const t = String(text||'').trim();
  if(!t) return fallback;
  return t.length > 135 ? t.slice(0,132).trim() + '...' : t;
}
function setAiTile(id, title, text, cls=''){
  const el=$(id); if(!el) return;
  const b=el.querySelector('b'); const p=el.querySelector('p');
  if(b) b.textContent = title;
  if(p) p.textContent = text;
  el.classList.remove('good','warn','danger');
  if(cls) el.classList.add(cls);
}
function aiJournalCoachSummary(){
  const latest = aiJournal[0];
  const recent = aiJournal.slice(0,3);
  const painEntries = recent.filter(x => hasMeaningfulPain(x.pain));
  const rec = recoveryScore(latestDailyMetric);
  const latestTraining = trainings[0];
  const todayText = $('todayCoachBrief')?.textContent || 'Czekam na analizę treningów i regeneracji.';
  let nutrition = latest?.food ? 'Wpis o jedzeniu jest — będzie można łączyć posiłki z treningiem i regeneracją.' : 'Brakuje wpisu o jedzeniu. To ważne przy długich rowerach, biegach i regeneracji.';
  if(latest?.food && /makaron|ryż|ryz|owsianka|banan|ziemniak|pieczywo|żel|zel|izotonik/i.test(latest.food)) nutrition = 'Wpis zawiera paliwo węglowodanowe — dobry trop przy przygotowaniach do dłuższych jednostek.';
  if(latest?.food && !/białko|bialko|jaj|kurczak|twaróg|twarog|jogurt|ryba|mięso|mieso|ser/i.test(latest.food)) nutrition += ' Sprawdź też białko po treningu.';
  let body = painEntries.length ? `Uwaga: w ostatnich wpisach pojawia się ból/przeciążenie. Nie dokładałbym mocnego akcentu bez obserwacji.` : 'Brak powtarzających się sygnałów bólowych w ostatnich wpisach.';
  let decisionClass = rec.score < 55 || painEntries.length ? 'danger' : rec.score >= 78 ? 'good' : 'warn';
  return {latest, recent, painEntries, rec, latestTraining, todayText, nutrition, body, decisionClass};
}
function renderAiSupport(){
  if($('aiJournalDate') && !$('aiJournalDate').value) $('aiJournalDate').value = todayDate();
  const s = aiJournalCoachSummary();
  const safety = evaluateSafetyContext({readiness: Number($('readiness')?.textContent || 60), loadLabel: 'lekki', weekCount: currentWeek().length, weekMinutes: currentWeek().reduce((a,b)=>a+Number(b.minutes||0),0), latest: trainings[0], rec: s.rec});
  setAiTile('aiSupportSafety', safety.title, safety.summary, safety.level === 'red' ? 'danger' : safety.level === 'yellow' ? 'warn' : 'good');
  if($('aiSafetyStatus')){ $('aiSafetyStatus').className = `ai-safety-status ${safety.level === 'red' ? 'danger' : safety.level === 'yellow' ? 'warn' : 'good'}`; $('aiSafetyStatus').textContent = `${safety.title}. ${safety.summary}`; }
  setAiTile('aiSupportDecision', safety.level === 'red' ? 'Bez mocnego treningu' : s.rec.score < 55 ? 'Dziś mądrze' : s.rec.score >= 78 ? 'Można trenować' : 'Trenuj rozsądnie', safety.level === 'red' ? safety.restriction : s.todayText, safety.level === 'red' ? 'danger' : s.decisionClass);
  setAiTile('aiSupportFood', s.latest?.food ? 'Wpis jedzenia zapisany' : 'Dodaj jedzenie dnia', s.nutrition, s.latest?.food ? 'good' : 'warn');
  setAiTile('aiSupportBody', s.painEntries.length ? 'Obserwuj przeciążenia' : 'Ciało bez alarmu', s.body, s.painEntries.length ? 'danger' : 'good');
  setAiTile('aiSupportRecovery', `${s.rec.label}`, s.rec.advice, s.rec.score < 55 ? 'danger' : s.rec.score >= 78 ? 'good' : 'warn');
  if($('aiJournalCount')) $('aiJournalCount').textContent = `${aiJournal.length} ${aiJournal.length === 1 ? 'wpis' : 'wpisów'}`;
  if($('aiMemorySummary')){
    if(!aiJournal.length) $('aiMemorySummary').textContent = 'Brak wpisów. Pierwszy wpis dnia stworzy początek pamięci AI.';
    else {
      const last = aiJournal[0];
      $('aiMemorySummary').innerHTML = `<b>Ostatni wpis: ${formatDate(last.date)}.</b> Energia ${last.energy}/5, stres ${last.stress}/5, motywacja ${last.motivation}/5. ${hasMeaningfulPain(last.pain) ? 'Wpis zawiera sygnał bólu/przeciążenia — warto obserwować.' : 'Brak mocnego alarmu bólowego w ostatnim wpisie.'}`;
    }
  }
  const list=$('aiJournalList');
  if(list){
    if(!aiJournal.length){ list.innerHTML = '<div class="empty-history">Brak wpisów dziennika. Zapisz pierwszy dzień: jedzenie, samopoczucie i uwagi.</div>'; }
    else list.innerHTML = aiJournal.slice(0,14).map(e => `<article class="ai-journal-entry ${hasMeaningfulPain(e.pain) ? 'pain' : ''}">
      <div class="ai-entry-head"><b>${formatDate(e.date)}</b><span>Energia ${e.energy}/5 • Stres ${e.stress}/5 • Motywacja ${e.motivation}/5</span></div>
      <p><strong>Jedzenie:</strong> ${escapeHtml(shortText(e.food, 'brak wpisu'))}</p>
      ${e.hydration ? `<p><strong>Nawodnienie:</strong> ${escapeHtml(shortText(e.hydration, ''))}</p>` : ''}
      <p><strong>Samopoczucie:</strong> ${escapeHtml(shortText(e.feeling, 'brak wpisu'))}</p>
      <p><strong>Bóle:</strong> ${escapeHtml(shortText(e.pain, 'brak wpisu'))}</p>
      ${e.notes ? `<p><strong>Notatka:</strong> ${escapeHtml(shortText(e.notes, ''))}</p>` : ''}
    </article>`).join('');
  }
}


function geminiUsageToday(){
  const today = todayDate();
  try{
    const data = JSON.parse(localStorage.getItem(GEMINI_USAGE_KEY) || '{}');
    if(data.date !== today) return { date: today, count: 0, lastAt: 0 };
    return { date: today, count: Number(data.count || 0), lastAt: Number(data.lastAt || 0) };
  }catch{
    return { date: todayDate(), count: 0, lastAt: 0 };
  }
}
function saveGeminiUsage(data){
  localStorage.setItem(GEMINI_USAGE_KEY, JSON.stringify({ date: todayDate(), count: Number(data.count || 0), lastAt: Number(data.lastAt || 0) }));
}
function markGeminiAttempt(){
  const u = geminiUsageToday();
  u.count += 1;
  u.lastAt = Date.now();
  saveGeminiUsage(u);
  updateGeminiUsageUi();
  return u;
}
function geminiCooldownInfo(){
  const u = geminiUsageToday();
  const leftMs = Math.max(0, GEMINI_COOLDOWN_MS - (Date.now() - Number(u.lastAt || 0)));
  return { ...u, leftMs, leftSec: Math.ceil(leftMs / 1000), limitLeft: Math.max(0, GEMINI_DAILY_SOFT_LIMIT - Number(u.count || 0)) };
}
function canCallGeminiNow(){
  const info = geminiCooldownInfo();
  if(info.count >= GEMINI_DAILY_SOFT_LIMIT) return { ok:false, reason:'daily', info };
  if(info.leftMs > 0) return { ok:false, reason:'cooldown', info };
  return { ok:true, info };
}
function updateGeminiUsageUi(){
  const u = geminiUsageToday();
  const text = `AI dziś: ${u.count}/${GEMINI_DAILY_SOFT_LIMIT}.`;
  const a = $('geminiUsageInfo'); if(a) a.textContent = text;
  const b = $('geminiChatUsageInfo'); if(b) b.textContent = text;
}
function quotaFriendlyMessage(message=''){
  const m = String(message || '').toLowerCase();
  if(m.includes('quota') || m.includes('rate') || m.includes('limit') || m.includes('429') || m.includes('too many')){
    return 'Limit AI na dziś jest chwilowo wykorzystany. Spróbuj później — ostatnia dobra odpowiedź zostaje dostępna.';
  }
  if(m.includes('sesja') || m.includes('zaloguj') || m.includes('jwt') || m.includes('auth')) return 'Sesja logowania wygasła. Zaloguj konto Szymona ponownie.';
  return 'AI chwilowo nie odpowiedziało. Spróbuj później.';
}

function readLastGeminiAnalysis(){
  try { return JSON.parse(localStorage.getItem(GEMINI_ANALYSIS_KEY) || 'null'); } catch { return null; }
}
function saveLastGeminiAnalysis(data){
  try { localStorage.setItem(GEMINI_ANALYSIS_KEY, JSON.stringify(data)); } catch {}
}
function readGeminiChatHistory(){
  try {
    const item = JSON.parse(localStorage.getItem(GEMINI_CHAT_KEY) || 'null');
    if(!item) return [];
    return Array.isArray(item) ? item.slice(-1) : [item];
  } catch { return []; }
}
function saveGeminiChatHistory(history){
  try {
    const last = Array.isArray(history) ? history[history.length - 1] : history;
    if(last) localStorage.setItem(GEMINI_CHAT_KEY, JSON.stringify(last));
    else localStorage.removeItem(GEMINI_CHAT_KEY);
  } catch {}
}
function clearGeminiChat(){
  localStorage.removeItem(GEMINI_CHAT_KEY);
  const input = $('geminiQuestionInput');
  if(input) input.value = '';
  renderGeminiChatHistory();
  updateGeminiUsageUi();
  const status = $('geminiChatStatus');
  if(status){ status.className = 'sync-status info'; status.textContent = 'Rozmowa wyczyszczona. Wpisz nowe pytanie do AI Coach.'; }
}
function formatGeminiFullText(text){
  const normalized = normalizeCoachText(text).replace(/\r/g, '').trim();
  if(!normalized) return '';
  const paragraphs = normalized.split(/\n\s*\n+/).map(part => part.trim()).filter(Boolean);
  const html = paragraphs.map(part => {
    const safe = escapeHtml(part)
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br>');
    return `<p>${safe}</p>`;
  }).join('');
  return html || `<p>${escapeHtml(normalized).replace(/\n/g, '<br>')}</p>`;
}
function renderGeminiChatHistory(){
  const out = $('geminiChatOutput');
  if(!out) return;
  const history = readGeminiChatHistory();
  if(!history.length){
    out.innerHTML = '<div class="gemini-placeholder">Tu pojawi się odpowiedź AI Coach na ostatnie pytanie. Kolejne pytanie zastąpi poprzednią odpowiedź.</div>';
    return;
  }
  out.innerHTML = history.map(item => {
    const q = escapeHtml(item.question || '');
    const a = formatGeminiFullText(item.answer || '');
    const date = item.generatedAt ? formatDate(String(item.generatedAt).slice(0,10)) : '';
    const model = item.model ? ` • ${escapeHtml(item.model)}` : '';
    return `<article class="gemini-chat-turn">
      <div class="gemini-chat-question"><span>Ty</span><p>${q}</p></div>
      <div class="gemini-chat-answer"><span>AI Coach${date ? ` • ${date}` : ''}${model}</span><div class="gemini-chat-text">${a}</div></div>
    </article>`;
  }).join('');
}
function normalizeCoachText(text){
  return String(text || '')
    .replace(/TSS\s*(\d+\.\d+)/gi, (m,n) => `obciążenie ${Math.round(Number(n))}`)
    .replace(/IF\s*(\d+\.\d+)/gi, (m,n) => `intensywność ${Number(n).toFixed(2)}`)
    .replace(/NP\s*(\d+\.\d+)/gi, (m,n) => `moc znormalizowana ${Math.round(Number(n))}`)
    .replace(/(\d+)\.(\d{4,})/g, (m,a,b) => b.length > 4 ? String(Math.round(Number(m))) : m)
    .trim();
}
function sectionFromText(text, label){
  const pattern = new RegExp(`\\*\\*${label}:?\\*\\*\\s*([\\s\\S]*?)(?=\\n\\s*\\*\\*|$)`, 'i');
  const m = text.match(pattern);
  return m ? m[1].trim() : '';
}
function coachCard(title, body, cls=''){
  if(!body) return '';
  const safe = escapeHtml(normalizeCoachText(body)).replace(/\n/g, '<br>');
  return `<div class="gemini-coach-card ${cls}"><b>${escapeHtml(title)}</b><p>${safe}</p></div>`;
}
function renderGeminiAnalysis(data, targetId='geminiAiOutput'){
  const out = $(targetId);
  if(!out) return;
  if(!data){
    out.innerHTML = '<div class="gemini-placeholder">Brak analizy Gemini. Kliknij „Analizuj z Gemini AI”, kiedy dziennik i Garmin mają aktualne dane.</div>';
    return;
  }
  const rawText = String(data.analysis || data.text || '').trim();
  const text = normalizeCoachText(rawText);
  if(!text){
    out.innerHTML = '<div class="gemini-placeholder">Gemini nie zwrócił treści analizy.</div>';
    return;
  }
  const meta = data.generatedAt ? `<div class="gemini-meta">Gemini AI • ${formatDate(String(data.generatedAt).slice(0,10))}${data.model ? ` • ${escapeHtml(data.model)}` : ''}</div>` : '<div class="gemini-meta">Gemini AI</div>';
  const fullHtml = formatGeminiFullText(text);
  out.innerHTML = `${meta}<div class="gemini-answer gemini-full-scroll">${fullHtml}</div>`;
  try { out.scrollTop = 0; } catch {}
}
async function callGeminiBackend({question='', targetId='geminiAiOutput', statusId='geminiAiStatus', buttonId='runGeminiAiBtn'} = {}){
  const status = $(statusId);
  const btn = $(buttonId);
  const isQuestion = Boolean(String(question || '').trim());
  const gate = canCallGeminiNow();
  if(!gate.ok){
    const msg = gate.reason === 'daily'
      ? `Dzisiejszy limit AI w aplikacji został wykorzystany (${GEMINI_DAILY_SOFT_LIMIT}/${GEMINI_DAILY_SOFT_LIMIT}). Wróć później albo jutro.`
      : `Daj AI chwilę. Następne pytanie najwcześniej za około ${gate.info.leftSec} s.`;
    if(status){ status.className = 'sync-status warn'; status.textContent = msg; }
    if(!isQuestion){
      const last = readLastGeminiAnalysis();
      if(last) renderGeminiAnalysis(last, targetId);
    }
    updateGeminiUsageUi();
    return;
  }
  const sessionOk = await refreshSessionIfNeeded(true);
  if(!sessionOk || !currentSession?.access_token || !currentUser?.id){
    if(status){ status.className = 'sync-status warn'; status.textContent = 'Sesja logowania wygasła. Zaloguj konto Szymona ponownie i spróbuj uruchomić AI Coach.'; }
    return;
  }
  markGeminiAttempt();
  if(btn){ btn.disabled = true; btn.textContent = isQuestion ? 'Pytam AI...' : 'Analizuję...'; }
  if(status){ status.className = 'sync-status info'; status.textContent = isQuestion ? 'AI myśli nad odpowiedzią. To może potrwać kilkanaście sekund.' : 'AI analizuje dane. To może potrwać kilkanaście sekund.'; }
  try{
    const response = await fetch(GEMINI_AI_ENDPOINT, {
      method: 'POST',
      mode: 'cors',
      cache: 'no-store',
      headers: headers({'Content-Type':'application/json'}),
      body: JSON.stringify({ date: todayDate(), source: 'pwa-v3.2.5', mode: isQuestion ? 'chat' : 'analysis', question: String(question || '').trim() })
    });
    const raw = await response.text();
    let data = null;
    try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
    if(!response.ok || !data || data.ok === false){
      const msg = data?.error || data?.message || raw || `HTTP ${response.status}`;
      throw new Error(msg);
    }
    const payload = { ...data, generatedAt: data.generatedAt || new Date().toISOString(), question: String(question || '').trim() };
    if(isQuestion){
      const answerText = String(payload.analysis || payload.text || '').trim();
      const history = [{ question: payload.question, answer: answerText, model: payload.model, generatedAt: payload.generatedAt }];
      saveGeminiChatHistory(history);
      renderGeminiChatHistory();
      const chatInput = $('geminiQuestionInput'); if(chatInput) chatInput.value = '';
    } else {
      saveLastGeminiAnalysis(payload);
      renderGeminiAnalysis(payload, targetId);
    }
    if(status){ status.className = 'sync-status ok'; status.textContent = isQuestion ? 'AI Coach odpowiedział. Odpowiedź została zapamiętana lokalnie.' : 'Analiza Gemini gotowa i zapamiętana jako ostatnia dobra odpowiedź.'; }
  }catch(err){
    console.warn('Gemini AI Coach error', err);
    const friendly = quotaFriendlyMessage(err?.message || '');
    if(status){ status.className = 'sync-status warn'; status.textContent = friendly; }
    if(!isQuestion){
      const last = readLastGeminiAnalysis();
      if(last){
        renderGeminiAnalysis(last, targetId);
        if(status) status.textContent += ' Poniżej pokazuję ostatnią dobrą analizę.';
      }
    } else {
      const out = $(targetId);
      if(out) out.innerHTML = '<div class="gemini-placeholder">AI nie odpowiedziało na to pytanie. Nie wysyłam automatycznych powtórek, żeby nie zjadać limitu Gemini.</div>';
    }
  }finally{
    const info = geminiCooldownInfo();
    const restore = () => {
      if(!btn) return;
      const g = canCallGeminiNow();
      if(g.ok){ btn.disabled = false; btn.textContent = isQuestion ? 'Wyślij pytanie' : 'Analizuj z Gemini AI'; updateGeminiUsageUi(); return; }
      btn.disabled = true;
      btn.textContent = g.reason === 'daily' ? 'Limit AI dziś' : `Poczekaj ${g.info.leftSec}s`;
      setTimeout(restore, 1000);
    };
    restore();
  }
}
async function runGeminiAiCoach(){
  return callGeminiBackend({ targetId:'geminiAiOutput', statusId:'geminiAiStatus', buttonId:'runGeminiAiBtn' });
}
async function runGeminiQuestion(){
  const input = $('geminiQuestionInput');
  const q = String(input?.value || '').trim();
  const status = $('geminiChatStatus');
  if(!q){
    if(status){ status.className = 'sync-status warn'; status.textContent = 'Wpisz pytanie do AI Coach.'; }
    return;
  }
  await callGeminiBackend({ question:q, targetId:'geminiChatOutput', statusId:'geminiChatStatus', buttonId:'sendGeminiQuestionBtn' });
}


function renderAll(){ updateKalmarRoad(); renderTotals(); renderHistory(); renderRecovery(); analyze(); renderAiSupport(); updatePreview(); }
function updatePreview(){
  const type = $('sportType').value;
  const meta = sportMeta[type] || sportMeta.run;
  const dist = Number($('distanceInput').value || 0);
  const min = Number($('minutesInput').value || 0);
  $('previewSport').textContent = `${meta.icon} ${meta.label}`;
  $('previewDistance').textContent = `${formatKm(dist)} km`;
  $('previewTime').textContent = `${min} min`;
  if(dist && min){
    const candidate = parsedGarmin || {
      type,
      distanceKm: dist,
      minutes: min,
      workout_date: $('workoutDateInput')?.value || todayDate(),
      date: $('workoutDateInput')?.value || todayDate(),
      sourceUrl: $('garminLink')?.value || '',
      garminActivityId: extractGarminActivityId($('garminLink')?.value || '')
    };
    const duplicated = updateDuplicateHint(candidate);
    if(!duplicated && $('garminStatus')?.textContent?.includes('duplikatu')) setGarminStatus('Sprawdź dane przed zapisaniem do historii.', 'info');
  }
}
function showTab(tab){
  $all('.screen').forEach(s => s.classList.remove('active'));
  const screen = $(`screen-${tab}`);
  if(screen) screen.classList.add('active');
  $all('.bottom-nav button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  window.scrollTo({top:0, behavior:'smooth'});
}
function setSport(type){
  $('sportType').value = type;
  $all('#sportSegmented button').forEach(b => b.classList.toggle('active', b.dataset.sport === type));
  updatePreview();
}

$all('.bottom-nav button').forEach(btn => btn.addEventListener('click', () => showTab(btn.dataset.tab)));
$all('[data-goto]').forEach(btn => btn.addEventListener('click', () => showTab(btn.dataset.goto)));
$all('#sportSegmented button').forEach(btn => btn.addEventListener('click', () => setSport(btn.dataset.sport)));
$all('#filterRow button').forEach(btn => btn.addEventListener('click', () => { activeFilter = btn.dataset.filter; $all('#filterRow button').forEach(b=>b.classList.toggle('active', b===btn)); renderHistory(); }));
if($('historySearch')) $('historySearch').addEventListener('input', e => { historySearch = e.target.value || ''; renderHistory(); });
if($('historyRange')) $('historyRange').addEventListener('change', e => { historyRange = e.target.value || '30'; renderHistory(); });

if($('aiJournalDate')) $('aiJournalDate').addEventListener('change', e => loadAiJournalForm(e.target.value || todayDate()));
if($('saveAiJournalBtn')) $('saveAiJournalBtn').addEventListener('click', () => saveAiJournalEntry());
if($('clearAiJournalFormBtn')) $('clearAiJournalFormBtn').addEventListener('click', () => { resetAiJournalForm(); if($('aiJournalStatus')){ $('aiJournalStatus').className='sync-status info'; $('aiJournalStatus').textContent='Formularz wyczyszczony. Dane zapisane wcześniej zostają w pamięci AI.'; } });
if($('deleteAiJournalBtn')) $('deleteAiJournalBtn').addEventListener('click', () => deleteAiJournalEntry());
if($('refreshAiJournalBtn')) $('refreshAiJournalBtn').addEventListener('click', () => refreshAiJournalEntries());
if($('runGeminiAiBtn')) $('runGeminiAiBtn').addEventListener('click', () => runGeminiAiCoach());
if($('sendGeminiQuestionBtn')) $('sendGeminiQuestionBtn').addEventListener('click', () => runGeminiQuestion());
if($('clearGeminiChatBtn')) $('clearGeminiChatBtn').addEventListener('click', () => clearGeminiChat());
if($('generateAthleteReportBtn')) $('generateAthleteReportBtn').addEventListener('click', generateAthleteReport);
if($('copyAthleteReportBtn')) $('copyAthleteReportBtn').addEventListener('click', copyAthleteReport);
if($('printAthleteReportBtn')) $('printAthleteReportBtn').addEventListener('click', printAthleteReport);

if($('recoveryCard')) $('recoveryCard').addEventListener('click', openRecoveryDetails);
if($('openRecoveryFromAnalysis')) $('openRecoveryFromAnalysis').addEventListener('click', openRecoveryDetails);
if($('recoveryCard')) $('recoveryCard').addEventListener('keydown', e => { if(e.key === 'Enter' || e.key === ' ') openRecoveryDetails(); });
if($('closeRecoveryBtn')) $('closeRecoveryBtn').addEventListener('click', closeRecoveryDetails);
if($('recoveryDetails')) $('recoveryDetails').addEventListener('click', (event) => { if(event.target.id === 'recoveryDetails') closeRecoveryDetails(); });
$('historyList').addEventListener('click', (event) => {
  const btn = event.target.closest('[data-delete-id]');
  if(btn){ event.stopPropagation(); deleteTraining(btn.dataset.deleteId); return; }
  const item = event.target.closest('[data-workout-id]');
  if(item) openWorkoutDetails(item.dataset.workoutId);
});
if($('recentList')) $('recentList').addEventListener('click', (event) => {
  const item = event.target.closest('[data-workout-id]');
  if(item) openWorkoutDetails(item.dataset.workoutId);
});
['distanceInput','minutesInput','sportType','workoutDateInput'].forEach(id => $(id)?.addEventListener('input', updatePreview));

$('loadBtn').addEventListener('click', analyzeGarminLink);
$('saveManualBtn').addEventListener('click', async () => {
  const type = $('sportType').value;
  const distanceKm = Number($('distanceInput').value);
  const minutes = Number($('minutesInput').value);
  if(!distanceKm || !minutes){ alert('Wpisz dystans i czas.'); return; }
  const meta = sportMeta[type] || sportMeta.other;
  const manualNote = $('noteInput').value.trim();
  const link = normalizeGarminLink($('garminLink').value);
  const garminId = extractGarminActivityId(link);
  const item = {
    ...(parsedGarmin || {}),
    type,
    name: parsedGarmin?.name || (manualNote && manualNote.length < 80 ? manualNote : `${meta.pl} — trening Kalmar`),
    distanceKm,
    minutes,
    elevation: Number(parsedGarmin?.elevation || parsedGarmin?.ascent || 0),
    ascent: Number(parsedGarmin?.ascent || parsedGarmin?.elevation || 0),
    calories: Number(parsedGarmin?.calories || 0),
    note: manualNote,
    source: parsedGarmin?.source || (garminId ? 'Garmin Link — ręcznie uzupełnione' : 'ręczny wpis'),
    sourceUrl: parsedGarmin?.sourceUrl || link,
    garminActivityId: parsedGarmin?.garminActivityId || garminId,
    avgHr: parsedGarmin?.avgHr || null,
    maxHr: parsedGarmin?.maxHr || null,
    parsedBy: parsedGarmin?.parsedBy || (garminId ? 'manual-with-garmin-link' : 'manual'),
    pace: parsedGarmin?.pace || null,
    speed: parsedGarmin?.speed || null,
    latitude: parsedGarmin?.latitude || null,
    longitude: parsedGarmin?.longitude || null,
    rawDescription: parsedGarmin?.rawDescription || '',
    workout_date: parsedGarmin?.workout_date || $('workoutDateInput')?.value || todayDate(),
    date: parsedGarmin?.workout_date || $('workoutDateInput')?.value || todayDate()
  };
  await addTraining(item);
  parsedGarmin = null;
  setGarminStatus('Gotowe. Trening zapisany w Supabase razem z danymi Garmin: nazwa, dystans, czas, źródło, ID i przewyższenie.', 'ok');
  setImportReport(null);
  updatePreview();
});
$('refreshBtn').addEventListener('click', async()=>{ await loadDailyMetrics(); await loadGarminSyncState(); await loadTrainings(); });
$('refreshBtn2').addEventListener('click', async()=>{ await loadDailyMetrics(); await loadGarminSyncState(); await loadTrainings(); });
if($('refreshGarminMiniBtn')) $('refreshGarminMiniBtn').addEventListener('click', async () => { await loadDailyMetrics(); await loadGarminSyncState(); renderRecovery(); analyze(); });
if($('saveProfileBtn')) $('saveProfileBtn').addEventListener('click', saveProfile);
if($('loginBtn')) $('loginBtn').addEventListener('click', signIn);
if($('authPassword')) $('authPassword').addEventListener('keydown', e => { if(e.key === 'Enter') signIn(); });
if($('logoutBtn')) $('logoutBtn').addEventListener('click', signOut);
$('clearLocalBtn').addEventListener('click', () => {
  if(confirm('Wyczyścić tylko lokalny backup na tym urządzeniu? Dane w Supabase zostają.')){
    localStorage.removeItem(LOCAL_BACKUP_KEY);
    setSync('Wyczyszczono lokalny backup. Dane w Supabase nie zostały usunięte.','info');
  }
});

if($('closeDetailsBtn')) $('closeDetailsBtn').addEventListener('click', closeWorkoutDetails);
if($('workoutDetails')) $('workoutDetails').addEventListener('click', (event) => { if(event.target.id === 'workoutDetails') closeWorkoutDetails(); });
if($('saveDetailsBtn')) $('saveDetailsBtn').addEventListener('click', saveWorkoutDetails);
if($('openGarminBtn')) $('openGarminBtn').addEventListener('click', openSelectedGarmin);
if($('addGarminDetailsBtn')) $('addGarminDetailsBtn').addEventListener('click', () => {
  const editor = $('garminDetailsEditor');
  if(editor){
    editor.hidden = !editor.hidden;
    if(!editor.hidden) setTimeout(() => $('editGarminPaste')?.focus(), 120);
  }
});
if($('deleteDetailsBtn')) $('deleteDetailsBtn').addEventListener('click', deleteSelectedWorkout);
if($('parseGarminTextBtn')) $('parseGarminTextBtn').addEventListener('click', () => mergeAdvancedIntoSelected(false));
if($('clearGarminTextBtn')) $('clearGarminTextBtn').addEventListener('click', () => mergeAdvancedIntoSelected(true));
document.addEventListener('keydown', (event) => { if(event.key === 'Escape' && !$('workoutDetails')?.hidden) closeWorkoutDetails(); if(event.key === 'Escape' && !$('recoveryDetails')?.hidden) closeRecoveryDetails(); });

const savedLink = localStorage.getItem('lastGarminLink');
if(savedLink) $('garminLink').value = savedLink;
if($('workoutDateInput')) $('workoutDateInput').value = todayDate();
if($('aiJournalDate')) loadAiJournalForm(todayDate());
renderGeminiAnalysis(readLastGeminiAnalysis());
renderGeminiChatHistory();
updateGeminiUsageUi();

if(loadStoredAuth()){
  showApp();
  bootAppData();
}else{
  showLogin();
  renderAll();
}
localStorage.setItem('lastVersion', VERSION);
if('serviceWorker' in navigator){ navigator.serviceWorker.register('service-worker.js?v=322').catch(()=>{}); }
