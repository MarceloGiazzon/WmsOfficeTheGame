package com.wmsoffice.capabilities.fiscal;

import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;

import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import java.io.ByteArrayInputStream;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class FiscalImportCapability {

    @SuppressWarnings("unchecked")
    public Map<String, Object> importarNfe(Map<String, Object> input) {
        return importarNfe(listOf(input.get("chavesJaImportadas")), input, listOf(input.get("produtosConhecidos")));
    }

    /**
     * Move 5 (docs/MOVE5_CLOSE_ALL_OPEN_PLAN.md, Wave 3A / Gap 6): the produtosConhecidos/
     * chavesJaImportadas auto-match/dedup helpers ParseNfeProcedure's own doc comment named as
     * "intentionally omitted... a real, separate, narrower gap" until mapList existed to build
     * them from a listConcepts result. This 3-arg overload takes them positionally (a 3-entry
     * callCapability args map resolves to a 3-arg reflective invoke, matched by name+argCount --
     * see ArtifactLocalJavaSourceCapabilityHandler) instead of nested inside input, so the
     * pre-existing 1-arg overload above (still used by the ImportarNfe flow) is unchanged. Both
     * lists are always objects (mapList's select builds one object per item, never a bare scalar),
     * so chavesJaImportadas reads {chave: "..."} entries rather than raw strings.
     *
     * <p><b>Parameter order matters:</b> {@code ArtifactLocalJavaSourceCapabilityHandler} invokes
     * reflectively by POSITION (matched only by method name + arg count), binding the step's
     * {@code args} values in their declared key order. ParseNfeProcedure declares them
     * chavesJaImportadas, input, produtosConhecidos to match this signature (that order was forced
     * on it by the pre-#34 alphabetical compile; {@code npdev migrate procedure-args-order} kept it).
     */
    public Map<String, Object> importarNfe(
            List<Map<String, Object>> chavesJaImportadas,
            Map<String, Object> input,
            List<Map<String, Object>> produtosConhecidos
    ) {
        String xml = String.valueOf(input.get("xml"));

        try {
            DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
            factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
            factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD, "");
            factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");
            factory.setNamespaceAware(true);
            DocumentBuilder builder = factory.newDocumentBuilder();
            Document doc = builder.parse(new ByteArrayInputStream(xml.getBytes(StandardCharsets.UTF_8)));
            doc.getDocumentElement().normalize();

            // Real SEFAZ NFe 4.00 layout (infNFe/ide/emit/det/prod) is tried first; the
            // project's earlier simplified tags (numero/chave/dataEmissao/emitente/item) remain
            // a fallback so pre-existing samples/tests keep working unchanged.
            String numero = firstText(doc, "nNF");
            if (numero == null) numero = firstText(doc, "numero");

            String chaveResolved = chaveFromInfNfeId(doc);
            if (chaveResolved == null) chaveResolved = firstText(doc, "chNFe");
            if (chaveResolved == null) chaveResolved = firstText(doc, "chave");
            final String chave = chaveResolved;

            boolean chaveJaImportada = false;
            if (chave != null) {
                for (Map<String, Object> v : chavesJaImportadas) {
                    if (chave.equals(String.valueOf(v.get("chave")))) {
                        chaveJaImportada = true;
                        break;
                    }
                }
            }
            if (chaveJaImportada) {
                return failure("NF-e ja importada anteriormente (chave duplicada): " + chave);
            }

            String dataEmissao = firstText(doc, "dhEmi");
            if (dataEmissao == null) dataEmissao = firstText(doc, "dEmi");
            if (dataEmissao == null) dataEmissao = firstText(doc, "dataEmissao");

            String emitenteCnpj = firstTextUnder(doc, "emit", "CNPJ");
            if (emitenteCnpj == null) emitenteCnpj = firstTextUnder(doc, "emitente", "cnpj");

            List<Element> itemNodes = allByLocalName(doc.getDocumentElement(), "det");
            List<Map<String, Object>> itens = new ArrayList<>();
            for (Element det : itemNodes) {
                List<Element> prodNodes = allByLocalName(det, "prod");
                Element prod = prodNodes.isEmpty() ? det : prodNodes.get(0);
                String codigo = firstTextOf(prod, "cProd");
                String descricao = firstTextOf(prod, "xProd");
                long quantidade = parseDecimalAsLong(firstTextOf(prod, "qCom"));
                long valorUnitarioCentavos = parseCentavos(firstTextOf(prod, "vUnCom"));

                itens.add(buildItemResult(produtosConhecidos, codigo, descricao, quantidade, valorUnitarioCentavos));
            }

            if (itens.isEmpty()) {
                // Fallback: the project's earlier simplified <item> tag shape.
                NodeList legacyItemNodes = doc.getElementsByTagName("item");
                for (int i = 0; i < legacyItemNodes.getLength(); i++) {
                    Element item = (Element) legacyItemNodes.item(i);
                    String codigo = textOf(item, "codigo");
                    String descricao = textOf(item, "descricao");
                    long quantidade = parseLong(textOf(item, "quantidade"));
                    long valorUnitarioCentavos = parseCentavos(textOf(item, "valorUnitario"));
                    itens.add(buildItemResult(produtosConhecidos, codigo, descricao, quantidade, valorUnitarioCentavos));
                }
            }

            if (itens.isEmpty()) {
                return failure("Nenhum item encontrado na NF-e");
            }

            boolean todosRegistrados = todosRegistrados(itens);

            Map<String, Object> result = new LinkedHashMap<>();
            result.put("numero", numero);
            result.put("chave", chave);
            result.put("dataEmissao", dataEmissao);
            result.put("emitenteCnpj", emitenteCnpj);
            result.put("itens", itens);
            result.put("todosRegistrados", todosRegistrados);
            result.put("duplicado", false);
            result.put("sucesso", true);
            return result;
        } catch (Exception exception) {
            return failure("Falha ao interpretar XML da NF-e: " + exception.getMessage());
        }
    }

    /**
     * Move 10 W1.1 (docs/MOVE10_CONSOLE_PARITY_SPEC.md): the Romaneio twin of
     * {@link #importarNfe(List, Map, List)}'s 3-arg overload -- ParseRomaneioProcedure's
     * {@code callCapability} builds produtosConhecidos/numerosJaImportados with {@code mapList} and
     * passes them positionally, because nothing in the procedure DSL nests an already-computed list
     * inside a synthetic input Map (see the 3-arg importarNfe's own doc comment).
     *
     * <p><b>Parameter order is alphabetical-by-args-key, NOT declaration order</b>: ModelCompiler's
     * {@code sortObjectMap} normalizes every {@code callCapability} args map alphabetically before
     * compiling, and {@code ArtifactLocalJavaSourceCapabilityHandler} invokes reflectively by
     * POSITION (matched only by method name + arg count). Hence
     * "input" &lt; "numerosJaImportados" &lt; "produtosConhecidos".
     *
     * <p>{@code numerosJaImportados} arrives as {@code [{numero: "R-1"}, ...]} -- mapList's select
     * always builds one OBJECT per item, never a bare scalar -- while the pre-existing 1-arg
     * overload's own dedup check compares {@code String.valueOf(v)} against raw scalars (the shape
     * {@code conferencia-fiscal.html} posts). Flattening here rather than loosening the 1-arg check
     * keeps the still-live flow path byte-for-byte unchanged; passing the maps through unflattened
     * would have compared "{numero=R-1}" to "R-1" and silently disabled duplicate rejection.
     *
     * <p>{@code dataEmissao} is added to the result only on this path: the original console computed
     * it client-side as {@code new Date().toISOString().slice(0,10)} at confirm time, and a procedure
     * has no "today" expression, so the server supplies it. Additive -- the 1-arg overload and the
     * {@code ImportarRomaneio} flow that calls it are untouched.
     */
    public Map<String, Object> importarRomaneio(
            Map<String, Object> input,
            List<Map<String, Object>> numerosJaImportados,
            List<Map<String, Object>> produtosConhecidos
    ) {
        Map<String, Object> merged = new LinkedHashMap<>(input);
        merged.put("produtosConhecidos", produtosConhecidos == null ? List.of() : produtosConhecidos);
        List<Object> numerosPlanos = new ArrayList<>();
        if (numerosJaImportados != null) {
            for (Map<String, Object> entry : numerosJaImportados) {
                Object numero = entry == null ? null : entry.get("numero");
                if (numero != null) {
                    numerosPlanos.add(numero);
                }
            }
        }
        merged.put("numerosJaImportados", numerosPlanos);

        Map<String, Object> result = importarRomaneio(merged);
        result.put("dataEmissao", java.time.LocalDate.now().toString());
        return result;
    }

    public Map<String, Object> importarRomaneio(Map<String, Object> input) {
        String texto = String.valueOf(input.get("texto"));
        String numero = input.get("numero") == null ? null : String.valueOf(input.get("numero"));
        List<Map<String, Object>> produtosConhecidos = listOf(input.get("produtosConhecidos"));
        List<Object> numerosJaImportados = rawListOf(input.get("numerosJaImportados"));

        boolean numeroJaImportado = false;
        if (numero != null) {
            for (Object v : numerosJaImportados) {
                if (numero.equals(String.valueOf(v))) {
                    numeroJaImportado = true;
                    break;
                }
            }
        }
        if (numeroJaImportado) {
            return failure("Romaneio ja importado anteriormente (numero duplicado): " + numero);
        }

        List<Map<String, Object>> itens = new ArrayList<>();
        for (String linha : texto.split("\\r?\\n")) {
            String trimmed = linha.trim();
            if (trimmed.isEmpty()) {
                continue;
            }
            String[] partes = trimmed.split(";");
            if (partes.length < 2) {
                continue;
            }
            String codigo = partes[0].trim();
            long quantidade = parseLong(partes[1].trim());

            Map<String, Object> produto = encontrarProduto(produtosConhecidos, codigo);
            Map<String, Object> itemResult = new LinkedHashMap<>();
            itemResult.put("codigo", codigo);
            itemResult.put("quantidade", quantidade);
            itemResult.put("produtoId", produto == null ? null : produto.get("produtoId"));
            itemResult.put("registrado", produto != null);
            itens.add(itemResult);
        }

        if (itens.isEmpty()) {
            return failure("Nenhum item valido encontrado no romaneio");
        }

        boolean todosRegistrados = todosRegistrados(itens);

        Map<String, Object> result = new LinkedHashMap<>();
        // REG-225: echo numero back, the same way importarNfe's own result already echoes
        // numero/chave/dataEmissao/emitenteCnpj. numero only ever exists as the workbench action's
        // OWN inputField value (never written into the client draft itself), so the platform-level
        // store.patch merge fix (workbench-page.html.mustache) has nothing of the draft's own to
        // preserve here -- the capability has to hand it back explicitly or it is gone for good the
        // instant Import runs.
        result.put("numero", numero);
        result.put("itens", itens);
        result.put("todosRegistrados", todosRegistrados);
        result.put("duplicado", false);
        result.put("sucesso", true);
        return result;
    }

    private static boolean todosRegistrados(List<Map<String, Object>> itens) {
        for (Map<String, Object> it : itens) {
            if (!Boolean.TRUE.equals(it.get("registrado"))) {
                return false;
            }
        }
        return true;
    }

    private static Map<String, Object> buildItemResult(List<Map<String, Object>> produtosConhecidos, String codigo,
            String descricao, long quantidade, long valorUnitarioCentavos) {
        Map<String, Object> produto = encontrarProduto(produtosConhecidos, codigo);
        Map<String, Object> itemResult = new LinkedHashMap<>();
        itemResult.put("codigo", codigo);
        itemResult.put("descricao", descricao);
        itemResult.put("quantidade", quantidade);
        itemResult.put("valorUnitarioCentavos", valorUnitarioCentavos);
        itemResult.put("produtoId", produto == null ? null : produto.get("produtoId"));
        itemResult.put("registrado", produto != null);
        return itemResult;
    }

    /**
     * Real NFe XML carries the 44-digit access key as the numeric suffix of
     * {@code <infNFe Id="NFe...44 digits...">}, not as its own text-content element.
     */
    private static String chaveFromInfNfeId(Document doc) {
        for (Element infNfe : allByLocalName(doc.getDocumentElement(), "infNFe")) {
            String id = infNfe.getAttribute("Id");
            if (id != null && id.length() >= 44) {
                String digits = id.replaceAll("\\D", "");
                if (digits.length() >= 44) {
                    return digits.substring(digits.length() - 44);
                }
            }
        }
        return null;
    }

    private static List<Element> allByLocalName(Element root, String localName) {
        List<Element> found = new ArrayList<>();
        collectByLocalName(root, localName, found);
        return found;
    }

    private static void collectByLocalName(Element element, String localName, List<Element> found) {
        NodeList children = element.getChildNodes();
        for (int i = 0; i < children.getLength(); i++) {
            org.w3c.dom.Node node = children.item(i);
            if (node instanceof Element child) {
                String name = child.getLocalName() != null ? child.getLocalName() : child.getTagName();
                if (localName.equals(name)) {
                    found.add(child);
                }
                collectByLocalName(child, localName, found);
            }
        }
    }

    private static String firstTextOf(Element root, String localName) {
        List<Element> matches = allByLocalName(root, localName);
        return matches.isEmpty() ? null : matches.get(0).getTextContent().trim();
    }

    private static String firstText(Document doc, String localName) {
        return firstTextOf(doc.getDocumentElement(), localName);
    }

    private static String firstTextUnder(Document doc, String parentLocalName, String childLocalName) {
        List<Element> parents = allByLocalName(doc.getDocumentElement(), parentLocalName);
        if (parents.isEmpty()) {
            return null;
        }
        return firstTextOf(parents.get(0), childLocalName);
    }

    private static long parseDecimalAsLong(String value) {
        if (value == null || value.isBlank()) {
            return 0L;
        }
        try {
            return new BigDecimal(value.trim()).longValue();
        } catch (Exception ignored) {
            return parseLong(value);
        }
    }

    /**
     * REG-225: ParseRomaneioProcedure's own produtosConhecidos is keyed on Produto.nome (not
     * Produto.codigo -- several seeded Produto rows have a null codigo, and the original console's
     * own helper matched by nome), a deliberate, still-correct choice for that reason. But the
     * shared paste textarea gives the operator no signal about which field to type, and a numeric
     * "codigo" is the far more natural, intuitive token to paste -- typing one against a
     * nome-only-keyed list silently failed to match, leaving produtoId null and Save failing on a
     * confusing "RomaneioItem.produtoId" error with no indication why. Tries codigo first (matches
     * ParseNfeProcedure's own convention, and Romaneio's produtosConhecidos now carries a real
     * codigo entry too), then falls back to nome -- NFe's own produtosConhecidos never populates a
     * "nome" key at all, so this fallback is a no-op there and changes nothing for that path.
     */
    private static Map<String, Object> encontrarProduto(List<Map<String, Object>> produtosConhecidos, String codigo) {
        if (produtosConhecidos == null || codigo == null) {
            return null;
        }
        for (Map<String, Object> produto : produtosConhecidos) {
            if (codigo.equalsIgnoreCase(String.valueOf(produto.get("codigo")))) {
                return produto;
            }
        }
        for (Map<String, Object> produto : produtosConhecidos) {
            if (codigo.equalsIgnoreCase(String.valueOf(produto.get("nome")))) {
                return produto;
            }
        }
        return null;
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> listOf(Object value) {
        return value instanceof List ? (List<Map<String, Object>>) value : List.of();
    }

    @SuppressWarnings("unchecked")
    private static List<Object> rawListOf(Object value) {
        return value instanceof List ? (List<Object>) value : List.of();
    }

    private static String textOf(Document doc, String tag) {
        NodeList nodes = doc.getElementsByTagName(tag);
        return nodes.getLength() == 0 ? null : nodes.item(0).getTextContent().trim();
    }

    private static String textOf(Element parent, String tag) {
        NodeList nodes = parent.getElementsByTagName(tag);
        return nodes.getLength() == 0 ? null : nodes.item(0).getTextContent().trim();
    }

    private static String textOfNested(Document doc, String parentTag, String childTag) {
        NodeList parents = doc.getElementsByTagName(parentTag);
        if (parents.getLength() == 0) {
            return null;
        }
        return textOf((Element) parents.item(0), childTag);
    }

    private static long parseLong(String value) {
        if (value == null || value.isBlank()) {
            return 0L;
        }
        try {
            return Long.parseLong(value.trim());
        } catch (NumberFormatException ignored) {
            return 0L;
        }
    }

    private static long parseCentavos(String value) {
        if (value == null || value.isBlank()) {
            return 0L;
        }
        try {
            return new BigDecimal(value.trim()).movePointRight(2).longValueExact();
        } catch (Exception ignored) {
            return 0L;
        }
    }

    private static Map<String, Object> failure(String motivo) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("itens", List.of());
        result.put("motivo", motivo);
        result.put("sucesso", false);
        return result;
    }
}
