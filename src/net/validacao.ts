// Validação de formato das respostas do NPDev. O servidor é fronteira de confiança: um campo ausente ou com tipo
// trocado vira `resposta_invalida` com o caminho do campo — nunca um `undefined` que explode longe dali.

import { NpdevError } from './erros';

export type Obj = Record<string, unknown>;

const invalida = (msg: string): NpdevError => new NpdevError('resposta_invalida', `Resposta do servidor inválida: ${msg}.`);

export function objeto(v: unknown, onde: string): Obj {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) throw invalida(`${onde} deveria ser um objeto`);
  return v as Obj;
}

export function lista(v: unknown, onde: string): unknown[] {
  if (!Array.isArray(v)) throw invalida(`${onde} deveria ser uma lista`);
  return v;
}

export function texto(o: Obj, campo: string, onde: string): string {
  const v = o[campo];
  if (typeof v !== 'string' || v === '') throw invalida(`${onde}.${campo} deveria ser um texto não vazio`);
  return v;
}

export function inteiro(o: Obj, campo: string, onde: string): number {
  const v = o[campo];
  if (typeof v !== 'number' || !Number.isSafeInteger(v)) throw invalida(`${onde}.${campo} deveria ser um inteiro`);
  return v;
}

export function enumerado<T extends string>(o: Obj, campo: string, valores: readonly T[], onde: string): T {
  const v = o[campo];
  if (typeof v !== 'string' || !(valores as readonly string[]).includes(v)) {
    throw invalida(`${onde}.${campo} deveria ser um de ${valores.join('/')}`);
  }
  return v as T;
}

export function booleano(o: Obj, campo: string, onde: string): boolean {
  const v = o[campo];
  if (typeof v !== 'boolean') throw invalida(`${onde}.${campo} deveria ser verdadeiro ou falso`);
  return v;
}

export { invalida as erroDeFormato };
