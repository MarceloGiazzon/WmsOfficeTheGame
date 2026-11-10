#!/usr/bin/env python3
"""N3 — verificação ao vivo da role Jogador, das regras por linha e das queries (app de pé na 8200).

Dois jogadores de teste (criados pelo admin se não existirem; ficam no banco entre execuções):
  - lê cenários ativos, ordens do cenário e a topologia; não lê nem escreve o resto do WMS (403);
  - cria a própria partida pelo REST, não em nome de outro;
  - não edita/apaga partida pelo REST (troca de dono era possível antes — corrigido);
  - não vê, conclui nem abandona a partida de outro jogador;
  - não cria SimScore direto (forjar score era possível antes — corrigido); só via ConcluirPartida;
  - não escreve no WMS nem por flow (sem capability.invoke) nem por aggregate/procedure (access.write);
  - ranking por cenário: só scores validados, ordenado, visível a todos os jogadores.

Uso: python3 backend/npdev/tests/n3_jogador.py [--base ...] [--user admin] [--password ...]
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from npdev_api import Api  # noqa: E402

SENHA_JOGADOR = "Jogo!Teste2026"
JOGADORES = ["teste-jogador-1", "teste-jogador-2"]
METRICAS = {"distanciaRealCm": 824000, "distanciaTeoricaCm": 400000, "ordensTotal": 100,
            "ordensAtrasadas": 14, "eventosConflito": 6, "ocupacaoFinalCentesimos": 6200}  # -> 5040


def out(res):
    return res.get("output") if isinstance(res, dict) else None


def erro(res):
    return str(res.get("error") if isinstance(res, dict) else res)


def run(adm):
    check = adm.check
    for u in JOGADORES:
        st, res = adm.call("POST", "auth/create-user", {"username": u, "displayName": u, "password": SENHA_JOGADOR,
                                                       "roleNames": ["Jogador"]})
        if st not in (201, 409):
            raise SystemExit(f"create-user {u}: {st} {res}")
    j1 = Api(adm.base, JOGADORES[0], SENHA_JOGADOR)
    j2 = Api(adm.base, JOGADORES[1], SENHA_JOGADOR)

    print("fixtures (admin)")
    ent = adm.create("entidades", {"nome": "N3 Teste", "tipo": "Estabelecimento"})
    arm = adm.create("armazems", {"entidadeId": ent["id"], "nome": "N3 Armazem"})
    area = adm.create("areas", {"armazemId": arm["id"], "nome": "N3 Area", "funcao": "Armazenagem"})
    rua = adm.create("ruas", {"areaId": area["id"], "codigo": "N3R1", "qtdPosicoes": 2, "qtdAndares": 1})
    prod = adm.create("produtos", {"nome": "N3 Produto", "qtdCaixasPorPallet": 10})
    cen = adm.create("sim_cenarios", {"codigo": "N3-ATIVO", "nome": "N3 ativo", "armazemId": arm["id"], "seed": 3})
    inativo = adm.create("sim_cenarios", {"codigo": "N3-INATIVO", "nome": "N3 inativo", "armazemId": arm["id"],
                                          "seed": 4, "ativo": False})
    for i, lib in enumerate([30000, 29000]):
        adm.create("sim_ordems", {"cenarioId": cen["id"], "numero": f"IN-{i + 1:04d}", "tipo": "Inbound",
                                  "liberacaoSeg": lib, "slaSeg": 1800, "produtoId": prod["id"]})

    print("leitura do jogador")
    st, res = j1.call("GET", "queries/CenariosAtivos")
    codigos = [r["codigo"] for r in res.get("rows", [])] if st == 200 else []
    check("CenariosAtivos traz o ativo e não o inativo", "N3-ATIVO" in codigos and "N3-INATIVO" not in codigos,
          f"{st} {res}")
    st, res = j1.call("GET", f"queries/OrdensPorCenario?cenarioId={cen['id']}")
    rows = res.get("rows", []) if st == 200 else []
    check("OrdensPorCenario: só as do cenário, por liberação",
          [r["numero"] for r in rows] == ["IN-0002", "IN-0001"], f"{st} {res}")
    st, _ = j1.call("GET", "queries/OrdensPorCenario")
    check("OrdensPorCenario sem cenarioId -> 400 (nunca devolve tudo)", st == 400, st)
    for rota in ["armazems", "areas", "ruas", "local_armazenagems", "produtos", "sim_ordems"]:
        st, _ = j1.call("GET", rota)
        check(f"lê {rota}", st == 200, st)

    print("o que o jogador não pode (REST)")
    for metodo, rota, corpo in [
        ("POST", "sim_cenarios", {"codigo": "X", "nome": "x", "armazemId": arm["id"], "seed": 1}),
        ("PUT", f"sim_cenarios/{cen['id']}", {"codigo": "N3-ATIVO", "nome": "hack", "armazemId": arm["id"], "seed": 3}),
        ("POST", "sim_ordems", {"cenarioId": cen["id"], "numero": "X", "tipo": "Inbound", "liberacaoSeg": 1,
                                "slaSeg": 1, "produtoId": prod["id"]}),
        ("POST", "armazems", {"entidadeId": ent["id"], "nome": "X"}),
        ("PUT", f"ruas/{rua['id']}", {"areaId": area["id"], "codigo": "N3R1", "qtdPosicoes": 99, "qtdAndares": 1}),
        ("GET", "recebimentos", None),
        ("GET", "movimentos", None),
        ("GET", "entidades", None),
        ("GET", "identity_users", None),
    ]:
        st, _ = j1.call(metodo, rota, corpo)
        check(f"{metodo} {rota.split('/')[0]} -> 403", st == 403, st)

    print("partidas")
    base_partida = {"cenarioId": cen["id"], "politica": "AbcProximidade", "versaoMotor": "0.1.0",
                    "iniciadaEm": "2026-11-10T08:00:00Z"}
    st, p1 = j1.call("POST", "sim_partidas", {**base_partida, "jogador": j1.me["username"]})
    check("jogador cria a própria partida", st in (200, 201) and p1.get("situacao") == "EmAndamento",
          f"{st} {p1}")
    adm.track("sim_partidas", p1["id"])
    j1.expect_reject("criar partida em nome de outro jogador", "POST", "sim_partidas",
                     {**base_partida, "jogador": j2.me["username"]}, why="ROW_SCOPE_DENIED")
    st, _ = j1.call("PUT", f"sim_partidas/{p1['id']}", {**base_partida, "jogador": j2.me["username"]})
    check("PUT na própria partida (ex.: trocar o dono) -> 403", st == 403, st)
    st, _ = j1.call("DELETE", f"sim_partidas/{p1['id']}")
    check("DELETE da própria partida -> 403", st == 403, st)
    st, _ = j2.call("GET", f"sim_partidas/{p1['id']}")
    check("outro jogador não vê a partida (404)", st == 404, st)
    check("  nem na listagem", all(p["id"] != p1["id"] for p in j2.call("GET", "sim_partidas")[1]))
    check("admin vê todas", any(p["id"] == p1["id"] for p in adm.call("GET", "sim_partidas")[1]))

    st, res = j2.flow("ConcluirPartida", {"partidaId": p1["id"], **METRICAS, "scoreCentesimos": 5040})
    check("outro jogador não conclui a partida", st >= 400 and "CONCEPT_NOT_FOUND" in erro(res), f"{st} {res}")
    st, res = j2.flow("AbandonarPartida", {"partidaId": p1["id"]})
    check("outro jogador não abandona a partida", st >= 400, f"{st} {res}")
    check("  partida intacta", adm.call("GET", f"sim_partidas/{p1['id']}")[1]["situacao"] == "EmAndamento")

    st, sc_forjado = j1.call("POST", "sim_scores", {"partidaId": p1["id"], "cenarioId": cen["id"],
                                                    "jogador": j1.me["username"], **METRICAS,
                                                    "scoreCentesimos": 10000, "validadoServidor": True})
    check("jogador não cria SimScore direto (forjar ranking) -> 403", st == 403, f"{st} {sc_forjado}")
    if st in (200, 201):
        adm.track("sim_scores", sc_forjado["id"])

    st, res = j1.flow("ConcluirPartida", {"partidaId": p1["id"], **METRICAS, "scoreCentesimos": 5040})
    dados = (out(res) or {}).get("data") or {}
    check("jogador conclui a própria partida", st == 200 and dados.get("scoreCentesimos") == 5040
          and dados.get("validadoServidor") is True, f"{st} {res}")
    check("  score leva cenário e jogador da partida",
          dados.get("cenarioId") == cen["id"] and dados.get("jogador") == j1.me["username"], dados)
    if dados.get("id"):
        adm.track("sim_scores", dados["id"])

    # j2: partida com score adulterado (não validado) e uma abandonada
    st, p2 = j2.call("POST", "sim_partidas", {**base_partida, "jogador": j2.me["username"]})
    adm.track("sim_partidas", p2["id"])
    st, res = j2.flow("ConcluirPartida", {"partidaId": p2["id"], **{**METRICAS, "ordensAtrasadas": 0},
                                          "scoreCentesimos": 10000})
    d2 = (out(res) or {}).get("data") or {}
    check("score adulterado é gravado como não validado", d2.get("validadoServidor") is False, res)
    if d2.get("id"):
        adm.track("sim_scores", d2["id"])
    st, p3 = j2.call("POST", "sim_partidas", {**base_partida, "jogador": j2.me["username"]})
    adm.track("sim_partidas", p3["id"])
    st, res = j2.flow("AbandonarPartida", {"partidaId": p3["id"]})
    check("jogador abandona a própria partida",
          st == 200 and adm.call("GET", f"sim_partidas/{p3['id']}")[1]["situacao"] == "Abandonada", f"{st} {res}")
    st, res = j1.flow("AbandonarPartida", {"partidaId": p1["id"]})
    check("abandonar partida já concluída é recusado (lifecycle)",
          st >= 400 and adm.call("GET", f"sim_partidas/{p1['id']}")[1]["situacao"] == "Concluida", f"{st} {res}")

    print("ranking")
    st, res = j2.call("GET", f"queries/RankingPorCenario?cenarioId={cen['id']}")
    rows = res.get("rows", []) if st == 200 else []
    check("outro jogador vê o ranking com o score validado de j1",
          [(r["jogador"], r["scoreCentesimos"]) for r in rows] == [(j1.me["username"], 5040)], f"{st} {res}")
    st, res = j1.call("GET", f"queries/RankingPorCenario?cenarioId={inativo['id']}")
    check("ranking de outro cenário vazio", st == 200 and res.get("rows") == [], f"{st} {res}")

    print("outras vias de escrita")
    # createConcept/updateConcept de FLOW ignoram access.* no NPDev; a defesa é o jogador não ter capability.invoke.
    st, res = j1.flow("CriarLocalArmazenagemVerificado", {"locaisExistentes": [], "dados": {
        "ruaId": rua["id"], "posicao": 1, "andar": 1, "situacao": "Disponivel"}})
    check("flow do WMS com escrita -> negado (sem capability.invoke)",
          st >= 400 and "capability.invoke" in erro(res), f"{st} {erro(res)}")
    criados = [loc for loc in adm.call("GET", "local_armazenagems")[1] if loc.get("ruaId") == rua["id"]]
    check("  nenhum local criado", not criados, criados)
    st, res = j1.flow("IniciarPartida", {**base_partida, "jogador": j2.me["username"]})
    check("não há flow de create de partida (createConcept de flow ignoraria a regra de dono)", st >= 400, f"{st} {res}")
    st, res = j1.call("POST", "v1/runtime/aggregate/Recebimento", {"root": {"entidadeId": ent["id"],
                                                                         "dataRecebimento": "2026-11-10"}})
    check("commit de aggregate do WMS -> negado pela regra por linha",
          st == 403 and "ROW_SCOPE_DENIED" in str(res), f"{st} {str(res)[:200]}")
    st, res = j1.flow("GerarOrdensSimulacao", {"seed": 1, "inicioTurnoSeg": 28800, "fimTurnoSeg": 64800,
                                               "qtdOrdens": 5, "produtos": [{"produtoId": prod["id"], "peso": 1}]})
    check("flows do jogo funcionam para o jogador (só callProcedure)",
          st == 200 and len((out(res) or {}).get("ordens", [])) == 5, f"{st} {res}")

    print("cenários semeados (tools/semear_cenarios.py)")
    _, ativos = j1.call("GET", "queries/CenariosAtivos")
    por_codigo = {r["codigo"]: r for r in ativos.get("rows", [])}
    for codigo, n_ordens, n_locais in [("WH-A-PEQUENO", 60, 52), ("WH-B-MEGA", 400, 1448)]:
        if codigo not in por_codigo:
            print(f"  skip {codigo} não semeado")
            continue
        c = por_codigo[codigo]
        st, res = j1.call("GET", f"queries/OrdensPorCenario?cenarioId={c['id']}")
        ordens = res.get("rows", []) if st == 200 else []
        check(f"{codigo}: jogador lê as {n_ordens} ordens numa chamada",
              len(ordens) == n_ordens and res.get("total") == n_ordens, f"{st} rows={len(ordens)} total={res.get('total')}")
        check(f"  {codigo}: ordens em ordem de liberação",
              [o["liberacaoSeg"] for o in ordens] == sorted(o["liberacaoSeg"] for o in ordens))
    if "WH-A-PEQUENO" in por_codigo:
        c = por_codigo["WH-A-PEQUENO"]
        st, pa = j1.call("POST", "sim_partidas", {**base_partida, "cenarioId": c["id"], "jogador": j1.me["username"]})
        adm.track("sim_partidas", pa["id"])
        st, res = j1.flow("ConcluirPartida", {"partidaId": pa["id"], **METRICAS, "scoreCentesimos": 5040})
        d = (out(res) or {}).get("data") or {}
        if d.get("id"):
            adm.track("sim_scores", d["id"])
        _, rk = j2.call("GET", f"queries/RankingPorCenario?cenarioId={c['id']}")
        check("WH-A-PEQUENO: partida jogada aparece no ranking para outro jogador",
              any(r["id"] == d.get("id") for r in rk.get("rows", [])), f"{res} {rk}")

    # o admin limpa também o local criado se a regra falhar
    for loc in adm.call("GET", "local_armazenagems")[1]:
        if loc.get("ruaId") == rua["id"]:
            adm.track("local_armazenagems", loc["id"])


if __name__ == "__main__":
    Api.from_argv().run(run)
