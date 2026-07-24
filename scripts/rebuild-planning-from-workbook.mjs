import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import * as XLSX from "xlsx";

XLSX.set_fs(fs);

const [workbookPath, databasePath, mode = "--dry-run"] = process.argv.slice(2);
if (!workbookPath || !databasePath || !["--dry-run", "--apply"].includes(mode)) {
  console.error("Uso: node scripts/rebuild-planning-from-workbook.mjs <planilha.xlsx> <CasaEmOrdem-familia.json> [--dry-run|--apply]");
  process.exit(2);
}

const importedAt = new Date().toISOString();
const importedMonth = importedAt.slice(0, 7);
const fileName = path.basename(workbookPath);
const normalize = (value) => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR");
const slug = (value) => normalize(value).replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const amount = (value) => Math.round((Math.abs(Number(value) || 0) + Number.EPSILON) * 100) / 100;
const audit = (id) => ({ id, createdAt: importedAt, updatedAt: importedAt, updatedBy: "Ambos", version: 1 });
const source = (line, originalName) => ({ file: fileName, sheet: "Planejamento", row: line, importedAt, originalName });

function readRows() {
  const sheet = XLSX.readFile(workbookPath).Sheets.Planejamento;
  if (!sheet) throw new Error("A aba Planejamento não foi encontrada.");
  const values = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true });
  const headerIndex = values.findIndex((row) => row.some((cell) => normalize(cell) === "classificacao"));
  if (headerIndex < 0) throw new Error("Cabeçalho Classificação não encontrado.");
  const headers = values[headerIndex];
  const index = new Map(headers.map((header, position) => [normalize(header), position]));
  const get = (row, header) => row[index.get(normalize(header))];
  return values.slice(headerIndex + 1).map((row, offset) => ({
    line: headerIndex + offset + 2,
    classification: String(get(row, "Classificação") || "").trim(),
    frequency: String(get(row, "Frequência") || "").trim(),
    channel: String(get(row, "Canal") || "").trim(),
    category: String(get(row, "Categoria") || "").trim(),
    subcategory: String(get(row, "Conta / objetivo") || "").trim(),
    value: get(row, "Valor atual / observado"),
    dueDay: Number(get(row, "Dia vencimento")) || undefined,
    dueMonth: Number(get(row, "Periodo")) || undefined,
    status: String(get(row, "Status") || "").trim(),
  })).filter((row) => row.classification && row.category);
}

function categoryNature(name) {
  const key = normalize(name);
  return key === "receita" ? "income" : key === "meta" ? "goal" : "expense";
}

function accountForChannel(accounts, channel) {
  const key = normalize(channel);
  const pick = (predicate) => accounts.find(predicate)?.id;
  if (key.includes("investimento")) return pick((item) => item.kind === "investment");
  if (key.includes("conta btg")) return pick((item) => item.kind === "checking" && normalize(item.name).includes("btg"));
  if (key.includes("inter recorrente")) return pick((item) => item.kind === "card" && normalize(item.functionalName).includes("recorrente"));
  if (key.includes("cartao mari")) return pick((item) => item.kind === "card" && normalize(item.functionalName).includes("mari"));
  if (key.includes("cartao olcino")) return pick((item) => item.kind === "card" && normalize(item.functionalName).includes("olcino"));
  if (key.includes("cartao btg")) return pick((item) => item.kind === "card" && normalize(item.name).includes("btg"));
  return undefined;
}

function annualDue(row) {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const currentDay = now.getDate();
  const month = row.dueMonth || 12;
  const day = row.dueDay || 1;
  let year = currentYear;
  if (month < currentMonth || (month === currentMonth && day <= currentDay)) year += 1;
  const dueDate = `${year}-${String(month).padStart(2, "0")}-${String(Math.min(day, new Date(year, month, 0).getDate())).padStart(2, "0")}`;
  const due = new Date(`${dueDate}T12:00:00`);
  const months = Math.max(1, (due.getFullYear() - currentYear) * 12 + due.getMonth() - now.getMonth());
  return { dueDate, months, assumedDate: !row.dueDay || !row.dueMonth };
}

function rebuild(data, rows) {
  const report = { categories: 0, payments: 0, monthlyBudgets: 0, provisions: 0, goals: 0, pendingReview: [], annualProvisionTotal: 0, monthlyProvisionTotal: 0 };
  const categories = new Map();
  for (const row of rows) {
    const key = normalize(row.category);
    if (!categories.has(key)) categories.set(key, { ...audit(`category:${slug(row.category)}`), name: row.category, nature: categoryNature(row.category), subcategories: [] });
    const category = categories.get(key);
    if (row.subcategory && !category.subcategories.some((item) => normalize(item) === normalize(row.subcategory))) category.subcategories.push(row.subcategory);
  }
  data.categories = [...categories.values()];
  report.categories = data.categories.length;
  const categoryId = (name) => categories.get(normalize(name))?.id;
  const byCategorySubcategory = new Map();
  const addBudget = (row, value) => {
    const key = `${normalize(row.category)}\u0000${normalize(row.subcategory || "Sem subcategoria")}`;
    const previous = byCategorySubcategory.get(key) || { row, amount: 0 };
    previous.amount += amount(value);
    byCategorySubcategory.set(key, previous);
  };
  const provisions = [];
  const payments = [];
  const goalRows = [];
  for (const row of rows) {
    const classification = normalize(row.classification);
    const frequency = normalize(row.frequency);
    if (["gasto no cartao", "recorrente no cartao"].includes(classification)) addBudget(row, row.value);
    if (classification === "pagamento") {
      const isAnnual = frequency === "anual";
      const due = isAnnual ? annualDue(row) : { dueDate: `${importedMonth}-${String(row.dueDay || 1).padStart(2, "0")}`, months: 0, assumedDate: !row.dueDay };
      const accountId = accountForChannel(data.accounts, row.channel);
      payments.push({
        ...audit(`payment:${slug(row.category)}:${slug(row.subcategory)}:${slug(row.channel)}`),
        name: row.subcategory || row.category, kind: row.channel.toLocaleLowerCase("pt-BR").includes("cartao") ? "Recorrência no cartão" : "Manual",
        planned: amount(row.value), dueDate: due.dueDate, recurrence: isAnnual ? "yearly" : "monthly", tolerance: 0,
        accountId, categoryId: categoryId(row.category), subcategory: row.subcategory || undefined,
        status: "Prevista", needsReview: normalize(row.status) === "a validar" || due.assumedDate || !accountId,
        channel: row.channel, frequency: row.frequency, source: source(row.line, row.subcategory),
      });
      report.payments += 1;
      if (!isAnnual) addBudget(row, row.value);
      if (isAnnual) {
        const provisionAmount = Math.round((amount(row.value) / due.months + Number.EPSILON) * 100) / 100;
        provisions.push({ row, amount: provisionAmount, reason: `Provisão para ${row.subcategory || row.category}`, months: due.months });
        report.annualProvisionTotal += provisionAmount;
      }
      if (normalize(row.status) === "a validar" || due.assumedDate || !accountId) report.pendingReview.push({ line: row.line, name: row.subcategory || row.category, reason: !accountId ? "Conta não identificada" : due.assumedDate ? "Vencimento incompleto" : "A validar" });
    }
    if (classification === "provisao de conta mensal") provisions.push({ row, amount: amount(row.value), reason: row.subcategory || row.category });
    if (classification === "investimento") goalRows.push(row);
  }
  data.obligations = payments;
  // As categorias foram recriadas do zero; regras antigas poderiam apontar
  // para categorias removidas e não devem ser reaplicadas.
  data.rules = [];
  data.budgets = [...byCategorySubcategory.values()].map(({ row, amount: total }) => ({
    ...audit(`budget:${slug(row.category)}:${slug(row.subcategory || "sem-subcategoria")}`), month: "", kind: "budget", reason: row.subcategory || row.category,
    amount: Math.round((total + Number.EPSILON) * 100) / 100, categoryId: categoryId(row.category), subcategory: row.subcategory || undefined,
    accountId: accountForChannel(data.accounts, row.channel), source: source(row.line, row.subcategory),
  }));
  report.monthlyBudgets = data.budgets.length;
  data.budgets.push(...provisions.map((item) => ({
    ...audit(`provision:${slug(item.row.category)}:${slug(item.row.subcategory || item.reason)}`), month: "", kind: "provision", reason: item.reason,
    amount: item.amount, categoryId: categoryId(item.row.category), subcategory: item.row.subcategory || undefined,
    accountId: accountForChannel(data.accounts, item.row.channel), source: source(item.row.line, item.row.subcategory),
    needsReview: normalize(item.row.status) === "a validar",
  })));
  report.provisions = provisions.length;
  report.monthlyProvisionTotal = Math.round((provisions.reduce((sum, item) => sum + item.amount, 0) + Number.EPSILON) * 100) / 100;
  data.goals = goalRows.map((row, index) => ({
    ...audit(`goal:${slug(row.category)}:${slug(row.subcategory)}`), name: row.subcategory || row.category, kind: "desire", target: amount(row.value) * 12,
    minimum: amount(row.value), startDate: "", deadline: "", categoryId: categoryId(row.category), subcategory: row.subcategory || undefined,
    priority: index + 1, emergency: false, active: true, movements: [], source: source(row.line, row.subcategory),
  }));
  data.goals.push({ ...audit("goal:provision-pool"), name: "Caixa unificado de provisões", kind: "provision", provisionPool: true, target: report.monthlyProvisionTotal, minimum: 0, startDate: "", deadline: "", priority: 0, emergency: false, active: true, movements: [] });
  report.goals = goalRows.length;
  return report;
}

const rows = readRows();
const data = JSON.parse(fs.readFileSync(databasePath, "utf8"));
const report = rebuild(data, rows);
console.log(JSON.stringify(report, null, 2));
if (mode === "--apply") {
  const backup = `${databasePath}.before-workbook-rebuild-${importedAt.replace(/[:.]/g, "-")}.json`;
  fs.copyFileSync(databasePath, backup);
  data.lastSavedAt = importedAt;
  fs.writeFileSync(databasePath, JSON.stringify(data), "utf8");
  console.error(`Reconstrução aplicada. Backup: ${backup}`);
}
