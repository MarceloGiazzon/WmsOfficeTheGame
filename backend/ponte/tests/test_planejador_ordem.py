#!/usr/bin/env python3
"""Testes OFFLINE (extras): a ordem de processamento quando uma saída é liberada ANTES da entrada que lhe dá os paletes.

Caso real (WH-B, T1.10): a saída espera estoque, a entrada chega depois e a saída retira o palete dela. Ordenar só por
liberacaoSeg faria o item da saída citar um lote que ainda não existe. Não altera test_planejador.py (que continua valendo).
Uso: python3 -m unittest discover -s backend/ponte/tests -p 'test_*.py' -v
"""
import copy
import json
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
PONTE = os.path.dirname(HERE)
sys.path.insert(0, PONTE)

import fonte  # noqa: E402
import mapa  # noqa: E402
import planejador  # noqa: E402

MINI = os.path.join(PONTE, "exemplos", "mini")


def fonte_saida_antes_da_entrada():
    pacote = json.load(open(os.path.join(MINI, "pacote.json"), encoding="utf-8"))
    pacote["ordens"] = [
        {"id": "OUT-cedo", "numero": "OUT-0001", "tipo": "Outbound", "liberacaoSeg": 28900, "slaSeg": 3600, "produtoId": "MINIprod01", "quantidadePaletes": 1},
        {"id": "IN-tarde", "numero": "IN-0001", "tipo": "Inbound", "liberacaoSeg": 29500, "slaSeg": 3600, "produtoId": "MINIprod01", "quantidadePaletes": 1},
    ]
    base = {"ordemSaidaId": None, "localDestinoId": None}
    eventos = [
        {"seq": 0, "tipo": "Putaway", "tSeg": 30000, "ordemId": "IN-tarde", "produtoId": "MINIprod01", "localId": "MINIrua01-P01-A1", **base},
        {"seq": 1, "tipo": "OrdemConcluida", "tSeg": 30000, "ordemId": "IN-tarde", "produtoId": None, "localId": None, **base},
        {"seq": 2, "tipo": "Picking", "tSeg": 30100, "ordemId": "OUT-cedo", "produtoId": "MINIprod01", "localId": "MINIrua01-P01-A1", **base},
        {"seq": 3, "tipo": "OrdemConcluida", "tSeg": 30200, "ordemId": "OUT-cedo", "produtoId": None, "localId": None, **base},
    ]
    rastro = {"formato": "rastro-v1", "partidaId": "00000000-0000-4000-8000-0000000000aa", "cenarioId": "MINIcenario",
              "cenarioCodigo": "MINI", "versaoMotor": "0.3.0", "politicaInicial": "AbcProximidade", "eventos": eventos}
    fonte.validar_pacote(pacote)
    fonte.validar_rastro(rastro, pacote)
    return fonte.Fonte(pacote, rastro)


class TestOrdemDeProcessamento(unittest.TestCase):
    def setUp(self):
        self.ops = planejador.planejar(fonte_saida_antes_da_entrada(), mapa.carregar(),
                                       planejador.Opcoes(data="2026-11-10")).operacoes

    def indice(self, chave, tipo="garantir"):
        return next(i for i, o in enumerate(self.ops) if o.chave == chave and o.tipo == tipo)

    def test_a_entrada_vem_antes_da_saida_que_retira_o_lote_dela(self):
        self.assertLess(self.indice("lote:IN-tarde"), self.indice("item:OUT-cedo:lote:IN-tarde"))
        self.assertLess(self.indice("mov:IN-tarde"), self.indice("mov:OUT-cedo"))

    def test_toda_ref_aponta_para_registro_ja_planejado(self):
        vistas = set()

        def refs(v):
            if isinstance(v, dict):
                return [v["$ref"]] if set(v) == {"$ref"} else [r for x in v.values() for r in refs(x)]
            return [r for x in v for r in refs(x)] if isinstance(v, list) else []

        for o in self.ops:
            for r in refs(o.dados):
                self.assertIn(r, vistas, f"{o.tipo} {o.chave} cita {r} antes de ele existir")
            if o.tipo in ("garantir", "ocupacao"):
                vistas.add(o.chave)

    def test_sem_dependencia_a_ordem_continua_sendo_por_liberacao(self):
        # no mini, OUT-0001 depende só do estoque inicial: a ordem por (liberacaoSeg, numero) não muda
        f = fonte.carregar_arquivos(os.path.join(MINI, "pacote.json"), os.path.join(MINI, "rastro.json"))
        ops = planejador.planejar(f, mapa.carregar(), planejador.Opcoes(data="2026-11-10")).operacoes
        movs = [o.chave for o in ops if o.tipo == "garantir" and o.conceito == "Movimento"]
        self.assertEqual(movs, ["mov:inicial", "mov:MINIord-IN-0001", "mov:MINIord-OUT-0001", "mov:MINIord-IN-0003",
                                "mov:MINIord-OUT-0002", "mov:MINIord-IN-0002"])


if __name__ == "__main__":
    unittest.main()
