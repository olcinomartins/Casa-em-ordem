export interface PaymentAccess { login: string; password: string }
type AccessStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const keyFor = (id: string) => `casa-em-ordem-payment-access:${id}`;
const empty = (): PaymentAccess => ({ login: "", password: "" });
export function loadPaymentAccess(id: string, storage?: AccessStorage): PaymentAccess {
  try {
    const value = JSON.parse((storage ?? localStorage).getItem(keyFor(id)) || "null");
    return { login: typeof value?.login === "string" ? value.login : "", password: typeof value?.password === "string" ? value.password : "" };
  } catch { return empty(); }
}
export function savePaymentAccess(id: string, access: PaymentAccess, storage?: AccessStorage) {
  const target = storage ?? localStorage;
  if (!access.login && !access.password) {
    if (target.getItem(keyFor(id))) target.removeItem(keyFor(id));
  } else target.setItem(keyFor(id), JSON.stringify(access));
}
export const accessFromForm = (form: FormData): PaymentAccess => ({ login: String(form.get("accessLogin") ?? ""), password: String(form.get("accessPassword") ?? "") });
export function parsePaidAmount(value: string) {
  const raw = value.trim().replace(/^R\$\s*/, "");
  const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) throw Error("Informe um valor válido, maior ou igual a zero.");
  const amount = Number(normalized);
  if (!Number.isFinite(amount)) throw Error("Informe um valor válido, maior ou igual a zero.");
  return amount;
}
