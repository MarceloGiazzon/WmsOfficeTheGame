#!/usr/bin/env python3
"""Testes OFFLINE do `propor-ranking` (T3.4): a ordem das ruas, o plano da proposta e a escolha da melhor partida."""
import copy
import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

import mapa  # noqa: E402
import propor  # noqa: E402

MINI = os.path.join(os.path.dirname(HERE), "exemplos", "mini")


def carregar():
    with open(os.path.join(MINI, "pacote.json"), encoding="utf-8") as a, open(os.path.join(MINI, "rastro.json"), encoding="utf-8") as b:
        return json.load(a), json.load(b)


def com_putaways_em(rastro, destinos):
    """Cópia do rastro com os Putaway (na ordem em que aparecem) indo para os locais de `destinos`."""
    r = copy.deepcopy(rastro)
    it = iter(destinos)
    for e in r["eventos"]:
        if e["tipo"] == "Putaway":
            e["localId"] = next(it)
    return r


class TestOrdemDasRuas(unittest.TestCase):
    def test_mais_paletes_primeiro_e_so_ruas_de_armazenagem(self):
        pacote, rastro = carregar()
        ordem = propor.ordem_das_ruas(pacote, rastro)
        self.assertEqual([(o["codigo"], o["prioridade"], o["paletes"]) for o in ordem], [("R01", 1, 2), ("R02", 2, 1)])
        self.assertNotIn("DOCA-IN", [o["codigo"] for o in ordem])

    def test_a_partida_inverte_a_ordem(self):
        pacote, rastro = carregar()
        r = com_putaways_em(rastro, ["MINIrua02-P03-A1", "MINIrua02-P03-A1", "MINIrua01-P01-A1"])
        ordem = propor.ordem_das_ruas(pacote, r)
        self.assertEqual([(o["codigo"], o["paletes"]) for o in ordem], [("R02", 2), ("R01", 1)])

    def test_empate_vale_quem_recebeu_o_primeiro_palete_antes(self):
        pacote, rastro = carregar()
        r = com_putaways_em(rastro, ["MINIrua02-P03-A1", "MINIrua01-P01-A1", "MINIrua01-P02-A1"])  # 1 x 2: sem empate
        r = com_putaways_em(rastro, ["MINIrua02-P03-A1", "MINIrua01-P01-A1", "MINIrua01-P02-A1"][:2] + ["MINIrua02-P03-A1"])
        # R02 recebeu o 1º e o 3º palete (2), R01 só o 2º (1): sem empate; forçamos 2 x 1 -> troca o 3º por R01 e o 4º some
        ordem = propor.ordem_das_ruas(pacote, r)
        self.assertEqual([o["codigo"] for o in ordem], ["R02", "R01"])
        # empate de verdade: tira um Putaway (3 -> 2 eventos), um em cada rua; o primeiro evento decide
        r2 = copy.deepcopy(rastro)
        puts = [e for e in r2["eventos"] if e["tipo"] == "Putaway"]
        puts[0]["localId"], puts[1]["localId"] = "MINIrua02-P03-A1", "MINIrua01-P01-A1"
        r2["eventos"] = [e for e in r2["eventos"] if e is not puts[2]]
        ordem2 = propor.ordem_das_ruas(pacote, r2)
        self.assertEqual([(o["codigo"], o["paletes"]) for o in ordem2], [("R02", 1), ("R01", 1)])

    def test_rua_sem_palete_vai_para_o_fim_na_ordem_antiga(self):
        pacote, rastro = carregar()
        r = com_putaways_em(rastro, ["MINIrua02-P03-A1"] * 3)
        ordem = propor.ordem_das_ruas(pacote, r)
        self.assertEqual([(o["codigo"], o["paletes"]) for o in ordem], [("R02", 3), ("R01", 0)])

    def test_ignora_crossdock_e_estoque_inicial(self):
        pacote, rastro = carregar()
        r = copy.deepcopy(rastro)
        r["eventos"] = [e for e in r["eventos"] if e["tipo"] != "Putaway"]  # só sobram EstoqueInicial e outros
        ordem = propor.ordem_das_ruas(pacote, r)
        self.assertEqual([o["paletes"] for o in ordem], [0, 0])
        self.assertEqual([o["codigo"] for o in ordem], ["R01", "R02"])  # a ordem que o cenário já tinha


class TestPlano(unittest.TestCase):
    def setUp(self):
        pacote, rastro = carregar()
        self.ordem = propor.ordem_das_ruas(pacote, com_putaways_em(rastro, ["MINIrua02-P03-A1"] * 3))
        self.plano = propor.plano_da_proposta(mapa.carregar(), pacote["cenario"], "3a2ea061-aaaa-bbbb", self.ordem,
                                              {"R01": "origem-r01", "R02": "origem-r02"}, 75)

    def test_perfil_novo_e_inativo(self):
        perfil = self.plano.operacoes[0]
        self.assertEqual((perfil.tipo, perfil.chave, perfil.conceito, perfil.compartilhado), ("garantir", "proposta:perfil", "PerfilAlocacao", False))
        self.assertIs(perfil.dados["ativo"], False)
        self.assertEqual(perfil.dados["ocupacaoIdealPercent"], 75)
        self.assertTrue(perfil.dados["nome"].startswith("Proposta do jogo · "))
        self.assertIn("partida 3a2ea061", perfil.dados["nome"])

    def test_um_ranking_por_rua_apontando_para_a_rua_da_origem(self):
        ranks = self.plano.operacoes[1:]
        self.assertEqual([(o.chave, o.dados["ruaId"], o.dados["prioridade"]) for o in ranks],
                         [("proposta:ranking:R02", "origem-r02", 1), ("proposta:ranking:R01", "origem-r01", 2)])
        self.assertTrue(all(o.dados["perfilAlocacaoId"] == {"$ref": "proposta:perfil"} and o.conceito == "RankingRua" for o in ranks))

    def test_so_cria_nunca_altera_nem_apaga(self):
        self.assertEqual({o.tipo for o in self.plano.operacoes}, {"garantir"})
        self.assertEqual({o.conceito for o in self.plano.operacoes}, {"PerfilAlocacao", "RankingRua"})


class JogoFalso:
    def __init__(self, scores, partidas):
        self.t = {"SimScore": scores, "SimPartida": partidas}

    def pagina(self, conceito, **filtros):
        return [r for r in self.t[conceito] if all(r.get(k) == v for k, v in filtros.items())]


class TestMelhorPartida(unittest.TestCase):
    def partidas(self, *ids, situacao="Concluida"):
        return [{"id": i, "cenarioId": "c", "situacao": situacao, "concluidaEm": f"2026-11-10T10:0{n}:00Z"} for n, i in enumerate(ids)]

    def test_maior_score_validado(self):
        jogo = JogoFalso([{"partidaId": "a", "cenarioId": "c", "scoreCentesimos": 7000, "validadoServidor": True},
                          {"partidaId": "b", "cenarioId": "c", "scoreCentesimos": 8000, "validadoServidor": True},
                          {"partidaId": "x", "cenarioId": "c", "scoreCentesimos": 9900, "validadoServidor": False}],
                         self.partidas("a", "b", "x"))
        self.assertEqual(propor.melhor_partida(jogo, "c")["id"], "b")

    def test_empate_vale_a_que_concluiu_antes(self):
        jogo = JogoFalso([{"partidaId": "a", "cenarioId": "c", "scoreCentesimos": 7662, "validadoServidor": True},
                          {"partidaId": "b", "cenarioId": "c", "scoreCentesimos": 7662, "validadoServidor": True}],
                         self.partidas("b", "a"))  # b concluiu 10:00, a 10:01
        self.assertEqual(propor.melhor_partida(jogo, "c")["id"], "b")

    def test_sem_partida_validada(self):
        jogo = JogoFalso([{"partidaId": "a", "cenarioId": "c", "scoreCentesimos": 7000, "validadoServidor": False}], self.partidas("a"))
        self.assertIsNone(propor.melhor_partida(jogo, "c"))


if __name__ == "__main__":
    unittest.main()
