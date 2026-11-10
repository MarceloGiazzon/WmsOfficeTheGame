#!/usr/bin/env python3
"""Gera os seeds dos cenários do jogo (definition/seeds/cenario-*.json).

As ordens vêm da regra canônica — SimulacaoCapability.gerarOrdens, compilada e executada aqui com
javac/java — usando o mesmo seed gravado em SimCenario.seed. Rodar de novo gera arquivos idênticos.

Uso: python3 backend/npdev/tools/gerar_seeds_cenarios.py
"""
import json
import os
import shutil
import subprocess
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
DEF = os.path.join(HERE, "..", "definition")
CAP = os.path.join(DEF, "capabilities", "simulacao", "src", "main", "java", "com", "wmsofficethegame",
                   "capabilities", "simulacao", "SimulacaoCapability.java")

CENARIOS = [
    {
        "arquivo": "cenario-wh-a-pequeno.json",
        "prefixo": "WHA",
        "codigo": "WH-A-PEQUENO", "nome": "WH-A Pequeno", "dificuldade": "Facil",
        "seed": 20261110,
        "ruas": 4, "posicoes": 12, "andares": 1,
        "docasIn": 2, "docasOut": 2, "equipamentos": 3, "velocidade": 220, "descarga": 300,
        "produtos": [40, 30, 25, 12, 10, 8, 7, 4, 3, 3, 2, 2],
        "ordens": {"qtdOrdens": 60, "slaMinSeg": 1800, "slaMaxSeg": 5400, "paletesMin": 1, "paletesMax": 3},
    },
    {
        "arquivo": "cenario-wh-b-mega.json",
        "prefixo": "WHB",
        "codigo": "WH-B-MEGA", "nome": "WH-B Mega", "dificuldade": "Dificil",
        "seed": 20261111,
        "ruas": 12, "posicoes": 30, "andares": 4,
        "docasIn": 4, "docasOut": 4, "equipamentos": 8, "velocidade": 220, "descarga": 300,
        # curva ABC: peso ~ 100 / i^1.1 (os primeiros ~20% concentram ~60% das saídas)
        "produtos": [max(1, round(100 / i ** 1.1)) for i in range(1, 31)],
        "ordens": {"qtdOrdens": 400, "slaMinSeg": 1800, "slaMaxSeg": 7200, "paletesMin": 1, "paletesMax": 4},
    },
]
TURNO = (28800, 64800)  # 08:00–18:00


def jdk_tool(name):
    found = shutil.which(name)
    if found:
        return found
    java = shutil.which("java")
    cand = os.path.join(os.path.dirname(os.path.realpath(java)), name) if java else ""
    if cand and os.path.exists(cand):
        return cand
    raise SystemExit(f"{name} não encontrado")


def gerar_ordens(entradas):
    """Executa SimulacaoCapability.gerarOrdens para cada entrada (dict com valores int/str/list de dicts)."""
    def lit(v):
        if isinstance(v, bool):
            return "Boolean.TRUE" if v else "Boolean.FALSE"
        if isinstance(v, int):
            return f"Long.valueOf({v}L)"
        if isinstance(v, str):
            return json.dumps(v)
        if isinstance(v, list):
            return "new ArrayList<Object>(Arrays.asList(" + ", ".join(lit(x) for x in v) + "))"
        if isinstance(v, dict):
            return "m(" + ", ".join(f"{json.dumps(k)}, {lit(x)}" for k, x in v.items()) + ")"
        raise TypeError(v)

    corpo = "\n".join(f"        System.out.println(j(cap.gerarOrdens({lit(e)})));" for e in entradas)
    src = """
import com.wmsofficethegame.capabilities.simulacao.SimulacaoCapability;
import java.util.*;
public class Gen {
    static Map<String, Object> m(Object... kv) {
        Map<String, Object> r = new LinkedHashMap<>();
        for (int i = 0; i < kv.length; i += 2) r.put((String) kv[i], kv[i + 1]);
        return r;
    }
    static String j(Object o) {
        if (o == null) return "null";
        if (o instanceof Map<?, ?> mp) {
            StringJoiner sj = new StringJoiner(",", "{", "}");
            for (Map.Entry<?, ?> e : mp.entrySet()) sj.add(j(String.valueOf(e.getKey())) + ":" + j(e.getValue()));
            return sj.toString();
        }
        if (o instanceof List<?> l) {
            StringJoiner sj = new StringJoiner(",", "[", "]");
            for (Object x : l) sj.add(j(x));
            return sj.toString();
        }
        if (o instanceof String s) return "\\"" + s.replace("\\\\", "\\\\\\\\").replace("\\"", "\\\\\\"") + "\\"";
        return String.valueOf(o);
    }
    public static void main(String[] a) {
        SimulacaoCapability cap = new SimulacaoCapability();
%s
    }
}
""" % corpo
    tmp = tempfile.mkdtemp(prefix="seedgen-")
    try:
        open(os.path.join(tmp, "Gen.java"), "w").write(src)
        out = os.path.join(tmp, "out")
        subprocess.run([jdk_tool("javac"), "-d", out, CAP, os.path.join(tmp, "Gen.java")], check=True)
        res = subprocess.run([jdk_tool("java"), "-cp", out, "Gen"], check=True, capture_output=True, text=True)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    saidas = [json.loads(line) for line in res.stdout.splitlines()]
    for s in saidas:
        if not s.get("sucesso"):
            raise SystemExit(f"gerarOrdens falhou: {s}")
    return [s["ordens"] for s in saidas]


def montar(c, ordens):
    p = c["prefixo"]
    R = []

    def rec(concept, data, alias=None):
        r = {"concept": concept, "data": data}
        if alias:
            r = {"alias": alias, **r}
        R.append(r)

    rec("Entidade", {"nome": f"{c['nome']} (jogo)", "tipo": "Estabelecimento", "ativo": True}, f"{p}entidade")
    rec("Armazem", {"entidadeId": f"$ref:{p}entidade", "nome": c["nome"], "ativo": True}, f"{p}armazem")
    # SimCenario logo depois do Armazem: seeds NÃO são transacionais e codigo é unique, então rodar o seed
    # de novo falha aqui, deixando no máximo Entidade+Armazem órfãos (use tools/semear_cenarios.py).
    rec("SimCenario", {"codigo": c["codigo"], "nome": c["nome"], "dificuldade": c["dificuldade"],
                       "armazemId": f"$ref:{p}armazem", "seed": c["seed"],
                       "qtdDocasInbound": c["docasIn"], "qtdDocasOutbound": c["docasOut"],
                       "qtdEquipamentos": c["equipamentos"], "velocidadeEquipamentoCmS": c["velocidade"],
                       "tempoDescargaSeg": c["descarga"], "inicioTurnoSeg": TURNO[0], "fimTurnoSeg": TURNO[1],
                       "ativo": True}, f"{p}cenario")
    for area, funcao in [("Recebimento", "Recebimento"), ("Expedicao", "Expedicao"), ("Armazenagem", "Armazenagem")]:
        rec("Area", {"armazemId": f"$ref:{p}armazem", "nome": f"Area {area}", "funcao": funcao, "ativo": True},
            f"{p}area{area}")

    def rua(alias, area, codigo, posicoes, andares):
        rec("Rua", {"areaId": f"$ref:{p}area{area}", "codigo": codigo, "qtdPosicoes": posicoes, "qtdAndares": andares,
                    "ativo": True}, alias)
        R.append({"concept": "LocalArmazenagem",
                  "repeatOver": {"vars": {"posicao": [1, posicoes], "andar": [1, andares]}},
                  "data": {"ruaId": f"$ref:{alias}", "posicao": "$posicao", "andar": "$andar",
                           "situacao": "Disponivel"}})

    # Docas: uma rua por área, uma posição por doca (o cliente desenha as docas a partir delas).
    rua(f"{p}docaIn", "Recebimento", "DOCA-IN", c["docasIn"], 1)
    rua(f"{p}docaOut", "Expedicao", "DOCA-OUT", c["docasOut"], 1)
    for i in range(1, c["ruas"] + 1):
        rua(f"{p}rua{i:02d}", "Armazenagem", f"R{i:02d}", c["posicoes"], c["andares"])

    # Perfil + ranking de ruas (política WmsReal): R01 é a mais próxima da expedição.
    rec("PerfilAlocacao", {"nome": f"{c['nome']} - Perfil padrao", "ocupacaoIdealPercent": 80, "ativo": True},
        f"{p}perfil")
    for i in range(1, c["ruas"] + 1):
        rec("RankingRua", {"perfilAlocacaoId": f"$ref:{p}perfil", "ruaId": f"$ref:{p}rua{i:02d}", "prioridade": i})

    for i, peso in enumerate(c["produtos"], start=1):
        classe = "A" if i <= max(1, round(len(c["produtos"]) * 0.2)) else (
            "B" if i <= round(len(c["produtos"]) * 0.5) else "C")
        rec("Produto", {"nome": f"{p} Produto {i:02d} (classe {classe}, peso {peso})", "codigo": f"{p}-P{i:02d}",
                        "qtdCaixasPorPallet": 10 * (1 + i % 4), "perfilAlocacaoId": f"$ref:{p}perfil",
                        "ativo": True}, f"{p}prod{i:02d}")

    for o in ordens:
        rec("SimOrdem", {"cenarioId": f"$ref:{p}cenario", "numero": o["numero"], "tipo": o["tipo"],
                         "liberacaoSeg": o["liberacaoSeg"], "slaSeg": o["slaSeg"],
                         "produtoId": f"$ref:{o['produtoId']}", "quantidadePaletes": o["quantidadePaletes"]})

    locais = (c["docasIn"] + c["docasOut"] + c["ruas"] * c["posicoes"] * c["andares"])
    entradas = sum(1 for o in ordens if o["tipo"] == "Inbound")
    return {
        "id": os.path.splitext(c["arquivo"])[0],
        "label": f"Cenario {c['codigo']}",
        "description": (f"WmsOffice: The Game — cenario {c['codigo']} ({c['dificuldade']}): {c['ruas']} ruas x "
                        f"{c['posicoes']} posicoes x {c['andares']} andar(es) + {c['docasIn']}+{c['docasOut']} docas "
                        f"({locais} locais), {len(c['produtos'])} produtos (curva ABC), {len(ordens)} ordens "
                        f"({entradas} inbound) geradas por SimulacaoCapability.gerarOrdens com seed {c['seed']}. "
                        "Gerado por backend/npdev/tools/gerar_seeds_cenarios.py -- nao editar a mao."),
        "kind": "smart",
        "records": R,
    }


def main():
    entradas = []
    for c in CENARIOS:
        produtos = [{"produtoId": f"{c['prefixo']}prod{i:02d}", "peso": w} for i, w in enumerate(c["produtos"], 1)]
        entradas.append({"seed": c["seed"], "inicioTurnoSeg": TURNO[0], "fimTurnoSeg": TURNO[1],
                         "percentualInboundCentesimos": 5000, **c["ordens"], "produtos": produtos})
    for c, ordens in zip(CENARIOS, gerar_ordens(entradas)):
        seed = montar(c, ordens)
        caminho = os.path.join(DEF, "seeds", c["arquivo"])
        with open(caminho, "w") as f:
            f.write("{\n")
            for k in ("id", "label", "description", "kind"):
                f.write(f"  {json.dumps(k)}: {json.dumps(seed[k], ensure_ascii=False)},\n")
            f.write('  "records": [\n')
            f.write(",\n".join("    " + json.dumps(r, ensure_ascii=False) for r in seed["records"]))
            f.write("\n  ]\n}\n")
        print(f"{caminho}: {len(seed['records'])} registros, {len(ordens)} ordens")


if __name__ == "__main__":
    main()
