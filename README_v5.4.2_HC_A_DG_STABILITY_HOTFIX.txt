# Szymon AI Coach — v5.4.2 HC-A DG Stability Hotfix

Mały, celowany hotfix na bazie działającej wersji v5.4.2 HC-A DG PRO+.
Cel: spójność Data Guard w całym UI, bez zmiany kontraktu AI.

## Zakres wykonany

1. Sekcja „Szczegóły danych" (Gotowość / Sen / Body Battery) na ekranie
   Dzisiaj przepuszczona przez ten sam Data Guard (morningMetricValue +
   morningDataIncomplete), który już chronił główny tekst trenera i ring
   gotowości. Wcześniej te trzy pola czytały surowe wartości z readiness
   bez filtra, co mogło pokazywać "gotowość 0/100" / "Body Battery 0 → 3"
   równolegle z tekstem AI mówiącym "dane poranne niepełne".

2. Usunięto powtórzenie "Co dziś?" — element todayMainAction w karcie
   hero był duplikatem treści już pokazywanej w dedykowanej karcie
   "Decyzja trenera" (pole coachToday). Usunięty z index.html i app.js.

3. Zweryfikowano (bez zmian, bo już było poprawne):
   - normalizeCoachTitle zawsze mapuje status na jeden z trzech stałych
     tytułów (DZISIAJ: TRENING / KONTROLOWANY TRENING / ODBUDOWA)
     niezależnie czy źródłem jest AI czy fallback lokalny — słownictwo
     już było spójne, nie wymagało poprawki.
   - Ring gotowości (renderKalmarFocusCard) już używał Data Guard przez
     validTodayReadinessScore() — nie był źródłem rozbieżności.

4. Wersja/cache bump: v=542-hc-a-dg-stability-hotfix we wszystkich
   plikach (index.html, app.js, manifest.json, service-worker.js) +
   nowa nazwa CACHE_NAME w service-worker.js, żeby wymusić odświeżenie
   cache po wgraniu.

## Nie ruszano

- SQL,
- Supabase Edge Function (activity-coach-analysis) i jej kontraktu,
- tabel i danych,
- VM / Proxmox,
- cronów,
- importu Garmin,
- logiki AI / mode: "today",
- grafiki / stylów wizualnych.

## Po wgraniu

Ctrl+F5 w przeglądarce. Na iPhonie zamknij i otwórz PWA ponownie, żeby
service worker pociągnął nowy CACHE_NAME.

## Co sprawdzić po wdrożeniu

Otwórz ekran Dzisiaj w sytuacji, gdy dane poranne są niepełne (np. brak
snu z ostatniej noby). Oczekiwany efekt: główny tekst trenera ORAZ
"Szczegóły danych" mówią to samo — "brak pełnych danych" w obu miejscach,
żadnych surowych zer.
