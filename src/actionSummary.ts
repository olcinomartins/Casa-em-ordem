import {
  CashView,
  FamilyData,
  Obligation,
  Transaction,
} from "./domain";
import { budgetValue } from "./finance";
import { monthlySpending } from "./spending";

export interface BudgetOverrun {
  categoryId: string;
  name: string;
  planned: number;
  tracked: number;
  overage: number;
}

export interface ActionSummaryOptions {
  month: string;
  view: CashView;
  /** Data local no formato AAAA-MM-DD. */
  today?: string;
  /** Quantidade de dias, incluindo hoje como início da janela. */
  upcomingDays?: number;
}

export interface ActionSummary {
  budgetOverruns: BudgetOverrun[];
  overduePayments: Obligation[];
  upcomingPayments: Obligation[];
  pendingTransactions: Transaction[];
}

const completedPaymentStatuses = new Set<Obligation["status"]>([
  "Paga",
  "Confirmada",
  "Dispensada",
]);

const localDate = () => {
  const date = new Date();
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
};

const addDays = (date: string, days: number) => {
  const [year, month, day] = date.split("-").map(Number);
  const result = new Date(Date.UTC(year, month - 1, day + days));
  return result.toISOString().slice(0, 10);
};

const compareText = (left: string, right: string) =>
  left.localeCompare(right, "pt-BR", { sensitivity: "base" });

const comparePayments = (left: Obligation, right: Obligation) =>
  left.dueDate.localeCompare(right.dueDate) ||
  compareText(left.name, right.name) ||
  left.id.localeCompare(right.id);

const effectiveDate = (
  transaction: Transaction,
  view: Exclude<CashView, "compare">,
) =>
  view === "cash"
    ? transaction.paymentDate || transaction.date
    : transaction.purchaseDate || transaction.date;

/**
 * Reúne somente os itens que pedem atenção no painel. O seletor não altera a
 * base recebida; todas as ordenações são feitas em novos arrays.
 */
export function selectActionSummary(
  data: FamilyData,
  options: ActionSummaryOptions,
): ActionSummary {
  const { month } = options;
  const view: Exclude<CashView, "compare"> =
    options.view === "accrual" ? "accrual" : "cash";
  const trackedViews: Array<Exclude<CashView, "compare">> =
    options.view === "compare" ? ["cash", "accrual"] : [view];
  const today = options.today || localDate();
  const upcomingDays = Number.isFinite(options.upcomingDays)
    ? Math.max(0, Math.floor(options.upcomingDays!))
    : 14;
  const upcomingLimit = addDays(today, upcomingDays);
  const relevantTransactionDate = (transaction: Transaction) =>
    trackedViews
      .map((trackedView) => effectiveDate(transaction, trackedView))
      .filter((date) => date.slice(0, 7) === month)
      .sort()
      .at(-1) || effectiveDate(transaction, view);

  const trackedByCategory = new Map<string, number>();
  for (const trackedView of trackedViews) {
    const totals = new Map<string, number>();
    for (const entry of monthlySpending(data, month, trackedView)) {
      if (!entry.categoryId) continue;
      totals.set(
        entry.categoryId,
        (totals.get(entry.categoryId) || 0) + entry.amount,
      );
    }
    for (const [categoryId, total] of totals) {
      trackedByCategory.set(
        categoryId,
        Math.max(trackedByCategory.get(categoryId) || 0, total),
      );
    }
  }

  const budgetOverruns = data.categories
    .filter((category) => category.nature === "expense")
    .map((category): BudgetOverrun => {
      const planned = budgetValue(
        data,
        month,
        (budget) => budget.categoryId === category.id,
      );
      const tracked = trackedByCategory.get(category.id) || 0;
      return {
        categoryId: category.id,
        name: category.name,
        planned,
        tracked,
        overage: tracked - planned,
      };
    })
    .filter((item) => item.planned > 0 && item.overage > 0)
    .sort(
      (left, right) =>
        right.overage - left.overage ||
        compareText(left.name, right.name) ||
        left.categoryId.localeCompare(right.categoryId),
    );

  const openPayments = data.obligations.filter(
    (payment) => !completedPaymentStatuses.has(payment.status),
  );
  const overduePayments = openPayments
    .filter((payment) => payment.dueDate < today)
    .slice()
    .sort(comparePayments);
  const upcomingPayments = openPayments
    .filter(
      (payment) =>
        payment.dueDate >= today && payment.dueDate <= upcomingLimit,
    )
    .slice()
    .sort(comparePayments);

  const pendingTransactions = data.transactions
    .filter(
      (transaction) =>
        transaction.classification !== "confirmed" &&
        !transaction.reconciledTransactionId &&
        trackedViews.some(
          (trackedView) =>
            effectiveDate(transaction, trackedView).slice(0, 7) === month,
        ),
    )
    .slice()
    .sort((left, right) => {
      const dateOrder = relevantTransactionDate(right).localeCompare(
        relevantTransactionDate(left),
      );
      return (
        dateOrder ||
        compareText(left.description, right.description) ||
        left.id.localeCompare(right.id)
      );
    });

  return {
    budgetOverruns,
    overduePayments,
    upcomingPayments,
    pendingTransactions,
  };
}
