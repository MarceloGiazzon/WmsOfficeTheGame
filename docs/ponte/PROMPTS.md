# Prompts para entregar as tarefas a um agente

Um prompt por sessão de trabalho, uma tarefa (ou um bloco pequeno de tarefas) por vez. Copie o **modelo** e troque
`<TAREFA>` e o bloco "Específico". Os blocos abaixo já têm o específico de cada tarefa que pede mais contexto.

## Modelo

```text
Você vai implementar a tarefa <TAREFA> da ponte Jogo ↔ WmsOffice, no repositório ~/repos/WmsOfficeTheGame.

Leia, nesta ordem, antes de escrever código:
  1. docs/ponte/PLANO.md §0 a §6 (inteiro) e a seção da tarefa <TAREFA>;
  2. docs/ponte/CONTRATO_REST.md (como os servidores respondem — verificado ao vivo);
  3. backend/ponte/mapa.json (as regras de tradução) e os arquivos citados na tarefa.

Regras (PLANO §0.3, resumo): uma tarefa só; não mude testes já escritos nem exemplos/mini/esperado.json para
passar; não altere a definição do produto WmsOffice (~/repos/NPDev/AppGen/apps/_official/WmsOffice); nunca escreva
na topologia de um cenário do jogo; Python só com a biblioteca padrão; português em código, comentários e mensagens;
não faça commit; apague o que seus testes criarem no banco.

Termine rodando o "Pronto quando" da tarefa e mostre a saída real dos comandos. Marque a linha da tarefa em
docs/ponte/CHECKLIST.md com uma nota curta (data, números, desvios). Se cair em algum caso de PLANO §11
("Quando parar e perguntar"), pare e me pergunte em vez de contornar.

Específico desta tarefa:
<cole aqui o bloco da tarefa, abaixo, se houver>
```

## Blocos específicos

### T0.1–T0.3 (podem ir juntas)

```text
- O cliente REST copia a lógica de backend/npdev/tests/npdev_api.py (Api.call), mas é um módulo novo:
  backend/ponte/npdev.py. Não importe npdev_api na ponte (ele é helper de teste).
- Para o import de test_planejador.py funcionar desde a T0.2, crie fonte.py e planejador.py vazios primeiro.
- Rode os testes com: python3 -m unittest discover -s backend/ponte/tests -p 'test_planejador.py' -k <Classe> -v
```

### T0.4–T0.7 (o planejador)

```text
- O planejador é PURO: não importa npdev.py, não abre rede, não lê relógio (a data vem em Opcoes.data).
- A interface exata está no PLANO §5.9; as regras em §5.1–§5.8 e em mapa.json. Os 29 testes de
  backend/ponte/tests/test_planejador.py e exemplos/mini/esperado.json são a especificação.
- Use preencher() do mapa.py para TODA chave e TODO corpo; não monte corpo de registro à mão no planejador.
- Contexto com todas as chaves que os modelos usam (ex.: produto.diasValidadePadrao = None se faltar), senão KeyError.
- Ordem determinística: nada de iterar set; use listas e dict (ordem de inserção).
```

### T0.8–T0.9 (executor e linha de comando)

```text
- O modelo do executor é backend/ponte/referencia/ciclo_rest_verificado.py: as mesmas chamadas, na mesma ordem.
- Antes de cada passo de ciclo, GET e compare o estado: repetir um flow Confirmar* duplica o histórico (CONTRATO [A1]).
- Ao comparar ocorridoEm, compare instantes (o /page devolve -03:00, o GET por id devolve Z).
- O diário só cresce (append + flush logo após cada POST). limpar = ordem inversa, pula compartilhados.
- Aceite: python3 backend/ponte/tests/aceite_p0.py e depois com --completo. Os dois têm de dar OK: 0 falha(s).
```

### T1.1 (gravador de rastro no motor)

```text
- Mexe em src/sim/simulation.ts, o coração do jogo. Só ACRESCENTE anotações nos pontos listados no PLANO T1.1;
  não mude nenhuma outra linha, nem a ordem de chamadas existente.
- npm test tem de continuar verde SEM alterar goldens; git diff src/sim/simulation.test.ts tem de sair vazio.
- O formato do evento é o de backend/ponte/rastro.schema.json (8 campos, sempre presentes, null quando não se aplica).
```

### T1.3 / T1.6 / T2.1 (backend do jogo)

```text
- Siga backend/ponte/modelos/ALTERACOES_BACKEND.md ao pé da letra (os JSON dos concepts já estão prontos).
- Depois: ~/repos/NPDev/NPDev_General/npdev validate model backend/npdev/definition/model.json (0 erros) e
  backend/npdev/rebuild.sh (SEM --reset-db). Se o boot recusar a migração, PARE e me pergunte.
- Rode os testes ao vivo antigos (backend/npdev/tests/n1_sim_concepts.py, n2_simulacao_flows.py, n3_jogador.py) além do novo.
```

### T1.4 (cliente envia o rastro)

```text
- Leia antes: src/app/partidaOnline.ts (concluir, paraExtras), src/net/filaEnvio.ts, src/net/leitura.ts,
  src/net/servidorFalso.ts e os testes vizinhos, para seguir os padrões de erro (NpdevError) e de teste.
- Falha no envio do rastro nunca derruba o resultado da partida; vira texto nos extras.
- Teste manual no navegador: veja a memória do projeto sobre o Chrome headless (login lembra o usuário; espere com
  { polling: 100 }; limpe SimPartida/SimScore/SimEvento criados).
```

### T1.9 (corporativo :8100)

```text
- Suba o app com: cd ~/repos/NPDev/Build/generated-finalapps-linux/wmsoffice/App && sh _ops/start-app.sh
- Não regenere nem recompile o WmsOffice; não mexa em nada em ~/repos/NPDev/AppGen/apps/_official/WmsOffice.
- Se a referência der diferente na :8100, pare e descreva a diferença antes de mudar qualquer código.
```

### T2.x (importador)

```text
- Leia src/sim/layout.ts (construirLayout): é ele que decide o que é doca e o que é rua de armazenagem.
- O importador grava no JOGO (:8200) e lê do CORPORATIVO (:8100). Reaproveite Executor e Diario da P0.
- Os valores de referência (qtdOrdens, distanciaTeoricaCm) vêm do mesmo pipeline dos cenários embutidos:
  backend/npdev/tools/teorica_cenarios.ts via npx vite-node. Sem eles o ConcluirPartida recusa a partida.
```

### T3.2 (botão no resultado)

```text
- Leia src/ui/resultado.ts, src/app/resultado.ts e src/app/partidaOnline.ts. O texto da tela é em português, curto.
- O endereço do WmsOffice aparece como texto copiável além do link.
- Sem o vigia rodando, a solicitação fica "Solicitada": depois de 30 s, explique como ligar a ponte.
```
