#!/usr/bin/env python3
"""Ponte Jogo <-> WmsOffice corporativo. Só biblioteca padrão. Uso e regras: docs/ponte/PLANO.md §6.

  ponte.py exportar --pacote P.json --rastro R.json --data AAAA-MM-DD [--ordens IN-0001,OUT-0001] [--alvo URL] [--parar-apos N] [--sem-crossdocking]
  ponte.py exportar --partida UUID [--jogo URL] [--alvo URL] [--forcar] [--parar-apos N]   (partida real, registra em SimExportacao)
  ponte.py limpar   --diario ARQUIVO.jsonl [--alvo URL]
  ponte.py armazens [--origem URL]                 lista os armazéns do corporativo (o id que o importar pede)
  ponte.py importar --origem URL --armazem UUID [--simular] [--max-docas N] [--max-produtos N] [--qtd-ordens N] [--seed N]
  ponte.py vigiar [--intervalo 5] [--uma-vez]      executa os pedidos feitos pelo botão do jogo
  ponte.py propor-ranking (--cenario CODIGO | --partida UUID) [--simular] [--alvo URL --armazem UUID]
                                                   o jogo propõe ao corporativo a ordem de ruas da melhor partida
  ponte.py ao-vivo --partida UUID [--alvo URL] [--velocidade N]   exporta reproduzindo o turno no tempo do jogo

Progresso no stderr; a ÚLTIMA linha do stdout é um JSON de resumo.
Saída: 0 ok · 1 erro · 2 uso errado · 3 interrompido por --parar-apos.
"""
import argparse
import json
import os
import re
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)

import executor  # noqa: E402
import exportar_partida  # noqa: E402
import fonte as fonte_mod  # noqa: E402
import mapa as mapa_mod  # noqa: E402
import planejador  # noqa: E402
from diario import Diario  # noqa: E402
from npdev import Cliente, ErroPonte  # noqa: E402



def _log(*a):
    print(*a, file=sys.stderr, flush=True)


def _alvo(args):
    url = args.alvo or os.environ.get("PONTE_ALVO_URL", "http://localhost:8200")
    return url.rstrip("/")


def _cliente_alvo(url):
    return Cliente(url, os.environ.get("PONTE_ALVO_USUARIO", "admin"), os.environ.get("PONTE_ALVO_SENHA", "Teste123!"))


caminho_diario = exportar_partida.caminho_diario


def exportar(args):
    if bool(args.pacote) != bool(args.rastro) or bool(args.pacote) == bool(args.partida):
        _log("uso: exportar aceita --pacote e --rastro juntos, OU --partida; nunca os dois")
        return 2
    if args.partida:
        codigo, resumo = exportar_partida.exportar_partida(
            exportar_partida.cliente_do_jogo(args.jogo), args.partida, _alvo(args), args.forcar, args.parar_apos,
            args.ordens.split(",") if args.ordens else None, not args.sem_crossdocking)
        print(json.dumps(resumo, ensure_ascii=False))
        return codigo
    if not args.data:
        _log("uso: exportar --pacote/--rastro exige --data AAAA-MM-DD")
        return 2
    alvo = _alvo(args)
    mapa = mapa_mod.carregar()
    f = fonte_mod.carregar_arquivos(args.pacote, args.rastro)
    ordens = set(args.ordens.split(",")) if args.ordens else None
    plano = planejador.planejar(f, mapa, planejador.Opcoes(data=args.data, ordens=ordens, crossdocking=not args.sem_crossdocking))
    _log(f"plano: {len(plano.operacoes)} operações → {alvo}")

    cliente = _cliente_alvo(alvo)
    diario = Diario(caminho_diario(alvo, f.rastro["partidaId"]), alvo, f.rastro["partidaId"])
    res = executor.Executor(cliente, mapa, diario, executor.progresso_stderr()).executar(plano, args.parar_apos)
    saida = {"diario": diario.caminho, "armazemAlvoId": diario.id("armazem") if diario.tem("armazem") else None, **res}
    print(json.dumps(saida, ensure_ascii=False))
    return 3 if res.get("parado") else 0


def limpar(args):
    if not os.path.exists(args.diario):
        _log(f"diário não encontrado: {args.diario}")
        return 2
    diario = Diario(args.diario)
    alvo = (args.alvo or diario.cabecalho.get("alvo") or os.environ.get("PONTE_ALVO_URL", "http://localhost:8200")).rstrip("/")
    res = executor.limpar(_cliente_alvo(alvo), mapa_mod.carregar(), diario, _log)
    print(json.dumps(res))
    return 0


UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


def armazens(args):
    """Lista os armazéns de um WmsOffice: o id é o que `importar --armazem` e `propor-ranking --armazem` pedem."""
    origem_url = (args.origem or os.environ.get("PONTE_ORIGEM_URL", "http://localhost:8100")).rstrip("/")
    origem = Cliente(origem_url, os.environ.get("PONTE_ORIGEM_USUARIO", "admin"), os.environ.get("PONTE_ORIGEM_SENHA", "Teste123!"))
    linhas = sorted(origem.pagina("Armazem"), key=lambda a: a["nome"])
    for a in linhas:
        espelho = "  (espelho de uma partida, criado pela ponte)" if " · partida " in a["nome"] else ""
        print(f"{a['id']}  {a['nome']}{espelho}")
    _log(f"{len(linhas)} armazém(ns) em {origem_url}")
    return 0


def importar(args):
    import importador  # só aqui: puxa subprocess/tempfile e o planejador
    if not UUID.match(args.armazem):
        _log(f"erro: --armazem tem de ser o id (uuid) de um armazém, não {args.armazem!r}; veja `ponte.py armazens --origem {args.origem}`")
        return 2
    origem_url = args.origem.rstrip("/")
    origem = Cliente(origem_url, os.environ.get("PONTE_ORIGEM_USUARIO", "admin"), os.environ.get("PONTE_ORIGEM_SENHA", "Teste123!"))
    jogo = exportar_partida.cliente_do_jogo(args.jogo)
    res = importador.importar(jogo, origem, origem_url, args.armazem, mapa_mod.carregar(), args.max_docas, args.max_produtos,
                              args.codigo, args.qtd_ordens, args.seed, args.simular)
    print(json.dumps(res, ensure_ascii=False))
    return 0


def ao_vivo(args):
    codigo, resumo = exportar_partida.exportar_partida(
        exportar_partida.cliente_do_jogo(args.jogo), args.partida, _alvo(args), args.forcar, None, None,
        not args.sem_crossdocking, args.velocidade)
    print(json.dumps(resumo, ensure_ascii=False))
    return codigo


def propor_ranking(args):
    import propor  # só aqui
    jogo = exportar_partida.cliente_do_jogo(args.jogo)
    res = propor.propor(jogo, args.partida, args.cenario, args.alvo, args.armazem, args.simular)
    print(json.dumps(res, ensure_ascii=False))
    return 0


def vigiar(args):
    import vigia
    print(json.dumps(vigia.vigiar(args.jogo, args.intervalo, args.uma_vez)))
    return 0


def montar_parser():
    p = argparse.ArgumentParser(prog="ponte.py", description="Ponte Jogo <-> WmsOffice corporativo")
    sub = p.add_subparsers(dest="comando", required=True)

    e = sub.add_parser("exportar", help="partida do jogo -> documentos do WmsOffice")
    e.add_argument("--pacote")
    e.add_argument("--rastro")
    e.add_argument("--partida", help="id de uma SimPartida no servidor do jogo")
    e.add_argument("--data", help="AAAA-MM-DD, o dia dos documentos")
    e.add_argument("--ordens", help="números das ordens a exportar, separados por vírgula (padrão: todas)")
    e.add_argument("--alvo", help="URL do WmsOffice de destino (padrão: PONTE_ALVO_URL ou http://localhost:8200)")
    e.add_argument("--jogo", help="URL do servidor do jogo (com --partida)")
    e.add_argument("--forcar", action="store_true")
    e.add_argument("--sem-crossdocking", action="store_true", help="não cria a linha de CrossDocking dos pares cross-dock (só os documentos)")
    e.add_argument("--parar-apos", type=int, metavar="N", help="interrompe depois da N-ésima operação (teste de retomada)")
    e.set_defaults(func=exportar)

    l = sub.add_parser("limpar", help="apaga o que uma exportação criou (ordem inversa do diário)")
    l.add_argument("--diario", required=True)
    l.add_argument("--alvo")
    l.set_defaults(func=limpar)

    ar = sub.add_parser("armazens", help="lista os armazéns do corporativo e seus ids")
    ar.add_argument("--origem", help="URL do WmsOffice (padrão: PONTE_ORIGEM_URL ou http://localhost:8100)")
    ar.set_defaults(func=armazens)

    i = sub.add_parser("importar", help="armazém do WmsOffice -> cenário do jogo (P2)")
    i.add_argument("--origem", required=True, help="URL do WmsOffice de onde ler o armazém (ex.: http://localhost:8100)")
    i.add_argument("--armazem", required=True, help="id (uuid) do Armazem na origem")
    i.add_argument("--codigo", help="código do SimCenario (padrão: CORP-<8 primeiros do id>)")
    i.add_argument("--max-docas", type=int, default=2, help="docas de cada tipo a copiar (padrão 2)")
    i.add_argument("--max-produtos", type=int, default=30, help="produtos a copiar (padrão 30)")
    i.add_argument("--qtd-ordens", type=int, help="nº de ordens (padrão: pelo nº de locais, 20..400)")
    i.add_argument("--seed", type=int)
    i.add_argument("--jogo", help="URL do servidor do jogo (padrão: PONTE_JOGO_URL ou http://localhost:8200)")
    i.add_argument("--simular", action="store_true", help="só mostra o que seria criado; não grava nada")
    i.set_defaults(func=importar)
    a = sub.add_parser("ao-vivo", help="exporta uma partida reproduzindo o turno no tempo do jogo (T3.4)")
    a.add_argument("--partida", required=True, help="id de uma SimPartida Concluida no servidor do jogo")
    a.add_argument("--velocidade", type=float, default=300.0,
                   help="vezes mais rápido que o turno (padrão 300: um turno de 10 h dura 2 min; 3600: 10 min de turno em 10 s)")
    a.add_argument("--alvo", help="URL do WmsOffice de destino (padrão: PONTE_ALVO_URL ou http://localhost:8200)")
    a.add_argument("--jogo", help="URL do servidor do jogo (padrão: PONTE_JOGO_URL ou http://localhost:8200)")
    a.add_argument("--forcar", action="store_true")
    a.add_argument("--sem-crossdocking", action="store_true")
    a.set_defaults(func=ao_vivo)
    r = sub.add_parser("propor-ranking", help="propõe ao corporativo a ordem de ruas da melhor partida (T3.4)")
    r.add_argument("--cenario", help="código do SimCenario (usa a melhor partida validada dele)")
    r.add_argument("--partida", help="id de uma SimPartida (em vez de --cenario)")
    r.add_argument("--alvo", help="URL do corporativo (padrão: a de onde o cenário veio, SimCenario.procedenciaUrl)")
    r.add_argument("--armazem", help="id do Armazem no corporativo (padrão: o de onde o cenário veio)")
    r.add_argument("--jogo", help="URL do servidor do jogo (padrão: PONTE_JOGO_URL ou http://localhost:8200)")
    r.add_argument("--simular", action="store_true", help="só mostra a ordem proposta; não grava nada")
    r.set_defaults(func=propor_ranking)
    v = sub.add_parser("vigiar", help="processa pedidos de exportação feitos pelo jogo (SimExportacao Solicitada)")
    v.add_argument("--intervalo", type=float, default=5.0, help="segundos entre consultas (padrão 5)")
    v.add_argument("--uma-vez", action="store_true", help="processa o que houver e sai")
    v.add_argument("--jogo", help="URL do servidor do jogo (padrão: PONTE_JOGO_URL ou http://localhost:8200)")
    v.set_defaults(func=vigiar)
    return p


def main(argv=None):
    args = montar_parser().parse_args(argv)
    try:
        return args.func(args)
    except ErroPonte as e:
        _log(f"erro: {e}")
        return 1
    except (ValueError, KeyError) as e:
        _log(f"erro: {type(e).__name__}: {e}")
        return 1
    except KeyboardInterrupt:
        _log("interrompido")
        return 1


if __name__ == "__main__":
    sys.exit(main())
