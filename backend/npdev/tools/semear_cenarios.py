#!/usr/bin/env python3
"""Semeia os cenários do jogo no backend (app de pé), sem duplicar.

Os seeds do NPDev não são transacionais nem idempotentes: rodar um seed de novo recria a topologia e só
falha no SimCenario (codigo unique), deixando registros órfãos. Este script só executa o seed de um
cenário cujo codigo ainda não existe.

Uso: python3 backend/npdev/tools/semear_cenarios.py [--base ...] [--user admin] [--password ...]
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "tests"))
from npdev_api import Api  # noqa: E402

SEEDS = os.path.join(HERE, "..", "definition", "seeds")


def main():
    api = Api.from_argv()
    _, existentes = api.call("GET", "sim_cenarios")
    codigos = {c["codigo"] for c in existentes}
    falhou = False
    for nome in sorted(os.listdir(SEEDS)):
        if not nome.startswith("cenario-"):
            continue
        seed = json.load(open(os.path.join(SEEDS, nome)))
        codigo = next(r["data"]["codigo"] for r in seed["records"] if r["concept"] == "SimCenario")
        if codigo in codigos:
            print(f"{codigo}: já existe — pulado")
            continue
        st, res = api.call("POST", f"admin/seeds/{seed['id']}/run")
        ok = st == 200 and res.get("ok")
        falhou |= not ok
        print(f"{codigo}: {'semeado' if ok else 'FALHOU'} {res.get('createdCounts') if ok else res}")
    sys.exit(1 if falhou else 0)


if __name__ == "__main__":
    main()
