import { describe, expect, it, vi } from "vitest";
import {
  defaultUiPreferences,
  loadUiPreferences,
  saveUiPreferences,
  UI_PREFERENCES_STORAGE_KEY,
} from "./uiPreferences";

describe("uiPreferences", () => {
  it("loads a complete versioned preference set", () => {
    const storage = {
      getItem: () =>
        JSON.stringify({
          version: 1,
          month: "2026-05",
          view: "compare",
          analytics: {
            start: "2025-01",
            end: "2026-05",
            mode: "cash",
            report: "final",
            accountId: "card-xp",
          },
        }),
    };

    expect(loadUiPreferences(storage)).toEqual({
      version: 1,
      month: "2026-05",
      view: "compare",
      analytics: {
        start: "2025-01",
        end: "2026-05",
        mode: "cash",
        report: "final",
        accountId: "card-xp",
      },
    });
  });

  it("migrates a legacy flat preference set and orders its date range", () => {
    const storage = {
      getItem: () =>
        JSON.stringify({
          month: "2026-07",
          view: "accrual",
          analyticsStart: "2026-06",
          analyticsEnd: "2025-02",
          analyticsMode: "cash",
          analyticsReport: "reserve",
          analyticsAccountId: " conta-mari ",
        }),
    };

    expect(loadUiPreferences(storage)).toMatchObject({
      version: 1,
      month: "2026-07",
      view: "accrual",
      analytics: {
        start: "2025-02",
        end: "2026-06",
        mode: "cash",
        report: "reserve",
        accountId: "conta-mari",
      },
    });
  });

  it("recovers from invalid JSON, invalid values and storage errors", () => {
    expect(loadUiPreferences({ getItem: () => "not-json" })).toEqual(
      defaultUiPreferences(),
    );
    expect(
      loadUiPreferences({
        getItem: () =>
          JSON.stringify({
            month: "2026-13",
            view: "other",
            analytics: {
              start: "bad",
              end: 7,
              mode: "compare",
              report: "unknown",
              accountId: " ",
            },
          }),
      }),
    ).toEqual(defaultUiPreferences());
    expect(
      loadUiPreferences({
        getItem: () => {
          throw new Error("blocked");
        },
      }),
    ).toEqual(defaultUiPreferences());
  });

  it("normalizes before saving and never propagates storage failures", () => {
    const setItem = vi.fn();
    saveUiPreferences(
      {
        version: 1,
        month: "2026-04",
        view: "cash",
        analytics: {
          start: "2026-04",
          end: "2026-07",
          mode: "accrual",
          report: "budget",
          accountId: "all",
        },
      },
      { setItem },
    );

    expect(setItem).toHaveBeenCalledOnce();
    expect(setItem.mock.calls[0][0]).toBe(UI_PREFERENCES_STORAGE_KEY);
    expect(JSON.parse(setItem.mock.calls[0][1])).toMatchObject({
      version: 1,
      month: "2026-04",
      analytics: { end: "2026-07" },
    });

    expect(() =>
      saveUiPreferences(defaultUiPreferences(), {
        setItem: () => {
          throw new Error("quota");
        },
      }),
    ).not.toThrow();
  });
});
