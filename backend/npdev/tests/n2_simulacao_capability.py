#!/usr/bin/env python3
"""N2 — testes unitários da SimulacaoCapability (Java puro), sem servidor.

Compila a capability com javac, gera uma classe de teste com os casos embutidos como literais Java,
executa com `java` e compara com o esperado. Cobre:
  - calcularScore / validarScore contra tests/fixtures/score-cases.json (compartilhado com o TS);
  - gerarOrdens: determinismo, faixas, numeração e erros de entrada;
  - PRNG mulberry32 idêntico a uma referência JS executada com node (base de src/sim/rng.ts);
  - gate de bytecode do NPDev (o inspector real do kernel), que senão só falha no boot do app.

Uso: python3 backend/npdev/tests/n2_simulacao_capability.py
Requer JDK 17 (javac/java) e, para o check do PRNG, node.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "..", "definition", "capabilities", "simulacao", "src", "main", "java")
CAP = os.path.join(SRC, "com", "wmsofficethegame", "capabilities", "simulacao", "SimulacaoCapability.java")
FIXTURES = os.path.join(HERE, "fixtures", "score-cases.json")
# Mesmo inspector que o app gerado roda no boot (falha = B30:plugin_bytecode_violation).
KERNEL_JAR = os.path.join(os.environ.get("NPDEV_ROOT", os.path.expanduser("~/repos/NPDev")),
                          "Build", "runtimehost-libs", "kernel-0.1.0.jar")
GATE = r"""
import com.npdev.kernel.security.UntrustedExtensionBytecodeInspector;
import java.nio.file.Path;

public class Gate {
    public static void main(String[] files) throws Exception {
        UntrustedExtensionBytecodeInspector inspector = new UntrustedExtensionBytecodeInspector();
        for (String f : files) {
            UntrustedExtensionBytecodeInspector.BytecodeInspectionResult r = inspector.inspect(Path.of(f));
            System.out.println(Path.of(f).getFileName() + "\t" + r.passed() + "\t" + r.violations());
        }
    }
}
"""


def jdk_tool(name):
    found = shutil.which(name)
    if found:
        return found
    java = shutil.which("java")
    if java:
        cand = os.path.join(os.path.dirname(os.path.realpath(java)), name)
        if os.path.exists(cand):
            return cand
    raise SystemExit(f"{name} não encontrado")


def jlit(v):
    """Valor Python -> expressão Java (Map/List/Long/String/Boolean)."""
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "Boolean.TRUE" if v else "Boolean.FALSE"
    if isinstance(v, int):
        return f"Long.valueOf({v}L)"
    if isinstance(v, str):
        return json.dumps(v)
    if isinstance(v, list):
        return "lst(" + ", ".join(jlit(x) for x in v) + ")"
    if isinstance(v, dict):
        return "map(" + ", ".join(f"{json.dumps(k)}, {jlit(x)}" for k, x in v.items()) + ")"
    raise TypeError(v)


HARNESS = r"""
import com.wmsofficethegame.capabilities.simulacao.SimulacaoCapability;
import java.util.*;

public class Harness {
    static Map<String, Object> map(Object... kv) {
        Map<String, Object> m = new LinkedHashMap<>();
        for (int i = 0; i < kv.length; i += 2) m.put((String) kv[i], kv[i + 1]);
        return m;
    }
    static List<Object> lst(Object... xs) { return new ArrayList<>(Arrays.asList(xs)); }
    static String j(Object o) {
        if (o == null) return "null";
        if (o instanceof Map<?, ?> m) {
            StringBuilder sb = new StringBuilder("{");
            for (Map.Entry<?, ?> e : m.entrySet()) {
                if (sb.length() > 1) sb.append(",");
                sb.append(j(String.valueOf(e.getKey()))).append(":").append(j(e.getValue()));
            }
            return sb.append("}").toString();
        }
        if (o instanceof List<?> l) {
            StringBuilder sb = new StringBuilder("[");
            for (Object x : l) { if (sb.length() > 1) sb.append(","); sb.append(j(x)); }
            return sb.append("]").toString();
        }
        if (o instanceof String s) return "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
        return String.valueOf(o);
    }
    public static void main(String[] a) {
        SimulacaoCapability cap = new SimulacaoCapability();
        %BODY%
    }
}
"""


def main():
    fx = json.load(open(FIXTURES))
    body = []
    labels = []

    def emit(label, expr):
        labels.append(label)
        body.append(f"System.out.println(j({expr}));")

    for c in fx["casos"]:
        emit(("score", c), f"cap.calcularScore({jlit(c['metricas'])})")
        esperado = c["esperado"]["scoreCentesimos"]
        emit(("valida-ok", c), f"cap.validarScore({jlit({**c['metricas'], 'scoreCentesimos': esperado})})")
        emit(("valida-errado", c), f"cap.validarScore({jlit({**c['metricas'], 'scoreCentesimos': esperado - 1})})")
    for c in fx["invalidos"]:
        emit(("invalido", c), f"cap.calcularScore({jlit(c['metricas'])})")
        emit(("valida-invalido", c), f"cap.validarScore({jlit({**c['metricas'], 'scoreCentesimos': 5000})})")

    produtos = [{"produtoId": "A", "peso": 70}, {"produtoId": "B", "peso": 20}, {"produtoId": "C", "peso": 10}]
    base = {"seed": 42, "inicioTurnoSeg": 28800, "fimTurnoSeg": 64800, "qtdOrdens": 400,
            "slaMinSeg": 1800, "slaMaxSeg": 7200, "paletesMin": 1, "paletesMax": 4, "produtos": produtos}
    emit(("ordens", "seed42"), f"cap.gerarOrdens({jlit(base)})")
    emit(("ordens", "seed42-bis"), f"cap.gerarOrdens({jlit(base)})")
    emit(("ordens", "seed43"), f"cap.gerarOrdens({jlit({**base, 'seed': 43})})")
    emit(("ordens", "so-inbound"), f"cap.gerarOrdens({jlit({**base, 'percentualInboundCentesimos': 10000})})")
    emit(("ordens", "seed-negativo-grande"), f"cap.gerarOrdens({jlit({**base, 'seed': -9007199254740991})})")
    ruins = {
        "sem seed": {k: v for k, v in base.items() if k != "seed"},
        "turno invertido": {**base, "inicioTurnoSeg": 64800, "fimTurnoSeg": 28800},
        "qtd 0": {**base, "qtdOrdens": 0},
        "sla min > turno": {**base, "slaMinSeg": 40000, "slaMaxSeg": 40000},
        "sla max < min": {**base, "slaMaxSeg": 100},
        "sem produtos": {**base, "produtos": []},
        "peso 0": {**base, "produtos": [{"produtoId": "A", "peso": 0}]},
    }
    for nome, inp in ruins.items():
        emit(("ordens-erro", nome), f"cap.gerarOrdens({jlit(inp)})")
    seeds_prng = [0, 1, 42, -1, 2147483647, -2147483648, 123456789]
    for i, s in enumerate(seeds_prng):
        emit(("prng", s), "lst(" + ", ".join([f"(Object) Double.valueOf(rng{i}.next())"] * 5) + ")")
    # um Mulberry32 por seed, declarado antes do uso
    decls = [f"SimulacaoCapability.Mulberry32 rng{i} = new SimulacaoCapability.Mulberry32({s});"
             for i, s in enumerate(seeds_prng)]

    tmp = tempfile.mkdtemp(prefix="n2cap-")
    try:
        src = HARNESS.replace("%BODY%", "\n        ".join(decls + body))
        open(os.path.join(tmp, "Harness.java"), "w").write(src)
        out = os.path.join(tmp, "out")
        subprocess.run([jdk_tool("javac"), "-d", out, CAP, os.path.join(tmp, "Harness.java")], check=True)
        res = subprocess.run([jdk_tool("java"), "-cp", out, "Harness"], check=True, capture_output=True, text=True)
        gate = None
        if os.path.exists(KERNEL_JAR):
            gsrc = os.path.join(tmp, "Gate.java")
            open(gsrc, "w").write(GATE)
            subprocess.run([jdk_tool("javac"), "-cp", KERNEL_JAR, "-d", os.path.join(tmp, "gate"), gsrc], check=True)
            pkg = os.path.join(out, "com", "wmsofficethegame", "capabilities", "simulacao")
            gate = subprocess.run([jdk_tool("java"), "-cp", KERNEL_JAR + os.pathsep + os.path.join(tmp, "gate"), "Gate"]
                                  + [os.path.join(pkg, f) for f in sorted(os.listdir(pkg))],
                                  check=True, capture_output=True, text=True).stdout.splitlines()
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    results = [json.loads(line) for line in res.stdout.splitlines()]
    assert len(results) == len(labels), (len(results), len(labels))

    failures = []

    def check(name, cond, detail=""):
        print(("  ok   " if cond else "  FAIL ") + name + ("" if cond else f"  -> {detail}"))
        if not cond:
            failures.append(name)

    print("gate de bytecode do NPDev (UntrustedExtensionBytecodeInspector real)")
    if gate is None:
        print(f"  skip kernel jar ausente: {KERNEL_JAR}")
    for line in gate or []:
        nome, passou, violacoes = line.split("\t")
        check(f"{nome} passa no gate", passou == "true", violacoes)

    got = dict()
    print("calcularScore / validarScore")
    for (kind, ref), r in zip(labels, results):
        if kind == "score":
            exp = ref["esperado"]
            check(ref["nome"], r.get("sucesso") is True and r["scoreCentesimos"] == exp["scoreCentesimos"]
                  and r["penalidades"] == exp["penalidades"], f"esperado {exp}, obtido {r}")
        elif kind == "valida-ok":
            check("  validarScore aceita o score certo", r["valido"] is True
                  and r["scoreRecalculado"] == ref["esperado"]["scoreCentesimos"] and "avaliadoEm" in r, r)
        elif kind == "valida-errado":
            check("  validarScore recusa score -1 e devolve o recalculado", r["valido"] is False
                  and r["scoreRecalculado"] == ref["esperado"]["scoreCentesimos"], r)
        elif kind == "invalido":
            check("métrica inválida: " + ref["nome"], r.get("sucesso") is False and r.get("motivo"), r)
        elif kind == "valida-invalido":
            check("  validarScore com métrica inválida -> valido=false", r["valido"] is False
                  and r["sucesso"] is False, r)
        else:
            got[(kind, ref)] = r

    print("gerarOrdens")
    o42 = got[("ordens", "seed42")]
    ordens = o42["ordens"]
    check("seed 42 gera 400 ordens", o42["sucesso"] and len(ordens) == 400, o42.get("motivo"))
    check("determinístico (mesmo seed -> mesma saída)", o42 == got[("ordens", "seed42-bis")])
    check("seed diferente -> ordens diferentes", got[("ordens", "seed43")]["ordens"] != ordens)
    check("ordenadas por liberacaoSeg", [o["liberacaoSeg"] for o in ordens] == sorted(o["liberacaoSeg"] for o in ordens))
    check("liberação em [inicio, fim - slaMin]", all(28800 <= o["liberacaoSeg"] <= 64800 - 1800 for o in ordens))
    check("SLA em [1800, 7200]", all(1800 <= o["slaSeg"] <= 7200 for o in ordens))
    check("paletes em [1, 4]", all(1 <= o["quantidadePaletes"] <= 4 for o in ordens))
    ins = [o for o in ordens if o["tipo"] == "Inbound"]
    outs = [o for o in ordens if o["tipo"] == "Outbound"]
    check("numeração IN-0001.. e OUT-0001.. sequencial",
          [o["numero"] for o in ins] == [f"IN-{i:04d}" for i in range(1, len(ins) + 1)]
          and [o["numero"] for o in outs] == [f"OUT-{i:04d}" for i in range(1, len(outs) + 1)])
    check("mistura inbound/outbound ~50% (35%–65%)", 140 <= len(ins) <= 260, len(ins))
    freq = {p: sum(1 for o in ordens if o["produtoId"] == p) for p in "ABC"}
    check("frequência segue o peso (A > B > C)", freq["A"] > freq["B"] > freq["C"] > 0, freq)
    check("percentualInbound 100% -> só Inbound",
          all(o["tipo"] == "Inbound" for o in got[("ordens", "so-inbound")]["ordens"]))
    check("seed long fora de 32 bits é aceito", got[("ordens", "seed-negativo-grande")]["sucesso"] is True)
    for nome in ruins:
        r = got[("ordens-erro", nome)]
        check("entrada inválida recusada: " + nome, r["sucesso"] is False and r.get("motivo"), r)

    print("PRNG mulberry32 (Java x JS)")
    if shutil.which("node"):
        js = """
        function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);
        t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;}}
        const seeds=%s;console.log(JSON.stringify(seeds.map(s=>{const r=mulberry32(s);return[r(),r(),r(),r(),r()]})));
        """ % json.dumps(seeds_prng)
        ref = json.loads(subprocess.run(["node", "-e", js], check=True, capture_output=True, text=True).stdout)
        for s, exp in zip(seeds_prng, ref):
            check(f"seed {s}: 5 primeiros valores iguais", got[("prng", s)] == exp, f"java {got[('prng', s)]} js {exp}")
    else:
        print("  skip node ausente")

    print(f"\n{'FALHOU' if failures else 'OK'}: {len(failures)} falha(s)")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
