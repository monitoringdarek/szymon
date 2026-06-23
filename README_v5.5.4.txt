Szymon AI Coach — v5.5.4 — humanizacja typów aktywności Garmin

Mały hotfix prezentacji. Zero zmian w SQL/Supabase/VM/Garmin Sync/
Edge Function/modelu Kalmar 226 km/Adaptive Athlete Profile poza
opisanym niżej (proWorkoutVerdict dostał nową, dodatkową gałąź —
reszta jego logiki nietknięta).

## 1. Tłumaczenie typów aktywności (sportLabel)

Rozbudowane o: strength_training/Strength -> Trening siłowy,
lap_swimming/pool_swimming -> Pływanie, treadmill_running -> Bieżnia
(sprawdzane PRZED ogólnym "running", żeby nie wpadło w Bieg),
indoor_cycling -> Rower indoor (sprawdzane przed ogólnym "cycling"),
walking -> Spacer, cardio -> Cardio, multisport/triathlon -> Multisport.

proTrainingTypeLabel() uproszczone — teraz w pełni deleguje do
sportLabel() (poza wyjątkiem is_multisport->"Race"). Wcześniej miało
własne, węższe sprawdzenia kolidujące z nowymi, bardziej precyzyjnymi
etykietami (np. blokowało "Bieżnia", bo "treadmill_running" zawiera
"run" i własny check łapał to pierwszy).

## 2. Dystans 0,00 km — naprawione w 4 miejscach

Znaleziono i naprawiono (każde to inny render path, niezależny kod):
- activityHtml() — karta na liście "Treningi": dystans pokazywany
  tylko gdy >0, inaczej tile pokazuje nazwę dyscypliny,
- recentTrainingItems() — tytuł na ekranie Dzisiaj: ten sam błąd
  (sprawdzał != null, nie > 0), osobne wystąpienie, niezależnie
  znalezione i naprawione,
- renderProActivityAnalysisShell() — karta BODZIEC, fallback dla
  aktywności bez segmentów: pokazywał "0.00 km • 161 min", teraz
  "161 min" samodzielnie (dystans tylko gdy >0).

Karta KOSZT (Load/HR/IF/TE) nigdy nie pokazywała dystansu — bez zmian.

## 3. Surowa nazwa aktywności (np. "Strength")

Nowy helper looksLikeRawGarminType() — rozpoznaje, gdy Garmin-owy
event_name/activity_name to surowy techniczny token (lista znanych
słów: strength, cardio, walking, running, cycling, swimming, itd.,
z normalizacją podkreślnik/spacja), nie prawdziwa nazwa aktywności.
W takim przypadku UI pokazuje humanizowaną etykietę dyscypliny
zamiast surowego tekstu. Zastosowane w activityHtml() (tytuł karty)
i renderProActivityAnalysisShell() (nagłówek "Analiza treningu").

Uwaga: pierwsza wersja tej poprawki używała exact-match przeciw
sport_type/activity_type TEJ aktywności — zawiodła dla realnego
przykładu (event_name="Strength" vs sport_type="strength_training",
różne stringi). Wykryte i naprawione przed wydaniem testem na
dokładnym przykładzie z opisu.

## 4. "0 segmentów" — zabezpieczenie defensywne

Przeszukano cały kod źródłowy v5.5.3 — nie znaleziono literalnego
tekstu "0 segmentów" w żadnym miejscu (istniejące komunikaty już
mówią "Brak segmentów PRO", nie "0 segmentów"). Najbardziej
prawdopodobne źródło: surowe pole segment_summary z Garmina/Supabase
mogłoby teoretycznie zawierać taki tekst. Dodano defensywny regex
(/^0\s*segment/i) w dwóch miejscach, gdzie to surowe pole trafia do
UI — jeśli tekst zaczyna się od "0 segment...", traktowane jak
brak danych.

## 5. Werdykt trenera dla aktywności nieendurance

Nowa, wczesna gałąź w proWorkoutVerdict() (przed istniejącą logiką
endurance) dla strength/cardio/spacer — wykrywane niezależnie od
sportKeyForItem() (który celowo bucketuje je jako 'general' dla
Adaptive Profile, to NIE zmienione). Cytuje konkretne liczby (czas,
HR, load) i kończy: "To trening uzupełniający, nie główny bodziec pod
Kalmar — nie liczymy go jak biegu czy roweru."

Przykład zweryfikowany (dokładnie dane z opisu: 161 min, HR 80/131,
load 4):
"Trening siłowy. czas 161 min, HR 80/131, obciążenie 4. To trening
uzupełniający, nie główny bodziec pod Kalmar — nie liczymy go jak
biegu czy roweru."

## Znaleziony i naprawiony efekt domina: plakietka nagłówka

"Trening siłowy" jest dłuższe niż dotychczasowe etykiety (Bieg/Rower/
Pływanie) — odkryto, że mała plakietka w nagłówku "Analiza treningu"
(position:absolute, fixed top/right) nachodziła na podtytuł przy
dłuższym tekście. Naprawione dodaniem skróconej etykiety TYLKO dla tej
jednej plakietki (Trening siłowy -> Siła, Rower indoor -> Rower) —
pełna nazwa zostaje wszędzie indziej (werdykt, karta BODZIEC, lista).
Zmierzone przed/po: nakładanie usunięte (horizontalOverlap: false).

## Zweryfikowane jako NIETKNIĘTE (diff, bit-identyczne)

buildAthleteBaseline, classifyAgainstBaseline,
kalmarOvernightResponseForSimilar, athleteBaselineNote,
buildKalmarForecast, buildPlanGuide, kalmarRegenerationTrend,
kalmarLoadTrend, kalmarRecoveryTrend, buildKalmarCoachTip,
kalmarRecentSessionsComparison, kalmarComparisonPhrase,
activityImpact, proCostTitle — wszystkie 14 funkcji identyczne
z v5.5.3. sportKeyForItem()/sportKey() (klasyfikacja dla Adaptive
Profile) — również nietknięte, strength_training nadal poprawnie
trafia do 'general' i jest wykluczone z baseline.

SQL, Supabase zapisy, VM/Proxmox, Garmin Sync Agent, import Garmin,
service_role, Edge Function — nie dotknięte.

## Zweryfikowane end-to-end

- wszystkie 13 mapowań sportLabel() z opisu — poprawne,
- dokładny przykład (Strength/strength_training, 22 cze 2026, 161 min,
  HR 80/131, load 4) przetestowany przez activityHtml(),
  proWorkoutVerdict() i renderProActivityAnalysisShell() — wszystkie
  3 ścieżki dają poprawny, ludzki wynik,
- regex zero-segment przetestowany na 4 przypadkach (pozytywne i
  negatywne) — działa precyzyjnie,
- stress-test poziomego scrolla na 360px, wszystkich 7 wskazanych
  ekranach (Dzisiaj/Treningi/Plan/Plan->Ostatni trening/Kalmar/Profil)
  z aktywnością siłową załadowaną — 0px przepełnienia wszędzie,
- 0 błędów JS na 5 zakładkach,
- Wyloguj: +25px (bez regresji),
- brak service_role / destrukcyjnego SQL.

## Wersja / cache

v=554 we wszystkich plikach + nowy CACHE_NAME.
