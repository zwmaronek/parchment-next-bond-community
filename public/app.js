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
loadCategories().then(loadThreads);
