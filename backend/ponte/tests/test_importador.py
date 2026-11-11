#!/usr/bin/env python3
"""Testes OFFLINE das partes puras do importador (Corporativo -> Jogo): escolha de docas/produtos/ranking, parâmetros e operações."""
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
PONTE = os.path.dirname(HERE)
sys.path.insert(0, PONTE)

import importador as imp  # noqa: E402
import mapa  # noqa: E402


def origem(n_ruas_arm=2, posicoes=3, produtos=None, ranking=True, com_docas=True):
    areas = [{"id": "aA", "nome": "Armaz", "funcao": "Armazenagem"}, {"id": "aR", "nome": "Rec", "funcao": "Recebimento"},
             {"id": "aE", "nome": "Exp", "funcao": "Expedicao"}]
    ruas, locais = [], []
    for i in range(1, n_ruas_arm + 1):
        ruas.append({"id": f"rA{i}", "areaId": "aA", "codigo": f"A{i:03d}", "qtdPosicoes": posicoes, "qtdAndares": 2})
        for p in range(1, posicoes + 1):
            for a in (1, 2):
                locais.append({"id": f"lA{i}-{p}-{a}", "ruaId": f"rA{i}", "posicao": p, "andar": a,
                               "situacao": "Bloqueado" if (i, p, a) == (1, 1, 2) else "Ocupado"})
    if com_docas:
        for rid, area, cod in (("rR1", "aR", "REC01"), ("rE1", "aE", "EXP01")):
            ruas.append({"id": rid, "areaId": area, "codigo": cod, "qtdPosicoes": 4, "qtdAndares": 1})
            for p in (3, 4, 5, 6):  # posições que NÃO começam em 1: têm de ser renumeradas
                locais.append({"id": f"l{rid}-{p}", "ruaId": rid, "posicao": p, "andar": 1, "situacao": "Disponivel"})
    rk = [{"ruaId": f"rA{i}", "perfilAlocacaoId": "perfil1", "prioridade": 10 - i} for i in range(1, n_ruas_arm)] if ranking else []
    prods = produtos if produtos is not None else [
        {"id": "p1" + "0" * 30, "codigo": "B", "nome": "Prod B", "qtdCaixasPorPallet": 10, "perfilAlocacaoId": "perfil1", "ativo": True},
        {"id": "p2" + "0" * 30, "codigo": "A", "nome": "Prod A", "qtdCaixasPorPallet": 20, "perfilAlocacaoId": "perfil1", "ativo": True},
        {"id": "p3" + "0" * 30, "codigo": "C", "nome": "Fora do perfil", "qtdCaixasPorPallet": 5, "perfilAlocacaoId": None, "ativo": True}]
    return {"armazem": {"id": "arm-1234-5678", "nome": "Armazem X"}, "areas": areas, "ruas": ruas, "locais": locais, "ranking": rk,
            "perfis": {"perfil1": {"id": "perfil1", "nome": "Perfil 1", "ocupacaoIdealPercent": 70}}, "produtos": prods}


class TestEscolher(unittest.TestCase):
    def test_docas_sao_as_primeiras_por_rua_e_posicao(self):
        e = imp.escolher(origem(), max_docas=2)
        self.assertEqual([(r["codigo"], l["posicao"]) for r, l in e["entrada"]], [("REC01", 3), ("REC01", 4)])
        self.assertEqual([(r["codigo"], l["posicao"]) for r, l in e["saida"]], [("EXP01", 3), ("EXP01", 4)])

    def test_produtos_do_perfil_ordenados_por_codigo(self):
        e = imp.escolher(origem())
        self.assertEqual([p["codigo"] for p in e["produtos"]], ["A", "B"])  # o "C" é de nenhum perfil: fica de fora
        self.assertEqual(e["perfilId"], "perfil1")

    def test_sem_perfil_vale_todo_produto_ativo_e_o_limite(self):
        o = origem(ranking=False)
        self.assertEqual([p["codigo"] for p in imp.escolher(o)["produtos"]], ["A", "B", "C"])
        self.assertEqual([p["codigo"] for p in imp.escolher(o, max_produtos=2)["produtos"]], ["A", "B"])

    def test_produto_sem_codigo_usa_o_id(self):
        p = {"id": "abcdef0123456789", "codigo": None, "nome": "Demo", "qtdCaixasPorPallet": 1, "ativo": True}
        e = imp.escolher(origem(ranking=False, produtos=[p]))
        self.assertEqual(imp.codigo_produto(e["produtos"][0]), "CORP-abcdef01")

    def test_ranking_completa_as_ruas_sem_prioridade_no_fim(self):
        e = imp.escolher(origem(n_ruas_arm=3))
        self.assertEqual(e["prioridade"], {"rA1": 9, "rA2": 8, "rA3": 10})

    def test_sem_ranking_e_1_n_por_codigo(self):
        e = imp.escolher(origem(ranking=False))
        self.assertEqual(e["prioridade"], {"rA1": 1, "rA2": 2})

    def test_recusa_o_que_nao_e_jogavel(self):
        with self.assertRaisesRegex(ValueError, "armazenagem"):
            imp.escolher(origem(n_ruas_arm=0))
        with self.assertRaisesRegex(ValueError, "doca"):
            imp.escolher(origem(com_docas=False))
        with self.assertRaisesRegex(ValueError, "produto"):
            imp.escolher(origem(produtos=[]))


class TestParametros(unittest.TestCase):
    def setUp(self):
        self.o = origem()
        self.e = imp.escolher(self.o)

    def test_regras_do_mapa(self):
        p = imp.parametros(self.e, self.o["armazem"])
        self.assertEqual(p["codigo"], "CORP-arm-1234")
        self.assertEqual((p["dificuldade"], p["equipamentos"], p["qtdOrdens"]), ("Facil", 2, 20))  # 12 locais
        self.assertEqual((p["docasEntrada"], p["docasSaida"]), (2, 2))
        self.assertEqual(p["seed"], imp.parametros(self.e, self.o["armazem"])["seed"])  # determinística
        self.assertEqual(imp.parametros(self.e, self.o["armazem"], seed=7, qtd_ordens=33, codigo="X")["seed"], 7)

    def test_dificuldade_e_equipamentos_por_tamanho(self):
        self.assertEqual([imp._dificuldade(n) for n in (99, 100, 499, 500, 1499, 1500)],
                         ["Facil", "Medio", "Medio", "Dificil", "Dificil", "Extremo"])
        e = dict(self.e, nLocais=1448)
        p = imp.parametros(e, self.o["armazem"])
        self.assertEqual((p["equipamentos"], p["qtdOrdens"]), (8 if round(1448 / 150) > 8 else round(1448 / 150), 400))

    def test_pesos(self):
        self.assertEqual(imp.pesos(range(1, 6)), [100, 47, 30, 22, 17])


class TestOperacoes(unittest.TestCase):
    def setUp(self):
        self.o = origem()
        self.e = imp.escolher(self.o)
        self.p = imp.parametros(self.e, self.o["armazem"])
        self.m = mapa.carregar()
        self.ops = imp.operacoes_topologia(self.e, self.o["armazem"], self.p, self.m, "http://localhost:8100", "2026-11-10T12:00:00Z")

    def op(self, chave):
        achadas = [o for o in self.ops if o.chave == chave]
        self.assertEqual(len(achadas), 1, chave)
        return achadas[0]

    def test_resumo_bate_com_as_operacoes(self):
        from collections import Counter
        r = imp.resumo(self.e, self.p, self.o["armazem"])["criaria"]
        c = Counter(o.conceito for o in self.ops)
        for k in ("Entidade", "Armazem", "Area", "Rua", "LocalArmazenagem", "PerfilAlocacao", "RankingRua", "Produto", "SimCenario"):
            self.assertEqual(r[k], c[k], k)

    def test_docas_renumeradas_e_rua_da_doca_com_so_as_copiadas(self):
        rua = self.op("imp:rua:rR1").dados
        self.assertEqual((rua["qtdPosicoes"], rua["qtdAndares"]), (2, 1))
        self.assertEqual(sorted(self.op(k).dados["posicao"] for k in ("imp:local:lrR1-3", "imp:local:lrR1-4")), [1, 2])
        self.assertFalse([o for o in self.ops if o.chave == "imp:local:lrR1-5"])

    def test_local_bloqueado_continua_e_o_resto_vira_disponivel(self):
        self.assertEqual(self.op("imp:local:lA1-1-2").dados["situacao"], "Bloqueado")
        self.assertEqual(self.op("imp:local:lA1-1-1").dados["situacao"], "Disponivel")

    def test_produto_e_cenario(self):
        pr = self.op("imp:produto:" + self.e["produtos"][0]["id"]).dados
        self.assertEqual((pr["codigo"], pr["qtdCaixasPorPallet"], pr["perfilAlocacaoId"]), ("CORP-A", 20, {"$ref": "imp:perfil"}))
        cen = self.op("imp:cenario").dados
        self.assertEqual((cen["procedencia"], cen["procedenciaUrl"], cen["procedenciaArmazemId"], cen["procedenciaEm"]),
                         ("Corporativo", "http://localhost:8100", "arm-1234-5678", "2026-11-10T12:00:00Z"))
        self.assertEqual((cen["nome"], cen["codigo"], cen["qtdDocasInbound"], cen["armazemId"]),
                         ("Armazem X (corporativo)", "CORP-arm-1234", 2, {"$ref": "imp:armazem"}))
        self.assertNotIn("distanciaTeoricaCm", cen)  # vem depois, do motor

    def test_toda_ref_aponta_para_registro_ja_planejado(self):
        def refs(v):
            if isinstance(v, dict):
                return [v["$ref"]] if set(v) == {"$ref"} else [r for x in v.values() for r in refs(x)]
            return []
        vistas = set()
        for o in self.ops:
            for r in refs(o.dados):
                self.assertIn(r, vistas, f"{o.chave} cita {r}")
            vistas.add(o.chave)

    def test_ordens_e_entrada_do_flow(self):
        ops = imp.operacoes_ordens([{"numero": "IN-0001", "tipo": "Inbound", "liberacaoSeg": 29000, "slaSeg": 3000, "produtoId": "uuid-p", "quantidadePaletes": 2}])
        self.assertEqual((ops[0].chave, ops[0].conceito, ops[0].dados["cenarioId"]), ("imp:ordem:IN-0001", "SimOrdem", {"$ref": "imp:cenario"}))
        corpo = imp.entrada_gerar_ordens(self.e, self.p, {p["id"]: "J" + p["id"] for p in self.e["produtos"]})
        self.assertEqual([x["peso"] for x in corpo["produtos"]], [100, 47])
        self.assertTrue(corpo["produtos"][0]["produtoId"].startswith("J"))
        self.assertEqual((corpo["slaMinSeg"], corpo["paletesMax"], corpo["seed"]), (1800, 3, self.p["seed"]))


if __name__ == "__main__":
    unittest.main()
