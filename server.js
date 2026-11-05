const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const CATEGORIES = [
  'Buildings and repairs',
  'Classrooms and learning',
  'Safety',
  'Cost and taxes',
  'Timeline and phasing',
  'Other ideas',
];

function clean(str, max) {
  if (typeof str !== 'string') return '';
  return str.trim().slice(0, max);
}
function displayName(v) {
  const n = clean(v, 60);
  return n || 'A resident';
}

// ---------- Storage: Postgres when DATABASE_URL is set, otherwise in-memory ----------
let usePg = !!process.env.DATABASE_URL;
let pool = null;
if (usePg) {
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes('render.com') || process.env.DATABASE_URL.includes('postgres')
      ? { rejectUnauthorized: false } : false,
  });
}

let mem = { threads: [], comments: [], nextThread: 1, nextComment: 1 };
const SEED = [
  { title: 'What should be fixed first?', category: 'Buildings and repairs', body: 'Share which building needs you think should come first in a next proposal, and why. Focus on the need itself, not on any person.' },
  { title: 'What would make a next proposal easier to understand?', category: 'Cost and taxes', body: 'What information about costs, taxes, and timing would help residents judge a next proposal fairly?' },
  { title: 'How should a next proposal be phased?', category: 'Timeline and phasing', body: 'Should work be done all at once or in stages? What are the tradeoffs you see?' },
];

async function initPg() {
  await pool.query(`CREATE TABLE IF NOT EXISTS threads (
    id SERIAL PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL,
    category TEXT NOT NULL, display_name TEXT NOT NULL DEFAULT 'A resident',
    upvotes INT NOT NULL DEFAULT 0, reports INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS comments (
    id SERIAL PRIMARY KEY, thread_id INT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    body TEXT NOT NULL, display_name TEXT NOT NULL DEFAULT 'A resident',
    upvotes INT NOT NULL DEFAULT 0, reports INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM threads');
  if (rows[0].n === 0) {
    for (const s of SEED) {
      await pool.query('INSERT INTO threads (title, body, category, display_name) VALUES ($1,$2,$3,$4)',
        [s.title, s.body, s.category, 'Welcome thread']);
    }
  }
}
function seedMem() {
  if (mem.threads.length) return;
  for (const s of SEED) {
    mem.threads.push({ id: mem.nextThread++, title: s.title, body: s.body, category: s.category, display_name: 'Welcome thread', upvotes: 0, reports: 0, created_at: new Date().toISOString() });
  }
}
async function listThreads(category, q) {
  if (usePg) {
    const cond = []; const args = [];
    if (category && CATEGORIES.includes(category)) { args.push(category); cond.push(`category = $${args.length}`); }
    if (q) { args.push(`%${q}%`); cond.push(`(title ILIKE $${args.length} OR body ILIKE $${args.length})`); }
    const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
    const { rows } = await pool.query(`SELECT t.*, (SELECT COUNT(*)::int FROM comments c WHERE c.thread_id = t.id) AS comment_count FROM threads t ${where} ORDER BY upvotes DESC, created_at DESC LIMIT 200`, args);
    return rows;
  }
  seedMem();
  return mem.threads.filter(t => (!category || t.category === category) && (!q || (t.title + t.body).toLowerCase().includes(q.toLowerCase())))
    .map(t => ({ ...t, comment_count: mem.comments.filter(c => c.thread_id === t.id).length }))
    .sort((a, b) => b.upvotes - a.upvotes || new Date(b.created_at) - new Date(a.created_at));
}
async function getThread(id) {
  if (usePg) {
    const { rows } = await pool.query('SELECT * FROM threads WHERE id = $1', [id]);
    if (!rows.length) return null;
    const c = await pool.query('SELECT * FROM comments WHERE thread_id = $1 ORDER BY upvotes DESC, created_at ASC', [id]);
    return { ...rows[0], comments: c.rows };
  }
  seedMem();
  const t = mem.threads.find(x => x.id === id);
  if (!t) return null;
  return { ...t, comments: mem.comments.filter(c => c.thread_id === id).sort((a, b) => b.upvotes - a.upvotes || new Date(a.created_at) - new Date(b.created_at)) };
}
async function createThread({ title, body, category, display_name }) {
  if (usePg) {
    const { rows } = await pool.query('INSERT INTO threads (title, body, category, display_name) VALUES ($1,$2,$3,$4) RETURNING *',
      [title, body, category, display_name]);
    return rows[0];
  }
  seedMem();
  const t = { id: mem.nextThread++, title, body, category, display_name, upvotes: 0, reports: 0, created_at: new Date().toISOString() };
  mem.threads.push(t); return t;
}
async function createComment(threadId, { body, display_name }) {
  if (usePg) {
    const { rows } = await pool.query('INSERT INTO comments (thread_id, body, display_name) VALUES ($1,$2,$3) RETURNING *',
      [threadId, body, display_name]);
    return rows[0];
  }
  const c = { id: mem.nextComment++, thread_id: threadId, body, display_name, upvotes: 0, reports: 0, created_at: new Date().toISOString() };
  mem.comments.push(c); return c;
}
async function upvote(table, id) {
  if (usePg) {
    const { rows } = await pool.query(`UPDATE ${table} SET upvotes = upvotes + 1 WHERE id = $1 RETURNING *`, [id]);
    return rows[0] || null;
  }
  const list = table === 'threads' ? mem.threads : mem.comments;
  const item = list.find(x => x.id === id);
  if (item) item.upvotes += 1;
  return item || null;
}
async function report(table, id) {
  if (usePg) {
    const { rows } = await pool.query(`UPDATE ${table} SET reports = reports + 1 WHERE id = $1 RETURNING *`, [id]);
    return rows[0] || null;
  }
  const list = table === 'threads' ? mem.threads : mem.comments;
  const item = list.find(x => x.id === id);
  if (item) item.reports += 1;
  return item || null;
}

// ---------- Neutral summary ----------
// If OPENAI_API_KEY is set, use it with a strictly neutral prompt. Otherwise
// fall back to an extractive summary built only from the thread itself.
// Either way the summary never takes a side and never adds outside facts.
function extractiveSummary(thread) {
  const comments = thread.comments || [];
  const texts = comments.map(c => c.body);
  const questions = texts.filter(t => t.includes('?')).slice(0, 5);
  const keywords = ['repair', 'roof', 'cost', 'tax', 'safety', 'classroom', 'building', 'middle school', 'elementary', 'timeline', 'phase', 'bus', 'parking', 'hvac', 'plumbing'];
  const raised = keywords.filter(k => (thread.title + ' ' + thread.body + ' ' + texts.join(' ')).toLowerCase().includes(k));
  const hasContrast = /should not|too much|too little|disagree|instead|rather than/i.test(texts.join(' '));
  return {
    mode: 'automatic',
    points: [
      `This thread has ${comments.length} comment${comments.length === 1 ? '' : 's'}.`,
      raised.length ? `Topics raised here include: ${raised.slice(0, 6).join(', ')}.` : 'No single topic dominates this thread yet.',
      texts.length ? 'The points below are taken from the comments themselves, in the commenters’ own direction.' : 'No comments yet. Be the first to add an idea.',
    ],
    agreement: comments.length >= 2
      ? 'Agreement cannot be assumed from comment counts alone. Read the comments to see where commenters converge.'
      : 'Not enough comments yet to describe agreement.',
    disagreement: hasContrast
      ? 'Different views appear in this thread. The comments show at least one point where commenters pull in different directions.'
      : 'No clear disagreement is visible in the comments so far.',
    openQuestions: questions.length ? questions.map(q => q.split('?')[0].trim().slice(0, 200) + '?') : ['What would help move this idea forward?'],
    note: 'Automatic summary. It is not a district statement and does not replace reading the comments.',
  };
}
async function buildSummary(thread) {
  if (!process.env.OPENAI_API_KEY) return extractiveSummary(thread);
  try {
    const prompt = `Summarize this community discussion neutrally. Do not take a side for or against any bond idea, do not add facts not in the discussion, and do not name any private person. Return JSON only with keys: points (array of strings), agreement (string), disagreement (string), openQuestions (array of strings).\n\nThread: ${thread.title}\n${thread.body}\n\nComments:\n${(thread.comments || []).map(c => '- ' + c.body).join('\n').slice(0, 8000)}`;
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }], temperature: 0.2 }),
    });
    const data = await res.json();
    const parsed = JSON.parse(data.choices[0].message.content);
    return { mode: 'ai', ...parsed, note: 'AI summary. It is not a district statement and does not replace reading the comments.' };
  } catch (e) {
    return extractiveSummary(thread);
  }
}

// ---------- Simple per-IP rate limit for posting ----------
const hits = new Map();
function rateLimit(req, res, next) {
  const ip = req.ip || 'unknown';
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < 3600 * 1000);
  if (arr.length >= 30) return res.status(429).json({ error: 'Too many posts in the last hour. Please try again later.' });
  arr.push(now); hits.set(ip, arr); next();
}

// ---------- API ----------
app.get('/api/categories', (req, res) => res.json(CATEGORIES));
app.get('/api/threads', async (req, res) => {
  try { res.json(await listThreads(req.query.category || '', req.query.q || '')); }
  catch (e) { res.status(500).json({ error: 'Could not load threads.' }); }
});
app.get('/api/threads/:id', async (req, res) => {
  const t = await getThread(Number(req.params.id));
  if (!t) return res.status(404).json({ error: 'Thread not found.' });
  res.json(t);
});
app.get('/api/threads/:id/summary', async (req, res) => {
  const t = await getThread(Number(req.params.id));
  if (!t) return res.status(404).json({ error: 'Thread not found.' });
  res.json(await buildSummary(t));
});
app.post('/api/threads', rateLimit, async (req, res) => {
  const title = clean(req.body.title, 200);
  const body = clean(req.body.body, 4000);
  const category = CATEGORIES.includes(req.body.category) ? req.body.category : 'Other ideas';
  if (title.length < 3 || body.length < 3) return res.status(400).json({ error: 'Please add a title and a description.' });
  try { res.status(201).json(await createThread({ title, body, category, display_name: displayName(req.body.displayName) })); }
  catch (e) { res.status(500).json({ error: 'Could not save the thread.' }); }
});
app.post('/api/threads/:id/comments', rateLimit, async (req, res) => {
  const body = clean(req.body.body, 4000);
  if (body.length < 2) return res.status(400).json({ error: 'Please add a comment.' });
  const t = await getThread(Number(req.params.id));
  if (!t) return res.status(404).json({ error: 'Thread not found.' });
  try { res.status(201).json(await createComment(t.id, { body, display_name: displayName(req.body.displayName) })); }
  catch (e) { res.status(500).json({ error: 'Could not save the comment.' }); }
});
app.post('/api/threads/:id/upvote', async (req, res) => {
  const item = await upvote('threads', Number(req.params.id));
  if (!item) return res.status(404).json({ error: 'Not found.' });
  res.json(item);
});
app.post('/api/comments/:id/upvote', async (req, res) => {
  const item = await upvote('comments', Number(req.params.id));
  if (!item) return res.status(404).json({ error: 'Not found.' });
  res.json(item);
});
app.post('/api/threads/:id/report', async (req, res) => {
  const item = await report('threads', Number(req.params.id));
  if (!item) return res.status(404).json({ error: 'Not found.' });
  res.json({ reported: true });
});
app.post('/api/comments/:id/report', async (req, res) => {
  const item = await report('comments', Number(req.params.id));
  if (!item) return res.status(404).json({ error: 'Not found.' });
  res.json({ reported: true });
});
app.get('/health', (req, res) => res.json({ ok: true }));

(async () => {
  try {
    if (usePg) { await initPg(); console.log('Using Postgres'); }
    else { seedMem(); console.log('Using in-memory store (set DATABASE_URL for Postgres)'); }
  } catch (e) {
    console.log('Postgres init failed, falling back to in-memory store:', e.message);
    usePg = false; seedMem();
  }
  app.listen(PORT, () => console.log(`Listening on ${PORT}`));
})();
