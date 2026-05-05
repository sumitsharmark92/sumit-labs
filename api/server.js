const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const morgan = require('morgan');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'sumit-labs-secret-key-2026-cyber-ops';
const DB_PATH = path.join(__dirname, '..', 'data', 'db.json');

// ═══════════════════════════════════════════════
// MIDDLEWARE
// ═══════════════════════════════════════════════
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(morgan('dev'));

// Serve static files from project root
app.use(express.static(path.join(__dirname, '..')));

// ═══════════════════════════════════════════════
// DATABASE HELPERS
// ═══════════════════════════════════════════════
function readDB() {
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    console.error('DB read error:', e.message);
    return getDefaultDB();
  }
}

function writeDB(data) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('DB write error:', e.message);
  }
}

function getDefaultDB() {
  return {
    admin: { username: 'admin', passwordHash: bcrypt.hashSync('radhey', 10) },
    messages: [], visitors: [], projects: [], skills: [],
    experience: [], blockedIPs: [], activityLog: [], notifications: [],
    settings: { siteName: 'Sumit Sharma', quickNote: '' },
    editor: {}
  };
}

function logActivity(action, details, status = 'INFO') {
  const db = readDB();
  db.activityLog.unshift({ id: uuidv4(), action, details, status, time: Date.now() });
  if (db.activityLog.length > 200) db.activityLog = db.activityLog.slice(0, 200);
  writeDB(db);
}

// ═══════════════════════════════════════════════
// AUTH MIDDLEWARE
// ═══════════════════════════════════════════════
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  try {
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ═══════════════════════════════════════════════
// AUTH ROUTES
// ═══════════════════════════════════════════════
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  const db = readDB();

  if (!password) {
    return res.status(400).json({ error: 'Password required' });
  }

  const valid = bcrypt.compareSync(password, db.admin.passwordHash);
  if (!valid) {
    // Log failed attempt
    logActivity('FAILED LOGIN', `Failed login attempt from ${req.ip}`, 'DANGER');
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign({ username: db.admin.username, role: 'admin' }, JWT_SECRET, { expiresIn: '24h' });
  logActivity('LOGIN', 'Admin authenticated successfully', 'SUCCESS');
  res.json({ success: true, token });
});

app.get('/api/verify', authMiddleware, (req, res) => {
  res.json({ success: true, user: req.user });
});

app.post('/api/password', authMiddleware, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const db = readDB();

  if (!bcrypt.compareSync(currentPassword, db.admin.passwordHash)) {
    return res.status(400).json({ error: 'Current password incorrect' });
  }
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  }

  db.admin.passwordHash = bcrypt.hashSync(newPassword, 10);
  writeDB(db);
  logActivity('SETTINGS', 'Admin password changed', 'WARN');
  res.json({ success: true });
});

// ═══════════════════════════════════════════════
// CONTACT (PUBLIC — from portfolio frontend)
// ═══════════════════════════════════════════════
app.post('/api/contact', (req, res) => {
  const { name, email, phone, message } = req.body;
  if (!name || !email || !message) {
    return res.status(400).json({ error: 'Name, email and message are required' });
  }

  const db = readDB();
  const msg = {
    id: uuidv4(),
    name, email, phone: phone || '',
    message, ip: req.ip || 'unknown',
    timestamp: new Date().toISOString(),
    read: false
  };
  db.messages.unshift(msg);
  writeDB(db);
  logActivity('MESSAGE', `New contact from ${name} (${email})`, 'SUCCESS');
  res.json({ success: true, id: msg.id });
});

// ═══════════════════════════════════════════════
// VISITOR TRACKING (PUBLIC)
// ═══════════════════════════════════════════════
app.post('/api/track', (req, res) => {
  const { page, referrer } = req.body;
  const db = readDB();
  const visitor = {
    id: uuidv4(),
    ip: req.ip || 'unknown',
    page: page || '/',
    referrer: referrer || 'Direct',
    userAgent: req.headers['user-agent'] || 'Unknown',
    timestamp: new Date().toISOString(),
    country: 'Unknown'
  };
  db.visitors.unshift(visitor);
  if (db.visitors.length > 5000) db.visitors = db.visitors.slice(0, 5000);
  writeDB(db);
  res.json({ success: true });
});

// ═══════════════════════════════════════════════
// MESSAGES (AUTH REQUIRED)
// ═══════════════════════════════════════════════
app.get('/api/messages', authMiddleware, (req, res) => {
  const db = readDB();
  res.json(db.messages);
});

app.patch('/api/messages/:id', authMiddleware, (req, res) => {
  const db = readDB();
  const idx = db.messages.findIndex(m => m.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Message not found' });
  db.messages[idx] = { ...db.messages[idx], ...req.body };
  writeDB(db);
  logActivity('MESSAGE', `Updated message from ${db.messages[idx].name}`, 'INFO');
  res.json(db.messages[idx]);
});

app.delete('/api/messages/:id', authMiddleware, (req, res) => {
  const db = readDB();
  const idx = db.messages.findIndex(m => m.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Message not found' });
  const removed = db.messages.splice(idx, 1)[0];
  writeDB(db);
  logActivity('MESSAGE', `Deleted message from ${removed.name}`, 'WARN');
  res.json({ success: true });
});

app.delete('/api/messages', authMiddleware, (req, res) => {
  const db = readDB();
  const count = db.messages.length;
  db.messages = [];
  writeDB(db);
  logActivity('MESSAGE', `Cleared all ${count} messages`, 'WARN');
  res.json({ success: true, cleared: count });
});

// ═══════════════════════════════════════════════
// VISITORS (AUTH REQUIRED)
// ═══════════════════════════════════════════════
app.get('/api/visitors', authMiddleware, (req, res) => {
  const db = readDB();
  const limit = parseInt(req.query.limit) || 200;
  res.json(db.visitors.slice(0, limit));
});

app.delete('/api/visitors', authMiddleware, (req, res) => {
  const db = readDB();
  db.visitors = [];
  writeDB(db);
  logActivity('VISITORS', 'Cleared visitor log', 'WARN');
  res.json({ success: true });
});

// ═══════════════════════════════════════════════
// STATS (AUTH REQUIRED)
// ═══════════════════════════════════════════════
app.get('/api/stats', authMiddleware, (req, res) => {
  const db = readDB();
  const today = new Date().toISOString().split('T')[0];
  const todayVisitors = db.visitors.filter(v => v.timestamp && v.timestamp.startsWith(today)).length;
  const countries = new Set(db.visitors.map(v => v.country).filter(Boolean));
  const unreadMessages = db.messages.filter(m => !m.read).length;

  res.json({
    totalVisitors: db.visitors.length,
    todayVisitors,
    totalMessages: db.messages.length,
    unreadMessages,
    countries: countries.size,
    totalProjects: db.projects.length,
    blockedIPs: db.blockedIPs.length
  });
});

// ═══════════════════════════════════════════════
// PROJECTS (AUTH REQUIRED)
// ═══════════════════════════════════════════════
app.get('/api/projects', (req, res) => {
  const db = readDB();
  res.json(db.projects);
});

app.post('/api/projects', authMiddleware, (req, res) => {
  const db = readDB();
  const project = { id: uuidv4(), ...req.body, createdAt: Date.now() };
  db.projects.push(project);
  writeDB(db);
  logActivity('PROJECTS', `Added project: ${project.name}`, 'SUCCESS');
  res.json(project);
});

app.put('/api/projects/:id', authMiddleware, (req, res) => {
  const db = readDB();
  const idx = db.projects.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Project not found' });
  db.projects[idx] = { ...db.projects[idx], ...req.body };
  writeDB(db);
  logActivity('PROJECTS', `Updated project: ${db.projects[idx].name}`, 'SUCCESS');
  res.json(db.projects[idx]);
});

app.delete('/api/projects/:id', authMiddleware, (req, res) => {
  const db = readDB();
  const idx = db.projects.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Project not found' });
  const removed = db.projects.splice(idx, 1)[0];
  writeDB(db);
  logActivity('PROJECTS', `Deleted project: ${removed.name}`, 'WARN');
  res.json({ success: true });
});

// ═══════════════════════════════════════════════
// SKILLS (AUTH REQUIRED)
// ═══════════════════════════════════════════════
app.get('/api/skills', (req, res) => {
  const db = readDB();
  res.json(db.skills);
});

app.post('/api/skills', authMiddleware, (req, res) => {
  const db = readDB();
  const skill = { id: uuidv4(), ...req.body };
  db.skills.push(skill);
  writeDB(db);
  logActivity('SKILLS', `Added skill: ${skill.name}`, 'SUCCESS');
  res.json(skill);
});

app.put('/api/skills/:id', authMiddleware, (req, res) => {
  const db = readDB();
  const idx = db.skills.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Skill not found' });
  db.skills[idx] = { ...db.skills[idx], ...req.body };
  writeDB(db);
  res.json(db.skills[idx]);
});

app.delete('/api/skills/:id', authMiddleware, (req, res) => {
  const db = readDB();
  const idx = db.skills.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Skill not found' });
  const removed = db.skills.splice(idx, 1)[0];
  writeDB(db);
  logActivity('SKILLS', `Deleted skill: ${removed.name}`, 'WARN');
  res.json({ success: true });
});

// ═══════════════════════════════════════════════
// EXPERIENCE (AUTH REQUIRED)
// ═══════════════════════════════════════════════
app.get('/api/experience', (req, res) => {
  const db = readDB();
  res.json(db.experience);
});

app.post('/api/experience', authMiddleware, (req, res) => {
  const db = readDB();
  const exp = { id: uuidv4(), ...req.body };
  db.experience.push(exp);
  writeDB(db);
  logActivity('EXPERIENCE', `Added: ${exp.company}`, 'SUCCESS');
  res.json(exp);
});

app.put('/api/experience/:id', authMiddleware, (req, res) => {
  const db = readDB();
  const idx = db.experience.findIndex(e => e.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Experience not found' });
  db.experience[idx] = { ...db.experience[idx], ...req.body };
  writeDB(db);
  res.json(db.experience[idx]);
});

app.delete('/api/experience/:id', authMiddleware, (req, res) => {
  const db = readDB();
  const idx = db.experience.findIndex(e => e.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Experience not found' });
  const removed = db.experience.splice(idx, 1)[0];
  writeDB(db);
  logActivity('EXPERIENCE', `Deleted: ${removed.company}`, 'WARN');
  res.json({ success: true });
});

// ═══════════════════════════════════════════════
// BLOCKED IPs (AUTH REQUIRED)
// ═══════════════════════════════════════════════
app.get('/api/blocked-ips', authMiddleware, (req, res) => {
  const db = readDB();
  res.json(db.blockedIPs);
});

app.post('/api/blocked-ips', authMiddleware, (req, res) => {
  const { ip } = req.body;
  if (!ip) return res.status(400).json({ error: 'IP required' });
  const db = readDB();
  if (!db.blockedIPs.includes(ip)) {
    db.blockedIPs.push(ip);
    writeDB(db);
    logActivity('SECURITY', `Blocked IP: ${ip}`, 'WARN');
  }
  res.json({ success: true, blockedIPs: db.blockedIPs });
});

app.delete('/api/blocked-ips/:ip', authMiddleware, (req, res) => {
  const db = readDB();
  db.blockedIPs = db.blockedIPs.filter(ip => ip !== req.params.ip);
  writeDB(db);
  logActivity('SECURITY', `Unblocked IP: ${req.params.ip}`, 'INFO');
  res.json({ success: true });
});

// ═══════════════════════════════════════════════
// ACTIVITY LOG (AUTH REQUIRED)
// ═══════════════════════════════════════════════
app.get('/api/activity', authMiddleware, (req, res) => {
  const db = readDB();
  res.json(db.activityLog.slice(0, 100));
});

app.delete('/api/activity', authMiddleware, (req, res) => {
  const db = readDB();
  db.activityLog = [];
  writeDB(db);
  res.json({ success: true });
});

// ═══════════════════════════════════════════════
// NOTIFICATIONS (AUTH REQUIRED)
// ═══════════════════════════════════════════════
app.get('/api/notifications', authMiddleware, (req, res) => {
  const db = readDB();
  res.json(db.notifications || []);
});

app.post('/api/notifications', authMiddleware, (req, res) => {
  const db = readDB();
  if (!db.notifications) db.notifications = [];
  const notif = { id: uuidv4(), ...req.body, time: Date.now(), read: false };
  db.notifications.unshift(notif);
  if (db.notifications.length > 50) db.notifications = db.notifications.slice(0, 50);
  writeDB(db);
  res.json(notif);
});

app.delete('/api/notifications/:id', authMiddleware, (req, res) => {
  const db = readDB();
  db.notifications = (db.notifications || []).filter(n => n.id !== req.params.id);
  writeDB(db);
  res.json({ success: true });
});

app.delete('/api/notifications', authMiddleware, (req, res) => {
  const db = readDB();
  db.notifications = [];
  writeDB(db);
  res.json({ success: true });
});

// ═══════════════════════════════════════════════
// SETTINGS & EDITOR (AUTH REQUIRED)
// ═══════════════════════════════════════════════
app.get('/api/settings', authMiddleware, (req, res) => {
  const db = readDB();
  res.json({ settings: db.settings || {}, editor: db.editor || {} });
});

app.put('/api/settings', authMiddleware, (req, res) => {
  const db = readDB();
  if (req.body.settings) db.settings = { ...db.settings, ...req.body.settings };
  if (req.body.editor) db.editor = { ...db.editor, ...req.body.editor };
  writeDB(db);
  logActivity('SETTINGS', 'Settings updated', 'SUCCESS');
  res.json({ success: true });
});

// ═══════════════════════════════════════════════
// EXPORT DATA (AUTH REQUIRED)
// ═══════════════════════════════════════════════
app.get('/api/export', authMiddleware, (req, res) => {
  const db = readDB();
  const exported = { ...db };
  delete exported.admin;
  res.json(exported);
});

// ═══════════════════════════════════════════════
// FALLBACK — serve index.html for SPA-like routing
// ═══════════════════════════════════════════════
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '..', 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, '..', 'admin.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, '..', 'login.html')));

// ═══════════════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════════════
app.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════════════╗');
  console.log('  ║  ⬡ SUMIT-LABS BACKEND SERVER                ║');
  console.log('  ║  ═══════════════════════════════════════════ ║');
  console.log(`  ║  🌐 Portfolio:  http://localhost:${PORT}          ║`);
  console.log(`  ║  🔒 Login:      http://localhost:${PORT}/login    ║`);
  console.log(`  ║  ⚙  Admin:      http://localhost:${PORT}/admin    ║`);
  console.log(`  ║  📡 API:        http://localhost:${PORT}/api      ║`);
  console.log('  ║  ─────────────────────────────────────────── ║');
  console.log('  ║  Default Password: radhey                    ║');
  console.log('  ╚══════════════════════════════════════════════╝');
  console.log('');
});
