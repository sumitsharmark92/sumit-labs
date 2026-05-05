// ═══════════════════════════════════════
// PORTFOLIO JS — Sumit Sharma
// ═══════════════════════════════════════
const API_BASE = window.location.origin;
const WORKER_URL = 'https://divine-butterfly-e664.sumitsharmark92.workers.dev/';

// ── NAV ──
document.addEventListener('DOMContentLoaded', () => {
  // Mobile toggle
  const toggle = document.querySelector('.nav-toggle');
  const links = document.querySelector('.nav-links');
  if (toggle) toggle.addEventListener('click', () => links.classList.toggle('open'));

  // Active link tracking
  const sections = document.querySelectorAll('section[id]');
  const navLinks = document.querySelectorAll('.nav-links a');
  window.addEventListener('scroll', () => {
    let current = '';
    sections.forEach(s => { if (window.scrollY >= s.offsetTop - 100) current = s.id; });
    navLinks.forEach(a => {
      a.classList.remove('active');
      if (a.getAttribute('href') === '#' + current) a.classList.add('active');
    });
    // Close mobile menu on scroll
    if (links) links.classList.remove('open');
  });

  // Close mobile menu on link click
  navLinks.forEach(a => a.addEventListener('click', () => { if (links) links.classList.remove('open'); }));

  // Track visitor
  fetch(API_BASE + '/api/track', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ page: location.pathname, referrer: document.referrer || '' })
  }).catch(() => {});

  initTypewriter();
  initReveal();
  initSkillBars();
  initEducationCircles();
  initTerminal();
  initGithub();
  initContribGraph();
});

// ── TYPEWRITER ──
function initTypewriter() {
  const roles = ["Junior Security Analyst", "Blue Team Specialist", "Penetration Tester", "SOC Analyst", "Ethical Hacker", "IT Administrator"];
  let ri = 0, ci = 0, deleting = false;
  const el = document.getElementById('hero-role');
  if (!el) return;
  function type() {
    const role = roles[ri];
    if (!deleting) {
      el.textContent = role.substring(0, ci + 1) + '█';
      ci++;
      if (ci === role.length) { deleting = true; setTimeout(type, 2000); return; }
    } else {
      el.textContent = role.substring(0, ci) + '█';
      ci--;
      if (ci < 0) { deleting = false; ri = (ri + 1) % roles.length; ci = 0; }
    }
    setTimeout(type, deleting ? 50 : 80);
  }
  type();
}

// ── REVEAL ON SCROLL ──
function initReveal() {
  const obs = new IntersectionObserver(entries => {
    entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); } });
  }, { threshold: 0.1 });
  document.querySelectorAll('.reveal').forEach(el => obs.observe(el));
}

// ── SKILL BARS ──
function initSkillBars() {
  const obs = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.querySelectorAll('.skill-fill').forEach(bar => {
          bar.style.width = bar.dataset.width + '%';
        });
        obs.unobserve(e.target);
      }
    });
  }, { threshold: 0.2 });
  const skillSection = document.getElementById('skills');
  if (skillSection) obs.observe(skillSection);
}

// ── EDUCATION CIRCLES ──
function initEducationCircles() {
  const circumference = 2 * Math.PI * 54;
  const obs = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        const c1 = document.getElementById('circle-secondary');
        const c2 = document.getElementById('circle-senior');
        if (c1) setTimeout(() => { c1.style.strokeDashoffset = circumference * (1 - 80 / 100); }, 200);
        if (c2) setTimeout(() => { c2.style.strokeDashoffset = circumference * (1 - 78 / 100); }, 400);
        obs.disconnect();
      }
    });
  });
  const edu = document.getElementById('education');
  if (edu) obs.observe(edu);
}

// ── TERMINAL ──
function initTerminal() {
  const body = document.getElementById('terminal-body');
  const input = document.getElementById('term-input');
  if (!body || !input) return;
  let history = [], histIdx = -1;

  const COMMANDS = {
    help: () => `<span class="term-info">AVAILABLE COMMANDS:</span>\n<span class="term-output">  about      — Operator profile\n  skills     — Security skill set\n  experience — Professional history\n  projects   — Active modules\n  certs      — Certifications\n  contact    — Contact information\n  whoami     — Current operator\n  scan       — Network scan simulation\n  clear      — Clear terminal</span>`,
    about: () => `<span class="term-success">[ OPERATOR PROFILE ]</span>\n<span class="term-output">  Name     : Sumit Sharma\n  Role     : Junior Security Analyst\n  Focus    : Blue Team | SOC | Penetration Testing\n  Location : Vrindavan, UP, India\n  Status   : Seeking Pentest/SOC/CEH opportunities</span>`,
    skills: () => `<span class="term-success">[ SKILL MATRIX ]</span>\n<span class="term-output">  [██████████] 90% IT Administration\n  [████████░░] 82% Penetration Testing\n  [████████░░] 80% SOC Analysis\n  [████████░░] 78% Network Security\n  [███████░░░] 75% Incident Response\n  [███████░░░] 70% Dark Web / OPSEC</span>`,
    experience: () => `<span class="term-success">[ EXPERIENCE ]</span>\n<span class="term-output">  Govardhan Institute for Vedic Education\n  Role   : IT Administrator | 2025–Present\n  ▸ IT infrastructure for 100+ users\n  ▸ Security controls & endpoint protection\n  ▸ Tier-1/2 technical support</span>`,
    projects: () => `<span class="term-success">[ PROJECTS ]</span>\n<span class="term-output">  [001] CYBER-OPS PORTFOLIO — HTML/CSS/JS, Three.js\n  [002] NETWORK SECURITY TOOLKIT — Python, Kali\n  [003] AZURE SECURITY — Microsoft Azure\n  [004] OPSEC RESEARCH — Tor, EC-Council</span>`,
    certs: () => `<span class="term-success">[ CERTIFICATIONS ]</span>\n<span class="term-output">  [1] EC-Council — Dark Web & Crypto\n  [2] Cybrary — Penetration Tester Path\n  [3] Microsoft — Azure Storage Security\n  [4] Microsoft — Power Apps\n  [5] Cybrary — Enterprise SOC Leadership</span>`,
    contact: () => `<span class="term-success">[ CONTACT ]</span>\n<span class="term-output">  Email  : calista.natsu@hotmail.com\n  Phone  : +91 9027051135\n  GitHub : github.com/sumitsharmark92</span>`,
    whoami: () => `<span class="term-success">root@cyber-ops</span>\n<span class="term-output">  OPERATOR: SUMIT SHARMA | CLEARANCE: LEVEL-3</span>`,
    scan: () => 'SCAN',
    clear: () => 'CLEAR'
  };

  function appendLine(html) {
    const div = document.createElement('div');
    div.className = 'term-line'; div.innerHTML = html;
    body.appendChild(div); body.scrollTop = body.scrollHeight;
  }

  function runCommand(cmd) {
    const c = cmd.trim().toLowerCase();
    appendLine(`<span class="term-prompt">root@cyber:~$</span> <span class="term-cmd">${cmd}</span>`);
    if (!c) return;
    history.unshift(cmd); histIdx = -1;
    const fn = COMMANDS[c];
    if (!fn) { appendLine(`<span class="term-error">command not found: ${cmd} — type 'help'</span>`); return; }
    const out = fn();
    if (out === 'CLEAR') { body.innerHTML = ''; return; }
    if (out === 'SCAN') {
      const targets = ['192.168.1.1', '10.0.0.254', '172.16.0.1'];
      let i = 0;
      function next() {
        if (i >= targets.length) { appendLine(`<span class="term-success">SCAN COMPLETE: ${targets.length} hosts, 0 critical</span>`); return; }
        appendLine(`<span class="term-output">  Scanning ${targets[i]}... ports: 22,80,443</span>`);
        i++; setTimeout(next, 400);
      }
      appendLine(`<span class="term-info">Starting Nmap 7.94...</span>`);
      setTimeout(next, 200);
    } else { appendLine(out); }
  }

  appendLine(`<span class="term-info">CYBER-OPS TERMINAL v3.7 — Type 'help' for commands</span>`);

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { runCommand(input.value); input.value = ''; }
    else if (e.key === 'ArrowUp') { histIdx = Math.min(histIdx + 1, history.length - 1); input.value = history[histIdx] || ''; }
    else if (e.key === 'ArrowDown') { histIdx = Math.max(histIdx - 1, -1); input.value = histIdx < 0 ? '' : history[histIdx] || ''; }
  });
}

// ── GITHUB ──
async function initGithub() {
  try {
    const r = await fetch('https://api.github.com/users/sumitsharmark92');
    const d = await r.json();
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('gh-repos', d.public_repos || '--');
    set('gh-followers', d.followers || '--');
    set('gh-following', d.following || '--');
    set('gh-gists', d.public_gists || '0');
  } catch (e) { }
}

// ── CONTRIB GRAPH ──
function initContribGraph() {
  const container = document.getElementById('contrib-cells');
  if (!container) return;
  for (let w = 0; w < 52; w++) {
    const week = document.createElement('div');
    week.className = 'contrib-week';
    for (let d = 0; d < 7; d++) {
      const cell = document.createElement('div');
      const r = Math.random();
      cell.className = 'contrib-cell ' + (r > 0.85 ? 'l4' : r > 0.65 ? 'l3' : r > 0.45 ? 'l2' : r > 0.3 ? 'l1' : '');
      week.appendChild(cell);
    }
    container.appendChild(week);
  }
}

// ── CONTACT FORM ──
async function submitContact() {
  const name = document.getElementById('contact-name').value.trim();
  const email = document.getElementById('contact-email').value.trim();
  const phone = document.getElementById('contact-phone')?.value.trim() || '';
  const message = document.getElementById('contact-msg').value.trim();
  const btn = document.getElementById('submit-btn');
  const status = document.getElementById('form-status');

  if (!name || !email || !message) {
    status.textContent = '⚠ All fields required'; status.style.color = '#ff3b5c'; return;
  }

  btn.textContent = 'SENDING...'; btn.disabled = true;
  status.textContent = 'Establishing secure connection...'; status.style.color = 'var(--cyan)';

  try {
    const r = await fetch(API_BASE + '/api/contact', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, phone, message })
    });
    const d = await r.json();
    if (d.success) {
      btn.textContent = '✓ SENT'; status.textContent = '✓ Message delivered successfully!'; status.style.color = 'var(--green)';
      document.getElementById('contact-name').value = '';
      document.getElementById('contact-email').value = '';
      document.getElementById('contact-msg').value = '';
      if (document.getElementById('contact-phone')) document.getElementById('contact-phone').value = '';
    } else throw new Error(d.error);
  } catch (e) {
    btn.textContent = 'SEND MESSAGE'; btn.disabled = false;
    status.textContent = '✗ Failed: ' + e.message; status.style.color = '#ff3b5c';
  }
}

// ── CHATBOT ──
let chatOpen = false, chatHistory = [];
function toggleChat() {
  chatOpen = !chatOpen;
  const panel = document.getElementById('chat-panel');
  panel.classList.toggle('open', chatOpen);
  document.getElementById('chat-toggle').textContent = chatOpen ? '✕' : '💬';
  if (chatOpen) document.getElementById('chat-input').focus();
}
function sendSuggestion(text) { document.getElementById('chat-input').value = text; sendChat(); }
async function sendChat() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim(); if (!text) return; input.value = '';
  const msgs = document.getElementById('chat-messages');
  const ud = document.createElement('div'); ud.className = 'chat-msg user'; ud.textContent = text; msgs.appendChild(ud);
  const ld = document.createElement('div'); ld.className = 'chat-msg bot'; ld.textContent = 'Processing...'; msgs.appendChild(ld);
  msgs.scrollTop = msgs.scrollHeight;
  const sys = { role: 'system', content: 'You are CYBER-ASSIST, AI for Sumit Sharma\'s cybersecurity portfolio. Sumit is a Junior Security Analyst, Blue Team, IT Admin at GIVE (100+ users), from Vrindavan India. Certs: EC-Council, Cybrary, Microsoft Azure. Skills: Pentest, SOC, CEH, OPSEC. Keep answers under 100 words, terminal style.' };
  chatHistory.push({ role: 'user', content: text });
  try {
    const r = await fetch(WORKER_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [sys, ...chatHistory] }) });
    const d = await r.json();
    const reply = d.choices?.[0]?.message?.content || 'Error processing request';
    chatHistory.push({ role: 'assistant', content: reply });
    ld.textContent = reply;
  } catch (e) { ld.textContent = '[ERROR] ' + e.message; }
  msgs.scrollTop = msgs.scrollHeight;
}
