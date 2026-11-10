#!/usr/bin/env python3
"""Semeia os cenários do jogo no backend (app de pé), sem duplicar.

Os seeds do NPDev não são transacionais nem idempotentes: rodar um seed de novo recria a topologia e só
falha no SimCenario (codigo unique), deixando registros órfãos. Este script só executa o seed de um
cenário cujo codigo ainda não existe.

Cenário que já existe não é recriado, mas ganha os valores de referência do seed (SimCenario.qtdOrdens e
distanciaTeoricaCm: o ConcluirPartida recusa partidas de cenário sem eles) quando estão ausentes ou diferentes.

Uso: python3 backend/npdev/tools/semear_cenarios.py [--base ...] [--user admin] [--password ...]
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "tests"))
from npdev_api import Api  # noqa: E402

SEEDS = os.path.join(HERE, "..", "definition", "seeds")


REFERENCIAS = ("qtdOrdens", "distanciaTeoricaCm")


def atualizar_referencias(api, existente, dados_seed, campos):
    """Cenário já semeado: grava qtdOrdens/distanciaTeoricaCm do seed se faltarem ou diferirem. True = ok."""
    codigo = existente["codigo"]
    novos = {k: dados_seed[k] for k in REFERENCIAS if k in dados_seed and existente.get(k) != dados_seed[k]}
    if not novos:
        print(f"{codigo}: já existe, referências em dia — pulado")
        return True
    corpo = {k: existente[k] for k in campos if k in existente and existente[k] is not None}
    corpo.update(novos)
    st, res = api.call("PUT", f"sim_cenarios/{existente['id']}", corpo)
    ok = st == 200
    print(f"{codigo}: já existe — referências {'atualizadas' if ok else 'FALHARAM'} {novos if ok else (st, res)}")
    return ok


def main():
    api = Api.from_argv()
    _, existentes = api.call("GET", "sim_cenarios")
    por_codigo = {c["codigo"]: c for c in existentes}
    campos = [f["name"] for f in json.load(open(os.path.join(HERE, "..", "definition", "concepts", "SimCenario.json")))["fields"]
              if f["name"] != "id"]
    falhou = False
    for nome in sorted(os.listdir(SEEDS)):
        if not nome.startswith("cenario-"):
            continue
        seed = json.load(open(os.path.join(SEEDS, nome)))
        dados = next(r["data"] for r in seed["records"] if r["concept"] == "SimCenario")
        codigo = dados["codigo"]
        if codigo in por_codigo:
            falhou |= not atualizar_referencias(api, por_codigo[codigo], dados, campos)
            continue
        st, res = api.call("POST", f"admin/seeds/{seed['id']}/run")
        ok = st == 200 and res.get("ok")
        falhou |= not ok
        print(f"{codigo}: {'semeado' if ok else 'FALHOU'} {res.get('createdCounts') if ok else res}")
    sys.exit(1 if falhou else 0)


if __name__ == "__main__":
    main()
