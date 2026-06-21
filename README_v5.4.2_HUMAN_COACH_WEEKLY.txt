Szymon AI Coach PRO — v5.4.2-human-coach-weekly-context-local

Baza odniesienia:
- szymon-main(3).zip / v5.4.2-iphone-pro-visual-fix-local
- nie użyto odrzuconych wersji v5.5/v5.6

Cel zmiany:
- zmienić aplikację z technicznego raportu w prostego codziennego trenera dla Szymona
- pierwszy ekran po zalogowaniu odpowiada: co robić dziś, co jutro, jaki jest trend tygodnia
- AI ma oceniać tydzień wstecz, minimum 3 ostatnie treningi i regenerację z ostatnich dni

Zakres frontendu:
- index.html: ekran startowy zmieniony na „Dzisiaj”
- app.js: dodana decyzja tygodniowa Human Coach, lokalny fallback i tryb AI { mode: "today" }
- styles.css: dodane karty Human Coach i 4-elementowa nawigacja: Dzisiaj / Treningi / Plan / Profil
- service-worker.js: cache podbity na v542-human-coach-weekly
- manifest.json: start_url podbite

Zakres Edge Function:
- supabase/functions/activity-coach-analysis/index.ts v3
- zachowuje stary kontrakt { activityId } dla analizy aktywności
- dodaje nowy kontrakt { mode: "today", activityId } dla ekranu Dzisiaj
- czyta tylko dane przez token użytkownika i anon key, bez service_role
- nie zmienia SQL, tabel, VM, cronów ani danych

Ważne zasady języka:
- na ekranie dla Szymona nie używać: D+1, D0, Baseline, Recovery
- zamiast tego: poranek po treningu, po kolejnej nocy, dzień treningu, ostatnie dni, regeneracja
- główny ekran nie jest raportem z liczb; liczby są schowane w szczegółach

Testy lokalne:
- node --check app.js OK
- node --check service-worker.js OK
- manifest.json OK
- kontrola ID index.html względem app.js OK

Wdrożenie Edge Function v3:
Z folderu projektu:
  npx supabase functions deploy activity-coach-analysis --project-ref ktfjdngmvrnqkzjxvzoc

Nie uruchamiać:
- supabase db push
- supabase db reset
- migracji SQL
- zmian VM/cron/Garmin sync
