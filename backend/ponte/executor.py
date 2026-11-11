"""Executor: aplica um Plano num alvo NPDev, usando o diário. Genérico — não conhece regra de negócio (isso é do planejador).

Cada tipo de operação é idempotente (PLANO §6.4): rodar de novo continua de onde parou e não duplica nada.
Modelo das chamadas: referencia/ciclo_rest_verificado.py.
"""
import sys
from datetime import datetime, timezone

from mapa import endpoint
from npdev import ErroPonte


def _instante(texto):
    """'...-03:00' (o /page) e '...Z' (o GET por id) são o mesmo instante: compare instantes, nunca o texto."""
    if not texto:
        return None
    return datetime.fromisoformat(texto.replace("Z", "+00:00")).astimezone(timezone.utc)


class Executor:
    def __init__(self, cliente, mapa, diario, progresso=None, ritmo=None):
        self.cliente, self.mapa, self.diario = cliente, mapa, diario
        self.progresso = progresso  # callable(feitas, total, operacao) ou None
        self.ritmo = ritmo          # callable(operacao) chamado ANTES de cada operação (modo ao vivo: espera o tempo do jogo)
        self.criados = 0
        self.reusados = 0

    def _ep(self, conceito):
        return endpoint(self.mapa, conceito)

    def executar(self, plano, parar_apos=None):
        total = len(plano.operacoes)
        resultado = {}
        for i, op in enumerate(plano.operacoes, start=1):
            if self.ritmo:
                self.ritmo(op)
            getattr(self, "_" + op.tipo)(op)
            if self.progresso:
                self.progresso(i, total, op)
            if parar_apos is not None and i >= parar_apos and i < total:
                resultado["parado"] = True
                break
        return {"criados": self.criados, "reusados": self.reusados, "chamadas": self.cliente.chamadas, **resultado}

    # ---- garantir ------------------------------------------------------------------------------------------------------
    def _garantir(self, op):
        if self.diario.tem(op.chave):
            self.reusados += 1
            return
        ep = self._ep(op.conceito)
        if op.compartilhado:
            achados = self.cliente.pagina(op.conceito, **op.buscarPor)
            if achados:
                self.diario.anotar(op.chave, op.conceito, achados[0]["id"], True)
                self.reusados += 1
                return
        criado = self.cliente.criar(ep, self.diario.resolver(op.dados))
        self.diario.anotar(op.chave, op.conceito, criado["id"], op.compartilhado)
        self.criados += 1

    # ---- avancar -------------------------------------------------------------------------------------------------------
    def _avancar(self, op):
        ciclo = self.mapa["ciclos"][op.ciclo]
        campo = ciclo["campo"]
        estados = [p["estado"] for p in ciclo["passos"]]
        if op.ate not in estados:
            raise ErroPonte(f"estado {op.ate!r} não existe no ciclo {op.ciclo}")
        ep = self._ep(op.conceito)
        id_ = self.diario.id(op.chave)
        atual = self.cliente.ler(ep, id_)
        if atual is None:
            raise ErroPonte(f"{op.chave} está no diário mas não existe mais no alvo", 404, None, "GET", f"{ep}/{id_}")
        while True:
            estado = atual.get(campo)
            if estado not in estados:
                raise ErroPonte(f"{op.chave}: estado {estado!r} fora do ciclo {op.ciclo}")
            i, alvo = estados.index(estado), estados.index(op.ate)
            if i >= alvo:
                return
            passo = ciclo["passos"][i + 1]
            if passo["via"] == "put":
                atual = self.cliente.atualizar(ep, id_, {campo: passo["estado"]})
            elif passo["via"] == "criar":
                raise ErroPonte(f"ciclo {op.ciclo}: o passo {passo['estado']} só se obtém criando")
            else:  # um flow: o corpo é o registro inteiro com o novo estado (CONTRATO §4)
                self.cliente.flow(passo["via"], {**atual, campo: passo["estado"]})
                atual = self.cliente.ler(ep, id_)
            if atual.get(campo) != passo["estado"]:
                raise ErroPonte(f"{op.chave}: esperava {passo['estado']} e ficou {atual.get(campo)!r}")

    # ---- crossdocking --------------------------------------------------------------------------------------------------
    def _crossdocking(self, op):
        """Liga um Recebimento a uma Expedição (T3.4). Só o flow AtivarCrossDocking cria a linha (POST direto dá 500) e ele
        provisiona a baia no PRIMEIRO armazém da Entidade, que num alvo com vários espelhos não é o desta exportação;
        por isso: o flow cria → a baia é movida para a Rua 'CD' do armazém desta exportação → a Rua/Area que o flow tenha
        provisionado lá e ficaram vazias são apagadas → só então a baia e a linha entram no diário (nessa ordem: o limpar
        apaga de trás para a frente e a linha aponta para a baia). Refazer depois de uma queda acha a linha pelo par
        recebimento/expedição e continua dali."""
        ep = self._ep(op.conceito)
        corpo = self.diario.resolver(op.dados)
        if self.diario.tem(op.chave):
            self.reusados += 1
            linha = self.cliente.ler(ep, self.diario.id(op.chave))
            if linha is None:
                raise ErroPonte(f"{op.chave} está no diário mas não existe mais no alvo", 404, None, "GET", f"{ep}/{self.diario.id(op.chave)}")
        else:
            achadas = self.cliente.pagina(op.conceito, recebimentoId=corpo["recebimentoId"], expedicaoId=corpo["expedicaoId"])
            if achadas:
                linha = achadas[0]
                self.reusados += 1
            else:
                saida = self.cliente.flow("AtivarCrossDocking", corpo)
                linha = self.cliente.ler(ep, saida["id"])
                self.criados += 1
            self._acomodar_baia(op, linha)
            self.diario.anotar(op.chave, op.conceito, linha["id"])
        if op.ate == "Concluido":
            if linha["situacao"] != "Concluido":
                self.cliente.atualizar(ep, linha["id"], {"situacao": "Concluido"})
            for conceito, campo in (("Recebimento", "recebimentoId"), ("Expedicao", "expedicaoId")):
                doc = self.cliente.ler(self._ep(conceito), linha[campo])
                if doc is not None and doc.get("crossDockingAtivo"):
                    self._escrever_sem_historico(conceito, doc, {"crossDockingAtivo": False})

    def _escrever_sem_historico(self, conceito, doc, campos):
        """Qualquer PUT num Recebimento/Expedição faz o produto gravar uma linha de HistoricoMovimentacao no estágio atual
        (verificado ao vivo: um 'Armazenado' a mais por PUT). Essa linha seria um duplicado com a hora do relógio; apaga-se
        só a(s) que ESTA escrita criou, deixando o histórico como o `historico` do plano o monta."""
        h_ep = self._ep("HistoricoMovimentacao")
        antes = {h["id"] for h in self.cliente.pagina("HistoricoMovimentacao", movimentoId=doc["movimentoId"])}
        self.cliente.atualizar(self._ep(conceito), doc["id"], campos)
        for h in self.cliente.pagina("HistoricoMovimentacao", movimentoId=doc["movimentoId"]):
            if h["id"] not in antes:
                self.cliente.apagar(h_ep, h["id"])

    def _acomodar_baia(self, op, linha):
        baia_ep = self._ep(op.extra["baia"]["conceito"])
        alvo = self.diario.resolver(op.extra["baia"]["dados"])  # ruaId e posicao certos
        baia = self.cliente.ler(baia_ep, linha["baiaLocalArmazenagemId"])
        rua_antiga = baia["ruaId"]
        if rua_antiga != alvo["ruaId"] or baia.get("posicao") != alvo["posicao"]:
            self.cliente.atualizar(baia_ep, baia["id"], {"ruaId": alvo["ruaId"], "posicao": alvo["posicao"]})
        if rua_antiga != alvo["ruaId"]:
            self._recolher_rua_de_baia_vazia(rua_antiga)
        if not self.diario.tem(op.extra["baia"]["chave"]):
            self.diario.anotar(op.extra["baia"]["chave"], op.extra["baia"]["conceito"], baia["id"])

    def _recolher_rua_de_baia_vazia(self, rua_id):
        """Apaga a Rua 'CD' (e a Area 'Cross-Docking' dela) que o flow acabou de provisionar fora do armazém desta exportação,
        se a baia movida era o único local. Nunca toca em rua/área que não sejam as de cross-docking nem em rua com locais."""
        rua = self.cliente.ler(self._ep("Rua"), rua_id)
        if rua is None or rua.get("codigo") != "CD" or self.cliente.pagina("LocalArmazenagem", ruaId=rua_id):
            return
        area = self.cliente.ler(self._ep("Area"), rua["areaId"])
        if area is None or area.get("funcao") != "CrossDocking":
            return
        self.cliente.apagar(self._ep("Rua"), rua_id)
        if not self.cliente.pagina("Rua", areaId=area["id"]):
            self.cliente.apagar(self._ep("Area"), area["id"])

    # ---- ocupacao ------------------------------------------------------------------------------------------------------
    def _ocupacao(self, op):
        ep = self._ep(op.conceito)
        quantidade = op.dados["quantidade"]
        if self.diario.tem(op.chave):
            self.reusados += 1
            id_ = self.diario.id(op.chave)
            atual = self.cliente.ler(ep, id_)
            if atual is None:
                raise ErroPonte(f"{op.chave} está no diário mas não existe mais no alvo", 404, None, "GET", f"{ep}/{id_}")
        else:
            corpo = self.diario.resolver(op.dados)
            achados = self.cliente.pagina(op.conceito, localArmazenagemId=corpo["localArmazenagemId"], loteId=corpo["loteId"])
            if achados:
                atual = achados[0]
                self.diario.anotar(op.chave, op.conceito, atual["id"], False)
                self.reusados += 1
            else:
                criado = self.cliente.criar(ep, corpo)
                self.diario.anotar(op.chave, op.conceito, criado["id"], False)
                self.criados += 1
                return
        if atual["quantidade"] != quantidade:
            self.cliente.atualizar(ep, atual["id"], {"quantidade": quantidade})

    # ---- situacao ------------------------------------------------------------------------------------------------------
    def _situacao(self, op):
        ep = self._ep(op.conceito)
        id_ = self.diario.id(op.chave)
        atual = self.cliente.ler(ep, id_)
        if atual is None:
            raise ErroPonte(f"{op.chave} está no diário mas não existe mais no alvo", 404, None, "GET", f"{ep}/{id_}")
        if atual.get("situacao") != op.dados["situacao"]:
            self.cliente.atualizar(ep, id_, {"situacao": op.dados["situacao"]})

    # ---- historico -----------------------------------------------------------------------------------------------------
    def _historico(self, op):
        ep = self._ep("HistoricoMovimentacao")
        linhas = self.cliente.pagina("HistoricoMovimentacao", movimentoId=self.diario.id(op.chave))
        tempos, descricoes = op.dados["tempos"], op.dados["descricoes"]
        vistos = set()
        for h in linhas:
            ev = h.get("evento")
            if ev not in tempos:
                continue
            vistos.add(ev)
            if _instante(h.get("ocorridoEm")) != _instante(tempos[ev]) or h.get("descricao") != descricoes[ev]:
                self.cliente.atualizar(ep, h["id"], {"ocorridoEm": tempos[ev], "descricao": descricoes[ev]})
        faltando = sorted(set(tempos) - vistos)
        if faltando:
            raise ErroPonte(f"o histórico de {op.chave} não tem as linhas {faltando} (o servidor não as criou?)")


def limpar(cliente, mapa, diario, aviso=None):
    """Apaga o que o diário criou, de trás para a frente, pulando os compartilhados. Devolve {apagados, naoEncontrados}."""
    apagados = nao_encontrados = 0
    for r in reversed(diario.registros()):
        if r["compartilhado"]:
            continue
        if cliente.apagar(endpoint(mapa, r["conceito"]), r["id"]):
            apagados += 1
        else:
            nao_encontrados += 1
        if aviso and (apagados + nao_encontrados) % 100 == 0:
            aviso(f"  apagados {apagados + nao_encontrados}")
    diario.encerrar_limpo()
    return {"apagados": apagados, "naoEncontrados": nao_encontrados}


def hora_do_jogo(seg):
    """Segundos do dia -> 'HH:MM:SS' (só para o registro de andamento); '' se não é um instante do turno."""
    if seg is None or seg < 0 or seg >= 10 ** 6:
        return ""
    return f"{seg // 3600 % 24:02d}:{seg // 60 % 60:02d}:{seg % 60:02d} "


def progresso_stderr(passo=25):
    """Imprime '[  50/161] garantir pos:4' no stderr a cada `passo` operações e na última (com a hora do jogo, se a operação tem)."""
    def f(feitas, total, op):
        if feitas % passo == 0 or feitas == total:
            largura = len(str(total))
            print(f"[{feitas:>{largura}}/{total}] {hora_do_jogo(op.tSeg)}{op.tipo} {op.chave}", file=sys.stderr, flush=True)
    return f
