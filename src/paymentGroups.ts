export const PAYMENT_GROUP_ORDER = [
  "Vencidos",
  "Vence hoje",
  "Vence nos próximos 7 dias",
  "Vence este mês",
  "Vence nos próximos meses",
] as const;

export type PaymentGroupName = (typeof PAYMENT_GROUP_ORDER)[number];

export function shouldResetNestedOnToggle(target: unknown, currentTarget: unknown) {
  return target === currentTarget;
}

export function groupPayments<T>(
  items: T[],
  groupOf: (item: T) => string,
  dueDateOf: (item: T) => string,
  amountOf: (item: T) => number,
) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const name = groupOf(item);
    groups.set(name, [...(groups.get(name) || []), item]);
  }

  return PAYMENT_GROUP_ORDER.flatMap((name) => {
    const groupedItems = groups.get(name);
    if (!groupedItems?.length) return [];
    const sortedItems = groupedItems
      .slice()
      .sort((a, b) => dueDateOf(a).localeCompare(dueDateOf(b)));
    return [{
      name,
      items: sortedItems,
      count: sortedItems.length,
      total: sortedItems.reduce((sum, item) => sum + amountOf(item), 0),
    }];
  });
}
