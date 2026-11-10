// Formatação de números para a UI (pt-BR). Tudo parte dos inteiros escalados da D6 (cm, centésimos, segundos),
// sem passar por ponto flutuante onde dá: "85,52" vem de 8552, não de 85.52.

const doisDigitos = (n: number): string => String(n).padStart(2, '0');

/** Centésimos → "85,52" (sempre duas casas). Aceita negativo: "-1,50". */
export function formatarCentesimos(c: number): string {
  const sinal = c < 0 ? '-' : '';
  const abs = Math.abs(Math.round(c));
  return `${sinal}${Math.floor(abs / 100)},${doisDigitos(abs % 100)}`;
}

/** Pontos de score: "85,52". Alias com o nome do domínio, para o código de quem lê. */
export const formatarScore = formatarCentesimos;

/** Valor de um termo do score com sinal explícito: "+5,00" / "−12,34" (menos tipográfico). Zero não leva sinal. */
export function formatarPontos(c: number, sinal: '+' | '−'): string {
  return c === 0 ? '0,00' : `${sinal}${formatarCentesimos(c)}`;
}

/** Centésimos de percentual → "58%" (arredonda). Com `casas`, "57,9%". */
export function formatarPercentual(centesimos: number, casas = 0): string {
  const v = centesimos / 100;
  return `${casas === 0 ? Math.round(v) : v.toFixed(casas).replace('.', ',')}%`;
}

/** Centímetros → "12,34 km". */
export function formatarKm(cm: number): string {
  return `${(cm / 100_000).toFixed(2).replace('.', ',')} km`;
}

/** Segundos desde 00:00 → "08:00" (sem os segundos: é para horário de turno, não para o relógio da sim). */
export function formatarHorario(seg: number): string {
  return `${doisDigitos(Math.floor(seg / 3600) % 24)}:${doisDigitos(Math.floor((seg % 3600) / 60))}`;
}

/** Duração em segundos → "10 h", "3 h 20 min", "45 min", "30 s". Arredonda para o minuto. */
export function formatarDuracao(seg: number): string {
  if (seg < 60) return `${Math.round(seg)} s`;
  const min = Math.round(seg / 60);
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** Instante ISO → "09/11 14:02" no fuso do aparelho (a data em que o cache foi baixado, uma partida na fila…). */
export function formatarDataHora(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${doisDigitos(d.getDate())}/${doisDigitos(d.getMonth() + 1)} ${doisDigitos(d.getHours())}:${doisDigitos(d.getMinutes())}`;
}

/** "1 ordem" / "3 ordens". */
export function plural(n: number, singular: string, pluralTexto: string): string {
  return `${n} ${n === 1 ? singular : pluralTexto}`;
}
