let categories = [];
let currentThread = null;

function el(tag, text, cls) {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  if (cls) n.className = cls;
  return n;
}
async function loadCategories() {
  categories = await (await fetch('/api/categories')).json();
  const f = document.getElementById('categoryFilter');
  const n = document.getElementById('newCategory');
  categories.forEach(c => {
    f.appendChild(el('option', c));
    n.appendChild(el('option', c));
  });
}
async function loadThreads() {
  const cat = document.getElementById('categoryFilter').value;
  const q = document.getElementById('searchBox').value.trim();
  const params = new URLSearchParams();
  if (cat) params.set('category', cat);
  if (q) params.set('q', q);
  const threads = await (await fetch('/api/threads?' + params)).json();
  const list = document.getElementById('threadList');
  list.innerHTML = '';
  if (!threads.length) list.appendChild(el('p', 'No threads yet for this topic. Start one below.'));
  threads.forEach(t => {
    const d = el('div', undefined, 'thread');
    d.appendChild(el('h3', t.title));
    d.appendChild(el('p', `${t.category} | ${t.comment_count} comments | ${t.upvotes} upvotes | ${t.display_name}`, 'meta'));
    d.appendChild(el('p', t.body.slice(0, 220)));
    d.addEventListener('click', () => openThread(t.id));
    list.appendChild(d);
  });
}
async function openThread(id) {
  const t = await (await fetch('/api/threads/' + id)).json();
  currentThread = t;
  document.getElementById('threadDetail').hidden = false;
  document.getElementById('detailTitle').textContent = t.title;
  document.getElementById('detailMeta').textContent = `${t.category} | ${t.display_name} | ${t.upvotes} upvotes`;
  document.getElementById('detailBody').textContent = t.body;
  const actions = document.getElementById('detailActions');
  actions.innerHTML = '';
  const up = el('button', `Upvote (${t.upvotes})`);
  up.addEventListener('click', async () => { await fetch(`/api/threads/${t.id}/upvote`, { method: 'POST' }); openThread(t.id); });
  const rep = el('button', 'Report');
  rep.addEventListener('click', async () => { await fetch(`/api/threads/${t.id}/report`, { method: 'POST' }); alert('Thanks. This thread has been reported.'); });
  actions.append(up, rep);
  const cl = document.getElementById('commentList');
  cl.innerHTML = '';
  (t.comments || []).forEach(c => {
    const d = el('div', undefined, 'comment');
    d.appendChild(el('p', c.body));
    d.appendChild(el('p', `${c.display_name} | ${c.upvotes} upvotes`, 'meta'));
    const u = el('button', 'Upvote');
    u.addEventListener('click', async () => { await fetch(`/api/comments/${c.id}/upvote`, { method: 'POST' }); openThread(t.id); });
    const r = el('button', 'Report');
    r.addEventListener('click', async () => { await fetch(`/api/comments/${c.id}/report`, { method: 'POST' }); alert('Thanks. This comment has been reported.'); });
    d.append(u, r);
    cl.appendChild(d);
  });
  const sb = document.getElementById('summaryBox');
  sb.innerHTML = '';
  try {
    const s = await (await fetch(`/api/threads/${t.id}/summary`)).json();
    sb.appendChild(el('p', s.points ? s.points.join(' ') : ''));
    sb.appendChild(el('p', 'Agreement: ' + (s.agreement || '')));
    sb.appendChild(el('p', 'Different views: ' + (s.disagreement || '')));
    if (s.openQuestions && s.openQuestions.length) {
      sb.appendChild(el('p', 'Open questions:'));
      const ul = document.createElement('ul');
      s.openQuestions.forEach(q => ul.appendChild(el('li', q)));
      sb.appendChild(ul);
    }
    sb.appendChild(el('p', s.note || '', 'small'));
  } catch (e) {
    sb.appendChild(el('p', 'Summary is not available right now. Please read the comments directly.'));
  }
  document.getElementById('threadDetail').scrollIntoView();
}
document.getElementById('backBtn').addEventListener('click', () => {
  document.getElementById('threadDetail').hidden = true;
  loadThreads();
});
document.getElementById('refreshBtn').addEventListener('click', loadThreads);
document.getElementById('categoryFilter').addEventListener('change', loadThreads);
document.getElementById('searchBox').addEventListener('input', loadThreads);
document.getElementById('newThreadForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('newThreadMsg');
  const res = await fetch('/api/threads', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: document.getElementById('newTitle').value, body: document.getElementById('newBody').value, category: document.getElementById('newCategory').value, displayName: document.getElementById('newName').value }),
  });
  if (!res.ok) { msg.textContent = (await res.json()).error || 'Could not post.'; return; }
  const t = await res.json();
  msg.textContent = 'Thread posted.';
  e.target.reset();
  loadThreads();
  openThread(t.id);
});
document.getElementById('newCommentForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentThread) return;
  const msg = document.getElementById('commentMsg');
  const res = await fetch(`/api/threads/${currentThread.id}/comments`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body: document.getElementById('commentBody').value, displayName: document.getElementById('commentName').value }),
  });
  if (!res.ok) { msg.textContent = (await res.json()).error || 'Could not post.'; return; }
  msg.textContent = 'Comment posted.';
  e.target.reset();
  openThread(currentThread.id);
});
let sectionsCache = [];
let lastAdvice = null;
function myBondIds() {
  try { return JSON.parse(localStorage.getItem('myBondIds') || '[]'); } catch (e) { return []; }
}
function saveBondIds(ids) { localStorage.setItem('myBondIds', JSON.stringify(ids)); }
// Draft-only edits to a section: title, building, and cost as shown in the
// draft table. These live in the browser only and never rewrite the shared
// section, so the seeded 2026 costs stay as published for everyone else.
function myBondOverrides() {
  try { return JSON.parse(localStorage.getItem('myBondOverrides') || '{}'); } catch (e) { return {}; }
}
function saveBondOverrides(o) { localStorage.setItem('myBondOverrides', JSON.stringify(o)); }
function draftSection(s) {
  const ov = myBondOverrides()[s.id] || {};
  return {
    ...s,
    title: ov.title !== undefined ? ov.title : s.title,
    building: ov.building !== undefined ? ov.building : s.building,
    cost: ov.cost !== undefined ? ov.cost : s.cost,
  };
}
function money(n) { return '$' + Number(n).toLocaleString('en-US'); }
async function loadPastBonds() {
  const box = document.getElementById('pastBonds');
  if (!box) return;
  const bonds = await (await fetch('/api/past-bonds')).json();
  box.innerHTML = '';
  bonds.forEach(b => {
    const d = el('div', undefined, 'thread');
    d.appendChild(el('h3', `${b.date}: ${b.amount} bond`));
    d.appendChild(el('p', `${b.result}. ${b.votes}.`, 'meta'));
    box.appendChild(d);
  });
}
async function loadSections() {
  const list = document.getElementById('sectionList');
  if (!list) return;
  sectionsCache = await (await fetch('/api/sections')).json();
  list.classList.add('section-grid');
  list.innerHTML = '';
  sectionsCache.forEach(s => {
    const d = el('div', undefined, 'thread');
    d.appendChild(el('h3', s.title));
    d.appendChild(el('p', `${s.building} | ${s.source} | ${s.cost_label} | ${s.upvotes} votes | ${s.comment_count} points`, 'meta'));
    d.appendChild(el('p', s.detail));
    d.appendChild(el('p', 'Open question: ' + s.open_question, 'small'));
    const vote = el('button', `Vote for this section (${s.upvotes})`);
    vote.addEventListener('click', async (ev) => { ev.stopPropagation(); await fetch(`/api/sections/${s.id}/upvote`, { method: 'POST' }); loadSections(); });
    const add = el('button', myBondIds().includes(s.id) ? 'In my bond' : 'Add to my bond');
    add.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const ids = myBondIds();
      if (ids.includes(s.id)) { saveBondIds(ids.filter(x => x !== s.id)); }
      else { ids.push(s.id); saveBondIds(ids); }
      renderMyBond(); loadSections();
    });
    const discuss = el('button', 'Discuss this section');
    discuss.addEventListener('click', (ev) => { ev.stopPropagation(); openSection(s.id); });
    d.append(vote, add, discuss);
    list.appendChild(d);
  });
  renderMyBond();
}
async function openSection(id) {
  const s = await (await fetch('/api/sections/' + id)).json();
  const list = document.getElementById('sectionList');
  const box = el('div', undefined, 'card');
  box.appendChild(el('h3', 'Points on: ' + s.title));
  const sum = await (await fetch(`/api/sections/${id}/summary`)).json();
  box.appendChild(el('p', sum.points ? sum.points.join(' ') : ''));
  box.appendChild(el('p', 'Agreement: ' + (sum.agreement || '')));
  box.appendChild(el('p', 'Different views: ' + (sum.disagreement || '')));
  (s.comments || []).forEach(c => {
    const d = el('div', undefined, 'comment');
    d.appendChild(el('p', `[${c.kind}] ${c.body}`));
    d.appendChild(el('p', `${c.display_name} | ${c.upvotes} votes`, 'meta'));
    const u = el('button', 'Upvote');
    u.addEventListener('click', async () => { await fetch(`/api/section-comments/${c.id}/upvote`, { method: 'POST' }); openSection(id); });
    d.appendChild(u);
    box.appendChild(d);
  });
  const form = document.createElement('form');
  const kind = document.createElement('select');
  ['idea', 'pro', 'con', 'question'].forEach(k => kind.appendChild(el('option', k)));
  const body = document.createElement('textarea');
  body.required = true; body.rows = 3; body.placeholder = 'Add a point, a pro, a con, or a question about this section';
  const name = document.createElement('input');
  name.placeholder = 'Display name (optional)';
  const btn = el('button', 'Add point');
  btn.type = 'submit';
  form.append(kind, body, name, btn);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    await fetch(`/api/sections/${id}/comments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: body.value, kind: kind.value, displayName: name.value }) });
    openSection(id); loadSections();
  });
  box.appendChild(form);
  list.prepend(box);
  box.scrollIntoView();
}
function updateBondTotals() {
  const box = document.getElementById('myBond');
  if (!box) return;
  const rows = box.querySelectorAll('tbody tr');
  let total = 0; let unknown = 0;
  rows.forEach(r => {
    const v = r.querySelector('.bond-cost').value;
    if (v === '') unknown += 1;
    else total += Number(v) || 0;
  });
  const totalCell = document.getElementById('bondTotalCell');
  const unknownCell = document.getElementById('bondUnknownCell');
  const taxCell = document.getElementById('bondTaxCell');
  if (!totalCell) return;
  totalCell.textContent = money(total);
  unknownCell.textContent = unknown ? `${unknown} section${unknown === 1 ? '' : 's'} with no cost estimate` : '';
  const first = total / 41000000 * 3.95;
  const avg = total / 41000000 * 5.51;
  taxCell.textContent = `Rough tax estimate, scaled from the 2026 $41 million ballot figures: about ${first.toFixed(2)} mills in the first year ($${Math.round(first * 100)} per year on $100,000 of taxable value), ${avg.toFixed(2)}-mill simple average. Rough estimate only, not a tax quote.`;
}
function renderMyBond() {
  const box = document.getElementById('myBond');
  if (!box) return;
  const ids = myBondIds();
  const picked = sectionsCache.filter(s => ids.includes(s.id)).map(draftSection);
  box.innerHTML = '';
  if (!picked.length) { box.appendChild(el('p', 'No sections picked yet. Use Add to my bond on a section below.')); return; }
  const wrap = el('div', undefined, 'table-scroll');
  const table = document.createElement('table');
  table.className = 'bond-table';
  table.innerHTML = '<thead><tr><th>Section</th><th>Building</th><th>Cost</th><th>Votes</th><th></th></tr></thead>';
  const tbody = document.createElement('tbody');
  picked.forEach(s => {
    const tr = document.createElement('tr');
    const titleTd = document.createElement('td');
    const title = document.createElement('input');
    title.type = 'text'; title.className = 'bond-title'; title.value = s.title; title.maxLength = 200;
    title.setAttribute('aria-label', 'Section title');
    titleTd.appendChild(title);
    const bldTd = document.createElement('td');
    const bld = document.createElement('input');
    bld.type = 'text'; bld.className = 'bond-building'; bld.value = s.building || ''; bld.maxLength = 120;
    bld.setAttribute('aria-label', 'Building');
    bldTd.appendChild(bld);
    const costTd = document.createElement('td');
    costTd.className = 'cost-cell';
    const cost = document.createElement('input');
    cost.type = 'number'; cost.className = 'bond-cost'; cost.min = '0'; cost.max = '200000000'; cost.step = '1';
    cost.value = typeof s.cost === 'number' ? s.cost : '';
    cost.placeholder = 'No estimate';
    cost.setAttribute('aria-label', 'Cost in dollars');
    costTd.appendChild(cost);
    const votesTd = el('td', String(s.upvotes || 0));
    const rmTd = document.createElement('td');
    const rm = el('button', 'Remove');
    rm.type = 'button';
    rm.addEventListener('click', () => {
      const o = myBondOverrides(); delete o[s.id]; saveBondOverrides(o);
      saveBondIds(myBondIds().filter(x => x !== s.id));
      renderMyBond(); loadSections();
    });
    rmTd.appendChild(rm);
    tr.append(titleTd, bldTd, costTd, votesTd, rmTd);
    const onEdit = () => {
      const o = myBondOverrides();
      const costVal = cost.value === '' ? null : Number(cost.value);
      o[s.id] = { title: title.value, building: bld.value, cost: costVal };
      saveBondOverrides(o);
      updateBondTotals();
    };
    [title, bld, cost].forEach(inp => inp.addEventListener('input', onEdit));
    tbody.appendChild(tr);
  });
  const tfoot = document.createElement('tfoot');
  tfoot.innerHTML = '<tr><td colspan="2">Priced total</td><td id="bondTotalCell"></td><td id="bondUnknownCell" colspan="2"></td></tr>' +
    '<tr><td colspan="5" id="bondTaxCell" class="small"></td></tr>';
  table.append(tbody, tfoot);
  wrap.appendChild(table);
  box.appendChild(wrap);
  box.appendChild(el('p', 'Edit any cell in the table. Edits change only your draft, not the shared sections, and the total and tax estimate update as you type.', 'small'));
  const clear = el('button', 'Clear my draft');
  clear.addEventListener('click', () => { saveBondIds([]); saveBondOverrides({}); lastAdvice = null; renderMyBond(); loadSections(); });
  const advise = el('button', 'Get advice on this draft');
  advise.addEventListener('click', async () => {
    advise.disabled = true; advise.textContent = 'Checking your draft...';
    try {
      const res = await fetch('/api/drafts/advise', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sectionIds: myBondIds(), overrides: myBondOverrides() }),
      });
      if (!res.ok) throw new Error('advice failed');
      lastAdvice = await res.json();
    } catch (e) {
      lastAdvice = { mode: 'automatic', advice: ['Advice is not available right now. Your draft and its totals are still above, unchanged.'], estimates: [], note: '' };
    }
    renderMyBond();
  });
  box.appendChild(clear);
  box.appendChild(advise);
  updateBondTotals();
  renderAdvice();
}
function renderAdvice() {
  const box = document.getElementById('myBond');
  if (!box || !lastAdvice) return;
  const wrap = el('div', undefined, 'advice-box');
  wrap.appendChild(el('h4', lastAdvice.mode === 'ai' ? 'AI suggestions on this draft' : 'A check on this draft'));
  const ul = document.createElement('ul');
  lastAdvice.advice.forEach(a => ul.appendChild(el('li', a)));
  wrap.appendChild(ul);
  (lastAdvice.estimates || []).forEach(est => {
    const s = sectionsCache.find(x => x.id === est.sectionId);
    if (!s) return;
    const current = draftSection(s);
    const row = el('p', `${s.title}: roughly ${money(est.low)} to ${money(est.high)}. ${est.basis} `);
    if (typeof current.cost === 'number') {
      row.appendChild(el('span', 'Applied.', 'small'));
    } else {
      const mid = Math.round((est.low + est.high) / 2);
      const use = el('button', `Use ${money(mid)}`);
      use.type = 'button';
      use.addEventListener('click', () => {
        const o = myBondOverrides();
        o[s.id] = { ...(o[s.id] || {}), title: current.title, building: current.building, cost: mid };
        saveBondOverrides(o);
        renderMyBond();
      });
      row.appendChild(use);
    }
    wrap.appendChild(row);
  });
  if (lastAdvice.note) wrap.appendChild(el('p', lastAdvice.note, 'small'));
  const dismiss = el('button', 'Hide advice');
  dismiss.type = 'button';
  dismiss.addEventListener('click', () => { lastAdvice = null; renderMyBond(); });
  wrap.appendChild(dismiss);
  box.appendChild(wrap);
}
document.getElementById('newSectionForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('sectionMsg');
  const costVal = document.getElementById('sectionCost').value;
  const res = await fetch('/api/sections', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: document.getElementById('sectionTitle').value, building: document.getElementById('sectionBuilding').value, detail: document.getElementById('sectionDetail').value, openQuestion: document.getElementById('sectionQuestion').value, cost: costVal === '' ? null : Number(costVal), displayName: document.getElementById('sectionName').value }),
  });
  if (!res.ok) { msg.textContent = (await res.json()).error || 'Could not save the section.'; return; }
  msg.textContent = 'Section added. Vote for it, and add it to your draft.';
  e.target.reset();
  loadSections();
});
document.getElementById('draftForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = document.getElementById('draftMsg');
  const res = await fetch('/api/drafts', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sectionIds: myBondIds(), overrides: myBondOverrides(), title: document.getElementById('draftTitle').value, note: document.getElementById('draftNote').value, displayName: document.getElementById('draftName').value }),
  });
  if (!res.ok) { msg.textContent = (await res.json()).error || 'Could not submit the draft.'; return; }
  const data = await res.json();
  msg.textContent = `Draft submitted as a proposal thread. Priced total ${money(data.total)}.`;
  saveBondIds([]);
  saveBondOverrides({});
  renderMyBond();
  loadThreads();
  openThread(data.thread.id);
});
loadCategories().then(loadThreads);
loadPastBonds();
loadSections();

