# santander-fatura-parse

Parser de faturas PDF do cartão Santander. Extrai transações por portador, calcula totais e verifica a conciliação dos valores.

## Requisitos

- Node.js 22.3+
- npm

## Instalação

```bash
npm install
```

## Uso

```bash
node parse.js [opções] [últimos 4 dígitos]
```

### Arquivo de entrada

Por padrão o script lê `./fatura.pdf`. Use `--file` para especificar outro caminho:

```bash
node parse.js --file ./fatura.pdf
node parse.js --file "/caminho/para/fatura 2.pdf"
```

Apenas arquivos `.pdf` são aceitos.

---

## Modos de saída

### Resumo por cartão (padrão)

Exibe os totais por portador e a conciliação da fatura.

```bash
node parse.js
node parse.js --file ./fatura.pdf
```

```
══════════════════════════════════════════════════
       FATURA SANTANDER — TOTAIS POR CARTÃO
══════════════════════════════════════════════════

  CARTÕES
  ──────────────────────────────────────────────────
  NOME DO PORTADOR     ···1234      R$ 10.000,00
  ...
  ──────────────────────────────────────────────────
  TOTAL (soma dos cartões)           R$ 89.848,55

  CONCILIAÇÃO
  ──────────────────────────────────────────────────
  Total Despesas (Brasil)            R$ 92.349,25
  Total Despesas (Exterior)               R$ 0,00
  Total Créditos                    - R$ 2.500,70
  Esperado (despesas − créditos)     R$ 89.848,55
  ──────────────────────────────────────────────────
  Soma por transação             ✓ PASS
  Soma por cartão                ✓ PASS
══════════════════════════════════════════════════
```

### Transações (`--transactions` / `-t`)

Exibe todas as transações detalhadas por portador.

```bash
node parse.js --transactions
node parse.js -t
```

#### Filtrar por descrição (`--filter`)

Busca case-insensitive no campo descrição (equivalente a SQL `LIKE`).

```bash
node parse.js -t --filter "shopee"
node parse.js -t --filter "apple"
```

### JSON (`--json`)

Saída completa em JSON formatado.

```bash
node parse.js --json
node parse.js --json > fatura.json
```

### JSON minificado (`--json-minified`)

```bash
node parse.js --json-minified
```

### Debug (`--debug`)

Imprime cada linha lida do PDF por página, sem processar. Útil para inspecionar o conteúdo bruto.

```bash
node parse.js --debug
```

---

## Filtrar por cartão

Passe os últimos 4 dígitos do cartão como argumento para filtrar qualquer modo de saída:

```bash
node parse.js 9764                    # resumo apenas do cartão ···9764
node parse.js 9764 -t                 # transações do cartão ···9764
node parse.js 9764 -t --filter "uber" # transações filtradas
node parse.js 9764 --json             # JSON do cartão ···9764
```

---

## Estrutura do JSON

```json
{
  "cards": {
    "1234": {
      "name": "NOME DO PORTADOR",
      "last_four": "1234",
      "transactions": [
        {
          "type": "contactless | chip | online | null",
          "date": "DD/MM",
          "description": "DESCRIÇÃO DA COMPRA",
          "installments": "01/06 | null",
          "value": 173.51
        }
      ],
      "total_value": 30469.55,
      "total_value_string": "30.469,55",
      "transactions_sum": 30469.49
    }
  },
  "total_spent": 92349.25,
  "total_spent_string": "92.349,25",
  "total_foreign_spent": 173.51,
  "total_foreign_spent_string": "173,51",
  "total_credits": 2500.70,
  "total_credits_string": "2.500,70",
  "z_reconciliation": true,
  "z_reconciliation_transactions_sum": true
}
```

### Campos

| Campo | Descrição |
|---|---|
| `cards` | Objeto indexado pelos últimos 4 dígitos do cartão |
| `transactions[].type` | `chip`, `online`, `contactless` ou `null` |
| `transactions[].date` | Data no formato `DD/MM`, ou `null` para lançamentos sem data (ex: IOF) |
| `transactions[].installments` | Parcela no formato `01/06`, ou `null` |
| `transactions[].value` | Valor em float (negativo = crédito/estorno) |
| `total_value` | Total da fatura do cartão conforme o PDF |
| `transactions_sum` | Soma calculada das transações (exclui `PAGAMENTO DE FATURA`) |
| `total_spent` | Total de despesas no Brasil (da seção Resumo da Fatura) |
| `total_foreign_spent` | Total de despesas no exterior em BRL |
| `total_credits` | Total de créditos (da seção Resumo da Fatura) |
| `z_reconciliation` | `true` se a soma individual das transações bate com o esperado |
| `z_reconciliation_transactions_sum` | `true` se a soma dos `transactions_sum` por cartão bate com o esperado |

### Fórmula de conciliação

```
esperado = total_spent + total_foreign_spent - total_credits
```
