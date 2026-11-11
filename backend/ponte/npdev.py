"""Cliente REST mínimo para um app NPDev (só biblioteca padrão).

Copia a lógica de backend/npdev/tests/npdev_api.py (Api.call), mas é um módulo próprio: aquele é helper de teste.
Contrato verificado ao vivo: docs/ponte/CONTRATO_REST.md.
"""
import json
import urllib.error
import urllib.parse
import urllib.request

TIMEOUT_SEG = 30
PAGINA = 1000


class ErroPonte(Exception):
    """Resposta inesperada do servidor. `corpo` é o que o servidor devolveu (para diagnóstico)."""

    def __init__(self, mensagem, status=None, corpo=None, metodo=None, caminho=None):
        self.mensagem, self.status, self.corpo = mensagem, status, corpo
        self.metodo, self.caminho = metodo, caminho
        super().__init__(mensagem)

    def __str__(self):
        partes = [self.mensagem]
        if self.metodo or self.caminho:
            partes.append(f"[{self.metodo or ''} {self.caminho or ''}]".replace("[ ", "["))
        if self.status is not None:
            partes.append(f"status {self.status}")
        if self.corpo is not None:
            texto = self.corpo if isinstance(self.corpo, str) else json.dumps(self.corpo, ensure_ascii=False)
            partes.append(f"corpo: {texto[:500]}")
        return " · ".join(partes)


class Cliente:
    def __init__(self, base, usuario, senha):
        self.base = base.rstrip("/")
        self.chamadas = 0
        self.token = None
        status, res = self.chamar("POST", "auth/login", {"username": usuario, "password": senha})
        if status != 200 or not isinstance(res, dict) or "token" not in res:
            raise ErroPonte("login falhou", status, res, "POST", "auth/login")
        self.token = res["token"]

    def chamar(self, metodo, caminho, corpo=None):
        """Uma chamada a /api/<caminho>. Devolve (status, json|None); 4xx/5xx também voltam (lendo o corpo do erro)."""
        dados = json.dumps(corpo).encode() if corpo is not None else None
        req = urllib.request.Request(f"{self.base}/api/{caminho}", data=dados, method=metodo)
        req.add_header("Content-Type", "application/json")
        if self.token:
            req.add_header("Authorization", "Bearer " + self.token)
        self.chamadas += 1
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT_SEG) as r:
                bruto = r.read()
                return r.status, (json.loads(bruto) if bruto else None)
        except urllib.error.HTTPError as e:
            bruto = e.read()
            try:
                return e.code, json.loads(bruto)
            except ValueError:
                return e.code, bruto.decode(errors="replace")
        except (urllib.error.URLError, OSError) as e:
            raise ErroPonte(f"não consegui falar com {self.base}: {e}", None, None, metodo, caminho) from e

    def _ok(self, metodo, caminho, corpo=None, aceitos=(200, 201)):
        status, res = self.chamar(metodo, caminho, corpo)
        if status not in aceitos:
            raise ErroPonte("resposta inesperada", status, res, metodo, caminho)
        return res

    def pagina(self, conceito, **filtros):
        """Todas as linhas de /concepts/<conceito>/page que casam com os filtros (igualdade), paginando.

        sort=id é obrigatório: sem ordem estável, páginas por offset repetem ou pulam linhas."""
        itens, n = [], 0
        while True:
            q = urllib.parse.urlencode({**filtros, "sort": "id", "direction": "asc", "offset": n, "limit": PAGINA})
            res = self._ok("GET", f"concepts/{conceito}/page?{q}", aceitos=(200,))
            novos = res["items"]
            itens.extend(novos)
            n += len(novos)
            if not res.get("hasMore"):
                return itens
            if not novos:
                raise ErroPonte("página vazia com hasMore=true", 200, res, "GET", f"concepts/{conceito}/page")

    def flow(self, nome, corpo):
        """Executa um flow; HTTP 200 com status != OK também é erro. Devolve o `output`."""
        status, res = self.chamar("POST", f"flows/{nome}/execute", corpo)
        if status != 200 or not isinstance(res, dict) or res.get("status") != "OK":
            raise ErroPonte(f"flow {nome} não deu certo", status, res, "POST", f"flows/{nome}/execute")
        return res.get("output")

    def criar(self, endpoint, corpo):
        return self._ok("POST", endpoint, corpo)

    def ler(self, endpoint, id_):
        status, res = self.chamar("GET", f"{endpoint}/{id_}")
        if status == 404:
            return None
        if status != 200:
            raise ErroPonte("resposta inesperada", status, res, "GET", f"{endpoint}/{id_}")
        return res

    def atualizar(self, endpoint, id_, corpo):
        return self._ok("PUT", f"{endpoint}/{id_}", corpo, aceitos=(200,))

    def apagar(self, endpoint, id_):
        status, res = self.chamar("DELETE", f"{endpoint}/{id_}")
        if status == 204:
            return True
        if status == 404:
            return False
        raise ErroPonte("não consegui apagar", status, res, "DELETE", f"{endpoint}/{id_}")
