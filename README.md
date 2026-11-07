# Calorie Tracker (Cloudflare Workers + D1 + Workers AI)

A single Cloudflare Worker serves the tracker page and a small JSON API.

- **Data:** D1 database `calorie-tracker` (id `471ce920-98c5-45bb-8e9c-3fd8e9080a12`)
- **AI estimates:** Workers AI, model `@cf/deepseek-ai/deepseek-v4.1-flash-1017`
- **Live:** https://calorie-tracker.tu-john9k9.workers.dev

## Features
- Food log: free-text entries (up to 4,000 chars) with ✨ AI calorie + protein estimates
- Exercise log with AI burn estimates (uses your latest weight)
- Tap any calorie number to edit it; ✕ deletes
- Maintenance calculator (Mifflin-St Jeor × activity) using your latest weigh-in;
  optionally used as the base daily burn
- Daily deficit/surplus = base burn + exercise − food
- Weekly deficit: "This week" (Mon–Sun) and "4 weeks"; weeks with fewer than
  6 of 7 days logged are greyed out and excluded
- Trends: calories, deficit and weight over 2w / 30d / 90d
- Export everything as JSON

## Layout
| File | What |
|---|---|
| `src/index.js` | Worker: routes, AI prompts/schemas, maintenance math |
| `src/index.html` | The whole front end (imported as text) |
| `schema.sql` | D1 tables: `meals`, `exercises`, `weights`, `settings` |
| `wrangler.toml` | D1 + AI bindings |

## Deploy
```bash
npm install
npx wrangler login
npx wrangler deploy
```
## Auth
The Worker sits behind **Cloudflare Access** (MFA enforced org-wide). Access passes a signed JWT in
`Cf-Access-Jwt-Assertion`; the Worker re-verifies it (RS256 signature against the team's certs, issuer,
audience, expiry, and email) before serving any `/api/*` call, so there is no separate password.
The team domain, app AUD and allowed email are constants at the top of the auth block in `src/index.js`.

The old `API_TOKEN` bearer token still works as a fallback (local dev, emergencies). It is only
accepted if the secret exists; retire it with `npx wrangler secret delete API_TOKEN`.
The API fails closed: with no valid Access JWT and no token, every `/api/*` call returns 401.

## Local development
```bash
npx wrangler d1 execute calorie-tracker --local --file=schema.sql
npx wrangler dev --local --var API_TOKEN:dev
```

## API (all require an Access login, or `Authorization: Bearer <API_TOKEN>` as fallback)
| Method | Path | Body / query |
|---|---|---|
| GET | `/api/day?d=YYYY-MM-DD` | meals, exercises, weight for a day |
| POST | `/api/estimate` | `{kind: "food"\|"exercise", text}` (nothing saved) |
| POST | `/api/meals` · `/api/exercises` | `{day, name, calories}` |
| PATCH | `/api/meals/:id` · `/api/exercises/:id` | `{calories}` |
| DELETE | `/api/meals/:id` · `/api/exercises/:id` | — |
| PUT | `/api/weight` | `{day, weight}` |
| DELETE | `/api/weight?d=YYYY-MM-DD` | — |
| GET | `/api/history?from=YYYY-MM-DD` | daily totals + weights |
| GET / PUT | `/api/settings` | goal, base burn, unit, profile, burn mode |
| GET | `/api/export` | everything |
