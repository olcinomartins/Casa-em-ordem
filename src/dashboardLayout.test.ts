import { describe, expect, it } from "vitest";
import {
  dashboardBlockIds,
  dashboardOrderStorageKey,
  moveDashboardBlock,
  normalizeDashboardOrder,
} from "./dashboardLayout";

describe("dashboardLayout", () => {
  it("uses the complete default block order", () => {
    expect(normalizeDashboardOrder(undefined)).toEqual(dashboardBlockIds);
  });

  it("preserves known order, removes duplicates and appends missing blocks", () => {
    expect(
      normalizeDashboardOrder(["goals", "summary", "unknown", "goals"]),
    ).toEqual([
      "goals",
      "summary",
      "categories",
      "budget",
      "personal",
      "commitments",
    ]);
  });

  it("migrates versioned, legacy and localized layouts", () => {
    expect(
      normalizeDashboardOrder(
        JSON.stringify({ version: 0, blocks: ["Metas", "Orçamento", "Resumo"] }),
      ),
    ).toEqual([
      "goals",
      "budget",
      "summary",
      "categories",
      "personal",
      "commitments",
    ]);
  });

  it("moves blocks without mutating the original and respects boundaries", () => {
    const original = [...dashboardBlockIds];
    expect(moveDashboardBlock(original, "budget", "up")).toEqual([
      "summary",
      "budget",
      "categories",
      "personal",
      "commitments",
      "goals",
    ]);
    expect(original).toEqual(dashboardBlockIds);
    expect(moveDashboardBlock(original, "summary", "up")).toEqual(original);
    expect(moveDashboardBlock(original, "goals", "down")).toEqual(original);
  });

  it("creates stable and isolated storage keys per member", () => {
    expect(dashboardOrderStorageKey(" Olcino ")).toBe(
      dashboardOrderStorageKey("olcino"),
    );
    expect(dashboardOrderStorageKey("Olcino")).not.toBe(
      dashboardOrderStorageKey("Mari"),
    );
  });
});
