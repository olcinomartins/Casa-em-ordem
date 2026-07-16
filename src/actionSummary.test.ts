import { describe, expect, it } from "vitest";
import {
  Budget,
  FamilyData,
  Obligation,
  Transaction,
  audit,
  normalize,
} from "./domain";
import { createSeed } from "./seed";
import { selectActionSummary } from "./actionSummary";

const setup = () => {
  const data = createSeed();
  data.transactions = [];
  data.budgets = [];
  data.obligations = [];
  data.receipts = [];
  data.accounts = [
    {
      ...audit("Olcino"),
      id: "account",
      name: "Cartão",
      institution: "Inter",
      kind: "card",
      operator: "Olcino",
      active: true,
    },
  ];
  return data;
};

const categoryId = (data: FamilyData, name: string) =>
  data.categories.find(
    (category) => normalize(category.name) === normalize(name),
  )!.id;

const transaction = (
  patch: Partial<Transaction> = {},
): Transaction => ({
  ...audit("Olcino"),
  id: "transaction",
  date: "2026-07-10",
  competence: "2026-07",
  purchaseDate: "2026-07-10",
  paymentDate: "2026-07-10",
  description: "Compra teste",
  normalized: "COMPRA TESTE",
  amount: 100,
  accountId: "account",
  operator: "Olcino",
  scope: "Familiar",
  classification: "confirmed",
  dedupeKey: "transaction",
  transfer: false,
  movement: "expense_income",
  sourceKind: "card",
  ...patch,
});

const budget = (
  category: string,
  amount: number,
  patch: Partial<Budget> = {},
): Budget => ({
  ...audit(),
  month: "2026-07",
  startMonth: "2026-07",
  categoryId: category,
  amount,
  ...patch,
});

const payment = (patch: Partial<Obligation> = {}): Obligation => ({
  ...audit(),
  id: "payment",
  name: "Conta",
  kind: "Manual",
  planned: 100,
  dueDate: "2026-07-20",
  recurrence: "none",
  tolerance: 0,
  status: "A pagar",
  ...patch,
});

describe("selectActionSummary", () => {
  it("encontra excessos usando gastos realizados e estimados", () => {
    const data = setup();
    const food = categoryId(data, "Alimentação");
    const housing = categoryId(data, "Moradia");
    data.budgets = [budget(food, 100), budget(housing, 200)];
    data.transactions = [
      transaction({ id: "food", categoryId: food, amount: 130 }),
      transaction({
        id: "housing",
        categoryId: housing,
        amount: 240,
        estimated: true,
        estimateOrigin: "manual",
      }),
    ];

    expect(
      selectActionSummary(data, {
        month: "2026-07",
        view: "cash",
        today: "2026-07-10",
      }).budgetOverruns,
    ).toEqual([
      {
        categoryId: housing,
        name: "Moradia",
        planned: 200,
        tracked: 240,
        overage: 40,
      },
      {
        categoryId: food,
        name: "Alimentação",
        planned: 100,
        tracked: 130,
        overage: 30,
      },
    ]);
  });

  it("não trata gasto sem orçamento de categoria como excesso", () => {
    const data = setup();
    const food = categoryId(data, "Alimentação");
    data.transactions = [transaction({ categoryId: food, amount: 500 })];

    const result = selectActionSummary(data, {
      month: "2026-07",
      view: "cash",
      today: "2026-07-10",
    });

    expect(result.budgetOverruns).toEqual([]);
  });

  it("avisa excessos de qualquer uma das duas visões ao comparar", () => {
    const data = setup();
    const food = categoryId(data, "Alimentação");
    data.budgets = [budget(food, 50)];
    data.transactions = [
      transaction({
        categoryId: food,
        purchaseDate: "2026-07-05",
        date: "2026-07-05",
        paymentDate: "2026-08-05",
        amount: 100,
      }),
    ];

    const result = selectActionSummary(data, {
      month: "2026-07",
      view: "compare",
      today: "2026-07-10",
    });

    expect(result.budgetOverruns).toEqual([
      {
        categoryId: food,
        name: "Alimentação",
        planned: 50,
        tracked: 100,
        overage: 50,
      },
    ]);
  });

  it("separa vencidos e próximos, inclui os limites e ignora concluídos", () => {
    const data = setup();
    data.obligations = [
      payment({ id: "old-b", name: "B vencida", dueDate: "2026-07-01" }),
      payment({ id: "old-a", name: "A vencida", dueDate: "2026-07-01" }),
      payment({ id: "today", dueDate: "2026-07-10" }),
      payment({ id: "limit", dueDate: "2026-07-15" }),
      payment({ id: "later", dueDate: "2026-07-16" }),
      payment({ id: "paid", dueDate: "2026-07-09", status: "Paga" }),
      payment({
        id: "confirmed",
        dueDate: "2026-07-11",
        status: "Confirmada",
      }),
      payment({
        id: "dismissed",
        dueDate: "2026-07-12",
        status: "Dispensada",
      }),
    ];

    const result = selectActionSummary(data, {
      month: "2026-07",
      view: "cash",
      today: "2026-07-10",
      upcomingDays: 5,
    });

    expect(result.overduePayments.map((item) => item.id)).toEqual([
      "old-a",
      "old-b",
    ]);
    expect(result.upcomingPayments.map((item) => item.id)).toEqual([
      "today",
      "limit",
    ]);
  });

  it("limita pendências ao mês e as ordena sem alterar a base", () => {
    const data = setup();
    data.transactions = [
      transaction({
        id: "b",
        description: "B compra",
        classification: "suggested",
        date: "2026-07-20",
        paymentDate: "2026-07-20",
      }),
      transaction({
        id: "a",
        description: "A compra",
        classification: "pending",
        date: "2026-07-20",
        paymentDate: "2026-07-20",
      }),
      transaction({
        id: "newer",
        classification: "pending",
        date: "2026-07-25",
        paymentDate: "2026-07-25",
      }),
      transaction({
        id: "other-month",
        classification: "pending",
        date: "2026-08-01",
        paymentDate: "2026-08-01",
      }),
      transaction({ id: "confirmed", classification: "confirmed" }),
      transaction({
        id: "reconciled",
        classification: "suggested",
        reconciledTransactionId: "fact",
      }),
    ];
    const originalOrder = data.transactions.map((item) => item.id);

    const result = selectActionSummary(data, {
      month: "2026-07",
      view: "cash",
      today: "2026-07-10",
    });

    expect(result.pendingTransactions.map((item) => item.id)).toEqual([
      "newer",
      "a",
      "b",
    ]);
    expect(data.transactions.map((item) => item.id)).toEqual(originalOrder);
  });

  it("inclui pendências da compra integral ou do fluxo em comparar", () => {
    const data = setup();
    data.transactions = [
      transaction({
        classification: "pending",
        purchaseDate: "2026-07-05",
        date: "2026-07-05",
        paymentDate: "2026-08-05",
      }),
    ];

    const result = selectActionSummary(data, {
        month: "2026-07",
        view: "compare",
        today: "2026-07-10",
      });

    expect(result.pendingTransactions.map((item) => item.id)).toEqual([
      "transaction",
    ]);
  });
});
