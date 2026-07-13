import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = workerUrl;

export interface InterPdfRow {
  date: string;
  description: string;
  amount: number;
  installment?: number;
  installments?: number;
  card?: string;
}

const months: Record<string, string> = { jan:"01",fev:"02",mar:"03",abr:"04",mai:"05",jun:"06",jul:"07",ago:"08",set:"09",out:"10",nov:"11",dez:"12" };
const datePattern = /(\d{1,2})\s+de\s+(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\.\s+(\d{4})/i;
const moneyPattern = /([+-]?)\s*R\$\s*([\d.]+,\d{2})/;

export function parseInterInvoiceItems(items: string[]): InterPdfRow[] {
  const rows: InterPdfRow[] = [];
  let active = false, card = "", currentDate = "";
  let description: string[] = [];
  const flush = (valueText: string) => {
    if (!active || !currentDate || !description.length) return;
    const value = valueText.match(moneyPattern);
    if (!value) return;
    const text = description.filter(part => part !== "-").join(" ").replace(/\s+/g, " ").trim();
    if (!text || /^Total CART/i.test(text)) return;
    const parcel = text.match(/\(Parcela\s+(\d{1,2})\s+de\s+(\d{1,2})\)/i);
    const clean = text.replace(/\s*\(Parcela\s+\d{1,2}\s+de\s+\d{1,2}\)\s*/i, " ").trim();
    rows.push({
      date: currentDate,
      description: clean,
      amount: (value[1] === "+" ? -1 : 1) * Number(value[2].replace(/\./g, "").replace(",", ".")),
      installment: parcel ? Number(parcel[1]) : undefined,
      installments: parcel ? Number(parcel[2]) : undefined,
      card,
    });
  };
  for (let index = 0; index < items.length; index++) {
    const item = items[index].trim();
    if (!item) continue;
    if (/^Despesas da fatura$/i.test(item)) { active = true; continue; }
    if (/^Pr[oó]xima fatura$/i.test(item) || /compras parceladas realizadas/i.test(item)) { active = false; break; }
    if (/^CART(?:ÃO|AO)$/i.test(item)) {
      card = items.slice(index + 1, index + 5).map(value => value.trim()).find(value => /\d{4}\*{2,}\d{4}/.test(value)) || "";
      currentDate = ""; description = []; continue;
    }
    const cardMatch = item.match(/^CART(?:ÃO|AO)\s+(.+)/i);
    if (cardMatch) { card = cardMatch[1]; currentDate = ""; description = []; continue; }
    if (/^Total CART/i.test(item)) { currentDate = ""; description = []; continue; }
    const date = item.match(datePattern);
    if (date && active) {
      currentDate = `${date[3]}-${months[date[2].toLowerCase()]}-${date[1].padStart(2, "0")}`;
      description = []; continue;
    }
    if (active && currentDate && moneyPattern.test(item)) { flush(item); currentDate = ""; description = []; continue; }
    if (active && currentDate) description.push(item);
  }
  return rows;
}

const preparePdfBytes = async (file: File) => {
  const original = new Uint8Array(await file.arrayBuffer());
  const signature = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
  let start = -1;
  outer: for (let i = 0; i <= original.length - signature.length; i++) {
    for (let j = 0; j < signature.length; j++) if (original[i + j] !== signature[j]) continue outer;
    start = i; break;
  }
  if (start < 0) throw new Error("O arquivo não contém um PDF válido.");
  // Faturas do Inter podem trazer um bloco binário antes do cabeçalho. Removê-lo
  // corrige os offsets xref sem modificar o arquivo original.
  return start ? original.slice(start) : original;
};

export async function readInterPdf(file: File, password?: string) {
  const task = getDocument({ data: await preparePdfBytes(file), password: password || undefined });
  try {
    const pdf = await task.promise;
    const all: string[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      all.push(...content.items.map(item => ("str" in item ? item.str : "")));
    }
    const rows = parseInterInvoiceItems(all);
    const label = all.findIndex(item => /Data de Vencimento/i.test(item));
    const dueText = all.slice(Math.max(0, label), label + 8).find(item => /^\d{2}\/\d{2}\/\d{4}$/.test(item.trim())) ?? all.find(item => /^\d{2}\/\d{2}\/\d{4}$/.test(item.trim()));
    const due = dueText?.trim().match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (!rows.length) throw new Error("Nenhum lançamento foi encontrado. Confira a senha e se o PDF é uma fatura Inter compatível.");
    const documentText = all.join(" ").replace(/\s+/g, " ");
    const holder = all.find(item => /^[A-ZÀ-Ú ]{12,}$/.test(item.trim()) && /(?:OLCINO|MARIANA|CAMILL)/i.test(item));
    const cardNumbers = [...new Set(all.flatMap(item => item.match(/\d{4}\*{2,}\d{4}/g) || []))];
    return { rows, dueDate: due ? `${due[3]}-${due[2]}-${due[1]}` : undefined, documentText, holder: holder?.trim(), cardNumbers };
  } catch (error) {
    const detail = (error as Error).message || "";
    if ((error as { name?: string }).name === "PasswordException") throw new Error("A senha do PDF está ausente ou incorreta.");
    if (/Invalid Root reference/i.test(detail)) throw new Error("O PDF está danificado ou foi exportado de forma incompleta. Baixe novamente pelo aplicativo do banco.");
    throw error;
  } finally {
    await task.destroy();
  }
}
