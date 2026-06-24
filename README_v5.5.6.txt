Szymon AI Coach — v5.5.6 — poprawka po przeglądzie v5.5.5

KRYTYCZNY BŁĄD znaleziony i naprawiony. Nie wdrażać v5.5.5 — wdrożyć
tę wersję (v5.5.6) zamiast niej.

## Co było nie tak w v5.5.5

Podczas refaktoryzacji na mechanizm cache/Gemini Guard przypadkowo
usunięto cały, spójny blok 11 funkcji renderujących, które nowy kod
WCIĄŻ wywołuje:

buildActivityAiAnalysis, renderFactsBlock, renderAnalysisBlock,
renderBulletSection, renderSegmentCards, renderTimeline,
renderRawSummary, renderThresholdProfileContext, renderRunIntervals,
renderPowerIntervals, renderFullAnalysisDetails.

Efekt: `renderAi()` (wołane przez `renderAll()` na KAŻDYM cyklu
odświeżenia, niezależnie od aktywnej zakładki — to jest istniejący
wzorzec całej aplikacji) wyrzucało `ReferenceError:
buildActivityAiAnalysis is not defined` natychmiast, gdy istniała
jakakolwiek aktywność (`latest`) — czyli w KAŻDEJ realnej sesji z
prawdziwymi danymi Garmina.

Ponieważ błąd wystąpił w środku `renderAll()`, wszystko wołane PO
`renderAi()` w tej samej funkcji — `renderSettings()`,
`renderKalmarForecast()`, `renderStatus()` — przestawało się
wykonywać. Zmierzone bezpośrednio: po wywołaniu `renderAll()` z
ustawionym `latest`, ekran Kalmar zostawał na "czekam na dane" na
zawsze, Profil na "brak danych" na zawsze, niezależnie od realnych
danych w pamięci.

`node --check app.js` nie wykrywa tego typu błędu — to błąd
odwołania w czasie wykonania (poprawna składnia JS, ale wywołanie
nieistniejącej funkcji), nie błąd składni. Wykryte tylko przez
faktyczne uruchomienie kodu (Playwright, realne wywołanie
renderAll() z danymi), nie przez statyczną kontrolę.

## Naprawione

Przywrócono brakujący blok 1:1 z v5.5.4 (zero zmian w treści tych
funkcji — to są generyczne helpery renderujące, niezależne od logiki
auto-fetch/manual/cache). Zweryfikowane systematycznym skanem całego
pliku (porównanie wszystkich wywołań funkcji z wszystkimi
definicjami) — brak innych nowych wisiących referencji poza tym
jednym blokiem.

Potwierdzone bezpośrednim testem: renderAll() z ustawionym `latest`
nie wyrzuca już błędu, Kalmar poprawnie się przelicza
("13:05–14:50" zamiast zawieszonego "czekam na dane").

## Co zweryfikowano jako DZIAŁAJĄCE w nowym mechanizmie AI Guard
(po naprawie powyższego błędu)

Test z zamockowanym fetch (3 kroki, Edge Function nie jest dostępna
w tym środowisku testowym):

1. Zwykłe wejście, brak cache: 0 wywołań do Edge Function, status
   "Pokazuję lokalną decyzję trenera. Gemini nie zostało
   uruchomione." — potwierdzone.
2. Kliknięcie "Odśwież AI": dokładnie 1 wywołanie do Edge Function,
   wynik zapisany w localStorage
   (szymonAiCoach:v555:today:gid1:2026-06-24), status zmienia się na
   "Ta decyzja została właśnie wygenerowana przez AI i zapisana w
   cache." — potwierdzone.
3. Symulacja ponownego wejścia (reset stanu w pamięci, bez force):
   0 NOWYCH wywołań do Edge Function, dane wzięte z cache, status
   "Pokazuję zapisaną decyzję AI. Nie zużywam teraz Gemini." —
   potwierdzone.

Przycisk dla "Plan → Ostatni trening" (osobny mechanizm,
data-ai-refresh-activity): lokalna analiza renderuje się bez
klikania, przycisk istnieje i jest klikalny. Test błędu 429 (limit
Gemini): pokazuje przyjazny komunikat, nie techniczny błąd —
potwierdzone.

Wiązanie przycisków: sprawdzone, że dzieje się raz w bindEvents()
(wołane przy starcie), nie przy każdym renderze — brak ryzyka
duplikujących się listenerów.

## Dodatkowa, drobna, NIEZWIĄZANA obserwacja (nie naprawione, niski priorytet)

`fmtDuration` jest wołane w runIntervalLabel(), ale nie jest
zdefiniowane — to ISTNIEJE JUŻ w v5.5.4, nie jest regresją
wprowadzoną przez v5.5.5. Niska waga, bo dotyczy prawdopodobnie
rzadko trafianej gałęzi tekstu. Zostawione bez zmian w tej rundzie —
osobny, mały temat na przyszłość, jeśli faktycznie się objawi w
realnym użyciu.

## Zweryfikowane jako NIETKNIĘTE (diff, bit-identyczne)

17 funkcji: buildAthleteBaseline, classifyAgainstBaseline,
kalmarOvernightResponseForSimilar, athleteBaselineNote,
buildKalmarForecast, buildPlanGuide, kalmarRegenerationTrend,
kalmarLoadTrend, kalmarRecoveryTrend, buildKalmarCoachTip,
kalmarRecentSessionsComparison, kalmarComparisonPhrase,
activityImpact, proCostTitle, proWorkoutVerdict, sportLabel,
proTrainingTypeLabel — wszystkie identyczne z v5.5.4. Model Kalmar
226 km, Plan, Adaptive Athlete Profile i humanizacja typów aktywności
(v5.5.4) bez zmian.

CSS: tylko czyste, dodatkowe reguły dla nowych przycisków/statusów
AI (.ai-control-row, .ai-refresh-btn, .ai-status-badge.ai-cache/
ai-manual) — żadna istniejąca klasa nie zmieniona. Stress-test
poziomego scrolla i Wyloguj z poprzednich rund: bez regresji.

SQL, Supabase zapisy, VM/Proxmox, Garmin Sync Agent, import Garmin,
Edge Function, service_role — nie dotknięte.

## Zweryfikowane

- node --check app.js / service-worker.js: OK,
- manifest.json: OK,
- 0 błędów JS na 5 zakładkach (z aktywnością i AI Guard aktywnym),
- Wyloguj: +25px (bez regresji),
- brak service_role / destrukcyjnego SQL,
- mechanizm cache/manual-trigger AI: zweryfikowany end-to-end w 3
  krokach + obsługa błędu 429.

## Wersja / cache

v=556 we wszystkich plikach + nowy CACHE_NAME.

## Test po wdrożeniu (z oryginalnego README v5.5.5, wciąż aktualny)

1. Wgrać pliki v5.5.6 na GitHub Pages.
2. Odświeżyć PWA / stronę.
3. Wejść w Dzisiaj — powinno być "lokalna decyzja bez Gemini" albo
   "AI · z cache", bez nowego POST bez kliknięcia "Odśwież AI".
4. Wejść w Plan → Ostatni trening — bez klikania lokalna analiza.
5. Sprawdzić Supabase → Edge Functions → Logs: sam wpis do
   aplikacji nie powinien generować POST-ów do AI.
