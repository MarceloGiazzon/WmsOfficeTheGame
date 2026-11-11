#!/usr/bin/env python3
"""REFERÊNCIA VERIFICADA (2026-11-10, ao vivo na :8200): um recebimento e uma expedição completos só por REST.

Não é a ponte: é o "caminho feliz" mínimo, chamada a chamada, que a ponte (backend/ponte/) tem de reproduzir.
Cada passo tem um número [Rnn]/[Enn] citado em docs/ponte/CONTRATO_REST.md. Cria tudo num Estabelecimento próprio
("REF Ponte") e APAGA tudo no fim (ordem inversa da criação), mesmo se algo falhar.

Uso (app de pé):  python3 backend/ponte/referencia/ciclo_rest_verificado.py [--base http://localhost:8200]
                  [--user admin] [--password 'Teste123!']
Saída esperada: todas as linhas "ok" e, no fim, "OK: 0 falha(s)".
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "npdev", "tests"))
from npdev_api import Api  # noqa: E402

DATA = "2026-11-10"


def run(api):
    c = api.check

    def get(path):
        st, res = api.call("GET", path)
        assert st == 200, (path, st, res)
        return res

    def put(path, body):
        return api.call("PUT", path, body)

    def eventos(movimento_id):
        pag = get(f"concepts/HistoricoMovimentacao/page?movimentoId={movimento_id}&limit=100")
        return sorted(h["evento"] for h in pag["items"]), pag["items"]

    # ---- topologia mínima ---------------------------------------------------------------------------------------
    ent = api.create("entidades", {"nome": "REF Ponte", "tipo": "Estabelecimento", "ativo": True})
    arm = api.create("armazems", {"entidadeId": ent["id"], "nome": "REF Armazem", "ativo": True})
    area = api.create("areas", {"armazemId": arm["id"], "nome": "REF Area", "funcao": "Armazenagem", "ativo": True})
    rua = api.create("ruas", {"areaId": area["id"], "codigo": "REF01", "qtdPosicoes": 1, "qtdAndares": 1,
                              "bloqueiaRecebimento": False, "bloqueiaExpedicao": False, "bloqueiaMovimento": False,
                              "ativo": True})
    loc = api.create("local_armazenagems", {"ruaId": rua["id"], "posicao": 1, "andar": 1, "situacao": "Disponivel"})
    perfil = api.create("perfil_alocacaos", {"nome": "REF Perfil", "ocupacaoIdealPercent": 80, "ativo": True})
    prod = api.create("produtos", {"nome": "REF Produto", "codigo": "REF-P1", "qtdCaixasPorPallet": 20,
                                   "diasValidadePadrao": 90, "perfilAlocacaoId": perfil["id"], "ativo": True})
    c("[T1] POST devolve o registro com id, version e tenantId", {"id", "version", "tenantId"} <= set(prod), prod)

    # ---- recebimento ----------------------------------------------------------------------------------------------
    lote = api.create("lotes", {"entidadeId": ent["id"], "produtoId": prod["id"], "dataValidade": "2027-02-08",  # [R01]
                                "ocorrencia": "Normal", "situacao": "Recebido", "quantidade": 20})
    mov = api.create("movimentos", {"entidadeId": ent["id"], "tipo": "Recebimento", "dataMovimento": DATA,  # [R02]
                                    "situacao": "Pendente"})
    item = api.create("movimento_items", {"movimentoId": mov["id"], "produtoId": prod["id"],  # [R03]
                                          "loteId": lote["id"], "quantidade": 20})
    rec = api.create("recebimentos", {"entidadeId": ent["id"], "movimentoId": mov["id"], "dataRecebimento": DATA,  # [R04]
                                      "estagio": "PreRecebimento", "situacao": "Normal", "nfePendente": False,
                                      "divergenciaItensXNotas": False, "crossDockingAtivo": False,
                                      "observacao": "WmsOffice: The Game · referência · ordem IN-0001"})
    api.create("recebimento_lotes", {"recebimentoId": rec["id"], "loteId": lote["id"], "quantidade": 20,  # [R05]
                                     "crossDocking": False})

    st, res = put(f"recebimentos/{rec['id']}", {"estagio": "Conferido"})
    c("[R06x] pular estágio por PUT -> 422 status_transition_not_allowed",
      st == 422 and "status_transition_not_allowed" in str(res), (st, res))
    st, res = put(f"recebimentos/{rec['id']}", {"estagio": "Enderecado"})  # [R06] PUT PARCIAL: mescla com o registro
    c("[R06] PUT parcial {estagio: Enderecado} -> 200 e mantém os outros campos",
      st == 200 and res["estagio"] == "Enderecado" and res["observacao"].startswith("WmsOffice"), (st, res))
    st, res = api.call("PATCH", f"recebimentos/{rec['id']}", {"estagio": "Conferido"})
    c("[T2] PATCH não existe -> 405", st == 405, (st, res))
    st, res = put(f"recebimentos/{rec['id']}", {"estagio": "Conferido"})  # [R07]
    c("[R07] PUT -> Conferido", st == 200 and res["estagio"] == "Conferido", (st, res))

    api.create("movimento_item_posicaos", {"movimentoItemId": item["id"], "localArmazenagemId": loc["id"],  # [R08]
                                           "produtoId": prod["id"], "loteId": lote["id"], "papel": "Destino",
                                           "quantidade": 20})
    ocup = api.create("local_armazenagem_lotes", {"localArmazenagemId": loc["id"], "loteId": lote["id"],  # [R09]
                                                  "quantidade": 20})
    st, res = put(f"local_armazenagems/{loc['id']}", {"situacao": "Ocupado"})  # [R10]
    c("[R10] PUT local -> Ocupado", st == 200 and res["situacao"] == "Ocupado", (st, res))

    st, res = api.flow("ConfirmarMovimentacao", {**get(f"movimentos/{mov['id']}"), "situacao": "Concluido"})  # [R11]
    c("[R11] flow ConfirmarMovimentacao -> status OK, situacao Concluido",
      st == 200 and res["status"] == "OK" and res["output"]["situacao"] == "Concluido", (st, res))
    st, res = api.flow("ConfirmarRecebimento", {**get(f"recebimentos/{rec['id']}"), "estagio": "Armazenado"})  # [R12]
    c("[R12] flow ConfirmarRecebimento -> Armazenado",
      st == 200 and res["status"] == "OK" and get(f"recebimentos/{rec['id']}")["estagio"] == "Armazenado", (st, res))

    nomes, linhas = eventos(mov["id"])
    c("[H1] histórico do recebimento = 4 linhas (Enderecado, Conferido, Armazenado, Concluido)",
      nomes == ["Armazenado", "Concluido", "Conferido", "Enderecado"], nomes)
    c("[H2] ocorridoEm e descricao vêm NULOS (o servidor não carimba)",
      all(h["ocorridoEm"] is None and h["descricao"] is None for h in linhas), linhas)
    h0 = linhas[0]
    st, res = put(f"historico_movimentacaos/{h0['id']}", {"ocorridoEm": "2026-11-10T11:10:20Z",  # [H3]
                                                          "descricao": "WmsOffice: The Game · ordem IN-0001"})
    c("[H3] PUT histórico com ocorridoEm/descricao -> 200", st == 200 and res["ocorridoEm"].startswith("2026-11-10T11:10:20"),
      (st, res))

    # ---- expedição -------------------------------------------------------------------------------------------------
    mov2 = api.create("movimentos", {"entidadeId": ent["id"], "tipo": "Expedicao", "dataMovimento": DATA,  # [E01]
                                     "situacao": "Pendente"})
    exp = api.create("expedicaos", {"entidadeId": ent["id"], "movimentoId": mov2["id"], "dataExpedicao": DATA,  # [E02]
                                    "tipo": "Normal", "estagio": "PreExpedicao", "situacao": "Normal",
                                    "crossDockingAtivo": False})
    api.create("expedicao_items", {"expedicaoId": exp["id"], "produtoId": prod["id"], "quantidade": 20,  # [E03]
                                   "autoFinalizacao": False})
    st, res = put(f"expedicaos/{exp['id']}", {"estagio": "DemandaGerada"})  # [E04]
    c("[E04] PUT expedição -> DemandaGerada", st == 200, (st, res))
    item2 = api.create("movimento_items", {"movimentoId": mov2["id"], "produtoId": prod["id"],  # [E05]
                                           "loteId": lote["id"], "quantidade": 20})
    api.create("movimento_item_posicaos", {"movimentoItemId": item2["id"], "localArmazenagemId": loc["id"],  # [E06]
                                           "produtoId": prod["id"], "loteId": lote["id"], "papel": "Origem",
                                           "quantidade": 20})
    st, res = put(f"expedicaos/{exp['id']}", {"estagio": "MovimentacaoConcluida"})  # [E07]
    c("[E07] PUT expedição -> MovimentacaoConcluida", st == 200, (st, res))
    st, res = put(f"local_armazenagem_lotes/{ocup['id']}", {"quantidade": 0})  # [E08]
    c("[E08] PUT ocupação -> 0 (a linha fica, com quantidade 0)", st == 200 and res["quantidade"] == 0, (st, res))
    st, res = put(f"local_armazenagems/{loc['id']}", {"situacao": "Disponivel"})  # [E09]
    c("[E09] PUT local -> Disponivel", st == 200, (st, res))
    st, res = api.flow("ConfirmarMovimentacao", {**get(f"movimentos/{mov2['id']}"), "situacao": "Concluido"})  # [E10]
    c("[E10] flow ConfirmarMovimentacao (expedição)", st == 200 and res["status"] == "OK", (st, res))
    st, res = api.flow("ConfirmarSaidaExpedicao", {**get(f"expedicaos/{exp['id']}"), "estagio": "SaidaConfirmada"})  # [E11]
    c("[E11] flow ConfirmarSaidaExpedicao -> SaidaConfirmada",
      st == 200 and res["status"] == "OK" and get(f"expedicaos/{exp['id']}")["estagio"] == "SaidaConfirmada", (st, res))
    nomes, _ = eventos(mov2["id"])
    c("[H4] histórico da expedição = 4 linhas (DemandaGerada, MovimentacaoConcluida, SaidaConfirmada, Concluido)",
      nomes == ["Concluido", "DemandaGerada", "MovimentacaoConcluida", "SaidaConfirmada"], nomes)

    # ---- armadilhas ------------------------------------------------------------------------------------------------
    st, res = api.flow("ConfirmarMovimentacao", {**get(f"movimentos/{mov2['id']}"), "situacao": "Concluido"})
    nomes, _ = eventos(mov2["id"])
    c("[A1] repetir ConfirmarMovimentacao em Concluido devolve OK e DUPLICA a linha do histórico",
      st == 200 and res["status"] == "OK" and nomes.count("Concluido") == 2, nomes)
    st, todos = api.call("GET", f"historico_movimentacaos?movimentoId={mov2['id']}")
    c("[A2] GET /api/<conceito>?campo= IGNORA o filtro (devolve linhas de outros movimentos)",
      st == 200 and any(h["movimentoId"] != mov2["id"] for h in todos), len(todos))


if __name__ == "__main__":
    Api.from_argv().run(run)
