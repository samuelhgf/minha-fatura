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

function copyableCurrencyValue(value) {
  return StatementParser.formatBRL(value).replace('R$ ', '');
}

function copyValueButton(value) {
  const formattedValue = copyableCurrencyValue(value);
  return `
    <button type="button" class="card-copy" data-copy-value="${esc(formattedValue)}" aria-label="Copiar valor ${esc(formattedValue)}">
      <svg class="copy-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect>
        <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path>
      </svg>
      <svg class="copied-icon hidden" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="m5 12 4 4L19 6"></path>
      </svg>
      <span class="card-copy-label" aria-live="polite">Copiar</span>
    </button>`;
}

function renderSummary(statement, opts = {}) {
  const shared = !!opts.shared;
  const grid = document.getElementById('cardsGrid');
  const concilEl = document.getElementById('conciliation');
  const cards = Object.values(statement.cards);
  const cardsTotal = Math.round(
    cards.reduce((a, c) => a + c.transactions_sum, 0) * 100
  ) / 100;

  grid.innerHTML = '';

  cards.forEach(card => {
    const el = document.createElement('article');
    el.className = 'card card-clickable';
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.dataset.lastFour = card.last_four;
    el.innerHTML = `
      <div class="card-header">
        ${shared ? '' : `<input type="checkbox" class="card-select" data-last-four="${esc(card.last_four)}" aria-label="Selecionar cartão ${esc(card.name)} para compartilhar">`}
        <span class="card-name">${esc(card.name)}</span>
        <span class="card-last-four">···${esc(card.last_four)}</span>
      </div>
      <div class="card-value-row">
        <div class="card-value">${StatementParser.formatBRL(card.transactions_sum)}</div>
        ${copyValueButton(card.transactions_sum)}
      </div>
      <div class="card-tx-count">${card.transactions.length} transaç${card.transactions.length === 1 ? 'ão' : 'ões'}</div>
    `;
    grid.appendChild(el);
  });

  const totalEl = document.createElement('article');
  totalEl.className = 'card total-card card-clickable';
  totalEl.setAttribute('role', 'button');
  totalEl.setAttribute('tabindex', '0');
  totalEl.dataset.lastFour = '';
  totalEl.innerHTML = `
    <div class="card-header">
      <span class="card-name">Total</span>
      <span class="card-last-four">${cards.length} cartões</span>
    </div>
    <div class="card-value-row">
      <div class="card-value">${StatementParser.formatBRL(cardsTotal)}</div>
      ${copyValueButton(cardsTotal)}
    </div>
    <div class="card-tx-count">${cards.reduce((a, c) => a + c.transactions.length, 0)} transações</div>
  `;
  grid.appendChild(totalEl);

  if (shared) {
    concilEl.classList.add('hidden');
    concilEl.innerHTML = '';
    return;
  }
  concilEl.classList.remove('hidden');

  // Fresh selection state on every (re)render of the summary.
  hide('shareBox');
  updateShareButton();

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

  const foot = document.getElementById('txFoot');

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="tx-empty">Nenhuma transação encontrada.</td></tr>`;
    foot.classList.add('hidden');
    return;
  }

  const total = Math.round(rows.reduce((a, tx) => a + tx.value, 0) * 100) / 100;
  foot.querySelector('.tx-foot-label').textContent =
    `${rows.length} transaç${rows.length === 1 ? 'ão' : 'ões'}`;
  const totalCell = foot.querySelector('.tx-foot-total');
  totalCell.textContent = StatementParser.formatBRL(total);
  totalCell.classList.toggle('negative', total < 0);
  foot.classList.remove('hidden');

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

// ─── Share links (cards encoded in the URL) ─────────────────────────────────────
// lz-string keeps the link short and is UTF-8 safe (accented names like "JOÃO" work).
function encodeShare(obj) {
  return LZString.compressToEncodedURIComponent(JSON.stringify(obj));
}

function decodeShare(str) {
  return JSON.parse(LZString.decompressFromEncodedURIComponent(str));
}

function getSelectedLastFours() {
  return [...document.querySelectorAll('.card-select:checked')].map(c => c.dataset.lastFour);
}

function updateShareButton() {
  const btn = document.getElementById('shareCards');
  if (btn) btn.disabled = getSelectedLastFours().length === 0;
}

function buildSharePayload(lastFours) {
  const cards = {};
  for (const lf of lastFours) {
    const c = currentStatement && currentStatement.cards[lf];
    if (!c) continue;
    cards[lf] = {
      name: c.name,
      last_four: c.last_four,
      transactions: c.transactions,
      transactions_sum: c.transactions_sum,
    };
  }
  return { v: 1, cards };
}

function openCardTransactions(lastFour) {
  if (!currentStatement) return;
  switchTab('transactions');
  const sel = document.getElementById('cardFilter');
  sel.value = lastFour || '';
  renderTransactions(currentStatement, sel.value, document.getElementById('descFilter').value);
  requestAnimationFrame(() => {
    document.querySelector('.tabs').scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'start',
    });
  });
}

// ─── History (localStorage) ───────────────────────────────────────────────────
const HISTORY_KEY = 'minha_fatura_history';

function getHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; }
  catch { return []; }
}

function statementFingerprint(statement) {
  const txCount = Object.values(statement.cards).reduce((a, c) => a + c.transactions.length, 0);
  const raw = [statement.total_spent, statement.total_foreign_spent, statement.total_credits, txCount].join('|');
  return btoa(raw);
}

function historyLabel(statement) {
  const total = statement.total_spent + statement.total_foreign_spent - statement.total_credits;
  const n = Object.keys(statement.cards).length;
  return `${StatementParser.formatBRL(total)} · ${n} portador${n !== 1 ? 'es' : ''}`;
}

function saveStatementToHistory(statement) {
  try {
    const fp = statementFingerprint(statement);
    const items = getHistory();
    if (items.some(i => i.fp === fp)) {
      const btn = document.getElementById('saveStatement');
      btn.disabled = true;
      const original = btn.innerHTML;
      btn.innerHTML = '⚠ Já salvo';
      setTimeout(() => { btn.disabled = false; btn.innerHTML = original; }, 1500);
      return;
    }
    items.unshift({ id: Date.now().toString(), fp, savedAt: new Date().toISOString(), label: historyLabel(statement), statement });
    localStorage.setItem(HISTORY_KEY, JSON.stringify(items));
    renderHistory();
    const btn = document.getElementById('saveStatement');
    btn.disabled = true;
    const original = btn.innerHTML;
    btn.innerHTML = '✓ Salvo';
    setTimeout(() => { btn.hidden = true; btn.disabled = false; btn.innerHTML = original; }, 1200);
  } catch (e) {
    console.error('Erro ao salvar:', e);
  }
}

function deleteHistoryItem(id) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(getHistory().filter(i => i.id !== id)));
  renderHistory();
}

function renderHistory() {
  const section = document.getElementById('historySection');
  const list    = document.getElementById('historyList');
  const items   = getHistory();
  if (!items.length) { section.classList.add('hidden'); return; }
  section.classList.remove('hidden');
  list.innerHTML = items.map(item => `
    <div class="history-item">
      <div class="history-info">
        <span class="history-label">${esc(item.label)}</span>
        <span class="history-date">${new Date(item.savedAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
      </div>
      <div class="history-actions">
        <button class="btn-secondary btn-sm history-load" data-id="${item.id}">Abrir</button>
        <button class="btn-ghost btn-sm history-delete" data-id="${item.id}" aria-label="Remover">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
            <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
          </svg>
        </button>
      </div>
    </div>
  `).join('');
  list.querySelectorAll('.history-load').forEach(btn =>
    btn.addEventListener('click', () => {
      const item = getHistory().find(i => i.id === btn.dataset.id);
      if (item) openSavedStatement(item.statement);
    })
  );
  list.querySelectorAll('.history-delete').forEach(btn => {
    let timer = null;
    btn.addEventListener('click', () => {
      if (btn.dataset.confirm === 'true') {
        clearTimeout(timer);
        deleteHistoryItem(btn.dataset.id);
      } else {
        btn.dataset.confirm = 'true';
        btn.classList.add('history-delete-confirm');
        btn.setAttribute('aria-label', 'Confirmar remoção');
        btn.innerHTML = '<span>Confirmar?</span>';
        timer = setTimeout(() => {
          btn.dataset.confirm = '';
          btn.classList.remove('history-delete-confirm');
          btn.setAttribute('aria-label', 'Remover');
          btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>`;
        }, 3000);
      }
    });
  });
}

function openSavedStatement(statement) {
  currentStatement = statement;
  hide('uploadSection');
  hide('errorBox');
  show('results');
  document.getElementById('resultTitle').textContent =
    `Fatura analisada — ${Object.keys(statement.cards).length} portador(es)`;
  renderSummary(statement);
  populateCardFilter(statement);
  renderTransactions(statement);
  document.getElementById('saveStatement').hidden = true;
}

function openSharedStatement(statement) {
  currentStatement = statement;
  document.body.classList.add('shared-mode');
  hide('uploadSection');
  hide('errorBox');
  hide('historySection');
  show('results');
  show('sharedBanner');
  document.getElementById('resultTitle').textContent = 'Cartões compartilhados';
  renderSummary(statement, { shared: true });
  populateCardFilter(statement);
  renderTransactions(statement);
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
    document.getElementById('saveStatement').hidden =
      !(statement.z_reconciliation && statement.z_reconciliation_transactions_sum);
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
    if (tab.dataset.tab === 'summary') {
      document.getElementById('cardFilter').value = '';
      document.getElementById('descFilter').value = '';
    }
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

document.getElementById('saveStatement').addEventListener('click', () => {
  if (currentStatement) saveStatementToHistory(currentStatement);
});

document.getElementById('newFile').addEventListener('click', reset);
document.getElementById('errorRetry').addEventListener('click', reset);

// ─── Card grid: click a card → its transactions; checkboxes → share selection ───
const cardsGrid = document.getElementById('cardsGrid');
const copyResetTimers = new WeakMap();

async function writeToClipboard(value) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('copy_failed');
}

function showCopiedState(btn) {
  const previousTimer = copyResetTimers.get(btn);
  if (previousTimer) clearTimeout(previousTimer);

  btn.classList.add('is-copied');
  btn.querySelector('.copy-icon').classList.add('hidden');
  btn.querySelector('.copied-icon').classList.remove('hidden');
  btn.querySelector('.card-copy-label').textContent = 'Copiado';
  btn.setAttribute('aria-label', 'Valor copiado');

  const timer = setTimeout(() => {
    btn.classList.remove('is-copied');
    btn.querySelector('.copy-icon').classList.remove('hidden');
    btn.querySelector('.copied-icon').classList.add('hidden');
    btn.querySelector('.card-copy-label').textContent = 'Copiar';
    btn.setAttribute('aria-label', `Copiar valor ${btn.dataset.copyValue}`);
    copyResetTimers.delete(btn);
  }, 1800);
  copyResetTimers.set(btn, timer);
}

cardsGrid.addEventListener('click', async e => {
  const copyButton = e.target.closest('.card-copy');
  if (copyButton) {
    e.stopPropagation();
    try {
      await writeToClipboard(copyButton.dataset.copyValue);
      showCopiedState(copyButton);
    } catch (err) {
      console.error('Não foi possível copiar o valor:', err);
    }
    return;
  }
  if (e.target.closest('.card-select')) return;
  const card = e.target.closest('.card-clickable');
  if (card) openCardTransactions(card.dataset.lastFour);
});

cardsGrid.addEventListener('keydown', e => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  if (e.target.closest('.card-select, .card-copy')) return;
  const card = e.target.closest('.card-clickable');
  if (!card) return;
  e.preventDefault();
  openCardTransactions(card.dataset.lastFour);
});

cardsGrid.addEventListener('change', e => {
  if (e.target.classList.contains('card-select')) updateShareButton();
});

// ─── Share ──────────────────────────────────────────────────────────────────────
function flashButton(btn, label) {
  const original = btn.textContent;
  btn.textContent = label;
  btn.disabled = true;
  setTimeout(() => { btn.textContent = original; btn.disabled = false; }, 1500);
}

document.getElementById('shareCards').addEventListener('click', () => {
  const selected = getSelectedLastFours();
  if (!selected.length || !currentStatement) return;
  const payload = buildSharePayload(selected);
  const url = location.origin + location.pathname + '?s=' + encodeURIComponent(encodeShare(payload));
  document.getElementById('shareUrl').value = url;
  show('shareBox');
  if (navigator.clipboard) {
    navigator.clipboard.writeText(url)
      .then(() => flashButton(document.getElementById('shareCopy'), '✓ Copiado!'))
      .catch(() => {});
  }
});

document.getElementById('shareCopy').addEventListener('click', () => {
  const input = document.getElementById('shareUrl');
  input.select();
  const copy = () => flashButton(document.getElementById('shareCopy'), '✓ Copiado!');
  if (navigator.clipboard) {
    navigator.clipboard.writeText(input.value).then(copy).catch(copy);
  } else {
    document.execCommand('copy');
    copy();
  }
});

// ─── Bootstrap: shared link or normal history ───────────────────────────────────
(function initShare() {
  const shared = new URLSearchParams(location.search).get('s');
  if (!shared) { renderHistory(); return; }
  try {
    const statement = decodeShare(shared);
    if (!statement || !statement.cards || !Object.keys(statement.cards).length) {
      throw new Error('empty_share');
    }
    openSharedStatement(statement);
  } catch (err) {
    console.error('Link de compartilhamento inválido:', err);
    renderHistory();
  }
})();
