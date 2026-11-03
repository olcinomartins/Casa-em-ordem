import { describe, expect, it, vi } from "vitest";
import {
  defaultUiPreferences,
  compactMonthLabel,
  shiftMonth,
  loadUiPreferences,
  saveUiPreferences,
  UI_PREFERENCES_STORAGE_KEY,
} from "./uiPreferences";

describe("uiPreferences", () => {
  it("formats the selected month compactly without losing the year", () => {
    expect(compactMonthLabel("2026-11")).toBe("nov 2026");
    expect(compactMonthLabel("2027-02")).toBe("fev 2027");
  });
  it("moves chronologically through months and changes the year automatically", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2027-01", -1)).toBe("2026-12");
    let month = "2026-11";
    for (let i = 0; i < 3; i++) month = shiftMonth(month, 1);
    expect(month).toBe("2027-02");
  });
  it("opens in the local current month after manual selection and year rollover", () => {
    vi.useFakeTimers();
    try {
      let serialized = "";
      const storage = {
        getItem: () => serialized,
        setItem: (_key: string, value: string) => { serialized = value; },
      };
      vi.setSystemTime(new Date(2026, 11, 31, 23, 59));
      const manuallySelected = { ...defaultUiPreferences(), month: "2026-10" };
      saveUiPreferences(manuallySelected, storage);
      expect(manuallySelected.month).toBe("2026-10");
      expect(loadUiPreferences(storage).month).toBe("2026-12");
      vi.setSystemTime(new Date(2027, 0, 1, 0, 1));
      expect(loadUiPreferences(storage).month).toBe("2027-01");
    } finally {
      vi.useRealTimers();
    }
  });

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
      month: defaultUiPreferences().month,
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
      month: defaultUiPreferences().month,
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
