"""`ponte.py vigiar`: executa os pedidos de exportação feitos pelo jogo (P3, decisão D8 do PLANO).

O servidor do jogo não pode chamar o corporativo (capabilities não têm `java.net`) e o navegador não fala com outra origem.
Então o botão "Enviar ao WmsOffice" só cria uma `SimExportacao` "Solicitada"; este processo, à parte, a executa — com a
mesma rotina do `exportar --partida` — e o próprio registro mostra o andamento. Só aceita alvos de uma lista permitida
(`PONTE_ALVOS_PERMITIDOS`, padrão `http://localhost:8100,http://localhost:8200`): um jogador não escolhe para onde a ponte,
rodando com a senha de admin, vai escrever.
"""
import os
import sys
import time

import exportar_partida
from npdev import ErroPonte

PERMITIDOS_PADRAO = "http://localhost:8100,http://localhost:8200"


def alvos_permitidos():
    bruto = os.environ.get("PONTE_ALVOS_PERMITIDOS", PERMITIDOS_PADRAO)
    return {a.strip().rstrip("/") for a in bruto.split(",") if a.strip()}


def _log(*a):
    print(*a, file=sys.stderr, flush=True)


def processar_pendentes(jogo, permitidos=None):
    """Executa tudo que está `Solicitada`. Devolve quantas deram certo e quantas falharam. Nunca lança por causa de um pedido."""
    permitidos = permitidos if permitidos is not None else alvos_permitidos()
    feitas = falhas = 0
    for pedido in jogo.pagina("SimExportacao", situacao="Solicitada"):
        alvo = pedido["alvoUrl"].rstrip("/")
        if alvo not in permitidos:
            _log(f"pedido {pedido['id']}: alvo não permitido ({alvo})")
            try:
                jogo.atualizar("sim_exportacaos", pedido["id"], {"situacao": "Falhou", "mensagem": "alvo não permitido"})
            except ErroPonte as e:
                _log(f"  não consegui registrar a recusa: {e}")
            falhas += 1
            continue
        _log(f"pedido {pedido['id']}: partida {pedido['partidaId']} → {alvo}")
        try:
            codigo, _ = exportar_partida.exportar_partida(jogo, pedido["partidaId"], alvo)
            feitas += codigo == 0
            falhas += codigo != 0
        except Exception as e:  # exportar_partida já gravou a falha no registro; o laço segue para o próximo
            _log(f"  falhou: {e}")
            falhas += 1
    return feitas, falhas


def vigiar(jogo_url=None, intervalo=5.0, uma_vez=False):
    jogo = exportar_partida.cliente_do_jogo(jogo_url)
    _log(f"vigiando {jogo.base} (alvos permitidos: {', '.join(sorted(alvos_permitidos()))}); Ctrl+C para sair")
    total_feitas = total_falhas = 0
    try:
        while True:
            feitas, falhas = processar_pendentes(jogo)
            total_feitas += feitas
            total_falhas += falhas
            if uma_vez:
                break
            time.sleep(intervalo)
    except KeyboardInterrupt:
        _log("saindo")
    return {"concluidas": total_feitas, "falhas": total_falhas}
