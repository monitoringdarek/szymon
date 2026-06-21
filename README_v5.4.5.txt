Szymon AI Coach — v5.4.5

Wersja: szymon-ai-coach-v5.4.5
Cache: szymon-ai-coach-v5.4.5
Cache busting: ?v=545

Zakres v5.4.5 (tylko warstwa tekstu, zero zmian logiki):

- skrócono wszystkie 8 wariantów „Co poprawi prognozę" (7 z
  buildKalmarCoachTip + 1 ze stanu pustego buildKalmarForecast) do
  realnych 3 linii,
- każdy wariant ma strukturę: fakt -> cel tygodnia -> dlaczego to
  pomaga prognozie Kalmar,
- dodano kalmarShortFact() — mały, lokalny mapping skracający etykiety
  faktu WYŁĄCZNIE w tej jednej karcie (np. "brakuje zakładki lub
  startu multisport" -> "multisport"). Nie zmienia to tablic
  missing/weak używanych gdzie indziej (pole "guard" w tej samej
  karcie zachowuje pełny, długi opis),
- linia roweru używa zaokrąglonego km bez miejsc dziesiętnych
  (np. "92 km" zamiast "92.00 km") tylko w tym jednym miejscu —
  fmtKmDot() używany gdzie indziej w aplikacji jest nietknięty,
- dodano white-space:pre-line w CSS, żeby \n w tekście renderował się
  jako wymuszone łamanie linii, nie zlewał się w jeden akapit.

Metoda weryfikacji:
Każdy z 8 wariantów (oraz 4 przypadki brzegowe: rower 135 km, rower
92 km, zupełny brak danych rowerowych, najgorszy przypadek długiej
etykiety faktu) zmierzony realnym renderem (Playwright, viewport
390x844, ten sam font/waga co produkcyjny CSS) — wysokość elementu
podzielona przez line-height, nie szacowanie na oko. Wszystkie
warianty potwierdzone na <=3 linie po dwóch rundach korekt (pierwsza
próba wyszła na 4-6 linii, bo rzeczywista szerokość karty to 306px,
węższa niż początkowo zakładano, a krój czcionki jest bardzo ciężki
- waga 850).

Bez zmian:
- logika limitera i hierarchii (brak danych / regeneracja trendowa /
  rower / bieg po rowerze / pływanie / trzymaj rytm),
- readinessHistory i model trendu regeneracji,
- Supabase SQL, VM/Proxmox, Garmin Sync Agent, dane, service_role,
  zapisy do bazy.

Zweryfikowane (diff + regresja):
- 0 błędów JS na wszystkich 5 zakładkach,
- patch "Wyloguj" z v5.4.3 nadal aktywny (+28px odstępu od nawigacji),
- brak service_role / destrukcyjnego SQL (grep niezależny),
- nazewnictwo 226 km bez zmian.
