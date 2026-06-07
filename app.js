const VERSION = '1.8';
const RACE_DATE = new Date('2026-08-15T07:00:00+02:00');
const START_PREP_DATE = new Date('2025-06-01T00:00:00+02:00');
const LOCAL_BACKUP_KEY = 'szymonKalmarTrainingHistoryV18Backup';
const AUTH_SESSION_KEY = 'szymonKalmarAuthSessionV11';

const SUPABASE_URL = 'https://ktfjdngmvrnqkzjxvzoc.supabase.co';
const SUPABASE_KEY = 'sb_publishable_r1A-cyrFQ3ASLsOVPGcmDA_26a3P8zK';
const WORKOUTS_ENDPOINT = `${SUPABASE_URL}/rest/v1/workouts`;
const GARMIN_EDGE_ENDPOINT = `${SUPABASE_URL}/functions/v1/garmin-public-import`;
const PROFILE_ENDPOINT = `${SUPABASE_URL}/rest/v1/athlete_profile`;
const AUTH_TOKEN_ENDPOINT = `${SUPABASE_URL}/auth/v1/token?grant_type=password`;
const AUTH_LOGOUT_ENDPOINT = `${SUPABASE_URL}/auth/v1/logout`;
const AUTH_USER_ENDPOINT = `${SUPABASE_URL}/auth/v1/user`;

let cloudOnline = false;
let trainings = [];
let currentSession = null;
let currentUser = null;
let activeFilter = 'all';
let profileRowId = null;
let athleteProfile = { athlete_name:'Szymon', target_event:'IRONMAN Kalmar 2026', target_date:'2026-08-15' };
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
  date: new Date().toISOString()
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
function localBackup(){ try { return JSON.parse(localStorage.getItem(LOCAL_BACKUP_KEY)) || []; } catch { return []; } }
function saveLocalBackup(items){ localStorage.setItem(LOCAL_BACKUP_KEY, JSON.stringify(items.slice(0,200))); }
function safeParse(text){ if(!text) return null; if(typeof text === 'object') return text; try { return JSON.parse(text); } catch { return null; } }
function formatKm(n, digits=2){ return Number(n||0).toLocaleString('pl-PL',{minimumFractionDigits:digits, maximumFractionDigits:digits}); }
function formatDate(value){ const d = value ? new Date(value) : new Date(); return d.toLocaleDateString('pl-PL', { day:'numeric', month:'short', year:'numeric' }); }
function formatTime(value){ const d = value ? new Date(value) : new Date(); return d.toLocaleTimeString('pl-PL', {hour:'2-digit', minute:'2-digit'}); }
function minutesToClock(min){ const h=Math.floor((min||0)/60), m=Math.round((min||0)%60); return h ? `${h}:${String(m).padStart(2,'0')}:00` : `${m}:00`; }
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
async function apiDelete(url){
  const r = await fetch(url,{method:'DELETE',headers:headers({'Prefer':'return=representation'})});
  if(!r.ok) throw new Error(`DELETE ${r.status}`);
  try { return await r.json(); } catch { return []; }
}
function fromDb(row){
  const notes = safeParse(row.notes) || {};
  return {
    id: row.id,
    date: row.workout_date || row.created_at,
    workout_date: row.workout_date || String(row.created_at || '').slice(0,10),
    type: row.sport || 'other',
    name: row.title || `${(sportMeta[row.sport]||sportMeta.other).pl} — trening Kalmar`,
    distanceKm: Number(row.distance_km || 0),
    minutes: Number(row.duration_minutes || 0),
    elevation: Number(notes.elevation || 0),
    calories: Number(notes.calories || 0),
    note: notes.note || '',
    source: notes.source || 'Supabase',
    sourceUrl: notes.sourceUrl || notes.garmin_url || '',
    garminActivityId: notes.garminActivityId || notes.garmin_activity_id || '',
    avgHr: notes.avgHr || notes.avg_hr || null,
    maxHr: notes.maxHr || notes.max_hr || null,
    ascent: notes.ascent || notes.elevation || 0,
    parsedBy: notes.parsedBy || '',
    pace: notes.pace || null,
    speed: notes.speed || null,
    latitude: notes.latitude || null,
    longitude: notes.longitude || null,
    rawDescription: notes.rawDescription || '',
    metrics: notes.metrics || {},
    rawAdvancedText: notes.rawAdvancedText || '',
    cloud: true
  };
}
function toDb(item){
  return {
    user_id: currentUser?.id || null,
    workout_date: item.workout_date || todayDate(),
    sport: item.type,
    title: item.name,
    distance_km: Number(item.distanceKm || 0),
    duration_minutes: Number(item.minutes || 0),
    notes: JSON.stringify({
      source: item.source || 'aplikacja',
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
async function loadTrainings(){
  setSync('Łączenie z Supabase...','info');
  try{
    const rows = await apiGet(`${WORKOUTS_ENDPOINT}?select=*&${userFilter()}order=workout_date.desc,created_at.desc&limit=200`);
    cloudOnline = true;
    trainings = rows.map(fromDb);
    saveLocalBackup(trainings);
    setSync(`Supabase działa • treningów w chmurze: ${trainings.length}`,'ok');
  }catch(err){
    cloudOnline = false;
    trainings = localBackup();
    setSync('Brak połączenia z Supabase — pokazuję lokalny backup','warn');
    console.warn(err);
  }
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
  const localItem = { id:`local-${Date.now()}`, date:todayDate(), ...item };
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
    trainings = [saved, ...trainings].slice(0,200);
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
  return trainings.filter(x => new Date(x.date || x.workout_date).getTime() >= weekAgo);
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
    <div class="workout-main"><b>${activityNameFor(item).replace(' — trening Kalmar','')}</b><small>${formatDate(item.date)} • ${formatTime(item.date)}</small></div>
    <div class="workout-metric"><b>${formatKm(item.distanceKm)} km</b><small>${minutesToClock(item.minutes)} • ${pace}</small></div>
    ${actions}
  </div>`;
}
function detailAiText(item){
  const pace = calcPace(item.distanceKm, item.minutes, item.type);
  const km = Number(item.distanceKm || 0);
  const min = Number(item.minutes || 0);
  const type = item.type || 'run';
  if(type === 'swim') return `Pływanie ${formatKm(km)} km w czasie ${minutesToClock(min)}. Dobry element techniczny i tlenowy pod Kalmar. Kontroluj spokojny rytm i jakość ruchu.`;
  if(type === 'bike') return `Rower ${formatKm(km)} km${item.elevation ? `, przewyższenie +${Math.round(Number(item.elevation))} m` : ''}${item.speed ? `, średnia ${item.speed}` : ''}. To ważne budowanie bazy pod 180 km w Kalmar. Jeśli trening był mocny, następnego dnia warto rozważyć lżejsze pływanie albo spokojny bieg.`;
  if(type === 'run') return `Bieg ${formatKm(km)} km ze średnim tempem ${item.pace || pace}${item.elevation ? ` i przewyższeniem +${Math.round(Number(item.elevation))} m` : ''}. Ten trening buduje wytrzymałość biegową pod maraton po rowerze. Zadbaj o regenerację łydek i sen.`;
  return `Trening zapisany w historii. Każda aktywność dokłada cegiełkę do Road to Kalmar 2026.`;
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
function renderAdvancedStats(item){
  const box = $('advancedStats');
  if(!box) return;
  const m = item.metrics || {};
  const rows = metricOrder.filter(k => m[k] !== undefined && m[k] !== null && String(m[k]).trim() !== '').map(k => `<div><span>${metricLabels[k] || k}</span><b>${escapeHtml(String(m[k]))}</b></div>`);
  if(!rows.length){
    box.className = 'advanced-stats empty';
    box.innerHTML = 'Brak dodatkowych danych. Wklej tekst ze szczegółów Garmin poniżej i kliknij „Odczytaj dane”.';
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
  $('detailsSub').textContent = `${formatDate(item.date)} • ${formatTime(item.date)} • Road to Kalmar 2026`;
  $('detailsDistance').textContent = `${formatKm(item.distanceKm)} km`;
  $('detailsDuration').textContent = minutesToClock(item.minutes);
  $('detailsPace').textContent = calcPace(item.distanceKm, item.minutes, item.type);
  $('detailsDate').textContent = formatDate(item.date);
  $('detailsSource').textContent = item.source || (item.sourceUrl ? 'Garmin Connect' : 'Aplikacja');
  $('detailsElevation').textContent = item.elevation || item.ascent ? `+${Math.round(Number(item.elevation || item.ascent || 0))} m` : '--';
  $('detailsCalories').textContent = item.calories ? `${Math.round(Number(item.calories))} kcal` : '--';
  $('detailsHeart').textContent = item.avgHr ? `${Math.round(Number(item.avgHr))} bpm${item.maxHr ? ` / max ${Math.round(Number(item.maxHr))}` : ''}` : '--';
  $('detailsGarminId').textContent = item.garminActivityId || (item.sourceUrl ? extractGarminActivityId(item.sourceUrl) : '') || '--';
  $('detailsAiText').textContent = detailAiText(item);
  $('editTitle').value = activityNameFor(item).replace(' — trening Kalmar','');
  $('editDistance').value = Number(item.distanceKm || 0).toFixed(2);
  $('editMinutes').value = Math.round(Number(item.minutes || 0));
  $('editNote').value = item.note || '';
  if($('editGarminPaste')) $('editGarminPaste').value = item.rawAdvancedText || '';
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
    note: $('editNote').value.trim(),
    metrics: item.metrics || {},
    rawAdvancedText: $('editGarminPaste')?.value.trim() || item.rawAdvancedText || '',
    avgHr: item.avgHr || null,
    maxHr: item.maxHr || null,
    calories: item.calories || 0,
    elevation: item.elevation || 0,
    ascent: item.ascent || item.elevation || 0,
    workout_date: String(item.workout_date || item.date || todayDate()).slice(0,10)
  };
  setSync('Zapisywanie zmian treningu...', 'info');
  try{
    if(cloudOnline && !String(updated.id).startsWith('local-')){
      const body = toDb(updated);
      delete body.user_id;
      await apiPatch(`${WORKOUTS_ENDPOINT}?id=eq.${encodeURIComponent(updated.id)}${currentUser?.id ? `&user_id=eq.${encodeURIComponent(currentUser.id)}` : ''}`, body);
    }
    trainings = trainings.map(x => String(x.id) === String(updated.id) ? updated : x);
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
function renderHistory(){
  const full = trainings.length ? trainings : [demo];
  const filtered = activeFilter === 'all' ? full : full.filter(x => x.type === activeFilter);
  const html = filtered.length ? filtered.map(item => workoutHtml(item, true)).join('') : '<div class="empty-history">Brak treningów w wybranej dyscyplinie.</div>';
  $('historyList').innerHTML = html;
  $('recentList').innerHTML = full.slice(0,4).map(item => workoutHtml(item, false)).join('') || '<div class="empty-history">Dodaj pierwszy trening.</div>';
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
  const loadScore = Math.min(100, Math.round((weekMinutes/8) + weekCount*5 + weekTotals.run.km*1.1 + weekTotals.bike.km*0.18 + weekTotals.swim.km*5));
  let loadLabel = 'lekki';
  if(loadScore >= 70) loadLabel = 'mocny';
  else if(loadScore >= 35) loadLabel = 'średni';
  const readiness = clamp(100 - Math.round(loadScore*.42), 40, 94);
  $('readiness').textContent = readiness;
  $('readinessDonut').style.setProperty('--value', readiness);
  const set = (id, value) => { const el=$(id); if(el) el.textContent = value; };
  set('aiScore', readiness);
  set('weekLoadValue', `${loadLabel} • ${weekCount} treningów • ${(weekMinutes/60).toFixed(1).replace('.', ',')} h`);
  set('aiReadinessText', readiness >= 75 ? 'Organizm wygląda na gotowy do normalnego treningu.' : readiness >= 58 ? 'Warto trenować rozsądnie i pilnować regeneracji.' : 'Obciążenie rośnie — lepszy będzie lżejszy dzień.');

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
    balanceText = `W tym tygodniu dominuje: ${domName}. ${missing.length ? 'Brakuje: ' + missing.map(k=>sportMeta[k].label).join(', ') + '.' : 'Wszystkie trzy dyscypliny są obecne.'}`;
    decision = `🟡 Tydzień ${loadLabel}. ${balanceText}`;
  }
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
  $('decision').textContent = decision;
  $('aiSummary').innerHTML = `<p><b>Dzień przygotowań:</b> ${$('prepDay').textContent}. Każdy zapisany trening buduje drogę do Kalmar.</p><p><b>Ostatnie 7 dni:</b> ${weekCount} treningów, ${(weekMinutes/60).toFixed(1).replace('.', ',')} h, ${formatKm(totalKm,1)} km łącznie.</p><p><b>AI:</b> ${balanceText}</p>`;
  $('planList').innerHTML = plan.map(x=>`<li>${x}</li>`).join('');
  if($('weeklyPlan')) $('weeklyPlan').innerHTML = generateWeeklyPlan(readiness, loadLabel, missing);
}
function renderAll(){ updateKalmarRoad(); renderTotals(); renderHistory(); analyze(); updatePreview(); }
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
      workout_date: todayDate(),
      date: todayDate(),
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
['distanceInput','minutesInput','sportType'].forEach(id => $(id).addEventListener('input', updatePreview));

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
    workout_date: parsedGarmin?.workout_date || todayDate(),
    date: parsedGarmin?.workout_date || todayDate()
  };
  await addTraining(item);
  parsedGarmin = null;
  setGarminStatus('Gotowe. Trening zapisany w Supabase razem z danymi Garmin: nazwa, dystans, czas, źródło, ID i przewyższenie.', 'ok');
  setImportReport(null);
  updatePreview();
});
$('refreshBtn').addEventListener('click', loadTrainings);
$('refreshBtn2').addEventListener('click', loadTrainings);
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
if($('deleteDetailsBtn')) $('deleteDetailsBtn').addEventListener('click', deleteSelectedWorkout);
if($('parseGarminTextBtn')) $('parseGarminTextBtn').addEventListener('click', () => mergeAdvancedIntoSelected(false));
if($('clearGarminTextBtn')) $('clearGarminTextBtn').addEventListener('click', () => mergeAdvancedIntoSelected(true));
document.addEventListener('keydown', (event) => { if(event.key === 'Escape' && !$('workoutDetails')?.hidden) closeWorkoutDetails(); });

const savedLink = localStorage.getItem('lastGarminLink');
if(savedLink) $('garminLink').value = savedLink;

if(loadStoredAuth()){
  showApp();
  bootAppData();
}else{
  showLogin();
  renderAll();
}
localStorage.setItem('lastVersion', VERSION);
if('serviceWorker' in navigator){ navigator.serviceWorker.register('service-worker.js?v=15').catch(()=>{}); }
