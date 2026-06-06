const fs = require('fs');
const { PDFParse } = require('pdf-parse');

const TYPE_MAP = { '1': 'chip', '2': 'online', '3': 'contactless' };

const RESET  = '\x1b[0m';
const BOLD   = '\x1b[1m';
const DIM    = '\x1b[2m';
const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const CYAN   = '\x1b[36m';
const YELLOW = '\x1b[33m';

function parseBrazilianNumber(str) {
  const negative = str.startsWith('-');
  const cleaned = str.replace('-', '').replace(/\./g, '').replace(',', '.');
  const value = parseFloat(cleaned);
  return negative ? -value : value;
}

function formatBRL(value) {
  const [int, dec] = Math.abs(value).toFixed(2).split('.');
  const intFormatted = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (value < 0 ? '-' : '') + 'R$ ' + intFormatted + ',' + dec;
}

function pad(str, len, right = false) {
  const s = String(str);
  return right ? s.padStart(len) : s.padEnd(len);
}

function printSummary(statement) {
  const pass = `${GREEN}${BOLD}✓ PASS${RESET}`;
  const fail = `${RED}${BOLD}✗ FAIL${RESET}`;

  const cards    = Object.values(statement.cards);
  const maxNameLen = Math.max(...cards.map(c => c.name.length));
  const expected = statement.total_spent + statement.total_foreign_spent - statement.total_credits;

  const allLabels = [
    maxNameLen + 9, // name(maxNameLen) + "  " + "···XXXX"
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
  const W      = leftW + rightW + 4; // 2 indent + 2 gap
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
    const extra    = ' '.repeat(leftW - maxNameLen - 9);
    const sum      = pad(formatBRL(card.transactions_sum), rightW, true);
    console.log(`  ${namePart}  ${DIM}${lastFour}${RESET}${extra}  ${BOLD}${sum}${RESET}`);
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
  const DATE_W = 5;
  const TYPE_W = 11;
  const DESC_W = 25;
  const PARC_W = 8;
  const VAL_W  = 14;
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

    // Header
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
    const totalVal = pad(formatBRL(filteredSum), VAL_W, true);
    const totalPad = ' '.repeat(DATE_W + 2 + TYPE_W + 2 + DESC_W + 2 + PARC_W + 2);
    console.log(`  ${BOLD}${totalPad}${totalVal}${RESET}`);
  }

  const concilLeftW  = Math.max(
    'Total Despesas (Brasil)'.length,
    'Total Despesas (Exterior)'.length,
    'Total Créditos'.length,
    'Esperado (despesas − créditos)'.length,
    'Soma por transação'.length,
    'Soma por cartão'.length,
  );
  const concilW     = concilLeftW + 16 + 4;
  const concilLine  = '─'.repeat(concilW);
  const concilDline = '═'.repeat(concilW);
  printConciliation(statement, { line: concilLine, dline: concilDline, leftW: concilLeftW });
}

const CARD_LINE_RE   = /^@?\s*(.+?)\s+-\s+\d{4}\s+XXXX\s+XXXX\s+(\d{4})$/;
const VALOR_TOTAL_RE = /^VALOR TOTAL/;
const TOTAL_SPENT_RE = /^\(\+\) Total Despesas\/Débitos no Brasil/;
const TOTAL_CREDITS_RE        = /^\(-\) Total de créditos/;
const TOTAL_FOREIGN_SPENT_RE  = /^\(\+\) Total Despesas\/Débitos no Exterior/;
const SKIP_RE = /^(Pagamento e Demais Créditos|Despesas|Parcelamentos|Compra\s+Data|Detalhamento da Fatura|Resumo da Fatura|Descrição|\d+\/\d+$)/;
const BR_VALUE_RE      = /^-?[\d.]+,\d{2}$/;
const FOREIGN_CURR_RE  = /^-?[\d.]+,\d{2}\s+[A-Za-z]+$/;

function parseTransactionLine(line) {
  const parts = line.split('\t').map(p => p.trim()).filter(Boolean);

  let i = 0;
  let typeDigit = null;

  if (/^[123]$/.test(parts[i])) {
    typeDigit = parts[i];
    i++;
  }

  let date = null;
  let description = null;

  if (i < parts.length && /^\d{2}\/\d{2}\s+/.test(parts[i])) {
    // Normal line with date: "DD/MM DESCRIPTION"
    const dateDescMatch = parts[i].match(/^(\d{2}\/\d{2})\s+(.+)$/);
    if (!dateDescMatch) return null;
    date = dateDescMatch[1];
    description = dateDescMatch[2].trim();
    i++;
  } else if (!typeDigit && i < parts.length) {
    // No-date line: just description (e.g. "IOF DESPESA NO EXTERIOR")
    description = parts[i].trim();
    i++;
  } else {
    return null;
  }

  // Collect extra description fragments the PDF split across tabs (e.g. "SHEIN" + "*SHEINCOM")
  while (
    i < parts.length &&
    !/^\d{2}\/\d{2}$/.test(parts[i]) &&
    !FOREIGN_CURR_RE.test(parts[i]) &&
    !BR_VALUE_RE.test(parts[i])
  ) {
    description += ' ' + parts[i];
    i++;
  }

  let installments = null;
  if (i < parts.length && /^\d{2}\/\d{2}$/.test(parts[i])) {
    installments = parts[i];
    i++;
  }

  // Skip foreign currency amount if present (e.g. "27,33 EURO")
  if (i < parts.length && FOREIGN_CURR_RE.test(parts[i])) i++;

  if (i >= parts.length || !BR_VALUE_RE.test(parts[i])) return null;
  const value = parseBrazilianNumber(parts[i]);

  return { type: typeDigit ? TYPE_MAP[typeDigit] : null, date, description, installments, value };
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
  const fileArgIdx        = args.indexOf('--file');
  const filePath          = fileArgIdx !== -1 ? args[fileArgIdx + 1] : './fatura.pdf';

  if (fileArgIdx !== -1 && !filePath) {
    console.error('--file requires a path argument');
    process.exit(1);
  }
  if (!filePath.toLowerCase().endsWith('.pdf')) {
    console.error(`Invalid file type: only PDF files are supported`);
    process.exit(1);
  }
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const data = new Uint8Array(fs.readFileSync(filePath));
  const parser = new PDFParse({ data });
  const result = await parser.getText();

  const pages = result.pages;
  const relevantPages = pages.slice(1, pages.length - 1);

  const statement = {
    cards: {},
    total_spent: null,
    total_spent_string: null,
    total_foreign_spent: null,
    total_foreign_spent_string: null,
    total_credits: null,
    total_credits_string: null,
    z_reconciliation: null,
    z_reconciliation_transactions_sum: null,
  };

  let currentCard = null;

  for (const page of relevantPages) {
    const lines = page.text.split('\n').map(l => l.trim()).filter(Boolean);

    if (debugMode) {
      console.log(`\n--- PAGE ${page.num} START ---`);
    }

    for (const line of lines) {
      if (debugMode) console.log(line);
      if (SKIP_RE.test(line)) continue;

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
        // parts[1] = BRL value, parts[2] = USD value (skip)
        statement.total_foreign_spent = parseBrazilianNumber(parts[1]);
        statement.total_foreign_spent_string = parts[1];
        continue;
      }

      const cardMatch = line.match(CARD_LINE_RE);
      if (cardMatch) {
        const name = cardMatch[1].trim();
        const last_four = cardMatch[2];
        currentCard = last_four;
        if (!statement.cards[last_four]) {
          statement.cards[last_four] = { name, last_four, transactions: [] };
        }
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
      if (tx && tx.description !== 'PAGAMENTO DE FATURA') {
        statement.cards[currentCard].transactions.push(tx);
      }
    }
  }

  for (const card of Object.values(statement.cards)) {
    card.transactions_sum = Math.round(card.transactions.reduce((acc, tx) => acc + tx.value, 0) * 100) / 100;
  }

  const txSum = Object.values(statement.cards)
    .flatMap(c => c.transactions)
    .reduce((acc, tx) => acc + tx.value, 0);

  const expected = statement.total_spent + statement.total_foreign_spent - statement.total_credits;
  statement.z_reconciliation = Math.round(txSum * 100) === Math.round(expected * 100);

  const txSumFromCards = Object.values(statement.cards)
    .reduce((acc, c) => acc + c.transactions_sum, 0);
  statement.z_reconciliation_transactions_sum = Math.round(txSumFromCards * 100) === Math.round(expected * 100);

  if (debugMode) return;

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
