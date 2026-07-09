/* test-v558.js — testy historii prognozy Kalmar v5.5.8.
   Uruchamianie: node test-v558.js */

const assert = require('assert');
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/app.js', 'utf8');
const VERSION = 'szymon-ai-coach-v5.5.8-kalmar-forecast-history';
let readiness = null;
let readinessHistory = [];
let cards = [];
let load28d = [];
let proActivities = [];
let athleteThresholds = [];

function extract(name){
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `Nie znaleziono funkcji ${name}`);
  let parens = 0;
  let bodyStart = -1;
  for(let i = src.indexOf('(', start); i < src.length; i++){
    if(src[i] === '(') parens++;
    if(src[i] === ')') parens--;
    if(parens === 0 && src[i] === '{'){
      bodyStart = i;
      break;
    }
  }
  assert.ok(bodyStart >= 0, `Nie znaleziono ciała funkcji ${name}`);
  let depth = 0;
  for(let j = bodyStart; j < src.length; j++){
    if(src[j] === '{') depth++;
    if(src[j] === '}'){
      depth--;
      if(depth === 0) return src.slice(start, j + 1);
    }
  }
  throw new Error(`Nie sparsowano funkcji ${name}`);
}

const stubs = `
function escapeHtml(value){ return String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c])); }
function fmtDateIso(value){ if(!value) return ''; const s = String(value).slice(0, 10); return /^\\d{4}-\\d{2}-\\d{2}$/.test(s) ? s : ''; }
function fmtDate(value){ return fmtDateIso(value) || 'brak danych'; }
function fmtNumber(value){ const n = Number(value); return Number.isFinite(n) ? String(Math.round(n)) : 'brak danych'; }
function fmtKmDot(value){ const n = Number(value); return Number.isFinite(n) ? n.toFixed(1) + ' km' : 'brak danych'; }
function parseJsonArray(value){ if(Array.isArray(value)) return value; if(!value) return []; try{ const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; }catch{ return []; } }
function segmentTypes(record){ return parseJsonArray(record && record.segments).map(s => String(s.segment_type || '').toLowerCase()); }
function hasSegment(record, type){ return segmentTypes(record).includes(type); }
function isProActivityRow(){ return false; }
function proSegmentsForActivity(record){ return parseJsonArray(record && record.segments); }
function activityDistanceKm(record){ const km = Number(record && record.distance_km); if(Number.isFinite(km)) return km; const m = Number(record && record.distance_meters); return Number.isFinite(m) ? m / 1000 : null; }
function thresholdFor(sport, type){ return athleteThresholds.find(item => String(item.sport).toLowerCase() === String(sport).toLowerCase() && String(item.threshold_type).toLowerCase() === String(type).toLowerCase()) || null; }
function thresholdValue(row){ const n = Number(row && row.value_working); return Number.isFinite(n) ? n : null; }
`;

const fnNames = [
  'kalmarNum', 'kalmarClamp', 'kalmarMedian', 'kalmarRoundSec', 'kalmarTimeHM', 'kalmarRangeText',
  'kalmarMinutesToHM', 'kalmarTodayIso', 'kalmarForecastSnapshotFromForecast', 'kalmarForecastPointWithSource',
  'prepareKalmarForecastHistoryPoints', 'mergeKalmarForecastHistoryPoints', 'kalmarForecastHistoryStartDate',
  'kalmarDataDate', 'kalmarRowsUntil', 'kalmarLatestReadinessUntil', 'kalmarHistoricalDataCoverage',
  'kalmarDaysBetween', 'kalmarFirstContextDate', 'kalmarActivityHasUsableRangeInput',
  'withKalmarDataContext', 'kalmarHistoricalContextUntil', 'kalmarHistoricalPointStatus', 'kalmarHasEnoughHistoricalData',
  'buildKalmarForecastAt', 'kalmarWeeklyCutoffDates', 'buildHistoricalKalmarForecastPoints',
  'kalmarForecastHistoryWeekCount', 'kalmarForecastHistoryAxis', 'kalmarForecastHistoryEmptyHtml',
  'kalmarForecastHistorySvg', 'kalmarIsSport', 'kalmarSegmentsFor', 'kalmarSegmentSum',
  'kalmarActivitySportMetrics', 'kalmarAllActivityRows', 'kalmarPaceFromActivities',
  'kalmarTransitionSeconds', 'kalmarThresholdWorking', 'kalmarReadinessPenalty',
  'kalmarAverage', 'kalmarDateDescValue', 'kalmarSortedByDateDesc', 'kalmarDailyRecoveryIndex',
  'kalmarLoadTrend', 'kalmarRecoveryTrend', 'kalmarRegenerationTrend', 'kalmarShortFact',
  'buildKalmarCoachTip', 'buildKalmarForecast'
];

eval(`const VERSION = '${VERSION}';\n${stubs}\n${fnNames.map(extract).join('\n\n')}`);
kalmarTodayIso = () => '2026-07-09';

function addDays(date, days){
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function activity(date, sport, km, secPerKm, load = 90){
  return {
    workout_date: date,
    sport_type: sport,
    event_name: sport,
    distance_meters: km * 1000,
    duration_seconds: Math.round(km * secPerKm),
    training_load: load
  };
}

function morning(date, score = 62){
  return { metric_date: date, sleep_minutes: 430, body_battery_end: 58, avg_stress: 22, training_readiness_score: score };
}

function seed({ start = '2026-01-01', weeks = 8, futureFast = false } = {}){
  proActivities = [];
  cards = [];
  readinessHistory = [];
  load28d = [];
  athleteThresholds = [];
  for(let i = 0; i < weeks; i++){
    const d = addDays(start, i * 7);
    proActivities.push(activity(d, 'bike', 40 + i * 2, futureFast && i === weeks - 1 ? 95 : 130, 80 + i));
    proActivities.push(activity(addDays(d, 1), 'run', 8 + i * 0.3, 320, 65 + i));
    readinessHistory.push(morning(d, 58 + (i % 8)));
    readinessHistory.push(morning(addDays(d, 1), 59 + (i % 8)));
    load28d.push({ workout_date: d, daily_training_load: 90 + i, daily_duration_min: 60, daily_distance_km: 30, activity_count: 1 });
  }
  readiness = readinessHistory[readinessHistory.length - 1] || null;
}

const emptySvg = kalmarForecastHistorySvg([]);
assert.ok(emptySvg.includes('Historia prognozy jest jeszcze budowana'), 'brak historii pokazuje stan pusty');

seed({ start:'2026-01-01', weeks:26 });
let januaryPoints = buildHistoricalKalmarForecastPoints();
assert.ok(januaryPoints.length >= 20, 'dane od 1 stycznia budują długi trend');
assert.ok(januaryPoints[0].date >= '2026-01-01', 'trend nie wychodzi przed 2026-01-01');

seed({ start:'2026-05-12', weeks:8 });
let eightWeekPoints = buildHistoricalKalmarForecastPoints();
assert.ok(eightWeekPoints.length >= 5 && eightWeekPoints.length <= 9, 'około 8 tygodni danych daje około 8 punktów');
assert.ok(kalmarForecastHistorySvg(eightWeekPoints).includes('kalmar-chart-line'), '8 tygodni rysuje linię');

seed({ start:'2026-06-03', weeks:6 });
const thirtySevenDayPoints = buildHistoricalKalmarForecastPoints();
assert.ok(thirtySevenDayPoints.length >= 3, '37 dni danych od 3 czerwca daje co najmniej 3 punkty');
assert.ok(thirtySevenDayPoints.some(point => point.date === '2026-07-09'), 'dzisiejszy cutoff jest w historii');

seed({ start:'2026-06-01', weeks:0 });
assert.equal(buildHistoricalKalmarForecastPoints().length, 0, 'brak wystarczających danych nie tworzy trendu');

seed({ start:'2026-05-01', weeks:8, futureFast:true });
const beforeFuture = buildKalmarForecastAt('2026-06-05');
const afterFuture = buildKalmarForecastAt('2026-06-26');
assert.ok(beforeFuture && afterFuture, 'punkty przed i po szybkim przyszłym treningu istnieją');
assert.ok(beforeFuture.middleMinutes >= afterFuture.middleMinutes, 'przyszły szybki trening nie poprawia wcześniejszego punktu');

const historical = [{ ...beforeFuture, date:'2026-06-05', middleMinutes:700, source:'historical' }];
const snapshots = [{ ...beforeFuture, date:'2026-06-05', middleMinutes:760, source:'snapshot' }, { ...afterFuture, date:'2026-06-26', source:'snapshot' }];
const merged = mergeKalmarForecastHistoryPoints(historical, snapshots);
assert.equal(merged.find(p => p.date === '2026-06-05').middleMinutes, 700, 'historyczny punkt wygrywa ze snapshotem tej samej daty');
assert.ok(merged.some(p => p.date === '2026-06-26'), 'snapshot zostaje jako uzupełnienie przyszłych punktów');

const dirty = prepareKalmarForecastHistoryPoints([{ date:'2026-07-01', lowerMinutes:NaN, middleMinutes:700, upperMinutes:730 }]);
assert.equal(dirty.length, 0, 'NaN/null są odrzucane');

const offlineAssets = fs.readFileSync(__dirname + '/service-worker.js', 'utf8');
assert.ok(offlineAssets.includes('v=558'), 'service worker ma assety v558');
assert.ok(offlineAssets.includes('szymon-ai-coach-v5.5.8-kalmar-forecast-history'), 'service worker ma cache v5.5.8');

console.log('PASS test-v558.js — historyczna prognoza Kalmar bez przyszłych danych');
