import { describe, expect, it } from "vitest";
import { groupPayments } from "./paymentGroups";

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
