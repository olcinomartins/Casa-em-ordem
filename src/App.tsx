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
  X,
  CircleDollarSign,
  Camera,
} from "lucide-react";
import {
  Account,
  Budget,
  CashView,
  FamilyData,
  Member,
  Obligation,
  Receipt,
  ReceiptItem,
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
  ACCOUNT_OWNERSHIP_OPTIONS,
  accountHolder,
  accountKindLabel,
  accountOwnershipValue,
  accountResponsibilityLabel,
  inferInstitution,
  inferLastDigits,
  parseAccountOwnership,
} from "./accounts";
import {
  loadLocalIfPresent,
  loadLocalRecovery,
  saveLocalRecovery,
  clearLocalRecovery,
  markLocalPending,
  hasLocalPending,
  clearLocalPending,
  saveLocal,
  exportJson,
  restoreJson,
  download,
} from "./storage";
import {
  getCloudLocation,
  hasCloudVersion,
  isConfigured,
  loadCloud,
  saveCloud,
  setCloudLocation,
  signIn,
  signOut,
  resumeSignIn,
  waitForCloudIdle,
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
import {
  monthlySpending,
  reconcileImportedTransactions,
  spendingByCategory,
} from "./spending";
import { previewFile, Preview } from "./importer";
import { tasksToIcs } from "./ics";
import { readReceipt, ReadReceipt } from "./receipts";
import {
  getProtectedPdfPasswords,
  identifyPdfBank,
  isPdfPasswordError,
  tryPdfPasswordCandidates,
} from "./pdfPasswords";
import { readVoiceExpense, VoiceTransaction } from "./voice";
import { ShoppingListManager } from "./ShoppingListManager";
import {
  loadUiPreferences,
  saveUiPreferences,
  UI_PREFERENCES_STORAGE_KEY,
} from "./uiPreferences";
import {
  dashboardBlockIds,
  dashboardOrderStorageKey,
  moveDashboardBlock,
  normalizeDashboardOrder,
  type DashboardBlockId,
} from "./dashboardLayout";
import { selectActionSummary } from "./actionSummary";
import {
  inferShoppingMacro,
  shoppingMacroCategories,
  shoppingUnitOptions,
} from "./shoppingList";

type Page = "visao" | "rotinas" | "planejamento" | "importar" | "supermercado";
type QuickExpenseNotice = {
  transactionId: string;
  date: string;
  message: string;
};
const nav: [Page, string, typeof BarChart3][] = [
  ["visao", "Painel e Análises", BarChart3],
  ["rotinas", "Responsabilidades, Tarefas e Pagamentos", CheckSquare],
  ["planejamento", "Categorias, Contas, Orçamentos e Metas", WalletCards],
  ["importar", "Importar extratos e faturas", Upload],
  ["supermercado", "Supermercado", ShoppingCart],
];
const dateOnly = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};
const sameFamilyContent = (left: FamilyData, right: FamilyData) =>
  JSON.stringify({ ...left, lastSavedAt: "" }) ===
  JSON.stringify({ ...right, lastSavedAt: "" });

export default function App() {
  const [hadStoredUiPreferences] = useState(() => {
    try {
      return Boolean(localStorage.getItem(UI_PREFERENCES_STORAGE_KEY));
    } catch {
      return false;
    }
  });
  const [initialUiPreferences] = useState(() => loadUiPreferences());
  const [data, setData] = useState<FamilyData>();
  const dataRef = useRef<FamilyData>();
  const localMutationGeneration = useRef(0);
  const refreshGeneration = useRef(0);
  const allowAccountGeneration = useRef(0);
  const connectionGeneration = useRef(0);
  const [localRecovery, setLocalRecovery] = useState<FamilyData>();
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
  const [pendingQuickTarget, setPendingQuickTarget] = useState<{
    page: Page;
    sectionId: string;
  } | null>(null);
  const [month, setMonth] = useState(initialUiPreferences.month);
  const [view, setView] = useState<CashView>(initialUiPreferences.view);
  const [message, setMessage] = useState("");
  const [quickExpenseNotice, setQuickExpenseNotice] =
    useState<QuickExpenseNotice>();
  const [focusedTransactionId, setFocusedTransactionId] = useState<string>();
  const [cloud, setCloud] = useState<"local" | "syncing" | "connected">(
    "local",
  );
  useEffect(() => {
    if (!quickExpenseNotice) return;
    const timer = window.setTimeout(
      () => setQuickExpenseNotice(undefined),
      15_000,
    );
    return () => window.clearTimeout(timer);
  }, [quickExpenseNotice]);
  useEffect(() => {
    dataRef.current = data;
  }, [data]);
  useEffect(() => {
    const current = loadUiPreferences();
    saveUiPreferences({ ...current, month, view });
  }, [month, view]);
  useEffect(() => {
    if (authenticated && data) saveLocal(data);
  }, [authenticated, data]);
  const autosaveReady = useRef(false);
  const skipNextAutosave = useRef(false);
  const autosaveGeneration = useRef(0);
  useEffect(() => {
    if (!authenticated || !data) return;
    if (skipNextAutosave.current) {
      skipNextAutosave.current = false;
      return;
    }
    if (!autosaveReady.current) {
      autosaveReady.current = true;
      return;
    }
    const generation = ++autosaveGeneration.current;
    setCloud("syncing");
    const timer = window.setTimeout(() => {
      if (generation !== autosaveGeneration.current) return;
      saveCloud(data)
        .then(() => {
          if (generation === autosaveGeneration.current) {
            clearLocalPending();
            setCloud("connected");
          }
        })
        .catch((error) => {
          if (generation !== autosaveGeneration.current) return;
          setCloud("local");
          setMessage(
            `Falha no salvamento automático: ${(error as Error).message}`,
          );
        });
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [authenticated, data]);
  useEffect(() => {
    if (!authenticated || cloud !== "connected") return;
    const refresh = async () => {
      if (document.visibilityState !== "visible") return;
      const refreshRequest = ++refreshGeneration.current;
      const mutationAtStart = localMutationGeneration.current;
      try {
        // O eTag só é adotado se nenhuma edição local ocorrer enquanto a
        // leitura estiver em andamento.
        const remote = await loadCloud(
          () =>
            refreshRequest === refreshGeneration.current &&
            mutationAtStart === localMutationGeneration.current,
        );
        if (
          refreshRequest !== refreshGeneration.current ||
          mutationAtStart !== localMutationGeneration.current
        )
          return;
        const current = dataRef.current;
        if (!remote || !current) return;
        if (JSON.stringify(remote) === JSON.stringify(current)) return;
        // Como o estado estava totalmente sincronizado ao iniciar a consulta,
        // uma diferença pertence ao OneDrive.
        if (
          refreshRequest === refreshGeneration.current &&
          mutationAtStart === localMutationGeneration.current
        ) {
          skipNextAutosave.current = true;
          setData(remote);
        }
      } catch (error) {
        setMessage(
          `Não foi possível atualizar do OneDrive: ${(error as Error).message}`,
        );
      }
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      refreshGeneration.current += 1;
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [authenticated, cloud]);
  const allowAccount = async (account: { username: string }) => {
    const attempt = ++allowAccountGeneration.current;
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
    const localWasPending = hasLocalPending();
    const result = await Promise.all([
      loadCloud(() => attempt === allowAccountGeneration.current),
      loadLocalIfPresent(),
      loadLocalRecovery(),
    ]).catch((error) => {
      if (attempt !== allowAccountGeneration.current) return undefined;
      throw error;
    });
    if (!result || attempt !== allowAccountGeneration.current) return;
    const [remote, cached, previousRecovery] = result;
    if (!remote)
      throw new Error(
        "A base familiar do OneDrive não foi encontrada. O aplicativo não abrirá uma cópia local antiga.",
      );
    const hasDivergentCache = Boolean(
      cached &&
        !sameFamilyContent(cached, remote) &&
        (localWasPending || cached.lastSavedAt > remote.lastSavedAt),
    );
    if (hasDivergentCache) {
      await saveLocalRecovery(cached!);
      if (attempt !== allowAccountGeneration.current) return;
      setLocalRecovery(cached);
      setMessage(
        "O OneDrive foi carregado sem sobrescrever alterações da outra pessoa. Uma cópia local divergente foi preservada para download.",
      );
    } else {
      setLocalRecovery(previousRecovery);
    }
    // O OneDrive é a fonte oficial. Cache nunca é enviado automaticamente
    // sobre uma versão remota diferente.
    if (attempt !== allowAccountGeneration.current) return;
    setCurrentMember(
      email === "mariana_camillie@hotmail.com" ? "Mari" : "Olcino",
    );
    setData(remote);
    clearLocalPending();
    setCloud("connected");
    setAuthenticated(true);
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
  const mutate = (fn: (draft: FamilyData) => void) => {
    localMutationGeneration.current += 1;
    setData((old) => {
      if (!old) return old;
      const draft = structuredClone(old);
      fn(draft);
      draft.lastSavedAt = now();
      markLocalPending(draft.lastSavedAt);
      return draft;
    });
  };
  const undoQuickExpense = (transactionId: string) => {
    if (!data?.transactions.some((item) => item.id === transactionId)) {
      setQuickExpenseNotice(undefined);
      setMessage("Esse lançamento já não está disponível para desfazer.");
      return;
    }
    mutate((draft) => {
      draft.transactions = draft.transactions.filter(
        (item) => item.id !== transactionId,
      );
    });
    setQuickExpenseNotice(undefined);
    setMessage("Despesa desfeita e sincronização automática iniciada.");
  };
  const viewQuickExpense = (notice: QuickExpenseNotice) => {
    setMonth(monthOf(notice.date));
    setFocusedTransactionId(notice.transactionId);
    setQuickExpenseNotice(undefined);
    goToQuickAction("importar", "quick-transactions");
  };
  const configureShared = async () => {
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
    const currentData = dataRef.current;
    const localWasPending = Boolean(currentData && hasLocalPending());
    if (currentData && localWasPending) {
      await saveLocalRecovery(currentData);
      setLocalRecovery(currentData);
    }
    // Uma gravação já iniciada pertence à localização anterior e não pode
    // concluir visualmente a conexão da nova base.
    autosaveGeneration.current += 1;
    refreshGeneration.current += 1;
    connectionGeneration.current += 1;
    setCloudLocation({ driveId, itemId });
    setCloud("local");
    setMessage(
      localWasPending
        ? "Base compartilhada configurada. A cópia local pendente foi preservada; conecte novamente."
        : "Base compartilhada configurada. Conecte novamente.",
    );
  };
  const toggleValues = () =>
    setHideValues((current) => {
      localStorage.setItem("casa-em-ordem-hide-values", String(!current));
      return !current;
    });
  const connect = async () => {
    const attempt = ++connectionGeneration.current;
    try {
      refreshGeneration.current += 1;
      setCloud("syncing");
      await signIn();
      await waitForCloudIdle();
      if (attempt !== connectionGeneration.current) return;
      const currentData = dataRef.current;
      let preservedLocalCopy = false;
      if (authenticated && currentData && hasCloudVersion()) {
        // Usa o eTag da última versão aceita. Se outra pessoa alterou a base,
        // o OneDrive responderá 412 e nada será sobrescrito.
        await saveCloud(currentData);
      } else {
        const localWasPending = hasLocalPending();
        const remote = await loadCloud(
          () => attempt === connectionGeneration.current,
        );
        if (attempt !== connectionGeneration.current) return;
        if (remote) {
          if (
            currentData &&
            localWasPending &&
            !sameFamilyContent(currentData, remote)
          ) {
            await saveLocalRecovery(currentData);
            if (attempt !== connectionGeneration.current) return;
            setLocalRecovery(currentData);
            preservedLocalCopy = true;
          }
          skipNextAutosave.current = true;
          setData(remote);
        } else if (currentData) await saveCloud(currentData);
      }
      if (attempt !== connectionGeneration.current) return;
      clearLocalPending();
      setCloud("connected");
      setMessage(
        preservedLocalCopy
          ? "OneDrive conectado. A cópia local pendente foi preservada para recuperação."
          : "OneDrive conectado.",
      );
    } catch (e) {
      if (attempt !== connectionGeneration.current) return;
      setCloud("local");
      setMessage((e as Error).message);
    }
  };
  const goToQuickAction = (targetPage: Page, sectionId: string) => {
    setPendingQuickTarget({ page: targetPage, sectionId });
    setPage(targetPage);
  };
  useEffect(() => {
    if (!pendingQuickTarget || pendingQuickTarget.page !== page) return;
    let cancelled = false;
    const frame = window.requestAnimationFrame(() => {
      if (cancelled) return;
      const section = document.getElementById(
        pendingQuickTarget.sectionId,
      ) as HTMLDetailsElement | null;
      if (!section) {
        setPendingQuickTarget(null);
        return;
      }
      section.open = true;
      section.scrollIntoView({ behavior: "smooth", block: "start" });
      const keepTransactionFocus =
        pendingQuickTarget.sectionId === "quick-transactions" &&
        Boolean(focusedTransactionId);
      if (keepTransactionFocus) {
        setPendingQuickTarget(null);
        return;
      }
      const target = section.querySelector<HTMLElement>(
        "[data-quick-focus], input:not([type='hidden']), select, textarea, button",
      );
      const shouldExpand =
        target?.dataset.quickExpand === "true" &&
        target.getAttribute("aria-expanded") !== "true";
      if (shouldExpand) target.click();
      window.requestAnimationFrame(() => {
        if (cancelled) return;
        const focusTarget = target?.dataset.quickExpand === "true"
          ? section.querySelector<HTMLElement>(
              ".quick-form input:not([type='hidden']), .quick-form select, .quick-form textarea",
            ) || target
          : target;
        focusTarget?.focus({ preventScroll: true });
        setPendingQuickTarget(null);
      });
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, [focusedTransactionId, page, pendingQuickTarget]);
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
              aria-current={page === id ? "page" : undefined}
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
              aria-pressed={hideValues}
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
          <div className="toast" role="status" aria-live="polite">
            <span>{message}</span>
            <button
              aria-label="Fechar mensagem"
              onClick={() => setMessage("")}
            >
              <X size={17} />
            </button>
          </div>
        )}
        {localRecovery && (
          <section className="recovery-banner" role="alert">
            <div>
              <b>Cópia local preservada</b>
              <p>
                Ela não foi enviada sobre o OneDrive. Baixe o arquivo para
                conferir antes de descartá-la.
              </p>
            </div>
            <div className="actions">
              <button onClick={() => exportJson(localRecovery)}>
                <Download size={17} /> Baixar cópia local
              </button>
              <button
                onClick={async () => {
                  await clearLocalRecovery();
                  setLocalRecovery(undefined);
                  setMessage("Cópia local divergente descartada.");
                }}
              >
                Descartar cópia
              </button>
            </div>
          </section>
        )}
        {quickExpenseNotice && (
          <div className="action-toast">
            <span
              className="action-toast-message"
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              {quickExpenseNotice.message}
            </span>
            <div className="action-toast-buttons">
              <button
                onClick={() =>
                  undoQuickExpense(quickExpenseNotice.transactionId)
                }
              >
                Desfazer
              </button>
              <button onClick={() => viewQuickExpense(quickExpenseNotice)}>
                Ver lançamento
              </button>
              <button
                className="action-toast-close"
                aria-label="Fechar notificação"
                onClick={() => setQuickExpenseNotice(undefined)}
              >
                <X size={18} />
              </button>
            </div>
          </div>
        )}
        {page === "visao" && (
          <>
            <Collapsible id="dashboard-panel" title="Painel">
              <Dashboard
                data={data}
                month={month}
                view={view}
                setView={setView}
                hideValues={hideValues}
                currentMember={currentMember}
                cloud={cloud}
                onNavigate={goToQuickAction}
              />
            </Collapsible>
            <Collapsible title="Análises históricas">
              <Analytics
                data={data}
                hadStoredPreferences={hadStoredUiPreferences}
              />
            </Collapsible>
          </>
        )}
        {page === "rotinas" && (
          <>
            <Collapsible id="quick-tasks" title="Responsabilidades, tarefas e agenda">
              <Tasks
                data={data}
                mutate={mutate}
                currentMember={currentMember}
              />
            </Collapsible>
            <Collapsible id="quick-payments" title="Central de pagamentos">
              <Payments data={data} mutate={mutate} hideValues={hideValues} />
            </Collapsible>
          </>
        )}
        {page === "planejamento" && (
          <>
            <Collapsible title="Contas e cartões">
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
            <Collapsible id="budgets-section" title="Orçamentos">
              <Budgets
                data={data}
                month={month}
                view={view}
                setView={setView}
                mutate={mutate}
                hideValues={hideValues}
              />
            </Collapsible>
            <Collapsible title="Metas e reservas">
              <Goals data={data} mutate={mutate} />
            </Collapsible>
          </>
        )}
        {page === "importar" && (
          <>
            <Collapsible id="quick-voice" title="Registrar despesa por voz">
              <VoiceExpense
                data={data}
                mutate={mutate}
                setMessage={setMessage}
                currentMember={currentMember}
              />
            </Collapsible>
            <Collapsible id="quick-import" title="Importar extratos e faturas">
              <ImportPage data={data} mutate={mutate} setMessage={setMessage} hideValues={hideValues} />
            </Collapsible>
            <Collapsible id="quick-transactions" title="Transações e revisão">
              <Transactions
                data={data}
                month={month}
                mutate={mutate}
                focusTransactionId={focusedTransactionId}
                onFocusHandled={() => setFocusedTransactionId(undefined)}
                hideValues={hideValues}
              />
            </Collapsible>
          </>
        )}
        {page === "supermercado" && (
          <Receipts
            data={data}
            mutate={mutate}
            setMessage={setMessage}
            currentMember={currentMember}
            hideValues={hideValues}
          />
        )}
      </main>
      <QuickActions
        data={data}
        mutate={mutate}
        currentMember={currentMember}
        onNavigate={goToQuickAction}
        onExpenseCreated={(transaction) =>
          setQuickExpenseNotice({
            transactionId: transaction.id,
            date: transaction.date,
            message: "Despesa adicionada à prévia do mês.",
          })
        }
      />
    </div>
  );
}

function Collapsible({
  id,
  title,
  open = false,
  children,
}: {
  id?: string;
  title: string;
  open?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details
      id={id}
      className="collapsible"
      {...(open ? { open: true } : {})}
    >
      <summary>
        {title}
        <span aria-hidden="true">⌄</span>
      </summary>
      <div className="collapsible-content">{children}</div>
    </details>
  );
}

function QuickActions({
  data,
  mutate,
  currentMember,
  onNavigate,
  onExpenseCreated,
}: {
  data: FamilyData;
  mutate: (f: (data: FamilyData) => void) => void;
  currentMember: Exclude<Member, "Ambos">;
  onNavigate: (page: Page, sectionId: string) => void;
  onExpenseCreated: (transaction: Transaction) => void;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"menu" | "expense">("menu");
  const [categoryId, setCategoryId] = useState("");
  const [subcategory, setSubcategory] = useState("");
  const [categoryTouched, setCategoryTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [operator, setOperator] = useState<Member>(currentMember);
  const [accountId, setAccountId] = useState(
    () =>
      data.accounts.find(
        (account) => account.active && account.operator === currentMember,
      )?.id || data.accounts.find((account) => account.active)?.id || "",
  );
  const [saving, setSaving] = useState(false);
  const [dialogError, setDialogError] = useState("");
  const savingRef = useRef(false);
  const fabRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const expenseCategories = data.categories.filter(
    (category) => category.nature === "expense",
  );
  const activeAccounts = data.accounts.filter((account) => account.active);

  const applyCategorySuggestion = (
    nextDescription: string,
    nextAccountId = accountId,
    nextOperator = operator,
  ) => {
    if (categoryTouched || !nextDescription.trim() || !nextAccountId) return;
    const rule = suggest(
      nextDescription,
      nextAccountId,
      nextOperator,
      data.rules,
    );
    if (
      !rule ||
      !expenseCategories.some((category) => category.id === rule.categoryId)
    ) return;
    setCategoryId(rule.categoryId);
    setSubcategory(rule.subcategory || "");
  };

  const close = (restoreFocus = true) => {
    setOpen(false);
    setMode("menu");
    setDialogError("");
    if (restoreFocus)
      window.setTimeout(() => fabRef.current?.focus(), 0);
  };

  const showDialogError = (error: string) => {
    setDialogError(error);
    window.setTimeout(() => errorRef.current?.focus(), 0);
  };

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const background = Array.from(
      document.querySelectorAll<HTMLElement>(".app > aside, .app > main"),
    );
    const previousInert = background.map((element) => element.inert);
    background.forEach((element) => {
      element.inert = true;
    });
    const handleKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        sheetRef.current?.querySelectorAll<HTMLElement>(
          "button:not([disabled]), input:not([disabled]):not([type='hidden']), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])",
        ) || [],
      ).filter((element) => element.getClientRects().length > 0);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyboard);
    window.requestAnimationFrame(
      () =>
        sheetRef.current
          ?.querySelector<HTMLElement>("button, input, select")
          ?.focus(),
    );
    return () => {
      document.body.style.overflow = previousOverflow;
      background.forEach((element, index) => {
        element.inert = previousInert[index];
      });
      document.removeEventListener("keydown", handleKeyboard);
    };
  }, [open]);

  const navigate = (page: Page, sectionId: string) => {
    close(false);
    onNavigate(page, sectionId);
  };

  const saveExpense = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (savingRef.current) return;
    savingRef.current = true;
    const form = new FormData(event.currentTarget);
    const amount = Math.abs(parseCurrency(form.get("amount")));
    const cleanDescription = String(form.get("description") || "").trim();
    const date = String(form.get("date") || dateOnly(new Date()));
    const selectedAccountId = String(form.get("accountId") || "");
    const selectedOperator = String(
      form.get("operator") || currentMember,
    ) as Member;
    const scope = String(form.get("scope") || "Familiar") as Transaction["scope"];
    const account = data.accounts.find((item) => item.id === selectedAccountId);
    if (!amount || !cleanDescription || !date || !account || !categoryId) {
      showDialogError(
        "Preencha valor, descrição, categoria, conta ou cartão e data.",
      );
      savingRef.current = false;
      return;
    }
    setDialogError("");
    setSaving(true);
    try {
      const transaction: Transaction = {
        ...audit(currentMember),
        date,
        competence: monthOf(date),
        purchaseDate: date,
        paymentDate: date,
        description: cleanDescription,
        normalized: normalize(cleanDescription),
        amount,
        accountId: selectedAccountId,
        operator: selectedOperator,
        scope,
        categoryId,
        subcategory: subcategory || undefined,
        classification: "confirmed",
        dedupeKey: "",
        transfer: false,
        movement: "expense_income",
        sourceKind: account.kind === "card" ? "card" : "statement",
        estimated: true,
        estimateOrigin: "manual",
        notes: "Estimativa manual registrada pelo botão de ação rápida.",
      };
      transaction.dedupeKey = await dedupeKey(transaction);
      mutate((family) => family.transactions.push(transaction));
      setCategoryId("");
      setSubcategory("");
      setCategoryTouched(false);
      setDescription("");
      close();
      onExpenseCreated(transaction);
    } catch (error) {
      showDialogError(
        `Não foi possível registrar: ${(error as Error).message}`,
      );
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <div className="quick-action-root">
      {open && (
        <div
          className="quick-action-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <div
            ref={sheetRef}
            id="quick-action-sheet"
            className="quick-action-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="quick-action-title"
          >
            <div className="quick-action-head">
              <div>
                <p className="eyebrow">AÇÃO RÁPIDA</p>
                <h2 id="quick-action-title">
                  {mode === "expense" ? "Nova despesa" : "O que deseja fazer?"}
                </h2>
              </div>
              <button
                className="quick-action-close"
                onClick={() => {
                  if (mode === "expense") {
                    setDialogError("");
                    setMode("menu");
                  } else {
                    close();
                  }
                }}
                aria-label={mode === "expense" ? "Voltar" : "Fechar"}
              >
                {mode === "expense" ? "Voltar" : <X size={21} />}
              </button>
            </div>

            {dialogError && (
              <div
                ref={errorRef}
                className="quick-action-error"
                role="alert"
                aria-live="assertive"
                aria-atomic="true"
                tabIndex={-1}
              >
                {dialogError}
              </div>
            )}

            {mode === "menu" ? (
              <>
                <div className="quick-action-grid">
                  <button
                    className="quick-action-primary"
                    onClick={() => {
                      setDialogError("");
                      setMode("expense");
                    }}
                  >
                    <CircleDollarSign size={22} />
                    <span>
                      <b>Nova despesa</b>
                      <small>Digitar agora</small>
                    </span>
                  </button>
                  <button onClick={() => navigate("importar", "quick-voice")}>
                    <Mic size={22} />
                    <span>
                      <b>Por voz</b>
                      <small>Falar o gasto</small>
                    </span>
                  </button>
                  <button onClick={() => navigate("rotinas", "quick-payments")}>
                    <WalletCards size={22} />
                    <span>
                      <b>Conta ou pagamento</b>
                      <small>Registrar ou confirmar</small>
                    </span>
                  </button>
                  <button onClick={() => navigate("supermercado", "quick-receipts")}>
                    <Camera size={22} />
                    <span>
                      <b>Fotografar nota</b>
                      <small>Compra de mercado</small>
                    </span>
                  </button>
                  <button onClick={() => navigate("supermercado", "quick-shopping")}>
                    <ShoppingCart size={22} />
                    <span>
                      <b>Item de compras</b>
                      <small>Adicionar à lista</small>
                    </span>
                  </button>
                  <button onClick={() => navigate("rotinas", "quick-tasks")}>
                    <CheckSquare size={22} />
                    <span>
                      <b>Nova tarefa</b>
                      <small>Casa ou agenda</small>
                    </span>
                  </button>
                </div>
                <button
                  className="quick-import-link"
                  onClick={() => navigate("importar", "quick-import")}
                >
                  <Upload size={18} /> Importar extrato ou fatura
                </button>
              </>
            ) : (
              <form
                className="quick-expense-form"
                onSubmit={saveExpense}
                onChangeCapture={() => {
                  if (dialogError) setDialogError("");
                }}
              >
                <p className="muted">
                  Entra como prévia do mês e será conciliada quando a fatura ou
                  o extrato forem importados.
                </p>
                <label className="quick-expense-value">
                  Valor
                  <MoneyInput
                    name="amount"
                    required
                    autoFocus
                    placeholder="R$ 0,00"
                  />
                </label>
                <label>
                  Descrição ou estabelecimento
                  <input
                    name="description"
                    required
                    placeholder="Ex.: farmácia"
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    onBlur={(event) =>
                      applyCategorySuggestion(event.target.value)
                    }
                  />
                </label>
                <div className="quick-expense-row">
                  <label>
                    Data
                    <input
                      name="date"
                      type="date"
                      required
                      defaultValue={dateOnly(new Date())}
                    />
                  </label>
                  <label>
                    Quem gastou
                    <select
                      name="operator"
                      value={operator}
                      onChange={(event) => {
                        const nextOperator = event.target.value as Member;
                        setOperator(nextOperator);
                        applyCategorySuggestion(
                          description,
                          accountId,
                          nextOperator,
                        );
                      }}
                    >
                      <option>Olcino</option>
                      <option>Mari</option>
                      <option>Ambos</option>
                    </select>
                  </label>
                </div>
                <label>
                  Categoria
                  <select
                    required
                    value={categoryId}
                    onChange={(event) => {
                      const next = event.target.value;
                      setCategoryTouched(true);
                      setCategoryId(next);
                      setSubcategory(
                        data.categories.find((item) => item.id === next)
                          ?.subcategories[0] || "",
                      );
                    }}
                  >
                    <option value="">Selecione</option>
                    {expenseCategories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Subcategoria
                  <select
                    value={subcategory}
                    onChange={(event) => setSubcategory(event.target.value)}
                  >
                    <option value="">Sem subcategoria</option>
                    {data.categories
                      .find((item) => item.id === categoryId)
                      ?.subcategories.map((item) => (
                        <option key={item}>{item}</option>
                      ))}
                  </select>
                </label>
                <label>
                  Conta ou cartão
                  <select
                    name="accountId"
                    required
                    value={accountId}
                    onChange={(event) => {
                      const nextAccountId = event.target.value;
                      setAccountId(nextAccountId);
                      applyCategorySuggestion(
                        description,
                        nextAccountId,
                        operator,
                      );
                    }}
                  >
                    <option value="">Selecione</option>
                    {activeAccounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Uso do gasto
                  <select name="scope" defaultValue="Familiar">
                    <option>Familiar</option>
                    <option>Pessoal — Olcino</option>
                    <option>Pessoal — Mari</option>
                    <option>Fora do orçamento</option>
                  </select>
                </label>
                <button className="primary quick-expense-save" disabled={saving}>
                  {saving ? "Salvando…" : "Adicionar à prévia"}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
      <button
        ref={fabRef}
        className={`quick-action-fab ${open ? "menu-open" : ""}`}
        onClick={() => (open ? close() : setOpen(true))}
        disabled={open}
        aria-hidden={open ? "true" : undefined}
        tabIndex={open ? -1 : undefined}
        aria-label={open ? "Fechar ações rápidas" : "Abrir ações rápidas"}
        aria-expanded={open}
        aria-controls="quick-action-sheet"
      >
        {open ? <X size={27} /> : <Plus size={29} />}
      </button>
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
        aria-pressed={view === "cash"}
        onClick={() => setView("cash")}
      >
        Fluxo das parcelas
      </button>
      <button
        className={view === "accrual" ? "on" : ""}
        aria-pressed={view === "accrual"}
        onClick={() => setView("accrual")}
      >
        Compra integral
      </button>
      <button
        className={view === "compare" ? "on" : ""}
        aria-pressed={view === "compare"}
        onClick={() => setView("compare")}
      >
        Comparar integral × parcelas
      </button>
    </div>
  );
}

function HiddenValue() {
  return (
    <span role="img" aria-label="valor oculto">
      <span aria-hidden="true">*****</span>
    </span>
  );
}

function SensitiveMoney({
  value,
  hidden,
}: {
  value: number;
  hidden: boolean;
}) {
  return hidden ? <HiddenValue /> : <>{money(value)}</>;
}

const dashboardBlockLabels: Record<DashboardBlockId, string> = {
  summary: "Resumo financeiro",
  categories: "Gastos por categoria",
  budget: "Orçado × acompanhado",
  personal: "Orçamentos pessoais",
  commitments: "Próximos compromissos",
  goals: "Metas prioritárias",
};

function Dashboard({
  data,
  month,
  view,
  setView,
  hideValues,
  currentMember,
  cloud,
  onNavigate,
}: {
  data: FamilyData;
  month: string;
  view: CashView;
  setView: (v: CashView) => void;
  hideValues: boolean;
  currentMember: Exclude<Member, "Ambos">;
  cloud: "local" | "syncing" | "connected";
  onNavigate: (page: Page, sectionId: string) => void;
}) {
  const orderKey = dashboardOrderStorageKey(currentMember);
  const [blockOrder, setBlockOrder] = useState<DashboardBlockId[]>(() => {
    try {
      return normalizeDashboardOrder(localStorage.getItem(orderKey));
    } catch {
      return [...dashboardBlockIds];
    }
  });
  const [organizing, setOrganizing] = useState(false);
  useEffect(() => {
    try {
      localStorage.setItem(orderKey, JSON.stringify(blockOrder));
    } catch {
      // A ordem é opcional e nunca deve bloquear o painel financeiro.
    }
  }, [blockOrder, orderKey]);
  const calc = (v: "cash" | "accrual") =>
    data.transactions.reduce(
      (sum, transaction) =>
        sum + (transaction.estimated ? 0 : realized(transaction, month, v)),
      0,
    );
  const cash = calc("cash"),
    acc = calc("accrual");
  const expenses = (v: "cash" | "accrual") =>
    data.transactions.reduce((s, t) => {
      if (t.estimated) return s;
      const x = realized(t, month, v);
      return s + (x > 0 ? x : 0);
    }, 0);
  const income = data.transactions
    .filter(
      (t) =>
        !t.estimated &&
        !t.transfer &&
        t.amount < 0 &&
        monthOf(t.paymentDate || t.date) === month,
    )
    .reduce((s, t) => s + Math.abs(t.amount), 0);
  const spending = monthlySpending(
    data,
    month,
    view === "accrual" ? "accrual" : "cash",
  );
  const realizedExpenses = spending.filter((entry) => entry.state === "realized").reduce((sum, entry) => sum + entry.amount, 0);
  const estimatedEntries = spending.filter((entry) => entry.state === "estimated");
  const expectedBeforeClosing = estimatedEntries.filter((entry) => entry.source === "payment").reduce((sum, entry) => sum + entry.amount, 0);
  const voiceExpected = estimatedEntries.filter((entry) => entry.source === "voice").reduce((sum, entry) => sum + entry.amount, 0);
  const manualExpected = estimatedEntries.filter((entry) => entry.source === "manual").reduce((sum, entry) => sum + entry.amount, 0);
  const receiptsExpected = estimatedEntries.filter((entry) => entry.source === "receipt").reduce((sum, entry) => sum + entry.amount, 0);
  const totalExpected = spending.reduce((sum, entry) => sum + entry.amount, 0);
  const integralExpected = view === "compare"
    ? monthlySpending(data, month, "accrual").reduce(
        (sum, entry) => sum + entry.amount,
        0,
      )
    : undefined;
  const actionSummary = selectActionSummary(data, { month, view });
  const commitments = data.obligations
    .filter(
      (obligation) =>
        !["Paga", "Confirmada", "Dispensada"].includes(obligation.status),
    )
    .slice()
    .sort(
      (left, right) =>
        left.dueDate.localeCompare(right.dueDate) ||
        left.name.localeCompare(right.name, "pt-BR"),
    )
    .slice(0, 5);
  const priorityGoals = data.goals
    .filter((goal) => goal.active)
    .slice()
    .sort((left, right) => left.priority - right.priority)
    .slice(0, 4);
  return (
    <>
      <div className="toolbar dashboard-toolbar">
        <ViewSwitch view={view} setView={setView} />
        <button
          aria-expanded={organizing}
          onClick={() => setOrganizing((current) => !current)}
        >
          <Settings size={17} />
          {organizing ? "Concluir organização" : "Organizar painel"}
        </button>
      </div>
      {organizing && (
        <section className="panel dashboard-organizer">
          <div className="panel-head">
            <div>
              <h2>Organizar painel</h2>
              <p className="muted">
                A ordem é salva automaticamente neste aparelho para{" "}
                {currentMember}.
              </p>
            </div>
            <button onClick={() => setBlockOrder([...dashboardBlockIds])}>
              Restaurar padrão
            </button>
          </div>
          <div className="dashboard-order-list">
            {blockOrder.map((blockId, index) => (
              <div key={blockId}>
                <span>
                  <b>{dashboardBlockLabels[blockId]}</b>
                  <small>
                    Posição {index + 1} de {blockOrder.length}
                  </small>
                </span>
                <div className="actions">
                  <button
                    disabled={index === 0}
                    aria-label={`Subir ${dashboardBlockLabels[blockId]}`}
                    onClick={() =>
                      setBlockOrder((current) =>
                        moveDashboardBlock(current, blockId, "up"),
                      )
                    }
                  >
                    ↑
                  </button>
                  <button
                    disabled={index === blockOrder.length - 1}
                    aria-label={`Descer ${dashboardBlockLabels[blockId]}`}
                    onClick={() =>
                      setBlockOrder((current) =>
                        moveDashboardBlock(current, blockId, "down"),
                      )
                    }
                  >
                    ↓
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
      <DashboardActionSummary
        summary={actionSummary}
        cloud={cloud}
        hideValues={hideValues}
        onNavigate={onNavigate}
      />
      <div className="dashboard-blocks" role="list" aria-label="Blocos do painel">
      {blockOrder.map((blockId, index) =>
        blockId === "summary" ? (
      <div
        key={blockId}
        className="dashboard-block wide"
        role="listitem"
        aria-posinset={index + 1}
        aria-setsize={blockOrder.length}
      >
      <section className="cards">
        <Card
          label="Renda familiar"
          value={<SensitiveMoney value={income} hidden={hideValues} />}
          hint="Entradas líquidas no mês"
          tone="good"
          details={data.transactions.filter(t=>!t.estimated&&t.amount<0&&Math.abs(realized(t,month,"cash"))>0).map(t=><Row key={t.id} a={t.description} b={t.paymentDate||t.date} c={<SensitiveMoney value={Math.abs(t.amount)} hidden={hideValues} />}/>) }
        />
        <Card
          label="Despesas no fluxo"
          value={<SensitiveMoney value={expenses("cash")} hidden={hideValues} />}
          hint={
            view === "compare"
              ? <>Integral: <SensitiveMoney value={expenses("accrual")} hidden={hideValues} /></>
              : "Conforme pagamentos"
          }
          tone="bad"
          details={data.transactions.filter(t=>!t.estimated&&t.amount>0&&Math.abs(realized(t,month,"cash"))>0).map(t=><Row key={t.id} a={t.description} b={t.paymentDate||t.date} c={<SensitiveMoney value={t.amount} hidden={hideValues} />}/>) }
        />
        <Card
          label="Resultado de caixa"
          value={<SensitiveMoney value={income - expenses("cash")} hidden={hideValues} />}
          hint="Antes dos aportes"
          tone={income - expenses("cash") < 0 ? "bad" : "good"}
          details={<p>Entradas <SensitiveMoney value={income} hidden={hideValues} /> menos despesas realizadas <SensitiveMoney value={expenses("cash")} hidden={hideValues} />.</p>}
        />
        <Card
          label={
            view === "compare"
              ? "Gastos acompanhados — fluxo"
              : "Gastos acompanhados em tempo real"
          }
          value={<SensitiveMoney value={totalExpected} hidden={hideValues} />}
          hint={
            view === "compare"
              ? <>Compra integral acompanhada: <SensitiveMoney value={integralExpected || 0} hidden={hideValues} /></>
              : <><SensitiveMoney value={realizedExpenses} hidden={hideValues} /> realizado · <SensitiveMoney value={voiceExpected + manualExpected + receiptsExpected + expectedBeforeClosing} hidden={hideValues} /> ainda previsto</>
          }
          tone="warning"
          details={<>
            <p>Prévia formada por pagamentos realizados, registros manuais ou por voz, notas e compromissos ainda abertos. Não é saldo bancário nem fatura fechada.</p>
            <Row a="Pagamentos e gastos realizados" b="Confirmados no mês" c={<SensitiveMoney value={realizedExpenses} hidden={hideValues} />} />
            <Row a="Registros por voz" b={`${estimatedEntries.filter(entry=>entry.source==="voice").length} estimativa(s)`} c={<SensitiveMoney value={voiceExpected} hidden={hideValues} />} />
            <Row a="Registros manuais rápidos" b={`${estimatedEntries.filter(entry=>entry.source==="manual").length} estimativa(s)`} c={<SensitiveMoney value={manualExpected} hidden={hideValues} />} />
            <Row a="Notas de compras" b={`${estimatedEntries.filter(entry=>entry.source==="receipt").length} nota(s)`} c={<SensitiveMoney value={receiptsExpected} hidden={hideValues} />} />
            <Row a="Pagamentos ainda previstos" b="Obrigações abertas" c={<SensitiveMoney value={expectedBeforeClosing} hidden={hideValues} />} />
            {spending.slice().sort((a,b)=>a.date.localeCompare(b.date)).map(entry=><Row key={entry.id} a={`${entry.state==="realized"?"Realizado":"Previsto"} · ${entry.source==="voice"?"Voz":entry.source==="manual"?"Manual":entry.source==="receipt"?"Nota":entry.source==="payment"?"Pagamento":"Fatura/extrato"} · ${entry.description}`} b={entry.date} c={<SensitiveMoney value={entry.amount} hidden={hideValues} />}/>)}
          </>}
        />
      </section>
      </div>
        ) : blockId === "categories" ? (
      <div
        key={blockId}
        className="dashboard-block wide"
        role="listitem"
        aria-posinset={index + 1}
        aria-setsize={blockOrder.length}
      >
        <CategorySpendingCharts
          data={data}
          month={month}
          view={view}
          hideValues={hideValues}
        />
      </div>
        ) : blockId === "budget" ? (
      <div
        key={blockId}
        className="dashboard-block wide"
        role="listitem"
        aria-posinset={index + 1}
        aria-setsize={blockOrder.length}
      >
        <div className="panel">
          <h2>Orçado × acompanhado em tempo real</h2>
          {view === "compare" ? (
            <div className="grid two">
              <div>
                <h3>Fluxo das parcelas</h3>
                <BudgetBars data={data} month={month} view="cash" hideValues={hideValues} />
              </div>
              <div>
                <h3>Compra integral</h3>
                <BudgetBars data={data} month={month} view="accrual" hideValues={hideValues} />
              </div>
            </div>
          ) : (
            <BudgetBars data={data} month={month} view={view} hideValues={hideValues} />
          )}
        </div>
      </div>
        ) : blockId === "personal" ? (
      <div
        key={blockId}
        className="dashboard-block compact"
        role="listitem"
        aria-posinset={index + 1}
        aria-setsize={blockOrder.length}
      >
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
                <SensitiveMoney value={personalBalance(data, m, month)} hidden={hideValues} />
              </strong>
            </div>
          ))}
        </div>
      </div>
        ) : blockId === "commitments" ? (
      <div
        key={blockId}
        className="dashboard-block compact"
        role="listitem"
        aria-posinset={index + 1}
        aria-setsize={blockOrder.length}
      >
        <div className="panel">
          <h2>Próximos compromissos</h2>
          {commitments.length ? (
            commitments.map((obligation) => (
              <Row
                key={obligation.id}
                a={obligation.name}
                b={obligation.dueDate}
                c={<SensitiveMoney value={obligation.planned} hidden={hideValues} />}
              />
            ))
          ) : (
            <Empty />
          )}
        </div>
      </div>
        ) : blockId === "goals" ? (
      <div
        key={blockId}
        className="dashboard-block compact"
        role="listitem"
        aria-posinset={index + 1}
        aria-setsize={blockOrder.length}
      >
        <div className="panel">
          <h2>Metas prioritárias</h2>
          {priorityGoals.length ? (
            priorityGoals.map((goal) => {
              const total = goal.movements.reduce(
                (sum, movement) => sum + movement.amount,
                0,
              );
              return (
                <div key={goal.id} className="goal-mini">
                  <span>{goal.name}</span>
                  <b>
                    <SensitiveMoney value={total} hidden={hideValues} /> /{" "}
                    <SensitiveMoney value={goal.target} hidden={hideValues} />
                  </b>
                  <progress
                    value={Math.max(0, total)}
                    max={goal.target || 1}
                    aria-label={hideValues ? "valor oculto" : `${goal.name}: ${money(total)} de ${money(goal.target)}`}
                    aria-valuetext={hideValues ? "valor oculto" : `${money(total)} de ${money(goal.target)}`}
                  />
                </div>
              );
            })
          ) : (
            <Empty />
          )}
        </div>
      </div>
        ) : null
      )}
      </div>
      {view === "compare" && (
        <p className="note">
          Resultado reconhecido: fluxo <SensitiveMoney value={cash} hidden={hideValues} /> · compra integral{" "}
          <SensitiveMoney value={acc} hidden={hideValues} />. A visualização não altera os lançamentos.
        </p>
      )}
    </>
  );
}

function DashboardActionSummary({
  summary,
  cloud,
  hideValues,
  onNavigate,
}: {
  summary: ReturnType<typeof selectActionSummary>;
  cloud: "local" | "syncing" | "connected";
  hideValues: boolean;
  onNavigate: (page: Page, sectionId: string) => void;
}) {
  const hasFinancialAlerts = Boolean(
    summary.overduePayments.length ||
      summary.budgetOverruns.length ||
      summary.pendingTransactions.length ||
      summary.upcomingPayments.length,
  );
  const paymentPreview = (items: Obligation[]) =>
    items
      .slice(0, 3)
      .map((item) => `${item.name} · ${item.dueDate}`)
      .join(" | ");
  return (
    <section className="panel attention-summary">
      <div className="panel-head attention-head">
        <div>
          <h2>Resumo que pede atenção</h2>
          <p className="muted">
            Orçamentos e lançamentos do período selecionado; contas vencidas e
            próximas calculadas a partir de hoje.
          </p>
        </div>
        <span
          className={`sync-pill ${cloud}`}
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {cloud === "connected"
            ? "OneDrive atualizado"
            : cloud === "syncing"
              ? "Salvando…"
              : "OneDrive sem confirmação"}
        </span>
      </div>
      <div className="attention-list">
        {cloud === "local" && (
          <div className="attention-item danger" role="alert">
            <span aria-hidden="true">!</span>
            <div>
              <b>As últimas alterações podem não estar no OneDrive</b>
              <small>Verifique a mensagem acima antes de continuar.</small>
            </div>
          </div>
        )}
        {summary.overduePayments.length > 0 && (
          <button
            className="attention-item danger"
            onClick={() => onNavigate("rotinas", "quick-payments")}
          >
            <span aria-hidden="true">!</span>
            <div>
              <b>{summary.overduePayments.length} pagamento(s) vencido(s)</b>
              <small>{paymentPreview(summary.overduePayments)}</small>
            </div>
            <em>Ver</em>
          </button>
        )}
        {summary.budgetOverruns.length > 0 && (
          <button
            className="attention-item danger"
            onClick={() => onNavigate("planejamento", "budgets-section")}
          >
            <span aria-hidden="true">!</span>
            <div>
              <b>
                {summary.budgetOverruns.length} categoria(s) acima do orçamento
              </b>
              <small>
                {summary.budgetOverruns.slice(0, 3).map((item, index) => (
                  <span key={item.categoryId}>
                    {index > 0 && " | "}
                    {item.name} ·{" "}
                    <SensitiveMoney value={item.overage} hidden={hideValues} /> acima
                  </span>
                ))}
              </small>
            </div>
            <em>Ver</em>
          </button>
        )}
        {summary.pendingTransactions.length > 0 && (
          <button
            className="attention-item warning"
            onClick={() => onNavigate("importar", "quick-transactions")}
          >
            <span aria-hidden="true">?</span>
            <div>
              <b>
                {summary.pendingTransactions.length} lançamento(s) para revisar
              </b>
              <small>
                {summary.pendingTransactions
                  .slice(0, 3)
                  .map((item) => item.description)
                  .join(" | ")}
              </small>
            </div>
            <em>Revisar</em>
          </button>
        )}
        {summary.upcomingPayments.length > 0 && (
          <button
            className="attention-item info"
            onClick={() => onNavigate("rotinas", "quick-payments")}
          >
            <span aria-hidden="true">i</span>
            <div>
              <b>
                {summary.upcomingPayments.length} pagamento(s) nos próximos 14
                dias
              </b>
              <small>{paymentPreview(summary.upcomingPayments)}</small>
            </div>
            <em>Ver</em>
          </button>
        )}
        {!hasFinancialAlerts && cloud !== "local" && (
          <div className="attention-item success">
            <CheckCircle2 size={20} aria-hidden="true" />
            <div>
              <b>Tudo em ordem neste período</b>
              <small>Nenhuma pendência financeira encontrada.</small>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

const categoryPalette = [
  "#a8483e",
  "#c78b45",
  "#527a6c",
  "#596f9d",
  "#9b6a83",
  "#6c8050",
  "#b76e4c",
];

const categoryColor = (key: string) => {
  let hash = 0;
  for (let index = 0; index < key.length; index += 1)
    hash = (hash * 31 + key.charCodeAt(index)) | 0;
  return categoryPalette[Math.abs(hash) % categoryPalette.length];
};

type CategorySlice = {
  key: string;
  name: string;
  amount: number;
  percentage: number;
  color: string;
};

function CategoryDonut({
  title,
  result,
  hideValues,
}: {
  title?: string;
  result: ReturnType<typeof spendingByCategory>;
  hideValues: boolean;
}) {
  const condensed = result.categories.length <= 6
    ? result.categories
    : [
        ...result.categories.slice(0, 6),
        {
          name: "Outras categorias",
          categoryId: undefined,
          amount: result.categories
            .slice(6)
            .reduce((sum, row) => sum + row.amount, 0),
          percentage: result.categories
            .slice(6)
            .reduce((sum, row) => sum + row.percentage, 0),
        },
      ];
  const usedColors = new Set<string>();
  const slices: CategorySlice[] = condensed.map((row) => {
    const key = row.categoryId || row.name;
    let color = categoryColor(key);
    if (usedColors.has(color))
      color = categoryPalette.find((candidate) => !usedColors.has(candidate)) || color;
    usedColors.add(color);
    return {
      key,
      name: row.name,
      amount: row.amount,
      percentage: row.percentage,
      color,
    };
  });
  const [selectedKey, setSelectedKey] = useState(slices[0]?.key || "");
  useEffect(() => {
    if (!slices.some((slice) => slice.key === selectedKey))
      setSelectedKey(slices[0]?.key || "");
  }, [result.total, slices.map((slice) => slice.key).join("|")]);
  const selected =
    slices.find((slice) => slice.key === selectedKey) || slices[0];
  let offset = 0;
  const chartTitle = `${title ? `${title}. ` : ""}${
    hideValues
      ? "Distribuição dos gastos por categoria; valores ocultos"
      : `Distribuição de ${money(result.total)} em gastos por categoria`
  }`;

  if (!slices.length)
    return (
      <div className="category-donut-card category-donut-empty">
        {title && <h3>{title}</h3>}
        <Empty />
      </div>
    );

  return (
    <div className="category-donut-card">
      {title && <h3>{title}</h3>}
      <div className="category-donut-layout">
        <div className="category-donut-visual">
          <svg
            viewBox="0 0 42 42"
            role="img"
            aria-label={chartTitle}
          >
            <title>{chartTitle}</title>
            <circle
              className="category-donut-track"
              cx="21"
              cy="21"
              r="15.9155"
              fill="none"
              strokeWidth="6"
            />
            {slices.map((slice) => {
              const currentOffset = offset;
              offset += slice.percentage;
              const label = hideValues
                ? slice.name
                : `${slice.name}: ${slice.percentage.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% e ${money(slice.amount)}`;
              return (
                <circle
                  key={slice.key}
                  className={`category-donut-slice ${selected?.key === slice.key ? "selected" : ""}`}
                  cx="21"
                  cy="21"
                  r="15.9155"
                  fill="none"
                  pathLength="100"
                  stroke={slice.color}
                  strokeWidth={selected?.key === slice.key ? "7" : "6"}
                  strokeDasharray={`${slice.percentage} ${100 - slice.percentage}`}
                  strokeDashoffset={-currentOffset}
                  transform="rotate(-90 21 21)"
                  aria-hidden="true"
                  focusable="false"
                  onClick={() => setSelectedKey(slice.key)}
                >
                  <title>{label}</title>
                </circle>
              );
            })}
          </svg>
          <div className="category-donut-center" aria-live="polite">
            <small>{selected?.name || "Total"}</small>
            <strong>
              {hideValues
                ? <HiddenValue />
                : `${selected?.percentage.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`}
            </strong>
            <span>{hideValues ? <HiddenValue /> : money(selected?.amount || result.total)}</span>
          </div>
        </div>
        <div className="category-donut-legend">
          {slices.map((slice) => (
            <button
              key={slice.key}
              className={selected?.key === slice.key ? "selected" : ""}
              onClick={() => setSelectedKey(slice.key)}
              aria-pressed={selected?.key === slice.key}
            >
              <i style={{ background: slice.color }} aria-hidden="true" />
              <span>{slice.name}</span>
              <b>
                {hideValues
                  ? <HiddenValue />
                  : `${slice.percentage.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`}
                <small>{hideValues ? <HiddenValue /> : money(slice.amount)}</small>
              </b>
            </button>
          ))}
          {result.categories.length > 6 && (
            <details className="category-donut-others">
              <summary>Ver categorias agrupadas em “Outras”</summary>
              {result.categories.slice(6).map((row) => (
                <div key={row.categoryId || row.name}>
                  <span>{row.name}</span>
                  <b>
                    {hideValues
                      ? <HiddenValue />
                      : `${row.percentage.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% · ${money(row.amount)}`}
                  </b>
                </div>
              ))}
            </details>
          )}
        </div>
      </div>
    </div>
  );
}

function CategorySpendingCharts({
  data,
  month,
  view,
  hideValues,
}: {
  data: FamilyData;
  month: string;
  view: CashView;
  hideValues: boolean;
}) {
  const cash = spendingByCategory(data, month, "cash");
  const accrual = spendingByCategory(data, month, "accrual");
  return (
    <section className="panel category-spending-panel">
      <div className="panel-head">
        <div>
          <h2>Gastos por categoria</h2>
          <p className="muted">
            Participação do realizado e das estimativas acompanhadas no mês.
            Toque em uma categoria para destacá-la.
          </p>
        </div>
      </div>
      <div className={view === "compare" ? "category-donut-compare" : ""}>
        {view === "compare" ? (
          <>
            <CategoryDonut
              title="Fluxo das parcelas"
              result={cash}
              hideValues={hideValues}
            />
            <CategoryDonut
              title="Compra integral"
              result={accrual}
              hideValues={hideValues}
            />
          </>
        ) : (
          <CategoryDonut
            result={view === "accrual" ? accrual : cash}
            hideValues={hideValues}
          />
        )}
      </div>
    </section>
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
  value: React.ReactNode;
  hint: React.ReactNode;
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
  hideValues = false,
}: {
  data: FamilyData;
  month: string;
  view: "cash" | "accrual";
  hideValues?: boolean;
}) {
  const spending = monthlySpending(data, month, view);
  const rows = data.categories
    .filter((c) => c.nature === "expense")
    .map((c) => {
      const planned = budgetValue(data, month, (b) => b.categoryId === c.id);
      const actual = spending
        .filter((entry) => entry.categoryId === c.id && entry.state === "realized")
        .reduce((sum, entry) => sum + entry.amount, 0);
      const estimated = spending
        .filter((entry) => entry.categoryId === c.id && entry.state === "estimated")
        .reduce((sum, entry) => sum + entry.amount, 0);
      return { name: c.name, planned, actual, estimated, tracked: actual + estimated };
    })
    .filter((x) => x.planned || x.tracked)
    .sort((a, b) => b.tracked - a.tracked)
    .slice(0, 8);
  return rows.length ? (
    <div className="bars">
      {rows.map((r) => (
        <div key={r.name}>
          <label>
            <span>{r.name}</span>
            <span>
              <SensitiveMoney value={r.tracked} hidden={hideValues} /> /{" "}
              <SensitiveMoney value={r.planned} hidden={hideValues} />
            </span>
          </label>
          <small><SensitiveMoney value={r.actual} hidden={hideValues} /> realizado · <SensitiveMoney value={r.estimated} hidden={hideValues} /> estimado</small>
          <progress
            value={r.tracked}
            max={r.planned || r.tracked || 1}
            aria-label={hideValues ? "valor oculto" : `${r.name}: ${money(r.tracked)} de ${money(r.planned)}`}
            aria-valuetext={hideValues ? "valor oculto" : `${money(r.tracked)} de ${money(r.planned)}`}
          />
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

const groceryMacro = inferShoppingMacro;

function ProductOccurrenceEditor({
  receipt,
  item,
  macroCategories,
  unitOptions,
  onSave,
  hideValues,
}: {
  receipt: Receipt;
  item: ReceiptItem;
  macroCategories: string[];
  unitOptions: string[][];
  onSave: (receiptId: string, itemId: string, patch: Partial<ReceiptItem>) => void;
  hideValues: boolean;
}) {
  const [draft, setDraft] = useState({ ...item });
  useEffect(() => setDraft({ ...item }), [item]);
  return (
    <div className="receipt-item-edit product-occurrence-edit">
      <div className="occurrence-context">
        <b>{receipt.date}</b>
        <small>{receipt.store}</small>
      </div>
      <input value={draft.description} onChange={(event)=>setDraft({...draft,description:event.target.value})} placeholder="Produto" />
      <select value={draft.macroCategory||"Outros"} onChange={(event)=>setDraft({...draft,macroCategory:event.target.value})}>
        {macroCategories.map(category=><option key={category}>{category}</option>)}
      </select>
      <label>Quantidade<input type="number" inputMode="decimal" step="0.001" value={draft.quantity} onChange={(event)=>setDraft({...draft,quantity:Number(event.target.value)})}/></label>
      <label>Unidade<select value={draft.unit||"un"} onChange={(event)=>setDraft({...draft,unit:event.target.value})}>{unitOptions.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      <label>Valor unitário{hideValues ? <span className="hidden-input"><HiddenValue /></span> : <CurrencyInput value={Number(draft.unitPrice)||0} onChange={(value)=>setDraft({...draft,unitPrice:value})}/>}</label>
      <label>Valor total{hideValues ? <span className="hidden-input"><HiddenValue /></span> : <CurrencyInput value={Number(draft.total)||0} onChange={(value)=>setDraft({...draft,total:value})}/>}</label>
      <button className="primary" onClick={()=>onSave(receipt.id,item.id,draft)}>Salvar esta ocorrência</button>
    </div>
  );
}

function Receipts({
  data,
  mutate,
  setMessage,
  currentMember,
  hideValues,
}: {
  data: FamilyData;
  mutate: (f: (d: FamilyData) => void) => void;
  setMessage: (s: string) => void;
  currentMember: Member;
  hideValues: boolean;
}) {
  const [draft, setDraft] = useState<ReadReceipt>();
  const [editingReceiptId, setEditingReceiptId] = useState<string>();
  const [editingProductKey, setEditingProductKey] = useState<string>();
  const [occurrenceStart, setOccurrenceStart] = useState("");
  const [occurrenceEnd, setOccurrenceEnd] = useState("");
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
      ...audit(currentMember),
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
      if (editingReceiptId) {
        const index = (d.receipts ??= []).findIndex(
          (item) => item.id === editingReceiptId,
        );
        if (index >= 0) {
          receipt.id = editingReceiptId;
          receipt.createdAt = d.receipts[index].createdAt;
          receipt.updatedAt = now();
          receipt.version = d.receipts[index].version + 1;
          receipt.categoryId = d.receipts[index].categoryId;
          receipt.reconciledTransactionId =
            d.receipts[index].reconciledTransactionId;
          d.receipts[index] = receipt;
        }
      } else {
        (d.receipts ??= []).push(receipt);
      }
    });
    setDraft(undefined);
    setEditingReceiptId(undefined);
    setMessage(
      editingReceiptId
        ? "Compra atualizada e sincronização automática iniciada."
        : "Compra registrada e sincronização automática iniciada.",
    );
  };
  const editSavedReceipt = (receipt: Receipt) => {
    setEditingReceiptId(receipt.id);
    setDraft({
      estabelecimento: receipt.store,
      data: receipt.date,
      total: receipt.total,
      confianca: receipt.confidence,
      observacoes: receipt.notes,
      itens: receipt.items.map((item) => ({
        descricao: item.description,
        quantidade: item.quantity,
        unidade: item.unit,
        valorUnitario: item.unitPrice,
        valorTotal: item.total,
        categoriaMacro: item.macroCategory,
      })),
    });
    setMessage("Compra aberta para edição.");
    window.setTimeout(
      () =>
        document
          .querySelector(".receipt-review")
          ?.scrollIntoView({ behavior: "smooth", block: "start" }),
      50,
    );
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
  const macroCategories = [...shoppingMacroCategories];
  const unitOptions = shoppingUnitOptions.map((option) => [...option]);
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
        key,
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
        unit: last?.i.unit || "un",
        averageDays,
        next,
      };
    })
    .sort((a, b) => b.count - a.count);
  const productOccurrences = editingProductKey
    ? allPurchases
        .filter(({ r, i }) =>
          normalize(i.description) === editingProductKey &&
          (!occurrenceStart || r.date >= occurrenceStart) &&
          (!occurrenceEnd || r.date <= occurrenceEnd),
        )
        .sort((a, b) => b.r.date.localeCompare(a.r.date))
    : [];
  const saveProductOccurrence = (
    receiptId: string,
    itemId: string,
    patch: Partial<ReceiptItem>,
  ) => {
    mutate((d) => {
      const receipt = (d.receipts || []).find((entry) => entry.id === receiptId);
      const item = receipt?.items.find((entry) => entry.id === itemId);
      if (!receipt || !item) return;
      Object.assign(item, patch);
      const recalculated = receipt.items.reduce((sum, current) => {
        const total = Number(current.total);
        if (Number.isFinite(total) && total > 0) return sum + total;
        return sum + (Number(current.quantity) || 0) * (Number(current.unitPrice) || 0);
      }, 0);
      if (recalculated > 0)
        receipt.total = Math.round((recalculated + Number.EPSILON) * 100) / 100;
      receipt.updatedAt = now();
      receipt.version++;
    });
    setMessage("Ocorrência atualizada e sincronização automática iniciada.");
  };
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
      <Collapsible id="quick-receipts" title="Adicionar notas e compras">
      <section className="panel supermarket-panel">
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
              data-quick-focus
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
              {hideValues ? (
                <span className="hidden-input"><HiddenValue /></span>
              ) : (
                <CurrencyInput
                  value={Number(draft.total) || 0}
                  onChange={(value) => setDraft({ ...draft, total: value })}
                />
              )}
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
                  <select
                    value={item.unidade || ""}
                    onChange={(e) =>
                      updateItem(index, { unidade: e.target.value })
                    }
                  >
                    <option value="">Selecione</option>
                    {unitOptions.map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Valor unitário
                  {hideValues ? <span className="hidden-input"><HiddenValue /></span> : (
                    <CurrencyInput
                      value={Number(item.valorUnitario) || 0}
                      onChange={(value) =>
                        updateItem(index, { valorUnitario: value })
                      }
                    />
                  )}
                </label>
                <label>
                  Valor total
                  {hideValues ? <span className="hidden-input"><HiddenValue /></span> : (
                    <CurrencyInput
                      value={Number(item.valorTotal) || 0}
                      onChange={(value) =>
                        updateItem(index, { valorTotal: value })
                      }
                    />
                  )}
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
            <div className="actions">
              <button className="primary" onClick={save}>
                {editingReceiptId
                  ? "Salvar alterações"
                  : "Confirmar e salvar nota"}
              </button>
              {editingReceiptId && (
                <button
                  onClick={() => {
                    setDraft(undefined);
                    setEditingReceiptId(undefined);
                  }}
                >
                  Cancelar edição
                </button>
              )}
            </div>
          </div>
        )}
      </section>
      </Collapsible>
      <Collapsible
        id="quick-shopping"
        title={`Lista de compras e sugestões (${(data.shoppingList || []).filter((item) => item.status === "pending").length})`}
      >
        <ShoppingListManager
          data={data}
          currentMember={currentMember}
          mutate={mutate}
          setMessage={setMessage}
          suggestions={products
            .filter((product) => product.next)
            .map((product) => ({
              key: `${product.key}|${product.next}`,
              name: product.name,
              category: product.category,
              quantity: product.averageQuantity,
              unit: product.unit,
              next: product.next!,
              averageDays: product.averageDays,
            }))}
        />
      </Collapsible>
      <Collapsible title={`Compras confirmadas (${history.length})`}>
      <section className="supermarket-panel confirmed-purchases-section">
          <p className="muted">
            Corrija produtos, categorias, quantidades e valores já salvos.
          </p>
          <div className="list">
            {history
              .slice()
              .sort((a, b) => b.date.localeCompare(a.date))
              .map((receipt) => (
                <div className="row editable-row confirmed-purchase-row" key={receipt.id}>
                  <div>
                    <b>{receipt.store}</b>
                    <small>
                      {receipt.date} · {receipt.items.length} item(ns) ·{" "}
                      <SensitiveMoney value={receipt.total} hidden={hideValues} />
                    </small>
                  </div>
                  <div className="actions">
                    <button onClick={() => editSavedReceipt(receipt)}>
                      Editar produtos
                    </button>
                    <button
                      className="danger-button"
                      aria-label={`Excluir compra de ${receipt.store}`}
                      title="Excluir compra"
                      onClick={() =>
                        confirm("Excluir esta compra confirmada?") &&
                        mutate((d) => {
                          d.receipts = (d.receipts || []).filter(
                            (item) => item.id !== receipt.id,
                          );
                        })
                      }
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              ))}
            {!history.length && <Empty />}
          </div>
      </section>
      </Collapsible>
      <Collapsible title={`Catálogo de produtos (${products.length})`}>
      <section className="panel supermarket-panel product-catalog">
        <h2>Produtos e valores médios</h2>
        <p className="muted">
          Edite diretamente o produto consolidado, sem precisar localizar cada compra.
        </p>
        {editingProductKey && (
          <div className="product-occurrences">
            <div className="form-row">
              <label>De<input type="date" value={occurrenceStart} onChange={(event)=>setOccurrenceStart(event.target.value)}/></label>
              <label>Até<input type="date" value={occurrenceEnd} onChange={(event)=>setOccurrenceEnd(event.target.value)}/></label>
              <button onClick={()=>{setOccurrenceStart("");setOccurrenceEnd("")}}>Limpar período</button>
              <button onClick={()=>setEditingProductKey(undefined)}>Fechar ocorrências</button>
            </div>
            <p className="muted">{productOccurrences.length} ocorrência(s), da mais recente para a mais antiga. Salve somente as que desejar alterar.</p>
            {productOccurrences.map(({r,i})=><ProductOccurrenceEditor key={`${r.id}:${i.id}`} receipt={r} item={i} macroCategories={macroCategories} unitOptions={unitOptions} onSave={saveProductOccurrence} hideValues={hideValues}/>)}
            {!productOccurrences.length&&<Empty/>}
          </div>
        )}
        {products.length ? (
          products.map((p) => (
            <div className="row editable-row" key={p.key}>
              <div>
                <b>{p.name}</b>
                <small>{`${p.category} · ${p.unit} · ${p.count} ocorrência(s) · quantidade média ${p.averageQuantity.toFixed(1)} · último local: ${p.store || "não identificado"}`}</small>
              </div>
              <div className="actions">
                <span>{p.price == null ? "—" : <><SensitiveMoney value={p.price} hidden={hideValues} /> médio</>}</span>
                <button
                  onClick={() => {
                    setEditingProductKey(p.key);
                    setOccurrenceStart("");
                    setOccurrenceEnd("");
                  }}
                >
                  Ver e editar ocorrências
                </button>
              </div>
            </div>
          ))
        ) : (
          <Empty />
        )}
      </section>
      </Collapsible>
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
            await readVoiceExpense(new Blob(chunks.current, { type: active.mimeType }),{categories:data.categories.map(category=>({name:category.name,subcategories:category.subcategories})),accounts:data.accounts.filter(account=>account.active).map(account=>({name:account.name,institution:account.institution,holder:accountHolder(account),operator:account.operator}))}),
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
      estimateOrigin: "voice" as const,
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
          data-quick-focus
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
          <select value={draft.contaOuCartaoSugerido||""} onChange={e=>setDraft({...draft,contaOuCartaoSugerido:e.target.value})}><option value="">Selecione a conta ou cartão</option>{data.accounts.filter(account=>account.active).map(account=><option key={account.id} value={account.name}>{account.name}</option>)}</select>
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
  hideValues,
}: {
  data: FamilyData;
  mutate: (f: (d: FamilyData) => void) => void;
  setMessage: (s: string) => void;
  hideValues: boolean;
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
      const loaded: Preview[] = [];
      for (let index = 0; index < files.length; index++) {
        const file = files[index];
        setMessage(`Processando arquivo ${index + 1} de ${files.length}…`);
        const isPdf = /\.pdf$/i.test(file.name);
        const selectedInstitution = data.accounts.find(
          (item) => item.id === account,
        )?.institution || "";
        let passwordLookupError: unknown;
        let protectedPasswords: string[] = [];
        if (!pdfPassword && isPdf) {
          try {
            protectedPasswords = await getProtectedPdfPasswords(
              identifyPdfBank(`${file.name} ${selectedInstitution}`),
            );
          } catch (error) {
            passwordLookupError = error;
          }
        }
        const attempts: Array<string | undefined> = isPdf
          ? (pdfPassword ? [pdfPassword] : [...protectedPasswords, undefined])
          : [undefined];
        try {
          const preview = isPdf
            ? await tryPdfPasswordCandidates(attempts, (password) =>
                previewFile(
                  file,
                  data,
                  account || undefined,
                  undefined,
                  password,
                ))
            : await previewFile(file, data, account || undefined);
          loaded.push(preview);
        } catch (error) {
          // Se o cofre de senhas falhou e o PDF confirmou que exige senha,
          // exponha a falha do cofre em vez de alegar que a senha está errada.
          const visibleError = passwordLookupError && isPdfPasswordError(error)
            ? passwordLookupError
            : error;
          setMessage(`${file.name}: ${(visibleError as Error).message}`);
        }
      }
      setPreviews(loaded);
    } catch (e) {
      setMessage((e as Error).message);
    }
  };
  const confirm = () => {
    if (!previews.length) return;
    let reconciled = 0;
    mutate((d) => {
      for(const preview of previews){
        reconciled += reconcileImportedTransactions(d, preview.rows);
        d.transactions.push(...preview.rows);
        d.imports.push({...audit(preview.operator),filename:preview.filename,hash:preview.hash,institution:preview.institution,count:preview.rows.length,duplicates:preview.duplicates});
      }
    });
    setMessage(`${previews.reduce((sum,item)=>sum+item.rows.length,0)} lançamentos de ${previews.length} arquivo(s) importados.${reconciled ? ` ${reconciled} registro(s) preliminar(es) conciliado(s).` : ""}`);
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
              {a.name}
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
        <button data-quick-focus className="primary" onClick={() => input.current?.click()}>
          <Upload size={17} /> Escolher arquivo
        </button>
      </div>
      {previews.length>0 && (
        <>
          {previews.map(preview=><div key={preview.hash}><div className="summary"><b>{preview.filename}</b><span className="status confirmed">{preview.institution} · {data.accounts.find(a=>a.id===preview.accountId)?.name} · {preview.operator}</span><span>{preview.rows.length} novos</span><span>{preview.duplicates} duplicados ignorados</span><span>{preview.rows.filter(r=>r.classification==="suggested").length} sugestões</span><small>Identificado por: {preview.detectedBy}</small></div><TransactionTable rows={preview.rows.slice(0,20)} data={data} hideValues={hideValues}/></div>)}
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
  hideValues,
}: {
  rows: Transaction[];
  data: FamilyData;
  hideValues: boolean;
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
              <td><SensitiveMoney value={t.amount} hidden={hideValues} /></td>
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
  focusTransactionId,
  onFocusHandled,
  hideValues,
}: {
  data: FamilyData;
  month: string;
  mutate: (f: (d: FamilyData) => void) => void;
  focusTransactionId?: string;
  onFocusHandled?: () => void;
  hideValues: boolean;
}) {
  const [filter, setFilter] = useState("review");
  const [selected,setSelected]=useState<Set<string>>(new Set());
  const [bulkCategory,setBulkCategory]=useState("");
  const undoTransactions=useRef<Transaction[]>();
  const [startDate, setStartDate] = useState(`${month}-01`);
  const [endDate, setEndDate] = useState(`${month}-31`);
  const [pendingFocusId, setPendingFocusId] = useState<string>();
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
  useEffect(() => {
    if (!focusTransactionId) return;
    const transaction = data.transactions.find(
      (item) => item.id === focusTransactionId,
    );
    if (!transaction) {
      onFocusHandled?.();
      return;
    }
    setFilter("all");
    setStartDate(transaction.date);
    setEndDate(transaction.date);
    setPendingFocusId(transaction.id);
  }, [focusTransactionId]);
  useEffect(() => {
    if (!pendingFocusId) return;
    let cancelled = false;
    let frame = 0;
    let attempts = 0;
    const focusWhenVisible = () => {
      if (cancelled) return;
      const element = document.getElementById(`transaction-${pendingFocusId}`);
      if (!element || element.getClientRects().length === 0) {
        attempts += 1;
        if (attempts < 12)
          frame = window.requestAnimationFrame(focusWhenVisible);
        return;
      }
      element.scrollIntoView({ behavior: "smooth", block: "center" });
      element.focus({ preventScroll: true });
      setPendingFocusId(undefined);
      onFocusHandled?.();
    };
    frame = window.requestAnimationFrame(focusWhenVisible);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, [pendingFocusId, filter, startDate, endDate]);
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
  const bulkApply=(action:"confirm"|"category"|"delete")=>{if(!selectedRows.length)return;const total=selectedRows.reduce((sum,row)=>sum+Math.abs(row.amount),0);if(!confirm(`${action==="delete"?"Excluir":"Alterar"} ${selectedRows.length} lançamento(s)${hideValues?"":`, total ${money(total)}`}?`))return;remember();mutate(d=>{if(action==="delete")d.transactions=d.transactions.filter(row=>!selected.has(row.id));else d.transactions.filter(row=>selected.has(row.id)).forEach(row=>{if(action==="confirm")row.classification="confirmed";if(action==="category"){const category=d.categories.find(c=>c.id===bulkCategory);row.categoryId=bulkCategory;row.subcategory=category?.subcategories[0];row.classification="confirmed"}row.updatedAt=now();row.version++})});setSelected(new Set())};
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
      <div className="bulk-toolbar"><label><input type="checkbox" checked={rows.length>0&&selectedRows.length===rows.length} onChange={e=>setSelected(e.target.checked?new Set(rows.map(row=>row.id)):new Set())}/> Selecionar todos os filtrados</label><b>{selectedRows.length} selecionado(s) · <SensitiveMoney value={selectedRows.reduce((sum,row)=>sum+Math.abs(row.amount),0)} hidden={hideValues} /></b><button onClick={()=>bulkApply("confirm")}>Confirmar em massa</button><select value={bulkCategory} onChange={e=>setBulkCategory(e.target.value)}><option value="">Categoria em massa</option>{data.categories.map(category=><option key={category.id} value={category.id}>{category.name}</option>)}</select><button disabled={!bulkCategory} onClick={()=>bulkApply("category")}>Aplicar categoria</button><button className="danger-button" onClick={()=>bulkApply("delete")}>Excluir selecionados</button>{undoTransactions.current&&<button onClick={undoBulk}>Desfazer última operação</button>}</div>
      <div className="transaction-list">
        {rows.map((t) => (
          <div
            id={`transaction-${t.id}`}
            tabIndex={-1}
            className={`transaction-edit ${t.classification==="confirmed"?"confirmed-item":""}`}
            key={t.id}
          >
            <input type="checkbox" checked={selected.has(t.id)} onChange={e=>setSelected(current=>{const next=new Set(current);e.target.checked?next.add(t.id):next.delete(t.id);return next})}/>
            <div className="tx-main">
              <input value={t.description} onChange={e=>update(t.id,{description:e.target.value,normalized:normalize(e.target.value)})}/>
              <div className="tx-core-fields"><input type="date" value={t.date} onChange={e=>update(t.id,{date:e.target.value,paymentDate:e.target.value,competence:monthOf(e.target.value)})}/>{hideValues ? <span className="hidden-input"><HiddenValue /></span> : <CurrencyInput value={Math.abs(t.amount)} onChange={value=>update(t.id,{amount:t.amount<0?-Math.abs(value):Math.abs(value)})}/>}</div>
              <small>{t.estimated?`Estimativa ${t.estimateOrigin==="manual"?"manual":"por voz"} · `:""}{t.classification==="confirmed"?"Confirmado":"Em revisão"}</small>
            </div>
            <select value={t.accountId} onChange={e=>update(t.id,{accountId:e.target.value})}>{data.accounts.filter(account=>account.active).map(account=><option key={account.id} value={account.id}>{account.name}</option>)}</select>
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
  hideValues,
}: {
  data: FamilyData;
  month: string;
  view: CashView;
  setView: (v: CashView) => void;
  mutate: (f: (d: FamilyData) => void) => void;
  hideValues: boolean;
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
            <h2>Realizado e estimado</h2>
            {view === "compare" ? (
              <>
                <h3>Fluxo</h3>
                <BudgetBars data={data} month={month} view="cash" hideValues={hideValues} />
                <h3>Compra integral</h3>
                <BudgetBars data={data} month={month} view="accrual" hideValues={hideValues} />
              </>
            ) : (
              <BudgetBars data={data} month={month} view={view} hideValues={hideValues} />
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
  hideValues,
}: {
  data: FamilyData;
  mutate: (f: (d: FamilyData) => void) => void;
  hideValues: boolean;
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
        categoryId: String(fd.get("categoryId") || "") || undefined,
        status: "A pagar",
      }),
    );
  const mark = (id: string) => {
    if (hideValues)
      return alert("Mostre os valores pelo botão do olho para confirmar o pagamento.");
    const current=data.obligations.find(o=>o.id===id)!;
    const raw=prompt("Valor efetivamente pago:",hideValues?"":money(current.planned)); if(raw===null)return;
    const paidAmount=parseCurrency(raw); if(paidAmount<=0)return alert("Informe um valor maior que zero.");
    const paidAt=prompt("Data efetiva do pagamento (AAAA-MM-DD):",dateOnly(new Date())); if(!paidAt||!/^\d{4}-\d{2}-\d{2}$/.test(paidAt))return alert("Data inválida.");
    const account=current.accountId||data.accounts[0]?.id; if(!account)return alert("Cadastre uma conta para o pagamento.");
    mutate(d=>{const o=d.obligations.find(x=>x.id===id)!;o.status="Paga";o.paidAt=paidAt;o.paidAmount=paidAmount;o.reconciledTransactionId=undefined;const accountOwner=d.accounts.find(item=>item.id===account)?.operator||"Ambos";const rule=suggest(o.name,account,accountOwner,d.rules);const fallback=d.categories.find(category=>normalize(category.name)==="OUTROS")?.id;d.transactions=d.transactions.filter(t=>t.obligationId!==id);d.transactions.push({...audit(accountOwner),date:paidAt,competence:monthOf(paidAt),purchaseDate:o.dueDate,paymentDate:paidAt,description:o.name,normalized:normalize(o.name),amount:paidAmount,accountId:account,operator:accountOwner,scope:"Familiar",categoryId:o.categoryId||rule?.categoryId||fallback,subcategory:o.subcategory||rule?.subcategory,classification:o.categoryId?"confirmed":rule?"suggested":"pending",dedupeKey:`payment:${id}:${paidAt}`,transfer:false,movement:"expense_income",sourceKind:"statement",obligationId:id,provisional:true,notes:`Pagamento realizado. Previsto: ${money(o.planned)}`})});
  };
  const edit = (id: string) => {
    if (hideValues)
      return alert("Mostre os valores pelo botão do olho para editar este pagamento.");
    const current = data.obligations.find((o) => o.id === id)!;
    const name = prompt("Nome do compromisso:", current.name);
    if (!name) return;
    const planned = prompt("Valor planejado:", hideValues ? "" : money(current.planned));
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
    const tolerance = prompt("Tolerância de valor:", hideValues ? "" : money(current.tolerance));
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
        <button
          data-quick-focus
          data-quick-expand="true"
          className="primary"
          aria-expanded={show}
          onClick={() => setShow(!show)}
        >
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
              <select name="accountId"><option value="">Conta do pagamento</option>{data.accounts.filter(account=>account.active).map(account=><option key={account.id} value={account.id}>{account.name}</option>)}</select>
              <select name="categoryId"><option value="">Categoria da despesa</option>{data.categories.filter(category=>category.nature==="expense").map(category=><option key={category.id} value={category.id}>{category.name}</option>)}</select>
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
                <strong><SensitiveMoney value={o.planned} hidden={hideValues} /></strong>
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
      <details className="completed-block"><summary>Pagamentos confirmados ({data.obligations.filter(o=>["Paga","Confirmada","Dispensada"].includes(o.status)).length})</summary>{data.obligations.filter(o=>["Paga","Confirmada","Dispensada"].includes(o.status)).sort((a,b)=>b.dueDate.localeCompare(a.dueDate)).map(o=><div className="confirmed-row" key={o.id}><div><b>{o.name}</b><small>{o.dueDate} · <SensitiveMoney value={o.paidAmount??o.planned} hidden={hideValues} /> · {o.status}</small></div><button onClick={()=>mutate(d=>{const item=d.obligations.find(x=>x.id===o.id);if(item){item.status="A pagar";item.paidAt=undefined;item.paidAmount=undefined;item.reconciledTransactionId=undefined;d.transactions=d.transactions.filter(transaction=>transaction.obligationId!==o.id||!transaction.provisional);for(const transaction of d.transactions)if(transaction.obligationId===o.id)transaction.obligationId=undefined}})}>Desconfirmar</button></div>)}</details>
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
          <button
            data-quick-focus
            data-quick-expand="true"
            className="primary"
            aria-expanded={show}
            onClick={() => setShow(!show)}
          >
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

function AccountFields({ account }: { account?: Account }) {
  const supportedKind =
    account && ["checking", "card", "investment"].includes(account.kind)
      ? account.kind
      : "";
  return (
    <>
      <label className="field account-name-field">
        <span>Nome</span>
        <input
          name="name"
          required
          defaultValue={account?.name || ""}
          placeholder="Ex.: Inter, conta 1234 ou cartão 5678"
          autoComplete="off"
        />
        <small>Use: instituição, número ou identificação da conta/cartão.</small>
      </label>
      <label className="field">
        <span>Tipo de conta</span>
        <select name="kind" required defaultValue={supportedKind}>
          <option value="" disabled>
            {account?.kind === "cash"
              ? "Dinheiro é um tipo antigo — escolha o novo tipo"
              : "Selecione o tipo"}
          </option>
          <option value="investment">Investimento</option>
          <option value="checking">Conta corrente</option>
          <option value="card">Cartão</option>
        </select>
      </label>
      <label className="field account-ownership-field">
        <span>Responsabilidade / Titularidade</span>
        <select
          name="ownership"
          required
          defaultValue={account ? accountOwnershipValue(account) : ""}
        >
          <option value="" disabled>
            Selecione quem é o titular e quem usa
          </option>
          {ACCOUNT_OWNERSHIP_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <small>
          O titular identifica a fatura; o uso define o orçamento familiar ou
          pessoal.
        </small>
      </label>
    </>
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
  const [editingAccountId, setEditingAccountId] = useState<string>();
  const restore = async (file?: File) => {
    if (!file) return;
    try {
      const restored = { ...(await restoreJson(file)), lastSavedAt: now() };
      mutate((draft) => Object.assign(draft, restored));
      setMessage("Backup restaurado.");
    } catch (e) {
      setMessage((e as Error).message);
    }
  };
  const readAccountForm = (fd: FormData, editingId?: string) => {
    const name = String(fd.get("name") || "").trim();
    if (!name) throw new Error("Informe o nome da conta ou cartão.");
    if (
      data.accounts.some(
        (account) =>
          account.id !== editingId && normalize(account.name) === normalize(name),
      )
    )
      throw new Error("Já existe uma conta ou cartão com esse nome.");
    const kind = String(fd.get("kind")) as Account["kind"];
    if (!["checking", "card", "investment"].includes(kind))
      throw new Error("Selecione o tipo de conta.");
    const ownership = parseAccountOwnership(String(fd.get("ownership") || ""));
    const existing = editingId
      ? data.accounts.find((account) => account.id === editingId)
      : undefined;
    const nameWasKept = Boolean(
      existing && normalize(existing.name) === normalize(name),
    );
    return {
      name,
      kind,
      ...ownership,
      institution:
        nameWasKept && existing?.institution
          ? existing.institution
          : inferInstitution(name),
      lastDigits:
        (nameWasKept ? existing?.lastDigits : undefined) ||
        inferLastDigits(name) ||
        existing?.lastDigits,
    };
  };
  const addAccount = (fd: FormData) => {
    try {
      const values = readAccountForm(fd);
      mutate((d) =>
        d.accounts.push({
          ...audit(),
          ...values,
          active: true,
          importAliases: [values.name],
        }),
      );
      setMessage("Conta ou cartão adicionado.");
      return true;
    } catch (error) {
      setMessage((error as Error).message);
      return false;
    }
  };
  const editAccount = (id: string, fd: FormData) => {
    try {
      const values = readAccountForm(fd, id);
      mutate((d) => {
        const item = d.accounts.find((account) => account.id === id)!;
        Object.assign(item, values);
        item.importAliases = Array.from(
          new Set([...(item.importAliases || []), values.name]),
        );
        item.updatedAt = now();
        item.version++;
      });
      setEditingAccountId(undefined);
      setMessage("Conta ou cartão atualizado.");
    } catch (error) {
      setMessage((error as Error).message);
    }
  };
  const removeAccount = (id: string) => {
    const used =
      data.transactions.some((t) => t.accountId === id) ||
      data.budgets.some((b) => b.accountId === id) ||
      data.obligations.some((obligation) => obligation.accountId === id) ||
      data.rules.some((rule) => rule.accountId === id);
    if (used)
      return alert(
        "Esta conta possui lançamentos, orçamentos, pagamentos ou regras vinculados. Remova os vínculos antes de excluir.",
      );
    if (confirm("Excluir esta conta/cartão?"))
      mutate((d) => {
        d.accounts = d.accounts.filter((a) => a.id !== id);
      });
  };
  return (
    <div className={mode === "all" ? "grid two" : "grid"}>
      {mode !== "categories" && (
        <section className="panel">
          <h2>Contas e cartões</h2>
          <p className="muted">
            Informe somente o nome, o tipo e a combinação entre titular e uso.
            O reconhecimento das importações será preparado automaticamente.
          </p>
          <form
            className="account-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (addAccount(new FormData(event.currentTarget)))
                event.currentTarget.reset();
            }}
          >
            <AccountFields />
            <button type="submit">Adicionar conta ou cartão</button>
          </form>
          <div className="list account-list">
            {!data.accounts.length && (
              <p className="empty">Nenhuma conta ou cartão cadastrado.</p>
            )}
            {data.accounts.map((account) => (
              <div className="account-entry" key={account.id}>
                <div className="row editable-row account-row">
                  <div>
                    <b>{account.name}</b>
                    <small>{accountKindLabel(account.kind)}</small>
                    <small>{accountResponsibilityLabel(account)}</small>
                  </div>
                  <div className="actions">
                    <button
                      type="button"
                      aria-expanded={editingAccountId === account.id}
                      onClick={() =>
                        setEditingAccountId((current) =>
                          current === account.id ? undefined : account.id,
                        )
                      }
                    >
                      {editingAccountId === account.id ? "Fechar" : "Editar"}
                    </button>
                    <button
                      type="button"
                      className="danger-button"
                      aria-label={`Excluir ${account.name}`}
                      onClick={() => removeAccount(account.id)}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
                {editingAccountId === account.id && (
                  <form
                    className="account-form account-edit-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      editAccount(account.id, new FormData(event.currentTarget));
                    }}
                  >
                    <AccountFields account={account} />
                    <div className="actions account-form-actions">
                      <button type="submit">Salvar alterações</button>
                      <button
                        type="button"
                        onClick={() => setEditingAccountId(undefined)}
                      >
                        Cancelar
                      </button>
                    </div>
                  </form>
                )}
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

function Analytics({
  data,
  hadStoredPreferences,
}: {
  data: FamilyData;
  hadStoredPreferences: boolean;
}) {
  const [initialPreferences] = useState(() => loadUiPreferences().analytics);
  const available = [
    ...new Set(
      data.transactions
        .filter((transaction) => !transaction.estimated)
        .map((transaction) => monthOf(transaction.paymentDate || transaction.date)),
    ),
  ].sort();
  const [start, setStart] = useState(
    hadStoredPreferences
      ? initialPreferences.start
      : available[0] || initialPreferences.start,
  );
  const [end, setEnd] = useState(
    hadStoredPreferences
      ? initialPreferences.end
      : available.at(-1) || initialPreferences.end,
  );
  const [mode, setMode] = useState<"cash" | "accrual">(
    initialPreferences.mode,
  );
  const [report, setReport] = useState<"budget" | "reserve" | "final">(
    initialPreferences.report,
  );
  const [accountId, setAccountId] = useState(
    initialPreferences.accountId === "all" ||
      data.accounts.some((account) => account.id === initialPreferences.accountId)
      ? initialPreferences.accountId
      : "all",
  );
  useEffect(() => {
    if (
      accountId !== "all" &&
      !data.accounts.some((account) => account.id === accountId)
    ) {
      setAccountId("all");
    }
  }, [accountId, data.accounts]);
  useEffect(() => {
    const current = loadUiPreferences();
    saveUiPreferences({
      ...current,
      analytics: { start, end, mode, report, accountId },
    });
  }, [start, end, mode, report, accountId]);
  const months = available.filter((month) => month >= start && month <= end);
  const belongs = (t: Transaction, kind: "budget" | "reserve" | "final") =>
    !t.estimated &&
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
                  <small>{accountResponsibilityLabel(row.account)}</small>
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
  autoFocus,
}: {
  name: string;
  defaultValue?: number;
  placeholder?: string;
  required?: boolean;
  autoFocus?: boolean;
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
      autoFocus={autoFocus}
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
function Row({ a, b, c }: { a: string; b: string; c: React.ReactNode }) {
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
