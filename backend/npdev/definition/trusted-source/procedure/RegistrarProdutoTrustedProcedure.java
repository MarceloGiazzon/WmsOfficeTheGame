import java.util.List;
import java.util.Map;
import java.util.UUID;

public final class RegistrarProdutoTrustedProcedure {
    public Map<String, Object> execute(NPDevProcedureContext ctx) {
        String id = UUID.randomUUID().toString();
        Map<String, Object> produto = Map.of(
            "id", id,
            "nome", "Produto Trusted-Source " + id.substring(0, 8),
            "qtdCaixasPorPallet", 12,
            "ativo", true
        );
        List<Map<String, Object>> saved = ctx.saveMany("Produto", List.of(produto));
        return Map.of(
            "createdCount", saved.size(),
            "actorId", ctx.actorId(),
            "produtos", saved
        );
    }
}
