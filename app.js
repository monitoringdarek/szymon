const demo = {
  name: 'Mogilany Bieganie',
  type: 'Bieganie',
  distanceKm: 15.08,
  time: '1:09:11',
  pace: '4:35',
  elevation: 225,
  calories: 1089,
  avgHr: null,
  load: 'wysokie'
};

function analyze(a){
  const distanceScore = Math.min(35, a.distanceKm * 2.1);
  const hillScore = Math.min(25, a.elevation / 10);
  const paceScore = a.pace <= '4:40' ? 25 : 15;
  const load = Math.round(distanceScore + hillScore + paceScore);
  const readiness = Math.max(42, 100 - Math.round(load * .55));
  document.getElementById('readiness').textContent = readiness;
  let decision = '🟡 Jutro: lekki trening albo regeneracja aktywna';
  let plan = ['20–30 min bardzo lekko albo spacer', '10 min mobilizacji biodra/łydki', 'Sen minimum 8 h', 'Bez interwałów po mocnym biegu'];
  if(readiness > 80){ decision='🟢 Jutro: można trenować normalnie'; plan=['10 min rozgrzewki','6–8 km spokojnie','4 przebieżki po 80 m','Schłodzenie i rozciąganie']; }
  if(readiness < 55){ decision='🔴 Jutro: odpoczynek'; plan=['Bez biegania','Spacer 20–40 min','Nawodnienie i jedzenie','Sen i regeneracja']; }
  document.getElementById('decision').textContent = decision;
  document.getElementById('aiSummary').innerHTML = `
    <p><b>${a.name}</b> wygląda na mocny trening biegowy: <b>${a.distanceKm} km</b> w tempie <b>${a.pace}/km</b> oraz <b>${a.elevation} m</b> przewyższenia.</p>
    <p>Szacowane obciążenie: <b>${a.load}</b>. Po takim treningu AI nie pchałoby od razu kolejnych interwałów, tylko sprawdziłoby sen, HRV i zmęczenie nóg.</p>
  `;
  const ul = document.getElementById('planList');
  ul.innerHTML = plan.map(x=>`<li>${x}</li>`).join('');
}

function render(a){
  document.getElementById('activityName').textContent = a.name;
  document.getElementById('activityMeta').textContent = `${a.type} • publiczny link Garmin • Fenix 7X`;
  document.getElementById('distance').textContent = a.distanceKm.toFixed(2);
  document.getElementById('time').textContent = a.time;
  document.getElementById('pace').textContent = a.pace;
  document.getElementById('elev').textContent = a.elevation;
  document.getElementById('cal').textContent = a.calories;
  analyze(a);
}

document.getElementById('loadBtn').addEventListener('click', () => {
  const link = document.getElementById('garminLink').value.trim();
  const id = (link.match(/activity\/(\d+)/)||[])[1];
  if(!id){ alert('Wklej poprawny link Garmin Connect z numerem aktywności.'); return; }
  render(demo);
});
render(demo);
