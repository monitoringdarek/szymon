// supabase/functions/activity-coach-analysis/index.ts
//
// WERSJA 3 — Human Coach Weekly Context.
// Zakres: tylko Edge Function, tylko odczyt danych, bez zmian SQL/VM/cronów/danych.
//
// Obsługiwane tryby:
// 1) POST body: { activityId } albo { mode: "activity", activityId }
//    Zwraca: { analysis: { headline, coachAnalysis, good[], risks[], kalmar, recovery, nightResponse, dataGaps[] } }
//    Ten kontrakt zostaje zgodny z app.js v5.4.2.
//
// 2) POST body: { mode: "today", activityId }
//    Zwraca: { todayCoach: { status, title, summary, today, tomorrow, nextDays, weeklyTrend, lastTrainings[], watch[], dataGaps[] } }
//    To zasila nowy ekran „Dzisiaj”: tydzień wstecz + minimum 3 ostatnie treningi + zalecenia na najbliższe dni.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const HUMAN_LANGUAGE_RULES = `
BARDZO WAŻNE — język dla Szymona:
- Nie używaj technicznych oznaczeń: D+1, D0, D-1, Baseline, Recovery.
- Zamiast D+1 pisz: "następnego dnia", "poranek po treningu", "po kolejnej nocy".
- Zamiast D0 pisz: "dzień treningu".
- Zamiast Baseline pisz: "punkt odniesienia" albo "ostatnie dni".
- Zamiast Recovery pisz: "regeneracja".
- Nie pisz raportu laboratoryjnego. Pisz jak trener: prosto, konkretnie i z decyzją.
- Liczby możesz podać tylko wtedy, gdy od razu tłumaczysz, co znaczą dla treningu.
- Jeśli brakuje danych, napisz "brak danych" i nie zgaduj.
`;

const ACTIVITY_PROMPT = `Jesteś doświadczonym trenerem triathlonu przygotowującym Szymona do Ironman Kalmar 2026.
Analizujesz konkretny trening lub start na podstawie realnych danych Garmin PRO: aktywność główna, segmenty, sen, Body Battery, stress, tętno spoczynkowe, gotowość i kontekst regeneracji.

${HUMAN_LANGUAGE_RULES}

Zasady analizy aktywności:
1. Każde zdanie ma wynikać z danych. Nie wymyślaj brakujących wartości.
2. Jeśli są segmenty, analizuj je osobno: pływanie, T1, rower, T2, bieg albo odcinki roweru/biegu.
3. Gdy segmenty są równe, nazwij to stabilnością i kontrolą, nie szukaj sztucznych problemów.
4. Łącz fakty: stan przed treningiem → przebieg treningu → koszt dla organizmu → co dalej.
5. Pole nightResponse opisuje wyłącznie realne dane z poranka po treningu. Jeśli ich nie ma, ustaw pusty string i dopisz "brak_danych_po_nocy" w dataGaps.
6. Pole recovery ma być konkretną decyzją na najbliższe dni, nie ogólnikiem.

Odpowiadasz WYŁĄCZNIE poprawnym JSON-em:
{
  "headline": "1-2 zdania: najważniejszy wniosek z treningu",
  "coachAnalysis": "3-7 zdań: pełna, ludzka analiza trenerska",
  "good": ["punkt 1", "punkt 2"],
  "risks": ["punkt 1", "punkt 2"],
  "kalmar": "1-3 zdania: znaczenie dla przygotowań do Ironman Kalmar",
  "recovery": "1-2 zdania: konkretne zalecenie na kolejne dni",
  "nightResponse": "opis poranka po treningu jeśli dane są dostępne, inaczej pusty string",
  "dataGaps": ["lista braków danych"]
}`;

const TODAY_PROMPT = `Jesteś osobistym trenerem Szymona przygotowującego się do Ironman Kalmar 2026.
Twoim zadaniem nie jest opisanie jednej aktywności, tylko danie profesjonalnej decyzji: co Szymon ma zrobić dzisiaj, jutro i przez najbliższe dni.

${HUMAN_LANGUAGE_RULES}

Kontekst, który dostajesz:
- ostatni tydzień aktywności,
- minimum 3 ostatnie treningi, jeśli są dostępne,
- sen, Body Battery, stress, tętno spoczynkowe i gotowość z ostatnich dni,
- ostatni ważny trening i jego segmenty,
- podsumowanie tygodnia Garmin PRO.

Zasady decyzji:
1. Na początku daj jedną jasną decyzję: train, caution albo recovery.
2. Pisz dla Szymona, nie dla programisty. Ma po 10 sekundach wiedzieć, co robić.
3. Patrz na tydzień wstecz, nie tylko jeden trening.
4. Uwzględnij minimum 3 ostatnie treningi. Jeśli ich brakuje, napisz to w dataGaps.
5. Daj konkretną rekomendację na dziś, jutro i najbliższe 2-3 dni.
6. Nie udawaj, że znasz przyszłe dane Garmin. Możesz dać warunek: jeśli sen i energia się poprawią, wróć do spokojnego treningu; jeśli nie, regeneracja.
7. Nie używaj słów D+1, D0, Baseline, Recovery.

Odpowiadasz WYŁĄCZNIE poprawnym JSON-em:
{
  "status": "train | caution | recovery",
  "title": "DZISIAJ: ...",
  "summary": "2-4 zdania: dlaczego taka decyzja",
  "today": "konkret: co zrobić dziś",
  "tomorrow": "konkret: co zrobić jutro, z warunkiem jeśli trzeba",
  "nextDays": "zalecenie na najbliższe 2-3 dni",
  "weeklyTrend": "wniosek z ostatniego tygodnia",
  "lastTrainings": [
    {"date":"data lub opis", "title":"trening", "summary":"ludzki opis kosztu i znaczenia", "load": null}
  ],
  "watch": ["co obserwować"],
  "dataGaps": ["braki danych"]
}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const geminiKey = Deno.env.get("GEMINI_API_KEY");

    if (!geminiKey) return jsonResponse({ error: "GEMINI_API_KEY nie jest ustawiony." }, 500);

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const body = await req.json().catch(() => ({}));
    const mode = body?.mode === "today" ? "today" : "activity";
    const activityId = body?.activityId;

    if (mode === "today") {
      const todayCoach = await buildTodayCoach(supabase, geminiKey, activityId);
      return jsonResponse({ todayCoach, model: GEMINI_MODEL }, 200);
    }

    if (!activityId) return jsonResponse({ error: "Brak activityId w żądaniu." }, 400);
    const analysis = await buildActivityAnalysis(supabase, geminiKey, activityId);
    return jsonResponse({ analysis, model: GEMINI_MODEL }, 200);
  } catch (err) {
    return jsonResponse({ error: String(err) }, 500);
  }
});

async function buildActivityAnalysis(supabase: any, geminiKey: string, activityId: string) {
  const { data: contextRow, error: contextErr } = await supabase
    .from("garmin_pro_activity_analysis_context")
    .select("*")
    .eq("activity_id", activityId)
    .maybeSingle();

  if (contextErr || !contextRow) {
    throw new Error(`Nie znaleziono kontekstu aktywności: ${contextErr?.message ?? "brak danych"}`);
  }

  const { data: segments } = await supabase
    .from("garmin_activity_segments")
    .select("*")
    .eq("activity_id", activityId)
    .order("segment_order", { ascending: true });

  const { data: recentSimilar } = contextRow.sport_type
    ? await supabase
        .from("garmin_pro_activity_analysis_context")
        .select("workout_date, sport_type, training_load, hr_avg, np_watts, intensity_factor")
        .eq("sport_type", contextRow.sport_type)
        .lt("workout_date", contextRow.workout_date)
        .order("workout_date", { ascending: false })
        .limit(4)
    : { data: [] };

  const payload = { activity: contextRow, segments: segments ?? [], recentSimilarActivities: recentSimilar ?? [] };
  const analysis = await callGemini(geminiKey, ACTIVITY_PROMPT, payload);
  return humanizeObject(analysis);
}

async function buildTodayCoach(supabase: any, geminiKey: string, activityId?: string) {
  let anchorActivity: any = null;
  if (activityId) {
    const { data } = await supabase
      .from("garmin_pro_activity_analysis_context")
      .select("*")
      .eq("activity_id", activityId)
      .maybeSingle();
    anchorActivity = data;
  }

  if (!anchorActivity) {
    const { data } = await supabase
      .from("garmin_pro_activity_analysis_context")
      .select("*")
      .order("workout_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    anchorActivity = data;
  }

  if (!anchorActivity) throw new Error("Brak aktywności do decyzji dziennej.");

  const anchorDate = String(anchorActivity.workout_date || "").slice(0, 10);
  const weekStart = addDaysIso(anchorDate, -7);
  const weekEnd = addDaysIso(anchorDate, 1);

  const { data: weekActivities } = await supabase
    .from("garmin_pro_activity_analysis_context")
    .select("*")
    .gte("workout_date", weekStart)
    .lte("workout_date", weekEnd)
    .order("workout_date", { ascending: false })
    .limit(20);

  const recentIds = (weekActivities ?? [])
    .slice(0, 5)
    .map((row: any) => row.activity_id)
    .filter(Boolean);

  let segments: unknown[] = [];
  if (recentIds.length) {
    const { data } = await supabase
      .from("garmin_activity_segments")
      .select("*")
      .in("activity_id", recentIds)
      .order("segment_order", { ascending: true });
    segments = data ?? [];
  }

  const { data: readinessRows } = await supabase
    .from("garmin_pro_readiness_context")
    .select("*")
    .order("metric_date", { ascending: false })
    .limit(10);

  const { data: weeklySummary } = await supabase
    .from("garmin_pro_weekly_summary")
    .select("*")
    .limit(1)
    .maybeSingle();

  const dataGaps: string[] = [];
  if ((weekActivities ?? []).length < 3) dataGaps.push("mniej niż 3 treningi w ostatnim tygodniu");
  if (!(readinessRows ?? []).length) dataGaps.push("brak danych regeneracji z ostatnich dni");
  if (!weeklySummary) dataGaps.push("brak podsumowania tygodnia Garmin PRO");

  const payload = {
    anchorDate,
    anchorActivity,
    weekWindow: { from: weekStart, to: weekEnd },
    weekActivities: weekActivities ?? [],
    lastThreeTrainings: (weekActivities ?? []).slice(0, 3),
    recentSegments: segments,
    readinessLastDays: readinessRows ?? [],
    weeklySummary: weeklySummary ?? null,
    explicitDataGaps: dataGaps,
  };

  const coach = await callGemini(geminiKey, TODAY_PROMPT, payload);
  const human = humanizeObject(coach) as Record<string, unknown>;
  human.dataGaps = Array.from(new Set([...(Array.isArray(human.dataGaps) ? human.dataGaps as string[] : []), ...dataGaps]));
  return human;
}

async function callGemini(geminiKey: string, systemPrompt: string, payload: unknown) {
  const geminiBody = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: "user", parts: [{ text: `Dane Garmin PRO (JSON):\n${JSON.stringify(payload, null, 2)}` }] }],
    generationConfig: { temperature: 0.35, responseMimeType: "application/json" },
  };

  const geminiResp = await fetch(`${GEMINI_URL}?key=${geminiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(geminiBody),
  });

  if (!geminiResp.ok) {
    const errText = await geminiResp.text();
    throw new Error(`Gemini error: ${errText}`);
  }

  const geminiJson = await geminiResp.json();
  const rawText = geminiJson?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  try {
    return JSON.parse(rawText);
  } catch {
    throw new Error(`Gemini zwrócił nieprawidłowy JSON: ${rawText.slice(0, 500)}`);
  }
}

function humanizeText(value: string) {
  return String(value ?? "")
    .replace(/\bD-3\s*→\s*D\+1\b/g, "tydzień i poranek po treningu")
    .replace(/\bD\+1\b/g, "poranek po treningu")
    .replace(/\bD0\b/g, "dzień treningu")
    .replace(/\bD-\d+\b/g, "jeden z dni przed treningiem")
    .replace(/\bBaseline\b/gi, "punkt odniesienia")
    .replace(/\bRecovery\b/gi, "regeneracja")
    .replace(/\btraining readiness\b/gi, "gotowość treningowa")
    .replace(/\breadiness\b/gi, "gotowość");
}

function humanizeObject(value: unknown): unknown {
  if (typeof value === "string") return humanizeText(value);
  if (Array.isArray(value)) return value.map(humanizeObject);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, val]) => [key, humanizeObject(val)]));
  }
  return value;
}

function addDaysIso(value: string, days: number) {
  const raw = String(value || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const d = new Date(`${raw}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
