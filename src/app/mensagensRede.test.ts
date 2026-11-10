import { describe, expect, it } from 'vitest';
import { NpdevError, type TipoErro } from '../net/erros';
import { causaEmPoucasPalavras, mensagemDeErro } from './mensagensRede';

const erro = (tipo: TipoErro, extra: { status?: number; mensagem?: string } = {}) =>
  new NpdevError(tipo, extra.mensagem ?? 'texto do servidor', { status: extra.status });

describe('mensagemDeErro: login', () => {
  it('401 → usuário ou senha inválidos', () => {
    expect(mensagemDeErro(erro('nao_autenticado', { status: 401 }), 'login')).toBe('Usuário ou senha inválidos.');
  });

  it('rede caída → diz que é a conexão/servidor e oferece o convidado', () => {
    const m = mensagemDeErro(erro('rede'), 'login');
    expect(m).toMatch(/sem conexão|fora do ar/i);
    expect(m).toMatch(/convidado/i);
  });

  it('servidor com 5xx mostra o status; timeout e resposta inválida têm texto próprio', () => {
    expect(mensagemDeErro(erro('servidor', { status: 503 }), 'login')).toMatch(/HTTP 503/);
    expect(mensagemDeErro(erro('timeout'), 'login')).toMatch(/demorou/i);
    expect(mensagemDeErro(erro('resposta_invalida'), 'login')).toMatch(/formato inesperado/i);
  });

  it('403 → falta a role Jogador; campos vazios mostram o texto do cliente', () => {
    expect(mensagemDeErro(erro('proibido', { status: 403 }), 'login')).toMatch(/Jogador/);
    expect(mensagemDeErro(erro('requisicao_invalida', { mensagem: 'Informe usuário e senha.' }), 'login')).toBe('Informe usuário e senha.');
  });
});

describe('mensagemDeErro: geral', () => {
  it('401 fora do login = sessão vencida (não "senha inválida")', () => {
    expect(mensagemDeErro(erro('nao_autenticado'))).toMatch(/sessão expirou/i);
  });

  it('erro que não é NpdevError mantém a mensagem; recusa do servidor mostra o motivo dele', () => {
    expect(mensagemDeErro(new Error('boom'))).toBe('boom');
    expect(mensagemDeErro('texto solto')).toBe('texto solto');
    expect(mensagemDeErro(erro('recusado', { mensagem: 'ordensAtrasadas > ordensTotal' }))).toBe('ordensAtrasadas > ordensTotal');
  });

  it('todo tipo de erro tem frase não vazia', () => {
    const tipos: TipoErro[] = ['offline', 'rede', 'timeout', 'nao_autenticado', 'proibido', 'nao_encontrado', 'requisicao_invalida', 'servidor', 'resposta_invalida', 'recusado', 'indisponivel'];
    for (const t of tipos) {
      expect(mensagemDeErro(erro(t), 'login').length).toBeGreaterThan(5);
      expect(mensagemDeErro(erro(t), 'geral').length).toBeGreaterThan(5);
      expect(causaEmPoucasPalavras(erro(t)).length).toBeGreaterThan(3);
    }
  });
});
