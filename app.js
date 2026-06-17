const VERSION = 'v5.3.4-human-language-everywhere-local';
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

let session = null;
let user = null;
let readiness = null;
let weekly = null;
let latest = null;
let cards = [];
let load28d = [];
let activityContexts = [];
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
  weekly: 'idle',
  latest: 'idle',
  cards: 'idle',
  load28d: 'idle',
  thresholds: 'idle',
  powerIntervals: 'idle',
  thresholdProfileContext: 'idle',
  runIntervals: 'idle',
  thresholdSuggestions: 'idle'
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


function hasTextAny(text, patterns){
  const source = String(text || '').toLowerCase();
  return patterns.some(pattern => source.includes(pattern));
}

function humanLoadMeaning(load){
  const n = numberOrNull(load);
  if(n == null) return '';
  if(n >= 250) return 'To nie była lekka jednostka — obciążenie pokazuje duży koszt dla organizmu.';
  if(n >= 120) return 'To był solidny bodziec, który warto uwzględnić w regeneracji.';
  if(n >= 50) return 'To był umiarkowany bodziec: coś dołożył, ale bez przesadnej demolki.';
  return 'Obciążenie wygląda raczej spokojnie, więc sama jednostka nie powinna mocno rozbić organizmu.';
}

function humanHrMeaning(hrAvg, hrMax){
  const avg = numberOrNull(hrAvg);
  const max = numberOrNull(hrMax);
  if(avg == null && max == null) return '';
  if(avg != null && avg >= 165) return 'Tętno było wysoko przez większość aktywności, więc organizm pracował mocno, a nie tylko „odhaczał” trening.';
  if(max != null && max >= 180) return 'W końcówkach lub mocniejszych fragmentach serce weszło bardzo wysoko, więc koszt wysiłku był realny.';
  if(avg != null && avg >= 140) return 'Tętno pokazuje konkretną pracę, ale bez sygnału skrajnego przeciążenia.';
  return 'Tętno wygląda spokojnie — bardziej jak kontrolowana praca niż walka o przetrwanie.';
}

function humanActivitySummary(item){
  if(!item) return 'Brak danych do opisania tej aktywności.';
  const text = activityText(item).toLowerCase();
  const sport = String(item?.sport_type || item?.activity_type || '').toLowerCase();
  const load = numberOrNull(item?.training_load);
  const hrAvg = numberOrNull(item?.hr_avg);
  const hrMax = numberOrNull(item?.hr_max);
  const ifValue = numberOrNull(item?.bike_if_value ?? item?.intensity_factor ?? extractMetric(item, [/\bIF\s*[:=]?\s*([0-9]+(?:[.,][0-9]+)?)/i]));
  const hasSwim = hasTextAny(text, ['pływanie', 'swim']) || sport.includes('swim');
  const hasBike = hasTextAny(text, ['rower', 'bike']) || sport.includes('bike') || sport.includes('cycl');
  const hasRun = hasTextAny(text, ['bieg', 'run']) || sport.includes('run');
  const isTri = Boolean(item?.is_multisport) || sport.includes('triathlon') || sport.includes('multi') || (hasSwim && hasBike && hasRun);
  const parts = [];

  if(isTri){
    if(load != null && load >= 250){
      parts.push('To był krótki, ale bardzo intensywny start triathlonowy. Nie wygląda jak spokojna jednostka treningowa — organizm dostał konkretny wycisk.');
    }else{
      parts.push('To był start triathlonowy, więc koszt nie wynika z jednej dyscypliny, tylko z przejścia przez pływanie, rower i bieg jedno po drugim.');
    }
    if(hasSwim) parts.push('Pływanie było krótkie, ale od razu wprowadziło organizm na wyższe obroty.');
    if(hasBike){
      if(ifValue != null && ifValue >= 0.9) parts.push('Rower był pojechany agresywnie — tu nie było oszczędzania nóg przed biegiem.');
      else parts.push('Rower był ważnym elementem kosztu całego startu.');
    }
    if(hasRun) parts.push('Bieg został utrzymany żwawo mimo zmęczenia po wcześniejszych częściach.');
  }else if(hasBike){
    parts.push(ifValue != null && ifValue >= 0.9
      ? 'To był mocno dociśnięty rower. Intensywność była wysoka, więc taki trening trzeba liczyć jako realny koszt, nie luźne kręcenie.'
      : 'To był rower do budowania pracy i kontroli intensywności. Najważniejsze jest, czy moc była stabilna i czy tętno nie uciekało za wysoko.');
  }else if(hasRun){
    parts.push('To był bieg, który trzeba oceniać nie tylko po tempie, ale też po tętnie i po tym, jak organizm odbije kolejnej nocy.');
  }else if(hasSwim){
    parts.push('To było pływanie do oceny przez rytm, spokój i ekonomię ruchu — liczby są ważne, ale najważniejsze jest, czy woda nie zabrała zbyt dużo energii.');
  }else{
    parts.push('To była aktywność, którą trzeba oceniać przez koszt dla organizmu, a nie tylko przez dystans i czas.');
  }

  const loadText = humanLoadMeaning(load);
  const hrText = humanHrMeaning(hrAvg, hrMax);
  if(loadText) parts.push(loadText);
  if(hrText) parts.push(hrText);
  return parts.join(' ');
}

function humanSegmentNarrative(item){
  const text = activityText(item).toLowerCase();
  const hasSwim = hasTextAny(text, ['pływanie', 'swim']);
  const hasBike = hasTextAny(text, ['rower', 'bike']);
  const hasRun = hasTextAny(text, ['bieg', 'run']);
  const parts = [];
  if(hasSwim) parts.push('Pływanie potraktuj jako wejście w wysiłek — ważne, żeby nie zabrało zbyt dużo energii na dalszą część.');
  if(hasBike) parts.push('Rower pokazuje główny koszt mechaniczny i energetyczny: jeśli jest pojechany mocno, później bieg od razu robi się droższy.');
  if(hasRun) parts.push('Bieg mówi najwięcej o tym, ile zostało w baku po wcześniejszej pracy. Utrzymanie tempa przy wysokim tętnie to dobry sygnał, ale też koszt.');
  return parts.join(' ') || 'Nie mam pełnego podziału segmentów, więc opis traktuję ostrożnie.';
}

function humanCluesNarrative(item){
  const clues = extractPowerClues(item);
  const text = activityText(item).toLowerCase();
  const ifValue = numberOrNull(extractMetric(item, [/\bIF\s*[:=]?\s*([0-9]+(?:[.,][0-9]+)?)/i]));
  const parts = [];
  if(ifValue != null){
    if(ifValue >= 0.9) parts.push('Intensywność roweru była wysoka — to sygnał, że nogi mogły dostać mocno przed dalszą częścią.');
    else if(ifValue >= 0.75) parts.push('Intensywność roweru była konkretna, ale wygląda bardziej na kontrolowaną pracę niż pełne przepalenie.');
    else parts.push('Intensywność roweru wygląda spokojniej, więc koszt powinien być łatwiejszy do opanowania.');
  }
  if(hasTextAny(text, ['tempo 4:', 'pace 4:'])) parts.push('Tempo biegu było żwawe — to nie jest opis spokojnego rozbiegania, tylko mocniejszej pracy.');
  if(!parts.length && clues.length) parts.push('Dane o mocy, tempie i intensywności zostawiam w szczegółach; najważniejsze jest to, czy wysiłek był kontrolowany i jaki koszt zostawił.');
  return parts.join(' ');
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

function humanSleepLong(minutes){
  const n = Number(minutes);
  if(!Number.isFinite(n)) return 'brak danych';
  const total = Math.max(0, Math.round(n));
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  const hourLabel = hours === 1 ? 'godzinę' : (hours >= 2 && hours <= 4 ? 'godziny' : 'godzin');
  const minLabel = mins === 1 ? 'minutę' : (mins >= 2 && mins <= 4 ? 'minuty' : 'minut');
  if(hours && mins) return `${hours} ${hourLabel} i ${mins} ${minLabel}`;
  if(hours) return `${hours} ${hourLabel}`;
  return `${mins} ${minLabel}`;
}

function readinessHumanSignal(score, level){
  const n = Number(score);
  const key = String(level || '').toUpperCase();
  if(Number.isFinite(n)){
    if(n <= 20) return `Gotowość ${Math.round(n)}/100 to czerwone światło — organizm nie wygląda na gotowy do mocnego bodźca.`;
    if(n < 60) return `Gotowość ${Math.round(n)}/100 to taki sportowy żółty alert: można trenować, ale bez szaleństw.`;
    if(n < 80) return `Gotowość ${Math.round(n)}/100 wygląda przyzwoicie — organizm jest gotowy na rozsądny trening.`;
    return `Gotowość ${Math.round(n)}/100 wygląda bardzo dobrze — organizm ma mocny zapas na trening.`;
  }
  if(key === 'MODERATE') return 'Gotowość jest umiarkowana — można trenować, ale bez dokładania intensywności na siłę.';
  if(key === 'POOR' || key === 'LOW') return 'Gotowość jest niska — to raczej dzień na ostrożność niż na mocny bodziec.';
  return 'Nie mam pełnej oceny gotowości, więc decyzję trzeba oprzeć też na samopoczuciu.';
}

function humanReadinessSummary({ score, level, sleep, battery, stress, load7d }){
  const shortSleep = sleep != null && sleep < 360;
  const goodBattery = battery != null && battery >= 60;
  const calmStress = stress != null && stress <= 35;
  const highLoad = load7d != null && load7d >= 500;

  if(shortSleep && goodBattery && calmStress){
    return 'Wystartowałeś do treningu lekko niedospany, ale nie z pustego baku. Sen był za krótki, za to organizm był dość spokojny i bateria była całkiem dobrze naładowana.';
  }
  if(shortSleep){
    return 'Wystartowałeś do treningu z uszczuplonymi zasobami energii. Największy minus to krótki sen, więc organizm nie miał pełnej szansy na odbudowę.';
  }
  if(goodBattery && calmStress && !highLoad){
    return 'Na starcie organizm wyglądał całkiem stabilnie: bateria była dobra, stres niski, więc miałeś z czego trenować.';
  }
  if(highLoad){
    return 'Na starcie trzeba było pamiętać o zmęczeniu z całego tygodnia. Organizm miał już za sobą solidną dawkę pracy, więc każdy kolejny bodziec dokłada koszt.';
  }
  return 'Na starcie organizm był w stanie pozwalającym na trening, ale decyzję trzeba było podejmować z głową, a nie tylko według planu.';
}

function humanReadinessDetails({ score, level, sleep, battery, stress, load7d }){
  const lines = [];
  if(score != null) lines.push(readinessHumanSignal(score, level));
  if(sleep != null){
    const plainSleep = humanSleepLong(sleep);
    if(sleep < 360) lines.push(`Sen: ${plainSleep}. To główna rzecz, która obniżała gotowość — trochę za mało jak na pełną regenerację.`);
    else lines.push(`Sen: ${plainSleep}. Ten element wyglądał rozsądnie i dawał bazę do treningu.`);
  }
  if(battery != null){
    if(battery >= 70) lines.push(`Body Battery ${Math.round(battery)}/100: w baku było jeszcze całkiem sporo paliwa.`);
    else if(battery >= 45) lines.push(`Body Battery ${Math.round(battery)}/100: paliwo było, ale bez dużego marginesu bezpieczeństwa.`);
    else lines.push(`Body Battery ${Math.round(battery)}/100: bak był już wyraźnie przygaszony.`);
  }
  if(stress != null){
    if(stress <= 35) lines.push(`Średni stres ${Math.round(stress)}: organizm był dość spokojny, co trochę ratowało sytuację po krótszym śnie.`);
    else if(stress <= 55) lines.push(`Średni stres ${Math.round(stress)}: organizm był lekko podbity, więc regeneracja nie była idealna.`);
    else lines.push(`Średni stres ${Math.round(stress)}: organizm był mocno podbity i to jest sygnał ostrożności.`);
  }
  if(load7d != null){
    if(load7d >= 600) lines.push(`Obciążenie z 7 dni ${Math.round(load7d)}: w ostatnim tygodniu nie leżałeś na kanapie — to już solidny mikrocykl i zmęczenie się kumuluje.`);
    else if(load7d >= 350) lines.push(`Obciążenie z 7 dni ${Math.round(load7d)}: tydzień był aktywny, więc ten trening dokładał kolejną cegiełkę.`);
    else lines.push(`Obciążenie z 7 dni ${Math.round(load7d)}: tygodniowe tło nie wyglądało przesadnie ciężko.`);
  }
  return lines;
}

function readinessDecision(){
  if(!readiness) return {
    decision: 'Brak danych gotowości.',
    reason: 'Nie mam jeszcze rekordu z garmin_pro_readiness_context.',
    coach: 'Nie mam jeszcze danych z Garmina, więc nie udaję decyzji treningowej. Najpierw potrzebuję snu, gotowości, stresu i Body Battery.'
  };

  const score = numberOrNull(readiness.training_readiness_score);
  const level = String(readiness.training_readiness_level || '').toUpperCase();
  const sleep = numberOrNull(readiness.sleep_minutes);
  const battery = numberOrNull(readiness.body_battery_start ?? readiness.body_battery_end);
  const stress = numberOrNull(readiness.avg_stress ?? readiness.stress_avg);
  const load7d = numberOrNull(readiness.load_7d);

  const lowReadiness = score != null && score <= 20;
  const poorLevel = level === 'POOR' || level === 'LOW';
  const shortSleep = sleep != null && sleep < 360;
  const lowBattery = battery != null && battery < 35;

  const human = humanReadinessSummary({ score, level, sleep, battery, stress, load7d });
  const detail = humanReadinessDetails({ score, level, sleep, battery, stress, load7d }).join(' ');

  if(lowReadiness || poorLevel || shortSleep || lowBattery){
    return {
      decision: 'Dzisiaj bez mocnego treningu.',
      reason: human,
      coach: `${human} ${detail} Dzisiaj postawiłbym na spokojny ruch, technikę albo regenerację — bez dokładania mocnej intensywności na siłę.`
    };
  }

  return {
    decision: 'Trening możliwy, ale z głową.',
    reason: human,
    coach: `${human} ${detail} Trening możesz zrobić, ale pilnuj kontroli — lepiej dowieźć rozsądny bodziec niż przepalić energię na siłę.`
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
  const summary = humanActivitySummary(item);
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
    activityContext: 'activity_analysis_context',
    thresholds: 'athlete_current_thresholds',
    powerIntervals: 'garmin_activity_power_intervals',
    thresholdProfileContext: 'athlete_threshold_profile_context',
    runIntervals: 'garmin_activity_run_intervals',
    thresholdSuggestions: 'threshold_suggestions'
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
  return Boolean(readiness || weekly || latest || cards.length || load28d.length || athleteThresholds.length || activityPowerIntervals.length || activityRunIntervals.length || athleteProfileContext.length || athleteThresholdSuggestions.length);
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
}

function renderStatus(){
  const labels = {
    readiness: 'gotowość',
    weekly: 'tydzień',
    latest: 'ostatnia aktywność',
    cards: 'historia',
    load28d: 'load 28d',
    thresholds: 'progi Szymona',
    thresholdSuggestions: 'propozycje progów'
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
  const [readinessRows, weeklyRows, latestRows, cardRows, loadRows, thresholdRows, powerRows, runRows, profileRows, suggestionRows] = await Promise.all([
    loadOne('readiness', `${READINESS_ENDPOINT}?select=*&limit=1`),
    loadOne('weekly', `${WEEKLY_ENDPOINT}?select=*&limit=1`),
    loadOne('latest', `${LATEST_ENDPOINT}?select=*&limit=1`),
    loadOne('cards', `${CARDS_ENDPOINT}?select=*&order=workout_date.desc&limit=30`),
    loadOne('load28d', `${LOAD_28D_ENDPOINT}?select=workout_date,daily_training_load,daily_duration_min,daily_distance_km,activity_count&limit=28`),
    loadOne('thresholds', `${ATHLETE_THRESHOLDS_ENDPOINT}?select=*&athlete_key=eq.szymon`),
    loadOne('powerIntervals', `${POWER_INTERVALS_ENDPOINT}?select=*&athlete_key=eq.szymon&order=garmin_activity_id.asc,target_sec.asc&limit=250`),
    loadOne('runIntervals', `${RUN_INTERVALS_ENDPOINT}?select=*&athlete_key=eq.szymon&order=garmin_activity_id.asc,target_m.asc&limit=250`),
    loadOne('thresholdProfileContext', `${ATHLETE_PROFILE_CONTEXT_ENDPOINT}?select=*&athlete_key=eq.szymon&order=sport.asc,threshold_type.asc`),
    loadOne('thresholdSuggestions', `${THRESHOLD_SUGGESTIONS_ENDPOINT}?select=*&athlete_key=eq.szymon&suggestion_status=eq.pending&order=created_at.desc`)
  ]);
  readiness = readinessRows[0] || null;
  weekly = weeklyRows[0] || null;
  latest = latestRows[0] || null;
  cards = cardRows;
  load28d = loadRows;
  athleteThresholds = thresholdRows;
  activityPowerIntervals = powerRows;
  activityRunIntervals = runRows;
  athleteProfileContext = profileRows;
  athleteThresholdSuggestions = suggestionRows;
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
    ['Surowy opis Garmin', facts.autoSummary],
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
  if(strongLoad) caution.push(`To był ciężki bodziec — obciążenie ${fmtNumber(load)} nie przechodzi przez organizm bez śladu.`);
  if(highHr) caution.push(`Serce pracowało wysoko: ${facts.hrAvg != null ? Math.round(facts.hrAvg) : 'brak danych'} średnio i ${facts.hrMax != null ? Math.round(facts.hrMax) : 'brak danych'} maksymalnie, więc to nie był luźny spacer.`);
  if(hardBike) caution.push(`Rower wygląda mocno: IF ${facts.ifValue || 'brak danych'}, kategoria ${textOrMissing(activity.bike_if_category)}. To może podnieść koszt biegu.`);
  if(facts.readinessScore != null && facts.readinessScore <= 20) caution.push(`Gotowość była bardzo niska (${Math.round(facts.readinessScore)}/100), więc po takim bodźcu nie dokładałbym kolejnej intensywności.`);
  if(facts.sleep != null && facts.sleep < 360) caution.push(`Sen był krótki — ${humanSleepLong(facts.sleep)} — więc organizm nie miał pełnej szansy się odbudować.`);
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
    ? `Zalecenie po aktywności: regeneracja, mobilność albo bardzo lekki ruch. Mocniejszy trening dopiero wtedy, gdy sen, gotowość i bateria pokażą, że organizm odbił.`
    : mediumLoad
      ? `Zalecenie po aktywności: lekki trening lub technika, bez dokładania intensywności dzień po dniu.`
      : `Zalecenie po aktywności: następny mocniejszy bodziec oprzyj nie tylko na planie, ale też na śnie, gotowości, baterii i zmęczeniu z całego tygodnia.`;

  return {
    facts: factRowsFromFacts(facts),
    rating: hasEnoughToRate
      ? `Ocena: ${intensity}. W praktyce: organizm dostał bodziec ${facts.load != null ? `z obciążeniem ${fmtNumber(facts.load)}` : 'o niepełnym obciążeniu'}, tętno było ${facts.hrAvg != null ? Math.round(facts.hrAvg) : 'brak danych'} / ${facts.hrMax != null ? Math.round(facts.hrMax) : 'brak danych'}${facts.ifValue ? `, a rower miał IF ${facts.ifValue}` : ''}.`
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
  const names = cards.map(card => card.title.toLowerCase()).join(', ');
  if(names.includes('pływanie') && names.includes('rower') && names.includes('bieg')){
    return 'To była aktywność złożona: najpierw wejście w wysiłek w wodzie, potem główny koszt na rowerze i na końcu sprawdzian, ile zostało w nogach na biegu.';
  }
  return 'Segmenty pokazują nie tylko kolejność aktywności, ale też rozkład kosztu: gdzie organizm pracował spokojnie, a gdzie trzeba było mocniej zapłacić za tempo lub moc.';
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

function timelineCardForOffset(record, offset){
  const entry = dailyDataForOffset(record, offset);
  const daily = entry.daily;
  const rows = [
    ['Gotowość', daily?.training_readiness_score != null ? `${Math.round(Number(daily.training_readiness_score))}/100 ${daily.training_readiness_level || ''}`.trim() : 'brak danych'],
    ['Sen', daily?.sleep_minutes != null ? `${Math.round(Number(daily.sleep_minutes))} min` : 'brak danych'],
    ['Paliwo w baku', daily?.body_battery_start != null || daily?.body_battery_end != null ? `${daily.body_battery_start != null ? Math.round(Number(daily.body_battery_start)) : 'brak danych'} → ${daily.body_battery_end != null ? Math.round(Number(daily.body_battery_end)) : 'brak danych'}` : 'brak danych'],
    ['Spokój organizmu', daily?.avg_stress != null ? Math.round(Number(daily.avg_stress)) : 'brak danych'],
    ['Tętno spoczynkowe', daily?.resting_hr != null ? Math.round(Number(daily.resting_hr)) : 'brak danych'],
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


function humanSleepText(minutes){
  const n = Number(minutes);
  if(!Number.isFinite(n)) return 'brak danych';
  const total = Math.max(0, Math.round(n));
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if(hours && mins) return `${hours} h ${mins} min`;
  if(hours) return `${hours} h`;
  return `${mins} min`;
}

function humanMetric(value, suffix = ''){
  const n = Number(value);
  if(!Number.isFinite(n)) return 'brak danych';
  return `${Math.round(n)}${suffix}`;
}

function workoutReadiness(record){
  return metricForDate(parseJsonArray(record.daily_metrics_window), fmtDateIso(record.workout_date)) || null;
}

function recoveryDay(record){
  return metricForDate(parseJsonArray(record.daily_metrics_window), addDaysIso(record.workout_date, 1)) || null;
}

function baselineDays(record){
  return [-3, -2, -1]
    .map(offset => metricForDate(parseJsonArray(record.daily_metrics_window), addDaysIso(record.workout_date, offset)))
    .filter(Boolean);
}

function readinessHumanLevel(level){
  const key = String(level || '').toUpperCase();
  if(key === 'MODERATE') return 'umiarkowana gotowość';
  if(key === 'POOR') return 'niska gotowość';
  if(key === 'LOW') return 'niska gotowość';
  if(key === 'HIGH') return 'dobra gotowość';
  if(key === 'EXCELLENT') return 'bardzo dobra gotowość';
  return level || '';
}

function controlledTrainingText(record){
  const flags = asArray(record.coach_flags).join(' ').toLowerCase();
  const hrMax = numberOrNull(record.hr_max);
  if(flags.includes('anomaly') || flags.includes('anomalia')) return 'W danych widać sygnał, który trzeba sprawdzić — nie traktuję tego treningu jako idealnie czystego pomiaru.';
  if(hrMax != null && hrMax >= 190) return 'Trening miał wysoki pik tętna, więc warto sprawdzić, czy to była realna intensywność, czy pojedynczy skok pomiaru.';
  return 'Sam trening był pod kontrolą — nie poniosła Cię fantazja i nie widać, żebyś przegiął z intensywnością.';
}

function afterReadinessCost(record){
  const after = recoveryDay(record);
  if(!after) return '';
  const score = numberOrNull(after.training_readiness_score);
  const level = readinessHumanLevel(after.training_readiness_level);
  const batteryEnd = numberOrNull(after.body_battery_end);
  const parts = [];
  if(score != null) parts.push(`gotowość dzień po treningu: ${Math.round(score)}/100${level ? ` (${level})` : ''}`);
  if(batteryEnd != null) parts.push(`Body Battery po dniu: ${Math.round(batteryEnd)}`);
  if(!parts.length) return '';
  if(score != null && score <= 20) return `Dane z kolejnej doby pokazują, że organizm mocno odczuł ten wysiłek: ${parts.join(', ')}.`;
  if(batteryEnd != null && batteryEnd < 45) return `Dane z kolejnej doby sugerują wyraźny koszt regeneracji: ${parts.join(', ')}.`;
  return `Dane z kolejnej doby są już dostępne: ${parts.join(', ')}.`;
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
  const after = recoveryDay(record);
  const day = workoutReadiness(record);
  const baseline = baselineDays(record);
  const baselineStressValues = baseline.map(item => numberOrNull(item.avg_stress)).filter(value => value != null);
  const avgBaselineStress = baselineStressValues.length ? Math.round(baselineStressValues.reduce((sum, value) => sum + value, 0) / baselineStressValues.length) : null;
  const readinessScore = numberOrNull(day?.training_readiness_score);
  const readinessLevel = readinessHumanLevel(day?.training_readiness_level);
  const sleep = numberOrNull(day?.sleep_minutes);
  const batteryStart = numberOrNull(day?.body_battery_start ?? day?.body_battery_end);
  const stress = numberOrNull(day?.avg_stress);
  const load7d = numberOrNull(record.load_7d_before_activity);
  const sentences = [];

  sentences.push(`To był konkretny bodziec dla organizmu: load ${load != null ? fmtNumber(load) : 'brak danych'}, tętno ${hrAvg != null ? Math.round(hrAvg) : 'brak danych'}/${hrMax != null ? Math.round(hrMax) : 'brak danych'}.`);
  sentences.push(controlledTrainingText(record));

  if(readinessScore != null || sleep != null || batteryStart != null || stress != null || load7d != null){
    sentences.push(humanReadinessSummary({ score: readinessScore, level: day?.training_readiness_level, sleep, battery: batteryStart, stress, load7d }));
    humanReadinessDetails({ score: readinessScore, level: day?.training_readiness_level, sleep, battery: batteryStart, stress, load7d })
      .forEach(line => sentences.push(line));
  }else{
    sentences.push('Nie mam pełnych danych z poranka przed treningiem, więc nie będę udawał pewności. Ocenę stanu startowego traktuję ostrożnie.');
  }

  if(after){
    const afterReadiness = numberOrNull(after.training_readiness_score);
    const afterLevel = readinessHumanLevel(after.training_readiness_level);
    const afterBattery = numberOrNull(after.body_battery_end ?? after.body_battery_start);
    const afterStress = numberOrNull(after.avg_stress);
    const afterParts = [];
    if(afterReadiness != null) afterParts.push(`gotowość ${Math.round(afterReadiness)}/100${afterLevel ? ` — ${afterLevel}` : ''}`);
    if(afterBattery != null) afterParts.push(`Body Battery ${Math.round(afterBattery)}`);
    if(afterStress != null) afterParts.push(`stress ${Math.round(afterStress)}`);
    sentences.push(`Mam już dane z kolejnej nocy: ${afterParts.join(', ') || 'brak kluczowych wartości'}. Teraz można uczciwiej powiedzieć, jak organizm odpowiedział po wysiłku.`);
  }else{
    sentences.push('Na dziś widzę, jaki wysiłek dostał organizm i w jakim stanie Szymon startował. Pełnej oceny regeneracji jeszcze nie robię — do tego potrzebuję danych z kolejnej nocy: snu, tętna spoczynkowego, HRV, stresu i Body Battery.');
  }

  return sentences.join(' ');
}
function fullRecoveryRecommendation(record){
  const after = recoveryDay(record);
  if(!after){
    return 'Na teraz nie dokładałbym kolejnego mocnego bodźca tylko dlatego, że trening był wykonany. Poczekajmy na dane z kolejnej nocy — one pokażą, czy organizm wrócił do normy.';
  }
  const score = numberOrNull(after.training_readiness_score);
  const level = String(after.training_readiness_level || '').toUpperCase();
  const batteryEnd = numberOrNull(after.body_battery_end);
  const poorAfter = (score != null && score <= 20) || level === 'POOR' || (batteryEnd != null && batteryEnd < 35);
  if(poorAfter){
    return 'Dane z kolejnej doby pokazują wyraźny koszt, więc priorytetem jest sen, nawodnienie, spokojny ruch i regeneracja. Mocniejszy trening dopiero po odbiciu gotowości i Body Battery.';
  }
  return 'Jeśli samopoczucie jest dobre, można zrobić lekki trening albo technikę. Mocniejsze rzeczy dopiero wtedy, gdy sen, gotowość i bateria pokażą, że organizm naprawdę odbił.';
}
function buildGoodPoints(record){
  const points = [];
  const swim = segmentByType(record, 'swim');
  const bike = segmentByType(record, 'bike');
  const run = segmentByType(record, 'run');
  const bikeIf = numberOrNull(record.bike_if_value ?? record.intensity_factor);
  if(swim) points.push('Pływanie dało wejście w wysiłek i dobrze pokazało, jak szybko organizm potrafi wejść na obroty.');
  if(bike) points.push(bikeIf != null && bikeIf >= 0.9 ? 'Rower był mocno dociśnięty — to dobry sygnał mocy, ale też element, który najmocniej podnosi koszt całego startu.' : 'Rower został wykonany jako kontrolowana praca, czyli dokładnie ten element, który trzeba budować pod dłuższy dystans.');
  if(run) points.push('Bieg po wcześniejszej pracy jest wartościowy, bo pokazuje, co zostaje w nogach, gdy organizm jest już zmęczony.');
  if(!points.length) points.push('Największy plus: aktywność została zapisana na tyle dobrze, że można oceniać nie tylko wynik, ale też koszt dla organizmu.');
  return points.slice(0, 4);
}

function buildRiskPoints(record){
  const points = [];
  const load = numberOrNull(record.training_load);
  const bikeIf = numberOrNull(record.bike_if_value ?? record.intensity_factor);
  const runHr = runHrText(record);
  const after = metricForDate(parseJsonArray(record.daily_metrics_window), addDaysIso(record.workout_date, 1));
  if(load != null && load >= 250) points.push('To był duży koszt dla organizmu. Po takiej jednostce nie dokładamy kolejnego mocnego bodźca tylko dlatego, że „jest w planie”.');
  else if(load != null && load >= 100) points.push('To był solidny bodziec — nie dramat, ale coś, co trzeba doliczyć do zmęczenia z tygodnia.');
  if(bikeIf != null && bikeIf >= 0.9) points.push('Rower był mocny. Przy triathlonie to ważne, bo zbyt agresywny rower może później zabrać jakość biegu.');
  if(runHr) points.push('Bieg był wysoko tętniowo, więc nie traktuję go jak lekkiego dobiegnięcia do mety bez kosztu.');
  if(after?.training_readiness_score != null && Number(after.training_readiness_score) <= 20) points.push('Dane z kolejnej doby pokazują, że organizm mocno zapłacił za ten wysiłek — tu priorytetem jest regeneracja.');
  if(!points.length) points.push('Nie widzę dużej czerwonej flagi, ale decyzję o kolejnym treningu trzeba oprzeć na śnie, gotowości i samopoczuciu następnego dnia.');
  return points.slice(0, 4);
}

function buildHeadline(record){
  const after = recoveryDay(record);
  const load = record.training_load != null ? fmtNumber(record.training_load) : 'brak danych';
  const hr = record.hr_avg != null || record.hr_max != null ? `${record.hr_avg != null ? Math.round(Number(record.hr_avg)) : 'brak danych'}/${record.hr_max != null ? Math.round(Number(record.hr_max)) : 'brak danych'}` : 'brak danych';
  const date = fmtDate(record.workout_date) || fmtDateIso(record.workout_date) || 'brak danych';
  if(after){
    const score = after.training_readiness_score != null ? `${Math.round(Number(after.training_readiness_score))}/100${after.training_readiness_level ? ` — ${readinessHumanLevel(after.training_readiness_level)}` : ''}` : 'brak danych';
    return `To był konkretny bodziec dla organizmu: load ${load}, tętno ${hr}. Trening z ${date} można już zestawić z danymi z kolejnej nocy — gotowość dzień później: ${score}.`;
  }
  return `To był konkretny bodziec dla organizmu: load ${load}, tętno ${hr}. Wiem już, jaki wysiłek dostał organizm podczas treningu z ${date}, ale pełny koszt regeneracji będzie jasny dopiero po danych z kolejnej nocy.`;
}
function buildFactBasedActivityAnalysis(activityContext){
  if(!activityContext?.activity){
    return {
      hasFullContext: false,
      facts: [['Aktywność', 'brak danych']],
      mode: 'Analiza ostrożna — mam mniej danych, więc nie udaję pełnej pewności',
      headline: 'Brak aktywności Garmin PRO do analizy.',
      good: ['brak danych'],
      risks: ['brak danych'],
      segmentCards: [],
      contextBefore: [],
      activityDay: [],
      recoveryContext: [],
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
      mode: 'Analiza ostrożna — mam mniej danych, więc nie udaję pełnej pewności',
      headline: `${basic.rating} ${basic.caution}`,
      good: [basic.good],
      risks: [basic.caution],
      segmentCards: [],
      contextBefore: [],
      activityDay: [],
      recoveryContext: [],
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
    mode: 'Patrzę jak trener: najpierw bodziec, potem stan organizmu i odpowiedź po kolejnej nocy',
    headline: buildHeadline(record),
    good: buildGoodPoints(record),
    risks: buildRiskPoints(record),
    segmentCards: buildSegmentCards(record),
    contextBefore: contextBeforeText(record),
    activityDay: activityDayText(record),
    recoveryContext: recoveryAfterText(record),
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

function buildActivityAiAnalysis(activity){
  return buildFactBasedActivityAnalysis(buildActivityContext(activity));
}

function renderFactsBlock(rows){
  return `<details class="facts-block analysis-details"><summary>Techniczne dane Garmin PRO</summary><ul>${rows.map(([label, value]) => `<li><b>${escapeHtml(label)}</b><em>${escapeHtml(value || 'brak danych')}</em></li>`).join('')}</ul></details>`;
}

function renderAnalysisBlock(title, text, className = ''){
  return `<section class="analysis-section ${className}"><span>${escapeHtml(title)}</span><p>${escapeHtml(text || 'brak danych')}</p></section>`;
}

function renderBulletSection(title, items, className = ''){
  const list = (items && items.length ? items : ['brak danych']).map(item => `<li>${escapeHtml(item)}</li>`).join('');
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
  return `<details class="analysis-details raw-summary"><summary>Surowy opis Garmin — do kontroli</summary><p>${escapeHtml(text)}</p></details>`;
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
    renderAnalysisBlock('Jak patrzę na ten trening', analysis.mode, 'mode-section'),
    renderThresholdProfileContext(analysis.profileContextStatus),
    renderAnalysisBlock('Najważniejszy wniosek', analysis.headline, 'headline-section'),
    renderAnalysisBlock('Jakich progów używam w tle', analysis.thresholdProfile, 'threshold-section'),
    renderBulletSection('Co poszło dobrze', analysis.good, 'good-section'),
    renderBulletSection('Koszt / ryzyka', analysis.risks, 'risk-section'),
    renderSegmentCards(analysis.segmentCards),
    renderTimeline('Jak wyglądał organizm przed treningiem', analysis.contextBefore),
    renderTimeline('Dzień treningu', analysis.activityDay),
    renderTimeline('Odpowiedź organizmu po treningu', analysis.recoveryContext),
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
  const analysis = buildActivityAiAnalysis(activity);

  const topCards = [
    renderPowerIntervals(analysis.powerIntervals, analysis.powerInsight),
    renderRunIntervals(analysis.runIntervals, analysis.runInsight)
  ].filter(Boolean);

  const visibleSummary = topCards.length
    ? topCards.join('')
    : renderAnalysisBlock('Najważniejszy wniosek', analysis.headline, 'headline-section');

  target.innerHTML = [
    visibleSummary,
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
  $('detailActivityName').textContent = activityName(activity);
  $('detailActivityMeta').textContent = `${fmtDate(activity.workout_date)} · ${sportLabel(activity.sport_type || activity.activity_type)}`;
  $('detailDistance').textContent = fmtKm(activity.distance_km);
  $('detailDuration').textContent = fmtMin(activity.duration_min);
  $('detailHr').textContent = activity.hr_avg || activity.hr_max ? `${activity.hr_avg ? Math.round(Number(activity.hr_avg)) : 'brak'} / ${activity.hr_max ? Math.round(Number(activity.hr_max)) : 'brak'}` : 'brak danych';
  $('detailLoad').textContent = activity.training_load != null ? fmtNumber(activity.training_load) : 'brak danych';
  const segmentNarrative = humanSegmentNarrative(activity);
  const effortNarrative = humanCluesNarrative(activity);
  const summaryParts = [
    `<p><b>Opis trenerski:</b> ${escapeHtml(humanActivitySummary(activity))}</p>`,
    segmentNarrative ? `<p><b>Co mówią części aktywności:</b> ${escapeHtml(segmentNarrative)}</p>` : '',
    effortNarrative ? `<p><b>Intensywność:</b> ${escapeHtml(effortNarrative)}</p>` : ''
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
    navigator.serviceWorker.register('service-worker.js?v=531-threshold-action-error-hotfix').catch(() => {});
  }
  if(loadSession() && await refreshSession()){
    showApp();
    await loadAllData();
  }else{
    showLogin();
  }
}

init();
