import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import * as XLSX from "xlsx";

XLSX.set_fs(fs);

const [workbookPath, databasePath, mode = "--dry-run"] = process.argv.slice(2);
if (!workbookPath || !databasePath || !["--dry-run", "--apply"].includes(mode)) {
  console.error("Uso: node scripts/import-planning-workbook.mjs <planilha.xlsx> <CasaEmOrdem-familia.json> [--dry-run|--apply]");
  process.exit(2);
}

const now = new Date().toISOString();
const fileName = path.basename(workbookPath);
const sheetName = "Orcamento_Mestre";
const normalize = (value) => String(value ?? "")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR");
const slug = (value) => normalize(value).replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const money = (value) => Math.round((Math.abs(Number(value) || 0) + Number.EPSILON) * 100) / 100;
const audit = (id) => ({ id, createdAt: now, updatedAt: now, updatedBy: "Ambos", version: 1 });
const source = (row, originalName) => ({
  file: fileName, sheet: sheetName, row, importedAt: now, originalName,
});
const classificationGoal = "orcamento de meta mensal";
const classificationProvision = "provisao de conta mensal eventual";

function rowsFromWorkbook() {
  const workbook = XLSX.readFile(workbookPath, { cellDates: false });
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error(`A aba ${sheetName} não foi encontrada.`);
  const values = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
  const headerRowIndex = values.findIndex((row) => row.some((cell) => normalize(cell) === "classificacao"));
  if (headerRowIndex < 0) throw new Error("A linha de cabeçalhos não foi encontrada.");
  const headers = values[headerRowIndex];
  const index = new Map(headers.map((header, column) => [normalize(header), column]));
  const get = (row, header) => row[index.get(normalize(header))];
  const required = ["Classificação", "Categoria", "Conta / objetivo", "Titular", "Canal", "Frequência", "Valor atual / observado", "Dia vencimento", "Periodo", "Status", "Ação"];
  for (const header of required) if (!index.has(normalize(header))) throw new Error(`Coluna ausente: ${header}`);
  return values.slice(headerRowIndex + 1).map((row, offset) => ({
    line: headerRowIndex + offset + 2,
    classification: String(get(row, "Classificação") || "").trim(),
    category: String(get(row, "Categoria") || "").trim(),
    name: String(get(row, "Conta / objetivo") || "").trim(),
    holder: String(get(row, "Titular") || "").trim(),
    channel: String(get(row, "Canal") || "").trim(),
    frequency: String(get(row, "Frequência") || "").trim(),
    value: get(row, "Valor atual / observado"),
    dueDay: get(row, "Dia vencimento"),
    period: String(get(row, "Periodo") || "").trim(),
    status: String(get(row, "Status") || "").trim(),
    action: String(get(row, "Ação") || "").trim(),
  })).filter((row) => row.classification || row.category || row.name);
}

function categoryNature(name) {
  if (normalize(name) === "receita") return "income";
  if (normalize(name) === "meta") return "goal";
  return "expense";
}

function canonicalName(row) {
  if (normalize(row.category) === "educacao" && !row.name) return "Educação — meta a definir";
  if (normalize(row.name).startsWith("mariana") && normalize(row.category) === "compras pessoais") return "Compras pessoais — Mariana";
  if (normalize(row.name).startsWith("olcino") && normalize(row.category) === "compras pessoais") return "Compras pessoais — José";
  return row.name.replace(/^Corola\b/i, "Corolla");
}

function importPlanning(data, rows) {
  const report = {
    mode,
    categories: { created: [], reused: [] },
    goals: { created: [], updated: [] },
    provisions: { created: [], updated: [] },
    ignored: [], pendingReview: [], conflicts: [], totals: { goals: 0, provisions: 0 },
  };
  const unchanged = ["accounts", "transactions", "obligations", "rules", "imports", "tasks", "receipts", "shoppingList", "chores"]
    .map((key) => [key, JSON.stringify(data[key] ?? [])]);
  const categories = new Map(data.categories.map((item) => [normalize(item.name), item]));

  for (const categoryName of [...new Set(rows.map((row) => row.category).filter(Boolean).map((name) => name.trim()))]) {
    const key = normalize(categoryName);
    const existing = categories.get(key);
    if (existing) {
      existing.name = categoryName;
      existing.importMetadata = source(0, categoryName);
      existing.updatedAt = now;
      existing.version = (existing.version || 0) + 1;
      report.categories.reused.push(categoryName);
    } else {
      const item = { ...audit(`category:${slug(categoryName)}`), name: categoryName, subcategories: [], nature: categoryNature(categoryName), importMetadata: source(0, categoryName) };
      data.categories.push(item);
      categories.set(key, item);
      report.categories.created.push(categoryName);
    }
  }

  for (const row of rows) {
    const classification = normalize(row.classification);
    if (classification !== classificationGoal && classification !== classificationProvision) {
      report.ignored.push({ line: row.line, classification: row.classification, reason: "Fora do escopo" });
      continue;
    }
    const name = canonicalName(row);
    const category = categories.get(normalize(row.category));
    if (!category) {
      report.conflicts.push({ line: row.line, reason: `Categoria não encontrada: ${row.category}` });
      continue;
    }
    const needsReview = normalize(row.status) === "a validar";
    if (classification === classificationGoal) {
      const id = `goal:${slug(row.category)}:${slug(name)}:${slug(row.holder || "casal")}`;
      const value = normalize(name) === "multas de transito meta zero" ? 0 : money(row.value);
      const existing = data.goals.find((item) => item.id === id);
      const item = existing || { ...audit(id), movements: [] };
      Object.assign(item, {
        name, kind: "desire", target: value, referenceValue: normalize(name) === "multas de transito meta zero" ? money(row.value) : undefined,
        startDate: "", deadline: "", categoryId: category.id, subcategory: undefined,
        holder: row.holder, channel: row.channel, frequency: row.frequency, dueDay: row.dueDay ?? undefined,
        period: row.period || undefined, status: row.status, needsReview: needsReview || normalize(name) === "multas de transito meta zero",
        action: row.action || undefined, importMetadata: source(row.line, row.name || name),
        priority: existing?.priority ?? data.goals.length + 1, minimum: 0, emergency: false, active: true,
        updatedAt: now, updatedBy: "Ambos", version: (existing?.version || 0) + 1,
      });
      if (!existing) data.goals.push(item);
      report.goals[existing ? "updated" : "created"].push(name);
      report.totals.goals += value;
      if (item.needsReview) report.pendingReview.push({ line: row.line, type: "meta", name });
    } else {
      const id = `provision:${slug(row.category)}:${slug(name)}:${slug(row.holder || "casal")}`;
      const existing = data.budgets.find((item) => item.id === id);
      const item = existing || { ...audit(id) };
      Object.assign(item, {
        month: "", startMonth: undefined, endMonth: undefined, kind: "provision", reason: name,
        amount: money(row.value), categoryId: category.id, subcategory: undefined,
        holder: row.holder, channel: row.channel, frequency: row.frequency, dueDay: row.dueDay ?? undefined,
        period: row.period || undefined, status: row.status, needsReview,
        action: row.action || undefined, importMetadata: source(row.line, row.name),
        updatedAt: now, updatedBy: "Ambos", version: (existing?.version || 0) + 1,
      });
      if (!existing) data.budgets.push(item);
      report.provisions[existing ? "updated" : "created"].push(name);
      report.totals.provisions += item.amount;
      if (needsReview) report.pendingReview.push({ line: row.line, type: "provisão", name });
    }
  }

  const monthlyProvisionTotal = Math.round((report.totals.provisions + Number.EPSILON) * 100) / 100;
  let pool = data.goals.find((item) => item.id === "goal:provision-pool" || item.provisionPool);
  if (!pool) {
    pool = { ...audit("goal:provision-pool"), name: "Caixa unificado de provisões", kind: "provision", provisionPool: true, movements: [], priority: 0, minimum: 0, emergency: false, active: true };
    data.goals.push(pool);
  }
  Object.assign(pool, { target: monthlyProvisionTotal, startDate: "", deadline: "", updatedAt: now, updatedBy: "Ambos", version: (pool.version || 0) + 1, importMetadata: source(0, "Provisões importadas") });
  report.totals.provisions = monthlyProvisionTotal;

  for (const [key, before] of unchanged) if (before !== JSON.stringify(data[key] ?? [])) throw new Error(`Proteção de escopo: ${key} foi alterado.`);
  return report;
}

const rows = rowsFromWorkbook();
const data = JSON.parse(fs.readFileSync(databasePath, "utf8"));
const report = importPlanning(data, rows);
console.log(JSON.stringify(report, null, 2));
if (mode === "--apply") {
  const backup = `${databasePath}.before-planning-import-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  fs.copyFileSync(databasePath, backup);
  data.lastSavedAt = now;
  fs.writeFileSync(databasePath, JSON.stringify(data), "utf8");
  console.error(`Importação aplicada. Backup: ${backup}`);
}
