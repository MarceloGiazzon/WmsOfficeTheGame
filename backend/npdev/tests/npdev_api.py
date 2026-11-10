"""Helpers dos testes ao vivo contra o backend do jogo (stdlib apenas).

    api = Api.from_argv()          # --base/--user/--password, faz login
    api.create("sim_cenarios", {...})   # registra para limpeza
    api.check("nome", cond, detalhe)
    api.finish()                   # limpa tudo (ordem inversa) e sai com 0/1
"""
import argparse
import json
import sys
import urllib.error
import urllib.request


class Api:
    def __init__(self, base, user, password):
        self.base = base
        self.token = None
        self.failures = []
        self.created = []  # (endpoint, id) em ordem de criação
        st, res = self.call("POST", "auth/login", {"username": user, "password": password})
        if st != 200:
            raise SystemExit(f"login falhou: {st} {res}")
        self.token = res["token"]
        _, self.me = self.call("GET", "auth/me")

    @classmethod
    def from_argv(cls):
        p = argparse.ArgumentParser()
        p.add_argument("--base", default="http://localhost:8200")
        p.add_argument("--user", default="admin")
        p.add_argument("--password", default="Teste123!")
        a = p.parse_args()
        return cls(a.base, a.user, a.password)

    def call(self, method, path, body=None):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.base + "/api/" + path, data=data, method=method)
        req.add_header("Content-Type", "application/json")
        if self.token:
            req.add_header("Authorization", "Bearer " + self.token)
        try:
            with urllib.request.urlopen(req) as r:
                raw = r.read()
                return r.status, (json.loads(raw) if raw else None)
        except urllib.error.HTTPError as e:
            raw = e.read()
            try:
                return e.code, json.loads(raw)
            except ValueError:
                return e.code, raw.decode(errors="replace")

    def flow(self, name, body):
        """Executa /api/flows/<name>/execute. Devolve (status_http, envelope)."""
        return self.call("POST", f"flows/{name}/execute", body)

    def check(self, name, cond, detail=""):
        print(("  ok   " if cond else "  FAIL ") + name + ("" if cond else f"  -> {str(detail)[:400]}"))
        if not cond:
            self.failures.append(name)

    def create(self, endpoint, body):
        st, res = self.call("POST", endpoint, body)
        if st not in (200, 201):
            raise SystemExit(f"fixture {endpoint} falhou: {st} {res}")
        self.created.append((endpoint, res["id"]))
        return res

    def track(self, endpoint, id_):
        self.created.append((endpoint, id_))

    def expect_reject(self, name, method, path, body=None, why=None):
        """Exige 4xx e, se `why` for dado, que ele apareça no corpo (nome do invariant / código do erro)."""
        st, res = self.call(method, path, body)
        self.check(name, 400 <= st < 500 and (why is None or why in str(res)), f"{st} {str(res)[:200]}")
        if method == "POST" and st in (200, 201) and isinstance(res, dict) and "id" in res:
            self.created.append((path, res["id"]))
        return st

    def cleanup(self):
        for endpoint, id_ in reversed(self.created):
            self.call("DELETE", f"{endpoint}/{id_}")
        leftovers = [(e, i) for e, i in self.created if self.call("GET", f"{e}/{i}")[0] != 404]
        if leftovers:
            print(f"ATENCAO: registros nao removidos: {leftovers}")

    def run(self, fn):
        """Executa fn(api), limpa sempre e sai com o código certo."""
        try:
            fn(self)
        finally:
            self.cleanup()
        print(f"\n{'FALHOU' if self.failures else 'OK'}: {len(self.failures)} falha(s)")
        sys.exit(1 if self.failures else 0)
