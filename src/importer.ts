import * as XLSX from "xlsx";
import {
  FamilyData,
  Member,
  Transaction,
  audit,
  normalize,
  monthOf,
} from "./domain";
import { dedupeKey, hashText, suggest } from "./finance";
export interface Preview {
  filename: string;
  hash: string;
  institution: string;
  rows: Transaction[];
  duplicates: number;
  errors: string[];
}
const parseMoney = (v: unknown) => {
  if (typeof v === "number") return v;
  let s = String(v ?? "")
    .replace(/R\$|\u00a0/g, "")
    .trim();
  if (s.includes(",") && s.includes("."))
    s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(",", ".");
  return Number(s.replace(/[^0-9.-]/g, ""));
};
const parseDate = (v: unknown) => {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number") {
    const d = XLSX.SSF.parse_date_code(v);
    return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  const s = String(v ?? "")
    .split(" às ")[0]
    .trim();
  const m = s.match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  return new Date().toISOString().slice(0, 10);
};
const pick = (r: Record<string, unknown>, names: string[]) => {
  const key = Object.keys(r).find((k) =>
    names.some((n) => normalize(k).includes(normalize(n))),
  );
  return key ? r[key] : undefined;
};
export async function previewFile(
  file: File,
  data: FamilyData,
  accountId: string,
  operator: Member,
): Promise<Preview> {
  const buffer = await file.arrayBuffer();
  const hash = await hashText(
    String.fromCharCode(...new Uint8Array(buffer).slice(0, 50000)),
  );
  if (data.imports.some((i) => i.hash === hash))
    throw new Error("Este arquivo já foi importado.");
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  const transactionSheet =
    wb.SheetNames.find((name) =>
      normalize(name).includes("EXTRATO E CARTAO"),
    ) ?? wb.SheetNames[0];
  let raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(
    wb.Sheets[transactionSheet],
    { defval: "" },
  );
  if (!raw.length) {
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(
      wb.Sheets[transactionSheet],
      { header: 1, defval: "" },
    );
    const header = matrix.findIndex((row) =>
      row.some((v) => /data|release_date/i.test(String(v))),
    );
    if (header >= 0) {
      const ws = XLSX.utils.aoa_to_sheet(matrix.slice(header));
      raw = XLSX.utils.sheet_to_json(ws, { defval: "" });
    }
  }
  const institution = /inter/i.test(file.name)
    ? "Inter"
    : /xp/i.test(file.name)
      ? "XP"
      : /btg/i.test(file.name)
        ? "BTG"
        : /mercado/i.test(file.name)
          ? "Mercado Pago"
          : "Outro";
  const rows: Transaction[] = [];
  let duplicates = 0;
  const errors: string[] = [];
  for (const [index, r] of raw.entries()) {
    const desc = pick(r, [
      "Lançamento",
      "Estabelecimento",
      "Descricao",
      "Descrição",
      "TRANSACTION_TYPE",
    ]);
    const value = pick(r, ["Valor", "TRANSACTION_NET_AMOUNT"]);
    const date = pick(r, ["Data", "RELEASE_DATE"]);
    if (!desc || !date || value === "") continue;
    let amount = parseMoney(value);
    if (!Number.isFinite(amount)) {
      errors.push(`Linha ${index + 2}: valor inválido`);
      continue;
    }
    const descString = String(desc);
    const invoice = /fatura|cart[aã]o/i.test(file.name);
    if (invoice) amount = Math.abs(amount);
    const parcel = String(pick(r, ["Parcela"]) || "").match(
      /(\d+)\s*(?:de|\/|\s)\s*(\d+)/i,
    );
    const d = parseDate(date);
    const base = {
      ...audit(operator),
      date: d,
      competence: monthOf(d),
      description: descString,
      normalized: normalize(descString),
      amount,
      accountId,
      operator,
      scope: (operator === "Ambos"
        ? "Familiar"
        : `Pessoal — ${operator}`) as Transaction["scope"],
      classification: "pending" as const,
      installment: parcel ? Number(parcel[1]) : undefined,
      installments: parcel ? Number(parcel[2]) : undefined,
      paymentDate: d,
      transfer: /PAGAMENTO.*FATURA|FATURA.*CART[AÃ]O|TRANSFERENCIA ENTRE/i.test(
        normalize(descString),
      ),
      movement: /PAGAMENTO.*FATURA|FATURA.*CART[AÃ]O|TRANSFERENCIA ENTRE/i.test(
        normalize(descString),
      )
        ? ("transfer" as const)
        : ("expense_income" as const),
      sourceKind: invoice ? ("card" as const) : ("statement" as const),
      dedupeKey: "",
      batchId: hash,
    };
    const key = await dedupeKey(base);
    if (data.transactions.some((t) => t.dedupeKey === key)) {
      duplicates++;
      continue;
    }
    const historical = String(
      pick(r, ["SUBCATEGORIA - CONTA (Definida)", "MOVIMENTAÇÃO"]) || "",
    );
    const [historicalCategory, ...historicalSub] = historical.split("-");
    const matchedCategory = data.categories.find(
      (c) => normalize(c.name) === normalize(historicalCategory),
    );
    const rule = suggest(descString, accountId, operator, data.rules);
    rows.push({
      ...base,
      dedupeKey: key,
      categoryId: matchedCategory?.id ?? rule?.categoryId,
      subcategory: historicalSub.join("-") || rule?.subcategory,
      classification: matchedCategory
        ? "confirmed"
        : rule
          ? "suggested"
          : "pending",
    });
  }
  return { filename: file.name, hash, institution, rows, duplicates, errors };
}
