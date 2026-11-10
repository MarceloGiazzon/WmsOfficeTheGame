import { describe, expect, it } from 'vitest';
import { sugerirDestinoNoServidor } from './alocacao';
import { NpdevClient } from './npdevClient';
import { ServidorFalso } from './servidorFalso';

async function montar(logar = true) {
  const servidor = new ServidorFalso({ pacotes: [] });
  servidor.adicionarUsuario('jogador', 'senha');
  const cliente = new NpdevClient({ fetch: servidor.fetch });
  if (logar) await cliente.login('jogador', 'senha');
  return { servidor, cliente };
}

const pergunta = { loteId: 'ORD-9', candidatos: [{ localArmazenagemId: 'b', prioridade: 2 }, { localArmazenagemId: 'a', prioridade: 2 }, { localArmazenagemId: 'z', prioridade: 1 }] };

describe('sugerirDestinoNoServidor', () => {
  it('manda o lote e os candidatos ao flow e devolve a escolha do servidor', async () => {
    const { servidor, cliente } = await montar();
    const r = await sugerirDestinoNoServidor(cliente, pergunta);
    expect(r).toEqual({ sucesso: true, localArmazenagemId: 'z', motivo: 'Local disponivel com maior prioridade de ranking' });
    const chamada = servidor.chamadas.at(-1)!;
    expect(chamada).toMatchObject({ metodo: 'POST', caminho: '/flows/SugerirDestinoJogo/execute' });
    expect(chamada.corpo).toEqual(pergunta);
  });

  it('sem candidatos: resposta válida, sem sucesso', async () => {
    const { cliente } = await montar();
    expect(await sugerirDestinoNoServidor(cliente, { loteId: 'L', candidatos: [] })).toMatchObject({ sucesso: false, localArmazenagemId: null });
  });

  it('convidado: offline, e nenhuma chamada de rede', async () => {
    const { servidor, cliente } = await montar(false);
    await expect(sugerirDestinoNoServidor(cliente, pergunta)).rejects.toMatchObject({ tipo: 'offline' });
    expect(servidor.chamadas).toHaveLength(0);
  });

  it('local que não estava entre os candidatos: resposta_invalida (servidor com defeito)', async () => {
    const { servidor, cliente } = await montar();
    servidor.escolhaDoDestino = () => 'fora-da-lista';
    await expect(sugerirDestinoNoServidor(cliente, pergunta)).rejects.toMatchObject({ tipo: 'resposta_invalida' });
  });

  it('sucesso sem `sucesso` booleano: resposta_invalida', async () => {
    const { servidor, cliente } = await montar();
    servidor.falharProximas(1, { status: 200, corpo: { status: 'OK', output: { localArmazenagemId: 'a' } } }, c => c.caminho.startsWith('/flows/'));
    await expect(sugerirDestinoNoServidor(cliente, pergunta)).rejects.toMatchObject({ tipo: 'resposta_invalida' });
  });

  it('flow que falha (FAILED: timeout do plugin na 1ª chamada) vira erro recuperável do servidor, não resposta', async () => {
    const { servidor, cliente } = await montar();
    servidor.falharProximas(1, { status: 422, corpo: { status: 'FAILED', errorCode: 'PLUGIN_EXECUTION_TIMEOUT', error: 'PLUGIN_EXECUTION_TIMEOUT: plugin sandbox' } }, c => c.caminho.startsWith('/flows/'));
    await expect(sugerirDestinoNoServidor(cliente, pergunta)).rejects.toMatchObject({ recuperavel: true });
  });

  it('respeita o prazo da chamada', async () => {
    const { servidor, cliente } = await montar();
    servidor.travarProximas(1, c => c.caminho.startsWith('/flows/'));
    await expect(sugerirDestinoNoServidor(cliente, pergunta, { timeoutMs: 20 })).rejects.toMatchObject({ tipo: 'timeout' });
  });
});
