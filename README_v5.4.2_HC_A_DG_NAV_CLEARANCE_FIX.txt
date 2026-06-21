# Szymon AI Coach — v5.4.2 HC-A DG Stability+ (nav clearance fix)

Mały, celowany hotfix. Zakres: tylko punkty 2 i 3 z ustalonej listy.
Nie ruszono topbara, karty Kalmar, kolorów, ikon, AI, Supabase, Edge
Function, danych ani logiki.

## Problem

Zmierzono realnym renderem (Playwright, viewport 390x844 — typowy
iPhone): treść karty „Szymon, co dziś robimy?" mogła kończyć się pod
dolną nawigacją (fixed bottom-nav) już przy pierwszym otwarciu ekranu,
zanim użytkownik zrobił cokolwiek. Brakowało ok. 16px w budżecie
wysokości ekranu.

## Co zrobiono (punkty 2 + 3)

**Punkt 2 — pasek techniczny Supabase/Garmin skompaktowany:**
- padding: 14px 16px → 6px 12px
- margin-bottom: 14px → 8px
- font-size etykiety: 14px → 11.5px
- font-size wartości: 12px → 10.5px
- wysokość paska: ~70px → ~45px

**Punkt 3 — padding/gap karty hero zmniejszony:**
- padding karty: 20-22px → 16-17px
- gap między elementami wewnątrz karty: 14px → 10px
- margin-bottom karty: dodano 12px dla czytelnego odstępu

**Punkt 3 — bezpieczny odstęp dla dolnej nawigacji:**
- padding-bottom głównego kontenera: 96px → 120px + safe-area
- dodano scroll-padding-bottom na poziomie html (defensywne, dla
  ewentualnych przyszłych scrollIntoView/anchor scroll)

## Zmierzony efekt

Przed poprawką: tekst decyzji mógł być zasłonięty przez nawigację na
starcie ekranu.
Po poprawce: 32px czystego odstępu między tekstem decyzji a górną
granicą nawigacji (test na realnym, długim tekście AI, viewport 390px).

## Co NIE zostało zmienione (zweryfikowane diffem)

- topbar / nagłówek aplikacji (margin przywrócony do wartości
  oryginalnej po wcześniejszym, niezaautoryzowanym eksperymencie)
- karta Kalmar (kolory, padding, struktura) — bez zmian
- ikony, kolorystyka stanów (train/caution/recovery)
- AI, Edge Function, kontrakt z Supabase
- SQL, VM, crony, import Garmin
- logika tygodniowa / Data Guard (już naprawione w poprzedniej rundzie)

## Naprawiona niezgodność w samej paczce źródłowej

Plakietka wersji w nagłówku pokazywała „v5.4.2 HC-A DG Stability", a
tekst w Ustawieniach pokazywał „v5.4.2 HC-A DG PRO" — różne stringi w
tej samej dostarczonej paczce. Ujednolicono do „v5.4.2 HC-A DG
Stability+" w obu miejscach.

## Wersja / cache

v=542-hc-a-dg-nav-clearance-fix we wszystkich plikach + nowy
CACHE_NAME w service-worker.js.

## Po wgraniu

Ctrl+F5 w przeglądarce. Na iPhonie zamknij i otwórz PWA ponownie.

## Test po wdrożeniu

1. Otwórz ekran Dzisiaj z dłuższym tekstem decyzji (3 linie) —
   sprawdź czy tekst ma czysty odstęp od dolnej nawigacji.
2. Sprawdź, że pasek „Supabase: ... · Garmin PRO: ..." jest teraz
   wizualnie drugoplanowy, nie konkuruje z kartą Kalmar o uwagę.
3. Sprawdź, że karta Kalmar (IRONMAN KALMAR, licznik dni, ring
   gotowości) wygląda identycznie jak przed tą poprawką.
4. Sprawdź dół ekranu Historia/Treningi — ostatni element nie chowa
   się pod nawigacją.
