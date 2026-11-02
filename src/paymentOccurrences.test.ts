import { describe, expect, it } from "vitest";
import { paymentOccurrencesForMonth, summarizePaymentOccurrences } from "./paymentSchedule";
import type { Obligation, Transaction } from "./domain";

const series = { id: "bill", name: "Recurring bill", dueDate: "2026-11-01", planned: 100, recurrence: "monthly", status: "A pagar", skippedDates: [] } as unknown as Obligation;
const open = (items: Obligation[]) => items.filter(item => item.status === "A pagar");

describe("payment occurrences per month", () => {
  it("keeps unpaid monthly occurrences and generates later ones independently", () => {
    const items = open(paymentOccurrencesForMonth(series, "2027-01", []));
    expect(items.map(item => item.dueDate)).toEqual(["2026-11-01", "2026-12-01", "2027-01-01", "2027-02-01"]);
    expect(items.filter(item => item.dueDate.startsWith("2027-01")).reduce((sum, item) => sum + item.planned, 0)).toBe(100);
    expect(series.dueDate).toBe("2026-11-01");
  });
  it("shows quarterly occurrences every three months without paying the previous ones", () => {
    const quarterly = { ...series, dueDate: "2026-11-02", recurrence: "quarterly" as const, status: "Paga" as const, paidAt: "2026-11-01" };
    const transactions = [{ obligationId: series.id, purchaseDate: "2026-11-02", paymentDate: "2026-11-01", amount: 100 }] as Transaction[];
    for (const [month, date] of [["2027-02", "2027-02-01"], ["2027-05", "2027-05-01"], ["2027-08", "2027-08-01"]]) {
      expect(open(paymentOccurrencesForMonth(quarterly, month, transactions)).filter(item => item.dueDate.startsWith(month)).map(item => item.dueDate)).toEqual([date]);
    }
    expect(open(paymentOccurrencesForMonth(quarterly, "2027-04", transactions)).map(item => item.dueDate)).toEqual(["2027-02-01", "2027-05-01"]);
  });
  it("settles only the linked occurrence even if paid in a different month", () => {
    const transactions = [{ obligationId: series.id, purchaseDate: "2026-11-01", paymentDate: "2027-01-03", amount: 110 }] as Transaction[];
    const items = paymentOccurrencesForMonth(series, "2027-01", transactions);
    expect(open(items).map(item => item.dueDate)).toEqual(["2026-12-01", "2027-01-01", "2027-02-01"]);
  });
  it("does not erase a later quarterly bill when an overdue occurrence is paid late", () => {
    const quarterly = { ...series, recurrence: "quarterly" as const };
    const transactions = [
      { obligationId: series.id, purchaseDate: "2026-11-01", paymentDate: "2026-11-01", amount: 100 },
      { obligationId: series.id, purchaseDate: "2027-02-01", paymentDate: "2027-06-01", amount: 100 },
    ] as Transaction[];
    expect(open(paymentOccurrencesForMonth(quarterly, "2027-06", transactions)).map(item => item.dueDate)).toEqual(["2027-05-01", "2027-08-01"]);
  });
  it("keeps month-end anchors and skips only an explicitly dismissed occurrence", () => {
    const payment = { ...series, dueDate: "2027-01-31", skippedDates: ["2027-02-28"] };
    expect(open(paymentOccurrencesForMonth(payment, "2027-03", [])).map(item => item.dueDate)).toEqual(["2027-01-31", "2027-03-31", "2027-04-30"]);
  });
  it("keeps unpaid one-off bills in later months but never repeats a paid one", () => {
    const once = { ...series, recurrence: "none" as const };
    expect(paymentOccurrencesForMonth(once, "2027-03", [])).toHaveLength(1);
    expect(paymentOccurrencesForMonth({ ...once, status: "Paga" }, "2027-03", [])).toEqual([]);
  });
  it("projects semiannual and annual bills independently of payment", () => {
    for (const [recurrence, month] of [["semiannual", "2027-05"], ["yearly", "2027-11"]] as const) {
      expect(open(paymentOccurrencesForMonth({ ...series, recurrence }, month, [])).some(item => item.dueDate === `${month}-01`)).toBe(true);
    }
  });
  it("separates the month's forecast from arrears and later months", () => {
    const items = paymentOccurrencesForMonth(series, "2027-01", []);
    expect(summarizePaymentOccurrences(items, "2027-01")).toEqual({
      monthCount: 1, monthTotal: 100, pendingCount: 1, pendingTotal: 100,
      overdueCount: 2, overdueTotal: 200,
    });
  });
});
