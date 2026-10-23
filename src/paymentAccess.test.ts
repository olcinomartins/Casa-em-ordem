import { describe, expect, it } from "vitest";
import { loadPaymentAccess, savePaymentAccess, parsePaidAmount } from "./paymentAccess";
import { paymentForMonth } from "./paymentSchedule";
import type { Obligation, Transaction } from "./domain";
const storage = () => { const values = new Map<string, string>(); return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } }; };
describe("payment access", () => {
  it("isolates credentials by payment, preserving exact password characters", () => {
    const local = storage();
    savePaymentAccess("gas", { login: "user@example.com", password: "  S&e nhã!  " }, local);
    expect(loadPaymentAccess("gas", local)).toEqual({ login: "user@example.com", password: "  S&e nhã!  " });
    expect(loadPaymentAccess("water", local)).toEqual({ login: "", password: "" });
    savePaymentAccess("gas", { login: "", password: "" }, local);
    expect(loadPaymentAccess("gas", local)).toEqual({ login: "", password: "" });
  });
  it("reports storage failures rather than pretending credentials were saved", () => {
    expect(() => savePaymentAccess("gas", { login: "user", password: "pass" }, { ...storage(), setItem: () => { throw Error("blocked"); } })).toThrow();
  });
});
describe("zero payments", () => {
  it("accepts explicit zero and Brazilian currency but rejects empty, negative and invalid input", () => {
    expect(parsePaidAmount("0")).toBe(0);
    expect(parsePaidAmount("R$ 0,00")).toBe(0);
    expect(parsePaidAmount("1.234,56")).toBe(1234.56);
    for (const value of ["", " ", "abc", "-1", "NaN", "Infinity"]) expect(() => parsePaidAmount(value)).toThrow();
  });
  it("confirms zero only for its occurrence and keeps the following month pending", () => {
    const gas = { id: "gas", recurrence: "monthly", status: "Paga", dueDate: "2026-09-10", paidAt: "2026-09-10", paidAmount: 0 } as Obligation;
    const history = [{ obligationId: "gas", purchaseDate: "2026-09-10", paymentDate: "2026-09-10", amount: 0 }] as Transaction[];
    expect(paymentForMonth(gas, "2026-09", history)).toMatchObject({ status: "Paga", paidAmount: 0 });
    expect(paymentForMonth(gas, "2026-10", history).status).toBe("A pagar");
  });
});
