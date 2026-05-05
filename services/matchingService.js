'use strict';

const CATEGORY_ALIASES = [
  ['software engineering', ['engineering', 'software', 'development', 'developer', 'coding', 'programmer']],
  ['data science',         ['data', 'analytics', 'machine learning', 'ai', 'ml', 'scientist']],
  ['product management',   ['product', 'pm', 'product manager']],
  ['design',               ['ux', 'ui', 'design', 'creative', 'visual']],
  ['marketing',            ['marketing', 'growth', 'content', 'seo', 'brand']],
  ['sales',                ['sales', 'account', 'business development', 'revenue']],
  ['devops',               ['devops', 'infrastructure', 'cloud', 'platform', 'sre', 'reliability']],
  ['security',             ['security', 'cybersecurity', 'infosec', 'appsec']],
  ['finance',              ['finance', 'accounting', 'financial', 'analyst']],
  ['operations',           ['operations', 'ops', 'logistics', 'supply chain']],
];

const SKILL_SYNONYMS = [
  [['javascript', 'js'],          ['node', 'nodejs', 'typescript', 'ts', 'react', 'vue', 'angular', 'next']],
  [['python'],                    ['django', 'flask', 'fastapi', 'pandas', 'numpy', 'scipy']],
  [['cloud', 'aws', 'azure', 'gcp'], ['s3', 'lambda', 'ec2', 'azure', 'gcp', 'kubernetes', 'k8s']],
  [['sql', 'database'],           ['mysql', 'postgresql', 'postgres', 'sqlite', 'oracle', 'db']],
  [['machine learning', 'ml'],    ['ai', 'deep learning', 'neural', 'tensorflow', 'pytorch', 'sklearn']],
  [['agile', 'scrum'],            ['sprint', 'kanban', 'jira', 'confluence']],
  [['ci/cd', 'devops'],           ['jenkins', 'github actions', 'gitlab', 'docker', 'terraform']],
];

function normalizeText(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function tokenize(text) {
  return normalizeText(text).split(' ').filter(w => w.length > 2);
}

function categoryScore(jobRole, profileCategory) {
  if (!jobRole || !profileCategory) return 0;
  const jobNorm  = normalizeText(jobRole);
  const profNorm = normalizeText(profileCategory);
  if (jobNorm.includes(profNorm) || profNorm.includes(jobNorm)) return 20;
  for (const [, aliases] of CATEGORY_ALIASES) {
    const inJob  = aliases.some(a => jobNorm.includes(a));
    const inProf = aliases.some(a => profNorm.includes(a));
    if (inJob && inProf) return 15;
  }
  return 0;
}

function titleScore(jobTitle, profileRoleLabel) {
  if (!jobTitle || !profileRoleLabel) return 0;
  const jobTokens  = tokenize(jobTitle);
  const profTokens = tokenize(profileRoleLabel);
  let matches = 0;
  for (const t of jobTokens) {
    if (profTokens.includes(t)) matches++;
  }
  return Math.min(10, matches * 4);
}

function keywordScore(jobText, profileKeywords) {
  if (!profileKeywords || !profileKeywords.length) return 0;
  const jobNorm = normalizeText(jobText);
  let score = 0;
  for (const kw of profileKeywords) {
    const kwNorm = normalizeText(kw);
    if (jobNorm.includes(kwNorm)) { score += 2; continue; }
    // synonym expansion — 1pt partial credit
    for (const [canonicals, synonyms] of SKILL_SYNONYMS) {
      const allTerms = [...canonicals, ...synonyms];
      if (allTerms.includes(kwNorm)) {
        if (allTerms.some(s => s !== kwNorm && jobNorm.includes(s))) {
          score += 1;
          break;
        }
      }
    }
  }
  return score;
}

function scoreProfile(job, profile) {
  let resumeData = {};
  try { resumeData = JSON.parse(profile.resume_json || '{}'); } catch {}

  const jobText = [job.role, job.company, job.notes || '', job.job_description || ''].join(' ');
  const cat     = categoryScore(job.role, profile.role_category);
  const title   = titleScore(job.role, profile.role_label);
  const kw      = keywordScore(jobText, resumeData.keywords || []);
  const total   = cat + title + kw;

  return {
    profileId:   profile.id,
    roleLabel:   profile.role_label,
    score:       total,
    breakdown:   { category: cat, title, keywords: kw },
  };
}

function findBestMatch(job, profiles) {
  if (!profiles || !profiles.length) return null;
  const scored = profiles.map(p => scoreProfile(job, p));
  scored.sort((a, b) => b.score - a.score);
  return scored[0];
}

module.exports = { scoreProfile, findBestMatch };
