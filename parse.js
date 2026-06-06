const fs = require('fs');

// pdfjs-dist tries to polyfill DOMMatrix/Path2D via the optional `canvas`
// package; stub them out so it skips the attempt silently.
if (typeof globalThis.DOMMatrix === 'undefined') globalThis.DOMMatrix = class {};
if (typeof globalThis.Path2D    === 'undefined') globalThis.Path2D    = class {};

const { parseBrazilianNumber, formatBRL, extractPages, parseStatementPages, isSantanderStatement } = require('./docs/parser');

const RESET  = '\x1b[0m';
const BOLD   = '\x1b[1m';
const DIM    = '\x1b[2m';
const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const CYAN   = '\x1b[36m';

function pad(str, len, right = false) {
  const s = String(str);
  return right ? s.padStart(len) : s.padEnd(len);
}

function printSummary(statement) {
  const cards    = Object.values(statement.cards);
  const maxNameLen = Math.max(...cards.map(c => c.name.length));

  const countW = 8; // width for "  NNN tx" column
  const allLabels = [
    maxNameLen + 9 + 2 + countW,
    'TOTAL (soma dos cartões)'.length,
    'Total Despesas (Brasil)'.length,
    'Total Despesas (Exterior)'.length,
    'Total Créditos'.length,
    'Esperado (despesas − créditos)'.length,
    'Soma por transação'.length,
    'Soma por cartão'.length,
  ];
  const leftW  = Math.max(...allLabels);
  const rightW = 16;
  const W      = leftW + rightW + 4;
  const line   = '─'.repeat(W);
  const dline  = '═'.repeat(W);

  const row = (label, val, opts = {}) => {
    const l = opts.bold ? `${BOLD}${pad(label, leftW)}${RESET}` : pad(label, leftW);
    const r = opts.bold ? `${BOLD}${pad(val, rightW, true)}${RESET}` : pad(val, rightW, true);
    console.log(`  ${l}  ${r}`);
  };

  const title = 'FATURA SANTANDER — TOTAIS POR CARTÃO';
  const titlePad = ' '.repeat(Math.max(0, Math.floor((W - title.length) / 2)));
  console.log(`\n${BOLD}${dline}${RESET}`);
  console.log(`${BOLD}${titlePad}${title}${RESET}`);
  console.log(`${BOLD}${dline}${RESET}`);

  console.log(`\n${CYAN}${BOLD}  CARTÕES${RESET}`);
  console.log(`  ${DIM}${line}${RESET}`);

  let cardsTotal = 0;
  for (const card of cards) {
    const namePart = pad(card.name, maxNameLen);
    const lastFour = `···${card.last_four}`;
    const count    = pad(`${card.transactions.length} tx`, countW, true);
    const extra    = ' '.repeat(leftW - maxNameLen - 9 - 2 - countW);
    const sum      = pad(formatBRL(card.transactions_sum), rightW, true);
    console.log(`  ${namePart}  ${DIM}${lastFour}${RESET}  ${DIM}${count}${RESET}${extra}  ${BOLD}${sum}${RESET}`);
    cardsTotal += card.transactions_sum;
  }

  cardsTotal = Math.round(cardsTotal * 100) / 100;
  console.log(`  ${DIM}${line}${RESET}`);
  row('TOTAL (soma dos cartões)', formatBRL(cardsTotal), { bold: true });

  printConciliation(statement, { line, dline, leftW });
}

function printConciliation(statement, { line, dline, leftW }) {
  const pass = `${GREEN}${BOLD}✓ PASS${RESET}`;
  const fail = `${RED}${BOLD}✗ FAIL${RESET}`;
  const expected = statement.total_spent + statement.total_foreign_spent - statement.total_credits;

  console.log(`\n${CYAN}${BOLD}  CONCILIAÇÃO${RESET}`);
  console.log(`  ${DIM}${line}${RESET}`);
  console.log(`  ${pad('Total Despesas (Brasil)', leftW)}  ${pad(formatBRL(statement.total_spent), 16, true)}`);
  console.log(`  ${pad('Total Despesas (Exterior)', leftW)}  ${pad(formatBRL(statement.total_foreign_spent), 16, true)}`);
  console.log(`  ${pad('Total Créditos', leftW)}  ${pad('- ' + formatBRL(statement.total_credits), 16, true)}`);
  console.log(`  ${pad('Esperado (despesas − créditos)', leftW)}  ${pad(formatBRL(expected), 16, true)}`);
  console.log(`  ${DIM}${line}${RESET}`);
  console.log(`  ${pad('Soma por transação', leftW)}  ${statement.z_reconciliation ? pass : fail}`);
  console.log(`  ${pad('Soma por cartão', leftW)}  ${statement.z_reconciliation_transactions_sum ? pass : fail}`);
  console.log(`\n${BOLD}${dline}${RESET}\n`);
}

function printTransactions(statement, filterDesc = null) {
  const cards  = Object.values(statement.cards);
  const DATE_W = 5, TYPE_W = 11, DESC_W = 25, PARC_W = 8, VAL_W = 14;
  const W = 2 + DATE_W + 2 + TYPE_W + 2 + DESC_W + 2 + PARC_W + 2 + VAL_W;
  const line  = '─'.repeat(W);
  const dline = '═'.repeat(W);

  const TYPE_LABEL = { chip: 'Chip Físico', online: 'Online', contactless: 'Aproximação' };

  const title = 'FATURA SANTANDER — TRANSAÇÕES';
  const titlePad = ' '.repeat(Math.max(0, Math.floor((W - title.length) / 2)));
  console.log(`\n${BOLD}${dline}${RESET}`);
  console.log(`${BOLD}${titlePad}${title}${RESET}`);
  console.log(`${BOLD}${dline}${RESET}`);

  for (const card of cards) {
    console.log(`\n${CYAN}${BOLD}  ${card.name}  ${DIM}···${card.last_four}${RESET}`);
    console.log(`  ${DIM}${line}${RESET}`);

    const header =
      `${pad('Data', DATE_W)}  ${pad('Tipo', TYPE_W)}  ${pad('Descrição', DESC_W)}  ${pad('Parcelas', PARC_W)}  ${pad('Valor', VAL_W, true)}`;
    console.log(`  ${CYAN}${header}${RESET}`);
    console.log(`  ${DIM}${line}${RESET}`);

    const txList = filterDesc
      ? card.transactions.filter(tx => tx.description.toLowerCase().includes(filterDesc.toLowerCase()))
      : card.transactions;

    if (txList.length === 0) {
      console.log(`  ${DIM}(sem transações)${RESET}`);
    } else {
      for (const tx of txList) {
        const date  = pad(tx.date ?? '—', DATE_W);
        const type  = tx.type ? pad(TYPE_LABEL[tx.type], TYPE_W) : pad('—', TYPE_W);
        const desc  = pad(tx.description.slice(0, DESC_W), DESC_W);
        const parc  = tx.installments ? pad(tx.installments, PARC_W) : pad('—', PARC_W);
        const val   = pad(formatBRL(tx.value), VAL_W, true);
        const color = tx.value < 0 ? DIM : '';
        console.log(`  ${color}${date}  ${type}  ${desc}  ${parc}  ${BOLD}${val}${RESET}`);
      }
    }

    console.log(`  ${DIM}${line}${RESET}`);
    const filteredSum = Math.round(txList.reduce((acc, tx) => acc + tx.value, 0) * 100) / 100;
    const countLabel  = `${txList.length} transaç${txList.length === 1 ? 'ão' : 'ões'}`;
    const totalVal    = pad(formatBRL(filteredSum), VAL_W, true);
    const countPadW   = DATE_W + 2 + TYPE_W + 2 + DESC_W + 2 + PARC_W + 2;
    const countLeft   = pad(countLabel, countPadW);
    console.log(`  ${DIM}${countLeft}${RESET}${BOLD}${totalVal}${RESET}`);
  }

  const concilLeftW = Math.max(
    'Total Despesas (Brasil)'.length,
    'Total Despesas (Exterior)'.length,
    'Total Créditos'.length,
    'Esperado (despesas − créditos)'.length,
    'Soma por transação'.length,
    'Soma por cartão'.length,
  );
  const concilW = concilLeftW + 16 + 4;
  printConciliation(statement, {
    line: '─'.repeat(concilW),
    dline: '═'.repeat(concilW),
    leftW: concilLeftW,
  });
}

async function main() {
  const args = process.argv.slice(2);
  const jsonMode          = args.includes('--json');
  const jsonMinifiedMode  = args.includes('--json-minified');
  const debugMode         = args.includes('--debug');
  const txMode            = args.includes('--transactions') || args.includes('-t');
  const filterCard        = args.find(a => /^\d{4}$/.test(a)) || null;
  const filterIdx         = args.indexOf('--filter');
  const filterDesc        = filterIdx !== -1 ? args[filterIdx + 1] : null;

  if (filterIdx !== -1 && !filterDesc) {
    console.error('--filter requires a search term');
    process.exit(1);
  }

  const fileArgIdx = args.indexOf('--file');
  const filePath   = fileArgIdx !== -1 ? args[fileArgIdx + 1] : './fatura.pdf';

  if (fileArgIdx !== -1 && !filePath) {
    console.error('--file requires a path argument');
    process.exit(1);
  }
  if (!filePath.toLowerCase().endsWith('.pdf')) {
    console.error('Invalid file type: only PDF files are supported');
    process.exit(1);
  }
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const data = new Uint8Array(fs.readFileSync(filePath));
  const pages = await extractPages(data);

  if (!debugMode && !isSantanderStatement(pages)) {
    console.error('Arquivo não reconhecido como fatura Santander válida.');
    process.exit(1);
  }

  if (debugMode) {
    for (const page of pages) {
      console.log(`\n--- PAGE ${page.num} START ---`);
      page.lines.forEach(l => console.log(l));
    }
    return;
  }

  const statement = parseStatementPages(pages);

  if (filterCard && !statement.cards[filterCard]) {
    console.error(`Card ···${filterCard} not found. Available: ${Object.keys(statement.cards).join(', ')}`);
    process.exit(1);
  }

  const filtered = filterCard
    ? { ...statement, cards: { [filterCard]: statement.cards[filterCard] } }
    : statement;

  const jsonTarget = filterCard ? filtered.cards[filterCard] : filtered;

  if (jsonMode) {
    console.log(JSON.stringify(jsonTarget, null, 2));
  } else if (jsonMinifiedMode) {
    console.log(JSON.stringify(jsonTarget));
  } else if (txMode) {
    printTransactions(filtered, filterDesc);
  } else {
    printSummary(filtered);
  }
}

main().catch(console.error);
