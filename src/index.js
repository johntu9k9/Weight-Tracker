import PAGE from "./index.html";
import { makeIcon, MANIFEST, SW } from "./assets.js";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
// GLM-5.3-Flash won a bake-off on real entries (Workers Paid plan model). Reasoning can't be
// turned off on this model, only lowered; "low" uses almost no extra tokens for this task.
const AI_MODEL = "@cf/zai-org/glm-5.3-flash";
const MAX_TEXT = 4000; // characters per meal / activity description

const FOOD_PROMPT =
  "You estimate nutrition for a personal food log. The user lists what they ate, usually with gram weights. Rules: gram weights are COOKED weights unless the user says raw. Meat is skinless and lean unless stated (e.g. chicken breast cooked ~165 kcal/100g, chicken thigh skinless cooked ~180 kcal/100g). Vegetables 'no oil' or blanched/steamed have no added fat. If a quantity is vague ('some', 'a bunch'), assume one typical serving. Drinks: a beer ~150 kcal, a glass of wine ~125 kcal, a cocktail ~200 kcal unless described. If the user states calories for an item (e.g. '150 calories of tortillas'), use that number exactly. Return ONLY JSON matching the schema; keep item names short.";
const FOOD_SCHEMA = {
  type: "object",
  properties: {
    items: { type: "array", items: { type: "object", properties: { name: { type: "string" }, calories: { type: "number" }, protein_g: { type: "number" } }, required: ["name", "calories", "protein_g"] } },
    note: { type: "string" },
  },
  required: ["items"],
};
const exercisePrompt = (weight, unit) =>
  `You estimate calories burned by exercise for a personal log, ON TOP of normal daily burn (exclude resting metabolism). ${weight ? `The user weighs ${weight} ${unit}.` : "Assume the user weighs about 155 lb."} Use MET-based estimates; be conservative, since people overestimate. Casual commuting cycling ~30-40 kcal/mile, walking ~80-90 kcal/mile, drumming ~3-4 MET. If the user states calories burned, use that number exactly. Return ONLY JSON matching the schema; keep item names short.`;
const EX_SCHEMA = {
  type: "object",
  properties: {
    items: { type: "array", items: { type: "object", properties: { name: { type: "string" }, calories: { type: "number" } }, required: ["name", "calories"] } },
    note: { type: "string" },
  },
  required: ["items"],
};

// Pull the JSON object out of whatever shape the AI binding returns.
export function parseAiJson(res) {
  let c = res?.choices?.[0]?.message?.content ?? res?.response ?? res;
  if (c && typeof c === "object" && !Array.isArray(c) && c.items) return c;
  if (typeof c !== "string") throw new Error("empty AI response");
  c = c.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "");
  const start = c.indexOf("{"), end = c.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("AI response had no JSON");
  return JSON.parse(c.slice(start, end + 1));
}

export function summarize(parsed, withProtein) {
  const items = (Array.isArray(parsed.items) ? parsed.items : [])
    .map((i) => ({ name: String(i.name || "item").slice(0, 60), calories: Math.max(0, Math.round(Number(i.calories) || 0)), ...(withProtein ? { protein_g: Math.max(0, Math.round(Number(i.protein_g) || 0)) } : {}) }))
    .filter((i) => i.calories > 0 || i.name);
  const calories = items.reduce((s, i) => s + i.calories, 0); // add it up ourselves; don't trust model math
  const out = { items, calories };
  if (withProtein) out.protein_g = items.reduce((s, i) => s + (i.protein_g || 0), 0);
  if (parsed.note) out.note = String(parsed.note).slice(0, 200);
  return out;
}

// Mifflin-St Jeor BMR x activity factor (activity = daily life, NOT logged workouts)
const ACTIVITY = { "1.2": 1, "1.375": 1, "1.55": 1, "1.725": 1 };
export function maintenance(s, latest) {
  const age = s.birth_year ? new Date().getFullYear() - Number(s.birth_year) : null;
  const cm = Number(s.height_cm), act = Number(s.activity);
  if (!latest || !age || !cm || !act || (s.sex !== "m" && s.sex !== "f")) return null;
  const kg = s.unit === "kg" ? latest.weight : latest.weight * 0.45359237;
  const bmr = 10 * kg + 6.25 * cm - 5 * age + (s.sex === "m" ? 5 : -161);
  return { bmr: Math.round(bmr), tdee: Math.round(bmr * act), age, weight: latest.weight, weight_day: latest.day };
}

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
const bad = (msg, status = 400) => json({ error: msg }, status);

// ---- Cloudflare Access login (MFA is enforced there) ----
// Access sits in front of this Worker and passes a signed JWT in Cf-Access-Jwt-Assertion.
// We re-verify it here (signature, issuer, audience, expiry, email) so the API stays closed
// even if a request ever reaches the Worker some other way.
const ACCESS_TEAM = "https://silent-field-4a1d.cloudflareaccess.com";
const ACCESS_AUD = "d4096196d405049c9a1f2f7f67aaf09adf45f0ed39de4c79526f6e38c236f8ec";
const ACCESS_EMAIL = "tu.john9k9@gmail.com";
const b64u = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
export async function accessEmail(request, now = Date.now()) {
  const jwt = request.headers.get("cf-access-jwt-assertion");
  const [h, p, sig] = (jwt || "").split(".");
  if (!sig) return null;
  try {
    const dec = (x) => JSON.parse(new TextDecoder().decode(b64u(x)));
    const head = dec(h), c = dec(p);
    if (head.alg !== "RS256" || c.iss !== ACCESS_TEAM) return null;
    if (![].concat(c.aud).includes(ACCESS_AUD)) return null;
    if (!c.exp || c.exp * 1000 < now) return null;
    const certs = await (await fetch(ACCESS_TEAM + "/cdn-cgi/access/certs", { cf: { cacheTtl: 3600, cacheEverything: true } })).json();
    const jwk = certs.keys.find((k) => k.kid === head.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64u(sig), new TextEncoder().encode(h + "." + p));
    return ok && c.email === ACCESS_EMAIL ? c.email : null;
  } catch {
    return null;
  }
}

async function authorized(request, env) {
  if (await accessEmail(request)) return true;
  // Fallback for local dev / emergencies: the old bearer token. Delete the API_TOKEN secret to retire it.
  if (!env.API_TOKEN) return false; // fail closed when no token is set
  const h = request.headers.get("authorization") || "";
  return h === `Bearer ${env.API_TOKEN}`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // installable-app files (public, no token needed)
    if (method === "GET" || method === "HEAD") {
      const size = { "/icon-512.png": 512, "/apple-touch-icon.png": 180 }[path];
      const day = { "cache-control": "public, max-age=86400" };
      if (size) return new Response(await makeIcon(size), { headers: { "content-type": "image/png", ...day } });
      if (path === "/manifest.webmanifest") return new Response(JSON.stringify(MANIFEST), { headers: { "content-type": "application/manifest+json", ...day } });
      if (path === "/sw.js") return new Response(SW, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-cache" } });
    }

    if (!path.startsWith("/api/")) {
      return new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    if (!(await authorized(request, env))) return bad("unauthorized", 401);

    try {
      // ---- one day: meals + weight ----
      if (path === "/api/day" && method === "GET") {
        const d = url.searchParams.get("d");
        if (!DAY_RE.test(d || "")) return bad("bad date");
        const [meals, weight, ex] = await env.DB.batch([
          env.DB.prepare("SELECT id, name, calories FROM meals WHERE day = ? ORDER BY id").bind(d),
          env.DB.prepare("SELECT weight FROM weights WHERE day = ?").bind(d),
          env.DB.prepare("SELECT id, name, calories FROM exercises WHERE day = ? ORDER BY id").bind(d),
        ]);
        return json({ day: d, meals: meals.results, exercises: ex.results, weight: weight.results[0]?.weight ?? null });
      }

      // ---- AI estimate (suggestion only; nothing is saved) ----
      if (path === "/api/estimate" && method === "POST") {
        if (!env.AI) return bad("AI is not set up on this Worker", 503);
        const { kind, text } = await request.json();
        const t = String(text || "").trim().slice(0, MAX_TEXT);
        if (!t) return bad("describe what you ate or did");
        if (kind !== "food" && kind !== "exercise") return bad("kind must be food or exercise");
        let system = FOOD_PROMPT, schema = FOOD_SCHEMA;
        if (kind === "exercise") {
          const [w, u] = await env.DB.batch([
            env.DB.prepare("SELECT weight FROM weights ORDER BY day DESC LIMIT 1"),
            env.DB.prepare("SELECT value FROM settings WHERE key = 'unit'"),
          ]);
          system = exercisePrompt(w.results[0]?.weight, u.results[0]?.value || "lb");
          schema = EX_SCHEMA;
        }
        let res;
        try {
          res = await env.AI.run(AI_MODEL, {
            messages: [{ role: "system", content: system }, { role: "user", content: t }],
            response_format: { type: "json_schema", json_schema: schema },
            max_tokens: 4000, // room for long multi-item entries plus a little reasoning
            temperature: 0.2,
            reasoning_effort: "low",
          });
        } catch (e) {
          return bad("AI estimate failed: " + e.message, 502);
        }
        try {
          return json(summarize(parseAiJson(res), kind === "food"));
        } catch (e) {
          return bad("Couldn't read the AI estimate, try rewording", 502);
        }
      }

      // ---- exercise ----
      if (path === "/api/exercises" && method === "POST") {
        const { day, name, calories } = await request.json();
        const cal = Math.round(Number(calories));
        if (!DAY_RE.test(day || "") || !String(name || "").trim() || !Number.isFinite(cal) || cal < 0 || cal > 10000)
          return bad("need day, activity, calories");
        const r = await env.DB.prepare("INSERT INTO exercises (day, name, calories) VALUES (?, ?, ?) RETURNING id")
          .bind(day, String(name).trim().slice(0, MAX_TEXT), cal).first();
        return json({ id: r.id }, 201);
      }
      const exMatch = path.match(/^\/api\/exercises\/(\d+)$/);
      if (exMatch && method === "PATCH") {
        const { calories } = await request.json();
        const cal = Math.round(Number(calories));
        if (!Number.isFinite(cal) || cal < 0 || cal > 10000) return bad("calories out of range");
        const r = await env.DB.prepare("UPDATE exercises SET calories = ? WHERE id = ?").bind(cal, Number(exMatch[1])).run();
        if (!r.meta.changes) return bad("entry not found", 404);
        return json({ ok: true });
      }
      if (exMatch && method === "DELETE") {
        await env.DB.prepare("DELETE FROM exercises WHERE id = ?").bind(Number(exMatch[1])).run();
        return json({ ok: true });
      }

      // ---- meals ----
      if (path === "/api/meals" && method === "POST") {
        const { day, name, calories } = await request.json();
        const cal = Math.round(Number(calories));
        if (!DAY_RE.test(day || "") || !String(name || "").trim() || !Number.isFinite(cal) || cal < 0 || cal > 20000)
          return bad("need day, name, calories");
        const r = await env.DB.prepare("INSERT INTO meals (day, name, calories) VALUES (?, ?, ?) RETURNING id")
          .bind(day, String(name).trim().slice(0, MAX_TEXT), cal).first();
        return json({ id: r.id }, 201);
      }
      const mealMatch = path.match(/^\/api\/meals\/(\d+)$/);
      if (mealMatch && method === "PATCH") {
        const { calories } = await request.json();
        const cal = Math.round(Number(calories));
        if (!Number.isFinite(cal) || cal < 0 || cal > 20000) return bad("calories out of range");
        const r = await env.DB.prepare("UPDATE meals SET calories = ? WHERE id = ?").bind(cal, Number(mealMatch[1])).run();
        if (!r.meta.changes) return bad("entry not found", 404);
        return json({ ok: true });
      }
      if (mealMatch && method === "DELETE") {
        await env.DB.prepare("DELETE FROM meals WHERE id = ?").bind(Number(mealMatch[1])).run();
        return json({ ok: true });
      }

      // ---- weight ----
      if (path === "/api/weight" && method === "PUT") {
        const { day, weight } = await request.json();
        const w = Number(weight);
        if (!DAY_RE.test(day || "") || !Number.isFinite(w) || w <= 0 || w > 2000) return bad("need day, weight");
        await env.DB.prepare(
          "INSERT INTO weights (day, weight) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET weight = excluded.weight"
        ).bind(day, Math.round(w * 10) / 10).run();
        return json({ ok: true });
      }
      if (path === "/api/weight" && method === "DELETE") {
        const d = url.searchParams.get("d");
        if (!DAY_RE.test(d || "")) return bad("bad date");
        await env.DB.prepare("DELETE FROM weights WHERE day = ?").bind(d).run();
        return json({ ok: true });
      }

      // ---- history for charts ----
      if (path === "/api/history" && method === "GET") {
        const from = url.searchParams.get("from");
        if (!DAY_RE.test(from || "")) return bad("bad from date");
        const [cals, weights, ex] = await env.DB.batch([
          env.DB.prepare("SELECT day, SUM(calories) AS total FROM meals WHERE day >= ? GROUP BY day ORDER BY day").bind(from),
          env.DB.prepare("SELECT day, weight FROM weights WHERE day >= ? ORDER BY day").bind(from),
          env.DB.prepare("SELECT day, SUM(calories) AS total FROM exercises WHERE day >= ? GROUP BY day ORDER BY day").bind(from),
        ]);
        return json({ calories: cals.results, weights: weights.results, exercise: ex.results });
      }

      // ---- settings ----
      if (path === "/api/settings" && method === "GET") {
        const [s, w] = await env.DB.batch([
          env.DB.prepare("SELECT key, value FROM settings"),
          env.DB.prepare("SELECT day, weight FROM weights ORDER BY day DESC LIMIT 1"),
        ]);
        const out = Object.fromEntries(s.results.map((r) => [r.key, r.value]));
        out.latest_weight = w.results[0] || null;
        const m = maintenance(out, w.results[0]);
        if (m) out.calc = m;
        // the one number everything else uses for "base daily burn"
        out.base_burn_effective = out.burn_mode === "auto" && m ? m.tdee : Number(out.base_burn) || 2100;
        return json(out);
      }
      if (path === "/api/settings" && method === "PUT") {
        const body = await request.json();
        const stmts = [];
        if (body.calorie_goal !== undefined) {
          const g = Math.round(Number(body.calorie_goal));
          if (!Number.isFinite(g) || g < 500 || g > 10000) return bad("goal out of range");
          stmts.push(env.DB.prepare("INSERT OR REPLACE INTO settings VALUES ('calorie_goal', ?)").bind(String(g)));
        }
        if (body.base_burn !== undefined) {
          const g = Math.round(Number(body.base_burn));
          if (!Number.isFinite(g) || g < 1000 || g > 6000) return bad("base burn out of range");
          stmts.push(env.DB.prepare("INSERT OR REPLACE INTO settings VALUES ('base_burn', ?)").bind(String(g)));
        }
        const set = (k, v) => stmts.push(env.DB.prepare("INSERT OR REPLACE INTO settings VALUES (?, ?)").bind(k, String(v)));
        if (body.sex !== undefined) {
          if (!["m", "f"].includes(body.sex)) return bad("sex must be m or f");
          set("sex", body.sex);
        }
        if (body.age !== undefined) {
          const a = Math.round(Number(body.age));
          if (!Number.isFinite(a) || a < 13 || a > 100) return bad("age out of range");
          set("birth_year", new Date().getFullYear() - a);
        }
        if (body.height_cm !== undefined) {
          const h = Math.round(Number(body.height_cm) * 10) / 10;
          if (!Number.isFinite(h) || h < 100 || h > 250) return bad("height out of range");
          set("height_cm", h);
        }
        if (body.activity !== undefined) {
          if (!ACTIVITY[String(body.activity)]) return bad("pick an activity level");
          set("activity", String(body.activity));
        }
        if (body.burn_mode !== undefined) {
          if (!["auto", "manual"].includes(body.burn_mode)) return bad("burn_mode must be auto or manual");
          set("burn_mode", body.burn_mode);
        }
        if (body.unit !== undefined) {
          if (!["lb", "kg"].includes(body.unit)) return bad("unit must be lb or kg");
          stmts.push(env.DB.prepare("INSERT OR REPLACE INTO settings VALUES ('unit', ?)").bind(body.unit));
        }
        if (stmts.length) await env.DB.batch(stmts);
        return json({ ok: true });
      }

      // ---- export everything ----
      if (path === "/api/export" && method === "GET") {
        const [meals, weights, ex] = await env.DB.batch([
          env.DB.prepare("SELECT day, name, calories, created_at FROM meals ORDER BY day, id"),
          env.DB.prepare("SELECT day, weight FROM weights ORDER BY day"),
          env.DB.prepare("SELECT day, name, calories, created_at FROM exercises ORDER BY day, id"),
        ]);
        return json({ meals: meals.results, weights: weights.results, exercises: ex.results });
      }

      return bad("not found", 404);
    } catch (e) {
      return bad("server error: " + e.message, 500);
    }
  },
};
