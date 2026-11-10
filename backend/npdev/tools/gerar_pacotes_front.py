#!/usr/bin/env python3
"""Converte os seeds dos cenários (definition/seeds/cenario-*.json) no "pacote do cenário" que o front usa
offline (src/data/cenarios/<codigo>.json) — o mesmo formato que a F5 monta a partir do REST (N4, opção A):

  { cenario, armazem, areas[], ruas[], locais[], produtos[], ordens[], rankingRuas[] }

Os ids são os aliases do seed (estáveis); no backend eles são UUIDs. Rodar de novo gera arquivos idênticos.

Uso: python3 backend/npdev/tools/gerar_pacotes_front.py
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
SEEDS = os.path.join(HERE, "..", "definition", "seeds")
DESTINO = os.path.join(HERE, "..", "..", "..", "src", "data", "cenarios")


def resolver(valor, ctx):
    if isinstance(valor, str):
        if valor.startswith("$ref:"):
            return valor[5:]
        if valor.startswith("$") and valor[1:] in ctx:
            return ctx[valor[1:]]
    return valor


def expandir(seed):
    """Devolve [(concept, id, data)] com $ref resolvido para alias e repeatOver expandido."""
    saida = []
    contadores = {}
    for r in seed["records"]:
        variacoes = [{}]
        if "repeatOver" in r:
            variacoes = []
            vars_ = r["repeatOver"]["vars"]
            nomes = list(vars_)
            def combinar(i, atual):
                if i == len(nomes):
                    variacoes.append(dict(atual))
                    return
                lo, hi = vars_[nomes[i]]
                for v in range(lo, hi + 1):
                    atual[nomes[i]] = v
                    combinar(i + 1, atual)
            combinar(0, {})
        for ctx in variacoes:
            data = {k: resolver(v, ctx) for k, v in r["data"].items()}
            if "alias" in r:
                id_ = r["alias"]
            elif r["concept"] == "LocalArmazenagem":
                id_ = f"{data['ruaId']}-P{data['posicao']:02d}-A{data['andar']}"
            else:
                n = contadores.get(r["concept"], 0) + 1
                contadores[r["concept"]] = n
                id_ = f"{r['concept']}-{n}"
            saida.append((r["concept"], id_, data))
    return saida


def pacote(seed):
    regs = expandir(seed)
    def todos(concept, campos):
        return [{"id": i, **{c: d.get(c) for c in campos}} for (k, i, d) in regs if k == concept]
    cen = todos("SimCenario", ["codigo", "nome", "dificuldade", "armazemId", "seed", "qtdDocasInbound",
                               "qtdDocasOutbound", "qtdEquipamentos", "velocidadeEquipamentoCmS",
                               "tempoDescargaSeg", "inicioTurnoSeg", "fimTurnoSeg"])[0]
    armazem = todos("Armazem", ["nome"])[0]
    return {
        "cenario": cen,
        "armazem": armazem,
        "areas": todos("Area", ["armazemId", "nome", "funcao"]),
        "ruas": todos("Rua", ["areaId", "codigo", "qtdPosicoes", "qtdAndares"]),
        "locais": todos("LocalArmazenagem", ["ruaId", "posicao", "andar", "situacao"]),
        "produtos": todos("Produto", ["codigo", "nome", "qtdCaixasPorPallet"]),
        "ordens": todos("SimOrdem", ["numero", "tipo", "liberacaoSeg", "slaSeg", "produtoId", "quantidadePaletes"]),
        "rankingRuas": [{"ruaId": d["ruaId"], "prioridade": d["prioridade"]} for (k, _, d) in regs if k == "RankingRua"],
    }


def main():
    os.makedirs(DESTINO, exist_ok=True)
    for nome in sorted(os.listdir(SEEDS)):
        if not nome.startswith("cenario-"):
            continue
        p = pacote(json.load(open(os.path.join(SEEDS, nome))))
        caminho = os.path.join(DESTINO, f"{p['cenario']['codigo']}.json")
        with open(caminho, "w") as f:
            json.dump(p, f, ensure_ascii=False, separators=(",", ":"))
            f.write("\n")
        print(f"{os.path.normpath(caminho)}: {len(p['locais'])} locais, {len(p['ordens'])} ordens")


if __name__ == "__main__":
    main()
