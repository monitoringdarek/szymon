# Wdrożenie `activity-coach-analysis` v3 — Human Coach Weekly Context

Zakres bezpieczny: wdrażamy tylko Edge Function. Nie zmieniamy SQL, tabel, danych, VM, cronów ani importu Garmin.

## Co zmienia v3

- Stary kontrakt `{ activityId }` zostaje zachowany dla ekranu „Ostatni trening”.
- Nowy tryb `{ mode: "today", activityId }` zwraca decyzję dla ekranu „Dzisiaj”.
- AI analizuje tydzień wstecz, minimum 3 ostatnie treningi, regenerację z ostatnich dni i ostatni ważny trening.
- W odpowiedziach użytkownikowi funkcja usuwa techniczne zwroty typu `D+1`, `D0`, `Baseline`, `Recovery`.

## Deploy

Z folderu projektu, w którym widzisz katalog `supabase`, uruchom:

```bat
npx supabase functions deploy activity-coach-analysis --project-ref ktfjdngmvrnqkzjxvzoc
```

## Sekret

Sekret `GEMINI_API_KEY` musi istnieć. Sprawdzenie:

```bat
npx supabase secrets list --project-ref ktfjdngmvrnqkzjxvzoc
```

Nie wklejaj klucza do frontendu ani do rozmowy.
