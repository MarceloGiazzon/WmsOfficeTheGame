import { describe, expect, it } from 'vitest';
import whA from '../data/cenarios/WH-A-PEQUENO.json';
import { remapearIds } from '../net/idsUuid';
import { NpdevClient } from '../net/npdevClient';
import { iniciarPartida } from '../net/partidas';
import { ServidorFalso } from '../net/servidorFalso';
import type { PacoteCenario } from '../sim/model';
import {
  COMANDO_PONTE, ESPERA_ATE_SEM_PONTE_MS, EnvioWmsOffice, enderecoMapaWmsOffice, INTERVALO_CONSULTA_MS, LIMITE_ACOMPANHAMENTO_MS,
  textoWmsOffice, type EstadoWmsOffice,
} from './envioWmsOffice';

const banco = remapearIds(whA as unknown as PacoteCenario, 41).pacote;
const ALVO = 'http://localhost:8100';

/** Tempo falso: `esperar` só avança o relógio e deixa o teste agir (como o `ponte.py vigiar`) entre uma consulta e outra. */
async function montar() {
  const servidor = new ServidorFalso({ pacotes: [banco], usuarios: { ana: { senha: 's' }, bia: { senha: 's' } } });
  const http = new NpdevClient({ fetch: servidor.fetch });
  await http.login('ana', 's');
  const partida = await iniciarPartida(http, { cenarioId: banco.cenario.id, politica: 'AbcProximidade' });
  let tempo = 1_000_000;
  const estados: EstadoWmsOffice[] = [];
  let aoEsperar: (() => void) | null = null;
  const envio = new EnvioWmsOffice({
    http, partidaId: partida.id, jogador: 'ana', alvoUrl: ALVO, aoMudar: e => estados.push(e),
    agora: () => tempo, esperar: async ms => { tempo += ms; aoEsperar?.(); },
  });
  const tipos = () => estados.map(e => e.tipo);
  return { servidor, http, partida, envio, estados, tipos, agirAoEsperar: (f: (() => void) | null) => { aoEsperar = f; }, avancar: (ms: number) => { tempo += ms; } };
}

describe('EnvioWmsOffice', () => {
  it('cria um pedido Solicitada (da própria partida, para o alvo) e acompanha até Concluida', async () => {
    const t = await montar();
    let consultas = 0;
    t.agirAoEsperar(() => {
      const linha = t.servidor.exportacoes[0];
      consultas++;
      if (consultas === 1) Object.assign(linha, { situacao: 'EmAndamento', passo: 'garantir pos:12', progressoCentesimos: 2500 });
      if (consultas === 2) Object.assign(linha, { situacao: 'Concluida', progressoCentesimos: 10000, armazemAlvoId: 'abc' });
    });
    await t.envio.solicitar();
    expect(t.servidor.exportacoes).toHaveLength(1);
    expect(t.servidor.exportacoes[0]).toMatchObject({ partidaId: t.partida.id, alvoUrl: ALVO, solicitadaPor: 'ana' });
    expect(t.tipos()).toEqual(['solicitando', 'solicitada', 'andamento', 'concluida']);
    expect(t.estados[2]).toEqual({ tipo: 'andamento', passo: 'garantir pos:12', progressoCentesimos: 2500 });
    expect(t.envio.estado).toEqual({ tipo: 'concluida', url: `${ALVO}/mapa-armazem.html` });
  });

  it('Falhou: mostra a mensagem que a ponte gravou', async () => {
    const t = await montar();
    t.agirAoEsperar(() => Object.assign(t.servidor.exportacoes[0], { situacao: 'Falhou', mensagem: 'não consegui falar com http://localhost:8100' }));
    await t.envio.solicitar();
    expect(t.envio.estado).toEqual({ tipo: 'falhou', mensagem: 'não consegui falar com http://localhost:8100' });
  });

  it('sem a ponte rodando: depois de 30 s ainda Solicitada vira semPonte, e a tela anda quando a ponte liga', async () => {
    const t = await montar();
    let consultas = 0;
    const porIntervalo = Math.ceil(ESPERA_ATE_SEM_PONTE_MS / INTERVALO_CONSULTA_MS);
    t.agirAoEsperar(() => {
      consultas++;
      if (consultas === porIntervalo + 2) Object.assign(t.servidor.exportacoes[0], { situacao: 'Concluida' }); // a ponte ligou
    });
    await t.envio.solicitar();
    const tipos = t.tipos();
    expect(tipos).toContain('semPonte');
    expect(tipos.indexOf('semPonte')).toBeGreaterThan(tipos.indexOf('solicitada'));
    expect(tipos.slice(-1)).toEqual(['concluida']);
    expect(COMANDO_PONTE).toBe('python3 backend/ponte/ponte.py vigiar');
  });

  it('não duplica: com um pedido em curso (ou já Concluida), acompanha o que existe', async () => {
    const t = await montar();
    await t.http.post('/sim_exportacaos', { partidaId: t.partida.id, alvoUrl: ALVO, solicitadaPor: 'ana', solicitadaEm: new Date().toISOString() });
    Object.assign(t.servidor.exportacoes[0], { situacao: 'Concluida' });
    await t.envio.solicitar();
    expect(t.servidor.exportacoes).toHaveLength(1);
    expect(t.envio.estado.tipo).toBe('concluida');
  });

  it('depois de um Falhou, tentar de novo cria um pedido novo (o jogador não edita o antigo) e acompanha o NOVO', async () => {
    const t = await montar();
    await t.http.post('/sim_exportacaos', { partidaId: t.partida.id, alvoUrl: ALVO, solicitadaPor: 'ana', solicitadaEm: '2026-11-10T10:00:00.000Z' });
    Object.assign(t.servidor.exportacoes[0], { situacao: 'Falhou', mensagem: 'antigo' });
    t.agirAoEsperar(() => Object.assign(t.servidor.exportacoes[1], { situacao: 'Concluida' }));
    await t.envio.solicitar();
    expect(t.servidor.exportacoes).toHaveLength(2);
    expect(t.envio.estado.tipo).toBe('concluida');
  });

  it('erro ao pedir vira falhou com texto, sem lançar', async () => {
    const t = await montar();
    t.servidor.falharProximas(10, { status: 503, corpo: { error: 'x' } }, c => c.metodo === 'POST' && c.caminho === '/sim_exportacaos');
    await t.envio.solicitar();
    expect(t.envio.estado.tipo).toBe('falhou');
    expect((t.envio.estado as { mensagem: string }).mensagem).toContain('Não consegui pedir a exportação');
  });

  it('3 consultas seguidas que falham: desiste de acompanhar (o pedido continua no servidor)', async () => {
    const t = await montar();
    t.servidor.falharProximas(10, { status: 503, corpo: { error: 'x' } }, c => c.metodo === 'GET' && c.caminho.endsWith('/SimExportacao/page') && t.servidor.exportacoes.length > 0);
    await t.envio.solicitar();
    expect(t.envio.estado.tipo).toBe('falhou');
    expect(t.servidor.exportacoes).toHaveLength(1);
  });

  it('passou de 10 minutos acompanhando: para, avisando que ainda pode terminar', async () => {
    const t = await montar();
    t.agirAoEsperar(() => t.avancar(LIMITE_ACOMPANHAMENTO_MS)); // cada espera "dura" 10 min
    await t.envio.solicitar();
    expect(t.envio.estado.tipo).toBe('falhou');
    expect((t.envio.estado as { mensagem: string }).mensagem).toContain('10 minutos');
  });

  it('parar() interrompe o acompanhamento; chamar solicitar() em andamento não faz um segundo pedido', async () => {
    const t = await montar();
    t.agirAoEsperar(() => t.envio.parar());
    const primeira = t.envio.solicitar();
    await t.envio.solicitar(); // já em curso: volta na hora
    await primeira;
    expect(t.servidor.exportacoes).toHaveLength(1);
    expect(t.envio.estado.tipo).toBe('solicitada');
  });

  it('o endereço aponta para o Mapa do Armazém, sem barra duplicada', () => {
    expect(enderecoMapaWmsOffice('http://localhost:8100/')).toBe('http://localhost:8100/mapa-armazem.html');
  });
});

describe('textoWmsOffice', () => {
  it('só os estados em que dá para agir têm botão', () => {
    const botoes = ([
      { tipo: 'disponivel' }, { tipo: 'solicitando' }, { tipo: 'solicitada' }, { tipo: 'semPonte' },
      { tipo: 'andamento', passo: null, progressoCentesimos: null }, { tipo: 'concluida', url: 'u' }, { tipo: 'falhou', mensagem: 'x' },
    ] as EstadoWmsOffice[]).map(e => textoWmsOffice(e).botao);
    expect(botoes).toEqual(['Enviar ao WmsOffice', null, null, null, null, null, 'Tentar de novo']);
  });

  it('sem a ponte, o texto traz o comando para ligá-la', () => {
    expect(textoWmsOffice({ tipo: 'semPonte' }).texto).toContain(COMANDO_PONTE);
  });

  it('andamento mostra o percentual e o passo', () => {
    expect(textoWmsOffice({ tipo: 'andamento', passo: 'garantir pos:12', progressoCentesimos: 2550 })).toEqual({
      texto: 'Enviando ao WmsOffice: 26% (garantir pos:12)…', botao: null, percentual: 26,
    });
    expect(textoWmsOffice({ tipo: 'andamento', passo: null, progressoCentesimos: null }).percentual).toBeNull();
  });

  it('falhou mostra a mensagem da ponte', () => {
    expect(textoWmsOffice({ tipo: 'falhou', mensagem: 'alvo não permitido' }).texto).toBe('alvo não permitido');
  });
});
