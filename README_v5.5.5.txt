Szymon AI Coach — v5.5.5 — AI Control / Gemini Guard

Baza:
- v5.5.4 — humanizacja typów aktywności Garmin.

Cel v5.5.5:
- ograniczyć zużycie Gemini API,
- zatrzymać automatyczne odpalanie pełnej analizy AI przy zwykłym odświeżeniu aplikacji,
- dać użytkownikowi jasną kontrolę: kiedy aplikacja używa Gemini, a kiedy pokazuje decyzję lokalną / cache.

Zakres zmian:

1) Ekran Dzisiaj — brak automatycznego Gemini
- Po zwykłym wejściu / odświeżeniu aplikacji karta Dzisiaj pokazuje lokalną decyzję trenera.
- Gemini nie jest uruchamiane automatycznie, jeśli nie ma zapisanego wyniku z cache.
- Dodano przycisk „Odśwież AI”. Dopiero kliknięcie tego przycisku wysyła żądanie do Edge Function activity-coach-analysis z mode: today.
- Jeżeli wynik AI zostanie wygenerowany, jest zapisywany w localStorage jako cache dziennej decyzji.
- Przy kolejnym wejściu aplikacja pokazuje „AI · z cache” i nie zużywa Gemini.

2) Plan / Ostatni trening / Analiza AI — brak automatycznego Gemini
- renderActivityAiAnalysis() nie wysyła już automatycznie POST do activity-coach-analysis.
- Jeśli jest cache analizy dla tej aktywności, aplikacja pokazuje zapisany wynik jako „Analiza z cache — bez zużycia Gemini”.
- Jeśli cache nie ma, aplikacja pokazuje lokalną analizę faktograficzną i komunikat „Lokalna analiza — Gemini nie zostało uruchomione”.
- Dodano przycisk „Wygeneruj AI” / „Odśwież AI”. Dopiero kliknięcie przycisku wysyła POST do Edge Function.
- Wynik analizy aktywności jest zapisywany w localStorage na 14 dni.

3) Obsługa limitu / błędu Gemini
- Jeśli AI zwróci limit / błąd, aplikacja nie pokazuje technicznego błędu.
- Zostaje lokalna analiza z komunikatem, że Gemini / AI jest niedostępne.

4) Statusy widoczne dla użytkownika
- Dzisiaj:
  - „lokalna decyzja bez Gemini”
  - „AI · z cache”
  - „AI · wygenerowano teraz”
  - „AI limit · decyzja lokalna”
- Analiza treningu:
  - „Lokalna analiza — Gemini nie zostało uruchomione”
  - „Analiza z cache — bez zużycia Gemini”
  - „Analiza wygenerowana przez AI i zapisana w cache”

5) Log pomocniczy po stronie przeglądarki
- Dodano console.info:
  - GEMINI_CALL_START_CLIENT
  - GEMINI_CALL_END_CLIENT
- To pomaga lokalnie w DevTools sprawdzić, kiedy użytkownik ręcznie uruchomił AI.
- To nie jest jeszcze log Supabase Edge Function. Do pełnego logowania po stronie Supabase trzeba osobno zmodyfikować kod Edge Function.

Czego nie ruszano:
- Supabase SQL
- tabele / widoki
- VM / Proxmox
- Garmin Sync Agent
- import Garmin
- Edge Function activity-coach-analysis
- service_role
- model Kalmar 226 km
- Adaptive Athlete Profile
- logika progów / sugestii progów

Wersja / cache:
- widoczna wersja: v5.5.5
- app.js?v=555
- styles.css?v=555
- manifest.json?v=555
- service-worker.js?v=555
- CACHE_NAME: szymon-ai-coach-v5.5.5

Testy wykonane lokalnie:
- node --check app.js OK
- node --check service-worker.js OK
- manifest.json OK
- grep SUPABASE_SERVICE_ROLE / service_role / drop table / delete from / truncate — brak w kodzie

Test po wdrożeniu:
1. Wgrać pliki v5.5.5 na GitHub Pages.
2. Odświeżyć PWA / stronę.
3. Wejść w Dzisiaj:
   - powinno być „lokalna decyzja bez Gemini” albo „AI · z cache”.
   - bez kliknięcia „Odśwież AI” nie powinno być nowego POST do Edge Function.
4. Wejść w Plan → Ostatni trening:
   - bez kliknięcia „Wygeneruj AI” aplikacja powinna pokazać lokalną analizę.
5. Sprawdzić Supabase → Edge Functions → activity-coach-analysis → Logs / Invocations:
   - samo wejście w aplikację nie powinno generować nowych POST-ów do AI.
   - POST powinien pojawić się dopiero po kliknięciu przycisku AI.
