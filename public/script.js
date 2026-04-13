const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const authTabs = document.querySelectorAll('.auth-tab');
const authFormTitle = document.getElementById('auth-form-title');
const userLabel = document.getElementById('user-label');
const logoutBtn = document.getElementById('logout-btn');
const authScreen = document.getElementById('auth-screen');
const jobForm = document.querySelector('form.job-form');
const jobsBody = document.getElementById('jobs-body');
const jobsGrid = document.getElementById('jobs-grid');
const summaryIds = {
  Applied: document.getElementById('count-applied'),
  Interview: document.getElementById('count-interview'),
  Offer: document.getElementById('count-offer'),
  Rejected: document.getElementById('count-rejected')
};
let newlyAddedJobId = null;
let currentFilter = null;

function getToken() {
  return localStorage.getItem('userToken');
}

function setSession(user) {
  localStorage.setItem('userToken', user.api_key);
  localStorage.setItem('userName', user.username);
  userLabel.textContent = `Hi, ${user.username}`;
  logoutBtn.classList.remove('hidden');
}

function clearSession() {
  localStorage.removeItem('userToken');
  localStorage.removeItem('userName');
  userLabel.textContent = 'Guest';
  logoutBtn.classList.add('hidden');
}

function apiFetch(path, options = {}) {
  const token = getToken();
  options.headers = options.headers || {};
  if (token) {
    options.headers['X-User-Token'] = token;
  }
  return fetch(path, options).then(async response => {
    if (response.status === 401) {
      showAuthScreen();
      throw new Error('Please sign in again.');
    }
    return response;
  });
}

function showAuthScreen() {
  authScreen.classList.remove('hidden');
  document.body.classList.add('auth-active');
}

function hideAuthScreen() {
  authScreen.classList.add('hidden');
  document.body.classList.remove('auth-active');
}

function switchAuthMode(mode) {
  const isLogin = mode === 'login';
  loginForm.classList.toggle('hidden', !isLogin);
  registerForm.classList.toggle('hidden', isLogin);
  authTabs.forEach(tab => {
    tab.classList.toggle('active', tab.dataset.target === mode);
  });
  authFormTitle.textContent = isLogin ? 'Login' : 'Sign Up';
}

authTabs.forEach(tab => {
  tab.addEventListener('click', () => switchAuthMode(tab.dataset.target));
});

async function checkSession() {
  const token = getToken();
  if (!token) {
    showAuthScreen();
    return;
  }

  try {
    const response = await apiFetch('/api/profile');
    const data = await response.json();
    if (response.ok) {
      userLabel.textContent = `Hi, ${data.username}`;
      logoutBtn.classList.remove('hidden');
      hideAuthScreen();
      refresh();
    } else {
      clearSession();
      showAuthScreen();
    }
  } catch (error) {
    clearSession();
    showAuthScreen();
  }
}

function setStatusFilter(status) {
  currentFilter = status;
  document.querySelectorAll('.status-filter').forEach(button => {
    if (button.textContent === (status || 'All')) {
      button.classList.add('active');
    } else {
      button.classList.remove('active');
    }
  });
  refresh();
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function createStatusSelect(currentStatus, jobId) {
  const select = document.createElement('select');
  ['Applied', 'Interview', 'Offer', 'Rejected'].forEach(status => {
    const option = document.createElement('option');
    option.value = status;
    option.textContent = status;
    if (status === currentStatus) option.selected = true;
    select.append(option);
  });
  select.className = `status-select status-pill status-${currentStatus}`;
  select.addEventListener('change', () => {
    const newStatus = select.value;
    select.className = `status-select status-pill status-${newStatus}`;
    if (newStatus === 'Offer') {
      showStatusModal({
        title: '🎉 Congratulations!',
        message: 'This application is now in offer status. Keep the momentum and celebrate your progress.'
      }, true);
    }
    updateJob(jobId, { status: newStatus });
  });
  return select;
}

function createEmailTrackingCell(job) {
  const cell = document.createElement('div');
  cell.className = 'email-tracking';

  const emailBtn = document.createElement('button');
  emailBtn.className = 'action-btn';
  emailBtn.textContent = job.email_sent ? '✓ Emailed' : 'Mark Emailed';
  if (job.email_sent) emailBtn.classList.add('email-sent');
  emailBtn.addEventListener('click', () => {
    updateJob(job.id, { email_sent: !job.email_sent });
  });

  const followup1Btn = document.createElement('button');
  followup1Btn.className = 'action-btn followup-track';
  followup1Btn.textContent = job.followup_1_date ? '✓ FU1' : 'FU1';
  if (job.followup_1_date) followup1Btn.style.background = 'linear-gradient(135deg, #c6f6d5 0%, #9ae6b4 100%)';
  followup1Btn.addEventListener('click', () => {
    const date = prompt('Set Follow-up 1 date (YYYY-MM-DD):', job.followup_1_date || '');
    if (date !== null) updateJob(job.id, { followup_1_date: date || null });
  });

  const followup2Btn = document.createElement('button');
  followup2Btn.className = 'action-btn followup-track';
  followup2Btn.textContent = job.followup_2_date ? '✓ FU2' : 'FU2';
  if (job.followup_2_date) followup2Btn.style.background = 'linear-gradient(135deg, #c6f6d5 0%, #9ae6b4 100%)';
  followup2Btn.addEventListener('click', () => {
    const date = prompt('Set Follow-up 2 date (YYYY-MM-DD):', job.followup_2_date || '');
    if (date !== null) updateJob(job.id, { followup_2_date: date || null });
  });

  cell.append(emailBtn, followup1Btn, followup2Btn);
  return cell;
}

function renderSummary(summary = {}) {
  Object.entries(summaryIds).forEach(([status, element]) => {
    element.textContent = summary[status] ?? 0;
  });
}

function renderJobs(jobs) {
  jobsBody.innerHTML = '';
  const filteredJobs = currentFilter ? jobs.filter(job => job.status === currentFilter) : jobs;
  if (!filteredJobs.length) {
    jobsBody.innerHTML = '<tr><td colspan="9" style="text-align: center; color: #64748b;">No applications yet. Add one above to get started! 📝</td></tr>';
    return;
  }

  filteredJobs.forEach(job => {
    const row = document.createElement('tr');
    row.className = `row-${job.status.toLowerCase()}${job.id === newlyAddedJobId ? ' newly-added' : ''}`;

    row.innerHTML = `
      <td><strong>${escapeHtml(job.company)}</strong></td>
      <td>${escapeHtml(job.role)}</td>
      <td>${escapeHtml(job.location || '—')}</td>
      <td></td>
      <td>${escapeHtml(job.notes || '—')}</td>
      <td></td>
      <td></td>
      <td></td>
      <td class="actions"></td>
    `;

    const statusCell = row.querySelector('td:nth-child(4)');
    statusCell.appendChild(createStatusSelect(job.status, job.id));

    const coverCell = row.querySelector('td:nth-child(6)');
    const resumeCell = row.querySelector('td:nth-child(7)');
    const emailCell = row.querySelector('td:nth-child(8)');

    if (job.cover_letter_file) {
      const link = document.createElement('a');
      link.href = `/uploads/${job.user_id}/${encodeURIComponent(job.cover_letter_file)}`;
      link.target = '_blank';
      link.textContent = 'View';
      link.className = 'file-link';
      coverCell.appendChild(link);
    } else {
      coverCell.textContent = '—';
    }

    if (job.resume_file) {
      const link = document.createElement('a');
      link.href = `/uploads/${job.user_id}/${encodeURIComponent(job.resume_file)}`;
      link.target = '_blank';
      link.textContent = 'View';
      link.className = 'file-link';
      resumeCell.appendChild(link);
    } else {
      resumeCell.textContent = '—';
    }

    emailCell.appendChild(createEmailTrackingCell(job));

    const actionsCell = row.querySelector('.actions');
    const noteButton = document.createElement('button');
    noteButton.textContent = '📝 Notes';
    noteButton.className = 'action-btn';
    noteButton.addEventListener('click', async () => {
      const newNotes = prompt('Update notes for this application:', job.notes || '');
      if (newNotes !== null) updateJob(job.id, { notes: newNotes });
    });

    const deleteButton = document.createElement('button');
    deleteButton.textContent = '🗑️ Delete';
    deleteButton.className = 'action-btn';
    deleteButton.addEventListener('click', () => {
      if (confirm(`Are you sure you want to delete ${job.company}?`)) {
        removeJob(job.id);
      }
    });

    actionsCell.append(noteButton, deleteButton);
    jobsBody.appendChild(row);
  });
}

function showStatusModal(messageObj, shouldCelebrate = false) {
  let modal = document.getElementById('status-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'status-modal';
    modal.className = 'modal';
    modal.innerHTML = `<div class="modal-content">
      <h2 id="modal-title"></h2>
      <p id="modal-message"></p>
      <button class="btn-primary">Awesome!</button>
    </div>`;
    document.body.appendChild(modal);
    modal.querySelector('button').addEventListener('click', () => {
      modal.classList.remove('show');
    });
  }

  modal.querySelector('#modal-title').textContent = messageObj.title;
  modal.querySelector('#modal-message').textContent = messageObj.message;
  modal.classList.add('show');

  if (shouldCelebrate) {
    celebrateWithConfetti();
  }
}

function celebrateWithConfetti() {
  const colors = ['🎉', '🎊', '✨', '🌟', '💫', '🎈', '🎁'];
  for (let i = 0; i < 50; i++) {
    const confetti = document.createElement('div');
    confetti.className = 'confetti';
    confetti.textContent = colors[Math.floor(Math.random() * colors.length)];
    confetti.style.left = Math.random() * 100 + '%';
    confetti.style.top = '-10px';
    confetti.style.fontSize = (Math.random() * 20 + 20) + 'px';
    confetti.style.opacity = Math.random() * 0.5 + 0.5;
    confetti.style.animation = `celebrate ${Math.random() * 3 + 2}s ease-in forwards`;
    confetti.style.animationDelay = Math.random() * 0.5 + 's';
    document.body.appendChild(confetti);

    setTimeout(() => confetti.remove(), 5000);
  }
}

async function fetchJobs() {
  const response = await apiFetch('/api/jobs');
  return response.json();
}

async function fetchSummary() {
  const response = await apiFetch('/api/summary');
  return response.json();
}

async function refresh() {
  try {
    const [jobs, summary] = await Promise.all([fetchJobs(), fetchSummary()]);
    renderJobs(jobs);
    renderSummary(summary);
  } catch (error) {
    console.error(error);
  }
}

async function createJob(formData) {
  const response = await apiFetch('/api/jobs', {
    method: 'POST',
    body: formData
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Unable to create job');
  }
  return response.json();
}

async function updateJob(id, data) {
  const response = await apiFetch(`/api/jobs/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!response.ok) {
    const error = await response.json();
    alert(error.error || 'Unable to update job');
    return;
  }
  refresh();
}

async function removeJob(id) {
  const response = await apiFetch(`/api/jobs/${id}`, { method: 'DELETE' });
  if (!response.ok) {
    const error = await response.json();
    alert(error.error || 'Unable to delete job');
    return;
  }
  refresh();
}

function updateJobPreference() {
  const role = document.getElementById('desired-role').value.trim();
  const location = document.getElementById('desired-location').value.trim();

  if (role || location) {
    localStorage.setItem('jobPreference', JSON.stringify({ role, location }));
    const noteEl = document.getElementById('preference-note');
    noteEl.textContent = `✅ Got it! Looking for: ${role ? role + ' ' : ''}${location ? 'in ' + location : ''}`;
    setTimeout(() => (noteEl.textContent = ''), 3000);
  }
}

async function searchJobs() {
  const role = document.getElementById('job-search-role').value.trim() || 'developer';
  const location = document.getElementById('job-search-location').value.trim() || 'Canada';

  jobsGrid.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: #667eea;">🔍 Searching for jobs...</p>';

  try {
    const response = await apiFetch(`/api/jobs/search?role=${encodeURIComponent(role)}&location=${encodeURIComponent(location)}`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const jobs = await response.json();
    if (!jobs || jobs.length === 0) {
      jobsGrid.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: #64748b;">No jobs found. Try a different search!</p>';
      return;
    }
    renderJobCards(jobs);
  } catch (error) {
    console.error('Error fetching jobs:', error);
    jobsGrid.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: #ef4444;">⚠️ Error loading jobs. Please try again.</p>';
  }
}

function renderJobCards(jobs) {
  if (!jobs.length) {
    jobsGrid.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: #64748b;">No jobs found. Try a different search!</p>';
    return;
  }

  jobsGrid.innerHTML = jobs
    .map(job => `
      <div class="job-card">
        <div class="job-card-header">
          <div>
            <h3>${escapeHtml(job.title)}</h3>
            <p class="company">${escapeHtml(job.company)} · ${escapeHtml(job.location)}</p>
          </div>
          <span class="source-pill">${escapeHtml(job.source)}</span>
        </div>
        <div class="details">
          <div class="detail-row"><strong>Salary:</strong> ${escapeHtml(job.salary)}</div>
          <div class="detail-row"><strong>Rating:</strong> ${escapeHtml(job.company_rating)} ⭐</div>
          <div class="detail-row"><strong>Posted:</strong> ${escapeHtml(job.posted_date)}</div>
          <p class="description">${escapeHtml(job.description)}</p>
        </div>
        <div class="job-card-actions">
          <button class="apply-btn" onclick="applyFromSearch('${escapeHtml(job.title)}', '${escapeHtml(job.company)}', '${escapeHtml(job.location)}', '${job.url}')">Extract Info</button>
          <a href="${job.url}" target="_blank" class="visit-btn">Visit Job →</a>
        </div>
      </div>
    `)
    .join('');
}

function applyFromSearch(title, company, location, url) {
  scrollToSection('job-form');
  setTimeout(() => {
    document.querySelector('input[name="role"]').value = title;
    document.querySelector('input[name="company"]').value = company;
    document.querySelector('input[name="location"]').value = location;
    document.querySelector('textarea[name="notes"]').value = `Applied via Job Search\nURL: ${url}`;
    document.querySelector('input[name="role"]').focus();
  }, 300);
}

loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;

  if (!username || !password) {
    alert('Please enter both username and password.');
    return;
  }

  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Unable to sign in');
    }
    setSession(data);
    hideAuthScreen();
    refresh();
  } catch (error) {
    alert(error.message);
  }
});

registerForm.addEventListener('submit', async event => {
  event.preventDefault();
  const username = document.getElementById('register-username').value.trim();
  const password = document.getElementById('register-password').value;

  if (!username || !password) {
    alert('Please enter both username and password.');
    return;
  }

  try {
    const response = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Unable to create account');
    }
    setSession(data);
    hideAuthScreen();
    refresh();
  } catch (error) {
    alert(error.message);
  }
});

logoutBtn.addEventListener('click', () => {
  clearSession();
  showAuthScreen();
});

jobForm.addEventListener('submit', async event => {
  event.preventDefault();
  const formData = new FormData(jobForm);
  formData.set('email_sent', '0');

  try {
    const result = await createJob(formData);
    newlyAddedJobId = result.id;
    jobForm.reset();
    refresh();
  } catch (error) {
    alert(error.message);
  }
});

function scrollToSection(id) {
  document.getElementById(id).scrollIntoView({ behavior: 'smooth' });
}

window.addEventListener('load', () => {
  switchAuthMode('login');
  const saved = localStorage.getItem('jobPreference');
  if (saved) {
    const pref = JSON.parse(saved);
    document.getElementById('desired-role').value = pref.role || '';
    document.getElementById('desired-location').value = pref.location || '';
  }
  checkSession();
});
