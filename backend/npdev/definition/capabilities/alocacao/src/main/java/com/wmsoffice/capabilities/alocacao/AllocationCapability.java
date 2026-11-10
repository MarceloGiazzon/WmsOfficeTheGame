package com.wmsoffice.capabilities.alocacao;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class AllocationCapability {

    /**
     * WMS-9 C7 (WMSOFFICE_SCREEN_PARITY_CHECKLIST.md 2.5, per the original GeneXus manual): a
     * cross-docked receipt must never be put away into ordinary storage -- it goes straight to the
     * CrossDocking's own already-provisioned staging bay ({@link #localizarBaiaCrossDocking}'s own
     * result, written onto CrossDocking.baiaLocalArmazenagemId by ProvisionarBaiaCrossDockingProcedure,
     * not built here). When {@code input.recebimentoId} matches an {@code Ativo} CrossDocking row
     * with a resolved bay, this short-circuits straight to that bay and skips the normal
     * candidatos-ranking entirely -- there is exactly one correct destino for a cross-docked
     * quantity, not a ranked choice among many. Params declared alphabetically
     * (crossDockings, input), same resolveMethod binding-order convention as every other multi-arg
     * method in this file.
     */
    @SuppressWarnings("unchecked")
    public Map<String, Object> sugerirDestino(List<Map<String, Object>> crossDockings, Map<String, Object> input) {
        Object baiaCrossDocking = baiaAtivaParaRecebimento(crossDockings, input.get("recebimentoId"));
        if (baiaCrossDocking != null) {
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("localArmazenagemId", baiaCrossDocking);
            result.put("motivo", "Cross-Docking ativo: destino fixado na baia de cross-docking");
            result.put("sucesso", true);
            return result;
        }

        List<Map<String, Object>> candidatos = (List<Map<String, Object>>) input.get("candidatos");
        Object loteId = input.get("loteId");

        if (candidatos == null || candidatos.isEmpty()) {
            return failure("Nenhum local candidato informado");
        }

        List<Map<String, Object>> ordenadosDestino = new ArrayList<>(candidatos);
        ordenadosDestino.sort(new Comparator<Map<String, Object>>() {
            @Override
            public int compare(Map<String, Object> a, Map<String, Object> b) {
                int cmp = Boolean.compare(
                        !sameId(a.get("loteOcupanteId"), loteId), !sameId(b.get("loteOcupanteId"), loteId));
                if (cmp != 0) {
                    return cmp;
                }
                cmp = Integer.compare(prioridade(a.get("prioridade")), prioridade(b.get("prioridade")));
                if (cmp != 0) {
                    return cmp;
                }
                return String.valueOf(a.get("localArmazenagemId")).compareTo(String.valueOf(b.get("localArmazenagemId")));
            }
        });
        Map<String, Object> escolhido = ordenadosDestino.isEmpty() ? null : ordenadosDestino.get(0);

        boolean mesmoLote = sameId(escolhido.get("loteOcupanteId"), loteId);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("localArmazenagemId", escolhido.get("localArmazenagemId"));
        result.put("motivo", mesmoLote
                ? "Local ja ocupado pelo mesmo lote (completar pallet)"
                : "Local disponivel com maior prioridade de ranking");
        result.put("sucesso", true);
        return result;
    }

    /**
     * WMS-9 C7 (WMSOFFICE_SCREEN_PARITY_CHECKLIST.md 2.5): {@link #sugerirDestino}'s Expedicao-side
     * twin -- a cross-docked shipment must be pulled from the CrossDocking's own staging bay, not
     * ranked among ordinary storage candidatos by FEFO. When {@code input.expedicaoId} matches an
     * {@code Ativo} CrossDocking row with a resolved bay, short-circuits to a single allocation at
     * that bay for the full {@code quantidadeNecessaria}. Params declared alphabetically
     * (crossDockings, input), same convention as {@link #sugerirDestino}.
     */
    @SuppressWarnings("unchecked")
    public Map<String, Object> sugerirOrigem(List<Map<String, Object>> crossDockings, Map<String, Object> input) {
        long quantidadeNecessaria = toLong(input.get("quantidadeNecessaria"));
        Object baiaCrossDocking = baiaAtivaParaExpedicao(crossDockings, input.get("expedicaoId"));
        if (baiaCrossDocking != null) {
            Map<String, Object> alocacao = new LinkedHashMap<>();
            alocacao.put("localArmazenagemId", baiaCrossDocking);
            alocacao.put("loteId", null);
            alocacao.put("quantidadeAlocada", quantidadeNecessaria);
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("alocacoes", List.of(alocacao));
            result.put("quantidadeAtendida", quantidadeNecessaria);
            result.put("atendeuTotal", true);
            result.put("motivo", "Cross-Docking ativo: origem fixada na baia de cross-docking");
            result.put("sucesso", true);
            return result;
        }

        List<Map<String, Object>> candidatos = (List<Map<String, Object>>) input.get("candidatos");

        if (candidatos == null || candidatos.isEmpty()) {
            return failure("Nenhum local candidato informado");
        }

        List<Map<String, Object>> ordenados = new ArrayList<>(candidatos);
        ordenados.sort(new Comparator<Map<String, Object>>() {
            @Override
            public int compare(Map<String, Object> a, Map<String, Object> b) {
                int cmp = parseDate(a.get("dataValidade")).compareTo(parseDate(b.get("dataValidade")));
                if (cmp != 0) {
                    return cmp;
                }
                return Integer.compare(prioridade(a.get("prioridade")), prioridade(b.get("prioridade")));
            }
        });

        List<Map<String, Object>> alocacoes = new ArrayList<>();
        long restante = quantidadeNecessaria;
        for (Map<String, Object> candidato : ordenados) {
            if (restante <= 0) {
                break;
            }
            long disponivel = toLong(candidato.get("quantidadeDisponivel"));
            if (disponivel <= 0) {
                continue;
            }
            long alocado = Math.min(disponivel, restante);
            Map<String, Object> alocacao = new LinkedHashMap<>();
            alocacao.put("localArmazenagemId", candidato.get("localArmazenagemId"));
            alocacao.put("loteId", candidato.get("loteId"));
            alocacao.put("quantidadeAlocada", alocado);
            alocacoes.add(alocacao);
            restante -= alocado;
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("alocacoes", alocacoes);
        result.put("quantidadeAtendida", quantidadeNecessaria - restante);
        result.put("atendeuTotal", restante <= 0);
        result.put("sucesso", true);
        return result;
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> alocarRecebimento(Map<String, Object> input) {
        List<Map<String, Object>> candidatos = (List<Map<String, Object>>) input.get("candidatos");
        Object produtoId = input.get("produtoId");
        Object mesValidade = input.get("mesValidade");
        long quantidadeNecessaria = toLong(input.get("quantidadeNecessaria"));
        long palletSize = Math.max(1, toLong(input.get("palletSize")));
        return alocarComCandidatos(candidatos, produtoId, mesValidade, quantidadeNecessaria, palletSize);
    }

    /**
     * Move 13 P1.1 (MOVE13_CLOSE_EVERYTHING_SPEC.md, item 14 follow-through): the eligibility/sort/
     * greedy-allocate core {@code alocarRecebimento(Map)} used to do inline, extracted so
     * {@code alocarRecebimentoPorRua} below (the onCommit-side twin that builds its own candidatos
     * from raw locais/lotes/ocupacoes instead of a pre-built list) can reuse it verbatim rather than
     * duplicate it -- same precedent {@code somarQuantidadePorLocalLote} set for
     * {@code encontrarOcupacao}'s own lookup logic (fold, don't duplicate).
     */
    private static Map<String, Object> alocarComCandidatos(
            List<Map<String, Object>> candidatos, Object produtoId, Object mesValidade,
            long quantidadeNecessaria, long palletSize) {
        if (candidatos == null || candidatos.isEmpty()) {
            return failureAlocacao("Nenhum local candidato informado");
        }
        if (quantidadeNecessaria <= 0) {
            return failureAlocacao("Quantidade necessaria invalida");
        }

        List<Map<String, Object>> elegiveis = new ArrayList<>();
        for (Map<String, Object> c : candidatos) {
            long ocupada = toLong(c.get("quantidadeOcupada"));
            boolean vazio = "Disponivel".equals(String.valueOf(c.get("situacao"))) && ocupada <= 0;
            boolean topOff = ocupada > 0 && ocupada < palletSize
                    && sameId(c.get("ocupanteProdutoId"), produtoId)
                    && sameValue(c.get("ocupanteMesValidade"), mesValidade);
            if (vazio || topOff) {
                Map<String, Object> c2 = new LinkedHashMap<>(c);
                c2.put("_prioridade", topOff ? 0 : 1);
                elegiveis.add(c2);
            }
        }
        elegiveis.sort(new Comparator<Map<String, Object>>() {
            @Override
            public int compare(Map<String, Object> a, Map<String, Object> b) {
                int cmp = Integer.compare((Integer) a.get("_prioridade"), (Integer) b.get("_prioridade"));
                if (cmp != 0) {
                    return cmp;
                }
                cmp = Long.compare(toLong(a.get("posicao")), toLong(b.get("posicao")));
                if (cmp != 0) {
                    return cmp;
                }
                return Long.compare(toLong(a.get("andar")), toLong(b.get("andar")));
            }
        });

        List<Map<String, Object>> alocacoes = new ArrayList<>();
        long restante = quantidadeNecessaria;
        for (Map<String, Object> c : elegiveis) {
            if (restante <= 0) {
                break;
            }
            long livre = palletSize - toLong(c.get("quantidadeOcupada"));
            if (livre <= 0) {
                continue;
            }
            long alocar = Math.min(livre, restante);
            Map<String, Object> a = new LinkedHashMap<>();
            a.put("localArmazenagemId", c.get("localArmazenagemId"));
            a.put("quantidadeAlocada", alocar);
            alocacoes.add(a);
            restante -= alocar;
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("alocacoes", alocacoes);
        result.put("quantidadeAtendida", quantidadeNecessaria - restante);
        result.put("atendeuTotal", restante <= 0);
        result.put("sucesso", true);
        if (restante > 0) {
            result.put("motivo", "Capacidade insuficiente nos locais candidatos (faltaram " + restante + " unidade(s))");
        }
        return result;
    }

    /**
     * Move 13 P1.1 (MOVE13_CLOSE_EVERYTHING_SPEC.md, item 14 follow-through): the propose-step half
     * of inventario.html's "Recebimento por Arquivo" wizard -- ports {@code ruasDaEntidade()} +
     * {@code posDisponiveisPorRua} (the original's own client-side three-hop join: Armazem.entidadeId
     * -&gt; Area.armazemId -&gt; Rua.areaId, then a count of that rua's LocalArmazenagem rows with
     * situacao=='Disponivel') into a capability so the propose procedure can pass whole reshaped
     * lists (mapList's own List output) instead of the original's client-only computation.
     *
     * <p>Params declared alphabetically (areas, armazens, entidadeId, locais, ruas) per this file's
     * standing {@code ArtifactLocalJavaSourceCapabilityHandler.resolveMethod} binding-order
     * convention (see {@code encontrarOcupacao}'s doc comment).
     */
    public Map<String, Object> ruasElegiveis(
            List<Map<String, Object>> areas, List<Map<String, Object>> armazens, Object entidadeId,
            List<Map<String, Object>> locais, List<Map<String, Object>> ruas) {
        List<Object> armazensDaEntidade = new ArrayList<>();
        if (armazens != null) {
            for (Map<String, Object> armazem : armazens) {
                if (sameId(armazem.get("entidadeId"), entidadeId)) {
                    armazensDaEntidade.add(armazem.get("id"));
                }
            }
        }
        List<Object> areasDaEntidade = new ArrayList<>();
        if (areas != null) {
            for (Map<String, Object> area : areas) {
                if (containsId(armazensDaEntidade, area.get("armazemId"))) {
                    areasDaEntidade.add(area.get("id"));
                }
            }
        }
        Map<String, Long> posDisponiveisPorRua = new LinkedHashMap<>();
        if (locais != null) {
            for (Map<String, Object> local : locais) {
                if ("Disponivel".equals(String.valueOf(local.get("situacao")))) {
                    String ruaId = String.valueOf(local.get("ruaId"));
                    Long atual = posDisponiveisPorRua.get(ruaId);
                    posDisponiveisPorRua.put(ruaId, atual == null ? 1L : atual + 1L);
                }
            }
        }

        List<Map<String, Object>> resultado = new ArrayList<>();
        if (ruas != null) {
            for (Map<String, Object> rua : ruas) {
                if (!containsId(areasDaEntidade, rua.get("areaId"))) {
                    continue;
                }
                Map<String, Object> r = new LinkedHashMap<>();
                r.put("id", rua.get("id"));
                r.put("codigo", rua.get("codigo"));
                r.put("posicoesDisponiveis", posDisponiveisPorRua.getOrDefault(String.valueOf(rua.get("id")), 0L));
                resultado.add(r);
            }
        }
        return Map.of("ruas", resultado);
    }

    /**
     * Move 13 P1.1 (MOVE13_CLOSE_EVERYTHING_SPEC.md, item 14 follow-through): the commit-time half
     * of "Recebimento por Arquivo" -- {@code ProcessarRecebimentoArquivoOnCommitProcedure} calls this
     * once per accepted preview row instead of the original screen's client-side
     * {@code confirmarRecebimento()} building its own {@code candidatos} array. Filters
     * {@code locais} to {@code ruaId}, joins each to its current occupation (if any, via
     * {@code ocupacoes}) and that occupation's occupant lote (via {@code lotes}, for
     * ocupanteProdutoId/ocupanteMesValidade) exactly as the client's own
     * {@code candidatos.map(...)} did, resolves {@code palletSize} from the matching {@code produtos}
     * entry's {@code qtdCaixasPorPallet} (default 1) -- letting Java do this lookup since mapList has
     * no cross-list join primitive (same reason {@code gerarTemplate}'s 3-arg overload folds its own
     * produtoId join in Java) -- derives {@code mesValidade} as the first 7 characters of
     * {@code dataValidade} (an ISO {@code yyyy-MM-dd} string, same convention
     * {@code parseDataBr}/{@code Lote.dataValidade} already use; no substring primitive exists in
     * procedure-step grammar either), THEN reuses {@code alocarComCandidatos} -- the SAME eligibility/
     * sort/allocate logic {@code alocarRecebimento} uses -- rather than duplicate it. Also enriches
     * each returned allocation with {@code existingOcupacaoId}/{@code ocupacaoQuantidadeAtual} (see
     * the field-level comment below for why) so the caller can upsert LocalArmazenagemLote directly.
     *
     * <p>Params declared alphabetically (dataValidade, locais, loteId, lotes, ocupacoes, produtoId,
     * produtos, quantidadeNecessaria, ruaId) per this file's standing resolveMethod binding-order
     * convention.
     */
    @SuppressWarnings("unchecked")
    public Map<String, Object> alocarRecebimentoPorRua(
            Object dataValidade, List<Map<String, Object>> locais, Object loteId, List<Map<String, Object>> lotes,
            List<Map<String, Object>> ocupacoes, Object produtoId, List<Map<String, Object>> produtos,
            Object quantidadeNecessaria, Object ruaId) {
        Map<String, Object> ocupacaoPorLocal = new LinkedHashMap<>();
        // Move 13 P1.1 follow-up fix: keyed by (localArmazenagemId, loteId) composite so the
        // caller (ProcessarRecebimentoArquivoOnCommitProcedure) does not need a SECOND
        // capabilityCall to encontrarOcupacao(String,String,List) to find the exact existing
        // LocalArmazenagemLote row for the specific lote being received. That second call was
        // tried first and hit JAVA_SOURCE_CAPABILITY_DISPATCH_ERROR "argument type mismatch" live:
        // encontrarOcupacao's params are String (safe for its own caller, SyncOcupacaoProcedure,
        // whose args are procedure PARAMETERS the executor coerces to String), but values THIS
        // procedure has on hand come from listConcepts+mapList, the SAME "not guaranteed to
        // already be java.lang.String" situation somarQuantidadePorLocalLote's own doc comment
        // already names -- so this method folds the lookup in here instead (Object-typed,
        // same fix pattern) and returns each allocation enriched with existingOcupacaoId/
        // ocupacaoQuantidadeAtual, letting the caller upsert directly with no further lookup.
        Map<String, Object> ocupacaoPorLocalELote = new LinkedHashMap<>();
        if (ocupacoes != null) {
            for (Map<String, Object> ocupacao : ocupacoes) {
                if (toLong(ocupacao.get("quantidade")) > 0) {
                    ocupacaoPorLocal.put(String.valueOf(ocupacao.get("localArmazenagemId")), ocupacao);
                }
                ocupacaoPorLocalELote.put(
                        String.valueOf(ocupacao.get("localArmazenagemId")) + "|" + String.valueOf(ocupacao.get("loteId")),
                        ocupacao);
            }
        }
        Map<String, Object> lotePorId = new LinkedHashMap<>();
        if (lotes != null) {
            for (Map<String, Object> lote : lotes) {
                if (lote.get("id") != null) {
                    lotePorId.put(String.valueOf(lote.get("id")), lote);
                }
            }
        }
        long palletSize = 1;
        if (produtos != null) {
            for (Map<String, Object> produto : produtos) {
                if (sameId(produto.get("id"), produtoId)) {
                    palletSize = Math.max(1, toLong(produto.get("qtdCaixasPorPallet")));
                    break;
                }
            }
        }
        String mesValidade = dataValidade == null ? null
                : String.valueOf(dataValidade).length() >= 7 ? String.valueOf(dataValidade).substring(0, 7) : null;

        List<Map<String, Object>> candidatos = new ArrayList<>();
        if (locais != null) {
            for (Map<String, Object> local : locais) {
                if (!sameId(local.get("ruaId"), ruaId)) {
                    continue;
                }
                Map<String, Object> ocupacao = (Map<String, Object>) ocupacaoPorLocal.get(String.valueOf(local.get("id")));
                Map<String, Object> loteOcupante = ocupacao == null ? null
                        : (Map<String, Object>) lotePorId.get(String.valueOf(ocupacao.get("loteId")));
                String ocupanteMesValidade = null;
                if (loteOcupante != null && loteOcupante.get("dataValidade") != null) {
                    String dv = String.valueOf(loteOcupante.get("dataValidade"));
                    ocupanteMesValidade = dv.length() >= 7 ? dv.substring(0, 7) : dv;
                }
                Map<String, Object> c = new LinkedHashMap<>();
                c.put("localArmazenagemId", local.get("id"));
                c.put("posicao", local.get("posicao"));
                c.put("andar", local.get("andar"));
                c.put("situacao", local.get("situacao"));
                c.put("ocupanteProdutoId", loteOcupante == null ? null : loteOcupante.get("produtoId"));
                c.put("ocupanteMesValidade", ocupanteMesValidade);
                c.put("quantidadeOcupada", ocupacao == null ? 0L : toLong(ocupacao.get("quantidade")));
                candidatos.add(c);
            }
        }
        Map<String, Object> result = alocarComCandidatos(candidatos, produtoId, mesValidade, toLong(quantidadeNecessaria), palletSize);
        List<Map<String, Object>> alocacoes = (List<Map<String, Object>>) result.get("alocacoes");
        if (alocacoes != null) {
            for (Map<String, Object> a : alocacoes) {
                String key = String.valueOf(a.get("localArmazenagemId")) + "|" + String.valueOf(loteId);
                Map<String, Object> existente = (Map<String, Object>) ocupacaoPorLocalELote.get(key);
                a.put("existingOcupacaoId", existente == null ? null : existente.get("id"));
                a.put("ocupacaoQuantidadeAtual", existente == null ? 0L : toLong(existente.get("quantidade")));
            }
        }
        return result;
    }

    /**
     * R16 (WMSOFFICE_SCREEN_PARITY_CHECKLIST.md 2.3, Recebimento's PreRecebimento-&gt;Enderecado
     * lifecycle transition): puts away every {@code RecebimentoLote} row of a single Recebimento in
     * one call, across the whole entidade's storage rather than one rua a human already picked --
     * "Enderecado" means computing DESTINATION positions before goods physically arrive, unlike
     * {@link #alocarRecebimentoPorRua}, which confirms a specific incoming ruaId. Reuses
     * {@code alocarComCandidatos} per lote (the same eligibility/sort/greedy-allocate core
     * {@link #alocarRecebimento}/{@link #alocarRecebimentoPorRua} already use) and folds the same
     * locais/ocupacoes/lotes join those methods already establish in Java, since the procedure-step
     * grammar's {@code mapList} has no cross-list join primitive (same reasoning
     * {@code alocarRecebimentoPorRua}'s own doc comment gives). A local's real {@code situacao} field
     * is read as-is from {@code locais} (so Reservado/Bloqueado rows are never chosen as "vazio"),
     * while the occupied quantity is tracked in a local working copy seeded from {@code ocupacoes}
     * and updated after each lote is allocated, so two lotes in the same Recebimento never overfill
     * the same local before the caller's own patchConcept steps persist anything -- the in-call
     * counterpart of {@code ProcessarRecebimentoArquivoOnCommitProcedure}'s own accepted "a single
     * commit's own newly-created rows are not re-listed mid-loop" limitation. Params declared
     * alphabetically (locais, lotes, ocupacoes, produtos, recebimentoId, recebimentoLotes) per this
     * file's standing resolveMethod binding-order convention.
     */
    @SuppressWarnings("unchecked")
    public Map<String, Object> enderecarRecebimento(
            List<Map<String, Object>> locais, List<Map<String, Object>> lotes,
            List<Map<String, Object>> ocupacoes, List<Map<String, Object>> produtos,
            Object recebimentoId, List<Map<String, Object>> recebimentoLotes) {
        Map<String, Map<String, Object>> lotePorId = new LinkedHashMap<>();
        if (lotes != null) {
            for (Map<String, Object> lote : lotes) {
                if (lote.get("id") != null) {
                    lotePorId.put(String.valueOf(lote.get("id")), lote);
                }
            }
        }
        Map<String, Long> palletSizePorProduto = new LinkedHashMap<>();
        if (produtos != null) {
            for (Map<String, Object> produto : produtos) {
                palletSizePorProduto.put(
                        String.valueOf(produto.get("id")), Math.max(1, toLong(produto.get("qtdCaixasPorPallet"))));
            }
        }

        Map<String, Long> ocupacaoAtualPorLocal = new LinkedHashMap<>();
        Map<String, Object> ocupanteProdutoPorLocal = new LinkedHashMap<>();
        Map<String, Object> ocupanteMesValidadePorLocal = new LinkedHashMap<>();
        Map<String, Object> existingOcupacaoIdPorLocal = new LinkedHashMap<>();
        if (ocupacoes != null) {
            for (Map<String, Object> ocupacao : ocupacoes) {
                String localId = String.valueOf(ocupacao.get("localArmazenagemId"));
                long qtd = toLong(ocupacao.get("quantidade"));
                if (qtd > 0) {
                    ocupacaoAtualPorLocal.put(localId, qtd);
                    existingOcupacaoIdPorLocal.put(localId, ocupacao.get("id"));
                    Map<String, Object> loteOcupante = lotePorId.get(String.valueOf(ocupacao.get("loteId")));
                    if (loteOcupante != null) {
                        ocupanteProdutoPorLocal.put(localId, loteOcupante.get("produtoId"));
                        String dv = loteOcupante.get("dataValidade") == null
                                ? null : String.valueOf(loteOcupante.get("dataValidade"));
                        ocupanteMesValidadePorLocal.put(localId, dv != null && dv.length() >= 7 ? dv.substring(0, 7) : dv);
                    }
                }
            }
        }

        List<Map<String, Object>> todasAlocacoes = new ArrayList<>();
        if (recebimentoLotes != null) {
            for (Map<String, Object> rl : recebimentoLotes) {
                if (!sameId(rl.get("recebimentoId"), recebimentoId)) {
                    continue;
                }
                Object loteId = rl.get("loteId");
                Map<String, Object> lote = lotePorId.get(String.valueOf(loteId));
                if (lote == null) {
                    continue;
                }
                Object produtoId = lote.get("produtoId");
                String dataValidade = lote.get("dataValidade") == null ? null : String.valueOf(lote.get("dataValidade"));
                String mesValidade = dataValidade != null && dataValidade.length() >= 7 ? dataValidade.substring(0, 7) : null;
                long quantidadeNecessaria = toLong(rl.get("quantidade"));
                long palletSize = palletSizePorProduto.getOrDefault(String.valueOf(produtoId), 1L);

                List<Map<String, Object>> candidatos = new ArrayList<>();
                if (locais != null) {
                    for (Map<String, Object> local : locais) {
                        String localId = String.valueOf(local.get("id"));
                        Map<String, Object> c = new LinkedHashMap<>();
                        c.put("localArmazenagemId", local.get("id"));
                        c.put("posicao", local.get("posicao"));
                        c.put("andar", local.get("andar"));
                        c.put("situacao", local.get("situacao"));
                        Long ocupadaAtual = ocupacaoAtualPorLocal.get(localId);
                        c.put("quantidadeOcupada", ocupadaAtual == null ? 0L : ocupadaAtual);
                        c.put("ocupanteProdutoId", ocupanteProdutoPorLocal.get(localId));
                        c.put("ocupanteMesValidade", ocupanteMesValidadePorLocal.get(localId));
                        candidatos.add(c);
                    }
                }

                Map<String, Object> resultado = alocarComCandidatos(candidatos, produtoId, mesValidade, quantidadeNecessaria, palletSize);
                List<Map<String, Object>> alocacoes = (List<Map<String, Object>>) resultado.get("alocacoes");
                if (alocacoes != null) {
                    for (Map<String, Object> a : alocacoes) {
                        String localId = String.valueOf(a.get("localArmazenagemId"));
                        a.put("loteId", loteId);
                        a.put("existingOcupacaoId", existingOcupacaoIdPorLocal.get(localId));
                        long ocupacaoAtualAntes = ocupacaoAtualPorLocal.getOrDefault(localId, 0L);
                        a.put("ocupacaoQuantidadeAtual", ocupacaoAtualAntes);
                        long alocado = toLong(a.get("quantidadeAlocada"));
                        ocupacaoAtualPorLocal.put(localId, ocupacaoAtualAntes + alocado);
                        ocupanteProdutoPorLocal.put(localId, produtoId);
                        ocupanteMesValidadePorLocal.put(localId, mesValidade);
                        todasAlocacoes.add(a);
                    }
                }
            }
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("alocacoes", todasAlocacoes);
        result.put("sucesso", true);
        return result;
    }

    /**
     * Move 13 P1.1 (MOVE13_CLOSE_EVERYTHING_SPEC.md, item 14 follow-through): find-or-signal-create
     * for the Lote natural key (entidadeId, produtoId, dataValidade) that
     * "Recebimento por Arquivo" upserts on commit. A plain linear scan, same judgement
     * {@code encontrarOcupacao}'s own doc comment already made (small table in practice, not worth a
     * new query-parameterization platform feature) -- and the SAME reason this has to be a capability
     * at all rather than a declared {@code runQuery} with parameters: {@code runQuery} has no
     * parameter-binding mechanism in this engine at all (confirmed by reading
     * {@code DefaultProcedureExecutor.runQuery} directly, not assumed), so a per-iteration natural-key
     * lookup inside a {@code forEach} cannot be expressed as a declared, parameterized query today --
     * it has to be a Java scan over a list loaded once, exactly like {@code encontrarOcupacao}.
     *
     * <p>Params declared alphabetically (dataValidade, entidadeId, lotes, produtoId) per this file's
     * standing resolveMethod binding-order convention.
     */
    public Map<String, Object> encontrarLotePorChave(
            Object dataValidade, Object entidadeId, List<Map<String, Object>> lotes, Object produtoId) {
        Map<String, Object> result = new LinkedHashMap<>();
        if (lotes != null) {
            for (Map<String, Object> lote : lotes) {
                if (sameId(lote.get("entidadeId"), entidadeId)
                        && sameId(lote.get("produtoId"), produtoId)
                        && sameValue(lote.get("dataValidade"), dataValidade)) {
                    result.put("found", true);
                    result.put("id", lote.get("id"));
                    result.put("quantidade", lote.get("quantidade"));
                    return result;
                }
            }
        }
        result.put("found", false);
        result.put("id", null);
        result.put("quantidade", null);
        return result;
    }

    /**
     * WMS-9 C7: shared lookup behind {@link #sugerirDestino}/{@link #sugerirOrigem}'s cross-docking
     * short-circuit -- finds the first {@code Ativo} CrossDocking row matching the given
     * recebimentoId/expedicaoId with a non-null baiaLocalArmazenagemId, or null if none (either no
     * cross-docking is active for this record, or its bay has not been provisioned yet by
     * ProvisionarBaiaCrossDockingProcedure, in which case the caller must fall through to normal
     * candidatos ranking rather than route to a bay that does not exist).
     */
    private static Object baiaAtivaParaRecebimento(List<Map<String, Object>> crossDockings, Object recebimentoId) {
        if (recebimentoId == null || crossDockings == null) {
            return null;
        }
        for (Map<String, Object> crossDocking : crossDockings) {
            if (sameId(crossDocking.get("recebimentoId"), recebimentoId)
                    && "Ativo".equals(String.valueOf(crossDocking.get("situacao")))
                    && crossDocking.get("baiaLocalArmazenagemId") != null) {
                return crossDocking.get("baiaLocalArmazenagemId");
            }
        }
        return null;
    }

    /** Expedicao-side twin of {@link #baiaAtivaParaRecebimento}, same reasoning. */
    private static Object baiaAtivaParaExpedicao(List<Map<String, Object>> crossDockings, Object expedicaoId) {
        if (expedicaoId == null || crossDockings == null) {
            return null;
        }
        for (Map<String, Object> crossDocking : crossDockings) {
            if (sameId(crossDocking.get("expedicaoId"), expedicaoId)
                    && "Ativo".equals(String.valueOf(crossDocking.get("situacao")))
                    && crossDocking.get("baiaLocalArmazenagemId") != null) {
                return crossDocking.get("baiaLocalArmazenagemId");
            }
        }
        return null;
    }

    private static boolean containsId(List<Object> ids, Object value) {
        if (value == null) {
            return false;
        }
        for (Object id : ids) {
            if (sameId(id, value)) {
                return true;
            }
        }
        return false;
    }

    private static Map<String, Object> failureAlocacao(String motivo) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("alocacoes", List.of());
        result.put("quantidadeAtendida", 0L);
        result.put("atendeuTotal", false);
        result.put("motivo", motivo);
        result.put("sucesso", false);
        return result;
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> verificarUnicidade(Map<String, Object> input) {
        List<Map<String, Object>> existentes = (List<Map<String, Object>>) input.get("locaisExistentes");
        Map<String, Object> candidato = (Map<String, Object>) input.get("dados");
        List<String> campos = List.of("ruaId", "posicao", "andar");

        boolean duplicado = false;
        if (existentes != null && candidato != null) {
            for (Map<String, Object> existente : existentes) {
                boolean todosIguais = true;
                for (String campo : campos) {
                    if (!sameValue(existente.get(campo), candidato.get(campo))) {
                        todosIguais = false;
                        break;
                    }
                }
                if (todosIguais) {
                    duplicado = true;
                    break;
                }
            }
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("duplicado", duplicado);
        result.put("motivo", duplicado
                ? "Ja existe um local de armazenagem nesta rua/posicao/andar"
                : null);
        result.put("sucesso", true);
        return result;
    }

    /**
     * Move 5 (final item / REG-78): the server-side find half of syncOcupacao (movimentacao-livre.html
     * / centro-trabalho.html's own client-side function of the same name) -- a plain linear scan
     * since ocupacoes is already this app's whole LocalArmazenagemLote table (small in practice: one
     * row per occupied bin/lot pair), not worth a new query-parameterization platform feature for.
     * Params are declared alphabetically (localArmazenagemId, loteId, ocupacoes) to match
     * SyncOcupacaoProcedure's callCapability args map -- CompiledProcedureStep.args is compiled in
     * that order (ModelCompiler.sortObjectMap) and ArtifactLocalJavaSourceCapabilityHandler.resolveMethod
     * matches purely by (methodName, argCount), so a multi-arg method's parameters must line up with
     * that alphabetical order or silently bind the wrong value to the wrong parameter.
     */
    @SuppressWarnings("unchecked")
    public Map<String, Object> encontrarOcupacao(String localArmazenagemId, String loteId, List<Map<String, Object>> ocupacoes) {
        Map<String, Object> result = new LinkedHashMap<>();
        if (ocupacoes != null) {
            for (Map<String, Object> ocupacao : ocupacoes) {
                if (sameId(ocupacao.get("localArmazenagemId"), localArmazenagemId) && sameId(ocupacao.get("loteId"), loteId)) {
                    result.put("found", true);
                    result.put("id", ocupacao.get("id"));
                    result.put("quantidade", ocupacao.get("quantidade"));
                    return result;
                }
            }
        }
        result.put("found", false);
        result.put("id", null);
        result.put("quantidade", null);
        return result;
    }

    /**
     * Move 8 Part B (docs/MOVE8_CLOSE_TABLE_SPEC.md, item G1): the absolute-recompute half of
     * Movimento.onCommit. Sums MovimentoItemPosicao.quantidade across every persisted position
     * whose PARENT MovimentoItem.loteId matches loteId and whose own localArmazenagemId matches
     * localArmazenagemId (a position carries no loteId of its own; its item does), AND looks up
     * the existing LocalArmazenagemLote row's id for that pair (or null), in the SAME call --
     * folding encontrarOcupacao's own lookup in here rather than a second capabilityCall, since
     * that method's params are typed {@code String} (safe for its own caller, SyncOcupacaoProcedure,
     * whose args are procedure PARAMETERS the executor coerces to String) but the values THIS
     * procedure has on hand come straight off the reloaded aggregate tree's own field data
     * (AggregateRuntime.putRecord's {@code record.data()}), whose uuid-typed values are not
     * guaranteed to already be java.lang.String -- reflection invocation fails outright on a real
     * type mismatch (confirmed live: JAVA_SOURCE_CAPABILITY_DISPATCH_ERROR "argument type
     * mismatch"), unlike sameId's own deliberately loose comparison below. localArmazenagemId/
     * loteId are therefore declared {@code Object}, not {@code String}. Absolute, not a delta:
     * onCommit receives only the post-write tree, with no channel back to whatever quantities
     * existed before this commit, so the only idempotent, retry-safe operation is "recompute the
     * true total from scratch" -- recommitting the SAME tree twice must produce the SAME total,
     * which a delta cannot guarantee. Params declared alphabetically (itens, localArmazenagemId,
     * loteId, ocupacoes, posicoes) per encontrarOcupacao's own documented
     * ArtifactLocalJavaSourceCapabilityHandler.resolveMethod binding-order requirement, above.
     */
    @SuppressWarnings("unchecked")
    public Map<String, Object> somarQuantidadePorLocalLote(
            List<Map<String, Object>> itens, Object localArmazenagemId, Object loteId,
            List<Map<String, Object>> ocupacoes, List<Map<String, Object>> posicoes) {
        Map<String, Object> loteIdByItemId = new LinkedHashMap<>();
        if (itens != null) {
            for (Map<String, Object> item : itens) {
                Object itemId = item.get("id");
                Object itemLoteId = item.get("loteId");
                if (itemId != null && itemLoteId != null) {
                    loteIdByItemId.put(String.valueOf(itemId), itemLoteId);
                }
            }
        }
        long total = 0;
        if (posicoes != null) {
            for (Map<String, Object> posicao : posicoes) {
                if (!sameId(posicao.get("localArmazenagemId"), localArmazenagemId)) {
                    continue;
                }
                Object itemLoteId = loteIdByItemId.get(String.valueOf(posicao.get("movimentoItemId")));
                if (!sameId(itemLoteId, loteId)) {
                    continue;
                }
                total += toLong(posicao.get("quantidade"));
            }
        }
        Object existingId = null;
        if (ocupacoes != null) {
            for (Map<String, Object> ocupacao : ocupacoes) {
                if (sameId(ocupacao.get("localArmazenagemId"), localArmazenagemId) && sameId(ocupacao.get("loteId"), loteId)) {
                    existingId = ocupacao.get("id");
                    break;
                }
            }
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("total", total);
        result.put("id", existingId);
        result.put("sucesso", true);
        return result;
    }

    private static boolean sameValue(Object a, Object b) {
        if (a == null || b == null) {
            return a == b;
        }
        return String.valueOf(a).equals(String.valueOf(b));
    }

    private static boolean sameId(Object a, Object b) {
        return a != null && b != null && String.valueOf(a).equals(String.valueOf(b));
    }

    private static int prioridade(Object value) {
        if (value == null) {
            return Integer.MAX_VALUE;
        }
        if (value instanceof Number number) {
            return number.intValue();
        }
        try {
            return Integer.parseInt(String.valueOf(value).trim());
        } catch (NumberFormatException ignored) {
            return Integer.MAX_VALUE;
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

    private static LocalDate parseDate(Object value) {
        if (value == null) {
            return LocalDate.MAX;
        }
        try {
            return LocalDate.parse(String.valueOf(value));
        } catch (Exception ignored) {
            return LocalDate.MAX;
        }
    }

    /**
     * WMS-9 C6 (WMSOFFICE_SCREEN_PARITY_CHECKLIST.md 2.5): "a CD is offered only when an outbound
     * product matches an inbound one". Correlates each active Recebimento's incoming products
     * (RecebimentoLote -&gt; Lote.produtoId -- RecebimentoLote itself only carries a loteId, not a
     * produtoId directly) against each active Expedicao's needed products (ExpedicaoItem.produtoId
     * direct) and returns one candidate row per (Recebimento, Expedicao, Produto) match, with a
     * suggested quantidade capped at whichever side has less -- a cross-dock cannot move more than
     * either side has or needs. Java does this join because mapList/procedure steps have no
     * cross-list join primitive, same reason {@link #ruasElegiveis} and {@code alocarRecebimento}
     * above do their own joins in Java rather than the DSL. {@code dataAtivacao} is stamped here
     * (not left for the caller to fill) since no "today()" expression exists in the procedure-step
     * grammar either -- a plain Java capability has no such limitation.
     *
     * <p>Params declared alphabetically, per this file's standing resolveMethod binding-order
     * convention (capabilityCall's {@code args} is a JSON object whose key ORDER becomes the
     * positional argument list -- keeping both the JSON and this signature alphabetical is what
     * keeps them trivially in sync).
     */
    public Map<String, Object> candidatosCrossDocking(
            List<Map<String, Object>> expedicaoItens, List<Map<String, Object>> expedicoes,
            List<Map<String, Object>> lotes, List<Map<String, Object>> recebimentoLotes,
            List<Map<String, Object>> recebimentos) {
        Map<Object, Object> produtoPorLote = new LinkedHashMap<>();
        if (lotes != null) {
            for (Map<String, Object> lote : lotes) {
                produtoPorLote.put(lote.get("id"), lote.get("produtoId"));
            }
        }

        // B30 (plugin bytecode policy): no lambdas/method references here (computeIfAbsent/merge
        // both compile to invokedynamic+LambdaMetafactory, forbidden for untrusted java-source
        // capabilities) -- plain get/put, same style ruasElegiveis above already uses.
        Map<Object, Map<Object, Long>> qtdPorRecebimentoProduto = new LinkedHashMap<>();
        if (recebimentoLotes != null) {
            for (Map<String, Object> linha : recebimentoLotes) {
                Object produtoId = produtoPorLote.get(linha.get("loteId"));
                if (produtoId == null) {
                    continue;
                }
                Object recebimentoId = linha.get("recebimentoId");
                Map<Object, Long> porProduto = qtdPorRecebimentoProduto.get(recebimentoId);
                if (porProduto == null) {
                    porProduto = new LinkedHashMap<>();
                    qtdPorRecebimentoProduto.put(recebimentoId, porProduto);
                }
                Long atual = porProduto.get(produtoId);
                porProduto.put(produtoId, (atual == null ? 0L : atual) + toLong(linha.get("quantidade")));
            }
        }

        Map<Object, Map<Object, Long>> qtdPorExpedicaoProduto = new LinkedHashMap<>();
        if (expedicaoItens != null) {
            for (Map<String, Object> item : expedicaoItens) {
                Object expedicaoId = item.get("expedicaoId");
                Object produtoId = item.get("produtoId");
                Map<Object, Long> porProduto = qtdPorExpedicaoProduto.get(expedicaoId);
                if (porProduto == null) {
                    porProduto = new LinkedHashMap<>();
                    qtdPorExpedicaoProduto.put(expedicaoId, porProduto);
                }
                Long atual = porProduto.get(produtoId);
                porProduto.put(produtoId, (atual == null ? 0L : atual) + toLong(item.get("quantidade")));
            }
        }

        List<Map<String, Object>> recebimentosElegiveis = new ArrayList<>();
        if (recebimentos != null) {
            for (Map<String, Object> recebimento : recebimentos) {
                if ("Normal".equals(String.valueOf(recebimento.get("situacao")))
                        && !Boolean.TRUE.equals(recebimento.get("crossDockingAtivo"))) {
                    recebimentosElegiveis.add(recebimento);
                }
            }
        }
        List<Map<String, Object>> expedicoesElegiveis = new ArrayList<>();
        if (expedicoes != null) {
            for (Map<String, Object> expedicao : expedicoes) {
                if ("Normal".equals(String.valueOf(expedicao.get("situacao")))
                        && !"SaidaConfirmada".equals(String.valueOf(expedicao.get("estagio")))
                        && !Boolean.TRUE.equals(expedicao.get("crossDockingAtivo"))) {
                    expedicoesElegiveis.add(expedicao);
                }
            }
        }

        String hoje = LocalDate.now().toString();
        List<Map<String, Object>> candidatos = new ArrayList<>();
        for (Map<String, Object> recebimento : recebimentosElegiveis) {
            Map<Object, Long> produtosRecebimento = qtdPorRecebimentoProduto.get(recebimento.get("id"));
            if (produtosRecebimento == null || produtosRecebimento.isEmpty()) {
                continue;
            }
            for (Map<String, Object> expedicao : expedicoesElegiveis) {
                Map<Object, Long> produtosExpedicao = qtdPorExpedicaoProduto.get(expedicao.get("id"));
                if (produtosExpedicao == null || produtosExpedicao.isEmpty()) {
                    continue;
                }
                for (Map.Entry<Object, Long> entry : produtosRecebimento.entrySet()) {
                    Long necessario = produtosExpedicao.get(entry.getKey());
                    if (necessario == null || necessario <= 0) {
                        continue;
                    }
                    long quantidade = Math.min(entry.getValue(), necessario);
                    if (quantidade <= 0) {
                        continue;
                    }
                    Map<String, Object> candidato = new LinkedHashMap<>();
                    candidato.put("recebimentoId", recebimento.get("id"));
                    candidato.put("expedicaoId", expedicao.get("id"));
                    candidato.put("produtoId", entry.getKey());
                    candidato.put("quantidade", quantidade);
                    candidato.put("dataAtivacao", hoje);
                    candidatos.add(candidato);
                }
            }
        }
        return Map.of("candidatos", candidatos);
    }

    /**
     * WMS-9 C7 gate (WMSOFFICE_SCREEN_PARITY_CHECKLIST.md 2.5, per the original GeneXus manual --
     * D:\WorkSpace\WmsOffice\Doctos\CrossDoking.html: "nao e possivel confirmar a movimentacao
     * [da expedicao] quando houver um CrossDocking ativo cujo recebimento nao tenha a conferencia
     * registrada"). Called before Expedicao's DemandaGerada-&gt;MovimentacaoConcluida transition
     * commits. Unlike every other method in this file, this one THROWS on failure instead of
     * returning {@code sucesso:false} -- ManifestDrivenJavaSourcePluginHandler.invoke unwraps a
     * thrown exception's own message straight through to the calling procedure as a genuine
     * failure (confirmed by reading its InvocationTargetException/getCause handling directly),
     * which is what actually blocks the transition; a soft sucesso:false map would need the DSL
     * side to branch on it, and no such branch exists in the calling procedure by design -- the
     * capabilityCall step itself IS the gate.
     *
     * <p>Params declared alphabetically, same convention as {@link #candidatosCrossDocking}.
     */
    public Map<String, Object> verificarGateCrossDocking(
            List<Map<String, Object>> crossDockings, Object expedicaoId, List<Map<String, Object>> recebimentos) {
        if (crossDockings != null && recebimentos != null) {
            Map<Object, Map<String, Object>> recebimentoPorId = new LinkedHashMap<>();
            for (Map<String, Object> recebimento : recebimentos) {
                recebimentoPorId.put(recebimento.get("id"), recebimento);
            }
            for (Map<String, Object> crossDocking : crossDockings) {
                if (!sameId(crossDocking.get("expedicaoId"), expedicaoId)) {
                    continue;
                }
                if (!"Ativo".equals(String.valueOf(crossDocking.get("situacao")))) {
                    continue;
                }
                Map<String, Object> recebimento = recebimentoPorId.get(crossDocking.get("recebimentoId"));
                String estagio = recebimento == null ? null : String.valueOf(recebimento.get("estagio"));
                if (!"Conferido".equals(estagio) && !"Armazenado".equals(estagio)) {
                    throw new IllegalStateException(
                            "Nao e possivel confirmar a movimentacao: ha um Cross-Docking ativo cujo "
                                    + "recebimento vinculado ainda nao teve a conferencia registrada.");
                }
            }
        }
        return Map.of("sucesso", true);
    }

    /**
     * WMS-9 C7 bay lookup (WMSOFFICE_SCREEN_PARITY_CHECKLIST.md 2.5, per the original GeneXus
     * manual): finds an existing CrossDocking-function staging Area/Rua for the given Entidade's
     * Armazem, if one exists -- the caller (ProvisionarBaiaCrossDockingProcedure) uses the result
     * with patchConcept's own createIfMissing convention (a null id there means "create fresh"),
     * so this method only ever LOOKS UP, never writes. Java does the multi-level join (Armazem -&gt;
     * Area -&gt; Rua) because mapList/procedure steps have no cross-list join primitive, same
     * reasoning {@link #candidatosCrossDocking} above already established. Throws if no Armazem
     * exists for the Entidade at all (Cross-Docking has nowhere to stage goods without one) --
     * unlike a missing Area/Rua, which is expected on first use and simply triggers creation.
     *
     * <p>Params declared alphabetically, same convention as {@link #candidatosCrossDocking}.
     */
    public Map<String, Object> localizarBaiaCrossDocking(
            List<Map<String, Object>> areas, List<Map<String, Object>> armazens, Object entidadeId,
            List<Map<String, Object>> ruas) {
        Object armazemId = null;
        if (armazens != null) {
            for (Map<String, Object> armazem : armazens) {
                if (sameId(armazem.get("entidadeId"), entidadeId)) {
                    armazemId = armazem.get("id");
                    break;
                }
            }
        }
        if (armazemId == null) {
            throw new IllegalStateException(
                    "Nao foi possivel localizar um Armazem para esta Entidade -- Cross-Docking "
                            + "requer um armazem cadastrado.");
        }
        Object areaCrossDockingId = null;
        if (areas != null) {
            for (Map<String, Object> area : areas) {
                if (sameId(area.get("armazemId"), armazemId)
                        && "CrossDocking".equals(String.valueOf(area.get("funcao")))) {
                    areaCrossDockingId = area.get("id");
                    break;
                }
            }
        }
        Object ruaCrossDockingId = null;
        if (areaCrossDockingId != null && ruas != null) {
            for (Map<String, Object> rua : ruas) {
                if (sameId(rua.get("areaId"), areaCrossDockingId)) {
                    ruaCrossDockingId = rua.get("id");
                    break;
                }
            }
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("armazemId", armazemId);
        result.put("areaCrossDockingId", areaCrossDockingId);
        result.put("ruaCrossDockingId", ruaCrossDockingId);
        return result;
    }

    private static Map<String, Object> failure(String motivo) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("localArmazenagemId", null);
        result.put("motivo", motivo);
        result.put("sucesso", false);
        return result;
    }

    /**
     * WMS-16 (WMSOFFICE_SCREEN_PARITY_CHECKLIST.md 2.3, "Adicionar Itens" duplicate-product
     * refusal): a Recebimento must never carry two RecebimentoLote rows for the same produto --
     * RecebimentoLote itself only carries a loteId, not a produtoId directly, so this joins it
     * through Lote first, the same one-hop-via-Lote join {@link #candidatosCrossDocking}'s own doc
     * comment already established (mapList/procedure steps have no cross-list join primitive).
     * Same "THROW to block" precedent as {@link #verificarGateCrossDocking} -- confirmed by reading
     * ManifestDrivenJavaSourcePluginHandler.invoke directly, a thrown exception's message reaches
     * the calling procedure as a genuine failure, which is what actually blocks the add; a soft
     * sucesso:false map would need the DSL side to branch on it, and the calling procedure
     * (AdicionarItemRecebimentoProcedure) has no such branch by design -- this capabilityCall step
     * itself IS the gate. Params declared alphabetically (loteId, lotes, recebimentoId,
     * recebimentoLotes), same resolveMethod binding-order convention as every other multi-arg
     * method in this file.
     */
    public Map<String, Object> verificarProdutoDuplicado(
            Object loteId, List<Map<String, Object>> lotes, Object recebimentoId,
            List<Map<String, Object>> recebimentoLotes) {
        Object produtoId = null;
        if (lotes != null) {
            for (Map<String, Object> lote : lotes) {
                if (sameId(lote.get("id"), loteId)) {
                    produtoId = lote.get("produtoId");
                    break;
                }
            }
        }
        if (produtoId == null) {
            throw new IllegalStateException("Lote informado nao foi encontrado.");
        }
        if (recebimentoLotes != null) {
            Map<Object, Object> produtoPorLote = new LinkedHashMap<>();
            if (lotes != null) {
                for (Map<String, Object> lote : lotes) {
                    produtoPorLote.put(lote.get("id"), lote.get("produtoId"));
                }
            }
            for (Map<String, Object> existente : recebimentoLotes) {
                if (!sameId(existente.get("recebimentoId"), recebimentoId)) {
                    continue;
                }
                Object existenteProdutoId = produtoPorLote.get(existente.get("loteId"));
                if (sameId(existenteProdutoId, produtoId)) {
                    throw new IllegalStateException(
                            "Este produto ja foi adicionado a este recebimento em outro lote.");
                }
            }
        }
        return Map.of("produtoId", produtoId, "sucesso", true);
    }

    /**
     * WMS-16 Expedicao residual (WMSOFFICE_SCREEN_PARITY_CHECKLIST.md 2.3, "Adicionar Itens"
     * duplicate-product refusal, Expedicao side): {@link #verificarProdutoDuplicado}'s twin for
     * ExpedicaoDemandaPanel's own "itens" dataSource -- simpler than the Recebimento side since
     * ExpedicaoItem carries produtoId directly, no Lote join needed. Same "THROW to block"
     * precedent as {@link #verificarGateCrossDocking}/{@link #verificarProdutoDuplicado} --
     * AdicionarItemExpedicaoProcedure has no branch on a soft sucesso:false, so this capabilityCall
     * step itself IS the gate. Params declared alphabetically (expedicaoId, itens, produtoId), same
     * resolveMethod binding-order convention as every other multi-arg method in this file.
     */
    public Map<String, Object> verificarProdutoDuplicadoExpedicao(
            Object expedicaoId, List<Map<String, Object>> itens, Object produtoId) {
        if (itens != null) {
            for (Map<String, Object> existente : itens) {
                if (sameId(existente.get("expedicaoId"), expedicaoId)
                        && sameId(existente.get("produtoId"), produtoId)) {
                    throw new IllegalStateException(
                            "Este produto ja foi adicionado a esta expedicao em outro item.");
                }
            }
        }
        return Map.of("produtoId", produtoId, "sucesso", true);
    }
}
