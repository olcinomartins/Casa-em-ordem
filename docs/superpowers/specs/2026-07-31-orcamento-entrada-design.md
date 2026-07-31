# Orçamento de entrada e checagem de coerência

## Objetivo

Permitir que a família cadastre a renda mensal prevista no mesmo fluxo de
orçamentos e veja, em uma checagem compacta, se o planejamento mensal cabe
nas entradas previstas.

## Cadastro

O tipo de planejamento existente continua com três opções: `Orçamento mensal`,
`Provisão mensal` e `Meta`.

Quando o tipo for `Orçamento mensal`, o formulário exibirá a natureza:

- `Entrada` para previsão de renda familiar;
- `Saída` para limite de despesa familiar.

Cada orçamento de entrada terá nome, valor, categoria/subcategoria de receita,
início e fim de vigência, como os demais orçamentos. Não haverá campos por
pessoa: a base e o planejamento pertencem à família.

## Checagem de coerência

Na página `Categorias, Contas, Orçamentos e Metas`, antes dos blocos de
orçamentos, provisões e metas, haverá uma checagem compacta do período
selecionado:

```text
Entradas previstas
- Orçamentos de saída
- Provisões mensais
- Aportes mensais em metas
= Margem livre / insuficiência
```

Entradas, saídas, provisões e metas respeitam sua vigência. Aportes de metas
consideram o aporte mensal planejado já existente na meta. O resultado será
verde quando maior ou igual a zero e vermelho quando negativo.

Cada linha poderá ser tocada para revelar os orçamentos, provisões ou metas
que compõem o respectivo valor. Esta abertura é apenas explicativa; não altera
o planejamento.

## Dados e compatibilidade

Um campo opcional `direction` será adicionado ao orçamento com valores
`income` e `expense`. Orçamentos existentes serão tratados como `expense`,
preservando o resultado atual. Provisões e metas não usam esse campo.

## Testes

- orçamento de entrada ativo entra na soma de entradas;
- orçamento de saída entra na soma de compromissos;
- orçamentos fora da vigência não entram;
- provisões e aportes de metas entram uma vez cada;
- margem positiva e insuficiência são calculadas corretamente;
- orçamento legado sem `direction` é considerado saída.
