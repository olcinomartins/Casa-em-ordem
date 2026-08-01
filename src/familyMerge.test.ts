import { describe, expect, it } from "vitest";
import { FamilyData, audit } from "./domain";
import { mergeFamilySnapshots } from "./familyMerge";

const base = (): FamilyData => ({
  schemaVersion: 1,
  household: { name: "Casa", currency: "BRL", members: ["Olcino", "Mari"] },
  categories: [], accounts: [], transactions: [], rules: [], budgets: [],
  obligations: [], goals: [], tasks: [], imports: [], lastSavedAt: "2026-08-01T00:00:00.000Z",
});

const transaction = (id: string, description: string) => ({
  ...audit("Olcino"), id, description, normalized: description, date: "2026-08-01",
  competence: "2026-08", amount: 10, accountId: "account", operator: "Ambos" as const,
  scope: "Familiar" as const, classification: "confirmed" as const, dedupeKey: id,
  transfer: false,
});

describe("mergeFamilySnapshots", () => {
  it("preserva os lançamentos adicionados em dois aparelhos antes da sincronização", () => {
    const remote = base();
    remote.transactions.push(transaction("olcino", "Compra do Olcino"));
    const local = base();
    local.transactions.push(transaction("mari", "Compra da Mari"));

    const merged = mergeFamilySnapshots(remote, local);

    expect(merged.transactions.map((item) => item.id).sort()).toEqual(["mari", "olcino"]);
  });
});
