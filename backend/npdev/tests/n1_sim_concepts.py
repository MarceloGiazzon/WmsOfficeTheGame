#!/usr/bin/env python3
"""N1 — verificação ao vivo dos concepts Sim* (SimCenario, SimOrdem, SimPartida, SimScore).

Cobre CRUD REST, invariants, unique, lifecycle de SimPartida e os bonds (restrict/cascade).
Cria as próprias fixtures e apaga tudo no final, inclusive em caso de falha.

Uso:  python3 backend/npdev/tests/n1_sim_concepts.py [--base http://localhost:8200] [--user admin] [--password ...]
"""
import argparse
import json
import sys
import urllib.error
import urllib.request

args = argparse.ArgumentParser()
args.add_argument("--base", default="http://localhost:8200")
args.add_argument("--user", default="admin")
args.add_argument("--password", default="Teste123!")
args = args.parse_args()

TOKEN = None
failures = []
created = []  # (endpoint, id) para limpeza, em ordem de criação


def call(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(args.base + "/api/" + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if TOKEN:
        req.add_header("Authorization", "Bearer " + TOKEN)
    try:
        with urllib.request.urlopen(req) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw)
        except ValueError:
            return e.code, raw.decode(errors="replace")


def check(name, cond, detail=""):
    print(("  ok   " if cond else "  FAIL ") + name + ("" if cond else f"  -> {detail}"))
    if not cond:
        failures.append(name)


def create(endpoint, body):
    st, res = call("POST", endpoint, body)
    if st not in (200, 201):
        raise SystemExit(f"fixture {endpoint} falhou: {st} {res}")
    created.append((endpoint, res["id"]))
    return res


def expect_reject(name, method, path, body=None, why=None):
    """Exige 4xx e, se `why` for dado, que ele apareça no corpo (nome do invariant / código do erro)."""
    st, res = call(method, path, body)
    check(name, 400 <= st < 500 and (why is None or why in str(res)), f"{st} {str(res)[:200]}")
    if method == "POST" and st in (200, 201) and isinstance(res, dict):
        created.append((path, res["id"]))
    return st


def run():
    global TOKEN
    st, res = call("POST", "auth/login", {"username": args.user, "password": args.password})
    if st != 200:
        raise SystemExit(f"login falhou: {st} {res}")
    TOKEN = res["token"]
    _, me = call("GET", "auth/me")

    print("fixtures")
    ent = create("entidades", {"nome": "N1 Teste", "tipo": "Estabelecimento"})
    arm = create("armazems", {"entidadeId": ent["id"], "nome": "N1 Armazem"})
    prod = create("produtos", {"nome": "N1 Produto", "qtdCaixasPorPallet": 10})

    print("SimCenario")
    cen_body = {"codigo": "N1-TESTE", "nome": "Cenario N1", "armazemId": arm["id"], "seed": 42}
    cen = create("sim_cenarios", cen_body)
    check("defaults aplicados (2/2 docas, 3 equip., turno 28800-64800, Facil, ativo)",
          (cen["qtdDocasInbound"], cen["qtdDocasOutbound"], cen["qtdEquipamentos"],
           cen["inicioTurnoSeg"], cen["fimTurnoSeg"], cen["dificuldade"], cen["ativo"])
          == (2, 2, 3, 28800, 64800, "Facil", True), cen)
    expect_reject("codigo duplicado rejeitado", "POST", "sim_cenarios", cen_body, why="unique_integrity_failed")
    expect_reject("fimTurno <= inicioTurno rejeitado", "POST", "sim_cenarios",
                  {**cen_body, "codigo": "N1-X1", "inicioTurnoSeg": 64800, "fimTurnoSeg": 28800}, why="SimCenarioFimTurnoRange")
    expect_reject("qtdEquipamentos 0 rejeitado", "POST", "sim_cenarios",
                  {**cen_body, "codigo": "N1-X2", "qtdEquipamentos": 0}, why="SimCenarioEquipamentosPositive")
    expect_reject("dificuldade fora do enum rejeitada", "POST", "sim_cenarios",
                  {**cen_body, "codigo": "N1-X3", "dificuldade": "Impossivel"})
    expect_reject("armazemId inexistente rejeitado", "POST", "sim_cenarios",
                  {**cen_body, "codigo": "N1-X4", "armazemId": "00000000-0000-0000-0000-000000000000"})
    st, got = call("GET", f"sim_cenarios/{cen['id']}")
    check("GET por id", st == 200 and got["codigo"] == "N1-TESTE", f"{st} {got}")

    print("SimOrdem")
    ord_body = {"cenarioId": cen["id"], "numero": "IN-0001", "tipo": "Inbound",
                "liberacaoSeg": 29000, "slaSeg": 1800, "produtoId": prod["id"], "quantidadePaletes": 2}
    ordem = create("sim_ordems", ord_body)
    check("ordem criada", ordem["tipo"] == "Inbound", ordem)
    expect_reject("slaSeg 0 rejeitado", "POST", "sim_ordems", {**ord_body, "numero": "X", "slaSeg": 0}, why="SimOrdemSlaPositive")
    expect_reject("quantidadePaletes 0 rejeitado", "POST", "sim_ordems",
                  {**ord_body, "numero": "X", "quantidadePaletes": 0}, why="SimOrdemPaletesPositive")
    expect_reject("tipo fora do enum rejeitado", "POST", "sim_ordems", {**ord_body, "numero": "X", "tipo": "Lateral"})

    print("SimPartida")
    par_body = {"cenarioId": cen["id"], "jogadorId": me["id"], "politica": "AbcProximidade",
                "versaoMotor": "0.1.0", "iniciadaEm": "2026-11-10T08:00:00Z"}
    par = create("sim_partidas", par_body)
    check("situacao inicial EmAndamento", par["situacao"] == "EmAndamento", par)
    expect_reject("jogadorId inexistente rejeitado", "POST", "sim_partidas",
                  {**par_body, "jogadorId": "00000000-0000-0000-0000-000000000000"})
    expect_reject("politica fora do enum rejeitada", "POST", "sim_partidas", {**par_body, "politica": "Aleatoria"})
    expect_reject("Concluida sem concluidaEm rejeitado", "PUT", f"sim_partidas/{par['id']}",
                  {**par_body, "situacao": "Concluida"}, why="SimPartidaConcluidaEmRequired")
    st, upd = call("PUT", f"sim_partidas/{par['id']}",
                   {**par_body, "situacao": "Concluida", "concluidaEm": "2026-11-10T09:00:00Z"})
    check("EmAndamento -> Concluida", st == 200 and upd["situacao"] == "Concluida", f"{st} {upd}")
    expect_reject("Concluida -> EmAndamento rejeitado (terminal)", "PUT", f"sim_partidas/{par['id']}",
                  {**par_body, "situacao": "EmAndamento", "concluidaEm": "2026-11-10T09:00:00Z"},
                  why="status_transition_not_allowed")
    expect_reject("Concluida -> Abandonada rejeitado (terminal)", "PUT", f"sim_partidas/{par['id']}",
                  {**par_body, "situacao": "Abandonada", "concluidaEm": "2026-11-10T09:00:00Z"},
                  why="status_transition_not_allowed")
    par2 = create("sim_partidas", {**par_body, "politica": "WmsReal"})
    st, upd = call("PUT", f"sim_partidas/{par2['id']}", {**par_body, "politica": "WmsReal", "situacao": "Abandonada"})
    check("EmAndamento -> Abandonada", st == 200 and upd["situacao"] == "Abandonada", f"{st} {upd}")

    print("SimScore")
    sc_body = {"partidaId": par["id"], "distanciaRealCm": 1_250_000, "distanciaTeoricaCm": 1_000_000,
               "ordensTotal": 60, "ordensAtrasadas": 3, "eventosConflito": 2,
               "ocupacaoFinalCentesimos": 8150, "scoreCentesimos": 9150}
    expect_reject("ordensAtrasadas > ordensTotal rejeitado", "POST", "sim_scores", {**sc_body, "ordensAtrasadas": 61},
                  why="SimScoreOrdensAtrasadasRange")
    expect_reject("scoreCentesimos > 10000 rejeitado", "POST", "sim_scores", {**sc_body, "scoreCentesimos": 10001}, why="SimScoreRange")
    expect_reject("ocupacao < 0 rejeitada", "POST", "sim_scores", {**sc_body, "ocupacaoFinalCentesimos": -1},
                  why="SimScoreOcupacaoRange")
    sc = create("sim_scores", sc_body)
    check("score criado, validadoServidor default false", sc["validadoServidor"] is False, sc)
    expect_reject("segundo score para a mesma partida rejeitado (unique)", "POST", "sim_scores", sc_body,
                  why="unique_integrity_failed")

    print("bonds")
    expect_reject("delete Armazem usado por cenario rejeitado (restrict)", "DELETE", f"armazems/{arm['id']}", why="reference_integrity_failed")
    expect_reject("delete Produto usado por ordem rejeitado (restrict)", "DELETE", f"produtos/{prod['id']}", why="reference_integrity_failed")
    expect_reject("delete SimCenario com partidas rejeitado (restrict)", "DELETE", f"sim_cenarios/{cen['id']}",
                  why="reference_integrity_failed")
    st, _ = call("DELETE", f"sim_partidas/{par['id']}")
    check("delete SimPartida", st in (200, 204), st)
    st, _ = call("GET", f"sim_scores/{sc['id']}")
    check("SimScore removido em cascata com a partida", st == 404, st)
    call("DELETE", f"sim_partidas/{par2['id']}")
    st, _ = call("DELETE", f"sim_cenarios/{cen['id']}")
    check("delete SimCenario sem partidas", st in (200, 204), st)
    st, _ = call("GET", f"sim_ordems/{ordem['id']}")
    check("SimOrdem removida em cascata com o cenario", st == 404, st)


def cleanup():
    for endpoint, id_ in reversed(created):
        call("DELETE", f"{endpoint}/{id_}")
    leftovers = [(e, i) for e, i in created if call("GET", f"{e}/{i}")[0] != 404]
    if leftovers:
        print(f"ATENCAO: registros nao removidos: {leftovers}")


try:
    run()
finally:
    if TOKEN:
        cleanup()

print(f"\n{'FALHOU' if failures else 'OK'}: {len(failures)} falha(s)")
sys.exit(1 if failures else 0)
