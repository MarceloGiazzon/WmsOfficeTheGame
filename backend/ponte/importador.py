"""Corporativo → Jogo (P2): um armazém do WmsOffice vira um cenário jogável no servidor do jogo.

Lê da ORIGEM (corporativo, :8100), grava no JOGO (:8200) com o mesmo Executor e um diário próprio. As regras de escolha
(docas, produtos, ranking, dificuldade, equipamentos, seed, nº de ordens) estão em mapa.json → corporativoParaJogo.

Partes puras (testadas offline, tests/test_importador.py): `escolher`, `parametros`, `operacoes_topologia`, `operacoes_ordens`,
`resumo`. As que falam com servidor: `ler_origem`, `importar`.
"""
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
from datetime import datetime, timezone

import fonte as fonte_mod
import mapa as mapa_mod
from diario import Diario
from executor import Executor, progresso_stderr
from planejador import Operacao, Plano

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(os.path.dirname(AQUI))
PASTA_ESTADO = os.path.join(AQUI, "estado")
CODIGO_MAX = 40  # SimCenario.codigo
PRODUTO_CODIGO_MAX = 30
INICIO_TURNO_SEG, FIM_TURNO_SEG = 28800, 64800


def _log(*a):
    print(*a, file=sys.stderr, flush=True)


# ---- leitura da origem --------------------------------------------------------------------------------------------------

def ler_origem(cliente, armazem_id, mapa):
    """Tudo o que a importação precisa do armazém da origem (linhas REST cruas). ValueError se o armazém não existe."""
    armazem = cliente.ler("armazems", armazem_id)
    if armazem is None:
        raise ValueError(f"armazém {armazem_id} não existe na origem")
    copiadas = set(mapa["corporativoParaJogo"]["areasCopiadas"])
    areas = [a for a in cliente.pagina("Area", armazemId=armazem_id) if a["funcao"] in copiadas]
    ruas, locais, ranking = [], [], []
    for a in areas:
        ruas += cliente.pagina("Rua", areaId=a["id"])
    for r in ruas:
        locais += cliente.pagina("LocalArmazenagem", ruaId=r["id"])
        ranking += cliente.pagina("RankingRua", ruaId=r["id"])
    perfis = {p["id"]: p for p in cliente.pagina("PerfilAlocacao")}
    produtos = [p for p in cliente.pagina("Produto") if p.get("ativo", True)]
    return {"armazem": armazem, "areas": areas, "ruas": ruas, "locais": locais, "ranking": ranking, "perfis": perfis,
            "produtos": produtos}


# ---- escolha (pura) -----------------------------------------------------------------------------------------------------

def escolher(origem, max_docas=2, max_produtos=30):
    """Decide o que copiar. ValueError (mensagem clara) se o armazém não dá um cenário jogável (PLANO T2.2)."""
    area_func = {a["id"]: a["funcao"] for a in origem["areas"]}
    locais_por_rua = {}
    for l in origem["locais"]:
        locais_por_rua.setdefault(l["ruaId"], []).append(l)
    for ls in locais_por_rua.values():
        ls.sort(key=lambda x: (x["posicao"], x["andar"]))

    ruas_arm = sorted((r for r in origem["ruas"] if area_func.get(r["areaId"]) == "Armazenagem" and locais_por_rua.get(r["id"])),
                      key=lambda r: r["codigo"])
    if not ruas_arm:
        raise ValueError("o armazém não tem nenhuma rua de armazenagem com locais")

    def docas(funcao):
        """(rua, local) de andar 1 das ruas da área, por (rua.codigo, posicao); só as `max_docas` primeiras."""
        ruas = sorted((r for r in origem["ruas"] if area_func.get(r["areaId"]) == funcao), key=lambda r: r["codigo"])
        todas = [(r, l) for r in ruas for l in locais_por_rua.get(r["id"], []) if l["andar"] == 1]
        return todas[:max_docas]

    entrada, saida = docas("Recebimento"), docas("Expedicao")
    if not entrada:
        raise ValueError("o armazém não tem doca de entrada (local de andar 1 numa rua de área Recebimento)")
    if not saida:
        raise ValueError("o armazém não tem doca de saída (local de andar 1 numa rua de área Expedicao)")

    # ranking: do primeiro perfil (por id) que tenha alguma linha para as ruas copiadas; sem nenhum, 1..n por rua.codigo
    ids_arm = {r["id"] for r in ruas_arm}
    por_perfil = {}
    for rk in origem["ranking"]:
        if rk["ruaId"] in ids_arm and rk.get("perfilAlocacaoId"):
            por_perfil.setdefault(rk["perfilAlocacaoId"], {})[rk["ruaId"]] = rk["prioridade"]
    perfil_id = sorted(por_perfil)[0] if por_perfil else None
    prioridade = dict(por_perfil[perfil_id]) if perfil_id else {}
    proxima = max(prioridade.values(), default=0) + 1
    for r in ruas_arm:  # ruas sem ranking entram no fim, por código
        if r["id"] not in prioridade:
            prioridade[r["id"]] = proxima
            proxima += 1

    # produtos: os do perfil do ranking (é o que o WmsOffice usa para alocar neste armazém); sem eles, todos os ativos
    ativos = sorted(origem["produtos"], key=codigo_de_origem)
    do_perfil = [p for p in ativos if perfil_id and p.get("perfilAlocacaoId") == perfil_id]
    produtos = (do_perfil or ativos)[:max_produtos]
    if not produtos:
        raise ValueError("a origem não tem nenhum produto ativo")

    areas_usadas = {r["areaId"] for r in ruas_arm} | {r["areaId"] for r, _ in entrada + saida}
    return {
        "areas": [a for a in origem["areas"] if a["id"] in areas_usadas],
        "ruas_armazenagem": ruas_arm, "locais_por_rua": {r["id"]: locais_por_rua[r["id"]] for r in ruas_arm},
        "entrada": entrada, "saida": saida, "prioridade": prioridade,
        "perfil": origem["perfis"].get(perfil_id) if perfil_id else None, "perfilId": perfil_id,
        "produtos": produtos,
        "nLocais": sum(len(locais_por_rua[r["id"]]) for r in ruas_arm),
    }


def _dificuldade(n_locais):
    return "Facil" if n_locais < 100 else "Medio" if n_locais < 500 else "Dificil" if n_locais < 1500 else "Extremo"


def parametros(escolha, armazem, codigo=None, seed=None, qtd_ordens=None):
    n = escolha["nLocais"]
    return {
        "codigo": codigo or f"CORP-{armazem['id'][:8]}",
        "seed": seed if seed is not None else int(hashlib.sha1(armazem["id"].encode()).hexdigest()[:8], 16) & 0x7FFFFFFF,
        "dificuldade": _dificuldade(n),
        "equipamentos": max(2, min(8, round(n / 150))),
        "qtdOrdens": qtd_ordens if qtd_ordens is not None else min(400, max(20, round(n * 1.2))),
        "docasEntrada": len(escolha["entrada"]), "docasSaida": len(escolha["saida"]),
    }


def codigo_de_origem(p):
    """`Produto.codigo` é opcional no WmsOffice (os produtos demo do seed vêm sem ele): sem código, os 8 primeiros do id."""
    return p.get("codigo") or p["id"][:8]


def codigo_produto(p):
    return f"CORP-{codigo_de_origem(p)}"[:PRODUTO_CODIGO_MAX]


def pesos(produtos):
    """i-ésimo produto por código (i = 1..n): max(1, round(100 / i ** 1.1)) — a mesma curva do WH-B."""
    return [max(1, round(100 / (i ** 1.1))) for i in range(1, len(produtos) + 1)]


# ---- operações (puras) ---------------------------------------------------------------------------------------------------

def operacoes_topologia(escolha, armazem, params, mapa, origem_url, agora_iso):
    """`garantir` da topologia, do perfil, dos produtos e do SimCenario (sem as ordens). Chaves `imp:` sobre ids da ORIGEM."""
    ops = []

    def g(chave, conceito, dados):
        ops.append(Operacao("garantir", chave, conceito, dados))

    nome = armazem["nome"]
    g("imp:entidade", "Entidade", {"nome": f"Corporativo · {nome}"[:120], "tipo": "Estabelecimento", "ativo": True})
    g("imp:armazem", "Armazem", {"entidadeId": {"$ref": "imp:entidade"}, "nome": f"{nome} (do corporativo)"[:120], "ativo": True})
    for a in escolha["areas"]:
        g(f"imp:area:{a['id']}", "Area", {"armazemId": {"$ref": "imp:armazem"}, "nome": a["nome"], "funcao": a["funcao"], "ativo": True})

    def rua(r, qtd_posicoes, qtd_andares):
        g(f"imp:rua:{r['id']}", "Rua", {
            "areaId": {"$ref": f"imp:area:{r['areaId']}"}, "codigo": r["codigo"], "qtdPosicoes": qtd_posicoes,
            "qtdAndares": qtd_andares, "bloqueiaRecebimento": False, "bloqueiaExpedicao": False, "bloqueiaMovimento": False,
            "ativo": True})

    for r in escolha["ruas_armazenagem"]:
        rua(r, r["qtdPosicoes"], r["qtdAndares"])
        for l in escolha["locais_por_rua"][r["id"]]:
            g(f"imp:local:{l['id']}", "LocalArmazenagem", {
                "ruaId": {"$ref": f"imp:rua:{r['id']}"}, "posicao": l["posicao"], "andar": l["andar"],
                "situacao": "Bloqueado" if l["situacao"] == "Bloqueado" else "Disponivel"})
    # docas: a rua leva só as copiadas, com qtdPosicoes = quantas (e 1 andar); posições renumeradas 1..k
    for docas in (escolha["entrada"], escolha["saida"]):
        por_rua = {}
        for r, l in docas:
            por_rua.setdefault(r["id"], (r, []))[1].append(l)
        for r, ls in por_rua.values():
            rua(r, len(ls), 1)
            for i, l in enumerate(ls, start=1):
                g(f"imp:local:{l['id']}", "LocalArmazenagem", {
                    "ruaId": {"$ref": f"imp:rua:{r['id']}"}, "posicao": i, "andar": 1, "situacao": "Disponivel"})

    perfil = escolha["perfil"]
    g("imp:perfil", "PerfilAlocacao", {"nome": f"Corporativo · {nome}"[:120],
                                       "ocupacaoIdealPercent": (perfil or {}).get("ocupacaoIdealPercent") or 80, "ativo": True})
    for r in escolha["ruas_armazenagem"]:
        g(f"imp:ranking:{r['id']}", "RankingRua", {"perfilAlocacaoId": {"$ref": "imp:perfil"}, "ruaId": {"$ref": f"imp:rua:{r['id']}"},
                                                   "prioridade": escolha["prioridade"][r["id"]]})
    for p in escolha["produtos"]:
        dados = {"nome": p["nome"], "codigo": codigo_produto(p), "qtdCaixasPorPallet": p.get("qtdCaixasPorPallet") or 1,
                 "perfilAlocacaoId": {"$ref": "imp:perfil"}, "ativo": True}
        if p.get("diasValidadePadrao") is not None:
            dados["diasValidadePadrao"] = p["diasValidadePadrao"]
        g(f"imp:produto:{p['id']}", "Produto", dados)

    modelo = mapa["corporativoParaJogo"]["cenario"]
    contexto = {**params, "armazemOrigem": armazem, "origemUrl": origem_url, "agoraIso": agora_iso}
    ops.append(Operacao("garantir", modelo["chave"], modelo["conceito"], mapa_mod.preencher(modelo["campos"], contexto)))
    return ops


def operacoes_ordens(ordens_geradas, id_cenario_chave="imp:cenario"):
    """`garantir` de cada SimOrdem devolvida por GerarOrdensSimulacao (produtoId já é o id do JOGO)."""
    return [Operacao("garantir", f"imp:ordem:{o['numero']}", "SimOrdem", {
        "cenarioId": {"$ref": id_cenario_chave}, "numero": o["numero"], "tipo": o["tipo"], "liberacaoSeg": o["liberacaoSeg"],
        "slaSeg": o["slaSeg"], "produtoId": o["produtoId"], "quantidadePaletes": o["quantidadePaletes"]}) for o in ordens_geradas]


def entrada_gerar_ordens(escolha, params, ids_produtos_jogo):
    """Corpo do flow GerarOrdensSimulacao (mapa.json → corporativoParaJogo.ordens.entrada)."""
    return {"seed": params["seed"], "inicioTurnoSeg": INICIO_TURNO_SEG, "fimTurnoSeg": FIM_TURNO_SEG, "qtdOrdens": params["qtdOrdens"],
            "produtos": [{"produtoId": ids_produtos_jogo[p["id"]], "peso": w} for p, w in zip(escolha["produtos"], pesos(escolha["produtos"]))],
            "slaMinSeg": 1800, "slaMaxSeg": 5400, "paletesMin": 1, "paletesMax": 3}


def resumo(escolha, params, armazem):
    """O que a importação criaria (para --simular): contagens por conceito, docas e produtos com o código novo."""
    n_docas = lambda docas: len({r["id"] for r, _ in docas})  # noqa: E731
    return {
        "armazemOrigem": {"id": armazem["id"], "nome": armazem["nome"]},
        "cenario": {k: params[k] for k in ("codigo", "dificuldade", "seed", "qtdOrdens")} | {"equipamentos": params["equipamentos"]},
        "criaria": {
            "Entidade": 1, "Armazem": 1, "Area": len(escolha["areas"]),
            "Rua": len(escolha["ruas_armazenagem"]) + n_docas(escolha["entrada"]) + n_docas(escolha["saida"]),
            "LocalArmazenagem": escolha["nLocais"] + len(escolha["entrada"]) + len(escolha["saida"]),
            "PerfilAlocacao": 1, "RankingRua": len(escolha["ruas_armazenagem"]), "Produto": len(escolha["produtos"]),
            "SimCenario": 1, "SimOrdem": params["qtdOrdens"]},
        "docasEntrada": [f"{r['codigo']}-P{l['posicao']:02d}" for r, l in escolha["entrada"]],
        "docasSaida": [f"{r['codigo']}-P{l['posicao']:02d}" for r, l in escolha["saida"]],
        "ruasArmazenagem": [r["codigo"] for r in escolha["ruas_armazenagem"]],
        "perfil": (escolha["perfil"] or {}).get("nome"),
        "produtos": [f"{codigo_de_origem(p)} → {codigo_produto(p)}" for p in escolha["produtos"]],
    }


# ---- importar (fala com servidores) -------------------------------------------------------------------------------------

def caminho_diario(jogo_url, origem_url, armazem_id):
    id_ = hashlib.sha1(f"{jogo_url.rstrip('/')}|importar|{origem_url.rstrip('/')}|{armazem_id}".encode()).hexdigest()[:12]
    return os.path.join(PASTA_ESTADO, f"{id_}.jsonl")


def distancia_teorica(pacote):
    """npx vite-node backend/npdev/tools/teorica_cenarios.ts <pacote> — a conta usa a malha e a curva ABC do motor do front."""
    with tempfile.TemporaryDirectory() as pasta:
        arquivo = os.path.join(pasta, "pacote.json")
        with open(arquivo, "w", encoding="utf-8") as f:
            json.dump(pacote, f)
        res = subprocess.run(["npx", "vite-node", "backend/npdev/tools/teorica_cenarios.ts", arquivo], cwd=RAIZ,
                             capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(f"teorica_cenarios.ts falhou ({res.returncode}): {res.stderr[-800:]}")
    saida = json.loads(res.stdout.strip().splitlines()[-1])
    return saida[pacote["cenario"]["codigo"]]


def importar(jogo, origem, origem_url, armazem_id, mapa, max_docas=2, max_produtos=30, codigo=None, qtd_ordens=None, seed=None,
             simular=False):
    """Devolve o resumo (dict). Com `simular`, não grava nada."""
    dados = ler_origem(origem, armazem_id, mapa)
    armazem = dados["armazem"]
    escolha = escolher(dados, max_docas, max_produtos)
    params = parametros(escolha, armazem, codigo, seed, qtd_ordens)
    if simular:
        return resumo(escolha, params, armazem)

    jogo_url = jogo.base
    diario = Diario(caminho_diario(jogo_url, origem_url, armazem_id), jogo_url, f"importar:{origem_url}:{armazem_id}")
    ex = Executor(jogo, mapa, diario, progresso_stderr())
    agora = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    ex.executar(Plano(operacoes_topologia(escolha, armazem, params, mapa, origem_url, agora)))

    # ordens: o flow é determinístico pela seed (rodar de novo gera as mesmas) e não grava nada; quem grava é o `garantir`
    ids_produtos = {p["id"]: diario.id(f"imp:produto:{p['id']}") for p in escolha["produtos"]}
    saida = jogo.flow("GerarOrdensSimulacao", entrada_gerar_ordens(escolha, params, ids_produtos))
    if not saida.get("sucesso", True) or not saida.get("ordens"):
        raise ValueError(f"GerarOrdensSimulacao não gerou ordens: {saida}")
    ex.executar(Plano(operacoes_ordens(saida["ordens"])))

    cenario_id = diario.id("imp:cenario")
    pacote = fonte_mod.pacote_do_jogo(jogo, cenario_id)
    teorica = distancia_teorica(pacote)
    jogo.atualizar(mapa_mod.endpoint(mapa, "SimCenario"), cenario_id, {"qtdOrdens": len(saida["ordens"]), "distanciaTeoricaCm": teorica})
    return {"cenarioId": cenario_id, "codigo": params["codigo"], "ordens": len(saida["ordens"]), "distanciaTeoricaCm": teorica,
            "diario": diario.caminho}
