const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const app = express();
const db = new sqlite3.Database(path.join(__dirname, 'jobs.db'));
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    cb(null, `${timestamp}-${safeName}`);
  }
});

const upload = multer({ storage });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadDir));

const STATUSES = ['Applied', 'Interview', 'Offer', 'Rejected'];

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
      applied_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.all(`PRAGMA table_info(jobs)`, [], (err, columns) => {
    if (err) return;
    const existing = columns.map(col => col.name);
    const additions = [
      { name: 'email', type: 'TEXT' },
      { name: 'email_sent', type: 'BOOLEAN DEFAULT 0' },
      { name: 'followup_1_date', type: 'TEXT' },
      { name: 'followup_2_date', type: 'TEXT' },
      { name: 'resume_file', type: 'TEXT' },
      { name: 'cover_letter_file', type: 'TEXT' }
    ];
    additions.forEach(column => {
      if (!existing.includes(column.name)) {
        db.run(`ALTER TABLE jobs ADD COLUMN ${column.name} ${column.type}`);
      }
    });
  });
});

app.get('/api/jobs', (req, res) => {
  const sql = 'SELECT * FROM jobs ORDER BY applied_at DESC';
  db.all(sql, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.get('/api/summary', (req, res) => {
  const sql = `
    SELECT status, COUNT(*) AS count
    FROM jobs
    GROUP BY status
  `;
  db.all(sql, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const summary = STATUSES.reduce((acc, status) => {
      acc[status] = 0;
      return acc;
    }, {});
    rows.forEach(row => {
      summary[row.status] = row.count;
    });
    res.json(summary);
  });
});

app.post('/api/jobs', upload.fields([
  { name: 'resume', maxCount: 1 },
  { name: 'coverLetter', maxCount: 1 }
]), (req, res) => {
  const { company, role, location, status, notes, email, email_sent, followup_1_date, followup_2_date } = req.body;
  if (!company || !role) {
    return res.status(400).json({ error: 'Company and role are required.' });
  }

  const finalStatus = STATUSES.includes(status) ? status : 'Applied';
  const parsedEmailSent = email_sent === '1' || email_sent === 'true' || email_sent === 'on';
  const resumeFile = req.files?.resume?.[0]?.filename || null;
  const coverLetterFile = req.files?.coverLetter?.[0]?.filename || null;
  const sql = `INSERT INTO jobs (company, role, location, status, notes, email, email_sent, followup_1_date, followup_2_date, resume_file, cover_letter_file) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  db.run(sql, [
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
    coverLetterFile
  ], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.status(201).json({ id: this.lastID });
  });
});

app.put('/api/jobs/:id', (req, res) => {
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

  values.push(id);
  const sql = `UPDATE jobs SET ${fields.join(', ')} WHERE id = ?`;
  db.run(sql, values, function (err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0) return res.status(404).json({ error: 'Job not found.' });
    res.json({ updated: this.changes });
  });
});

app.delete('/api/jobs/:id', (req, res) => {
  const sql = 'DELETE FROM jobs WHERE id = ?';
  db.run(sql, [req.params.id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0) return res.status(404).json({ error: 'Job not found.' });
    res.json({ deleted: this.changes });
  });
});

app.get('/api/jobs/search', (req, res) => {
  const { role = 'developer', location = 'Canada' } = req.query;
  const mockJobs = [
    { id: 'j1', title: 'Senior Software Engineer', company: 'Google Canada', location: 'Toronto, ON', salary: '$120k-$160k', description: 'Build scalable systems for millions of users', url: 'https://google.com/careers' },
    { id: 'j2', title: 'Full Stack Developer', company: 'Shopify', location: 'Ottawa, ON', salary: '$100k-$140k', description: 'Create amazing e-commerce experiences', url: 'https://shopify.com/careers' },
    { id: 'j3', title: 'Product Manager', company: 'Microsoft Canada', location: 'Vancouver, BC', salary: '$130k-$170k', description: 'Lead innovative cloud products', url: 'https://microsoft.com/careers' },
    { id: 'j4', title: 'DevOps Engineer', company: 'Amazon AWS', location: 'Montreal, QC', salary: '$110k-$150k', description: 'Manage cloud infrastructure at scale', url: 'https://amazon.com/careers' },
    { id: 'j5', title: 'Frontend Developer', company: 'RBC', location: 'Toronto, ON', salary: '$95k-$130k', description: 'Build modern web interfaces', url: 'https://rbc.com/careers' },
    { id: 'j6', title: 'Data Scientist', company: 'TD Bank', location: 'Remote (Canada)', salary: '$105k-$145k', description: 'Unlock insights from big data', url: 'https://td.com/careers' },
    { id: 'j7', title: 'Software Engineer Intern', company: 'Telus', location: 'Calgary, AB', salary: '$25-$35/hr', description: 'Get hands-on experience with modern tech', url: 'https://telus.com/careers' },
    { id: 'j8', title: 'Mobile App Developer', company: 'Wealthsimple', location: 'Toronto, ON', salary: '$100k-$135k', description: 'Create fintech apps for millions', url: 'https://wealthsimple.com/careers' },
    { id: 'j9', title: 'Backend Engineer', company: 'Slack', location: 'Vancouver, BC', salary: '$115k-$155k', description: 'Build reliable messaging infrastructure', url: 'https://slack.com/careers' },
    { id: 'j10', title: 'UX/UI Designer', company: 'Canva', location: 'Remote (Canada)', salary: '$85k-$125k', description: 'Design delightful user experiences', url: 'https://canva.com/careers' }
  ];
  const filtered = mockJobs.filter(job => 
    job.title.toLowerCase().includes(role.toLowerCase()) || 
    job.description.toLowerCase().includes(role.toLowerCase()) ||
    job.company.toLowerCase().includes(role.toLowerCase())
  );
  res.json(filtered.length > 0 ? filtered : mockJobs);
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
