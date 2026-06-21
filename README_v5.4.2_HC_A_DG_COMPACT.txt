# Szymon AI Coach — v5.4.2 HC-A DG Compact+

Mały, celowany hotfix. Dwa zadania, zero rozszerzania zakresu.

## 1. Topbar — realnie mniejszy, sticky zostaje

Zmierzono realnym renderem (Playwright): wysokość topbara spadła z
**165px do 48px**.

Zmiany:
- usunięto podtytuł „Human Coach Visual PRO+" całkowicie,
- skrócono tytuł: „Szymon AI Coach PRO" → „Szymon AI Coach",
- skrócono eyebrow: „Road to IRONMAN Kalmar 2026" → „Road to Kalmar 2026",
  rozmiar 9px, jedna linia, capslock,
- h1 zmniejszony do 16px,
- przycisk odśwież (icon-btn): 48×48px → 32×32px,
- plakietka wersji: mniejszy padding i font,
- topbar nadal `position: sticky; top: 0` — zweryfikowane scrollem,
  pozostaje przyklejony do góry.

Technicznie: dodano jeden nowy blok CSS (`.topbar.topbar-compact`) na
końcu pliku, który nadpisuje istniejące warstwy stylów przez wyższy
priorytet w kaskadzie — nie usunięto żadnej z poprzednich reguł, więc
nic innego korzystającego z `.topbar` nie zostało zerwane.

## 2. Sekcja diagnostyczna „Dane Garmin" w Profilu

Nowa karta na ekranie Ustawienia/Profil, czysto odczytowa — nie dotyka
SQL, VM, sync agenta. Pokazuje:

- ostatni udany odczyt (data + godzina),
- ostatnią aktywność Garmin (data, nazwa, sport),
- ostatni dzień z danymi porannymi,
- ostatni zapis snu (data + czas),
- ostatni Body Battery,
- ostatnią gotowość,
- ostatnie tętno spoczynkowe,
- komunikat diagnostyczny: jedna z trzech wersji w zależności od stanu
  danych — dostępne dziś / brak dziś / ostatnie z konkretnej daty.

Wszystkie wartości przechodzą przez ten sam Data Guard, który już
chroni resztę aplikacji (`morningMetricValue`, `morningDataIncomplete`)
— jeśli sen/Body Battery/gotowość/RHR są 0, null albo podejrzanie
niskie, pole pokazuje „brak pełnych danych", nigdy surowe zero.

Przetestowane trzy scenariusze (zrzuty z realnego renderu):
- dane z dzisiaj, kompletne → „Dane poranne z dzisiaj są dostępne."
- dane z dzisiaj, niekompletne (zera) → „Brak pełnych danych
  porannych z dzisiaj — aplikacja nie udaje oceny regeneracji." +
  pola pokazują „brak pełnych danych", nie „sen 0 min"
- brak danych wcale → ten sam komunikat ostrzegawczy
- dane z wczoraj → „Ostatnie dane poranne są z: 18 cze 2026."

## Dodatkowo naprawiono (drobne, przy okazji)

W dostarczonej paczce znaleziono TRZY różne stringi wersji w trzech
miejscach (plakietka, opis ekranu, pole „Wersja" w gridzie) —
ujednolicono do „v5.4.2 HC-A DG Compact+".

## Zweryfikowane jako NIEZMIENIONE (diff względem poprzedniej wersji)

- karta Kalmar (kolory, struktura, ikony) — bit-identyczna,
- dolna nawigacja — bit-identyczna,
- AI / Edge Function / kontrakt Supabase — nie dotknięte,
- SQL / VM / crony / import Garmin — nie dotknięte,
- Data Guard logika — używana, nie zmieniona.

## Wersja / cache

v=542-hc-a-dg-compact we wszystkich plikach + nowy CACHE_NAME.

## Po wgraniu

Ctrl+F5. Na iPhonie zamknij i otwórz PWA ponownie.

## Test po wdrożeniu

1. Topbar na telefonie jest realnie mniejszy — jedna zwarta linia
   tytułu + mała plakietka wersji + mały refresh.
2. Topbar zostaje przyklejony do góry przy scrollowaniu.
3. Karta Kalmar wygląda identycznie jak przed zmianą.
4. Dolna nawigacja nie zasłania tekstu (zachowane z poprzedniej rundy).
5. W Profilu → „Dane Garmin" widać dokładnie kiedy ostatnio Garmin
   dostarczył dane i czy dzisiejsze dane poranne są kompletne.
