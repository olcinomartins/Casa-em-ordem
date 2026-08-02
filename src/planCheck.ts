import { Budget, FamilyData, Goal, Obligation } from "./domain";
import { budgetApplies } from "./finance";

const cardKinds = new Set<Obligation["kind"]>([
  "Recorrência no cartão",
  "Assinatura",
  "Parcela",
]);

export const isCardCommitment = (obligation: Obligation) =>
  cardKinds.has(obligation.kind);

const sum = <T>(items: T[], value: (item: T) => number) =>
  items.reduce((total, item) => total + value(item), 0);

const monthlyPayment = (item: Obligation) =>
  item.recurrence === "monthly" &&
  item.status !== "Dispensada";

const legacyPaymentBudget = (budget: Budget, payments: Obligation[]) =>
  payments.some(
    (payment) =>
      Boolean(payment.categoryId && budget.categoryId) &&
      payment.categoryId === budget.categoryId &&
      (payment.name.trim().toLocaleLowerCase("pt-BR") === (budget.reason || "").trim().toLocaleLowerCase("pt-BR") ||
        Boolean(payment.subcategory && budget.subcategory) && payment.subcategory === budget.subcategory),
  );

/** Valores mensais que precisam caber na entrada familiar prevista. */
export function planCheck(data: FamilyData, month: string) {
  const activeBudgets = data.budgets.filter((item) => budgetApplies(item, month));
  const payments = data.obligations.filter(monthlyPayment);
  const incomeItems = activeBudgets.filter(
    (item) => item.kind !== "provision" && item.direction === "income",
  );
  const expenseItems = activeBudgets.filter(
    (item) =>
      item.kind !== "provision" &&
      item.direction !== "income" &&
      !legacyPaymentBudget(item, payments),
  );
  const provisionItems = activeBudgets.filter((item) => item.kind === "provision");
  const goalItems = data.goals.filter(
    (item: Goal) => item.active && !item.provisionPool && item.minimum > 0,
  );
  const income = sum(incomeItems, (item) => item.amount);
  const manualBudget = sum(expenseItems, (item) => item.amount);
  const monthlyPayments = sum(payments, (item) => item.planned);
  const provisions = sum(provisionItems, (item) => item.amount);
  const goalContributions = sum(goalItems, (item) => item.minimum);
  return {
    income, manualBudget, monthlyPayments, provisions, goalContributions,
    margin: income - manualBudget - monthlyPayments - provisions - goalContributions,
    incomeItems, expenseItems, payments, provisionItems, goalItems,
  };
}
