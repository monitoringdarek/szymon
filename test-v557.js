/* test-v557.js — testy logiki analizy aktywności v5.5.7-hotfix.
   Uruchamianie: node test-v557.js
   Test kończy się kodem błędu (assert), jeśli status lub kluczowe
   zdanie nie pasuje do oczekiwań.

   Scenariusze:
   A. pełne dane, dobra reakcja               -> good
   B. pełne dane, wysoki koszt                -> costly
   C. tylko sen po nocy (Data Guard)          -> incomplete + tekst o niepełnych danych
   D. brak jakichkolwiek danych D+1           -> komunikat o oczekiwaniu na kolejną noc
   E. historyczny trening                     -> baseline bez dat późniejszych niż workout_date
   F. mocny trening load >= 120               -> werdykt zmienia się po pojawieniu się D+1
   G. brak HRV, komplet pozostałych danych    -> ocena możliwa + informacja o ograniczonej pewności
   H. (dodatkowy) dwie metryki                -> maksymalnie neutral, nigdy good/costly
   I. (dodatkowy) dane śmieciowe              -> brak wyjątków */

const assert = require('assert');
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/app.js', 'utf8');

function extract(name){
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `Nie znaleziono funkcji ${name} w app.js`);
  let depth = 0;
  for(let j = src.indexOf('{', start); j < src.length; j++){
    if(src[j] === '{') depth++;
    if(src[j] === '}'){ depth--; if(depth === 0) return src.slice(start, j + 1); }
  }
  throw new Error(`Nie sparsowano ${name}`);
}

const FNS = [
  'fmtDateIso', 'addDaysIso', 'fmtDate', 'fmtNumber', 'fmtMin', 'fmtMinAsHours',
  'kalmarNum', 'parseJsonArray', 'metricForDate', 'readinessHistoryForDate',
  'recoveryMetricBaseline', 'proContextForActivity', 'proDailyForOffset',
  'assessOvernightResponse', 'verdictOvernightTail', 'proBeforeText',
  'proBeforeControlLine', 'proRecoveryStatus', 'joinVerdictParts',
  'joinPolishList', 'proWorkoutVerdict'
].map(extract).join('\n\n');

/* Stuby zależności proWorkoutVerdict spoza testowanego zakresu —
   deklaracje PO kodzie z app.js nadpisują oryginały (hoisting). */
const STUBS = `
function sportKeyForItem(){ return 'run'; }
function proTrainingTypeLabel(){ return 'Bieg'; }
function nonEnduranceSportLabel(pro){
  const t = String(pro && (pro.sport_type || pro.activity_type) || '').toLowerCase();
  return t.includes('strength') ? 'Trening siłowy' : null;
}
function buildAthleteBaseline(){ return { hasEnough: false, count: 0 }; }
function classifyAgainstBaseline(){ return { tier: 'unknown' }; }
function kalmarOvernightResponseForSimilar(){ return { hasEnough: false }; }
function kalmarRegenerationTrend(){ return null; }
function kalmarRecentSessionsComparison(){ return { hasEnough: false }; }
`;

function run(env, expr){
  const code = `${env}\n${FNS}\n${STUBS}\n;(${expr});`;
  return eval(code);
}
function envOf({ contexts = [], history = [], globalReadiness = null } = {}){
  return `let activityContexts = ${JSON.stringify(contexts)};
let readinessHistory = ${JSON.stringify(history)};
let readiness = ${JSON.stringify(globalReadiness)};`;
}

const WORKOUT = { garmin_activity_id: 'g1', workout_date: '2026-07-08', started_at: '2026-07-08T17:30:00Z' };
function baseHistory(){
  const rows = [];
  for(let d = 1; d <= 7; d++){
    rows.push({ metric_date: `2026-07-0${d}`, resting_hr: 40, hrv_avg: 62, training_readiness_score: 60, sleep_minutes: 430, avg_stress: 24 });
  }
  return rows;
}
const BEFORE = { metric_date: '2026-07-08', sleep_minutes: 464, body_battery_end: 38, avg_stress: 20, training_readiness_score: 64, resting_hr: 40 };
const AFTER_GOOD = { metric_date: '2026-07-09', sleep_minutes: 488, body_battery_start: 37, body_battery_end: 64, avg_stress: 19, training_readiness_score: 65, resting_hr: 39 };
const AFTER_COSTLY = { metric_date: '2026-07-09', sleep_minutes: 340, body_battery_end: 35, avg_stress: 48, training_readiness_score: 30, resting_hr: 46 };

let passed = 0;
function ok(label){ passed++; console.log(`PASS  ${label}`); }

/* ---------- A. pełne dane, dobra reakcja -> good ---------- */
{
  const env = envOf({ history: [...baseHistory(), BEFORE, AFTER_GOOD] });
  const a = run(env, `assessOvernightResponse(${JSON.stringify(WORKOUT)})`);
  assert.strictEqual(a.status, 'good', `A: oczekiwano good, jest ${a.status}`);
  const night = run(env, `proRecoveryStatus(${JSON.stringify(WORKOUT)})`);
  assert.strictEqual(night.status, 'Odpowiedź gotowa');
  assert.ok(night.title.includes('dobrze zareagował'), `A: tytuł: ${night.title}`);
  assert.ok(night.text.includes('65/100') && night.text.includes('64/100'), 'A: brak porównania gotowości przed/po');
  assert.ok(night.text.includes('z 37 do 64'), 'A: brak doładowania Body Battery');
  const tail = run(env, `verdictOvernightTail(${JSON.stringify(WORKOUT)})`);
  assert.ok(tail.includes('nie pokazał wyraźnego wzrostu kosztu'), `A: tail: ${tail}`);
  ok('A: pełne dane + dobra reakcja -> good');
}

/* ---------- B. pełne dane, wysoki koszt -> costly ---------- */
{
  const env = envOf({ history: [...baseHistory(), BEFORE, AFTER_COSTLY] });
  const a = run(env, `assessOvernightResponse(${JSON.stringify(WORKOUT)})`);
  assert.strictEqual(a.status, 'costly', `B: oczekiwano costly, jest ${a.status}`);
  assert.ok(a.signals.strong.length >= 1, 'B: brak mocnych sygnałów');
  const night = run(env, `proRecoveryStatus(${JSON.stringify(WORKOUT)})`);
  assert.ok(night.title.includes('wyraźny koszt'), `B: tytuł: ${night.title}`);
  assert.ok(night.text.includes('46 bpm'), 'B: brak RHR w tekście');
  const tail = run(env, `verdictOvernightTail(${JSON.stringify(WORKOUT)})`);
  assert.ok(tail.includes('realny koszt'), `B: tail: ${tail}`);
  ok('B: pełne dane + wysoki koszt -> costly');
}

/* ---------- C. tylko sen -> incomplete (Data Guard) ---------- */
{
  const onlySleep = { metric_date: '2026-07-09', sleep_minutes: 500 };
  const env = envOf({ history: [...baseHistory(), BEFORE, onlySleep] });
  const a = run(env, `assessOvernightResponse(${JSON.stringify(WORKOUT)})`);
  assert.strictEqual(a.status, 'incomplete', `C: oczekiwano incomplete, jest ${a.status}`);
  assert.strictEqual(a.partial, true, 'C: oczekiwano partial=true');
  const night = run(env, `proRecoveryStatus(${JSON.stringify(WORKOUT)})`);
  assert.strictEqual(night.status, 'Odpowiedź częściowa', `C: badge: ${night.status}`);
  assert.ok(night.title.includes('niepełne'), `C: tytuł: ${night.title}`);
  assert.ok(night.text.includes('Dostępny sen') && night.text.includes('wygląda dobrze'), `C: tekst: ${night.text}`);
  assert.ok(night.text.includes('gotowości') && night.text.includes('Body Battery')
    && night.text.includes('RHR') && night.text.includes('HRV'), 'C: brak listy brakujących metryk');
  assert.ok(!night.title.includes('dobrze zareagował') && !night.text.includes('dobrze zareagował'),
    'C: fałszywy wniosek good przy jednej metryce');
  ok('C: tylko sen -> incomplete + tekst o niepełnych danych');
}

/* ---------- D. brak D+1 -> oczekiwanie na kolejną noc ---------- */
{
  const env = envOf({ history: [...baseHistory(), BEFORE] });
  const a = run(env, `assessOvernightResponse(${JSON.stringify(WORKOUT)})`);
  assert.strictEqual(a.status, 'incomplete');
  assert.strictEqual(a.partial, false, 'D: partial powinno być false przy zerze danych');
  const night = run(env, `proRecoveryStatus(${JSON.stringify(WORKOUT)})`);
  assert.strictEqual(night.status, 'Rano');
  assert.ok(night.title.includes('po danych z kolejnego poranka'), `D: tytuł: ${night.title}`);
  const tail = run(env, `verdictOvernightTail(${JSON.stringify(WORKOUT)})`);
  assert.strictEqual(tail, 'Ocena wykonania jest gotowa. Reakcję organizmu uzupełnimy po kolejnej nocy.');
  ok('D: brak D+1 -> komunikat o oczekiwaniu na kolejną noc');
}

/* ---------- E. baseline bez dat późniejszych niż workout_date ---------- */
{
  // Przed treningiem RHR stabilnie 40; PO treningu seria 60 —
  // jeśli baza uwzględni późniejsze dni, mediana ucieknie w górę.
  const history = baseHistory(); // 1–7 lipca, RHR 40
  for(let d = 10; d <= 20; d++){
    history.push({ metric_date: `2026-07-${d}`, resting_hr: 60, hrv_avg: 30 });
  }
  const env = envOf({ history: [...history, BEFORE, AFTER_GOOD] });
  const base = run(env, `recoveryMetricBaseline('resting_hr', '2026-07-08')`);
  assert.ok(base, 'E: baza nie została policzona');
  assert.strictEqual(Math.round(base.median), 40, `E: mediana ${base.median} — baza zawiera dane późniejsze niż trening`);
  // dzień treningu też nie wchodzi do bazy:
  const env2 = envOf({ history: [...baseHistory(), { metric_date: '2026-07-08', resting_hr: 99 }] });
  const base2 = run(env2, `recoveryMetricBaseline('resting_hr', '2026-07-08')`);
  assert.strictEqual(Math.round(base2.median), 40, 'E: dzień treningu nie może wchodzić do bazy');
  // ocena reakcji używa zakotwiczonej bazy (RHR 39 vs 40 -> w normie):
  const a = run(env, `assessOvernightResponse(${JSON.stringify(WORKOUT)})`);
  assert.strictEqual(a.metrics.rhrBaseline, 40, `E: rhrBaseline=${a.metrics.rhrBaseline}`);
  assert.strictEqual(a.status, 'good', 'E: zakotwiczona baza powinna dać good');
  ok('E: baseline zakotwiczony w dacie treningu, bez danych późniejszych');
}

/* ---------- F. load >= 120 -> werdykt zmienia się po D+1 ---------- */
{
  const strongRun = { ...WORKOUT, training_load: 150, sport_type: 'running' };
  const envNoAfter = envOf({ history: [...baseHistory(), BEFORE] });
  const envWithAfter = envOf({ history: [...baseHistory(), BEFORE, AFTER_GOOD] });
  const vBefore = run(envNoAfter, `proWorkoutVerdict(${JSON.stringify(strongRun)}, null, [])`);
  const vAfter = run(envWithAfter, `proWorkoutVerdict(${JSON.stringify(strongRun)}, null, [])`);
  assert.ok(vBefore.includes('Reakcję organizmu uzupełnimy po kolejnej nocy'), `F: przed nocą: ${vBefore}`);
  assert.ok(vAfter.includes('Kolejny poranek'), `F: po nocy: ${vAfter}`);
  assert.ok(!vAfter.includes('uzupełnimy po kolejnej nocy'), 'F: werdykt nie zaktualizował się po D+1');
  assert.notStrictEqual(vBefore, vAfter, 'F: werdykt identyczny mimo danych D+1');
  // trening siłowy również reaguje na D+1:
  const strength = { ...WORKOUT, training_load: 60, sport_type: 'strength_training', duration_seconds: 2400 };
  const sAfter = run(envWithAfter, `proWorkoutVerdict(${JSON.stringify(strength)}, null, [])`);
  assert.ok(sAfter.includes('Kolejny poranek'), `F: siłowy po nocy: ${sAfter}`);
  ok('F: werdykt (load>=120 i siłowy) aktualizuje się po pojawieniu się D+1');
}

/* ---------- G. brak HRV, komplet pozostałych -> ocena + zastrzeżenie ---------- */
{
  const env = envOf({ history: [...baseHistory().map(r => ({ ...r, hrv_avg: null })), BEFORE, AFTER_GOOD] });
  const a = run(env, `assessOvernightResponse(${JSON.stringify(WORKOUT)})`);
  assert.notStrictEqual(a.status, 'incomplete', 'G: komplet danych poza HRV musi pozwolić na ocenę');
  assert.strictEqual(a.status, 'good', `G: oczekiwano good, jest ${a.status}`);
  const night = run(env, `proRecoveryStatus(${JSON.stringify(WORKOUT)})`);
  assert.ok(night.text.includes('Brak HRV ogranicza pewność oceny'), `G: brak zastrzeżenia o HRV: ${night.text}`);
  ok('G: brak HRV -> ocena możliwa z informacją o ograniczonej pewności');
}

/* ---------- H. dwie metryki -> maksymalnie neutral ---------- */
{
  const twoCalm = { metric_date: '2026-07-09', sleep_minutes: 490, training_readiness_score: 70 };
  const twoBad = { metric_date: '2026-07-09', sleep_minutes: 300, training_readiness_score: 25 };
  for(const [label, after, forbidden] of [['spokojne', twoCalm, 'good'], ['złe', twoBad, 'costly']]){
    const env = envOf({ history: [...baseHistory(), BEFORE, after] });
    const a = run(env, `assessOvernightResponse(${JSON.stringify(WORKOUT)})`);
    assert.strictEqual(a.status, 'neutral', `H (${label}): oczekiwano neutral, jest ${a.status}`);
    assert.notStrictEqual(a.status, forbidden, `H (${label}): status ${forbidden} przy dwóch metrykach`);
  }
  ok('H: dwie metryki -> maksymalnie neutral (Data Guard)');
}

/* ---------- I. dane śmieciowe -> brak wyjątków ---------- */
{
  const env = envOf({ contexts: null, history: null });
  const r = run(env, `[
    verdictOvernightTail(null),
    proBeforeText(null),
    proRecoveryStatus({}).status,
    String(recoveryMetricBaseline('resting_hr', null)),
    proWorkoutVerdict({ workout_date: 'zła-data' }, null, [])
  ].join(' | ')`);
  assert.ok(typeof r === 'string' && r.length > 0);
  ok('I: dane śmieciowe nie powodują wyjątków');
}

/* ---------- Regresja: globalny readiness nie przecieka ---------- */
{
  const env = envOf({
    history: [...baseHistory(), BEFORE, AFTER_GOOD],
    globalReadiness: { metric_date: '2026-07-09', training_readiness_score: 5, sleep_minutes: 1, avg_stress: 99, resting_hr: 99 }
  });
  const before = run(env, `proBeforeText(${JSON.stringify(WORKOUT)})`);
  assert.ok(before.includes('64/100'), 'Regresja: STAN PRZED nie używa danych z workout_date');
  assert.ok(!before.includes('5/100'), 'Regresja: globalny readiness przeciekł do STAN PRZED');
  ok('Regresja: zatruty globalny readiness nie wpływa na analizę historyczną');
}

console.log(`\nWSZYSTKIE TESTY ZALICZONE (${passed}/${passed})`);
