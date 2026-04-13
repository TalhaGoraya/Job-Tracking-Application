const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const crypto = require('crypto');

const app = express();
const dbPath = path.join(__dirname, 'jobs.db');
const uploadRoot = path.join(__dirname, 'uploads');

if (!fs.existsSync(uploadRoot)) {
  fs.mkdirSync(uploadRoot, { recursive: true });
}

const db = new sqlite3.Database(dbPath);
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

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function runSql(sql) {
  db.run(sql, err => {
    if (err) console.error('SQLite error:', err.message);
  });
}

function ensureUsersTable() {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      api_key TEXT NOT NULL UNIQUE,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
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
    { name: 'source', type: 'TEXT' },
    { name: 'salary', type: 'TEXT' },
    { name: 'company_rating', type: 'TEXT' },
    { name: 'posted_date', type: 'TEXT' },
    { name: 'updated_at', type: 'TEXT' }
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
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  const normalized = username.trim().toLowerCase();
  const passwordHash = hashPassword(password);
  const apiKey = generateApiKey();

  db.run(
    `INSERT INTO users (username, password_hash, api_key) VALUES (?, ?, ?)`,
    [normalized, passwordHash, apiKey],
    function (err) {
      if (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
          return res.status(400).json({ error: 'Username is already taken.' });
        }
        return res.status(500).json({ error: err.message });
      }
      res.json({ id: this.lastID, username: normalized, api_key: apiKey });
    }
  );
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  const normalized = username.trim().toLowerCase();
  const passwordHash = hashPassword(password);

  db.get(
    `SELECT id, username, api_key FROM users WHERE username = ? AND password_hash = ?`,
    [normalized, passwordHash],
    (err, user) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (!user) {
        return res.status(401).json({ error: 'Invalid username or password.' });
      }
      res.json({ id: user.id, username: user.username, api_key: user.api_key });
    }
  );
});

app.get('/api/profile', authenticate, (req, res) => {
  res.json({ id: req.user.id, username: req.user.username, api_key: req.user.api_key });
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

app.get('/api/jobs/search', authenticate, (req, res) => {
  const role = (req.query.role || 'developer').toLowerCase();
  const location = (req.query.location || 'Canada').toLowerCase();

  const results = jobSearchPool
    .map(job => ({
      ...job,
      relevance:
        ['title', 'company', 'description', 'location'].reduce((score, field) => {
          const text = job[field].toLowerCase();
          if (role && text.includes(role)) score += 4;
          if (location && text.includes(location)) score += 3;
          return score;
        }, 0)
    }))
    .filter(job => job.relevance > 0 || role === 'developer')
    .sort((a, b) => b.relevance - a.relevance || parseFloat(b.company_rating) - parseFloat(a.company_rating))
    .slice(0, 24);

  res.json(results);
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

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
