Szymon AI Coach v2.8.3 — dopieszczona góra aplikacji + wyjaśniony bezpieczny tryb AI


Wersja: PWA v2.8.3

Zmiany v2.8:
- dodana osobna zakładka Wsparcie AI,
- dodany dziennik trenera: jedzenie, nawodnienie, samopoczucie, bóle/przeciążenia i ważne notatki,
- dodane proste wskaźniki: energia, stres, motywacja,
- dodane kafelki AI: Dzisiaj, Wyżywienie, Ciało, Regeneracja Garmin,
- AI-regułowe łączy wpis dnia z regeneracją Garmin i ostatnią analizą treningową,
- dodana Pamięć AI z historią wpisów,
- pulpit pozostaje minimalistyczny i nie został przeładowany.

Uwaga techniczna:
- dziennik Wsparcie AI w tej wersji zapisuje się lokalnie w przeglądarce/localStorage,
- Supabase dla dziennika można dodać w kolejnym etapie, gdy układ i pola będą zaakceptowane.

Na GitHub wgraj: index.html, app.js, styles.css, manifest.json, service-worker.js, icon-180.png, README.txt.
Agenta Proxmox, SQL i Edge Function nie ruszamy.


Zmiany v2.8.1:
- zmieniono ikony zakładek Analiza i AI na nowoczesne, liniowe ikony SVG,
- dodano widoczny aktywny link Pomoc • WawrzyS,
- kliknięcie Pomoc • WawrzyS otwiera mail do: @
- cache podbite do PWA v2.8.3.


v2.8.3 — Bezpieczne AI Coach:
- dodano warstwę czerwonych i pomarańczowych flag,
- AI nie rekomenduje intensywności przy bólu, chorobie, słabym śnie, niskim Body Battery lub powtarzających się przeciążeniach,
- porady żywieniowe są ostrożne: paliwo, nawodnienie, posiłek regeneracyjny; bez diet odchudzających i bez głodzenia,
- każda rada pokazuje podstawę w danych,
- dodano komunikat, że aplikacja nie zastępuje lekarza, dietetyka ani trenera.