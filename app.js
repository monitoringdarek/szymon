const VERSION = 'szymon-ai-coach-v5.5.0';
const IRONMAN_KALMAR_DATE = '2026-08-15';
const AUTH_SESSION_KEY = 'szymonAiCoachProV5Session';
const LOGIN_TIMEOUT_MS = 15000;

const SUPABASE_URL = 'https://ktfjdngmvrnqkzjxvzoc.supabase.co';
const SUPABASE_KEY = 'sb_publishable_r1A-cyrFQ3ASLsOVPGcmDA_26a3P8zK';
const READINESS_ENDPOINT = `${SUPABASE_URL}/rest/v1/garmin_pro_readiness_context`;
const READINESS_HISTORY_ENDPOINT = `${SUPABASE_URL}/rest/v1/garmin_pro_readiness_context`;
const WEEKLY_ENDPOINT = `${SUPABASE_URL}/rest/v1/garmin_pro_weekly_summary`;
const LATEST_ENDPOINT = `${SUPABASE_URL}/rest/v1/garmin_pro_latest_activity`;
const CARDS_ENDPOINT = `${SUPABASE_URL}/rest/v1/garmin_pro_activity_cards`;
const LOAD_28D_ENDPOINT = `${SUPABASE_URL}/rest/v1/garmin_pro_training_load_28d`;
const ACTIVITY_CONTEXT_ENDPOINT = `${SUPABASE_URL}/rest/v1/garmin_pro_activity_analysis_context`;
const ATHLETE_THRESHOLDS_ENDPOINT = `${SUPABASE_URL}/rest/v1/athlete_current_thresholds`;
const ATHLETE_PROFILE_CONTEXT_ENDPOINT = `${SUPABASE_URL}/rest/v1/athlete_threshold_profile_context`;
const POWER_INTERVALS_ENDPOINT = `${SUPABASE_URL}/rest/v1/garmin_activity_power_intervals`;
const RUN_INTERVALS_ENDPOINT = `${SUPABASE_URL}/rest/v1/garmin_activity_run_intervals`;
const THRESHOLD_SUGGESTIONS_ENDPOINT = `${SUPABASE_URL}/rest/v1/athlete_threshold_suggestions_context`;
const APPROVE_THRESHOLD_RPC = `${SUPABASE_URL}/rest/v1/rpc/approve_threshold_suggestion`;
const REJECT_THRESHOLD_RPC = `${SUPABASE_URL}/rest/v1/rpc/reject_threshold_suggestion`;
const AUTH_TOKEN_ENDPOINT = `${SUPABASE_URL}/auth/v1/token?grant_type=password`;
const AUTH_REFRESH_ENDPOINT = `${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`;
const AUTH_LOGOUT_ENDPOINT = `${SUPABASE_URL}/auth/v1/logout`;
const ACTIVITY_AI_ANALYSIS_ENDPOINT = `${SUPABASE_URL}/functions/v1/activity-coach-analysis`;
const GARMIN_ACTIVITIES_ENDPOINT = `${SUPABASE_URL}/rest/v1/garmin_activities`;
const GARMIN_SEGMENTS_ENDPOINT = `${SUPABASE_URL}/rest/v1/garmin_activity_segments`;
const GARMIN_ANALYTICS_ENDPOINT = `${SUPABASE_URL}/rest/v1/garmin_activity_analytics`;

// Cache analiz AI per aktywność, żeby nie odpytywać Gemini przy każdym
// otwarciu tego samego treningu w trakcie sesji.
const aiAnalysisCache = new Map();

let session = null;
let user = null;
let readiness = null;
let readinessHistory = [];
let weekly = null;
let latest = null;
let cards = [];
let load28d = [];
let activityContexts = [];
let proActivities = [];
let proSegments = [];
let proAnalytics = [];
let athleteThresholds = [];
let activityPowerIntervals = [];
let activityRunIntervals = [];
let athleteProfileContext = [];
let athleteThresholdSuggestions = [];
let thresholdActionBusy = false;
let thresholdActionBusyId = '';
let thresholdActionBusyDecision = '';
let thresholdActionFeedback = null;
let thresholdPanelOpen = false;
let historySearchTerm = '';
let historySportFilter = 'all';
let historyShowAll = false;
let activityContextStatus = 'idle';
let lastReadAt = null;
let selectedActivityKey = '';
let viewState = {
  readiness: 'idle',
  readinessHistory: 'idle',
  weekly: 'idle',
  latest: 'idle',
  cards: 'idle',
  load28d: 'idle',
  thresholds: 'idle',
  powerIntervals: 'idle',
  thresholdProfileContext: 'idle',
  runIntervals: 'idle',
  thresholdSuggestions: 'idle',
  proActivities: 'idle',
  proSegments: 'idle',
  proAnalytics: 'idle'
};
let aiMode = 'plan';
let weeklyCoachAnalysis = null;
let weeklyCoachStatus = 'idle';
let weeklyCoachCacheKey = '';
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

async function apiPost(url, payload = {}){
  const response = await fetch(url, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload)
  });
  const text = await response.text();
  if(!response.ok) throw new Error(text || `POST ${response.status}`);
  if(!text) return null;
  try{
    return JSON.parse(text);
  }catch{
    return text;
  }
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

function fmtDateTime(value){
  const d = value instanceof Date ? value : (value ? new Date(value) : null);
  if(!d || Number.isNaN(d.getTime())) return 'brak danych';
  return d.toLocaleString('pl-PL', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function todayIso(){
  return new Date().toISOString().slice(0, 10);
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

function daysUntilKalmar(){
  const target = new Date(`${IRONMAN_KALMAR_DATE}T00:00:00`);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.ceil((target.getTime() - today.getTime()) / 86400000);
  return Number.isFinite(diff) ? Math.max(0, diff) : null;
}

function validTodayReadinessScore(){
  if(morningDataIncomplete()) return null;
  const score = morningMetricValue('readiness', readiness?.training_readiness_score);
  return score != null ? Math.max(0, Math.min(100, Math.round(Number(score)))) : null;
}

function renderKalmarFocusCard(){
  const days = daysUntilKalmar();
  if($('daysToKalmar')) $('daysToKalmar').textContent = days != null ? String(days) : '--';
  const score = validTodayReadinessScore();
  const ring = $('readinessRing');
  if(ring){
    const deg = score != null ? Math.round((score / 100) * 360) : 0;
    ring.style.setProperty('--ready', `${deg}deg`);
    ring.classList.toggle('is-empty', score == null);
  }
  if($('readinessRingValue')) $('readinessRingValue').textContent = score != null ? String(score) : '--';
  if($('readinessRingLabel')) $('readinessRingLabel').textContent = score != null ? 'Gotowość /100' : 'Dane poranne';
}

function sportLabel(value){
  const key = String(value || '').toLowerCase();
  if(key.includes('swim')) return 'Pływanie';
  if(key.includes('bike') || key.includes('cycl')) return 'Rower';
  if(key.includes('run')) return 'Bieg';
  if(key.includes('walk')) return 'Marsz';
  return value || 'brak danych';
}

function sportKey(value){
  const key = String(value || '').toLowerCase();
  if(key.includes('triathlon') || key.includes('multi')) return 'triathlon';
  if(key.includes('swim') || key.includes('pływ') || key.includes('basen')) return 'swim';
  if(key.includes('bike') || key.includes('cycl') || key.includes('rower') || key.includes('kolar')) return 'bike';
  if(key.includes('run') || key.includes('bieg')) return 'run';
  return 'general';
}

function sportKeyForItem(item){
  return sportKey([
    item?.sport_type,
    item?.activity_type,
    item?.title,
    item?.name,
    item?.event_name,
    item?.activity_name,
    item?.summary,
    item?.note
  ].filter(Boolean).join(' '));
}

function sportIconSvg(key){
  const sport = sportKey(key);
  if(sport === 'bike') return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.2 17.4a3.1 3.1 0 1 1-6.2 0 3.1 3.1 0 0 1 6.2 0Z"/><path d="M23 17.4a3.1 3.1 0 1 1-6.2 0 3.1 3.1 0 0 1 6.2 0Z"/><path d="M4.1 17.4h4.2l3.2-6.2 3.9 6.2"/><path d="M8.3 17.4h5.8l-3.5-6.2"/><path d="M12.8 8.2h3.7"/><path d="M15.4 17.4 18 10.6"/></svg>';
  if(sport === 'run') return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.8 5.2a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"/><path d="M9.8 10.3 13 7.2l3.2 2.1 2.7-.6"/><path d="m12.8 11.2-2.3 4.2-4.1 1.7"/><path d="m14.6 12.9 2.8 3.1 2.3 4"/><path d="M8.9 7.6 6.6 10"/></svg>';
  if(sport === 'swim') return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17.2c2.2-1.4 4.1-1.4 6.3 0s4.1 1.4 6.3 0 4.2-1.4 6.4 0"/><path d="M3 20.7c2.2-1.4 4.1-1.4 6.3 0s4.1 1.4 6.3 0 4.2-1.4 6.4 0"/><path d="M9.4 12.5 13 8.8l3.4 1.8"/><path d="M12.2 6.1a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"/></svg>';
  if(sport === 'triathlon') return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17.5c1.7-1 3.2-1 4.9 0s3.2 1 4.9 0 3.3-1 5 0 3.2 1 4.9 0"/><path d="M6.5 12.3a2.2 2.2 0 1 1-4.4 0 2.2 2.2 0 0 1 4.4 0Z"/><path d="M21.8 12.3a2.2 2.2 0 1 1-4.4 0 2.2 2.2 0 0 1 4.4 0Z"/><path d="M4.3 12.3h5.2l2.5-5 2.7 5h4.9"/><path d="M12 7.3h3.2"/></svg>';
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5v17"/><path d="M5.2 7.8h13.6"/><path d="M6.4 16.2h11.2"/></svg>';
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
  return { readiness, weekly, load28d, activityContexts, activityContextStatus, athleteThresholds, athleteThresholdSuggestions };
}

function escapeHtml(value){
  return String(value ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}

function humanizeCoachText(value){
  return String(value ?? '')
    .replace(/\bD-3\s*→\s*D\+1\b/g, 'tydzień i poranek po treningu')
    .replace(/\bD\+1\b/g, 'poranek po treningu')
    .replace(/\bD0\b/g, 'dzień treningu')
    .replace(/\bD-3\b/g, 'kilka dni przed treningiem')
    .replace(/\bBaseline\b/gi, 'punkt odniesienia')
    .replace(/\bRecovery\b/gi, 'regeneracja')
    .replace(/\btraining readiness\b/gi, 'gotowość treningowa')
    .replace(/\breadiness\b/gi, 'gotowość')
    .replace(/\bload 7d\b/gi, 'obciążenie z tygodnia')
    .replace(/\bIF\s*([0-9]+(?:[.,][0-9]+)?)/gi, 'wysoka intensywność')
    .replace(/\bload\s*([0-9]+)/gi, 'duże obciążenie')
    .replace(/po wczorajszym/gi, 'po ostatnim')
    .replace(/wczorajszym/gi, 'ostatnim')
    .replace(/wczoraj/gi, 'po ostatnim treningu')
    .replace(/Pełna regeneracja!?/gi, 'ODBUDOWA')
    .replace(/Regeneracja!/gi, 'ODBUDOWA')
    .replace(/!+/g, '')
    .replace(/Dane poranek po treningu:/g, 'Poranek po treningu:');
}

function normalizeCoachTitle(status, rawTitle){
  const text = humanizeCoachText(rawTitle || '').trim().toUpperCase();
  if(status === 'train') return text && !/MOŻNA TRENOWAĆ|TRENUJ|TRENING/.test(text) ? text : 'DZISIAJ: TRENING';
  if(status === 'recovery') return text && /AKTYWNA|KONTROLOWANA/.test(text) ? text : (text && !/REGENERACJA|PEŁNA|ODBUDOWA/.test(text) ? text : 'DZISIAJ: ODBUDOWA AKTYWNA');
  return text && !/OSTROŻNIE|KONTROLA|KONTROLOWANY/.test(text) ? text : 'DZISIAJ: KONTROLOWANY TRENING';
}
function readinessDecision(){
  return buildLocalTodayCoach();
}

function metricValue(...values){
  for(const value of values){
    const n = Number(value);
    if(Number.isFinite(n)) return n;
  }
  return null;
}

function morningMetricValue(kind, ...values){
  for(const value of values){
    const n = Number(value);
    if(!Number.isFinite(n)) continue;
    if(kind === 'readiness' && n <= 0) continue;
    if(kind === 'sleep' && n <= 0) continue;
    if(kind === 'battery' && n <= 5) continue;
    if(kind === 'stress' && n <= 0) continue;
    if(kind === 'rhr' && n <= 0) continue;
    return n;
  }
  return null;
}

function morningDataIncomplete(){
  const rawScore = Number(readiness?.training_readiness_score);
  const rawSleep = Number(readiness?.sleep_minutes);
  const rawBatteryEnd = Number(readiness?.body_battery_end);
  const rawBatteryStart = Number(readiness?.body_battery_start);
  if(readiness && Number.isFinite(rawScore) && rawScore <= 0) return true;
  if(readiness && Number.isFinite(rawSleep) && rawSleep <= 0) return true;
  if(readiness && Number.isFinite(rawBatteryEnd) && rawBatteryEnd <= 5) return true;
  if(readiness && Number.isFinite(rawBatteryStart) && rawBatteryStart <= 5) return true;
  return !readiness;
}

function cleanMainCoachText(value){
  return humanizeCoachText(value)
    .replace(/gotowość\s*0\/100/gi, 'gotowość: brak pełnych danych porannych')
    .replace(/sen\s*0\s*min/gi, 'sen: brak pełnych danych')
    .replace(/Body Battery\s*[0-5]\b/gi, 'Body Battery: brak pełnych danych')
    .replace(/,\s*,/g, ',')
    .replace(/W tle:\s*\./g, 'Dane poranne są niepełne.')
    .trim();
}

function activityImpact(item){
  const load = metricValue(item?.training_load);
  const text = String(item?.auto_summary || item?.segment_summary || item?.bike_if_category || '').toLowerCase();
  const ifMatch = text.match(/\bIF\s*[:=]?\s*([0-9]+(?:[.,][0-9]+)?)/i);
  const ifValue = ifMatch ? Number(ifMatch[1].replace(',', '.')) : metricValue(item?.intensity_factor, item?.bike_if_value);

  const sport = sportKeyForItem(item);
  const baseline = buildAthleteBaseline(sport);
  if(baseline.hasEnough && load != null){
    const tier = classifyAgainstBaseline(load, baseline).tier;
    if(tier === 'over' || (ifValue != null && ifValue >= 0.86) || text.includes('mocno')) return 'mocny bodziec, duży koszt';
    if(tier === 'elevated') return 'podwyższony bodziec względem ostatnich tygodni';
    return 'normalny bodziec roboczy dla aktualnego poziomu';
  }

  if((load != null && load >= 250) || (ifValue != null && ifValue >= 0.86) || text.includes('mocno')) return 'mocny bodziec, duży koszt';
  if(load != null && load >= 120) return 'solidna praca, umiarkowany koszt';
  if(load != null) return 'lekki albo kontrolowany trening';
  return 'brak pełnych danych kosztu';
}

function recentTrainingItems(limit = 3){
  const source = (cards && cards.length ? cards : latest ? [latest] : [])
    .filter(Boolean)
    .slice()
    .sort((a, b) => String(b.workout_date || '').localeCompare(String(a.workout_date || '')));
  return source.slice(0, limit).map(item => {
    const key = sportKeyForItem(item);
    return {
      date: fmtDate(item.workout_date),
      title: `${sportLabel(item.sport_type || item.activity_type)}${item.distance_km != null ? ` ${fmtKm(item.distance_km)}` : ''}`.trim(),
      summary: activityImpact(item),
      load: item.training_load != null ? Math.round(Number(item.training_load)) : null,
      key: activityKey(item),
      sportKey: key,
      sportLabel: sportLabel(item.sport_type || item.activity_type)
    };
  });
}

function weeklyLoadValue(){
  return metricValue(readiness?.load_7d, weekly?.total_training_load);
}

function weeklyTrendFallback(){
  const load = weeklyLoadValue();
  const recent = recentTrainingItems(3);
  const strongCount = recent.filter(item => String(item.summary).includes('mocny')).length;
  if(load != null && load >= 650) return 'W ostatnim tygodniu praca jest duża. To buduje formę pod Kalmar, ale trzeba pilnować jakości kolejnych akcentów, zamiast dokładać zmęczenie bez celu.';
  if(strongCount >= 2) return 'W ostatnich treningach były mocne bodźce. Dzisiaj liczy się kontrola i przygotowanie organizmu do następnej jakościowej roboty.';
  if(recent.length >= 3) return 'Tydzień daje już obraz pracy. Decyzja na dziś zależy od snu, energii i tego, czy ostatni trening zostawił koszt w organizmie.';
  return 'Brakuje pełnego tygodnia albo minimum trzech treningów, więc decyzja jest ostrożniejsza.';
}

function buildLocalTodayCoach(){
  const score = morningMetricValue('readiness', readiness?.training_readiness_score);
  const level = String(readiness?.training_readiness_level || '').toUpperCase();
  const sleep = morningMetricValue('sleep', readiness?.sleep_minutes);
  const battery = morningMetricValue('battery', readiness?.body_battery_end, readiness?.body_battery_start);
  const stress = morningMetricValue('stress', readiness?.avg_stress);
  const incompleteMorning = morningDataIncomplete();
  const load7d = weeklyLoadValue();
  const latestImpact = activityImpact(latest);
  const recent = recentTrainingItems(3);

  const veryLowReady = !incompleteMorning && ((score != null && score <= 25) || level === 'POOR');
  const lowReady = !incompleteMorning && ((score != null && score <= 55) || ['LOW', 'MODERATE'].includes(level));
  const shortSleep = sleep != null && sleep < 360;
  const lowBattery = battery != null && battery <= 35;
  const highLoad = load7d != null && load7d >= 700;
  const hardLatest = String(latestImpact).includes('mocny');
  const redFlags = [lowReady && score != null && score <= 40, shortSleep, lowBattery, highLoad].filter(Boolean).length;
  const forceRecovery = veryLowReady || (hardLatest && redFlags >= 3);

  let status = 'caution';
  let title = 'DZISIAJ: KONTROLOWANY TRENING';
  let summary = 'Szymon ma sportową bazę, więc normalny bodziec nie jest alarmem. Dzisiaj liczy się kontrola wykonania, a nie dokładanie chaosu.';
  let today = 'Kontrolowany trening: spokojny tlen, technika albo lekka jednostka zgodna z planem. Bez ścigania i bez przepalania pod 226 km.';
  let tomorrow = 'Jutro sprawdzamy odpowiedź po nocy. Jeśli sen, energia i tętno spoczynkowe są w porządku — wracamy do pracy.';

  if(forceRecovery){
    status = 'recovery';
    title = 'DZISIAJ: ODBUDOWA AKTYWNA';
    summary = 'To nie jest traktowanie Szymona jak początkującego. To świadome zejście z obciążenia, gdy kilka sygnałów naraz mówi: nie dokładaj jakości.';
    today = 'Odbudowa aktywna: wolne, mobilność albo 30–45 minut bardzo lekko. Celem jest jakość kolejnego bodźca, nie odpoczynek dla samego odpoczynku.';
    tomorrow = 'Jutro decyzja zależy od poranka. Jeśli organizm odbije — wracamy do pracy; jeśli nie — utrzymujemy lekki dzień bez dokładania tempa.';
  }else if(!lowReady && !shortSleep && !lowBattery && !highLoad){
    status = 'train';
    title = 'DZISIAJ: TRENING';
    summary = 'Organizm wygląda gotowo do pracy. Szymon ma doświadczenie, ale Kalmar będzie pierwszym 226 km — trenujemy mocno, lecz bez chaosu.';
    today = 'Wykonaj zaplanowany trening. Jeśli jest akcent, zrób go jakościowo i kontrolowanie — mocno, ale nie ponad cel jednostki.';
    tomorrow = 'Jutro ocenimy odpowiedź organizmu po śnie, energii i tętnie spoczynkowym. Jeśli wszystko gra, jedziemy dalej z planem.';
  }

  const reasons = [];
  if(incompleteMorning) reasons.push('dane poranne niepełne');
  else{
    if(score != null) reasons.push(`gotowość ${Math.round(score)}/100`);
    if(sleep != null) reasons.push(`sen ${fmtMin(sleep)}`);
    if(battery != null) reasons.push(`Body Battery ${Math.round(battery)}`);
    if(stress != null) reasons.push(`stress ${Math.round(stress)}`);
  }
  if(load7d != null) reasons.push(`obciążenie tygodnia ${Math.round(load7d)}`);
  if(hardLatest) reasons.push('ostatni trening był mocny');

  return {
    status,
    title,
    summary: reasons.length ? `${summary} W tle: ${reasons.join(', ')}.` : summary,
    today,
    tomorrow,
    nextDays: 'Najbliższe 2–3 dni prowadzimy jak sportowiec: gdy organizm odpowiada — wracasz do pracy; gdy sygnały są słabe — odbudowa, żeby kolejny mocny bodziec miał jakość.',
    weeklyTrend: weeklyTrendFallback(),
    lastTrainings: recent,
    watch: ['sen i poranna energia', 'tętno spoczynkowe', 'ciężkość nóg po ostatnim treningu', 'gotowość do jakościowej pracy'],
    dataGaps: [
      ...(recent.length < 3 ? ['brakuje minimum trzech ostatnich treningów w widoku'] : []),
      ...(incompleteMorning ? ['brak pełnych danych z dzisiejszego poranka'] : [])
    ],
    source: 'fallback'
  };
}

function normalizeTodayCoach(coach){
  if(!coach) return null;
  const statusRaw = String(coach.status || coach.decision || '').toLowerCase();
  const status = statusRaw.includes('regen') || statusRaw.includes('red') ? 'recovery'
    : statusRaw.includes('train') || statusRaw.includes('green') || statusRaw.includes('trenuj') ? 'train'
    : 'caution';
  return {
    status,
    title: normalizeCoachTitle(status, coach.title || coach.decisionTitle || coach.headline),
    summary: cleanMainCoachText(coach.summary || coach.reason || coach.headline || ''),
    today: cleanMainCoachText(coach.today || coach.todayAction || coach.recommendationToday || coach.recovery || ''),
    tomorrow: cleanMainCoachText(coach.tomorrow || coach.tomorrowAction || coach.recommendationTomorrow || ''),
    nextDays: cleanMainCoachText(coach.nextDays || coach.next_48_72h || coach.next48h || ''),
    weeklyTrend: cleanMainCoachText(coach.weeklyTrend || coach.trend || ''),
    lastTrainings: Array.isArray(coach.lastTrainings) ? coach.lastTrainings.slice(0, 3).map(item => {
      const title = humanizeCoachText(item.title || item.name || 'Trening');
      const summary = cleanMainCoachText(item.summary || item.note || '');
      return {
        date: humanizeCoachText(item.date || ''),
        title,
        summary,
        load: item.load ?? null,
        sportKey: sportKeyForItem({ ...item, title, summary })
      };
    }) : recentTrainingItems(3),
    watch: Array.isArray(coach.watch) ? coach.watch.map(humanizeCoachText).filter(Boolean).slice(0, 4) : [],
    dataGaps: Array.isArray(coach.dataGaps) ? coach.dataGaps.map(humanizeCoachText).filter(Boolean) : [],
    source: 'ai'
  };
}

async function requestWeeklyCoachAnalysis(){
  const activityId = latest?.activity_id || latest?.id || latest?.garmin_activity_id;
  const cacheKey = `${activityId || 'no-activity'}:${readiness?.metric_date || weekly?.week_end || ''}`;
  if(!activityId) return;
  if(weeklyCoachCacheKey === cacheKey && weeklyCoachAnalysis) return;
  weeklyCoachCacheKey = cacheKey;
  weeklyCoachStatus = 'loading';
  renderDashboard();
  try{
    const response = await fetch(ACTIVITY_AI_ANALYSIS_ENDPOINT, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ mode: 'today', activityId })
    });
    if(!response.ok) throw new Error(`today coach ${response.status}`);
    const json = await response.json();
    const coach = normalizeTodayCoach(json.todayCoach || json.analysis?.todayCoach || null);
    if(!coach) throw new Error('Brak todayCoach w odpowiedzi AI');
    weeklyCoachAnalysis = coach;
    weeklyCoachStatus = 'ai';
  }catch(err){
    console.warn('Nie udało się pobrać tygodniowej decyzji AI, zostaje decyzja lokalna:', err);
    weeklyCoachAnalysis = null;
    weeklyCoachStatus = 'fallback';
  }
  renderDashboard();
}

function todayStatusLabel(status){
  if(status === 'train') return 'trening';
  if(status === 'recovery') return 'odbudowa aktywna';
  return 'kontrola';
}

function renderRecentTrainingsList(items){
  const rows = (items && items.length ? items : recentTrainingItems(3));
  if(!rows.length) return '<div class="muted-card">Brak treningów do pokazania.</div>';
  return rows.map(item => {
    const key = sportKeyForItem(item);
    return `
      <article class="recent-training-item sport-${escapeHtml(key)}">
        <span class="sport-mark" aria-hidden="true">${sportIconSvg(key)}</span>
        <div class="training-copy">
          <b>${escapeHtml(item.date || 'brak daty')} · ${escapeHtml(item.title || 'Trening')}</b>
          <span>${escapeHtml(item.summary || 'brak opisu')}</span>
        </div>
      </article>
    `;
  }).join('');
}

function renderHumanCoachDashboard(coach){
  const selected = weeklyCoachAnalysis || coach || buildLocalTodayCoach();
  const status = selected.status || 'caution';
  const sourceText = weeklyCoachStatus === 'loading' ? 'AI analizuje tydzień'
    : weeklyCoachStatus === 'ai' ? 'AI · tydzień + 3 treningi'
    : 'decyzja zapasowa';

  if($('todayDecision')) $('todayDecision').textContent = normalizeCoachTitle(status, selected.title || '');
  if($('todayReason')) $('todayReason').textContent = cleanMainCoachText(selected.summary || 'Brak pełnej decyzji.');
  if($('todayCoachSource')) $('todayCoachSource').textContent = sourceText;
  if($('todayCoachStatus')) $('todayCoachStatus').textContent = todayStatusLabel(status);
  if($('coachToday')) $('coachToday').textContent = cleanMainCoachText(selected.today || 'Brak danych Garmin PRO do decyzji.');
  if($('coachTomorrow')) $('coachTomorrow').textContent = cleanMainCoachText(selected.tomorrow || selected.nextDays || 'Jutro ocenimy po poranku i jakości snu.');
  if($('weeklyTrendText')) $('weeklyTrendText').textContent = cleanMainCoachText(selected.weeklyTrend || weeklyTrendFallback());
  if($('recentTrainingsList')) $('recentTrainingsList').innerHTML = renderRecentTrainingsList(selected.lastTrainings);

  const hero = document.querySelector('.human-today-hero');
  if(hero){
    hero.classList.remove('today-train', 'today-caution', 'today-recovery');
    hero.classList.add(`today-${status}`);
  }
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
  const key = sportKeyForItem(item);
  return `
    <article class="activity-card sport-${escapeHtml(key)}">
      <div class="activity-top">
        <div class="activity-heading-pro">
          <span class="sport-mark activity-sport-mark" aria-hidden="true">${sportIconSvg(key)}</span>
          <div>
            <h3>${escapeHtml(name)}</h3>
            <p>${escapeHtml(fmtDate(item.workout_date))} • ${escapeHtml(sport)}</p>
          </div>
        </div>
        <span class="load-pill">${escapeHtml(load)}</span>
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
  return html.replace(/<article class="activity-card([^"]*)">/, `<article class="activity-card$1 history-activity-card" data-activity-key="${escapeHtml(key)}" role="button" tabindex="0">`)
    .replace('</article>', '<button class="analysis-link" type="button">Szczegóły / Analiza</button></article>');
}

function renderActivityInto(id, item){
  const el = $(id);
  if(!el) return;
  if(!item){
    el.outerHTML = `<article id="${id}" class="activity-card muted-card">Brak danych.</article>`;
    return;
  }
  el.outerHTML = activityHtml(item).replace(/<article class="activity-card([^"]*)">/, `<article id="${id}" class="activity-card$1">`);
}

function viewLabel(key){
  return {
    readiness: 'readiness',
    readinessHistory: 'readiness_history',
    weekly: 'weekly',
    latest: 'latest',
    cards: 'activity_cards',
    load28d: 'load_28d',
    activityContext: 'activity_analysis_context',
    thresholds: 'athlete_current_thresholds',
    powerIntervals: 'garmin_activity_power_intervals',
    thresholdProfileContext: 'athlete_threshold_profile_context',
    runIntervals: 'garmin_activity_run_intervals',
    thresholdSuggestions: 'threshold_suggestions',
    proActivities: 'garmin_activities',
    proSegments: 'garmin_activity_segments',
    proAnalytics: 'garmin_activity_analytics'
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
  return Boolean(readiness || readinessHistory.length || weekly || latest || cards.length || proActivities.length || proSegments.length || proAnalytics.length || load28d.length || athleteThresholds.length || activityPowerIntervals.length || activityRunIntervals.length || athleteProfileContext.length || athleteThresholdSuggestions.length);
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


function thresholdSuggestionTitle(row){
  const type = String(row?.threshold_type || '');
  const map = {
    bike_threshold_hr_bpm: 'Rower — HR progowe',
    eftp_bike_observed: 'Rower — eFTP',
    ftp_bike_declared_old: 'Rower — FTP',
    run_threshold_pace_sec_per_km: 'Bieg — tempo progowe',
    run_threshold_hr_bpm: 'Bieg — HR progowe',
    swim_css_sec_per_100m: 'Pływanie — CSS',
    swim_threshold_pace_sec_per_100m: 'Pływanie — tempo progowe',
    swim_race_pace_sec_per_100m: 'Pływanie — tempo startowe',
    body_weight_estimated: 'Profil — masa ciała',
    hr_max_observed_bpm: 'Profil — HR max',
    resting_hr_observed_bpm: 'Profil — resting HR'
  };
  return map[type] || `${String(row?.sport || 'profil').toUpperCase()} — ${type || 'próg'}`;
}

function thresholdSuggestionValue(row){
  if(!row) return 'brak danych';
  const unit = String(row.unit || '').trim();
  const working = row.suggested_value_working;
  const min = row.suggested_value_min;
  const max = row.suggested_value_max;
  if(unit === 'sec/km'){
    const main = paceTextFromSec(working);
    const range = min != null || max != null ? `zakres ${paceTextFromSec(min)} – ${paceTextFromSec(max)}` : '';
    return [main, range].filter(Boolean).join(' · ');
  }
  if(unit === 'sec/100m'){
    const fmt = value => {
      const n = Number(value);
      if(!Number.isFinite(n)) return 'brak danych';
      const rounded = Math.round(n);
      return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}/100m`;
    };
    const main = fmt(working);
    const range = min != null || max != null ? `zakres ${fmt(min)} – ${fmt(max)}` : '';
    return [main, range].filter(Boolean).join(' · ');
  }
  const digits = unit === 'kg' ? 1 : 0;
  const main = `${fmtNumber(working, digits)} ${unit}`.trim();
  const range = min != null || max != null ? `zakres ${fmtNumber(min, digits)} – ${fmtNumber(max, digits)} ${unit}`.trim() : '';
  return [main, range].filter(Boolean).join(' · ');
}

function renderThresholdSuggestions(){
  const countEl = $('thresholdSuggestionCount');
  const listEl = $('thresholdSuggestionList');
  const statusEl = $('thresholdSuggestionStatus');
  if(!countEl || !listEl || !statusEl) return;

  const rows = Array.isArray(athleteThresholdSuggestions) ? athleteThresholdSuggestions : [];
  countEl.textContent = rows.length ? `${rows.length} pending` : 'brak pending';

  if(viewState.thresholdSuggestions === 'loading'){
    listEl.innerHTML = '<div class="muted-card">Pobieram propozycje progów...</div>';
    statusEl.textContent = 'Ładowanie propozycji progów.';
    statusEl.className = 'status info';
    return;
  }

  if(viewState.thresholdSuggestions === 'error'){
    listEl.innerHTML = '<div class="muted-card">Nie udało się pobrać propozycji progów.</div>';
    statusEl.textContent = 'Błąd odczytu athlete_threshold_suggestions_context.';
    statusEl.className = 'status bad';
    return;
  }

  if(!rows.length){
    listEl.innerHTML = '<div class="muted-card">Brak propozycji do decyzji. Automat nadal obserwuje dane.</div>';
    if(thresholdActionFeedback){
      statusEl.textContent = thresholdActionFeedback.text;
      statusEl.className = `status ${thresholdActionFeedback.type}`;
    }else{
      statusEl.textContent = 'Brak aktywnych propozycji. Confirmed progi nie są nadpisywane automatycznie.';
      statusEl.className = 'status ok';
    }
    return;
  }

  listEl.innerHTML = rows.map(row => {
    const confidence = row.confidence || 'brak';
    const reason = row.reason || row.coach_comment || 'brak uzasadnienia';
    const isBusyCard = thresholdActionBusy && String(thresholdActionBusyId) === String(row.id);
    const approveLabel = isBusyCard && thresholdActionBusyDecision === 'approve' ? 'Przetwarzam…' : 'Akceptuj';
    const rejectLabel = isBusyCard && thresholdActionBusyDecision === 'reject' ? 'Przetwarzam…' : 'Odrzuć';
    return `
      <article class="threshold-suggestion-card" data-suggestion-id="${escapeHtml(row.id)}">
        <div class="threshold-suggestion-top">
          <div>
            <h3>${escapeHtml(thresholdSuggestionTitle(row))}</h3>
            <p>${escapeHtml(row.ai_decision_note || 'Propozycja czeka na akceptację.')}</p>
          </div>
          <span>${escapeHtml(confidence)}</span>
        </div>
        <div class="threshold-suggestion-value">${escapeHtml(thresholdSuggestionValue(row))}</div>
        <p class="threshold-suggestion-reason">${escapeHtml(reason)}</p>
        <div class="threshold-suggestion-actions">
          <button class="primary-btn threshold-approve-btn" type="button" data-action="approve" ${thresholdActionBusy ? 'disabled' : ''}>${approveLabel}</button>
          <button class="secondary-btn threshold-reject-btn" type="button" data-action="reject" ${thresholdActionBusy ? 'disabled' : ''}>${rejectLabel}</button>
        </div>
      </article>
    `;
  }).join('');

  if(thresholdActionFeedback){
    statusEl.textContent = thresholdActionFeedback.text;
    statusEl.className = `status ${thresholdActionFeedback.type}`;
  }else{
    statusEl.textContent = 'Propozycje czekają na decyzję. Akceptacja wpisze próg do profilu, odrzucenie tylko zamknie propozycję.';
    statusEl.className = 'status warn';
  }
}

async function decideThresholdSuggestion(id, decision){
  const suggestion = athleteThresholdSuggestions.find(item => String(item.id) === String(id));
  if(!suggestion || thresholdActionBusy) return;
  const isApprove = decision === 'approve';
  const title = thresholdSuggestionTitle(suggestion);
  const value = thresholdSuggestionValue(suggestion);
  const message = isApprove
    ? `Zaakceptować propozycję progu?\n\n${title}\n${value}\n\nPo akceptacji próg zostanie wpisany do profilu.`
    : `Odrzucić propozycję progu?\n\n${title}\n${value}\n\nPropozycja zostanie oznaczona jako rejected.`;
  if(!window.confirm(message)) return;

  thresholdActionBusy = true;
  thresholdActionBusyId = String(id);
  thresholdActionBusyDecision = decision;
  thresholdActionFeedback = {
    type: 'info',
    text: isApprove ? 'Przetwarzam akceptację propozycji progu…' : 'Przetwarzam odrzucenie propozycji progu…'
  };
  renderThresholdSuggestions();
  try{
    await apiPost(isApprove ? APPROVE_THRESHOLD_RPC : REJECT_THRESHOLD_RPC, {
      p_suggestion_id: id,
      p_decided_by: 'szymon_app',
      p_decision_note: isApprove ? 'Zaakceptowano w aplikacji Szymon AI Coach PRO.' : 'Odrzucono w aplikacji Szymon AI Coach PRO.'
    });
    thresholdActionFeedback = {
      type: 'ok',
      text: isApprove ? 'Zaakceptowano propozycję i odświeżono progi.' : 'Odrzucono propozycję i odświeżono listę.'
    };
    await loadAllData();
  }catch(err){
    thresholdActionFeedback = {
      type: 'bad',
      text: `Nie udało się wykonać decyzji: ${String(err?.message || err).slice(0, 220)}`
    };
    console.warn('Błąd decyzji progu', err);
  }finally{
    thresholdActionBusy = false;
    thresholdActionBusyId = '';
    thresholdActionBusyDecision = '';
    renderThresholdSuggestions();
  }
}

function handleThresholdSuggestionClick(event){
  const button = event.target.closest('[data-action]');
  if(!button) return;
  const card = event.target.closest('[data-suggestion-id]');
  if(!card) return;
  decideThresholdSuggestion(card.dataset.suggestionId, button.dataset.action);
}


function latestProActivity(){
  return Array.isArray(proActivities) && proActivities.length ? proActivities[0] : null;
}

function isProActivityRow(item){
  return Boolean(item && Object.prototype.hasOwnProperty.call(item, 'distance_meters') && Object.prototype.hasOwnProperty.call(item, 'duration_seconds'));
}

function proActivityKey(item){
  return String(item?.garmin_activity_id || item?.workout_id || item?.id || '');
}

function proActivityForActivity(activity){
  if(!activity) return null;
  const garminId = String(activity.garmin_activity_id || activity.activity_id || '').trim();
  const workoutId = String(activity.id || activity.workout_id || '').trim();
  return (proActivities || []).find(row => {
    return (garminId && String(row.garmin_activity_id || '') === garminId)
      || (workoutId && String(row.workout_id || '') === workoutId)
      || (workoutId && String(row.id || '') === workoutId);
  }) || null;
}

function proSegmentsForActivity(activityOrPro){
  const pro = isProActivityRow(activityOrPro) ? activityOrPro : proActivityForActivity(activityOrPro);
  if(!pro?.id) return [];
  return (proSegments || [])
    .filter(row => String(row.activity_id || '') === String(pro.id))
    .sort((a, b) => Number(a.segment_order || 0) - Number(b.segment_order || 0));
}

function proAnalyticsForActivity(activityOrPro){
  const pro = isProActivityRow(activityOrPro) ? activityOrPro : proActivityForActivity(activityOrPro);
  if(!pro?.id) return null;
  return (proAnalytics || []).find(row => String(row.activity_id || '') === String(pro.id)) || null;
}

function segmentTitle(type){
  const key = String(type || '').toLowerCase();
  return {
    swim: 'Pływanie',
    t1: 'T1',
    bike: 'Rower',
    t2: 'T2',
    run: 'Bieg',
    other: 'Inne'
  }[key] || sportLabel(key);
}

function segmentIcon(type){
  const key = String(type || '').toLowerCase();
  return { swim: '🌊', t1: '↗', bike: '🚴', t2: '↘', run: '🏃', other: '◆' }[key] || '◆';
}

function fmtSecToMin(value){
  const n = Number(value);
  if(!Number.isFinite(n)) return 'brak danych';
  const min = n / 60;
  return min < 10 ? `${fmtNumber(min, 1)} min` : `${Math.round(min).toLocaleString('pl-PL')} min`;
}

function fmtMetersAsKm(value){
  const n = Number(value);
  if(!Number.isFinite(n)) return 'brak danych';
  if(n < 1000) return `${Math.round(n).toLocaleString('pl-PL')} m`;
  return `${fmtNumber(n / 1000, 2)} km`;
}

function fmtPaceSec(value, unit = 'km'){
  const n = Number(value);
  if(!Number.isFinite(n) || n <= 0) return 'brak danych';
  const m = Math.floor(n / 60);
  const s = Math.round(n % 60);
  return `${m}:${String(s).padStart(2, '0')}/${unit}`;
}

function segmentPaceText(segment){
  if(!segment) return 'brak danych';
  if(segment.segment_type === 'run'){
    if(segment.pace_avg_sec_per_km) return fmtPaceSec(segment.pace_avg_sec_per_km, 'km');
    const distKm = Number(segment.distance_meters) / 1000;
    const sec = Number(segment.duration_seconds || segment.elapsed_time_seconds);
    if(Number.isFinite(distKm) && distKm > 0 && Number.isFinite(sec)) return fmtPaceSec(sec / distKm, 'km');
  }
  if(segment.segment_type === 'swim'){
    const meters = Number(segment.distance_meters);
    const sec = Number(segment.duration_seconds || segment.elapsed_time_seconds);
    if(Number.isFinite(meters) && meters > 0 && Number.isFinite(sec)) return fmtPaceSec(sec / (meters / 100), '100m');
  }
  return 'brak danych';
}

function proIntensityTitle(pro, analytics, segments){
  const bike = segments.find(s => s.segment_type === 'bike');
  const run = segments.find(s => s.segment_type === 'run');
  const ifValue = Number(analytics?.bike_if_value ?? bike?.intensity_factor ?? pro?.intensity_factor);
  const load = Number(pro?.training_load);
  if(pro?.is_multisport && Number.isFinite(ifValue) && ifValue >= 0.93){
    return 'Krótki, mocny start. Największy koszt zrobił rower, a bieg pokazał cenę tej intensywności.';
  }
  if(pro?.is_multisport){
    return 'Start dał czytelny bodziec triathlonowy: ważne jest nie tylko tempo, ale koszt przejścia z roweru na bieg.';
  }
  if(String(pro?.activity_type || '').includes('running')){
    return Number.isFinite(load) && load >= 120
      ? 'Bieg był konkretnym bodźcem. Ocena zależy od tempa, tętna i odpowiedzi organizmu po nocy.'
      : 'Bieg wygląda kontrolowanie. Najważniejsze jest, czy utrzymał jakość bez nadmiernego kosztu.';
  }
  if(String(pro?.activity_type || '').includes('cycling')){
    return 'Rower oceniamy przez moc, tętno i stabilność. Sam dystans nie wystarcza do dobrej decyzji.';
  }
  return 'Ten trening oceniamy przez bodziec, koszt i reakcję organizmu — nie przez pojedynczą liczbę.';
}

function proCostTitle(pro, analytics, segments){
  const load = Number(pro?.training_load);
  const hrMax = Number(pro?.hr_max);
  const hrAvg = Number(pro?.hr_avg);
  const ifValue = Number(analytics?.bike_if_value ?? pro?.intensity_factor);
  const tooHard = String(analytics?.bike_if_category || '').includes('too_hard') || ifValue >= 0.93;
  const isRun = String(pro?.sport_type || pro?.activity_type || '').toLowerCase().includes('run') || segments.some(s => s.segment_type === 'run');
  if(tooHard) return 'Koszt: wysoki, ale czytelny. W przygotowaniu do 226 km pilnujemy, żeby rower nie zabrał biegu.';

  const sport = sportKeyForItem(pro);
  const baseline = buildAthleteBaseline(sport);
  if(baseline.hasEnough && Number.isFinite(load)){
    const tier = classifyAgainstBaseline(load, baseline).tier;
    const overnight = kalmarOvernightResponseForSimilar(sport, load, baseline);
    const note = athleteBaselineNote(tier, overnight);
    const typical = `${fmtNumber(baseline.p25)}–${fmtNumber(baseline.p75)}`;
    if(tier === 'over'){
      return `Koszt: powyżej Twojej aktualnej tolerancji (load ${fmtNumber(load)} vs typowe ${typical}). Następny mocny akcent czeka na poranek.${note}`;
    }
    if(tier === 'elevated'){
      return `Koszt: podwyższony bodziec względem ostatnich tygodni (load ${fmtNumber(load)} vs typowe ${typical}), ale nadal w granicach pracy.${note}`;
    }
    return `Koszt: normalny bodziec roboczy dla Twojego aktualnego poziomu (load ${fmtNumber(load)}, typowo ${typical}). To nie jest alarm.${note}`;
  }

  if(Number.isFinite(load) && load >= 250) return 'Koszt: duży bodziec. Dla Szymona to nie panika, ale następny mocny akcent musi poczekać na odpowiedź po nocy.';
  if(isRun && Number.isFinite(load) && load >= 120 && load < 180 && (!Number.isFinite(hrMax) || hrMax < 178) && (!Number.isFinite(hrAvg) || hrAvg < 158)){
    return 'Koszt: konkretny, ale kontrolowany bodziec. Dla Szymona to nie alarm — poranek pokaże, jak szybko wracamy do pracy.';
  }
  if(Number.isFinite(load) && load >= 120) return 'Koszt: solidny bodziec roboczy. Nie dramatyzujemy, ale kolejny krok zależy od snu, energii i tętna spoczynkowego.';
  if(Number.isFinite(hrMax) && hrMax >= 180) return 'Koszt głównie sercowo-naczyniowy. Tętno weszło wysoko, więc jutro liczy się kontrola reakcji, nie straszenie odpoczynkiem.';
  return 'Koszt wygląda spokojniej. Pełną ocenę daje dopiero poranek po treningu i odczucie zawodnika.';
}

function proSegmentSummary(pro, segments, analytics){
  if(!segments.length) return 'Brak segmentów PRO dla tej aktywności — pokazuję tylko podsumowanie główne.';
  if(pro?.is_multisport){
    const bike = segments.find(s => s.segment_type === 'bike');
    const run = segments.find(s => s.segment_type === 'run');
    const ifValue = Number(bike?.intensity_factor ?? analytics?.bike_if_value);
    if(Number.isFinite(ifValue) && ifValue >= 0.93) return 'Start był czytelny: pływanie otworzyło pracę, rower poszedł bardzo mocno, a bieg pokazał cenę tej intensywności.';
    return 'Start był równy i czytelny: segmenty pozwalają ocenić nie tylko wynik, ale koszt przejść między dyscyplinami.';
  }
  const type = segments[0]?.segment_type;
  if(type === 'bike') return 'Rower analizujemy przez moc, tętno i stabilność. Przy równych odcinkach ważniejsza jest kontrola niż sztuczne szukanie skrajności.';
  if(type === 'run') return 'Bieg analizujemy przez tempo, tętno i koszt. Pojedyncze tempo bez HR nie wystarcza do oceny jakości.';
  if(type === 'swim') return 'Pływanie analizujemy przez rytm, ekonomię i powtarzalność, nie tylko sam dystans.';
  return 'Segmenty PRO porządkują aktywność i pozwalają oddzielić bodziec od kosztu.';
}


function proContextForActivity(pro){
  if(!pro) return null;
  const garminId = String(pro.garmin_activity_id || '').trim();
  const workoutId = String(pro.workout_id || '').trim();
  const proId = String(pro.id || '').trim();
  return (activityContexts || []).find(record => {
    return (garminId && String(record.garmin_activity_id || '').trim() === garminId)
      || (workoutId && String(record.workout_id || record.activity_id || '').trim() === workoutId)
      || (proId && String(record.activity_id || '').trim() === proId);
  }) || null;
}

function proDailyForOffset(pro, offset){
  const context = proContextForActivity(pro);
  const baseDate = fmtDateIso(context?.workout_date || pro?.workout_date || pro?.started_at);
  if(!baseDate) return null;
  const targetDate = addDaysIso(baseDate, offset);
  if(!targetDate) return null;
  const dailyWindow = parseJsonArray(context?.daily_metrics_window);
  return metricForDate(dailyWindow, targetDate);
}

function proBeforeText(pro){
  const daily = proDailyForOffset(pro, 0) || readiness || null;
  if(!daily){
    return 'Brakuje pełnego stanu przed treningiem, więc oceniamy ostrożnie: najpierw bodziec, potem reakcja organizmu po nocy.';
  }
  const readinessScore = daily.training_readiness_score != null ? Math.round(Number(daily.training_readiness_score)) : null;
  const sleep = daily.sleep_minutes != null ? fmtMin(daily.sleep_minutes) : null;
  const battery = daily.body_battery_end ?? daily.body_battery_start ?? null;
  const stress = daily.avg_stress != null ? Math.round(Number(daily.avg_stress)) : null;
  const lowReadiness = readinessScore != null && readinessScore < 45;
  const shortSleep = Number(daily.sleep_minutes) > 0 && Number(daily.sleep_minutes) < 360;
  if(lowReadiness || shortSleep){
    return 'Szymon nie wchodził w ten trening idealnie świeży. To nie blokuje pracy, ale zwiększa znaczenie kontroli po wysiłku.';
  }
  if(readinessScore != null || sleep || battery != null || stress != null){
    return 'Szymon wszedł w trening z czytelnym kontekstem regeneracji. Patrzymy na wykonanie, koszt i reakcję po nocy — bez oceniania go jak początkującego.';
  }
  return 'Stan przed treningiem jest częściowy. Analiza opiera się na dostępnych danych i nie dopowiada braków.';
}

function proBeforeControlLine(pro){
  const daily = proDailyForOffset(pro, 0) || readiness || null;
  if(!daily) return 'Sen brak danych • Body Battery brak danych • Stress brak danych • gotowość brak danych';
  const sleep = daily.sleep_minutes != null ? fmtMin(daily.sleep_minutes) : 'brak danych';
  const battery = daily.body_battery_end ?? daily.body_battery_start;
  const stress = daily.avg_stress != null ? Math.round(Number(daily.avg_stress)) : null;
  const readinessScore = daily.training_readiness_score != null ? Math.round(Number(daily.training_readiness_score)) : null;
  return `Sen ${sleep} • Body Battery ${battery ?? 'brak danych'} • Stress ${stress ?? 'brak danych'} • gotowość ${readinessScore != null ? `${readinessScore}/100` : 'brak danych'}`;
}

function proTrainingTypeLabel(pro){
  if(pro?.is_multisport) return 'Race';
  const type = String(pro?.sport_type || pro?.activity_type || '').toLowerCase();
  if(type.includes('run')) return 'Bieg';
  if(type.includes('cycl') || type.includes('bike')) return 'Rower';
  if(type.includes('swim')) return 'Pływanie';
  return sportLabel(type || 'Trening');
}

function proRecoveryStatus(pro){
  const activityDate = fmtDateIso(pro?.workout_date || pro?.started_at);
  const tomorrow = addDaysIso(activityDate, 1);
  const after = proDailyForOffset(pro, 1);
  const hasRecoveryData = Boolean(after && (
    after.sleep_minutes != null
    || after.body_battery_end != null
    || after.body_battery_start != null
    || after.avg_stress != null
    || after.resting_hr != null
    || after.training_readiness_score != null
    || after.hrv_status != null
    || after.hrv_avg != null
  ));

  if(hasRecoveryData){
    const sleep = after.sleep_minutes != null ? fmtMin(after.sleep_minutes) : 'brak danych';
    const battery = after.body_battery_end ?? after.body_battery_start ?? 'brak danych';
    const stress = after.avg_stress != null ? Math.round(Number(after.avg_stress)) : 'brak danych';
    const rhr = after.resting_hr != null ? Math.round(Number(after.resting_hr)) : 'brak danych';
    const readinessScore = after.training_readiness_score != null ? `${Math.round(Number(after.training_readiness_score))}/100` : 'brak danych';
    const hrv = after.hrv_status || (after.hrv_avg != null ? `${fmtNumber(after.hrv_avg)} ms` : 'brak danych');
    const readinessN = Number(after.training_readiness_score);
    const sleepN = Number(after.sleep_minutes);
    const stressN = Number(after.avg_stress);
    let title = 'Po tej nocy można już uczciwie ocenić koszt regeneracji po treningu.';
    if(Number.isFinite(readinessN) && readinessN <= 35){
      title = 'Poranek po treningu pokazuje wyraźny koszt — dziś nie dokładamy jakości, tylko kontrolujemy powrót do pracy.';
    }else if(Number.isFinite(sleepN) && sleepN < 360){
      title = 'Dane z kolejnej nocy są dostępne, ale krótki sen każe kontrolować kolejny bodziec.';
    }else if(Number.isFinite(stressN) && stressN <= 30){
      title = 'Dane z kolejnej nocy są spokojne — bodziec wygląda przyjęty, można planować kolejny krok bez dramatyzowania.';
    }
    return {
      status: 'Odpowiedź gotowa',
      title,
      text: `Sen ${sleep} • Body Battery ${battery} • Stress ${stress} • tętno spoczynkowe ${rhr} • gotowość ${readinessScore} • HRV ${hrv}.`
    };
  }

  return {
    status: 'Czeka na dane',
    title: 'Brak danych z kolejnej nocy — pełna ocena kosztu regeneracji nie jest jeszcze możliwa.',
    text: tomorrow
      ? `Czekam na poranek po treningu (${fmtDate(tomorrow)}): sen brak danych • Body Battery brak danych • stress brak danych • tętno spoczynkowe brak danych • gotowość brak danych.`
      : 'Czekam na poranek po treningu: sen brak danych • Body Battery brak danych • stress brak danych • tętno spoczynkowe brak danych • gotowość brak danych.'
  };
}

function proControlNumbers(pro, analytics, segments){
  const hr = pro?.hr_avg || pro?.hr_max ? `${pro?.hr_avg ? Math.round(Number(pro.hr_avg)) : 'brak'} / ${pro?.hr_max ? Math.round(Number(pro.hr_max)) : 'brak'}` : 'brak';
  const load = pro?.training_load != null ? fmtNumber(pro.training_load) : 'brak';
  const ifValue = analytics?.bike_if_value ?? pro?.intensity_factor;
  const ifText = ifValue != null ? fmtIf(ifValue) : 'brak';
  const te = pro?.training_effect_aerobic != null || pro?.training_effect_anaerobic != null
    ? `${pro?.training_effect_aerobic != null ? fmtEffect(pro.training_effect_aerobic) : 'brak'} / ${pro?.training_effect_anaerobic != null ? fmtEffect(pro.training_effect_anaerobic) : 'brak'}`
    : 'brak';
  return { hr, load, ifText, te };
}

function renderProSegmentMini(segment){
  if(!segment) return '';
  const type = segment.segment_type;
  const title = segmentTitle(type);
  const icon = segmentIcon(type);
  const distance = fmtMetersAsKm(segment.distance_meters);
  const time = fmtSecToMin(segment.duration_seconds || segment.elapsed_time_seconds);
  const details = [];
  if(type === 'bike'){
    if(segment.power_norm_w != null) details.push(`NP ${Math.round(Number(segment.power_norm_w))} W`);
    if(segment.intensity_factor != null) details.push(`IF ${fmtIf(segment.intensity_factor)}`);
  }else if(type === 'run' || type === 'swim'){
    const pace = segmentPaceText(segment);
    if(pace !== 'brak danych') details.push(pace);
  }
  if(!details.length && segment.hr_avg != null) details.push(`HR ${Math.round(Number(segment.hr_avg))}`);
  return `
    <article class="pro-mini-segment pro-mini-${escapeHtml(type)}">
      <b>${icon} ${escapeHtml(title)}</b>
      <span>${escapeHtml(distance)} • ${escapeHtml(time)}</span>
      <em>${escapeHtml(details.join(' • ') || 'dane PRO')}</em>
    </article>
  `;
}

function renderProSegmentRows(segments){
  if(!segments.length) return '<div class="pro-empty-line">Brak segmentów PRO dla tej aktywności.</div>';
  return segments.map(segment => {
    const type = segment.segment_type;
    const line = [
      fmtMetersAsKm(segment.distance_meters),
      fmtSecToMin(segment.duration_seconds || segment.elapsed_time_seconds),
      segment.hr_avg != null ? `HR ${Math.round(Number(segment.hr_avg))}` : '',
      type === 'bike' && segment.power_norm_w != null ? `NP ${Math.round(Number(segment.power_norm_w))} W` : '',
      type === 'bike' && segment.intensity_factor != null ? `IF ${fmtIf(segment.intensity_factor)}` : '',
      type === 'run' || type === 'swim' ? segmentPaceText(segment) : ''
    ].filter(Boolean).join(' • ');
    return `
      <details class="pro-segment-row pro-segment-${escapeHtml(type)}">
        <summary><span>${segmentIcon(type)} ${escapeHtml(segmentTitle(type))}</span><em>${escapeHtml(line)}</em></summary>
        <div class="pro-segment-detail-grid">
          <div><span>Dystans</span><b>${escapeHtml(fmtMetersAsKm(segment.distance_meters))}</b></div>
          <div><span>Czas</span><b>${escapeHtml(fmtSecToMin(segment.duration_seconds || segment.elapsed_time_seconds))}</b></div>
          <div><span>HR avg/max</span><b>${escapeHtml(segment.hr_avg || segment.hr_max ? `${segment.hr_avg ? Math.round(Number(segment.hr_avg)) : 'brak'} / ${segment.hr_max ? Math.round(Number(segment.hr_max)) : 'brak'}` : 'brak')}</b></div>
          <div><span>Moc / NP</span><b>${escapeHtml(segment.power_avg_w || segment.power_norm_w ? `${segment.power_avg_w ? Math.round(Number(segment.power_avg_w)) : 'brak'} / ${segment.power_norm_w ? Math.round(Number(segment.power_norm_w)) : 'brak'} W` : 'brak')}</b></div>
          <div><span>IF / EF</span><b>${escapeHtml(segment.intensity_factor || segment.efficiency_factor ? `${segment.intensity_factor ? fmtIf(segment.intensity_factor) : 'brak'} / ${segment.efficiency_factor ? fmtEf(segment.efficiency_factor) : 'brak'}` : 'brak')}</b></div>
          <div><span>Kadencja</span><b>${escapeHtml(segment.cadence_avg || segment.stroke_rate_avg ? `${segment.cadence_avg || segment.stroke_rate_avg}` : 'brak')}</b></div>
        </div>
      </details>
    `;
  }).join('');
}

function renderProActivityAnalysisShell(activityOrPro, options = {}){
  const pro = isProActivityRow(activityOrPro) ? activityOrPro : (proActivityForActivity(activityOrPro) || null);
  const fallbackActivity = activityOrPro && !activityOrPro.garmin_activity_id ? activityOrPro : null;
  if(!pro){
    const name = fallbackActivity ? activityName(fallbackActivity) : 'Aktywność Garmin PRO';
    return `
      <button class="secondary-btn back-btn pro-back-btn" type="button">Wróć do historii</button>
      <section class="pro-analysis-screen">
        <div class="pro-analysis-hero">
          <span class="eyebrow">ROAD TO KALMAR 2026</span>
          <h2>Analiza treningu</h2>
          <p>${escapeHtml(name)}</p>
        </div>
        <article class="pro-analysis-card pro-warning-card">
          <div class="pro-card-icon">!</div>
          <div>
            <h3>Brak danych PRO dla tej aktywności</h3>
            <p>Pokazuję analizę podstawową. Pełny ekran PRO pojawi się, gdy Garmin Sync zapisze aktywność do nowych tabel.</p>
          </div>
        </article>
        <div class="activity-ai-analysis">${renderAnalysisBlock('Analiza podstawowa', buildActivityAiAnalysis(fallbackActivity).headline)}</div>
      </section>
    `;
  }

  const segments = proSegmentsForActivity(pro);
  const analytics = proAnalyticsForActivity(pro);
  const swim = segments.find(s => s.segment_type === 'swim');
  const bike = segments.find(s => s.segment_type === 'bike');
  const run = segments.find(s => s.segment_type === 'run');
  const primarySegments = [swim, bike, run].filter(Boolean);
  const controls = proControlNumbers(pro, analytics, segments);
  const recovery = proRecoveryStatus(pro);
  const badge = proTrainingTypeLabel(pro);
  const title = pro.event_name || pro.activity_name || activityName(fallbackActivity) || 'Aktywność Garmin PRO';
  const date = fmtDate(pro.workout_date || pro.started_at);
  const distance = fmtMetersAsKm(pro.distance_meters);
  const duration = fmtSecToMin(pro.duration_seconds || pro.elapsed_time_seconds);
  const beforeLine = proBeforeControlLine(pro);
  const beforeText = proBeforeText(pro);
  const costTitle = proCostTitle(pro, analytics, segments);
  const stimulusTitle = proIntensityTitle(pro, analytics, segments);
  const segmentSummary = proSegmentSummary(pro, segments, analytics);
  const nextText = analytics?.auto_summary || (pro.is_multisport
    ? 'Dobry materiał do nauki startowej. Najważniejsze jest teraz połączenie mocy na rowerze z biegiem bez nadmiernego kosztu.'
    : 'Ten trening ma sens dopiero w połączeniu z regeneracją i kolejnymi jednostkami. Patrzymy na kierunek, nie jedną liczbę.');

  return `
    <button class="secondary-btn back-btn pro-back-btn" type="button">Wróć do historii</button>
    <section class="pro-analysis-screen">
      <header class="pro-analysis-hero">
        <div>
          <span class="eyebrow">ROAD TO KALMAR 2026</span>
          <h2>Analiza treningu</h2>
          <p>${escapeHtml(title)} • ${escapeHtml(date)}</p>
        </div>
        <span class="pro-race-badge">🏁 ${escapeHtml(badge)}</span>
        <div class="pro-hero-line"><i></i></div>
      </header>

      <article class="pro-analysis-card pro-before-card">
        <div class="pro-card-icon">☼</div>
        <div class="pro-card-body">
          <h3>STAN PRZED</h3>
          <p>${escapeHtml(beforeText)}</p>
          <div class="pro-chip-row"><span>${escapeHtml(beforeLine)}</span></div>
        </div>
      </article>

      <article class="pro-analysis-card pro-stimulus-card">
        <div class="pro-card-icon orange">⚡</div>
        <div class="pro-card-body">
          <h3>BODZIEC</h3>
          <p>${escapeHtml(stimulusTitle)}</p>
          <div class="pro-mini-segment-grid">
            ${primarySegments.length ? primarySegments.map(renderProSegmentMini).join('') : `<article class="pro-mini-segment"><b>◆ Aktywność</b><span>${escapeHtml(distance)} • ${escapeHtml(duration)}</span><em>Load ${escapeHtml(controls.load)}</em></article>`}
          </div>
        </div>
      </article>

      <article class="pro-analysis-card pro-segments-card">
        <div class="pro-card-icon blue">▥</div>
        <div class="pro-card-body">
          <h3>SEGMENTY</h3>
          <p>${escapeHtml(segmentSummary)}</p>
          <div class="pro-segment-list">${renderProSegmentRows(segments)}</div>
          <small>ⓘ Przy równych odcinkach AI pokazuje stabilność, nie poluje na sztuczne skrajności.</small>
        </div>
      </article>

      <article class="pro-analysis-card pro-cost-card">
        <div class="pro-card-icon orange">⚖</div>
        <div class="pro-card-body">
          <h3>KOSZT</h3>
          <p>${escapeHtml(costTitle)}</p>
          <div class="pro-control-row">
            <span>Load <b>${escapeHtml(controls.load)}</b></span>
            <span>HR <b>${escapeHtml(controls.hr)}</b></span>
            <span>IF <b>${escapeHtml(controls.ifText)}</b></span>
            <span>TE <b>${escapeHtml(controls.te)}</b></span>
          </div>
          <small>🛡 Decyzja AI i liczby kontrolne są zawsze pokazane razem.</small>
        </div>
      </article>

      <article class="pro-analysis-card pro-night-card">
        <div class="pro-card-icon yellow">☾</div>
        <div class="pro-card-body">
          <div class="pro-card-title-row"><h3>ODPOWIEDŹ PO NOCY</h3><span class="pro-waiting-badge">⌛ ${escapeHtml(recovery.status)}</span></div>
          <p>${escapeHtml(recovery.title)}</p>
          <small>${escapeHtml(recovery.text)}</small>
        </div>
      </article>

      <article class="pro-analysis-card pro-next-card">
        <div class="pro-card-icon blue">◎</div>
        <div class="pro-card-body">
          <h3>CO DALEJ</h3>
          <p>${escapeHtml(nextText)}</p>
          <div class="pro-action-row">
            <button class="secondary-btn pro-ai-full-btn" type="button">✦ Pełna analiza AI</button>
            <button class="secondary-btn pro-ai-chat-btn" type="button">☵ Zapytaj AI Coacha</button>
          </div>
        </div>
      </article>
    </section>
  `;
}

function renderAnalysis(){
  const target = $('proAnalysisMain');
  if(!target) return;
  const pro = latestProActivity();
  target.innerHTML = renderProActivityAnalysisShell(pro || latest, { back: false }).replace(/<button class="secondary-btn back-btn pro-back-btn" type="button">Wróć do historii<\/button>/, '');
  bindProAnalysisButtons(target);
}

function bindProAnalysisButtons(root){
  const back = root.querySelector('.pro-back-btn');
  if(back) back.addEventListener('click', closeActivityDetails);
  const full = root.querySelector('.pro-ai-full-btn');
  if(full) full.addEventListener('click', () => {
    aiMode = 'analysis';
    showTab('ai');
  });
  const chat = root.querySelector('.pro-ai-chat-btn');
  if(chat) chat.addEventListener('click', () => showTab('ai'));
}

function renderDashboard(){
  const decision = buildLocalTodayCoach();
  renderHumanCoachDashboard(decision);
  renderKalmarFocusCard();

  const guardedScore = morningMetricValue('readiness', readiness?.training_readiness_score);
  const guardedSleep = morningMetricValue('sleep', readiness?.sleep_minutes);
  const guardedBatteryEnd = morningMetricValue('battery', readiness?.body_battery_end);
  const guardedBatteryStart = morningMetricValue('battery', readiness?.body_battery_start);
  const morningIncomplete = morningDataIncomplete();

  if($('readinessScore')) $('readinessScore').textContent = (!morningIncomplete && guardedScore != null) ? `${Math.round(guardedScore)}/100` : 'brak pełnych danych';
  if($('sleepValue')) $('sleepValue').textContent = (!morningIncomplete && guardedSleep != null) ? fmtMin(guardedSleep) : 'brak pełnych danych';
  if($('batteryValue')) $('batteryValue').textContent = (!morningIncomplete && (guardedBatteryStart != null || guardedBatteryEnd != null))
    ? `${guardedBatteryStart != null ? fmtNumber(guardedBatteryStart) : 'brak'} → ${guardedBatteryEnd != null ? fmtNumber(guardedBatteryEnd) : 'brak'}`
    : 'brak pełnych danych';
  if($('load7dValue')) $('load7dValue').textContent = weeklyLoadValue() != null ? fmtNumber(weeklyLoadValue()) : 'brak danych';

  if($('weekRange')) $('weekRange').textContent = weekly?.week_start || weekly?.week_end ? `${fmtDate(weekly.week_start)} – ${fmtDate(weekly.week_end)}` : 'brak danych';
  if($('weekSwim')) $('weekSwim').textContent = `${fmtKm(weekly?.swim_distance_km)} / ${fmtMin(weekly?.swim_duration_min)}`;
  if($('weekBike')) $('weekBike').textContent = `${fmtKm(weekly?.bike_distance_km)} / ${fmtMin(weekly?.bike_duration_min)}`;
  if($('weekRun')) $('weekRun').textContent = `${fmtKm(weekly?.run_distance_km)} / ${fmtMin(weekly?.run_duration_min)}`;
  if($('weekLoad')) $('weekLoad').textContent = weekly?.total_training_load != null ? fmtNumber(weekly.total_training_load) : 'brak danych';
  renderActivityInto('latestActivity', latest);
}


function historySportKey(item){
  const raw = `${item?.sport_type || ''} ${item?.activity_type || ''} ${item?.event_name || ''}`.toLowerCase();
  if(raw.includes('triathlon') || raw.includes('multi_sport') || raw.includes('multisport')) return 'triathlon';
  if(raw.includes('swim') || raw.includes('pły') || raw.includes('ply')) return 'swim';
  if(raw.includes('bike') || raw.includes('cycling') || raw.includes('rower')) return 'bike';
  if(raw.includes('run') || raw.includes('bieg')) return 'run';
  return 'other';
}

function historySearchBlob(item){
  return [
    item?.event_name,
    item?.activity_name,
    item?.sport_type,
    item?.activity_type,
    item?.workout_date,
    fmtDate(item?.workout_date),
    item?.auto_summary,
    item?.segment_summary
  ].filter(Boolean).join(' ').toLowerCase();
}

function filteredHistoryCards(){
  const term = String(historySearchTerm || '').trim().toLowerCase();
  return (Array.isArray(cards) ? cards : []).filter(item => {
    const sportOk = historySportFilter === 'all' || historySportKey(item) === historySportFilter;
    const termOk = !term || historySearchBlob(item).includes(term);
    return sportOk && termOk;
  });
}

function renderHistory(){
  const allCount = Array.isArray(cards) ? cards.length : 0;
  const filtered = filteredHistoryCards();
  const hasActiveFilter = Boolean(String(historySearchTerm || '').trim()) || historySportFilter !== 'all';
  const visible = historyShowAll || hasActiveFilter ? filtered : filtered.slice(0, 6);
  $('historyStatus').textContent = allCount ? `Aktywności Garmin PRO: ${visible.length}/${filtered.length} pokazane · razem ${allCount}` : 'Brak danych Garmin PRO.';
  $('historyStatus').className = `status ${allCount ? 'ok' : 'warn'}`;
  const moreBtn = $('historyShowMoreBtn');
  if(moreBtn){
    moreBtn.hidden = hasActiveFilter || filtered.length <= 6;
    moreBtn.textContent = historyShowAll ? 'Ukryj starsze aktywności' : `Pokaż więcej aktywności (${filtered.length - 6})`;
  }
  $('activityList').innerHTML = visible.length ? visible.map(historyActivityHtml).join('') : '<div class="muted-card">Brak aktywności dla wybranego filtra.</div>';
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
  renderPlanGuide();
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
  const panel = $('thresholdSuggestionPanel');
  const toggle = $('toggleThresholdSuggestionsBtn');
  if(panel) panel.hidden = !thresholdPanelOpen;
  if(toggle){
    toggle.setAttribute('aria-expanded', thresholdPanelOpen ? 'true' : 'false');
    const count = Array.isArray(athleteThresholdSuggestions) ? athleteThresholdSuggestions.length : 0;
    toggle.textContent = thresholdPanelOpen ? 'Zwiń propozycje progów' : (count ? `Sprawdź progi (${count})` : 'Sprawdź progi');
  }
  renderThresholdSuggestions();
  renderGarminDiagnostics();
}

function renderGarminDiagnostics(){
  const incomplete = morningDataIncomplete();
  const morningDateRaw = readiness?.metric_date ? String(readiness.metric_date).slice(0, 10) : null;

  if($('diagLastRead')) $('diagLastRead').textContent = lastReadAt ? fmtDateTime(lastReadAt) : 'brak danych';

  if($('diagLastActivity')){
    if(latest){
      const name = latest.event_name || latest.activity_name || 'Aktywność Garmin';
      const sport = sportLabel(latest.sport_type || latest.activity_type);
      const date = fmtDate(latest.workout_date);
      const sportSuffix = sport && sport !== 'brak danych' && !String(name).toLowerCase().includes(String(sport).toLowerCase()) ? ` (${sport})` : '';
      $('diagLastActivity').textContent = `${date} • ${name}${sportSuffix}`;
    }else{
      $('diagLastActivity').textContent = 'brak danych';
    }
  }

  if($('diagLastMorningDay')) $('diagLastMorningDay').textContent = morningDateRaw ? fmtDate(morningDateRaw) : 'brak danych';

  const guardedSleep = morningMetricValue('sleep', readiness?.sleep_minutes);
  const guardedBatteryEnd = morningMetricValue('battery', readiness?.body_battery_end);
  const guardedBatteryStart = morningMetricValue('battery', readiness?.body_battery_start);
  const guardedReadiness = morningMetricValue('readiness', readiness?.training_readiness_score);
  const guardedRhr = morningMetricValue('rhr', readiness?.resting_hr);

  if($('diagLastSleep')) $('diagLastSleep').textContent = (!incomplete && guardedSleep != null && morningDateRaw)
    ? `${fmtDate(morningDateRaw)} • ${fmtMin(guardedSleep)}`
    : 'brak pełnych danych';

  if($('diagLastBattery')) $('diagLastBattery').textContent = (!incomplete && (guardedBatteryStart != null || guardedBatteryEnd != null) && morningDateRaw)
    ? `${fmtDate(morningDateRaw)} • ${guardedBatteryStart != null ? fmtNumber(guardedBatteryStart) : 'brak'} → ${guardedBatteryEnd != null ? fmtNumber(guardedBatteryEnd) : 'brak'}`
    : 'brak pełnych danych';

  if($('diagLastReadiness')) $('diagLastReadiness').textContent = (!incomplete && guardedReadiness != null && morningDateRaw)
    ? `${fmtDate(morningDateRaw)} • ${Math.round(guardedReadiness)}/100`
    : 'brak pełnych danych';

  if($('diagLastRhr')) $('diagLastRhr').textContent = (!incomplete && guardedRhr != null && morningDateRaw)
    ? `${fmtDate(morningDateRaw)} • ${Math.round(guardedRhr)} bpm`
    : 'brak pełnych danych';

  const baselineLabel = (sport) => {
    const b = buildAthleteBaseline(sport);
    if(!b.hasEnough) return `za mało danych do osobistego porównania (${b.count}/6 treningów)`;
    return `typowo ${fmtNumber(b.p25)}–${fmtNumber(b.p75)} load (${b.count} treningów / ${b.days} dni)`;
  };
  if($('diagBaselineRun')) $('diagBaselineRun').textContent = baselineLabel('run');
  if($('diagBaselineBike')) $('diagBaselineBike').textContent = baselineLabel('bike');
  if($('diagBaselineSwim')) $('diagBaselineSwim').textContent = baselineLabel('swim');

  const msgEl = $('garminDiagnosticMessage');
  if(msgEl){
    msgEl.classList.remove('ok', 'warn', 'bad', 'info');
    if(!morningDateRaw){
      msgEl.textContent = 'Brak pełnych danych porannych z dzisiaj — aplikacja nie udaje oceny regeneracji.';
      msgEl.classList.add('warn');
    }else{
      const isToday = morningDateRaw === todayIso();
      if(isToday && !incomplete){
        msgEl.textContent = 'Dane poranne z dzisiaj są dostępne.';
        msgEl.classList.add('ok');
      }else if(isToday && incomplete){
        msgEl.textContent = 'Brak pełnych danych porannych z dzisiaj — aplikacja nie udaje oceny regeneracji.';
        msgEl.classList.add('warn');
      }else{
        msgEl.textContent = `Ostatnie dane poranne są z: ${fmtDate(morningDateRaw)}.`;
        msgEl.classList.add('warn');
      }
    }
  }
}

function renderStatus(){
  const labels = {
    readiness: 'gotowość',
    readinessHistory: 'historia regeneracji',
    weekly: 'tydzień',
    latest: 'ostatnia aktywność',
    cards: 'historia',
    load28d: 'load 28d',
    thresholds: 'progi Szymona',
    thresholdSuggestions: 'propozycje progów',
    proActivities: 'aktywności PRO',
    proSegments: 'segmenty PRO',
    proAnalytics: 'analityka PRO'
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
    status.textContent = `Dane Garmin PRO gotowe: ${okCount}/${Object.keys(viewState).length} widoków.`;
    status.className = 'status ok';
  }
  renderConnectionStatus();
}


/* =========================================================
   Kalmar 2026 — Prognoza 226 km
   Mały, odseparowany moduł. Nie zapisuje danych, nie zmienia
   Supabase/VM/SQL. Liczy kierunek z dostępnych danych i pilnuje
   Data Guard: brak danych oraz dane zbyt słabe do ekstrapolacji.
   ========================================================= */
function kalmarNum(value){
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function kalmarClamp(value, min, max){
  return Math.max(min, Math.min(max, value));
}

function kalmarMedian(values){
  const nums = values.map(Number).filter(Number.isFinite).sort((a,b) => a-b);
  if(!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

function kalmarRoundSec(value, minutes = 10){
  const step = minutes * 60;
  return Math.round(Number(value || 0) / step) * step;
}

function kalmarTimeHM(seconds){
  const s = Math.max(0, kalmarRoundSec(seconds, 5));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}`;
}

function kalmarRangeText(lowSec, highSec){
  return `${kalmarTimeHM(lowSec)}–${kalmarTimeHM(highSec)}`;
}

function kalmarIsSport(record, group){
  const text = `${record?.sport_type || ''} ${record?.activity_type || ''} ${record?.event_name || ''} ${record?.activity_name || ''}`.toLowerCase();
  if(group === 'bike') return text.includes('bike') || text.includes('cycl') || text.includes('kolar') || hasSegment(record, 'bike');
  if(group === 'run') return text.includes('run') || text.includes('bieg') || hasSegment(record, 'run');
  if(group === 'swim') return text.includes('swim') || text.includes('pływ') || text.includes('basen') || hasSegment(record, 'swim');
  if(group === 'multi') return text.includes('triathlon') || text.includes('multi') || (hasSegment(record, 'swim') && hasSegment(record, 'bike') && hasSegment(record, 'run'));
  return false;
}

function kalmarSegmentsFor(record){
  if(!record) return [];
  if(isProActivityRow(record)) return proSegmentsForActivity(record) || [];
  return parseJsonArray(record?.segments);
}

function kalmarSegmentSum(record, type){
  const rows = kalmarSegmentsFor(record).filter(s => String(s.segment_type || '').toLowerCase() === type);
  const meters = rows.reduce((acc, row) => acc + (kalmarNum(row.distance_meters) || 0), 0);
  const seconds = rows.reduce((acc, row) => acc + (kalmarNum(row.duration_seconds ?? row.elapsed_time_seconds) || 0), 0);
  return {
    distanceKm: meters ? meters / 1000 : null,
    seconds: seconds || null,
    count: rows.length
  };
}

function kalmarActivitySportMetrics(record, type){
  const segment = kalmarSegmentSum(record, type);
  if(segment.distanceKm != null || segment.seconds != null) return segment;
  if(!kalmarIsSport(record, type)) return { distanceKm:null, seconds:null, count:0 };
  return {
    distanceKm: activityDistanceKm(record),
    seconds: kalmarNum(record?.duration_seconds ?? record?.elapsed_time_seconds ?? (record?.duration_min != null ? Number(record.duration_min) * 60 : null)),
    count: 1
  };
}

function kalmarAllActivityRows(){
  const map = new Map();
  [...(proActivities || []), ...(cards || [])].forEach(row => {
    const key = `${row?.id || ''}:${row?.garmin_activity_id || row?.activity_id || ''}:${row?.workout_date || ''}:${row?.event_name || row?.activity_name || ''}`;
    if(!map.has(key)) map.set(key, row);
  });
  return Array.from(map.values());
}

/* ============================================================
   ADAPTIVE ATHLETE PROFILE
   Cel: oceniać trening względem osobistego poziomu Szymona z
   ostatnich 4-8 tygodni, nie względem ogólnych norm. Dotyczy
   wyłącznie buildLocalTodayCoach() i proCostTitle() — nie ma
   żadnego związku z Kalmarem 226 km, Planem ani trendem
   regeneracji (te mają własne, niezmienione sygnały).
   ============================================================ */

function kalmarPercentile(sortedValues, p){
  if(!sortedValues.length) return null;
  const idx = (sortedValues.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if(lo === hi) return sortedValues[lo];
  return sortedValues[lo] + (sortedValues[hi] - sortedValues[lo]) * (idx - lo);
}

function buildAthleteBaseline(sport, days = 56){
  if(!sport || sport === 'general' || sport === 'triathlon'){
    return { hasEnough: false, count: 0, sport };
  }
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const loads = kalmarAllActivityRows()
    .filter(row => sportKeyForItem(row) === sport)
    .filter(row => {
      const d = row?.workout_date ? new Date(row.workout_date) : null;
      return d && !Number.isNaN(d.getTime()) && d >= cutoff;
    })
    .map(row => kalmarNum(row?.training_load))
    .filter(v => v != null && v > 0)
    .sort((a, b) => a - b);

  const count = loads.length;
  if(count < 6){
    return { hasEnough: false, count, sport };
  }

  return {
    hasEnough: true,
    count,
    sport,
    days,
    median: kalmarPercentile(loads, 0.5),
    p25: kalmarPercentile(loads, 0.25),
    p75: kalmarPercentile(loads, 0.75),
    p90: kalmarPercentile(loads, 0.90)
  };
}

function classifyAgainstBaseline(load, baseline){
  if(!baseline?.hasEnough || load == null || !Number.isFinite(load)){
    return { tier: 'unknown' };
  }
  if(load <= baseline.p75) return { tier: 'normal' };
  if(load <= baseline.p90) return { tier: 'elevated' };
  return { tier: 'over' };
}

/* Zabezpieczenie, nie główny mechanizm: jak organizm Szymona
   zwykle reagował następnego dnia po treningach o podobnym
   obciążeniu w ciągu ostatnich 4-8 tyg. Wymaga >=3 dopasowanych
   nocy, inaczej hasEnough:false i sygnał jest po prostu nieużyty. */
function kalmarOvernightResponseForSimilar(sport, load, baseline, days = 56){
  if(!baseline?.hasEnough || load == null || !Number.isFinite(load)){
    return { hasEnough: false };
  }
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const tolerance = Math.max(20, (baseline.p75 - baseline.p25) || 20);

  const candidates = kalmarAllActivityRows()
    .filter(row => sportKeyForItem(row) === sport)
    .map(row => ({ date: row?.workout_date, load: kalmarNum(row?.training_load) }))
    .filter(row => {
      if(!row.date || row.load == null) return false;
      const d = new Date(row.date);
      return !Number.isNaN(d.getTime()) && d >= cutoff && Math.abs(row.load - load) <= tolerance;
    });

  if(candidates.length < 3) return { hasEnough: false, count: candidates.length };

  const byDate = new Map((readinessHistory || []).map(r => [String(r?.metric_date || '').slice(0, 10), r]));
  const nextDayScores = [];
  candidates.forEach(c => {
    const next = new Date(c.date);
    next.setDate(next.getDate() + 1);
    const iso = next.toISOString().slice(0, 10);
    const rec = byDate.get(iso);
    const score = rec ? kalmarNum(rec.training_readiness_score) : null;
    if(score != null) nextDayScores.push(score);
  });

  if(nextDayScores.length < 3) return { hasEnough: false, count: nextDayScores.length };

  return {
    hasEnough: true,
    sampleCount: nextDayScores.length,
    avgNextDayReadiness: kalmarAverage(nextDayScores)
  };
}

function athleteBaselineNote(tier, overnight){
  if(!overnight?.hasEnough) return '';
  if(tier === 'normal' || tier === 'elevated'){
    return overnight.avgNextDayReadiness >= 50
      ? ' Po podobnych treningach organizm zwykle wracał do pracy bez problemu.'
      : ' Po podobnych treningach regeneracja bywała wolniejsza, więc warto obserwować poranek.';
  }
  return '';
}

function kalmarPaceFromActivities(type, minKm){
  const rows = kalmarAllActivityRows();
  const samples = [];
  let longest = 0;
  rows.forEach(row => {
    const m = kalmarActivitySportMetrics(row, type);
    if(m.distanceKm != null) longest = Math.max(longest, m.distanceKm);
    if(m.distanceKm != null && m.seconds != null && m.distanceKm >= minKm){
      samples.push({ km: m.distanceKm, secPerKm: m.seconds / m.distanceKm, seconds: m.seconds });
    }
  });
  samples.sort((a,b) => b.km - a.km);
  const top = samples.slice(0, 5).map(x => x.secPerKm);
  return { pace: kalmarMedian(top), longest, sampleCount: samples.length };
}

function kalmarTransitionSeconds(type){
  const rows = [];
  kalmarAllActivityRows().forEach(row => {
    const seg = kalmarSegmentSum(row, type);
    if(seg.seconds != null) rows.push(seg.seconds);
  });
  const median = kalmarMedian(rows);
  return { seconds: median, count: rows.length };
}

function kalmarThresholdWorking(sport, types){
  for(const type of types){
    const row = thresholdFor(sport, type);
    const value = thresholdValue(row);
    if(value != null) return { value, row };
  }
  return { value:null, row:null };
}

function kalmarReadinessPenalty(){
  if(!readiness) return { penalty:0, note:'brak pełnego kontekstu dzisiejszego poranka' };
  const score = kalmarNum(readiness.training_readiness_score);
  const sleep = kalmarNum(readiness.sleep_minutes);
  const battery = kalmarNum(readiness.body_battery_end);
  const stress = kalmarNum(readiness.avg_stress);
  const weak = (score != null && score < 45) || (sleep != null && sleep < 360) || (battery != null && battery < 40) || (stress != null && stress > 45);
  if(weak) return { penalty:0.035, note:'dzisiejszy stan organizmu każe traktować wynik ostrożniej' };
  return { penalty:0, note:'stan organizmu nie blokuje prognozy' };
}

function kalmarAverage(values){
  const nums = values.map(Number).filter(Number.isFinite);
  if(!nums.length) return null;
  return nums.reduce((a,b) => a + b, 0) / nums.length;
}

function kalmarDateDescValue(row, keys){
  for(const key of keys){
    const raw = row?.[key];
    if(raw) return String(raw).slice(0, 10);
  }
  return '';
}

function kalmarSortedByDateDesc(rows, keys){
  return [...(rows || [])].sort((a,b) => kalmarDateDescValue(b, keys).localeCompare(kalmarDateDescValue(a, keys)));
}

function kalmarDailyRecoveryIndex(row){
  const parts = [];
  const sleep = kalmarNum(row?.sleep_minutes);
  const battery = kalmarNum(row?.body_battery_end ?? row?.body_battery_start);
  const score = kalmarNum(row?.training_readiness_score);
  if(sleep != null && sleep > 0) parts.push(kalmarClamp(sleep / 480, 0, 1));
  if(battery != null && battery > 0) parts.push(kalmarClamp(battery / 100, 0, 1));
  if(score != null && score > 0) parts.push(kalmarClamp(score / 100, 0, 1));
  return kalmarAverage(parts);
}

function kalmarLoadTrend(){
  const rows = kalmarSortedByDateDesc(load28d, ['workout_date', 'metric_date', 'date']);
  const loads = rows.map(row => kalmarNum(row?.daily_training_load)).filter(v => v != null);
  return {
    recent: kalmarAverage(loads.slice(0, 7)),
    prior: kalmarAverage(loads.slice(7, 14)),
    count: loads.length
  };
}

function kalmarRecoveryTrend(){
  const rows = kalmarSortedByDateDesc(readinessHistory, ['metric_date', 'journal_date', 'date']);
  const indexed = rows.map(row => ({ row, index: kalmarDailyRecoveryIndex(row) })).filter(x => x.index != null);
  return {
    recent: kalmarAverage(indexed.slice(0, 4).map(x => x.index)),
    prior: kalmarAverage(indexed.slice(4, 8).map(x => x.index)),
    count: indexed.length
  };
}

function kalmarRegenerationTrend(){
  const load = kalmarLoadTrend();
  const recovery = kalmarRecoveryTrend();
  const hasEnough = load.recent != null && load.prior != null && recovery.recent != null && recovery.prior != null;
  const bad = hasEnough && load.recent > load.prior * 1.15 && recovery.recent < recovery.prior * 0.93;
  const loadText = load.recent != null && load.prior != null
    ? `obciążenie ${Math.round(load.recent)} vs ${Math.round(load.prior)}`
    : 'brak pełnego trendu obciążenia';
  const recoveryText = recovery.recent != null && recovery.prior != null
    ? `regeneracja ${Math.round(recovery.recent * 100)}% vs ${Math.round(recovery.prior * 100)}%`
    : 'brak pełnego trendu regeneracji';
  return {
    bad,
    hasEnough,
    load,
    recovery,
    fact: `${loadText}, ${recoveryText}`,
    note: bad ? 'obciążenie rośnie szybciej niż regeneracja' : 'trend regeneracji nie blokuje prognozy'
  };
}

function kalmarShortFact(text){
  const map = {
    'pływanie/CSS': 'pływanie',
    'rower/FTP': 'rower',
    'bieg/próg': 'bieg',
    'T1/T2': 'zmiany',
    'dzisiejszy stan organizmu': 'stan dziś',
    'brakuje długiej jazdy 140+ km': 'rower 140+ km',
    'brakuje danych rowerowych': 'dane roweru',
    'brakuje długiego biegu': 'długi bieg',
    'brakuje danych biegowych': 'dane biegu',
    'mało danych pływackich': 'dane pływania',
    'brakuje zakładki lub startu multisport': 'multisport'
  };
  if(map[text]) return map[text];
  if(text && text.length > 16) return `${text.slice(0, 14)}…`;
  return text || 'dane';
}

function buildKalmarCoachTip({ confidence, missing, weak, bikeAct, runAct, swimAct, swimCss, hasMulti, regenerationTrend }){
  if(confidence === 'brak danych' || (missing.length >= 3 && weak.length)){
    const fact = kalmarShortFact(missing[0] || weak[0]);
    return `Dane są za słabe: ${fact}.\nCel: domknąć podstawę danych.\nTo da mocniejszą prognozę.`;
  }
  if(confidence === 'niska' && (missing.length || weak.length)){
    const fact = kalmarShortFact(weak[0] || missing[0]);
    return `Prognoza wczesna: ${fact}.\nCel: mocniejszy sygnał z treningu.\nTo podniesie pewność prognozy.`;
  }
  if(regenerationTrend?.bad){
    return `Rośnie obciążenie, spada regeneracja.\nCel tygodnia: jakość bez przepalania.\nTo podniesie pewność prognozy.`;
  }
  if(bikeAct.longest < 140){
    const fact = bikeAct.longest ? `najdłużej ${Math.round(bikeAct.longest)} km` : 'brak długiej jazdy';
    return `Rower ogranicza: ${fact}.\nCel: spokojne 120+ km, bez szarpania.\nTo wzmocni bieg po rowerze.`;
  }
  if(!hasMulti){
    return `Rower OK, bieg po nim niewiadomą.\nCel: długa jazda + krótki bieg.\nTo zweryfikuje koszt przejścia.`;
  }
  if(swimCss.value == null && swimAct.longest < 1.5){
    const longest = swimAct.longest ? fmtKmDot(swimAct.longest) : 'brak danych';
    return `Pływanie ma mało danych: ${longest}.\nCel: dłuższe, regularne pływanie.\nTo podniesie pewność startu.`;
  }
  return 'Kierunek dobry, dane są spójne.\nCel: równa jazda, spokojna forma.\nPrognoza rośnie bez przepalania.';
}


function kalmarPlanShortText(text, fallback = 'Kontroluj jakość i nie dokładaj chaosu.'){
  const clean = humanizeCoachText(text || '').replace(/\s+/g, ' ').trim();
  if(!clean) return fallback;
  if(clean.length <= 175) return clean;
  const cut = clean.slice(0, 172).replace(/[,;:\-–—]?\s+\S*$/, '');
  return `${cut}…`;
}

function buildPlanGuide(){
  const forecast = buildKalmarForecast();
  const decision = buildLocalTodayCoach();
  const limiterKey = forecast.limiterKey || 'ok';

  let goal = 'Utrzymać rytm pod Kalmar';
  let why = 'Dane są spójne. Teraz liczy się konsekwencja, równa praca i spokojna kontrola kosztu treningów.';
  let accent = 'Równa jazda rowerowa i krótka zakładka, jeśli poranek po treningu jest dobry.';
  let avoid = 'Nie dokładaj mocnego bodźca tylko po to, żeby „zaliczyć” ciężki dzień.';

  if(limiterKey === 'empty'){
    goal = 'Domknąć dane przed planem';
    why = 'Bez treningów i poranków aplikacja nie powinna udawać planu.';
    accent = 'Najpierw synchronizacja Garmin i spokojne wejście w rytm treningów.';
    avoid = 'Nie buduj prognozy ani planu z pustych danych.';
  }else if(limiterKey === 'regen'){
    goal = 'Jakość bez przepalania';
    why = 'Kalmar pokazuje, że obciążenie rośnie szybciej niż regeneracja.';
    accent = 'Najbliższy mocniejszy akcent dopiero po lepszym śnie, energii i poranku.';
    avoid = 'Nie dokładaj mocnego bodźca, gdy organizm nie nadąża z odbudową.';
  }else if(limiterKey === 'bike'){
    goal = 'Rower + spokojna zakładka';
    why = 'Prognozę ogranicza brak mocnego potwierdzenia długiej jazdy.';
    accent = 'Jedna spokojna, równa jazda 120+ km i krótki bieg po rowerze.';
    avoid = 'Nie przepalaj pierwszej części jazdy — rower ma zostawić nogi do biegu.';
  }else if(limiterKey === 'run'){
    goal = 'Bieg po rowerze';
    why = 'Rower wygląda lepiej, ale bieg po nim nadal wymaga potwierdzenia.';
    accent = 'Dłuższa jazda i krótki bieg kontrolny, bez ścigania tempa.';
    avoid = 'Nie testuj naraz mocnego roweru i mocnego biegu.';
  }else if(limiterKey === 'swim'){
    goal = 'Regularność pływania';
    why = 'Rower i bieg są ważniejsze, ale pływanie nadal obniża pewność startową.';
    accent = 'Dłuższe spokojne pływanie, równo i technicznie, bez sprintowego chaosu.';
    avoid = 'Nie rób z pływania walki o tempo kosztem techniki.';
  }

  const todayTitle = decision?.title || 'DZISIAJ: KONTROLA';
  const todayText = kalmarPlanShortText(decision?.today, 'Trzymaj decyzję z ekranu Dzisiaj i nie dokładaj pracy ponad cel jednostki.');
  const tomorrowText = kalmarPlanShortText(decision?.tomorrow, 'Jutro oceń poranek po treningu: sen, energię, tętno spoczynkowe i ciężkość nóg.');

  return { goal, why, todayTitle, todayText, tomorrowText, accent, avoid, forecast };
}

function renderPlanGuide(){
  const target = $('planPanel');
  if(!target) return;
  const plan = buildPlanGuide();
  target.innerHTML = `
    <header class="plan-guide-head">
      <span>Plan najbliższych dni</span>
      <h2>${escapeHtml(plan.goal)}</h2>
      <p>${escapeHtml(plan.why)}</p>
    </header>
    <div class="plan-guide-grid">
      <article class="plan-guide-card plan-guide-main">
        <span>Cel tygodnia</span>
        <b>${escapeHtml(plan.goal)}</b>
        <p>${escapeHtml(plan.accent)}</p>
      </article>
      <article class="plan-guide-card">
        <span>Dzisiaj</span>
        <b>${escapeHtml(plan.todayTitle)}</b>
        <p>${escapeHtml(plan.todayText)}</p>
      </article>
      <article class="plan-guide-card">
        <span>Jutro</span>
        <b>Odpowiedź po nocy</b>
        <p>${escapeHtml(plan.tomorrowText)}</p>
      </article>
      <article class="plan-guide-card plan-guide-stop">
        <span>Nie rób teraz</span>
        <b>Bez chaosu</b>
        <p>${escapeHtml(plan.avoid)}</p>
      </article>
    </div>
    <p class="plan-guide-note">Plan korzysta z tych samych danych co Dzisiaj i Kalmar, ale nie jest kalendarzem treningowym.</p>
  `;
}

function buildKalmarForecast(){
  const rows = kalmarAllActivityRows();
  const hasData = rows.length || readiness || readinessHistory.length || load28d.length || weekly || athleteThresholds.length || athleteProfileContext.length;
  if(!hasData){
    return {
      range:'czekam na dane',
      confidence:'brak danych',
      limiter:'brak odczytu Garmin',
      limiterKey:'empty',
      driver:'treningi + stan organizmu',
      why:'Po pobraniu danych karta pokaże krótki kierunek pod Kalmar.',
      guard:'Brak danych do prognozy — nie udaję wyniku.',
      coachTip:'Brak danych z treningów i poranków.\nCel: pierwsza synchronizacja Garmin.\nBez tego to byłoby zgadywanie.',
      details:'Brak aktywności, progów i danych porannych.',
      status:'empty'
    };
  }

  const swimCss = kalmarThresholdWorking('swim', ['swim_css_sec_per_100m', 'swim_threshold_pace_sec_per_100m', 'swim_race_pace_sec_per_100m']);
  const runThreshold = kalmarThresholdWorking('run', ['run_threshold_pace_sec_per_km']);
  const bikeFtp = kalmarThresholdWorking('bike', ['eftp_bike_observed', 'ftp_bike_declared_old']);
  const swimAct = kalmarPaceFromActivities('swim', 0.4);
  const bikeAct = kalmarPaceFromActivities('bike', 10);
  const runAct = kalmarPaceFromActivities('run', 3);
  const t1 = kalmarTransitionSeconds('t1');
  const t2 = kalmarTransitionSeconds('t2');
  const readinessGuard = kalmarReadinessPenalty();
  const regenerationTrend = kalmarRegenerationTrend();

  const swimBase = swimCss.value != null
    ? swimCss.value * 38 * 1.07
    : (swimAct.pace != null ? swimAct.pace * 3.8 * 1.08 : 92 * 60);

  const bikeKmhFromActivities = bikeAct.pace != null ? 3600 / bikeAct.pace : null;
  let bikeKmh;
  if(bikeKmhFromActivities != null){
    const extrapolation = bikeAct.longest >= 140 ? 0.94 : bikeAct.longest >= 100 ? 0.90 : bikeAct.longest >= 70 ? 0.84 : 0.78;
    bikeKmh = kalmarClamp(bikeKmhFromActivities * extrapolation, 22, 36);
  }else if(bikeFtp.value != null){
    bikeKmh = kalmarClamp(24 + Math.sqrt(Math.max(1, bikeFtp.value)) * 0.42, 24, 34);
  }else{
    bikeKmh = 28;
  }
  const bikeBase = (180 / bikeKmh) * 3600;

  const runBasePace = runThreshold.value != null
    ? runThreshold.value
    : (runAct.pace != null ? runAct.pace : 6.3 * 60);
  const bikeCost = 1.15 + (bikeAct.longest < 100 ? 0.06 : 0) + (bikeAct.longest < 70 ? 0.05 : 0) + readinessGuard.penalty;
  const runBase = runBasePace * 42.2 * bikeCost;

  const t1Base = t1.seconds != null ? t1.seconds : 8 * 60;
  const t2Base = t2.seconds != null ? t2.seconds : 6 * 60;
  const total = swimBase + bikeBase + runBase + t1Base + t2Base;
  const totalConservative = (swimBase * 1.02) + (bikeBase * 1.06) + (runBasePace * 42.2 * kalmarClamp(bikeCost - 0.035, 1.06, 1.42)) + t1Base + t2Base + (2 * 60);
  const totalReal = total;
  const totalAggressive = (swimBase * 0.99) + (bikeBase * 0.96) + (runBasePace * 42.2 * kalmarClamp(bikeCost + 0.065, 1.12, 1.58)) + t1Base + t2Base;

  const missing = [];
  const weak = [];
  if(swimCss.value == null && swimAct.sampleCount < 2) missing.push('pływanie/CSS');
  if(bikeFtp.value == null && bikeAct.sampleCount < 2) missing.push('rower/FTP');
  if(runThreshold.value == null && runAct.sampleCount < 2) missing.push('bieg/próg');
  if(t1.count === 0 || t2.count === 0) missing.push('T1/T2');
  if(!readiness) missing.push('dzisiejszy stan organizmu');
  if(readinessHistory.length < 5) weak.push('za krótka historia regeneracji');
  if(bikeAct.longest > 0 && bikeAct.longest < 140) weak.push('brakuje długiej jazdy 140+ km');
  if(bikeAct.longest === 0) weak.push('brakuje danych rowerowych');
  if(runAct.longest > 0 && runAct.longest < 18) weak.push('brakuje długiego biegu');
  if(runAct.longest === 0) weak.push('brakuje danych biegowych');
  if(swimAct.longest > 0 && swimAct.longest < 1.5) weak.push('mało danych pływackich');
  const hasMulti = rows.some(row => kalmarIsSport(row, 'multi'));
  if(!hasMulti) weak.push('brakuje zakładki lub startu multisport');

  let confidenceScore = 0;
  if(swimCss.value != null || swimAct.sampleCount >= 2) confidenceScore += 1;
  if(bikeFtp.value != null) confidenceScore += 1;
  if(bikeAct.sampleCount >= 2) confidenceScore += 2;
  if(bikeAct.longest >= 140) confidenceScore += 2;
  else if(bikeAct.longest >= 100) confidenceScore += 1;
  if(runThreshold.value != null || runAct.sampleCount >= 2) confidenceScore += 2;
  if(runAct.longest >= 18) confidenceScore += 1;
  if(t1.count || t2.count) confidenceScore += 1;
  if(hasMulti) confidenceScore += 1;
  if(readiness) confidenceScore += 1;

  const confidence = confidenceScore >= 8 ? 'rosnąca' : confidenceScore >= 5 ? 'średnia' : 'niska';
  const spread = confidence === 'rosnąca' ? 0.045 : confidence === 'średnia' ? 0.07 : 0.105;
  const scenarioLow = Math.min(totalReal, totalAggressive);
  const scenarioHigh = Math.max(totalReal, totalConservative);
  const low = scenarioLow * (1 - spread * 0.5);
  const high = scenarioHigh * (1 + spread * 0.5);

  let limiter = 'bieg po rowerze';
  let limiterKey = 'run';
  if(regenerationTrend.bad){ limiter = 'regeneracja tygodniowa'; limiterKey = 'regen'; }
  else if(bikeAct.longest < 140){ limiter = 'rower 180 km'; limiterKey = 'bike'; }
  else if(!hasMulti){ limiter = 'bieg po rowerze'; limiterKey = 'run'; }
  else if(swimCss.value == null && swimAct.longest < 1.5){ limiter = 'pływanie / regularność'; limiterKey = 'swim'; }
  else { limiterKey = 'ok'; }

  const driverParts = [];
  if(bikeAct.sampleCount) driverParts.push('rower z treningów');
  if(runAct.sampleCount || runThreshold.value != null) driverParts.push('bieg');
  if(readiness) driverParts.push('stan organizmu');
  if(regenerationTrend.hasEnough) driverParts.push('trend regeneracji');
  const driver = driverParts.length ? driverParts.slice(0,3).join(' + ') : 'dostępne dane Garmin';

  let why = 'Największy wpływ ma koszt roweru i to, czy po nim zostanie bieg.';
  if(bikeAct.sampleCount && !hasMulti) why = 'Rower daje najwięcej sygnału, ale brakuje mocnej zakładki z biegiem.';
  if(readinessGuard.penalty) why = 'Treningi dają kierunek, ale dzisiejszy stan organizmu obniża pewność.';
  if(regenerationTrend.bad) why = 'Obciążenie rośnie szybciej niż regeneracja, więc prognozę trzeba budować cierpliwie.';
  if(confidence === 'rosnąca') why = 'Dane treningowe zaczynają być spójne, ale nadal nie traktuję tego jak gwarancji startowej.';

  let guard = 'Prognoza jest kierunkiem, nie obietnicą wyniku.';
  if(missing.length) guard = `Braki danych: ${missing.slice(0,3).join(', ')}.`;
  if(weak.length) guard = `Dane są, ale za słabe do mocnej ekstrapolacji: ${weak.slice(0,2).join(', ')}.`;

  const details = [
    `Pływanie: ${swimCss.value != null ? 'CSS/próg dostępny' : (swimAct.longest ? `najdłużej ${fmtKmDot(swimAct.longest)}` : 'brak pewnych danych')}`,
    `Rower: ${bikeAct.longest ? `najdłużej ${fmtKmDot(bikeAct.longest)}` : 'brak długich jazd'}${bikeFtp.value != null ? `, próg ${fmtNumber(bikeFtp.value)} ${bikeFtp.row?.unit || ''}` : ''}`,
    `Bieg: ${runAct.longest ? `najdłużej ${fmtKmDot(runAct.longest)}` : 'brak długich biegów'}`,
    `Scenariusze: bezpieczny ${kalmarTimeHM(totalConservative)}, realny ${kalmarTimeHM(totalReal)}, mocny dzień ${kalmarTimeHM(totalAggressive)}`,
    `Zmiany: ${t1.count || t2.count ? 'są sygnały T1/T2' : 'zakres generyczny'}`,
    `Regeneracja dziś: ${readinessGuard.note}`,
    `Trend: ${regenerationTrend.note}`
  ].join(' · ');

  const coachTip = buildKalmarCoachTip({ confidence, missing, weak, bikeAct, runAct, swimAct, swimCss, hasMulti, regenerationTrend });

  return {
    range: kalmarRangeText(low, high),
    confidence,
    limiter,
    limiterKey,
    driver,
    why,
    guard,
    coachTip,
    details,
    status: confidence === 'niska' ? 'weak' : 'ok'
  };
}

function renderKalmarForecast(){
  const rangeEl = $('kalmarForecastRange');
  if(!rangeEl) return;
  const forecast = buildKalmarForecast();
  const statusEl = $('kalmarForecastStatus');
  rangeEl.textContent = forecast.range;
  if($('kalmarForecastConfidence')) $('kalmarForecastConfidence').textContent = forecast.confidence;
  if($('kalmarForecastLimiter')) $('kalmarForecastLimiter').textContent = forecast.limiter;
  if($('kalmarForecastDriver')) $('kalmarForecastDriver').textContent = forecast.driver;
  if($('kalmarForecastWhy')) $('kalmarForecastWhy').textContent = forecast.why;
  if($('kalmarForecastGuard')) $('kalmarForecastGuard').textContent = forecast.guard;
  if($('kalmarCoachTipText')) $('kalmarCoachTipText').textContent = forecast.coachTip || 'Karta pokaże jedną konkretną dźwignię po pobraniu danych.';
  if($('kalmarForecastDetails')) $('kalmarForecastDetails').textContent = forecast.details;
  if($('kalmarForecastHint')) $('kalmarForecastHint').textContent = 'Liczone jako zakres godzinowy w kilometrach: 3,8 km pływania + T1 + 180 km roweru + T2 + 42,2 km biegu po rowerze.';
  if(statusEl){
    statusEl.textContent = forecast.status === 'empty' ? 'czekam na Garmin PRO' : forecast.status === 'weak' ? 'prognoza wczesna' : 'model aktualny';
    statusEl.className = `coach-mode-pill kalmar-status-${forecast.status}`;
  }
}


function applyActiveTabClass(tab){
  const safe = ['dashboard', 'analysis', 'history', 'ai', 'settings', 'kalmar'].includes(tab) ? tab : 'dashboard';
  document.body.classList.remove('tab-dashboard', 'tab-analysis', 'tab-history', 'tab-ai', 'tab-settings', 'tab-kalmar');
  document.body.classList.add(`tab-${safe}`);
}

function renderAll(){
  if(!document.body.classList.contains('tab-dashboard') && !document.body.classList.contains('tab-analysis') && !document.body.classList.contains('tab-history') && !document.body.classList.contains('tab-ai') && !document.body.classList.contains('tab-settings') && !document.body.classList.contains('tab-kalmar')) applyActiveTabClass('dashboard');
  renderConnectionStatus();
  renderDashboard();
  renderAnalysis();
  renderHistory();
  renderAi();
  renderSettings();
  renderKalmarForecast();
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
  const [readinessRows, readinessHistoryRows, weeklyRows, latestRows, cardRows, loadRows, thresholdRows, powerRows, runRows, profileRows, suggestionRows, proActivityRows, proSegmentRows, proAnalyticsRows] = await Promise.all([
    loadOne('readiness', `${READINESS_ENDPOINT}?select=*&limit=1`),
    loadOne('readinessHistory', `${READINESS_HISTORY_ENDPOINT}?select=*&order=metric_date.desc&limit=60`),
    loadOne('weekly', `${WEEKLY_ENDPOINT}?select=*&limit=1`),
    loadOne('latest', `${LATEST_ENDPOINT}?select=*&limit=1`),
    loadOne('cards', `${CARDS_ENDPOINT}?select=*&order=workout_date.desc&limit=30`),
    loadOne('load28d', `${LOAD_28D_ENDPOINT}?select=workout_date,daily_training_load,daily_duration_min,daily_distance_km,activity_count&limit=28`),
    loadOne('thresholds', `${ATHLETE_THRESHOLDS_ENDPOINT}?select=*&athlete_key=eq.szymon`),
    loadOne('powerIntervals', `${POWER_INTERVALS_ENDPOINT}?select=*&athlete_key=eq.szymon&order=garmin_activity_id.asc,target_sec.asc&limit=250`),
    loadOne('runIntervals', `${RUN_INTERVALS_ENDPOINT}?select=*&athlete_key=eq.szymon&order=garmin_activity_id.asc,target_m.asc&limit=250`),
    loadOne('thresholdProfileContext', `${ATHLETE_PROFILE_CONTEXT_ENDPOINT}?select=*&athlete_key=eq.szymon&order=sport.asc,threshold_type.asc`),
    loadOne('thresholdSuggestions', `${THRESHOLD_SUGGESTIONS_ENDPOINT}?select=*&athlete_key=eq.szymon&suggestion_status=eq.pending&order=created_at.desc`),
    loadOne('proActivities', `${GARMIN_ACTIVITIES_ENDPOINT}?select=*&order=workout_date.desc&limit=40`),
    loadOne('proSegments', `${GARMIN_SEGMENTS_ENDPOINT}?select=*&order=segment_order.asc&limit=500`),
    loadOne('proAnalytics', `${GARMIN_ANALYTICS_ENDPOINT}?select=*&limit=100`)
  ]);
  readiness = readinessRows[0] || null;
  readinessHistory = readinessHistoryRows;
  weekly = weeklyRows[0] || null;
  latest = latestRows[0] || null;
  cards = cardRows;
  load28d = loadRows;
  athleteThresholds = thresholdRows;
  activityPowerIntervals = powerRows;
  activityRunIntervals = runRows;
  athleteProfileContext = profileRows;
  athleteThresholdSuggestions = suggestionRows;
  proActivities = proActivityRows;
  proSegments = proSegmentRows;
  proAnalytics = proAnalyticsRows;
  activityContexts = await loadActivityAnalysisContexts();
  lastReadAt = new Date();
  renderAll();
  requestWeeklyCoachAnalysis();
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
    ['Gotowość', facts.readinessScore != null ? `${Math.round(facts.readinessScore)}/100 (${facts.readinessLevel})` : 'brak danych'],
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
    ? `Zalecenie po aktywności: nie dokładamy kolejnej jakości bez poranka. Jeśli sen i energia są OK, wracamy do pracy kontrolowanie.`
    : mediumLoad
      ? `Zalecenie po aktywności: bodziec zaliczony. Kolejny dzień prowadź według poranka — lekko, technicznie albo kontrolowany trening.`
      : `Zalecenie po aktywności: decyzję o kolejnym bodźcu oprzyj na poranku, odczuciu Szymona i obciążeniu tygodnia.`;

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

function numericFromText(value){
  if(value == null) return null;
  const match = String(value).replace(',', '.').match(/-?\d+(?:\.\d+)?/);
  if(!match) return null;
  const n = Number(match[0]);
  return Number.isFinite(n) ? n : null;
}

function thresholdFor(sport, type){
  const wantedSport = String(sport || '').toLowerCase();
  const wantedType = String(type || '').toLowerCase();
  return athleteThresholds.find(item =>
    String(item.athlete_key || '') === 'szymon' &&
    String(item.sport || '').toLowerCase() === wantedSport &&
    String(item.threshold_type || '').toLowerCase() === wantedType
  ) || null;
}

function currentBikeFtp(){
  return thresholdFor('bike', 'ftp_bike_declared_old');
}

function currentBikeEftp(){
  return thresholdFor('bike', 'eftp_bike_observed');
}

function currentBodyWeight(){
  return thresholdFor('general', 'body_weight_estimated');
}

function thresholdValue(threshold){
  const n = Number(threshold?.value_working);
  return Number.isFinite(n) ? n : null;
}

function thresholdRangeText(threshold){
  if(!threshold) return 'brak danych';
  const min = threshold.value_min != null ? fmtNumber(threshold.value_min, threshold.unit === 'kg' ? 1 : 0) : 'brak';
  const work = threshold.value_working != null ? fmtNumber(threshold.value_working, threshold.unit === 'kg' ? 1 : 0) : 'brak';
  const max = threshold.value_max != null ? fmtNumber(threshold.value_max, threshold.unit === 'kg' ? 1 : 0) : 'brak';
  const unit = threshold.unit || '';
  return `${min}–${work}–${max} ${unit}`.trim();
}

function bikeNpWatts(record){
  const fromRecord = numericFromText(record?.np_watts);
  if(fromRecord != null) return fromRecord;
  return numericFromText(extractMetric(record, [/\bNP\s*[:=]?\s*([0-9]+(?:[.,][0-9]+)?\s*W?)/i]));
}

function avgPowerWatts(record){
  const fromRecord = numericFromText(record?.avg_power);
  if(fromRecord != null) return fromRecord;
  return numericFromText(extractMetric(record, [/\bmoc\s*śr\.\s*([0-9]+(?:[.,][0-9]+)?\s*W?)/i, /\bavg power\s*[:=]?\s*([0-9]+(?:[.,][0-9]+)?\s*W?)/i]));
}


function sportGroupForRecord(record){
  if(!record) return 'general';
  const sport = String(record?.sport_type || record?.activity_type || record?.event_name || '').toLowerCase();
  if(hasSegment(record, 'swim') && hasSegment(record, 'bike') && hasSegment(record, 'run')) return 'triathlon';
  if(hasSegment(record, 'bike') || sport.includes('bike') || sport.includes('cycl') || sport.includes('kolar')) return 'bike';
  if(hasSegment(record, 'run') || sport.includes('run') || sport.includes('bieg')) return 'run';
  if(hasSegment(record, 'swim') || sport.includes('swim') || sport.includes('pływ')) return 'swim';
  return 'general';
}

function profileRowsForSportGroup(group){
  const sports = group === 'triathlon' ? ['swim', 'bike', 'run', 'general'] : [group, 'general'];
  return athleteProfileContext.filter(row => sports.includes(String(row.sport || '').toLowerCase()));
}

function profileValueText(row){
  if(!row?.is_available) return 'brak danych';
  const value = row.value_working != null ? fmtNumber(row.value_working, String(row.unit || '').includes('kg') ? 1 : 0) : 'brak';
  return `${value} ${row.unit || ''}`.trim();
}

function thresholdProfileContextStatus(record){
  const group = record ? sportGroupForRecord(record) : 'general';
  const rows = profileRowsForSportGroup(group);
  if(!rows.length){
    return {
      group,
      title: 'Profil progów — status danych',
      summary: 'Brak odczytu athlete_threshold_profile_context. AI ma analizować ostrożnie i jasno pisać „brak danych”.',
      available: [],
      missing: [],
      rows: []
    };
  }

  const available = rows
    .filter(row => row.is_available)
    .map(row => `${row.profile_label || row.threshold_type}: ${profileValueText(row)} (${row.status || 'status brak'}, ${row.confidence || 'pewność brak'})`);

  const missing = rows
    .filter(row => !row.is_available)
    .map(row => `${row.profile_label || row.threshold_type}: brak danych`);

  let summary;
  if(group === 'bike'){
    summary = available.some(text => text.includes('FTP')) || available.some(text => text.includes('eFTP'))
      ? 'Rower ma użyteczne progi mocy FTP/eFTP i może być analizowany konkretnie na mocy oraz power curve. Brakujące HR progowe nie jest zgadywane.'
      : 'Rower nie ma pełnych progów — AI ma analizować ostrożnie.';
  }else if(group === 'run'){
    summary = 'Brak progów biegowych Szymona. AI ma analizować bieg ostrożnie na podstawie tempa, HR, obciążenia i regeneracji.';
  }else if(group === 'swim'){
    summary = 'Brak CSS / progów pływackich Szymona. AI ma analizować pływanie ostrożnie na podstawie tempa /100 m, dystansu i kontekstu dnia.';
  }else if(group === 'triathlon'){
    summary = 'Triathlon ma mieszany profil: rower ma FTP/eFTP, ale run i swim nadal nie mają własnych progów. AI musi rozdzielać pewne dane od braków.';
  }else{
    summary = 'Profil ogólny ma ograniczone dane. AI ma używać dostępnej masy i jasno opisywać braki.';
  }

  return { group, title: 'Profil progów — status danych', summary, available, missing, rows };
}


function bikeThresholdInsight(record){
  if(!record) return '';
  const sport = String(record.sport_type || record.activity_type || '').toLowerCase();
  const hasBikeActivity = hasSegment(record, 'bike') || sport.includes('bike') || sport.includes('cycl') || sport.includes('triathlon');
  if(!hasBikeActivity) return '';

  const ftpW = thresholdValue(currentBikeFtp());
  const eftpW = thresholdValue(currentBikeEftp());
  const weightKg = thresholdValue(currentBodyWeight());

  const parts = [];
  if(ftpW != null) parts.push(`FTP ${fmtNumber(ftpW)} W`);
  if(eftpW != null) parts.push(`eFTP ${fmtNumber(eftpW)} W`);
  if(weightKg != null) parts.push(`masa ${fmtNumber(weightKg, 1)} kg`);

  if(!parts.length) return 'Profil progów Szymona: brak danych progowych dla roweru.';

  return `Progi użyte do analizy: ${parts.join(' · ')}. Szczegółowe przeliczenia są w sekcji Power curve.`;
}


function activityGarminId(record){
  return String(record?.garmin_activity_id || record?.activity_id || '').trim();
}

function powerIntervalsForActivity(record){
  const gid = activityGarminId(record);
  if(!gid) return [];
  return activityPowerIntervals
    .filter(item => String(item.garmin_activity_id || '').trim() === gid)
    .sort((a, b) => Number(a.target_sec || 0) - Number(b.target_sec || 0));
}

function powerIntervalLabel(type, targetSec){
  const t = String(type || '');
  if(t === 'best_1m') return 'Najlepsze 1 min';
  if(t === 'best_3m') return 'Najlepsze 3 min';
  if(t === 'best_3m25') return 'Najlepsze 3:25';
  if(t === 'best_5m') return 'Najlepsze 5 min';
  if(t === 'best_20m') return 'Najlepsze 20 min';
  const sec = Number(targetSec);
  if(Number.isFinite(sec) && sec > 0) return `Najlepsze ${fmtDuration(sec)}`;
  return t || 'Interwał';
}

function keyPowerInterval(rows){
  return rows.find(item => item.interval_type === 'best_3m25')
    || rows.find(item => item.interval_type === 'best_3m')
    || rows.find(item => item.interval_type === 'best_5m')
    || rows[0]
    || null;
}

function powerSignalType(row){
  const pct = Number(row?.pct_ftp);
  const sec = Number(row?.target_sec);
  if(Number.isFinite(sec) && sec >= 900) return 'próg / FTP';
  if(Number.isFinite(pct) && pct >= 130) return 'VO2 Max';
  if(Number.isFinite(pct) && pct >= 110) return 'praca powyżej progu';
  if(Number.isFinite(pct) && pct >= 95) return 'okolice progu';
  return 'kontrolowany bodziec tlenowy';
}

function powerCoachTexts(row){
  if(!row){
    return {
      signal: 'brak danych',
      interpretation: 'Brak zapisanych interwałów mocy dla tej aktywności.',
      meaning: 'Bez danych mocy AI nie ocenia power curve.'
    };
  }

  const label = powerIntervalLabel(row.interval_type, row.target_sec).replace('Najlepsze ', '');
  const watts = row.avg_power_w != null ? `${fmtNumber(row.avg_power_w)} W` : 'brak danych';
  const pctFtp = row.pct_ftp != null ? `${fmtNumber(row.pct_ftp)}% FTP` : 'brak % FTP';
  const ftp = row.ftp_w != null ? fmtNumber(row.ftp_w) : 'brak';
  const eftp = row.eftp_w != null ? fmtNumber(row.eftp_w) : 'brak';
  const signalType = powerSignalType(row);

  let interpretation;
  if(signalType === 'VO2 Max'){
    interpretation = `To był mocny bodziec VO2 Max. Szymon jechał wyraźnie powyżej starego FTP ${ftp} W${row.eftp_w != null ? ` i także powyżej obserwowanego eFTP ${eftp} W` : ''}.`;
  }else if(signalType === 'praca powyżej progu'){
    interpretation = 'To była praca powyżej progu. Nie jest to spokojny rower — odcinek pokazuje realny bodziec jakościowy.';
  }else if(signalType === 'próg / FTP'){
    interpretation = 'To jest sygnał progu/FTP. Odcinek 20 minut pomaga ocenić, czy aktualne FTP/eFTP nadal pasuje do zawodnika.';
  }else if(signalType === 'okolice progu'){
    interpretation = 'To była praca blisko progu. Dobry sygnał kontroli tempa, ale bez tak dużego kosztu jak VO2 Max.';
  }else{
    interpretation = 'To wygląda na kontrolowany bodziec tlenowy. Power curve nie pokazuje bardzo mocnego odcinka ponad progiem.';
  }

  const meaning = signalType === 'VO2 Max'
    ? 'Forma rowerowa idzie w górę, ale taki bodziec ma koszt regeneracyjny.'
    : signalType === 'próg / FTP'
      ? 'Ten odcinek jest ważny do oceny FTP/eFTP i tempa pod dłuższy wysiłek.'
      : 'To pomaga ocenić jakość roweru bez zalewania ekranu wszystkimi liczbami.';

  return {
    signal: `${label} — ${watts} — ${pctFtp}`,
    interpretation,
    meaning
  };
}

function powerIntervalInsight(record){
  const rows = powerIntervalsForActivity(record);
  if(!rows.length) return '';
  const key = keyPowerInterval(rows);
  const texts = powerCoachTexts(key);
  return `Najmocniejszy sygnał: ${texts.signal}. ${texts.interpretation} Znaczenie: ${texts.meaning}`;
}



function runIntervalsForActivity(record){
  const gid = activityGarminId(record);
  if(!gid) return [];
  return activityRunIntervals
    .filter(item => String(item.garmin_activity_id || '').trim() === gid)
    .sort((a, b) => Number(a.target_m || 0) - Number(b.target_m || 0));
}

function runIntervalLabel(type, targetM){
  const t = String(type || '');
  if(t === 'best_1k') return 'Najlepszy 1 km';
  if(t === 'best_3k') return 'Najlepsze 3 km';
  if(t === 'best_5k') return 'Najlepsze 5 km';
  if(t === 'best_10k') return 'Najlepsze 10 km';
  const m = Number(targetM);
  if(Number.isFinite(m) && m > 0) return `Najlepsze ${fmtNumber(m / 1000, 1)} km`;
  return t || 'Odcinek biegu';
}

function paceTextFromSec(sec){
  const n = Number(sec);
  if(!Number.isFinite(n) || n <= 0) return 'brak danych';
  const rounded = Math.round(n);
  const min = Math.floor(rounded / 60);
  const s = String(rounded % 60).padStart(2, '0');
  return `${min}:${s}/km`;
}

function keyRunInterval(rows){
  return rows.find(item => item.interval_type === 'best_10k')
    || rows.find(item => item.interval_type === 'best_5k')
    || rows.find(item => item.interval_type === 'best_3k')
    || rows.find(item => item.interval_type === 'best_1k')
    || rows[0]
    || null;
}

function runCoachTexts(row){
  if(!row){
    return {
      signal: 'brak danych',
      interpretation: 'Brak zapisanych odcinków biegu dla tej aktywności.',
      meaning: 'Bez danych run curve AI nie ocenia jakości odcinków biegowych.'
    };
  }

  const label = runIntervalLabel(row.interval_type, row.target_m).replace('Najlepszy ', '').replace('Najlepsze ', '');
  const pace = paceTextFromSec(row.pace_sec_per_km);
  const hr = row.avg_hr != null ? `HR ${fmtNumber(row.avg_hr)}` : '';
  const power = row.avg_power_w != null ? `moc ${fmtNumber(row.avg_power_w)} W` : '';
  const cadence = row.avg_cadence != null ? `kadencja ${fmtNumber(row.avg_cadence)}` : '';
  const details = [hr, power, cadence].filter(Boolean).join(', ');

  const target = Number(row.target_m || 0);
  let interpretation = 'To jest fakt z Garmin raw_details — przydatny do analizy biegu, ale nie jest jeszcze progiem RUN.';
  if(target >= 10000){
    interpretation = 'To jest mocny sygnał wytrzymałości biegowej: tempo utrzymane długo, bez opierania wniosku na jednym szybkim kilometrze.';
  }else if(target >= 5000){
    interpretation = 'To jest jakościowy odcinek biegowy. Pomaga ocenić utrzymanie tempa, ale nie jest jeszcze progiem zawodnika.';
  }else if(target >= 3000){
    interpretation = 'To pokazuje szybszy fragment biegu, dobry do oceny dynamiki i reakcji tętna.';
  }else{
    interpretation = 'To pokazuje najlepszy krótki odcinek, ale nie wystarcza do wyznaczenia progu biegowego.';
  }

  return {
    signal: `${label} — ${pace}${details ? ` — ${details}` : ''}`,
    interpretation,
    meaning: 'AI może używać tego do wniosku trenerskiego, ale progi biegowe nadal są oznaczone jako brak danych.'
  };
}

function runIntervalInsight(record){
  const rows = runIntervalsForActivity(record);
  if(!rows.length) return '';
  const key = keyRunInterval(rows);
  const texts = runCoachTexts(key);
  return `Najmocniejszy sygnał biegowy: ${texts.signal}. ${texts.interpretation} ${texts.meaning}`;
}


function activityDistanceKm(record){
  const meters = numberOrNull(record?.distance_meters);
  if(meters != null) return meters / 1000;
  return numberOrNull(record?.distance_km);
}

function sumSegmentDistanceKm(record, type){
  const segments = parseJsonArray(record?.segments).filter(segment => String(segment.segment_type || '').toLowerCase() === type);
  const sum = segments.reduce((acc, segment) => acc + (numberOrNull(segment.distance_meters) || 0), 0);
  return sum ? sum / 1000 : null;
}

function sumSegmentDurationSeconds(record, type){
  const segments = parseJsonArray(record?.segments).filter(segment => String(segment.segment_type || '').toLowerCase() === type);
  const sum = segments.reduce((acc, segment) => acc + (numberOrNull(segment.duration_seconds) || 0), 0);
  return sum || null;
}

function bikeTotalLine(record){
  const sport = String(record?.sport_type || record?.activity_type || '').toLowerCase();
  const activityIsBike = sport.includes('bike') || sport.includes('cycl');
  const distance = activityIsBike ? activityDistanceKm(record) : sumSegmentDistanceKm(record, 'bike');
  const seconds = activityIsBike ? numberOrNull(record?.duration_seconds) : sumSegmentDurationSeconds(record, 'bike');
  const np = bikeNpWatts(record);
  const avgPower = avgPowerWatts(record);
  const pieces = [];
  if(distance != null) pieces.push(fmtKmDot(distance));
  if(seconds != null) pieces.push(fmtSeconds(seconds));
  if(np != null) pieces.push(`NP ${fmtNumber(np)} W`);
  if(avgPower != null) pieces.push(`moc śr. ${fmtNumber(avgPower)} W`);
  return pieces.length ? pieces.join(', ') : 'brak danych';
}

function thresholdRowsForFacts(record){
  const insight = bikeThresholdInsight(record);
  if(!insight) return [];
  const ftp = currentBikeFtp();
  const eftp = currentBikeEftp();
  const weight = currentBodyWeight();
  return [
    ['Profil Szymona', insight],
    ['FTP źródło', ftp ? `${ftp.source || 'brak danych'} · ${ftp.source_note || ''}`.trim() : 'brak danych'],
    ['eFTP źródło', eftp ? `${eftp.source || 'brak danych'} · ${eftp.source_note || ''}`.trim() : 'brak danych'],
    ['Waga źródło', weight ? `${weight.source || 'brak danych'} · ${weight.source_note || ''}`.trim() : 'brak danych']
  ];
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
    ['NP / IF Garmin', firstData(record.np_watts, npFromSummary, null) || firstData(record.intensity_factor, record.bike_if_value, ifFromSummary, null) ? `${record.np_watts != null ? fmtMaybeNumber(record.np_watts, ' W') : (npFromSummary || 'brak danych')} / ${record.intensity_factor != null ? fmtIf(record.intensity_factor) : record.bike_if_value != null ? fmtIf(record.bike_if_value) : (ifFromSummary ? fmtIf(ifFromSummary) : 'brak danych')}` : 'brak danych'],
    ...thresholdRowsForFacts(record),
    ['EF', ef || 'brak danych'],
    ['Coach flags', coachFlags.length ? coachFlags.join(', ') : 'brak danych'],
    ['Load 7d / 28d przed aktywnością', record.load_7d_before_activity != null || record.load_28d_before_activity != null ? `${record.load_7d_before_activity != null ? fmtNumber(record.load_7d_before_activity) : 'brak danych'} / ${record.load_28d_before_activity != null ? fmtNumber(record.load_28d_before_activity) : 'brak danych'}` : 'brak danych']
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

function segmentCardData(segment, record){
  const type = String(segment.segment_type || '').toLowerCase();
  const title = segmentLabel(type);
  const duration = segment.duration_seconds != null ? fmtSeconds(segment.duration_seconds) : 'brak danych';
  const hr = segment.hr_avg != null || segment.hr_max != null ? `${segment.hr_avg != null ? Math.round(Number(segment.hr_avg)) : 'brak danych'} / ${segment.hr_max != null ? Math.round(Number(segment.hr_max)) : 'brak danych'}` : 'brak danych';
  const distance = segment.distance_meters != null ? fmtKmDot(Number(segment.distance_meters) / 1000) : 'brak danych';
  const lines = [];
  if(type === 't1' || type === 't2'){
    lines.push(['Czas', duration]);
    lines.push(['HR', hr]);
    return { type, title, lines };
  }
  lines.push(['Dystans', distance]);
  lines.push(['Czas', duration]);
  if(type === 'swim'){
    lines.push(['Tempo', segment.swim_pace_sec_per_100m != null ? `${fmtSeconds(segment.swim_pace_sec_per_100m)}/100 m` : 'brak danych']);
  }else if(type === 'run'){
    lines.push(['Tempo', segment.pace_min_per_km != null ? fmtPace(segment.pace_min_per_km) : 'brak danych']);
  }
  if(type === 'bike'){
    lines.push(['IF', record.bike_if_value != null ? fmtIf(record.bike_if_value) : 'brak danych']);
    const np = extractMetric(record, [/\bNP\s*[:=]?\s*([0-9]+(?:[.,][0-9]+)?\s*W?)/i]);
    lines.push(['NP', np || 'brak danych']);
    if(record.bike_if_category) lines.push(['Ocena', record.bike_if_category]);
  }
  lines.push(['HR', hr]);
  if(type === 'run' && record.run_start_hr != null) lines.push(['Start HR', Math.round(Number(record.run_start_hr))]);
  return { type, title, lines };
}

function buildSegmentCards(record){
  const segments = parseJsonArray(record.segments);
  if(!segments.length) return [];
  return segments
    .slice()
    .sort((a, b) => Number(a.segment_order || 0) - Number(b.segment_order || 0))
    .map(segment => segmentCardData(segment, record));
}

function buildSegmentsText(record){
  const cards = buildSegmentCards(record);
  if(!cards.length) return 'brak danych';
  return cards.map(card => `${card.title}: ${card.lines.map(([label, value]) => `${label} ${value}`).join(', ')}`).join('. ');
}

function metricForDate(items, date){
  return items.find(item => fmtDateIso(item.metric_date || item.journal_date) === date) || null;
}

function journalLine(item){
  if(!item) return 'brak danych';
  return [
    item.energy != null ? `energia ${item.energy}` : '',
    item.stress != null ? `stress dziennik ${item.stress}` : '',
    item.motivation != null ? `motywacja ${item.motivation}` : '',
    item.feeling ? `samopoczucie: ${item.feeling}` : '',
    item.pain ? `ból: ${item.pain}` : '',
    item.food ? `jedzenie: ${item.food}` : '',
    item.hydration ? `nawodnienie: ${item.hydration}` : '',
    item.notes ? `notatka: ${item.notes}` : ''
  ].filter(Boolean).join(', ') || 'brak danych';
}

function dailyDataForOffset(record, offset){
  const date = addDaysIso(record.workout_date, offset);
  const daily = metricForDate(parseJsonArray(record.daily_metrics_window), date);
  const journal = metricForDate(parseJsonArray(record.journal_window), date);
  const label = offset < 0 ? `D${offset}` : offset > 0 ? `D+${offset}` : 'Dzień aktywności';
  return { label, date, daily, journal };
}

function nightResponseAfterActivity(record){
  if(!record) return 'Brak danych z kolejnej nocy — pełna ocena kosztu regeneracji nie jest jeszcze możliwa.';
  const activityDate = fmtDateIso(record.workout_date || record.started_at);
  const nextDate = addDaysIso(activityDate, 1);
  const after = metricForDate(parseJsonArray(record.daily_metrics_window), nextDate);
  if(!after){
    return 'Brak danych z kolejnej nocy — pełna ocena kosztu regeneracji nie jest jeszcze możliwa.';
  }

  const hasAny = after.sleep_minutes != null
    || after.body_battery_end != null
    || after.body_battery_start != null
    || after.avg_stress != null
    || after.resting_hr != null
    || after.training_readiness_score != null
    || after.hrv_status != null
    || after.hrv_avg != null;

  if(!hasAny){
    return 'Brak danych z kolejnej nocy — pełna ocena kosztu regeneracji nie jest jeszcze możliwa.';
  }

  const sleep = after.sleep_minutes != null ? fmtMin(after.sleep_minutes) : 'brak danych';
  const battery = after.body_battery_end ?? after.body_battery_start ?? 'brak danych';
  const stress = after.avg_stress != null ? Math.round(Number(after.avg_stress)) : 'brak danych';
  const rhr = after.resting_hr != null ? Math.round(Number(after.resting_hr)) : 'brak danych';
  const readiness = after.training_readiness_score != null ? `${Math.round(Number(after.training_readiness_score))}/100${after.training_readiness_level ? ` (${after.training_readiness_level})` : ''}` : 'brak danych';
  const hrv = after.hrv_status || (after.hrv_avg != null ? `${fmtNumber(after.hrv_avg)} ms` : 'brak danych');
  const readinessN = Number(after.training_readiness_score);
  const sleepN = Number(after.sleep_minutes);
  const stressN = Number(after.avg_stress);

  let coach = 'Po tej nocy można już lepiej ocenić, ile ten trening kosztował organizm.';
  if(Number.isFinite(readinessN) && readinessN <= 35){
    coach = 'Po kolejnej nocy widać, że trening zostawił wyraźny koszt — organizm nie jest jeszcze gotowy na mocny bodziec.';
  }else if(Number.isFinite(sleepN) && sleepN < 360){
    coach = 'Po kolejnej nocy obraz regeneracji jest niepełny, bo sen był krótki i mógł ograniczyć odbudowę.';
  }else if(Number.isFinite(stressN) && stressN <= 30){
    coach = 'Po kolejnej nocy organizm wygląda spokojnie — nie ma sygnału mocnego rozbicia w dostępnych danych.';
  }

  return `${coach} Poranek po treningu: sen ${sleep}, Body Battery ${battery}, stress ${stress}, tętno spoczynkowe ${rhr}, gotowość ${readiness}, HRV ${hrv}.`;
}

function timelineCardForOffset(record, offset){
  const entry = dailyDataForOffset(record, offset);
  const daily = entry.daily;
  const rows = [
    ['Gotowość', daily?.training_readiness_score != null ? `${Math.round(Number(daily.training_readiness_score))}/100 ${daily.training_readiness_level || ''}`.trim() : 'brak danych'],
    ['Sen', daily?.sleep_minutes != null ? `${Math.round(Number(daily.sleep_minutes))} min` : 'brak danych'],
    ['Body Battery', daily?.body_battery_start != null || daily?.body_battery_end != null ? `${daily.body_battery_start != null ? Math.round(Number(daily.body_battery_start)) : 'brak danych'} → ${daily.body_battery_end != null ? Math.round(Number(daily.body_battery_end)) : 'brak danych'}` : 'brak danych'],
    ['Stress', daily?.avg_stress != null ? Math.round(Number(daily.avg_stress)) : 'brak danych'],
    ['Resting HR', daily?.resting_hr != null ? Math.round(Number(daily.resting_hr)) : 'brak danych'],
    ['Dziennik', journalLine(entry.journal)]
  ];
  return { ...entry, rows };
}

function contextBeforeText(record){
  return [-3, -2, -1].map(offset => timelineCardForOffset(record, offset));
}

function activityDayText(record){
  return [timelineCardForOffset(record, 0)];
}

function recoveryAfterText(record){
  return [timelineCardForOffset(record, 1)];
}

function segmentTypes(record){
  return parseJsonArray(record?.segments).map(segment => String(segment.segment_type || '').toLowerCase());
}

function hasSegment(record, type){
  return segmentTypes(record).includes(type);
}

function segmentByType(record, type){
  return parseJsonArray(record?.segments).find(segment => String(segment.segment_type || '').toLowerCase() === type) || null;
}

function runHrText(record){
  const run = segmentByType(record, 'run');
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
  if(score != null && score <= 20) return `Poranek po treningu: gotowość ${Math.round(score)}/100 ${level || ''} pokazuje duży koszt regeneracyjny.`.trim();
  if(batteryEnd != null && batteryEnd < 45) return `Poranek po treningu: Body Battery ${Math.round(batteryEnd)} sugeruje wyraźny koszt regeneracyjny.`;
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
  const thresholdInsight = bikeThresholdInsight(record);

  if(isMulti){
    const parts = ['Wniosek pod Ironman Kalmar: ten start pokazuje układ pływanie–rower–bieg, więc najważniejsza jest kontrola kosztu między dyscyplinami.'];
    if(hasBike && (bikeIf != null || np || record.bike_if_category)) parts.push(`Rower jest mocnym elementem, ale wymaga kontroli${bikeIf != null ? ` — IF Garmin ${fmtIf(bikeIf)}` : ''}${np ? `, NP ${np}` : ''}${record.bike_if_category ? `, kategoria ${record.bike_if_category}` : ''}.`);
    if(thresholdInsight) parts.push(thresholdInsight);
    if(hasRun && runHr) parts.push(`Bieg był wykonywany wysoko tętniowo (${runHr}), więc koszt roweru trzeba pilnować przed dłuższymi dystansami.`);
    if(recoveryCost) parts.push(recoveryCost);
    if(!hasBike && !hasRun && load != null) parts.push(`Load ${fmtNumber(load)} pokazuje koszt całego startu, ale brakuje pełnych danych segmentów do głębszej oceny.`);
    return parts.join(' ');
  }

  if(hasBike){
    const parts = ['Wniosek pod Ironman Kalmar: rower trzeba rozwijać jako stabilną, ekonomiczną pracę, a nie tylko pojedynczy mocny bodziec.'];
    if(bikeIf != null || np || record.bike_if_category) parts.push(`Dostępne dane rowerowe: ${bikeIf != null ? `IF Garmin ${fmtIf(bikeIf)}` : 'IF Garmin brak danych'}${np ? `, NP ${np}` : ', NP brak danych'}${record.bike_if_category ? `, kategoria ${record.bike_if_category}` : ''}.`);
    if(thresholdInsight) parts.push(thresholdInsight);
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
  const after = metricForDate(parseJsonArray(record.daily_metrics_window), addDaysIso(record.workout_date, 1));
  const activityDay = metricForDate(parseJsonArray(record.daily_metrics_window), fmtDateIso(record.workout_date));
  const before = parseJsonArray(record.daily_metrics_window).filter(item => itemMatchesRelativeDay(item, 'before', record));
  const moderateBefore = before.some(item => String(item.training_readiness_level || '').toUpperCase() === 'MODERATE');
  const hasBike = hasSegment(record, 'bike');
  const hasRun = hasSegment(record, 'run');
  const sentences = [];
  if(moderateBefore || activityDay?.training_readiness_level){
    sentences.push('Szymon wszedł w aktywność z gotowością umiarkowaną, ale sen w oknie startowym był krótki albo niepełny tam, gdzie mamy dane.');
  }else{
    sentences.push('Wejście w aktywność: readiness przed startem brak danych.');
  }
  if(load != null || hrAvg != null || hrMax != null){
    sentences.push(`Sam bodziec był konkretny: obciążenie ${load != null ? fmtNumber(load) : 'brak danych'} i HR ${hrAvg != null ? Math.round(hrAvg) : 'brak danych'}/${hrMax != null ? Math.round(hrMax) : 'brak danych'} pokazują pracę, ale nie oznaczają automatycznie alarmu u doświadczonego zawodnika.`);
  }
  if(hasBike && (bikeIf != null || record.bike_if_category)) sentences.push('Rower był mocnym elementem startu, więc w dłuższym triathlonie trzeba pilnować, żeby nie zabrał jakości biegu.');
  const thresholdInsight = bikeThresholdInsight(record);
  if(thresholdInsight) sentences.push(thresholdInsight);
  if(hasRun && runHrText(record)) sentences.push(`Bieg był wykonywany wysoko tętniowo (${runHrText(record)}), czyli organizm pracował już blisko górnego zakresu.`);
  if(after){
    sentences.push(`Poranek po treningu potwierdza koszt regeneracyjny: gotowość ${after.training_readiness_score != null ? `${Math.round(Number(after.training_readiness_score))}/100 ${after.training_readiness_level || ''}` : 'brak danych'}, Body Battery ${after.body_battery_end != null ? Math.round(Number(after.body_battery_end)) : 'brak danych'}.`);
  }else{
    sentences.push('Koszt po aktywności: brak danych z poranka po treningu, więc nie udajemy pełnej oceny reakcji.');
  }
  return sentences.join(' ');
}

function fullRecoveryRecommendation(record){
  const after = metricForDate(parseJsonArray(record.daily_metrics_window), addDaysIso(record.workout_date, 1));
  const poorAfter = after && (Number(after.training_readiness_score) <= 20 || String(after.training_readiness_level || '').toUpperCase() === 'POOR');
  if(poorAfter){
    return 'Po tej aktywności priorytetem jest spokojne domknięcie regeneracji: sen, nawodnienie i lekki ruch. Do mocniejszego bodźca wracaj dopiero po potwierdzeniu poranka.';
  }
  return 'Po tej aktywności nie trzeba panikować. Wybierz lekki trening, technikę albo kontrolowaną pracę — mocniejszy bodziec dopiero, gdy poranek i odczucie Szymona to potwierdzą.';
}

function buildGoodPoints(record){
  const points = [];
  const swim = segmentByType(record, 'swim');
  const bike = segmentByType(record, 'bike');
  const run = segmentByType(record, 'run');
  if(swim) points.push(`Pływanie zostało wykonane konkretnie: ${swim.distance_meters != null ? fmtKmDot(Number(swim.distance_meters) / 1000) : 'brak danych'}, ${swim.duration_seconds != null ? fmtSeconds(swim.duration_seconds) : 'brak danych'}, HR ${swim.hr_avg != null ? Math.round(Number(swim.hr_avg)) : 'brak danych'}/${swim.hr_max != null ? Math.round(Number(swim.hr_max)) : 'brak danych'}.`);
  if(bike) points.push(`Rower jest mocnym atutem: ${bikeTotalLine(record)}. IF Garmin ${record.bike_if_value != null ? fmtIf(record.bike_if_value) : 'brak danych'}.`);
  if(run) points.push(`Bieg został dowieziony po rowerze: ${run.distance_meters != null ? fmtKmDot(Number(run.distance_meters) / 1000) : 'brak danych'}, ${run.duration_seconds != null ? fmtSeconds(run.duration_seconds) : 'brak danych'}, tempo ${run.pace_min_per_km != null ? fmtPace(run.pace_min_per_km) : 'brak danych'}.`);
  if(!points.length) points.push('Dane Garmin PRO pozwalają opisać aktywność, ale brak pełnych segmentów ogranicza ocenę szczegółową.');
  return points.slice(0, 4);
}

function buildRiskPoints(record){
  const points = [];
  const load = numberOrNull(record.training_load);
  const bikeIf = numberOrNull(record.bike_if_value ?? record.intensity_factor);
  const runHr = runHrText(record);
  const after = metricForDate(parseJsonArray(record.daily_metrics_window), addDaysIso(record.workout_date, 1));
  if(load != null && load >= 250) points.push(`Load ${fmtNumber(load)} to mocny bodziec — następny akcent wymaga kontroli, nie automatycznego alarmu.`);
  if(bikeIf != null && bikeIf >= 0.9) points.push(`Rower był intensywny: IF ${fmtIf(bikeIf)}. Przy dłuższym dystansie taki koszt trzeba mocno kontrolować.`);
  if(runHr) points.push(`Bieg miał wyraźne tętno (${runHr}), więc traktujemy go jako bodziec, ale oceniamy też odczucie Szymona.`);
  if(after?.training_readiness_score != null && Number(after.training_readiness_score) <= 20) points.push(`Poranek po treningu: gotowość ${Math.round(Number(after.training_readiness_score))}/100 ${after.training_readiness_level || ''} pokazuje bardzo duży koszt po aktywności.`);
  if(!points.length) points.push('Brak wyraźnych czerwonych flag w dostępnych danych, ale analiza jest ograniczona do tego, co zwraca Garmin PRO.');
  return points.slice(0, 4);
}

function buildHeadline(record){
  const after = metricForDate(parseJsonArray(record.daily_metrics_window), addDaysIso(record.workout_date, 1));
  const load = record.training_load != null ? fmtNumber(record.training_load) : 'brak danych';
  const hr = record.hr_avg != null || record.hr_max != null ? `${record.hr_avg != null ? Math.round(Number(record.hr_avg)) : 'brak danych'}/${record.hr_max != null ? Math.round(Number(record.hr_max)) : 'brak danych'}` : 'brak danych';
  const afterText = after?.training_readiness_score != null ? ` Następnego dnia gotowość: ${Math.round(Number(after.training_readiness_score))}/100 ${after.training_readiness_level || ''} — to decyduje, jak szybko wracamy do pracy.` : ' Brak danych z poranka po treningu ogranicza ocenę reakcji organizmu.';
  return `To była aktywność z realnym bodźcem: obciążenie ${load}, HR ${hr}. Szymon ma doświadczenie, więc nie oceniamy jej jak treningu początkującego — kluczowa jest reakcja po nocy.${afterText}`;
}

function buildFactBasedActivityAnalysis(activityContext){
  if(!activityContext?.activity){
    return {
      hasFullContext: false,
      facts: [['Aktywność', 'brak danych']],
      mode: 'Analiza podstawowa — ograniczona do dostępnych danych',
      headline: 'Brak aktywności Garmin PRO do analizy.',
      good: ['brak danych'],
      risks: ['brak danych'],
      segmentCards: [],
      contextBefore: [],
      activityDay: [],
      recoveryContext: [],
      nightResponse: 'Brak danych z kolejnej nocy — pełna ocena kosztu regeneracji nie jest jeszcze możliwa.',
      coachAnalysis: 'Brak aktywności Garmin PRO do analizy.',
      kalmar: 'brak danych',
      recovery: 'brak danych',
      rawSummary: '',
      thresholdProfile: 'brak danych',
      powerIntervals: [],
      powerInsight: 'brak danych',
      profileContextStatus: thresholdProfileContextStatus(null),
      runIntervals: [],
      runInsight: 'brak danych'
    };
  }
  if(!activityContext.hasFullContext){
    const basic = buildBasicActivityAnalysis(activityContext.activity, {});
    return {
      hasFullContext: false,
      facts: basic.facts,
      mode: 'Analiza podstawowa — ograniczona do dostępnych danych',
      headline: `${basic.rating} ${basic.caution}`,
      good: [basic.good],
      risks: [basic.caution],
      segmentCards: [],
      contextBefore: [],
      activityDay: [],
      recoveryContext: [],
      nightResponse: nightResponseAfterActivity(activityContext.activity),
      coachAnalysis: `${basic.rating} ${basic.good} ${basic.caution}`,
      kalmar: basic.kalmar,
      recovery: basic.recovery,
      rawSummary: activityContext.activity?.auto_summary || activityContext.activity?.segment_summary || '',
      thresholdProfile: bikeThresholdInsight(activityContext.activity) || 'Profil progów Szymona: brak danych dla tej aktywności.',
      powerIntervals: powerIntervalsForActivity(activityContext.activity),
      powerInsight: powerIntervalInsight(activityContext.activity) || 'Brak zapisanych interwałów mocy dla tej aktywności.',
      profileContextStatus: thresholdProfileContextStatus(activityContext.activity),
      runIntervals: runIntervalsForActivity(activityContext.activity),
      runInsight: runIntervalInsight(activityContext.activity) || 'Brak zapisanych odcinków biegu dla tej aktywności.'
    };
  }
  const record = activityContext.contextRecord;
  return {
    hasFullContext: true,
    facts: contextActivityFacts(record),
    mode: 'Analiza PRO — tydzień, trening i poranek po treningu',
    headline: buildHeadline(record),
    good: buildGoodPoints(record),
    risks: buildRiskPoints(record),
    segmentCards: buildSegmentCards(record),
    contextBefore: contextBeforeText(record),
    activityDay: activityDayText(record),
    recoveryContext: recoveryAfterText(record),
    nightResponse: nightResponseAfterActivity(record),
    coachAnalysis: fullCoachAnalysis(record),
    kalmar: buildDynamicKalmarConclusion(record),
    recovery: fullRecoveryRecommendation(record),
    rawSummary: record.auto_summary || '',
    thresholdProfile: bikeThresholdInsight(record) || 'Dla tej aktywności brak użytecznych progów Szymona.',
    powerIntervals: powerIntervalsForActivity(record),
    powerInsight: powerIntervalInsight(record) || 'Brak zapisanych interwałów mocy dla tej aktywności.',
    profileContextStatus: thresholdProfileContextStatus(record),
    runIntervals: runIntervalsForActivity(record),
    runInsight: runIntervalInsight(record) || 'Brak zapisanych odcinków biegu dla tej aktywności.'
  };
}

async function fetchRealAiAnalysis(activity){
  const activityId = activity?.id ?? activity?.activity_id;
  if(!activityId) return null;
  if(aiAnalysisCache.has(activityId)) return aiAnalysisCache.get(activityId);
  try{
    const response = await fetch(ACTIVITY_AI_ANALYSIS_ENDPOINT, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ activityId })
    });
    if(!response.ok) throw new Error(`AI analysis ${response.status}`);
    const json = await response.json();
    if(json.error || !json.analysis) throw new Error(json.error || 'Brak analysis w odpowiedzi');
    aiAnalysisCache.set(activityId, json.analysis);
    return json.analysis;
  }catch(err){
    console.warn('Nie udało się pobrać analizy AI, używam analizy faktograficznej jako fallback:', err);
    return null;
  }
}

function mergeRealAiIntoAnalysis(baseAnalysis, aiResult){
  if(!aiResult) return baseAnalysis;
  return {
    ...baseAnalysis,
    headline: aiResult.headline || baseAnalysis.headline,
    coachAnalysis: aiResult.coachAnalysis || baseAnalysis.coachAnalysis,
    good: Array.isArray(aiResult.good) && aiResult.good.length ? aiResult.good : baseAnalysis.good,
    risks: Array.isArray(aiResult.risks) && aiResult.risks.length ? aiResult.risks : baseAnalysis.risks,
    kalmar: aiResult.kalmar || baseAnalysis.kalmar,
    recovery: aiResult.recovery || baseAnalysis.recovery,
    nightResponse: aiResult.nightResponse || baseAnalysis.nightResponse,
    dataGaps: Array.isArray(aiResult.dataGaps) ? aiResult.dataGaps : [],
    isRealAi: true
  };
}

function buildActivityAiAnalysis(activity){
  return buildFactBasedActivityAnalysis(buildActivityContext(activity));
}

function renderFactsBlock(rows){
  return `<details class="facts-block analysis-details"><summary>Surowe fakty Garmin PRO</summary><ul>${rows.map(([label, value]) => `<li><b>${escapeHtml(label)}</b><em>${escapeHtml(value || 'brak danych')}</em></li>`).join('')}</ul></details>`;
}

function renderAnalysisBlock(title, text, className = ''){
  return `<section class="analysis-section ${className}"><span>${escapeHtml(title)}</span><p>${escapeHtml(humanizeCoachText(text || 'brak danych'))}</p></section>`;
}

function renderBulletSection(title, items, className = ''){
  const list = (items && items.length ? items : ['brak danych']).map(item => `<li>${escapeHtml(humanizeCoachText(item))}</li>`).join('');
  return `<section class="analysis-section ${className}"><span>${escapeHtml(title)}</span><ul class="coach-bullets">${list}</ul></section>`;
}

function renderSegmentCards(cards){
  if(!cards || !cards.length) return renderAnalysisBlock('Segmenty', 'brak danych');
  return `<section class="analysis-section segment-section"><span>Segmenty</span><div class="segment-card-grid">${cards.map(card => `<article class="segment-card segment-${escapeHtml(card.type)}"><h4>${escapeHtml(card.title)}</h4>${card.lines.map(([label, value]) => `<div><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>`).join('')}</article>`).join('')}</div></section>`;
}

function renderTimeline(title, entries){
  if(!entries || !entries.length) return renderAnalysisBlock(title, 'brak danych');
  return `<section class="analysis-section timeline-section"><span>${escapeHtml(title)}</span><div class="timeline-grid">${entries.map(entry => `<article class="timeline-card"><h4>${escapeHtml(entry.label)} · ${escapeHtml(entry.date || 'brak danych')}</h4>${entry.rows.map(([label, value]) => `<div><span>${escapeHtml(label)}</span><b>${escapeHtml(value)}</b></div>`).join('')}</article>`).join('')}</div></section>`;
}

function renderRawSummary(text){
  if(!text) return '';
  return `<details class="analysis-details raw-summary"><summary>Podsumowanie Garmin</summary><p>${escapeHtml(text)}</p></details>`;
}



function renderThresholdProfileContext(status){
  if(!status) return '';
  const availableList = status.available?.length
    ? status.available.map(item => `<li>${escapeHtml(item)}</li>`).join('')
    : '<li>brak dostępnych progów dla tej dyscypliny</li>';
  const missingList = status.missing?.length
    ? status.missing.map(item => `<li>${escapeHtml(item)}</li>`).join('')
    : '<li>brak jawnie oznaczonych braków</li>';

  return `
    <section class="analysis-section profile-context-section">
      <span>${escapeHtml(status.title || 'Profil progów — status danych')}</span>
      <p>${escapeHtml(status.summary || 'brak danych')}</p>
      <details class="profile-details">
        <summary>Co AI ma, a czego nie ma?</summary>
        <div class="profile-detail-grid">
          <div>
            <b>Dostępne</b>
            <ul>${availableList}</ul>
          </div>
          <div>
            <b>Braki</b>
            <ul>${missingList}</ul>
          </div>
        </div>
      </details>
    </section>
  `;
}



function renderRunIntervals(rows, insight){
  if(!rows || !rows.length) return '';

  const key = keyRunInterval(rows);
  const texts = runCoachTexts(key);

  const detailRows = rows.map(row => {
    const cells = [
      `<td>${escapeHtml(runIntervalLabel(row.interval_type, row.target_m).replace('Najlepszy ', '').replace('Najlepsze ', ''))}</td>`,
      `<td>${escapeHtml(paceTextFromSec(row.pace_sec_per_km))}</td>`,
      `<td>${row.moving_time_sec != null ? `${escapeHtml(fmtNumber(row.moving_time_sec))} s` : 'brak'}</td>`,
      `<td>${row.avg_hr != null ? escapeHtml(fmtNumber(row.avg_hr)) : 'brak'}</td>`,
      `<td>${row.max_hr != null ? escapeHtml(fmtNumber(row.max_hr)) : 'brak'}</td>`,
      `<td>${row.avg_power_w != null ? `${escapeHtml(fmtNumber(row.avg_power_w))} W` : 'brak'}</td>`,
      `<td>${row.avg_cadence != null ? escapeHtml(fmtNumber(row.avg_cadence)) : 'brak'}</td>`
    ].join('');
    return `<tr>${cells}</tr>`;
  }).join('');

  return `
    <section class="analysis-section run-coach-section">
      <span>Run curve — wniosek trenerski</span>

      <div class="run-coach-card">
        <div class="run-coach-part">
          <b>Najmocniejszy sygnał</b>
          <p>${escapeHtml(texts.signal)}</p>
        </div>

        <div class="run-coach-part">
          <b>Interpretacja</b>
          <p>${escapeHtml(texts.interpretation)}</p>
        </div>

        <div class="run-coach-part">
          <b>Znaczenie</b>
          <p>${escapeHtml(texts.meaning)}</p>
        </div>
      </div>

      <details class="run-details">
        <summary>Więcej szczegółów biegu</summary>
        <div class="run-table-wrap">
          <table class="run-table">
            <thead>
              <tr>
                <th>Odcinek</th>
                <th>Tempo</th>
                <th>Czas</th>
                <th>HR śr.</th>
                <th>HR max</th>
                <th>Moc</th>
                <th>Kad.</th>
              </tr>
            </thead>
            <tbody>${detailRows}</tbody>
          </table>
        </div>
      </details>
    </section>
  `;
}


function renderPowerIntervals(rows, insight){
  if(!rows || !rows.length) return '';

  const key = keyPowerInterval(rows);
  const texts = powerCoachTexts(key);

  const detailRows = rows.map(row => {
    const cells = [
      `<td>${escapeHtml(powerIntervalLabel(row.interval_type, row.target_sec).replace('Najlepsze ', ''))}</td>`,
      `<td>${row.avg_power_w != null ? `${escapeHtml(fmtNumber(row.avg_power_w))} W` : 'brak'}</td>`,
      `<td>${row.pct_ftp != null ? `${escapeHtml(fmtNumber(row.pct_ftp))}%` : 'brak'}</td>`,
      `<td>${row.pct_eftp != null ? `${escapeHtml(fmtNumber(row.pct_eftp))}%` : 'brak'}</td>`,
      `<td>${row.w_per_kg != null ? escapeHtml(fmtNumber(row.w_per_kg, 2)) : 'brak'}</td>`,
      `<td>${row.avg_hr != null ? escapeHtml(fmtNumber(row.avg_hr)) : 'brak'}</td>`
    ].join('');
    return `<tr>${cells}</tr>`;
  }).join('');

  return `
    <section class="analysis-section power-coach-section">
      <span>Power curve — wniosek trenerski</span>

      <div class="power-coach-card">
        <div class="power-coach-part">
          <b>Najmocniejszy sygnał</b>
          <p>${escapeHtml(texts.signal)}</p>
        </div>

        <div class="power-coach-part">
          <b>Interpretacja</b>
          <p>${escapeHtml(texts.interpretation)}</p>
        </div>

        <div class="power-coach-part">
          <b>Znaczenie</b>
          <p>${escapeHtml(texts.meaning)}</p>
        </div>
      </div>

      <details class="power-details">
        <summary>Więcej szczegółów mocy</summary>
        <div class="power-table-wrap">
          <table class="power-table">
            <thead>
              <tr>
                <th>Odcinek</th>
                <th>Moc</th>
                <th>FTP</th>
                <th>eFTP</th>
                <th>W/kg</th>
                <th>HR</th>
              </tr>
            </thead>
            <tbody>${detailRows}</tbody>
          </table>
        </div>
      </details>
    </section>
  `;
}



function renderFullAnalysisDetails(analysis){
  const content = [
    renderAnalysisBlock('Tryb analizy', analysis.mode, 'mode-section'),
    renderThresholdProfileContext(analysis.profileContextStatus),
    renderAnalysisBlock('Najważniejszy wniosek', analysis.headline, 'headline-section'),
    renderAnalysisBlock('Profil / progi Szymona', analysis.thresholdProfile, 'threshold-section'),
    renderBulletSection('Co poszło dobrze', analysis.good, 'good-section'),
    renderBulletSection('Koszt / ryzyka', analysis.risks, 'risk-section'),
    renderSegmentCards(analysis.segmentCards),
    renderTimeline('Kontekst przed aktywnością', analysis.contextBefore),
    renderTimeline('Dzień aktywności', analysis.activityDay),
    renderAnalysisBlock('Odpowiedź po nocy', analysis.nightResponse, 'night-response-section'),
    renderTimeline('Regeneracja po aktywności', analysis.recoveryContext),
    renderAnalysisBlock('Analiza trenerska', analysis.coachAnalysis, 'coach-section'),
    renderAnalysisBlock('Wniosek pod Ironman Kalmar', analysis.kalmar, 'kalmar-section'),
    renderAnalysisBlock('Zalecenie', analysis.recovery, 'recommendation-section'),
    renderFactsBlock(analysis.facts),
    renderRawSummary(analysis.rawSummary)
  ].filter(Boolean).join('');

  return `
    <details class="analysis-full-details">
      <summary>Więcej szczegółów analizy AI</summary>
      <div class="analysis-full-details-body">${content}</div>
    </details>
  `;
}


function renderActivityAiAnalysis(targetId, activity){
  const target = $(targetId);
  if(!target) return;
  const baseAnalysis = buildActivityAiAnalysis(activity);
  renderAiAnalysisInto(target, baseAnalysis, 'loading');

  fetchRealAiAnalysis(activity).then(aiResult => {
    // Jeśli w międzyczasie użytkownik przełączył się na inną aktywność, nie nadpisuj.
    const selected = selectedActivity();
    if(selected && selected.id !== activity?.id && selected.activity_id !== activity?.activity_id) return;
    const merged = mergeRealAiIntoAnalysis(baseAnalysis, aiResult);
    renderAiAnalysisInto(target, merged, aiResult ? 'ai' : 'fallback');
  });
}

function renderAiAnalysisInto(target, analysis, status){
  const topCards = [
    renderPowerIntervals(analysis.powerIntervals, analysis.powerInsight),
    renderRunIntervals(analysis.runIntervals, analysis.runInsight)
  ].filter(Boolean);

  const visibleSummary = topCards.length
    ? topCards.join('')
    : renderAnalysisBlock('Najważniejszy wniosek', analysis.headline, 'headline-section');

  const statusBadge = status === 'loading'
    ? '<div class="ai-status-badge loading">AI analizuje trening...</div>'
    : status === 'ai'
      ? '<div class="ai-status-badge ai-ok">Analiza wygenerowana przez AI</div>'
      : '<div class="ai-status-badge ai-fallback">Analiza podstawowa (AI niedostępne) — pokazuję dane faktograficzne</div>';

  const nightSummary = renderAnalysisBlock('Odpowiedź po nocy', analysis.nightResponse, 'night-response-section night-response-visible');
  target.innerHTML = [
    statusBadge,
    visibleSummary,
    nightSummary,
    renderFullAnalysisDetails(analysis)
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
  detail.innerHTML = renderProActivityAnalysisShell(activity);
  bindProAnalysisButtons(detail);
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
  const target = ['dashboard', 'analysis', 'history', 'ai', 'settings', 'kalmar'].includes(tab) ? tab : 'dashboard';
  applyActiveTabClass(target);
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
  const historySearch = $('historySearchInput');
  if(historySearch){
    historySearch.addEventListener('input', event => {
      historySearchTerm = event.target.value || '';
      historyShowAll = false;
      renderHistory();
    });
  }
  const historyFilter = $('historySportFilter');
  if(historyFilter){
    historyFilter.addEventListener('change', event => {
      historySportFilter = event.target.value || 'all';
      historyShowAll = false;
      renderHistory();
    });
  }
  const historyMoreBtn = $('historyShowMoreBtn');
  if(historyMoreBtn){
    historyMoreBtn.addEventListener('click', () => {
      historyShowAll = !historyShowAll;
      renderHistory();
    });
  }
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
  const toggleThresholdBtn = $('toggleThresholdSuggestionsBtn');
  if(toggleThresholdBtn){
    toggleThresholdBtn.addEventListener('click', () => {
      thresholdPanelOpen = !thresholdPanelOpen;
      renderSettings();
      if(thresholdPanelOpen){
        const panel = $('thresholdSuggestionPanel');
        if(panel) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });
  }
  const suggestionList = $('thresholdSuggestionList');
  if(suggestionList){
    suggestionList.addEventListener('click', handleThresholdSuggestionClick);
  }
  $$('.bottom-nav button').forEach(btn => btn.addEventListener('click', () => showTab(btn.dataset.tab)));
  $$('[data-mode]').forEach(btn => btn.addEventListener('click', () => {
    aiMode = btn.dataset.mode === 'analysis' ? 'analysis' : 'plan';
    renderAi();
  }));
}

async function init(){
  bindEvents();
  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('service-worker.js?v=550').catch(() => {});
  }
  if(loadSession() && await refreshSession()){
    showApp();
    await loadAllData();
  }else{
    showLogin();
  }
}

init();
