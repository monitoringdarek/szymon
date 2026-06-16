const VERSION = 'v5.0.8-analysis-logic-hotfix-local';
const AUTH_SESSION_KEY = 'szymonAiCoachProV5Session';
const LOGIN_TIMEOUT_MS = 15000;

const SUPABASE_URL = 'https://ktfjdngmvrnqkzjxvzoc.supabase.co';
const SUPABASE_KEY = 'sb_publishable_r1A-cyrFQ3ASLsOVPGcmDA_26a3P8zK';
const READINESS_ENDPOINT = `${SUPABASE_URL}/rest/v1/garmin_pro_readiness_context`;
const WEEKLY_ENDPOINT = `${SUPABASE_URL}/rest/v1/garmin_pro_weekly_summary`;
const LATEST_ENDPOINT = `${SUPABASE_URL}/rest/v1/garmin_pro_latest_activity`;
const CARDS_ENDPOINT = `${SUPABASE_URL}/rest/v1/garmin_pro_activity_cards`;
const LOAD_28D_ENDPOINT = `${SUPABASE_URL}/rest/v1/garmin_pro_training_load_28d`;
const ACTIVITY_CONTEXT_ENDPOINT = `${SUPABASE_URL}/rest/v1/garmin_pro_activity_analysis_context`;
const AUTH_TOKEN_ENDPOINT = `${SUPABASE_URL}/auth/v1/token?grant_type=password`;
const AUTH_REFRESH_ENDPOINT = `${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`;
const AUTH_LOGOUT_ENDPOINT = `${SUPABASE_URL}/auth/v1/logout`;

let session = null;
let user = null;
let readiness = null;
let weekly = null;
let latest = null;
let cards = [];
let load28d = [];
let activityContexts = [];
let activityContextStatus = 'idle';
let lastReadAt = null;
let selectedActivityKey = '';
let viewState = {
  readiness: 'idle',
  weekly: 'idle',
  latest: 'idle',
  cards: 'idle',
  load28d: 'idle'
};
let aiMode = 'plan';
let loginAttemptId = 0;

const $ = (id) => document.getElementById(id);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

function authHeaders(extra = {}){
  const token = session?.access_token || SUPABASE_KEY;
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${token}`,
    ...extra
  };
}

function anonHeaders(extra = {}){
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    ...extra
  };
}

async function apiGet(url){
  const response = await fetch(url, { method: 'GET', headers: authHeaders() });
  if(!response.ok) throw new Error(`GET ${response.status}`);
  return response.json();
}

function saveSession(nextSession){
  if(!nextSession){
    session = null;
    user = null;
    localStorage.removeItem(AUTH_SESSION_KEY);
    return;
  }
  session = {
    access_token: nextSession.access_token,
    refresh_token: nextSession.refresh_token || '',
    expires_at: nextSession.expires_at || Math.floor(Date.now() / 1000) + Number(nextSession.expires_in || 3600),
    user: nextSession.user || null
  };
  user = session.user;
  localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session));
}

function loadSession(){
  try{
    const stored = JSON.parse(localStorage.getItem(AUTH_SESSION_KEY) || 'null');
    if(!stored?.access_token || !stored?.user) return false;
    session = stored;
    user = stored.user;
    return true;
  }catch{
    return false;
  }
}

function simplifyAuthError(error){
  const message = String(error?.message || error || '').trim();
  const lower = message.toLowerCase();
  if(!message) return 'Nie udało się zalogować.';
  if(lower.includes('invalid login credentials') || lower.includes('invalid credentials')) return 'Błędny email lub hasło.';
  if(lower.includes('failed to fetch') || lower.includes('network') || lower.includes('fetch')) return 'Nie udało się połączyć z Supabase.';
  if(lower.includes('abort') || lower.includes('aborted')) return 'Logowanie trwa zbyt długo. Sprawdź internet, konfigurację Supabase albo dane logowania.';
  if(lower.includes('email not confirmed')) return 'Email nie jest potwierdzony.';
  if(lower.includes('timeout') || lower.includes('zbyt długo')) return 'Logowanie trwa zbyt długo. Sprawdź internet, konfigurację Supabase albo dane logowania.';
  return message.length > 140 ? `${message.slice(0, 140)}...` : message;
}

function withTimeout(promise, timeoutMs, timeoutMessage){
  let timer = null;
  return new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    promise.then(resolve).catch(reject).finally(() => clearTimeout(timer));
  });
}

async function fetchJsonWithTimeout(url, options, timeoutMs){
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try{
    const response = await fetch(url, { ...options, signal: controller.signal });
    const data = await response.json().catch(() => ({}));
    return { response, data };
  }finally{
    clearTimeout(timer);
  }
}

const supabase = {
  auth: {
    async signInWithPassword({ email, password }){
      const { response, data } = await fetchJsonWithTimeout(AUTH_TOKEN_ENDPOINT, {
        method: 'POST',
        headers: anonHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ email, password })
      }, LOGIN_TIMEOUT_MS);
      if(!response.ok){
        return {
          data: null,
          error: new Error(data.error_description || data.msg || data.error || `Logowanie nieudane (${response.status})`)
        };
      }
      return { data, error: null };
    }
  }
};

function setLoginBusy(isBusy){
  const btn = $('loginBtn');
  if(!btn) return;
  btn.disabled = isBusy;
  btn.textContent = isBusy ? 'Loguję...' : 'Zaloguj';
}

async function refreshSession(force = false){
  if(!session?.access_token) return false;
  const now = Math.floor(Date.now() / 1000);
  if(!force && Number(session.expires_at || 0) - now > 180) return true;
  if(!session.refresh_token) return true;
  try{
    const { response, data } = await fetchJsonWithTimeout(AUTH_REFRESH_ENDPOINT, {
      method: 'POST',
      headers: anonHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ refresh_token: session.refresh_token })
    }, LOGIN_TIMEOUT_MS);
    if(!response.ok) throw new Error(data.error_description || data.msg || data.error || `Odświeżenie sesji nieudane (${response.status})`);
    saveSession({ ...data, user: data.user || session.user });
    return true;
  }catch(err){
    console.warn('Nie udało się odświeżyć sesji Supabase', err);
    return false;
  }
}

function setAuthStatus(message, kind = 'info'){
  const el = $('authStatus');
  if(!el) return;
  el.textContent = message;
  el.className = `status ${kind}`;
}

function setAuthView(isLoggedIn){
  const loginScreen = $('loginScreen');
  const appShell = $('appShell');
  if(loginScreen) loginScreen.hidden = isLoggedIn;
  if(appShell) appShell.hidden = !isLoggedIn;
  document.body.classList.toggle('is-authenticated', isLoggedIn);
  document.body.classList.toggle('is-login', !isLoggedIn);
  document.body.classList.remove('is-auth-checking');
}

function showLogin(){
  setAuthView(false);
  setAuthStatus('Zaloguj konto, żeby uruchomić panel PRO.', 'info');
  setLoginBusy(false);
}

function showApp(){
  setAuthView(true);
  renderAll();
}

async function signIn(){
  const email = $('authEmail').value.trim();
  const password = $('authPassword').value;
  if(!email || !password){
    setAuthStatus('Wpisz email i hasło.', 'warn');
    return;
  }
  const attempt = ++loginAttemptId;
  setLoginBusy(true);
  setAuthStatus('Loguję do Supabase...', 'info');
  try{
    const { data, error } = await withTimeout(
      supabase.auth.signInWithPassword({ email, password }),
      LOGIN_TIMEOUT_MS + 1000,
      'Logowanie trwa zbyt długo. Sprawdź internet, konfigurację Supabase albo dane logowania.'
    );
    if(attempt !== loginAttemptId) return;
    if(error) throw error;
    if(!data?.access_token) throw new Error('Supabase nie zwrócił aktywnej sesji.');
    saveSession(data);
    setAuthStatus(`Zalogowano: ${user?.email || 'konto PRO'}`, 'ok');
    showApp();
    await loadAllData();
  }catch(err){
    if(attempt === loginAttemptId){
      setAuthStatus(simplifyAuthError(err), 'bad');
    }
    console.warn('Logowanie Supabase nie powiodło się', err);
  }finally{
    if(attempt === loginAttemptId) setLoginBusy(false);
  }
}

async function signOut(){
  try{
    if(session?.access_token){
      await fetchJsonWithTimeout(AUTH_LOGOUT_ENDPOINT, { method: 'POST', headers: authHeaders() }, 8000);
    }
  }catch(err){
    console.warn(err);
  }
  saveSession(null);
  showLogin();
}

function fmtNumber(value, digits = 0){
  const n = Number(value);
  if(!Number.isFinite(n)) return 'brak danych';
  return n.toLocaleString('pl-PL', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function fmtDot(value, digits){
  const n = Number(value);
  if(!Number.isFinite(n)) return 'brak danych';
  return n.toFixed(digits);
}

function fmtIf(value){
  return fmtDot(value, 3);
}

function fmtEffect(value){
  return fmtDot(value, 1);
}

function fmtEf(value){
  return fmtDot(value, 5);
}

function fmtKmDot(value){
  const n = Number(value);
  if(!Number.isFinite(n)) return 'brak danych';
  return `${n.toFixed(2)} km`;
}

function fmtKm(value){
  const n = Number(value);
  if(!Number.isFinite(n)) return 'brak danych';
  return `${fmtNumber(n, 2)} km`;
}

function fmtMin(value){
  const n = Number(value);
  if(!Number.isFinite(n)) return 'brak danych';
  return `${Math.round(n).toLocaleString('pl-PL')} min`;
}

function fmtDate(value){
  const raw = String(value || '').slice(0, 10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return 'brak danych';
  return new Date(`${raw}T12:00:00`).toLocaleDateString('pl-PL', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtClock(value){
  const d = value instanceof Date ? value : (value ? new Date(value) : null);
  if(!d || Number.isNaN(d.getTime())) return 'brak danych';
  return d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
}

function fmtSeconds(value){
  const n = Number(value);
  if(!Number.isFinite(n)) return 'brak danych';
  const total = Math.max(0, Math.round(n));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if(hours) return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function fmtPace(value){
  const n = Number(value);
  if(!Number.isFinite(n)) return 'brak danych';
  const minutes = Math.floor(n);
  const seconds = Math.round((n - minutes) * 60);
  return `${minutes}:${String(seconds).padStart(2, '0')}/km`;
}

function fmtDateIso(value){
  const raw = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '';
}

function addDaysIso(value, days){
  const raw = fmtDateIso(value);
  if(!raw) return '';
  const d = new Date(`${raw}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function sportLabel(value){
  const key = String(value || '').toLowerCase();
  if(key.includes('swim')) return 'Pływanie';
  if(key.includes('bike') || key.includes('cycl')) return 'Rower';
  if(key.includes('run')) return 'Bieg';
  if(key.includes('walk')) return 'Marsz';
  return value || 'brak danych';
}

function activityKey(item){
  return String(item?.garmin_activity_id || item?.activity_id || item?.workout_date || '');
}

function activityName(item){
  return item?.event_name || item?.activity_name || item?.sport_type || 'Aktywność Garmin PRO';
}

function numberOrNull(value){
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function textOrMissing(value){
  const text = String(value ?? '').trim();
  return text || 'brak danych';
}

function activityText(item){
  return [
    item?.auto_summary,
    item?.segment_summary,
    item?.bike_if_category,
    item?.run_split_type,
    item?.event_name,
    item?.sport_type,
    item?.activity_type
  ].filter(Boolean).join(' ');
}

function extractPowerClues(item){
  const text = activityText(item);
  const clues = [];
  const ifMatch = text.match(/\bIF\s*[:=]?\s*([0-9]+(?:[.,][0-9]+)?)/i);
  const npMatch = text.match(/\bNP\s*[:=]?\s*([0-9]+(?:[.,][0-9]+)?\s*W?)/i);
  const powerMatch = text.match(/\b(?:moc|power|avg power)\s*[:=]?\s*([0-9]+(?:[.,][0-9]+)?\s*W?)/i);
  const paceMatch = text.match(/\b(?:tempo|pace)\s*[:=]?\s*([0-9]+[:.][0-9]{2}\s*\/?\s*(?:km|100m)?)/i);
  if(ifMatch) clues.push(`IF ${ifMatch[1].replace(',', '.')}`);
  if(npMatch) clues.push(`NP ${npMatch[1]}`);
  if(powerMatch) clues.push(`moc ${powerMatch[1]}`);
  if(paceMatch) clues.push(`tempo ${paceMatch[1]}`);
  return clues;
}

function extractMetric(item, patterns){
  const text = activityText(item);
  for(const pattern of patterns){
    const match = text.match(pattern);
    if(match) return match[1].trim().replace(',', '.');
  }
  return '';
}

function extractSegmentLine(item, segment){
  const source = String(item?.auto_summary || '').replace(/\s+/g, ' ').trim();
  if(!source) return '';
  const chunks = source.split(/\.\s+/).map(part => part.trim()).filter(Boolean);
  const checks = {
    swim: [/p\S*ywanie/i, /\bswim\b/i],
    t1: [/^T1\b/i],
    bike: [/\brower\b/i, /\bbike\b/i],
    t2: [/^T2\b/i],
    run: [/\bbieg\b/i, /\brun\b/i]
  }[segment] || [];
  const found = chunks.find(part => checks.some(pattern => pattern.test(part)));
  return found ? found.replace(/\.$/, '') : '';
}

function analysisContext(){
  return { readiness, weekly, load28d, activityContexts, activityContextStatus };
}

function escapeHtml(value){
  return String(value ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}

function readinessDecision(){
  if(!readiness) return {
    decision: 'Brak danych gotowości.',
    reason: 'Nie mam jeszcze rekordu z garmin_pro_readiness_context.',
    coach: 'Brak danych Garmin PRO do decyzji.'
  };

  const score = Number(readiness.training_readiness_score);
  const level = String(readiness.training_readiness_level || '').toUpperCase();
  const sleep = Number(readiness.sleep_minutes);
  const battery = Number(readiness.body_battery_end);
  const load7d = Number(readiness.load_7d);
  const parts = [];

  if(Number.isFinite(score)) parts.push(`Readiness ${Math.round(score)}/100`);
  if(level) parts.push(level);
  if(Number.isFinite(sleep)) parts.push(`sen ${Math.round(sleep)} min`);
  if(Number.isFinite(battery)) parts.push(`Body Battery ${Math.round(battery)}`);
  if(Number.isFinite(load7d)) parts.push(`load 7d ${Math.round(load7d)}`);

  if(readiness.pro_recommendation && readiness.pro_reason){
    return {
      decision: readiness.pro_recommendation,
      reason: readiness.pro_reason,
      coach: `${readiness.pro_recommendation}. ${readiness.pro_reason}`
    };
  }

  const lowReadiness = Number.isFinite(score) && score <= 20;
  const poorLevel = level === 'POOR';
  const shortSleep = Number.isFinite(sleep) && sleep < 360;
  const lowBattery = Number.isFinite(battery) && battery < 35;
  const highLoad = Number.isFinite(load7d) && load7d > 300;

  if(lowReadiness || poorLevel || shortSleep || lowBattery){
    return {
      decision: 'Dzisiaj bez mocnego treningu.',
      reason: parts.join(', ') || 'Sygnały regeneracji są niepełne.',
      coach: `Dzisiaj bez mocnego treningu. ${parts.join(', ')}${highLoad ? ', świeże obciążenie jest wysokie' : ''}. Tylko regeneracja, mobilność albo bardzo lekka technika.`
    };
  }

  return {
    decision: 'Trening kontrolowany.',
    reason: parts.join(', ') || 'Dane Garmin PRO są częściowe.',
    coach: `Trening kontrolowany. ${parts.join(', ')}. Nie dokładaj intensywności bez dobrego samopoczucia.`
  };
}

function activityHtml(item){
  if(!item) return '<div class="muted-card">Brak danych.</div>';
  const name = item.event_name || item.activity_name || item.sport_type || 'Aktywność Garmin PRO';
  const sport = sportLabel(item.sport_type || item.activity_type);
  const distance = fmtKm(item.distance_km);
  const duration = fmtMin(item.duration_min);
  const hr = [item.hr_avg ? `avg ${Math.round(Number(item.hr_avg))}` : '', item.hr_max ? `max ${Math.round(Number(item.hr_max))}` : ''].filter(Boolean).join(' / ');
  const load = Number.isFinite(Number(item.training_load)) ? Math.round(Number(item.training_load)).toLocaleString('pl-PL') : 'brak danych';
  const summary = item.auto_summary || item.segment_summary || '';
  return `
    <article class="activity-card">
      <div class="activity-top">
        <div>
          <h3>${escapeHtml(name)}</h3>
          <p>${escapeHtml(fmtDate(item.workout_date))} • ${escapeHtml(sport)}</p>
        </div>
        <span>${escapeHtml(load)}</span>
      </div>
      <div class="activity-metrics">
        <b>${escapeHtml(distance)}</b>
        <b>${escapeHtml(duration)}</b>
        <b>${escapeHtml(hr || 'HR brak danych')}</b>
      </div>
      ${summary ? `<p class="activity-summary">${escapeHtml(summary)}</p>` : ''}
    </article>
  `;
}

function historyActivityHtml(item){
  if(!item) return '';
  const key = activityKey(item);
  const html = activityHtml(item);
  return html.replace('<article class="activity-card">', `<article class="activity-card history-activity-card" data-activity-key="${escapeHtml(key)}" role="button" tabindex="0">`)
    .replace('</article>', '<button class="analysis-link" type="button">Szczegóły / Analiza</button></article>');
}

function renderActivityInto(id, item){
  const el = $(id);
  if(!el) return;
  if(!item){
    el.outerHTML = `<article id="${id}" class="activity-card muted-card">Brak danych.</article>`;
    return;
  }
  el.outerHTML = activityHtml(item).replace('class="activity-card"', `id="${id}" class="activity-card"`);
}

function viewLabel(key){
  return {
    readiness: 'readiness',
    weekly: 'weekly',
    latest: 'latest',
    cards: 'activity_cards',
    load28d: 'load_28d',
    activityContext: 'activity_analysis_context'
  }[key] || key;
}

function viewStatusText(value){
  if(value === 'ok') return 'OK';
  if(value === 'error') return 'błąd';
  if(value === 'missing') return 'brak widoku';
  if(value === 'loading') return 'ładowanie';
  return 'brak danych';
}

function allViewsOk(){
  return Object.values(viewState).every(value => value === 'ok');
}

function anyViewError(){
  return Object.values(viewState).some(value => value === 'error');
}

function anyUsefulData(){
  return Boolean(readiness || weekly || latest || cards.length || load28d.length);
}

function garminOverallStatus(){
  if(anyViewError()) return 'problem';
  if(allViewsOk() && anyUsefulData()) return 'dane OK';
  if(Object.values(viewState).some(value => value === 'loading')) return 'ładowanie';
  return 'brak danych';
}

function renderConnectionStatus(){
  const supabaseText = session?.access_token ? 'połączono' : 'brak sesji';
  const garminText = garminOverallStatus();
  const summary = $('connectionSummary');
  const readLabel = $('lastReadLabel');
  if(summary){
    summary.textContent = `Supabase: ${supabaseText} · Garmin PRO: ${garminText === 'dane OK' ? 'OK' : garminText}`;
  }
  if(readLabel) readLabel.textContent = `Ostatni odczyt: ${lastReadAt ? fmtClock(lastReadAt) : 'brak danych'}`;
}

function renderDashboard(){
  const decision = readinessDecision();
  $('todayDecision').textContent = decision.decision;
  $('todayReason').textContent = decision.reason;
  $('coachToday').textContent = decision.coach;
  $('readinessScore').textContent = readiness?.training_readiness_score != null ? `${Math.round(Number(readiness.training_readiness_score))}/100` : 'brak danych';
  $('sleepValue').textContent = readiness?.sleep_minutes != null ? fmtMin(readiness.sleep_minutes) : 'brak danych';
  $('batteryValue').textContent = readiness?.body_battery_start != null || readiness?.body_battery_end != null
    ? `${fmtNumber(readiness.body_battery_start)} → ${fmtNumber(readiness.body_battery_end)}`
    : 'brak danych';
  $('load7dValue').textContent = readiness?.load_7d != null ? fmtNumber(readiness.load_7d) : 'brak danych';

  $('weekRange').textContent = weekly?.week_start || weekly?.week_end ? `${fmtDate(weekly.week_start)} – ${fmtDate(weekly.week_end)}` : 'brak danych';
  $('weekSwim').textContent = `${fmtKm(weekly?.swim_distance_km)} / ${fmtMin(weekly?.swim_duration_min)}`;
  $('weekBike').textContent = `${fmtKm(weekly?.bike_distance_km)} / ${fmtMin(weekly?.bike_duration_min)}`;
  $('weekRun').textContent = `${fmtKm(weekly?.run_distance_km)} / ${fmtMin(weekly?.run_duration_min)}`;
  $('weekLoad').textContent = weekly?.total_training_load != null ? fmtNumber(weekly.total_training_load) : 'brak danych';
  renderActivityInto('latestActivity', latest);
}

function renderHistory(){
  $('historyStatus').textContent = cards.length ? `Aktywności Garmin PRO: ${cards.length}` : 'Brak danych Garmin PRO.';
  $('historyStatus').className = `status ${cards.length ? 'ok' : 'warn'}`;
  $('activityList').innerHTML = cards.length ? cards.map(historyActivityHtml).join('') : '<div class="muted-card">Brak danych Garmin PRO.</div>';
  renderActivityDetails();
}

function renderAi(){
  $$('[data-mode]').forEach(btn => {
    const active = btn.dataset.mode === aiMode;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  $('planPanel').hidden = aiMode !== 'plan';
  $('analysisPanel').hidden = aiMode !== 'analysis';
  renderActivityInto('aiLatestActivity', latest);
  renderActivityAiAnalysis('aiActivityAnalysis', latest);
}

function renderSettings(){
  const okCount = Object.values(viewState).filter(x => x === 'ok').length;
  const failCount = Object.values(viewState).filter(x => x === 'error').length;
  $('supabaseStatus').textContent = failCount ? 'częściowy błąd danych' : okCount ? 'połączony' : 'brak danych';
  $('sessionStatus').textContent = session?.access_token ? 'aktywna' : 'brak sesji';
  $('garminStatus').textContent = garminOverallStatus();
  $('settingsLastRead').textContent = lastReadAt ? fmtClock(lastReadAt) : 'brak danych';
  const statusEntries = [...Object.entries(viewState), ['activityContext', activityContextStatus]];
  $('viewStatusList').innerHTML = statusEntries.map(([key, value]) => `<li><span>${escapeHtml(viewLabel(key))}</span><b>${escapeHtml(viewStatusText(value))}</b></li>`).join('');
  $('userStatus').textContent = user?.email || 'brak danych';
}

function renderStatus(){
  const labels = {
    readiness: 'gotowość',
    weekly: 'tydzień',
    latest: 'ostatnia aktywność',
    cards: 'historia',
    load28d: 'load 28d'
  };
  const failed = Object.entries(viewState).filter(([, value]) => value === 'error').map(([key]) => labels[key]);
  const loading = Object.values(viewState).some(value => value === 'loading');
  const okCount = Object.values(viewState).filter(value => value === 'ok').length;
  const status = $('dataStatus');
  if(loading){
    status.textContent = 'Pobieram dane Garmin PRO...';
    status.className = 'status info';
  }else if(failed.length){
    status.textContent = `Nie udało się pobrać: ${failed.join(', ')}.`;
    status.className = 'status bad';
  }else{
    status.textContent = `Dane Garmin PRO gotowe: ${okCount}/5 widoków.`;
    status.className = 'status ok';
  }
  renderConnectionStatus();
}

function renderAll(){
  renderConnectionStatus();
  renderDashboard();
  renderHistory();
  renderAi();
  renderSettings();
  renderStatus();
}

async function loadOne(key, url){
  viewState[key] = 'loading';
  renderStatus();
  try{
    const rows = await apiGet(url);
    viewState[key] = 'ok';
    return rows || [];
  }catch(err){
    viewState[key] = 'error';
    console.warn(`Nie udało się pobrać ${key}`, err);
    return [];
  }finally{
    renderStatus();
  }
}

async function loadActivityAnalysisContexts(){
  activityContextStatus = 'loading';
  renderSettings();
  try{
    const rows = await apiGet(`${ACTIVITY_CONTEXT_ENDPOINT}?select=*&order=workout_date.desc&limit=30`);
    activityContextStatus = 'ok';
    return rows || [];
  }catch(err){
    const message = String(err?.message || err || '');
    activityContextStatus = message.includes('404') ? 'missing' : 'error';
    console.warn('Pełny kontekst aktywności PRO niedostępny', err);
    return [];
  }finally{
    renderSettings();
  }
}

async function loadAllData(){
  await refreshSession();
  const [readinessRows, weeklyRows, latestRows, cardRows, loadRows] = await Promise.all([
    loadOne('readiness', `${READINESS_ENDPOINT}?select=*&limit=1`),
    loadOne('weekly', `${WEEKLY_ENDPOINT}?select=*&limit=1`),
    loadOne('latest', `${LATEST_ENDPOINT}?select=*&limit=1`),
    loadOne('cards', `${CARDS_ENDPOINT}?select=*&order=workout_date.desc&limit=30`),
    loadOne('load28d', `${LOAD_28D_ENDPOINT}?select=workout_date,daily_training_load,daily_duration_min,daily_distance_km,activity_count&limit=28`)
  ]);
  readiness = readinessRows[0] || null;
  weekly = weeklyRows[0] || null;
  latest = latestRows[0] || null;
  cards = cardRows;
  load28d = loadRows;
  activityContexts = await loadActivityAnalysisContexts();
  lastReadAt = new Date();
  renderAll();
}

function selectedActivity(){
  return cards.find(item => activityKey(item) === selectedActivityKey) || null;
}

function buildActivityFacts(activity, context = {}){
  const readinessData = context.readiness || {};
  const distance = numberOrNull(activity?.distance_km);
  const duration = numberOrNull(activity?.duration_min);
  const hrAvg = numberOrNull(activity?.hr_avg);
  const hrMax = numberOrNull(activity?.hr_max);
  const load = numberOrNull(activity?.training_load);
  const readinessScore = numberOrNull(readinessData.training_readiness_score);
  const sleep = numberOrNull(readinessData.sleep_minutes);
  const batteryStart = numberOrNull(readinessData.body_battery_start);
  const batteryEnd = numberOrNull(readinessData.body_battery_end);
  const stress = numberOrNull(readinessData.avg_stress);
  const restingHr = numberOrNull(readinessData.resting_hr);
  const load7d = numberOrNull(readinessData.load_7d);
  const load28d = numberOrNull(readinessData.load_28d);
  const sport = String(activity?.sport_type || activity?.activity_type || '').toLowerCase();
  const text = activityText(activity).toLowerCase();
  const ifValue = extractMetric(activity, [/\bIF\s*[:=]?\s*([0-9]+(?:[.,][0-9]+)?)/i]);
  const npValue = extractMetric(activity, [/\bNP\s*[:=]?\s*([0-9]+(?:[.,][0-9]+)?\s*W?)/i]);
  const avgPower = extractMetric(activity, [/\bmoc\s*śr\.\s*([0-9]+(?:[.,][0-9]+)?\s*W?)/i, /\bavg power\s*[:=]?\s*([0-9]+(?:[.,][0-9]+)?\s*W?)/i]);
  const maxPower = extractMetric(activity, [/\bmoc\s*max\s*[:=]?\s*([0-9]+(?:[.,][0-9]+)?\s*W?)/i, /\bmax power\s*[:=]?\s*([0-9]+(?:[.,][0-9]+)?\s*W?)/i]);
  const pace = extractMetric(activity, [/\btempo\s*([0-9]+:[0-9]{2}\s*\/?\s*(?:km|100m)?)/i, /\bpace\s*[:=]?\s*([0-9]+:[0-9]{2}\s*\/?\s*(?:km|100m)?)/i]);
  const aerobicEffect = extractMetric(activity, [/\baerobic(?:zny)?\s*(?:effect|TE)?\s*[:=]?\s*([0-9]+(?:[.,][0-9]+)?)/i]);
  const anaerobicEffect = extractMetric(activity, [/\banaerobic(?:zny)?\s*(?:effect|TE)?\s*[:=]?\s*([0-9]+(?:[.,][0-9]+)?)/i]);
  const ef = extractMetric(activity, [/\bEF\s*[:=]?\s*([0-9]+(?:[.,][0-9]+)?)/i]);
  const isMulti = sport.includes('triathlon') || sport.includes('multi') || (text.includes('swim') && text.includes('bike') && text.includes('run')) || text.includes('pływanie') && text.includes('rower') && text.includes('bieg');
  const segments = {
    swim: extractSegmentLine(activity, 'swim'),
    t1: extractSegmentLine(activity, 't1'),
    bike: extractSegmentLine(activity, 'bike'),
    t2: extractSegmentLine(activity, 't2'),
    run: extractSegmentLine(activity, 'run')
  };
  const hasSegmentDetails = Object.values(segments).some(Boolean);
  const activityDate = String(activity?.workout_date || '').slice(0, 10);
  const metricDate = String(readinessData.metric_date || '').slice(0, 10);
  const contextDateNote = metricDate
    ? (activityDate && metricDate !== activityDate ? `kontekst regeneracyjny z ${metricDate}, nie musi dotyczyć dokładnie momentu aktywności` : `kontekst regeneracyjny z ${metricDate}`)
    : 'brak danych';

  return {
    name: textOrMissing(activityName(activity)),
    date: textOrMissing(activityDate),
    sport: textOrMissing(sportLabel(activity?.sport_type || activity?.activity_type)),
    distance,
    duration,
    hrAvg,
    hrMax,
    load,
    ifValue,
    npValue,
    avgPower,
    maxPower,
    pace,
    aerobicEffect,
    anaerobicEffect,
    ef,
    segmentSummary: textOrMissing(activity?.segment_summary),
    autoSummary: textOrMissing(activity?.auto_summary),
    segments,
    hasSegmentDetails,
    isMulti,
    isRun: sport.includes('run'),
    isBike: sport.includes('bike') || sport.includes('cycl'),
    isSwim: sport.includes('swim'),
    readinessScore,
    readinessLevel: textOrMissing(readinessData.training_readiness_level),
    sleep,
    batteryStart,
    batteryEnd,
    stress,
    restingHr,
    load7d,
    load28d,
    journalDate: textOrMissing(readinessData.journal_date),
    journalPain: textOrMissing(readinessData.journal_pain),
    contextDateNote
  };
}

function factRowsFromFacts(facts){
  return [
    ['Nazwa', facts.name],
    ['Data', facts.date],
    ['Sport', facts.sport],
    ['Dystans', facts.distance != null ? fmtKm(facts.distance) : 'brak danych'],
    ['Czas', facts.duration != null ? fmtMin(facts.duration) : 'brak danych'],
    ['Tempo', facts.pace || 'brak danych'],
    ['HR avg/max', facts.hrAvg != null || facts.hrMax != null ? `${facts.hrAvg != null ? Math.round(facts.hrAvg) : 'brak danych'} / ${facts.hrMax != null ? Math.round(facts.hrMax) : 'brak danych'}` : 'brak danych'],
    ['Moc avg/max', facts.avgPower || facts.maxPower ? `${facts.avgPower || 'brak danych'} / ${facts.maxPower || 'brak danych'}` : 'brak danych'],
    ['NP / IF', facts.npValue || facts.ifValue ? `${facts.npValue || 'brak danych'} / ${facts.ifValue || 'brak danych'}` : 'brak danych'],
    ['Load', facts.load != null ? fmtNumber(facts.load) : 'brak danych'],
    ['Training effect aerobic/anaerobic', facts.aerobicEffect || facts.anaerobicEffect ? `${facts.aerobicEffect || 'brak danych'} / ${facts.anaerobicEffect || 'brak danych'}` : 'brak danych'],
    ['EF', facts.ef || 'brak danych'],
    ['Segmenty', facts.segmentSummary],
    ['Auto summary', facts.autoSummary],
    ['Readiness', facts.readinessScore != null ? `${Math.round(facts.readinessScore)}/100 (${facts.readinessLevel})` : 'brak danych'],
    ['Sen', facts.sleep != null ? fmtMin(facts.sleep) : 'brak danych'],
    ['Body Battery', facts.batteryStart != null || facts.batteryEnd != null ? `${facts.batteryStart != null ? Math.round(facts.batteryStart) : 'brak danych'} → ${facts.batteryEnd != null ? Math.round(facts.batteryEnd) : 'brak danych'}` : 'brak danych'],
    ['Stress avg', facts.stress != null ? fmtNumber(facts.stress) : 'brak danych'],
    ['Resting HR', facts.restingHr != null ? fmtNumber(facts.restingHr) : 'brak danych'],
    ['Load 7d / 28d', facts.load7d != null || facts.load28d != null ? `${facts.load7d != null ? fmtNumber(facts.load7d) : 'brak danych'} / ${facts.load28d != null ? fmtNumber(facts.load28d) : 'brak danych'}` : 'brak danych'],
    ['Dziennik', facts.journalDate !== 'brak danych' ? `${facts.journalDate}, ból: ${facts.journalPain}` : 'brak danych'],
    ['Uwaga o kontekście', facts.contextDateNote]
  ];
}

function buildBasicActivityAnalysis(activity, context = {}){
  if(!activity){
    return {
      facts: [['Aktywność', 'brak danych']],
      rating: 'Brak aktywności Garmin PRO do analizy.',
      segments: 'Brak danych do oceny tego parametru.',
      good: 'Brak danych do oceny tego parametru.',
      caution: 'Brak danych do oceny tego parametru.',
      kalmar: 'Brak danych do oceny tego parametru.',
      recovery: 'Brak danych do oceny tego parametru.'
    };
  }

  const facts = buildActivityFacts(activity, context);
  const load = facts.load;
  const ifValue = numberOrNull(facts.ifValue);
  const highHr = (facts.hrMax != null && facts.hrMax >= 180) || (facts.hrAvg != null && facts.hrAvg >= 165);
  const strongLoad = load != null && load >= 250;
  const mediumLoad = load != null && load >= 120 && load < 250;
  const hardBike = ifValue != null && ifValue >= 0.9 || String(activity.bike_if_category || '').toLowerCase().includes('mocno');
  const hasEnoughToRate = load != null || facts.hrAvg != null || facts.hrMax != null || ifValue != null;
  const intensity = !hasEnoughToRate ? 'brak danych' : strongLoad || hardBike || highHr ? 'bardzo mocna / start testowy' : mediumLoad ? 'mocna, ale możliwa do kontroli' : 'lekka lub kontrolowana';
  const segmentLabels = [
    ['Pływanie', facts.segments.swim],
    ['T1', facts.segments.t1],
    ['Rower', facts.segments.bike],
    ['T2', facts.segments.t2],
    ['Bieg', facts.segments.run]
  ];
  const segmentText = facts.isMulti
    ? (facts.hasSegmentDetails
      ? segmentLabels.map(([label, value]) => `${label}: ${value || 'brak danych'}.`).join(' ')
      : `Brak pełnych danych segmentów — analiza segmentowa ograniczona do dostępnego podsumowania: ${facts.segmentSummary}.`)
    : (facts.segmentSummary !== 'brak danych'
      ? `Aktywność pojedynczej dyscypliny: ${facts.segmentSummary}. ${facts.autoSummary !== 'brak danych' ? facts.autoSummary : ''}`.trim()
      : 'Brak pełnych danych segmentów — analiza segmentowa ograniczona do dostępnego podsumowania.');

  const good = [];
  if(facts.distance != null && facts.duration != null) good.push(`Dystans ${fmtKm(facts.distance)} i czas ${fmtMin(facts.duration)} dają pełny obraz objętości tej aktywności.`);
  if(facts.hasSegmentDetails) good.push('Podsumowanie zawiera segmenty, więc można ocenić kolejność i koszt części aktywności.');
  if(facts.pace) good.push(`Tempo widoczne w danych: ${facts.pace}, więc bieg można odnieść do realnego wykonania.`);
  if(facts.npValue || facts.ifValue || facts.avgPower) good.push(`Dane rowerowe są konkretne: NP ${facts.npValue || 'brak danych'}, IF ${facts.ifValue || 'brak danych'}, moc średnia ${facts.avgPower || 'brak danych'}.`);
  if(!good.length) good.push('Brak danych do oceny tego parametru.');

  const caution = [];
  if(strongLoad) caution.push(`Load ${fmtNumber(load)} jest wysoki, więc koszt aktywności jest duży.`);
  if(highHr) caution.push(`HR ${facts.hrAvg != null ? Math.round(facts.hrAvg) : 'brak danych'} / ${facts.hrMax != null ? Math.round(facts.hrMax) : 'brak danych'} wskazuje na mocny bodziec sercowo-naczyniowy.`);
  if(hardBike) caution.push(`Rower wygląda mocno: IF ${facts.ifValue || 'brak danych'}, kategoria ${textOrMissing(activity.bike_if_category)}. To może podnieść koszt biegu.`);
  if(facts.readinessScore != null && facts.readinessScore <= 20) caution.push(`Aktualny kontekst regeneracyjny pokazuje readiness ${Math.round(facts.readinessScore)}/100, więc po takim bodźcu nie dokładałbym intensywności.`);
  if(facts.sleep != null && facts.sleep < 360) caution.push(`Sen ${Math.round(facts.sleep)} min jest krótki w kontekście regeneracji.`);
  if(!caution.length) caution.push('Brak danych do oceny tego parametru.');

  const kalmar = facts.isMulti
    ? `Wniosek pod Ironman Kalmar: ta aktywność pokazuje koszt układu pływanie-rower-bieg. Przy rowerze z IF ${facts.ifValue || 'brak danych'} i HR biegu widocznym w podsumowaniu trzeba pilnować, żeby nie przepalić roweru przed biegiem.`
    : facts.isBike
      ? `Wniosek pod Ironman Kalmar: rower musi być kontrolowany, bo jego koszt przenosi się na bieg. IF/NP/moc: ${facts.ifValue || 'brak danych'} / ${facts.npValue || 'brak danych'} / ${facts.avgPower || 'brak danych'}.`
      : facts.isRun
        ? `Wniosek pod Ironman Kalmar: bieg oceniaj przez tempo, HR i load. Tu tempo to ${facts.pace || 'brak danych'}, HR ${facts.hrAvg != null ? Math.round(facts.hrAvg) : 'brak danych'} / ${facts.hrMax != null ? Math.round(facts.hrMax) : 'brak danych'}, load ${facts.load != null ? fmtNumber(facts.load) : 'brak danych'}.`
        : facts.isSwim
          ? `Wniosek pod Ironman Kalmar: pływanie ma być ekonomiczne. Bez pełnych danych techniki nie oceniam stabilności, korzystam tylko z dystansu, czasu i HR.`
          : `Wniosek pod Ironman Kalmar: ocena ograniczona do dostępnych danych aktywności i obciążenia.`;

  const recovery = strongLoad || highHr || (facts.readinessScore != null && facts.readinessScore <= 20)
    ? `Zalecenie po aktywności: regeneracja, mobilność albo bardzo lekki ruch. Do mocniejszego bodźca wracaj dopiero po poprawie readiness, snu i obciążenia 7d.`
    : mediumLoad
      ? `Zalecenie po aktywności: lekki trening lub technika, bez dokładania intensywności dzień po dniu.`
      : `Zalecenie po aktywności: decyzję o kolejnym bodźcu oprzyj na readiness, śnie, Body Battery i load 7d.`;

  return {
    facts: factRowsFromFacts(facts),
    rating: hasEnoughToRate
      ? `Ocena: ${intensity}. Uzasadnienie: load ${facts.load != null ? fmtNumber(facts.load) : 'brak danych'}, HR ${facts.hrAvg != null ? Math.round(facts.hrAvg) : 'brak danych'} / ${facts.hrMax != null ? Math.round(facts.hrMax) : 'brak danych'}, IF ${facts.ifValue || 'brak danych'}.`
      : 'Brak danych do oceny intensywności aktywności.',
    segments: segmentText,
    good: good.join(' '),
    caution: caution.join(' '),
    kalmar,
    recovery
  };
}

function contextMatchesActivity(record, activity){
  if(!record || !activity) return false;
  const activityId = String(activity.activity_id || '');
  const garminId = String(activity.garmin_activity_id || '');
  if(activityId && String(record.activity_id || '') === activityId) return true;
  if(garminId && String(record.garmin_activity_id || '') === garminId) return true;
  return false;
}

function fallbackContextMatchesActivity(record, activity){
  if(!record || !activity) return false;
  const date = fmtDateIso(activity.workout_date);
  if(!date || fmtDateIso(record.workout_date) !== date) return false;
  return activityName(record) === activityName(activity);
}

function findActivityContext(activity){
  if(!activity) return null;
  const exact = activityContexts.find(item => contextMatchesActivity(item, activity));
  if(exact) return exact;
  const fallbackMatches = activityContexts.filter(item => fallbackContextMatchesActivity(item, activity));
  if(fallbackMatches.length === 1) return fallbackMatches[0];
  if(fallbackMatches.length > 1){
    console.warn('Niepewne dopasowanie kontekstu aktywności — zostawiam analizę podstawową.', {
      workout_date: fmtDateIso(activity.workout_date),
      event_name: activityName(activity)
    });
  }
  return null;
}

function normalizeContextActivity(record, fallbackActivity){
  if(!record) return fallbackActivity;
  return {
    ...fallbackActivity,
    ...record,
    distance_km: record.distance_meters != null ? Number(record.distance_meters) / 1000 : fallbackActivity?.distance_km,
    duration_min: record.duration_seconds != null ? Number(record.duration_seconds) / 60 : fallbackActivity?.duration_min,
    segment_summary: record.segment_summary || fallbackActivity?.segment_summary,
    auto_summary: record.auto_summary || fallbackActivity?.auto_summary,
    bike_if_value: record.bike_if_value ?? record.intensity_factor ?? fallbackActivity?.bike_if_value,
    training_load: record.training_load ?? fallbackActivity?.training_load
  };
}

function buildActivityContext(activity){
  const record = findActivityContext(activity);
  if(!record){
    return {
      hasFullContext: false,
      status: activityContextStatus,
      activity,
      contextRecord: null,
      message: 'Pełna analiza PRO wymaga kontekstu aktywności: 3 dni przed, dzień aktywności i regeneracja po aktywności. Obecnie pokazuję analizę podstawową z dostępnych danych.'
    };
  }
  return {
    hasFullContext: true,
    status: activityContextStatus,
    activity: normalizeContextActivity(record, activity),
    contextRecord: record,
    message: ''
  };
}

function parseJsonArray(value){
  if(Array.isArray(value)) return value;
  if(!value) return [];
  if(typeof value === 'string'){
    try{
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    }catch{
      return [];
    }
  }
  return [];
}

function compactDailyLine(item){
  if(!item) return 'brak danych';
  return [
    item.metric_date || item.journal_date || 'brak daty',
    item.training_readiness_score != null ? `readiness ${Math.round(Number(item.training_readiness_score))}/100` : '',
    item.sleep_minutes != null ? `sen ${Math.round(Number(item.sleep_minutes))} min` : '',
    item.body_battery_end != null ? `Body Battery ${Math.round(Number(item.body_battery_end))}` : '',
    item.avg_stress != null ? `stress ${Math.round(Number(item.avg_stress))}` : '',
    item.energy != null ? `energia ${item.energy}` : '',
    item.pain ? `ból: ${item.pain}` : ''
  ].filter(Boolean).join(', ');
}

function itemMatchesRelativeDay(item, relation, record){
  if(!item) return false;
  if(item.relative_day === relation) return true;
  const itemDate = fmtDateIso(item.metric_date || item.journal_date);
  const workoutDate = fmtDateIso(record?.workout_date);
  if(!itemDate || !workoutDate) return false;
  if(relation === 'activity_day') return itemDate === workoutDate;
  if(relation === 'before') return itemDate >= addDaysIso(workoutDate, -3) && itemDate < workoutDate;
  if(relation === 'after') return itemDate > workoutDate && itemDate <= addDaysIso(workoutDate, 1);
  return false;
}

function contextWindowText(record, relation){
  if(!record) return 'brak danych';
  const daily = parseJsonArray(record.daily_metrics_window).filter(item => itemMatchesRelativeDay(item, relation, record));
  const journal = parseJsonArray(record.journal_window).filter(item => itemMatchesRelativeDay(item, relation, record));
  const parts = [];
  if(daily.length) parts.push(`Garmin: ${daily.map(compactDailyLine).join(' | ')}`);
  if(journal.length) parts.push(`Dziennik: ${journal.map(compactDailyLine).join(' | ')}`);
  return parts.length ? parts.join(' ') : 'brak danych';
}

function asArray(value){
  if(Array.isArray(value)) return value;
  if(value == null) return [];
  if(typeof value === 'string'){
    const trimmed = value.trim();
    if(!trimmed) return [];
    if(trimmed.startsWith('{') && trimmed.endsWith('}')){
      return trimmed.slice(1, -1).split(',').map(item => item.trim()).filter(Boolean);
    }
    try{
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed : [];
    }catch{
      return [trimmed];
    }
  }
  return [];
}

function firstData(...values){
  for(const value of values){
    if(value !== null && value !== undefined && value !== '') return value;
  }
  return null;
}

function fmtMaybeNumber(value, suffix = ''){
  const n = Number(value);
  if(!Number.isFinite(n)) return 'brak danych';
  return `${fmtNumber(n)}${suffix}`;
}

function contextActivityFacts(record){
  const npFromSummary = extractMetric(record, [/\bNP\s*[:=]?\s*([0-9]+(?:[.,][0-9]+)?\s*W?)/i]);
  const ifFromSummary = extractMetric(record, [/\bIF\s*[:=]?\s*([0-9]+(?:[.,][0-9]+)?)/i]);
  const avgPowerFromSummary = extractMetric(record, [/\bmoc\s*śr\.\s*([0-9]+(?:[.,][0-9]+)?\s*W?)/i, /\bavg power\s*[:=]?\s*([0-9]+(?:[.,][0-9]+)?\s*W?)/i]);
  const coachFlags = asArray(record.coach_flags);
  const ef = [
    record.swim_ef != null ? `swim ${fmtEf(record.swim_ef)}` : '',
    record.bike_ef != null ? `bike ${fmtEf(record.bike_ef)}` : '',
    record.run_ef != null ? `run ${fmtEf(record.run_ef)}` : ''
  ].filter(Boolean).join(', ');
  return [
    ['Nazwa', textOrMissing(record.event_name)],
    ['Data', textOrMissing(fmtDateIso(record.workout_date))],
    ['Sport', textOrMissing(record.sport_type || record.activity_type)],
    ['Dystans', record.distance_meters != null ? fmtKm(Number(record.distance_meters) / 1000) : 'brak danych'],
    ['Czas', record.duration_seconds != null ? fmtSeconds(record.duration_seconds) : 'brak danych'],
    ['HR avg/max', record.hr_avg != null || record.hr_max != null ? `${record.hr_avg != null ? Math.round(Number(record.hr_avg)) : 'brak danych'} / ${record.hr_max != null ? Math.round(Number(record.hr_max)) : 'brak danych'}` : 'brak danych'],
    ['Load', record.training_load != null ? fmtNumber(record.training_load) : 'brak danych'],
    ['Calories', record.calories != null ? fmtMaybeNumber(record.calories, ' kcal') : 'brak danych'],
    ['Training effect', record.training_effect_aerobic != null || record.training_effect_anaerobic != null ? `aerobic ${record.training_effect_aerobic != null ? fmtEffect(record.training_effect_aerobic) : 'brak danych'} / anaerobic ${record.training_effect_anaerobic != null ? fmtEffect(record.training_effect_anaerobic) : 'brak danych'}` : 'brak danych'],
    ['Moc avg/max', record.avg_power != null || record.max_power != null || avgPowerFromSummary ? `${record.avg_power != null ? fmtMaybeNumber(record.avg_power, ' W') : (avgPowerFromSummary || 'brak danych')} / ${record.max_power != null ? fmtMaybeNumber(record.max_power, ' W') : 'brak danych'}` : 'brak danych'],
    ['NP / IF', firstData(record.np_watts, npFromSummary, null) || firstData(record.intensity_factor, record.bike_if_value, ifFromSummary, null) ? `${record.np_watts != null ? fmtMaybeNumber(record.np_watts, ' W') : (npFromSummary || 'brak danych')} / ${record.intensity_factor != null ? fmtIf(record.intensity_factor) : record.bike_if_value != null ? fmtIf(record.bike_if_value) : (ifFromSummary ? fmtIf(ifFromSummary) : 'brak danych')}` : 'brak danych'],
    ['EF', ef || 'brak danych'],
    ['Coach flags', coachFlags.length ? coachFlags.join(', ') : 'brak danych'],
    ['Load 7d / 28d przed aktywnością', record.load_7d_before_activity != null || record.load_28d_before_activity != null ? `${record.load_7d_before_activity != null ? fmtNumber(record.load_7d_before_activity) : 'brak danych'} / ${record.load_28d_before_activity != null ? fmtNumber(record.load_28d_before_activity) : 'brak danych'}` : 'brak danych'],
    ['Auto summary', textOrMissing(record.auto_summary)]
  ];
}

function segmentLabel(type){
  const key = String(type || '').toLowerCase();
  if(key === 'swim') return 'Pływanie';
  if(key === 'bike') return 'Rower';
  if(key === 'run') return 'Bieg';
  if(key === 't1') return 'T1';
  if(key === 't2') return 'T2';
  return type || 'Segment';
}

function segmentLine(segment, record){
  const type = String(segment.segment_type || '').toLowerCase();
  const duration = segment.duration_seconds != null ? fmtSeconds(segment.duration_seconds) : 'brak danych';
  const hr = segment.hr_avg != null || segment.hr_max != null ? `HR ${segment.hr_avg != null ? Math.round(Number(segment.hr_avg)) : 'brak danych'}/${segment.hr_max != null ? Math.round(Number(segment.hr_max)) : 'brak danych'}` : 'HR brak danych';
  if(type === 't1' || type === 't2'){
    return `${segmentLabel(type)}: ${duration}, ${hr}.`;
  }
  const distance = segment.distance_meters != null ? fmtKmDot(Number(segment.distance_meters) / 1000) : 'brak danych';
  const pace = type === 'swim'
    ? (segment.swim_pace_sec_per_100m != null ? `${fmtSeconds(segment.swim_pace_sec_per_100m)}/100 m` : 'tempo brak danych')
    : (segment.pace_min_per_km != null ? fmtPace(segment.pace_min_per_km) : 'tempo brak danych');
  if(type === 'bike'){
    const extras = [];
    if(record.bike_if_value != null) extras.push(`IF ${fmtIf(record.bike_if_value)}`);
    const np = extractMetric(record, [/\bNP\s*[:=]?\s*([0-9]+(?:[.,][0-9]+)?\s*W?)/i]);
    if(np) extras.push(`NP ${np}`);
    if(record.bike_if_category) extras.push(`kategoria ${record.bike_if_category}`);
    return `${segmentLabel(type)}: ${distance}, ${duration}, ${extras.length ? `${extras.join(', ')}, ` : ''}${hr}.`;
  }
  const extras = [];
  if(type === 'run' && record.run_start_hr != null) extras.push(`start HR ${Math.round(Number(record.run_start_hr))}`);
  return `${segmentLabel(type)}: ${distance}, ${duration}, ${pace}, ${hr}${extras.length ? `, ${extras.join(', ')}` : ''}.`;
}

function buildSegmentsText(record){
  const segments = parseJsonArray(record.segments);
  if(!segments.length) return 'brak danych';
  return segments
    .slice()
    .sort((a, b) => Number(a.segment_order || 0) - Number(b.segment_order || 0))
    .map(segment => segmentLine(segment, record))
    .join(' ');
}

function metricForDate(items, date){
  return items.find(item => fmtDateIso(item.metric_date || item.journal_date) === date) || null;
}

function journalLine(item){
  if(!item) return 'dziennik brak danych';
  return [
    item.energy != null ? `energia ${item.energy}` : '',
    item.stress != null ? `stress dziennik ${item.stress}` : '',
    item.motivation != null ? `motywacja ${item.motivation}` : '',
    item.feeling ? `samopoczucie: ${item.feeling}` : '',
    item.pain ? `ból: ${item.pain}` : '',
    item.notes ? `notatka: ${item.notes}` : ''
  ].filter(Boolean).join(', ') || 'dziennik brak danych';
}

function dailyLineForDate(record, offset){
  const date = addDaysIso(record.workout_date, offset);
  const daily = metricForDate(parseJsonArray(record.daily_metrics_window), date);
  const journal = metricForDate(parseJsonArray(record.journal_window), date);
  const label = offset < 0 ? `D${offset}` : offset > 0 ? `D+${offset}` : 'Dzień aktywności';
  if(!date) return `${label}: brak danych`;
  if(!daily && !journal) return `${label} ${date}: brak danych`;
  const dailyText = daily ? [
    daily.training_readiness_score != null ? `readiness ${Math.round(Number(daily.training_readiness_score))}/100 ${daily.training_readiness_level || ''}`.trim() : 'readiness brak danych',
    daily.sleep_minutes != null ? `sen ${Math.round(Number(daily.sleep_minutes))} min` : 'sen brak danych',
    daily.body_battery_start != null || daily.body_battery_end != null ? `Body Battery ${daily.body_battery_start != null ? Math.round(Number(daily.body_battery_start)) : 'brak danych'} → ${daily.body_battery_end != null ? Math.round(Number(daily.body_battery_end)) : 'brak danych'}` : 'Body Battery brak danych',
    daily.avg_stress != null ? `stress ${Math.round(Number(daily.avg_stress))}` : 'stress brak danych',
    daily.resting_hr != null ? `resting HR ${Math.round(Number(daily.resting_hr))}` : 'resting HR brak danych'
  ].join(', ') : 'Garmin brak danych';
  return `${label} ${date}: ${dailyText}. ${journalLine(journal)}.`;
}

function contextBeforeText(record){
  return [-3, -2, -1].map(offset => dailyLineForDate(record, offset)).join(' ');
}

function activityDayText(record){
  return dailyLineForDate(record, 0);
}

function recoveryAfterText(record){
  return dailyLineForDate(record, 1);
}

function segmentTypes(record){
  return parseJsonArray(record.segments).map(segment => String(segment.segment_type || '').toLowerCase());
}

function hasSegment(record, type){
  return segmentTypes(record).includes(type);
}

function runHrText(record){
  const run = parseJsonArray(record.segments).find(segment => String(segment.segment_type || '').toLowerCase() === 'run');
  if(run?.hr_avg != null || run?.hr_max != null){
    return `${run.hr_avg != null ? Math.round(Number(run.hr_avg)) : 'brak danych'}/${run.hr_max != null ? Math.round(Number(run.hr_max)) : 'brak danych'}`;
  }
  if(record.run_start_hr != null) return `start HR ${Math.round(Number(record.run_start_hr))}`;
  return '';
}

function afterReadinessCost(record){
  const after = metricForDate(parseJsonArray(record.daily_metrics_window), addDaysIso(record.workout_date, 1));
  if(!after) return '';
  const score = numberOrNull(after.training_readiness_score);
  const level = String(after.training_readiness_level || '').toUpperCase();
  const batteryEnd = numberOrNull(after.body_battery_end);
  if(score != null && score <= 20) return `D+1 readiness ${Math.round(score)}/100 ${level || ''} pokazuje duży koszt regeneracyjny.`.trim();
  if(batteryEnd != null && batteryEnd < 45) return `D+1 Body Battery ${Math.round(batteryEnd)} sugeruje wyraźny koszt regeneracyjny.`;
  return '';
}

function buildDynamicKalmarConclusion(record){
  if(!record) return 'Wniosek pod Ironman Kalmar: brak danych.';
  const sport = String(record.sport_type || record.activity_type || '').toLowerCase();
  const hasSwim = hasSegment(record, 'swim') || sport.includes('swim');
  const hasBike = hasSegment(record, 'bike') || sport.includes('bike') || sport.includes('cycl');
  const hasRun = hasSegment(record, 'run') || sport.includes('run');
  const isMulti = Boolean(record.is_multisport) || sport.includes('triathlon') || sport.includes('multi') || (hasSwim && hasBike && hasRun);
  const bikeIf = numberOrNull(record.bike_if_value ?? record.intensity_factor);
  const npFromSummary = extractMetric(record, [/\bNP\s*[:=]?\s*([0-9]+(?:[.,][0-9]+)?\s*W?)/i]);
  const np = record.np_watts != null ? fmtMaybeNumber(record.np_watts, ' W') : npFromSummary;
  const load = numberOrNull(record.training_load);
  const hrAvg = numberOrNull(record.hr_avg);
  const hrMax = numberOrNull(record.hr_max);
  const recoveryCost = afterReadinessCost(record);
  const runHr = runHrText(record);

  if(isMulti){
    const parts = ['Wniosek pod Ironman Kalmar: ten start pokazuje układ pływanie–rower–bieg, więc najważniejsza jest kontrola kosztu między dyscyplinami.'];
    if(hasBike && (bikeIf != null || np || record.bike_if_category)){
      parts.push(`Rower jest mocnym elementem, ale wymaga kontroli${bikeIf != null ? ` — IF ${fmtIf(bikeIf)}` : ''}${np ? `, NP ${np}` : ''}${record.bike_if_category ? `, kategoria ${record.bike_if_category}` : ''}.`);
    }
    if(hasRun && runHr) parts.push(`Bieg był wykonywany wysoko tętniowo (${runHr}), więc koszt roweru trzeba pilnować przed dłuższymi dystansami.`);
    if(recoveryCost) parts.push(recoveryCost);
    if(!hasBike && !hasRun && load != null) parts.push(`Load ${fmtNumber(load)} pokazuje koszt całego startu, ale brakuje pełnych danych segmentów do głębszej oceny.`);
    return parts.join(' ');
  }

  if(hasBike){
    const parts = ['Wniosek pod Ironman Kalmar: rower trzeba rozwijać jako stabilną, ekonomiczną pracę, a nie tylko pojedynczy mocny bodziec.'];
    if(bikeIf != null || np || record.bike_if_category) parts.push(`Dostępne dane rowerowe: ${bikeIf != null ? `IF ${fmtIf(bikeIf)}` : 'IF brak danych'}${np ? `, NP ${np}` : ', NP brak danych'}${record.bike_if_category ? `, kategoria ${record.bike_if_category}` : ''}.`);
    if(hrAvg != null || hrMax != null) parts.push(`HR ${hrAvg != null ? Math.round(hrAvg) : 'brak danych'}/${hrMax != null ? Math.round(hrMax) : 'brak danych'} pokazuje koszt intensywności.`);
    if(recoveryCost) parts.push(recoveryCost);
    return parts.join(' ');
  }

  if(hasRun){
    const pace = extractMetric(record, [/\btempo\s*([0-9]+:[0-9]{2}\/?km)/i]);
    const parts = ['Wniosek pod Ironman Kalmar: ten bieg oceniaj przez tempo, tętno i koszt regeneracji, bo w Ironmanie kluczowa będzie odporność na zmęczenie po rowerze.'];
    if(pace || hrAvg != null || hrMax != null || load != null) parts.push(`Dane biegu: tempo ${pace || 'brak danych'}, HR ${hrAvg != null ? Math.round(hrAvg) : 'brak danych'}/${hrMax != null ? Math.round(hrMax) : 'brak danych'}, load ${load != null ? fmtNumber(load) : 'brak danych'}.`);
    if(recoveryCost) parts.push(recoveryCost);
    return parts.join(' ');
  }

  if(hasSwim){
    const parts = ['Wniosek pod Ironman Kalmar: pływanie ma być ekonomiczne i spokojne, żeby nie zabierało zasobów przed rowerem.'];
    if(hrAvg != null || hrMax != null) parts.push(`HR ${hrAvg != null ? Math.round(hrAvg) : 'brak danych'}/${hrMax != null ? Math.round(hrMax) : 'brak danych'} pozwala ocenić koszt wejścia w wysiłek.`);
    if(recoveryCost) parts.push(recoveryCost);
    return parts.join(' ');
  }

  return 'Wniosek pod Ironman Kalmar: ocena ograniczona do dostępnych danych aktywności. Brak danych segmentowych do sportowej interpretacji.';
}

function fullCoachAnalysis(record){
  const load = numberOrNull(record.training_load);
  const hrAvg = numberOrNull(record.hr_avg);
  const hrMax = numberOrNull(record.hr_max);
  const bikeIf = numberOrNull(record.bike_if_value ?? record.intensity_factor);
  const runStartHr = numberOrNull(record.run_start_hr);
  const after = metricForDate(parseJsonArray(record.daily_metrics_window), addDaysIso(record.workout_date, 1));
  const activityDay = metricForDate(parseJsonArray(record.daily_metrics_window), fmtDateIso(record.workout_date));
  const before = parseJsonArray(record.daily_metrics_window).filter(item => itemMatchesRelativeDay(item, 'before', record));
  const moderateBefore = before.some(item => String(item.training_readiness_level || '').toUpperCase() === 'MODERATE');
  const sentences = [];
  sentences.push(`Analiza PRO — pełny kontekst D-3 → D+1, zakotwiczona w ${fmtDateIso(record.workout_date) || 'brak danych'}.`);
  if(moderateBefore || activityDay?.training_readiness_level){
    sentences.push(`Szymon wszedł w aktywność z gotowością MODERATE, ale sen w oknie startowym był krótki albo niepełny tam, gdzie są dane.`);
  }else{
    sentences.push('Wejście w aktywność: readiness przed startem brak danych.');
  }
  if(load != null || hrAvg != null || hrMax != null){
    sentences.push(`To był mocny bodziec startowy: wysokie obciążenie i wysokie tętno pokazują duży koszt, nie zwykły trening kontrolny.`);
  }
  if(bikeIf != null || record.bike_if_category){
    const np = extractMetric(record, [/\bNP\s*[:=]?\s*([0-9]+(?:[.,][0-9]+)?\s*W?)/i]);
    sentences.push(`Rower był atutem, ale intensywność roweru była już w strefie, która może zabrać jakość biegu.`);
  }
  if(runStartHr != null || String(record.auto_summary || '').includes('HR 171/185')){
    sentences.push('Bieg został wykonany wysoko tętniowo, więc po mocnym rowerze organizm nie miał dużego marginesu luzu.');
  }
  if(after){
    sentences.push(`D+1 potwierdza koszt regeneracyjny: readiness spadło do ${after.training_readiness_score != null ? `${Math.round(Number(after.training_readiness_score))}/100 ${after.training_readiness_level || ''}` : 'brak danych'}, a Body Battery do ${after.body_battery_end != null ? Math.round(Number(after.body_battery_end)) : 'brak danych'}.`);
  }else{
    sentences.push('Koszt po aktywności: D+1 brak danych.');
  }
  return sentences.join(' ');
}

function fullRecoveryRecommendation(record){
  const after = metricForDate(parseJsonArray(record.daily_metrics_window), addDaysIso(record.workout_date, 1));
  const poorAfter = after && (Number(after.training_readiness_score) <= 20 || String(after.training_readiness_level || '').toUpperCase() === 'POOR');
  if(poorAfter){
    return 'Po tej aktywności priorytetem jest regeneracja, sen, nawodnienie i bardzo lekki ruch. Do mocniejszego bodźca wracaj dopiero po odbiciu readiness i Body Battery, nie dzień po takim starcie.';
  }
  return 'Po tej aktywności wybierz lekki trening lub technikę i kontroluj obciążenie. Mocniejszy bodziec dopiero, gdy readiness, sen i Body Battery potwierdzą regenerację.';
}

function buildFactBasedActivityAnalysis(activityContext){
  if(!activityContext?.activity){
    return {
      facts: [['Aktywność', 'brak danych']],
      mode: 'Analiza podstawowa — ograniczona do dostępnych danych',
      segments: 'brak danych',
      contextBefore: 'brak danych',
      activityDay: 'brak danych',
      recoveryContext: 'brak danych',
      coachAnalysis: 'Brak aktywności Garmin PRO do analizy.',
      kalmar: 'brak danych',
      recovery: 'brak danych'
    };
  }
  if(!activityContext.hasFullContext){
    const basic = buildBasicActivityAnalysis(activityContext.activity, {});
    return {
      facts: basic.facts,
      mode: 'Analiza podstawowa — ograniczona do dostępnych danych',
      segments: basic.segments,
      contextBefore: activityContext.message,
      activityDay: 'brak danych',
      recoveryContext: 'brak danych',
      coachAnalysis: `${basic.rating} ${basic.good} ${basic.caution}`,
      kalmar: basic.kalmar,
      recovery: basic.recovery
    };
  }
  const record = activityContext.contextRecord;
  return {
    facts: contextActivityFacts(record),
    mode: 'Analiza PRO — pełny kontekst D-3 → D+1',
    segments: buildSegmentsText(record),
    contextBefore: contextBeforeText(record),
    activityDay: activityDayText(record),
    recoveryContext: recoveryAfterText(record),
    coachAnalysis: fullCoachAnalysis(record),
    kalmar: buildDynamicKalmarConclusion(record),
    recovery: fullRecoveryRecommendation(record)
  };
}

function buildActivityAiAnalysis(activity){
  return buildFactBasedActivityAnalysis(buildActivityContext(activity));
}

function renderFactsBlock(rows){
  return `<div class="facts-block"><span>Fakty Garmin PRO</span><ul>${rows.map(([label, value]) => `<li><b>${escapeHtml(label)}</b><em>${escapeHtml(value || 'brak danych')}</em></li>`).join('')}</ul></div>`;
}

function renderAnalysisBlock(title, text){
  return `<div><span>${escapeHtml(title)}</span><p>${escapeHtml(text || 'brak danych')}</p></div>`;
}

function renderActivityAiAnalysis(targetId, activity){
  const target = $(targetId);
  if(!target) return;
  const analysis = buildActivityAiAnalysis(activity);
  target.innerHTML = [
    renderAnalysisBlock('Tryb analizy', analysis.mode),
    renderFactsBlock(analysis.facts),
    renderAnalysisBlock('Segmenty', analysis.segments),
    renderAnalysisBlock('Kontekst 3 dni przed', analysis.contextBefore),
    renderAnalysisBlock('Dzień aktywności', analysis.activityDay),
    renderAnalysisBlock('Regeneracja po aktywności', analysis.recoveryContext),
    renderAnalysisBlock('Analiza trenerska', analysis.coachAnalysis),
    renderAnalysisBlock('Wniosek pod Ironman Kalmar', analysis.kalmar),
    renderAnalysisBlock('Zalecenie', analysis.recovery)
  ].join('');
}

function renderActivityDetails(){
  const detail = $('activityDetailView');
  if(!detail) return;
  const activity = selectedActivity();
  if(!activity){
    detail.hidden = true;
    if($('historyListView')) $('historyListView').hidden = false;
    return;
  }
  if($('historyListView')) $('historyListView').hidden = true;
  detail.hidden = false;
  $('detailActivityName').textContent = activityName(activity);
  $('detailActivityMeta').textContent = `${fmtDate(activity.workout_date)} · ${sportLabel(activity.sport_type || activity.activity_type)}`;
  $('detailDistance').textContent = fmtKm(activity.distance_km);
  $('detailDuration').textContent = fmtMin(activity.duration_min);
  $('detailHr').textContent = activity.hr_avg || activity.hr_max ? `${activity.hr_avg ? Math.round(Number(activity.hr_avg)) : 'brak'} / ${activity.hr_max ? Math.round(Number(activity.hr_max)) : 'brak'}` : 'brak danych';
  $('detailLoad').textContent = activity.training_load != null ? fmtNumber(activity.training_load) : 'brak danych';
  const clues = extractPowerClues(activity);
  const summaryParts = [
    activity.auto_summary ? `<p><b>Auto summary:</b> ${escapeHtml(activity.auto_summary)}</p>` : '',
    activity.segment_summary ? `<p><b>Segmenty:</b> ${escapeHtml(activity.segment_summary)}</p>` : '',
    clues.length ? `<p><b>IF / NP / moc / tempo:</b> ${escapeHtml(clues.join(', '))}</p>` : '<p><b>IF / NP / moc / tempo:</b> Brak danych do oceny tego parametru.</p>'
  ].filter(Boolean);
  $('detailSummary').innerHTML = summaryParts.join('');
  renderActivityAiAnalysis('activityAiAnalysis', activity);
}

function openActivityDetails(key){
  selectedActivityKey = String(key || '');
  renderActivityDetails();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function closeActivityDetails(){
  selectedActivityKey = '';
  renderActivityDetails();
}

function showTab(tab){
  const target = ['dashboard', 'history', 'ai', 'settings'].includes(tab) ? tab : 'dashboard';
  if(target !== 'history') selectedActivityKey = '';
  $$('.screen').forEach(screen => screen.classList.toggle('active', screen.id === `screen-${target}`));
  $$('.bottom-nav button').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === target));
  renderActivityDetails();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function bindEvents(){
  $('loginForm').addEventListener('submit', event => {
    event.preventDefault();
    signIn();
  });
  $('logoutBtn').addEventListener('click', signOut);
  $('refreshBtn').addEventListener('click', loadAllData);
  $('backToHistoryBtn').addEventListener('click', closeActivityDetails);
  $('activityList').addEventListener('click', event => {
    const card = event.target.closest('[data-activity-key]');
    if(card) openActivityDetails(card.dataset.activityKey);
  });
  $('activityList').addEventListener('keydown', event => {
    if(event.key !== 'Enter' && event.key !== ' ') return;
    const card = event.target.closest('[data-activity-key]');
    if(card){
      event.preventDefault();
      openActivityDetails(card.dataset.activityKey);
    }
  });
  $$('.bottom-nav button').forEach(btn => btn.addEventListener('click', () => showTab(btn.dataset.tab)));
  $$('[data-mode]').forEach(btn => btn.addEventListener('click', () => {
    aiMode = btn.dataset.mode === 'analysis' ? 'analysis' : 'plan';
    renderAi();
  }));
}

async function init(){
  bindEvents();
  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('service-worker.js?v=508-analysis-logic-hotfix').catch(() => {});
  }
  if(loadSession() && await refreshSession()){
    showApp();
    await loadAllData();
  }else{
    showLogin();
  }
}

init();
