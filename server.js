const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Share-card image: embedded as base64 text in og-image-data.js because the
// PNG itself cannot travel through the text-only deploy path. Served at the
// same /og-image.png URL the meta tags point at; the static file wins
// locally when it exists, this route covers the deployed site.
let ogImageBuf = null;
try { ogImageBuf = Buffer.from(require('./og-image-data.js'), 'base64'); } catch (e) { ogImageBuf = null; }
app.get('/og-image.png', (req, res) => {
  if (!ogImageBuf) return res.status(404).send('Not found.');
  res.set('Content-Type', 'image/png');
  res.set('Cache-Control', 'public, max-age=86400');
  res.send(ogImageBuf);
});

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

let mem = { threads: [], comments: [], nextThread: 1, nextComment: 1, sections: [], sectionComments: [], nextSection: 1, nextSectionComment: 1 };
const SEED = [
  { title: 'What should be fixed first?', category: 'Buildings and repairs', body: 'Share which building needs you think should come first in a next proposal, and why. Focus on the need itself, not on any person.' },
  { title: 'What would make a next proposal easier to understand?', category: 'Cost and taxes', body: 'What information about costs, taxes, and timing would help residents judge a next proposal fairly?' },
  { title: 'How should a next proposal be phased?', category: 'Timeline and phasing', body: 'Should work be done all at once or in stages? What are the tradeoffs you see?' },
];

const SEED_SECTIONS = [
  { title: 'Repair Parchment Middle School instead of closing it', building: 'Parchment Middle School', source: 'State study, not the 2026 bond', cost: 12788595, cost_label: '$12,788,595, phased over 9 years', detail: 'Statewide Facilities Study, certified July 29, 2024: total repair $12,788,595. Critical years 1-3: $3,332,951. Near term: $8,045,655. Long term: $1,409,989. Full replacement: $38,281,736. The study\'s Most Cost-Effective determination was repair for the middle school and for every Parchment building.', open_question: 'If the middle school is repaired, what happens to the grade 7-8 plan, and what is repaired first?' },
  { title: 'New grades 7-8 wing at Parchment High School', building: 'Parchment High School', source: '2026 bond, $41M plan', cost: 14615611, cost_label: '$14,615,611 across all series', detail: 'Dedicated entrance, classrooms, science lab, cafeteria and multipurpose space, plus boiler, electrical, furniture and technology. $13,173,618 in the first series. The 2026 plan said the middle school would no longer be necessary if this wing was built.', open_question: 'Does a new wing cost more than repairing the whole middle school, and what does it solve that repair does not?' },
  { title: 'North Elementary, grades 3-6', building: 'North Elementary', source: '2026 bond, $41M plan', cost: 17447000, cost_label: '$17,447,000', detail: 'Classroom addition, new competition gym, secure vestibule, boiler and electrical work, parking, playground, furniture and technology.', open_question: 'Which parts of this are urgent, and which could wait or be phased?' },
  { title: 'Northwood Elementary, grades K-2', building: 'Northwood Elementary', source: '2026 bond, $41M plan', cost: 8059000, cost_label: '$8,059,000', detail: 'New gym addition, roofing, boiler and electrical work, parking, playground, furniture and technology.', open_question: 'Which parts of this are urgent, and which could wait or be phased?' },
  { title: 'Central Elementary: early learning center and district offices', building: 'Central Elementary', source: '2026 bond, $41M plan', cost: 306801, cost_label: '$306,801', detail: 'Conversion to an early learning center and district administrative offices, with furniture, technology and fire alarm replacement. Bond funds cannot by law pay salaries, benefits, or operating costs.', open_question: 'What should Central be used for if it is not an elementary school?' },
  { title: 'Parchment Middle School: sell or demolish', building: 'Parchment Middle School', source: '2026 bond, $41M plan', cost: 420949, cost_label: '$420,949 for demolition and site restoration if not sold', detail: 'The 2026 plan listed the middle school as SELL or DEMOLISH, said it was one of the district\'s most expensive buildings to maintain, and said sale proceeds would go to other facility needs. No appraisal or sale-value record was identified in October 2026.', open_question: 'If it is sold, what use restrictions and sale assumptions are built in, and what would the proceeds actually cover?' },
  { title: 'Phased critical repairs first', building: 'District-wide', source: 'State study, critical years 1-3', cost: 3332951, cost_label: '$3,332,951', detail: 'Critical middle school repairs in years 1-3 from the state study. A smaller first step instead of a full $41 million plan at once.', open_question: 'What would a phased plan need to show voters before a second phase?' },
  { title: 'Secure entrances and safety work, on their own', building: 'District-wide', source: 'Community idea, cost not priced separately before', cost: null, cost_label: 'Cost was inside the building projects above, not priced separately', detail: 'A secure vestibule at North Elementary was in the 2026 plan. Other safety items were bundled into building projects. Use this section to propose safety items on their own, with a cost estimate if you have one.', open_question: 'Which safety items matter most, and what would they cost on their own?' },
];
const PAST_BONDS = [
  { date: 'May 6, 2025', amount: '$36.4 million', result: 'Failed', votes: '705 yes, 797 no' },
  { date: 'Nov. 4, 2025', amount: '$32.35 million', result: 'Failed', votes: '962 yes, 1,040 no' },
  { date: 'Nov. 3, 2026', amount: '$41 million', result: 'Failed', votes: '2,035 yes, 2,367 no' },
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
  await pool.query(`CREATE TABLE IF NOT EXISTS sections (
    id SERIAL PRIMARY KEY, title TEXT NOT NULL, building TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'Community idea', detail TEXT NOT NULL,
    open_question TEXT NOT NULL DEFAULT '', cost BIGINT, cost_label TEXT NOT NULL DEFAULT '',
    display_name TEXT NOT NULL DEFAULT 'Community idea',
    upvotes INT NOT NULL DEFAULT 0, reports INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS section_comments (
    id SERIAL PRIMARY KEY, section_id INT NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
    body TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'idea',
    display_name TEXT NOT NULL DEFAULT 'A resident',
    upvotes INT NOT NULL DEFAULT 0, reports INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  const sr = await pool.query('SELECT COUNT(*)::int AS n FROM sections');
  if (sr.rows[0].n === 0) {
    for (const s of SEED_SECTIONS) {
      await pool.query('INSERT INTO sections (title, building, source, detail, open_question, cost, cost_label, display_name) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [s.title, s.building, s.source, s.detail, s.open_question, s.cost, s.cost_label, 'Past bond record']);
    }
  }
}
function seedMem() {
  if (mem.threads.length) return;
  for (const s of SEED) {
    mem.threads.push({ id: mem.nextThread++, title: s.title, body: s.body, category: s.category, display_name: 'Welcome thread', upvotes: 0, reports: 0, created_at: new Date().toISOString() });
  }
  if (!mem.sections.length) {
    for (const s of SEED_SECTIONS) {
      mem.sections.push({ id: mem.nextSection++, title: s.title, building: s.building, source: s.source, detail: s.detail, open_question: s.open_question, cost: s.cost, cost_label: s.cost_label, display_name: 'Past bond record', upvotes: 0, reports: 0, created_at: new Date().toISOString() });
    }
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
async function listSections() {
  if (usePg) {
    const { rows } = await pool.query(`SELECT s.*, (SELECT COUNT(*)::int FROM section_comments c WHERE c.section_id = s.id) AS comment_count FROM sections s ORDER BY upvotes DESC, created_at ASC`);
    return rows;
  }
  seedMem();
  return mem.sections.map(s => ({ ...s, comment_count: mem.sectionComments.filter(c => c.section_id === s.id).length }))
    .sort((a, b) => b.upvotes - a.upvotes || new Date(a.created_at) - new Date(b.created_at));
}
async function getSection(id) {
  if (usePg) {
    const { rows } = await pool.query('SELECT * FROM sections WHERE id = $1', [id]);
    if (!rows.length) return null;
    const c = await pool.query('SELECT * FROM section_comments WHERE section_id = $1 ORDER BY upvotes DESC, created_at ASC', [id]);
    return { ...rows[0], comments: c.rows };
  }
  seedMem();
  const s = mem.sections.find(x => x.id === id);
  if (!s) return null;
  return { ...s, comments: mem.sectionComments.filter(c => c.section_id === id).sort((a, b) => b.upvotes - a.upvotes || new Date(a.created_at) - new Date(b.created_at)) };
}
async function createSection({ title, building, detail, open_question, cost, cost_label, display_name }) {
  if (usePg) {
    const { rows } = await pool.query('INSERT INTO sections (title, building, source, detail, open_question, cost, cost_label, display_name) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
      [title, building, 'Community idea', detail, open_question, cost, cost_label, display_name]);
    return rows[0];
  }
  seedMem();
  const s = { id: mem.nextSection++, title, building, source: 'Community idea', detail, open_question, cost, cost_label, display_name, upvotes: 0, reports: 0, created_at: new Date().toISOString() };
  mem.sections.push(s); return s;
}
async function createSectionComment(sectionId, { body, kind, display_name }) {
  if (usePg) {
    const { rows } = await pool.query('INSERT INTO section_comments (section_id, body, kind, display_name) VALUES ($1,$2,$3,$4) RETURNING *',
      [sectionId, body, kind, display_name]);
    return rows[0];
  }
  const c = { id: mem.nextSectionComment++, section_id: sectionId, body, kind, display_name, upvotes: 0, reports: 0, created_at: new Date().toISOString() };
  mem.sectionComments.push(c); return c;
}
function taxEstimate(total) {
  const first = total / 41000000 * 3.95;
  const avg = total / 41000000 * 5.51;
  return { total, firstMill: Math.round(first * 100) / 100, avgMill: Math.round(avg * 100) / 100, per100kFirst: Math.round(first * 100), per100kAvg: Math.round(avg * 100), note: 'Rough estimate only, scaled from the 2026 $41 million ballot figures (3.95 mills in 2027, 5.51-mill simple average). Not a tax quote.' };
}
async function upvote(table, id) {
  if (usePg) {
    const { rows } = await pool.query(`UPDATE ${table} SET upvotes = upvotes + 1 WHERE id = $1 RETURNING *`, [id]);
    return rows[0] || null;
  }
  const list = table === 'threads' ? mem.threads : table === 'sections' ? mem.sections : table === 'section_comments' ? mem.sectionComments : mem.comments;
  const item = list.find(x => x.id === id);
  if (item) item.upvotes += 1;
  return item || null;
}
async function report(table, id) {
  if (usePg) {
    const { rows } = await pool.query(`UPDATE ${table} SET reports = reports + 1 WHERE id = $1 RETURNING *`, [id]);
    return rows[0] || null;
  }
  const list = table === 'threads' ? mem.threads : table === 'sections' ? mem.sections : table === 'section_comments' ? mem.sectionComments : mem.comments;
  const item = list.find(x => x.id === id);
  if (item) item.reports += 1;
  return item || null;
}

// ---------- Neutral summary ----------
// If GROQ_API_KEY is set, use it with a strictly neutral prompt. Otherwise
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
  if (!process.env.GROQ_API_KEY) return extractiveSummary(thread);
  try {
    const prompt = `Summarize this community discussion neutrally. Do not take a side for or against any bond idea, do not add facts not in the discussion, and do not name any private person. Return JSON only with keys: points (array of strings), agreement (string), disagreement (string), openQuestions (array of strings).\n\nThread: ${thread.title}\n${thread.body}\n\nComments:\n${(thread.comments || []).map(c => '- ' + c.body).join('\n').slice(0, 8000)}`;
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages: [{ role: 'user', content: prompt }], temperature: 0.2, response_format: { type: 'json_object' } }),
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
app.get('/api/past-bonds', (req, res) => res.json(PAST_BONDS));
app.get('/api/sections', async (req, res) => {
  try { res.json(await listSections()); }
  catch (e) { res.status(500).json({ error: 'Could not load sections.' }); }
});
app.get('/api/sections/:id', async (req, res) => {
  const s = await getSection(Number(req.params.id));
  if (!s) return res.status(404).json({ error: 'Section not found.' });
  res.json(s);
});
app.get('/api/sections/:id/summary', async (req, res) => {
  const s = await getSection(Number(req.params.id));
  if (!s) return res.status(404).json({ error: 'Section not found.' });
  res.json(await buildSummary({ title: s.title, body: s.detail + ' Open question: ' + s.open_question, comments: s.comments || [] }));
});
app.post('/api/sections', rateLimit, async (req, res) => {
  const title = clean(req.body.title, 200);
  const building = clean(req.body.building, 120) || 'District-wide';
  const detail = clean(req.body.detail, 4000);
  const open_question = clean(req.body.openQuestion, 500);
  let cost = null; let cost_label = 'No cost estimate given';
  if (req.body.cost !== '' && req.body.cost !== null && req.body.cost !== undefined) {
    const n = Number(req.body.cost);
    if (!Number.isFinite(n) || n < 0 || n > 200000000) return res.status(400).json({ error: 'Please give a cost between $0 and $200 million, or leave it blank.' });
    cost = Math.round(n);
    cost_label = '$' + cost.toLocaleString('en-US') + ' (community estimate)';
  }
  if (title.length < 3 || detail.length < 3) return res.status(400).json({ error: 'Please add a section title and what it would include.' });
  try { res.status(201).json(await createSection({ title, building, detail, open_question, cost, cost_label, display_name: displayName(req.body.displayName) })); }
  catch (e) { res.status(500).json({ error: 'Could not save the section.' }); }
});
app.post('/api/sections/:id/comments', rateLimit, async (req, res) => {
  const body = clean(req.body.body, 4000);
  const kind = ['idea', 'pro', 'con', 'question'].includes(req.body.kind) ? req.body.kind : 'idea';
  if (body.length < 2) return res.status(400).json({ error: 'Please add a point.' });
  const s = await getSection(Number(req.params.id));
  if (!s) return res.status(404).json({ error: 'Section not found.' });
  try { res.status(201).json(await createSectionComment(s.id, { body, kind, display_name: displayName(req.body.displayName) })); }
  catch (e) { res.status(500).json({ error: 'Could not save the point.' }); }
});
app.post('/api/sections/:id/upvote', async (req, res) => {
  const item = await upvote('sections', Number(req.params.id));
  if (!item) return res.status(404).json({ error: 'Not found.' });
  res.json(item);
});
app.post('/api/sections/:id/report', async (req, res) => {
  const item = await report('sections', Number(req.params.id));
  if (!item) return res.status(404).json({ error: 'Not found.' });
  res.json({ reported: true });
});
app.post('/api/section-comments/:id/upvote', async (req, res) => {
  const item = await upvote('section_comments', Number(req.params.id));
  if (!item) return res.status(404).json({ error: 'Not found.' });
  res.json(item);
});
// Draft-only edits from the workshop table: a resident can rename a
// section, move it to another building, or change its cost in their own
// draft. Overrides apply to the draft copy only; the shared section in
// the database is never changed.
function withDraftOverrides(s, overrides) {
  const ov = overrides[String(s.id)] || overrides[s.id] || {};
  const copy = { ...s };
  if (typeof ov.title === 'string' && ov.title.trim()) copy.title = clean(ov.title, 200);
  if (typeof ov.building === 'string') copy.building = clean(ov.building, 120);
  if ('cost' in ov) {
    if (ov.cost === null) copy.cost = null;
    else if (typeof ov.cost === 'number' && Number.isFinite(ov.cost) && ov.cost >= 0 && ov.cost <= 200000000) copy.cost = Math.round(ov.cost);
  }
  copy.cost_label = typeof copy.cost === 'number' ? '$' + copy.cost.toLocaleString('en-US') : 'No cost estimate yet';
  return copy;
}
async function draftSections(req) {
  const ids = Array.isArray(req.body.sectionIds) ? req.body.sectionIds.map(Number).filter(n => Number.isFinite(n)).slice(0, 20) : [];
  if (!ids.length) return null;
  const overrides = req.body.overrides && typeof req.body.overrides === 'object' ? req.body.overrides : {};
  const sections = [];
  for (const id of ids) {
    const s = await getSection(id);
    if (s) sections.push(withDraftOverrides(s, overrides));
  }
  return sections.length ? sections : null;
}
app.post('/api/drafts', rateLimit, async (req, res) => {
  const sections = await draftSections(req);
  if (!sections) return res.status(400).json({ error: 'Add at least one section to your draft first.' });
  const known = sections.filter(s => typeof s.cost === 'number');
  const total = known.reduce((a, s) => a + s.cost, 0);
  const unknown = sections.length - known.length;
  const est = taxEstimate(total);
  const lines = sections.map(s => `- ${s.title} (${s.building}): ${s.cost_label}`).join('\n');
  const title = clean(req.body.title, 200) || `My bond draft: ${sections.length} sections, $${total.toLocaleString('en-US')} in priced sections`;
  const body = `A community draft built in the Build a Bond Workshop. This is a resident proposal, not a district proposal.\n\nSections:\n${lines}\n\nPriced total: $${total.toLocaleString('en-US')}${unknown ? `, plus ${unknown} section${unknown === 1 ? '' : 's'} with no cost estimate` : ''}.\nRough tax estimate, scaled from the 2026 $41 million ballot figures: about ${est.firstMill} mills in the first year ($${est.per100kFirst} per year on $100,000 of taxable value), ${est.avgMill}-mill simple average. Rough estimate only, not a tax quote.\n\nNote from the builder: ${clean(req.body.note, 1000) || 'No note added.'}`;
  try {
    const thread = await createThread({ title, body, category: 'Other ideas', display_name: displayName(req.body.displayName) });
    res.status(201).json({ thread, total, unknown, estimate: est });
  } catch (e) { res.status(500).json({ error: 'Could not save the draft.' }); }
});
// ---------- Draft advisor ----------
// Subtle, opt-in help for the workshop draft table. It runs only when a
// resident asks for it, and it never takes a side on any bond.
// Always available: a rules-based check against the app's own records
// (past bonds, seeded costs, the state study figure). When GROQ_API_KEY
// is set, the same draft also gets a short neutral AI review, and unpriced
// sections get rough AI estimate ranges. Estimates are always labeled
// rough, are never district figures, and never invent a cost where no
// comparable exists.
function automaticAdvice(sections) {
  const known = sections.filter(s => typeof s.cost === 'number');
  const total = known.reduce((a, s) => a + s.cost, 0);
  const unknown = sections.length - known.length;
  const advice = [];
  const past = PAST_BONDS.map(b => `${b.amount} (${b.date})`).join(', ');
  advice.push(`Your draft totals $${total.toLocaleString('en-US')} across ${sections.length} section${sections.length === 1 ? '' : 's'}. The last three asks were ${past}, and all three failed.`);
  if (total >= 32000000) advice.push('That total sits in the same range as the three failed asks, which were $32 million to $41 million.');
  else if (total > 0) advice.push('That total sits well under the last three asks, which were $32 million to $41 million.');
  if (known.length) {
    const biggest = known.reduce((a, s) => (s.cost > a.cost ? s : a), known[0]);
    if (total > 0 && biggest.cost / total > 0.6) advice.push(`One section, "${biggest.title}", is more than half of your draft. A phased plan sometimes splits a large piece across two votes.`);
  }
  const hay = sections.map(s => (s.title + ' ' + s.detail + ' ' + s.building).toLowerCase()).join(' ');
  const coverage = [
    [/middle school/, 'the middle school'],
    [/safety|secure/, 'safety work'],
    [/high school|wing/, 'the high school'],
    [/elementary/, 'an elementary school'],
  ];
  coverage.forEach(([re, label]) => {
    if (!re.test(hay)) advice.push(`Nothing in the draft covers ${label} yet. Add a section from the list or build your own if it belongs.`);
  });
  if (unknown) advice.push(unknown === 1 ? '1 section has no cost estimate, so the total above is a floor, not the full price.' : `${unknown} sections have no cost estimate, so the total above is a floor, not the full price.`);
  const estimates = [];
  sections.filter(s => typeof s.cost !== 'number').forEach(s => {
    const text = (s.title + ' ' + s.detail).toLowerCase();
    if (/middle school.*repair|repair.*middle school/.test(text)) {
      estimates.push({ sectionId: s.id, low: 12788595, high: 12788595, basis: 'State facilities study total repair figure for the middle school, $12,788,595.' });
    } else if (/wing|grades 7-8/.test(text)) {
      estimates.push({ sectionId: s.id, low: 14615611, high: 14615611, basis: '2026 plan figure for the grades 7-8 wing, $14,615,611 across all series.' });
    }
    // Any other unpriced section gets no invented number: the resident is
    // told to add their own estimate or ask the district for a figure.
  });
  return { mode: 'automatic', advice, estimates, total, unknown, estimate: taxEstimate(total), note: 'Automatic check against the workshop records. It is not a district statement, and any estimate is rough, not a quote.' };
}
async function aiAdvice(sections) {
  const base = automaticAdvice(sections);
  if (!process.env.GROQ_API_KEY) return base;
  try {
    const unpriced = sections.filter(s => typeof s.cost !== 'number');
    const prompt = `You are a neutral advisor for residents drafting a school bond proposal. Do not take a side for or against any bond, do not recommend voting either way, and do not invent district facts or prices. Use only the figures given below. Return JSON only with keys: advice (array of up to 5 short strings) and estimates (array of {sectionId, low, high, basis} for the unpriced sections only, low and high in dollars, basis naming which given figure it is based on; omit a section if no given figure is a fair comparable).\n\nKnown figures: middle school total repair $12,788,595 (state facilities study, certified July 29, 2024); grades 7-8 wing $14,615,611 (2026 plan, all series); North Elementary $17,447,000; Northwood Elementary $8,059,000; Central early learning center $306,801; middle school demolition $420,949; phased critical repairs $3,332,951. Past bonds: $36.4M May 2025 failed, $32.35M Nov 2025 failed, $41M Nov 2026 failed. Tax scaling: 3.95 mills in year one and 5.51-mill average per $41 million.\n\nDraft sections:\n${sections.map(s => `- id ${s.id}: ${s.title} (${s.building}): ${typeof s.cost === 'number' ? '$' + s.cost.toLocaleString('en-US') : 'no cost estimate yet'}`).join('\n')}\nDraft total: $${base.total.toLocaleString('en-US')}, plus ${base.unknown} unpriced section(s).`;
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      body: JSON.stringify({ model: 'llama-3.3-70b-versatile', messages: [{ role: 'user', content: prompt }], temperature: 0.2, response_format: { type: 'json_object' } }),
    });
    const data = await res.json();
    const parsed = JSON.parse(data.choices[0].message.content);
    const validIds = new Set(unpriced.map(s => s.id));
    const estimates = (Array.isArray(parsed.estimates) ? parsed.estimates : []).filter(e =>
      validIds.has(e.sectionId) && Number.isFinite(e.low) && Number.isFinite(e.high) && e.low >= 0 && e.high >= e.low && e.high <= 200000000
    ).map(e => ({ sectionId: e.sectionId, low: Math.round(e.low), high: Math.round(e.high), basis: clean(e.basis || '', 200) || 'AI estimate based on the given figures.' }));
    const advice = (Array.isArray(parsed.advice) ? parsed.advice : []).filter(a => typeof a === 'string' && a.trim()).slice(0, 5).map(a => a.trim());
    return { mode: 'ai', advice: advice.length ? advice : base.advice, estimates: estimates.length ? estimates : base.estimates, total: base.total, unknown: base.unknown, estimate: base.estimate, note: 'AI review. It is not a district statement, and any estimate is rough, not a quote.' };
  } catch (e) {
    return base;
  }
}
app.post('/api/drafts/advise', rateLimit, async (req, res) => {
  const sections = await draftSections(req);
  if (!sections) return res.status(400).json({ error: 'Add at least one section to your draft first.' });
  try { res.json(await aiAdvice(sections)); }
  catch (e) { res.status(500).json({ error: 'Advice is not available right now.' }); }
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
