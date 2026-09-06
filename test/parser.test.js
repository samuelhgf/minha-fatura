const test = require('node:test');
const assert = require('node:assert/strict');

// pdfjs-dist optionally looks for these browser globals when loaded in Node.js.
globalThis.DOMMatrix ??= class {};
globalThis.Path2D ??= class {};

const { parseStatementPages, parseTransactionLine } = require('../docs/parser');

test('parses the first amount in a joined BRL and USD value field as BRL', () => {
  const transaction = parseTransactionLine(
    '2 10/01 EXAMPLE ONLINE STORE\t123,45 22,50'
  );

  assert.deepEqual(transaction, {
    type: 'online',
    date: '10/01',
    description: 'EXAMPLE ONLINE STORE',
    installments: null,
    value: 123.45,
  });
});

test('continues to parse foreign transactions with an explicit currency field', () => {
  const transaction = parseTransactionLine(
    '3 11/01 EXAMPLE EURO SHOP\t20,00 EURO\t120,00 21,90'
  );

  assert.deepEqual(transaction, {
    type: 'contactless',
    date: '11/01',
    description: 'EXAMPLE EURO SHOP',
    installments: null,
    value: 120,
  });
});

test('reconciles a statement containing joined BRL and USD value fields', () => {
  const statement = parseStatementPages([{
    num: 1,
    lines: [
      'TEST CUSTOMER - 0000 XXXX XXXX 1234',
      '2 10/01 EXAMPLE ONLINE STORE\t123,45 22,50',
      '2 11/01 SAMPLE SUBSCRIPTION\t76,55 14,00',
      'VALOR TOTAL\t200,00 36,50',
      '(+) Total Despesas/Débitos no Brasil\t0,00',
      '(+) Total Despesas/Débitos no Exterior\t200,00 36,50',
      '(-) Total de créditos\t0,00',
    ],
  }]);

  assert.equal(statement.cards['1234'].transactions.length, 2);
  assert.equal(statement.cards['1234'].transactions_sum, 200);
  assert.equal(statement.z_reconciliation, true);
  assert.equal(statement.z_reconciliation_transactions_sum, true);
});
