import { Budget, FamilyData, Goal, Obligation, normalize } from "./domain";
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

const compact = (value: string) => normalize(value).replace(/\s/g, "");

const legacyPaymentBudget = (budget: Budget, payments: Obligation[]) =>
  payments.some(
    (payment) => {
      const sameCategory = Boolean(payment.categoryId && budget.categoryId) && payment.categoryId === budget.categoryId;
      const paymentName = compact(payment.name);
      const budgetName = compact(budget.reason || "");
      const sameName = Boolean(paymentName && budgetName) && paymentName === budgetName;
      const sameDescription = Boolean(payment.subcategory && budget.subcategory) && compact(payment.subcategory || "") === compact(budget.subcategory || "");
      return sameCategory && (sameName || sameDescription);
    },
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
