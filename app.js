const VERSION = '0.6';
const RACE_DATE = new Date('2026-08-15T07:00:00+02:00');
const START_PREP_DATE = new Date('2025-06-01T00:00:00+02:00');
const LOCAL_BACKUP_KEY = 'szymonKalmarTrainingHistoryV06Backup';

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
}
async function addTraining(item){
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
function workoutHtml(item){
  const meta = sportMeta[item.type] || sportMeta.other;
  const pace = calcPace(item.distanceKm, item.minutes, item.type);
  return `<div class="workout-item">
    <div class="workout-icon ${meta.cls}">${meta.icon}</div>
    <div class="workout-main"><b>${activityNameFor(item).replace(' — trening Kalmar','')}</b><small>${formatDate(item.date)} • ${formatTime(item.date)}</small></div>
    <div class="workout-metric"><b>${formatKm(item.distanceKm)} km</b><small>${minutesToClock(item.minutes)} • ${pace}</small></div>
    <div class="chev">›</div>
  </div>`;
}
function renderHistory(){
  const full = trainings.length ? trainings : [demo];
  const filtered = activeFilter === 'all' ? full : full.filter(x => x.type === activeFilter);
  const html = filtered.length ? filtered.map(workoutHtml).join('') : '<div class="empty-history">Brak treningów w wybranej dyscyplinie.</div>';
  $('historyList').innerHTML = html;
  $('recentList').innerHTML = full.slice(0,4).map(workoutHtml).join('') || '<div class="empty-history">Dodaj pierwszy trening.</div>';
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
['distanceInput','minutesInput','sportType'].forEach(id => $(id).addEventListener('input', updatePreview));

$('loadBtn').addEventListener('click', async () => {
  const link = $('garminLink').value.trim();
  const id = (link.match(/activity\/(\d+)/)||[])[1];
  if(!id){ alert('Wklej poprawny link Garmin Connect z numerem aktywności.'); return; }
  localStorage.setItem('lastGarminLink', link);
  const item = { ...demo, id: undefined, name:'Mogilany Bieganie', source:'Garmin link demo', workout_date: todayDate(), date: todayDate() };
  await addTraining(item);
});
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
    source: 'ręczny wpis',
    workout_date: todayDate(),
    date: todayDate()
  };
  await addTraining(item);
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
if('serviceWorker' in navigator){ navigator.serviceWorker.register('service-worker.js?v=06').catch(()=>{}); }
