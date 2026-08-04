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
