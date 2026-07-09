SZYMON AI COACH — v5.5.7-hotfix
===============================
Poprawiona paczka v5.5.7 (przed wdrożeniem). Zakres: wyłącznie
frontend (app.js, styles.css, index.html, service-worker.js) i testy.
BEZ zmian w: SQL, tabelach i widokach Supabase, VM, Garmin Sync Agent,
Edge Function, service_role.

Pełny opis funkcjonalny wersji 5.5.7 (trzy warstwy analizy, wspólny
helper, baner AI, czyszczenie języka) — patrz README_v5.5.7.txt.
Ten plik opisuje wyłącznie poprawki hotfixa.

POPRAWKI WZGLĘDEM v5.5.7
------------------------
1. DATA GUARD w assessOvernightResponse()
   - Liczony jest zestaw niezależnych metryk porannych D+1
     (sen, gotowość, Body Battery, stres, RHR, HRV) — metrics.present
     i metrics.presentCount.
   - 1 metryka  -> zawsze status 'incomplete' (partial=true),
   - 2 metryki  -> maksymalnie 'neutral' (dotyczy też sygnałów
     negatywnych: ostrzeżenie o koszcie również wymaga pokrycia
     danymi — sygnały są wtedy nazwane, ale bez twardego werdyktu),
   - 'good' wymaga >=3 metryk, w tym co najmniej jednej z: gotowość,
     Body Battery, RHR, HRV (sam sen + stres nie wystarczą).
   - Karta ODPOWIEDŹ PO NOCY przy danych częściowych pokazuje badge
     "Odpowiedź częściowa" i tekst w stylu: "Dane po nocy są niepełne.
     Dostępny sen (8 godz. 20 min) wygląda dobrze, ale bez gotowości,
     Body Battery, RHR i HRV nie oceniamy pełnej reakcji organizmu."
   - Przy 2 metrykach (status neutral) karta jawnie dopisuje, których
     kluczowych metryk brakuje; końcówka werdyktu rozróżnia "brak
     danych z nocy" od "dane niepełne — czekamy na komplet".

2. BASELINE ZAKOTWICZONY W DACIE TRENINGU
   - recoveryMetricBaseline(field, beforeDate, ...) wymaga kotwicy:
     do bazy wchodzą wyłącznie dni WCZEŚNIEJSZE niż workout_date
     (okno ~45 dni wstecz), bez dnia treningu i bez dat późniejszych.
   - Zaktualizowane oba miejsca użycia: assessOvernightResponse()
     (RHR i HRV) oraz proBeforeText() (RHR).
   - Efekt: STAN PRZED i REAKCJA PO NOCY historycznego treningu nie
     zmieniają się z upływem czasu.

3. overnightTail WE WSZYSTKICH GAŁĘZIACH WERDYKTU
   - Dodany w gałęziach pominiętych w v5.5.7: load >= 120 (mocniejszy
     trening), trening siłowy/cardio/spacer (nonEndurance), trend
     tygodniowy (obciążenie vs regeneracja) oraz multisport
     (rower zjadł bieg).
   - Każde zakończenie proWorkoutVerdict() przechodzi teraz przez
     wspólny wynik assessOvernightResponse().

4. TESTY Z ASSERT (test-v557.js)
   - Test kończy się kodem błędu, gdy status lub kluczowe zdanie nie
     pasuje. Scenariusze:
     A. pełne dane, dobra reakcja           -> good
     B. pełne dane, wysoki koszt            -> costly
     C. tylko sen                           -> incomplete + tekst o brakach
     D. brak D+1                            -> komunikat o kolejnej nocy
     E. historyczny trening                 -> baza bez dat po workout_date
                                               i bez dnia treningu
     F. load>=120 oraz trening siłowy       -> werdykt zmienia się po D+1
     G. brak HRV, komplet reszty            -> ocena + zastrzeżenie o HRV
     H. (dodatkowy) dwie metryki            -> maks. neutral
     I. (dodatkowy) dane śmieciowe          -> brak wyjątków
     + regresja: zatruty globalny `readiness` nie przecieka do analizy
       historycznej.
   - Uruchamianie: node test-v557.js
   - Wynik: 10/10 PASS; node --check app.js i service-worker.js czyste.

5. DROBNE
   - joinPolishList(): listy braków łączone spójnikiem "i"
     ("gotowości, Body Battery, RHR i HRV").
   - Neutral w końcówce werdyktu cytuje także mocne sygnały
     ograniczone przez Data Guard.
   - Wersja/cache: 'szymon-ai-coach-v5.5.7-hotfix', assets ?v=5571.
