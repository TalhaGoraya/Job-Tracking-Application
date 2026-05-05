'use strict';

const rateLimit = require('express-rate-limit');

// ── Magic bytes signatures ───────────────────────────────────
const MAGIC = {
  pdf:  [0x25, 0x50, 0x44, 0x46],          // %PDF
  docx: [0x50, 0x4B, 0x03, 0x04],          // PK.. (ZIP)
  doc:  [0xD0, 0xCF, 0x11, 0xE0],          // OLE compound
};

function detectMagic(buffer) {
  const bytes = Array.from(buffer.slice(0, 4));
  for (const [type, sig] of Object.entries(MAGIC)) {
    if (sig.every((b, i) => bytes[i] === b)) return type;
  }
  return null;
}

// Allowed MIME types → expected magic type
const ALLOWED = {
  'application/pdf':                                             'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/msword':                                          'doc',
  'text/plain':                                                  null,  // no magic check for plain text
};

function validateUpload(buffer, mimetype) {
  if (!ALLOWED.hasOwnProperty(mimetype)) {
    return { valid: false, error: `File type not allowed. Accepted: PDF, DOCX, DOC, TXT.` };
  }
  const expectedMagic = ALLOWED[mimetype];
  if (expectedMagic !== null) {
    const actual = detectMagic(buffer);
    if (actual !== expectedMagic) {
      return { valid: false, error: `File content does not match its extension. Upload a real ${expectedMagic.toUpperCase()}.` };
    }
  }
  if (buffer.length > 10 * 1024 * 1024) {
    return { valid: false, error: 'File exceeds 10 MB limit.' };
  }
  return { valid: true };
}

// ── AI input sanitization ────────────────────────────────────
const MAX_AI_INPUT = 50_000;

function sanitizeForAI(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_AI_INPUT);
}

// ── Rate limiters ────────────────────────────────────────────
function makeJsonLimiter(windowMs, max, message) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => res.status(429).json({ error: message }),
  });
}

const limiters = {
  auth:      makeJsonLimiter(15 * 60 * 1000, 20,  'Too many auth attempts. Try again in 15 minutes.'),
  ai:        makeJsonLimiter(60 * 60 * 1000, 30,  'AI request limit reached. Try again in an hour.'),
  upload:    makeJsonLimiter(60 * 60 * 1000, 40,  'Upload limit reached. Try again in an hour.'),
  jobSearch: makeJsonLimiter(15 * 60 * 1000, 60,  'Search limit reached. Try again in 15 minutes.'),
  api:       makeJsonLimiter(15 * 60 * 1000, 300, 'Too many requests. Try again in 15 minutes.'),
};

module.exports = { validateUpload, sanitizeForAI, limiters };
