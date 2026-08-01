import { describe, expect, it } from "vitest";
import { mergeSharedLayout } from "./sharedLayout";

describe("mergeSharedLayout", () => {
  it("adota a disposição mais recente para todos os aparelhos", () => {
    const layout = mergeSharedLayout(
      { updatedAt: "2026-08-01T10:00:00.000Z", pageOrders: { visao: ["dashboard-panel"] } },
      { updatedAt: "2026-08-01T10:01:00.000Z", pageOrders: { visao: ["analytics-section", "dashboard-panel"] } },
    );

    expect(layout?.pageOrders.visao).toEqual(["analytics-section", "dashboard-panel"]);
  });
});
