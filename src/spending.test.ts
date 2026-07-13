import { describe, expect, it } from "vitest";
import {
  FamilyData,
  Obligation,
  Receipt,
  Transaction,
  audit,
  normalize,
} from "./domain";
import { createSeed } from "./seed";
import {
  monthlySpending,
  reconcileImportedTransactions,
} from "./spending";

const setup = () => {
  const data = createSeed();
  data.budgets = [];
  data.tasks = [];
  data.goals = [];
  data.accounts = [
    {
      ...audit("Olcino"),
      name: "Inter Olcino",
      institution: "Inter",
      kind: "card",
      operator: "Olcino",
      active: true,
    },
  ];
  return data;
};

const transaction = (
  data: FamilyData,
  patch: Partial<Transaction> = {},
): Transaction => ({
  ...audit("Olcino"),
  date: "2026-07-10",
  competence: "2026-07",
  purchaseDate: "2026-07-10",
  paymentDate: "2026-07-10",
  description: "Compra teste",
  normalized: "COMPRA TESTE",
  amount: 50,
  accountId: data.accounts[0].id,
  operator: "Olcino",
  scope: "Familiar",
  categoryId: data.categories.find(
    (category) => normalize(category.name) === "ALIMENTACAO",
  )?.id,
  classification: "confirmed",
  dedupeKey: crypto.randomUUID(),
  transfer: false,
  movement: "expense_income",
  sourceKind: "card",
  ...patch,
});

const receipt = (patch: Partial<Receipt> = {}): Receipt => ({
  ...audit(),
  store: "Mercado Bom",
  date: "2026-07-11",
  total: 100,
  items: [],
  ...patch,
});

const obligation = (
  data: FamilyData,
  patch: Partial<Obligation> = {},
): Obligation => ({
  ...audit(),
  name: "Conta de energia",
  kind: "Manual",
  planned: 200,
  dueDate: "2026-07-20",
  recurrence: "none",
  tolerance: 0,
  accountId: data.accounts[0].id,
  status: "A pagar",
  ...patch,
});

describe("acompanhamento em tempo real", () => {
  it("soma nota, voz e pagamento previsto nas categorias", () => {
    const data = setup();
    data.receipts = [receipt()];
    data.transactions = [
      transaction(data, {
        estimated: true,
        amount: 50,
        date: "2026-07-12",
        purchaseDate: "2026-07-12",
        paymentDate: "2026-07-12",
      }),
    ];
    data.obligations = [obligation(data)];
    const entries = monthlySpending(data, "2026-07", "cash");
    expect(entries.map((entry) => entry.source).sort()).toEqual([
      "payment",
      "receipt",
      "voice",
    ]);
    expect(entries.reduce((sum, entry) => sum + entry.amount, 0)).toBe(350);
    expect(entries.every((entry) => Boolean(entry.categoryId))).toBe(true);
  });

  it("não trata transferência, aporte ou fora do orçamento como despesa", () => {
    const data = setup();
    data.transactions = [
      transaction(data, { estimated: true, transfer: true }),
      transaction(data, { estimated: true, movement: "reserve" }),
      transaction(data, { estimated: true, scope: "Fora do orçamento" }),
    ];
    expect(monthlySpending(data, "2026-07", "cash")).toHaveLength(0);
  });

  it("leva pagamento confirmado ao realizado e cobrança confirmada ao previsto", () => {
    const data = setup();
    data.obligations = [
      obligation(data, {
        status: "Paga",
        paidAt: "2026-07-21",
        paidAmount: 210,
      }),
      obligation(data, {
        name: "Assinatura",
        status: "Confirmada",
        planned: 40,
        dueDate: "2026-07-22",
      }),
    ];
    const entries = monthlySpending(data, "2026-07", "cash");
    expect(entries.find((entry) => entry.amount === 210)?.state).toBe("realized");
    expect(entries.find((entry) => entry.amount === 40)?.state).toBe("estimated");
  });

  it("usa a nota detalhada uma vez quando a mesma compra também veio por voz", () => {
    const data = setup();
    data.receipts = [receipt({ total: 74.77, date: "2026-07-13" })];
    data.transactions = [
      transaction(data, {
        estimated: true,
        amount: 74.77,
        date: "2026-07-13",
        purchaseDate: "2026-07-13",
        description: "Remédios",
      }),
    ];
    const entries = monthlySpending(data, "2026-07", "cash");
    expect(entries).toHaveLength(1);
    expect(entries[0].source).toBe("receipt");
  });
});

describe("conciliação posterior", () => {
  it("substitui voz e pagamento provisório pelo fato importado", () => {
    const data = setup();
    const bill = obligation(data, {
      status: "Paga",
      paidAt: "2026-07-20",
      paidAmount: 200,
    });
    const voice = transaction(data, {
      estimated: true,
      amount: 75,
      date: "2026-07-12",
      purchaseDate: "2026-07-12",
      description: "Padaria Central",
    });
    const provisional = transaction(data, {
      amount: 200,
      date: "2026-07-20",
      purchaseDate: "2026-07-20",
      paymentDate: "2026-07-20",
      description: "Conta de energia",
      obligationId: bill.id,
      provisional: true,
    });
    data.transactions = [voice, provisional];
    data.obligations = [bill];
    const imported = [
      transaction(data, {
        amount: 75,
        date: "2026-07-12",
        purchaseDate: "2026-07-12",
        description: "PADARIA CENTRAL LTDA",
        batchId: "import-1",
      }),
      transaction(data, {
        amount: 200,
        date: "2026-07-20",
        purchaseDate: "2026-07-20",
        paymentDate: "2026-07-20",
        description: "PAGAMENTO CONTA DE ENERGIA",
        batchId: "import-1",
      }),
    ];

    reconcileImportedTransactions(data, imported);
    data.transactions.push(...imported);

    expect(data.transactions.some((item) => item.id === provisional.id)).toBe(false);
    expect(voice.reconciledTransactionId).toBe(imported[0].id);
    expect(bill.reconciledTransactionId).toBe(imported[1].id);
    expect(imported[1].obligationId).toBe(bill.id);
    expect(
      monthlySpending(data, "2026-07", "cash").reduce(
        (sum, entry) => sum + entry.amount,
        0,
      ),
    ).toBe(275);
  });

  it("mantém duas compras legítimas iguais e concilia uma a uma", () => {
    const data = setup();
    const first = transaction(data, { estimated: true, amount: 30 });
    const second = transaction(data, {
      estimated: true,
      amount: 30,
      dedupeKey: "voice-2",
    });
    data.transactions = [first, second];
    const imported = [
      transaction(data, { amount: 30, batchId: "batch", dedupeKey: "fact-1" }),
      transaction(data, { amount: 30, batchId: "batch", dedupeKey: "fact-2" }),
    ];
    reconcileImportedTransactions(data, imported);
    expect(new Set([first.reconciledTransactionId, second.reconciledTransactionId])).toEqual(
      new Set(imported.map((item) => item.id)),
    );
  });
});
