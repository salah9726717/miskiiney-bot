
const { Pool } = require("pg");
const config = require("./config");

const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl:
    process.env.PGSSLMODE === "disable"
      ? false
      : { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      telegram_id BIGINT PRIMARY KEY,
      username TEXT,
      first_name TEXT,
      last_name TEXT,
      language_code TEXT,
      first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      is_blocked BOOLEAN NOT NULL DEFAULT FALSE
    );

    CREATE TABLE IF NOT EXISTS content (
      id BIGSERIAL PRIMARY KEY,
      category TEXT NOT NULL
        CHECK (category IN ('films','series','books','curriculum')),
      title TEXT NOT NULL,
      normalized_title TEXT NOT NULL,
      description TEXT DEFAULT '',
      year TEXT DEFAULT '',
      grade TEXT DEFAULT '',
      subject TEXT DEFAULT '',
      channel_id BIGINT NOT NULL,
      channel_message_id BIGINT,
      file_id TEXT,
      file_unique_id TEXT,
      media_type TEXT NOT NULL DEFAULT 'unknown',
      source TEXT NOT NULL DEFAULT 'admin',
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by BIGINT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(channel_id, channel_message_id)
    );

    ALTER TABLE content
      ADD COLUMN IF NOT EXISTS season_number INTEGER;

    ALTER TABLE content
      ADD COLUMN IF NOT EXISTS part_number INTEGER;

    CREATE INDEX IF NOT EXISTS content_title_idx
      ON content USING GIN (
        to_tsvector(
          'simple',
          title || ' ' ||
          COALESCE(description, '') || ' ' ||
          COALESCE(grade, '') || ' ' ||
          COALESCE(subject, '')
        )
      );

    CREATE INDEX IF NOT EXISTS content_category_idx
      ON content(category, active);

    CREATE INDEX IF NOT EXISTS content_normalized_idx
      ON content(normalized_title);

    CREATE INDEX IF NOT EXISTS content_series_parts_idx
      ON content(normalized_title, season_number, part_number)
      WHERE category = 'series' AND active = TRUE;

    CREATE TABLE IF NOT EXISTS admin_sessions (
      telegram_id BIGINT PRIMARY KEY,
      state TEXT NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS bot_events (
      id BIGSERIAL PRIMARY KEY,
      event_type TEXT NOT NULL,
      success BOOLEAN NOT NULL DEFAULT TRUE,
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS users_last_seen_idx
      ON users(last_seen_at DESC);
  `);

  console.log("PostgreSQL schema ready.");
}

async function trackUser(user) {
  if (!user?.id) return;

  await pool.query(
    `
    INSERT INTO users (
      telegram_id, username, first_name, last_name, language_code
    )
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (telegram_id) DO UPDATE SET
      username = EXCLUDED.username,
      first_name = EXCLUDED.first_name,
      last_name = EXCLUDED.last_name,
      language_code = EXCLUDED.language_code,
      last_seen_at = NOW(),
      is_blocked = FALSE
    `,
    [
      String(user.id),
      user.username || null,
      user.first_name || null,
      user.last_name || null,
      user.language_code || null
    ]
  );
}

async function saveSession(id, state, payload = {}) {
  await pool.query(
    `
    INSERT INTO admin_sessions (
      telegram_id, state, payload, updated_at
    )
    VALUES ($1, $2, $3, NOW())
    ON CONFLICT (telegram_id) DO UPDATE SET
      state = EXCLUDED.state,
      payload = EXCLUDED.payload,
      updated_at = NOW()
    `,
    [String(id), state, JSON.stringify(payload)]
  );
}

async function getSession(id) {
  const result = await pool.query(
    "SELECT state, payload FROM admin_sessions WHERE telegram_id = $1",
    [String(id)]
  );

  return result.rows[0] || null;
}

async function clearSession(id) {
  await pool.query(
    "DELETE FROM admin_sessions WHERE telegram_id = $1",
    [String(id)]
  );
}

async function logEvent(eventType, success = true, details = {}) {
  try {
    await pool.query(
      `
      INSERT INTO bot_events(event_type, success, details)
      VALUES ($1, $2, $3)
      `,
      [eventType, success, JSON.stringify(details)]
    );
  } catch (error) {
    console.error("Could not log event:", error.message);
  }
}

module.exports = {
  pool,
  initDb,
  trackUser,
  saveSession,
  getSession,
  clearSession,
  logEvent
};
