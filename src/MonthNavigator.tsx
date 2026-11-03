import { ChevronLeft, ChevronRight } from "lucide-react";
import { compactMonthLabel, defaultUiPreferences, shiftMonth } from "./uiPreferences";

export function MonthNavigator({ month, onChange }: { month: string; onChange: (month: string) => void }) {
  return <div className="month-selector">
    <div className="month-navigation" role="group" aria-label="Navegar por mês e ano">
      <button type="button" className="month-step" aria-label="Mês anterior" title="Mês anterior" onClick={() => onChange(shiftMonth(month, -1))}><ChevronLeft size={16} /></button>
      <span className="month-label" aria-live="polite" aria-atomic="true">{compactMonthLabel(month)}</span>
      <button type="button" className="month-step" aria-label="Próximo mês" title="Próximo mês" onClick={() => onChange(shiftMonth(month, 1))}><ChevronRight size={16} /></button>
    </div>
    <button type="button" className="month-today" title="Voltar ao mês atual" aria-label="Selecionar mês atual" onClick={() => onChange(defaultUiPreferences().month)}>Hoje</button>
  </div>;
}
