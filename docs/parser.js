// Shared logic — works in Node.js (CommonJS) and browser (sets globalThis.StatementParser)
(function (exports) {
  'use strict';

  // ─── PDF.js setup ────────────────────────────────────────────────────────────
  // In Node.js: loaded from pdfjs-dist. In browser: already a global from CDN.
  const pdfjsLib = typeof module !== 'undefined'
    ? require('pdfjs-dist/legacy/build/pdf.js')
    : globalThis.pdfjsLib;

  if (typeof module !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = '';
  } else {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  // ─── PDF text extraction (shared) ────────────────────────────────────────────

  function buildColumnLines(items) {
    const rows = new Map();
    for (const item of items) {
      // 5pt bucket: merges items on the same visual row that have slightly
      // different Y positions (e.g. IOF description vs. its value field)
      const y = Math.round(item.transform[5] / 5) * 5;
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y).push(item);
    }
    return [...rows.entries()]
      .sort(([ya], [yb]) => yb - ya)
      .map(([, rowItems]) => {
        const sorted = rowItems.sort((a, b) => a.transform[4] - b.transform[4]);
        let text = '', prevEnd = null;
        for (const item of sorted) {
          const x = item.transform[4];
          if (prevEnd !== null) {
            const gap = x - prevEnd;
            if (gap > 15) text += '\t';
            else if (gap > 1) text += ' ';
          }
          text += item.str;
          prevEnd = x + (item.width || 0);
        }
        return text.trim();
      })
      .filter(Boolean);
  }

  // Santander faturas use a two-column layout. Split items at the page midpoint
  // and process each column top-to-bottom independently (left first), preserving
  // the logical card → transactions → VALOR TOTAL reading order.
  function reconstructLines(textContent, pageWidth) {
    const items = textContent.items.filter(it => it.str && it.str.trim());
    if (!items.length) return [];
    const midX = pageWidth / 2;
    const left  = items.filter(it => it.transform[4] <  midX);
    const right = items.filter(it => it.transform[4] >= midX);
    if (left.length < items.length * 0.1 || right.length < items.length * 0.1) {
      return buildColumnLines(items);
    }
    return [...buildColumnLines(left), ...buildColumnLines(right)];
  }

  // data: Uint8Array or ArrayBuffer (works in both Node.js and browser)
  async function extractPages(data) {
    const params = {
      data,
      useWorkerFetch: false,
      isEvalSupported: false,
      disableStream: true,
    };
    if (typeof module !== 'undefined') {
      const path = require('path');
      params.standardFontDataUrl = path.join(
        path.dirname(require.resolve('pdfjs-dist/package.json')),
        'standard_fonts/'
      );
    }
    const pdf = await pdfjsLib.getDocument(params).promise;
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const tc = await page.getTextContent();
      const viewport = page.getViewport({ scale: 1 });
      pages.push({ num: i, lines: reconstructLines(tc, viewport.width) });
    }
    return pages;
  }

  // ─── Parsing constants ────────────────────────────────────────────────────────

  const TYPE_MAP = { '1': 'chip', '2': 'online', '3': 'contactless' };

  const CARD_LINE_RE           = /^@?\s*(.+?)\s+-\s+\d{4}\s+XXXX\s+XXXX\s+(\d{4})$/;
  const VALOR_TOTAL_RE         = /^VALOR TOTAL/;
  const TOTAL_SPENT_RE         = /^\(\+\) Total Despesas\/Débitos no Brasil/;
  const TOTAL_CREDITS_RE       = /^\(-\) Total de créditos/;
  const TOTAL_FOREIGN_SPENT_RE = /^\(\+\) Total Despesas\/Débitos no Exterior/;
  const SKIP_RE                = /^(Pagamento e Demais Créditos|Despesas|Parcelamentos|Compra\s+Data|Detalhamento da Fatura|Resumo da Fatura|Descrição|\d+\/\d+$)/;
  const BR_VALUE_RE            = /^-?[\d.]+,\d{2}$/;
  const TRANSACTION_VALUE_RE   = /^(-?[\d.]+,\d{2})(?:\s+-?[\d.]+,\d{2})?$/;
  const FOREIGN_CURR_RE        = /^-?[\d.]+,\d{2}\s+[A-Za-z]+$/;

  function parseBrazilianNumber(str) {
    const negative = str.startsWith('-');
    const cleaned = str.replace('-', '').replace(/\./g, '').replace(',', '.');
    return negative ? -parseFloat(cleaned) : parseFloat(cleaned);
  }

  function formatBRL(value) {
    const [int, dec] = Math.abs(value).toFixed(2).split('.');
    const intFormatted = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return (value < 0 ? '-' : '') + 'R$ ' + intFormatted + ',' + dec;
  }

  function parseTransactionLine(line) {
    const parts = line.split('\t').map(p => p.trim()).filter(Boolean);
    let i = 0, typeDigit = null;

    // Type digit may be its own tab field ("3\t17/02 …") or merged with the date ("3 17/02 …")
    if (/^[123]$/.test(parts[i])) { typeDigit = parts[i]; i++; }

    let date = null, description = null;
    if (i < parts.length && /^\d{2}\/\d{2}\s+/.test(parts[i])) {
      const m = parts[i].match(/^(\d{2}\/\d{2})\s+(.+)$/);
      if (!m) return null;
      date = m[1]; description = m[2].trim(); i++;
    } else if (i < parts.length && /^[123]\s+\d{2}\/\d{2}\s+/.test(parts[i])) {
      const m = parts[i].match(/^([123])\s+(\d{2}\/\d{2})\s+(.+)$/);
      if (!m) return null;
      typeDigit = m[1]; date = m[2]; description = m[3].trim(); i++;
    } else if (!typeDigit && i < parts.length) {
      description = parts[i].trim(); i++;
    } else {
      return null;
    }

    // Collect tab-split description fragments (e.g. "EXAMPLE" + "STORE")
    while (
      i < parts.length &&
      !/^\d{2}\/\d{2}$/.test(parts[i]) &&
      !FOREIGN_CURR_RE.test(parts[i]) &&
      !TRANSACTION_VALUE_RE.test(parts[i])
    ) {
      description += ' ' + parts[i]; i++;
    }

    let installments = null;
    if (i < parts.length && /^\d{2}\/\d{2}$/.test(parts[i])) { installments = parts[i]; i++; }
    // Skip foreign currency amount (e.g. "20,00 EURO") — take only the BRL value
    if (i < parts.length && FOREIGN_CURR_RE.test(parts[i])) i++;
    if (i >= parts.length) return null;
    // Accept "123,45 22,50" (BRL + space-joined USD): extract just the BRL part
    const valueMatch = parts[i].match(TRANSACTION_VALUE_RE);
    if (!valueMatch) return null;

    return {
      type: typeDigit ? TYPE_MAP[typeDigit] : null,
      date,
      description: description.trim(),
      installments,
      value: parseBrazilianNumber(valueMatch[1]),
    };
  }

  function parseStatementPages(pages) {
    const statement = {
      cards: {},
      total_spent: null, total_spent_string: null,
      total_foreign_spent: null, total_foreign_spent_string: null,
      total_credits: null, total_credits_string: null,
      z_reconciliation: null, z_reconciliation_transactions_sum: null,
    };

    let currentCard = null;
    let pendingBareValue = null; // lone number line that may precede a split "IOF DESPESA NO EXTERIOR"

    for (const page of pages) {
      for (const line of page.lines) {
        if (SKIP_RE.test(line)) continue;

        // Handle split IOF lines: a bare number followed by the IOF label on the next line
        if (line === 'IOF DESPESA NO EXTERIOR' && pendingBareValue !== null && currentCard) {
          statement.cards[currentCard].transactions.push({
            type: null, date: null,
            description: 'IOF DESPESA NO EXTERIOR',
            installments: null,
            value: parseBrazilianNumber(pendingBareValue),
          });
          pendingBareValue = null;
          continue;
        }
        pendingBareValue = BR_VALUE_RE.test(line) ? line : null;

        if (TOTAL_SPENT_RE.test(line)) {
          const parts = line.split('\t').map(p => p.trim()).filter(Boolean);
          statement.total_spent = parseBrazilianNumber(parts[1]);
          statement.total_spent_string = parts[1];
          continue;
        }
        if (TOTAL_CREDITS_RE.test(line)) {
          const parts = line.split('\t').map(p => p.trim()).filter(Boolean);
          statement.total_credits = parseBrazilianNumber(parts[1]);
          statement.total_credits_string = parts[1];
          continue;
        }
        if (TOTAL_FOREIGN_SPENT_RE.test(line)) {
          const parts = line.split('\t').map(p => p.trim()).filter(Boolean);
          statement.total_foreign_spent = parseBrazilianNumber(parts[1]);
          statement.total_foreign_spent_string = parts[1];
          continue;
        }

        const cardMatch = line.match(CARD_LINE_RE);
        if (cardMatch) {
          const name = cardMatch[1].trim(), last_four = cardMatch[2];
          currentCard = last_four;
          if (!statement.cards[last_four])
            statement.cards[last_four] = { name, last_four, transactions: [] };
          continue;
        }

        if (!currentCard) continue;

        if (VALOR_TOTAL_RE.test(line)) {
          const parts = line.split('\t').map(p => p.trim()).filter(Boolean);
          statement.cards[currentCard].total_value = parseBrazilianNumber(parts[1]);
          statement.cards[currentCard].total_value_string = parts[1];
          currentCard = null;
          continue;
        }

        const tx = parseTransactionLine(line);
        if (tx && !tx.description.includes('PAGAMENTO DE FATURA'))
          statement.cards[currentCard].transactions.push(tx);
      }
    }

    statement.total_foreign_spent ??= 0;
    statement.total_foreign_spent_string ??= '0,00';

    for (const card of Object.values(statement.cards)) {
      card.transactions_sum = Math.round(
        card.transactions.reduce((a, t) => a + t.value, 0) * 100
      ) / 100;
    }

    const txSum = Object.values(statement.cards)
      .flatMap(c => c.transactions)
      .reduce((a, t) => a + t.value, 0);

    const expected = statement.total_spent + statement.total_foreign_spent - statement.total_credits;
    statement.z_reconciliation = Math.round(txSum * 100) === Math.round(expected * 100);

    const txSumCards = Object.values(statement.cards)
      .reduce((a, c) => a + c.transactions_sum, 0);
    statement.z_reconciliation_transactions_sum =
      Math.round(txSumCards * 100) === Math.round(expected * 100);

    return statement;
  }

  function isSantanderStatement(pages) {
    const lines = pages.flatMap(p => p.lines);
    return (
      lines.some(l => l.includes('Detalhamento da Fatura')) &&
      lines.some(l => CARD_LINE_RE.test(l)) &&
      lines.some(l => TOTAL_SPENT_RE.test(l))
    );
  }

  exports.extractPages         = extractPages;
  exports.parseStatementPages     = parseStatementPages;
  exports.isSantanderStatement    = isSantanderStatement;
  exports.parseBrazilianNumber = parseBrazilianNumber;
  exports.formatBRL            = formatBRL;
  exports.parseTransactionLine = parseTransactionLine;

})(typeof module !== 'undefined' ? module.exports : (globalThis.StatementParser = {}));
