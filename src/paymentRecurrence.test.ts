import { describe, expect, it } from "vitest";
import { paymentForMonth } from "./paymentSchedule";
import type { Obligation, Transaction } from "./domain";
const paid = { id: "rent", dueDate: "2026-08-31", recurrence: "monthly", status: "Paga", paidAt: "2026-08-31", paidAmount: 100 } as Obligation;
describe("paymentForMonth", () => {
  it("reopens September and October after August was paid, clamping month end", () => {
    expect(paymentForMonth(paid, "2026-09", [])).toMatchObject({ dueDate: "2026-09-30", status: "A pagar", paidAmount: undefined });
    expect(paymentForMonth(paid, "2026-10", [])).toMatchObject({ dueDate: "2026-10-31", status: "A pagar" });
    expect(paid.status).toBe("Paga");
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
