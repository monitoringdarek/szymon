const VERSION = '0.5';
const RACE_DATE = new Date('2026-08-15T07:00:00+02:00');
const START_PREP_DATE = new Date('2025-06-01T00:00:00+02:00');
const LOCAL_BACKUP_KEY = 'szymonKalmarTrainingHistoryV05Backup';

const SUPABASE_URL = 'https://ktfjdngmvrnqkzjxvzoc.supabase.co';
const SUPABASE_KEY = 'sb_publishable_r1A-cyrFQ3ASLsOVPGcmDA_26a3P8zK';
const WORKOUTS_ENDPOINT = `${SUPABASE_URL}/rest/v1/workouts`;
const PROFILE_ENDPOINT = `${SUPABASE_URL}/rest/v1/athlete_profile`;

let cloudOnline = false;
let trainings = [];

const demo = {
  name: 'Mogilany Bieganie',
  type: 'run',
  label: 'Bieganie',
  distanceKm: 15.08,
  minutes: 69,
  time: '1:09:11',
  pace: '4:35',
  elevation: 225,
  calories: 1089,
  load: 'wysokie',
  source: 'Garmin demo'
};

const sportMeta = {
  swim: { icon:'🏊', label:'Swim' },
  bike: { icon:'🚴', label:'Bike' },
  run: { icon:'🏃', label:'Run' },
  strength: { icon:'💪', label:'Strength' },
  other: { icon:'⭐', label:'Other' }
};

const quotes = [
  'Every workout counts.',
  'One day closer to Kalmar.',
  '226 km starts today.',
  'Trust the process.',
  'Strong today. Stronger tomorrow.',
  'Nie trenujesz na jutro. Trenujesz na Kalmar.'
];

function clamp(n, min, max){ return Math.max(min, Math.min(max, n)); }
function $(id){ return document.getElementById(id); }
function todayDate(){ return new Date().toISOString().slice(0,10); }
function formatHours(min){ return (min / 60).toFixed(1); }
function formatDate(value){
  const d = value ? new Date(value) : new Date();
  return d.toLocaleDateString('pl-PL', {day:'2-digit', month:'2-digit', year:'numeric'});
}
function calcPace(distanceKm, minutes, type){
  if(!distanceKm || !minutes) return '--';
  if(type === 'swim'){
    const secPer100 = Math.round((minutes * 60) / (distanceKm * 10));
    return `${Math.floor(secPer100/60)}:${String(secPer100%60).padStart(2,'0')}/100m`;
  }
  if(type === 'bike'){
    return `${(distanceKm / (minutes/60)).toFixed(1)} km/h`;
  }
  const secPerKm = Math.round((minutes * 60) / distanceKm);
  return `${Math.floor(secPerKm/60)}:${String(secPerKm%60).padStart(2,'0')}/km`;
}
function minutesToTime(min){
  const h = Math.floor(min/60), m = min % 60;
  return h ? `${h}:${String(m).padStart(2,'0')}:00` : `${m}:00`;
}
function localBackup(){
  try { return JSON.parse(localStorage.getItem(LOCAL_BACKUP_KEY)) || []; }
  catch { return []; }
}
function saveLocalBackup(items){
  localStorage.setItem(LOCAL_BACKUP_KEY, JSON.stringify(items.slice(0, 120)));
}
function setSync(text, type='info'){
  const el = $('syncStatus');
  if(!el) return;
  el.textContent = text;
  el.className = `sync-status ${type}`;
}
function headers(extra = {}){
  return {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    ...extra
  };
}
function fromDb(row){
  const meta = sportMeta[row.sport] || sportMeta.other;
  const notes = safeParse(row.notes) || {};
  return {
    id: row.id,
    date: row.workout_date || row.created_at,
    type: row.sport || 'other',
    label: meta.label,
    name: row.title || `${meta.label} — trening Kalmar`,
    distanceKm: Number(row.distance_km || 0),
    minutes: Number(row.duration_minutes || 0),
    elevation: Number(notes.elevation || 0),
    calories: Number(notes.calories || 0),
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
      version: VERSION
    })
  };
}
function safeParse(text){
  if(!text) return null;
  if(typeof text === 'object') return text;
  try { return JSON.parse(text); } catch { return null; }
}

async function apiGet(url){
  const res = await fetch(url, { headers: headers() });
  if(!res.ok) throw new Error(`Supabase GET ${res.status}`);
  return res.json();
}
async function apiPost(url, body){
  const res = await fetch(url, {
    method: 'POST',
    headers: headers({
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    }),
    body: JSON.stringify(body)
  });
  if(!res.ok) throw new Error(`Supabase POST ${res.status}`);
  return res.json();
}

async function loadProfile(){
  try{
    const rows = await apiGet(`${PROFILE_ENDPOINT}?select=*&limit=1`);
    if(rows && rows[0]){
      if(rows[0].target_date){
        // RACE_DATE zostaje stałą dla odliczania, ale pokazujemy profil w statusie.
        setSync(`☁️ Supabase połączony • ${rows[0].athlete_name} • ${rows[0].target_event}`, 'ok');
      }
    }
  }catch(err){
    console.warn(err);
  }
}
async function loadTrainings(){
  setSync('Łączenie z Supabase...', 'info');
  try{
    const rows = await apiGet(`${WORKOUTS_ENDPOINT}?select=*&order=workout_date.desc,created_at.desc&limit=120`);
    cloudOnline = true;
    trainings = rows.map(fromDb);
    saveLocalBackup(trainings);
    setSync(`☁️ Supabase działa • treningów w chmurze: ${trainings.length}`, 'ok');
  }catch(err){
    cloudOnline = false;
    trainings = localBackup();
    setSync('⚠️ Brak połączenia z Supabase — pokazuję lokalny backup', 'warn');
    console.warn(err);
  }
  renderHistory();
}
async function addTraining(item){
  const backup = [{ id: `local-${Date.now()}`, date: todayDate(), ...item }, ...localBackup()];
  saveLocalBackup(backup);

  if(!cloudOnline){
    trainings = backup;
    setSync('⚠️ Zapisano tylko lokalnie — odśwież po powrocie internetu', 'warn');
    renderHistory();
    return;
  }

  setSync('Zapisywanie treningu do Supabase...', 'info');
  try{
    const inserted = await apiPost(WORKOUTS_ENDPOINT, toDb(item));
    const saved = inserted && inserted[0] ? fromDb(inserted[0]) : { id: `cloud-${Date.now()}`, date: todayDate(), ...item, cloud: true };
    trainings = [saved, ...trainings].slice(0, 120);
    saveLocalBackup(trainings);
    setSync('✅ Trening zapisany w Supabase — PC i iPhone zobaczą te same dane', 'ok');
    renderHistory();
  }catch(err){
    cloudOnline = false;
    trainings = backup;
    setSync('⚠️ Nie udało się zapisać w chmurze — zostawiam lokalny backup', 'warn');
    console.warn(err);
    renderHistory();
  }
}

function updateKalmarRoad(){
  const now = new Date();
  const dayMs = 1000 * 60 * 60 * 24;
  const daysLeft = Math.max(0, Math.ceil((RACE_DATE - now) / dayMs));
  const prepDay = Math.max(1, Math.floor((now - START_PREP_DATE) / dayMs) + 1);
  const totalPrep = Math.max(1, Math.ceil((RACE_DATE - START_PREP_DATE) / dayMs));
  const progress = clamp(Math.round((prepDay / totalPrep) * 100), 0, 100);

  $('daysLeft').textContent = daysLeft;
  $('prepDay').textContent = prepDay;
  $('progressText').textContent = progress + '%';
  $('progressBar').style.width = progress + '%';
  $('quoteText').textContent = quotes[prepDay % quotes.length];
}

function analyze(a){
  const week = currentWeek();
  const weekMinutes = week.reduce((s,x)=>s+Number(x.minutes||0),0);
  const weekCount = week.length;
  const typeFactor = a.type === 'bike' ? 0.35 : a.type === 'swim' ? 5 : 2.1;
  const distanceScore = Math.min(35, a.distanceKm * typeFactor);
  const timeScore = Math.min(25, a.minutes / 3);
  const hillScore = Math.min(20, (a.elevation || 0) / 12);
  const load = Math.round(distanceScore + timeScore + hillScore + Math.min(12, weekMinutes / 90));
  const readiness = Math.max(35, 100 - Math.round(load * .50));
  $('readiness').textContent = readiness;

  let decision = '🟡 Jutro: lekki trening albo regeneracja aktywna';
  let plan = [
    '🏊 Pływanie techniczne 30–40 min albo lekki rower Z1/Z2',
    '🦵 10 min mobilizacji łydki, biodra i pleców',
    '💧 Nawodnienie + spokojny sen minimum 8 h',
    '⛔ Bez mocnych interwałów po mocnym dniu'
  ];

  if(readiness > 80){
    decision='🟢 Jutro: można trenować normalnie';
    plan=['🚴 Rower Z2 60–90 min','🏃 Krótki bieg easy 20 min po rowerze','🧘 Schłodzenie i rozciąganie','📌 Kontrola tętna, bez ścigania'];
  }
  if(readiness < 55){
    decision='🔴 Jutro: regeneracja';
    plan=['😴 Bez biegania i bez mocnego roweru','🚶 Spacer 20–40 min','💧 Nawodnienie i spokojne jedzenie','📈 Sprawdź sen, HRV i zmęczenie nóg'];
  }

  $('decision').textContent = decision;
  $('aiSummary').innerHTML = `
    <p><b>Dzień przygotowań do Kalmar:</b> ${$('prepDay').textContent}. Ten trening jest już zapisany w historii drogi do IRONMAN Kalmar 2026.</p>
    <p><b>${a.name}</b>: <b>${a.distanceKm.toFixed(2)} km</b>, czas <b>${minutesToTime(a.minutes)}</b>, tempo/prędkość <b>${calcPace(a.distanceKm, a.minutes, a.type)}</b>.</p>
    <p><b>Ten tydzień:</b> ${weekCount} treningów, ${formatHours(weekMinutes)} h. AI zaczyna patrzeć na historię, a w kolejnych wersjach dołożymy importer Garmin i mocniejsze wnioski.</p>
  `;

  $('planList').innerHTML = plan.map(x=>`<li>${x}</li>`).join('');
}

function renderActivity(a){
  const meta = sportMeta[a.type] || sportMeta.other;
  $('activityName').textContent = a.name;
  $('activityMeta').textContent = `${meta.icon} ${meta.label} • Road to Kalmar • ${a.source || 'Supabase'}`;
  $('distance').textContent = Number(a.distanceKm || 0).toFixed(2);
  $('time').textContent = a.time || minutesToTime(Number(a.minutes || 0));
  $('pace').textContent = calcPace(Number(a.distanceKm || 0), Number(a.minutes || 0), a.type).replace('/km','').replace('/100m','');
  $('elev').textContent = a.elevation || 0;
  $('cal').textContent = a.calories || Math.round(Number(a.minutes || 0) * 10);
  analyze(a);
}
function currentWeek(){
  const now = Date.now();
  const weekAgo = now - 7*24*60*60*1000;
  return trainings.filter(x => new Date(x.date || x.workout_date).getTime() >= weekAgo);
}
function renderHistory(){
  const history = trainings;
  const week = currentWeek();
  const totals = { swim:{km:0,min:0}, bike:{km:0,min:0}, run:{km:0,min:0} };
  for(const item of week){
    if(totals[item.type]){
      totals[item.type].km += Number(item.distanceKm || 0);
      totals[item.type].min += Number(item.minutes || 0);
    }
  }
  $('swimKm').textContent = totals.swim.km.toFixed(2) + ' km';
  $('bikeKm').textContent = totals.bike.km.toFixed(1) + ' km';
  $('runKm').textContent = totals.run.km.toFixed(1) + ' km';
  $('swimTime').textContent = Math.round(totals.swim.min) + ' min';
  $('bikeTime').textContent = Math.round(totals.bike.min) + ' min';
  $('runTime').textContent = Math.round(totals.run.min) + ' min';

  const weekKm = week.reduce((s,x)=>s+Number(x.distanceKm||0),0);
  const weekMin = week.reduce((s,x)=>s+Number(x.minutes||0),0);
  $('weekCount').textContent = week.length;
  $('weekHours').textContent = formatHours(weekMin);
  $('weekKm').textContent = weekKm.toFixed(1);
  $('cloudCount').textContent = history.length;

  const box = $('historyList');
  if(!history.length){
    box.innerHTML = '<div class="empty-history">Brak historii w Supabase. Zapisz pierwszy trening — od tego zacznie się prawdziwa droga do Kalmar.</div>';
    renderActivity(demo);
    return;
  }
  box.innerHTML = history.map(item => {
    const meta = sportMeta[item.type] || sportMeta.other;
    const pace = calcPace(Number(item.distanceKm), Number(item.minutes), item.type);
    const cloudMark = item.cloud ? '☁️' : '📱';
    return `<div class="history-item">
      <div class="history-icon">${meta.icon}</div>
      <div><b>${item.name || meta.label}</b><small>${formatDate(item.date)} • ${item.distanceKm} km • ${item.minutes} min • ${pace} • ${cloudMark}</small></div>
      <div class="history-pill">${meta.label}</div>
    </div>`;
  }).join('');

  renderActivity(history[0]);
}

$('loadBtn').addEventListener('click', async () => {
  const link = $('garminLink').value.trim();
  const id = (link.match(/activity\/(\d+)/)||[])[1];
  if(!id){ alert('Wklej poprawny link Garmin Connect z numerem aktywności.'); return; }
  localStorage.setItem('lastGarminLink', link);
  const item = { ...demo, name: 'Mogilany Bieganie', source: 'Garmin link demo', workout_date: todayDate() };
  await addTraining(item);
  renderActivity(item);
});

$('saveManualBtn').addEventListener('click', async () => {
  const type = $('sportType').value;
  const distanceKm = Number($('distanceInput').value);
  const minutes = Number($('minutesInput').value);
  if(!distanceKm || !minutes){ alert('Wpisz dystans i czas.'); return; }
  const meta = sportMeta[type];
  const item = {
    type,
    label: meta.label,
    name: `${meta.label} — trening Kalmar`,
    distanceKm,
    minutes,
    elevation: type === 'run' ? 80 : type === 'bike' ? 250 : 0,
    calories: Math.round(minutes * (type === 'bike' ? 9 : type === 'swim' ? 8 : 11)),
    source: 'ręczny wpis',
    workout_date: todayDate()
  };
  await addTraining(item);
  renderActivity(item);
});

$('refreshBtn').addEventListener('click', async () => {
  await loadTrainings();
});

$('clearLocalBtn').addEventListener('click', () => {
  if(confirm('Wyczyścić tylko lokalny backup na tym urządzeniu? Dane w Supabase zostają.')){
    localStorage.removeItem(LOCAL_BACKUP_KEY);
    setSync('Wyczyszczono lokalny backup. Dane w Supabase nie zostały usunięte.', 'info');
  }
});

const savedLink = localStorage.getItem('lastGarminLink');
if(savedLink){ $('garminLink').value = savedLink; }

updateKalmarRoad();
renderActivity(demo);
renderHistory();
localStorage.setItem('lastVersion', VERSION);
loadProfile();
loadTrainings();

if('serviceWorker' in navigator){
  navigator.serviceWorker.register('service-worker.js?v=05').catch(()=>{});
}
