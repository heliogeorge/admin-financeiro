# Plano — Remodelagem do Contas a Pagar

> Proposto em 09/11/2026, revisado com as regras de vencimento/baixa em lote.
> **Nada codado** — aguardando aprovação fase a fase.
> Caso real usado como exemplo: Villaggio das Flores, NF-044620 (entrada EM-26-000128),
> 2 boletos de R$ 1.792,17 (venc. 03/10 e 02/11) + "por fora" pago por depósito
> mensal que **junta os complementos de várias notas do mês**.

## 1. As dores de hoje

1. **A lista de Contas a Pagar é plana, por parcela.** A NF-044620 aparece como duas
   linhas soltas de R$ 1.792,17; nada mostra "título de R$ 3.584,34, parcela 2/2 paga,
   falta R$ 0". Esse resumo já existe na aba de Entradas (`resumo_pagamento`:
   `qtd_pagas/qtd_parcelas`, total pago, saldo), mas não no Contas a Pagar.
2. **Não há como registrar pagamento sem boleto.** Vários fornecedores cobram uma
   parte "por fora" (depósito/PIX), com regra diferente por fornecedor. O valor da NF
   não representa o total a pagar da compra, e hoje o sistema não tem onde registrar
   nem cobrar esse complemento.
3. **Não existe cadastro de fornecedor no app.** Só `fornecedor_regras_juros`
   (juros/multa p/ conciliação) e `compras_fornecedores` (módulo de compras, apartado).
   O fornecedor no contas a pagar é um texto + `erp_fornecedor_id`.

## 2. Como o mercado modela (TOTVS, Sankhya, Omie, SAP B1…)

- **Título → parcelas → baixas.** A NF/fatura gera um *título*; o título se divide em
  *parcelas* (duplicatas, numeradas NF/01, NF/02…); cada parcela recebe *baixas*
  (eventos de pagamento, com juros/desconto). A tela padrão tem dois níveis: posição
  por título (total, pago, saldo, parcelas x/y) e o detalhe com parcelas e baixas.
- **Fiscal ≠ financeiro.** O valor da NF nunca é alterado para refletir o que se paga;
  obrigações além da NF entram como **títulos manuais / despesas acessórias**
  vinculados à mesma compra. É exatamente o caso do complemento "por fora".
- **Adiantamentos** são títulos sem documento fiscal, depois compensados.

**Tradução para o nosso modelo:** já estamos 80% certos sem saber —
`contas_pagar` **é** a parcela, `contas_pagar_baixas` **são** as baixas, e a
`entrada_mercadoria` é o melhor agrupador de "compra" que temos (com
`contas_pagar_itens` fazendo o vínculo). O que falta: **(a)** a visão agrupada por
título no Contas a Pagar, **(b)** o título complementar sem boleto, **(c)** o cadastro
de fornecedor com a regra de cálculo, **(d)** a entrada medir-se pelo
**total esperado** (NF + complemento), não só pelo `total_faturado`.

## 3. Decisão de arquitetura recomendada

**Não alterar o valor na entrada de mercadoria.** Motivos:
- `total_faturado` vem do ERP e o sync (`sync_hash`) sobrescreveria a edição;
- é o valor fiscal da NF — perder isso quebra conferência e auditoria;
- o complemento tem vencimento, forma e comprovante próprios: é uma **obrigação**, e
  obrigação no nosso modelo é uma linha em `contas_pagar`.

**Caminho escolhido:** cadastro de fornecedor com **regra de complemento** + conta a
pagar do tipo `complemento` gerada por entrada (automática pela regra, com edição, ou
manual quando não houver regra). A entrada ganha o campo calculado
`total_esperado = total_faturado + complementos`, e titulação/pagamento passam a ser
medidos contra ele.

## 4. Modelo de dados proposto

### 4.1 Nova tabela `fornecedores` — espelho do ERP + regras do app
O cadastro **espelha o `CADFOR` do ERP** (o sync já faz join nele: `codiforn`,
`nomeforn`). Os campos-base vêm do ERP via sync (somente leitura, como entradas e
contas); os campos de regra são só do app e nunca são sobrescritos pelo sync.

| campo | origem | obs |
|---|---|---|
| id | pk | |
| codiforn | ERP (unique) | chave de amarração |
| nome | ERP (`nomeforn`) | |
| cnpj_cpf | ERP, se disponível no CADFOR | |
| aliases | app | nomes alternativos p/ match em extrato/DDA |
| complemento_tipo | app | enum: `nenhum` (default), `fator`, `valor_informado` |
| complemento_fator | app | **o fator a aplicar** (ex.: 0.30 = +30% sobre a base) |
| complemento_base | app | enum: `total_faturado`, `total_produtos` |
| complemento_vencimento | app | enum: `junto_parcelas` (default), `data_fixa` |
| complemento_dias | app | p/ `data_fixa`: venc. = data_entrada + N dias |
| complemento_obs | app | regra em texto livre |
| ativo | app | |

- **Vencimento é guia, não trava**: a conta complemento gerada tem vencimento
  editável; a regra só preenche o padrão (o pagamento real não tem data certa).
- `junto_parcelas`: gera **um complemento por parcela**, com o mesmo vencimento de
  cada boleto, rateando o fator proporcionalmente (caso Villaggio: o depósito do mês
  paga os complementos que vencem naquele mês, de várias notas).
- `data_fixa`: gera um complemento único por entrada, vencendo N dias após a entrada.
- `fornecedor_regras_juros` ganha fk opcional `fornecedor_id` (ou é absorvida depois —
  decidir na F2; não bloqueia).
- Seed inicial: sync do CADFOR; fallback distinct de `erp_fornecedor_id`+`fornecedor`
  das contas existentes.

### 4.2 `contas_pagar` — novos campos
| campo | obs |
|---|---|
| `tipo_titulo` enum: `duplicata` (default), `complemento`, `avulso` | complemento = "por fora"; avulso = manual sem NF |
| `fornecedor_id` fk null | amarração com o cadastro novo |
| (existentes `documento`, `referencia`, `erp_fornecedor_id` seguem como estão) |

### 4.3 `entradas_mercadoria` — novos campos
| campo | obs |
|---|---|
| `total_complemento` decimal default 0 | soma dos complementos vinculados |
| `total_esperado` decimal | `total_faturado + total_complemento` (recalculado) |

`reconciliationService.buildEntradaSnapshot` passa a usar `total_esperado` como régua
de `status_titulacao` / `status_pagamento` / saldos.

### 4.4 Visão por título (sem tabela nova)
Agrupamento **calculado** (endpoint), não persistido:
- chave: `entrada_id` (via `contas_pagar_itens`) quando existir; senão
  `(erp_fornecedor_id ou fornecedor) + documento + codiloja`;
- por grupo: fornecedor, documento/NF, entrada (numerorr), total do título,
  parcelas pagas x/y, total pago, saldo, próxima parcela a vencer, tipos
  (duplicata/complemento), DDA/boletos ligados.

### 4.5 Baixa em lote — um pagamento quita várias contas
Hoje a conciliação é 1 extrato → 1 baixa → 1 conta (`extratos_bancarios.baixa_id`).
O depósito mensal do "por fora" (e também pagamentos que juntam várias notas) exige
**1 extrato → N baixas**:

- `contas_pagar_baixas` ganha `extrato_id` (fk nullable para `extratos_bancarios`);
  `extratos_bancarios.baixa_id` vira legado (mantido, backfill via `extrato_id`).
- O extrato fica `conciliado` quando a **soma das baixas não estornadas ligadas a ele
  = valor do extrato** (tolerância de centavos); enquanto parcial, status novo
  `parcial` na conciliação.
- UI da conciliação: selecionar **várias contas** para um extrato, com rateio
  pré-preenchido (saldo de cada conta) e ajuste manual; diferença final pode virar
  juros/desconto numa das contas, como já acontece na baixa única.
- Sugestão de combinação: para débito sem boleto, o sistema propõe o conjunto de
  contas `complemento` em aberto do fornecedor (match por aliases na descrição ou
  seleção manual do fornecedor) cuja soma bate com o valor do depósito.

## 5. Fases

### F0 — Decisões (antes de codar) ✋
Já decidido pelo dono:
- Cadastro de fornecedor **espelha o ERP (CADFOR)**; regras são por fornecedor.
- Vencimento do complemento: opção `junto com os boletos` ou `data fixa (N dias)`,
  sem rigidez — campo editável na conta gerada.
- Campo principal da regra: **o fator a aplicar**.
- A baixa precisa aceitar **um depósito quitando complementos de várias notas**.

Ainda a responder:
1. Quais fornecedores têm "por fora" hoje e o fator de cada um
   (base: total da NF ou total dos produtos?). Para quais o valor só se conhece
   na hora (`valor_informado`)?
2. No `junto_parcelas`, o rateio por parcela proporcional está certo
   (NF 2 boletos → 2 complementos) ou prefere um complemento único por nota?
3. A visão padrão do Contas a Pagar deve ser **por título** (agrupada) com expandir,
   ou manter a lista por parcela e criar uma aba "Por título"? (recomendo aba nova
   primeiro, sem quebrar o fluxo atual)
4. Complemento entra no fluxo de aprovação de alguém ou nasce direto pendente?

### F1 — Visão por título no Contas a Pagar (só leitura, sem migration) ✅ FEITA 09/11/2026
- Backend: `GET /api/contas-pagar/titulos` com o agrupamento da seção 4.4
  + filtros (fornecedor, loja, status, origem, período) — `titulosService.js`.
  Período: o título entra se qualquer parcela vence no intervalo (totais somam tudo).
- Frontend: toggle "Por parcela | Por título" na ContasPagarPage — linha mestre
  (fornecedor · doc/entrada · parcelas x/y com barra · próx. venc · total · pago ·
  falta · status) expandindo para as parcelas com venc., baixas, DDA e lupa p/ o
  detalhe atual.
- Detalhe da conta (modal atual) ganhou o bloco "Título": irmãs do mesmo
  documento/entrada, com navegação entre parcelas (resolve "esse mesmo do exemplo
  são 2 boletos").
- Nenhuma mudança de schema. Validado nos dados reais (NF-044620 = 2/2 pago).

### F2 — Cadastro de Fornecedores (espelho do ERP) ✅ FEITA 09/11/2026
- Migration `20261109000001`: tabela `fornecedores` (4.1) + `tipo_titulo`
  (default `duplicata`) e `fornecedor_id` em `contas_pagar`.
- Sync próprio (`fornecedoresService.syncFornecedores`, `POST /api/fornecedores/sync`):
  upsert por `codiforn` só dos campos-base (regras preservadas) + backfill de
  `contas_pagar.fornecedor_id` via codiforn. Primeira carga: 542 fornecedores,
  691 contas vinculadas.
- Backend: `/api/fornecedores` (lista com busca/filtro "com regra" + saldo em
  aberto por fornecedor; PUT edita só os campos de regra).
- Frontend: página "Fornecedores" no menu — chip da regra em linguagem clara
  ("+30% sobre a NF · junto com os boletos") e modal com percentual, exemplo
  calculado, vencimento e aliases.
- Obs.: Villaggio tem 3 cadastros no ERP (64/224/424); o 64 é o que tem contas.
  Regras reais (fatores por fornecedor) ainda a cadastrar — pergunta F0.

### F3 — Complementos ("por fora") ✅ FEITA 09/11/2026
Implementada conforme abaixo, com ajustes: campo `complemento_desde` na regra
(só entradas emitidas a partir dali geram "por fora"; default = dia em que a
regra foi ligada); geração roda ao fim do sync de entradas e via
`backend/scripts/gerar-complementos.js`; vínculos automáticos usam
`origem_match='confirmado'`; teste real no Villaggio (30% fictício) validou
rateio, vencimentos junto dos boletos e `total_esperado` — e foi revertido
(fatores reais pendentes, pergunta F0).
- Migration: `total_complemento`/`total_esperado` na entrada.
- Sync de entradas: ao criar entrada de fornecedor com regra `fator` ativa, gera a(s)
  conta(s) `tipo_titulo='complemento'` (status pendente, sem boleto, forma sugerida
  depósito, `referencia = EM-xx-xxxxxx-C1`, `-C2`…) já vinculada(s) via
  `contas_pagar_itens`, e recalcula `total_esperado`:
  - `junto_parcelas`: um complemento por parcela, vencimento = o do boleto
    correspondente, valor = fator rateado proporcional;
  - `data_fixa`: um complemento único, vencimento = data_entrada + N dias.
  - Geração só quando as parcelas da entrada já chegaram do ERP (senão fica
    pendência "aguardando parcelas", resolvida na rodada seguinte do sync).
- Regra `valor_informado`: a entrada fica com pendência "complemento a informar" e um
  botão na tela da entrada cria a conta com valor manual.
- Edição/remoção do complemento e do vencimento na tela da entrada (log em
  observações); o sync nunca sobrescreve complementos.
- `reconciliationService` passa a medir contra `total_esperado`.
- Telas de entrada: resumo mostra NF + complemento = total esperado.

### F4 — Conciliação de pagamentos sem boleto + baixa em lote ✅ FEITA 09/11/2026
Implementada conforme abaixo: migration `20261109000003` (backfill 15/15),
status do extrato derivado das baixas (pendente/parcial/conciliado/divergente,
estorno reverte), `conciliar-lote` transacional, sugestões com combinação
subset-sum por fornecedor (nome/aliases na descrição ou seleção manual) e aba
"Lote (várias contas)" no modal de conciliação. Baixa automática em lote NÃO
ligada (decisão adiada, como planejado).
- Migration: `contas_pagar_baixas.extrato_id` + backfill a partir de
  `extratos_bancarios.baixa_id` (4.5).
- Backend: `POST /conciliacao/extratos/:id/conciliar-lote` — recebe
  `[{conta_pagar_id, valor_pago, juros, desconto}, …]`, valida soma = valor do
  extrato, cria N baixas e recalcula cada conta/entrada.
- UI da conciliação: modo multi-seleção com rateio pré-preenchido pelo saldo de cada
  conta e ajuste manual (caso Villaggio: 1 depósito ↔ complementos de várias notas).
- Sugestões (`/api/conciliacao/sugestoes/:extratoId`) para débitos **sem** `[banco …]`
  (PIX/TED/depósito): match por fornecedor (nome/aliases contra a descrição do
  extrato) e por **combinação de valores** — propõe o conjunto de contas
  `complemento` em aberto cuja soma bate com o depósito (± tolerância).
- Baixa automática opcional (conservadora: só match único de valor+fornecedor) —
  decidir se liga depois de rodar um tempo no manual.

### F5 — Polimento ✅ FEITA 09/11/2026
- `GET /api/fornecedores/posicao` + aba "Posição" na página Fornecedores:
  quanto devo a cada um (em aberto, vencido, "por fora"), próxima a vencer,
  ordenado pelo saldo, com totais.
- Alertas: entradas com "por fora" previsto pela regra e não lançado
  (aguardando boletos do ERP ou valor a informar), com botão
  "Gerar complementos agora".

---
**PLANO 100% IMPLEMENTADO (F1–F5) em 09/11/2026.** Pendências operacionais:
cadastrar as regras reais de "por fora" por fornecedor (F0.1) e usar a baixa
em lote no próximo depósito mensal. Futuro opcional: baixa automática em lote
(conservadora) e visão por título como padrão.

## 6. O que NÃO muda
- `contas_pagar` continua sendo a parcela (modelo de mercado); nenhuma reescrita.
- Sync do ERP intocado (complementos são sempre `origem='manual'|'complemento'`,
  nunca sobrescritos pelo sync).
- Conciliação OFX/MP atual continua funcionando igual (F4 só adiciona sugestões).

## 7. Ordem e esforço estimado
| Fase | Esforço | Depende de |
|---|---|---|
| F1 | 1 sessão | — |
| F2 | 1 sessão | F0 (fatores reais) |
| F3 | 1–2 sessões | F2 |
| F4 | 1–2 sessões (baixa em lote + sugestões) | F2 (aliases); migration própria |
| F5 | curto | F3 |
