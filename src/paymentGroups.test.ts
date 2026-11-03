import { describe, expect, it } from "vitest";
import { paymentGroupForDate, includePaymentInGroup } from "./paymentGroups";
import { paymentForMonth } from "./paymentSchedule";
import type { Obligation, Transaction } from "./domain";

describe("payment groups for the selected month", () => {
  it("excludes future monthly bills while keeping current, overdue, and non-monthly forecasts", () => {
    const rows = [
      { recurrence: "monthly", dueDate: "2026-11-10", planned: 100 },
      { recurrence: "monthly", dueDate: "2026-10-10", planned: 100 },
      { recurrence: "monthly", dueDate: "2026-12-10", planned: 100 },
      { recurrence: "quarterly", dueDate: "2027-02-01", planned: 200 },
      { recurrence: "yearly", dueDate: "2027-05-01", planned: 300 },
      { recurrence: "none", dueDate: "2027-03-01", planned: 400 },
    ];
    const visible = rows.filter(row => includePaymentInGroup(row, "2026-11", "2026-11-02"));
    expect(visible.map(row => row.dueDate)).toEqual(["2026-11-10", "2026-10-10", "2027-02-01", "2027-05-01", "2027-03-01"]);
    expect(visible.filter(row => paymentGroupForDate(row.dueDate, "2026-11", "2026-11-02") === "Vence nos próximos meses").reduce((sum, row) => sum + row.planned, 0)).toBe(900);
  });
  it("puts a quarterly occurrence in the selected future month instead of a collapsed future group", () => {
    const payment = { id: "quarterly", dueDate: "2026-11-02", recurrence: "quarterly", status: "Paga", paidAt: "2026-11-01" } as Obligation;
    const transactions = [{ obligationId: payment.id, purchaseDate: "2026-11-02", paymentDate: "2026-11-01", amount: 100 }] as Transaction[];
    const occurrence = paymentForMonth(payment, "2027-02", transactions);
    expect(occurrence.status).toBe("A pagar");
    expect(paymentGroupForDate(occurrence.dueDate, "2027-02", "2026-11-02")).toBe("Vence este mês");
  });
  it("keeps current-month urgency and compares other dates to the selected month", () => {
    expect(paymentGroupForDate("2026-11-02", "2026-11", "2026-11-02")).toBe("Vence hoje");
    expect(paymentGroupForDate("2026-11-08", "2026-11", "2026-11-02")).toBe("Vence nos próximos 7 dias");
    expect(paymentGroupForDate("2027-01-31", "2027-02", "2026-11-02")).toBe("Vencidos");
    expect(paymentGroupForDate("2027-05-01", "2027-03", "2026-11-02")).toBe("Vence nos próximos meses");
  });
});
import {
  groupPayments,
  paymentDateForEdit,
  shouldResetNestedOnToggle,
} from "./paymentGroups";

describe("groupPayments", () => {
  it("ordena as faixas, os vencimentos e calcula os resumos", () => {
    const items = [
      { id: "future", group: "Vence este mês", due: "2026-08-20", amount: 100 },
      { id: "today-b", group: "Vence hoje", due: "2026-08-04", amount: 70 },
      { id: "late", group: "Vencidos", due: "2026-08-01", amount: 50 },
      { id: "today-a", group: "Vence hoje", due: "2026-08-04", amount: 30 },
    ];

    const groups = groupPayments(
      items,
      (item) => item.group,
      (item) => item.due,
      (item) => item.amount,
    );

    expect(groups.map((group) => group.name)).toEqual([
      "Vencidos",
      "Vence hoje",
      "Vence este mês",
    ]);
    expect(groups[1].items.map((item) => item.id)).toEqual(["today-b", "today-a"]);
    expect(groups[1].count).toBe(2);
    expect(groups[1].total).toBe(100);
  });
});

describe("shouldResetNestedOnToggle", () => {
  it("não fecha os subblocos quando o evento veio de um grupo interno", () => {
    const central = {};
    const subgroup = {};

    expect(shouldResetNestedOnToggle(subgroup, central)).toBe(false);
    expect(shouldResetNestedOnToggle(central, central)).toBe(true);
  });
});

describe("paymentDateForEdit", () => {
  it("edita a mesma próxima ocorrência exibida no cartão", () => {
    expect(paymentDateForEdit("2026-08-10", "2026-09-10")).toBe("2026-09-10");
  });
});
