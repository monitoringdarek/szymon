Szymon AI Coach PRO — v5.4.2-iphone-pro-visual-fix-local

Zakres wykonany:
1. Realny visual restart frontendu pod iPhone/mobile:
   - nowy ciemny sportowy wygląd,
   - mocniejszy nagłówek PRO,
   - widoczny znacznik wersji v5.4.2,
   - przebudowane karty dashboardu, historii i analizy,
   - bottom nav w stylu iPhone/PWA,
   - sekcja Analiza PRO wygląda jak ekran trenerski, nie zwykła lista.

2. Osobna sekcja „Odpowiedź po nocy”:
   - widoczna jako osobna karta w analizie PRO,
   - widoczna jako osobna sekcja w pełnej analizie AI,
   - przy braku danych D+1 pokazuje dokładnie:
     „Brak danych z kolejnej nocy — pełna ocena kosztu regeneracji nie jest jeszcze możliwa.”
   - jeśli dane D+1 istnieją, pokazuje sen, Body Battery, stress, resting HR, readiness i HRV, bez zgadywania braków.

3. Cache / wersje:
   - app.js: v5.4.2-iphone-pro-visual-fix-local
   - index.html: query string v=542-iphone-pro-visual-fix
   - service-worker.js: cache szymon-ai-coach-v5-pro-only-v542-iphone-pro-visual-fix
   - service worker rejestrowany z v=542-iphone-pro-visual-fix
   - manifest start_url: ./?v=542

4. Nie ruszano:
   - Supabase SQL,
   - struktury tabel,
   - VM / cron,
   - importu Garmin,
   - danych,
   - kluczy prywatnych/service_role.

Testy:
- node --check app.js: OK
- node --check service-worker.js: OK
- manifest.json: OK
- kontrola wymaganych ID w index.html względem app.js: OK
