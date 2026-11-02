type PaymentRecurrence = "none" | "monthly" | "quarterly" | "semiannual" | "yearly";

const recurrenceMonths = (recurrence: PaymentRecurrence) =>
  recurrence === "monthly" ? 1
    : recurrence === "quarterly" ? 3
    : recurrence === "semiannual" ? 6
    : recurrence === "yearly" ? 12
    : 0;

const dateOnly = (date: Date) => date.toISOString().slice(0, 10);

export function nextOutstandingPaymentDue(payment: {
  dueDate: string;
  recurrence: PaymentRecurrence;
  skippedDates?: string[];
}) {
  const step = recurrenceMonths(payment.recurrence);
  if (!step) return payment.dueDate;
  const date = new Date(`${payment.dueDate}T12:00:00`);
  while (payment.skippedDates?.includes(dateOnly(date)))
    date.setMonth(date.getMonth() + step);
  return dateOnly(date);
}

/** Projects a series without changing its anchor or its payment history. */
export function paymentForMonth(
  payment: import("./domain").Obligation,
  month: string,
  transactions: import("./domain").Transaction[],
): import("./domain").Obligation {
  const step = recurrenceMonths(payment.recurrence);
  if (!step || payment.status === "Dispensada") return payment;
  if (step > 1) {
    const linked = transactions.filter(t => t.obligationId === payment.id);
    const occurrence = linked.find(t => (t.purchaseDate || t.paymentDate || t.date).slice(0, 7) === month);
    if (occurrence) return { ...payment, dueDate: occurrence.purchaseDate || payment.dueDate, status: "Paga", paidAt: occurrence.paymentDate || occurrence.date, paidAmount: Math.abs(occurrence.amount) };
    const lastPaid = linked
      .map(t => t.paymentDate || t.date)
      .filter(date => date.slice(0, 7) <= month)
      .sort().at(-1);
    const legacyPaidAt = !linked.length && ["Paga", "Confirmada"].includes(payment.status) ? payment.paidAt || payment.dueDate : undefined;
    const paidAnchor = lastPaid || (legacyPaidAt && legacyPaidAt.slice(0, 7) < month ? legacyPaidAt : undefined);
    const anchor = paidAnchor || payment.dueDate;
    const [year, startMonth, day] = anchor.split("-").map(Number);
    const [targetYear, targetMonth] = month.split("-").map(Number);
    const distance = (targetYear - year) * 12 + targetMonth - startMonth;
    if (distance < 0 || (!paidAnchor && legacyPaidAt && month === anchor.slice(0, 7))) return payment;
    const intervals = Math.max(paidAnchor ? 1 : 0, Math.ceil(distance / step));
    const date = new Date(year, startMonth - 1 + intervals * step, 1, 12);
    const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    const dueDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
    return { ...payment, dueDate, status: payment.skippedDates?.includes(dueDate) ? "Dispensada" : "A pagar", paidAt: undefined, paidAmount: undefined, reconciledTransactionId: undefined };
  }
  const [year, startMonth, day] = payment.dueDate.split("-").map(Number);
  const [targetYear, targetMonth] = month.split("-").map(Number);
  const distance = (targetYear - year) * 12 + targetMonth - startMonth;
  if (distance < 0 || distance % step) return payment;
  const dueDate = `${month}-${String(Math.min(day, new Date(targetYear, targetMonth, 0).getDate())).padStart(2, "0")}`;
  const transaction = transactions.find(t => t.obligationId === payment.id && (t.purchaseDate || t.paymentDate || t.date).slice(0, 7) === month);
  const legacyPaid = !transactions.some(t => t.obligationId === payment.id) &&
    ["Paga", "Confirmada"].includes(payment.status) && (payment.paidAt || payment.dueDate).slice(0, 7) === month;
  if (transaction || legacyPaid) return { ...payment, dueDate, status: "Paga", paidAt: transaction?.paymentDate || payment.paidAt, paidAmount: transaction ? Math.abs(transaction.amount) : payment.paidAmount };
  return { ...payment, dueDate, status: payment.skippedDates?.includes(dueDate) ? "Dispensada" : "A pagar", paidAt: undefined, paidAmount: undefined, reconciledTransactionId: undefined };
}
