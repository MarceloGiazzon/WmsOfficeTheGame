"""`exportar --partida`: a rotina completa para uma SimPartida do servidor do jogo, com o registro em SimExportacao (T1.5/T1.6).

Usada por ponte.py (linha de comando) e, na P3, por vigia.py (pedidos feitos pelo botão do jogo).
Retorna (código de saída, resumo): 0 ok · 1 erro (o SimExportacao fica `Falhou`) · 3 interrompido por --parar-apos.
"""
import hashlib
import os
import sys
from datetime import datetime, timezone

import executor
import fonte as fonte_mod
import mapa as mapa_mod
import planejador
from aovivo import Ritmo
from diario import Diario
from npdev import Cliente, ErroPonte

AQUI = os.path.dirname(os.path.abspath(__file__))
PASTA_ESTADO = os.path.join(AQUI, "estado")
PASSO_REGISTRO = 25  # atualiza o SimExportacao a cada N operações


def agora_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def caminho_diario(alvo_url, partida_id):
    id_ = hashlib.sha1(f"{alvo_url.rstrip('/')}|{partida_id}".encode()).hexdigest()[:12]
    return os.path.join(PASTA_ESTADO, f"{id_}.jsonl")


def cliente_do_jogo(url=None):
    return Cliente((url or os.environ.get("PONTE_JOGO_URL", "http://localhost:8200")),
                   os.environ.get("PONTE_JOGO_USUARIO", "admin"), os.environ.get("PONTE_JOGO_SENHA", "Teste123!"))


def cliente_do_alvo(url):
    return Cliente(url, os.environ.get("PONTE_ALVO_USUARIO", "admin"), os.environ.get("PONTE_ALVO_SENHA", "Teste123!"))


def _log(*a):
    print(*a, file=sys.stderr, flush=True)


class Registro:
    """O SimExportacao (partidaId + alvoUrl) no servidor do jogo: o estado da exportação, visível nas telas e ao botão."""

    def __init__(self, jogo, partida_id, alvo_url):
        self.jogo, self.partida_id, self.alvo_url = jogo, partida_id, alvo_url
        achados = jogo.pagina("SimExportacao", partidaId=partida_id, alvoUrl=alvo_url)
        self.linha = achados[0] if achados else None

    @property
    def concluida(self):
        return self.linha is not None and self.linha["situacao"] == "Concluida"

    def iniciar(self):
        campos = {"situacao": "EmAndamento", "iniciadaEm": agora_iso(), "mensagem": None, "passo": None, "progressoCentesimos": 0}
        if self.linha is None:
            self.linha = self.jogo.criar("sim_exportacaos", {
                "partidaId": self.partida_id, "alvoUrl": self.alvo_url, "solicitadaPor": self.jogo_usuario(), "solicitadaEm": agora_iso(), **campos})
        else:
            self.linha = self.jogo.atualizar("sim_exportacaos", self.linha["id"], campos)

    def jogo_usuario(self):
        status, me = self.jogo.chamar("GET", "auth/me")
        return me["username"]

    def progresso(self, feitas, total, op):
        if feitas % PASSO_REGISTRO == 0 and feitas != total:
            self.linha = self.jogo.atualizar("sim_exportacaos", self.linha["id"], {
                "passo": f"{op.tipo} {op.chave}"[:80], "progressoCentesimos": feitas * 10000 // total})

    def concluir(self, armazem_id, chamadas):
        self.linha = self.jogo.atualizar("sim_exportacaos", self.linha["id"], {
            "situacao": "Concluida", "concluidaEm": agora_iso(), "passo": "concluída", "progressoCentesimos": 10000,
            "armazemAlvoId": armazem_id, "totalChamadas": chamadas, "mensagem": None})

    def falhar(self, mensagem):
        try:
            self.linha = self.jogo.atualizar("sim_exportacaos", self.linha["id"], {"situacao": "Falhou", "mensagem": mensagem[:500]})
        except ErroPonte as e:  # não esconda o erro original por causa do registro
            _log(f"aviso: não consegui gravar a falha no SimExportacao: {e}")


def exportar_partida(jogo, partida_id, alvo_url, forcar=False, parar_apos=None, ordens=None, crossdocking=True, ao_vivo=None):
    alvo_url = alvo_url.rstrip("/")
    registro = Registro(jogo, partida_id, alvo_url)
    if registro.concluida and not forcar:
        l = registro.linha
        _log(f"já exportada para {alvo_url} (SimExportacao Concluida); use --forcar para exportar de novo")
        return 0, {"diario": caminho_diario(alvo_url, partida_id), "armazemAlvoId": l.get("armazemAlvoId"), "criados": 0,
                   "reusados": 0, "chamadas": 0, "jaConcluida": True, "totalChamadas": l.get("totalChamadas")}
    try:
        f = fonte_mod.carregar_do_jogo(jogo, partida_id)
    except (ValueError, ErroPonte) as e:
        # sem fonte válida não há o que registrar como em andamento, mas o pedido (se existe) tem de mostrar o motivo
        if registro.linha is not None:
            registro.falhar(str(e))
        raise
    mapa = mapa_mod.carregar()
    if ao_vivo:
        ritmo = Ritmo(f.pacote["cenario"]["inicioTurnoSeg"], ao_vivo)  # ValueError se a velocidade é inválida
        existente = caminho_diario(alvo_url, partida_id)
        if os.path.exists(existente) and os.path.getsize(existente) > 0:
            raise ValueError(f"já existe uma exportação desta partida em {alvo_url} ({existente}); apague-a com "
                             f"`ponte.py limpar --diario {existente}` antes de reproduzir ao vivo (o ritmo não sabe pular o que já foi feito)")
    plano = planejador.planejar(f, mapa, planejador.Opcoes(data=f.data, ordens=set(ordens) if ordens else None,
                                                           crossdocking=crossdocking, ao_vivo=bool(ao_vivo)))
    registro.iniciar()
    _log(f"plano: {len(plano.operacoes)} operações → {alvo_url}")
    try:
        alvo = cliente_do_alvo(alvo_url)
        diario = Diario(caminho_diario(alvo_url, partida_id), alvo_url, partida_id)
        barra = executor.progresso_stderr()

        def progresso(feitas, total, op):
            barra(feitas, total, op)
            registro.progresso(feitas, total, op)

        res = executor.Executor(alvo, mapa, diario, progresso, ritmo if ao_vivo else None).executar(plano, parar_apos)
    except Exception as e:  # o registro tem de refletir QUALQUER falha, não só ErroPonte
        registro.falhar(f"{type(e).__name__}: {e}" if not isinstance(e, ErroPonte) else str(e))
        raise
    armazem_id = diario.id("armazem") if diario.tem("armazem") else None
    saida = {"diario": diario.caminho, "armazemAlvoId": armazem_id, **res}
    if res.get("parado"):
        return 3, saida
    registro.concluir(armazem_id, res["chamadas"])
    return 0, saida
