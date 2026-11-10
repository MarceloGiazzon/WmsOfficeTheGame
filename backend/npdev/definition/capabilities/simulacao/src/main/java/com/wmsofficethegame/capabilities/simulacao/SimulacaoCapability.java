package com.wmsofficethegame.capabilities.simulacao;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Regras canônicas do WmsOffice: The Game (fase N2 do docs/PLANO.md).
 *
 * <p>Restrição do NPDev: o bytecode passa por um denylist na geração e no boot (sem lambdas/method
 * references, java.io, java.net, reflection, threads...). Use classes anônimas.
 *
 * <p>Java puro, sem estado e sem acesso a banco: o chamador (flow/procedure) envia tudo no corpo.
 * Tudo em inteiros escalados (D6): distâncias em cm, tempos em segundos, percentuais e score em
 * centésimos (0–10000).
 *
 * <p>Fórmula oficial do score (README §6, com o teto de 100 decidido em 2026-11-10):
 * <pre>
 *   P_dist     = min(35, max(0, (D_real − D_teorico) / D_teorico) × 35)
 *   P_atraso   = (atrasadas / total) × 40
 *   P_conflito = min(15, eventos × 1,5)
 *   B_ocup     = 5 se 75% ≤ ocupação ≤ 88%, senão 0
 *   E          = min(100, max(0, 100 − (P_dist + P_atraso + P_conflito)) + B_ocup)
 * </pre>
 * Cada termo é calculado em centésimos com arredondamento "meio para cima". Se D_teorico = 0,
 * P_dist = 0 quando D_real = 0 e o máximo (35) caso contrário.
 *
 * <p>O cliente TS (src/sim/score.ts) implementa a mesma fórmula; os casos de referência ficam em
 * backend/npdev/tests/fixtures/score-cases.json e valem para os dois lados.
 */
public final class SimulacaoCapability {

    static final long MAX_SCORE = 10_000L;
    static final long MAX_P_DIST = 3_500L;
    static final long PESO_ATRASO = 4_000L;
    static final long MAX_P_CONFLITO = 1_500L;
    static final long P_POR_CONFLITO = 150L;
    static final long BONUS_OCUPACAO = 500L;
    static final long OCUPACAO_MIN = 7_500L;
    static final long OCUPACAO_MAX = 8_800L;

    // ------------------------------------------------------------------------------------------
    // calcularScore
    // ------------------------------------------------------------------------------------------

    /**
     * Entrada: {@code distanciaRealCm, distanciaTeoricaCm, ordensTotal, ordensAtrasadas,
     * eventosConflito, ocupacaoFinalCentesimos}.
     * Saída: {@code sucesso, scoreCentesimos, penalidades{distancia, atraso, conflito, bonusOcupacao}}
     * ou {@code sucesso=false, motivo}.
     */
    public Map<String, Object> calcularScore(Map<String, Object> input) {
        String erro = validarMetricas(input);
        if (erro != null) {
            return failure(erro);
        }
        long dReal = toLong(input.get("distanciaRealCm"));
        long dTeorica = toLong(input.get("distanciaTeoricaCm"));
        long total = toLong(input.get("ordensTotal"));
        long atrasadas = toLong(input.get("ordensAtrasadas"));
        long conflitos = toLong(input.get("eventosConflito"));
        long ocupacao = toLong(input.get("ocupacaoFinalCentesimos"));

        long pDist;
        if (dTeorica == 0) {
            pDist = dReal == 0 ? 0 : MAX_P_DIST;
        } else {
            long excesso = Math.max(0, dReal - dTeorica);
            pDist = Math.min(MAX_P_DIST, divRound(excesso * MAX_P_DIST, dTeorica));
        }
        long pAtraso = divRound(atrasadas * PESO_ATRASO, total);
        long pConflito = Math.min(MAX_P_CONFLITO, conflitos * P_POR_CONFLITO);
        long bOcup = (ocupacao >= OCUPACAO_MIN && ocupacao <= OCUPACAO_MAX) ? BONUS_OCUPACAO : 0;
        long score = Math.min(MAX_SCORE, Math.max(0, MAX_SCORE - (pDist + pAtraso + pConflito)) + bOcup);

        Map<String, Object> penalidades = new LinkedHashMap<>();
        penalidades.put("distancia", pDist);
        penalidades.put("atraso", pAtraso);
        penalidades.put("conflito", pConflito);
        penalidades.put("bonusOcupacao", bOcup);

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("sucesso", true);
        result.put("scoreCentesimos", score);
        result.put("penalidades", penalidades);
        return result;
    }

    // ------------------------------------------------------------------------------------------
    // validarScore
    // ------------------------------------------------------------------------------------------

    /**
     * Entrada: as métricas de {@link #calcularScore} + {@code scoreCentesimos} informado pelo cliente.
     * Saída: {@code sucesso, valido, scoreCliente, scoreRecalculado, penalidades, avaliadoEm}.
     * {@code valido} = métricas consistentes e score do cliente igual ao recalculado. O score que vale
     * é sempre {@code scoreRecalculado}; {@code avaliadoEm} (UTC, ISO-8601) é o horário do servidor.
     */
    public Map<String, Object> validarScore(Map<String, Object> input) {
        Map<String, Object> calculo = calcularScore(input);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("avaliadoEm", Instant.now().truncatedTo(ChronoUnit.SECONDS).toString());
        if (!Boolean.TRUE.equals(calculo.get("sucesso"))) {
            result.put("sucesso", false);
            result.put("valido", false);
            result.put("motivo", calculo.get("motivo"));
            return result;
        }
        Object informado = input.get("scoreCentesimos");
        long recalculado = toLong(calculo.get("scoreCentesimos"));
        boolean valido = informado != null && toLong(informado) == recalculado;
        result.put("sucesso", true);
        result.put("valido", valido);
        result.put("scoreCliente", informado == null ? null : toLong(informado));
        result.put("scoreRecalculado", recalculado);
        result.put("penalidades", calculo.get("penalidades"));
        result.put("motivo", valido ? "Score confere com o recalculado no servidor"
                : "Score informado difere do recalculado; vale o recalculado");
        return result;
    }

    // ------------------------------------------------------------------------------------------
    // gerarOrdens
    // ------------------------------------------------------------------------------------------

    /**
     * Gera as ordens canônicas de um cenário, de forma determinística a partir do seed.
     *
     * <p>Entrada: {@code seed} (long), {@code inicioTurnoSeg}, {@code fimTurnoSeg}, {@code qtdOrdens},
     * {@code percentualInboundCentesimos} (default 5000), {@code slaMinSeg}/{@code slaMaxSeg}
     * (default 1800/7200), {@code paletesMin}/{@code paletesMax} (default 1/4) e
     * {@code produtos: [{produtoId, peso}]} — o peso (inteiro &gt; 0) é a frequência relativa; produtos
     * com peso alto viram a classe A da curva ABC.
     *
     * <p>Saída: {@code sucesso, ordens: [{numero, tipo, liberacaoSeg, slaSeg, produtoId,
     * quantidadePaletes}]}, ordenadas por liberação; números {@code IN-0001…} / {@code OUT-0001…}.
     * A liberação cai em [inicioTurno, fimTurno − slaMin].
     *
     * <p>PRNG: mulberry32 sobre os 32 bits baixos do seed — o mesmo de src/sim/rng.ts.
     */
    @SuppressWarnings("unchecked")
    public Map<String, Object> gerarOrdens(Map<String, Object> input) {
        long inicio = toLong(input.get("inicioTurnoSeg"));
        long fim = toLong(input.get("fimTurnoSeg"));
        long qtd = toLong(input.get("qtdOrdens"));
        long pctInbound = longOr(input.get("percentualInboundCentesimos"), 5_000);
        long slaMin = longOr(input.get("slaMinSeg"), 1_800);
        long slaMax = longOr(input.get("slaMaxSeg"), 7_200);
        long palMin = longOr(input.get("paletesMin"), 1);
        long palMax = longOr(input.get("paletesMax"), 4);
        List<Map<String, Object>> produtos = (List<Map<String, Object>>) input.get("produtos");

        if (input.get("seed") == null) {
            return failure("seed obrigatorio");
        }
        if (fim <= inicio || inicio < 0 || fim > 86_400) {
            return failure("turno invalido: exige 0 <= inicioTurnoSeg < fimTurnoSeg <= 86400");
        }
        if (qtd <= 0 || qtd > 9_999) {
            return failure("qtdOrdens deve estar entre 1 e 9999");
        }
        if (pctInbound < 0 || pctInbound > 10_000) {
            return failure("percentualInboundCentesimos deve estar entre 0 e 10000");
        }
        if (slaMin <= 0 || slaMax < slaMin || slaMin > fim - inicio) {
            return failure("SLA invalido: exige 0 < slaMinSeg <= slaMaxSeg e slaMinSeg <= duracao do turno");
        }
        if (palMin <= 0 || palMax < palMin) {
            return failure("paletes invalidos: exige 0 < paletesMin <= paletesMax");
        }
        if (produtos == null || produtos.isEmpty()) {
            return failure("Nenhum produto informado");
        }
        long pesoTotal = 0;
        for (Map<String, Object> p : produtos) {
            long peso = toLong(p.get("peso"));
            if (p.get("produtoId") == null || peso <= 0) {
                return failure("cada produto exige produtoId e peso > 0");
            }
            pesoTotal += peso;
        }

        Mulberry32 rng = new Mulberry32((int) toLong(input.get("seed")));
        long janela = (fim - slaMin) - inicio + 1;
        List<Map<String, Object>> ordens = new ArrayList<>();
        for (int i = 0; i < qtd; i++) {
            boolean inbound = rng.nextInt(10_000) < pctInbound;
            long liberacao = inicio + rng.nextInt(janela);
            long sla = slaMin + rng.nextInt(slaMax - slaMin + 1);
            long paletes = palMin + rng.nextInt(palMax - palMin + 1);
            long alvo = rng.nextInt(pesoTotal);
            Object produtoId = null;
            for (Map<String, Object> p : produtos) {
                alvo -= toLong(p.get("peso"));
                if (alvo < 0) {
                    produtoId = p.get("produtoId");
                    break;
                }
            }
            Map<String, Object> o = new LinkedHashMap<>();
            o.put("tipo", inbound ? "Inbound" : "Outbound");
            o.put("liberacaoSeg", liberacao);
            o.put("slaSeg", sla);
            o.put("produtoId", produtoId);
            o.put("quantidadePaletes", paletes);
            o.put("_seq", i);
            ordens.add(o);
        }
        // Comparator anônimo, não lambda: o gate de bytecode do NPDev recusa LambdaMetafactory.
        ordens.sort(new Comparator<Map<String, Object>>() {
            @Override
            public int compare(Map<String, Object> a, Map<String, Object> b) {
                int cmp = Long.compare(toLong(a.get("liberacaoSeg")), toLong(b.get("liberacaoSeg")));
                return cmp != 0 ? cmp : Long.compare(toLong(a.get("_seq")), toLong(b.get("_seq")));
            }
        });
        int nIn = 0;
        int nOut = 0;
        List<Map<String, Object>> saida = new ArrayList<>();
        for (Map<String, Object> o : ordens) {
            boolean inbound = "Inbound".equals(o.get("tipo"));
            String numero = inbound ? String.format("IN-%04d", ++nIn) : String.format("OUT-%04d", ++nOut);
            Map<String, Object> r = new LinkedHashMap<>();
            r.put("numero", numero);
            r.put("tipo", o.get("tipo"));
            r.put("liberacaoSeg", o.get("liberacaoSeg"));
            r.put("slaSeg", o.get("slaSeg"));
            r.put("produtoId", o.get("produtoId"));
            r.put("quantidadePaletes", o.get("quantidadePaletes"));
            saida.add(r);
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("sucesso", true);
        result.put("ordens", saida);
        return result;
    }

    // ------------------------------------------------------------------------------------------
    // helpers
    // ------------------------------------------------------------------------------------------

    /** mulberry32 — idêntico ao de src/sim/rng.ts (aritmética de int de 32 bits). */
    public static final class Mulberry32 {
        private int state;

        public Mulberry32(int seed) {
            this.state = seed;
        }

        public double next() {
            state += 0x6D2B79F5;
            int t = state;
            t = (t ^ (t >>> 15)) * (t | 1);
            t ^= t + (t ^ (t >>> 7)) * (t | 61);
            long u = (t ^ (t >>> 14)) & 0xFFFFFFFFL;
            return u / 4294967296.0;
        }

        /** Inteiro uniforme em [0, n). */
        public long nextInt(long n) {
            return (long) Math.floor(next() * n);
        }
    }

    private static String validarMetricas(Map<String, Object> m) {
        String[] campos = {"distanciaRealCm", "distanciaTeoricaCm", "ordensTotal", "ordensAtrasadas",
                "eventosConflito", "ocupacaoFinalCentesimos"};
        for (String c : campos) {
            if (m.get(c) == null) {
                return "metrica obrigatoria ausente: " + c;
            }
            if (toLong(m.get(c)) < 0) {
                return "metrica negativa: " + c;
            }
        }
        if (toLong(m.get("ordensTotal")) <= 0) {
            return "ordensTotal deve ser > 0";
        }
        if (toLong(m.get("ordensAtrasadas")) > toLong(m.get("ordensTotal"))) {
            return "ordensAtrasadas > ordensTotal";
        }
        if (toLong(m.get("ocupacaoFinalCentesimos")) > 10_000) {
            return "ocupacaoFinalCentesimos > 10000";
        }
        return null;
    }

    /** Divisão inteira com arredondamento meio-para-cima (num, den &gt;= 0; den &gt; 0). */
    static long divRound(long num, long den) {
        return (2 * num + den) / (2 * den);
    }

    private static long longOr(Object v, long padrao) {
        return v == null ? padrao : toLong(v);
    }

    private static long toLong(Object v) {
        if (v == null) {
            return 0;
        }
        if (v instanceof Number) {
            return ((Number) v).longValue();
        }
        return Long.parseLong(String.valueOf(v).trim());
    }

    private static Map<String, Object> failure(String motivo) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("sucesso", false);
        result.put("motivo", motivo);
        return result;
    }
}
