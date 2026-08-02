import { describe, expect, it } from "vitest";
import { FamilyData, audit } from "./domain";
import { planCheck } from "./planCheck";

const data = (): FamilyData => ({
  schemaVersion: 1, household: { name: "Casa", currency: "BRL", members: ["Olcino", "Mari"] },
  categories: [], accounts: [], transactions: [], rules: [], imports: [], tasks: [], receipts: [], shoppingList: [], chores: [],
  budgets: [
    { ...audit(), month: "2026-08", kind: "budget", direction: "income", amount: 10_000 },
    { ...audit(), month: "2026-08", kind: "budget", direction: "expense", amount: 2_000 },
    { ...audit(), month: "2026-08", kind: "provision", amount: 500 },
  ],
  obligations: [{ ...audit(), name: "Plano", kind: "Manual", planned: 800, dueDate: "2026-08-10", recurrence: "monthly", tolerance: 0, status: "A pagar" }],
  goals: [{ ...audit(), name: "Meta", target: 12_000, minimum: 1_000, deadline: "", priority: 1, emergency: false, active: true, movements: [] }],
  lastSavedAt: "2026-08-01T00:00:00.000Z",
});

describe("planCheck", () => {
  it("compara entradas com saídas, pagamentos, provisões e aportes de metas", () => {
    expect(planCheck(data(), "2026-08")).toMatchObject({
      income: 10_000,
      manualBudget: 2_000,
      monthlyPayments: 800,
      provisions: 500,
      goalContributions: 1_000,
      margin: 5_700,
    });
  });

  it("trata orçamento legado sem direção como saída", () => {
    const family = data();
    delete family.budgets[1].direction;
    expect(planCheck(family, "2026-08").manualBudget).toBe(2_000);
  });
});
