import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import PdfWorker from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?worker";
import { readBlobArrayBuffer } from "./fileCompat";

// Entrega o worker ao pipeline do Vite. Assim ele é transpilado e armazenado
// pela PWA, em vez de ser copiado como um módulo bruto incompatível com Safari.
let pdfWorker: Worker | undefined;
const ensurePdfWorker = () => {
  pdfWorker ??= new PdfWorker();
  GlobalWorkerOptions.workerPort = pdfWorker;
};

export type PdfInstitution = "Inter" | "XP" | "BTG";

export interface InterPdfRow {
  date: string;
  description: string;
  amount: number;
  installment?: number;
  installments?: number;
  card?: string;
}

const months: Record<string, string> = {
  jan: "01", fev: "02", mar: "03", abr: "04", mai: "05", jun: "06",
  jul: "07", ago: "08", set: "09", out: "10", nov: "11", dez: "12",
};
const longDatePattern = /(\d{1,2})\s+de\s+(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\.?(?:\s+(\d{4}))?/i;
const shortMonthPattern = /^(\d{1,2})\s+(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\.?(?:\s+(\d{4}))?$/i;
const numericDatePattern = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/;
const interMoneyPattern = /([+-]?)\s*R\$\s*([\d.]+,\d{2})/;

const fold = (value: string) =>
  value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/\s+/g, " ").trim();

const isoDate = (year: number, month: number, day: number) => {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) return undefined;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};

export function parsePdfDate(value: string, fallbackYear: number) {
  const text = fold(value);
  let match = text.match(numericDatePattern);
  if (match) {
    let year = match[3] ? Number(match[3]) : fallbackYear;
    if (year < 100) year += 2000;
    return isoDate(year, Number(match[2]), Number(match[1]));
  }
  match = text.match(longDatePattern) || text.match(shortMonthPattern);
  if (!match) return undefined;
  return isoDate(
    Number(match[3]) || fallbackYear,
    Number(months[match[2].toLowerCase()]),
    Number(match[1]),
  );
}

const parseRegularMoney = (value: string) => {
  const match = value.trim().match(/^([+-]?)\s*(?:R\$\s*)?([\d.]+,\d{2})$/i);
  if (!match) return undefined;
  const amount = Number(match[2].replace(/\./g, "").replace(",", "."));
  return match[1] === "-" ? -amount : amount;
};

const installment = (description: string) => {
  const match =
    description.match(/\bPARC(?:ELA)?\s*(\d{1,2})\s*(?:DE|\/)\s*(\d{1,2})\b/i) ||
    description.match(/\((?:Parcela\s+)?(\d{1,2})\s+de\s+(\d{1,2})\)/i) ||
    description.match(/\b(\d{1,2})\s*\/\s*(\d{1,2})\b/);
  return match
    ? { installment: Number(match[1]), installments: Number(match[2]) }
    : {};
};

const cleanDescription = (description: string) =>
  description
    .replace(/\s*\(Parcela\s+\d{1,2}\s+de\s+\d{1,2}\)\s*/i, " ")
    .replace(/\s+/g, " ")
    .trim();

export function parseInterInvoiceItems(items: string[]): InterPdfRow[] {
  const rows: InterPdfRow[] = [];
  let active = false, card = "", currentDate = "";
  let description: string[] = [];
  const flush = (valueText: string) => {
    if (!active || !currentDate || !description.length) return;
    const value = valueText.match(interMoneyPattern);
    if (!value) return;
    const text = description.filter((part) => part !== "-").join(" ").replace(/\s+/g, " ").trim();
    if (!text || /^Total CART/i.test(text)) return;
    const parcel = installment(text);
    rows.push({
      date: currentDate,
      description: cleanDescription(text),
      // O Inter usa sinal de mais para créditos na fatura.
      amount: (value[1] === "+" ? -1 : 1) * Number(value[2].replace(/\./g, "").replace(",", ".")),
      ...parcel,
      card,
    });
  };
  for (let index = 0; index < items.length; index++) {
    const item = items[index].trim();
    if (!item) continue;
    if (/^Despesas da fatura$/i.test(item)) { active = true; continue; }
    if (/^Pr[oó]xima fatura$/i.test(item) || /compras parceladas realizadas/i.test(item)) { active = false; break; }
    if (/^CART(?:ÃO|AO)$/i.test(item)) {
      card = items.slice(index + 1, index + 5).map((value) => value.trim()).find((value) => /\d{4}\*{2,}\d{4}/.test(value)) || "";
      currentDate = ""; description = []; continue;
    }
    const cardMatch = item.match(/^CART(?:ÃO|AO)\s+(.+)/i);
    if (cardMatch) { card = cardMatch[1]; currentDate = ""; description = []; continue; }
    if (/^Total CART/i.test(item)) { currentDate = ""; description = []; continue; }
    const date = item.match(/(\d{1,2})\s+de\s+(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\.\s+(\d{4})/i);
    if (date && active) {
      currentDate = `${date[3]}-${months[date[2].toLowerCase()]}-${date[1].padStart(2, "0")}`;
      description = []; continue;
    }
    if (active && currentDate && interMoneyPattern.test(item)) { flush(item); currentDate = ""; description = []; continue; }
    if (active && currentDate) description.push(item);
  }
  return rows;
}

export function parseBtgInvoiceItems(
  items: string[],
  fallbackYear: number,
): InterPdfRow[] {
  const rows: InterPdfRow[] = [];
  const card = items
    .map((item) => fold(item).match(/FINAL\s+(\d{4})/)?.[1])
    .find(Boolean);

  // O pagamento fica fora da tabela de compras no PDF do BTG. Importá-lo
  // permite conciliá-lo como transferência, sem contar uma despesa de novo.
  for (let index = 0; index < items.length; index++) {
    const description = items[index].trim();
    if (!/^PAGAMENTO\s+(?:DE|DA)\s+FATURA$/i.test(fold(description))) continue;
    let date: string | undefined;
    let amount: number | undefined;
    for (let next = index + 1; next < Math.min(items.length, index + 7); next++) {
      const candidate = items[next].trim();
      if (!candidate) continue;
      date ??= parsePdfDate(candidate, fallbackYear);
      if (date) {
        const parsed = parseRegularMoney(candidate);
        if (parsed != null) { amount = parsed; break; }
      }
    }
    if (date && amount != null) {
      rows.push({ date, description: cleanDescription(description), amount, card: card ? `final ${card}` : "" });
    }
  }

  let active = false;
  let pendingAmount: number | undefined;
  let pendingDescription: string[] = [];
  for (let index = 0; index < items.length; index++) {
    const item = items[index].trim();
    const normalized = fold(item);
    if (normalized === "TOTAL DE COMPRAS E DESPESAS") {
      active = true;
      pendingAmount = undefined;
      pendingDescription = [];
      continue;
    }
    if (active && /TOTAL DE COMPRAS E DESPESAS DESSA FATURA|SALDO FATURA ANTERIOR|PAGAMENTOS FEITOS|TOTAL DO CARTAO|TAXAS E ENCARGOS|CREDITO ROTATIVO|PARCELAMENTO DA FATURA/.test(normalized)) {
      active = false;
      pendingAmount = undefined;
      pendingDescription = [];
      continue;
    }
    if (!active || !item) continue;
    const amount = parseRegularMoney(item);
    if (amount != null) {
      // Na tabela visual do BTG a coluna de valor é extraída antes da
      // descrição e da data. O último valor, sem data depois dele, é o total.
      pendingAmount = amount;
      pendingDescription = [];
      continue;
    }
    const date = parsePdfDate(item, fallbackYear);
    if (date) {
      const description = cleanDescription(pendingDescription.join(" "));
      if (pendingAmount != null && description && !/^TOTAL\b/i.test(description)) {
        rows.push({
          date,
          description,
          amount: pendingAmount,
          ...installment(description),
          card: card ? `final ${card}` : "",
        });
      }
      pendingAmount = undefined;
      pendingDescription = [];
      continue;
    }
    if (!/^(R\$|DATA|VALOR|DESCRICAO)$/i.test(normalized)) pendingDescription.push(item);
  }
  return rows;
}

export function parseXpInvoiceItems(
  items: string[],
  fallbackYear: number,
): InterPdfRow[] {
  const rows: InterPdfRow[] = [];
  let active = false;
  let card = "";
  for (let index = 0; index < items.length; index++) {
    const item = items[index].trim();
    const normalized = fold(item);
    const cardMatch = item.match(/\d{4}\*{2,}\d{4}|\*{4}\s*\d{4}/);
    if (cardMatch) card = cardMatch[0];
    if (normalized === "DATA") { active = true; continue; }
    if (active && /^(SUBTOTAL|TOTAL DA FATURA|ENCARGOS DA FATURA)/.test(normalized)) {
      active = false;
      continue;
    }
    if (!active) continue;
    const date = parsePdfDate(item, fallbackYear);
    if (!date) continue;
    const description: string[] = [];
    let amount: number | undefined;
    let amountIndex = index;
    for (let next = index + 1; next < Math.min(items.length, index + 16); next++) {
      const candidate = items[next].trim();
      const candidateNormalized = fold(candidate);
      if (!candidate) continue;
      if (/^(SUBTOTAL|TOTAL DA FATURA|ENCARGOS DA FATURA|DATA)$/.test(candidateNormalized)) break;
      if (parsePdfDate(candidate, fallbackYear)) break;
      const parsed = parseRegularMoney(candidate);
      if (parsed != null) {
        amount = parsed;
        amountIndex = next;
        break;
      }
      if (!/^(R\$|US\$|DESCRICAO|VALOR)$/.test(candidateNormalized)) description.push(candidate);
    }
    const text = cleanDescription(description.join(" "));
    if (amount != null && text) {
      rows.push({ date, description: text, amount, ...installment(text), card });
      index = amountIndex;
    }
  }
  return rows;
}

const preparePdfBytes = async (file: File) => {
  const original = new Uint8Array(await readBlobArrayBuffer(file));
  const signature = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
  let start = -1;
  outer: for (let i = 0; i <= original.length - signature.length; i++) {
    for (let j = 0; j < signature.length; j++) if (original[i + j] !== signature[j]) continue outer;
    start = i; break;
  }
  if (start < 0) throw new Error("O arquivo não contém um PDF válido.");
  return start ? original.slice(start) : original;
};

const detectInstitution = (items: string[], filename: string): PdfInstitution => {
  const evidence = fold(`${filename} ${items.slice(0, 220).join(" ")}`);
  if (/\bBTG\b|BTG PACTUAL/.test(evidence)) return "BTG";
  if (/\bXP\b|XP INVESTIMENTOS/.test(evidence)) return "XP";
  return "Inter";
};

const yearFrom = (items: string[], filename: string) => {
  const filenameYear = filename.match(/\b(20\d{2})\b/);
  if (filenameYear) return Number(filenameYear[1]);
  const textYear = items.slice(0, 180).join(" ").match(/\b(20\d{2})\b/);
  return textYear ? Number(textYear[1]) : new Date().getFullYear();
};

export const findPdfDueDate = (items: string[], fallbackYear: number) => {
  for (let index = 0; index < items.length; index++) {
    if (!/VENCIMENTO/i.test(fold(items[index]))) continue;
    const inline = items[index].match(
      /VENCIMENTO\s*:?\s*(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/i,
    );
    if (inline) {
      const date = parsePdfDate(inline[1], fallbackYear);
      if (date) return date;
    }
    for (const candidate of items.slice(index + 1, index + 14)) {
      const date = parsePdfDate(candidate.trim(), fallbackYear);
      if (date) return date;
    }
  }
  return undefined;
};

export async function readInterPdf(file: File, password?: string) {
  let task: ReturnType<typeof getDocument> | undefined;
  try {
    ensurePdfWorker();
    const bytes = await preparePdfBytes(file);
    task = getDocument({
      data: bytes,
      password: password || undefined,
    });
    const pdf = await task.promise;
    const all: string[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      try {
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        all.push(...content.items.map((item) => ("str" in item ? item.str : "")));
      } catch (error) {
        throw new Error(`Falha ao ler a página ${pageNumber}: ${(error as Error).message}`);
      }
    }
    const institution = detectInstitution(all, file.name);
    const fallbackYear = yearFrom(all, file.name);
    const dueDate = findPdfDueDate(all, fallbackYear);
    const year = dueDate ? Number(dueDate.slice(0, 4)) : fallbackYear;
    const rows = institution === "Inter"
      ? parseInterInvoiceItems(all)
      : institution === "BTG"
        ? parseBtgInvoiceItems(all, year)
        : parseXpInvoiceItems(all, year);
    if (!rows.length)
      throw new Error(`Nenhum lançamento foi encontrado na fatura ${institution}. Confira a senha e o formato do arquivo.`);
    const documentText = all.join(" ").replace(/\s+/g, " ");
    const holder = all.find((item) => /(?:OLCINO|MARIANA|CAMILL)/i.test(fold(item)));
    const cardNumbers = [...new Set(all.flatMap((item) => [
      ...(item.match(/\d{4}\*{2,}\d{4}|\*{4}\s*\d{4}/g) || []),
      ...(item.match(/FINAL\s+\d{4}/gi) || []),
    ]))];
    return { rows, dueDate, documentText, holder: holder?.trim(), cardNumbers, institution };
  } catch (error) {
    const detail = (error as Error).message || "";
    const name = (error as { name?: string }).name || "Erro";
    if (name === "PasswordException") throw new Error("A senha do PDF está ausente ou incorreta.");
    if (/Invalid Root reference/i.test(detail))
      throw new Error("O PDF está danificado ou foi exportado de forma incompleta. Baixe novamente pelo aplicativo do banco.");
    if (/undefined is not a function/i.test(detail))
      throw new Error("O navegador não conseguiu iniciar o leitor de PDF. Feche e reabra o aplicativo para carregar o leitor atualizado.");
    throw error;
  } finally {
    if (task) await task.destroy().catch(() => undefined);
  }
}
