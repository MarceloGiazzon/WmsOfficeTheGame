"""Diário de uma exportação: um arquivo JSONL que só cresce (PLANO §6.3).

Guarda, na ordem, cada registro que a exportação criou (ou achou, se compartilhado) no alvo. Serve para retomar uma
exportação interrompida (o que já está no diário não é criado de novo) e para `limpar` (apaga de trás para a frente).
"""
import json
import os
from datetime import datetime, timezone

VERSAO_MAPA = 1


class Diario:
    def __init__(self, caminho, alvo=None, partida_id=None, versao_mapa=VERSAO_MAPA):
        self.caminho = caminho
        self._por_chave = {}
        self._ordem = []
        if os.path.exists(caminho) and os.path.getsize(caminho) > 0:
            with open(caminho, encoding="utf-8") as f:
                for linha in f:
                    if not linha.strip():
                        continue
                    r = json.loads(linha)
                    if r.get("tipo") == "cabecalho":
                        self.cabecalho = r
                        continue
                    self._por_chave[r["chave"]] = r
                    self._ordem.append(r["chave"])
        else:
            os.makedirs(os.path.dirname(os.path.abspath(caminho)), exist_ok=True)
            self.cabecalho = {"tipo": "cabecalho", "alvo": alvo, "partidaId": partida_id,
                              "criadoEm": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "versaoMapa": versao_mapa}
            self._gravar(self.cabecalho)

    def _gravar(self, registro):
        with open(self.caminho, "a", encoding="utf-8") as f:
            f.write(json.dumps(registro, ensure_ascii=False) + "\n")
            f.flush()
            os.fsync(f.fileno())

    def tem(self, chave):
        return chave in self._por_chave

    def id(self, chave):
        return self._por_chave[chave]["id"]

    def conceito(self, chave):
        return self._por_chave[chave]["conceito"]

    def anotar(self, chave, conceito, id_, compartilhado=False):
        if chave in self._por_chave:
            raise ValueError(f"o diário já tem a chave {chave}")
        r = {"chave": chave, "conceito": conceito, "id": id_, "compartilhado": bool(compartilhado)}
        self._gravar(r)
        self._por_chave[chave] = r
        self._ordem.append(chave)

    def registros(self):
        return [self._por_chave[c] for c in self._ordem]

    def resolver(self, dados):
        """Troca cada {"$ref": chave} pelo id do registro no alvo (recursivo). KeyError se a chave não está no diário."""
        if isinstance(dados, dict):
            if set(dados) == {"$ref"}:
                return self.id(dados["$ref"])
            return {k: self.resolver(v) for k, v in dados.items()}
        if isinstance(dados, list):
            return [self.resolver(v) for v in dados]
        return dados

    def encerrar_limpo(self):
        """Depois de `limpar`: renomeia o arquivo para <id>.jsonl.limpo, para uma nova exportação começar do zero."""
        os.replace(self.caminho, self.caminho + ".limpo")
