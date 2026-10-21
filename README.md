# Calorie Tracker (Cloudflare Workers + D1 + Workers AI)

A single Cloudflare Worker serves the tracker page and a small JSON API.

- **Data:** D1 database `calorie-tracker` (id `471ce920-98c5-45bb-8e9c-3fd8e9080a12`)
- **AI estimates:** Workers AI, model `@cf/zai-org/glm-5.3-flash`
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
npx wrangler secret put API_TOKEN   # only needed once; it's already set on the live Worker
npx wrangler deploy
```
The API fails closed: without `API_TOKEN` set, every `/api/*` call returns 401.
The page asks for the token once and keeps it in that browser.

## Local development
```bash
npx wrangler d1 execute calorie-tracker --local --file=schema.sql
npx wrangler dev --local --var API_TOKEN:dev
```

## API (all require `Authorization: Bearer <API_TOKEN>`)
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
