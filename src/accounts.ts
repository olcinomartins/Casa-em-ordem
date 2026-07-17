import type { Account, Member } from "./domain";

export type AccountHolder = "Olcino" | "Mari";
export type AccountOwnership = `${AccountHolder}:${Member}`;

export const ACCOUNT_OWNERSHIP_OPTIONS: ReadonlyArray<{
  value: AccountOwnership;
  label: string;
}> = [
  { value: "Olcino:Ambos", label: "No nome de Olcino · uso familiar" },
  { value: "Mari:Ambos", label: "No nome de Mari · uso familiar" },
  {
    value: "Olcino:Olcino",
    label: "No nome de Olcino · uso pessoal de Olcino",
  },
  { value: "Mari:Mari", label: "No nome de Mari · uso pessoal de Mari" },
  {
    value: "Olcino:Mari",
    label: "No nome de Olcino · uso pessoal de Mari",
  },
  {
    value: "Mari:Olcino",
    label: "No nome de Mari · uso pessoal de Olcino",
  },
];

const OWNERSHIP_VALUES = new Set(
  ACCOUNT_OWNERSHIP_OPTIONS.map((option) => option.value),
);

export function parseAccountOwnership(value: string): {
  holder: AccountHolder;
  operator: Member;
} {
  if (!OWNERSHIP_VALUES.has(value as AccountOwnership))
    throw new Error("Selecione a titularidade e o uso da conta.");
  const [holder, operator] = value.split(":") as [AccountHolder, Member];
  return { holder, operator };
}

export function accountHolder(account: Account): AccountHolder | undefined {
  if (account.holder) return account.holder;
  // Compatibilidade com cadastros antigos, nos quais operator misturava
  // titularidade e uso.
  return account.operator === "Ambos" ? undefined : account.operator;
}

export function accountOwnershipValue(account: Account): string {
  const holder = accountHolder(account);
  return holder ? `${holder}:${account.operator}` : "";
}

export function inferInstitution(name: string): string {
  const clean = name.trim();
  const firstPart = clean.split(/\s*(?:,|·|\s—\s|\s-\s)\s*/, 1)[0]?.trim();
  return firstPart || clean;
}

export function inferLastDigits(name: string): string | undefined {
  const digits = name.replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : undefined;
}

export function accountKindLabel(kind: Account["kind"]): string {
  if (kind === "checking") return "Conta corrente";
  if (kind === "card") return "Cartão";
  if (kind === "investment") return "Investimento";
  return "Dinheiro (cadastro antigo)";
}

export function accountResponsibilityLabel(account: Account): string {
  const holder = accountHolder(account);
  const use = account.operator === "Ambos" ? "Família" : account.operator;
  return `${holder ? `Titular: ${holder}` : "Titular não definido"} · Uso: ${use}`;
}
