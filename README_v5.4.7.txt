Szymon AI Coach — v5.4.7

Mały hotfix po przeglądzie v5.4.6. Dwie poprawki, zero nowej architektury.

## 1. Naprawiony błąd: Plan nigdy nie pokazywał "wszystko OK"

Przyczyna: `buildPlanGuide()` sprawdzał `forecast.limiter.includes('rower')`
do wykrycia problemu z rowerem. Domyślna wartość `limiter` (gdy wszystko
jest w porządku) to string `'bieg po rowerze'` — który ZAWIERA podciąg
"rower" (bo "rower" jest częścią słowa "rowerze"). Efekt: Plan zawsze
trafiał w gałąź "Rower + spokojna zakładka", nigdy w pozytywny scenariusz
"Utrzymać rytm", nawet gdy dane były świetne (rower 140+ km, multisport
obecny, pływanie OK).

Naprawione przez dodanie `limiterKey` — dokładnego, niełamliwego
identyfikatora (`'ok' | 'bike' | 'run' | 'swim' | 'regen' | 'empty'`)
zwracanego przez `buildKalmarForecast()` obok istniejącego tekstu
`limiter`. `buildPlanGuide()` używa teraz `limiterKey` (exact match),
nie `.includes()` na tekście.

Karta Kalmar — pole "Największa rezerwa" — wyświetla dokładnie ten sam
tekst `limiter` co wcześniej, bez zmian.

Zweryfikowane (realny test wszystkich 6 gałęzi):
- brak danych -> limiterKey='empty'
- regeneracja zła -> limiterKey='regen'
- rower za krótki -> limiterKey='bike'
- brak multisport -> limiterKey='run'
- pływanie słabe -> limiterKey='swim'
- wszystko OK (rower 140+ km, multisport, pływanie OK) -> limiterKey='ok'
  -> Plan teraz poprawnie pokazuje "Utrzymać rytm pod Kalmar"

## 2. Naprawione obcinanie tekstu "Jutro"

Limit `kalmarPlanShortText()` (118 znaków) ucinał najdłuższy realny
tekst stanu odbudowy (165 znaków) w połowie myśli, gubiąc konkretną
rekomendację ("jeszcze jeden dzień odbudowy..."). Podniesiono limit do
175 znaków — mieści wszystkie trzy realne warianty tekstu "jutro" z
buildLocalTodayCoach() w całości, z bezpiecznym marginesem na przyszłość.

Nie zmieniono samego buildLocalTodayCoach() — to dzielona logika z
ekranem Dzisiaj, poza zakresem tej poprawki.

## Bez zmian

- architektura ekranu Plan (przełącznik trybów, slot planPanel),
- logika hierarchii limiterów,
- readinessHistory, model trendu regeneracji,
- 3-liniowe podpowiedzi Kalmara z v5.4.5,
- SQL, Supabase, VM, Garmin Sync, service_role.

## Zweryfikowane

- node --check app.js / service-worker.js: OK,
- manifest.json: OK,
- 0 błędów JS na 5 zakładkach + przełączniku trybów Plan,
- patch "Wyloguj" z v5.4.3 nadal aktywny (+28px),
- brak service_role / destrukcyjnego SQL,
- nazewnictwo 226 km bez zmian.

## Wersja / cache

v=547 we wszystkich plikach + nowy CACHE_NAME.
