import { FamilyData } from "./domain";
import { mergeSharedLayout } from "./sharedLayout";

type Identified = { id: string; updatedAt: string; version: number };

const newer = <T extends Identified>(remote: T, local: T) =>
  local.updatedAt > remote.updatedAt ||
  (local.updatedAt === remote.updatedAt && local.version >= remote.version)
    ? local
    : remote;

const mergeRecords = <T extends Identified>(remote: T[], local: T[]) => {
  const records = new Map(remote.map((item) => [item.id, item]));
  for (const item of local) {
    const current = records.get(item.id);
    records.set(item.id, current ? newer(current, item) : item);
  }
  return [...records.values()];
};

/**
 * Une alterações feitas sobre a mesma versão da base. Inclusões possuem ids
 * próprios, portanto lançamentos de aparelhos diferentes coexistem. Em uma
 * edição do mesmo item, vence a revisão mais recente, preservando o restante.
 */
export function mergeFamilySnapshots(
  remote: FamilyData,
  local: FamilyData,
): FamilyData {
  return {
    ...remote,
    categories: mergeRecords(remote.categories, local.categories),
    accounts: mergeRecords(remote.accounts, local.accounts),
    transactions: mergeRecords(remote.transactions, local.transactions),
    rules: mergeRecords(remote.rules, local.rules),
    budgets: mergeRecords(remote.budgets, local.budgets),
    obligations: mergeRecords(remote.obligations, local.obligations),
    goals: mergeRecords(remote.goals, local.goals),
    tasks: mergeRecords(remote.tasks, local.tasks),
    imports: mergeRecords(remote.imports, local.imports),
    receipts: mergeRecords(remote.receipts ?? [], local.receipts ?? []),
    shoppingList: mergeRecords(remote.shoppingList ?? [], local.shoppingList ?? []),
    chores: mergeRecords(remote.chores ?? [], local.chores ?? []),
    auditLog: [...(remote.auditLog ?? []), ...(local.auditLog ?? [])]
      .filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index)
      .sort((a, b) => a.at.localeCompare(b.at))
      .slice(-500),
    setupTasksInitialized: remote.setupTasksInitialized || local.setupTasksInitialized,
    responsibilitiesMigrated: remote.responsibilitiesMigrated || local.responsibilitiesMigrated,
    sharedLayout: mergeSharedLayout(remote.sharedLayout, local.sharedLayout),
    lastSavedAt: remote.lastSavedAt > local.lastSavedAt ? remote.lastSavedAt : local.lastSavedAt,
  };
}
