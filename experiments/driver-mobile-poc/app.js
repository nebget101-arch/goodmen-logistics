'use strict';

// ── Config ────────────────────────────────────────────────────────────────
// API_BASE is overridable via ?api= query param for pointing at dev vs prod.
const params = new URLSearchParams(location.search);
const API_BASE = (params.get('api') || 'http://localhost:3333/api').replace(/\/$/, '');

// ── State ─────────────────────────────────────────────────────────────────
let token = sessionStorage.getItem('fn_poc_token') || '';
let allIncidents = [];
let activeFilter = 'ALL';

// ── Screens ───────────────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ── Login ─────────────────────────────────────────────────────────────────
async function handleLogin(e) {
  e.preventDefault();
  const btn   = document.getElementById('login-btn');
  const err   = document.getElementById('login-error');
  const uname = document.getElementById('username').value.trim();
  const pass  = document.getElementById('password').value;

  err.classList.remove('visible');
  btn.disabled = true;
  btn.textContent = 'Signing in…';

  try {
    const res  = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: uname, password: pass })
    });
    const data = await res.json();

    if (!res.ok) throw new Error(data?.message || data?.error || `Login failed (${res.status})`);

    token = data.token;
    sessionStorage.setItem('fn_poc_token', token);
    showScreen('incidents-screen');
    loadIncidents();
  } catch (ex) {
    err.textContent = ex.message;
    err.classList.add('visible');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sign in';
  }
}

// ── Incidents ─────────────────────────────────────────────────────────────
function timeSince(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 2)  return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function statusLabel(s) {
  return { NEW: 'New', TRIAGED: 'Triaged', DISPATCHED: 'Dispatched', RESOLVED: 'Resolved' }[s] || s;
}

function urgencyLabel(u) {
  return { CRITICAL: 'Critical', HIGH: 'High', NORMAL: 'Normal', LOW: 'Low' }[u] || u;
}

function issueLabel(t) {
  if (!t) return '';
  return t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function renderIncident(inc) {
  const li = document.createElement('li');
  li.className = `incident-card urgency-${inc.urgency || ''}`;
  li.setAttribute('role', 'button');
  li.setAttribute('tabindex', '0');
  li.setAttribute('aria-label', `Incident ${inc.call_number || inc.id}, status ${statusLabel(inc.status)}`);

  li.innerHTML = `
    <div class="incident-card-top">
      <span class="incident-number">${inc.call_number || inc.id || '—'}</span>
      <div class="incident-badges">
        <span class="badge badge-status-${inc.status}">${statusLabel(inc.status)}</span>
        ${inc.urgency && inc.urgency !== 'NORMAL'
          ? `<span class="badge badge-urgency-${inc.urgency}">${urgencyLabel(inc.urgency)}</span>`
          : ''}
      </div>
    </div>
    <div class="incident-title">${inc.caller_name ? escHtml(inc.caller_name) : 'Unknown caller'}</div>
    <div class="incident-meta">
      ${inc.issue_type ? `<span>${escHtml(issueLabel(inc.issue_type))}</span>` : ''}
      ${inc.issue_type && inc.created_at ? `<span class="meta-sep">·</span>` : ''}
      ${inc.created_at ? `<span class="incident-time">${timeSince(inc.created_at)}</span>` : ''}
    </div>`;

  li.addEventListener('click', () => openIncidentDetail(inc));
  li.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') openIncidentDetail(inc); });
  return li;
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function getFilteredIncidents() {
  if (activeFilter === 'ALL') return allIncidents;
  return allIncidents.filter(i => i.status === activeFilter);
}

function renderList() {
  const list  = document.getElementById('incident-list');
  const count = document.getElementById('incident-count');
  const data  = getFilteredIncidents();

  list.innerHTML = '';
  count.textContent = data.length;

  if (!data.length) {
    const empty = document.createElement('li');
    empty.innerHTML = `
      <div class="state-container">
        <div class="state-icon">📋</div>
        <p>${activeFilter === 'ALL' ? 'No incidents found.' : `No ${activeFilter.toLowerCase()} incidents.`}</p>
      </div>`;
    list.appendChild(empty);
    return;
  }

  data.forEach(inc => list.appendChild(renderIncident(inc)));
}

async function loadIncidents() {
  const list  = document.getElementById('incident-list');
  const count = document.getElementById('incident-count');

  list.innerHTML = `
    <li>
      <div class="state-container">
        <div class="spinner" role="status" aria-label="Loading incidents"></div>
        <p>Loading incidents…</p>
      </div>
    </li>`;
  count.textContent = '…';

  try {
    const res  = await fetch(`${API_BASE}/roadside/calls`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (res.status === 401) {
      sessionStorage.removeItem('fn_poc_token');
      token = '';
      showScreen('login-screen');
      document.getElementById('login-error').textContent = 'Session expired. Please sign in again.';
      document.getElementById('login-error').classList.add('visible');
      return;
    }

    if (!res.ok) throw new Error(`API error ${res.status}`);

    const data = await res.json();
    allIncidents = Array.isArray(data) ? data : (data.calls || data.data || []);
    renderList();
  } catch (ex) {
    list.innerHTML = `
      <li>
        <div class="state-container">
          <div class="state-icon">⚠️</div>
          <p>Could not load incidents.<br><small>${escHtml(ex.message)}</small></p>
        </div>
      </li>`;
    count.textContent = '0';
  }
}

// ── Detail sheet (minimal) ────────────────────────────────────────────────
function openIncidentDetail(inc) {
  // Phase 1 POC: show a simple alert with key fields.
  // A slide-up detail sheet would replace this in the full implementation.
  const lines = [
    `Call #: ${inc.call_number || inc.id}`,
    `Status: ${statusLabel(inc.status)}`,
    `Urgency: ${urgencyLabel(inc.urgency)}`,
    `Caller: ${inc.caller_name || '—'}`,
    `Issue: ${issueLabel(inc.issue_type) || '—'}`,
    inc.created_at ? `Opened: ${new Date(inc.created_at).toLocaleString()}` : ''
  ].filter(Boolean).join('\n');

  alert(lines);
}

// ── Filters ───────────────────────────────────────────────────────────────
function initFilters() {
  document.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      activeFilter = chip.dataset.filter;
      document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      renderList();
    });
  });
}

// ── Logout ────────────────────────────────────────────────────────────────
function handleLogout() {
  sessionStorage.removeItem('fn_poc_token');
  token = '';
  allIncidents = [];
  document.getElementById('username').value = '';
  document.getElementById('password').value = '';
  showScreen('login-screen');
}

// ── Boot ──────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('login-form').addEventListener('submit', handleLogin);
  document.getElementById('logout-btn').addEventListener('click', handleLogout);
  document.getElementById('refresh-btn').addEventListener('click', loadIncidents);
  initFilters();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {/* SW optional in POC */});
  }

  if (token) {
    showScreen('incidents-screen');
    loadIncidents();
  } else {
    showScreen('login-screen');
  }
});
