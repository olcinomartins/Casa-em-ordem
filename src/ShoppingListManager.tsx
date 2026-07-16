import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Mic, Plus, Square, Trash2 } from "lucide-react";
import {
  FamilyData,
  Member,
  ShoppingListItem,
  audit,
  normalize,
  now,
} from "./domain";
import {
  ShoppingItemDraft,
  parseShoppingSpeech,
  shoppingMacroCategories,
  shoppingUnitOptions,
} from "./shoppingList";

export interface ShoppingSuggestion {
  key: string;
  name: string;
  category: string;
  quantity: number;
  unit: string;
  next: string;
  averageDays?: number;
}

interface SpeechAlternativeLike {
  transcript: string;
}
interface SpeechResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: SpeechAlternativeLike;
}
interface SpeechResultListLike {
  readonly length: number;
  [index: number]: SpeechResultLike;
}
interface SpeechEventLike extends Event {
  results: SpeechResultListLike;
}
interface SpeechErrorLike extends Event {
  error: string;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((event: SpeechEventLike) => void) | null;
  onerror: ((event: SpeechErrorLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

const speechConstructor = () => {
  const browserWindow = window as typeof window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return (
    browserWindow.SpeechRecognition || browserWindow.webkitSpeechRecognition
  );
};

const emptyDraft = (): ShoppingItemDraft => ({
  name: "",
  quantity: 1,
  unit: "un",
  macroCategory: "Outros",
  notes: "",
});

const touch = (item: ShoppingListItem, member: Member) => {
  item.updatedAt = now();
  item.updatedBy = member;
  item.version += 1;
};

function ShoppingFields({
  draft,
  setDraft,
  nameRef,
}: {
  draft: ShoppingItemDraft;
  setDraft: (draft: ShoppingItemDraft) => void;
  nameRef?: React.RefObject<HTMLInputElement>;
}) {
  return (
    <div className="shopping-fields">
      <label className="shopping-product-name">
        Produto
        <input
          data-quick-focus
          ref={nameRef}
          value={draft.name}
          placeholder="Ex.: arroz integral"
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
        />
      </label>
      <label>
        Quantidade
        <input
          type="number"
          inputMode="decimal"
          min="0.001"
          step="0.001"
          value={draft.quantity}
          onChange={(event) =>
            setDraft({ ...draft, quantity: Number(event.target.value) })
          }
        />
      </label>
      <label>
        Unidade
        <select
          value={draft.unit}
          onChange={(event) => setDraft({ ...draft, unit: event.target.value })}
        >
          {shoppingUnitOptions.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Categoria
        <select
          value={draft.macroCategory}
          onChange={(event) =>
            setDraft({ ...draft, macroCategory: event.target.value })
          }
        >
          {shoppingMacroCategories.map((category) => (
            <option key={category}>{category}</option>
          ))}
        </select>
      </label>
      <label className="shopping-notes">
        Observação (opcional)
        <input
          value={draft.notes}
          placeholder="Ex.: sem lactose ou marca preferida"
          onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
        />
      </label>
    </div>
  );
}

function ShoppingItemEditor({
  item,
  currentMember,
  mutate,
  close,
  setMessage,
}: {
  item: ShoppingListItem;
  currentMember: Member;
  mutate: (f: (data: FamilyData) => void) => void;
  close: () => void;
  setMessage: (message: string) => void;
}) {
  const [draft, setDraft] = useState<ShoppingItemDraft>({
    name: item.name,
    quantity: item.quantity,
    unit: item.unit,
    macroCategory: item.macroCategory,
    notes: item.notes || "",
  });
  const save = () => {
    if (!draft.name.trim() || !Number.isFinite(draft.quantity) || draft.quantity <= 0) {
      setMessage("Informe o produto e uma quantidade maior que zero.");
      return;
    }
    mutate((data) => {
      const current = (data.shoppingList || []).find(
        (entry) => entry.id === item.id,
      );
      if (!current) return;
      current.name = draft.name.trim();
      current.quantity = draft.quantity;
      current.unit = draft.unit;
      current.macroCategory = draft.macroCategory;
      current.notes = draft.notes.trim() || undefined;
      touch(current, currentMember);
    });
    close();
    setMessage("Produto atualizado e sincronização automática iniciada.");
  };
  return (
    <div className="shopping-item-editor">
      <ShoppingFields draft={draft} setDraft={setDraft} />
      <div className="actions shopping-entry-actions">
        <button className="primary" onClick={save}>
          Salvar alterações
        </button>
        <button onClick={close}>Cancelar</button>
      </div>
    </div>
  );
}

export function ShoppingListManager({
  data,
  suggestions,
  currentMember,
  mutate,
  setMessage,
}: {
  data: FamilyData;
  suggestions: ShoppingSuggestion[];
  currentMember: Member;
  mutate: (f: (data: FamilyData) => void) => void;
  setMessage: (message: string) => void;
}) {
  const [draft, setDraft] = useState(emptyDraft);
  const [source, setSource] = useState<"manual" | "voice">("manual");
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [editingId, setEditingId] = useState<string>();
  const recognitionRef = useRef<SpeechRecognitionLike>();
  const transcriptRef = useRef("");
  const nameRef = useRef<HTMLInputElement>(null);
  const items = data.shoppingList || [];
  const pending = items.filter((item) => item.status === "pending");
  const completed = items
    .filter((item) => item.status === "completed")
    .sort((a, b) => (b.completedAt || "").localeCompare(a.completedAt || ""));

  useEffect(
    () => () => {
      recognitionRef.current?.abort();
    },
    [],
  );

  const applyTranscript = (text: string) => {
    const clean = text.trim();
    if (!clean) return;
    setDraft(parseShoppingSpeech(clean));
    setSource("voice");
  };

  const startVoice = () => {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const Recognition = speechConstructor();
    if (!Recognition) {
      nameRef.current?.focus();
      setMessage(
        "Este navegador não oferece reconhecimento direto. Toque no campo Produto e use o microfone do teclado do iPhone.",
      );
      return;
    }
    transcriptRef.current = "";
    setTranscript("");
    const recognition = new Recognition();
    recognition.lang = "pt-BR";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => setListening(true);
    recognition.onresult = (event) => {
      let heard = "";
      let hasFinalResult = false;
      for (let index = 0; index < event.results.length; index += 1) {
        heard += `${event.results[index][0]?.transcript || ""} `;
        hasFinalResult ||= event.results[index].isFinal;
      }
      heard = heard.trim();
      transcriptRef.current = heard;
      setTranscript(heard);
      if (hasFinalResult) applyTranscript(heard);
    };
    recognition.onerror = (event) => {
      const messages: Record<string, string> = {
        "not-allowed": "Autorize o microfone para adicionar produtos por voz.",
        "audio-capture": "O navegador não encontrou um microfone disponível.",
        "no-speech": "Nenhuma fala foi identificada. Tente novamente, mais perto do microfone.",
      };
      setMessage(messages[event.error] || `Não foi possível ouvir: ${event.error}.`);
    };
    recognition.onend = () => {
      setListening(false);
      applyTranscript(transcriptRef.current);
      recognitionRef.current = undefined;
    };
    recognitionRef.current = recognition;
    setListening(true);
    try {
      recognition.start();
    } catch {
      recognitionRef.current = undefined;
      setListening(false);
      setMessage("Não foi possível iniciar o microfone. Tente novamente.");
    }
  };

  const add = () => {
    const name = draft.name.trim();
    if (!name || !Number.isFinite(draft.quantity) || draft.quantity <= 0) {
      setMessage("Informe o produto e uma quantidade maior que zero.");
      return;
    }
    if (
      pending.some(
        (item) => normalize(item.name) === normalize(name) && item.unit === draft.unit,
      )
    ) {
      setMessage("Este produto já está na lista. Use Editar para ajustar a quantidade.");
      return;
    }
    mutate((family) => {
      (family.shoppingList ??= []).push({
        ...audit(currentMember),
        name,
        quantity: draft.quantity,
        unit: draft.unit,
        macroCategory: draft.macroCategory,
        notes: draft.notes.trim() || undefined,
        source,
        status: "pending",
      });
    });
    setDraft(emptyDraft());
    setTranscript("");
    setSource("manual");
    setMessage("Produto adicionado à lista e sincronização automática iniciada.");
  };

  const addSuggestion = (suggestion: ShoppingSuggestion) => {
    if (
      pending.some(
        (item) =>
          normalize(item.name) === normalize(suggestion.name) &&
          item.unit === suggestion.unit,
      )
    ) {
      setMessage("Este produto já está na lista de compras.");
      return;
    }
    mutate((family) => {
      (family.shoppingList ??= []).push({
        ...audit(currentMember),
        name: suggestion.name,
        quantity: Math.max(0.001, Number(suggestion.quantity.toFixed(3))),
        unit: suggestion.unit,
        macroCategory: suggestion.category,
        source: "suggestion",
        status: "pending",
        suggestionKey: suggestion.key,
      });
    });
    setMessage("Sugestão adicionada à lista e sincronização automática iniciada.");
  };

  const changeStatus = (
    id: string,
    status: "pending" | "completed" | "dismissed",
  ) =>
    mutate((family) => {
      const item = (family.shoppingList || []).find((entry) => entry.id === id);
      if (!item) return;
      item.status = status;
      item.completedAt = status === "completed" ? now() : undefined;
      item.dismissedAt = status === "dismissed" ? now() : undefined;
      if (status === "completed" && !item.suggestionKey) {
        item.suggestionKey = suggestions.find(
          (suggestion) =>
            normalize(suggestion.name) === normalize(item.name) &&
            suggestion.unit === item.unit,
        )?.key;
      }
      touch(item, currentMember);
    });

  const remove = (item: ShoppingListItem) => {
    if (!confirm(`Excluir “${item.name}” da lista?`)) return;
    mutate((family) => {
      if (item.suggestionKey) {
        const current = (family.shoppingList || []).find(
          (entry) => entry.id === item.id,
        );
        if (current) {
          current.status = "dismissed";
          current.completedAt = undefined;
          current.dismissedAt = now();
          touch(current, currentMember);
        }
      } else {
        family.shoppingList = (family.shoppingList || []).filter(
          (entry) => entry.id !== item.id,
        );
      }
    });
    setMessage("Produto removido e sincronização automática iniciada.");
  };

  const dismissSuggestion = (suggestion: ShoppingSuggestion) => {
    mutate((family) => {
      (family.shoppingList ??= []).push({
        ...audit(currentMember),
        name: suggestion.name,
        quantity: Math.max(0.001, Number(suggestion.quantity.toFixed(3))),
        unit: suggestion.unit,
        macroCategory: suggestion.category,
        source: "suggestion",
        status: "dismissed",
        suggestionKey: suggestion.key,
        dismissedAt: now(),
      });
    });
    setMessage("Sugestão ignorada para este ciclo de compra.");
  };

  const visibleSuggestions = suggestions
    .filter(
      (suggestion) =>
        !items.some(
          (item) =>
            item.suggestionKey === suggestion.key ||
            (item.status === "pending" &&
              normalize(item.name) === normalize(suggestion.name)),
        ),
    )
    .sort((a, b) => a.next.localeCompare(b.next));

  const renderItem = (item: ShoppingListItem, isCompleted = false) => (
    <article
      key={item.id}
      className={`shopping-list-item ${isCompleted ? "shopping-list-item-completed" : ""}`}
    >
      {editingId === item.id ? (
        <ShoppingItemEditor
          item={item}
          currentMember={currentMember}
          mutate={mutate}
          close={() => setEditingId(undefined)}
          setMessage={setMessage}
        />
      ) : (
        <>
          <div className="shopping-item-copy">
            <b>{item.name}</b>
            <small>
              {item.quantity.toLocaleString("pt-BR", {
                maximumFractionDigits: 3,
              })}{" "}
              {item.unit} · {item.macroCategory}
              {item.notes ? ` · ${item.notes}` : ""}
            </small>
            <small>
              {item.source === "voice"
                ? "Adicionado por voz"
                : item.source === "suggestion"
                  ? "Adicionado a partir de sugestão"
                  : "Adicionado por escrito"}{" "}
              · {item.updatedBy}
            </small>
          </div>
          <div className="actions shopping-item-actions">
            <button
              className={isCompleted ? undefined : "success-button"}
              onClick={() => {
                changeStatus(item.id, isCompleted ? "pending" : "completed");
                setMessage(
                  isCompleted
                    ? "Produto devolvido à lista de compras."
                    : "Produto marcado como comprado e movido para Concluídos.",
                );
              }}
            >
              <CheckCircle2 size={16} />
              {isCompleted ? "Desmarcar" : "Comprado"}
            </button>
            <button onClick={() => setEditingId(item.id)}>Editar</button>
            <button className="danger-button" onClick={() => remove(item)}>
              <Trash2 size={15} />
              <span>Excluir</span>
            </button>
          </div>
        </>
      )}
    </article>
  );

  return (
    <section className="panel supermarket-panel shopping-list-panel">
      <div className="shopping-section shopping-entry-section">
        <h2>Adicionar produto</h2>
        <p className="muted">
          Digite ou fale um produto por vez. Revise os campos antes de adicionar.
          A lista não conta como despesa até a compra realmente ser registrada.
        </p>
        <div className="voice-checklist">
          <b>Ao falar, informe:</b>
          <span>1. Quantidade</span>
          <span>2. Unidade</span>
          <span>3. Produto</span>
          <span>4. Categoria (opcional)</span>
        </div>
        <div className="shopping-voice-row">
          <button
            className={listening ? "danger-button" : "primary"}
            onClick={startVoice}
          >
            {listening ? <Square size={17} /> : <Mic size={17} />}
            {listening ? "Parar" : "Falar produto"}
          </button>
          <small>
            Exemplo: “dois pacotes de arroz, categoria mercearia”.
          </small>
        </div>
        {listening && (
          <div className="voice-live" aria-live="polite">
            <div className="shopping-listening">
              <span /> Ouvindo… fale agora
            </div>
            <strong>{transcript || "Aguardando sua voz…"}</strong>
          </div>
        )}
        {!listening && transcript && (
          <p className="shopping-transcript" aria-live="polite">
            <b>Entendi:</b> “{transcript}”. Confira abaixo antes de adicionar.
          </p>
        )}
        <ShoppingFields draft={draft} setDraft={setDraft} nameRef={nameRef} />
        <div className="actions shopping-entry-actions">
          <button className="primary" onClick={add}>
            <Plus size={17} /> Adicionar à lista
          </button>
          <button
            onClick={() => {
              setDraft(emptyDraft());
              setTranscript("");
              setSource("manual");
            }}
          >
            Limpar
          </button>
        </div>
      </div>

      <div className="shopping-section">
        <h2>A comprar ({pending.length})</h2>
        <div className="shopping-list-items">
          {pending.map((item) => renderItem(item))}
          {!pending.length && (
            <p className="empty-shopping-list">A lista está vazia.</p>
          )}
        </div>
      </div>

      <details className="shopping-inner-block">
        <summary>Concluídos ({completed.length})</summary>
        <div className="shopping-list-items">
          {completed.map((item) => renderItem(item, true))}
          {!completed.length && (
            <p className="empty-shopping-list">Nenhum produto concluído.</p>
          )}
        </div>
      </details>

      <details className="shopping-inner-block">
        <summary>Sugestões automáticas ({visibleSuggestions.length})</summary>
        <p className="muted">
          Calculadas pelas datas e quantidades já registradas nas notas.
        </p>
        <div className="shopping-suggestions">
          {visibleSuggestions.map((suggestion) => (
            <article className="shopping-suggestion" key={suggestion.key}>
              <div>
                <b>{suggestion.name}</b>
                <small>
                  {suggestion.category} · cerca de{" "}
                  {suggestion.quantity.toLocaleString("pt-BR", {
                    maximumFractionDigits: 3,
                  })}{" "}
                  {suggestion.unit}
                  {suggestion.averageDays
                    ? ` · intervalo médio ${suggestion.averageDays} dias`
                    : ""}
                </small>
                <small>Data sugerida: {suggestion.next}</small>
              </div>
              <div className="actions shopping-suggestion-actions">
                <button onClick={() => addSuggestion(suggestion)}>
                  <Plus size={16} /> Adicionar
                </button>
                <button onClick={() => dismissSuggestion(suggestion)}>
                  Ignorar
                </button>
              </div>
            </article>
          ))}
          {!visibleSuggestions.length && (
            <p className="empty-shopping-list">Nenhuma sugestão nova.</p>
          )}
        </div>
      </details>
    </section>
  );
}
