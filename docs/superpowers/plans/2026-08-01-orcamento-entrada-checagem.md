# Orçamento de Entrada e Checagem Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir receitas previstas e exibir uma checagem mensal compacta entre entrada, orçamento de saída, provisões e metas.

**Architecture:** Um campo opcional `direction` identifica orçamento de entrada ou saída, preservando orçamentos legados como saída. Funções puras em `finance.ts` calculam a coerência por mês; `App.tsx` expõe a natureza no formulário e um painel expansível acima dos blocos de orçamento, provisões e metas.

**Tech Stack:** React, TypeScript, Vitest, Vite.

## Global Constraints

- Manter a base familiar compartilhada como fonte oficial.
- Não mudar valores nem vigências dos orçamentos existentes.
- Orçamentos legados sem natureza são saídas.
- Usar moeda brasileira e interface em português.

---

### Task 1: Modelo e cálculo de coerência

**Files:**
- Modify: `src/domain.ts:Budget`
- Modify: `src/finance.ts`
- Create: `src/financePlan.test.ts`

**Interfaces:**
- Produces `Budget.direction?: "income" | "expense"`.
- Produces `planCheck(data, month)` com totais de entrada, saída, provisão, aporte de meta e margem.

- [ ] **Step 1: Write the failing test**

```ts
expect(planCheck(data, "2026-08")).toMatchObject({
  income: 10000, expenses: 6000, provisions: 1000,
  goalContributions: 500, margin: 2500,
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run src/financePlan.test.ts`
Expected: FAIL because `planCheck` is not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
export function planCheck(data: FamilyData, month: string) {
  const active = data.budgets.filter((item) => budgetApplies(item, month));
  const income = sum(active.filter((item) => item.kind !== "provision" && item.direction === "income"));
  const expenses = sum(active.filter((item) => item.kind !== "provision" && item.direction !== "income"));
  const provisions = sum(active.filter((item) => item.kind === "provision"));
  const goalContributions = data.goals.filter((item) => item.active && !item.provisionPool).reduce((sum, item) => sum + item.minimum, 0);
  return { income, expenses, provisions, goalContributions, margin: income - expenses - provisions - goalContributions };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --run src/financePlan.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain.ts src/finance.ts src/financePlan.test.ts
git commit -m "Adiciona cálculo de entrada prevista"
```

### Task 2: Cadastro e visualização de checagem

**Files:**
- Modify: `src/App.tsx:UnifiedPlanForm, Budgets, page planejamento`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes `Budget.direction` e `planCheck(data, month)`.
- Produces campo `Entrada/Saída` somente para orçamento mensal e painel `Checagem do planejamento` expansível.

- [ ] **Step 1: Write the failing test**

```ts
expect(planCheck(dataWithLegacyBudget, "2026-08").expenses).toBe(250);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run src/financePlan.test.ts`
Expected: FAIL until o cálculo tratar `undefined` como saída.

- [ ] **Step 3: Write minimal implementation**

```tsx
{type === "budget" && <label>Natureza<select name="direction"><option value="expense">Saída</option><option value="income">Entrada</option></select></label>}
<details className="plan-check"><summary>Checagem do planejamento</summary>...</details>
```

- [ ] **Step 4: Run tests and build**

Run: `npm test -- --run && npm run build`
Expected: all tests pass and Vite builds.

- [ ] **Step 5: Commit and publish**

```bash
git add src/App.tsx src/styles.css src/financePlan.test.ts
git commit -m "Exibe checagem entre entradas e planejamento"
git push upstream main
```
