#!/usr/bin/env python3
"""F3 — paridade TS × Java de sugerirDestino / sugerirOrigem (app de pé na 8200).

Roda as fixtures compartilhadas (tests/fixtures/alocacao-casos.json) contra os flows SugerirDestinoJogo e
SugerirOrigem — a AllocationCapability em Java — e exige a mesma saída que a porta TS (src/sim/wmsReal.ts, vitest)
já confere contra o mesmo arquivo. Casos `somenteDireto` dependem de CrossDocking no banco e ficam só no TS.

Uso: python3 backend/npdev/tests/f3_paridade_alocacao.py [--base ...] [--user ...] [--password ...]
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from npdev_api import Api  # noqa: E402

CASOS = json.load(open(os.path.join(HERE, "fixtures", "alocacao-casos.json")))


def output(res):
    return res.get("output") if isinstance(res, dict) else None


def aquecer(api):
    # A primeira chamada depois de um rebuild sobe o processo do plugin e pode falhar com 422 system_exception.
    for _ in range(3):
        st, _res = api.flow("SugerirDestinoJogo", {"loteId": "L0", "candidatos": [{"localArmazenagemId": "A"}]})
        if st == 200:
            return


def run(api):
    aquecer(api)
    for flow, chave in (("SugerirDestinoJogo", "destino"), ("SugerirOrigem", "origem")):
        print(flow)
        for c in CASOS[chave]:
            if c.get("somenteDireto"):
                continue
            st, res = api.flow(flow, c["entrada"])
            out = output(res)
            api.check(c["nome"], st == 200 and out == c["esperado"], f"{st} esperado={c['esperado']} obtido={out or res}")


if __name__ == "__main__":
    Api.from_argv().run(run)
