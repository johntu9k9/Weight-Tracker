-- Already applied to the calorie-tracker D1 database. Kept here for reference / re-creation:
--   npx wrangler d1 execute calorie-tracker --remote --file=schema.sql
CREATE TABLE IF NOT EXISTS meals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day TEXT NOT NULL,            -- YYYY-MM-DD (your local date)
  name TEXT NOT NULL,
  calories INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_meals_day ON meals(day);

CREATE TABLE IF NOT EXISTS weights (
  day TEXT PRIMARY KEY,
  weight REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT OR IGNORE INTO settings (key, value) VALUES ('calorie_goal', '2000'), ('unit', 'lb');

-- v2: exercise log + base daily burn for deficit math
CREATE TABLE IF NOT EXISTS exercises (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day TEXT NOT NULL,
  name TEXT NOT NULL,
  calories INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ex_day ON exercises(day);
INSERT OR IGNORE INTO settings (key, value) VALUES ('base_burn', '2100');
