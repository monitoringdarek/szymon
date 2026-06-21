Szymon AI Coach — v5.5.2 — Werdykt jako jedna narracja trenera

Przebudowa proWorkoutVerdict() z v5.5.1. Nie dłuższy tekst, nie więcej
zdań-dodatków — jedna, spójna opinia, gdzie wybiera się NAJWAŻNIEJSZY
temat i wokół niego buduje całą wypowiedź (ten sam wzorzec co `limiter`
w Kalmarze, tylko wybierający temat narracji, nie dźwignię treningową).

## Hierarchia tematu (sprawdzana w tej kolejności, pierwszy match wygrywa)

1. Multisport: IF segmentu roweru >=0.93 -> "rower zjadł bieg"
2. Intensywność (IF) ważniejsza niż load -> sesja "na górnej granicy"
3. Pojedyncza sesja ponad osobistą tolerancję (classification.tier='over')
4. Tydzień napięty (kalmarRegenerationTrend().bad), sesja sama niewinna
5. Podwyższony bodziec względem osobistego poziomu (tier='elevated')
6. Sesja normalna, ale historia podobnych treningów ostrzega przed
   wolniejszą regeneracją (kalmarOvernightResponseForSimilar)
7. Domyślny: normalny bodziec roboczy
8. Fallback: za mało danych do baseline'u, stare progi absolutne

## Nowość: porównanie do ostatnich 2-3 sesji

kalmarRecentSessionsComparison() — niezależna od 8-tygodniowego
baseline'u nić, zawsze obecna w wypowiedzi (gdy dostępne >=2 ostatnie
sesje tej samej dyscypliny). Trening może być "normalny" względem
miesięcy, a jednocześnie zauważalnym skokiem względem ostatnich dni —
to teraz jest widoczne.

5 poziomów: znacznie mocniejszy / trochę mocniejszy / podobny poziom /
trochę spokojniejszy / znacznie spokojniejszy (progi ±15%/±35%).

Porównanie jest WPLECIONE w główny temat, nie dorzucone na końcu jako
osobne zdanie — np. przy temacie "tydzień napięty": "Dzisiejszy bieg
był trochę mocniejszy niż ostatnio. To dokładanie się sumuje, nie
zaczyna od zera." — porównanie wzmacnia główny temat, nie stoi obok.

## Naprawione martwe/nieużywane dane (zgłoszone w poprzedniej rozmowie)

- `analytics`/`segments` — były przyjmowane jako parametry, nigdy
  nieużywane. Teraz: analytics.bike_if_value zasila tooHard, segments
  zasila wykrywanie "rower zjadł bieg" w multisporcie.
- `kalmarOvernightResponseForSimilar()` — istniał od v5.5.0, używany
  w proCostTitle(), ale nie w werdykcie. Teraz używany (priorytet 6).
- `hrAvg`/`hrMax` — usunięte jako martwe zmienne (nie były używane w
  starej wersji). Nie dodano HR-based intensity flag dla biegu — to
  zostaje jako otwarty punkt na przyszłość, nie wciągnięte po cichu
  w tę rundę.

## Zachowane bezpieczeństwo i zakres

Wszystkie 12 kluczowych funkcji (Adaptive Athlete Profile + Kalmar +
Plan + trend regeneracji) zweryfikowane jako bit-identyczne względem
v5.5.0/v5.5.1. Nowa funkcja korzysta z nich, nie modyfikuje.

Bez zmian: SQL, Supabase zapisy, VM/Proxmox, Garmin Sync Agent,
service_role, dane, readinessHistory, model Kalmar 226 km, Plan.

## Zweryfikowane end-to-end

- przykład load=146 + porównanie do ostatnich sesji,
- skok load (180 vs średnia ostatnich ~100) -> "znacznie mocniejszy"
  + tier='over' poprawnie się łączą w jedną narrację,
- tydzień napięty + porównanie wplecione naturalnie,
- multisport z mocnym rowerem (IF segmentu 0.95) -> "rower zjadł bieg",
- 0 błędów JS na 5 zakładkach,
- Wyloguj: +22px (bez regresji),
- brak service_role / destrukcyjnego SQL.

## Wersja / cache

v=552 we wszystkich plikach + nowy CACHE_NAME.
