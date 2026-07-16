import type { CashView } from "./domain";

export const UI_PREFERENCES_STORAGE_KEY = "casa-em-ordem-ui-preferences";
export const UI_PREFERENCES_VERSION = 1 as const;

export type AnalyticsMode = "cash" | "accrual";
export type AnalyticsReport = "budget" | "reserve" | "final";

export interface AnalyticsPreferences {
  start: string;
  end: string;
  mode: AnalyticsMode;
  report: AnalyticsReport;
  accountId: string;
}

export interface UiPreferences {
  version: typeof UI_PREFERENCES_VERSION;
  month: string;
  view: CashView;
  analytics: AnalyticsPreferences;
}

type ReadStorage = Pick<Storage, "getItem">;
type WriteStorage = Pick<Storage, "setItem">;

const monthPattern = /^(\d{4})-(0[1-9]|1[0-2])$/;
const views: readonly CashView[] = ["cash", "accrual", "compare"];
const analyticsModes: readonly AnalyticsMode[] = ["cash", "accrual"];
const analyticsReports: readonly AnalyticsReport[] = [
  "budget",
  "reserve",
  "final",
];

const currentMonth = () => {
  const date = new Date();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${date.getFullYear()}-${month}`;
};

export const defaultUiPreferences = (): UiPreferences => {
  const month = currentMonth();
  return {
    version: UI_PREFERENCES_VERSION,
    month,
    view: "cash",
    analytics: {
      start: month,
      end: month,
      mode: "accrual",
      report: "budget",
      accountId: "all",
    },
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const validMonth = (value: unknown, fallback: string) =>
  typeof value === "string" && monthPattern.test(value) ? value : fallback;

const oneOf = <T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T =>
  typeof value === "string" && allowed.includes(value as T)
    ? (value as T)
    : fallback;

const validAccountId = (value: unknown) => {
  if (typeof value !== "string") return "all";
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= 200
    ? normalized
    : "all";
};

/**
 * Accepts the current nested format and the unversioned/flat format used by
 * early builds. Invalid values are replaced independently, so one corrupt
 * filter does not discard all the other preferences.
 */
const normalizeUiPreferences = (value: unknown): UiPreferences => {
  const defaults = defaultUiPreferences();
  if (!isRecord(value)) return defaults;

  const analytics = isRecord(value.analytics) ? value.analytics : {};
  const start = validMonth(
    analytics.start ?? value.analyticsStart ?? value.start,
    defaults.analytics.start,
  );
  const end = validMonth(
    analytics.end ?? value.analyticsEnd ?? value.end,
    defaults.analytics.end,
  );

  return {
    version: UI_PREFERENCES_VERSION,
    month: validMonth(value.month, defaults.month),
    view: oneOf(value.view, views, defaults.view),
    analytics: {
      start: start <= end ? start : end,
      end: start <= end ? end : start,
      mode: oneOf(
        analytics.mode ?? value.analyticsMode ?? value.mode,
        analyticsModes,
        defaults.analytics.mode,
      ),
      report: oneOf(
        analytics.report ?? value.analyticsReport ?? value.report,
        analyticsReports,
        defaults.analytics.report,
      ),
      accountId: validAccountId(
        analytics.accountId ??
          value.analyticsAccountId ??
          value.accountId,
      ),
    },
  };
};

const browserReadStorage = (): ReadStorage | undefined => {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
};

const browserWriteStorage = (): WriteStorage | undefined => {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
};

export function loadUiPreferences(storage?: ReadStorage): UiPreferences {
  try {
    const serialized = (storage ?? browserReadStorage())?.getItem(
      UI_PREFERENCES_STORAGE_KEY,
    );
    if (!serialized) return defaultUiPreferences();
    return normalizeUiPreferences(JSON.parse(serialized));
  } catch {
    return defaultUiPreferences();
  }
}

export function saveUiPreferences(
  prefs: UiPreferences,
  storage?: WriteStorage,
): void {
  try {
    (storage ?? browserWriteStorage())?.setItem(
      UI_PREFERENCES_STORAGE_KEY,
      JSON.stringify(normalizeUiPreferences(prefs)),
    );
  } catch {
    // Preferences are an enhancement: unavailable/quota-limited storage must
    // never prevent the financial application from continuing to work.
  }
}
