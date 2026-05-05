'use strict';

function runMigrations(db, logger) {

  // ── New tables ──────────────────────────────────────────────
  const tables = [
    {
      name: 'user_profiles',
      sql: `CREATE TABLE IF NOT EXISTS user_profiles (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id          INTEGER NOT NULL UNIQUE,
        full_name        TEXT,
        phone            TEXT,
        location         TEXT,
        linkedin         TEXT,
        desired_role     TEXT,
        desired_location TEXT,
        work_auth        TEXT,
        resume_text      TEXT,
        FOREIGN KEY(user_id) REFERENCES users(id)
      )`
    },
    {
      name: 'resume_profiles',
      sql: `CREATE TABLE IF NOT EXISTS resume_profiles (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id       INTEGER NOT NULL,
        role_label    TEXT,
        role_category TEXT,
        keywords      TEXT,
        resume_json   TEXT NOT NULL DEFAULT '{}',
        template      TEXT NOT NULL DEFAULT 'modern',
        created_at    INTEGER DEFAULT (strftime('%s', 'now')),
        FOREIGN KEY(user_id) REFERENCES users(id)
      )`
    },
    {
      name: 'writing_samples',
      sql: `CREATE TABLE IF NOT EXISTS writing_samples (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id         INTEGER NOT NULL,
        content         TEXT NOT NULL,
        source_filename TEXT,
        created_at      INTEGER DEFAULT (strftime('%s', 'now')),
        FOREIGN KEY(user_id) REFERENCES users(id)
      )`
    },
    {
      name: 'stripe_subscriptions',
      sql: `CREATE TABLE IF NOT EXISTS stripe_subscriptions (
        id                     INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id                INTEGER NOT NULL,
        stripe_customer_id     TEXT,
        stripe_subscription_id TEXT UNIQUE,
        status                 TEXT,
        current_period_end     INTEGER,
        created_at             INTEGER DEFAULT (strftime('%s', 'now')),
        FOREIGN KEY(user_id) REFERENCES users(id)
      )`
    },
    {
      name: 'stripe_webhook_events',
      sql: `CREATE TABLE IF NOT EXISTS stripe_webhook_events (
        stripe_event_id TEXT PRIMARY KEY,
        event_type      TEXT,
        processed_at    TEXT NOT NULL DEFAULT (datetime('now'))
      )`
    },
    {
      name: 'email_events',
      sql: `CREATE TABLE IF NOT EXISTS email_events (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id         INTEGER NOT NULL,
        job_id          INTEGER,
        raw_snippet     TEXT,
        detected_status TEXT,
        received_at     INTEGER DEFAULT (strftime('%s', 'now')),
        FOREIGN KEY(user_id) REFERENCES users(id)
      )`
    },
  ];

  tables.forEach(({ name, sql }) => {
    db.run(sql, (err) => {
      if (err) logger.error('migration:fail', err, { table: name });
      else     logger.log('migration:success', { table: name });
    });
  });

  // ── Jobs column additions (job_description, ats_keywords, matched_profile_id)
  // cover_letter_file already handled by ensureJobsTable()
  // user_profiles.resume_text — added after initial table creation
  db.all(`PRAGMA table_info(user_profiles)`, [], (err, cols) => {
    if (err || !cols) return;
    if (!cols.find(c => c.name === 'resume_text')) {
      db.run(`ALTER TABLE user_profiles ADD COLUMN resume_text TEXT`, (e) => {
        if (e) logger.error('migration:fail', e, { table: 'user_profiles', column: 'resume_text' });
        else   logger.log('migration:success', { table: 'user_profiles', column: 'resume_text' });
      });
    }
  });

  const jobAdditions = [
    { name: 'job_description',    type: 'TEXT' },
    { name: 'ats_keywords',       type: 'TEXT' },
    { name: 'matched_profile_id', type: 'INTEGER' },
  ];

  db.all(`PRAGMA table_info(jobs)`, [], (err, columns) => {
    if (err || !columns) return;
    const existing = columns.map(c => c.name);
    jobAdditions.forEach(col => {
      if (!existing.includes(col.name)) {
        db.run(`ALTER TABLE jobs ADD COLUMN ${col.name} ${col.type}`, (alterErr) => {
          if (alterErr) logger.error('migration:fail', alterErr, { table: 'jobs', column: col.name });
          else          logger.log('migration:success', { table: 'jobs', column: col.name });
        });
      }
    });
  });

  // ── stripe_webhook_events — add event_type if missing ───────
  db.all(`PRAGMA table_info(stripe_webhook_events)`, [], (err, cols) => {
    if (err || !cols) return;
    if (!cols.find(c => c.name === 'event_type')) {
      db.run(`ALTER TABLE stripe_webhook_events ADD COLUMN event_type TEXT`, (e) => {
        if (e) logger.error('migration:fail', e, { table: 'stripe_webhook_events', column: 'event_type' });
      });
    }
  });

  // ── Indexes ─────────────────────────────────────────────────
  // stripe_webhook_events.stripe_event_id is already indexed as PRIMARY KEY
  const indexes = [
    `CREATE INDEX IF NOT EXISTS idx_users_api_key           ON users(api_key)`,
    `CREATE INDEX IF NOT EXISTS idx_jobs_user_id            ON jobs(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_resume_profiles_user_id ON resume_profiles(user_id)`,
  ];

  indexes.forEach(sql => {
    db.run(sql, (err) => {
      if (err) logger.error('migration:fail', err);
    });
  });
}

module.exports = { runMigrations };
