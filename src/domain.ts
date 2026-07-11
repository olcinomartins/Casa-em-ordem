export type Member = "Olcino" | "Mari" | "Ambos";
export type Scope =
  | "Familiar"
  | "Pessoal — Olcino"
  | "Pessoal — Mari"
  | "Transferência interna"
  | "Fora do orçamento";
export type Classification = "pending" | "suggested" | "confirmed";
export type CashView = "cash" | "accrual" | "compare";
export interface Audit {
  id: string;
  createdAt: string;
  updatedAt: string;
  updatedBy: Member;
  version: number;
}
export interface Category extends Audit {
  name: string;
  subcategories: string[];
  nature: "expense" | "income" | "transfer" | "goal";
}
export interface Account extends Audit {
  name: string;
  institution: string;
  kind: "checking" | "card" | "investment" | "cash";
  operator: Member;
  active: boolean;
}
export interface Transaction extends Audit {
  date: string;
  competence: string;
  description: string;
  normalized: string;
  amount: number;
  accountId: string;
  operator: Member;
  scope: Scope;
  categoryId?: string;
  subcategory?: string;
  classification: Classification;
  installment?: number;
  installments?: number;
  totalAmount?: number;
  purchaseDate?: string;
  paymentDate?: string;
  batchId?: string;
  dedupeKey: string;
  transfer: boolean;
  movement?: "expense_income" | "reserve" | "transfer";
  sourceKind?: "card" | "statement";
  notes?: string;
}
export interface Rule extends Audit {
  pattern: string;
  match: "exact" | "contains";
  categoryId: string;
  subcategory: string;
  accountId?: string;
  operator?: Member;
  priority: number;
  active: boolean;
  hits: number;
}
export interface Budget extends Audit {
  month: string;
  startMonth?: string;
  endMonth?: string;
  categoryId?: string;
  accountId?: string;
  member?: Exclude<Member, "Ambos">;
  amount: number;
  reason?: string;
}
export type ObligationStatus =
  | "Prevista"
  | "A pagar"
  | "Paga"
  | "Confirmada"
  | "Atrasada"
  | "Dispensada"
  | "Não encontrada";
export interface Obligation extends Audit {
  name: string;
  kind:
    | "Manual"
    | "Débito automático"
    | "Recorrência no cartão"
    | "Assinatura"
    | "Parcela"
    | "Variável"
    | "Eventual";
  planned: number;
  dueDate: string;
  recurrence: "none" | "monthly" | "yearly";
  tolerance: number;
  accountId?: string;
  pattern?: string;
  status: ObligationStatus;
  paidAt?: string;
  paidAmount?: number;
}
export interface GoalMovement {
  id: string;
  date: string;
  kind: "aporte" | "rendimento" | "retirada" | "ajuste";
  amount: number;
  reason?: string;
}
export interface Goal extends Audit {
  name: string;
  kind?: "provision" | "desire";
  target: number;
  startDate?: string;
  deadline: string;
  priority: number;
  minimum: number;
  emergency: boolean;
  active: boolean;
  movements: GoalMovement[];
}
export interface Task extends Audit {
  title: string;
  description?: string;
  assignee: Member;
  due: string;
  priority: "Baixa" | "Média" | "Alta";
  status: "Pendente" | "Concluída";
  repeat: "none" | "daily" | "weekly" | "monthly" | "yearly";
  repeatUntil?: string;
  checklist: string[];
  linkedId?: string;
  history: string[];
}
export interface ImportBatch extends Audit {
  filename: string;
  hash: string;
  institution: string;
  count: number;
  duplicates: number;
}
export interface FamilyData {
  schemaVersion: 1;
  household: { name: string; currency: "BRL"; members: Member[] };
  categories: Category[];
  accounts: Account[];
  transactions: Transaction[];
  rules: Rule[];
  budgets: Budget[];
  obligations: Obligation[];
  goals: Goal[];
  tasks: Task[];
  imports: ImportBatch[];
  lastSavedAt: string;
}
export const uid = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
export const audit = (who: Member = "Ambos"): Audit => ({
  id: uid(),
  createdAt: now(),
  updatedAt: now(),
  updatedBy: who,
  version: 1,
});
export const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\b(PAG|COMPRA|PIX|DEBITO|CREDITO)\b/g, "")
    .replace(/[^A-Z0-9]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
export const money = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    v,
  );
export const monthOf = (d: string) => d.slice(0, 7);
