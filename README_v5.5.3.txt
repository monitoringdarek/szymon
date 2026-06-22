Szymon AI Coach — v5.5.3 — hotfix

Dwa konkretne problemy, zero zmian w logice Kalmar/Plan/Adaptive
Athlete Profile poza opisanym niżej.

## Problem 1: testowy wpis o kontuzji łydki

Zweryfikowane grepem na całym kodzie źródłowym (app.js, index.html):
front NIE ma żadnego hardkodowanego tekstu o kontuzji, łydce ani
urazie. Zero wyników wyszukiwania.

Jedyny mechanizm, który mógłby to wyświetlać, to pole journal_pain /
journal_window w widoku garmin_pro_readiness_context — to samo źródło
danych co ekran Dzisiaj i Kalmar. Zweryfikowane (grep na ciele funkcji,
nie zgadywanie): to pole jest WYŁĄCZNIE wyświetlane w sekcji "Dziennik"
w szczegółach treningu. Nie jest czytane przez:
- buildLocalTodayCoach() (decyzja dnia),
- proWorkoutVerdict() (werdykt trenera),
- buildAthleteBaseline() / classifyAgainstBaseline() (Adaptive Profile),
- buildKalmarForecast() / buildPlanGuide() (Kalmar / Plan).

Czyli: aplikacja NIE "traktuje Szymona jako kontuzjowanego" w sensie
żadnej decyzji treningowej. Ale tekst nadal się WYŚWIETLA w dzienniku,
co jest mylące.

Dołączony plik find_injury_test_entry.sql:
- KROK 1 — czyste zapytanie SELECT (nic nie zmienia) lokalizujące
  dokładną datę i treść testowego wpisu w garmin_pro_readiness_context,
- KROK 2 — instrukcja jak bezpiecznie wyczyścić TYLKO pole
  journal_pain dla tej jednej daty, w tabeli źródłowej (nazwę tabeli
  źródłowej trzeba potwierdzić w definicji widoku — ja nie mam
  dostępu do Twojego Supabase, żeby to zrobić za Ciebie).

Mechanizm dziennika NIE jest usuwany — przyszłe, prawdziwe wpisy
zdrowotne będą się nadal poprawnie wyświetlać. Usuwamy tylko jeden,
konkretny testowy rekord, po Twoim potwierdzeniu z KROK 1.

Brak zmian w app.js dla tego punktu — bo problem nie jest w kodzie
frontendu, jest w danych testowych w Supabase.

## Problem 2: poziomy scroll całej strony

Zdiagnozowane: tabele Run Curve / Power Curve już miały własne
wrappery (.run-table-wrap, .power-table-wrap) z overflow-x:auto —
to było zrobione poprawnie. Brakowało jednak zabezpieczenia na
poziomie kontenerów WYŻEJ (html/body/app-shell/screen/karty), więc
długie, nieprzełamane treści (np. długie nazwy aktywności, długie
opisy źródeł progów) mogły rozciągać całą stronę w bok.

Dodany jeden, jasno oznaczony blok CSS na końcu styles.css:
- html/body/app-shell/screen: overflow-x:hidden + max-width jako
  siatka bezpieczeństwa,
- karty/sekcje/gridy (.card, .analysis-section, .segment-card,
  .timeline-card, .pro-segment-detail-grid, .profile-detail-grid,
  .plan-guide-card i inne): min-width:0 + max-width:100% +
  box-sizing:border-box,
- długie wartości tekstowe w tych gridach: overflow-wrap:anywhere —
  ale WYŁĄCZNIE poza tabelami (komórki run-table/power-table NIE są
  przełamywane, żeby nie gubić wyrównania kolumn),
- .run-table-wrap / .power-table-wrap: explicite potwierdzone
  overflow-x:auto + -webkit-overflow-scrolling:touch, żeby żadna
  przyszła zmiana nie wyłączyła tego przez przypadek.

Zweryfikowane (nie tylko wizualnie — zmierzone):
- agresywny stress-test (długa nieprzełamana nazwa aktywności,
  multisport z 5 segmentami, run+power intervals, wszystkie "Więcej
  szczegółów" otwarte naraz) na viewport 360px: scrollWidth strony
  PRZED poprawką = 364px (przy innerWidth 360px), PO poprawce = 360px
  na wszystkich 5 ekranach (Treningi, Dzisiaj, Plan, Kalmar, Profil),
- run-table-wrap nadal POPRAWNIE przewija się w bok wewnętrznie
  (scrollWidth 674px w 266px widocznego okna, canScroll=true) —
  fix nie ucina danych, tylko ogranicza overflow do zamierzonego
  miejsca,
- pageOverflow przy otwartej tabeli = 0px — strona nie rusza się
  w bok, tylko tabela wewnątrz.

Szczera uwaga: mój stress-test w sandboxie nie odtworzył dramatycznego
przesunięcia z opisanego screena (różnica przed poprawką była tylko
+4px, prawdopodobnie artefakt scrollbara w headless Chromium, nie
pełna reprodukcja realnego przypadku). Zaimplementowałem dokładnie tę
architekturę defensywną, którą opisałeś, i zweryfikowałem ją pod
dużym obciążeniem syntetycznym — ale warto przetestować to jeszcze
na prawdziwym urządzeniu/danych Szymona. Jeśli problem gdzieś nadal
wystąpi, prześlij dokładne dane z tego ekranu — dociągnę punktowo.

## Bez zmian (zweryfikowane diffem, bit-identyczne)

Wszystkie 14 funkcji JS: buildAthleteBaseline, classifyAgainstBaseline,
kalmarOvernightResponseForSimilar, athleteBaselineNote,
buildKalmarForecast, buildPlanGuide, kalmarRegenerationTrend,
kalmarLoadTrend, kalmarRecoveryTrend, buildKalmarCoachTip,
activityImpact, proCostTitle, proWorkoutVerdict,
kalmarRecentSessionsComparison — identyczne z v5.5.2. Problem 2 to
wyłącznie CSS, zero zmian w logice.

SQL, Supabase zapisy, VM/Proxmox, Garmin Sync Agent, service_role,
import Garmin — nie dotknięte.

## Zweryfikowane

- node --check app.js / service-worker.js: OK,
- manifest.json: OK,
- 0 błędów JS na 5 zakładkach,
- Wyloguj: +22px (bez regresji),
- brak service_role / destrukcyjnego SQL,
- 14 funkcji JS: bit-identyczne,
- stress-test poziomego scrolla: 0px przepełnienia na wszystkich
  6 wskazanych ekranach, tabela wciąż przewijalna wewnętrznie.

## Wersja / cache

v=553 we wszystkich plikach + nowy CACHE_NAME.
