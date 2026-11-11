"""Leitura de mapa.json e a função preencher() (docs/ponte/PLANO.md §5.3). Não fala com servidor."""
import json
import os
import re

AQUI = os.path.dirname(os.path.abspath(__file__))
_MARCADOR = re.compile(r"\{([a-zA-Z_][a-zA-Z0-9_.]*)\}")
_MARCADOR_INTEIRO = re.compile(r"\{([a-zA-Z_][a-zA-Z0-9_.]*)\}\Z")


def carregar(caminho=None):
    with open(caminho or os.path.join(AQUI, "mapa.json"), encoding="utf-8") as f:
        return json.load(f)


def endpoint(mapa, conceito):
    return mapa["conceitos"][conceito]["endpoint"]


def _valor(caminho, contexto):
    atual = contexto
    for parte in caminho.split("."):
        if not isinstance(atual, dict) or parte not in atual:
            raise KeyError(caminho)
        atual = atual[parte]
    return atual


def preencher(modelo, contexto):
    """Preenche os marcadores {a.b} de `modelo` com `contexto`.

    Marcador inteiro mantém o tipo; no meio de texto vira str(); {"$ref": modelo} tem a chave preenchida; campo de dict
    cujo valor final é None é omitido; marcador ausente = KeyError."""
    if isinstance(modelo, dict):
        if set(modelo) == {"$ref"}:
            return {"$ref": str(preencher(modelo["$ref"], contexto))}
        saida = {}
        for k, v in modelo.items():
            p = preencher(v, contexto)
            if p is not None:
                saida[k] = p
        return saida
    if isinstance(modelo, list):
        return [preencher(v, contexto) for v in modelo]
    if isinstance(modelo, str):
        inteiro = _MARCADOR_INTEIRO.match(modelo)
        if inteiro:
            return _valor(inteiro.group(1), contexto)
        return _MARCADOR.sub(lambda m: str(_valor(m.group(1), contexto)), modelo)
    return modelo
