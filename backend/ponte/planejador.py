"""Planejador PURO: (Fonte, mapa.json, Opcoes) -> Plano, uma lista de Operacao. Não abre rede, não lê o relógio.

Toda regra de negócio da exportação mora aqui e em mapa.json; o executor (executor.py) só sabe executar operações.
Regras: docs/ponte/PLANO.md §5. Cada corpo e cada chave vêm de mapa.preencher() sobre os modelos do mapa.
"""
import re
from collections import Counter
from dataclasses import asdict, dataclass, field
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fonte import Fonte
from mapa import preencher


@dataclass
class Opcoes:
    data: str                    # "2026-11-10"
    ordens: set | None = None    # números das ordens ("IN-0001"); None = todas
    rotulo: str | None = None
    crossdocking: bool = True    # cria a linha de CrossDocking para cada par cross-dock (T3.4); False = só os documentos
    ao_vivo: bool = False        # T3.4: operações na ordem do tempo do jogo e ocupação atualizada a cada Putaway/Picking


@dataclass
class Operacao:
    tipo: str                    # "garantir" | "avancar" | "ocupacao" | "situacao" | "historico" | "crossdocking"
    chave: str
    conceito: str                # para "avancar": o nome do ciclo (= conceito)
    dados: dict = field(default_factory=dict)   # corpo, já preenchido; pode conter {"$ref": chave}
    compartilhado: bool = False
    buscarPor: dict | None = None               # só em compartilhados
    ciclo: str | None = None                    # só em "avancar"
    ate: str | None = None                      # "avancar": estado-alvo · "crossdocking": "Ativo" ou "Concluido"
    extra: dict | None = None                   # só em "crossdocking": {"baia": {"chave", "dados"}}
    tSeg: int | None = None                     # segundo do jogo em que isto aconteceu (None = não ligado a um evento)

    def como_dict(self) -> dict:
        return asdict(self)


AO_VIVO_ANTES = -1          # operações "antes do turno" (cadastro, topologia, carga inicial)
AO_VIVO_DEPOIS = 10 ** 9    # histórico: reescrito com a hora do jogo no fim


def _sem_prefixo(chave, prefixo):
    return chave[len(prefixo):] if chave.startswith(prefixo) else chave


class Plano:
    def __init__(self, operacoes=None):
        self.operacoes: list[Operacao] = operacoes if operacoes is not None else []

    def resumo(self) -> dict:
        criados, compartilhados, estados, quantidades = Counter(), Counter(), {}, {}
        ocupacao, ocupados, historico = [], [], {}
        for o in self.operacoes:
            if o.tipo == "garantir":
                (compartilhados if o.compartilhado else criados)[o.conceito] += 1
                if o.conceito == "Movimento":
                    estados[o.chave] = o.dados.get("situacao")
                elif o.conceito in ("Recebimento", "Expedicao"):
                    estados[o.chave] = o.dados.get("estagio")
                elif o.conceito in ("Lote", "MovimentoItem"):
                    quantidades[o.chave] = o.dados.get("quantidade")
            elif o.tipo == "avancar":
                estados[o.chave] = o.ate
            elif o.tipo == "crossdocking":
                criados[o.conceito] += 1
                criados[o.extra["baia"]["conceito"]] += 1   # a baia que o flow cria
                estados[o.chave] = o.ate
            elif o.tipo == "ocupacao":
                criados[o.conceito] += 1
                ocupacao.append({"local": _sem_prefixo(o.dados["localArmazenagemId"]["$ref"], "local:"),
                                 "lote": o.dados["loteId"]["$ref"], "quantidade": o.dados["quantidade"]})
            elif o.tipo == "situacao" and o.dados.get("situacao") == "Ocupado":
                ocupados.append(_sem_prefixo(o.chave, "local:"))
            elif o.tipo == "historico":
                historico[o.chave] = [[ev, iso] for ev, iso in o.dados["tempos"].items()]
        return {"criados": dict(criados), "compartilhados": dict(compartilhados), "estados": estados,
                "quantidades": quantidades, "ocupacao": ocupacao, "locaisOcupados": ocupados, "historico": historico}


_TEMPO = re.compile(r"^([A-Za-z_][\w.]*)(?: ([+-]) (\d+))?$")


def _tempo_do_jogo(expressao, ctx):
    """'ordem.liberacaoSeg' / 'cenario.inicioTurnoSeg - 1' -> segundos; None se o contexto não tem o dado."""
    m = _TEMPO.match(expressao)
    if not m:
        raise ValueError(f"expressão de tempo inválida no mapa: {expressao!r}")
    atual = ctx
    for parte in m.group(1).split("."):
        if atual is None:
            return None
        atual = atual.get(parte)
    if atual is None:
        return None
    if m.group(2):
        atual = atual + int(m.group(3)) * (1 if m.group(2) == "+" else -1)
    return atual


def _instante(data, seg, fuso):
    """data (AAAA-MM-DD) + seg segundos no fuso do jogo -> (iso em UTC, HH:MM:SS local)."""
    local = (datetime.fromisoformat(data) + timedelta(seconds=seg)).replace(tzinfo=fuso)
    return local.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), local.strftime("%H:%M:%S")


def _texto_score(centesimos):
    return "" if centesimos is None else f" · score {centesimos // 100},{centesimos % 100:02d}"


def _entrada(m, ordem, produto, evs, concluida, ctx, garantir, avancar, caixas, validade, historicos, conclusao, relogio, t_cabeca):
    """Recebimento de uma ordem Inbound (PLANO §5.7). `relogio["t"]` é o tempo do jogo que garantir/avancar carimbam."""
    extra = {"ordem": ordem, "produto": produto, "paletes": len(evs), "quantidade": len(evs) * caixas(produto["id"]),
             "concluida": concluida, "temCrossDock": any(e["tipo"] == "CrossDock" for e in evs),
             "dataValidade": validade(produto), "caixas": caixas(produto["id"])}
    relogio["t"] = t_cabeca
    for k in ("lote", "movimento", "item", "documento", "documentoLote"):
        garantir(m[k], ctx(**extra))
    avancar(m["avancarAntes"], ctx(**extra))
    for e in evs:
        relogio["t"] = e["tSeg"]
        garantir(m["posicaoPutaway" if e["tipo"] == "Putaway" else "posicaoCrossDock"], ctx(**extra, evento=e))
    if concluida:
        relogio["t"] = conclusao["tSeg"]
        for passo in m["seConcluida"]:
            avancar(passo, ctx(**extra))
    relogio["t"] = None
    atingidos = ["Enderecado", "Conferido"] + (["Armazenado", "Concluido"] if concluida else [])
    historicos.append((preencher(m["movimento"]["chave"], ctx(**extra)), ordem["numero"], "Recebimento", atingidos,
                       {"ordem": ordem, "primeiroEvento": evs[0], "conclusao": conclusao}))


def _saida(m, ordem, produto, evs, concluida, ctx, garantir, avancar, caixas, lote_do_picking, historicos, conclusao, relogio, t_cabeca):
    """Expedição de uma ordem Outbound (PLANO §5.7)."""
    lote_de = {e["seq"]: (lote_do_picking[e["seq"]] if e["tipo"] == "Picking" else f"lote:{e['ordemId']}") for e in evs}
    por_lote = {}
    for e in evs:
        por_lote[lote_de[e["seq"]]] = por_lote.get(lote_de[e["seq"]], 0) + 1
    todos_sairam = len(evs) == ordem["quantidadePaletes"]
    extra = {"ordem": ordem, "produto": produto, "demanda": ordem["quantidadePaletes"] * caixas(produto["id"]),
             "concluida": concluida, "todosSairam": todos_sairam, "caixas": caixas(produto["id"])}
    relogio["t"] = t_cabeca
    for k in ("movimento", "documento", "documentoItem"):
        garantir(m[k], ctx(**extra))
    avancar(m["avancarAntes"], ctx(**extra))
    for lote, n in por_lote.items():
        garantir(m["item"], ctx(**extra, loteChave=lote, quantidade=n * caixas(produto["id"])))
    for e in evs:
        relogio["t"] = e["tSeg"]
        garantir(m["posicaoPicking" if e["tipo"] == "Picking" else "posicaoCrossDock"],
                 ctx(**extra, evento=e, loteChave=lote_de[e["seq"]]))
    if todos_sairam or concluida:
        relogio["t"] = evs[-1]["tSeg"]
        avancar(m["seTodosSairam"], ctx(**extra))
    if concluida:
        relogio["t"] = conclusao["tSeg"]
        for passo in m["seConcluida"]:
            avancar(passo, ctx(**extra))
    relogio["t"] = None
    atingidos = (["DemandaGerada"] + (["MovimentacaoConcluida"] if todos_sairam or concluida else [])
                 + (["SaidaConfirmada", "Concluido"] if concluida else []))
    historicos.append((preencher(m["movimento"]["chave"], ctx(**extra)), ordem["numero"], "Expedicao", atingidos,
                       {"ordem": ordem, "ultimoEvento": evs[-1], "conclusao": conclusao}))


def planejar(fonte: Fonte, mapa: dict, opcoes: Opcoes) -> Plano:
    date.fromisoformat(opcoes.data)  # ValueError se a data for inválida
    jc = mapa["jogoParaCorporativo"]
    fuso = ZoneInfo(mapa["fusoHorario"])
    pacote, rastro = fonte.pacote, fonte.rastro
    cenario = pacote["cenario"]
    produtos = {p["id"]: {"diasValidadePadrao": None, **p} for p in pacote["produtos"]}
    ordens = {o["id"]: o for o in pacote["ordens"]}
    locais = {loc["id"]: loc for loc in pacote["locais"]}
    ruas = {r["id"]: r for r in pacote["ruas"]}
    areas = {a["id"]: a for a in pacote["areas"]}
    dias_padrao = jc["unidades"]["validadeDiasPadrao"]

    base = {
        "partida": {"id": rastro["partidaId"], "curto": rastro["partidaId"][:8], "politica": rastro["politicaInicial"]},
        "cenario": cenario, "data": opcoes.data,
        "score": {"texto": _texto_score(rastro.get("scoreCentesimos"))}, "rotulo": opcoes.rotulo or "",
    }

    def ctx(**extra):
        return {**base, **extra}

    def caixas(produto_id):
        return produtos[produto_id]["qtdCaixasPorPallet"]

    def validade(produto):
        return (date.fromisoformat(opcoes.data) + timedelta(days=produto["diasValidadePadrao"] or dias_padrao)).isoformat()

    # ---- que ordens e eventos entram ---------------------------------------------------------------------------------
    selecionadas = {o["id"] for o in pacote["ordens"] if opcoes.ordens is None or o["numero"] in opcoes.ordens}
    eventos = []
    for e in rastro["eventos"]:
        t = e["tipo"]
        if t == "EstoqueInicial":
            ok = True
        elif t == "CrossDock":
            ok = e["ordemId"] in selecionadas and e["ordemSaidaId"] in selecionadas
        else:
            ok = e["ordemId"] in selecionadas
        if ok:
            eventos.append(e)

    entradas, saidas, concluidas = {}, {}, {}
    for e in eventos:
        if e["tipo"] in ("Putaway", "CrossDock"):
            entradas.setdefault(e["ordemId"], []).append(e)
        if e["tipo"] in ("Picking", "CrossDock"):
            saidas.setdefault(e["ordemSaidaId"] if e["tipo"] == "CrossDock" else e["ordemId"], []).append(e)
        if e["tipo"] == "OrdemConcluida":
            concluidas[e["ordemId"]] = e
    ordem_ids = sorted((i for i in set(entradas) | set(saidas)),
                       key=lambda i: (ordens[i]["liberacaoSeg"], ordens[i]["numero"]))
    iniciais = [e for e in eventos if e["tipo"] == "EstoqueInicial"]

    # ---- replay: lote de cada palete e ocupação final (PLANO §5.6) -----------------------------------------------------
    local_lote, lote_do_picking, ocup = {}, {}, {}
    for e in eventos:
        t = e["tipo"]
        if t == "EstoqueInicial":
            lote = f"lote:inicial:{e['produtoId']}"
            local_lote[e["localId"]] = lote
            ocup[(e["localId"], lote)] = ocup.get((e["localId"], lote), 0) + caixas(e["produtoId"])
        elif t == "Putaway":
            lote = f"lote:{e['ordemId']}"
            local_lote[e["localId"]] = lote
            ocup[(e["localId"], lote)] = ocup.get((e["localId"], lote), 0) + caixas(e["produtoId"])
        elif t == "Picking":
            lote = local_lote.pop(e["localId"], None)
            if lote is None:
                raise ValueError(
                    f"evento {e['seq']}: Picking em {e['localId']}, mas o palete que estava lá veio de uma entrada que não "
                    f"está nesta exportação; inclua essa ordem em --ordens")
            lote_do_picking[e["seq"]] = lote
            ocup[(e["localId"], lote)] -= caixas(e["produtoId"])

    # ---- produtos compartilhados (os usados) ---------------------------------------------------------------------------
    usados = {e["produtoId"] for e in iniciais} | {ordens[i]["produtoId"] for i in ordem_ids}
    produtos_usados = sorted((produtos[i] for i in usados), key=lambda p: p["codigo"])

    plano = Plano()
    ops = plano.operacoes

    relogio = {"t": None}  # o tempo do jogo que garantir/avancar carimbam nas operações (None fora das ordens)

    def garantir(modelo, contexto, compartilhado=False):
        buscar = preencher(modelo["buscarPor"], contexto) if compartilhado else None
        ops.append(Operacao("garantir", preencher(modelo["chave"], contexto), modelo["conceito"],
                            preencher(modelo["campos"], contexto), compartilhado, buscar, tSeg=relogio["t"]))

    def avancar(passo, contexto):
        ops.append(Operacao("avancar", preencher(passo["chave"], contexto), passo["ciclo"], {}, False, None,
                            passo["ciclo"], passo["ate"], tSeg=relogio["t"]))

    # ---- compartilhados ------------------------------------------------------------------------------------------------
    garantir(jc["compartilhados"]["escopo"], ctx(), True)
    for p in produtos_usados:
        garantir(jc["compartilhados"]["produto"], ctx(produto=p), True)

    # ---- topologia -----------------------------------------------------------------------------------------------------
    topo = jc["topologia"]
    garantir(topo["armazem"], ctx())
    for a in pacote["areas"]:
        garantir(topo["area"], ctx(area=a))
    for r in pacote["ruas"]:
        garantir(topo["rua"], ctx(rua=r))
    for loc in pacote["locais"]:
        garantir(topo["local"], ctx(local=loc, situacaoInicial="Bloqueado" if loc["situacao"] == "Bloqueado" else "Disponivel"))
    garantir(topo["perfil"], ctx())
    for rk in pacote["rankingRuas"]:
        garantir(topo["ranking"], ctx(ranking=rk))

    # ---- carga inicial -------------------------------------------------------------------------------------------------
    historicos = []  # (chave do movimento, nome do documento, tipo de documento, eventos atingidos, contexto de tempo)
    ci = jc["cargaInicial"]
    if iniciais:
        por_produto = {}
        for e in iniciais:
            por_produto[e["produtoId"]] = por_produto.get(e["produtoId"], 0) + 1
        for pid, n in por_produto.items():
            garantir(ci["lote"], ctx(produto=produtos[pid], dataValidade=validade(produtos[pid]), quantidade=n * caixas(pid)))
        garantir(ci["movimento"], ctx())
        for pid, n in por_produto.items():
            garantir(ci["item"], ctx(produto=produtos[pid], quantidade=n * caixas(pid)))
        for e in iniciais:
            garantir(ci["posicao"], ctx(evento=e, produto=produtos[e["produtoId"]], caixas=caixas(e["produtoId"])))
        avancar(ci["confirmar"], ctx())
        historicos.append(("mov:inicial", "carga inicial", "MovtoLivre", ["Concluido"], {"cenario": cenario}))

    # ---- ordens --------------------------------------------------------------------------------------------------------
    emitidas = set()

    def lotes_de_entrada_da_saida(oid):
        """Ordens Inbound cujos lotes esta saída retira (o lote de cada palete vem do replay): têm de existir antes dela."""
        deps = []
        for e in saidas[oid]:
            lote = lote_do_picking[e["seq"]] if e["tipo"] == "Picking" else f"lote:{e['ordemId']}"
            if not lote.startswith("lote:inicial:") and lote[len("lote:"):] not in deps:
                deps.append(lote[len("lote:"):])
        return deps

    def t_cabeca_de(oid, teto=None):
        """Quando os documentos da ordem nascem: na liberação (ou no 1º evento, se vier antes); `teto` = a liberação da saída
        que depende desta entrada."""
        evs = entradas.get(oid, []) + saidas.get(oid, [])
        return min([ordens[oid]["liberacaoSeg"]] + [e["tSeg"] for e in evs] + ([] if teto is None else [teto]))

    def emitir_ordem(oid, teto=None):
        # Ordem de processamento = (liberacaoSeg, numero), com UMA exceção: uma saída que espera estoque pode ser
        # liberada ANTES da entrada que, mais tarde, lhe dá os paletes; essa entrada é emitida primeiro (senão o item da
        # saída citaria um lote que ainda não existe). Visto no WH-B: SimOrdem-392 entra depois de saídas que a retiram.
        if oid in emitidas:
            return
        emitidas.add(oid)
        ordem, produto = ordens[oid], produtos[ordens[oid]["produtoId"]]
        if oid in entradas:
            _entrada(jc["entrada"], ordem, produto, entradas[oid], oid in concluidas, ctx, garantir, avancar, caixas,
                     validade, historicos, concluidas.get(oid), relogio, t_cabeca_de(oid, teto))
        if oid in saidas:
            for dep in lotes_de_entrada_da_saida(oid):
                emitir_ordem(dep, t_cabeca_de(oid))
            _saida(jc["saida"], ordem, produto, saidas[oid], oid in concluidas, ctx, garantir, avancar, caixas,
                   lote_do_picking, historicos, concluidas.get(oid), relogio, t_cabeca_de(oid))

    for oid in ordem_ids:
        emitir_ordem(oid)

    # ---- cross-docking: a linha que liga o Recebimento à Expedição do mesmo palete (T3.4) ------------------------------
    def t_fim(oid):
        """Quando os documentos da ordem chegam ao estado final: na conclusão, ou no último evento dela."""
        if oid in concluidas:
            return concluidas[oid]["tSeg"]
        return max(e["tSeg"] for e in entradas.get(oid, []) + saidas.get(oid, []))

    pares = {}
    for e in eventos:
        if e["tipo"] == "CrossDock":
            pares.setdefault((e["ordemId"], e["ordemSaidaId"]), []).append(e)
    if pares and opcoes.crossdocking:
        cd = jc["crossDocking"]
        garantir(cd["area"], ctx())
        garantir(cd["rua"], ctx())
        for posicao, ((entrada_id, saida_id), evs) in enumerate(sorted(pares.items(), key=lambda kv: kv[1][0]["seq"]), start=1):
            produto = produtos[evs[0]["produtoId"]]
            c = ctx(ordem=ordens[entrada_id], saida=ordens[saida_id], produto=produto, posicao=posicao,
                    quantidade=len(evs) * caixas(produto["id"]))
            ops.append(Operacao("crossdocking", preencher(cd["registro"]["chave"], c), cd["registro"]["conceito"],
                                preencher(cd["registro"]["campos"], c),
                                ate="Concluido" if entrada_id in concluidas and saida_id in concluidas else "Ativo",
                                extra={"baia": {"chave": preencher(cd["baia"]["chave"], c), "conceito": cd["baia"]["conceito"],
                                                "dados": preencher(cd["baia"]["campos"], c)}},
                                tSeg=max(t_fim(entrada_id), t_fim(saida_id))))

    # ---- ocupação, situação, histórico (PLANO §5.8) ----------------------------------------------------------------------
    of = jc["ocupacaoFinal"]
    sf = jc["situacaoFinal"]

    def op_ocupacao(local_id, lote, qtd, t_seg=None):
        return Operacao("ocupacao", preencher(of["chave"], ctx(local=locais[local_id], loteChave=lote)), of["conceito"],
                        preencher(of["campos"], ctx(local=locais[local_id], loteChave=lote, quantidade=qtd)), tSeg=t_seg)

    def rastreavel(loc):  # só locais de armazenagem não bloqueados têm a situação acompanhada (docas ficam Disponivel)
        return areas[ruas[loc["ruaId"]]["areaId"]]["funcao"] == "Armazenagem" and loc["situacao"] != "Bloqueado"

    if not opcoes.ao_vivo:
        for (local_id, lote), qtd in ocup.items():
            ops.append(op_ocupacao(local_id, lote, qtd))
        soma_local = {}
        for (local_id, _), qtd in ocup.items():
            soma_local[local_id] = soma_local.get(local_id, 0) + qtd
        for loc in pacote["locais"]:
            if not rastreavel(loc):
                continue
            situacao = "Ocupado" if soma_local.get(loc["id"], 0) > 0 else "Disponivel"
            ops.append(Operacao("situacao", preencher(sf["chave"], ctx(local=loc)), sf["conceito"], {"situacao": situacao}))
    else:
        # Ao vivo: a ocupação e a situação do local mudam no instante de cada Putaway/Picking (o valor ABSOLUTO do par, como
        # no modo em lote; o último vence, então o estado final é o mesmo). O estoque inicial já está lá desde antes do turno.
        corrente, por_local = {}, {}
        for e in eventos:
            if e["tipo"] not in ("EstoqueInicial", "Putaway", "Picking"):
                continue
            local_id = e["localId"]
            if e["tipo"] == "Picking":
                lote, delta = lote_do_picking[e["seq"]], -caixas(e["produtoId"])
            else:
                lote, delta = (f"lote:inicial:{e['produtoId']}" if e["tipo"] == "EstoqueInicial" else f"lote:{e['ordemId']}"), caixas(e["produtoId"])
            corrente[(local_id, lote)] = corrente.get((local_id, lote), 0) + delta
            por_local[local_id] = por_local.get(local_id, 0) + delta
            t_seg = AO_VIVO_ANTES if e["tipo"] == "EstoqueInicial" else e["tSeg"]
            ops.append(op_ocupacao(local_id, lote, corrente[(local_id, lote)], t_seg))
            if rastreavel(locais[local_id]):
                ops.append(Operacao("situacao", preencher(sf["chave"], ctx(local=locais[local_id])), sf["conceito"],
                                    {"situacao": "Ocupado" if por_local[local_id] > 0 else "Disponivel"}, tSeg=t_seg))

    for chave, documento, tipo_doc, atingidos, contexto_tempo in historicos:
        tempos, descricoes = {}, {}
        for evento in atingidos:
            seg = _tempo_do_jogo(jc["historico"]["tempos"][tipo_doc][evento], contexto_tempo)
            if seg is None:
                continue
            tempos[evento], hora = _instante(opcoes.data, seg, fuso)
            descricoes[evento] = preencher(jc["historico"]["descricao"], {"documento": documento, "evento": evento, "hora": hora})
        ops.append(Operacao("historico", chave, "HistoricoMovimentacao", {"tempos": tempos, "descricoes": descricoes},
                            tSeg=AO_VIVO_DEPOIS if opcoes.ao_vivo else None))
    if opcoes.ao_vivo:
        # O que não está ligado a um evento (topologia, cadastro, carga inicial) vem antes do turno; ordem estável pelo tempo.
        for o in ops:
            if o.tSeg is None:
                o.tSeg = AO_VIVO_ANTES
        ops.sort(key=lambda o: o.tSeg)
    return plano
