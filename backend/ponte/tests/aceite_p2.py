#!/usr/bin/env python3
"""Aceite da P2 (AO VIVO): o cenário importado do corporativo é jogável e o servidor do jogo aceita uma partida dele.

  1. importa (ou reaproveita) um armazém da ORIGEM como cenário no jogo (`ponte.py importar`);
  2. confere o cenário no jogo (procedência, referências qtdOrdens/distanciaTeoricaCm) e que ele aparece em CenariosAtivos
     para um jogador (não para o admin: a query é a mesma, a role é que muda);
  3. monta o pacote do jogo como a ponte faz (fonte.pacote_do_jogo), roda o motor SEM navegador (jogar_headless.ts,
     AbcProximidade), cria a SimPartida como jogador de teste e chama ConcluirPartida -> validadoServidor == true;
  4. limpa a partida e o score; com --limpar, também a importação (diário -> `ponte.py limpar`).

Uso: python3 backend/ponte/tests/aceite_p2.py [--origem http://localhost:8100] [--armazem <uuid>] [--jogo http://localhost:8200] [--limpar]
Sem --armazem: o primeiro armazém da origem cujo nome NÃO começa com "WH-" nem contém "partida" (os espelhos criados pela ponte).
Credenciais: PONTE_ORIGEM_*, PONTE_JOGO_* (padrão admin / Teste123!); jogador de teste: teste-jogador-2 / Jogo!Teste2026.
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
PONTE = os.path.dirname(HERE)
RAIZ = os.path.dirname(os.path.dirname(PONTE))
sys.path.insert(0, PONTE)
sys.path.insert(0, os.path.join(RAIZ, "backend", "npdev", "tests"))

import fonte  # noqa: E402
from npdev import Cliente  # noqa: E402
from npdev_api import Api  # noqa: E402


def rodar(cmd, **kw):
    res = subprocess.run(cmd, cwd=RAIZ, capture_output=True, text=True, **kw)
    if res.returncode != 0:
        raise SystemExit(f"{' '.join(cmd)} saiu com {res.returncode}\n{res.stdout[-1500:]}\n{res.stderr[-1500:]}")
    return json.loads([l for l in res.stdout.strip().splitlines() if l.strip()][-1])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--origem", default=os.environ.get("PONTE_ORIGEM_URL", "http://localhost:8100"))
    ap.add_argument("--armazem")
    ap.add_argument("--jogo", default=os.environ.get("PONTE_JOGO_URL", "http://localhost:8200"))
    ap.add_argument("--limpar", action="store_true")
    a = ap.parse_args()

    user_o, senha_o = os.environ.get("PONTE_ORIGEM_USUARIO", "admin"), os.environ.get("PONTE_ORIGEM_SENHA", "Teste123!")
    user_j, senha_j = os.environ.get("PONTE_JOGO_USUARIO", "admin"), os.environ.get("PONTE_JOGO_SENHA", "Teste123!")
    origem = Cliente(a.origem, user_o, senha_o)
    adm = Api(a.jogo, user_j, senha_j)
    c = adm.check

    armazem = a.armazem
    if not armazem:
        escolhidos = [x for x in origem.pagina("Armazem") if not x["nome"].startswith("WH-") and "partida" not in x["nome"]]
        if not escolhidos:
            raise SystemExit("a origem não tem um armazém para importar (rode o seed warehouse-a-small, PLANO §9)")
        armazem = escolhidos[0]["id"]

    print("importar")
    res = rodar([sys.executable, os.path.join(PONTE, "ponte.py"), "importar", "--origem", a.origem, "--armazem", armazem, "--jogo", a.jogo])
    cen = adm.call("GET", f"sim_cenarios/{res['cenarioId']}")[1]
    try:
        c("cenário no jogo com procedência Corporativo e a URL/armazém de origem",
          cen["procedencia"] == "Corporativo" and cen["procedenciaUrl"] == a.origem.rstrip("/") and cen["procedenciaArmazemId"] == armazem, cen)
        c("referências gravadas: qtdOrdens = nº de ordens e distanciaTeoricaCm > 0",
          cen["qtdOrdens"] == res["ordens"] and cen["distanciaTeoricaCm"] == res["distanciaTeoricaCm"] > 0, cen)
        ordens = adm.call("GET", f"concepts/SimOrdem/page?cenarioId={cen['id']}&limit=1")[1]["total"]
        c("as ordens estão gravadas", ordens == res["ordens"], ordens)

        print("jogador")
        jog = Api(a.jogo, "teste-jogador-2", "Jogo!Teste2026")
        ativos = {r["codigo"]: r for r in jog.call("GET", "queries/CenariosAtivos")[1]["rows"]}
        c("aparece em CenariosAtivos para o jogador, com procedencia", cen["codigo"] in ativos
          and ativos[cen["codigo"]].get("procedencia") == "Corporativo", list(ativos))

        print("partida")
        pacote = fonte.pacote_do_jogo(Cliente(a.jogo, user_j, senha_j), cen["id"])
        with tempfile.TemporaryDirectory() as pasta:
            arq = os.path.join(pasta, "pacote.json")
            json.dump(pacote, open(arq, "w", encoding="utf-8"))
            jogada = rodar(["npx", "vite-node", "backend/ponte/jogar_headless.ts", arq, "AbcProximidade"])
        st, partida = jog.call("POST", "sim_partidas", {"cenarioId": cen["id"], "politica": "AbcProximidade", "versaoMotor": "0.3.0",
                                                        "iniciadaEm": "2026-11-10T08:00:00Z", "jogador": jog.me["username"]})
        c("jogador cria a partida do cenário importado", st in (200, 201), (st, partida))
        adm.track("sim_partidas", partida["id"])
        st, out = jog.flow("ConcluirPartida", {"partidaId": partida["id"], **jogada["metricas"], "scoreCentesimos": jogada["scoreCentesimos"]})
        dados = (out.get("output") or {}).get("data") or {}
        c("ConcluirPartida: validadoServidor == true (o servidor recalculou o mesmo score)",
          st == 200 and dados.get("validadoServidor") is True and dados.get("scoreCentesimos") == jogada["scoreCentesimos"], (st, out))
        if dados.get("id"):
            adm.track("sim_scores", dados["id"])
    finally:
        adm.cleanup()
        if a.limpar:
            print("limpar a importação")
            rodar([sys.executable, os.path.join(PONTE, "ponte.py"), "limpar", "--diario", res["diario"], "--alvo", a.jogo])
            c("cenário importado apagado", adm.call("GET", f"sim_cenarios/{res['cenarioId']}")[0] == 404)

    print(f"\n{'FALHOU' if adm.failures else 'OK'}: {len(adm.failures)} falha(s)")
    sys.exit(1 if adm.failures else 0)


if __name__ == "__main__":
    main()
