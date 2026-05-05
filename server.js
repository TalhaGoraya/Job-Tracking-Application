require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const crypto = require('crypto');
const fileService              = require('./services/fileService');
const logger                   = require('./services/logger');
const { runMigrations }        = require('./services/dbMigrations');
const { validateUpload, sanitizeForAI, limiters } = require('./services/security');
const resumeParser = require('./services/resumeParser');
const aiService    = require('./services/aiService');
const stripeService = require('./services/stripeService');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
const dbPath = path.join(__dirname, 'jobs.db');
const uploadRoot = path.join(__dirname, 'uploads');

if (!fs.existsSync(uploadRoot)) {
  fs.mkdirSync(uploadRoot, { recursive: true });
}

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) logger.error('db:connect', err);
  else     logger.log('db:connected', { file: path.basename(dbPath) });
});
const STATUSES = ['Applied', 'Interview', 'Offer', 'Rejected'];

function hashPassword(password) {
  return crypto.createHash('sha256').update(password || '').digest('hex');
}

function generateApiKey() {
  return crypto.randomBytes(24).toString('hex');
}

function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const userFolder = path.join(uploadRoot, String(req.user.id));
    if (!fs.existsSync(userFolder)) {
      fs.mkdirSync(userFolder, { recursive: true });
    }
    cb(null, userFolder);
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const safeName = sanitizeFilename(file.originalname);
    cb(null, `${timestamp}-${safeName}`);
  }
});

const upload = multer({ storage });
const uploadMemory = multer({ storage: multer.memoryStorage() });

// Stripe webhook needs raw body — must be registered before express.json()
app.use('/api/billing/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api/auth',    limiters.auth);
app.use('/api/login',   limiters.auth);
app.use('/api/register',limiters.auth);
app.use('/api/ai',      limiters.ai);
app.use('/api/upload',  limiters.upload);
app.use('/api/jobs/search', limiters.jobSearch);
app.use('/api',         limiters.api);

function runSql(sql) {
  db.run(sql, err => {
    if (err) logger.error('migration:fail', err);
  });
}

function ensureUsersTable() {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      email TEXT,
      password_hash TEXT NOT NULL,
      api_key TEXT NOT NULL UNIQUE,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `, () => {
    const additions = [
      { name: 'email',                 type: 'TEXT' },
      { name: 'onboarding_step',       type: 'INTEGER DEFAULT 0' },
      { name: 'suggested_roles_cache', type: 'TEXT' },
      { name: 'trial_ends_at',         type: 'INTEGER' },
      { name: 'subscription_status',   type: "TEXT DEFAULT 'trial'" },
      { name: 'stripe_customer_id',    type: 'TEXT' },
      { name: 'gmail_connected',       type: 'INTEGER DEFAULT 0' },
      { name: 'outlook_connected',     type: 'INTEGER DEFAULT 0' }
    ];

    db.all(`PRAGMA table_info(users)`, [], (err, columns) => {
      if (err || !columns) return;
      const existing = columns.map(col => col.name);
      additions.forEach(col => {
        if (!existing.includes(col.name)) {
          runSql(`ALTER TABLE users ADD COLUMN ${col.name} ${col.type}`);
        }
      });
    });
  });
}

function ensureJobsTable() {
  db.run(`
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      company TEXT NOT NULL,
      role TEXT NOT NULL,
      location TEXT,
      status TEXT NOT NULL DEFAULT 'Applied',
      notes TEXT,
      email TEXT,
      email_sent BOOLEAN DEFAULT 0,
      followup_1_date TEXT,
      followup_2_date TEXT,
      resume_file TEXT,
      cover_letter_file TEXT,
      source TEXT,
      salary TEXT,
      company_rating TEXT,
      posted_date TEXT,
      applied_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);

  const additions = [
    { name: 'user_id', type: 'INTEGER' },
    { name: 'source', type: 'TEXT' },
    { name: 'salary', type: 'TEXT' },
    { name: 'company_rating', type: 'TEXT' },
    { name: 'posted_date', type: 'TEXT' },
    { name: 'updated_at', type: 'TEXT' },
    { name: 'email', type: 'TEXT' },
    { name: 'email_sent', type: 'BOOLEAN DEFAULT 0' },
    { name: 'followup_1_date', type: 'TEXT' },
    { name: 'followup_2_date', type: 'TEXT' },
    { name: 'resume_file', type: 'TEXT' },
    { name: 'cover_letter_file', type: 'TEXT' }
  ];

  db.all(`PRAGMA table_info(jobs)`, [], (err, columns) => {
    if (err || !columns) return;
    const existing = columns.map(col => col.name);
    additions.forEach(column => {
      if (!existing.includes(column.name)) {
        runSql(`ALTER TABLE jobs ADD COLUMN ${column.name} ${column.type}`);
      }
    });
  });
}

ensureUsersTable();
ensureJobsTable();
runMigrations(db, logger);

function authenticate(req, res, next) {
  const token = req.headers['x-user-token'] || req.query.token;
  if (!token) {
    return res.status(401).json({ error: 'Missing authentication token.' });
  }

  db.get(`SELECT id, username, api_key FROM users WHERE api_key = ?`, [token], (err, user) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!user) {
      return res.status(401).json({ error: 'Invalid token.' });
    }
    req.user = user;
    next();
  });
}

app.post('/api/register', (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) {
    return res.status(400).json({ error: 'Username, email, and password are required.' });
  }

  const normalized = username.trim().toLowerCase();
  const normalizedEmail = email.trim().toLowerCase();
  const passwordHash = hashPassword(password);
  const apiKey = generateApiKey();

  db.get(`SELECT id FROM users WHERE username = ?`, [normalized], (err, existing) => {
    if (err) { logger.error('auth:register', err, { username: normalized }); return res.status(500).json({ error: err.message }); }
    if (existing) return res.status(400).json({ error: 'That username is already taken. Please choose another.' });

    db.get(`SELECT id FROM users WHERE email = ?`, [normalizedEmail], (err2, existingEmail) => {
      if (err2) { logger.error('auth:register', err2, { username: normalized }); return res.status(500).json({ error: err2.message }); }
      if (existingEmail) return res.status(400).json({ error: 'An account with that email already exists. Try signing in instead.' });

      const trialEndsAt = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60; // 30 days from now
      db.run(
        `INSERT INTO users (username, email, password_hash, api_key, trial_ends_at, subscription_status)
         VALUES (?, ?, ?, ?, ?, 'trial')`,
        [normalized, normalizedEmail, passwordHash, apiKey, trialEndsAt],
        function (err3) {
          if (err3) { logger.error('auth:register', err3, { username: normalized }); return res.status(500).json({ error: err3.message }); }
          logger.log('auth:register', { username: normalized });
          res.json({ id: this.lastID, username: normalized, email: normalizedEmail, api_key: apiKey });
        }
      );
    });
  });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  const normalized = username.trim().toLowerCase();
  const passwordHash = hashPassword(password);

  db.get(
    `SELECT id, username, email, api_key, subscription_status FROM users WHERE username = ? AND password_hash = ?`,
    [normalized, passwordHash],
    (err, user) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (!user) {
        logger.error('auth:login', null, { reason: 'invalid_credentials', username: normalized });
        return res.status(401).json({ error: 'Invalid username or password.' });
      }
      res.json({ id: user.id, username: user.username, email: user.email, api_key: user.api_key, subscription_status: user.subscription_status });
    }
  );
});

app.get('/api/profile', authenticate, (req, res) => {
  res.json({ id: req.user.id, username: req.user.username, api_key: req.user.api_key });
});

app.get('/api/me', authenticate, (req, res) => {
  db.get(
    `SELECT id, username, email, subscription_status, onboarding_step, trial_ends_at, gmail_connected, outlook_connected FROM users WHERE id = ?`,
    [req.user.id],
    (err, user) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!user) return res.status(404).json({ error: 'User not found.' });
      res.json(user);
    }
  );
});

app.get('/api/health', (req, res) => {
  db.all(
    `SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ status: 'error', error: err.message });
      res.json({ status: 'ok', tables: rows.map(r => r.name) });
    }
  );
});

// ── User Profile ─────────────────────────────────────────────
app.get('/api/profile/info', authenticate, (req, res) => {
  db.get(`SELECT * FROM user_profiles WHERE user_id = ?`, [req.user.id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(row || {});
  });
});

app.put('/api/profile/info', authenticate, (req, res) => {
  const { full_name, phone, location, linkedin, desired_role, desired_location, work_auth } = req.body;
  db.run(
    `INSERT INTO user_profiles (user_id, full_name, phone, location, linkedin, desired_role, desired_location, work_auth)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       full_name = excluded.full_name, phone = excluded.phone, location = excluded.location,
       linkedin = excluded.linkedin, desired_role = excluded.desired_role,
       desired_location = excluded.desired_location, work_auth = excluded.work_auth`,
    [req.user.id, full_name || null, phone || null, location || null,
     linkedin || null, desired_role || null, desired_location || null, work_auth || null],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ saved: true });
    }
  );
});

app.post('/api/profile/resume', authenticate, uploadMemory.single('resume'), async (req, res) => {
  let resumeText = '';

  if (req.file) {
    const check = validateUpload(req.file.buffer, req.file.mimetype);
    if (!check.valid) return res.status(400).json({ error: check.error });
    try {
      resumeText = await resumeParser.parse(req.file.buffer, req.file.mimetype);
    } catch (err) {
      return res.status(422).json({ error: err.message });
    }
  } else if (req.body?.resume_text) {
    resumeText = sanitizeForAI(req.body.resume_text);
  } else {
    return res.status(400).json({ error: 'Provide a resume file or paste resume text.' });
  }

  const assessment = resumeParser.assess(resumeText);
  if (!assessment.ok) return res.status(422).json({ error: assessment.reason });

  db.run(
    `INSERT INTO user_profiles (user_id, resume_text) VALUES (?, ?)
     ON CONFLICT(user_id) DO UPDATE SET resume_text = excluded.resume_text`,
    [req.user.id, resumeText],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ saved: true, chars: resumeText.length, warning: assessment.warning || null });
    }
  );
});

app.get('/api/profile/resume-text', authenticate, (req, res) => {
  db.get(`SELECT resume_text FROM user_profiles WHERE user_id = ?`, [req.user.id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ resume_text: row?.resume_text || null });
  });
});

app.get('/api/jobs', authenticate, (req, res) => {
  db.all(`SELECT * FROM jobs WHERE user_id = ? ORDER BY applied_at DESC`, [req.user.id], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows || []);
  });
});

app.get('/api/summary', authenticate, (req, res) => {
  db.all(
    `SELECT status, COUNT(*) AS count FROM jobs WHERE user_id = ? GROUP BY status`,
    [req.user.id],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      const summary = STATUSES.reduce((acc, status) => {
        acc[status] = 0;
        return acc;
      }, {});
      rows.forEach(row => {
        summary[row.status] = row.count;
      });
      res.json(summary);
    }
  );
});

app.post(
  '/api/jobs',
  authenticate,
  upload.fields([
    { name: 'resume', maxCount: 1 },
    { name: 'coverLetter', maxCount: 1 }
  ]),
  (req, res) => {
    const {
      company,
      role,
      location,
      status,
      notes,
      email,
      email_sent,
      followup_1_date,
      followup_2_date
    } = req.body;

    if (!company || !role) {
      return res.status(400).json({ error: 'Company and role are required.' });
    }

    const finalStatus = STATUSES.includes(status) ? status : 'Applied';
    const parsedEmailSent = email_sent === '1' || email_sent === 'true' || email_sent === 'on';
    const resumeFile = req.files?.resume?.[0]?.filename || null;
    const coverLetterFile = req.files?.coverLetter?.[0]?.filename || null;

    const sql = `INSERT INTO jobs
      (user_id, company, role, location, status, notes, email, email_sent, followup_1_date, followup_2_date, resume_file, cover_letter_file, source, salary, company_rating, posted_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    db.run(
      sql,
      [
        req.user.id,
        company.trim(),
        role.trim(),
        location || '',
        finalStatus,
        notes || '',
        email || '',
        parsedEmailSent ? 1 : 0,
        followup_1_date || null,
        followup_2_date || null,
        resumeFile,
        coverLetterFile,
        'Manual entry',
        '',
        '',
        null
      ],
      function (err) {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        res.status(201).json({ id: this.lastID });
      }
    );
  }
);

app.put('/api/jobs/:id', authenticate, (req, res) => {
  const { id } = req.params;
  const { company, role, location, status, notes, email_sent, followup_1_date, followup_2_date } = req.body;
  const fields = [];
  const values = [];

  if (company !== undefined) {
    fields.push('company = ?');
    values.push(company);
  }
  if (role !== undefined) {
    fields.push('role = ?');
    values.push(role);
  }
  if (location !== undefined) {
    fields.push('location = ?');
    values.push(location);
  }
  if (status !== undefined && STATUSES.includes(status)) {
    fields.push('status = ?');
    values.push(status);
  }
  if (notes !== undefined) {
    fields.push('notes = ?');
    values.push(notes);
  }
  if (email_sent !== undefined) {
    fields.push('email_sent = ?');
    values.push(email_sent ? 1 : 0);
  }
  if (followup_1_date !== undefined) {
    fields.push('followup_1_date = ?');
    values.push(followup_1_date);
  }
  if (followup_2_date !== undefined) {
    fields.push('followup_2_date = ?');
    values.push(followup_2_date);
  }

  if (!fields.length) {
    return res.status(400).json({ error: 'No valid fields to update.' });
  }

  fields.push('updated_at = CURRENT_TIMESTAMP');
  values.push(req.user.id);
  values.push(id);

  const sql = `UPDATE jobs SET ${fields.join(', ')} WHERE user_id = ? AND id = ?`;
  db.run(sql, values, function (err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (this.changes === 0) {
      return res.status(404).json({ error: 'Job not found or access denied.' });
    }
    res.json({ updated: this.changes });
  });
});

app.delete('/api/jobs/:id', authenticate, (req, res) => {
  const { id } = req.params;
  db.run('DELETE FROM jobs WHERE user_id = ? AND id = ?', [req.user.id, id], function (err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (this.changes === 0) {
      return res.status(404).json({ error: 'Job not found or access denied.' });
    }
    res.json({ deleted: this.changes });
  });
});

app.post('/api/upload/test', authenticate, uploadMemory.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file provided.' });
  const check = validateUpload(req.file.buffer, req.file.mimetype);
  if (!check.valid) return res.status(400).json({ error: check.error });
  const safeName = sanitizeFilename(req.file.originalname);
  try {
    const key = await fileService.save(req.user.id, `test/${safeName}`, req.file.buffer, req.file.mimetype);
    logger.log('upload:test', { userId: req.user.id, key, size: req.file.size });
    res.json({ key });
  } catch (err) {
    logger.error('upload:test', err, { userId: req.user.id });
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/upload/test/:filename', authenticate, async (req, res) => {
  const safeName = sanitizeFilename(req.params.filename);
  try {
    await fileService.delete(req.user.id, `test/${safeName}`);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── AI Endpoints ─────────────────────────────────────────────
app.post('/api/ai/suggest-roles', authenticate, async (req, res) => {
  db.get(`SELECT resume_text FROM user_profiles WHERE user_id = ?`, [req.user.id], async (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row?.resume_text) return res.status(400).json({ error: 'Upload your resume first.' });
    db.get(`SELECT suggested_roles_cache FROM users WHERE id = ?`, [req.user.id], async (e2, u) => {
      if (u?.suggested_roles_cache) {
        try { return res.json({ roles: JSON.parse(u.suggested_roles_cache), cached: true }); } catch {}
      }
      try {
        const roles = await aiService.suggestRoles(row.resume_text);
        db.run(`UPDATE users SET suggested_roles_cache = ? WHERE id = ?`, [JSON.stringify(roles), req.user.id]);
        res.json({ roles });
      } catch (aiErr) {
        logger.error('ai:suggest-roles', aiErr, { userId: req.user.id });
        res.status(500).json({ error: aiErr.message });
      }
    });
  });
});

app.post('/api/ai/generate-profiles', authenticate, async (req, res) => {
  const roles = req.body?.roles;
  if (!Array.isArray(roles) || !roles.length || roles.length > 3) {
    return res.status(400).json({ error: 'Provide 1-3 roles.' });
  }
  db.get(`SELECT resume_text FROM user_profiles WHERE user_id = ?`, [req.user.id], async (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row?.resume_text) return res.status(400).json({ error: 'Upload your resume first.' });
    const results = await Promise.allSettled(
      roles.map(role => aiService.generateResumeProfile(row.resume_text, role))
    );
    const saved = [];
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === 'fulfilled') {
        const p = r.value;
        await new Promise(resolve => {
          db.run(
            `INSERT INTO resume_profiles (user_id, role_label, role_category, keywords, resume_json, template) VALUES (?, ?, ?, ?, ?, 'modern')`,
            [req.user.id, p.role_label, p.role_category, JSON.stringify(p.keywords || []), JSON.stringify(p)],
            function (dbErr) {
              if (!dbErr) saved.push({ id: this.lastID, role_label: p.role_label, role_category: p.role_category, keywords: JSON.stringify(p.keywords || []) });
              else logger.error('ai:save-profile', dbErr);
              resolve();
            }
          );
        });
      } else {
        logger.error('ai:generate-profile', new Error(results[i].reason?.message || 'failed'), { role: roles[i]?.title });
      }
    }
    if (!saved.length) return res.status(500).json({ error: 'All generations failed. Try again.' });
    res.json({ profiles: saved });
  });
});

app.get('/api/resume-profiles', authenticate, (req, res) => {
  db.all(
    `SELECT id, role_label, role_category, keywords, template, created_at FROM resume_profiles WHERE user_id = ? ORDER BY created_at DESC`,
    [req.user.id], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows || []);
    }
  );
});

app.get('/api/resume-profiles/:id', authenticate, (req, res) => {
  db.get(
    `SELECT * FROM resume_profiles WHERE id = ? AND user_id = ?`,
    [req.params.id, req.user.id], (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(404).json({ error: 'Profile not found.' });
      res.json(row);
    }
  );
});

// ── Writing Samples ──────────────────────────────────────────
app.post('/api/writing-samples', authenticate, (req, res) => {
  const content = sanitizeForAI(req.body?.content || '');
  const source  = (req.body?.source_filename || 'paste').slice(0, 200);
  if (content.length < 50) return res.status(400).json({ error: 'Sample too short (min 50 characters).' });
  db.run(
    `INSERT INTO writing_samples (user_id, content, source_filename) VALUES (?, ?, ?)`,
    [req.user.id, content, source],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.status(201).json({ id: this.lastID, chars: content.length });
    }
  );
});

app.post('/api/writing-samples/upload', authenticate, uploadMemory.single('sample'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file provided.' });
  const check = validateUpload(req.file.buffer, req.file.mimetype);
  if (!check.valid) return res.status(400).json({ error: check.error });
  try {
    const text = await resumeParser.parse(req.file.buffer, req.file.mimetype);
    const content = sanitizeForAI(text);
    db.run(
      `INSERT INTO writing_samples (user_id, content, source_filename) VALUES (?, ?, ?)`,
      [req.user.id, content, sanitizeFilename(req.file.originalname)],
      function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.status(201).json({ id: this.lastID, chars: content.length });
      }
    );
  } catch (err) {
    res.status(422).json({ error: err.message });
  }
});

app.get('/api/writing-samples', authenticate, (req, res) => {
  db.all(
    `SELECT id, source_filename, length(content) AS chars, created_at FROM writing_samples WHERE user_id = ? ORDER BY created_at DESC`,
    [req.user.id],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows || []);
    }
  );
});

app.delete('/api/writing-samples/:id', authenticate, (req, res) => {
  db.run(
    `DELETE FROM writing_samples WHERE id = ? AND user_id = ?`,
    [req.params.id, req.user.id],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0) return res.status(404).json({ error: 'Not found.' });
      res.json({ deleted: true });
    }
  );
});

// ── Job Search: The Muse API (free, no key) ──────────────────
const MUSE_CATEGORY_MAP = {
  software: 'Software Engineering', engineer: 'Software Engineering', developer: 'Software Engineering',
  coding: 'Software Engineering', programming: 'Software Engineering', devops: 'Software Engineering',
  frontend: 'Software Engineering', backend: 'Software Engineering', fullstack: 'Software Engineering',
  data: 'Data & Analytics', analytics: 'Data & Analytics', scientist: 'Data & Analytics',
  machine: 'Data & Analytics', ml: 'Data & Analytics', ai: 'Data & Analytics',
  design: 'Design & UX', ux: 'Design & UX', ui: 'Design & UX', graphic: 'Design & UX',
  product: 'Product', pm: 'Product', 'product manager': 'Product',
  marketing: 'Marketing & Communications', seo: 'Marketing & Communications', content: 'Marketing & Communications',
  sales: 'Sales & Business Development', business: 'Business & Strategy', strategy: 'Business & Strategy',
  finance: 'Finance', accounting: 'Finance', controller: 'Finance',
  hr: 'HR & Recruiting', recruiting: 'HR & Recruiting', talent: 'HR & Recruiting', people: 'HR & Recruiting',
  legal: 'Legal', counsel: 'Legal', compliance: 'Legal',
  operations: 'Operations', supply: 'Operations', logistics: 'Operations',
  management: 'Management & Leadership', director: 'Management & Leadership', vp: 'Management & Leadership',
  security: 'IT & Security', cyber: 'IT & Security', infosec: 'IT & Security',
  healthcare: 'Healthcare & Medicine', medical: 'Healthcare & Medicine', nurse: 'Healthcare & Medicine',
  education: 'Education', teacher: 'Education', teaching: 'Education',
  writing: 'Editorial', editor: 'Editorial', journalist: 'Editorial',
  customer: 'Customer Service', support: 'Customer Service', cx: 'Customer Service',
};

const MUSE_LOCATION_MAP = {
  toronto: 'Toronto, Ontario, Canada', vancouver: 'Vancouver, British Columbia, Canada',
  montreal: 'Montréal, Québec, Canada', calgary: 'Calgary, Alberta, Canada',
  ottawa: 'Ottawa, Ontario, Canada', edmonton: 'Edmonton, Alberta, Canada',
  winnipeg: 'Winnipeg, Manitoba, Canada', hamilton: 'Hamilton, Ontario, Canada',
  'new york': 'New York City, New York, United States', nyc: 'New York City, New York, United States',
  'san francisco': 'San Francisco, California, United States', sf: 'San Francisco, California, United States',
  'los angeles': 'Los Angeles, California, United States', la: 'Los Angeles, California, United States',
  chicago: 'Chicago, Illinois, United States', boston: 'Boston, Massachusetts, United States',
  seattle: 'Seattle, Washington, United States', austin: 'Austin, Texas, United States',
  denver: 'Denver, Colorado, United States', miami: 'Miami, Florida, United States',
  atlanta: 'Atlanta, Georgia, United States', dallas: 'Dallas, Texas, United States',
  remote: 'Flexible / Remote',
};

function resolveMuseCategory(role) {
  const lower = role.toLowerCase();
  for (const [key, cat] of Object.entries(MUSE_CATEGORY_MAP)) {
    if (lower.includes(key)) return cat;
  }
  return null;
}

function resolveMuseLocation(location) {
  const lower = location.toLowerCase();
  if (!lower || lower === 'canada' || lower === 'ca') return null; // no filter → gets all
  for (const [key, loc] of Object.entries(MUSE_LOCATION_MAP)) {
    if (lower.includes(key)) return loc;
  }
  if (lower.includes('us') || lower.includes('united states') || lower.includes('usa')) return null;
  return null;
}

function stripHtml(html) {
  return (html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
}

function museDaysAgo(dateStr) {
  if (!dateStr) return 'Recently';
  const days = Math.floor((Date.now() - new Date(dateStr)) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return '1 day ago';
  if (days < 7) return `${days} days ago`;
  if (days < 14) return '1 week ago';
  return `${Math.floor(days / 7)} weeks ago`;
}

async function fetchMuseJobs(role, location) {
  const category = resolveMuseCategory(role);
  const museLoc  = resolveMuseLocation(location);

  const params = new URLSearchParams({ page: '0', descending: 'true' });
  if (category) params.append('category', category);
  if (museLoc)  params.append('location', museLoc);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(`https://www.themuse.com/api/public/jobs?${params}`, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Pathly-JobTracker/1.0' },
    });
    clearTimeout(timer);
    if (!res.ok) return [];
    const data = await res.json();

    return (data.results || [])
      .filter(j => j.refs?.landing_page && j.name && j.company?.name)
      .map(j => ({
        id:           `muse-${j.id}`,
        title:        j.name,
        company:      j.company.name,
        location:     j.locations?.[0]?.name || 'Location not specified',
        description:  stripHtml(j.contents),
        url:          j.refs.landing_page,
        source:       'The Muse',
        category:     j.categories?.[0]?.name || '',
        level:        j.levels?.[0]?.name || '',
        salary:       '',
        company_rating: '',
        posted_date:  museDaysAgo(j.publication_date),
      }));
  } catch {
    clearTimeout(timer);
    return [];
  }
}

async function fetchRemotiveJobs(role) {
  const params = new URLSearchParams({ limit: '20' });
  if (role) params.set('search', role);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);

  try {
    const res = await fetch(`https://remotive.com/api/remote-jobs?${params}`, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Pathly-JobTracker/1.0' },
    });
    clearTimeout(timer);
    if (!res.ok) return [];
    const data = await res.json();

    return (data.jobs || [])
      .filter(j => j.url && j.title && j.company_name)
      .map(j => ({
        id:           `remotive-${j.id}`,
        title:        j.title,
        company:      j.company_name,
        location:     j.candidate_required_location || 'Remote',
        description:  stripHtml(j.description).slice(0, 300),
        url:          j.url,
        source:       'Remotive',
        category:     j.category || '',
        level:        '',
        salary:       j.salary || '',
        company_rating: '',
        posted_date:  museDaysAgo(j.publication_date),
      }));
  } catch {
    clearTimeout(timer);
    return [];
  }
}

function qualityFilter(jobs, roleQuery) {
  const seen  = new Set();
  const lower = (roleQuery || '').toLowerCase();
  const cutoff = Date.now() - 60 * 24 * 60 * 60 * 1000; // 60 days

  return jobs.filter(j => {
    if (seen.has(j.url)) return false;
    seen.add(j.url);
    if (!j.title || j.title.length < 2) return false;
    if (!j.url.startsWith('http'))      return false;
    return true;
  }).sort((a, b) => {
    // boost relevance if role keyword appears in title
    const aMatch = lower && a.title.toLowerCase().includes(lower) ? 1 : 0;
    const bMatch = lower && b.title.toLowerCase().includes(lower) ? 1 : 0;
    return bMatch - aMatch;
  });
}

const jobSearchCache = new Map(); // key → { results, expiresAt }
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

const jobSearchPool = [
  { title: 'Senior Software Engineer', company: 'Google Canada', location: 'Toronto, ON', salary: '$130k-$170k', description: 'Build scalable systems for millions of users.', url: 'https://careers.google.com/jobs/results/11111111', source: 'Google Careers', company_rating: '4.8', posted_date: '2 days ago' },
  { title: 'Full Stack Developer', company: 'Shopify', location: 'Ottawa, ON', salary: '$110k-$145k', description: 'Create elegant e-commerce experiences with React and Rails.', url: 'https://www.shopify.ca/careers/jobs/22222222', source: 'Shopify Jobs', company_rating: '4.5', posted_date: '3 days ago' },
  { title: 'Backend Engineer', company: 'Amazon', location: 'Vancouver, BC', salary: '$120k-$160k', description: 'Build high-performance APIs and cloud services for AWS.', url: 'https://www.amazon.jobs/en/jobs/33333333', source: 'LinkedIn', company_rating: '4.3', posted_date: '1 day ago' },
  { title: 'Product Manager', company: 'Microsoft', location: 'Calgary, AB', salary: '$125k-$165k', description: 'Lead cross-functional teams to deliver cloud products.', url: 'https://careers.microsoft.com/prod/44444444', source: 'Microsoft Careers', company_rating: '4.6', posted_date: '4 days ago' },
  { title: 'DevOps Engineer', company: 'AWS', location: 'Montreal, QC', salary: '$115k-$155k', description: 'Automate deployments and maintain scalable infrastructure.', url: 'https://aws.amazon.com/careers/55555555', source: 'AWS Jobs', company_rating: '4.4', posted_date: '6 days ago' },
  { title: 'Frontend Developer', company: 'RBC', location: 'Toronto, ON', salary: '$95k-$130k', description: 'Build beautiful interfaces for banking customers.', url: 'https://jobs.rbc.com/66666666', source: 'RBC Careers', company_rating: '4.1', posted_date: '5 days ago' },
  { title: 'Data Scientist', company: 'TD Bank', location: 'Remote (Canada)', salary: '$105k-$145k', description: 'Unlock insights from big data and improve customer experience.', url: 'https://jobs.td.com/77777777', source: 'TD Careers', company_rating: '4.2', posted_date: '2 days ago' },
  { title: 'Software Engineer Intern', company: 'Telus', location: 'Calgary, AB', salary: '$26-$36/hr', description: 'Gain hands-on experience building real products.', url: 'https://jobs.telus.com/88888888', source: 'Telus Jobs', company_rating: '4.0', posted_date: '1 week ago' },
  { title: 'Mobile App Developer', company: 'Wealthsimple', location: 'Toronto, ON', salary: '$100k-$135k', description: 'Build fintech apps that delight millions of users.', url: 'https://boards.greenhouse.io/wealthsimple/jobs/99999999', source: 'Greenhouse', company_rating: '4.3', posted_date: '18 hours ago' },
  { title: 'UX/UI Designer', company: 'Canva', location: 'Remote (Canada)', salary: '$85k-$125k', description: 'Design delightful user experiences.', url: 'https://www.canva.com/careers/10101010', source: 'Canva Careers', company_rating: '4.7', posted_date: '3 days ago' },
  { title: 'Site Reliability Engineer', company: 'Cloudflare', location: 'Toronto, ON', salary: '$130k-$170k', description: 'Keep services reliable and secure at scale.', url: 'https://careers.cloudflare.com/jobs/11111112', source: 'Cloudflare', company_rating: '4.5', posted_date: '6 days ago' },
  { title: 'Machine Learning Engineer', company: 'Nvidia', location: 'Ottawa, ON', salary: '$140k-$180k', description: 'Build ML infrastructure for advanced AI products.', url: 'https://www.nvidia.com/en-us/about-nvidia/careers/11111113', source: 'Nvidia Careers', company_rating: '4.8', posted_date: '2 days ago' },
  { title: 'Full Stack Engineer', company: 'Slack', location: 'Vancouver, BC', salary: '$115k-$150k', description: 'Build collaboration software used by teams everywhere.', url: 'https://slack.com/careers/11111114', source: 'Slack Careers', company_rating: '4.4', posted_date: '4 days ago' },
  { title: 'Cloud Solutions Architect', company: 'IBM', location: 'Montreal, QC', salary: '$125k-$165k', description: 'Design cloud solutions for enterprise customers.', url: 'https://www.ibm.com/careers/11111115', source: 'IBM Careers', company_rating: '4.2', posted_date: '2 days ago' },
  { title: 'Cybersecurity Analyst', company: 'Deloitte', location: 'Toronto, ON', salary: '$95k-$130k', description: 'Protect clients from security risks and threats.', url: 'https://www2.deloitte.com/ca/en/careers/11111116', source: 'Deloitte Careers', company_rating: '4.0', posted_date: '15 hours ago' },
  { title: 'QA Automation Engineer', company: 'Ceridian', location: 'Remote (Canada)', salary: '$90k-$120k', description: 'Automate quality checks and speed release cycles.', url: 'https://www.ceridian.com/careers/11111117', source: 'Ceridian Careers', company_rating: '4.1', posted_date: '3 days ago' },
  { title: 'DevSecOps Engineer', company: 'Shopify', location: 'Ottawa, ON', salary: '$118k-$150k', description: 'Build secure CI/CD pipelines and guard code quality.', url: 'https://careers.shopify.com/11111118', source: 'Shopify Careers', company_rating: '4.5', posted_date: '6 days ago' },
  { title: 'Business Systems Analyst', company: 'Scotiabank', location: 'Toronto, ON', salary: '$90k-$125k', description: 'Translate business needs into technical solutions.', url: 'https://www.scotiabank.com/careers/11111119', source: 'Scotiabank Careers', company_rating: '4.0', posted_date: '1 day ago' },
  { title: 'Technical Writer', company: 'Oracle', location: 'Montreal, QC', salary: '$85k-$115k', description: 'Create documentation that helps teams ship faster.', url: 'https://www.oracle.com/corporate/careers/11111120', source: 'Oracle Careers', company_rating: '4.1', posted_date: '5 days ago' },
  { title: 'Accessibility Engineer', company: 'Amazon', location: 'Vancouver, BC', salary: '$115k-$148k', description: 'Make user experiences inclusive and accessible.', url: 'https://www.amazon.jobs/en/jobs/11111121', source: 'Amazon Jobs', company_rating: '4.3', posted_date: '2 days ago' },
  { title: 'Data Engineer', company: 'Rogers', location: 'Toronto, ON', salary: '$105k-$140k', description: 'Build pipelines for analytics and customer insights.', url: 'https://www.rogers.com/careers/11111122', source: 'Rogers Careers', company_rating: '4.0', posted_date: '3 days ago' },
  { title: 'Mobile Product Manager', company: 'Uber', location: 'Remote (Canada)', salary: '$130k-$160k', description: 'Lead mobile features for a global marketplace.', url: 'https://www.uber.com/global/en/careers/11111123', source: 'Uber Careers', company_rating: '4.2', posted_date: '4 days ago' },
  { title: 'Frontend Architect', company: 'Shopify', location: 'Remote (Canada)', salary: '$125k-$160k', description: 'Design a modern frontend architecture for product teams.', url: 'https://www.shopify.ca/careers/11111124', source: 'Shopify Careers', company_rating: '4.5', posted_date: '2 days ago' }
];

// Mock AI suggestion endpoint
app.get('/api/ai/suggest', authenticate, (req, res) => {
  const { status, days_since } = req.query;
  const age = parseInt(days_since, 10) || 0;

  const suggestions = {
    Applied: age > 30
      ? { action: 'This application may be stale', detail: `It's been ${age} days. Consider a final follow-up or marking it inactive.`, priority: 'Heads Up' }
      : { action: 'Send a follow-up email', detail: 'A polite follow-up after 5–7 days can keep you top of mind with the recruiter.', priority: 'Recommended' },
    Interview: { action: 'Prepare STAR method answers', detail: 'Practice Situation, Task, Action, Result stories. Aim for 5–7 strong examples.', priority: 'High Priority' },
    Offer:     { action: 'Review the offer carefully', detail: "Don't rush. Take 24–48 hours to evaluate salary, benefits, and growth potential.", priority: 'High Priority' },
    Rejected:  { action: 'Request feedback', detail: 'Politely ask the recruiter for feedback. This insight can improve future applications.', priority: 'Recommended' },
  };

  const result = suggestions[status] || suggestions.Applied;
  res.json({ suggestion: result });
});

app.get('/api/jobs/search', authenticate, async (req, res) => {
  const role     = (req.query.role     || '').trim();
  const location = (req.query.location || '').trim();
  const cacheKey = `${role}|${location}`.toLowerCase();

  const cached = jobSearchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return res.json(cached.results);
  }

  try {
    const [museJobs, remotiveJobs] = await Promise.all([
      fetchMuseJobs(role, location),
      fetchRemotiveJobs(role),
    ]);

    const combined = qualityFilter([...museJobs, ...remotiveJobs], role).slice(0, 30);
    jobSearchCache.set(cacheKey, { results: combined, expiresAt: Date.now() + CACHE_TTL });
    res.json(combined);
  } catch (err) {
    logger.error('job:search', err, { role, location });
    res.status(500).json({ error: 'Job search failed. Please try again.' });
  }
});

app.get('/uploads/:userId/:filename', authenticate, (req, res) => {
  const downloadUserId = Number(req.params.userId);
  if (downloadUserId !== req.user.id) {
    return res.status(403).json({ error: 'Forbidden.' });
  }

  const fileName = path.basename(req.params.filename);
  const filePath = path.join(uploadRoot, String(downloadUserId), fileName);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found.' });
  }
  res.sendFile(filePath);
});

// ── Resume Viewer (EJS → browser print to PDF) ───────────────
app.get('/resume/:id', authenticate, (req, res) => {
  db.get(
    `SELECT * FROM resume_profiles WHERE id = ? AND user_id = ?`,
    [req.params.id, req.user.id],
    (err, profile) => {
      if (err || !profile) return res.status(404).send('<h3>Resume not found.</h3>');
      db.get(`SELECT * FROM user_profiles WHERE user_id = ?`, [req.user.id], (e2, userProfile) => {
        db.get(`SELECT username, email FROM users WHERE id = ?`, [req.user.id], (e3, user) => {
          let data = {};
          try { data = JSON.parse(profile.resume_json); } catch {}
          const userInfo = {
            full_name: userProfile?.full_name || user?.username || '',
            phone:     userProfile?.phone     || '',
            location:  userProfile?.location  || '',
            linkedin:  userProfile?.linkedin  || '',
          };
          const template = ['modern','classic','minimal'].includes(profile.template) ? profile.template : 'modern';
          res.render(`resume-${template}`, { profile, data, userInfo });
        });
      });
    }
  );
});

// ── Email Integration Stubs ───────────────────────────────────
app.get('/api/email/status', authenticate, (req, res) => {
  db.get(`SELECT gmail_connected, outlook_connected FROM users WHERE id = ?`, [req.user.id], (err, row) => {
    res.json({
      gmail:   { connected: !!(row?.gmail_connected),   comingSoon: true },
      outlook: { connected: !!(row?.outlook_connected), comingSoon: true },
    });
  });
});

app.get('/api/email/connect/gmail', authenticate, (req, res) => {
  res.status(501).json({ error: 'Gmail integration coming soon. Stay tuned!', comingSoon: true });
});

app.get('/api/email/connect/outlook', authenticate, (req, res) => {
  res.status(501).json({ error: 'Outlook integration coming soon. Stay tuned!', comingSoon: true });
});

// ── Legal Pages ──────────────────────────────────────────────
app.get('/privacy', (req, res) => res.render('privacy'));
app.get('/terms',   (req, res) => res.render('terms'));

// ── Account Deletion ─────────────────────────────────────────
app.delete('/api/account', authenticate, async (req, res) => {
  const userId = req.user.id;
  try {
    // Delete all user data atomically
    await new Promise((resolve, reject) =>
      db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        db.run(`DELETE FROM writing_samples        WHERE user_id = ?`, [userId]);
        db.run(`DELETE FROM resume_profiles        WHERE user_id = ?`, [userId]);
        db.run(`DELETE FROM user_profiles          WHERE user_id = ?`, [userId]);
        db.run(`DELETE FROM stripe_subscriptions   WHERE user_id = ?`, [userId]);
        db.run(`DELETE FROM email_events           WHERE user_id = ?`, [userId]);
        db.run(`DELETE FROM jobs                   WHERE user_id = ?`, [userId]);
        db.run(`DELETE FROM users                  WHERE id = ?`,      [userId], (err) => {
          if (err) { db.run('ROLLBACK'); return reject(err); }
          db.run('COMMIT', (commitErr) => commitErr ? reject(commitErr) : resolve());
        });
      })
    );

    // Delete user's uploaded files
    await fileService.deleteUserFolder(userId);

    logger.log('account:deleted', { userId });
    res.json({ ok: true });
  } catch (err) {
    logger.error('account:delete', err, { userId });
    res.status(500).json({ error: 'Account deletion failed. Please contact support.' });
  }
});

// ── Job Match ────────────────────────────────────────────────
app.get('/api/jobs/:id/match', authenticate, (req, res) => {
  const { scoreProfile, findBestMatch } = require('./services/matchingService');
  db.get(`SELECT * FROM jobs WHERE id = ? AND user_id = ?`, [req.params.id, req.user.id], (err, job) => {
    if (err || !job) return res.status(404).json({ error: 'Job not found.' });
    db.all(`SELECT * FROM resume_profiles WHERE user_id = ?`, [req.user.id], (err2, profiles) => {
      if (err2) return res.status(500).json({ error: err2.message });
      if (!profiles || !profiles.length) return res.json({ match: null, scores: [] });
      const scores = profiles.map(p => scoreProfile(job, p)).sort((a, b) => b.score - a.score);
      res.json({ match: scores[0], scores });
    });
  });
});

// ── Cover Letter Generation ───────────────────────────────────
app.post('/api/jobs/:id/cover-letter', authenticate, limiters.ai, async (req, res) => {
  try {
    const job = await new Promise((resolve, reject) =>
      db.get(`SELECT * FROM jobs WHERE id = ? AND user_id = ?`, [req.params.id, req.user.id],
        (err, row) => err ? reject(err) : resolve(row))
    );
    if (!job) return res.status(404).json({ error: 'Job not found.' });

    const profiles = await new Promise((resolve, reject) =>
      db.all(`SELECT * FROM resume_profiles WHERE user_id = ?`, [req.user.id],
        (err, rows) => err ? reject(err) : resolve(rows || []))
    );

    let selectedProfile = null;
    if (req.body.profile_id) {
      selectedProfile = profiles.find(p => p.id === Number(req.body.profile_id)) || null;
    }
    if (!selectedProfile && profiles.length) {
      const { findBestMatch } = require('./services/matchingService');
      const best = findBestMatch(job, profiles);
      if (best) selectedProfile = profiles.find(p => p.id === best.profileId) || null;
    }

    let resumeProfile = {};
    if (selectedProfile) {
      try { resumeProfile = JSON.parse(selectedProfile.resume_json); } catch {}
    }

    const samples = await new Promise((resolve, reject) =>
      db.all(`SELECT content FROM writing_samples WHERE user_id = ? LIMIT 5`, [req.user.id],
        (err, rows) => err ? reject(err) : resolve(rows || []))
    );

    const userInfo = await new Promise((resolve, reject) =>
      db.get(
        `SELECT up.full_name, up.location, u.email FROM user_profiles up
         JOIN users u ON u.id = up.user_id WHERE up.user_id = ?`,
        [req.user.id],
        (err, row) => err ? reject(err) : resolve(row || {}))
    );

    let writingStyle = null;
    if (samples.length >= 2) {
      try { writingStyle = await aiService.extractWritingStyle(samples); } catch {}
    }

    const coverLetter = await aiService.generateCoverLetter({
      jobTitle:        job.role,
      company:         job.company,
      jobDescription:  job.job_description || job.notes || '',
      resumeProfile,
      writingStyle,
      userInfo,
    });

    logger.log('cover-letter:generated', { userId: req.user.id, jobId: job.id, profileId: selectedProfile?.id });
    res.json({ cover_letter: coverLetter, profile_used: selectedProfile?.role_label || null });
  } catch (err) {
    logger.error('cover-letter:generate', err);
    res.status(500).json({ error: 'Cover letter generation failed. Please try again.' });
  }
});

// ── Billing: Status ──────────────────────────────────────────
app.get('/api/billing/status', authenticate, (req, res) => {
  db.get(
    `SELECT subscription_status, trial_ends_at, stripe_customer_id FROM users WHERE id = ?`,
    [req.user.id],
    (err, user) => {
      if (err) return res.status(500).json({ error: err.message });

      const now = Math.floor(Date.now() / 1000);
      const status = user?.subscription_status || 'trial';
      const trialEndsAt = user?.trial_ends_at || (now + 30 * 86400);
      const trialExpired = status === 'trial' && now > trialEndsAt;

      // Check stripe_subscriptions for active sub details
      db.get(
        `SELECT current_period_end FROM stripe_subscriptions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`,
        [req.user.id],
        (err2, sub) => {
          res.json({
            status:             trialExpired ? 'expired' : status,
            trial_ends_at:      trialEndsAt,
            current_period_end: sub?.current_period_end || null,
          });
        }
      );
    }
  );
});

// ── Billing: Create Checkout Session ─────────────────────────
app.post('/api/billing/checkout', authenticate, async (req, res) => {
  try {
    const user = await new Promise((resolve, reject) =>
      db.get(`SELECT username, email, subscription_status FROM users WHERE id = ?`, [req.user.id],
        (err, row) => err ? reject(err) : resolve(row))
    );

    const origin = `${req.protocol}://${req.get('host')}`;
    const session = await stripeService.createCheckoutSession(
      req.user.id,
      user?.email,
      `${origin}/?billing=success`,
      `${origin}/?billing=cancel`
    );

    logger.log('billing:checkout-created', { userId: req.user.id, sessionId: session.id });
    res.json({ url: session.url });
  } catch (err) {
    logger.error('billing:checkout', err);
    // If Stripe keys not configured, return null URL (dev mode)
    if (err.message.includes('not configured')) return res.json({ url: null });
    res.status(500).json({ error: 'Unable to start checkout. Please try again.' });
  }
});

// ── Billing: Stripe Webhook ───────────────────────────────────
app.post('/api/billing/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripeService.constructWebhookEvent(req.body, sig);
  } catch (err) {
    logger.error('billing:webhook-verify', err);
    return res.status(400).json({ error: `Webhook signature failed: ${err.message}` });
  }

  // Idempotency: skip already-processed events
  db.get(`SELECT id FROM stripe_webhook_events WHERE stripe_event_id = ?`, [event.id], (err, existing) => {
    if (existing) return res.json({ received: true, skipped: true });

    db.run(`INSERT OR IGNORE INTO stripe_webhook_events (stripe_event_id, event_type, processed_at)
            VALUES (?, ?, datetime('now'))`, [event.id, event.type]);

    const obj = event.data.object;
    const userId = Number(obj.metadata?.userId || obj.subscription_data?.metadata?.userId);

    const handlers = {
      'checkout.session.completed': () => {
        if (obj.mode !== 'subscription' || !userId) return;
        db.run(`UPDATE users SET subscription_status = 'active', stripe_customer_id = ?
                WHERE id = ?`, [obj.customer, userId]);
        logger.log('billing:subscribed', { userId, customerId: obj.customer });
      },
      'invoice.paid': () => {
        if (!obj.customer) return;
        db.get(`SELECT id FROM users WHERE stripe_customer_id = ?`, [obj.customer], (e, user) => {
          if (!user) return;
          db.run(`UPDATE users SET subscription_status = 'active' WHERE id = ?`, [user.id]);
          const subId = obj.subscription;
          const periodEnd = obj.lines?.data?.[0]?.period?.end;
          if (subId && periodEnd) {
            db.run(`INSERT INTO stripe_subscriptions (user_id, stripe_subscription_id, status, current_period_end)
                    VALUES (?, ?, 'active', ?)
                    ON CONFLICT(stripe_subscription_id) DO UPDATE SET status='active', current_period_end=excluded.current_period_end`,
              [user.id, subId, periodEnd]);
          }
        });
      },
      'customer.subscription.deleted': () => {
        if (!obj.customer) return;
        db.get(`SELECT id FROM users WHERE stripe_customer_id = ?`, [obj.customer], (e, user) => {
          if (!user) return;
          db.run(`UPDATE users SET subscription_status = 'cancelled' WHERE id = ?`, [user.id]);
          db.run(`UPDATE stripe_subscriptions SET status = 'cancelled' WHERE stripe_subscription_id = ?`, [obj.id]);
          logger.log('billing:cancelled', { userId: user.id });
        });
      },
      'invoice.payment_failed': () => {
        if (!obj.customer) return;
        db.get(`SELECT id FROM users WHERE stripe_customer_id = ?`, [obj.customer], (e, user) => {
          if (!user) return;
          db.run(`UPDATE users SET subscription_status = 'past_due' WHERE id = ?`, [user.id]);
          logger.log('billing:payment-failed', { userId: user.id });
        });
      },
    };

    if (handlers[event.type]) handlers[event.type]();
    res.json({ received: true });
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.log('server:start', { port: PORT });
});
