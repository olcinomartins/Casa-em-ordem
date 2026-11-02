import { describe, expect, it } from "vitest";
import { paymentForMonth } from "./paymentSchedule";
import type { Obligation, Transaction } from "./domain";
const paid = { id: "rent", dueDate: "2026-08-31", recurrence: "monthly", status: "Paga", paidAt: "2026-08-31", paidAmount: 100 } as Obligation;
describe("paymentForMonth", () => {
  it("shows the next quarterly payment from the actual payment date, including intermediate months", () => {
    const bravecto = { ...paid, dueDate: "2026-10-02", paidAt: "2026-11-01", recurrence: "quarterly" as const };
    const history = [{ obligationId: paid.id, purchaseDate: "2026-10-02", paymentDate: "2026-11-01", amount: 100 }] as Transaction[];
    expect(paymentForMonth(bravecto, "2027-02", history)).toMatchObject({ dueDate: "2027-02-01", status: "A pagar" });
    expect(paymentForMonth(bravecto, "2027-03", history)).toMatchObject({ dueDate: "2027-05-01", status: "A pagar" });
    expect(paymentForMonth(bravecto, "2027-04", history)).toMatchObject({ dueDate: "2027-05-01", status: "A pagar" });
    expect(paymentForMonth(bravecto, "2026-10", history).status).toBe("Paga");
  });

  it("reopens September and October after August was paid, clamping month end", () => {
    expect(paymentForMonth(paid, "2026-09", [])).toMatchObject({ dueDate: "2026-09-30", status: "A pagar", paidAmount: undefined });
    expect(paymentForMonth(paid, "2026-10", [])).toMatchObject({ dueDate: "2026-10-31", status: "A pagar" });
    expect(paid.status).toBe("Paga");
  });
  it("uses the latest actual quarterly payment and preserves past occurrence history", () => {
    const series = { ...paid, recurrence: "quarterly" as const, dueDate: "2026-08-31", paidAt: "2026-12-02" };
    const history = [
      { obligationId: paid.id, purchaseDate: "2026-08-31", paymentDate: "2026-08-31", amount: 100 },
      { obligationId: paid.id, purchaseDate: "2026-11-30", paymentDate: "2026-12-02", amount: 110 },
    ] as Transaction[];
    expect(paymentForMonth(series, "2027-03", history)).toMatchObject({ dueDate: "2027-03-02", status: "A pagar" });
    expect(paymentForMonth(series, "2026-11", history)).toMatchObject({ dueDate: "2026-11-30", status: "Paga", paidAmount: 110 });
    expect(paymentForMonth(series, "2026-09", history)).toMatchObject({ dueDate: "2026-11-30", status: "A pagar" });
  });
  it("clamps quarterly month ends and supports legacy paid records without transactions", () => {
    const series = { ...paid, recurrence: "quarterly" as const, dueDate: "2026-11-30", paidAt: "2026-11-30" };
    expect(paymentForMonth(series, "2027-02", [])).toMatchObject({ dueDate: "2027-02-28", status: "A pagar" });
    expect(paymentForMonth(series, "2027-05", [])).toMatchObject({ dueDate: "2027-05-30", status: "A pagar" });
  });
  it("uses each occurrence history even when paid in another month", () => {
    const history = [{ obligationId: "rent", purchaseDate: "2026-09-30", paymentDate: "2026-10-02", amount: 120 }] as Transaction[];
    expect(paymentForMonth(paid, "2026-09", history)).toMatchObject({ status: "Paga", paidAmount: 120 });
    expect(paymentForMonth(paid, "2026-10", history).status).toBe("A pagar");
  });
  it("keeps a paid occurrence and never reopens a one-off or cancelled series", () => {
    expect(paymentForMonth(paid, "2026-08", []).status).toBe("Paga");
    expect(paymentForMonth({ ...paid, recurrence: "none" }, "2026-10", []).status).toBe("Paga");
    expect(paymentForMonth({ ...paid, status: "Dispensada" }, "2026-10", []).status).toBe("Dispensada");
  });
});
