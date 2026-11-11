#!/usr/bin/env python3
"""P1/P3 (ponte Jogo ↔ WmsOffice) — verificação ao vivo do concept SimExportacao (registro e fila das exportações).

  - o jogador pede uma exportação da PRÓPRIA partida (situacao Solicitada por padrão) e a lê; não pede em nome de outro;
  - outro jogador não a vê; o jogador não edita nem apaga (quem muda a situação é a ponte, como admin);
  - sem lifecycle: o admin vai Solicitada -> EmAndamento -> Falhou -> EmAndamento -> Concluida (tentar de novo é permitido);
  - progressoCentesimos fora de 0..10000 é recusado.

Limpa tudo o que cria. Uso: python3 backend/npdev/tests/p1_sim_exportacao.py [--base ...] [--user admin] [--password ...]
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from npdev_api import Api  # noqa: E402

SENHA_JOGADOR = "Jogo!Teste2026"
JOGADORES = ["teste-jogador-1", "teste-jogador-2"]
AGORA = "2026-11-10T20:00:00Z"


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
    ent = adm.create("entidades", {"nome": "P1X Teste", "tipo": "Estabelecimento"})
    arm = adm.create("armazems", {"entidadeId": ent["id"], "nome": "P1X Armazem"})
    cen = adm.create("sim_cenarios", {"codigo": "P1-EXP", "nome": "P1 exportacao", "armazemId": arm["id"], "seed": 8})
    st, partida = j1.call("POST", "sim_partidas", {"cenarioId": cen["id"], "politica": "AbcProximidade", "versaoMotor": "0.3.0",
                                                   "iniciadaEm": AGORA, "jogador": j1.me["username"]})
    assert st in (200, 201), (st, partida)
    adm.track("sim_partidas", partida["id"])

    print("o jogador solicita")
    corpo = {"partidaId": partida["id"], "alvoUrl": "http://localhost:8100", "solicitadaPor": j1.me["username"],
             "solicitadaEm": AGORA}
    st, exp = j1.call("POST", "sim_exportacaos", corpo)
    check("POST da solicitação -> situacao Solicitada (padrão)", st in (200, 201) and exp.get("situacao") == "Solicitada", f"{st} {exp}")
    if st not in (200, 201):
        return
    adm.track("sim_exportacaos", exp["id"])
    st, pag = j1.call("GET", f"concepts/SimExportacao/page?partidaId={partida['id']}&limit=100")
    check("o jogador a lê pelo /page", st == 200 and [i["id"] for i in pag.get("items", [])] == [exp["id"]], f"{st} {pag}")
    j1.expect_reject("em nome de outro jogador -> ROW_SCOPE_DENIED", "POST", "sim_exportacaos",
                     {**corpo, "solicitadaPor": j2.me["username"]}, why="ROW_SCOPE_DENIED")

    print("isolamento e permissões")
    st, pag2 = j2.call("GET", f"concepts/SimExportacao/page?partidaId={partida['id']}&limit=100")
    check("outro jogador não a vê", st == 200 and pag2.get("items") == [], f"{st} {pag2}")
    st, _ = j1.call("PUT", f"sim_exportacaos/{exp['id']}", {**corpo, "situacao": "Concluida"})
    check("o jogador não edita (PUT -> 403)", st == 403, st)
    st, _ = j1.call("DELETE", f"sim_exportacaos/{exp['id']}")
    check("o jogador não apaga (DELETE -> 403)", st == 403, st)

    print("a ponte (admin) muda a situação, inclusive para tentar de novo")
    for situacao, extra in [("EmAndamento", {"iniciadaEm": AGORA, "passo": "garantir armazem", "progressoCentesimos": 100}),
                            ("Falhou", {"mensagem": "alvo fora do ar"}),
                            ("EmAndamento", {"mensagem": None, "progressoCentesimos": 0}),
                            ("Concluida", {"concluidaEm": AGORA, "progressoCentesimos": 10000, "armazemAlvoId": "abc",
                                           "totalChamadas": 155})]:
        st, res = adm.call("PUT", f"sim_exportacaos/{exp['id']}", {"situacao": situacao, **extra})
        check(f"admin -> {situacao}", st == 200 and res.get("situacao") == situacao, f"{st} {res}")
    st, res = j1.call("GET", f"sim_exportacaos/{exp['id']}")
    check("o jogador vê o resultado (armazemAlvoId, totalChamadas)", st == 200 and res.get("armazemAlvoId") == "abc"
          and res.get("totalChamadas") == 155, f"{st} {res}")
    adm.expect_reject("progressoCentesimos > 10000 -> recusado", "PUT", f"sim_exportacaos/{exp['id']}",
                      {"progressoCentesimos": 10001})


if __name__ == "__main__":
    Api.from_argv().run(run)
