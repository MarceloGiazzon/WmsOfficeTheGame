#!/usr/bin/env python3
"""N2 — verificação ao vivo dos flows da capability `simulacao` (app de pé na 8200).

  - CalcularScoreSimulacao: todos os casos de tests/fixtures/score-cases.json (mesmo resultado do teste offline);
  - ConcluirPartida: score certo, score adulterado, métricas inválidas, partida já concluída, abandonada,
    inexistente, e atomicidade (falha na criação do score não deixa a partida Concluida);
  - GerarOrdensSimulacao: determinismo pelo flow;
  - SugerirDestinoJogo: reaproveita a AllocationCapability.

Uso: python3 backend/npdev/tests/n2_simulacao_flows.py [--base ...] [--user ...] [--password ...]
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from npdev_api import Api  # noqa: E402

FIXTURES = json.load(open(os.path.join(HERE, "fixtures", "score-cases.json")))
METRICAS_A = FIXTURES["casos"][0]["metricas"]  # README Estratégia A -> 5040


def output(res):
    return res.get("output") if isinstance(res, dict) else None


def run(api):
    check = api.check

    print("CalcularScoreSimulacao")
    for c in FIXTURES["casos"]:
        st, res = api.flow("CalcularScoreSimulacao", c["metricas"])
        out = output(res) or {}
        check(c["nome"], st == 200 and out.get("scoreCentesimos") == c["esperado"]["scoreCentesimos"]
              and out.get("penalidades") == c["esperado"]["penalidades"], f"{st} {out or res}")
    for c in FIXTURES["invalidos"]:
        st, res = api.flow("CalcularScoreSimulacao", c["metricas"])
        check("inválido: " + c["nome"], (output(res) or {}).get("sucesso") is False, f"{st} {res}")

    print("fixtures")
    ent = api.create("entidades", {"nome": "N2 Teste", "tipo": "Estabelecimento"})
    arm = api.create("armazems", {"entidadeId": ent["id"], "nome": "N2 Armazem"})
    cen = api.create("sim_cenarios", {"codigo": "N2-TESTE", "nome": "Cenario N2", "armazemId": arm["id"], "seed": 7})

    def nova_partida(politica="AbcProximidade"):
        return api.create("sim_partidas", {"cenarioId": cen["id"], "jogadorId": api.me["id"], "politica": politica,
                                           "versaoMotor": "0.1.0", "iniciadaEm": "2026-11-10T08:00:00Z"})

    def scores_da(partida):
        _, todos = api.call("GET", "sim_scores")
        return [s for s in todos if s["partidaId"] == partida["id"]]

    def track_scores(partida):
        for s in scores_da(partida):
            api.track("sim_scores", s["id"])

    print("ConcluirPartida")
    p1 = nova_partida()
    st, res = api.flow("ConcluirPartida", {"partidaId": p1["id"], **METRICAS_A, "scoreCentesimos": 5040})
    out = output(res) or {}
    track_scores(p1)
    check("score certo -> 200", st == 200, res)
    dados = out.get("data") or {}
    check("  devolve o envelope do SimScore gravado (validadoServidor=true, 50,40)",
          out.get("conceptName") == "SimScore" and dados.get("partidaId") == p1["id"]
          and dados.get("validadoServidor") is True and dados.get("scoreCentesimos") == 5040, out)
    _, got = api.call("GET", f"sim_partidas/{p1['id']}")
    check("  partida Concluida com concluidaEm do servidor", got["situacao"] == "Concluida" and got["concluidaEm"], got)
    sc = scores_da(p1)
    check("  SimScore gravado com métricas e validadoServidor=true",
          len(sc) == 1 and sc[0]["validadoServidor"] is True and sc[0]["scoreCentesimos"] == 5040
          and all(sc[0][k] == v for k, v in METRICAS_A.items()), sc)

    st, res = api.flow("ConcluirPartida", {"partidaId": p1["id"], **METRICAS_A, "scoreCentesimos": 5040})
    check("segunda conclusão da mesma partida recusada",
          st == 200 and (output(res) or {}).get("sucesso") is False
          and "EmAndamento" in str((output(res) or {}).get("motivo")), f"{st} {res}")
    _, got2 = api.call("GET", f"sim_partidas/{p1['id']}")
    check("  concluidaEm não é sobrescrito e continua com 1 score",
          got2["concluidaEm"] == got["concluidaEm"] and len(scores_da(p1)) == 1, got2)

    p2 = nova_partida()
    st, res = api.flow("ConcluirPartida", {"partidaId": p2["id"], **METRICAS_A, "scoreCentesimos": 9999})
    track_scores(p2)
    sc = scores_da(p2)
    check("score adulterado (99,99) -> grava o recalculado (50,40) com validadoServidor=false",
          st == 200 and len(sc) == 1 and sc[0]["scoreCentesimos"] == 5040 and sc[0]["validadoServidor"] is False,
          f"{st} {sc} {res}")
    check("  resposta é o score gravado (recalculado)",
          ((output(res) or {}).get("data") or {}).get("scoreCentesimos") == 5040
          and ((output(res) or {}).get("data") or {}).get("validadoServidor") is False, output(res))

    p3 = nova_partida()
    st, res = api.flow("ConcluirPartida", {"partidaId": p3["id"], **{**METRICAS_A, "ordensAtrasadas": 101},
                                           "scoreCentesimos": 5040})
    out = output(res) or {}
    check("métricas inválidas -> devolve validacao sem gravar",
          st == 200 and out.get("sucesso") is False and "ordensAtrasadas" in str(out.get("motivo")), f"{st} {res}")
    _, got = api.call("GET", f"sim_partidas/{p3['id']}")
    check("  partida continua EmAndamento e sem score", got["situacao"] == "EmAndamento" and not scores_da(p3), got)

    p4 = nova_partida("WmsReal")
    api.call("PUT", f"sim_partidas/{p4['id']}", {**{k: p4[k] for k in ("cenarioId", "jogadorId", "politica",
                                                                       "versaoMotor", "iniciadaEm")},
                                                 "situacao": "Abandonada"})
    st, res = api.flow("ConcluirPartida", {"partidaId": p4["id"], **METRICAS_A, "scoreCentesimos": 5040})
    check("partida Abandonada não pode ser concluída",
          st == 200 and (output(res) or {}).get("sucesso") is False, f"{st} {res}")
    _, got = api.call("GET", f"sim_partidas/{p4['id']}")
    check("  continua Abandonada", got["situacao"] == "Abandonada", got)
    check("  sem score", not scores_da(p4))

    st, res = api.flow("ConcluirPartida", {"partidaId": "00000000-0000-0000-0000-000000000000", **METRICAS_A,
                                           "scoreCentesimos": 5040})
    check("partida inexistente recusada", st >= 400 and "CONCEPT_NOT_FOUND" in str(res), f"{st} {res}")

    # Sem estado parcial: procedures NÃO são transacionais, então o score é gravado ANTES da partida mudar.
    # Um SimScore criado à parte (via REST) faz a criação do score falhar (unique em partidaId); a partida
    # tem de continuar EmAndamento.
    p5 = nova_partida()
    api.create("sim_scores", {"partidaId": p5["id"], **METRICAS_A, "scoreCentesimos": 5040})
    st, res = api.flow("ConcluirPartida", {"partidaId": p5["id"], **METRICAS_A, "scoreCentesimos": 5040})
    _, got = api.call("GET", f"sim_partidas/{p5['id']}")
    check("falha ao gravar o score -> erro", st >= 400, f"{st} {res}")
    check("  partida continua EmAndamento (nenhuma escrita parcial)", got["situacao"] == "EmAndamento", got)

    print("GerarOrdensSimulacao")
    body = {"seed": 42, "inicioTurnoSeg": 28800, "fimTurnoSeg": 64800, "qtdOrdens": 60,
            "produtos": [{"produtoId": "A", "peso": 70}, {"produtoId": "B", "peso": 30}]}
    _, r1 = api.flow("GerarOrdensSimulacao", body)
    _, r2 = api.flow("GerarOrdensSimulacao", body)
    o1 = (output(r1) or {}).get("ordens", [])
    check("60 ordens, determinístico entre chamadas", len(o1) == 60 and o1 == (output(r2) or {}).get("ordens"),
          output(r1))
    _, r3 = api.flow("GerarOrdensSimulacao", {**body, "qtdOrdens": 0})
    check("entrada inválida -> sucesso=false", (output(r3) or {}).get("sucesso") is False, r3)

    print("SugerirDestinoJogo")
    _, r = api.flow("SugerirDestinoJogo", {"loteId": "L1", "candidatos": [
        {"localArmazenagemId": "B", "prioridade": 2},
        {"localArmazenagemId": "A", "prioridade": 1},
        {"localArmazenagemId": "C", "prioridade": 5, "loteOcupanteId": "L1"}]})
    check("prefere o local já ocupado pelo mesmo lote", (output(r) or {}).get("localArmazenagemId") == "C", r)
    _, r = api.flow("SugerirDestinoJogo", {"loteId": "L9", "candidatos": [
        {"localArmazenagemId": "B", "prioridade": 2}, {"localArmazenagemId": "A", "prioridade": 1}]})
    check("senão, menor prioridade de ranking", (output(r) or {}).get("localArmazenagemId") == "A", r)


if __name__ == "__main__":
    Api.from_argv().run(run)
