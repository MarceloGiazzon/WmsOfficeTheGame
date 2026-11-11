#!/usr/bin/env python3
"""Aceite da P0 (AO VIVO): exporta exemplos/mini com --ordens IN-0001,OUT-0001 e confere o ALVO contra
exemplos/mini/esperado.json ["p0"]; reexporta (não pode criar nada nem duplicar histórico); limpa e confere a limpeza.

Escrito ANTES do código (docs/ponte/PLANO.md, T0.9). Usa a interface de linha de comando definida no PLANO §6:
  ponte.py exportar ... imprime, na ÚLTIMA linha do stdout, um JSON com pelo menos
      {"diario": "<caminho .jsonl>", "armazemAlvoId": "<uuid>", "criados": <int>, "reusados": <int>, "chamadas": <int>}
  ponte.py limpar --diario <caminho> --alvo <url>  apaga, em ordem inversa, tudo o que o diário criou (exceto compartilhados).

Uso (app do alvo de pé):  python3 backend/ponte/tests/aceite_p0.py [--alvo http://localhost:8200] [--completo]
  --interromper N: (T1.8) antes de tudo, exporta com --parar-apos N e só então roda o roteiro normal, que RETOMA do diário;
  as mesmas asserções têm de passar (resultado idêntico ao de uma exportação sem interrupção).
  --completo: exporta TODAS as ordens e confere esperado.json ["completo"] (aceite da P1, T1.7).
Credenciais do alvo: PONTE_ALVO_USUARIO / PONTE_ALVO_SENHA (padrão admin / Teste123!).
"""
import argparse
import json
from datetime import datetime, timezone
import os
import subprocess
import sys
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
PONTE = os.path.dirname(HERE)
RAIZ = os.path.dirname(os.path.dirname(PONTE))
sys.path.insert(0, os.path.join(RAIZ, "backend", "npdev", "tests"))
from npdev_api import Api  # noqa: E402

MINI = os.path.join(PONTE, "exemplos", "mini")
ESPERADO = json.load(open(os.path.join(MINI, "esperado.json"), encoding="utf-8"))
COMPARTILHADOS = {"Entidade", "Produto"}


def rodar_ponte(*args, aceitar=(0,)):
    cmd = [sys.executable, os.path.join(PONTE, "ponte.py"), *args]
    res = subprocess.run(cmd, cwd=RAIZ, capture_output=True, text=True)
    if res.returncode not in aceitar:
        raise SystemExit(f"ponte.py {' '.join(args)} saiu com {res.returncode}\n--- stdout\n{res.stdout[-3000:]}\n--- stderr\n{res.stderr[-3000:]}")
    linhas = [l for l in res.stdout.strip().splitlines() if l.strip()]
    try:
        return json.loads(linhas[-1])
    except (IndexError, ValueError):
        raise SystemExit(f"a última linha do stdout de ponte.py não é JSON:\n{res.stdout[-2000:]}")


def instante(texto):
    """'2026-11-10T08:10:20-03:00' e '2026-11-10T11:10:20Z' são o MESMO instante: o /page devolve datetime no fuso do
    servidor e o GET por id devolve em UTC. Compare instantes, nunca o texto."""
    if not texto:
        return None
    return datetime.fromisoformat(texto.replace("Z", "+00:00")).astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def ler_diario(caminho):
    """chave -> {conceito, id, compartilhado}; ignora a linha de cabeçalho ({"tipo": "cabecalho", ...})."""
    por_chave = {}
    with open(caminho, encoding="utf-8") as f:
        for linha in f:
            if not linha.strip():
                continue
            r = json.loads(linha)
            if r.get("tipo") == "cabecalho":
                continue
            por_chave[r["chave"]] = r
    return por_chave


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--alvo", default=os.environ.get("PONTE_ALVO_URL", "http://localhost:8200"))
    ap.add_argument("--completo", action="store_true")
    ap.add_argument("--interromper", type=int, metavar="N",
                    help="T1.8: antes do roteiro, exporta com --parar-apos N (tem de sair com 3) e deixa a exportação normal retomar")
    a = ap.parse_args()
    caso = "completo" if a.completo else "p0"
    esp = ESPERADO[caso]

    api = Api(a.alvo, os.environ.get("PONTE_ALVO_USUARIO", "admin"), os.environ.get("PONTE_ALVO_SENHA", "Teste123!"))
    c = api.check
    endpoints = json.load(open(os.path.join(PONTE, "mapa.json"), encoding="utf-8"))["conceitos"]

    def get(conceito, id_):
        return api.call("GET", f"{endpoints[conceito]['endpoint']}/{id_}")

    def pagina(conceito, **filtros):
        q = urllib.parse.urlencode({**filtros, "limit": 1000})  # SEMPRE codificar: valores com espaço quebram a URL
        st, res = api.call("GET", f"concepts/{conceito}/page?{q}")
        assert st == 200, (conceito, st, res)
        return res["items"]

    args = ["exportar", "--pacote", os.path.join(MINI, "pacote.json"), "--rastro", os.path.join(MINI, "rastro.json"),
            "--data", "2026-11-10", "--alvo", a.alvo]
    if not a.completo:
        args += ["--ordens", ",".join(esp["ordens"])]

    if a.interromper:
        print(f"exportar interrompendo após {a.interromper} operações")
        parcial = rodar_ponte(*args, "--parar-apos", str(a.interromper), aceitar=(3,))
        c("a interrupção devolveu parado=true e o diário", parcial.get("parado") is True and "diario" in parcial, parcial)
    print(f"exportar ({caso})" + (" — retomando" if a.interromper else ""))
    resumo = rodar_ponte(*args)
    c("resumo tem diario, armazemAlvoId, criados, reusados, chamadas",
      {"diario", "armazemAlvoId", "criados", "reusados", "chamadas"} <= set(resumo), resumo)
    diario = ler_diario(resumo["diario"])
    ids = {k: v["id"] for k, v in diario.items()}
    try:
        print("contagens no diário")
        criados, compart = {}, {}
        for r in diario.values():
            alvo = compart if r.get("compartilhado") else criados
            alvo[r["conceito"]] = alvo.get(r["conceito"], 0) + 1
        c("criados por conceito = esperado", criados == esp["criados"], {"plano": criados, "esperado": esp["criados"]})
        c("compartilhados por conceito = esperado", compart == esp["compartilhados"], compart)
        c("armazemAlvoId = id da chave 'armazem'", resumo["armazemAlvoId"] == ids.get("armazem"), resumo)

        print("estados no alvo")
        for chave, estado in esp["estados"].items():
            conceito = diario[chave]["conceito"]
            st, reg = get(conceito, ids[chave])
            campo = "situacao" if conceito in ("Movimento", "CrossDocking") else "estagio"
            c(f"{chave} = {estado}", st == 200 and reg.get(campo) == estado, (st, reg))

        print("ocupação e situação dos locais")
        for o in esp["ocupacao"]:
            linhas = pagina("LocalArmazenagemLote", localArmazenagemId=ids["local:" + o["local"]], loteId=ids[o["lote"]])
            c(f"ocupação {o['local']} / {o['lote']} = {o['quantidade']}",
              len(linhas) == 1 and linhas[0]["quantidade"] == o["quantidade"], linhas)
        for chave in [k for k in diario if k.startswith("local:")]:
            st, reg = get("LocalArmazenagem", ids[chave])
            deveria = "Ocupado" if chave[len("local:"):] in esp["locaisOcupados"] else "Disponivel"
            c(f"{chave} {deveria}", st == 200 and reg["situacao"] == deveria, reg.get("situacao"))

        print("histórico (hora do jogo)")
        total = 0
        for mov, linhas_esp in esp["historico"].items():
            linhas = pagina("HistoricoMovimentacao", movimentoId=ids[mov])
            total += len(linhas)
            obtido = sorted((h["evento"], instante(h["ocorridoEm"])) for h in linhas)
            c(f"{mov}: {len(linhas_esp)} linha(s) com ocorridoEm do jogo", obtido == sorted(map(tuple, linhas_esp)), obtido)
            c(f"{mov}: descricao começa com 'WmsOffice: The Game'",
              all((h["descricao"] or "").startswith("WmsOffice: The Game") for h in linhas), [h["descricao"] for h in linhas])
        c(f"total de linhas de histórico = {esp['totalHistorico']}", total == esp["totalHistorico"], total)

        print("reexportar (idempotência)")
        de_novo = rodar_ponte(*args)
        c("segunda exportação não cria nada", de_novo["criados"] == 0, de_novo)
        c("mesmo diário e mesmo armazém", de_novo["diario"] == resumo["diario"] and de_novo["armazemAlvoId"] == resumo["armazemAlvoId"], de_novo)
        total2 = sum(len(pagina("HistoricoMovimentacao", movimentoId=ids[m])) for m in esp["historico"])
        c("histórico não duplicou", total2 == esp["totalHistorico"], total2)
    finally:
        print("limpar")
        rodar_ponte("limpar", "--diario", resumo["diario"], "--alvo", a.alvo)
        sobrou = [(k, v["conceito"]) for k, v in diario.items()
                  if not v.get("compartilhado") and get(v["conceito"], v["id"])[0] != 404]
        c("limpar apagou tudo o que a exportação criou", not sobrou, sobrou[:10])
        mantidos = [k for k, v in diario.items() if v.get("compartilhado") and get(v["conceito"], v["id"])[0] == 200]
        c("limpar manteve os compartilhados (Entidade de escopo, Produtos)",
          len(mantidos) == sum(1 for v in diario.values() if v.get("compartilhado")), mantidos)
        # Arrumação do teste (não é regra da ponte): os produtos MINI-* só existem por causa da fixture; a Entidade de
        # escopo só sai se nada mais a usa (com outra exportação no banco o DELETE dá 4xx e ela fica — está certo).
        for k, v in diario.items():
            if v.get("compartilhado") and (k.startswith("produto:MINI-") or k == "entidade:escopo"):
                api.call("DELETE", f"{endpoints[v['conceito']]['endpoint']}/{v['id']}")

    print(f"\n{'FALHOU' if api.failures else 'OK'}: {len(api.failures)} falha(s)")
    sys.exit(1 if api.failures else 0)


if __name__ == "__main__":
    main()
