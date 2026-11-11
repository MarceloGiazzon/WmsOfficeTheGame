#!/usr/bin/env python3
"""P1 (ponte Jogo ↔ WmsOffice) — verificação ao vivo do concept SimEvento (rastro da partida). App de pé na 8200.

  - o jogador cria eventos da PRÓPRIA partida e os lê pelo /page (por partidaId, em ordem de seq);
  - não cria evento em nome de outro jogador (ROW_SCOPE_DENIED);
  - outro jogador não vê esses eventos (nem na listagem nem por id);
  - o jogador não edita nem apaga evento (só read/create); o admin apaga (limpeza);
  - seq negativo é recusado (invariante);
  - apagar a partida leva os eventos junto (cascade).

Usa os jogadores de teste do n3_jogador.py (criados se faltarem). Limpa tudo o que cria.
Uso: python3 backend/npdev/tests/p1_sim_evento.py [--base ...] [--user admin] [--password ...]
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from npdev_api import Api  # noqa: E402

SENHA_JOGADOR = "Jogo!Teste2026"
JOGADORES = ["teste-jogador-1", "teste-jogador-2"]


# ATENÇÃO: o campo `tSeg` do concept é `tseg` na ESCRITA (POST/PUT e a resposta deles: o Jackson baixa a 1ª letra maiúscula
# de getTSeg; mandar `tSeg` dá 422 "required field tSeg is missing") mas `tSeg` no /page. Renomear o campo no model.json não
# serve: a migração recusa (DROP COLUMN, 2026-11-10). O cliente escreve `tseg` e lê `tSeg ?? tseg`.
def evento(partida_id, jogador, seq, tipo="EstoqueInicial", **extra):
    base = {"partidaId": partida_id, "jogador": jogador, "seq": seq, "tipo": tipo, "tseg": 20000 + seq}
    return {**base, **extra}


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
    ent = adm.create("entidades", {"nome": "P1 Teste", "tipo": "Estabelecimento"})
    arm = adm.create("armazems", {"entidadeId": ent["id"], "nome": "P1 Armazem"})
    area = adm.create("areas", {"armazemId": arm["id"], "nome": "P1 Area", "funcao": "Armazenagem"})
    rua = adm.create("ruas", {"areaId": area["id"], "codigo": "P1R1", "qtdPosicoes": 2, "qtdAndares": 1})
    loc = adm.create("local_armazenagems", {"ruaId": rua["id"], "posicao": 1, "andar": 1, "situacao": "Disponivel"})
    prod = adm.create("produtos", {"nome": "P1 Produto", "qtdCaixasPorPallet": 10})
    cen = adm.create("sim_cenarios", {"codigo": "P1-EVT", "nome": "P1 eventos", "armazemId": arm["id"], "seed": 7})
    ordem = adm.create("sim_ordems", {"cenarioId": cen["id"], "numero": "IN-0001", "tipo": "Inbound",
                                      "liberacaoSeg": 30000, "slaSeg": 1800, "produtoId": prod["id"]})
    base_partida = {"cenarioId": cen["id"], "politica": "AbcProximidade", "versaoMotor": "0.3.0",
                    "iniciadaEm": "2026-11-10T08:00:00Z"}
    st, partida = j1.call("POST", "sim_partidas", {**base_partida, "jogador": j1.me["username"]})
    assert st in (200, 201), (st, partida)
    adm.track("sim_partidas", partida["id"])

    print("o jogador grava o rastro da própria partida")
    criados = []
    for seq, (tipo, extra) in enumerate([
        ("EstoqueInicial", {"produtoId": prod["id"], "localId": loc["id"]}),
        ("Putaway", {"ordemId": ordem["id"], "produtoId": prod["id"], "localId": loc["id"]}),
        ("OrdemConcluida", {"ordemId": ordem["id"]}),
    ]):
        st, res = j1.call("POST", "sim_eventos", evento(partida["id"], j1.me["username"], seq, tipo, **extra))
        check(f"POST evento {seq} ({tipo})", st in (200, 201) and res.get("seq") == seq, f"{st} {res}")
        if st in (200, 201):
            criados.append(res)
            adm.track("sim_eventos", res["id"])

    st, pag = j1.call("GET", f"concepts/SimEvento/page?partidaId={partida['id']}&sort=seq&direction=asc&limit=1000")
    items = pag.get("items", []) if st == 200 else []
    check("o /page por partidaId devolve os 3, em ordem de seq", [i["seq"] for i in items] == [0, 1, 2]
          and pag.get("total") == 3, f"{st} {pag}")
    check("  os campos do evento voltam (tipo, tSeg, referências nulas continuam nulas)",
          items and items[0]["tipo"] == "EstoqueInicial" and items[0]["tSeg"] == 20000
          and items[0].get("ordemId") is None and items[2].get("localId") is None, items)

    print("isolamento entre jogadores")
    st, res = j1.call("POST", "sim_eventos", evento(partida["id"], j2.me["username"], 9))
    if st in (200, 201):
        adm.track("sim_eventos", res["id"])
    check("jogador não cria evento em nome de outro", st == 403 and "ROW_SCOPE_DENIED" in str(res), f"{st} {res}")
    st, pag2 = j2.call("GET", f"concepts/SimEvento/page?partidaId={partida['id']}&limit=1000")
    check("outro jogador não vê os eventos (lista vazia)", st == 200 and pag2.get("items") == [], f"{st} {pag2}")
    if criados:
        st, _ = j2.call("GET", f"sim_eventos/{criados[0]['id']}")
        check("  nem por id (404)", st == 404, st)
    st, res = j2.call("POST", "sim_eventos", evento(partida["id"], j2.me["username"], 50))
    if st in (200, 201):
        adm.track("sim_eventos", res["id"])
        st, pag = j1.call("GET", f"concepts/SimEvento/page?partidaId={partida['id']}&limit=1000")
        check("evento do outro jogador na MESMA partida não aparece para o dono (a ponte ignora jogador ≠ dono mesmo assim)",
              all(i["jogador"] == j1.me["username"] for i in pag.get("items", [])), pag)

    print("o que o jogador não pode")
    if criados:
        st, _ = j1.call("PUT", f"sim_eventos/{criados[0]['id']}", evento(partida["id"], j1.me["username"], 0, tseg=1))
        check("PUT no próprio evento -> 403", st == 403, st)
        st, _ = j1.call("DELETE", f"sim_eventos/{criados[0]['id']}")
        check("DELETE do próprio evento -> 403", st == 403, st)
    j1.expect_reject("seq negativo -> recusado", "POST", "sim_eventos", evento(partida["id"], j1.me["username"], -1))

    print("limpeza")
    for e in reversed(criados):
        st, _ = adm.call("DELETE", f"sim_eventos/{e['id']}")
        check("admin apaga evento", st == 204, st)
    adm.created = [(ep, i) for ep, i in adm.created if ep != "sim_eventos" or i not in {c["id"] for c in criados}]


if __name__ == "__main__":
    Api.from_argv().run(run)
