#!/usr/bin/env python3
"""Testes OFFLINE do modo ao vivo (T3.4): o planejador com Opcoes(ao_vivo=True) e o ritmo.

O modo ao vivo tem de produzir o MESMO resultado final que o modo em lote; só muda a ordem das operações (pelo tempo do
jogo) e a ocupação, que passa a ser atualizada a cada Putaway/Picking em vez de só no fim.
"""
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
PONTE = os.path.dirname(HERE)
sys.path.insert(0, PONTE)

import fonte  # noqa: E402
import mapa  # noqa: E402
import planejador  # noqa: E402
from aovivo import Ritmo  # noqa: E402
from test_planejador_ordem import fonte_saida_antes_da_entrada  # noqa: E402

MINI = os.path.join(PONTE, "exemplos", "mini")


def mini():
    return fonte.carregar_arquivos(os.path.join(MINI, "pacote.json"), os.path.join(MINI, "rastro.json"))


def plano(f, ao_vivo):
    return planejador.planejar(f, mapa.carregar(), planejador.Opcoes(data="2026-11-10", ao_vivo=ao_vivo)).operacoes


def refs(v):
    if isinstance(v, dict):
        return [v["$ref"]] if set(v) == {"$ref"} else [r for x in v.values() for r in refs(x)]
    return [r for x in v for r in refs(x)] if isinstance(v, list) else []


def final(ops):
    """O que sobra depois de executar `ops`: ocupação por (local, lote) e situação por local, o último valor de cada um."""
    ocup, situ = {}, {}
    for o in ops:
        if o.tipo == "ocupacao":
            ocup[o.chave] = o.dados["quantidade"]
        elif o.tipo == "situacao":
            situ[o.chave] = o.dados["situacao"]
    return ocup, situ


class Base:
    def fontes(self):
        raise NotImplementedError

    def setUp(self):
        self.lote, self.vivo = plano(self.fontes(), False), plano(self.fontes(), True)

    def test_mesmo_estado_final_que_o_modo_em_lote(self):
        (o1, s1), (o2, s2) = final(self.lote), final(self.vivo)
        self.assertEqual(o1, o2)
        for chave, estado in s2.items():
            self.assertEqual(s1[chave], estado, chave)
        # o que o modo em lote marca e o ao vivo não toca nunca saiu de Disponivel (o local não foi tocado)
        self.assertEqual({s1[c] for c in set(s1) - set(s2)} - {"Disponivel"}, set())

    def test_mesmas_operacoes_fora_a_ocupacao_e_a_situacao(self):
        def chaves(ops):
            return sorted((o.tipo, o.chave, o.ate) for o in ops if o.tipo not in ("ocupacao", "situacao"))
        self.assertEqual(chaves(self.lote), chaves(self.vivo))

    def test_o_tempo_nunca_volta(self):
        ts = [o.tSeg for o in self.vivo]
        self.assertTrue(all(t is not None for t in ts))
        self.assertEqual(ts, sorted(ts))

    def test_cada_registro_avanca_na_mesma_ordem_do_modo_em_lote(self):
        def avancos(ops):
            por = {}
            for o in ops:
                if o.tipo == "avancar":
                    por.setdefault(o.chave, []).append(o.ate)
            return por
        self.assertEqual(avancos(self.lote), avancos(self.vivo))

    def test_toda_ref_aponta_para_registro_ja_planejado(self):
        vistas = set()
        for o in self.vivo:
            for r in refs(o.dados) + refs(o.extra or {}):
                self.assertIn(r, vistas, f"{o.tipo} {o.chave} cita {r} antes de ele existir")
            if o.tipo in ("garantir", "ocupacao", "crossdocking"):
                vistas.add(o.chave)
                if o.extra:
                    vistas.add(o.extra["baia"]["chave"])
            if o.tipo in ("avancar", "situacao", "historico"):
                self.assertIn(o.chave, vistas, f"{o.tipo} sobre {o.chave} antes de criá-lo")

    def test_historico_e_a_ultima_coisa(self):
        tipos = [o.tipo for o in self.vivo]
        primeiro = tipos.index("historico")
        self.assertEqual(set(tipos[primeiro:]), {"historico"})


class TestMini(Base, unittest.TestCase):
    def fontes(self):
        return mini()

    def test_a_ocupacao_acompanha_os_eventos(self):
        # o palete da IN-0001 em R01-P01: a ocupação sobe no Putaway; o do estoque inicial em R02-P01 desce no Picking
        seq = [(o.tSeg, o.dados["quantidade"]) for o in self.vivo if o.tipo == "ocupacao" and o.chave.startswith("ocup:MINIrua02-P01-A1:")]
        self.assertEqual([q for _, q in seq], [10, 0])  # 10 caixas por palete do MINIprod02
        self.assertLess(seq[0][0], seq[1][0])

    def test_estoque_inicial_antes_do_turno(self):
        ini = [o for o in self.vivo if o.tipo == "ocupacao" and "lote:inicial" in o.chave][0]
        self.assertEqual(ini.tSeg, planejador.AO_VIVO_ANTES)

    def test_crossdocking_depois_dos_dois_documentos(self):
        chaves = [o.chave for o in self.vivo]
        i = chaves.index("cd:MINIord-IN-0003:MINIord-OUT-0002")
        ult = max(j for j, o in enumerate(self.vivo) if o.tipo == "avancar" and o.chave in ("rec:MINIord-IN-0003", "exp:MINIord-OUT-0002"))
        self.assertGreater(i, ult)


class TestSaidaAntesDaEntrada(Base, unittest.TestCase):
    def fontes(self):
        return fonte_saida_antes_da_entrada()

    def test_a_entrada_nasce_antes_da_saida_que_retira_o_lote_dela(self):
        chaves = [o.chave for o in self.vivo]
        self.assertLess(chaves.index("lote:IN-tarde"), chaves.index("item:OUT-cedo:lote:IN-tarde"))


class TestRitmo(unittest.TestCase):
    def rodar(self, velocidade, ts, t0=100):
        agora, dormidas = [0.0], []

        def dormir(s):
            dormidas.append(s)
            agora[0] += s
        r = Ritmo(t0, velocidade, relogio=lambda: agora[0], dormir=dormir)
        ops = [planejador.Operacao("garantir", "x", "Lote", tSeg=t) for t in ts]
        for o in ops:
            r(o)
        return dormidas, agora[0]

    def test_espera_o_tempo_do_jogo_dividido_pela_velocidade(self):
        dormidas, fim = self.rodar(10, [100, 150, 150, 200, 500])
        self.assertAlmostEqual(fim, 40.0)               # (500 - 100) / 10
        self.assertAlmostEqual(sum(dormidas), 40.0)
        self.assertAlmostEqual(dormidas[0], 5.0)

    def test_antes_do_turno_e_sem_tempo_nao_espera(self):
        dormidas, _ = self.rodar(10, [-1, None, 90, 100])
        self.assertEqual(dormidas, [])

    def test_o_historico_final_nao_espera(self):
        dormidas, _ = self.rodar(10, [150, planejador.AO_VIVO_DEPOIS])
        self.assertEqual(len(dormidas), 1)

    def test_atrasado_nao_dorme_e_nao_acumula(self):
        agora = [0.0]
        r = Ritmo(0, 1, relogio=lambda: agora[0], dormir=lambda s: self.fail("não devia dormir"))
        r(planejador.Operacao("garantir", "x", "Lote", tSeg=0))   # começa o relógio
        agora[0] = 100.0                                           # a execução demorou mais que o turno até aqui
        r(planejador.Operacao("garantir", "x", "Lote", tSeg=50))

    def test_velocidade_invalida(self):
        with self.assertRaises(ValueError):
            Ritmo(0, 0)


if __name__ == "__main__":
    unittest.main()
