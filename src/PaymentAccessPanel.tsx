import { useState } from "react";
import { Copy, Eye, EyeOff } from "lucide-react";
import { accessFromForm, loadPaymentAccess, savePaymentAccess, type PaymentAccess } from "./paymentAccess";

export function PaymentAccessFields({ access }: { access?: PaymentAccess }) {
  return <fieldset className="payment-access-fields">
    <legend>Usuário e senha (opcional)</legend>
    <label>Usuário / login<input name="accessLogin" type="text" autoCapitalize="none" autoCorrect="off" autoComplete="off" defaultValue={access?.login || ""} /></label>
    <label>Senha<input name="accessPassword" type="password" autoComplete="new-password" defaultValue={access?.password || ""} /></label>
    <small>Salvos somente neste navegador. Não entram na sincronização nem no backup financeiro. Quem acessa este navegador pode consultá-los.</small>
  </fieldset>;
}

export function PaymentAccessPanel({ paymentId, name }: { paymentId: string; name: string }) {
  const [visible, setVisible] = useState(false);
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState("");
  const access = loadPaymentAccess(paymentId);
  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setMessage(`${label} copiado.`);
    } catch { setMessage("Não foi possível copiar. Permita o acesso à área de transferência e tente novamente."); }
  };
  return <details className="payment-access" onToggle={event => { if (event.target === event.currentTarget && !event.currentTarget.open) { setVisible(false); setEditing(false); setMessage(""); } }}>
    <summary>Usuário</summary>
    <div className="payment-access-content">
      {editing ? <form onSubmit={event => {
        event.preventDefault();
        try { savePaymentAccess(paymentId, accessFromForm(new FormData(event.currentTarget))); setEditing(false); setMessage("Acesso salvo neste navegador."); }
        catch { setMessage("Não foi possível salvar o acesso neste navegador. Seus dados continuam no formulário."); }
      }}>
        <PaymentAccessFields access={access} />
        <div className="actions"><button type="submit">Salvar acesso</button><button type="button" onClick={() => setEditing(false)}>Cancelar</button></div>
      </form> : <>
        <div className="payment-access-row"><label>Usuário / login<input readOnly value={access.login} autoComplete="off" aria-label={`Usuário de ${name}`} placeholder="Não cadastrado" /></label><button type="button" disabled={!access.login} onClick={() => copy(access.login, "Usuário")} aria-label={`Copiar usuário de ${name}`}><Copy size={16} /> Copiar usuário</button></div>
        <div className="payment-access-row"><label>Senha<input readOnly type={visible ? "text" : "password"} value={access.password} autoComplete="off" aria-label={`Senha de ${name}`} placeholder="Não cadastrada" /></label><button type="button" disabled={!access.password} onClick={() => copy(access.password, "Senha")} aria-label={`Copiar senha de ${name}`}><Copy size={16} /> Copiar senha</button><button type="button" disabled={!access.password} onClick={() => setVisible(!visible)} aria-label={visible ? "Ocultar senha" : "Mostrar senha"}>{visible ? <EyeOff size={16} /> : <Eye size={16} />}</button></div>
        <button type="button" onClick={() => { setEditing(true); setMessage(""); }}>{access.login || access.password ? "Editar acesso" : "Cadastrar acesso"}</button>
        <small>Salvo somente neste navegador.</small>
      </>}
      <span role="status" aria-live="polite">{message}</span>
    </div>
  </details>;
}
