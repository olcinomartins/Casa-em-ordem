import { useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  Upload,
  Tags,
  WalletCards,
  ReceiptText,
  Target,
  CheckSquare,
  Settings,
  Cloud,
  CloudOff,
  Plus,
  Download,
  Save,
  Trash2,
  CheckCircle2,
  TrendingUp,
} from "lucide-react";
import {
  Account,
  Budget,
  CashView,
  FamilyData,
  Member,
  Obligation,
  Task,
  Transaction,
  audit,
  money,
  monthOf,
  normalize,
  now,
  uid,
} from "./domain";
import {
  loadLocal,
  saveLocal,
  exportJson,
  restoreJson,
  download,
} from "./storage";
import {
  getCloudLocation,
  isConfigured,
  loadCloud,
  saveCloud,
  setCloudLocation,
  signIn,
  signOut,
} from "./onedrive";
import { createSeed } from "./seed";
import {
  budgetApplies,
  budgetValue,
  personalBalance,
  realized,
  recurringCheck,
  upsertRule,
} from "./finance";
import { previewFile, Preview } from "./importer";
import { tasksToIcs } from "./ics";

type Page =
  | "painel"
  | "importar"
  | "transacoes"
  | "orcamento"
  | "pagamentos"
  | "metas"
  | "tarefas"
  | "analises"
  | "config";
const nav: [Page, string, typeof BarChart3][] = [
  ["painel", "Painel", BarChart3],
  ["importar", "Importar", Upload],
  ["transacoes", "Transações", Tags],
  ["orcamento", "Orçamentos", WalletCards],
  ["pagamentos", "Pagamentos", ReceiptText],
  ["metas", "Metas", Target],
  ["tarefas", "Tarefas", CheckSquare],
  ["analises", "Análises", TrendingUp],
  ["config", "Configurações", Settings],
];
const currentMonth = () => new Date().toISOString().slice(0, 7);
const dateOnly = (d: Date) => d.toISOString().slice(0, 10);

export default function App() {
  const [data, setData] = useState<FamilyData>();
  const [authenticated, setAuthenticated] = useState(false);
  const [authError, setAuthError] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [page, setPage] = useState<Page>("painel");
  const [month, setMonth] = useState(currentMonth());
  const [view, setView] = useState<CashView>("cash");
  const [message, setMessage] = useState("");
  const [cloud, setCloud] = useState<"local" | "syncing" | "connected">(
    "local",
  );
  useEffect(() => {
    if (authenticated && data) saveLocal(data);
  }, [authenticated, data]);
  const login = async () => {
    setAuthBusy(true);
    setAuthError("");
    try {
      const account = await signIn();
      const email = account.username.toLowerCase();
      const allowed = String(import.meta.env.VITE_ALLOWED_EMAILS || "")
        .toLowerCase()
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      if (!allowed.includes(email)) {
        await signOut();
        throw new Error(`O e-mail ${email} não está autorizado.`);
      }
      const remote = await loadCloud();
      setData(remote ?? (await loadLocal()));
      setAuthenticated(true);
      setCloud("connected");
    } catch (error) {
      setAuthError((error as Error).message);
    } finally {
      setAuthBusy(false);
    }
  };
  const mutate = (fn: (draft: FamilyData) => void) =>
    setData((old) => {
      if (!old) return old;
      const draft = structuredClone(old);
      fn(draft);
      draft.lastSavedAt = now();
      return draft;
    });
  const sync = async () => {
    if (!data) return;
    try {
      setCloud("syncing");
      await saveCloud(data);
      setCloud("connected");
      setMessage("Base salva no OneDrive.");
    } catch (e) {
      setCloud("local");
      setMessage((e as Error).message);
    }
  };
  const configureShared = () => {
    const current = getCloudLocation();
    const driveId = prompt(
      "ID do drive compartilhado:",
      current?.driveId || "",
    );
    if (!driveId) return;
    const itemId = prompt(
      "ID do arquivo compartilhado:",
      current?.itemId || "",
    );
    if (!itemId) return;
    setCloudLocation({ driveId, itemId });
    setMessage("Base compartilhada configurada. Conecte novamente.");
  };
  const connect = async () => {
    try {
      setCloud("syncing");
      await signIn();
      const remote = await loadCloud();
      if (remote) setData(remote);
      else if (data) await saveCloud(data);
      setCloud("connected");
      setMessage("OneDrive conectado.");
    } catch (e) {
      setCloud("local");
      setMessage((e as Error).message);
    }
  };
  if (!authenticated)
    return (
      <div className="login-page">
        <section className="login-card">
          <div className="login-mark">⌂</div>
          <p className="eyebrow">FINANÇAS DA FAMÍLIA</p>
          <h1>Casa em Ordem</h1>
          <p>Um espaço privado para Olcino e Mariana planejarem juntos.</p>
          <button
            className="primary login-button"
            disabled={authBusy}
            onClick={login}
          >
            <Cloud size={19} />
            {authBusy ? "Conectando…" : "Entrar com a Microsoft"}
          </button>
          {authError && <div className="auth-error">{authError}</div>}
          <small>Somente os dois e-mails autorizados podem acessar.</small>
        </section>
      </div>
    );
  if (!data) return <div className="splash">Preparando a casa…</div>;
  return (
    <div className="app">
      <aside>
        <div className="brand">
          <span>⌂</span>
          <div>
            Casa em Ordem<small>Finanças da família</small>
          </div>
        </div>
        <nav>
          {nav.map(([id, label, Icon]) => (
            <button
              key={id}
              className={page === id ? "active" : ""}
              onClick={() => setPage(id)}
            >
              <Icon size={19} />
              {label}
            </button>
          ))}
        </nav>
        <div className="aside-foot">
          <button onClick={isConfigured() ? connect : () => setPage("config")}>
            {cloud === "connected" ? (
              <Cloud size={18} />
            ) : (
              <CloudOff size={18} />
            )}{" "}
            {cloud === "connected"
              ? "OneDrive conectado"
              : "Somente neste aparelho"}
          </button>
        </div>
      </aside>
      <main>
        <header>
          <div>
            <h1>{nav.find((n) => n[0] === page)?.[1]}</h1>
            <p>
              {data.household.name} · dinheiro compartilhado, decisões em
              conjunto
            </p>
          </div>
          <div className="period">
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
            {page === "config" && (
              <button onClick={configureShared}>Base compartilhada</button>
            )}
            <button className="primary" onClick={sync}>
              <Save size={17} /> Salvar
            </button>
          </div>
        </header>
        {message && (
          <div className="toast" onClick={() => setMessage("")}>
            {message}
          </div>
        )}
        {page === "painel" && (
          <Dashboard data={data} month={month} view={view} setView={setView} />
        )}{" "}
        {page === "importar" && (
          <ImportPage data={data} mutate={mutate} setMessage={setMessage} />
        )}{" "}
        {page === "transacoes" && (
          <Transactions data={data} month={month} mutate={mutate} />
        )}{" "}
        {page === "orcamento" && (
          <Budgets
            data={data}
            month={month}
            view={view}
            setView={setView}
            mutate={mutate}
          />
        )}{" "}
        {page === "pagamentos" && <Payments data={data} mutate={mutate} />}{" "}
        {page === "metas" && <Goals data={data} mutate={mutate} />}{" "}
        {page === "tarefas" && <Tasks data={data} mutate={mutate} />}{" "}
        {page === "analises" && <Analytics data={data} />}{" "}
        {page === "config" && (
          <Config
            data={data}
            setData={setData}
            mutate={mutate}
            connect={connect}
            setMessage={setMessage}
          />
        )}
      </main>
    </div>
  );
}

function ViewSwitch({
  view,
  setView,
}: {
  view: CashView;
  setView: (v: CashView) => void;
}) {
  return (
    <div className="segmented">
      <button
        className={view === "cash" ? "on" : ""}
        onClick={() => setView("cash")}
      >
        Fluxo
      </button>
      <button
        className={view === "accrual" ? "on" : ""}
        onClick={() => setView("accrual")}
      >
        Compra integral
      </button>
      <button
        className={view === "compare" ? "on" : ""}
        onClick={() => setView("compare")}
      >
        Comparar
      </button>
    </div>
  );
}
function Dashboard({
  data,
  month,
  view,
  setView,
}: {
  data: FamilyData;
  month: string;
  view: CashView;
  setView: (v: CashView) => void;
}) {
  const calc = (v: "cash" | "accrual") =>
    data.transactions.reduce((s, t) => s + realized(t, month, v), 0);
  const cash = calc("cash"),
    acc = calc("accrual");
  const expenses = (v: "cash" | "accrual") =>
    data.transactions.reduce((s, t) => {
      const x = realized(t, month, v);
      return s + (x > 0 ? x : 0);
    }, 0);
  const income = data.transactions
    .filter(
      (t) =>
        !t.transfer &&
        t.amount < 0 &&
        monthOf(t.paymentDate || t.date) === month,
    )
    .reduce((s, t) => s + Math.abs(t.amount), 0);
  const pending = data.transactions.filter(
    (t) => t.classification !== "confirmed",
  ).length;
  const due = data.obligations.filter(
    (o) =>
      !["Paga", "Confirmada", "Dispensada"].includes(o.status) &&
      o.dueDate <= dateOnly(new Date(Date.now() + 14 * 864e5)),
  ).length;
  return (
    <>
      <div className="toolbar">
        <ViewSwitch view={view} setView={setView} />
      </div>
      <section className="cards">
        <Card
          label="Renda familiar"
          value={money(income)}
          hint="Entradas líquidas no mês"
        />
        <Card
          label="Despesas no fluxo"
          value={money(expenses("cash"))}
          hint={
            view === "compare"
              ? `Integral: ${money(expenses("accrual"))}`
              : "Conforme pagamentos"
          }
        />
        <Card
          label="Resultado de caixa"
          value={money(income - expenses("cash"))}
          hint="Antes dos aportes"
          tone={income - expenses("cash") < 0 ? "bad" : "good"}
        />
        <Card
          label="Para revisar"
          value={String(pending + due)}
          hint={`${pending} lançamentos · ${due} contas`}
        />
      </section>
      <section className="grid two">
        <div className="panel">
          <h2>Orçado × realizado</h2>
          <BudgetBars
            data={data}
            month={month}
            view={view === "accrual" ? "accrual" : "cash"}
          />
        </div>
        <div className="panel">
          <h2>Orçamentos pessoais acumulados</h2>
          {(["Olcino", "Mari"] as const).map((m) => (
            <div className="personal" key={m}>
              <div>
                <b>{m}</b>
                <small>Saldo até {month}</small>
              </div>
              <strong
                className={
                  personalBalance(data, m, month) >= 0 ? "positive" : "negative"
                }
              >
                {money(personalBalance(data, m, month))}
              </strong>
            </div>
          ))}
        </div>
      </section>
      <section className="grid two">
        <div className="panel">
          <h2>Próximos compromissos</h2>
          {data.obligations
            .filter(
              (o) => !["Paga", "Confirmada", "Dispensada"].includes(o.status),
            )
            .slice(0, 5)
            .map((o) => (
              <Row key={o.id} a={o.name} b={o.dueDate} c={money(o.planned)} />
            )) || <Empty />}
        </div>
        <div className="panel">
          <h2>Metas prioritárias</h2>
          {data.goals
            .filter((g) => g.active)
            .sort((a, b) => a.priority - b.priority)
            .slice(0, 4)
            .map((g) => {
              const total = g.movements.reduce((s, x) => s + x.amount, 0);
              return (
                <div key={g.id} className="goal-mini">
                  <span>{g.name}</span>
                  <b>
                    {money(total)} / {money(g.target)}
                  </b>
                  <progress value={total} max={g.target || 1} />
                </div>
              );
            })}
        </div>
      </section>
      {view === "compare" && (
        <p className="note">
          Resultado reconhecido: fluxo {money(cash)} · compra integral{" "}
          {money(acc)}. A visualização não altera os lançamentos.
        </p>
      )}
    </>
  );
}
function Card({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone?: string;
}) {
  return (
    <div className={`card ${tone || ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </div>
  );
}
function BudgetBars({
  data,
  month,
  view,
}: {
  data: FamilyData;
  month: string;
  view: "cash" | "accrual";
}) {
  const rows = data.categories
    .filter((c) => c.nature === "expense")
    .map((c) => {
      const planned = budgetValue(data, month, (b) => b.categoryId === c.id);
      const actual = data.transactions
        .filter((t) => t.categoryId === c.id)
        .reduce((s, t) => s + Math.abs(realized(t, month, view)), 0);
      return { name: c.name, planned, actual };
    })
    .filter((x) => x.planned || x.actual)
    .sort((a, b) => b.actual - a.actual)
    .slice(0, 8);
  return rows.length ? (
    <div className="bars">
      {rows.map((r) => (
        <div key={r.name}>
          <label>
            <span>{r.name}</span>
            <span>
              {money(r.actual)} / {money(r.planned)}
            </span>
          </label>
          <progress value={r.actual} max={r.planned || r.actual || 1} />
        </div>
      ))}
    </div>
  ) : (
    <Empty />
  );
}

function ImportPage({
  data,
  mutate,
  setMessage,
}: {
  data: FamilyData;
  mutate: (f: (d: FamilyData) => void) => void;
  setMessage: (s: string) => void;
}) {
  const [account, setAccount] = useState(data.accounts[0]?.id || "");
  const [operator, setOperator] = useState<Member>("Olcino");
  const [preview, setPreview] = useState<Preview>();
  const input = useRef<HTMLInputElement>(null);
  const choose = async (file?: File) => {
    if (!file || !account)
      return setMessage("Cadastre e selecione uma conta antes de importar.");
    try {
      setPreview(await previewFile(file, data, account, operator));
    } catch (e) {
      setMessage((e as Error).message);
    }
  };
  const confirm = () => {
    if (!preview) return;
    mutate((d) => {
      d.transactions.push(...preview.rows);
      d.imports.push({
        ...audit(operator),
        filename: preview.filename,
        hash: preview.hash,
        institution: preview.institution,
        count: preview.rows.length,
        duplicates: preview.duplicates,
      });
    });
    setMessage(`${preview.rows.length} lançamentos importados.`);
    setPreview(undefined);
  };
  return (
    <section className="panel">
      <h2>Importar extrato ou fatura</h2>
      <p className="muted">CSV, XLS ou XLSX · Inter, XP, BTG e Mercado Pago</p>
      <div className="form-row">
        <select value={account} onChange={(e) => setAccount(e.target.value)}>
          <option value="">Selecione a conta/cartão</option>
          {data.accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.institution} · {a.name}
            </option>
          ))}
        </select>
        <select
          value={operator}
          onChange={(e) => setOperator(e.target.value as Member)}
        >
          <option>Olcino</option>
          <option>Mari</option>
          <option>Ambos</option>
        </select>
        <input
          ref={input}
          type="file"
          accept=".csv,.xls,.xlsx,.xlsm"
          hidden
          onChange={(e) => choose(e.target.files?.[0])}
        />
        <button className="primary" onClick={() => input.current?.click()}>
          <Upload size={17} /> Escolher arquivo
        </button>
      </div>
      {preview && (
        <>
          <div className="summary">
            <b>{preview.filename}</b>
            <span>{preview.rows.length} novos</span>
            <span>{preview.duplicates} duplicados ignorados</span>
            <span>
              {
                preview.rows.filter((r) => r.classification === "suggested")
                  .length
              }{" "}
              sugestões
            </span>
          </div>
          <TransactionTable rows={preview.rows.slice(0, 100)} data={data} />
          <button className="primary end" onClick={confirm}>
            Confirmar importação
          </button>
        </>
      )}
    </section>
  );
}
function TransactionTable({
  rows,
  data,
}: {
  rows: Transaction[];
  data: FamilyData;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Data</th>
            <th>Lançamento</th>
            <th>Valor</th>
            <th>Categoria</th>
            <th>Situação</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id}>
              <td>{t.date}</td>
              <td>
                {t.description}
                <small>
                  {data.accounts.find((a) => a.id === t.accountId)?.name}
                </small>
              </td>
              <td>{money(t.amount)}</td>
              <td>
                {data.categories.find((c) => c.id === t.categoryId)?.name ||
                  "—"}
                <small>{t.subcategory}</small>
              </td>
              <td>
                <Badge
                  text={
                    t.classification === "confirmed"
                      ? "Confirmada"
                      : t.classification === "suggested"
                        ? "Sugestão"
                        : "Pendente"
                  }
                  kind={t.classification}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Transactions({
  data,
  month,
  mutate,
}: {
  data: FamilyData;
  month: string;
  mutate: (f: (d: FamilyData) => void) => void;
}) {
  const [filter, setFilter] = useState("all");
  const rows = data.transactions.filter(
    (t) =>
      monthOf(t.date) === month &&
      (filter === "all" || t.classification === filter),
  );
  const update = (id: string, patch: Partial<Transaction>, learn = false) =>
    mutate((d) => {
      const t = d.transactions.find((x) => x.id === id)!;
      Object.assign(t, patch, { updatedAt: now(), version: t.version + 1 });
      if (learn) upsertRule(d, t);
    });
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Revisão de lançamentos</h2>
          <p className="muted">
            Sugestões precisam de confirmação; classificações manuais sempre
            prevalecem.
          </p>
        </div>
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">Todos</option>
          <option value="pending">Pendentes</option>
          <option value="suggested">Sugeridos</option>
          <option value="confirmed">Confirmados</option>
        </select>
      </div>
      <div className="transaction-list">
        {rows.map((t) => (
          <div className="transaction-edit" key={t.id}>
            <div className="tx-main">
              <b>{t.description}</b>
              <small>
                {t.date} · {money(t.amount)}
              </small>
            </div>
            <select
              value={t.categoryId || ""}
              onChange={(e) => {
                const c = data.categories.find((x) => x.id === e.target.value);
                update(t.id, {
                  categoryId: e.target.value,
                  subcategory: c?.subcategories[0],
                  classification: "confirmed",
                });
              }}
            >
              <option value="">Categoria</option>
              {data.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <select
              value={t.subcategory || ""}
              onChange={(e) =>
                update(t.id, {
                  subcategory: e.target.value,
                  classification: "confirmed",
                })
              }
            >
              <option value="">Subcategoria</option>
              {data.categories
                .find((c) => c.id === t.categoryId)
                ?.subcategories.map((s) => (
                  <option key={s}>{s}</option>
                ))}
            </select>
            <select
              value={t.scope}
              onChange={(e) =>
                update(t.id, { scope: e.target.value as Transaction["scope"] })
              }
            >
              <option>Familiar</option>
              <option>Pessoal — Olcino</option>
              <option>Pessoal — Mari</option>
              <option>Transferência interna</option>
              <option>Fora do orçamento</option>
            </select>
            <button
              title="Confirmar e aprender"
              className="icon"
              onClick={() =>
                update(t.id, { classification: "confirmed" }, true)
              }
            >
              <CheckCircle2 />
            </button>
          </div>
        ))}
      </div>
      {!rows.length && <Empty />}
    </section>
  );
}

function Budgets({
  data,
  month,
  view,
  setView,
  mutate,
}: {
  data: FamilyData;
  month: string;
  view: CashView;
  setView: (v: CashView) => void;
  mutate: (f: (d: FamilyData) => void) => void;
}) {
  const [editing, setEditing] = useState<Budget>();
  const saveBudget = (form: FormData) => {
    const target = String(form.get("target"));
    mutate((draft) => {
      const existing =
        editing && draft.budgets.find((item) => item.id === editing.id);
      const item: Budget = existing || {
        ...audit(),
        month: String(form.get("startMonth")),
        amount: 0,
      };
      item.amount = Number(form.get("amount"));
      item.month = String(form.get("startMonth"));
      item.startMonth = String(form.get("startMonth"));
      item.endMonth = String(form.get("endMonth") || "") || undefined;
      item.categoryId = target.startsWith("category:")
        ? target.slice(9)
        : undefined;
      item.accountId = target.startsWith("account:")
        ? target.slice(8)
        : undefined;
      item.member = target.startsWith("member:")
        ? (target.slice(7) as "Olcino" | "Mari")
        : undefined;
      item.reason = String(form.get("reason") || "");
      item.updatedAt = now();
      item.version++;
      if (!existing) draft.budgets.push(item);
    });
    setEditing(undefined);
  };
  const remove = (id: string) =>
    mutate((draft) => {
      draft.budgets = draft.budgets.filter((item) => item.id !== id);
    });
  const label = (item: Budget) =>
    item.member
      ? `Pessoal — ${item.member}`
      : item.categoryId
        ? data.categories.find((c) => c.id === item.categoryId)?.name
        : data.accounts.find((a) => a.id === item.accountId)?.name ||
          "Orçamento";
  return (
    <>
      <div className="toolbar">
        <ViewSwitch view={view} setView={setView} />
      </div>
      <section className="grid two">
        <div className="panel">
          <h2>
            {editing ? "Editar orçamento" : "Novo orçamento com vigência"}
          </h2>
          <form
            className="budget-form"
            onSubmit={(event) => {
              event.preventDefault();
              saveBudget(new FormData(event.currentTarget));
              event.currentTarget.reset();
            }}
          >
            <select
              name="target"
              required
              defaultValue={
                editing?.member
                  ? `member:${editing.member}`
                  : editing?.categoryId
                    ? `category:${editing.categoryId}`
                    : editing?.accountId
                      ? `account:${editing.accountId}`
                      : ""
              }
            >
              <option value="">Categoria, conta ou pessoa</option>
              <optgroup label="Orçamentos pessoais">
                <option value="member:Olcino">Pessoal — Olcino</option>
                <option value="member:Mari">Pessoal — Mari</option>
              </optgroup>
              <optgroup label="Categorias">
                {data.categories
                  .filter((c) => c.nature === "expense")
                  .map((c) => (
                    <option key={c.id} value={`category:${c.id}`}>
                      {c.name}
                    </option>
                  ))}
              </optgroup>
              <optgroup label="Contas e cartões">
                {data.accounts.map((a) => (
                  <option key={a.id} value={`account:${a.id}`}>
                    {a.name}
                  </option>
                ))}
              </optgroup>
            </select>
            <input
              name="amount"
              required
              type="number"
              min="0"
              step="0.01"
              placeholder="Valor mensal"
              defaultValue={editing?.amount}
            />
            <label>
              Início
              <input
                name="startMonth"
                required
                type="month"
                defaultValue={editing?.startMonth || editing?.month || month}
              />
            </label>
            <label>
              Fim opcional
              <input
                name="endMonth"
                type="month"
                defaultValue={editing?.endMonth || ""}
              />
            </label>
            <input
              name="reason"
              placeholder="Observação"
              defaultValue={editing?.reason}
            />
            <div className="actions">
              <button className="primary" type="submit">
                {editing ? "Salvar alteração" : "Criar orçamento"}
              </button>
              {editing && (
                <button type="button" onClick={() => setEditing(undefined)}>
                  Cancelar
                </button>
              )}
            </div>
          </form>
          <p className="muted">
            Sem mês final, o valor se repete indefinidamente.
          </p>
        </div>
        <div>
          <section className="panel">
            <h2>Orçamentos cadastrados</h2>
            {data.budgets.map((item) => (
              <div className="budget-item" key={item.id}>
                <div>
                  <b>{label(item)}</b>
                  <small>
                    {money(item.amount)} · {item.startMonth || item.month} até{" "}
                    {item.endMonth || "indefinido"}
                  </small>
                </div>
                <div className="actions">
                  <button onClick={() => setEditing(item)}>Editar</button>
                  <button onClick={() => remove(item.id)}>
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            ))}
          </section>
          <section className="panel">
            <h2>Realizado</h2>
            {view === "compare" ? (
              <>
                <h3>Fluxo</h3>
                <BudgetBars data={data} month={month} view="cash" />
                <h3>Compra integral</h3>
                <BudgetBars data={data} month={month} view="accrual" />
              </>
            ) : (
              <BudgetBars data={data} month={month} view={view} />
            )}
          </section>
        </div>
      </section>
    </>
  );
}

function Payments({
  data,
  mutate,
}: {
  data: FamilyData;
  mutate: (f: (d: FamilyData) => void) => void;
}) {
  const [show, setShow] = useState(false);
  const add = (fd: FormData) =>
    mutate((d) =>
      d.obligations.push({
        ...audit(),
        name: String(fd.get("name")),
        kind: String(fd.get("kind")) as Obligation["kind"],
        planned: +String(fd.get("planned")),
        dueDate: String(fd.get("due")),
        recurrence: String(fd.get("repeat")) as Obligation["recurrence"],
        tolerance: +String(fd.get("tolerance") || 0),
        status: "A pagar",
      }),
    );
  const mark = (id: string) =>
    mutate((d) => {
      const o = d.obligations.find((x) => x.id === id)!;
      o.status = "Paga";
      o.paidAt = dateOnly(new Date());
      o.paidAmount = o.planned;
    });
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Central de pagamentos</h2>
          <p className="muted">
            Ações manuais e conferência de cobranças automáticas.
          </p>
        </div>
        <button className="primary" onClick={() => setShow(!show)}>
          <Plus size={17} /> Compromisso
        </button>
      </div>
      {show && (
        <QuickForm
          onSubmit={(fd) => {
            add(fd);
            setShow(false);
          }}
          fields={[
            ["name", "Nome", "text"],
            ["planned", "Valor planejado", "number"],
            ["due", "Vencimento", "date"],
            ["tolerance", "Tolerância", "number"],
          ]}
          extras={
            <>
              <select name="kind">
                <option>Manual</option>
                <option>Débito automático</option>
                <option>Recorrência no cartão</option>
                <option>Assinatura</option>
                <option>Parcela</option>
                <option>Variável</option>
                <option>Eventual</option>
              </select>
              <select name="repeat">
                <option value="none">Sem repetição</option>
                <option value="monthly">Mensal</option>
                <option value="yearly">Anual</option>
              </select>
            </>
          }
        />
      )}
      <div className="payment-grid">
        {data.obligations
          .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
          .map((o) => {
            const actual = o.pattern
              ? data.transactions.find((t) =>
                  normalize(t.description).includes(normalize(o.pattern!)),
                )?.amount
              : undefined;
            const check =
              o.kind === "Recorrência no cartão"
                ? recurringCheck(o.planned, actual, o.tolerance)
                : undefined;
            return (
              <article className="payment" key={o.id}>
                <div>
                  <Badge text={o.status} />
                  <h3>{o.name}</h3>
                  <small>
                    {o.kind} · vence {o.dueDate}
                  </small>
                </div>
                <strong>{money(o.planned)}</strong>
                {check && <Badge text={check} />}{" "}
                {!["Paga", "Confirmada"].includes(o.status) && (
                  <button onClick={() => mark(o.id)}>Marcar como paga</button>
                )}
              </article>
            );
          })}
      </div>
      {!data.obligations.length && <Empty />}
    </section>
  );
}

function Goals({
  data,
  mutate,
}: {
  data: FamilyData;
  mutate: (f: (d: FamilyData) => void) => void;
}) {
  const [show, setShow] = useState(false);
  const add = (fd: FormData) =>
    mutate((d) =>
      d.goals.push({
        ...audit(),
        name: String(fd.get("name")),
        target: +String(fd.get("target")),
        deadline: String(fd.get("deadline")),
        minimum: +String(fd.get("minimum")),
        priority: d.goals.length + 1,
        emergency: false,
        active: true,
        movements: [],
      }),
    );
  const move = (id: string) => {
    const raw = prompt("Valor do aporte:");
    if (!raw) return;
    mutate((d) =>
      d.goals
        .find((g) => g.id === id)!
        .movements.push({
          id: uid(),
          date: dateOnly(new Date()),
          kind: "aporte",
          amount: +raw.replace(",", "."),
        }),
    );
  };
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Metas em ordem de prioridade</h2>
          <p className="muted">
            Aportes mínimos primeiro; excedente em cascata.
          </p>
        </div>
        <button className="primary" onClick={() => setShow(!show)}>
          <Plus size={17} /> Meta
        </button>
      </div>
      {show && (
        <QuickForm
          onSubmit={(fd) => {
            add(fd);
            setShow(false);
          }}
          fields={[
            ["name", "Nome da meta", "text"],
            ["target", "Valor-alvo", "number"],
            ["minimum", "Aporte mínimo", "number"],
            ["deadline", "Prazo", "date"],
          ]}
        />
      )}
      <div className="goals">
        {data.goals
          .sort((a, b) => a.priority - b.priority)
          .map((g) => {
            const total = g.movements.reduce((s, m) => s + m.amount, 0);
            return (
              <article key={g.id}>
                <div className="goal-top">
                  <div>
                    <small>
                      Prioridade {g.priority}
                      {g.emergency ? " · reserva de emergência" : ""}
                    </small>
                    <h3>{g.name}</h3>
                  </div>
                  <strong>
                    {Math.max(0, Math.round((total / (g.target || 1)) * 100))}%
                  </strong>
                </div>
                <progress value={total} max={g.target || 1} />
                <div className="goal-foot">
                  <span>
                    {money(total)} de {money(g.target)}
                  </span>
                  <button onClick={() => move(g.id)}>Registrar aporte</button>
                </div>
              </article>
            );
          })}
      </div>
    </section>
  );
}

function Tasks({
  data,
  mutate,
}: {
  data: FamilyData;
  mutate: (f: (d: FamilyData) => void) => void;
}) {
  const [show, setShow] = useState(false);
  const add = (fd: FormData) =>
    mutate((d) =>
      d.tasks.push({
        ...audit(),
        title: String(fd.get("title")),
        assignee: String(fd.get("assignee")) as Member,
        due: new Date(String(fd.get("due"))).toISOString(),
        priority: String(fd.get("priority")) as Task["priority"],
        status: "Pendente",
        repeat: String(fd.get("repeat")) as Task["repeat"],
        checklist: [],
        history: [],
      }),
    );
  const done = (id: string) =>
    mutate((d) => {
      const t = d.tasks.find((x) => x.id === id)!;
      t.history.push(now());
      if (t.repeat === "none") t.status = "Concluída";
      else {
        const dt = new Date(t.due);
        if (t.repeat === "daily") dt.setDate(dt.getDate() + 1);
        if (t.repeat === "weekly") dt.setDate(dt.getDate() + 7);
        if (t.repeat === "monthly") dt.setMonth(dt.getMonth() + 1);
        if (t.repeat === "yearly") dt.setFullYear(dt.getFullYear() + 1);
        t.due = dt.toISOString();
      }
    });
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Agenda e rotinas</h2>
          <p className="muted">
            Concluir uma ocorrência mantém a próxima recorrência.
          </p>
        </div>
        <div className="actions">
          <button
            onClick={() =>
              download(
                "rotinas-casa-em-ordem.ics",
                tasksToIcs(data.tasks),
                "text/calendar",
              )
            }
          >
            <Download size={16} /> Calendário
          </button>
          <button className="primary" onClick={() => setShow(!show)}>
            <Plus size={17} /> Tarefa
          </button>
        </div>
      </div>
      {show && (
        <QuickForm
          onSubmit={(fd) => {
            add(fd);
            setShow(false);
          }}
          fields={[
            ["title", "Título", "text"],
            ["due", "Data e hora", "datetime-local"],
          ]}
          extras={
            <>
              <select name="assignee">
                <option>Ambos</option>
                <option>Olcino</option>
                <option>Mari</option>
              </select>
              <select name="priority">
                <option>Média</option>
                <option>Alta</option>
                <option>Baixa</option>
              </select>
              <select name="repeat">
                <option value="none">Uma vez</option>
                <option value="daily">Diária</option>
                <option value="weekly">Semanal</option>
                <option value="monthly">Mensal</option>
                <option value="yearly">Anual</option>
              </select>
            </>
          }
        />
      )}
      <div className="task-list">
        {data.tasks
          .filter((t) => t.status !== "Concluída")
          .sort((a, b) => a.due.localeCompare(b.due))
          .map((t) => (
            <article
              key={t.id}
              className={new Date(t.due) < new Date() ? "overdue" : ""}
            >
              <button className="check" onClick={() => done(t.id)}>
                <CheckCircle2 />
              </button>
              <div>
                <h3>{t.title}</h3>
                <small>
                  {new Date(t.due).toLocaleString("pt-BR")} · {t.assignee} ·{" "}
                  {t.repeat === "none" ? "sem repetição" : t.repeat}
                </small>
              </div>
              <Badge text={t.priority} />
            </article>
          ))}
      </div>
    </section>
  );
}

function Config({
  data,
  setData,
  mutate,
  connect,
  setMessage,
}: {
  data: FamilyData;
  setData: (d: FamilyData) => void;
  mutate: (f: (d: FamilyData) => void) => void;
  connect: () => void;
  setMessage: (s: string) => void;
}) {
  const restore = async (file?: File) => {
    if (!file) return;
    try {
      setData(await restoreJson(file));
      setMessage("Backup restaurado.");
    } catch (e) {
      setMessage((e as Error).message);
    }
  };
  const addAccount = (fd: FormData) =>
    mutate((d) =>
      d.accounts.push({
        ...audit(),
        name: String(fd.get("name")),
        institution: String(fd.get("institution")),
        kind: String(fd.get("kind")) as Account["kind"],
        operator: String(fd.get("operator")) as Member,
        active: true,
      }),
    );
  return (
    <div className="grid two">
      <section className="panel">
        <h2>OneDrive</h2>
        <p>
          A base financeira fica privada no OneDrive. O código público não
          contém seus dados.
        </p>
        {isConfigured() ? (
          <button className="primary" onClick={connect}>
            <Cloud size={17} /> Entrar e conectar
          </button>
        ) : (
          <div className="callout">
            Copie <code>.env.example</code> para <code>.env</code> e informe o
            Client ID do aplicativo Microsoft Entra. Veja o README.
          </div>
        )}
        <h2>Backup</h2>
        <div className="actions">
          <button onClick={() => exportJson(data)}>
            <Download size={16} /> Exportar JSON
          </button>
          <label className="button">
            Restaurar JSON
            <input
              hidden
              type="file"
              accept=".json"
              onChange={(e) => restore(e.target.files?.[0])}
            />
          </label>
        </div>
      </section>
      <section className="panel">
        <h2>Contas e cartões</h2>
        <QuickForm
          onSubmit={addAccount}
          fields={[
            ["name", "Nome da conta/cartão", "text"],
            ["institution", "Instituição", "text"],
          ]}
          extras={
            <>
              <select name="kind">
                <option value="checking">Conta corrente</option>
                <option value="card">Cartão</option>
                <option value="investment">Investimento</option>
                <option value="cash">Dinheiro</option>
              </select>
              <select name="operator">
                <option>Olcino</option>
                <option>Mari</option>
                <option>Ambos</option>
              </select>
            </>
          }
        />
        <div className="list">
          {data.accounts.map((a) => (
            <Row
              key={a.id}
              a={a.name}
              b={`${a.institution} · ${a.operator}`}
              c={a.kind}
            />
          ))}
        </div>
      </section>
      <section className="panel">
        <h2>Categorias</h2>
        <p className="muted">
          {data.categories.length} categorias · {data.rules.length} regras
          aprendidas
        </p>
        <CategoryEditor data={data} mutate={mutate} />
      </section>
      <section className="panel danger-zone">
        <h2>Recomeçar localmente</h2>
        <p>Apaga somente a cópia deste navegador. Faça backup antes.</p>
        <button
          onClick={() => {
            if (confirm("Recriar a base local?")) setData(createSeed());
          }}
        >
          <Trash2 size={16} /> Recriar base
        </button>
      </section>
    </div>
  );
}

function CategoryEditor({
  data,
  mutate,
}: {
  data: FamilyData;
  mutate: (f: (d: FamilyData) => void) => void;
}) {
  const addCategory = (fd: FormData) =>
    mutate((d) =>
      d.categories.push({
        ...audit(),
        name: String(fd.get("name")),
        nature: String(fd.get("nature")) as
          "expense" | "income" | "transfer" | "goal",
        subcategories: [],
      }),
    );
  const rename = (id: string, current: string) => {
    const name = prompt("Novo nome da categoria:", current);
    if (name)
      mutate((d) => {
        const c = d.categories.find((x) => x.id === id)!;
        c.name = name;
        c.updatedAt = now();
        c.version++;
      });
  };
  const addSub = (id: string) => {
    const name = prompt("Nome da nova subcategoria:");
    if (name)
      mutate((d) => {
        const c = d.categories.find((x) => x.id === id)!;
        if (!c.subcategories.includes(name)) c.subcategories.push(name);
      });
  };
  const renameSub = (id: string, old: string) => {
    const name = prompt("Novo nome da subcategoria:", old);
    if (name)
      mutate((d) => {
        const c = d.categories.find((x) => x.id === id)!;
        c.subcategories = c.subcategories.map((s) => (s === old ? name : s));
        d.transactions
          .filter((t) => t.categoryId === id && t.subcategory === old)
          .forEach((t) => (t.subcategory = name));
      });
  };
  return (
    <>
      <QuickForm
        onSubmit={addCategory}
        fields={[["name", "Nova categoria", "text"]]}
        extras={
          <select name="nature">
            <option value="expense">Despesa</option>
            <option value="income">Receita</option>
            <option value="transfer">Transferência</option>
            <option value="goal">Meta</option>
          </select>
        }
      />
      {data.categories.map((c) => (
        <details key={c.id}>
          <summary>{c.name}</summary>
          <div className="actions">
            <button onClick={() => rename(c.id, c.name)}>Renomear</button>
            <button onClick={() => addSub(c.id)}>Adicionar subcategoria</button>
          </div>
          <div className="subcategories">
            {c.subcategories.map((s) => (
              <button key={s} onClick={() => renameSub(c.id, s)}>
                {s}
              </button>
            ))}
          </div>
        </details>
      ))}
    </>
  );
}

function Analytics({ data }: { data: FamilyData }) {
  const months = [
    ...new Set(data.transactions.map((t) => monthOf(t.paymentDate || t.date))),
  ]
    .sort()
    .slice(-18);
  const rows = months.map((month) => {
    const income = data.transactions
      .filter((t) => !t.transfer && t.amount < 0)
      .reduce((s, t) => s + Math.abs(realized(t, month, "cash")), 0);
    const expense = data.transactions
      .filter((t) => !t.transfer && t.amount > 0)
      .reduce((s, t) => s + Math.abs(realized(t, month, "cash")), 0);
    const planned = budgetValue(data, month, (b) => !b.member);
    return { month, income, expense, planned };
  });
  const max = Math.max(
    1,
    ...rows.flatMap((r) => [r.income, r.expense, r.planned]),
  );
  return (
    <>
      <section className="cards">
        <Card
          label="Entradas no período"
          value={money(rows.reduce((s, r) => s + r.income, 0))}
          hint={`${rows.length} competências`}
        />
        <Card
          label="Saídas no período"
          value={money(rows.reduce((s, r) => s + r.expense, 0))}
          hint="Sem transferências internas"
        />
        <Card
          label="Resultado acumulado"
          value={money(rows.reduce((s, r) => s + r.income - r.expense, 0))}
          hint="Entradas menos saídas"
        />
        <Card
          label="Média mensal"
          value={money(
            rows.reduce((s, r) => s + r.expense, 0) / (rows.length || 1),
          )}
          hint="Média de saídas"
        />
      </section>
      <section className="panel analytics">
        <div className="panel-head">
          <div>
            <h2>Histórico mensal</h2>
            <p className="muted">Entradas, saídas e orçamento vigente.</p>
          </div>
          <div className="legend">
            <span className="income">Entradas</span>
            <span className="expense">Saídas</span>
            <span className="planned">Orçado</span>
          </div>
        </div>
        <div className="chart">
          {rows.map((r) => (
            <div className="chart-column" key={r.month}>
              <div className="chart-bars">
                <i
                  className="income"
                  style={{ height: `${(r.income / max) * 100}%` }}
                  title={`Entradas ${money(r.income)}`}
                />
                <i
                  className="expense"
                  style={{ height: `${(r.expense / max) * 100}%` }}
                  title={`Saídas ${money(r.expense)}`}
                />
                <i
                  className="planned"
                  style={{ height: `${(r.planned / max) * 100}%` }}
                  title={`Orçado ${money(r.planned)}`}
                />
              </div>
              <small>
                {r.month.slice(5)}/{r.month.slice(2, 4)}
              </small>
            </div>
          ))}
        </div>
        {!rows.length && <Empty />}
      </section>
      <section className="panel">
        <h2>Orçado × realizado por competência</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Mês</th>
                <th>Entradas</th>
                <th>Saídas</th>
                <th>Orçado</th>
                <th>Diferença</th>
              </tr>
            </thead>
            <tbody>
              {rows
                .slice()
                .reverse()
                .map((r) => (
                  <tr key={r.month}>
                    <td>{r.month}</td>
                    <td>{money(r.income)}</td>
                    <td>{money(r.expense)}</td>
                    <td>{money(r.planned)}</td>
                    <td
                      className={
                        r.planned - r.expense >= 0 ? "positive" : "negative"
                      }
                    >
                      {money(r.planned - r.expense)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function QuickForm({
  fields,
  extras,
  onSubmit,
}: {
  fields: [string, string, string][];
  extras?: React.ReactNode;
  onSubmit: (fd: FormData) => void;
}) {
  return (
    <form
      className="quick-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(new FormData(e.currentTarget));
        e.currentTarget.reset();
      }}
    >
      {fields.map(([name, label, type]) => (
        <input
          key={name}
          required
          name={name}
          type={type}
          placeholder={label}
          aria-label={label}
        />
      ))}
      {extras}
      <button type="submit">Adicionar</button>
    </form>
  );
}
function Row({ a, b, c }: { a: string; b: string; c: string }) {
  return (
    <div className="row">
      <div>
        <b>{a}</b>
        <small>{b}</small>
      </div>
      <span>{c}</span>
    </div>
  );
}
function Badge({ text, kind }: { text: string; kind?: string }) {
  return (
    <span
      className={`badge ${kind || normalize(text).toLowerCase().replace(/\s/g, "-")}`}
    >
      {text}
    </span>
  );
}
function Empty() {
  return <div className="empty">Nenhum registro por aqui ainda.</div>;
}
