import {
  FamilyData,
  Obligation,
  Receipt,
  Transaction,
  monthOf,
  normalize,
} from "./domain";
import { isExpenseTransaction, realized, suggest } from "./finance";

export type SpendingEntry = {
  id: string;
  date: string;
  description: string;
  amount: number;
  categoryId?: string;
  state: "realized" | "estimated";
  source: "transaction" | "voice" | "manual" | "receipt" | "payment";
};

export type CategorySpending = {
  categoryId?: string;
  name: string;
  amount: number;
  percentage: number;
};

export type SpendingByCategoryResult = {
  total: number;
  categories: CategorySpending[];
};

type Matchable = {
  amount: number;
  date: string;
  alternativeDates?: string[];
  description: string;
  accountId?: string;
};

const dateDistance = (left: string, right: string) => {
  const a = new Date(`${left}T12:00:00`).getTime();
  const b = new Date(`${right}T12:00:00`).getTime();
  return Number.isFinite(a) && Number.isFinite(b)
    ? Math.abs(a - b) / 86_400_000
    : Number.POSITIVE_INFINITY;
};

const ignoredWords = new Set([
  "A", "AS", "DA", "DAS", "DE", "DO", "DOS", "E", "EM", "LTDA", "ME",
  "SA", "S", "PAGAMENTO", "COMPRA", "CARTAO", "DEBITO", "CREDITO",
]);

const words = (value: string) =>
  normalize(value)
    .split(/[^A-Z0-9]+/)
    .filter((word) => word.length >= 3 && !ignoredWords.has(word));

export const descriptionsMatch = (left: string, right: string) => {
  const a = normalize(left);
  const b = normalize(right);
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  const leftWords = words(left);
  const rightWords = new Set(words(right));
  return leftWords.some((word) => rightWords.has(word));
};

const matchScore = (
  actual: Matchable,
  estimate: Matchable,
  maxDays: number,
) => {
  if (Math.abs(Math.abs(actual.amount) - Math.abs(estimate.amount)) >= 0.02)
    return Number.NEGATIVE_INFINITY;
  const dates = [actual.date, ...(actual.alternativeDates || [])].filter(Boolean);
  const days = Math.min(...dates.map((date) => dateDistance(date, estimate.date)));
  if (days > maxDays) return Number.NEGATIVE_INFINITY;
  let score = days === 0 ? 4 : days <= 1 ? 3 : days <= 3 ? 2 : 1;
  if (descriptionsMatch(actual.description, estimate.description)) score += 3;
  if (actual.accountId && estimate.accountId) {
    score += actual.accountId === estimate.accountId ? 4 : -4;
  }
  return score;
};

const actualMatchable = (transaction: Transaction): Matchable => ({
  amount: transaction.amount,
  date: transaction.purchaseDate || transaction.date,
  alternativeDates: [transaction.paymentDate || "", transaction.date],
  description: transaction.description,
  accountId: transaction.accountId,
});

const bestMatch = <T>(
  actual: Matchable,
  candidates: T[],
  toMatchable: (candidate: T) => Matchable,
  maxDays: number,
  minimumScore: number,
) => {
  let result: T | undefined;
  let highest = Number.NEGATIVE_INFINITY;
  for (const candidate of candidates) {
    const score = matchScore(actual, toMatchable(candidate), maxDays);
    if (score >= minimumScore && score > highest) {
      result = candidate;
      highest = score;
    }
  }
  return result;
};

const categoryForObligation = (data: FamilyData, obligation: Obligation) => {
  if (obligation.categoryId) return obligation.categoryId;
  const account = data.accounts.find((item) => item.id === obligation.accountId);
  return (
    suggest(
      obligation.name,
      obligation.accountId || "",
      account?.operator || "Ambos",
      data.rules,
    )?.categoryId ||
    data.categories.find((category) => normalize(category.name) === "OUTROS")?.id
  );
};

const transactionDate = (transaction: Transaction, view: "cash" | "accrual") =>
  view === "cash"
    ? transaction.paymentDate || transaction.date
    : transaction.purchaseDate || transaction.date;

/**
 * Consolida fatos e estimativas do mês. Estimativas conciliadas permanecem no
 * histórico para auditoria, mas deixam de compor o total assim que o fato chega.
 */
export function monthlySpending(
  data: FamilyData,
  month: string,
  view: "cash" | "accrual",
): SpendingEntry[] {
  const otherCategory = data.categories.find(
    (category) => normalize(category.name) === "OUTROS",
  )?.id;
  const actualTransactions = data.transactions.filter(
    (transaction) => !transaction.estimated && isExpenseTransaction(transaction),
  );
  const entries: SpendingEntry[] = actualTransactions
    .map((transaction) => ({
      id: transaction.id,
      date: transactionDate(transaction, view),
      description: transaction.description,
      amount: Math.abs(realized(transaction, month, view)),
      categoryId: transaction.categoryId || otherCategory,
      state: "realized" as const,
      source: transaction.obligationId
        ? ("payment" as const)
        : ("transaction" as const),
    }))
    .filter((entry) => entry.amount > 0);

  const usedActualBySource = {
    voice: new Set<string>(),
    receipt: new Set<string>(),
    payment: new Set<string>(),
  };
  const legacyActualMatch = (
    source: keyof typeof usedActualBySource,
    estimate: Matchable,
    maxDays: number,
    minimumScore: number,
  ) => {
    const candidate = bestMatch(
      estimate,
      actualTransactions.filter(
        (transaction) => !usedActualBySource[source].has(transaction.id),
      ),
      actualMatchable,
      maxDays,
      minimumScore,
    );
    if (!candidate) return false;
    usedActualBySource[source].add(candidate.id);
    return true;
  };

  const foodCategory = data.categories.find(
    (category) => normalize(category.name) === "ALIMENTACAO",
  )?.id;
  const activeReceipts = (data.receipts || []).filter(
    (receipt) =>
      !receipt.reconciledTransactionId &&
      monthOf(receipt.date) === month &&
      receipt.total > 0,
  );

  for (const receipt of activeReceipts) {
    const matchable: Matchable = {
      amount: receipt.total,
      date: receipt.date,
      description: receipt.store,
    };
    if (legacyActualMatch("receipt", matchable, 7, 5)) continue;
    entries.push({
      id: receipt.id,
      date: receipt.date,
      description: receipt.store,
      amount: Math.abs(receipt.total),
      categoryId: receipt.categoryId || foodCategory || otherCategory,
      state: "estimated",
      source: "receipt",
    });
  }

  for (const transaction of data.transactions) {
    const date = transaction.purchaseDate || transaction.date;
    if (
      !transaction.estimated ||
      transaction.reconciledTransactionId ||
      !isExpenseTransaction(transaction) ||
      monthOf(date) !== month
    ) continue;
    const matchable = actualMatchable(transaction);
    if (legacyActualMatch("voice", matchable, 7, 5)) continue;
    // Quando a mesma compra foi registrada por voz e por nota, a nota é a
    // estimativa mais detalhada e deve aparecer uma única vez.
    if (
      activeReceipts.some(
        (receipt) =>
          Math.abs(receipt.total - transaction.amount) < 0.02 &&
          dateDistance(receipt.date, date) === 0 &&
          descriptionsMatch(receipt.store, transaction.description),
      )
    ) continue;
    entries.push({
      id: transaction.id,
      date,
      description: transaction.description,
      amount: Math.abs(transaction.amount),
      categoryId: transaction.categoryId || otherCategory,
      state: "estimated",
      source: transaction.estimateOrigin === "manual" ? "manual" : "voice",
    });
  }

  for (const obligation of data.obligations) {
    const amount = obligation.paidAmount ?? obligation.planned;
    const actualForObligation = actualTransactions.find(
      (transaction) => transaction.obligationId === obligation.id,
    );
    if (obligation.status === "Dispensada" || actualForObligation) continue;

    if (obligation.status === "Paga") {
      if (monthOf(obligation.paidAt || obligation.dueDate) !== month || amount <= 0)
        continue;
      entries.push({
        id: `paid:${obligation.id}`,
        date: obligation.paidAt || obligation.dueDate,
        description: obligation.name,
        amount: Math.abs(amount),
        categoryId: categoryForObligation(data, obligation),
        state: "realized",
        source: "payment",
      });
      continue;
    }

    if (
      obligation.reconciledTransactionId ||
      monthOf(obligation.dueDate) !== month ||
      amount <= 0
    ) continue;
    const estimate: Matchable = {
      amount,
      date: obligation.dueDate,
      description: obligation.pattern || obligation.name,
      accountId: obligation.accountId,
    };
    if (legacyActualMatch("payment", estimate, 35, 5)) continue;
    entries.push({
      id: `obligation:${obligation.id}`,
      date: obligation.dueDate,
      description: obligation.name,
      amount: Math.abs(amount),
      categoryId: categoryForObligation(data, obligation),
      state: "estimated",
      source: "payment",
    });
  }
  return entries;
}

/**
 * Consolida o acompanhamento mensal por categoria. O percentual usa a escala
 * de 0 a 100 e considera a mesma combinação de fatos e estimativas já
 * conciliadas por `monthlySpending`.
 */
export function spendingByCategory(
  data: FamilyData,
  month: string,
  view: "cash" | "accrual",
): SpendingByCategoryResult {
  const categoriesById = new Map(
    data.categories.map((category) => [category.id, category]),
  );
  const uncategorizedKey = "__uncategorized__";
  const totals = new Map<string, number>();

  for (const entry of monthlySpending(data, month, view)) {
    if (!Number.isFinite(entry.amount) || entry.amount <= 0) continue;
    const key =
      entry.categoryId && categoriesById.has(entry.categoryId)
        ? entry.categoryId
        : uncategorizedKey;
    totals.set(key, (totals.get(key) || 0) + entry.amount);
  }

  const total = [...totals.values()].reduce((sum, amount) => sum + amount, 0);
  const categories = [...totals.entries()]
    .map(([categoryId, amount]): CategorySpending => {
      const category = categoriesById.get(categoryId);
      return {
        categoryId: category?.id,
        name: category?.name || "Sem categoria",
        amount,
        percentage: total > 0 ? (amount / total) * 100 : 0,
      };
    })
    .sort(
      (left, right) =>
        right.amount - left.amount || left.name.localeCompare(right.name, "pt-BR"),
    );

  return { total, categories };
}

/**
 * Liga lançamentos importados aos registros preliminares. Cada fato pode
 * conciliar no máximo um registro de cada fonte; assim, duas compras legítimas
 * de mesmo valor continuam distintas.
 */
export function reconcileImportedTransactions(
  data: FamilyData,
  imported: Transaction[],
) {
  let reconciled = 0;
  for (const actual of imported) {
    if (!isExpenseTransaction(actual)) continue;
    const matchable = actualMatchable(actual);

    const provisional = bestMatch(
      matchable,
      data.transactions.filter(
        (transaction) =>
          Boolean(transaction.provisional && transaction.obligationId) &&
          isExpenseTransaction(transaction),
      ),
      actualMatchable,
      7,
      5,
    );
    if (provisional) {
      actual.obligationId = provisional.obligationId;
      actual.categoryId ||= provisional.categoryId;
      actual.subcategory ||= provisional.subcategory;
      data.transactions = data.transactions.filter(
        (transaction) => transaction.id !== provisional.id,
      );
      reconciled++;
    }

    const voice = bestMatch(
      matchable,
      data.transactions.filter(
        (transaction) =>
          transaction.estimated &&
          !transaction.reconciledTransactionId &&
          isExpenseTransaction(transaction),
      ),
      actualMatchable,
      7,
      5,
    );
    if (voice) {
      voice.reconciledTransactionId = actual.id;
      voice.updatedAt = actual.updatedAt;
      voice.version++;
      actual.categoryId ||= voice.categoryId;
      actual.subcategory ||= voice.subcategory;
      reconciled++;
    }

    const receipt = bestMatch(
      matchable,
      (data.receipts || []).filter((item) => !item.reconciledTransactionId),
      (item: Receipt) => ({
        amount: item.total,
        date: item.date,
        description: item.store,
      }),
      7,
      5,
    );
    if (receipt) {
      receipt.reconciledTransactionId = actual.id;
      receipt.updatedAt = actual.updatedAt;
      receipt.version++;
      actual.categoryId ||= receipt.categoryId;
      reconciled++;
    }

    const obligation = bestMatch(
      matchable,
      data.obligations.filter(
        (item) =>
          item.status !== "Dispensada" &&
          !item.reconciledTransactionId &&
          !actual.obligationId,
      ),
      (item: Obligation) => ({
        amount: item.paidAmount ?? item.planned,
        date: item.paidAt || item.dueDate,
        description: item.pattern || item.name,
        accountId: item.accountId,
      }),
      35,
      5,
    );
    const linkedObligation = actual.obligationId
      ? data.obligations.find((item) => item.id === actual.obligationId)
      : obligation;
    if (linkedObligation) {
      linkedObligation.reconciledTransactionId = actual.id;
      linkedObligation.status = "Confirmada";
      linkedObligation.paidAt = actual.paymentDate || actual.date;
      linkedObligation.paidAmount = Math.abs(actual.amount);
      linkedObligation.updatedAt = actual.updatedAt;
      linkedObligation.version++;
      actual.obligationId = linkedObligation.id;
      actual.categoryId ||= linkedObligation.categoryId || categoryForObligation(data, linkedObligation);
      actual.subcategory ||= linkedObligation.subcategory;
      if (obligation) reconciled++;
    }
  }
  return reconciled;
}
