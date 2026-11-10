package com.wmsoffice.capabilities.inventory;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class InventoryFileCapability {

    @SuppressWarnings("unchecked")
    public Map<String, Object> gerarTemplate(Map<String, Object> input) {
        return gerarTemplate(input, (List<Map<String, Object>>) input.get("ocupacoes"));
    }

    /**
     * Move 5 (docs/MOVE5_CLOSE_ALL_OPEN_PLAN.md, Wave 4 / Gap 7): a 2-arg overload so
     * GerarTemplateContagemProcedure's callCapability can pass ocupacoes (mapList's own List
     * output, Wave 3A) directly, without wrapping it in a synthetic "ocupacoes"-keyed Map first --
     * no procedure step builds an arbitrary object from a computed value, only per-item mapList or
     * patchConcept's persisted-record set do that, neither fits "wrap one already-computed value."
     * A 1-arg List overload was tried first and reverted: it would collide on arg COUNT with the
     * pre-existing 1-arg Map overload above (ArtifactLocalJavaSourceCapabilityHandler.resolveMethod
     * matches by name+argCount only, never by type -- REG-79's own exact failure mode), silently
     * picking either one non-deterministically. Parameter order matches the ALPHABETICAL order
     * ModelCompiler's sortObjectMap normalizes a multi-entry args map to ("input" &lt;
     * "ocupacoes") -- see CompiledProcedureStep.args's own doc comment.
     */
    public Map<String, Object> gerarTemplate(Map<String, Object> input, List<Map<String, Object>> ocupacoes) {
        if (ocupacoes == null || ocupacoes.isEmpty()) {
            return failure("Nenhuma ocupacao informada para gerar o template");
        }

        StringBuilder texto = new StringBuilder();
        texto.append("localArmazenagemId;produtoId;loteId;quantidadeEsperada;quantidadeContada\n");
        for (Map<String, Object> ocupacao : ocupacoes) {
            texto.append(nullToEmpty(ocupacao.get("localArmazenagemId"))).append(';')
                    .append(nullToEmpty(ocupacao.get("produtoId"))).append(';')
                    .append(nullToEmpty(ocupacao.get("loteId"))).append(';')
                    .append(nullToEmpty(ocupacao.get("quantidade"))).append(';')
                    .append("\n");
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("texto", texto.toString());
        result.put("totalLinhas", ocupacoes.size());
        result.put("sucesso", true);
        return result;
    }

    /**
     * Move 10 W1.2 (docs/MOVE10_CONSOLE_PARITY_SPEC.md): the 3-arg overload
     * GerarTemplateContagemProcedure calls, closing the two content gaps the 2-arg (Move 5 Wave 4)
     * path left open against the original {@code inventario.html} {@code generateTemplate()}:
     *
     * <ol>
     *   <li><b>produtoId join.</b> The original looked each occupancy row's {@code loteId} up in its
     *       client-side {@code loteById} map to fill the CSV's produtoId column. {@code mapList}'s
     *       {@code select} is a literal-vs-$ref transform per item with no cross-list lookup
     *       (DefaultProcedureExecutor.resolveSetValue), so the procedure ships the Lote
     *       {id, produtoId} pairs as a second list and the join happens here. Without this the
     *       column was hard-coded {@code ""} -- a template an operator literally cannot fill in,
     *       since produtoId is what identifies WHAT is being counted.</li>
     *   <li><b>quantidade &gt; 0 filter.</b> The original filtered emptied bins out client-side
     *       ({@code Number(o.quantidade) > 0}) before ever calling this capability.</li>
     * </ol>
     *
     * <p>{@code dataGeracao} is returned so the procedure's {@code patchConcept} can stamp the
     * InventarioArquivo header row the original also created -- no procedure expression yields
     * "today". Additive: the 1-arg and 2-arg overloads, and the {@code GerarTemplateInventario} flow
     * that reaches the 1-arg one, are unchanged.
     *
     * <p><b>Parameter order is alphabetical-by-args-key</b> ("input" &lt; "lotes" &lt; "ocupacoes"),
     * not declaration order -- ModelCompiler's {@code sortObjectMap} normalizes the args map and
     * dispatch is positional, matched on name + arg count only. Arg count 3 does not collide with
     * the 1-arg or 2-arg overloads above (REG-79's failure mode).
     */
    public Map<String, Object> gerarTemplate(
            Map<String, Object> input,
            List<Map<String, Object>> lotes,
            List<Map<String, Object>> ocupacoes
    ) {
        if (ocupacoes == null || ocupacoes.isEmpty()) {
            return failure("Nenhuma ocupacao informada para gerar o template");
        }

        Map<String, Object> produtoPorLote = new LinkedHashMap<>();
        if (lotes != null) {
            for (Map<String, Object> lote : lotes) {
                if (lote == null || lote.get("id") == null) {
                    continue;
                }
                produtoPorLote.put(String.valueOf(lote.get("id")), lote.get("produtoId"));
            }
        }

        List<Map<String, Object>> enriquecidas = new ArrayList<>();
        for (Map<String, Object> ocupacao : ocupacoes) {
            if (toLong(ocupacao.get("quantidade")) <= 0) {
                continue;
            }
            Object loteId = ocupacao.get("loteId");
            Map<String, Object> linha = new LinkedHashMap<>(ocupacao);
            linha.put("produtoId", loteId == null ? null : produtoPorLote.get(String.valueOf(loteId)));
            enriquecidas.add(linha);
        }

        if (enriquecidas.isEmpty()) {
            return failure("Nenhuma ocupacao com quantidade positiva para gerar o template");
        }

        Map<String, Object> result = gerarTemplate(input, enriquecidas);
        result.put("dataGeracao", LocalDate.now().toString());
        return result;
    }

    public Map<String, Object> importarContagem(Map<String, Object> input) {
        String texto = String.valueOf(input.get("texto"));
        String[] linhas = texto.split("\\r?\\n");

        List<Map<String, Object>> resultado = new ArrayList<>();
        int totalDivergencias = 0;
        boolean firstLine = true;
        for (String linha : linhas) {
            String trimmed = linha.trim();
            if (trimmed.isEmpty()) {
                continue;
            }
            if (firstLine && trimmed.toLowerCase().startsWith("localarmazenagemid")) {
                firstLine = false;
                continue;
            }
            firstLine = false;

            String[] partes = trimmed.split(";", -1);
            if (partes.length < 4) {
                continue;
            }
            String localArmazenagemId = blankToNull(partes[0]);
            String produtoId = blankToNull(partes[1]);
            String loteId = blankToNull(partes[2]);
            long quantidadeEsperada = parseLong(partes[3]);
            Long quantidadeContada = partes.length > 4 ? parseLongOrNull(partes[4]) : null;

            boolean divergente = quantidadeContada != null && quantidadeContada != quantidadeEsperada;
            if (divergente) {
                totalDivergencias++;
            }

            Map<String, Object> linhaResultado = new LinkedHashMap<>();
            linhaResultado.put("localArmazenagemId", localArmazenagemId);
            linhaResultado.put("produtoId", produtoId);
            linhaResultado.put("loteId", loteId);
            linhaResultado.put("quantidadeEsperada", quantidadeEsperada);
            linhaResultado.put("quantidadeContada", quantidadeContada);
            linhaResultado.put("divergente", divergente);
            linhaResultado.put("contado", quantidadeContada != null);
            resultado.add(linhaResultado);
        }

        if (resultado.isEmpty()) {
            return failure("Nenhuma linha valida encontrada no arquivo de contagem");
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("linhas", resultado);
        result.put("totalLinhas", resultado.size());
        result.put("totalDivergencias", totalDivergencias);
        result.put("sucesso", true);
        return result;
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> analisarArquivoRecebimento(Map<String, Object> input) {
        List<Map<String, Object>> ruas = (List<Map<String, Object>>) input.get("ruas");
        List<Map<String, Object>> produtos = (List<Map<String, Object>>) input.get("produtos");
        return analisarArquivoRecebimento(input, produtos, ruas);
    }

    /**
     * Move 13 P1.1 (MOVE13_CLOSE_EVERYTHING_SPEC.md, item 14 follow-through): the 3-arg overload
     * {@code AnalisarArquivoRecebimentoDraftProcedure} calls, so the Aggregate Workbench's propose
     * step can pass {@code produtos}/{@code ruas} as typed lists (mapList's own List output, same
     * precedent {@code gerarTemplate}'s 3-arg overload above set) instead of relying on the client
     * to have nested them inside the raw request body the way the ORIGINAL hand-written
     * {@code inventario.html} did (it posted {@code {csvText, ruas, produtos}} as one flat body to
     * {@code /api/flows/AnalisarArquivoRecebimento/execute}, which the 1-arg overload above still
     * serves, unchanged, for that flow's sake). Delegates to the SAME body -- there is nothing to
     * duplicate, only where {@code ruas}/{@code produtos} come from differs.
     *
     * <p><b>Parameter order is alphabetical-by-args-key</b> ("input" &lt; "produtos" &lt; "ruas"),
     * not declaration order -- {@code ArtifactLocalJavaSourceCapabilityHandler.resolveMethod} matches
     * purely by (name, argCount), and {@code ModelCompiler.sortObjectMap} normalizes a
     * {@code capabilityCall} step's {@code args} map to that order before positional dispatch (the
     * same REG-79 failure mode {@code gerarTemplate}'s own overloads document). Arg count 3 does not
     * collide with the 1-arg overload above.
     */
    public Map<String, Object> analisarArquivoRecebimento(
            Map<String, Object> input, List<Map<String, Object>> produtos, List<Map<String, Object>> ruas) {
        String csvText = String.valueOf(input.get("csvText"));
        if (csvText == null || csvText.isBlank() || "null".equals(csvText)) {
            return failureAnalise("Nenhum conteudo de arquivo informado");
        }

        List<Map<String, Object>> resultado = new ArrayList<>();
        Map<String, Long> consumidoPorRua = new LinkedHashMap<>();
        int totalOk = 0;
        boolean firstLine = true;
        int numeroLinha = 0;

        for (String linhaTexto : csvText.split("\\r?\\n")) {
            numeroLinha++;
            String trimmed = linhaTexto.trim();
            if (trimmed.isEmpty()) {
                continue;
            }
            if (firstLine && trimmed.toLowerCase().startsWith("rua;")) {
                firstLine = false;
                continue;
            }
            firstLine = false;

            String[] partes = trimmed.split(";", -1);
            if (partes.length < 5) {
                continue;
            }
            String ruaCodigo = partes[0].trim();
            String produtoCodigo = blankToNull(partes[1]);
            if (produtoCodigo == null) {
                continue;
            }

            long posicoes = parseLong(partes[3]);
            long qtdAvulsa = parseLong(partes[4]);

            Map<String, Object> rua = findByCodigo(ruas, ruaCodigo);
            Map<String, Object> produto = findByCodigo(produtos, produtoCodigo);

            StringBuilder alerta = new StringBuilder();
            if (rua == null) {
                alerta.append("Rua Não Encontrada");
            }
            if (produto == null) {
                if (alerta.length() > 0) {
                    alerta.append(" / ");
                }
                alerta.append("Prod. Não Cadastrado: ").append(produtoCodigo);
            }

            long palletSize = produto != null ? toLong(produto.get("qtdCaixasPorPallet")) : 1;
            if (palletSize <= 0) {
                palletSize = 1;
            }
            long quantidade = posicoes * palletSize + qtdAvulsa;

            if (rua != null && produto != null) {
                String ruaId = String.valueOf(rua.get("id"));
                long capacidade = toLong(rua.get("posicoesDisponiveis"));
                long jaConsumido = consumidoPorRua.getOrDefault(ruaId, 0L);
                long necessario = (quantidade + palletSize - 1) / palletSize;
                if (jaConsumido + necessario > capacidade) {
                    if (alerta.length() > 0) {
                        alerta.append(" / ");
                    }
                    alerta.append("Locais Não Disponíveis");
                } else {
                    consumidoPorRua.put(ruaId, jaConsumido + necessario);
                }
            }

            boolean ok = alerta.length() == 0;
            if (ok) {
                alerta.append("OK!");
                totalOk++;
            }

            Map<String, Object> linha = new LinkedHashMap<>();
            linha.put("linha", numeroLinha);
            linha.put("ruaCodigo", ruaCodigo);
            linha.put("produtoCodigo", produtoCodigo);
            linha.put("dataValidade", parseDataBr(partes[2].trim()));
            linha.put("posicoes", posicoes);
            linha.put("quantidadeAvulsa", qtdAvulsa);
            linha.put("quantidade", quantidade);
            linha.put("ruaId", rua != null ? rua.get("id") : null);
            linha.put("produtoId", produto != null ? produto.get("id") : null);
            linha.put("alerta", alerta.toString());
            linha.put("ok", ok);
            resultado.add(linha);
        }

        if (resultado.isEmpty()) {
            return failureAnalise("Nenhuma linha valida encontrada no arquivo de recebimento");
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("linhas", resultado);
        result.put("totalLinhas", resultado.size());
        result.put("totalOk", totalOk);
        result.put("todasOk", totalOk == resultado.size());
        result.put("sucesso", true);
        return result;
    }

    private static Map<String, Object> findByCodigo(List<Map<String, Object>> lista, String codigo) {
        if (lista == null || codigo == null) {
            return null;
        }
        for (Map<String, Object> item : lista) {
            Object c = item.get("codigo");
            if (c != null && String.valueOf(c).trim().equals(codigo)) {
                return item;
            }
        }
        return null;
    }

    private static String parseDataBr(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        try {
            return LocalDate.parse(value, DateTimeFormatter.ofPattern("dd/MM/yyyy")).toString();
        } catch (Exception ignored) {
            return null;
        }
    }

    private static long toLong(Object value) {
        if (value == null) {
            return 0L;
        }
        if (value instanceof Number number) {
            return number.longValue();
        }
        try {
            return Long.parseLong(String.valueOf(value).trim());
        } catch (NumberFormatException ignored) {
            return 0L;
        }
    }

    private static Map<String, Object> failureAnalise(String motivo) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("linhas", List.of());
        result.put("totalLinhas", 0);
        result.put("totalOk", 0);
        result.put("todasOk", false);
        result.put("motivo", motivo);
        result.put("sucesso", false);
        return result;
    }

    private static String nullToEmpty(Object value) {
        return value == null ? "" : String.valueOf(value);
    }

    private static String blankToNull(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    private static long parseLong(String value) {
        Long parsed = parseLongOrNull(value);
        return parsed == null ? 0L : parsed;
    }

    private static Long parseLongOrNull(String value) {
        if (value == null || value.trim().isEmpty()) {
            return null;
        }
        try {
            return Long.parseLong(value.trim());
        } catch (NumberFormatException ignored) {
            return null;
        }
    }

    private static Map<String, Object> failure(String motivo) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("linhas", List.of());
        result.put("motivo", motivo);
        result.put("sucesso", false);
        return result;
    }
}
