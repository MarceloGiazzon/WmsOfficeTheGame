#!/usr/bin/env python3
"""Testes OFFLINE do diário (docs/ponte/PLANO.md, T0.8)."""
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from diario import Diario  # noqa: E402


class TestDiario(unittest.TestCase):
    def setUp(self):
        self.pasta = tempfile.TemporaryDirectory()
        self.caminho = os.path.join(self.pasta.name, "sub", "d.jsonl")

    def tearDown(self):
        self.pasta.cleanup()

    def test_anotar_reabrir_mantem_a_ordem(self):
        d = Diario(self.caminho, "http://x", "p1")
        d.anotar("a", "Armazem", "id-a")
        d.anotar("b", "Area", "id-b")
        d.anotar("c", "Produto", "id-c", True)
        d2 = Diario(self.caminho)
        self.assertEqual([r["chave"] for r in d2.registros()], ["a", "b", "c"])
        self.assertTrue(d2.tem("b"))
        self.assertEqual(d2.id("c"), "id-c")
        self.assertTrue(d2.registros()[2]["compartilhado"])
        self.assertFalse(d2.registros()[0]["compartilhado"])

    def test_resolver_ref_aninhada(self):
        d = Diario(self.caminho)
        d.anotar("rua:1", "Rua", "UUID-R")
        d.anotar("area:1", "Area", "UUID-A")
        corpo = {"x": {"$ref": "rua:1"}, "n": 3, "lista": [{"$ref": "area:1"}, {"outro": {"$ref": "rua:1"}}]}
        self.assertEqual(d.resolver(corpo), {"x": "UUID-R", "n": 3, "lista": ["UUID-A", {"outro": "UUID-R"}]})

    def test_resolver_ref_desconhecida(self):
        d = Diario(self.caminho)
        with self.assertRaises(KeyError):
            d.resolver({"x": {"$ref": "nao:existe"}})

    def test_cabecalho_so_uma_vez(self):
        Diario(self.caminho, "http://x", "p1")
        Diario(self.caminho, "http://x", "p1").anotar("a", "Armazem", "1")
        Diario(self.caminho)
        with open(self.caminho, encoding="utf-8") as f:
            linhas = [json.loads(l) for l in f if l.strip()]
        self.assertEqual([l.get("tipo") for l in linhas], ["cabecalho", None])
        self.assertEqual(linhas[0]["alvo"], "http://x")
        self.assertEqual(linhas[0]["versaoMapa"], 1)

    def test_chave_repetida_e_erro(self):
        d = Diario(self.caminho)
        d.anotar("a", "Armazem", "1")
        with self.assertRaises(ValueError):
            d.anotar("a", "Armazem", "2")


if __name__ == "__main__":
    unittest.main()
