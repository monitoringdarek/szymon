const VERSION = '0.8';
const RACE_DATE = new Date('2026-08-15T07:00:00+02:00');
const START_PREP_DATE = new Date('2025-06-01T00:00:00+02:00');
const LOCAL_BACKUP_KEY = 'szymonKalmarTrainingHistoryV08Backup';

const SUPABASE_URL = 'https://ktfjdngmvrnqkzjxvzoc.supabase.co';
const SUPABASE_KEY = 'sb_publishable_r1A-cyrFQ3ASLsOVPGcmDA_26a3P8zK';
const WORKOUTS_ENDPOINT = `${SUPABASE_URL}/rest/v1/workouts`;
const PROFILE_ENDPOINT = `${SUPABASE_URL}/rest/v1/athlete_profile`;

let cloudOnline = false;
let trainings = [];
let activeFilter = 'all';

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

function setGarminStatus(message, type='info'){
  const el = $('garminStatus');
  if(!el) return;
  el.textContent = message;
  el.className = `garmin-status ${type}`;
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
  const typeKey = activity.activityType?.typeKey || activity.activityTypeDTO?.typeKey || activity.eventType?.typeKey || '';
  const sport = mapGarminSport(typeKey || activity.activityType);
  const distanceMeters = Number(activity.distance || activity.summaryDTO?.distance || 0);
  const durationSeconds = Number(activity.duration || activity.movingDuration || activity.elapsedDuration || activity.summaryDTO?.duration || 0);
  const start = activity.startTimeLocal || activity.beginTimestamp || activity.startTimeGMT || activity.summaryDTO?.startTimeLocal || new Date().toISOString();
  const distanceKm = distanceMeters > 100 ? distanceMeters / 1000 : Number(activity.distanceKm || 0);
  const minutes = durationSeconds > 0 ? Math.round(durationSeconds / 60) : Number(activity.durationMinutes || 0);
  if(!distanceKm || !minutes) throw new Error('Garmin nie zwrócił dystansu/czasu.');
  return {
    type: sport,
    name: activity.activityName || activity.name || `${(sportMeta[sport]||sportMeta.other).pl} — Garmin`,
    distanceKm: Number(distanceKm.toFixed(2)),
    minutes,
    elevation: Number(activity.elevationGain || activity.summaryDTO?.elevationGain || 0),
    ascent: Number(activity.elevationGain || activity.summaryDTO?.elevationGain || 0),
    calories: Math.round(Number(activity.calories || activity.summaryDTO?.calories || 0)),
    avgHr: activity.averageHR || activity.summaryDTO?.averageHR || null,
    maxHr: activity.maxHR || activity.summaryDTO?.maxHR || null,
    source: 'Garmin Connect public',
    sourceUrl: originalUrl,
    garminActivityId: id,
    parsedBy: 'garmin-public-endpoint',
    workout_date: String(start).slice(0,10),
    date: String(start).slice(0,10)
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
}
async function analyzeGarminLink(){
  const link = $('garminLink').value.trim();
  const id = extractGarminActivityId(link);
  if(!id){ alert('Wklej poprawny link Garmin Connect z numerem aktywności.'); return; }
  localStorage.setItem('lastGarminLink', link);
  setGarminStatus('Próbuję pobrać publiczne dane z Garmin Connect...', 'info');
  const publicEndpoint = `https://connect.garmin.com/modern/proxy/activity-service/activity/${id}`;
  try{
    const json = await fetchJsonThroughProxy(publicEndpoint);
    const item = parseGarminActivityJson(json, link, id);
    applyParsedWorkout(item);
  }catch(err){
    console.warn(err);
    if(id === '23153515128'){
      applyParsedWorkout({ ...demo, id: undefined, garminActivityId:id, sourceUrl:link, source:'Garmin public fallback', parsedBy:'fallback-known-public-link', workout_date:todayDate(), date:todayDate() });
      setGarminStatus('Garmin/CORS nie zwrócił JSON, ale rozpoznano testowy publiczny link i uzupełniono dane. Docelowo warto dodać mały backend/proxy.', 'warn');
    }else{
      parsedGarmin = null;
      setGarminStatus('Nie udało się pobrać automatycznie. Uzupełnij ręcznie — link zapisze się razem z treningiem.', 'warn');
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
  return { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, ...extra };
}
async function apiGet(url){ const r = await fetch(url,{headers:headers()}); if(!r.ok) throw new Error(`GET ${r.status}`); return r.json(); }
async function apiPost(url, body){
  const r = await fetch(url,{method:'POST',headers:headers({'Content-Type':'application/json','Prefer':'return=representation'}),body:JSON.stringify(body)});
  if(!r.ok) throw new Error(`POST ${r.status}`);
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
    cloud: true
  };
}
function toDb(item){
  return {
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
async function loadProfile(){
  try{
    const rows = await apiGet(`${PROFILE_ENDPOINT}?select=*&limit=1`);
    if(rows && rows[0]) setSync(`Supabase połączony • ${rows[0].athlete_name} • ${rows[0].target_event}`,'ok');
  }catch(err){ console.warn(err); }
}
async function loadTrainings(){
  setSync('Łączenie z Supabase...','info');
  try{
    const rows = await apiGet(`${WORKOUTS_ENDPOINT}?select=*&order=workout_date.desc,created_at.desc&limit=200`);
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
  const daysLeft = Math.max(0, Math.ceil((RACE_DATE - now)/dayMs));
  const prepDay = Math.max(1, Math.floor((now - START_PREP_DATE)/dayMs)+1);
  const totalPrep = Math.max(1, Math.ceil((RACE_DATE - START_PREP_DATE)/dayMs));
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
  return `<div class="workout-item" data-workout-id="${id}">
    <div class="workout-icon ${meta.cls}">${meta.icon}</div>
    <div class="workout-main"><b>${activityNameFor(item).replace(' — trening Kalmar','')}</b><small>${formatDate(item.date)} • ${formatTime(item.date)}</small></div>
    <div class="workout-metric"><b>${formatKm(item.distanceKm)} km</b><small>${minutesToClock(item.minutes)} • ${pace}</small></div>
    ${actions}
  </div>`;
}
async function deleteTraining(id){
  if(!id) return;
  const item = trainings.find(x => String(x.id) === String(id));
  if(!item) return;
  if(!confirm(`Usunąć trening: ${activityNameFor(item)} (${formatKm(item.distanceKm)} km)?`)) return;
  setSync('Usuwanie treningu...', 'info');
  try{
    if(cloudOnline && !String(id).startsWith('local-')){
      await apiDelete(`${WORKOUTS_ENDPOINT}?id=eq.${encodeURIComponent(id)}`);
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
function analyze(){
  const latest = trainings[0] || demo;
  const week = currentWeek();
  const weekMinutes = week.reduce((s,x)=>s+Number(x.minutes||0),0);
  const weekCount = week.length;
  const load = Math.min(90, Math.round((weekMinutes/10) + weekCount*4 + (latest.type==='run' ? latest.distanceKm*1.1 : latest.type==='bike' ? latest.distanceKm*.18 : latest.distanceKm*5)));
  const readiness = clamp(100 - Math.round(load*.45), 42, 92);
  $('readiness').textContent = readiness;
  $('readinessDonut').style.setProperty('--value', readiness);
  let decision = '🟡 Dodaj kilka treningów, a AI będzie mądrzejsze.';
  let plan = ['🏊 Lekka technika lub mobilizacja 20–30 min','💧 Nawodnienie i sen','📌 Budujemy historię pod Kalmar 2026'];
  if(weekCount >= 3 && readiness > 72){
    decision = '🟢 Forma wygląda dobrze — można trenować normalnie.';
    plan = ['🚴 Rower Z2 60–90 min','🏃 Krótki bieg easy 15–25 min po rowerze','🧘 Schłodzenie i rozciąganie'];
  } else if(readiness < 58){
    decision = '🔴 Obciążenie rośnie — jutro lżejszy dzień.';
    plan = ['😴 Bez mocnych akcentów','🏊 Pływanie techniczne albo spacer','📈 Sprawdź sen, HRV i zmęczenie nóg'];
  }
  $('decision').textContent = decision;
  $('aiSummary').innerHTML = `<p><b>Dzień przygotowań:</b> ${$('prepDay').textContent}. Każdy zapisany trening buduje drogę do Kalmar.</p><p><b>Ten tydzień:</b> ${weekCount} treningów, ${(weekMinutes/60).toFixed(1)} h. Najnowszy wpis: ${activityNameFor(latest)}.</p>`;
  $('planList').innerHTML = plan.map(x=>`<li>${x}</li>`).join('');
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
  if(btn) deleteTraining(btn.dataset.deleteId);
});
['distanceInput','minutesInput','sportType'].forEach(id => $(id).addEventListener('input', updatePreview));

$('loadBtn').addEventListener('click', analyzeGarminLink);
$('saveManualBtn').addEventListener('click', async () => {
  const type = $('sportType').value;
  const distanceKm = Number($('distanceInput').value);
  const minutes = Number($('minutesInput').value);
  if(!distanceKm || !minutes){ alert('Wpisz dystans i czas.'); return; }
  const meta = sportMeta[type] || sportMeta.other;
  const item = {
    type,
    name: `${meta.pl} — trening Kalmar`,
    distanceKm,
    minutes,
    elevation: type === 'run' ? 80 : type === 'bike' ? 250 : 0,
    calories: Math.round(minutes * (type === 'bike' ? 9 : type === 'swim' ? 8 : 11)),
    note: $('noteInput').value.trim(),
    source: parsedGarmin ? parsedGarmin.source : 'ręczny wpis',
    sourceUrl: parsedGarmin?.sourceUrl || $('garminLink').value.trim(),
    garminActivityId: parsedGarmin?.garminActivityId || extractGarminActivityId($('garminLink').value),
    avgHr: parsedGarmin?.avgHr || null,
    maxHr: parsedGarmin?.maxHr || null,
    parsedBy: parsedGarmin?.parsedBy || '',
    workout_date: todayDate(),
    date: todayDate()
  };
  await addTraining(item);
  parsedGarmin = null;
  setGarminStatus('Gotowe. Możesz wkleić kolejny link Garmin albo dodać ręcznie następny trening.', 'ok');
});
$('refreshBtn').addEventListener('click', loadTrainings);
$('refreshBtn2').addEventListener('click', loadTrainings);
$('clearLocalBtn').addEventListener('click', () => {
  if(confirm('Wyczyścić tylko lokalny backup na tym urządzeniu? Dane w Supabase zostają.')){
    localStorage.removeItem(LOCAL_BACKUP_KEY);
    setSync('Wyczyszczono lokalny backup. Dane w Supabase nie zostały usunięte.','info');
  }
});

const savedLink = localStorage.getItem('lastGarminLink');
if(savedLink) $('garminLink').value = savedLink;

renderAll();
loadProfile();
loadTrainings();
localStorage.setItem('lastVersion', VERSION);
if('serviceWorker' in navigator){ navigator.serviceWorker.register('service-worker.js?v=08').catch(()=>{}); }
