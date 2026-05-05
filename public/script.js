/* ============================================================
   PATHLY — Frontend Application
   Modular vanilla JS · SPA router · Chart.js · AI suggestions
   ============================================================ */

'use strict';

// ─────────────────────────────────────────────────────────────
//  STATE
// ─────────────────────────────────────────────────────────────
const state = {
  token: null,
  user: null,
  jobs: [],
  summary: { Applied: 0, Interview: 0, Offer: 0, Rejected: 0 },
  currentPage: 'dashboard',
  currentFilter: 'all',
  searchQuery: '',
  notifications: [],
  chart: null,
  newlyAddedId: null,
};

// ─────────────────────────────────────────────────────────────
//  UTILITIES
// ─────────────────────────────────────────────────────────────
function escapeHtml(val) {
  return String(val || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDate(dateStr) {
  if (!dateStr) return null;
  try {
    return new Date(dateStr).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return dateStr; }
}

function daysSince(dateStr) {
  if (!dateStr) return 0;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.floor((target - today) / 86400000);
}

function getToken() { return state.token || localStorage.getItem('userToken'); }

// ─────────────────────────────────────────────────────────────
//  API LAYER
// ─────────────────────────────────────────────────────────────
async function apiFetch(path, options = {}) {
  const token = getToken();
  options.headers = options.headers || {};
  if (token) options.headers['X-User-Token'] = token;
  const res = await fetch(path, options);
  if (res.status === 401) { Auth.logout(); throw new Error('Session expired. Please sign in again.'); }
  return res;
}

const API = {
  async login(username, password) {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Unable to sign in.');
    return data;
  },

  async register(username, email, password) {
    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Unable to create account.');
    return data;
  },

  async profile() {
    const res = await apiFetch('/api/profile');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Unable to load profile.');
    return data;
  },

  async getJobs() {
    const res = await apiFetch('/api/jobs');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Unable to load jobs.');
    return data;
  },

  async getSummary() {
    const res = await apiFetch('/api/summary');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Unable to load summary.');
    return data;
  },

  async createJob(formData) {
    const res = await apiFetch('/api/jobs', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Unable to save application.');
    return data;
  },

  async updateJob(id, payload) {
    const res = await apiFetch(`/api/jobs/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Unable to update application.');
    return data;
  },

  async deleteJob(id) {
    const res = await apiFetch(`/api/jobs/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Unable to delete application.');
    return data;
  },

  async searchJobs(role, location) {
    const res = await apiFetch(`/api/jobs/search?role=${encodeURIComponent(role)}&location=${encodeURIComponent(location)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Search failed.');
    return data;
  },

  async getProfileInfo() {
    const res = await apiFetch('/api/profile/info');
    return res.json();
  },

  async saveProfileInfo(payload) {
    const res = await apiFetch('/api/profile/info', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Save failed.');
    return data;
  },

  async uploadResume(formData) {
    const res = await apiFetch('/api/profile/resume', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Upload failed.');
    return data;
  },

  async suggestRoles() {
    const res = await apiFetch('/api/ai/suggest-roles', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'AI failed.');
    return data;
  },

  async generateProfiles(roles) {
    const res = await apiFetch('/api/ai/generate-profiles', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roles }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'AI failed.');
    return data;
  },

  async getResumeProfiles() {
    const res = await apiFetch('/api/resume-profiles');
    return res.json();
  },

  async getBillingStatus() {
    const res = await apiFetch('/api/billing/status');
    return res.json();
  },

  async createCheckout() {
    const res = await apiFetch('/api/billing/checkout', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Checkout failed.');
    return data;
  },

  async addWritingSample(payload) {
    const res = await apiFetch('/api/writing-samples', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to save sample.');
    return data;
  },

  async getWritingSamples() {
    const res = await apiFetch('/api/writing-samples');
    return res.json();
  },

  async generateCoverLetter(jobId, profileId) {
    const res = await apiFetch(`/api/jobs/${jobId}/cover-letter`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile_id: profileId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'AI failed.');
    return data;
  },

  async matchJob(jobId) {
    const res = await apiFetch(`/api/jobs/${jobId}/match`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Match failed.');
    return data;
  },
};

// ─────────────────────────────────────────────────────────────
//  TOAST
// ─────────────────────────────────────────────────────────────
const Toast = {
  show(message, type = 'info', duration = 3500) {
    const icons = { success: '✅', error: '❌', info: 'ℹ️' };
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<span class="toast-icon">${icons[type]}</span><span>${escapeHtml(message)}</span>`;
    container.appendChild(el);
    setTimeout(() => {
      el.classList.add('hide');
      el.addEventListener('animationend', () => el.remove(), { once: true });
    }, duration);
  },
  success: (msg) => Toast.show(msg, 'success'),
  error:   (msg) => Toast.show(msg, 'error'),
  info:    (msg) => Toast.show(msg, 'info'),
};

// ─────────────────────────────────────────────────────────────
//  AUTH
// ─────────────────────────────────────────────────────────────
const Auth = {
  setSession(user) {
    state.token = user.api_key;
    state.user = user;
    localStorage.setItem('userToken', user.api_key);
    localStorage.setItem('userName', user.username);
    this._updateUI(user.username);
  },

  logout() {
    state.token = null;
    state.user = null;
    state.jobs = [];
    state.summary = { Applied: 0, Interview: 0, Offer: 0, Rejected: 0 };
    localStorage.removeItem('userToken');
    localStorage.removeItem('userName');
    document.getElementById('app').classList.add('hidden');
    document.getElementById('auth-screen').classList.remove('hidden');
    if (state.chart) { state.chart.destroy(); state.chart = null; }
  },

  _updateUI(username) {
    const initials = username ? username.charAt(0).toUpperCase() : '?';
    document.getElementById('sidebar-username').textContent = username || 'User';
    document.getElementById('user-avatar').textContent = initials;
  },

  async check() {
    const token = localStorage.getItem('userToken');
    if (!token) { this._showAuth(); return; }
    state.token = token;
    try {
      const user = await API.profile();
      this.setSession(user);
      this._showApp();
      await refresh();
    } catch {
      this._showAuth();
    }
  },

  _showAuth() {
    document.getElementById('auth-screen').classList.remove('hidden');
    document.getElementById('app').classList.add('hidden');
  },

  _showApp() {
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
  },
};

// ─────────────────────────────────────────────────────────────
//  ROUTER (SPA navigation)
// ─────────────────────────────────────────────────────────────
const PAGE_TITLES = {
  dashboard:    ['Dashboard',    'Welcome back! Here\'s your job search at a glance.'],
  applications: ['Applications', 'Track and manage all your job applications.'],
  search:       ['Find Jobs',    'Discover and add new opportunities to your pipeline.'],
  profile:      ['My Profile',   'Manage your personal info, resume, and AI career tools.'],
  billing:      ['Billing',      'Manage your Pathly subscription.'],
};

const Router = {
  go(page) {
    if (!PAGE_TITLES[page]) return;

    // Update state
    state.currentPage = page;

    // Hide all pages, show target
    document.querySelectorAll('.page').forEach(p => {
      p.classList.toggle('active', p.id === `page-${page}`);
      p.classList.toggle('hidden', p.id !== `page-${page}`);
    });

    // Update nav items
    document.querySelectorAll('.nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.page === page);
    });

    // Update header
    const [title, subtitle] = PAGE_TITLES[page];
    document.getElementById('page-title').textContent = title;
    document.getElementById('page-subtitle').textContent = subtitle;

    // Page-specific init
    if (page === 'dashboard')    Dashboard.render();
    if (page === 'applications') Apps.render();
    if (page === 'profile')      Profile.load();
    if (page === 'billing')      Billing.load();

    // Close mobile sidebar
    Sidebar.close();
  },
};

// ─────────────────────────────────────────────────────────────
//  SIDEBAR (mobile)
// ─────────────────────────────────────────────────────────────
const Sidebar = {
  open() {
    document.getElementById('sidebar').classList.add('open');
    document.getElementById('sidebar-overlay').classList.remove('hidden');
  },
  close() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebar-overlay').classList.add('hidden');
  },
  toggle() {
    document.getElementById('sidebar').classList.contains('open') ? this.close() : this.open();
  },
};

// ─────────────────────────────────────────────────────────────
//  NOTIFICATIONS
// ─────────────────────────────────────────────────────────────
const Notifications = {
  generate(jobs) {
    const notifs = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    jobs.forEach(job => {
      // Follow-up 1 date checks
      if (job.followup_1_date) {
        const diff = daysUntil(job.followup_1_date);
        if (diff < 0) {
          notifs.push({ icon: '⚠️', type: 'overdue', text: `Follow-up overdue`, sub: `${job.company} · ${Math.abs(diff)}d ago`, jobId: job.id });
        } else if (diff === 0) {
          notifs.push({ icon: '📅', type: 'today', text: `Follow-up due today`, sub: `${job.company}`, jobId: job.id });
        } else if (diff <= 3) {
          notifs.push({ icon: '🔔', type: 'upcoming', text: `Follow-up in ${diff} day${diff !== 1 ? 's' : ''}`, sub: `${job.company}`, jobId: job.id });
        }
      }

      // Stale Applied applications (>14 days, no email sent)
      if (job.status === 'Applied' && !job.email_sent) {
        const age = daysSince(job.applied_at);
        if (age >= 14) {
          notifs.push({ icon: '💡', type: 'reminder', text: `Application may need follow-up`, sub: `${job.company} · ${age}d old`, jobId: job.id });
        }
      }
    });

    state.notifications = notifs;
    return notifs;
  },

  render() {
    const list = document.getElementById('notif-list');
    const dot  = document.getElementById('notif-dot');
    const { notifications } = state;

    if (!notifications.length) {
      list.innerHTML = `<div class="notif-empty-msg">You're all caught up! 🎉</div>`;
      dot.classList.add('hidden');
      return;
    }

    dot.classList.remove('hidden');
    list.innerHTML = notifications.map(n => `
      <div class="notif-item">
        <span class="notif-item-icon">${n.icon}</span>
        <div class="notif-item-text">
          <span class="notif-item-company">${escapeHtml(n.text)}</span><br/>
          <span>${escapeHtml(n.sub)}</span>
        </div>
      </div>
    `).join('');
  },

  clear() {
    state.notifications = [];
    this.render();
  },
};

// ─────────────────────────────────────────────────────────────
//  AI SUGGESTIONS
// ─────────────────────────────────────────────────────────────
const AI = {
  _pool: {
    Applied: [
      { icon: '📧', action: 'Send a follow-up email', detail: 'It\'s been a few days since you applied. A polite follow-up can put you back on the recruiter\'s radar — keep it brief and professional.', priority: 'High Priority' },
      { icon: '🔍', action: 'Research the company', detail: 'Deep-dive into their products, culture, mission, and recent news. The more you know, the more confident you\'ll feel in any conversation.', priority: 'Recommended' },
      { icon: '💼', action: 'Connect on LinkedIn', detail: 'Find the hiring manager or team members on LinkedIn. A personalized connection request can open doors.', priority: 'Recommended' },
    ],
    Interview: [
      { icon: '🎯', action: 'Prepare STAR method answers', detail: 'Practice Situation, Task, Action, Result stories for behavioral questions. Aim for 5–7 strong examples you can adapt to different questions.', priority: 'High Priority' },
      { icon: '👥', action: 'Research your interviewers', detail: 'Look up your interviewers on LinkedIn to understand their background and tailor your questions. People love talking about their work.', priority: 'High Priority' },
      { icon: '❓', action: 'Prepare thoughtful questions', detail: 'Have 3–5 insightful questions ready about team culture, technical challenges, and growth opportunities. This shows genuine interest.', priority: 'Recommended' },
    ],
    Offer: [
      { icon: '📝', action: 'Review the offer carefully', detail: 'Don\'t rush. Take 24–48 hours to evaluate salary, benefits, equity, PTO, start date, and growth potential. Everything is negotiable.', priority: 'High Priority' },
      { icon: '💰', action: 'Consider negotiating', detail: 'Most offers have room to negotiate. Focus on base salary, signing bonus, or additional PTO. Have market data ready to support your ask.', priority: 'Recommended' },
      { icon: '🎉', action: 'Celebrate this win!', detail: 'You earned this offer — take a moment to appreciate your hard work before making any decisions.', priority: 'Nice to Know' },
    ],
    Rejected: [
      { icon: '💬', action: 'Request feedback', detail: 'Politely ask the recruiter for feedback on your application or interview. This insight is invaluable and often underutilized.', priority: 'High Priority' },
      { icon: '📚', action: 'Document what you learned', detail: 'Note down their interview process, questions asked, and what you\'d do differently. This builds your interview knowledge base.', priority: 'Recommended' },
      { icon: '🚀', action: 'Keep your momentum', detail: 'Every rejection is a redirection. Review your materials, strengthen weak spots, and keep applying. The right opportunity is ahead.', priority: 'Encouragement' },
    ],
  },

  getSuggestion(job) {
    const pool = this._pool[job.status] || this._pool.Applied;
    let primary = { ...pool[0] };

    // Override based on follow-up date urgency
    const diff = daysUntil(job.followup_1_date);
    if (diff !== null) {
      if (diff < 0) {
        primary = { icon: '⚠️', action: 'Follow-up is overdue!', detail: `Your planned follow-up was ${Math.abs(diff)} day(s) ago. Reach out today — a brief, professional email is all it takes.`, priority: 'Urgent' };
      } else if (diff <= 2) {
        primary = { icon: '📅', action: `Follow-up in ${diff} day${diff !== 1 ? 's' : ''}`, detail: 'Your planned follow-up is approaching. Prepare your message now so you\'re ready when the time comes.', priority: 'High Priority' };
      }
    }

    // Stale applied
    const age = daysSince(job.applied_at);
    if (job.status === 'Applied' && age > 30 && diff === null) {
      primary = { icon: '⏰', action: 'This application is aging', detail: `It's been ${age} days since you applied. Consider sending a final follow-up or marking this application as inactive.`, priority: 'Heads Up' };
    }

    return { primary, others: pool.slice(1), age };
  },

  showModal(jobId) {
    const job = state.jobs.find(j => j.id === jobId);
    if (!job) return;

    const { primary, others, age } = this.getSuggestion(job);
    const statusColors = { Applied: 'badge-Applied', Interview: 'badge-Interview', Offer: 'badge-Offer', Rejected: 'badge-Rejected' };

    document.getElementById('ai-job-context').innerHTML = `
      <div class="ai-ctx-avatar">${escapeHtml(job.company.charAt(0).toUpperCase())}</div>
      <div>
        <div class="ai-ctx-company">${escapeHtml(job.company)}</div>
        <div class="ai-ctx-role">${escapeHtml(job.role)} · Applied ${age} day${age !== 1 ? 's' : ''} ago</div>
      </div>
      <div class="ai-ctx-badge">
        <span class="status-badge ${statusColors[job.status] || ''}">${escapeHtml(job.status)}</span>
      </div>
    `;

    document.getElementById('ai-primary-card').innerHTML = `
      <div class="ai-suggestion-icon">${primary.icon}</div>
      <div>
        <div class="ai-priority-label">${escapeHtml(primary.priority)}</div>
        <div class="ai-suggestion-action">${escapeHtml(primary.action)}</div>
        <div class="ai-suggestion-detail">${escapeHtml(primary.detail)}</div>
      </div>
    `;

    document.getElementById('ai-other-cards').innerHTML = others.map(s => `
      <div class="ai-other-item">
        <span class="ai-other-icon">${s.icon}</span>
        <div>
          <div class="ai-other-action">${escapeHtml(s.action)}</div>
          <div class="ai-other-detail">${escapeHtml(s.detail)}</div>
        </div>
      </div>
    `).join('');

    document.getElementById('ai-modal').classList.remove('hidden');
  },
};

// ─────────────────────────────────────────────────────────────
//  SPEEDOMETER  (Canvas 2D — animated needle gauge)
// ─────────────────────────────────────────────────────────────
const Speedometer = {
  // ── Config ──────────────────────────────────────────────────
  MAX: 50,                              // needle reaches max at this many apps

  // Gauge arc: starts at 200° (lower-left), sweeps 140° CW to 340° (lower-right),
  // passing through 270° (12 o'clock) at the midpoint.
  // All angles in canvas convention: 0 = 3 o'clock, clockwise positive.
  ANG_START: 200 * (Math.PI / 180),    // 200° → lower-left
  ANG_SWEEP: 140 * (Math.PI / 180),    // 140° total sweep

  // State
  _value: 0,
  _raf: null,

  // ── Geometry helper ─────────────────────────────────────────
  _geo(canvas) {
    const W  = canvas.clientWidth  || 262;
    const H  = canvas.clientHeight || 190;
    const cx = W / 2;
    const cy = H - 18;                  // pivot near the bottom
    const r  = Math.min(W * 0.42, cy * 0.96);
    return { W, H, cx, cy, r };
  },

  // ── Core draw ───────────────────────────────────────────────
  _draw(canvas, val) {
    const dpr = window.devicePixelRatio || 1;
    const { W, H, cx, cy, r } = this._geo(canvas);

    // Sync internal pixel buffer to CSS size × DPR
    if (canvas.width !== Math.round(W * dpr)) canvas.width  = Math.round(W * dpr);
    if (canvas.height !== Math.round(H * dpr)) canvas.height = Math.round(H * dpr);

    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);  // reset + apply DPR scale
    ctx.clearRect(0, 0, W, H);

    const S = this.ANG_START;
    const T = this.ANG_SWEEP;
    const pct = Math.max(0, Math.min(val / this.MAX, 1));

    // ── 1. Track (background arc) ──────────────────────────────
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, S, S + T);
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth   = 20;
    ctx.lineCap     = 'round';
    ctx.stroke();
    ctx.restore();

    // ── 2. Zone bands (coloured fill on track) ─────────────────
    const zones = [
      { from: 0,    to: 0.34, lo: '#fca5a5', hi: '#ef4444' },   // red
      { from: 0.34, to: 0.67, lo: '#fde68a', hi: '#f59e0b' },   // amber
      { from: 0.67, to: 1.00, lo: '#6ee7b7', hi: '#10b981' },   // green
    ];
    zones.forEach(({ from, to, lo }) => {
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, S + from * T, S + to * T);
      ctx.strokeStyle = lo;
      ctx.lineWidth   = 16;
      ctx.lineCap     = 'butt';
      ctx.stroke();
      ctx.restore();
    });

    // ── 3. Progress glow (filled arc up to current value) ──────
    if (pct > 0) {
      const arcColor = pct < 0.34 ? '#ef4444' : pct < 0.67 ? '#f59e0b' : '#10b981';
      // Outer glow pass
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, S, S + pct * T);
      ctx.strokeStyle = arcColor + '44';   // ~27% opacity
      ctx.lineWidth   = 26;
      ctx.lineCap     = 'round';
      ctx.stroke();
      ctx.restore();
      // Solid progress line
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, S, S + pct * T);
      ctx.strokeStyle = arcColor;
      ctx.lineWidth   = 14;
      ctx.lineCap     = 'round';
      ctx.stroke();
      ctx.restore();
    }

    // ── 4. Tick marks + labels ─────────────────────────────────
    const TOTAL_TICKS = 10;
    for (let i = 0; i <= TOTAL_TICKS; i++) {
      const f      = i / TOTAL_TICKS;
      const angle  = S + f * T;
      const isMajor = i % 5 === 0;
      const innerR  = r - (isMajor ? 28 : 17);
      const outerR  = r + 5;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(cx + innerR * cos, cy + innerR * sin);
      ctx.lineTo(cx + outerR * cos, cy + outerR * sin);
      ctx.strokeStyle = isMajor ? '#94a3b8' : '#cbd5e1';
      ctx.lineWidth   = isMajor ? 2.5 : 1.5;
      ctx.lineCap     = 'round';
      ctx.stroke();
      ctx.restore();

      if (isMajor) {
        const lr = innerR - 13;
        ctx.save();
        ctx.font         = `700 9.5px Inter,system-ui,sans-serif`;
        ctx.fillStyle    = '#94a3b8';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(Math.round(f * this.MAX), cx + lr * cos, cy + lr * sin);
        ctx.restore();
      }
    }

    // ── 5. Needle ──────────────────────────────────────────────
    const needleAngle = S + pct * T;
    const needleLen   = r - 24;
    const needleWidth = 4.5;
    const perpAngle   = needleAngle + Math.PI / 2;
    const tipX = cx + needleLen * Math.cos(needleAngle);
    const tipY = cy + needleLen * Math.sin(needleAngle);

    // Drop shadow
    ctx.save();
    ctx.shadowColor   = 'rgba(0,0,0,0.22)';
    ctx.shadowBlur    = 8;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 3;

    ctx.beginPath();
    ctx.moveTo(
      cx + needleWidth * Math.cos(perpAngle),
      cy + needleWidth * Math.sin(perpAngle),
    );
    ctx.lineTo(tipX, tipY);
    ctx.lineTo(
      cx - needleWidth * Math.cos(perpAngle),
      cy - needleWidth * Math.sin(perpAngle),
    );
    ctx.closePath();

    // Gradient: dark at root → bright purple at tip
    const grad = ctx.createLinearGradient(cx, cy, tipX, tipY);
    grad.addColorStop(0,   '#312e81');
    grad.addColorStop(0.5, '#4f46e5');
    grad.addColorStop(1,   '#a5b4fc');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();

    // ── 6. Centre hub ──────────────────────────────────────────
    // Outer ring
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, 13, 0, Math.PI * 2);
    ctx.fillStyle = '#4f46e5';
    ctx.shadowColor = 'rgba(79,70,229,0.5)';
    ctx.shadowBlur  = 10;
    ctx.fill();
    ctx.restore();
    // White middle
    ctx.beginPath();
    ctx.arc(cx, cy, 9, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    // Inner dot
    ctx.beginPath();
    ctx.arc(cx, cy, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = '#4f46e5';
    ctx.fill();

    // ── 7. Zone label (arc midpoint, inside the gauge) ─────────
    const zoneLabel = pct < 0.34
      ? '🌱 Starting Out'
      : pct < 0.67
        ? '⚡ Building Momentum'
        : '🔥 On Fire!';
    const zoneColor = pct < 0.34 ? '#ef4444' : pct < 0.67 ? '#f59e0b' : '#10b981';
    // Position: 42% of the way up from centre towards top of arc
    const labelY = cy - r * 0.44;
    ctx.save();
    ctx.font         = `700 10px Inter,system-ui,sans-serif`;
    ctx.fillStyle    = zoneColor;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(zoneLabel, cx, labelY);
    ctx.restore();

    // ── 8. Big value number ────────────────────────────────────
    const displayVal = Math.round(val);
    ctx.save();
    ctx.font         = `800 30px Inter,system-ui,sans-serif`;
    ctx.fillStyle    = '#0f172a';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(displayVal, cx, cy - 6);
    ctx.restore();
  },

  // ── Smooth animation (ease-out cubic) ───────────────────────
  animate(target) {
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
    const canvas = document.getElementById('speedometer-canvas');
    if (!canvas) return;

    const from = this._value;
    const diff  = target - from;
    const dur   = 900;           // ms
    const t0    = performance.now();

    const step = (now) => {
      const progress = Math.min((now - t0) / dur, 1);
      const eased    = 1 - Math.pow(1 - progress, 3);  // cubic ease-out
      this._draw(canvas, from + diff * eased);
      if (progress < 1) {
        this._raf = requestAnimationFrame(step);
      } else {
        this._value = target;
      }
    };
    this._raf = requestAnimationFrame(step);
  },

  // ── Public: update from summary data ────────────────────────
  update(summary) {
    const total = Object.values(summary).reduce((a, b) => a + b, 0);

    // Dynamic MAX: expand ceiling gracefully as apps grow
    if (total > this.MAX * 0.85) this.MAX = Math.ceil(total / 50) * 50;

    // Update sub-label
    const lbl = document.getElementById('spdo-track-label');
    if (lbl) lbl.textContent = `${total} / ${this.MAX} applications`;

    this.animate(total);
  },

  // ── Re-draw on window resize (responsive canvas) ────────────
  onResize() {
    const canvas = document.getElementById('speedometer-canvas');
    if (canvas) {
      // Force size re-sync then redraw at current value
      canvas.width = 0;
      this._draw(canvas, this._value);
    }
  },
};

// ─────────────────────────────────────────────────────────────
//  CHART (Chart.js doughnut)
// ─────────────────────────────────────────────────────────────
const ChartManager = {
  COLORS: {
    Applied:   '#3b82f6',
    Interview: '#f59e0b',
    Offer:     '#10b981',
    Rejected:  '#ef4444',
  },

  render(summary) {
    const ctx = document.getElementById('status-chart');
    if (!ctx) return;

    const total = Object.values(summary).reduce((a, b) => a + b, 0);
    document.getElementById('chart-total').textContent = total;

    const labels = ['Applied', 'Interview', 'Offer', 'Rejected'];
    const data   = labels.map(l => summary[l] || 0);
    const colors = labels.map(l => this.COLORS[l]);

    if (state.chart) {
      state.chart.data.datasets[0].data = data;
      state.chart.update('active');
    } else {
      state.chart = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels,
          datasets: [{ data, backgroundColor: colors, borderWidth: 0, hoverOffset: 6 }],
        },
        options: {
          responsive: false,
          cutout: '68%',
          animation: { animateScale: true, duration: 600 },
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: (ctx) => {
                  const pct = total ? Math.round(ctx.raw / total * 100) : 0;
                  return ` ${ctx.label}: ${ctx.raw}  (${pct}%)`;
                },
              },
            },
          },
        },
      });
    }

    // Render legend
    document.getElementById('chart-legend').innerHTML = labels.map((l, i) => `
      <div class="legend-item">
        <span class="legend-label">
          <span class="legend-dot" style="background:${colors[i]}"></span>
          ${escapeHtml(l)}
        </span>
        <span class="legend-count">${data[i]}</span>
      </div>
    `).join('');
  },
};

// ─────────────────────────────────────────────────────────────
//  DASHBOARD
// ─────────────────────────────────────────────────────────────
const Dashboard = {
  render() {
    const { summary, jobs } = state;
    const total = Object.values(summary).reduce((a, b) => a + b, 0);

    // Stat cards
    document.getElementById('stat-total').textContent    = total;
    document.getElementById('stat-applied').textContent  = summary.Applied   || 0;
    document.getElementById('stat-interview').textContent= summary.Interview || 0;
    document.getElementById('stat-offer').textContent    = summary.Offer     || 0;
    document.getElementById('stat-rejected').textContent = summary.Rejected  || 0;

    // Nav chip
    document.getElementById('nav-chip').textContent = total;

    // Speedometer gauge
    Speedometer.update(summary);

    // Chart
    ChartManager.render(summary);

    // Recent apps
    this._renderRecent(jobs.slice(0, 5));

    // AI insight
    this._renderAIInsight(jobs);
  },

  _renderRecent(jobs) {
    const el = document.getElementById('recent-apps');
    if (!jobs.length) {
      el.innerHTML = `<div class="dash-empty-msg">No applications yet. Add one to get started!</div>`;
      return;
    }
    const statusColors = { Applied: '#3b82f6', Interview: '#f59e0b', Offer: '#10b981', Rejected: '#ef4444' };
    el.innerHTML = jobs.map(job => `
      <div class="recent-item" data-id="${job.id}" title="${escapeHtml(job.company)} — ${escapeHtml(job.role)}">
        <div class="recent-avatar">${escapeHtml(job.company.charAt(0).toUpperCase())}</div>
        <div class="recent-info">
          <div class="recent-company">${escapeHtml(job.company)}</div>
          <div class="recent-role">${escapeHtml(job.role)}</div>
        </div>
        <div class="recent-badge">
          <span class="status-badge badge-${job.status}" style="border-left: 2px solid ${statusColors[job.status] || '#94a3b8'}">${escapeHtml(job.status)}</span>
        </div>
      </div>
    `).join('');

    // Clicking a recent item navigates to Applications
    el.querySelectorAll('.recent-item').forEach(item => {
      item.addEventListener('click', () => Router.go('applications'));
    });
  },

  _renderAIInsight(jobs) {
    const el = document.getElementById('ai-insight-area');
    if (!jobs.length) {
      el.innerHTML = `<div class="dash-empty-msg">Add applications to get AI-powered insights.</div>`;
      return;
    }

    // Pick up to 2 most urgent jobs
    const urgent = [...jobs].sort((a, b) => {
      const scoreA = this._urgencyScore(a);
      const scoreB = this._urgencyScore(b);
      return scoreB - scoreA;
    }).slice(0, 2);

    el.innerHTML = urgent.map(job => {
      const { primary } = AI.getSuggestion(job);
      return `
        <div class="ai-insight-row" data-jobid="${job.id}">
          <span class="ai-insight-icon">${primary.icon}</span>
          <div class="ai-insight-body">
            <div class="ai-insight-title">${escapeHtml(primary.action)}</div>
            <div class="ai-insight-desc">${escapeHtml(primary.detail.substring(0, 80))}…</div>
            <div class="ai-insight-company">${escapeHtml(job.company)} · ${escapeHtml(job.status)}</div>
          </div>
        </div>
      `;
    }).join('');

    el.querySelectorAll('.ai-insight-row').forEach(row => {
      row.addEventListener('click', () => AI.showModal(Number(row.dataset.jobid)));
    });
  },

  _urgencyScore(job) {
    let score = 0;
    if (job.status === 'Interview') score += 30;
    if (job.status === 'Offer') score += 40;
    const diff = daysUntil(job.followup_1_date);
    if (diff !== null && diff <= 0) score += 50;
    else if (diff !== null && diff <= 3) score += 20;
    score += Math.min(daysSince(job.applied_at), 30);
    return score;
  },
};

// ─────────────────────────────────────────────────────────────
//  APPLICATIONS
// ─────────────────────────────────────────────────────────────
const Apps = {
  render() {
    const filtered = this._filtered();
    const grid  = document.getElementById('apps-grid');
    const empty = document.getElementById('apps-empty');
    const fEmpty= document.getElementById('apps-filter-empty');

    grid.innerHTML = '';
    empty.classList.add('hidden');
    fEmpty.classList.add('hidden');

    if (state.jobs.length === 0) {
      empty.classList.remove('hidden');
      return;
    }

    if (filtered.length === 0) {
      fEmpty.classList.remove('hidden');
      return;
    }

    filtered.forEach((job, i) => {
      const card = this._buildCard(job);
      card.style.animationDelay = `${i * 0.04}s`;
      card.classList.add('card-enter');
      if (job.id === state.newlyAddedId) card.classList.add('newly-added');
      grid.appendChild(card);
    });
  },

  _filtered() {
    let jobs = state.jobs;
    if (state.currentFilter !== 'all') jobs = jobs.filter(j => j.status === state.currentFilter);
    if (state.searchQuery) {
      const q = state.searchQuery.toLowerCase();
      jobs = jobs.filter(j =>
        j.company.toLowerCase().includes(q) ||
        j.role.toLowerCase().includes(q) ||
        (j.location && j.location.toLowerCase().includes(q))
      );
    }
    return jobs;
  },

  _buildCard(job) {
    const card = document.createElement('div');
    card.className = `job-card card-${job.status}`;
    card.dataset.id = job.id;

    const appliedStr = formatDate(job.applied_at) || '—';
    const token = getToken();

    // Follow-up chip
    let followupHtml = '';
    const diff = daysUntil(job.followup_1_date);
    if (diff !== null) {
      if (diff < 0)       followupHtml = `<span class="jc-followup-chip followup-overdue">⚠️ FU overdue</span>`;
      else if (diff === 0) followupHtml = `<span class="jc-followup-chip followup-soon">📅 FU today</span>`;
      else if (diff <= 3)  followupHtml = `<span class="jc-followup-chip followup-soon">📅 FU in ${diff}d</span>`;
      else                followupHtml = `<span class="jc-followup-chip followup-ok">📅 FU ${formatDate(job.followup_1_date)}</span>`;
    }

    // File links
    const resumeHtml = job.resume_file
      ? `<a class="jc-file-link" href="/uploads/${job.user_id}/${encodeURIComponent(job.resume_file)}?token=${encodeURIComponent(token || '')}" target="_blank">📄 Resume</a>`
      : '';
    const coverHtml = job.cover_letter_file
      ? `<a class="jc-file-link" href="/uploads/${job.user_id}/${encodeURIComponent(job.cover_letter_file)}?token=${encodeURIComponent(token || '')}" target="_blank">📝 Cover</a>`
      : '';

    const statusOptions = ['Applied', 'Interview', 'Offer', 'Rejected']
      .map(s => `<option value="${s}"${s === job.status ? ' selected' : ''}>${s}</option>`)
      .join('');

    const notesHtml = job.notes
      ? `<div class="jc-notes">${escapeHtml(job.notes)}</div>`
      : '';

    card.innerHTML = `
      <div class="jc-header">
        <div class="jc-company-row">
          <div class="jc-avatar">${escapeHtml(job.company.charAt(0).toUpperCase())}</div>
          <div class="jc-company-text">
            <div class="jc-company">${escapeHtml(job.company)}</div>
            <div class="jc-role">${escapeHtml(job.role)}</div>
          </div>
        </div>
        <div class="status-select-wrap">
          <select class="status-select sel-${job.status}" data-job-id="${job.id}" aria-label="Status">
            ${statusOptions}
          </select>
        </div>
      </div>

      <div class="jc-meta">
        ${job.location ? `<span class="jc-meta-chip">📍 ${escapeHtml(job.location)}</span>` : ''}
        <span class="jc-meta-chip">📅 ${appliedStr}</span>
        ${followupHtml}
        ${job.email_sent ? `<span class="jc-meta-chip">✉️ Emailed</span>` : ''}
      </div>

      ${notesHtml}

      <div class="jc-footer">
        <div class="jc-files">${resumeHtml}${coverHtml}</div>
        <div class="jc-actions">
          <button class="jc-btn edit" data-action="edit" data-job-id="${job.id}">Edit</button>
          <button class="jc-btn ai"   data-action="ai"   data-job-id="${job.id}">🤖 AI</button>
          <button class="jc-btn letter" data-action="letter" data-job-id="${job.id}" data-role="${escapeHtml(job.role)}" data-company="${escapeHtml(job.company)}">✍️ Letter</button>
          <button class="jc-btn del"  data-action="del"  data-job-id="${job.id}" data-company="${escapeHtml(job.company)}">Delete</button>
        </div>
      </div>
    `;

    return card;
  },

  setFilter(filter) {
    state.currentFilter = filter;
    document.querySelectorAll('.filter-pill').forEach(pill => {
      pill.classList.toggle('active', pill.dataset.filter === filter);
    });
    this.render();
  },

  setSearch(query) {
    state.searchQuery = query;
    this.render();
  },
};

// ─────────────────────────────────────────────────────────────
//  JOB MODAL
// ─────────────────────────────────────────────────────────────
const JobModal = {
  open(job = null) {
    const isEdit = !!job;
    document.getElementById('job-modal-title').textContent    = isEdit ? 'Edit Application' : 'Add Application';
    document.getElementById('job-modal-subtitle').textContent = isEdit ? 'Update your application details' : 'Track a new job in your pipeline';
    document.getElementById('modal-save').textContent         = isEdit ? 'Save Changes' : 'Save Application';
    document.getElementById('edit-job-id').value              = isEdit ? job.id : '';

    // Hide/show file upload (not supported in PUT)
    document.getElementById('file-upload-section').style.display = isEdit ? 'none' : '';

    // Fill fields
    const f = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
    f('f-company',  isEdit ? job.company : '');
    f('f-role',     isEdit ? job.role : '');
    f('f-location', isEdit ? job.location : '');
    f('f-status',   isEdit ? job.status : 'Applied');
    f('f-email',    isEdit ? job.email : '');
    f('f-followup1',isEdit ? (job.followup_1_date || '') : '');
    f('f-notes',    isEdit ? job.notes : '');

    document.getElementById('job-modal').classList.remove('hidden');
    setTimeout(() => document.getElementById('f-company').focus(), 50);
  },

  close() {
    document.getElementById('job-modal').classList.add('hidden');
    document.getElementById('job-form').reset();
    document.getElementById('edit-job-id').value = '';
    document.getElementById('file-upload-section').style.display = '';
  },

  async handleSubmit(e) {
    e.preventDefault();
    const editId = document.getElementById('edit-job-id').value;
    const btn = document.getElementById('modal-save');
    btn.textContent = 'Saving…';
    btn.disabled = true;

    try {
      if (editId) {
        // Edit mode — send JSON (PUT doesn't support files)
        const status = document.getElementById('f-status').value;
        await API.updateJob(editId, {
          company:         document.getElementById('f-company').value.trim(),
          role:            document.getElementById('f-role').value.trim(),
          location:        document.getElementById('f-location').value.trim(),
          status,
          email:           document.getElementById('f-email').value.trim(),
          followup_1_date: document.getElementById('f-followup1').value || null,
          notes:           document.getElementById('f-notes').value.trim(),
        });
        if (status === 'Offer') Celebrate.show();
        Toast.success('Application updated!');
      } else {
        // Create mode — use FormData for file upload
        const form = document.getElementById('job-form');
        const formData = new FormData(form);
        formData.set('email_sent', '0');
        const result = await API.createJob(formData);
        state.newlyAddedId = result.id;
        if (formData.get('status') === 'Offer') Celebrate.show();
        Toast.success('Application added!');
      }
      this.close();
      await refresh();
    } catch (err) {
      Toast.error(err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = editId ? 'Save Changes' : 'Save Application';
    }
  },
};

// ─────────────────────────────────────────────────────────────
//  JOB SEARCH
// ─────────────────────────────────────────────────────────────
const JobSearch = {
  async search() {
    const role     = document.getElementById('job-search-role').value.trim() || 'developer';
    const location = document.getElementById('job-search-location').value.trim() || 'Canada';
    const container = document.getElementById('search-results');

    container.innerHTML = `
      <div class="search-placeholder">
        <div class="spinner" style="margin: 0 auto;"></div>
        <p style="color:var(--slate-500);margin-top:12px;">Searching for <strong>${escapeHtml(role)}</strong> in <strong>${escapeHtml(location)}</strong>…</p>
      </div>
    `;

    try {
      const jobs = await API.searchJobs(role, location);
      if (!jobs.length) {
        container.innerHTML = `
          <div class="search-placeholder">
            <div class="search-placeholder-icon">😕</div>
            <p>No jobs found for that search. Try different keywords.</p>
          </div>`;
        return;
      }
      this._renderResults(jobs, container);
    } catch (err) {
      container.innerHTML = `
        <div class="search-placeholder">
          <div class="search-placeholder-icon">⚠️</div>
          <p style="color:var(--rejected)">Error: ${escapeHtml(err.message)}</p>
        </div>`;
    }
  },

  _renderResults(jobs, container) {
    const grid = document.createElement('div');
    grid.className = 'search-results-grid';

    grid.innerHTML = jobs.map(job => `
      <div class="search-job-card">
        <div class="sj-header">
          <div>
            <div class="sj-title">${escapeHtml(job.title)}</div>
            <div class="sj-company">${escapeHtml(job.company)}</div>
          </div>
          <span class="sj-source-badge">${escapeHtml(job.source)}</span>
        </div>
        <div class="sj-meta">
          <span class="sj-meta-item">📍 ${escapeHtml(job.location)}</span>
          ${job.salary       ? `<span class="sj-meta-item">💰 ${escapeHtml(job.salary)}</span>` : ''}
          ${job.level        ? `<span class="sj-meta-item">📊 ${escapeHtml(job.level)}</span>` : ''}
          ${job.category     ? `<span class="sj-meta-item">🏷️ ${escapeHtml(job.category)}</span>` : ''}
          <span class="sj-meta-item">🕐 ${escapeHtml(job.posted_date)}</span>
        </div>
        ${job.description ? `<p class="sj-desc">${escapeHtml(job.description)}</p>` : ''}
        <div class="sj-actions">
          <button class="sj-extract-btn"
            data-title="${escapeHtml(job.title)}"
            data-company="${escapeHtml(job.company)}"
            data-location="${escapeHtml(job.location)}"
            data-url="${escapeHtml(job.url)}">
            Add to Tracker
          </button>
          <a class="sj-visit-btn" href="${escapeHtml(job.url)}" target="_blank" rel="noopener noreferrer">
            View Job →
          </a>
        </div>
      </div>
    `).join('');

    container.innerHTML = '';
    container.appendChild(grid);

    // Extract info buttons
    grid.querySelectorAll('.sj-extract-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        JobModal.open(null);
        setTimeout(() => {
          document.getElementById('f-company').value  = btn.dataset.company;
          document.getElementById('f-role').value     = btn.dataset.title;
          document.getElementById('f-location').value = btn.dataset.location;
          document.getElementById('f-notes').value    = `Applied via job search\nURL: ${btn.dataset.url}`;
          document.getElementById('f-company').focus();
        }, 80);
      });
    });
  },
};

// ─────────────────────────────────────────────────────────────
//  CELEBRATE
// ─────────────────────────────────────────────────────────────
const Celebrate = {
  show() {
    document.getElementById('celebrate-modal').classList.remove('hidden');
    this._confetti();
  },
  hide() {
    document.getElementById('celebrate-modal').classList.add('hidden');
  },
  _confetti() {
    const emojis = ['🎉', '🎊', '✨', '🌟', '💫', '🎈'];
    for (let i = 0; i < 40; i++) {
      const el = document.createElement('div');
      el.className = 'confetti-piece';
      el.textContent = emojis[Math.floor(Math.random() * emojis.length)];
      el.style.cssText = `
        left:${Math.random() * 100}vw;
        top:-40px;
        font-size:${Math.random() * 18 + 18}px;
        animation-duration:${Math.random() * 2 + 2.5}s;
        animation-delay:${Math.random() * 0.8}s;
      `;
      document.body.appendChild(el);
      el.addEventListener('animationend', () => el.remove(), { once: true });
    }
  },
};

// ─────────────────────────────────────────────────────────────
//  GLOBAL REFRESH
// ─────────────────────────────────────────────────────────────
async function refresh() {
  try {
    const [jobs, summary] = await Promise.all([API.getJobs(), API.getSummary()]);
    state.jobs    = jobs;
    state.summary = summary;

    Notifications.generate(jobs);
    Notifications.render();

    if (state.currentPage === 'dashboard')    Dashboard.render();
    if (state.currentPage === 'applications') Apps.render();

    // Reset newly added highlight after one render
    state.newlyAddedId = null;
  } catch (err) {
    Toast.error(err.message);
  }
}

// ─────────────────────────────────────────────────────────────
//  EVENT LISTENERS — AUTH
// ─────────────────────────────────────────────────────────────
document.querySelectorAll('.auth-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const mode = tab.dataset.target;
    const isLogin = mode === 'login';
    document.getElementById('login-form').classList.toggle('hidden', !isLogin);
    document.getElementById('register-form').classList.toggle('hidden', isLogin);
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.toggle('active', t.dataset.target === mode));
    const subEl = document.getElementById('auth-form-subtitle');
    if (subEl) subEl.textContent = isLogin ? 'Sign in to continue' : 'Create your free account';
  });
});

document.getElementById('login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type=submit]');
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  btn.textContent = 'Signing in…'; btn.disabled = true;
  try {
    const user = await API.login(username, password);
    Auth.setSession(user);
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    await refresh();
    Router.go('dashboard');
  } catch (err) {
    Toast.error(err.message);
  } finally {
    btn.textContent = 'Sign In →'; btn.disabled = false;
  }
});

document.getElementById('register-form').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type=submit]');
  const errorEl = document.getElementById('register-error');
  const username = document.getElementById('register-username').value.trim();
  const email    = document.getElementById('register-email').value.trim();
  const password = document.getElementById('register-password').value;
  const confirm  = document.getElementById('register-confirm').value;

  const showError = msg => {
    errorEl.textContent = msg;
    errorEl.classList.remove('hidden');
    const confirmInput = document.getElementById('register-confirm');
    confirmInput.classList.add('field-shake');
    confirmInput.addEventListener('animationend', () => confirmInput.classList.remove('field-shake'), { once: true });
  };

  errorEl.classList.add('hidden');

  if (!username || !email || !password || !confirm) {
    return showError('Please fill in all fields.');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return showError('Please enter a valid email address.');
  }
  if (password.length < 6) {
    return showError('Password must be at least 6 characters.');
  }
  if (password !== confirm) {
    return showError('Passwords do not match.');
  }

  btn.textContent = 'Creating…'; btn.disabled = true;
  try {
    const user = await API.register(username, email, password);
    Auth.setSession(user);
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    await refresh();
    Router.go('dashboard');
    Toast.success(`Welcome to Pathly, ${user.username}!`);
  } catch (err) {
    showError(err.message);
  } finally {
    btn.textContent = 'Create Account →'; btn.disabled = false;
  }
});

document.getElementById('logout-btn').addEventListener('click', () => Auth.logout());

// ─────────────────────────────────────────────────────────────
//  EVENT LISTENERS — NAVIGATION
// ─────────────────────────────────────────────────────────────
document.querySelectorAll('[data-page]').forEach(el => {
  el.addEventListener('click', () => Router.go(el.dataset.page));
});

document.getElementById('menu-btn').addEventListener('click', () => Sidebar.toggle());
document.getElementById('sidebar-overlay').addEventListener('click', () => Sidebar.close());

// ─────────────────────────────────────────────────────────────
//  EVENT LISTENERS — HEADER ACTIONS
// ─────────────────────────────────────────────────────────────
document.getElementById('header-add-btn').addEventListener('click', () => JobModal.open());

// Global search
document.getElementById('global-search').addEventListener('input', e => {
  state.searchQuery = e.target.value.trim();
  if (state.currentPage !== 'applications') {
    Router.go('applications');
    // Sync the apps search input too
    document.getElementById('apps-search').value = state.searchQuery;
  }
  Apps.render();
});

// Notification bell toggle
document.getElementById('notif-btn').addEventListener('click', e => {
  e.stopPropagation();
  document.getElementById('notif-dropdown').classList.toggle('hidden');
});
document.getElementById('notif-clear').addEventListener('click', () => Notifications.clear());

// Close notif dropdown when clicking outside
document.addEventListener('click', e => {
  if (!document.getElementById('notif-btn').contains(e.target)) {
    document.getElementById('notif-dropdown').classList.add('hidden');
  }
});

// ─────────────────────────────────────────────────────────────
//  EVENT LISTENERS — APPLICATIONS PAGE
// ─────────────────────────────────────────────────────────────
['apps-add-btn', 'empty-add-btn', 'qa-add-btn', 'header-add-btn'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('click', () => JobModal.open());
});

// Filter pills (delegated to container)
document.getElementById('filter-pills').addEventListener('click', e => {
  const pill = e.target.closest('.filter-pill');
  if (pill) Apps.setFilter(pill.dataset.filter);
});

// App search input
document.getElementById('apps-search').addEventListener('input', e => {
  Apps.setSearch(e.target.value.trim());
  document.getElementById('global-search').value = e.target.value;
});

// Card grid event delegation (status change, edit, delete, AI)
document.getElementById('apps-grid').addEventListener('change', e => {
  const sel = e.target.closest('.status-select');
  if (!sel) return;
  const jobId    = Number(sel.dataset.jobId);
  const newStatus = sel.value;
  sel.className = `status-select sel-${newStatus}`;
  if (newStatus === 'Offer') Celebrate.show();
  API.updateJob(jobId, { status: newStatus })
    .then(() => refresh())
    .catch(err => Toast.error(err.message));
});

document.getElementById('apps-grid').addEventListener('click', e => {
  const editBtn   = e.target.closest('[data-action="edit"]');
  const aiBtn     = e.target.closest('[data-action="ai"]');
  const letterBtn = e.target.closest('[data-action="letter"]');
  const delBtn    = e.target.closest('[data-action="del"]');

  if (editBtn) {
    const job = state.jobs.find(j => j.id === Number(editBtn.dataset.jobId));
    if (job) JobModal.open(job);
  } else if (aiBtn) {
    AI.showModal(Number(aiBtn.dataset.jobId));
  } else if (letterBtn) {
    const jobId   = Number(letterBtn.dataset.jobId);
    const label   = `${letterBtn.dataset.role} @ ${letterBtn.dataset.company}`;
    CoverLetter.show(jobId, null, label);
  } else if (delBtn) {
    const jobId   = Number(delBtn.dataset.jobId);
    const company = delBtn.dataset.company;
    // Inline confirmation — turn button into confirm prompt
    if (delBtn.dataset.confirming) {
      API.deleteJob(jobId)
        .then(() => { Toast.success(`Deleted ${company}`); return refresh(); })
        .catch(err => Toast.error(err.message));
    } else {
      delBtn.dataset.confirming = 'yes';
      delBtn.textContent = 'Sure?';
      delBtn.style.background = 'var(--rejected-light)';
      delBtn.style.color = 'var(--rejected)';
      delBtn.style.borderColor = 'var(--rejected)';
      setTimeout(() => {
        if (delBtn.dataset.confirming) {
          delete delBtn.dataset.confirming;
          delBtn.textContent = 'Delete';
          delBtn.style.cssText = '';
        }
      }, 2500);
    }
  }
});

// View all link on dashboard
document.getElementById('view-all-link').addEventListener('click', () => Router.go('applications'));

// ─────────────────────────────────────────────────────────────
//  EVENT LISTENERS — JOB MODAL
// ─────────────────────────────────────────────────────────────
document.getElementById('modal-close').addEventListener('click',  () => JobModal.close());
document.getElementById('modal-cancel').addEventListener('click', () => JobModal.close());
document.getElementById('job-form').addEventListener('submit', (e) => JobModal.handleSubmit(e));

// Close modal on backdrop click
document.getElementById('job-modal').addEventListener('click', e => {
  if (e.target === document.getElementById('job-modal')) JobModal.close();
});

// ─────────────────────────────────────────────────────────────
//  EVENT LISTENERS — AI MODAL
// ─────────────────────────────────────────────────────────────
document.getElementById('ai-modal-close').addEventListener('click', () => {
  document.getElementById('ai-modal').classList.add('hidden');
});
document.getElementById('ai-modal').addEventListener('click', e => {
  if (e.target === document.getElementById('ai-modal')) document.getElementById('ai-modal').classList.add('hidden');
});

// ─────────────────────────────────────────────────────────────
//  EVENT LISTENERS — CELEBRATE MODAL
// ─────────────────────────────────────────────────────────────
document.getElementById('celebrate-close').addEventListener('click', () => Celebrate.hide());
document.getElementById('celebrate-modal').addEventListener('click', e => {
  if (e.target === document.getElementById('celebrate-modal')) Celebrate.hide();
});

// ─────────────────────────────────────────────────────────────
//  EVENT LISTENERS — JOB SEARCH
// ─────────────────────────────────────────────────────────────
document.getElementById('search-submit-btn').addEventListener('click', () => JobSearch.search());
document.getElementById('job-search-role').addEventListener('keydown', e => {
  if (e.key === 'Enter') JobSearch.search();
});
document.getElementById('job-search-location').addEventListener('keydown', e => {
  if (e.key === 'Enter') JobSearch.search();
});

// ─────────────────────────────────────────────────────────────
//  PROFILE
// ─────────────────────────────────────────────────────────────
const Profile = {
  _loaded: false,
  _selectedRoles: [],

  async load() {
    if (this._loaded) return;
    this._loaded = false; // always refresh on nav
    try {
      const info = await API.getProfileInfo();
      this._fillForm(info);
      const profiles = await API.getResumeProfiles();
      this._renderProfiles(profiles);
      if (info.resume_text) {
        document.getElementById('ai-tools-section').style.display = 'block';
      }
    } catch (err) {
      Toast.error(err.message);
    }
  },

  _fillForm(info) {
    const f = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
    f('pf-full-name',        info.full_name);
    f('pf-phone',            info.phone);
    f('pf-location',         info.location);
    f('pf-linkedin',         info.linkedin);
    f('pf-desired-role',     info.desired_role);
    f('pf-desired-location', info.desired_location);
    f('pf-work-auth',        info.work_auth);
  },

  async saveInfo(e) {
    e.preventDefault();
    const btn = document.getElementById('profile-save-btn');
    btn.textContent = 'Saving…'; btn.disabled = true;
    try {
      await API.saveProfileInfo({
        full_name:        document.getElementById('pf-full-name').value.trim(),
        phone:            document.getElementById('pf-phone').value.trim(),
        location:         document.getElementById('pf-location').value.trim(),
        linkedin:         document.getElementById('pf-linkedin').value.trim(),
        desired_role:     document.getElementById('pf-desired-role').value.trim(),
        desired_location: document.getElementById('pf-desired-location').value.trim(),
        work_auth:        document.getElementById('pf-work-auth').value,
      });
      Toast.success('Profile saved!');
    } catch (err) {
      Toast.error(err.message);
    } finally {
      btn.textContent = 'Save Profile'; btn.disabled = false;
    }
  },

  async uploadResume() {
    const btn       = document.getElementById('resume-upload-btn');
    const statusEl  = document.getElementById('resume-status');
    const fileInput = document.getElementById('resume-file-input');
    const pasteArea = document.getElementById('resume-paste-area');

    btn.textContent = 'Uploading…'; btn.disabled = true;
    statusEl.className = 'resume-status hidden';

    try {
      let result;
      if (fileInput.files[0]) {
        const fd = new FormData();
        fd.append('resume', fileInput.files[0]);
        result = await API.uploadResume(fd);
      } else if (pasteArea.value.trim()) {
        const fd = new FormData();
        fd.append('resume_text', pasteArea.value.trim());
        result = await API.uploadResume(fd);
      } else {
        throw new Error('Please upload a file or paste resume text.');
      }

      statusEl.className = 'resume-status ok';
      statusEl.textContent = `✅ Resume saved (${result.chars} chars)${result.warning ? ' — ' + result.warning : ''}`;
      statusEl.classList.remove('hidden');
      document.getElementById('ai-tools-section').style.display = 'block';
    } catch (err) {
      statusEl.className = 'resume-status err';
      statusEl.textContent = '❌ ' + err.message;
      statusEl.classList.remove('hidden');
    } finally {
      btn.textContent = 'Upload Resume'; btn.disabled = false;
    }
  },

  async suggestRoles() {
    const btn = document.getElementById('suggest-roles-btn');
    btn.disabled = true; btn.querySelector('.ai-tool-label').textContent = 'Analyzing…';
    try {
      const { roles } = await API.suggestRoles();
      this._showRolesModal(roles);
    } catch (err) {
      Toast.error(err.message);
    } finally {
      btn.disabled = false; btn.querySelector('.ai-tool-label').textContent = 'Suggest Roles';
    }
  },

  _showRolesModal(roles) {
    this._selectedRoles = [];
    const list = document.getElementById('roles-list');
    list.innerHTML = roles.map((r, i) => `
      <label class="role-option">
        <input type="checkbox" value="${i}" data-title="${escapeHtml(r.title)}" data-cat="${escapeHtml(r.category || '')}">
        <div class="role-option-text">
          <span class="role-option-title">${escapeHtml(r.title)}</span>
          <span class="role-option-cat">${escapeHtml(r.category || '')}</span>
        </div>
      </label>
    `).join('');

    list.querySelectorAll('input[type=checkbox]').forEach(cb => {
      cb.addEventListener('change', () => {
        const checked = list.querySelectorAll('input:checked');
        if (checked.length > 3) { cb.checked = false; Toast.info('Select up to 3 roles.'); return; }
        this._selectedRoles = Array.from(checked).map(c => ({ title: c.dataset.title, category: c.dataset.cat }));
      });
    });

    document.getElementById('roles-modal').classList.remove('hidden');
  },

  async generateProfiles() {
    if (!this._selectedRoles.length) { Toast.info('Select at least one role.'); return; }
    document.getElementById('roles-modal').classList.add('hidden');

    const card = document.getElementById('resume-profiles-card');
    card.style.display = 'block';
    const list = document.getElementById('resume-profiles-list');

    // Show spinner cards
    list.innerHTML = this._selectedRoles.map(r => `
      <div class="rp-card rp-generating">
        <div><span class="rp-spinner"></span>${escapeHtml(r.title)}</div>
        <div class="rp-card-category">${escapeHtml(r.category)}</div>
        <div style="font-size:.75rem;color:var(--slate-400);">Generating…</div>
      </div>
    `).join('');

    try {
      const { profiles } = await API.generateProfiles(this._selectedRoles);
      this._renderProfiles(profiles);
      Toast.success('Resume profiles generated!');
    } catch (err) {
      Toast.error(err.message);
      card.style.display = 'none';
    }
  },

  _renderProfiles(profiles) {
    if (!profiles || !profiles.length) return;
    const card = document.getElementById('resume-profiles-card');
    const list = document.getElementById('resume-profiles-list');
    card.style.display = 'block';
    list.innerHTML = profiles.map(p => {
      const keywords = JSON.parse(p.keywords || '[]').slice(0, 6);
      return `
        <div class="rp-card">
          <div class="rp-card-role">${escapeHtml(p.role_label)}</div>
          <div class="rp-card-category">${escapeHtml(p.role_category || '')}</div>
          <div class="rp-card-keywords">
            ${keywords.map(k => `<span class="rp-keyword">${escapeHtml(k)}</span>`).join('')}
          </div>
          <div class="rp-card-actions">
            <button class="rp-btn rp-btn-view" onclick="window.open('/resume/${p.id}','_blank')">View PDF</button>
          </div>
        </div>
      `;
    }).join('');

    // Show generate profiles button now that roles are selected
    document.getElementById('gen-profiles-btn').style.display = 'flex';
  },
};

// ─────────────────────────────────────────────────────────────
//  BILLING
// ─────────────────────────────────────────────────────────────
const Billing = {
  async load() {
    try {
      const status = await API.getBillingStatus();
      this._render(status);
    } catch (err) {
      Toast.error(err.message);
    }
  },

  _render(s) {
    const titleEl = document.getElementById('billing-plan-title');
    const descEl  = document.getElementById('billing-plan-desc');
    const cardEl  = document.getElementById('billing-status-card');

    if (s.status === 'trial') {
      const daysLeft = Math.max(0, Math.ceil((s.trial_ends_at * 1000 - Date.now()) / 86400000));
      const pct      = Math.max(0, Math.min(100, Math.round((30 - daysLeft) / 30 * 100)));
      titleEl.textContent = 'Free Trial';
      descEl.textContent  = `${daysLeft} day${daysLeft !== 1 ? 's' : ''} remaining`;
      cardEl.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <span style="font-weight:700;color:var(--slate-800);">Trial Period</span>
          <span style="font-size:.82rem;color:var(--slate-500);">${daysLeft} days left</span>
        </div>
        <div class="billing-trial-bar"><div class="billing-trial-fill" style="width:${pct}%"></div></div>
        <p style="font-size:.8rem;color:var(--slate-500);margin:8px 0 16px;">After your trial, Pathly is $49.99/month. Cancel anytime.</p>
        <button class="btn-primary-lg" id="upgrade-btn">Upgrade to Pro →</button>
      `;
      document.getElementById('upgrade-btn')?.addEventListener('click', () => this.upgrade());
    } else if (s.status === 'active') {
      const renewDate = s.current_period_end ? new Date(s.current_period_end * 1000).toLocaleDateString('en-CA', { month: 'long', day: 'numeric', year: 'numeric' }) : '—';
      titleEl.textContent = 'Pro Plan';
      descEl.textContent  = 'Full access to all features';
      cardEl.innerHTML = `
        <div style="display:flex;align-items:center;gap:12px;">
          <span style="font-size:2rem;">✅</span>
          <div>
            <div style="font-weight:700;color:var(--slate-800);">Active Subscription</div>
            <div style="font-size:.82rem;color:var(--slate-500);">Renews ${renewDate} · $49.99/month</div>
          </div>
        </div>
      `;
    } else {
      titleEl.textContent = 'Subscription Expired';
      descEl.textContent  = 'Reactivate to continue using Pathly';
      cardEl.innerHTML = `<button class="btn-primary-lg" id="upgrade-btn">Reactivate →</button>`;
      document.getElementById('upgrade-btn')?.addEventListener('click', () => this.upgrade());
    }
  },

  async upgrade() {
    try {
      const { url } = await API.createCheckout();
      if (url) window.location.href = url;
      else Toast.error('Checkout not configured. Contact support.');
    } catch (err) {
      Toast.error(err.message);
    }
  },
};

// ─────────────────────────────────────────────────────────────
//  COVER LETTER MODAL
// ─────────────────────────────────────────────────────────────
const CoverLetter = {
  _jobId: null,
  _profileId: null,

  async show(jobId, profileId, jobLabel) {
    this._jobId = jobId;
    this._profileId = profileId;
    document.getElementById('cover-letter-job-label').textContent = jobLabel || '';
    document.getElementById('cover-letter-body').innerHTML = '<div class="spinner" style="margin:40px auto;"></div>';
    document.getElementById('cover-letter-modal').classList.remove('hidden');
    await this._generate();
  },

  async _generate() {
    try {
      const { cover_letter } = await API.generateCoverLetter(this._jobId, this._profileId);
      document.getElementById('cover-letter-body').innerHTML = `
        <div class="cover-letter-text">${escapeHtml(cover_letter)}</div>
        <div class="cover-letter-disclaimer">⚠️ This cover letter was AI-assisted. Review and personalize before sending.</div>
      `;
    } catch (err) {
      document.getElementById('cover-letter-body').innerHTML = `<p style="color:var(--rejected);padding:20px;">${escapeHtml(err.message)}</p>`;
    }
  },

  hide() { document.getElementById('cover-letter-modal').classList.add('hidden'); },

  copy() {
    const text = document.querySelector('.cover-letter-text')?.textContent || '';
    navigator.clipboard.writeText(text).then(() => Toast.success('Copied to clipboard!'));
  },
};

// ─────────────────────────────────────────────────────────────
//  UPLOAD TEST PANEL  (dev only — not in sidebar nav)
// ─────────────────────────────────────────────────────────────
const UploadTest = {
  show() { document.getElementById('upload-test-panel').style.display = 'block'; },
  hide() { document.getElementById('upload-test-panel').style.display = 'none'; },

  async upload() {
    const fileInput = document.getElementById('upload-test-file');
    const resultEl  = document.getElementById('upload-test-result');
    const file = fileInput.files[0];
    if (!file) { resultEl.textContent = 'No file selected.'; return; }

    resultEl.textContent = 'Uploading…';
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res  = await apiFetch('/api/upload/test', { method: 'POST', body: formData });
      const data = await res.json();
      resultEl.textContent = JSON.stringify(data, null, 2);
    } catch (err) {
      resultEl.textContent = 'Error: ' + err.message;
    }
  },
};

document.getElementById('upload-test-btn').addEventListener('click', () => UploadTest.upload());
document.getElementById('upload-test-close').addEventListener('click', () => UploadTest.hide());

// ─── Profile page ──────────────────────────────────────────
document.getElementById('profile-info-form')?.addEventListener('submit', e => Profile.saveInfo(e));
document.getElementById('resume-upload-btn')?.addEventListener('click', () => Profile.uploadResume());
document.getElementById('suggest-roles-btn')?.addEventListener('click', () => Profile.suggestRoles());
document.getElementById('gen-profiles-btn')?.addEventListener('click',  () => Profile.generateProfiles());
document.getElementById('roles-confirm')?.addEventListener('click',     () => Profile.generateProfiles());
document.getElementById('roles-cancel')?.addEventListener('click',      () => document.getElementById('roles-modal').classList.add('hidden'));
document.getElementById('roles-modal-close')?.addEventListener('click', () => document.getElementById('roles-modal').classList.add('hidden'));

// Drag-and-drop on resume upload area
const uploadArea = document.getElementById('resume-upload-area');
if (uploadArea) {
  uploadArea.addEventListener('dragover', e => { e.preventDefault(); uploadArea.classList.add('drag-over'); });
  uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('drag-over'));
  uploadArea.addEventListener('drop', e => {
    e.preventDefault();
    uploadArea.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) {
      const dt = new DataTransfer();
      dt.items.add(file);
      document.getElementById('resume-file-input').files = dt.files;
      document.querySelector('.resume-upload-label').textContent = file.name;
    }
  });
  uploadArea.addEventListener('click', () => document.getElementById('resume-file-input').click());
}
document.getElementById('resume-file-input')?.addEventListener('change', e => {
  if (e.target.files[0]) {
    document.querySelector('.resume-upload-label').textContent = e.target.files[0].name;
  }
});

// ─── Cover letter modal ────────────────────────────────────
document.getElementById('cover-letter-close')?.addEventListener('click',  () => CoverLetter.hide());
document.getElementById('cover-letter-copy')?.addEventListener('click',   () => CoverLetter.copy());
document.getElementById('cover-letter-regen')?.addEventListener('click',  () => CoverLetter._generate());
document.getElementById('cover-letter-modal')?.addEventListener('click', e => {
  if (e.target === document.getElementById('cover-letter-modal')) CoverLetter.hide();
});

// ─────────────────────────────────────────────────────────────
//  INIT
// ─────────────────────────────────────────────────────────────
window.addEventListener('load', () => {
  // Clear any browser-autofilled credentials so the form starts blank
  ['login-username', 'login-password', 'register-username', 'register-email',
   'register-password', 'register-confirm'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  Auth.check();
});

// Redraw speedometer on resize so canvas stays crisp
window.addEventListener('resize', () => {
  if (state.currentPage === 'dashboard') Speedometer.onResize();
});
