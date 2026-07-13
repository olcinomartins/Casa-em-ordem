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
  Trash2,
  CheckCircle2,
  TrendingUp,
  Eye,
  EyeOff,
  ShoppingCart,
  Mic,
  Square,
} from "lucide-react";
import {
  Account,
  Budget,
  CashView,
  FamilyData,
  Member,
  Obligation,
  Receipt,
  Chore,
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
  resumeSignIn,
} from "./onedrive";
import { createSeed } from "./seed";
import {
  budgetApplies,
  budgetValue,
  personalBalance,
  realized,
  recurringCheck,
  upsertRule,
  dedupeKey,
  suggest,
} from "./finance";
import { previewFile, Preview } from "./importer";
import { tasksToIcs } from "./ics";
import { readReceipt, ReadReceipt } from "./receipts";
import { getProtectedPdfPasswords, identifyPdfBank } from "./pdfPasswords";
import { readVoiceExpense, VoiceTransaction } from "./voice";

type Page = "visao" | "rotinas" | "planejamento" | "importar" | "supermercado";
const nav: [Page, string, typeof BarChart3][] = [
  ["visao", "Painel e Análises", BarChart3],
  ["rotinas", "Responsabilidades, Tarefas e Pagamentos", CheckSquare],
  ["planejamento", "Categorias, Contas, Orçamentos e Metas", WalletCards],
  ["importar", "Importar extratos e faturas", Upload],
  ["supermercado", "Supermercado", ShoppingCart],
];
const currentMonth = () => new Date().toISOString().slice(0, 7);
const dateOnly = (d: Date) => d.toISOString().slice(0, 10);

export default function App() {
  const [data, setData] = useState<FamilyData>();
  const [authenticated, setAuthenticated] = useState(false);
  const [currentMember, setCurrentMember] = useState<"Olcino" | "Mari">(
    "Olcino",
  );
  const [authError, setAuthError] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [hideValues, setHideValues] = useState(
    () => localStorage.getItem("casa-em-ordem-hide-values") === "true",
  );
  const [page, setPage] = useState<Page>("visao");
  const [month, setMonth] = useState(currentMonth());
  const [view, setView] = useState<CashView>("cash");
  const [message, setMessage] = useState("");
  const [cloud, setCloud] = useState<"local" | "syncing" | "connected">(
    "local",
  );
  useEffect(() => {
    if (authenticated && data) saveLocal(data);
  }, [authenticated, data]);
  const autosaveReady = useRef(false);
  useEffect(() => {
    if (!authenticated || !data) return;
    if (!autosaveReady.current) {
      autosaveReady.current = true;
      return;
    }
    setCloud("syncing");
    const timer = window.setTimeout(() => {
      saveCloud(data)
        .then(() => setCloud("connected"))
        .catch((error) => {
          setCloud("local");
          setMessage(
            `Falha no salvamento automático: ${(error as Error).message}`,
          );
        });
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [authenticated, data]);
  useEffect(() => {
    if (!authenticated) return;
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      loadCloud()
        .then((remote) => {
          if (remote)
            setData((current) =>
              !current || remote.lastSavedAt > current.lastSavedAt
                ? remote
                : current,
            );
        })
        .catch((error) =>
          setMessage(
            `Não foi possível atualizar do OneDrive: ${(error as Error).message}`,
          ),
        );
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [authenticated]);
  const allowAccount = async (account: { username: string }) => {
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
    setCurrentMember(
      email === "mariana_camillie@hotmail.com" ? "Mari" : "Olcino",
    );
    const remote = await loadCloud();
    if (!remote)
      throw new Error(
        "A base familiar do OneDrive não foi encontrada. O aplicativo não abrirá uma cópia local antiga.",
      );
    setData(remote);
    setAuthenticated(true);
    setCloud("connected");
  };
  useEffect(() => {
    resumeSignIn()
      .then((account) => account && allowAccount(account))
      .catch((error) => setAuthError((error as Error).message));
  }, []);
  const login = async () => {
    setAuthBusy(true);
    setAuthError("");
    try {
      const account = await signIn();
      await allowAccount(account);
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
  const toggleValues = () =>
    setHideValues((current) => {
      localStorage.setItem("casa-em-ordem-hide-values", String(!current));
      return !current;
    });
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
    <div className={`app ${hideValues ? "values-hidden" : ""}`}>
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
          <button
            onClick={isConfigured() ? connect : () => setPage("planejamento")}
          >
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
            <select
              className="mobile-page-select"
              value={page}
              onChange={(event) => setPage(event.target.value as Page)}
              aria-label="Selecionar página"
            >
              {nav.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
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
            <button
              className="privacy-toggle"
              onClick={toggleValues}
              title={hideValues ? "Mostrar valores" : "Esconder valores"}
              aria-label={hideValues ? "Mostrar valores" : "Esconder valores"}
            >
              {hideValues ? <EyeOff size={18} /> : <Eye size={18} />}
              <span>{hideValues ? "Mostrar" : "Esconder"}</span>
            </button>
            {page === "planejamento" && (
              <button onClick={configureShared}>Base compartilhada</button>
            )}
          </div>
        </header>
        {message && (
          <div className="toast" onClick={() => setMessage("")}>
            {message}
          </div>
        )}
        {page === "visao" && (
          <>
            <Collapsible title="Painel" open>
              <Dashboard
                data={data}
                month={month}
                view={view}
                setView={setView}
              />
            </Collapsible>
            <Collapsible title="Análises históricas">
              <Analytics data={data} />
            </Collapsible>
          </>
        )}
        {page === "rotinas" && (
          <>
            <Collapsible title="Responsabilidades, tarefas e agenda" open>
              <Tasks
                data={data}
                mutate={mutate}
                currentMember={currentMember}
              />
            </Collapsible>
            <Collapsible title="Central de pagamentos">
              <Payments data={data} mutate={mutate} />
            </Collapsible>
          </>
        )}
        {page === "planejamento" && (
          <>
            <Collapsible title="Contas e cartões" open>
              <Config
                mode="accounts"
                data={data}
                setData={setData}
                mutate={mutate}
                connect={connect}
                setMessage={setMessage}
              />
            </Collapsible>
            <Collapsible title="Categorias de despesas e receitas">
              <Config
                mode="categories"
                data={data}
                setData={setData}
                mutate={mutate}
                connect={connect}
                setMessage={setMessage}
              />
            </Collapsible>
            <Collapsible title="Orçamentos">
              <Budgets
                data={data}
                month={month}
                view={view}
                setView={setView}
                mutate={mutate}
              />
            </Collapsible>
            <Collapsible title="Metas e reservas">
              <Goals data={data} mutate={mutate} />
            </Collapsible>
          </>
        )}
        {page === "importar" && (
          <>
            <Collapsible title="Registrar despesa por voz" open>
              <VoiceExpense
                data={data}
                mutate={mutate}
                setMessage={setMessage}
                currentMember={currentMember}
              />
            </Collapsible>
            <Collapsible title="Importar extratos e faturas">
              <ImportPage data={data} mutate={mutate} setMessage={setMessage} />
            </Collapsible>
            <Collapsible title="Transações e revisão">
              <Transactions data={data} month={month} mutate={mutate} />
            </Collapsible>
          </>
        )}
        {page === "supermercado" && (
          <Receipts data={data} mutate={mutate} setMessage={setMessage} />
        )}
      </main>
    </div>
  );
}

function Collapsible({
  title,
  open = false,
  children,
}: {
  title: string;
  open?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details className="collapsible" open={open}>
      <summary>
        {title}
        <span aria-hidden="true">⌄</span>
      </summary>
      <div className="collapsible-content">{children}</div>
    </details>
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
        Fluxo das parcelas
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
        Comparar integral × parcelas
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
  const expectedBeforeClosing = data.obligations
    .filter(
      (o) =>
        monthOf(o.dueDate) === month &&
          !["Paga", "Dispensada"].includes(o.status),
    )
    .reduce((sum, o) => sum + o.planned, 0);
  const realizedTransactions = data.transactions.filter(
    (t) => !t.estimated && t.amount > 0 && Math.abs(realized(t, month, "cash")) > 0,
  );
  const realizedExpenses = realizedTransactions.reduce(
    (sum, transaction) => sum + Math.abs(realized(transaction, month, "cash")),
    0,
  );
  const sameExpense = (amount: number, date: string, description?: string) =>
    realizedTransactions.some((transaction) => {
      const transactionDate = transaction.purchaseDate || transaction.date;
      const days = Math.abs(new Date(`${transactionDate}T12:00:00`).getTime() - new Date(`${date}T12:00:00`).getTime()) / 864e5;
      const descriptionMatches = !description || normalize(transaction.description).includes(normalize(description)) || normalize(description).includes(normalize(transaction.description));
      return Math.abs(Math.abs(transaction.amount) - Math.abs(amount)) < 0.02 && days <= 3 && descriptionMatches;
    });
  const voiceEstimates = data.transactions.filter(
    (t) => t.estimated && t.amount > 0 && monthOf(t.purchaseDate || t.date) === month && !sameExpense(t.amount, t.purchaseDate || t.date, t.description),
  );
  const voiceExpected = voiceEstimates.reduce((sum, transaction) => sum + Math.abs(transaction.amount), 0);
  const receiptEstimates = (data.receipts || []).filter(
    (receipt) => monthOf(receipt.date) === month && receipt.total > 0 && !sameExpense(receipt.total, receipt.date, receipt.store),
  );
  const receiptsExpected = receiptEstimates.reduce((sum, receipt) => sum + receipt.total, 0);
  const totalExpected = realizedExpenses + expectedBeforeClosing + voiceExpected + receiptsExpected;
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
          tone="good"
          details={data.transactions.filter(t=>t.amount<0&&Math.abs(realized(t,month,"cash"))>0).map(t=><Row key={t.id} a={t.description} b={t.paymentDate||t.date} c={money(Math.abs(t.amount))}/>) }
        />
        <Card
          label="Despesas no fluxo"
          value={money(expenses("cash"))}
          hint={
            view === "compare"
              ? `Integral: ${money(expenses("accrual"))}`
              : "Conforme pagamentos"
          }
          tone="bad"
          details={data.transactions.filter(t=>t.amount>0&&Math.abs(realized(t,month,"cash"))>0).map(t=><Row key={t.id} a={t.description} b={t.paymentDate||t.date} c={money(t.amount)}/>) }
        />
        <Card
          label="Resultado de caixa"
          value={money(income - expenses("cash"))}
          hint="Antes dos aportes"
          tone={income - expenses("cash") < 0 ? "bad" : "good"}
          details={<p>Entradas {money(income)} menos despesas realizadas {money(expenses("cash"))}.</p>}
        />
        <Card
          label="Estimativa antes do fechamento"
          value={money(totalExpected)}
          hint={`${money(realizedExpenses)} realizado · ${money(voiceExpected + receiptsExpected + expectedBeforeClosing)} ainda previsto`}
          tone="warning"
          details={<>
            <p>Prévia formada por pagamentos realizados, registros por voz, notas e compromissos ainda abertos. Não é saldo bancário nem fatura fechada.</p>
            <Row a="Pagamentos e gastos realizados" b="Confirmados no mês" c={money(realizedExpenses)} />
            <Row a="Registros por voz" b={`${voiceEstimates.length} estimativa(s)`} c={money(voiceExpected)} />
            <Row a="Notas de compras" b={`${receiptEstimates.length} nota(s)`} c={money(receiptsExpected)} />
            <Row a="Pagamentos ainda previstos" b="Obrigações abertas" c={money(expectedBeforeClosing)} />
            {voiceEstimates.map(t=><Row key={t.id} a={`Voz · ${t.description}`} b={t.purchaseDate||t.date} c={money(t.amount)}/>)}
            {receiptEstimates.map(receipt=><Row key={receipt.id} a={`Nota · ${receipt.store}`} b={receipt.date} c={money(receipt.total)}/>)}
            {data.obligations.filter(o=>monthOf(o.dueDate)===month&&!['Paga','Dispensada'].includes(o.status)).sort((a,b)=>a.dueDate.localeCompare(b.dueDate)).map(o=><Row key={o.id} a={o.name} b={`${o.dueDate} · ${o.status}`} c={money(o.planned)}/>)}
          </>}
        />
      </section>
      <section className="grid two">
        <div className="panel">
          <h2>Orçado × realizado</h2>
          {view === "compare" ? (
            <div className="grid two">
              <div>
                <h3>Fluxo das parcelas</h3>
                <BudgetBars data={data} month={month} view="cash" />
              </div>
              <div>
                <h3>Compra integral</h3>
                <BudgetBars data={data} month={month} view="accrual" />
              </div>
            </div>
          ) : (
            <BudgetBars data={data} month={month} view={view} />
          )}
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
  details,
}: {
  label: string;
  value: string;
  hint: string;
  tone?: string;
  details?: React.ReactNode;
}) {
  const content=<><span>{label}</span><strong>{tone==="good"?"↑ ":tone==="bad"?"↓ ":tone==="warning"?"→ ":""}{value}</strong><small>{hint}</small></>;
  return details?<details className={`card info-card ${tone||""}`}><summary>{content}<em>Toque para ver a composição</em></summary><div className="card-details">{details}</div></details>:<div className={`card ${tone||""}`}>{content}</div>;
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

const initialChores = [
  "Varrer a casa",
  "Passar pano",
  "Lavar roupa",
  "Estender roupa",
  "Lavar louça",
  "Comprar comida",
  "Passear com a cachorra",
  "Colocar comida para a cachorra",
  "Cozinhar",
];
function Chores({
  data,
  mutate,
}: {
  data: FamilyData;
  mutate: (f: (d: FamilyData) => void) => void;
}) {
  const [editing, setEditing] = useState<Chore>();
  useEffect(() => {
    if (data.chores === undefined)
      mutate((d) => {
        d.chores = initialChores.map((title) => ({
          ...audit(),
          title,
          assignee: "Ambos",
          frequency: "weekly",
          active: true,
          completionHistory: [],
        }));
      });
  }, [data.chores]);
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const values = {
      title: String(fd.get("title")),
      assignee: String(fd.get("assignee")) as Member,
      frequency: String(fd.get("frequency")) as Chore["frequency"],
    };
    mutate((d) => {
      d.chores ??= [];
      if (editing) {
        const item = d.chores.find((x) => x.id === editing.id);
        if (item)
          Object.assign(item, values, {
            updatedAt: now(),
            version: item.version + 1,
          });
      } else
        d.chores.push({
          ...audit(),
          ...values,
          active: true,
          completionHistory: [],
        });
    });
    setEditing(undefined);
    event.currentTarget.reset();
  };
  const frequency = (value: Chore["frequency"]) =>
    ({
      daily: "Diária",
      weekly: "Semanal",
      monthly: "Mensal",
      as_needed: "Quando necessário",
    })[value];
  return (
    <section className="grid two">
      <div className="panel">
        <h2>{editing ? "Editar responsabilidade" : "Nova responsabilidade"}</h2>
        <form key={editing?.id || "new"} onSubmit={submit}>
          <div className="form-stack">
            <input
              name="title"
              required
              placeholder="Tarefa doméstica"
              defaultValue={editing?.title}
            />
            <select name="assignee" defaultValue={editing?.assignee || "Ambos"}>
              <option>Olcino</option>
              <option>Mari</option>
              <option>Ambos</option>
            </select>
            <select
              name="frequency"
              defaultValue={editing?.frequency || "weekly"}
            >
              <option value="daily">Diária</option>
              <option value="weekly">Semanal</option>
              <option value="monthly">Mensal</option>
              <option value="as_needed">Quando necessário</option>
            </select>
            <div className="actions">
              <button className="primary" type="submit">
                {editing ? "Salvar alteração" : "Adicionar"}
              </button>
              {editing && (
                <button type="button" onClick={() => setEditing(undefined)}>
                  Cancelar
                </button>
              )}
            </div>
          </div>
        </form>
      </div>
      <div className="panel">
        <h2>Responsabilidades da casa</h2>
        {(data.chores || []).map((item) => (
          <div className="budget-item" key={item.id}>
            <div>
              <b>{item.title}</b>
              <small>
                {item.assignee} · {frequency(item.frequency)}
                {item.lastCompletedAt
                  ? ` · feita em ${item.lastCompletedAt.slice(0, 10)}`
                  : ""}
              </small>
            </div>
            <div className="actions">
              <button
                title="Marcar como feita"
                onClick={() =>
                  mutate((d) => {
                    const x = d.chores?.find((c) => c.id === item.id);
                    if (x) {
                      const date = now();
                      x.lastCompletedAt = date;
                      x.completionHistory.push(date);
                    }
                  })
                }
              >
                <CheckCircle2 size={16} />
              </button>
              <button onClick={() => setEditing(item)}>Editar</button>
              <button
                onClick={() =>
                  mutate((d) => {
                    d.chores = (d.chores || []).filter((x) => x.id !== item.id);
                  })
                }
              >
                <Trash2 size={15} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

const groceryMacro = (description: string) => {
  const n = normalize(description);
  if (/CARNE|FRANGO|PEIXE|LINGUICA|OVO/.test(n)) return "Proteínas";
  if (/LEITE|QUEIJO|IOGUR|MANTEIGA|REQUEI/.test(n)) return "Laticínios";
  if (/ARROZ|FEIJAO|MACARR|FARINHA|ACUCAR|CAFE|OLEO/.test(n))
    return "Mercearia";
  if (
    /BANANA|MACA|LARANJA|UVA|MAMAO|BATATA|TOMATE|CEBOLA|ALFACE|CENOURA/.test(n)
  )
    return "Hortifruti";
  if (/SABAO|DETERG|DESINF|AMACIANTE|ESPONJA/.test(n)) return "Limpeza";
  if (/SHAMPOO|SABONETE|PAPEL HIG|CREME DENT/.test(n)) return "Higiene";
  if (/RACAO|PETISCO|CACHORR/.test(n)) return "Pet";
  if (/BISCOITO|CHOCOLATE|REFRIG|SUCO|CERVEJA/.test(n))
    return "Bebidas e lanches";
  return "Outros";
};
function Receipts({
  data,
  mutate,
  setMessage,
}: {
  data: FamilyData;
  mutate: (f: (d: FamilyData) => void) => void;
  setMessage: (s: string) => void;
}) {
  const [draft, setDraft] = useState<ReadReceipt>();
  const [busy, setBusy] = useState(false);
  const libraryInput = useRef<HTMLInputElement>(null);
  const [photoProgress, setPhotoProgress] = useState<{
    current: number;
    total: number;
    completed: number;
    failed: number;
  }>();
  const analyze = async (files: File[]) => {
    if (!files.length) return;
    setBusy(true);
    setPhotoProgress({
      current: 1,
      total: files.length,
      completed: 0,
      failed: 0,
    });
    const parts: ReadReceipt[] = [];
    const failures: string[] = [];
    for (let index = 0; index < files.length; index++) {
      setPhotoProgress((p) => ({
        current: index + 1,
        total: files.length,
        completed: p?.completed || 0,
        failed: p?.failed || 0,
      }));
      setMessage(`Lendo imagem ${index + 1} de ${files.length}…`);
      try {
        parts.push(await readReceipt(files[index]));
        setPhotoProgress((p) => ({
          ...p!,
          completed: (p?.completed || 0) + 1,
        }));
      } catch (error) {
        failures.push(`imagem ${index + 1}: ${(error as Error).message}`);
        setPhotoProgress((p) => ({ ...p!, failed: (p?.failed || 0) + 1 }));
      }
      if (index < files.length - 1)
        await new Promise((resolve) => setTimeout(resolve, 1200));
    }
    if (parts.length) {
      const best =
        parts
          .slice()
          .sort((a, b) => (b.confianca || 0) - (a.confianca || 0))[0] || {};
      setDraft({
        ...best,
        estabelecimento: parts.find((x) => x.estabelecimento)?.estabelecimento,
        data: parts.find((x) => x.data)?.data,
        total: parts
          .slice()
          .reverse()
          .find((x) => Number(x.total) > 0)?.total,
        itens: parts.flatMap((x) => x.itens || []),
        observacoes: [
          ...parts.flatMap((x) => x.observacoes || []),
          ...failures,
        ],
      });
      setMessage(
        `${parts.length} de ${files.length} imagem(ns) lida(s).${failures.length ? " As demais podem ser reenviadas." : " Confira os dados."}`,
      );
    } else setMessage(failures[0] || "Nenhuma imagem pôde ser lida.");
    setBusy(false);
    window.setTimeout(() => setPhotoProgress(undefined), 2500);
  };
  const save = () => {
    if (!draft) return;
    const receipt: Receipt = {
      ...audit(),
      store: draft.estabelecimento || "Estabelecimento não identificado",
      date: draft.data || dateOnly(new Date()),
      total: Number(draft.total) || 0,
      confidence: draft.confianca,
      notes: draft.observacoes,
      items: (draft.itens || []).map((i) => ({
        id: uid(),
        description: i.descricao || "Item não identificado",
        quantity: Number(i.quantidade) || 1,
        unit: i.unidade,
        unitPrice:
          i.valorUnitario == null ? undefined : Number(i.valorUnitario),
        total: Number(i.valorTotal) || 0,
        macroCategory: i.categoriaMacro || groceryMacro(i.descricao || ""),
      })),
    };
    mutate((d) => {
      (d.receipts ??= []).push(receipt);
    });
    setDraft(undefined);
    setMessage("Compra registrada e sincronização automática iniciada.");
  };
  const updateItem = (
    index: number,
    patch: Partial<NonNullable<ReadReceipt["itens"]>[number]>,
  ) =>
    setDraft((current) => {
      if (!current) return current;
      const itens = [...(current.itens || [])];
      itens[index] = { ...itens[index], ...patch };
      return { ...current, itens };
    });
  const macroCategories = [
    "Proteínas",
    "Laticínios",
    "Mercearia",
    "Hortifruti",
    "Limpeza",
    "Higiene",
    "Pet",
    "Bebidas e lanches",
    "Outros",
  ];
  const history = data.receipts || [];
  const allPurchases = history.flatMap((r) => r.items.map((i) => ({ r, i })));
  const keys = Array.from(
    new Set(allPurchases.map((x) => normalize(x.i.description))),
  );
  const products = keys
    .map((key) => {
      const purchases = allPurchases
        .filter((x) => normalize(x.i.description) === key)
        .sort((a, b) => a.r.date.localeCompare(b.r.date));
      const last = purchases.at(-1);
      const intervals = purchases
        .slice(1)
        .map(
          (x, index) =>
            (new Date(x.r.date).getTime() -
              new Date(purchases[index].r.date).getTime()) /
            864e5,
        );
      const averageDays = intervals.length
        ? Math.round(intervals.reduce((a, b) => a + b, 0) / intervals.length)
        : undefined;
      const next =
        averageDays && last
          ? new Date(new Date(last.r.date).getTime() + averageDays * 864e5)
              .toISOString()
              .slice(0, 10)
          : undefined;
      const prices = purchases
        .map(
          (x) =>
            x.i.unitPrice ??
            (x.i.quantity ? x.i.total / x.i.quantity : undefined),
        )
        .filter((value): value is number => Number.isFinite(value));
      return {
        name: last?.i.description || key,
        category:
          last?.i.macroCategory || groceryMacro(last?.i.description || key),
        count: purchases.length,
        averageQuantity:
          purchases.reduce((s, x) => s + x.i.quantity, 0) / purchases.length,
        price: prices.length
          ? prices.reduce((a, b) => a + b, 0) / prices.length
          : undefined,
        store: last?.r.store,
        averageDays,
        next,
      };
    })
    .sort((a, b) => b.count - a.count);
  return (
    <>
      <input
        ref={libraryInput}
        hidden
        type="file"
        accept="image/*"
        multiple
        onChange={(e) => analyze(Array.from(e.target.files || []))}
      />
      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>Fotografar nota de supermercado</h2>
            <p className="muted">
              O mesmo login Microsoft do aplicativo autoriza a leitura. A
              fotografia não é armazenada na base.
            </p>
          </div>
          <div className="actions">
            <button
              className="primary"
              disabled={busy}
              onClick={() => libraryInput.current?.click()}
            >
              {busy ? "Lendo…" : "Fotografar ou escolher da biblioteca"}
            </button>
          </div>
        </div>
        {photoProgress && (
          <div className="photo-progress">
            <div className="photo-progress-head">
              <span className={busy ? "processing-dot" : ""} />
              <b>
                {busy
                  ? `Enviando e processando foto ${photoProgress.current} de ${photoProgress.total}`
                  : "Processamento concluído"}
              </b>
              <strong>
                {Math.round(
                  ((photoProgress.completed + photoProgress.failed) /
                    photoProgress.total) *
                    100,
                )}
                %
              </strong>
            </div>
            <progress
              value={photoProgress.completed + photoProgress.failed}
              max={photoProgress.total}
            />
            <small>
              {photoProgress.completed} concluída(s)
              {photoProgress.failed
                ? ` · ${photoProgress.failed} com erro`
                : ""}
            </small>
          </div>
        )}
        {draft && (
          <div className="receipt-review">
            <div className="form-row">
              <input
                value={draft.estabelecimento || ""}
                placeholder="Estabelecimento"
                onChange={(e) =>
                  setDraft({ ...draft, estabelecimento: e.target.value })
                }
              />
              <input
                type="date"
                value={draft.data || ""}
                onChange={(e) => setDraft({ ...draft, data: e.target.value })}
              />
              <CurrencyInput
                value={Number(draft.total) || 0}
                onChange={(value) => setDraft({ ...draft, total: value })}
              />
            </div>
            <div className="panel-head">
              <h3>Itens identificados</h3>
              <button
                onClick={() =>
                  setDraft({
                    ...draft,
                    itens: [
                      ...(draft.itens || []),
                      {
                        descricao: "",
                        categoriaMacro: "Outros",
                        quantidade: 1,
                        unidade: "un",
                        valorUnitario: 0,
                        valorTotal: 0,
                      },
                    ],
                  })
                }
              >
                <Plus size={15} /> Adicionar item
              </button>
            </div>
            {(draft.itens || []).map((item, index) => (
              <div className="receipt-item-edit" key={index}>
                <input
                  value={item.descricao || ""}
                  placeholder="Nome do produto"
                  onChange={(e) =>
                    updateItem(index, { descricao: e.target.value })
                  }
                />
                <select
                  value={
                    item.categoriaMacro || groceryMacro(item.descricao || "")
                  }
                  onChange={(e) =>
                    updateItem(index, { categoriaMacro: e.target.value })
                  }
                >
                  {macroCategories.map((category) => (
                    <option key={category}>{category}</option>
                  ))}
                </select>
                <label>
                  Quantidade
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.001"
                    value={item.quantidade ?? 1}
                    onChange={(e) =>
                      updateItem(index, { quantidade: Number(e.target.value) })
                    }
                  />
                </label>
                <label>
                  Unidade
                  <input
                    value={item.unidade || ""}
                    onChange={(e) =>
                      updateItem(index, { unidade: e.target.value })
                    }
                  />
                </label>
                <label>
                  Valor unitário
                  <CurrencyInput
                    value={Number(item.valorUnitario) || 0}
                    onChange={(value) =>
                      updateItem(index, { valorUnitario: value })
                    }
                  />
                </label>
                <label>
                  Valor total
                  <CurrencyInput
                    value={Number(item.valorTotal) || 0}
                    onChange={(value) =>
                      updateItem(index, { valorTotal: value })
                    }
                  />
                </label>
                <button
                  className="danger-button"
                  onClick={() =>
                    setDraft({
                      ...draft,
                      itens: (draft.itens || []).filter(
                        (_, itemIndex) => itemIndex !== index,
                      ),
                    })
                  }
                >
                  <Trash2 size={15} /> Excluir
                </button>
              </div>
            ))}
            <button className="primary" onClick={save}>
              Confirmar e salvar nota
            </button>
          </div>
        )}
      </section>
      <section className="panel">
        <h2>Sugestões para a lista de compras</h2>
        <p className="muted">
          Calculadas silenciosamente pelas datas e quantidades salvas na base.
        </p>
        {products
          .filter((p) => p.next)
          .map((p) => (
            <Row
              key={p.name}
              a={p.name}
              b={`${p.category} · comprar cerca de ${p.averageQuantity.toFixed(1)} un. · intervalo médio ${p.averageDays} dias`}
              c={p.next || "—"}
            />
          ))}
      </section>
      <section className="panel">
        <h2>Produtos e valores médios</h2>
        <p className="muted">
          Catálogo consolidado por categoria, sem exibir as notas individuais.
        </p>
        {products.length ? (
          products.map((p) => (
            <Row
              key={p.name}
              a={p.name}
              b={`${p.category} · ${p.count} ocorrência(s) · quantidade média ${p.averageQuantity.toFixed(1)} · último local: ${p.store || "não identificado"}`}
              c={p.price == null ? "—" : `${money(p.price)} médio`}
            />
          ))
        ) : (
          <Empty />
        )}
      </section>
    </>
  );
}

function VoiceExpense({
  data,
  mutate,
  setMessage,
  currentMember,
}: {
  data: FamilyData;
  mutate: (f: (d: FamilyData) => void) => void;
  setMessage: (s: string) => void;
  currentMember: "Olcino" | "Mari";
}) {
  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [draft, setDraft] = useState<VoiceTransaction>();
  const [levels, setLevels] = useState<number[]>(Array(24).fill(3));
  const recorder = useRef<MediaRecorder>();
  const stream = useRef<MediaStream>();
  const chunks = useRef<Blob[]>([]);
  const animation = useRef<number>();
  const start = async () => {
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      stream.current = media;
      const context = new AudioContext();
      await context.resume();
      const analyser = context.createAnalyser();
      analyser.fftSize = 64;
      context.createMediaStreamSource(media).connect(analyser);
      const samples = new Uint8Array(analyser.frequencyBinCount);
      const draw = () => {
        analyser.getByteFrequencyData(samples);
        setLevels(
          Array.from(samples.slice(0, 24)).map((value) =>
            Math.max(3, Math.round(value / 5)),
          ),
        );
        animation.current = requestAnimationFrame(draw);
      };
      draw();
      const preferred = [
        "audio/mp4",
        "audio/webm;codecs=opus",
        "audio/webm",
      ].find((type) => MediaRecorder.isTypeSupported(type));
      const active = new MediaRecorder(
        media,
        preferred ? { mimeType: preferred } : undefined,
      );
      recorder.current = active;
      chunks.current = [];
      active.ondataavailable = (e) => {
        if (e.data.size) chunks.current.push(e.data);
      };
      active.onstop = async () => {
        media.getTracks().forEach((track) => track.stop());
        if (animation.current) cancelAnimationFrame(animation.current);
        await context.close();
        setProcessing(true);
        try {
          setDraft(
            await readVoiceExpense(new Blob(chunks.current, { type: active.mimeType }),{categories:data.categories.map(category=>({name:category.name,subcategories:category.subcategories})),accounts:data.accounts.filter(account=>account.active).map(account=>({name:account.name,institution:account.institution,operator:account.operator}))}),
          );
          setMessage("Áudio interpretado. Confira antes de registrar.");
        } catch (error) {
          setMessage((error as Error).message);
        } finally {
          setProcessing(false);
        }
      };
      active.start(500);
      setRecording(true);
    } catch (error) {
      setMessage(
        `Não foi possível acessar o microfone: ${(error as Error).message}`,
      );
    }
  };
  const stop = () => {
    recorder.current?.stop();
    setRecording(false);
    if (animation.current) cancelAnimationFrame(animation.current);
  };
  const save = async () => {
    if (!draft?.descricao || !draft.valor || !draft.data)
      return setMessage("Confira descrição, valor e data.");
    const category = data.categories.find((c) => c.name===draft.categoriaSugerida);
    const account =
      data.accounts.find((a) => a.name===draft.contaOuCartaoSugerido) || data.accounts[0];
    if (!account)
      return setMessage("Cadastre uma conta ou cartão antes de registrar.");
    const amount =
      draft.tipo === "receita"
        ? -Math.abs(Number(draft.valor))
        : Math.abs(Number(draft.valor));
    const base = {
      ...audit(currentMember),
      date: draft.data,
      competence: monthOf(draft.data),
      purchaseDate: draft.data,
      paymentDate: draft.data,
      description: draft.descricao,
      normalized: normalize(draft.descricao),
      amount,
      accountId: account.id,
      operator: (["Olcino","Mari","Ambos"].includes(draft.responsavelSugerido||"")?draft.responsavelSugerido:currentMember) as Member,
      scope: (["Familiar","Pessoal — Olcino","Pessoal — Mari","Transferência interna","Fora do orçamento"].includes(draft.escopoSugerido||"")?draft.escopoSugerido:"Familiar") as Transaction["scope"],
      categoryId: category?.id,
      subcategory: draft.subcategoriaSugerida,
      classification: "confirmed" as const,
      installments: draft.parcelas || 1,
      transfer: draft.tipo === "transferência",
      movement:
        draft.tipo === "aporte"
          ? ("reserve" as const)
          : draft.tipo === "transferência"
            ? ("transfer" as const)
            : ("expense_income" as const),
      sourceKind: "card" as const,
      dedupeKey: "",
      estimated: true,
      notes: `Estimativa por voz: ${draft.transcricao || ""}`,
    };
    base.dedupeKey = await dedupeKey(base);
    mutate((d) => d.transactions.push(base));
    setDraft(undefined);
    setMessage("Estimativa registrada e incluída no acompanhamento do mês.");
  };
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Registrar por voz</h2>
          <p className="muted">O lançamento será uma estimativa editável.</p>
        </div>
        <button
          className={recording ? "danger-button" : "primary"}
          disabled={processing}
          onClick={recording ? stop : start}
        >
          {recording ? (
            <>
              <Square size={17} /> Parar
            </>
          ) : (
            <>
              <Mic size={17} /> {processing ? "Processando…" : "Gravar"}
            </>
          )}
        </button>
      </div>
      <div className="voice-checklist">
        <b>Inclua na gravação:</b>
        <span>1. Valor</span><span>2. Compra ou estabelecimento</span>
        <span>3. Categoria</span><span>4. Conta ou cartão</span>
        <span>5. Quem gastou</span><span>6. Data</span>
      </div>
      {recording && (
        <div className="voice-live">
          <div className="voice-wave" aria-label="Nível do microfone">
            {levels.map((level,index)=><i key={index} style={{height:`${level}px`}} />)}
          </div>
          <small>Gravando — as barras sobem quando o microfone recebe sua voz.</small>
        </div>
      )}
      {draft && (
        <div className="form-stack">
          <h3>Revise o lançamento antes de confirmar</h3>
          <textarea
            value={draft.transcricao || ""}
            onChange={(e) =>
              setDraft({ ...draft, transcricao: e.target.value })
            }
          />
          <input
            value={draft.descricao || ""}
            placeholder="Descrição"
            onChange={(e) => setDraft({ ...draft, descricao: e.target.value })}
          />
          <input
            type="date"
            value={draft.data || ""}
            onChange={(e) => setDraft({ ...draft, data: e.target.value })}
          />
          <CurrencyInput
            value={Number(draft.valor) || 0}
            onChange={(valor) => setDraft({ ...draft, valor })}
          />
          <select
            value={draft.tipo || "despesa"}
            onChange={(e) =>
              setDraft({
                ...draft,
                tipo: e.target.value as VoiceTransaction["tipo"],
              })
            }
          >
            <option value="despesa">Despesa</option>
            <option value="receita">Receita</option>
            <option value="transferência">Transferência</option>
            <option value="aporte">Aporte</option>
          </select>
          <select value={draft.categoriaSugerida||""} onChange={e=>setDraft({...draft,categoriaSugerida:e.target.value,subcategoriaSugerida:data.categories.find(c=>c.name===e.target.value)?.subcategories[0]})}><option value="">Selecione a categoria</option>{data.categories.map(category=><option key={category.id} value={category.name}>{category.name}</option>)}</select>
          <select value={draft.subcategoriaSugerida||""} onChange={e=>setDraft({...draft,subcategoriaSugerida:e.target.value})}><option value="">Selecione a subcategoria</option>{data.categories.find(category=>category.name===draft.categoriaSugerida)?.subcategories.map(subcategory=><option key={subcategory}>{subcategory}</option>)}</select>
          <select value={draft.contaOuCartaoSugerido||""} onChange={e=>setDraft({...draft,contaOuCartaoSugerido:e.target.value})}><option value="">Selecione a conta ou cartão</option>{data.accounts.filter(account=>account.active).map(account=><option key={account.id} value={account.name}>{account.institution} · {account.name}</option>)}</select>
          <select value={draft.responsavelSugerido||currentMember} onChange={e=>setDraft({...draft,responsavelSugerido:e.target.value})}><option>Olcino</option><option>Mari</option><option>Ambos</option></select>
          <select value={draft.escopoSugerido||"Familiar"} onChange={e=>setDraft({...draft,escopoSugerido:e.target.value})}><option>Familiar</option><option>Pessoal — Olcino</option><option>Pessoal — Mari</option><option>Transferência interna</option><option>Fora do orçamento</option></select>
          <button className="primary" onClick={save}>
            Confirmar estimativa
          </button>
        </div>
      )}
    </section>
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
  const [account, setAccount] = useState("");
  const [previews, setPreviews] = useState<Preview[]>([]);
  const [pdfPassword, setPdfPassword] = useState(
    () => sessionStorage.getItem("inter-pdf-password") || "",
  );
  const [rememberPassword, setRememberPassword] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const choose = async (files: File[]) => {
    if (!files.length)
      return;
    try {
      if (rememberPassword && pdfPassword)
        sessionStorage.setItem("inter-pdf-password", pdfPassword);
      else sessionStorage.removeItem("inter-pdf-password");
      const loaded:Preview[]=[];for(let index=0;index<files.length;index++){
        const file=files[index];setMessage(`Processando arquivo ${index+1} de ${files.length}…`);
        const protectedPasswords=!pdfPassword&&/\.pdf$/i.test(file.name)?await getProtectedPdfPasswords(identifyPdfBank(file.name)).catch(()=>[]):[];
        const attempts=/\.pdf$/i.test(file.name)?(pdfPassword?[pdfPassword]:[...protectedPasswords,undefined]):[undefined];
        let lastError:unknown;
        for(const password of attempts){try{loaded.push(await previewFile(file,data,account||undefined,undefined,password));lastError=undefined;break}catch(error){lastError=error}}
        if(lastError)setMessage(`${file.name}: ${(lastError as Error).message}`);
      }setPreviews(loaded);
    } catch (e) {
      setMessage((e as Error).message);
    }
  };
  const confirm = () => {
    if (!previews.length) return;
    mutate((d) => {
      for(const preview of previews){d.transactions.push(...preview.rows);d.imports.push({...audit(preview.operator),filename:preview.filename,hash:preview.hash,institution:preview.institution,count:preview.rows.length,duplicates:preview.duplicates})}
    });
    setMessage(`${previews.reduce((sum,item)=>sum+item.rows.length,0)} lançamentos de ${previews.length} arquivo(s) importados.`);
    setPreviews([]);
  };
  return (
    <section className="panel">
      <h2>Importar extrato ou fatura</h2>
      <p className="muted">PDF, CSV, XLS ou XLSX · o banco, a conta e o titular serão identificados automaticamente.</p>
      <div className="form-row">
        <select value={account} onChange={(e) => setAccount(e.target.value)}>
          <option value="">Identificar conta e titular automaticamente</option>
          {data.accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.institution} · {a.name}
            </option>
          ))}
        </select>
        <input
          type="password"
          value={pdfPassword}
          onChange={(e) => setPdfPassword(e.target.value)}
          placeholder="Senha manual (somente se o automático falhar)"
          autoComplete="off"
        />
        <label>
          <input
            type="checkbox"
            checked={rememberPassword}
            onChange={(e) => setRememberPassword(e.target.checked)}
          />
          Lembrar somente até fechar o navegador
        </label>
        <input
          ref={input}
          type="file"
          accept=".pdf,.csv,.xls,.xlsx,.xlsm"
          multiple
          hidden
          onChange={(e) => choose(Array.from(e.target.files||[]))}
        />
        <button className="primary" onClick={() => input.current?.click()}>
          <Upload size={17} /> Escolher arquivo
        </button>
      </div>
      {previews.length>0 && (
        <>
          {previews.map(preview=><div key={preview.hash}><div className="summary"><b>{preview.filename}</b><span className="status confirmed">{preview.institution} · {data.accounts.find(a=>a.id===preview.accountId)?.name} · {preview.operator}</span><span>{preview.rows.length} novos</span><span>{preview.duplicates} duplicados ignorados</span><span>{preview.rows.filter(r=>r.classification==="suggested").length} sugestões</span><small>Identificado por: {preview.detectedBy}</small></div><TransactionTable rows={preview.rows.slice(0,20)} data={data}/></div>)}
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
      <table className="transactions-table">
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
  const [filter, setFilter] = useState("review");
  const [selected,setSelected]=useState<Set<string>>(new Set());
  const [bulkCategory,setBulkCategory]=useState("");
  const undoTransactions=useRef<Transaction[]>();
  const [startDate, setStartDate] = useState(`${month}-01`);
  const [endDate, setEndDate] = useState(`${month}-31`);
  useEffect(() => {
    setStartDate(`${month}-01`);
    setEndDate(`${month}-31`);
  }, [month]);
  const rows = data.transactions.filter(
    (t) =>
      t.date >= startDate &&
      t.date <= endDate &&
      (filter === "all" || (filter==="review"?t.classification!=="confirmed":t.classification === filter)),
  );
  const update = (id: string, patch: Partial<Transaction>, learn = false) =>
    mutate((d) => {
      const t = d.transactions.find((x) => x.id === id)!;
      Object.assign(t, patch, { updatedAt: now(), version: t.version + 1 });
      if (learn) upsertRule(d, t);
    });
  const remove = (id: string) => {
    if (
      confirm(
        "Excluir este lançamento? Esta ação será registrada apenas após salvar.",
      )
    )
      mutate((d) => {
        d.transactions = d.transactions.filter((t) => t.id !== id);
      });
  };
  const selectedRows=rows.filter(row=>selected.has(row.id));
  const remember=()=>{undoTransactions.current=structuredClone(data.transactions)};
  const bulkApply=(action:"confirm"|"category"|"delete")=>{if(!selectedRows.length)return;const total=selectedRows.reduce((sum,row)=>sum+Math.abs(row.amount),0);if(!confirm(`${action==="delete"?"Excluir":"Alterar"} ${selectedRows.length} lançamento(s), total ${money(total)}?`))return;remember();mutate(d=>{if(action==="delete")d.transactions=d.transactions.filter(row=>!selected.has(row.id));else d.transactions.filter(row=>selected.has(row.id)).forEach(row=>{if(action==="confirm")row.classification="confirmed";if(action==="category"){const category=d.categories.find(c=>c.id===bulkCategory);row.categoryId=bulkCategory;row.subcategory=category?.subcategories[0];row.classification="confirmed"}row.updatedAt=now();row.version++})});setSelected(new Set())};
  const undoBulk=()=>{if(!undoTransactions.current)return;const snapshot=undoTransactions.current;mutate(d=>{d.transactions=snapshot});undoTransactions.current=undefined};
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
          <option value="review">A revisar</option>
          <option value="pending">Pendentes</option>
          <option value="suggested">Sugeridos</option>
          <option value="confirmed">Confirmados</option>
          <option value="all">Todos</option>
        </select>
      </div>
      <div className="form-row date-range">
        <label>
          De
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </label>
        <label>
          Até
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </label>
      </div>
      <div className="bulk-toolbar"><label><input type="checkbox" checked={rows.length>0&&selectedRows.length===rows.length} onChange={e=>setSelected(e.target.checked?new Set(rows.map(row=>row.id)):new Set())}/> Selecionar todos os filtrados</label><b>{selectedRows.length} selecionado(s) · {money(selectedRows.reduce((sum,row)=>sum+Math.abs(row.amount),0))}</b><button onClick={()=>bulkApply("confirm")}>Confirmar em massa</button><select value={bulkCategory} onChange={e=>setBulkCategory(e.target.value)}><option value="">Categoria em massa</option>{data.categories.map(category=><option key={category.id} value={category.id}>{category.name}</option>)}</select><button disabled={!bulkCategory} onClick={()=>bulkApply("category")}>Aplicar categoria</button><button className="danger-button" onClick={()=>bulkApply("delete")}>Excluir selecionados</button>{undoTransactions.current&&<button onClick={undoBulk}>Desfazer última operação</button>}</div>
      <div className="transaction-list">
        {rows.map((t) => (
          <div className={`transaction-edit ${t.classification==="confirmed"?"confirmed-item":""}`} key={t.id}>
            <input type="checkbox" checked={selected.has(t.id)} onChange={e=>setSelected(current=>{const next=new Set(current);e.target.checked?next.add(t.id):next.delete(t.id);return next})}/>
            <div className="tx-main">
              <input value={t.description} onChange={e=>update(t.id,{description:e.target.value,normalized:normalize(e.target.value)})}/>
              <div className="tx-core-fields"><input type="date" value={t.date} onChange={e=>update(t.id,{date:e.target.value,paymentDate:e.target.value,competence:monthOf(e.target.value)})}/><CurrencyInput value={Math.abs(t.amount)} onChange={value=>update(t.id,{amount:t.amount<0?-Math.abs(value):Math.abs(value)})}/></div>
              <small>{t.estimated?"Estimativa por voz · ":""}{t.classification==="confirmed"?"Confirmado":"Em revisão"}</small>
            </div>
            <select value={t.accountId} onChange={e=>update(t.id,{accountId:e.target.value})}>{data.accounts.filter(account=>account.active).map(account=><option key={account.id} value={account.id}>{account.institution} · {account.name}</option>)}</select>
            <select value={t.operator} onChange={e=>update(t.id,{operator:e.target.value as Member})}><option>Olcino</option><option>Mari</option><option>Ambos</option></select>
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
            {t.classification!=="confirmed"?<button title="Confirmar e aprender" className="icon" onClick={()=>update(t.id,{classification:"confirmed"},true)}><CheckCircle2/></button>:<button title="Desconfirmar" onClick={()=>update(t.id,{classification:"suggested"})}>Desconfirmar</button>}
            <button
              title="Excluir lançamento"
              className="icon danger-button transaction-delete"
              onClick={() => remove(t.id)}
            >
              <Trash2 size={19} />
              <span>Excluir</span>
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
    const startMonth = String(form.get("startMonth"));
    const endMonth = String(form.get("endMonth") || "");
    const amount = parseCurrency(form.get("amount"));
    if (!target) return alert("Selecione uma categoria, conta ou pessoa.");
    if (amount <= 0) return alert("O orçamento precisa ser maior que zero.");
    if (endMonth && endMonth < startMonth)
      return alert("O mês final não pode ser anterior ao início.");
    mutate((draft) => {
      const existing =
        editing && draft.budgets.find((item) => item.id === editing.id);
      const item: Budget = existing || {
        ...audit(),
        month: String(form.get("startMonth")),
        amount: 0,
      };
      item.amount = amount;
      item.month = startMonth;
      item.startMonth = startMonth;
      item.endMonth = endMonth || undefined;
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
  const remove = (id: string) => {
    if (!confirm("Excluir este orçamento?")) return;
    mutate((draft) => {
      draft.budgets = draft.budgets.filter((item) => item.id !== id);
    });
  };
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
            <MoneyInput
              key={editing?.id || data.budgets.length}
              name="amount"
              required
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
        planned: parseCurrency(fd.get("planned")),
        dueDate: String(fd.get("due")),
        recurrence: String(fd.get("repeat")) as Obligation["recurrence"],
        tolerance: parseCurrency(fd.get("tolerance")),
        accountId: String(fd.get("accountId") || "") || undefined,
        status: "A pagar",
      }),
    );
  const mark = (id: string) => {
    const current=data.obligations.find(o=>o.id===id)!;
    const raw=prompt("Valor efetivamente pago:",money(current.planned)); if(raw===null)return;
    const paidAmount=parseCurrency(raw); if(paidAmount<=0)return alert("Informe um valor maior que zero.");
    const paidAt=prompt("Data efetiva do pagamento (AAAA-MM-DD):",dateOnly(new Date())); if(!paidAt||!/^\d{4}-\d{2}-\d{2}$/.test(paidAt))return alert("Data inválida.");
    const account=current.accountId||data.accounts[0]?.id; if(!account)return alert("Cadastre uma conta para o pagamento.");
    mutate(d=>{const o=d.obligations.find(x=>x.id===id)!;o.status="Paga";o.paidAt=paidAt;o.paidAmount=paidAmount;const rule=suggest(o.name,account,"Ambos",d.rules);d.transactions=d.transactions.filter(t=>t.obligationId!==id);d.transactions.push({...audit("Ambos"),date:paidAt,competence:monthOf(paidAt),purchaseDate:o.dueDate,paymentDate:paidAt,description:o.name,normalized:normalize(o.name),amount:paidAmount,accountId:account,operator:"Ambos",scope:"Familiar",categoryId:rule?.categoryId,subcategory:rule?.subcategory,classification:rule?"suggested":"pending",dedupeKey:`payment:${id}:${paidAt}`,transfer:false,movement:"expense_income",sourceKind:"statement",obligationId:id,notes:`Pagamento realizado. Previsto: ${money(o.planned)}`})});
  };
  const edit = (id: string) => {
    const current = data.obligations.find((o) => o.id === id)!;
    const name = prompt("Nome do compromisso:", current.name);
    if (!name) return;
    const planned = prompt("Valor planejado:", money(current.planned));
    if (planned === null) return;
    const due = prompt("Vencimento (AAAA-MM-DD):", current.dueDate);
    if (!due || !/^\d{4}-\d{2}-\d{2}$/.test(due))
      return alert("Use a data no formato AAAA-MM-DD.");
    const kind = prompt("Tipo do compromisso:", current.kind) as
      | Obligation["kind"]
      | null;
    if (!kind) return;
    const recurrence = prompt(
      "Repetição: none, monthly ou yearly",
      current.recurrence,
    ) as Obligation["recurrence"] | null;
    if (!recurrence || !["none", "monthly", "yearly"].includes(recurrence))
      return alert("Repetição inválida.");
    const tolerance = prompt("Tolerância de valor:", money(current.tolerance));
    if (tolerance === null) return;
    mutate((d) => {
      const o = d.obligations.find((x) => x.id === id)!;
      o.name = name;
      o.planned = parseCurrency(planned);
      o.dueDate = due;
      o.kind = kind;
      o.recurrence = recurrence;
      o.tolerance = parseCurrency(tolerance);
      o.updatedAt = now();
      o.version++;
    });
  };
  const remove = (id: string) => {
    if (confirm("Excluir este compromisso?"))
      mutate((d) => {
        d.obligations = d.obligations.filter((o) => o.id !== id);
      });
  };
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
              <select name="accountId"><option value="">Conta do pagamento</option>{data.accounts.filter(account=>account.active).map(account=><option key={account.id} value={account.id}>{account.institution} · {account.name}</option>)}</select>
            </>
          }
        />
      )}
      <div className="payment-grid">
        {data.obligations
          .slice()
          .filter(o=>!["Paga","Confirmada","Dispensada"].includes(o.status))
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
                <div className="actions payment-actions">
                  <button onClick={() => edit(o.id)}>Editar</button>
                  <button
                    className="danger-button"
                    onClick={() => remove(o.id)}
                  >
                    <Trash2 size={15} /> Excluir
                  </button>
                </div>
              </article>
            );
          })}
      </div>
      <details className="completed-block"><summary>Pagamentos confirmados ({data.obligations.filter(o=>["Paga","Confirmada","Dispensada"].includes(o.status)).length})</summary>{data.obligations.filter(o=>["Paga","Confirmada","Dispensada"].includes(o.status)).sort((a,b)=>b.dueDate.localeCompare(a.dueDate)).map(o=><div className="confirmed-row" key={o.id}><div><b>{o.name}</b><small>{o.dueDate} · {money(o.paidAmount??o.planned)} · {o.status}</small></div><button onClick={()=>mutate(d=>{const item=d.obligations.find(x=>x.id===o.id);if(item){item.status="A pagar";item.paidAt=undefined;item.paidAmount=undefined;d.transactions=d.transactions.filter(transaction=>transaction.obligationId!==o.id)}})}>Desconfirmar</button></div>)}</details>
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
  const add = (fd: FormData) => {
    const target = parseCurrency(fd.get("target")),
      minimum = parseCurrency(fd.get("minimum"));
    const startDate = String(fd.get("startDate")),
      deadline = String(fd.get("deadline"));
    if (target <= 0) return alert("O valor-alvo precisa ser maior que zero.");
    if (minimum < 0) return alert("O aporte não pode ser negativo.");
    if (deadline < startDate)
      return alert("O prazo final precisa ser posterior à data inicial.");
    mutate((d) =>
      d.goals.push({
        ...audit(),
        name: String(fd.get("name")),
        kind: String(fd.get("kind") || "desire") as "provision" | "desire",
        target,
        startDate,
        deadline,
        minimum,
        priority: d.goals.length + 1,
        emergency: false,
        active: true,
        movements: [],
      }),
    );
  };
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
          amount: parseCurrency(raw),
        }),
    );
  };
  const edit = (id: string) => {
    const g = data.goals.find((x) => x.id === id)!;
    const name = prompt("Nome:", g.name);
    if (!name) return;
    const target = prompt("Valor-alvo:", money(g.target));
    if (target === null) return;
    const minimum = prompt("Aporte mensal:", money(g.minimum));
    if (minimum === null) return;
    const startDate = prompt(
      "Data inicial (AAAA-MM-DD):",
      g.startDate || dateOnly(new Date()),
    );
    if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate))
      return alert("Use a data inicial no formato AAAA-MM-DD.");
    const deadline = prompt("Prazo final (AAAA-MM-DD):", g.deadline);
    if (
      !deadline ||
      !/^\d{4}-\d{2}-\d{2}$/.test(deadline) ||
      deadline < startDate
    )
      return alert("A data final precisa ser válida e posterior ao início.");
    mutate((d) => {
      const item = d.goals.find((x) => x.id === id)!;
      item.name = name;
      item.target = parseCurrency(target);
      item.minimum = parseCurrency(minimum);
      item.startDate = startDate;
      item.deadline = deadline;
      item.updatedAt = now();
      item.version++;
    });
  };
  const remove = (id: string) => {
    if (confirm("Excluir esta meta e seu histórico de aportes?"))
      mutate((d) => {
        d.goals = d.goals.filter((g) => g.id !== id);
      });
  };
  const setKind = (id: string, kind: "provision" | "desire") =>
    mutate((d) => {
      d.goals.find((g) => g.id === id)!.kind = kind;
    });
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
            ["startDate", "Data inicial", "date"],
            ["deadline", "Prazo", "date"],
          ]}
          extras={
            <select name="kind">
              <option value="provision">Provisão para despesa</option>
              <option value="desire">Meta de desejo</option>
            </select>
          }
        />
      )}
      {(["provision", "desire"] as const).map((kind) => (
        <div key={kind} className="goal-section">
          <h2>
            {kind === "provision"
              ? "Provisões para despesas"
              : "Metas de desejos"}
          </h2>
          <div className="goals">
            {data.goals
              .filter((g) => (g.kind || "desire") === kind)
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
                        <small>
                          {g.startDate || "Início não informado"} até{" "}
                          {g.deadline}
                        </small>
                      </div>
                      <strong>
                        {Math.max(
                          0,
                          Math.round((total / (g.target || 1)) * 100),
                        )}
                        %
                      </strong>
                    </div>
                    <progress value={total} max={g.target || 1} />
                    <div className="goal-foot">
                      <span>
                        {money(total)} de {money(g.target)}
                      </span>
                      <button onClick={() => move(g.id)}>
                        Registrar aporte
                      </button>
                    </div>
                    <div className="actions goal-actions">
                      <button onClick={() => edit(g.id)}>Editar</button>
                      <select
                        aria-label="Tipo da meta"
                        value={g.kind || "desire"}
                        onChange={(e) =>
                          setKind(
                            g.id,
                            e.target.value as "provision" | "desire",
                          )
                        }
                      >
                        <option value="provision">Provisão</option>
                        <option value="desire">Desejo</option>
                      </select>
                      <button
                        className="danger-button"
                        onClick={() => remove(g.id)}
                      >
                        <Trash2 size={15} /> Excluir
                      </button>
                    </div>
                  </article>
                );
              })}
          </div>
        </div>
      ))}
    </section>
  );
}

function Tasks({
  data,
  mutate,
  currentMember,
}: {
  data: FamilyData;
  mutate: (f: (d: FamilyData) => void) => void;
  currentMember: "Olcino" | "Mari";
}) {
  const [show, setShow] = useState(false);
  const migratedResponsibilities = useRef(false);
  useEffect(() => {
    if (migratedResponsibilities.current) return;
    migratedResponsibilities.current = true;
    mutate((d) => {
      const existing = new Set(d.tasks.map((t) => normalize(t.title)));
      const source = d.chores?.length
        ? d.chores
        : initialChores.map((title) => ({
            title,
            assignee: "Ambos" as Member,
            frequency: "weekly" as const,
            completionHistory: [],
          }));
      for (const chore of source) {
        if (existing.has(normalize(chore.title))) continue;
        d.tasks.push({
          ...audit(),
          title: chore.title,
          assignee: chore.assignee,
          due: new Date().toISOString(),
          priority: "Média",
          status: "Pendente",
          repeat:
            chore.frequency === "daily"
              ? "daily"
              : chore.frequency === "monthly"
                ? "monthly"
                : "weekly",
          shift: "Livre",
          weekdays: chore.frequency === "weekly" ? [1] : undefined,
          checklist: [],
          history: chore.completionHistory || [],
        });
      }
      d.chores = [];
    });
  }, []);
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
        shift: String(fd.get("shift") || "Livre") as Task["shift"],
        weekdays: fd.getAll("weekday").map(Number),
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
        if (t.repeat === "weekly" && t.weekdays?.length) {
          do {
            dt.setDate(dt.getDate() + 1);
          } while (!t.weekdays.includes(dt.getDay()));
        } else if (t.repeat === "weekly") dt.setDate(dt.getDate() + 7);
        if (t.repeat === "monthly") dt.setMonth(dt.getMonth() + 1);
        if (t.repeat === "yearly") dt.setFullYear(dt.getFullYear() + 1);
        t.due = dt.toISOString();
      }
    });
  const edit = (id: string) => {
    const task = data.tasks.find((t) => t.id === id)!;
    const title = prompt("Título da tarefa:", task.title);
    if (!title) return;
    const due = prompt(
      "Data e hora (AAAA-MM-DDTHH:MM):",
      task.due.slice(0, 16),
    );
    if (!due || Number.isNaN(new Date(due).getTime()))
      return alert("Data e hora inválidas.");
    const assignee = prompt(
      "Responsável: Olcino, Mari ou Ambos",
      task.assignee,
    ) as Member | null;
    if (!assignee || !["Olcino", "Mari", "Ambos"].includes(assignee))
      return alert("Responsável inválido.");
    const repeat = prompt(
      "Repetição: none, daily, weekly, monthly ou yearly",
      task.repeat,
    ) as Task["repeat"] | null;
    if (
      !repeat ||
      !["none", "daily", "weekly", "monthly", "yearly"].includes(repeat)
    )
      return alert("Repetição inválida.");
    mutate((d) => {
      const item = d.tasks.find((t) => t.id === id)!;
      item.title = title;
      item.due = new Date(due).toISOString();
      item.assignee = assignee;
      item.repeat = repeat;
      const shift = prompt(
        "Turno: Manhã, Tarde, Noite ou Livre",
        item.shift || "Livre",
      ) as Task["shift"] | null;
      if (shift) item.shift = shift;
      const days = prompt(
        "Dias da semana (0=dom, 1=seg ... 6=sáb), separados por vírgula",
        (item.weekdays || []).join(","),
      );
      if (days !== null)
        item.weekdays = days
          .split(",")
          .map(Number)
          .filter((n) => n >= 0 && n <= 6);
      item.updatedAt = now();
      item.version++;
    });
  };
  const remove = (id: string) => {
    if (confirm("Excluir esta tarefa e seu histórico?"))
      mutate((d) => {
        d.tasks = d.tasks.filter((t) => t.id !== id);
      });
  };
  const active = data.tasks
    .filter((t) => t.status !== "Concluída")
    .slice()
    .sort((a, b) => a.due.localeCompare(b.due));
  const completedOccurrences=data.tasks.flatMap(task=>task.history.map((completedAt,index)=>({task,completedAt,index}))).sort((a,b)=>b.completedAt.localeCompare(a.completedAt));
  const undoCompletion=(taskId:string,index:number,completedAt:string)=>mutate(d=>{const task=d.tasks.find(item=>item.id===taskId);if(!task)return;task.history.splice(index,1);task.status="Pendente";task.due=completedAt;task.updatedAt=now();task.version++});
  const dayNames = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
  const renderTasks = (items: Task[]) => (
    <div className="task-list">
      {items.map((t) => (
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
              {t.shift || "Livre"}
              {t.weekdays?.length
                ? ` · ${t.weekdays.map((d) => dayNames[d]).join(", ")}`
                : ""}
            </small>
          </div>
          <Badge text={t.priority} />
          <div className="actions task-actions">
            <button onClick={() => edit(t.id)}>Editar</button>
            <button className="danger-button" onClick={() => remove(t.id)}>
              <Trash2 size={15} /> Excluir
            </button>
          </div>
        </article>
      ))}
    </div>
  );
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
              <select name="shift">
                <option>Livre</option>
                <option>Manhã</option>
                <option>Tarde</option>
                <option>Noite</option>
              </select>
              <fieldset className="weekday-picker">
                <legend>Dias da semana</legend>
                {dayNames.map((day, index) => (
                  <label key={day}>
                    <input type="checkbox" name="weekday" value={index} />
                    {day}
                  </label>
                ))}
              </fieldset>
            </>
          }
        />
      )}
      <h3>Minhas responsabilidades e tarefas</h3>
      {renderTasks(
        active.filter(
          (t) => t.assignee === currentMember || t.assignee === "Ambos",
        ),
      )}
      <h3>Outras responsabilidades e tarefas</h3>
      {renderTasks(
        active.filter(
          (t) => t.assignee !== currentMember && t.assignee !== "Ambos",
        ),
      )}
      <details className="completed-block"><summary>Concluídas ({completedOccurrences.length})</summary>{completedOccurrences.map(item=><div className="confirmed-row" key={`${item.task.id}-${item.completedAt}`}><div><b>{item.task.title}</b><small>{new Date(item.completedAt).toLocaleString("pt-BR")} · {item.task.assignee}</small></div><button onClick={()=>undoCompletion(item.task.id,item.index,item.completedAt)}>Desfazer conclusão</button></div>)}</details>
    </section>
  );
}

function Config({
  data,
  setData,
  mutate,
  connect,
  setMessage,
  mode = "all",
}: {
  data: FamilyData;
  setData: (d: FamilyData) => void;
  mutate: (f: (d: FamilyData) => void) => void;
  connect: () => void;
  setMessage: (s: string) => void;
  mode?: "all" | "accounts" | "categories";
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
        importAliases: String(fd.get("importAliases") || "").split(",").map(value=>value.trim()).filter(Boolean),
        lastDigits: String(fd.get("lastDigits") || "").replace(/\D/g, "").slice(-4) || undefined,
      }),
    );
  const editAccount = (id: string) => {
    const a = data.accounts.find((x) => x.id === id)!;
    const name = prompt("Nome da conta/cartão:", a.name);
    if (!name) return;
    const institution = prompt("Instituição:", a.institution);
    if (!institution) return;
    const kind = prompt("Tipo: checking, card, investment ou cash", a.kind) as
      | Account["kind"]
      | null;
    if (!kind || !["checking", "card", "investment", "cash"].includes(kind))
      return alert("Tipo inválido.");
    const operator = prompt(
      "Responsável: Olcino, Mari ou Ambos",
      a.operator,
    ) as Member | null;
    if (!operator || !["Olcino", "Mari", "Ambos"].includes(operator))
      return alert("Responsável inválido.");
    const aliases = prompt(
      "Identificadores para importação, separados por vírgula (nome completo do titular, apelido no arquivo etc.):",
      (a.importAliases || []).join(", "),
    );
    if (aliases === null) return;
    const lastDigits = prompt("Últimos 4 dígitos da conta/cartão (opcional):", a.lastDigits || "");
    if (lastDigits === null) return;
    mutate((d) => {
      const item = d.accounts.find((x) => x.id === id)!;
      item.name = name;
      item.institution = institution;
      item.kind = kind;
      item.operator = operator;
      item.importAliases = aliases.split(",").map(value=>value.trim()).filter(Boolean);
      item.lastDigits = lastDigits.replace(/\D/g, "").slice(-4) || undefined;
      item.updatedAt = now();
      item.version++;
    });
  };
  const removeAccount = (id: string) => {
    const used =
      data.transactions.some((t) => t.accountId === id) ||
      data.budgets.some((b) => b.accountId === id);
    if (used)
      return alert(
        "Esta conta possui lançamentos ou orçamentos. Desative-a ou remova os vínculos antes de excluir.",
      );
    if (confirm("Excluir esta conta/cartão?"))
      mutate((d) => {
        d.accounts = d.accounts.filter((a) => a.id !== id);
      });
  };
  return (
    <div className="grid two">
      {mode !== "categories" && (
        <section className="panel">
          <h2>Contas e cartões</h2>
          <p className="muted">Defina uma vez banco, tipo e titular. Nas próximas importações o aplicativo fará a associação automaticamente.</p>
          <QuickForm
            onSubmit={addAccount}
            fields={[
              ["name", "Nome da conta/cartão", "text"],
              ["institution", "Instituição", "text"],
              ["importAliases", "Nome do titular ou texto presente no arquivo", "text"],
              ["lastDigits", "Final da conta/cartão (4 dígitos)", "text"],
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
                  <option value="Olcino">Titular/uso: Olcino</option>
                  <option value="Mari">Titular/uso: Mari</option>
                  <option value="Ambos">Titular/uso: Ambos</option>
                </select>
              </>
            }
          />
          <div className="list">
            {data.accounts.map((a) => (
              <div className="row editable-row" key={a.id}>
                <div>
                  <b>{a.name}</b>
                  <small>
                    {a.institution} · {a.operator} · {a.kind}
                    {(a.lastDigits || a.importAliases?.length) && <> · reconhecimento: {[a.lastDigits&&`final ${a.lastDigits}`,...(a.importAliases||[])].filter(Boolean).join(", ")}</>}
                  </small>
                </div>
                <div className="actions">
                  <button onClick={() => editAccount(a.id)}>Editar</button>
                  <button
                    className="danger-button"
                    onClick={() => removeAccount(a.id)}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
      {mode !== "accounts" && (
        <section className="panel">
          <h2>Categorias</h2>
          <p className="muted">
            {data.categories.length} categorias · {data.rules.length} regras
            aprendidas
          </p>
          <CategoryEditor data={data} mutate={mutate} />
        </section>
      )}
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
  const [bulkText,setBulkText]=useState("");
  const bulkRows=bulkText.split(/\r?\n/).map(line=>line.split(/[;,\t]/).map(value=>value.trim())).filter(row=>row[0]);
  const createBulk=()=>{if(!bulkRows.length)return;const preview=bulkRows.slice(0,5).map(row=>`${row[0]} > ${row[1]||"sem subcategoria"}`).join("\n");if(!confirm(`Criar/atualizar ${bulkRows.length} linha(s)?\n\n${preview}${bulkRows.length>5?"\n…":""}`))return;mutate(d=>{for(const [name,subcategory,natureRaw] of bulkRows){let category=d.categories.find(c=>normalize(c.name)===normalize(name));if(!category){const nature=normalize(natureRaw||"DESPESA");category={...audit(),name,subcategories:[],nature:nature.includes("RECEITA")?"income":nature.includes("TRANSFER")?"transfer":nature.includes("META")?"goal":"expense"};d.categories.push(category)}if(subcategory&&!category.subcategories.some(item=>normalize(item)===normalize(subcategory)))category.subcategories.push(subcategory)}});setBulkText("")};
  const addCategory = (fd: FormData) =>
    mutate((d) =>
      d.categories.push({
        ...audit(),
        name: String(fd.get("name")),
        nature: String(fd.get("nature")) as
          | "expense"
          | "income"
          | "transfer"
          | "goal",
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
  const removeCategory = (id: string) => {
    const used =
      data.transactions.some((t) => t.categoryId === id) ||
      data.budgets.some((b) => b.categoryId === id);
    if (used)
      return alert(
        "Esta categoria está em uso. Reclassifique os lançamentos e orçamentos antes de excluir.",
      );
    if (confirm("Excluir esta categoria?"))
      mutate((d) => {
        d.categories = d.categories.filter((c) => c.id !== id);
        d.rules = d.rules.filter((r) => r.categoryId !== id);
      });
  };
  const removeSub = (id: string, sub: string) => {
    if (
      data.transactions.some(
        (t) => t.categoryId === id && t.subcategory === sub,
      )
    )
      return alert("Esta subcategoria está em uso e não pode ser excluída.");
    if (confirm(`Excluir a subcategoria ${sub}?`))
      mutate((d) => {
        const c = d.categories.find((x) => x.id === id)!;
        c.subcategories = c.subcategories.filter((s) => s !== sub);
      });
  };
  return (
    <>
      <div className="bulk-category"><h3>Criar categorias em massa</h3><p className="muted">Cole uma linha por subcategoria: Categoria; Subcategoria; Natureza.</p><textarea rows={6} value={bulkText} onChange={e=>setBulkText(e.target.value)} placeholder={'Alimentação;Supermercado;Despesa\nReceitas;Salário;Receita'}/><small>{bulkRows.length} linha(s) válida(s)</small><button className="primary" disabled={!bulkRows.length} onClick={createBulk}>Pré-visualizar e criar</button></div>
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
            <button
              className="danger-button"
              onClick={() => removeCategory(c.id)}
            >
              <Trash2 size={15} /> Excluir
            </button>
          </div>
          <div className="subcategories">
            {c.subcategories.map((s) => (
              <span className="sub-item" key={s}>
                <button onClick={() => renameSub(c.id, s)}>{s}</button>
                <button
                  className="danger-button"
                  onClick={() => removeSub(c.id, s)}
                  aria-label={`Excluir ${s}`}
                >
                  <Trash2 size={13} />
                </button>
              </span>
            ))}
          </div>
        </details>
      ))}
    </>
  );
}

function Analytics({ data }: { data: FamilyData }) {
  const available = [
    ...new Set(data.transactions.map((t) => monthOf(t.paymentDate || t.date))),
  ].sort();
  const [start, setStart] = useState(available[0] || currentMonth());
  const [end, setEnd] = useState(available.at(-1) || currentMonth());
  const [mode, setMode] = useState<"cash" | "accrual">("accrual");
  const [report, setReport] = useState<"budget" | "reserve" | "final">(
    "budget",
  );
  const [accountId, setAccountId] = useState("all");
  const months = available.filter((month) => month >= start && month <= end);
  const belongs = (t: Transaction, kind: "budget" | "reserve" | "final") =>
    (accountId === "all" || t.accountId === accountId) &&
    (kind === "final"
      ? t.movement !== "transfer" && !t.transfer
      : kind === "reserve"
        ? t.movement === "reserve"
        : (t.movement || "expense_income") === "expense_income" && !t.transfer);
  const rows = months.map((month) => {
    const relevant = data.transactions.filter((t) => belongs(t, report));
    const income = relevant
      .filter((t) => t.amount < 0)
      .reduce((s, t) => s + Math.abs(realized(t, month, mode)), 0);
    const expense = relevant
      .filter((t) => t.amount > 0)
      .reduce((s, t) => s + Math.abs(realized(t, month, mode)), 0);
    const budgetPlan = budgetValue(data, month, (b) => !b.member);
    const reservePlan = data.goals
      .filter((g) => g.active)
      .reduce((s, g) => s + g.minimum, 0);
    const planned =
      report === "reserve"
        ? reservePlan
        : report === "final"
          ? budgetPlan + reservePlan
          : budgetPlan;
    const realizedValue = report === "budget" ? expense - income : expense;
    return {
      month,
      income,
      expense,
      planned,
      realized: realizedValue,
      result: planned - realizedValue,
    };
  });
  const max = Math.max(
    1,
    ...rows.flatMap((r) => [r.realized, r.planned, Math.abs(r.result)]),
  );
  const categoryRows = data.categories
    .map((category) => {
      const actual = data.transactions
        .filter((t) => t.categoryId === category.id && belongs(t, report))
        .reduce(
          (s, t) =>
            months.reduce(
              (m, month) => m + Math.abs(realized(t, month, mode)),
              s,
            ),
          0,
        );
      return { name: category.name, actual };
    })
    .filter((x) => x.actual)
    .sort((a, b) => b.actual - a.actual)
    .slice(0, 10);
  const totalPlanned = rows.reduce((s, r) => s + r.planned, 0),
    totalRealized = rows.reduce((s, r) => s + r.realized, 0),
    totalResult = totalPlanned - totalRealized;
  const accountRows = data.accounts
    .map((account) => {
      const actual = data.transactions
        .filter((t) => t.accountId === account.id && belongs(t, report))
        .reduce(
          (sum, t) =>
            months.reduce(
              (value, current) => value + Math.abs(realized(t, current, mode)),
              sum,
            ),
          0,
        );
      return { account, actual };
    })
    .filter((row) => row.actual)
    .sort((a, b) => b.actual - a.actual);
  return (
    <>
      <section className="bi-controls">
        <div className="segmented">
          <button
            className={report === "budget" ? "on" : ""}
            onClick={() => setReport("budget")}
          >
            Orçamento mensal
          </button>
          <button
            className={report === "reserve" ? "on" : ""}
            onClick={() => setReport("reserve")}
          >
            Reservas
          </button>
          <button
            className={report === "final" ? "on" : ""}
            onClick={() => setReport("final")}
          >
            Resultado final
          </button>
        </div>
        <label>
          De
          <input
            type="month"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
        <label>
          Até
          <input
            type="month"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </label>
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as "cash" | "accrual")}
        >
          <option value="accrual">Data da compra</option>
          <option value="cash">Data da parcela</option>
        </select>
        <select
          value={accountId}
          onChange={(event) => setAccountId(event.target.value)}
          aria-label="Filtrar conta ou cartão"
        >
          <option value="all">Todas as contas e cartões</option>
          {data.accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </select>
      </section>
      <section className="cards">
        <Card
          label="Planejado"
          value={money(totalPlanned)}
          hint={`${rows.length} competências`}
        />
        <Card
          label="Realizado"
          value={money(totalRealized)}
          hint={mode === "cash" ? "Por parcela" : "Na compra"}
        />
        <Card
          label="Resultado"
          value={money(totalResult)}
          hint="Planejado menos realizado"
          tone={totalResult >= 0 ? "good" : "bad"}
        />
        <Card
          label="Entradas"
          value={money(rows.reduce((s, r) => s + r.income, 0))}
          hint="Sem transferências internas"
        />
      </section>
      <section className="grid bi-grid">
        <div className="panel analytics">
          <div className="panel-head">
            <div>
              <h2>Por mês</h2>
              <p className="muted">Planejado, realizado e resultado.</p>
            </div>
            <div className="legend">
              <span className="planned">Planejado</span>
              <span className="realized">Realizado</span>
              <span className="result">Resultado</span>
            </div>
          </div>
          <div className="chart">
            {rows.map((r) => (
              <div className="chart-column" key={r.month}>
                <div className="chart-bars">
                  <i
                    className="planned"
                    style={{ height: `${(r.planned / max) * 100}%` }}
                    title={`Planejado ${money(r.planned)}`}
                  />
                  <i
                    className="realized"
                    style={{ height: `${(r.realized / max) * 100}%` }}
                    title={`Realizado ${money(r.realized)}`}
                  />
                  <i
                    className={`result ${r.result < 0 ? "bad" : ""}`}
                    style={{ height: `${(Math.abs(r.result) / max) * 100}%` }}
                    title={`Resultado ${money(r.result)}`}
                  />
                </div>
                <small>
                  {r.month.slice(5)}/{r.month.slice(2, 4)}
                </small>
              </div>
            ))}
          </div>
          {!rows.length && <Empty />}
        </div>
        <div className="panel category-ranking">
          <h2>Acumulado por categoria</h2>
          {categoryRows.map((row) => (
            <div key={row.name}>
              <label>
                <span>{row.name}</span>
                <b>{money(row.actual)}</b>
              </label>
              <progress value={row.actual} max={categoryRows[0]?.actual || 1} />
            </div>
          ))}
        </div>
      </section>
      {report === "reserve" && (
        <section className="panel goals-bi">
          <h2>Acumulado × meta</h2>
          <div className="goal-columns">
            {data.goals
              .filter((g) => g.active)
              .map((g) => {
                const accumulated = g.movements.reduce(
                  (s, m) => s + m.amount,
                  0,
                );
                const maxGoal = Math.max(g.target, accumulated, 1);
                return (
                  <div key={g.id}>
                    <div>
                      <i
                        style={{ height: `${(accumulated / maxGoal) * 100}%` }}
                      />
                      <em
                        style={{ bottom: `${(g.target / maxGoal) * 100}%` }}
                      />
                    </div>
                    <small>{g.name}</small>
                    <b>
                      {money(accumulated)} / {money(g.target)}
                    </b>
                  </div>
                );
              })}
          </div>
        </section>
      )}
      <section className="panel">
        <h2>Planejado × realizado por competência</h2>
        <div className="table-wrap">
          <table className="analysis-table">
            <thead>
              <tr>
                <th>Mês</th>
                <th>Planejado</th>
                <th>Realizado</th>
                <th>Resultado</th>
              </tr>
            </thead>
            <tbody>
              {rows
                .slice()
                .reverse()
                .map((r) => (
                  <tr key={r.month}>
                    <td>{r.month}</td>
                    <td>{money(r.planned)}</td>
                    <td>{money(r.realized)}</td>
                    <td className={r.result >= 0 ? "positive" : "negative"}>
                      {money(r.result)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel account-history">
        <h2>Acumulado por conta e cartão</h2>
        <p className="muted">Valores no período e modo selecionados.</p>
        <div className="account-ranking">
          {accountRows.map((row) => (
            <div key={row.account.id}>
              <label>
                <span>
                  {row.account.name}
                  <small>
                    {row.account.institution} · {row.account.operator}
                  </small>
                </span>
                <b>{money(row.actual)}</b>
              </label>
              <progress value={row.actual} max={accountRows[0]?.actual || 1} />
            </div>
          ))}
        </div>
        {!accountRows.length && <Empty />}
      </section>
    </>
  );
}

function parseCurrency(value: FormDataEntryValue | null | undefined) {
  const raw = String(value || "").replace(/[^0-9,.-]/g, "");
  const normalized = raw.includes(",")
    ? raw.replace(/\./g, "").replace(",", ".")
    : raw;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function CurrencyInput({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <input
      type="number"
      inputMode="decimal"
      step="0.01"
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
    />
  );
}

function MoneyInput({
  name,
  defaultValue,
  placeholder,
  required,
}: {
  name: string;
  defaultValue?: number;
  placeholder?: string;
  required?: boolean;
}) {
  const format = (value: number) =>
    value
      ? new Intl.NumberFormat("pt-BR", {
          style: "currency",
          currency: "BRL",
        }).format(value)
      : "";
  const [display, setDisplay] = useState(
    defaultValue ? format(defaultValue) : "",
  );
  return (
    <input
      name={name}
      inputMode="decimal"
      required={required}
      placeholder={placeholder}
      value={display}
      onChange={(event) => setDisplay(event.target.value)}
      onBlur={() => setDisplay(format(parseCurrency(display)))}
    />
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
      {fields.map(([name, label, type]) =>
        type === "number" ? (
          <MoneyInput key={name} name={name} required placeholder={label} />
        ) : (
          <input
            key={name}
            required
            name={name}
            type={type}
            placeholder={label}
            aria-label={label}
          />
        ),
      )}
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
