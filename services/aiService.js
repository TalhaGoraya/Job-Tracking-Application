'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const { sanitizeForAI } = require('./security');

const MODEL = 'claude-haiku-4-5-20251001';
const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_RETRIES = 2;

let _client = null;
function getClient() {
  if (!_client) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error('ANTHROPIC_API_KEY not configured. Set it in your .env file.');
    _client = new Anthropic({ apiKey: key });
  }
  return _client;
}

async function withRetry(fn, retries = DEFAULT_RETRIES) {
  try {
    return await fn();
  } catch (err) {
    if (retries === 0) throw err;
    await new Promise(r => setTimeout(r, 1200));
    return withRetry(fn, retries - 1);
  }
}

async function withTimeout(fn, ms = DEFAULT_TIMEOUT) {
  return Promise.race([
    fn(),
    new Promise((_, reject) => setTimeout(() => reject(new Error('AI request timed out.')), ms)),
  ]);
}

function parseJSON(text) {
  const match = text.match(/```json\s*([\s\S]*?)```/i) || text.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
  if (!match) throw new Error('AI returned unexpected format.');
  return JSON.parse(match[1]);
}

// ── Role Suggestion ──────────────────────────────────────────
async function suggestRoles(resumeText) {
  const safe = sanitizeForAI(resumeText).slice(0, 6000);
  const client = getClient();

  return withRetry(() => withTimeout(async () => {
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 512,
      messages: [{
        role: 'user',
        content: `You are a career coach. Based on this resume, suggest the 6 best-fit job titles.
Return ONLY a JSON array of objects: [{"title":"...","category":"...","reason":"..."}]
Resume:\n${safe}`,
      }],
    });

    const roles = parseJSON(msg.content[0].text);
    if (!Array.isArray(roles)) throw new Error('Invalid role list from AI.');
    return roles.slice(0, 6).map(r => ({
      title:    String(r.title    || '').trim(),
      category: String(r.category || '').trim(),
      reason:   String(r.reason   || '').trim(),
    }));
  }));
}

// ── Resume Profile Generation ────────────────────────────────
async function generateResumeProfile(resumeText, role) {
  const safe = sanitizeForAI(resumeText).slice(0, 6000);
  const client = getClient();

  return withRetry(() => withTimeout(async () => {
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: `You are an expert resume writer and ATS specialist.
Create a tailored resume profile for the role: "${role.title}" in category "${role.category}".
Based on this candidate's experience:\n${safe}

Return ONLY a JSON object:
{
  "role_label": "exact job title",
  "role_category": "industry category",
  "summary": "2-3 sentence professional summary",
  "keywords": ["ats", "keyword", "list", "of", "10-15", "terms"],
  "experience": [
    {"title":"...","company":"...","dates":"...","bullets":["achievement 1","achievement 2","achievement 3"]}
  ],
  "skills": ["skill1","skill2"],
  "education": [{"degree":"...","school":"...","year":"..."}]
}`,
      }],
    });

    const profile = parseJSON(msg.content[0].text);
    if (!profile.role_label) throw new Error('AI returned incomplete profile.');

    // Enforce limits
    if (profile.experience?.length > 10) profile.experience = profile.experience.slice(0, 10);
    profile.experience?.forEach(e => {
      if (e.bullets?.length > 8) e.bullets = e.bullets.slice(0, 8);
    });
    if (profile.keywords?.length > 15) profile.keywords = profile.keywords.slice(0, 15);

    const jsonStr = JSON.stringify(profile);
    if (jsonStr.length > 100_000) throw new Error('Generated profile exceeds size limit.');

    return profile;
  }));
}

// ── Writing Style Extraction ─────────────────────────────────
async function extractWritingStyle(samples) {
  const combined = samples.map(s => s.content).join('\n\n---\n\n').slice(0, 8000);
  const client = getClient();

  return withRetry(() => withTimeout(async () => {
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 512,
      messages: [{
        role: 'user',
        content: `Analyze this person's writing style from these samples.
Return ONLY a JSON object:
{
  "tone": "formal|conversational|enthusiastic|analytical",
  "sentence_length": "short|medium|long",
  "vocabulary": "simple|professional|technical|varied",
  "traits": ["trait1","trait2","trait3"],
  "style_summary": "2 sentence description of their unique voice"
}
Samples:\n${combined}`,
      }],
    });
    return parseJSON(msg.content[0].text);
  }));
}

// ── Cover Letter Generation ──────────────────────────────────
async function generateCoverLetter({ jobTitle, company, jobDescription, resumeProfile, writingStyle, userInfo }) {
  const client = getClient();
  const profileSnippet = JSON.stringify(resumeProfile).slice(0, 3000);
  const styleNote = writingStyle
    ? `Write in a ${writingStyle.tone} tone with ${writingStyle.sentence_length} sentences. Style: ${writingStyle.style_summary}`
    : 'Write in a professional, enthusiastic tone.';

  const userBlock = userInfo
    ? `Candidate: ${userInfo.full_name || 'the candidate'}, located in ${userInfo.location || 'Canada'}.`
    : '';

  return withRetry(() => withTimeout(async () => {
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `Write a compelling, personalized cover letter for this application.

Job: ${jobTitle} at ${company}
${jobDescription ? `Job description excerpt:\n${jobDescription.slice(0, 1000)}` : ''}
${userBlock}
Resume profile: ${profileSnippet}

${styleNote}

Format: professional letter body only (no date/address header). 3-4 paragraphs.
Return the cover letter text only, no extra commentary.`,
      }],
    });
    return msg.content[0].text.trim();
  }, 45_000));
}

module.exports = { suggestRoles, generateResumeProfile, extractWritingStyle, generateCoverLetter };
