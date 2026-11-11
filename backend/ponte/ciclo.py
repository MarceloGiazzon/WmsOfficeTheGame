#!/usr/bin/env python3
"""O ciclo completo, sem intervenção: criar no corporativo -> jogar -> o resultado volta como operação.

  1. importa um armazém do WmsOffice (origem) como cenário do jogo           (ponte.py importar)
  2. joga um turno inteiro como jogador de teste, SEM navegador e registra a partida, o score e o rastro no jogo
                                                                              (jogar_online.ts)
  3. exporta a partida para o WmsOffice: um armazém ESPELHO com os documentos (ponte.py exportar --partida)
  4. imprime os links para ver o efeito (Mapa do Armazém, Recebimentos, Expedições, Movimentos)

Uso (da raiz do repo; jogo e corporativo de pé):
  python3 backend/ponte/ciclo.py [--origem http://localhost:8100] [--armazem <uuid>] [--jogo http://localhost:8200]
                                 [--alvo http://localhost:8100] [--politica AbcProximidade]
Sem --armazem: o primeiro armazém da origem que não é espelho da ponte (nome sem "partida" e sem "WH-").
Credenciais: PONTE_ORIGEM_*, PONTE_ALVO_*, PONTE_JOGO_* (admin / Teste123!) e PONTE_JOGADOR_* (jogador de teste).
O que o ciclo cria FICA nos servidores (é o efeito a mostrar); `ponte.py limpar --diario <arquivo>` desfaz cada parte.
"""
import argparse
import json
import os
import subprocess
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(os.path.dirname(AQUI))
sys.path.insert(0, AQUI)

from npdev import Cliente  # noqa: E402


def passo(titulo):
    print(f"\n== {titulo}", file=sys.stderr, flush=True)


def rodar(cmd):
    res = subprocess.run(cmd, cwd=RAIZ, stdout=subprocess.PIPE, text=True, stderr=None)  # o progresso do filho vai ao stderr
    if res.returncode != 0:
        raise SystemExit(f"{' '.join(cmd)} saiu com {res.returncode}")
    return json.loads([l for l in res.stdout.strip().splitlines() if l.strip()][-1])


def main():
    ap = argparse.ArgumentParser(description="importa -> joga -> exporta, de ponta a ponta")
    ap.add_argument("--origem", default=os.environ.get("PONTE_ORIGEM_URL", "http://localhost:8100"))
    ap.add_argument("--armazem")
    ap.add_argument("--jogo", default=os.environ.get("PONTE_JOGO_URL", "http://localhost:8200"))
    ap.add_argument("--alvo", default=os.environ.get("PONTE_ALVO_URL", "http://localhost:8100"))
    ap.add_argument("--politica", default="AbcProximidade")
    a = ap.parse_args()
    py = sys.executable
    ponte = os.path.join(AQUI, "ponte.py")

    armazem = a.armazem
    if not armazem:
        origem = Cliente(a.origem, os.environ.get("PONTE_ORIGEM_USUARIO", "admin"), os.environ.get("PONTE_ORIGEM_SENHA", "Teste123!"))
        candidatos = [x for x in origem.pagina("Armazem") if "partida" not in x["nome"] and not x["nome"].startswith("WH-")]
        if not candidatos:
            raise SystemExit("a origem não tem um armazém para importar (rode o seed warehouse-a-small, docs/ponte/PLANO.md §9)")
        armazem = candidatos[0]["id"]

    passo("1/3 importar o armazém do corporativo como cenário do jogo")
    imp = rodar([py, ponte, "importar", "--origem", a.origem, "--armazem", armazem, "--jogo", a.jogo])

    passo("2/3 jogar o turno (sem navegador) e registrar partida, score e rastro no jogo")
    env_url = ["--url", a.jogo]
    jogada = rodar(["npx", "vite-node", os.path.join("backend", "ponte", "jogar_online.ts"), imp["codigo"], a.politica, *env_url])

    passo("3/3 exportar a partida para o corporativo")
    exp = rodar([py, ponte, "exportar", "--partida", jogada["partidaId"], "--jogo", a.jogo, "--alvo", a.alvo])

    alvo = a.alvo.rstrip("/")
    print(json.dumps({"cenario": imp["codigo"], "partidaId": jogada["partidaId"], "scoreCentesimos": jogada["scoreCentesimos"],
                      "armazemEspelhoId": exp.get("armazemAlvoId"), "diarioImportacao": imp["diario"], "diarioExportacao": exp["diario"],
                      "mapa": f"{alvo}/mapa-armazem.html"}, ensure_ascii=False))
    print(f"\nPronto. Veja o efeito em {alvo}/mapa-armazem.html (armazém espelho {exp.get('armazemAlvoId')}; nome "
          f"'<cenário> · partida <8 do id> · <data>') e nas telas de Recebimentos, Expedições e Movimentos.", file=sys.stderr)


if __name__ == "__main__":
    main()
