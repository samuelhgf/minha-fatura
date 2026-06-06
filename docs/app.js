'use strict';

// ─── Theme ────────────────────────────────────────────────────────────────────
const themeToggle = document.getElementById('themeToggle');
const iconSun  = themeToggle.querySelector('.icon-sun');
const iconMoon = themeToggle.querySelector('.icon-moon');

function getTheme() {
  return document.documentElement.getAttribute('data-theme') ||
    (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
  iconSun.classList.toggle('hidden', theme === 'dark');
  iconMoon.classList.toggle('hidden', theme !== 'dark');
}

applyTheme(getTheme());
themeToggle.addEventListener('click', () =>
  applyTheme(getTheme() === 'dark' ? 'light' : 'dark'));

const TYPE_LABEL = { chip: 'Chip Físico', online: 'Online', contactless: 'Aproximação' };

// ─── Main parser ──────────────────────────────────────────────────────────────
async function parseStatement(file) {
  const buffer = await file.arrayBuffer();
  const pages = await StatementParser.extractPages(new Uint8Array(buffer));
  if (!StatementParser.isSantanderStatement(pages)) {
    throw new Error('invalid_statement');
  }
  return StatementParser.parseStatementPages(pages);
}

// ─── UI rendering ─────────────────────────────────────────────────────────────
let currentStatement = null;

function renderSummary(statement) {
  const grid = document.getElementById('cardsGrid');
  const concilEl = document.getElementById('conciliation');
  const cards = Object.values(statement.cards);
  const cardsTotal = Math.round(
    cards.reduce((a, c) => a + c.transactions_sum, 0) * 100
  ) / 100;

  grid.innerHTML = '';

  cards.forEach(card => {
    const el = document.createElement('article');
    el.className = 'card';
    el.innerHTML = `
      <div class="card-header">
        <span class="card-name">${esc(card.name)}</span>
        <span class="card-last-four">···${esc(card.last_four)}</span>
      </div>
      <div class="card-value">${StatementParser.formatBRL(card.transactions_sum)}</div>
      <div class="card-tx-count">${card.transactions.length} transaç${card.transactions.length === 1 ? 'ão' : 'ões'}</div>
    `;
    grid.appendChild(el);
  });

  const totalEl = document.createElement('article');
  totalEl.className = 'card total-card';
  totalEl.innerHTML = `
    <div class="card-header">
      <span class="card-name">Total</span>
      <span class="card-last-four">${cards.length} cartões</span>
    </div>
    <div class="card-value">${StatementParser.formatBRL(cardsTotal)}</div>
    <div class="card-tx-count">${cards.reduce((a, c) => a + c.transactions.length, 0)} transações</div>
  `;
  grid.appendChild(totalEl);

  const expected = statement.total_spent + statement.total_foreign_spent - statement.total_credits;

  concilEl.innerHTML = `
    <h3>Conciliação</h3>
    <div class="concil-row"><span class="concil-label">Total Despesas (Brasil)</span><span class="concil-value">${StatementParser.formatBRL(statement.total_spent)}</span></div>
    <div class="concil-row"><span class="concil-label">Total Despesas (Exterior)</span><span class="concil-value">${StatementParser.formatBRL(statement.total_foreign_spent)}</span></div>
    <div class="concil-row"><span class="concil-label">Total Créditos</span><span class="concil-value">− ${StatementParser.formatBRL(statement.total_credits)}</span></div>
    <div class="concil-row total"><span class="concil-label">Esperado</span><span class="concil-value">${StatementParser.formatBRL(expected)}</span></div>
    <div class="concil-checks">
      <div class="check-row"><span class="check-label">Soma por transação</span>${badge(statement.z_reconciliation)}</div>
      <div class="check-row"><span class="check-label">Soma por cartão</span>${badge(statement.z_reconciliation_transactions_sum)}</div>
    </div>
  `;
}

function badge(ok) {
  return ok
    ? `<span class="badge-pass">✓ PASS</span>`
    : `<span class="badge-fail">✗ FAIL</span>`;
}

function renderTransactions(statement, cardFilter = '', descFilter = '') {
  const tbody = document.getElementById('txBody');
  const desc = descFilter.toLowerCase();
  const rows = [];

  for (const card of Object.values(statement.cards)) {
    if (cardFilter && card.last_four !== cardFilter) continue;
    for (const tx of card.transactions) {
      if (desc && !tx.description.toLowerCase().includes(desc)) continue;
      rows.push({ ...tx, cardName: card.name, last_four: card.last_four });
    }
  }

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="tx-empty">Nenhuma transação encontrada.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(tx => `
    <tr>
      <td class="tx-date">${tx.date ?? '—'}</td>
      <td>${tx.type ? `<span class="tx-type-badge">${esc(TYPE_LABEL[tx.type])}</span>` : '<span style="color:var(--muted)">—</span>'}</td>
      <td class="tx-desc">${esc(tx.description)}</td>
      <td class="tx-install">${tx.installments ?? '—'}</td>
      <td style="white-space:nowrap;font-size:.8rem;color:var(--muted)">···${esc(tx.last_four)}</td>
      <td class="tx-value ${tx.value < 0 ? 'negative' : 'positive'}">${StatementParser.formatBRL(tx.value)}</td>
    </tr>
  `).join('');
}

function populateCardFilter(statement) {
  const sel = document.getElementById('cardFilter');
  sel.innerHTML = '<option value="">Todos os cartões</option>';
  for (const card of Object.values(statement.cards)) {
    const opt = document.createElement('option');
    opt.value = card.last_four;
    opt.textContent = `${card.name} ···${card.last_four}`;
    sel.appendChild(opt);
  }
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── File handling ────────────────────────────────────────────────────────────
function show(id) { document.getElementById(id).classList.remove('hidden'); }
function hide(id) { document.getElementById(id).classList.add('hidden'); }

async function handleFile(file) {
  if (!file || !file.name.toLowerCase().endsWith('.pdf')) {
    showError('Apenas arquivos .pdf são aceitos.');
    return;
  }

  hide('uploadSection');
  hide('errorBox');
  show('processing');

  try {
    const statement = await parseStatement(file);
    currentStatement = statement;

    hide('processing');
    show('results');

    document.getElementById('resultTitle').textContent =
      `Fatura analisada — ${Object.keys(statement.cards).length} portador(es)`;

    renderSummary(statement);
    populateCardFilter(statement);
    renderTransactions(statement);
  } catch (err) {
    hide('processing');
    if (err.message === 'invalid_statement') {
      showError('Arquivo não reconhecido como fatura Santander. Por enquanto, apenas faturas do cartão Santander são suportadas.');
    } else {
      showError('Não foi possível analisar este arquivo. Verifique se o PDF não está corrompido ou protegido por senha.');
    }
    console.error(err);
  }
}

function showError(msg) {
  document.getElementById('errorMsg').textContent = msg;
  hide('uploadSection');
  show('errorBox');
}

function reset() {
  currentStatement = null;
  hide('results');
  hide('errorBox');
  hide('processing');
  show('uploadSection');
  document.getElementById('fileInput').value = '';
  document.getElementById('cardFilter').innerHTML = '<option value="">Todos os cartões</option>';
  document.getElementById('descFilter').value = '';
  switchTab('summary');
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => {
    const active = t.dataset.tab === name;
    t.classList.toggle('active', active);
    t.setAttribute('aria-selected', active);
  });
  document.getElementById('summaryPanel').classList.toggle('hidden', name !== 'summary');
  document.getElementById('transactionsPanel').classList.toggle('hidden', name !== 'transactions');
}

// ─── Event listeners ──────────────────────────────────────────────────────────
const dropZone  = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');

// Skip if the click came from the label — it already opens the file input natively
dropZone.addEventListener('click', (e) => {
  if (!e.target.closest('label')) fileInput.click();
});
dropZone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') fileInput.click(); });

fileInput.addEventListener('change', e => {
  if (e.target.files[0]) handleFile(e.target.files[0]);
});

dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
});

document.querySelectorAll('.tab').forEach(tab =>
  tab.addEventListener('click', () => {
    switchTab(tab.dataset.tab);
    if (tab.dataset.tab === 'transactions' && currentStatement)
      renderTransactions(currentStatement,
        document.getElementById('cardFilter').value,
        document.getElementById('descFilter').value);
  })
);

document.getElementById('cardFilter').addEventListener('change', () => {
  if (currentStatement)
    renderTransactions(currentStatement,
      document.getElementById('cardFilter').value,
      document.getElementById('descFilter').value);
});

document.getElementById('descFilter').addEventListener('input', () => {
  if (currentStatement)
    renderTransactions(currentStatement,
      document.getElementById('cardFilter').value,
      document.getElementById('descFilter').value);
});

document.getElementById('downloadJson').addEventListener('click', () => {
  if (!currentStatement) return;
  const blob = new Blob([JSON.stringify(currentStatement, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'fatura.json';
  a.click();
  URL.revokeObjectURL(a.href);
});

document.getElementById('newFile').addEventListener('click', reset);
document.getElementById('errorRetry').addEventListener('click', reset);
