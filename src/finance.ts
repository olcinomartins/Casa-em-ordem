import {
  FamilyData,
  Transaction,
  Rule,
  normalize,
  monthOf,
  uid,
  now,
  Member,
  CashView,
} from "./domain";
export async function hashText(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
export async function dedupeKey(
  t: Pick<
    Transaction,
    "date" | "description" | "amount" | "accountId" | "installment"
  >,
) {
  return hashText(
    [
      t.date,
      normalize(t.description),
      t.amount.toFixed(2),
      t.accountId,
      t.installment ?? 0,
    ].join("|"),
  );
}
export function suggest(
  description: string,
  accountId: string,
  operator: Member,
  rules: Rule[],
) {
  const n = normalize(description);
  return rules
    .filter(
      (r) =>
        r.active &&
        (!r.accountId || r.accountId === accountId) &&
        (!r.operator || r.operator === operator) &&
        (r.match === "exact" ? n === r.pattern : n.includes(r.pattern)),
    )
    .sort((a, b) => b.priority - a.priority || b.hits - a.hits)[0];
}
export function upsertRule(data: FamilyData, t: Transaction) {
  if (!t.categoryId || !t.subcategory) return;
  const pattern = normalize(t.description);
  const old = data.rules.find(
    (r) => r.pattern === pattern && r.accountId === t.accountId,
  );
  if (old) {
    old.categoryId = t.categoryId;
    old.subcategory = t.subcategory;
    old.hits++;
    old.updatedAt = now();
    old.version++;
    return;
  }
  data.rules.push({
    id: uid(),
    createdAt: now(),
    updatedAt: now(),
    updatedBy: t.operator,
    version: 1,
    pattern,
    match: "exact",
    categoryId: t.categoryId,
    subcategory: t.subcategory,
    accountId: t.accountId,
    operator: t.operator,
    priority: 100,
    active: true,
    hits: 1,
  });
}
export function realized(
  t: Transaction,
  month: string,
  view: Exclude<CashView, "compare">,
) {
  if (t.transfer || t.scope === "Fora do orçamento") return 0;
  if (view === "cash")
    return monthOf(t.paymentDate || t.date) === month ? t.amount : 0;
  const d = t.purchaseDate || t.competence || t.date;
  if (monthOf(d) !== month) return 0;
  if ((t.installments ?? 1) > 1 && t.totalAmount != null)
    return (t.integralAnchor || (t.installment ?? 1) === 1) ? t.totalAmount : 0;
  return t.amount;
}
export function isExpenseTransaction(t: Transaction) {
  return (
    t.amount > 0 &&
    !t.transfer &&
    t.scope !== "Fora do orçamento" &&
    (t.movement == null || t.movement === "expense_income")
  );
}
export function budgetApplies(
  budget: FamilyData["budgets"][number],
  month: string,
) {
  if (!budget.startMonth) return budget.month === month;
  const start = budget.startMonth;
  return start <= month && (!budget.endMonth || budget.endMonth >= month);
}
export function budgetValue(
  data: FamilyData,
  month: string,
  filter: (budget: FamilyData["budgets"][number]) => boolean,
) {
  return data.budgets
    .filter((budget) => budgetApplies(budget, month) && filter(budget))
    .reduce((sum, budget) => sum + budget.amount, 0);
}
export function personalBalance(
  data: FamilyData,
  member: "Olcino" | "Mari",
  through: string,
  view: Exclude<CashView, "compare"> = "cash",
) {
  const starts = data.budgets
    .filter((budget) => budget.member === member)
    .map((budget) => budget.startMonth || budget.month)
    .filter((month) => month <= through)
    .sort();
  if (!starts.length) return 0;
  const months: string[] = [];
  let [year, monthNumber] = starts[0].split("-").map(Number);
  while (`${year}-${String(monthNumber).padStart(2, "0")}` <= through) {
    months.push(`${year}-${String(monthNumber).padStart(2, "0")}`);
    monthNumber++;
    if (monthNumber === 13) {
      monthNumber = 1;
      year++;
    }
  }
  return months.reduce((balance, month) => {
    const budget = budgetValue(data, month, (item) => item.member === member);
    const scope = `Pessoal — ${member}`;
    const spent = data.transactions
      .filter(
        (t) =>
          t.scope === scope &&
          isExpenseTransaction(t) &&
          (!t.estimated || !t.reconciledTransactionId),
      )
      .reduce((s, t) => s + Math.abs(realized(t, month, view)), 0);
    return balance + budget - spent;
  }, 0);
}
export function recurringCheck(
  planned: number,
  actual: number | undefined,
  tolerance: number,
) {
  if (actual == null) return "Não encontrado";
  if (Math.abs(actual - planned) <= tolerance) return "Dentro do planejado";
  return actual > planned ? "Acima" : "Abaixo";
}
