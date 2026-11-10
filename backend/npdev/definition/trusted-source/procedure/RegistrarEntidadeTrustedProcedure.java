import java.util.List;
import java.util.Map;
import java.util.UUID;

public final class RegistrarEntidadeTrustedProcedure {
    public Map<String, Object> execute(NPDevProcedureContext ctx) {
        String id = UUID.randomUUID().toString();
        Map<String, Object> entidade = Map.of(
            "id", id,
            "nome", "Entidade Trusted-Source " + id.substring(0, 8),
            "tipo", "Cliente",
            "ativo", true
        );
        List<Map<String, Object>> saved = ctx.saveMany("Entidade", List.of(entidade));
        return Map.of(
            "createdCount", saved.size(),
            "actorId", ctx.actorId(),
            "entidades", saved
        );
    }
}
