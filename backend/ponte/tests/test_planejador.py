#!/usr/bin/env python3
"""Testes OFFLINE da ponte (sem servidor): preencher(), validar_rastro() e o planejador contra exemplos/mini/esperado.json.

Escritos ANTES do código (docs/ponte/PLANO.md, P0): definem a interface que mapa.py, fonte.py e planejador.py têm de
ter. Não mude um teste para fazê-lo passar — mude o código. Se a regra precisar mudar, mude JUNTOS: mapa.json,
exemplos/mini/esperado.json, este arquivo e o PLANO.

Uso (da raiz do repo):  python3 -m unittest discover -s backend/ponte/tests -p 'test_*.py' -v
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
ESPERADO = json.load(open(os.path.join(MINI, "esperado.json"), encoding="utf-8"))


def carregar_mini():
    return fonte.carregar_arquivos(os.path.join(MINI, "pacote.json"), os.path.join(MINI, "rastro.json"))


def planejar(ordens=None):
    return planejador.planejar(carregar_mini(), mapa.carregar(), planejador.Opcoes(data="2026-11-10", ordens=ordens))


def refs(valor):
    """Todas as chaves citadas em {"$ref": ...} dentro de `valor` (dict/list aninhados)."""
    if isinstance(valor, dict):
        if set(valor) == {"$ref"}:
            return [valor["$ref"]]
        return [r for v in valor.values() for r in refs(v)]
    if isinstance(valor, list):
        return [r for v in valor for r in refs(v)]
    return []


def textos(valor):
    if isinstance(valor, dict):
        return [t for v in valor.values() for t in textos(v)]
    if isinstance(valor, list):
        return [t for v in valor for t in textos(v)]
    return [valor] if isinstance(valor, str) else []


class TestPreencher(unittest.TestCase):
    def test_marcador_inteiro_mantem_o_tipo(self):
        self.assertEqual(mapa.preencher("{a.b}", {"a": {"b": 7}}), 7)
        self.assertIs(mapa.preencher("{x}", {"x": True}), True)

    def test_marcador_dentro_de_texto_formata(self):
        self.assertEqual(mapa.preencher("ordem {o.numero} · {n}", {"o": {"numero": "IN-1"}, "n": 3}), "ordem IN-1 · 3")

    def test_ref_tem_a_chave_preenchida(self):
        self.assertEqual(mapa.preencher({"$ref": "rua:{r.id}"}, {"r": {"id": "R9"}}), {"$ref": "rua:R9"})

    def test_dict_aninhado_e_literais(self):
        tpl = {"a": "{x}", "b": 1, "c": False, "d": {"$ref": "k:{x}"}, "e": "fixo"}
        self.assertEqual(mapa.preencher(tpl, {"x": "v"}), {"a": "v", "b": 1, "c": False, "d": {"$ref": "k:v"}, "e": "fixo"})

    def test_marcador_ausente_e_erro(self):
        with self.assertRaises(KeyError):
            mapa.preencher("{nao.existe}", {})

    def test_campo_que_vira_null_e_omitido(self):
        self.assertEqual(mapa.preencher({"a": "{x}", "b": 1}, {"x": None}), {"b": 1})

    def test_mapa_carrega_e_tem_as_secoes(self):
        m = mapa.carregar()
        for secao in ("compartilhados", "topologia", "cargaInicial", "entrada", "saida", "ocupacaoFinal", "situacaoFinal", "historico"):
            self.assertIn(secao, m["jogoParaCorporativo"], secao)
        self.assertEqual(mapa.endpoint(m, "MovimentoItemPosicao"), "movimento_item_posicaos")


class TestValidarRastro(unittest.TestCase):
    def setUp(self):
        self.f = carregar_mini()

    def invalido(self, mexer):
        r = copy.deepcopy(self.f.rastro)
        mexer(r)
        with self.assertRaises(ValueError):
            fonte.validar_rastro(r, self.f.pacote)

    def test_fixture_e_valida(self):
        fonte.validar_rastro(self.f.rastro, self.f.pacote)  # não lança

    def test_buraco_no_seq(self):
        self.invalido(lambda r: r["eventos"].pop(4))

    def test_formato_errado(self):
        self.invalido(lambda r: r.__setitem__("formato", "rastro-v0"))

    def test_picking_de_local_vazio(self):
        # o evento 4 é o Picking de OUT-0001; em t=29350 o local MINIrua02-P03-A1 ainda está vazio
        self.invalido(lambda r: r["eventos"][4].__setitem__("localId", "MINIrua02-P03-A1"))

    def test_putaway_em_local_ocupado(self):
        self.invalido(lambda r: r["eventos"][3].__setitem__("localId", "MINIrua01-P03-A1"))

    def test_ordem_inexistente(self):
        self.invalido(lambda r: r["eventos"][3].__setitem__("ordemId", "nao-existe"))

    def test_tempo_voltando(self):
        self.invalido(lambda r: r["eventos"][6].__setitem__("tSeg", 100))

    def test_ordem_concluida_duas_vezes(self):
        def mexer(r):
            dup = dict(r["eventos"][7], seq=len(r["eventos"]), tSeg=70000)
            r["eventos"].append(dup)
        self.invalido(mexer)


class TestResumo(unittest.TestCase):
    """O resumo do plano tem de bater com exemplos/mini/esperado.json."""

    def comparar(self, resumo, esp):
        self.assertEqual(resumo["criados"], esp["criados"])
        self.assertEqual(resumo["compartilhados"], esp["compartilhados"])
        for chave, estado in esp["estados"].items():
            self.assertEqual(resumo["estados"].get(chave), estado, chave)
        self.assertEqual(set(resumo["estados"]) - set(esp["estados"]), set(), "estados a mais no plano")
        for chave, qtd in esp["quantidades"].items():
            self.assertEqual(resumo["quantidades"].get(chave), qtd, chave)
        self.assertEqual(sorted((o["local"], o["lote"], o["quantidade"]) for o in resumo["ocupacao"]),
                         sorted((o["local"], o["lote"], o["quantidade"]) for o in esp["ocupacao"]))
        self.assertEqual(sorted(resumo["locaisOcupados"]), sorted(esp["locaisOcupados"]))
        self.assertEqual(set(resumo["historico"]), set(esp["historico"]))
        for mov, linhas in esp["historico"].items():
            self.assertEqual(sorted(map(tuple, resumo["historico"][mov])), sorted(map(tuple, linhas)), mov)
        self.assertEqual(sum(len(v) for v in resumo["historico"].values()), esp["totalHistorico"])

    def test_p0(self):
        self.comparar(planejar(set(ESPERADO["p0"]["ordens"])).resumo(), ESPERADO["p0"])

    def test_completo(self):
        self.comparar(planejar().resumo(), ESPERADO["completo"])


class TestOperacoes(unittest.TestCase):
    def setUp(self):
        self.ops = planejar().operacoes

    def op(self, chave, tipo="garantir"):
        achadas = [o for o in self.ops if o.chave == chave and o.tipo == tipo]
        self.assertEqual(len(achadas), 1, f"{tipo} {chave}: {len(achadas)} operações")
        return achadas[0]

    def test_tipos_validos(self):
        self.assertEqual({o.tipo for o in self.ops} - {"garantir", "avancar", "ocupacao", "situacao", "historico", "crossdocking"}, set())

    def test_chaves_garantir_unicas(self):
        chaves = [o.chave for o in self.ops if o.tipo in ("garantir", "ocupacao")]
        self.assertEqual(len(chaves), len(set(chaves)))

    def test_toda_ref_aponta_para_registro_ja_planejado(self):
        vistas = set()
        for o in self.ops:
            for r in refs(o.dados):
                self.assertIn(r, vistas, f"{o.tipo} {o.chave} cita {r} antes de ele existir")
            if o.tipo in ("garantir", "ocupacao"):
                vistas.add(o.chave)
            if o.tipo in ("avancar", "situacao", "historico"):
                self.assertIn(o.chave, vistas, f"{o.tipo} sobre {o.chave} antes de criá-lo")

    def test_nenhum_marcador_sobrou(self):
        for o in self.ops:
            for t in textos(o.dados):
                self.assertNotRegex(t, r"\{[a-zA-Z_.]+\}", f"{o.chave}: {t}")

    def test_finais_vem_no_fim(self):
        tipos = [o.tipo for o in self.ops]
        primeiro_final = min(i for i, t in enumerate(tipos) if t in ("ocupacao", "situacao", "historico"))
        self.assertTrue(all(t in ("ocupacao", "situacao", "historico") for t in tipos[primeiro_final:]))
        self.assertLess(max(i for i, t in enumerate(tipos) if t == "ocupacao"),
                        min(i for i, t in enumerate(tipos) if t == "situacao"))
        self.assertLess(max(i for i, t in enumerate(tipos) if t == "situacao"),
                        min(i for i, t in enumerate(tipos) if t == "historico"))

    def test_compartilhados(self):
        esc = self.op("entidade:escopo")
        self.assertTrue(esc.compartilhado)
        self.assertEqual(esc.buscarPor, {"nome": "WmsOffice: The Game", "tipo": "Estabelecimento"})
        self.assertEqual(self.op("produto:MINI-P01").buscarPor, {"codigo": "MINI-P01"})
        self.assertFalse(self.op("armazem").compartilhado)

    def test_observacao_e_validade(self):
        rec = self.op("rec:MINIord-IN-0001")
        self.assertEqual(rec.dados["observacao"],
                         "WmsOffice: The Game · partida 00000000 · ordem IN-0001 · política AbcProximidade · score 82,86")
        self.assertEqual(rec.dados["estagio"], "PreRecebimento")
        self.assertEqual(self.op("lote:MINIord-IN-0001").dados["dataValidade"], "2027-11-10")  # 365 dias (sem diasValidadePadrao)

    def test_avancos_em_ordem(self):
        avancos = [(o.chave, o.ate) for o in self.ops if o.tipo == "avancar" and o.chave in ("rec:MINIord-IN-0001", "mov:MINIord-IN-0001")]
        self.assertEqual(avancos, [("rec:MINIord-IN-0001", "Conferido"), ("mov:MINIord-IN-0001", "Concluido"),
                                   ("rec:MINIord-IN-0001", "Armazenado")])
        i_conferido = self.ops.index(next(o for o in self.ops if o.tipo == "avancar" and o.chave == "rec:MINIord-IN-0001"))
        i_pos = self.ops.index(self.op("pos:3"))
        self.assertLess(i_conferido, i_pos, "posições do recebimento vêm depois do Conferido")

    def test_entrada_incompleta_para_em_conferido(self):
        avancos = [o.ate for o in self.ops if o.tipo == "avancar" and o.chave == "rec:MINIord-IN-0002"]
        self.assertEqual(avancos, ["Conferido"])
        self.assertFalse([o for o in self.ops if o.tipo == "avancar" and o.chave == "mov:MINIord-IN-0002"])

    def test_cross_dock(self):
        self.assertIs(self.op("reclote:MINIord-IN-0003").dados["crossDocking"], True)
        dest, orig = self.op("pos:8:destino").dados, self.op("pos:8:origem").dados
        self.assertEqual((dest["papel"], dest["localArmazenagemId"], dest["loteId"]),
                         ("Destino", {"$ref": "local:MINIdocaOut-P01-A1"}, {"$ref": "lote:MINIord-IN-0003"}))
        self.assertEqual((orig["papel"], orig["localArmazenagemId"], orig["loteId"]),
                         ("Origem", {"$ref": "local:MINIdocaOut-P01-A1"}, {"$ref": "lote:MINIord-IN-0003"}))
        self.assertEqual(orig["movimentoItemId"], {"$ref": "item:MINIord-OUT-0002:lote:MINIord-IN-0003"})

    def test_crossdocking_liga_recebimento_e_expedicao(self):
        cd = self.op("cd:MINIord-IN-0003:MINIord-OUT-0002", "crossdocking")
        self.assertEqual(cd.conceito, "CrossDocking")
        self.assertEqual(cd.dados, {"recebimentoId": {"$ref": "rec:MINIord-IN-0003"}, "expedicaoId": {"$ref": "exp:MINIord-OUT-0002"},
                                    "produtoId": {"$ref": "produto:MINI-P01"}, "quantidade": 20, "dataAtivacao": "2026-11-10"})
        self.assertEqual(cd.ate, "Concluido")  # as duas ordens têm OrdemConcluida
        baia = cd.extra["baia"]
        self.assertEqual((baia["chave"], baia["dados"]["ruaId"], baia["dados"]["posicao"], baia["dados"]["andar"]),
                         ("cd:baia:MINIord-IN-0003:MINIord-OUT-0002", {"$ref": "cd:rua"}, 1, 1))
        area, rua = self.op("cd:area"), self.op("cd:rua")
        self.assertEqual((area.dados["funcao"], area.dados["armazemId"]), ("CrossDocking", {"$ref": "armazem"}))
        self.assertEqual((rua.dados["codigo"], rua.dados["areaId"]), ("CD", {"$ref": "cd:area"}))

    def test_crossdocking_vem_depois_dos_dois_documentos_e_antes_da_ocupacao(self):
        chaves = [o.chave for o in self.ops]
        i = chaves.index("cd:MINIord-IN-0003:MINIord-OUT-0002")
        self.assertGreater(i, max(chaves.index(k) for k in ("rec:MINIord-IN-0003", "exp:MINIord-OUT-0002")))
        self.assertGreater(i, max(j for j, o in enumerate(self.ops) if o.tipo == "avancar"))
        self.assertLess(i, min(j for j, o in enumerate(self.ops) if o.tipo == "ocupacao"))
        self.assertLess(chaves.index("cd:rua"), i)

    def test_crossdocking_so_com_as_duas_ordens(self):
        ops = planejar({"IN-0003"}).operacoes  # a saída OUT-0002 não está: não há par
        self.assertFalse([o for o in ops if o.tipo == "crossdocking" or o.chave.startswith("cd:")])

    def test_crossdocking_pode_ser_desligado(self):
        ops = planejador.planejar(carregar_mini(), mapa.carregar(), planejador.Opcoes(data="2026-11-10", crossdocking=False)).operacoes
        self.assertFalse([o for o in ops if o.tipo == "crossdocking" or o.chave.startswith("cd:")])
        # os documentos e a marca no RecebimentoLote continuam
        self.assertIn("reclote:MINIord-IN-0003", [o.chave for o in ops])

    def test_crossdocking_fica_ativo_se_uma_das_ordens_nao_concluiu(self):
        f = carregar_mini()
        f.rastro["eventos"] = [e for e in f.rastro["eventos"] if not (e["tipo"] == "OrdemConcluida" and e["ordemId"].endswith("OUT-0002"))]
        for i, e in enumerate(f.rastro["eventos"]):
            e["seq"] = i
        ops = planejador.planejar(f, mapa.carregar(), planejador.Opcoes(data="2026-11-10")).operacoes
        self.assertEqual(next(o for o in ops if o.tipo == "crossdocking").ate, "Ativo")

    def test_picking_usa_o_lote_que_estava_no_local(self):
        pos = self.op("pos:4").dados
        self.assertEqual(pos["loteId"], {"$ref": "lote:inicial:MINIprod02"})
        self.assertEqual(pos["papel"], "Origem")
        self.assertEqual(pos["quantidade"], 10)

    def test_determinismo(self):
        a = [o.como_dict() for o in planejar().operacoes]
        b = [o.como_dict() for o in planejar().operacoes]
        self.assertEqual(a, b)


if __name__ == "__main__":
    unittest.main()
