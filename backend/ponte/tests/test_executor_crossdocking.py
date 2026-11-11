#!/usr/bin/env python3
"""Testes OFFLINE da operação `crossdocking` do executor (T3.4), com um alvo falso que imita o flow AtivarCrossDocking.

O que o flow real faz (verificado ao vivo na :8100): cria a linha de CrossDocking com situacao Ativo, liga
crossDockingAtivo no Recebimento e na Expedição e provisiona a baia (Area 'Cross-Docking' + Rua 'CD' + um LocalArmazenagem
novo) no PRIMEIRO armazém da Entidade, não no desta exportação.

Uso (da raiz do repo):  python3 -m unittest discover -s backend/ponte/tests -p 'test_*.py' -v
"""
import itertools
import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

import mapa  # noqa: E402
import planejador  # noqa: E402
from diario import Diario  # noqa: E402
from executor import Executor, limpar  # noqa: E402
import fonte  # noqa: E402

MINI = os.path.join(os.path.dirname(HERE), "exemplos", "mini")
EP = {"CrossDocking": "cross_dockings", "Recebimento": "recebimentos", "Expedicao": "expedicaos",
      "LocalArmazenagem": "local_armazenagems", "Rua": "ruas", "Area": "areas", "Armazem": "armazems",
      "HistoricoMovimentacao": "historico_movimentacaos"}
CONCEITO = {v: k for k, v in EP.items()}


class AlvoFalso:
    """Só o que o executor usa para o cross-docking: pagina/ler/atualizar/apagar/flow/criar."""

    def __init__(self, armazem_do_flow):
        self.chamadas = 0
        self.t = {c: {} for c in EP}
        self.n = itertools.count(1)
        self.armazem_do_flow = armazem_do_flow  # onde o flow provisiona a baia (o "primeiro armazém da Entidade")
        self.flows = 0

    def _novo(self, conceito, **campos):
        i = f"{conceito}-{next(self.n)}"
        self.t[conceito][i] = {"id": i, **campos}
        return self.t[conceito][i]

    def pagina(self, conceito, **filtros):
        return [dict(r) for r in self.t[conceito].values() if all(r.get(k) == v for k, v in filtros.items())]

    def ler(self, ep, id_):
        r = self.t[CONCEITO[ep]].get(id_)
        return dict(r) if r else None

    def atualizar(self, ep, id_, corpo):
        if CONCEITO[ep] in ("Recebimento", "Expedicao"):  # o produto grava uma linha de histórico a cada PUT
            self._novo("HistoricoMovimentacao", movimentoId=self.t[CONCEITO[ep]][id_]["movimentoId"], evento="Armazenado")
        self.t[CONCEITO[ep]][id_].update(corpo)
        return dict(self.t[CONCEITO[ep]][id_])

    def apagar(self, ep, id_):
        return self.t[CONCEITO[ep]].pop(id_, None) is not None

    def criar(self, ep, corpo):
        return dict(self._novo(CONCEITO[ep], **corpo))

    def flow(self, nome, corpo):
        assert nome == "AtivarCrossDocking"
        self.flows += 1
        area = next((a for a in self.t["Area"].values() if a["armazemId"] == self.armazem_do_flow and a["funcao"] == "CrossDocking"), None)
        area = area or self._novo("Area", armazemId=self.armazem_do_flow, nome="Cross-Docking", funcao="CrossDocking")
        rua = next((r for r in self.t["Rua"].values() if r["areaId"] == area["id"]), None) or self._novo("Rua", areaId=area["id"], codigo="CD")
        baia = self._novo("LocalArmazenagem", ruaId=rua["id"], posicao=1, andar=1, situacao="Ocupado")
        linha = self._novo("CrossDocking", **corpo, situacao="Ativo", baiaLocalArmazenagemId=baia["id"])
        for c, campo in (("Recebimento", "recebimentoId"), ("Expedicao", "expedicaoId")):
            self.t[c][corpo[campo]]["crossDockingAtivo"] = True
        return {"conceptName": "CrossDocking", "id": linha["id"]}


def preparar(armazem_do_flow, concluir=True):
    """Um diário com o que as ordens e a topologia já criaram + as duas operações de cross-docking do plano mini."""
    f = fonte.carregar_arquivos(os.path.join(MINI, "pacote.json"), os.path.join(MINI, "rastro.json"))
    plano = planejador.planejar(f, mapa.carregar(), planejador.Opcoes(data="2026-11-10"))
    cd_ops = [o for o in plano.operacoes if o.tipo == "crossdocking"]
    assert len(cd_ops) == 1
    if not concluir:
        cd_ops[0].ate = "Ativo"
    alvo = AlvoFalso(armazem_do_flow)
    pasta = tempfile.mkdtemp()
    diario = Diario(os.path.join(pasta, "d.jsonl"), "falso", "p")
    for chave, conceito in (("rec:MINIord-IN-0003", "Recebimento"), ("exp:MINIord-OUT-0002", "Expedicao")):
        diario.anotar(chave, conceito, alvo._novo(conceito, crossDockingAtivo=False, movimentoId="mov-" + chave)["id"])
    diario.anotar("produto:MINI-P01", "Produto", "prod-1", True)
    alvo.t["Armazem"]["ARM-ESPELHO"] = {"id": "ARM-ESPELHO"}
    diario.anotar("armazem", "Armazem", "ARM-ESPELHO")
    area = alvo._novo("Area", armazemId="ARM-ESPELHO", nome="Cross-Docking", funcao="CrossDocking")
    diario.anotar("cd:area", "Area", area["id"])
    rua = alvo._novo("Rua", areaId=area["id"], codigo="CD")
    diario.anotar("cd:rua", "Rua", rua["id"])
    return alvo, diario, cd_ops[0], rua["id"]


def executar(alvo, diario, op):
    return Executor(alvo, mapa.carregar(), diario)._crossdocking(op)


class TestCrossDocking(unittest.TestCase):
    def test_baia_no_armazem_certo_quando_o_flow_acerta(self):
        alvo, diario, op, rua = preparar("ARM-ESPELHO")
        executar(alvo, diario, op)
        (baia,) = alvo.t["LocalArmazenagem"].values()
        self.assertEqual((baia["ruaId"], baia["posicao"]), (rua, 1))
        self.assertEqual(len(alvo.t["Area"]), 1)
        self.assertEqual(len(alvo.t["Rua"]), 1)

    def test_baia_movida_e_rua_area_do_flow_recolhidas_quando_o_flow_erra(self):
        alvo, diario, op, rua = preparar("ARM-OUTRO")
        executar(alvo, diario, op)
        (baia,) = alvo.t["LocalArmazenagem"].values()
        self.assertEqual(baia["ruaId"], rua, "a baia foi para a Rua CD do armazém desta exportação")
        self.assertEqual([a["armazemId"] for a in alvo.t["Area"].values()], ["ARM-ESPELHO"], "a Area do outro armazém foi apagada")
        self.assertEqual(list(alvo.t["Rua"]), [rua])

    def test_nao_apaga_rua_do_outro_armazem_que_tem_outras_baias(self):
        alvo, diario, op, rua = preparar("ARM-OUTRO")
        area = alvo._novo("Area", armazemId="ARM-OUTRO", nome="Cross-Docking", funcao="CrossDocking")
        rua_outra = alvo._novo("Rua", areaId=area["id"], codigo="CD")
        alvo._novo("LocalArmazenagem", ruaId=rua_outra["id"], posicao=1, andar=1, situacao="Ocupado")  # baia de outra exportação
        executar(alvo, diario, op)
        self.assertIn(rua_outra["id"], alvo.t["Rua"])
        self.assertIn(area["id"], alvo.t["Area"])

    def test_diario_baia_antes_da_linha_e_limpar_deixa_so_o_que_nao_e_nosso(self):
        alvo, diario, op, _ = preparar("ARM-OUTRO")
        executar(alvo, diario, op)
        chaves = [r["chave"] for r in diario.registros()]
        self.assertLess(chaves.index(op.extra["baia"]["chave"]), chaves.index(op.chave))
        antes = {c: set(alvo.t[c]) for c in ("Recebimento", "Expedicao")}
        res = limpar(alvo, mapa.carregar(), diario)  # apaga de trás para a frente, pulando compartilhados
        self.assertEqual(alvo.t["CrossDocking"], {})
        self.assertEqual(alvo.t["LocalArmazenagem"], {})
        self.assertEqual((alvo.t["Rua"], alvo.t["Area"]), ({}, {}))
        self.assertEqual({c: set(alvo.t[c]) for c in antes}, {c: set() for c in antes})  # rec/exp também eram do diário
        self.assertEqual(res["naoEncontrados"], 0)

    def test_concluido_apaga_as_flags_e_ativo_deixa_ligadas(self):
        alvo, diario, op, _ = preparar("ARM-ESPELHO")
        executar(alvo, diario, op)
        (cd,) = alvo.t["CrossDocking"].values()
        self.assertEqual(cd["situacao"], "Concluido")
        self.assertTrue(all(not d["crossDockingAtivo"] for c in ("Recebimento", "Expedicao") for d in alvo.t[c].values()))
        alvo, diario, op, _ = preparar("ARM-ESPELHO", concluir=False)
        executar(alvo, diario, op)
        (cd,) = alvo.t["CrossDocking"].values()
        self.assertEqual(cd["situacao"], "Ativo")
        self.assertTrue(all(d["crossDockingAtivo"] for c in ("Recebimento", "Expedicao") for d in alvo.t[c].values()))

    def test_a_escrita_das_flags_nao_deixa_linha_de_historico_a_mais(self):
        alvo, diario, op, _ = preparar("ARM-ESPELHO")
        alvo._novo("HistoricoMovimentacao", movimentoId="mov-rec:MINIord-IN-0003", evento="Armazenado")  # a linha de verdade
        executar(alvo, diario, op)
        self.assertEqual(len(alvo.t["HistoricoMovimentacao"]), 1)

    def test_repetir_nao_duplica(self):
        alvo, diario, op, _ = preparar("ARM-OUTRO")
        executar(alvo, diario, op)
        executar(alvo, diario, op)
        self.assertEqual((alvo.flows, len(alvo.t["CrossDocking"]), len(alvo.t["LocalArmazenagem"])), (1, 1, 1))

    def test_retomar_depois_de_cair_logo_depois_do_flow(self):
        """O flow criou a linha e a baia, mas o diário não chegou a saber: a retomada acha a linha pelo par e conclui."""
        alvo, diario, op, rua = preparar("ARM-OUTRO")
        corpo = diario.resolver(op.dados)
        alvo.flow("AtivarCrossDocking", corpo)           # a queda
        self.assertFalse(diario.tem(op.chave))
        executar(alvo, diario, op)
        self.assertEqual((alvo.flows, len(alvo.t["CrossDocking"]), len(alvo.t["LocalArmazenagem"])), (1, 1, 1))
        (baia,) = alvo.t["LocalArmazenagem"].values()
        self.assertEqual(baia["ruaId"], rua)
        self.assertTrue(diario.tem(op.chave) and diario.tem(op.extra["baia"]["chave"]))
        self.assertEqual(next(iter(alvo.t["CrossDocking"].values()))["situacao"], "Concluido")


if __name__ == "__main__":
    unittest.main()
