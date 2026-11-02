export const PAYMENT_GROUP_ORDER = [
  "Vencidos",
  "Vence hoje",
  "Vence nos próximos 7 dias",
  "Vence este mês",
  "Vence nos próximos meses",
] as const;

export type PaymentGroupName = (typeof PAYMENT_GROUP_ORDER)[number];

export function paymentGroupForDate(dueDate: string, month: string, today: string): PaymentGroupName {
  if (month !== today.slice(0, 7)) {
    if (dueDate < `${month}-01`) return "Vencidos";
    return dueDate.slice(0, 7) === month ? "Vence este mês" : "Vence nos próximos meses";
  }
  const days = Math.round((new Date(`${dueDate}T12:00:00`).getTime() - new Date(`${today}T12:00:00`).getTime()) / 86_400_000);
  if (days < 0) return "Vencidos";
  if (days === 0) return "Vence hoje";
  if (days <= 7) return "Vence nos próximos 7 dias";
  return dueDate.slice(0, 7) === month ? "Vence este mês" : "Vence nos próximos meses";
}

export function shouldResetNestedOnToggle(target: unknown, currentTarget: unknown) {
  return target === currentTarget;
}

export function paymentDateForEdit(_storedDueDate: string, nextDueDate: string) {
  return nextDueDate;
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
