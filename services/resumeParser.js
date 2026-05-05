'use strict';

const pdfParse = require('pdf-parse');
const mammoth  = require('mammoth');

const MAX_CHARS = 80_000;

async function parse(buffer, mimetype) {
  try {
    if (mimetype === 'application/pdf') {
      const data = await pdfParse(buffer);
      return clean(data.text);
    }

    if (
      mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      mimetype === 'application/msword'
    ) {
      const result = await mammoth.extractRawText({ buffer });
      return clean(result.value);
    }

    if (mimetype === 'text/plain') {
      return clean(buffer.toString('utf8'));
    }

    throw new Error(`Unsupported file type: ${mimetype}`);
  } catch (err) {
    throw new Error(`Resume parsing failed: ${err.message}`);
  }
}

function clean(text) {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_CHARS);
}

function assess(text) {
  if (!text || text.length < 100) return { ok: false, reason: 'Resume text is too short to parse.' };
  if (text.length < 300)          return { ok: true,  warning: 'Very little text was extracted. Consider pasting your resume text manually.' };
  return { ok: true };
}

module.exports = { parse, assess };
