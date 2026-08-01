export interface SharedLayout {
  updatedAt: string;
  pageOrders: Record<string, string[]>;
  dashboardOrder?: string[];
  hiddenDashboardBlocks?: string[];
}

export function mergeSharedLayout(
  current?: SharedLayout,
  candidate?: SharedLayout,
): SharedLayout | undefined {
  if (!current) return candidate;
  if (!candidate) return current;
  return candidate.updatedAt >= current.updatedAt ? candidate : current;
}
