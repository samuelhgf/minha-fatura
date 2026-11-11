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

for (const currency of ['AED', 'QAR', 'USD', 'EUR', 'EURO', 'DIRHAM EMI.ARA', 'DIRHAM EMI.AR', 'DIRHAM EMI.A', 'RIAL DE CATAR', 'RIAL DE CATA']) {
  for (const values of ['120,00 21,90', '120,00\t21,90']) {
    test(`parses ${currency} currency labels with ${values.includes('\t') ? 'separate' : 'joined'} converted values`, () => {
      assert.deepEqual(parseTransactionLine(
        `3 11/01 EXAMPLE SHOP\t20,00 ${currency}\t${values}`
      ), {
        type: 'contactless',
        date: '11/01',
        description: 'EXAMPLE SHOP',
        installments: null,
        value: 120,
      });
    });
  }
}

test('parses installments joined to the value field', () => {
  assert.deepEqual(parseTransactionLine(
    '3 12/01 EXAMPLE CLINIC\t02/04 1.234,56'
  ), {
    type: 'contactless',
    date: '12/01',
    description: 'EXAMPLE CLINIC',
    installments: '02/04',
    value: 1234.56,
  });
});

test('rejects foreign amounts without a converted BRL value', () => {
  assert.equal(parseTransactionLine('3 11/01 EXAMPLE SHOP\t20,00 DIRHAM EMI.AR'), null);
});

test('reconciles joined installments and foreign purchases across pages', () => {
  const statement = parseStatementPages([{
    num: 1,
    lines: [
      'TEST CUSTOMER - 0000 XXXX XXXX 1234',
      '3 12/01 EXAMPLE CLINIC\t02/04 1.234,56',
      'VALOR TOTAL\t1.234,56 0,00',
      'TEST ADDITIONAL - 0000 XXXX XXXX 5678',
      '3 13/01 EXAMPLE SHOP\t20,00 DIRHAM EMI.AR\t120,00 21,90',
      'IOF DESPESA NO EXTERIOR\t4,20',
    ],
  }, {
    num: 2,
    lines: [
      '14/01 SAMPLE CAFE\t10,00 RIAL DE CATAR\t15,00\t2,78',
      '0,53',
      'IOF DESPESA NO EXTERIOR',
      '15/01 EXAMPLE REFUND\t-5,00',
      'VALOR TOTAL\t139,73 24,68',
      '(+) Total Despesas/Débitos no Brasil\t1.239,29',
      '(+) Total Despesas/Débitos no Exterior\t135,00 24,68',
      '(-) Total de créditos\t5,00',
    ],
  }]);

  assert.equal(statement.cards['1234'].transactions.length, 1);
  assert.equal(statement.cards['1234'].transactions_sum, 1234.56);
  assert.equal(statement.cards['5678'].transactions.length, 5);
  assert.equal(statement.cards['5678'].transactions_sum, 134.73);
  assert.equal(statement.z_reconciliation, true);
  assert.equal(statement.z_reconciliation_transactions_sum, true);
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
