"""Fonte dos dados da exportação: um pacote de cenário + o rastro de uma partida, já validados.

P0: lidos de arquivos (`carregar_arquivos`). P1: lidos do servidor do jogo (`carregar_do_jogo`).
O formato do rastro está em rastro.schema.json; as regras que o schema não expressa, em `validar_rastro`.
"""
import json
from dataclasses import dataclass
from datetime import datetime
from zoneinfo import ZoneInfo

CAMPOS_PACOTE = ("cenario", "armazem", "areas", "ruas", "locais", "produtos", "ordens", "rankingRuas")
CAMPOS_EVENTO = ("seq", "tipo", "tSeg", "ordemId", "ordemSaidaId", "produtoId", "localId", "localDestinoId")
TIPOS = ("EstoqueInicial", "Putaway", "Picking", "CrossDock", "OrdemConcluida")
POLITICAS = ("AbcProximidade", "FifoPrimeiraLivre", "Consolidacao", "CrossDocking", "WmsReal")

# Campos que cada tipo de evento tem de ter preenchidos; os demais ficam nulos.
PREENCHIDOS = {
    "EstoqueInicial": {"produtoId", "localId"},
    "Putaway": {"ordemId", "produtoId", "localId"},
    "Picking": {"ordemId", "produtoId", "localId"},
    "CrossDock": {"ordemId", "ordemSaidaId", "produtoId", "localId", "localDestinoId"},
    "OrdemConcluida": {"ordemId"},
}
CAMPOS_NULAVEIS = ("ordemId", "ordemSaidaId", "produtoId", "localId", "localDestinoId")


@dataclass
class Fonte:
    pacote: dict
    rastro: dict
    partida: dict | None = None  # só quando vem do servidor do jogo: a linha de SimPartida
    data: str | None = None      # idem: AAAA-MM-DD (America/Sao_Paulo) de SimPartida.iniciadaEm


def _ler_json(caminho):
    with open(caminho, encoding="utf-8") as f:
        return json.load(f)


def carregar_arquivos(caminho_pacote, caminho_rastro):
    pacote, rastro = _ler_json(caminho_pacote), _ler_json(caminho_rastro)
    validar_pacote(pacote)
    validar_rastro(rastro, pacote)
    return Fonte(pacote, rastro)


def _unicos(itens, rotulo):
    ids = [i["id"] for i in itens]
    if len(ids) != len(set(ids)):
        repetidos = sorted({i for i in ids if ids.count(i) > 1})
        raise ValueError(f"pacote: {rotulo} com id repetido: {repetidos[:5]}")
    return set(ids)


def validar_pacote(p):
    faltam = [c for c in CAMPOS_PACOTE if c not in p]
    if faltam:
        raise ValueError(f"pacote: faltam os campos {faltam}")
    areas = _unicos(p["areas"], "areas")
    ruas = _unicos(p["ruas"], "ruas")
    _unicos(p["locais"], "locais")
    produtos = _unicos(p["produtos"], "produtos")
    _unicos(p["ordens"], "ordens")
    for r in p["ruas"]:
        if r["areaId"] not in areas:
            raise ValueError(f"pacote: rua {r['id']} aponta para a área inexistente {r['areaId']}")
    for loc in p["locais"]:
        if loc["ruaId"] not in ruas:
            raise ValueError(f"pacote: local {loc['id']} aponta para a rua inexistente {loc['ruaId']}")
    for o in p["ordens"]:
        if o["produtoId"] not in produtos:
            raise ValueError(f"pacote: ordem {o['numero']} aponta para o produto inexistente {o['produtoId']}")
    for rk in p["rankingRuas"]:
        if rk["ruaId"] not in ruas:
            raise ValueError(f"pacote: ranking aponta para a rua inexistente {rk['ruaId']}")


def validar_rastro(r, pacote):
    """Aplica as `x-regras` de rastro.schema.json. Erro = ValueError('evento <seq>: <motivo>') ou do cabeçalho."""
    if r.get("formato") != "rastro-v1":
        raise ValueError(f"rastro: formato {r.get('formato')!r}, esperado 'rastro-v1'")
    for campo in ("partidaId", "cenarioId", "cenarioCodigo", "versaoMotor", "politicaInicial", "eventos"):
        if campo not in r:
            raise ValueError(f"rastro: falta o campo {campo}")
    if r["politicaInicial"] not in POLITICAS:
        raise ValueError(f"rastro: política desconhecida {r['politicaInicial']!r}")
    cen = pacote["cenario"]
    if r["cenarioId"] != cen["id"] or r["cenarioCodigo"] != cen["codigo"]:
        raise ValueError(f"rastro: é do cenário {r['cenarioCodigo']} ({r['cenarioId']}), o pacote é de {cen['codigo']} ({cen['id']})")

    ordens = {o["id"]: o for o in pacote["ordens"]}
    produtos = {p["id"] for p in pacote["produtos"]}
    locais = {loc["id"] for loc in pacote["locais"]}
    ocupacao = {}  # localId -> produtoId, replay
    concluidas = set()
    ultimo_t = None
    iniciais_acabaram = False

    for i, e in enumerate(r["eventos"]):
        def erro(motivo, seq=e.get("seq", i) if isinstance(e, dict) else i):
            return ValueError(f"evento {seq}: {motivo}")

        if not isinstance(e, dict) or set(e) != set(CAMPOS_EVENTO):
            raise erro(f"campos devem ser exatamente {list(CAMPOS_EVENTO)}")
        if e["seq"] != i:
            raise erro(f"seq deveria ser {i}")
        tipo = e["tipo"]
        if tipo not in TIPOS:
            raise erro(f"tipo desconhecido {tipo!r}")
        if not isinstance(e["tSeg"], int) or isinstance(e["tSeg"], bool):
            raise erro("tSeg deve ser inteiro")

        for campo in CAMPOS_NULAVEIS:
            deve = campo in PREENCHIDOS[tipo]
            if deve and e[campo] is None:
                raise erro(f"{tipo} exige {campo}")
            if not deve and e[campo] is not None:
                raise erro(f"{tipo} não tem {campo}")

        if tipo == "EstoqueInicial":
            if iniciais_acabaram:
                raise erro("EstoqueInicial depois de outro tipo de evento")
        else:
            iniciais_acabaram = True
            if ultimo_t is not None and e["tSeg"] < ultimo_t:
                raise erro(f"tSeg {e['tSeg']} menor que o do evento anterior ({ultimo_t})")
            ultimo_t = e["tSeg"]

        if e["produtoId"] is not None and e["produtoId"] not in produtos:
            raise erro(f"produto {e['produtoId']} não existe no pacote")
        for campo in ("localId", "localDestinoId"):
            if e[campo] is not None and e[campo] not in locais:
                raise erro(f"{campo} {e[campo]} não existe no pacote")
        for campo, tipo_ordem in (("ordemId", "Inbound" if tipo in ("Putaway", "CrossDock") else "Outbound" if tipo == "Picking" else None),
                                  ("ordemSaidaId", "Outbound")):
            if e[campo] is None:
                continue
            if e[campo] not in ordens:
                raise erro(f"{campo} {e[campo]} não existe no pacote")
            if tipo_ordem and ordens[e[campo]]["tipo"] != tipo_ordem:
                raise erro(f"{campo} {e[campo]} deveria ser {tipo_ordem}")

        if tipo in ("EstoqueInicial", "Putaway"):
            if e["localId"] in ocupacao:
                raise erro(f"{tipo} em local ocupado ({e['localId']})")
            ocupacao[e["localId"]] = e["produtoId"]
        elif tipo == "Picking":
            if ocupacao.get(e["localId"]) != e["produtoId"]:
                raise erro(f"Picking de {e['produtoId']} em local que não o tem ({e['localId']})")
            del ocupacao[e["localId"]]
        elif tipo == "OrdemConcluida":
            if e["ordemId"] in concluidas:
                raise erro(f"OrdemConcluida repetida para {e['ordemId']}")
            concluidas.add(e["ordemId"])

        if tipo in ("Putaway", "Picking", "CrossDock"):
            for campo in ("ordemId", "ordemSaidaId"):
                if e[campo] in concluidas:
                    raise erro(f"palete da ordem {e[campo]} depois de ela ter sido concluída")


# ---- fonte = servidor do jogo (P1) --------------------------------------------------------------------------------------

FUSO_JOGO = ZoneInfo("America/Sao_Paulo")


def _campos(linha, *campos):
    return {c: linha[c] for c in campos}


def _tseg(linha):
    """O campo `tSeg` do SimEvento é `tSeg` no /page e `tseg` no GET por id/POST (ver modelos/ALTERACOES_BACKEND.md)."""
    return linha["tSeg"] if "tSeg" in linha else linha["tseg"]


def pacote_do_jogo(cliente, cenario_id):
    """O pacote (mesmo formato do arquivo, em ordem canônica) de um SimCenario do servidor do jogo, lido como src/net/pacote.ts."""
    cen = cliente.ler("sim_cenarios", cenario_id)
    cenario = _campos(cen, "id", "codigo", "nome", "dificuldade", "armazemId", "seed", "qtdDocasInbound", "qtdDocasOutbound",
                      "qtdEquipamentos", "velocidadeEquipamentoCmS", "tempoDescargaSeg", "inicioTurnoSeg", "fimTurnoSeg")
    arm = cliente.ler("armazems", cen["armazemId"])
    areas = [_campos(a, "id", "armazemId", "nome", "funcao") for a in cliente.pagina("Area", armazemId=cen["armazemId"])]
    ruas, locais, ranking_linhas = [], [], []
    for a in areas:
        for r in cliente.pagina("Rua", areaId=a["id"]):
            ruas.append(_campos(r, "id", "areaId", "codigo", "qtdPosicoes", "qtdAndares"))
    for r in ruas:
        locais += [_campos(x, "id", "ruaId", "posicao", "andar", "situacao") for x in cliente.pagina("LocalArmazenagem", ruaId=r["id"])]
        ranking_linhas += cliente.pagina("RankingRua", ruaId=r["id"])
    ordens = [_campos(o, "id", "numero", "tipo", "liberacaoSeg", "slaSeg", "produtoId", "quantidadePaletes")
              for o in cliente.pagina("SimOrdem", cenarioId=cen["id"])]

    # produtos: os do perfil de alocação das ruas + os das ordens (como pacote.ts)
    perfis = sorted({r["perfilAlocacaoId"] for r in ranking_linhas if r.get("perfilAlocacaoId")})
    por_perfil = {p: cliente.pagina("Produto", perfilAlocacaoId=p) for p in perfis}
    ids_ordens = {o["produtoId"] for o in ordens}
    perfil = max(perfis, key=lambda p: (sum(1 for x in por_perfil[p] if x["id"] in ids_ordens), p), default=None)
    produtos = {x["id"]: x for x in (por_perfil[perfil] if perfil else [])}
    for pid in sorted(ids_ordens - set(produtos)):
        achado = cliente.ler("produtos", pid)
        if achado is None:
            raise ValueError(f"produto {pid} de uma ordem do cenário {cenario['codigo']} não existe")
        produtos[pid] = achado
    prioridade = {}
    for r in ranking_linhas:
        if perfil is not None and r.get("perfilAlocacaoId") != perfil:
            continue
        prioridade[r["ruaId"]] = min(r["prioridade"], prioridade.get(r["ruaId"], r["prioridade"]))

    rua_codigo = {r["id"]: r["codigo"] for r in ruas}
    pacote = {
        "cenario": cenario, "armazem": _campos(arm, "id", "nome"),
        "areas": sorted(areas, key=lambda a: a["nome"]),
        "ruas": sorted(ruas, key=lambda r: r["codigo"]),
        "locais": sorted(locais, key=lambda x: (rua_codigo[x["ruaId"]], x["posicao"], x["andar"])),
        "produtos": sorted((_campos(p, "id", "codigo", "nome", "qtdCaixasPorPallet") for p in produtos.values()), key=lambda p: p["codigo"]),
        "ordens": sorted(ordens, key=lambda o: (o["liberacaoSeg"], o["numero"])),
        "rankingRuas": sorted(({"ruaId": k, "prioridade": v} for k, v in prioridade.items()), key=lambda r: (r["prioridade"], r["ruaId"])),
    }

    validar_pacote(pacote)
    return pacote


def carregar_do_jogo(cliente, partida_id):
    """Monta (pacote, rastro) de uma partida CONCLUÍDA lendo o servidor do jogo. `cliente` = npdev.Cliente (admin).

    O pacote sai no mesmo formato do arquivo (só os campos do modelo, como src/net/pacote.ts), em ordem canônica; o rastro
    é o `rastro-v1` feito das linhas de SimEvento (só as do dono da partida). Valida como na leitura de arquivos."""
    partida = cliente.ler("sim_partidas", partida_id)
    if partida is None:
        raise ValueError(f"partida {partida_id} não existe no servidor do jogo")
    if partida["situacao"] != "Concluida":
        raise ValueError(f"partida {partida_id} está {partida['situacao']}; só dá para exportar partida Concluida")
    pacote = pacote_do_jogo(cliente, partida["cenarioId"])
    cen = pacote["cenario"]
    linhas = [e for e in cliente.pagina("SimEvento", partidaId=partida_id) if e["jogador"] == partida["jogador"]]
    linhas.sort(key=lambda e: e["seq"])
    scores = cliente.pagina("SimScore", partidaId=partida_id)
    rastro = {
        "formato": "rastro-v1", "partidaId": partida_id, "cenarioId": cen["id"], "cenarioCodigo": cen["codigo"],
        "versaoMotor": partida.get("versaoMotor") or "", "politicaInicial": partida["politica"],
        "scoreCentesimos": scores[0]["scoreCentesimos"] if scores else None,
        "eventos": [{"seq": e["seq"], "tipo": e["tipo"], "tSeg": _tseg(e), "ordemId": e.get("ordemId"), "ordemSaidaId": e.get("ordemSaidaId"),
                     "produtoId": e.get("produtoId"), "localId": e.get("localId"), "localDestinoId": e.get("localDestinoId")}
                    for e in linhas],
    }
    if not rastro["eventos"]:
        raise ValueError(f"partida {partida_id} não tem rastro (SimEvento): o cliente não o enviou; ela não pode ir ao WmsOffice")
    validar_rastro(rastro, pacote)
    iniciada = datetime.fromisoformat(partida["iniciadaEm"].replace("Z", "+00:00")).astimezone(FUSO_JOGO)
    return Fonte(pacote, rastro, partida, iniciada.strftime("%Y-%m-%d"))
