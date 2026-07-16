export const dashboardBlockIds = [
  "summary",
  "categories",
  "budget",
  "personal",
  "commitments",
  "goals",
] as const;

export type DashboardBlockId = (typeof dashboardBlockIds)[number];

const aliases: Readonly<Record<string, DashboardBlockId>> = {
  summary: "summary",
  resumo: "summary",
  overview: "summary",
  categories: "categories",
  categorias: "categories",
  spending: "categories",
  budget: "budget",
  budgets: "budget",
  orcamento: "budget",
  personal: "personal",
  personalbudgets: "personal",
  pessoais: "personal",
  commitments: "commitments",
  compromissos: "commitments",
  payments: "commitments",
  goals: "goals",
  metas: "goals",
};

const normalizedAlias = (value: unknown) => {
  if (typeof value !== "string") return undefined;
  const key = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  return aliases[key];
};

const extractOrder = (value: unknown): unknown[] => {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      return extractOrder(JSON.parse(value));
    } catch {
      return value.split(",");
    }
  }
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return extractOrder(record.order ?? record.blocks ?? record.blockOrder);
  }
  return [];
};

/** Migrates old labels/containers, removes duplicates and appends new blocks. */
export function normalizeDashboardOrder(value: unknown): DashboardBlockId[] {
  const result: DashboardBlockId[] = [];
  for (const candidate of extractOrder(value)) {
    const id = normalizedAlias(candidate);
    if (id && !result.includes(id)) result.push(id);
  }
  for (const id of dashboardBlockIds) {
    if (!result.includes(id)) result.push(id);
  }
  return result;
}

export function moveDashboardBlock(
  order: readonly DashboardBlockId[],
  id: DashboardBlockId,
  direction: "up" | "down",
): DashboardBlockId[] {
  const next = normalizeDashboardOrder(order);
  const index = next.indexOf(id);
  const target = index + (direction === "up" ? -1 : 1);
  if (index < 0 || target < 0 || target >= next.length) return next;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function dashboardOrderStorageKey(member: string): string {
  const memberKey = member
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `casa-em-ordem-dashboard-order:v1:${memberKey || "familia"}`;
}
