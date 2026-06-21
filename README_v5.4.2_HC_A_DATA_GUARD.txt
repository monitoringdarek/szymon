Szymon AI Coach PRO — v5.4.2 HC-A Data Guard

Zakres:
- hotfix na bazie v5.4.2 HC-A athlete tone,
- zachowany sportowy, wymagający ton: TRENING / KONTROLOWANY TRENING / ODBUDOWA,
- dodany data guard dla danych porannych,
- wartości 0/null/undefined lub skrajnie podejrzane w readiness/sen/Body Battery/stress/RHR nie są interpretowane jako pewny fakt,
- w głównym werdykcie aplikacja nie pokazuje już tekstów typu „sen 0 min”, „gotowość 0/100”, „Body Battery 3” jako dowodu,
- zamiast tego pokazuje „dane poranne niepełne” albo „brak pełnych danych z dzisiejszego poranka”,
- liczby techniczne zostają w szczegółach danych,
- Edge Function activity-coach-analysis dostała tę samą ochronę w promptach i sanitizacji odpowiedzi.

Nie ruszano:
- SQL,
- tabel,
- danych,
- VM / Proxmox,
- cronów,
- importu Garmin.

Wdrożenie:
1. Pliki root wrzucić na GitHub Pages.
2. Z pełnej paczki wdrożyć funkcję:
   npx supabase functions deploy activity-coach-analysis --project-ref ktfjdngmvrnqkzjxvzoc
