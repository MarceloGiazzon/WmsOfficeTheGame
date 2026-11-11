"""`propor-ranking` (T3.4): o jogo propõe ao corporativo a ordem de ruas da melhor partida de um cenário que veio de lá.

Regras (e por que é seguro): mapa.json → jogoParaCorporativo.propostaRanking. Em resumo: grava um PerfilAlocacao NOVO, inativo
e sem produtos, com as RankingRua dele, no armazém de ORIGEM; nada que já existe é alterado.

A parte pura (`ordem_das_ruas`, `plano_da_proposta`) não abre rede; `propor` faz a leitura/gravação.
"""
import sys

import exportar_partida
import fonte as fonte_mod
import mapa as mapa_mod
from diario import Diario
from executor import Executor, progresso_stderr
from planejador import Operacao, Plano

OCUPACAO_IDEAL_PADRAO = 80


def melhor_partida(jogo, cenario_id):
    """A partida Concluida de maior score entre as validadas pelo servidor (empate: a que concluiu antes). None se não há."""
    scores = [s for s in jogo.pagina("SimScore", cenarioId=cenario_id) if s.get("validadoServidor")]
    concluidas = {p["id"]: p for p in jogo.pagina("SimPartida", cenarioId=cenario_id) if p["situacao"] == "Concluida"}
    candidatos = [(s, concluidas[s["partidaId"]]) for s in scores if s["partidaId"] in concluidas]
    if not candidatos:
        return None
    score, partida = min(candidatos, key=lambda sp: (-sp[0]["scoreCentesimos"], sp[1].get("concluidaEm") or "", sp[1]["id"]))
    return {**partida, "scoreCentesimos": score["scoreCentesimos"]}


def ordem_das_ruas(pacote, rastro):
    """Ordem de preferência das ruas de armazenagem segundo a partida. Devolve [{ruaId, codigo, prioridade, paletes}] (1..n).

    Mais paletes guardados (Putaway) primeiro; empate: a rua que recebeu o primeiro palete antes; depois as ruas sem nenhum
    palete, na ordem de prioridade que o cenário já tinha (e por código)."""
    area_funcao = {a["id"]: a["funcao"] for a in pacote["areas"]}
    ruas = {r["id"]: r for r in pacote["ruas"] if area_funcao[r["areaId"]] == "Armazenagem"}
    rua_do_local = {l["id"]: l["ruaId"] for l in pacote["locais"]}
    paletes, primeiro = {}, {}
    for e in rastro["eventos"]:
        if e["tipo"] != "Putaway":
            continue
        rua = rua_do_local[e["localId"]]
        if rua not in ruas:
            continue
        paletes[rua] = paletes.get(rua, 0) + 1
        primeiro.setdefault(rua, e["seq"])
    antes = {rk["ruaId"]: rk["prioridade"] for rk in pacote["rankingRuas"]}
    usadas = sorted(paletes, key=lambda r: (-paletes[r], primeiro[r], ruas[r]["codigo"]))
    sem_uso = sorted((r for r in ruas if r not in paletes), key=lambda r: (antes.get(r, 10 ** 9), ruas[r]["codigo"]))
    return [{"ruaId": r, "codigo": ruas[r]["codigo"], "prioridade": i, "paletes": paletes.get(r, 0)}
            for i, r in enumerate(usadas + sem_uso, start=1)]


def plano_da_proposta(mapa, cenario, partida_id, ordem, rua_origem_por_codigo, ocupacao_ideal):
    """Plano com o PerfilAlocacao e uma RankingRua por rua. `rua_origem_por_codigo`: codigo -> id da rua NA ORIGEM."""
    modelo = mapa["jogoParaCorporativo"]["propostaRanking"]
    base = {"cenario": cenario, "partida": {"curto": partida_id[:8]}, "ocupacaoIdealPercent": ocupacao_ideal}
    plano = Plano()
    plano.operacoes.append(Operacao("garantir", modelo["perfil"]["chave"], modelo["perfil"]["conceito"],
                                    mapa_mod.preencher(modelo["perfil"]["campos"], base)))
    for r in ordem:
        c = {**base, "rua": r, "ruaOrigemId": rua_origem_por_codigo[r["codigo"]], "prioridade": r["prioridade"]}
        plano.operacoes.append(Operacao("garantir", mapa_mod.preencher(modelo["ranking"]["chave"], c), modelo["ranking"]["conceito"],
                                        mapa_mod.preencher(modelo["ranking"]["campos"], c)))
    return plano


def ler_ruas_da_origem(origem, armazem_id):
    """(codigo -> id da Rua nas áreas de Armazenagem do armazém, {ruaId: prioridade} de algum perfil, ocupacaoIdealPercent)."""
    if origem.ler("armazems", armazem_id) is None:
        raise ValueError(f"armazém {armazem_id} não existe em {origem.base}")
    ruas, ranking = {}, {}
    for a in origem.pagina("Area", armazemId=armazem_id):
        if a["funcao"] != "Armazenagem":
            continue
        for r in origem.pagina("Rua", areaId=a["id"]):
            ruas[r["codigo"]] = r["id"]
    perfil_id = None
    for codigo, rua_id in ruas.items():
        for rk in origem.pagina("RankingRua", ruaId=rua_id):
            ranking[rua_id] = min(rk["prioridade"], ranking.get(rua_id, rk["prioridade"]))
            perfil_id = perfil_id or rk.get("perfilAlocacaoId")
    ideal = OCUPACAO_IDEAL_PADRAO
    if perfil_id:
        perfil = origem.ler("perfil_alocacaos", perfil_id)
        ideal = (perfil or {}).get("ocupacaoIdealPercent") or ideal
    return ruas, ranking, ideal


def propor(jogo, partida_id=None, cenario_codigo=None, alvo_url=None, armazem_id=None, simular=False):
    """Devolve o resumo (dict). ValueError com mensagem clara se não dá para propor."""
    if bool(partida_id) == bool(cenario_codigo):
        raise ValueError("informe --partida OU --cenario")
    if partida_id is None:
        achados = jogo.pagina("SimCenario", codigo=cenario_codigo)
        if not achados:
            raise ValueError(f"cenário {cenario_codigo} não existe no jogo")
        melhor = melhor_partida(jogo, achados[0]["id"])
        if melhor is None:
            raise ValueError(f"o cenário {cenario_codigo} ainda não tem partida concluída e validada pelo servidor")
        partida_id = melhor["id"]
    f = fonte_mod.carregar_do_jogo(jogo, partida_id)
    cenario_linha = jogo.ler("sim_cenarios", f.pacote["cenario"]["id"])
    if cenario_linha.get("procedencia") != "Corporativo" and not (alvo_url and armazem_id):
        raise ValueError(f"o cenário {cenario_linha['codigo']} não veio do WmsOffice corporativo; para propor a um armazém "
                         f"específico use --alvo e --armazem")
    alvo_url = (alvo_url or cenario_linha.get("procedenciaUrl") or "").rstrip("/")
    armazem_id = armazem_id or cenario_linha.get("procedenciaArmazemId")
    if not alvo_url or not armazem_id:
        raise ValueError("o cenário não diz de que armazém veio (procedenciaUrl/procedenciaArmazemId); use --alvo e --armazem")

    alvo = exportar_partida.cliente_do_alvo(alvo_url)
    ruas_origem, antes_por_rua, ideal = ler_ruas_da_origem(alvo, armazem_id)
    ordem = ordem_das_ruas(f.pacote, f.rastro)
    sem_par = [r["codigo"] for r in ordem if r["codigo"] not in ruas_origem]
    if sem_par:
        raise ValueError(f"as ruas {sem_par[:5]} do cenário não existem no armazém {armazem_id} de {alvo_url} (por código)")
    antes = sorted(ruas_origem, key=lambda c: (antes_por_rua.get(ruas_origem[c], 10 ** 9), c))
    depois = [r["codigo"] for r in ordem]
    resumo = {"partida": partida_id, "cenario": cenario_linha["codigo"], "alvo": alvo_url, "armazemAlvoId": armazem_id,
              "ordem": ordem, "antes": antes, "depois": depois,
              "ruasQueMudaramDePosicao": sum(1 for a, d in zip(antes, depois) if a != d), "simulado": simular}
    if simular:
        return resumo
    plano = plano_da_proposta(mapa_mod.carregar(), f.pacote["cenario"], partida_id, ordem, ruas_origem, ideal)
    diario = Diario(exportar_partida.caminho_diario(alvo_url, "ranking:" + partida_id), alvo_url, "ranking:" + partida_id)
    res = Executor(alvo, mapa_mod.carregar(), diario, progresso_stderr()).executar(plano)
    resumo.update({"diario": diario.caminho, "perfilAlocacaoId": diario.id("proposta:perfil"), "criados": res["criados"],
                   "reusados": res["reusados"]})
    return resumo


if __name__ == "__main__":  # pragma: no cover
    print("use: python3 backend/ponte/ponte.py propor-ranking --help", file=sys.stderr)
    sys.exit(2)
