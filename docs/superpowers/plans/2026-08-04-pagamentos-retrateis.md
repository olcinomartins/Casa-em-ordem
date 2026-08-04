# Grupos retráteis de pagamentos — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar as faixas de vencimento em subblocos independentes e inicialmente fechados.

**Architecture:** Extrair o agrupamento para uma função pura testável. A tela mantém apenas um conjunto local com os grupos abertos e renderiza os cartões somente dentro do grupo expandido.

**Tech Stack:** React 18, TypeScript, Vitest, Vite.

## Global Constraints

- Não alterar os dados financeiros nem o cálculo da próxima data.
- Preservar ordenação e ações existentes dos pagamentos.
- Não adicionar dependências.

---

### Task 1: Agrupamento e resumo

**Files:**
- Create: `src/paymentGroups.ts`
- Create: `src/paymentGroups.test.ts`
- Modify: `src/App.tsx`

**Interfaces:**
- Produces: `groupPayments<T>(items, groupOf, dueDateOf, amountOf)` com grupos ordenados, quantidade e total.

- [ ] **Step 1: Write the failing test** que exige grupos na ordem definida, itens por vencimento e total somado.
- [ ] **Step 2: Run test to verify it fails** com `npm test -- --run src/paymentGroups.test.ts`.
- [ ] **Step 3: Write minimal implementation** da função pura.
- [ ] **Step 4: Run test to verify it passes** com o mesmo comando.
- [ ] **Step 5: Integrar em `Payments`** usando estado local de grupos abertos, iniciado vazio.
- [ ] **Step 6: Verificar** com `npm test -- --run` e `npm run build`.
- [ ] **Step 7: Commit e publicar** no GitHub Pages.
