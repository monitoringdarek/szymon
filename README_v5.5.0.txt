Szymon AI Coach — v5.5.0 — Adaptive Athlete Profile

Realna nowa funkcjonalność (nie kosmetyka tekstu), zgodnie z ustaleniami
po rozmowie z Szymonem. Aplikacja ocenia trening względem osobistego
poziomu Szymona z ostatnich 4-8 tygodni, nie ogólnych norm.

## Co zrobiono

1. `readinessHistory`: limit 14 -> 60 dni. Jedyna zmiana zasięgu danych,
   żaden nowy endpoint, żaden SQL. Zweryfikowano, że kalmarLoadTrend()/
   kalmarRecoveryTrend() używają względnych indeksów (slice(0,7) itd.),
   więc większy zasięg danych nie zmienia ich działania — tylko daje
   nowej funkcji więcej historii do dopasowania nocy.

2. Nowe, czyste funkcje (zero wpływu na istniejący kod, dopóki nie są
   explicite wołane):
   - buildAthleteBaseline(sport, days=56) — mediana, P25/P75/P90 z load
     ostatnich 4-8 tyg. dla danej dyscypliny. Wymaga >=6 porównywalnych
     treningów, inaczej hasEnough:false.
   - classifyAgainstBaseline(load, baseline) — normalny / podwyższony /
     ponad tolerancję, względem P75/P90.
   - kalmarOvernightResponseForSimilar(...) — zabezpieczenie, nie główny
     mechanizm: jak organizm zwykle reagował następnego dnia po
     podobnych treningach (wymaga >=3 dopasowanych nocy).

3. Zmodyfikowane (z fallbackiem do starych, absolutnych progów, gdy
   danych jest za mało — Data Guard):
   - activityImpact() — klasyfikacja "mocny/solidny/lekki" relatywna do
     osobistego baseline'u, gdy dostępny.
   - proCostTitle() — tekst kosztu po treningu cytuje konkretne osobiste
     liczby (load vs typowy zakres P25-P75), nie ogólne progi.

4. Diagnostyka w Profilu: trzy nowe wiersze ("Osobisty punkt odniesienia
   — bieg/rower/pływanie") pokazujące wprost ile treningów jest w bazie
   i czy to wystarcza (np. "za mało danych do osobistego porównania
   (2/6 treningów)").

## Zweryfikowany przykład z rozmowy z Szymonem

Bieg load=146, HR 150/171, z osobistą historią 10 biegów (P25=123,
P75=163):

  "Koszt: normalny bodziec roboczy dla Twojego aktualnego poziomu
  (load 146, typowo 123–163). To nie jest alarm."

Potwierdzone też dla load=170 (elevated) i load=300 (over) — trzy
poziomy klasyfikacji działają poprawnie na tych samych danych.

## Zachowane bezpieczeństwo (nie tylko łagodniejszy ton)

Przetestowano: trening genuinely ponad osobistą tolerancją (load=320,
P90=176) + 3 czerwone flagi (sen, battery, load7d) wciąż poprawnie
wywołuje DZISIAJ: ODBUDOWA AKTYWNA. System nie stał się "ślepy" na
realne przeciążenie — stał się precyzyjny względem Szymona, nie ogólnej
normy.

## Data Guard przy niedostatku danych

Z 3 biegami w historii (poniżej wymaganych 6): buildAthleteBaseline
zwraca hasEnough:false, a proCostTitle()/activityImpact() poprawnie
spadają do starych, już tone-poprawionych progów absolutnych z v5.4.9
— zero fałszywej precyzji.

## Bez zmian (zweryfikowane diffem, bit-identyczne)

buildKalmarForecast, buildPlanGuide, kalmarRegenerationTrend,
kalmarLoadTrend, kalmarRecoveryTrend, buildKalmarCoachTip — wszystkie
identyczne z v5.4.7/v5.4.9. Model Kalmar 226 km, Plan i trend
regeneracji nie mają żadnego związku z Adaptive Athlete Profile.

SQL, Supabase zapisy, VM/Proxmox, Garmin Sync Agent, service_role —
nie dotknięte.

## Odłożone (jawnie, nie po cichu)

RPE / odczucie po treningu ("Lekko / Pod kontrolą / Mocno / Bardzo
ciężko") — wymaga zapisu danych, czyli nowej, małej tabeli SQL. To
wykracza poza zakres tej wersji i czeka na osobną, jawną decyzję.

## Zweryfikowane

- node --check app.js / service-worker.js: OK,
- manifest.json: OK,
- 0 błędów JS na 5 zakładkach z realistycznymi danymi baseline,
- Wyloguj: +24px (bez regresji),
- 6 funkcji Kalmar/Plan/regeneracja: bit-identyczne,
- brak service_role / destrukcyjnego SQL,
- przykład z rozmowy z Szymonem (load 146) zweryfikowany end-to-end.

## Wersja / cache

v=550 we wszystkich plikach + nowy CACHE_NAME.
