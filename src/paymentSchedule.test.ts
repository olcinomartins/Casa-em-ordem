import { describe, expect, it } from "vitest";
import { nextOutstandingPaymentDue } from "./paymentSchedule";

describe("nextOutstandingPaymentDue", () => {
  it("mantém vencida uma ocorrência recorrente que ainda não foi resolvida", () => {
    expect(nextOutstandingPaymentDue({
      dueDate: "2026-08-01",
      recurrence: "monthly",
      skippedDates: [],
    })).toBe("2026-08-01");
  });

  it("avança somente as ocorrências explicitamente dispensadas", () => {
    expect(nextOutstandingPaymentDue({
      dueDate: "2026-08-01",
      recurrence: "monthly",
      skippedDates: ["2026-08-01"],
    })).toBe("2026-09-01");
  });
});
