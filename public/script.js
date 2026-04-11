const jobForm = document.getElementById('job-form');
const jobsBody = document.getElementById('jobs-body');
const summaryIds = {
  Applied: document.getElementById('count-applied'),
  Interview: document.getElementById('count-interview'),
  Offer: document.getElementById('count-offer'),
  Rejected: document.getElementById('count-rejected')
};
let newlyAddedJobId = null;

const STATUS_MESSAGES = {
  Offer: {
    title: '🎉 Congratulations!',
    message: 'You got the offer! Light those candles and celebrate your success! 🕯️ This is a huge achievement, and you deserve it. Go celebrate!',
    emoji: '🎉'
  },
  Rejected: {
    title: '💪 Keep Going!',
    message: 'This is not the end, it\'s just a bump in the road. Every "no" brings you closer to "yes". Stay focused, keep learning, and remember - your perfect opportunity is out there. You\'ve got this! 🚀',
    emoji: '💪'
  },
  Interview: {
    title: '📚 Interview Prep Time!',
    message: 'Time to showcase your skills! Study hard, practice your answers, and remember - they already see potential in you. Go crush this interview! You can do it! 💪',
    emoji: '📚'
  }
};

async function fetchJobs() {
  const response = await fetch('/api/jobs');
  return response.json();
}

async function fetchSummary() {
  const response = await fetch('/api/summary');
  return response.json();
}

function renderSummary(summary = {}) {
  Object.entries(summaryIds).forEach(([status, element]) => {
    element.textContent = summary[status] ?? 0;
  });
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
    if (STATUS_MESSAGES[newStatus]) {
      showStatusModal(STATUS_MESSAGES[newStatus], newStatus === 'Offer');
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

function renderJobs(jobs) {
  jobsBody.innerHTML = '';
  if (!jobs.length) {
    jobsBody.innerHTML = '<tr><td colspan="9" style="text-align: center; color: #64748b;">No applications yet. Add one above to get started! 📝</td></tr>';
    return;
  }

  jobs.forEach(job => {
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
      link.href = `/uploads/${encodeURIComponent(job.cover_letter_file)}`;
      link.target = '_blank';
      link.textContent = 'View';
      link.className = 'file-link';
      coverCell.appendChild(link);
    } else {
      coverCell.textContent = '—';
    }

    if (job.resume_file) {
      const link = document.createElement('a');
      link.href = `/uploads/${encodeURIComponent(job.resume_file)}`;
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

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
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
      <button class="btn-primary">Amazing!</button>
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

async function refresh() {
  const [jobs, summary] = await Promise.all([fetchJobs(), fetchSummary()]);
  renderJobs(jobs);
  renderSummary(summary);
}

async function createJob(formData) {
  const response = await fetch('/api/jobs', {
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
  const response = await fetch(`/api/jobs/${id}`, {
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
  const response = await fetch(`/api/jobs/${id}`, { method: 'DELETE' });
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
    setTimeout(() => noteEl.textContent = '', 3000);
  }
}

async function searchJobs() {
  const role = document.getElementById('job-search-role').value.trim() || 'developer';
  const location = document.getElementById('job-search-location').value.trim() || 'Canada';
  
  const grid = document.getElementById('jobs-grid');
  grid.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: #667eea;">🔍 Searching for jobs...</p>';
  
  try {
    const response = await fetch(`/api/jobs/search?role=${encodeURIComponent(role)}&location=${encodeURIComponent(location)}`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const jobs = await response.json();
    if (!jobs || jobs.length === 0) {
      grid.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: #64748b;">No jobs found. Try a different search!</p>';
      return;
    }
    renderJobCards(jobs);
  } catch (error) {
    console.error('Error fetching jobs:', error);
    grid.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: #ef4444;">⚠️ Error loading jobs. Please try again or check the server.</p>';
  }
}

function renderJobCards(jobs) {
  const grid = document.getElementById('jobs-grid');
  
  if (!jobs.length) {
    grid.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: #64748b;">No jobs found. Try a different search!</p>';
    return;
  }
  
  grid.innerHTML = jobs.map(job => `
    <div class="job-card">
      <div>
        <h3>${escapeHtml(job.title)}</h3>
        <p class="company">${escapeHtml(job.company)}</p>
      </div>
      <div class="details">
        <div class="detail-row">
          <strong>📍</strong> <span>${escapeHtml(job.location)}</span>
        </div>
        <div>
          <span class="salary">${escapeHtml(job.salary)}</span>
        </div>
        <p class="description">${escapeHtml(job.description)}</p>
      </div>
      <div style="display: flex; gap: 10px;">
        <button class="apply-btn" onclick="applyFromSearch('${escapeHtml(job.title)}', '${escapeHtml(job.company)}', '${escapeHtml(job.location)}', '${escapeHtml(job.url)}')">➕ Add to Track</button>
        <a href="${job.url}" target="_blank" style="flex: 1;">
          <button style="width: 100%; padding: 12px 20px; background: #f1f5f9; color: #667eea; border: 2px solid #667eea; border-radius: 10px; font-weight: 600; cursor: pointer; transition: all 0.3s ease;">Visit Job →</button>
        </a>
      </div>
    </div>
  `).join('');
}

function applyFromSearch(title, company, location, url) {
  document.getElementById('job-form').scrollIntoView({ behavior: 'smooth' });
  setTimeout(() => {
    document.querySelector('input[name="role"]').value = title;
    document.querySelector('input[name="company"]').value = company;
    document.querySelector('input[name="location"]').value = location;
    document.querySelector('textarea[name="notes"]').value = `Applied via Job Search\nURL: ${url}`;
    document.querySelector('input[name="role"]').focus();
  }, 500);
}

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

window.addEventListener('load', () => {
  const saved = localStorage.getItem('jobPreference');
  if (saved) {
    const pref = JSON.parse(saved);
    document.getElementById('desired-role').value = pref.role || '';
    document.getElementById('desired-location').value = pref.location || '';
  }
});

refresh();