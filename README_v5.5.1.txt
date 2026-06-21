Szymon AI Coach — v5.5.1 — Human Coach Verdict

Baza: v5.5.0 Adaptive Athlete Profile.

Zakres tej poprawki:
- dodano kartę „WERDYKT TRENERA” w szczegółach aktywności, bezpośrednio pod nagłówkiem „Analiza treningu”, przed „STAN PRZED”;
- karta tłumaczy analizę ludzkim językiem: czy trening był OK, czy był alarm, co oznacza obciążenie i jaki jest kolejny krok pod Kalmar;
- skrócono stan oczekiwania w sekcji „ODPOWIEDŹ PO NOCY”: bez długiej listy braków typu sen/Body Battery/gotowość brak danych;
- właściwa odpowiedź po nocy nadal pokazuje się wtedy, gdy dane z kolejnego poranka są dostępne;
- zachowano Adaptive Athlete Profile z v5.5.0;
- nie ruszano Kalmara, Planu, SQL, Supabase zapisów, VM/Proxmox, Garmin Sync Agent ani service_role.

Wersja/cache:
- widoczna wersja: v5.5.1
- cache busting: ?v=551
- cache: szymon-ai-coach-v5.5.1

Testy:
- node --check app.js OK
- node --check service-worker.js OK
- manifest.json OK
- brak service_role / destrukcyjnego SQL poza tekstem kontrolnym README
