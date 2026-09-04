import type { ReactNode } from 'react'
import { LEGAL_VERSION } from '@/lib/legal'

function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-bold text-ink">{title}</h2>
      <div className="space-y-3 text-sm leading-relaxed text-ink-secondary">
        {children}
      </div>
    </section>
  )
}

function LegalList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item} className="flex gap-2">
          <span className="mt-2 h-1.5 w-1.5 rounded-full bg-brand shrink-0" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )
}

function LegalHeader({ label, title, description }: { label: string; title: string; description: string }) {
  return (
    <div className="space-y-3">
      <p className="section-label">{label}</p>
      <h1 className="text-4xl font-extrabold text-ink">{title}</h1>
      <p className="text-ink-secondary leading-relaxed">{description}</p>
      <p className="text-xs text-ink-muted">Última atualização: {LEGAL_VERSION}</p>
    </div>
  )
}

export function TermsPage() {
  return (
    <div className="py-16">
      <div className="container-app max-w-3xl space-y-8">
        <LegalHeader
          label="Termos"
          title="Termos de Uso"
          description="Leia estes termos antes de criar sua conta, contratar serviços ou utilizar qualquer área da EloPeak."
        />

        <LegalSection title="1. Aceitação">
          <p>
            Ao acessar, criar conta ou contratar qualquer serviço na EloPeak, o usuário declara que leu, compreendeu e
            concorda com estes Termos de Uso e com a Política de Privacidade. Caso não concorde com alguma condição, o
            usuário não deve utilizar a plataforma nem contratar serviços.
          </p>
        </LegalSection>

        <LegalSection title="2. Elegibilidade">
          <p>
            A EloPeak é destinada a maiores de 18 anos ou a menores emancipados nos termos da lei brasileira. Ao criar
            conta, o usuário declara possuir capacidade civil para contratar. Contas de menores de 18 anos identificadas
            pela EloPeak podem ser suspensas ou encerradas a qualquer momento.
          </p>
        </LegalSection>

        <LegalSection title="3. Objeto da plataforma">
          <p>
            A EloPeak oferece uma plataforma de intermediação de serviços digitais relacionados a jogos, incluindo Solo
            Boost, Duo Boost, pacotes de vitórias avulsas, MD5, Clash e coaching, prestados por boosters cadastrados e
            aprovados na plataforma. O serviço contratado corresponde apenas ao que for descrito e configurado no
            pedido, incluindo elo, fila, divisão de destino e demais opções selecionadas no checkout.
          </p>
        </LegalSection>

        <LegalSection title="4. Cadastro e autenticação">
          <p>
            O acesso à plataforma é realizado por login social via Discord. Ao vincular sua conta, o usuário autoriza o
            uso das informações necessárias para autenticação e identificação dentro da EloPeak.
          </p>
          <LegalList
            items={[
              'Podemos receber Discord ID, nome de usuário, e-mail autorizado e avatar diretamente do Discord.',
              'O nome de usuário vindo do Discord não pode ser alterado pelo usuário; boosters aprovados podem definir um nome de exibição próprio, alterável a cada 30 dias.',
              'A EloPeak não solicita nem armazena a senha da conta Discord.',
              'O usuário deve manter a própria conta Discord segura e informar suspeitas de uso não autorizado.',
              'É proibido criar cadastros múltiplos, transferir conta da plataforma ou fornecer dados falsos.',
              'Ações realizadas diretamente pela plataforma (envio de mensagens, solicitações de drop, submissões de pedido e outras interações) podem estar sujeitas a limites de frequência (rate limiting), aplicados para prevenir abuso, automação indevida e proteger a estabilidade do serviço.',
            ]}
          />
        </LegalSection>

        <LegalSection title="5. Boosters">
          <p>
            Boosters passam por um processo de candidatura e aprovação antes de operar na plataforma, com fornecimento
            de nome completo, CPF e demais dados necessários ao pagamento via PIX. A prioridade de atribuição de
            pedidos e a posição na fila de disponibilidade podem variar conforme desempenho, avaliações e critérios
            internos definidos pela EloPeak. A EloPeak pode suspender, rebaixar prioridade ou desligar um booster por
            descumprimento destes Termos, fraude, baixo desempenho ou conduta prejudicial a clientes.
          </p>
        </LegalSection>

        <LegalSection title="6. Janela de análise antes da divulgação do pedido">
          <p>
            Após a confirmação do pagamento — e, quando o serviço exigir, após o envio das credenciais de acesso —
            todo pedido contratado passa por uma janela interna de análise de até 1 (um) minuto antes de ficar visível
            na aba de pedidos disponíveis para boosters e antes de qualquer anúncio automático em canais como o
            Discord.
          </p>
          <LegalList
            items={[
              'Durante esse período, o pedido fica em análise administrativa e ainda não pode ser aceito por nenhum booster.',
              'A equipe da EloPeak pode, dentro dessa janela, atribuir o pedido diretamente a um booster específico, travar a liberação automática para revisão adicional, ou intervir em caso de suspeita de fraude, erro de configuração ou qualquer outra inconsistência.',
              'Encerrada a janela sem intervenção manual, o pedido é liberado automaticamente para a fila geral de boosters e para os anúncios da plataforma.',
              'Essa janela se aplica apenas à entrada de um pedido novo na fila; pedidos reabertos por drop ou reatribuição retornam diretamente à fila geral, sem passar novamente por essa análise.',
            ]}
          />
        </LegalSection>

        <LegalSection title="7. Reserva exclusiva de pedidos (12 horas)">
          <p>
            Quando um booster aceita um pedido disponível na fila geral, ou quando a administração atribui um pedido
            diretamente a um booster específico, o pedido passa a contar com uma reserva de exclusividade de 12
            (doze) horas para aquele booster, funcionando como um pedido exclusivo.
          </p>
          <LegalList
            items={[
              'Durante essa janela, apenas o booster reservado pode confirmar o aceite do pedido; nenhum outro booster tem acesso a ele.',
              'Caso as 12 horas se esgotem sem confirmação de aceite, o pedido retorna automaticamente à fila geral, ficando disponível para qualquer booster elegível.',
              'A mesma regra de reserva e prazo se aplica tanto a pedidos aceitos espontaneamente quanto a atribuições diretas feitas pela administração.',
            ]}
          />
        </LegalSection>

        <LegalSection title="8. Execução dos serviços">
          <p>
            Após confirmação do pagamento e liberação do pedido, o serviço será executado conforme as informações
            configuradas. Em serviços que exigirem acesso à conta de jogo, o usuário fornece voluntariamente as
            credenciais necessárias apenas para a execução do pedido. Cliente e booster passam a se identificar
            reciprocamente (Discord ID/nome de usuário) no canal de atendimento do pedido, criado exclusivamente para
            essa finalidade.
          </p>
          <LegalList
            items={[
              'O booster deve acessar a conta de jogo somente para executar o serviço contratado.',
              'O booster não deve alterar e-mail, senha, dados pessoais ou usar credenciais para outra finalidade.',
              'O usuário autoriza expressamente o booster a ajustar configurações técnicas do jogo, páginas de runas, atalhos de teclado e a utilizar moedas virtuais gratuitas da própria conta (como Essência Azul ou equivalentes), exclusivamente quando necessário para a viabilidade, adaptação técnica e execução do pedido contratado.',
              'Prazos podem ser ajustados em caso de manutenção do jogo, indisponibilidade de servidores ou caso fortuito.',
              'A verificação de conclusão de alguns serviços é feita por consulta à API pública da Riot Games; instabilidades dessa API podem atrasar a confirmação do pedido.',
            ]}
          />
        </LegalSection>

        <LegalSection title="9. Interferência de acesso e partidas pelo cliente">
          <p>
            O usuário concorda em não acessar a conta de jogo ou jogar partidas na mesma fila/modo contratado durante
            o período em que o pedido estiver em andamento. Caso o usuário acesse a conta e jogue partidas na
            modalidade do serviço contratado sem autorização prévia:
          </p>
          <LegalList
            items={[
              'Quaisquer derrotas ou perdas de pontos/progresso causadas pelo usuário serão contabilizadas e deduzidas da meta do pedido, exigindo o pagamento de saldo adicional proporcional para a devida recomposição pelo booster; ou',
              'Havendo interferência recorrente que inviabilize a execução, a EloPeak reserva-se o direito de encerrar o pedido, dando o serviço como concluído na proporção do progresso já entregue, sem direito a reembolso das partidas/etapas afetadas.',
            ]}
          />
        </LegalSection>

        <LegalSection title="10. Ajuste por ganho de LP (MMR da conta)">
          <p>
            Para pedidos configurados em elos abaixo de Mestre, os preços base da plataforma consideram uma média de
            ganho igual ou superior a 20 LP (PDL) por vitória. Caso seja verificado durante a execução que a conta do
            usuário possui um ganho médio inferior a 20 LP por partida, haverá a aplicação automática de um adicional
            de 10% sobre o valor do serviço para compensar o volume extra de partidas necessárias.
          </p>
        </LegalSection>

        <LegalSection title="11. Duo Boost — conta registrada e apuração de partidas">
          <p>
            Em pedidos de Duo Boost, apenas as vitórias e derrotas registradas em partidas nas quais a conta de
            duo/booster cadastrada para aquele pedido efetivamente participou são contabilizadas para o progresso e a
            meta contratada. Partidas jogadas fora dessa conta registrada, ou por conta de duo diversa da vinculada ao
            pedido, não são computadas no resultado do serviço.
          </p>
          <p>
            Em pedidos Solo, a(s) lane(s) informada(s) no pedido corresponde(m) à(s) posição(ões) que o booster deve
            jogar na conta do cliente. Em pedidos Duo, a(s) lane(s) informada(s) corresponde(m) à(s) posição(ões) que o
            próprio cliente pretende jogar; a(s) posição(ões) complementar(es) ficam disponíveis para o booster jogar
            na conta de duo registrada para a execução do serviço.
          </p>
        </LegalSection>

        <LegalSection title="12. Drops, cancelamento antecipado e reatribuição">
          <p>
            Considera-se &quot;drop&quot; a interrupção antecipada da execução de um pedido antes da conclusão da meta
            contratada. O cliente tem direito a solicitar até 2 (dois) drops por pedido, e o booster designado ao
            pedido também pode solicitar drop dentro desse mesmo limite.
          </p>
          <LegalList
            items={[
              'Toda solicitação de drop feita pelo cliente ou pelo booster deve vir acompanhada de justificativa e depende de aprovação da administração da EloPeak antes de produzir qualquer efeito; a administração também pode determinar um drop de forma unilateral, sem necessidade de aprovação adicional, quando identificar violação destes Termos, fraude ou outra situação que exija intervenção imediata.',
              'Quando um drop é aprovado, o pedido é reaberto para reatribuição a outro booster disponível, preservando o progresso já entregue até aquele momento.',
              'O progresso entregue até o drop é liquidado proporcionalmente: se o booster avançou mais vitórias do que derrotas durante o período em que esteve responsável pelo pedido, ele recebe o pagamento proporcional ao progresso entregue; se o resultado for negativo (mais derrotas do que vitórias), aplica-se um desconto sobre o saldo do booster relativo àquele pedido, sendo o valor integral quando o próprio booster solicitou o drop, e um valor reduzido quando o drop foi solicitado pelo cliente ou determinado pela administração.',
              'Pedidos de Elo Boost ou Duo Boost com resultado negativo no momento do drop distinguem quem solicitou a interrupção para fins do cálculo da penalidade aplicável, conforme descrito acima.',
              'Ao atingir o limite de 2 drops em um mesmo pedido, uma terceira interrupção não reabre automaticamente o pedido para outro booster: o pedido é cancelado e movido para análise manual da equipe (centro de resolução), sem reatribuição automática, até que a administração defina o desfecho.',
            ]}
          />
        </LegalSection>

        <LegalSection title="13. Centro de resolução e pedidos em análise">
          <p>
            Pedidos que atingem o limite de drops, ou que apresentem qualquer outra inconsistência que exija
            intervenção manual, são colocados em status de análise (&quot;em revisão&quot;) e tratados individualmente
            pela equipe da EloPeak através do centro de resolução interno. O cliente e o booster envolvidos são
            notificados e podem ser contatados pelo canal de atendimento do pedido para fornecer informações
            adicionais. O desfecho — reembolso total ou parcial ao cliente, crédito ou desconto no saldo do booster,
            ou reabertura manual do pedido — é definido caso a caso pela administração, com base no progresso
            comprovado e nas justificativas apresentadas. Todo o histórico de status e as decisões tomadas em cada
            pedido ficam registrados e podem ser consultados pelo cliente e pelo booster envolvidos na linha do tempo
            do próprio pedido.
          </p>
        </LegalSection>

        <LegalSection title="14. Riscos assumidos pelo usuário">
          <p>
            O usuário reconhece que desenvolvedoras, publicadoras ou administradoras de jogos podem proibir boosting,
            compartilhamento de conta ou práticas semelhantes. O uso desses serviços pode gerar advertências,
            restrições, suspensão temporária, banimento permanente, perda de progresso, itens ou outros efeitos
            previstos pelas regras do jogo.
          </p>
          <p>
            A contratação ocorre por livre escolha do usuário, que assume os riscos associados às regras de terceiros.
            A EloPeak não controla decisões, sanções, instabilidades ou políticas aplicadas pelas empresas responsáveis
            por cada jogo, nem pela Riot Games em relação à API usada para verificação de resultado.
          </p>
        </LegalSection>

        <LegalSection title="15. Pagamento">
          <p>
            Os pagamentos são feitos via PIX, processados pela Mercado Pago, de forma antecipada, e o pedido só é
            processado após confirmação. Os valores são apresentados no checkout conforme serviço, rank, fila, extras
            e demais opções selecionadas. A EloPeak não acessa nem armazena dados bancários ou de conta PIX do
            cliente — esse processamento é feito diretamente pela Mercado Pago.
          </p>
        </LegalSection>

        <LegalSection title="16. Direito de arrependimento e reembolso">
          <p>
            Nos termos do art. 49 do Código de Defesa do Consumidor, o cliente tem até 7 dias corridos após a
            contratação para desistir do serviço sem justificativa, com reembolso integral, desde que a execução ainda
            não tenha começado. Ao configurar o pedido com prazo de início imediato, o cliente solicita expressamente
            que a execução comece antes do fim desse prazo, o que limita o direito de arrependimento à parte ainda não
            executada a partir desse ponto.
          </p>
          <LegalList
            items={[
              'Se houver execução parcial, o reembolso poderá ser proporcional à parte não executada.',
              'Não há reembolso por desistência após a conclusão do serviço.',
              'Não há reembolso por suspensão, banimento ou penalidade aplicada pela administradora do jogo, pois esse risco é assumido pelo usuário.',
              'Pedidos abandonados por falta de credenciais corretas ou regularização de acesso por 7 dias corridos podem ser cancelados sem reembolso.',
              'Pedidos cancelados por atingirem o limite de drops seguem o desfecho definido pelo centro de resolução, conforme a Seção 13.',
              'Solicitações devem ser abertas no suporte oficial da EloPeak, com análise em até 5 dias úteis e estorno em até 15 dias úteis após aprovação, processado pela Mercado Pago.',
            ]}
          />
        </LegalSection>

        <LegalSection title="17. Obrigações do usuário">
          <LegalList
            items={[
              'Fornecer informações, credenciais e códigos temporários corretos quando necessários.',
              'Não alterar senha ou configurações de acesso durante a execução do serviço.',
              'Não utilizar a plataforma para fraude, abuso, engenharia reversa, spam ou tentativa de contornar pagamentos.',
              'Utilizar o sistema de drops de forma responsável e com justificativa verdadeira, sujeitando-se às consequências previstas nestes Termos em caso de uso abusivo.',
              'Respeitar os limites de frequência (rate limiting) aplicados a ações realizadas diretamente na plataforma.',
              'Respeitar a legislação aplicável, estes Termos e os fluxos oficiais de atendimento.',
            ]}
          />
        </LegalSection>

        <LegalSection title="18. Limitação de responsabilidade">
          <p>
            A responsabilidade máxima da EloPeak, quando comprovadamente aplicável, fica limitada ao valor pago pelo
            serviço contratado. A EloPeak não se responsabiliza por danos indiretos, lucros cessantes, instabilidades
            de terceiros (incluindo Discord, Mercado Pago e Riot Games), sanções de administradoras de jogos ou
            acessos indevidos posteriores à conclusão do serviço.
          </p>
        </LegalSection>

        <LegalSection title="19. Propriedade intelectual, marcas e alterações">
          <p>
            Textos, marcas, layout, imagens e software da plataforma pertencem à EloPeak ou a seus licenciantes. Nomes,
            logotipos, marcas, marcas registradas e materiais de jogos de terceiros pertencem às suas respectivas
            desenvolvedoras e publicadoras, sendo citados e utilizados nesta plataforma apenas para identificar e
            descrever os serviços oferecidos. A EloPeak não possui afiliação, associação, patrocínio ou endosso por
            nenhuma dessas empresas, a menos que expressamente declarado. Estes Termos podem ser atualizados a
            qualquer momento para refletir mudanças legais, operacionais ou de produto. Alterações relevantes serão
            comunicadas na plataforma, e o uso continuado após a vigência da nova versão indica aceitação integral dos
            novos termos.
          </p>
        </LegalSection>

        <LegalSection title="20. Lei aplicável e foro">
          <p>
            Estes Termos são regidos pelas leis da República Federativa do Brasil, em especial o Código de Defesa do
            Consumidor e a Lei Geral de Proteção de Dados (Lei nº 13.709/2018). Fica eleito o foro do domicílio do
            consumidor para dirimir eventuais controvérsias, conforme a legislação consumerista aplicável.
          </p>
        </LegalSection>
      </div>
    </div>
  )
}

export function PrivacyPage() {
  return (
    <div className="py-16">
      <div className="container-app max-w-3xl space-y-8">
        <LegalHeader
          label="Privacidade"
          title="Política de Privacidade"
          description="Esta política explica como a EloPeak trata dados pessoais em conformidade com a LGPD (Lei nº 13.709/2018) e com a operação da plataforma."
        />

        <LegalSection title="1. Controlador e encarregado (DPO)">
          <p>
            A EloPeak é a controladora dos dados pessoais tratados na plataforma. Dúvidas, reclamações e solicitações
            sobre dados pessoais podem ser encaminhadas ao nosso encarregado de proteção de dados (DPO) pelos canais
            oficiais de suporte da EloPeak no Discord ou pelo e-mail de contato divulgado na plataforma.
          </p>
        </LegalSection>

        <LegalSection title="2. Dados coletados">
          <p>Coletamos apenas dados necessários para autenticação, segurança, atendimento, execução dos pedidos e obrigações legais.</p>
          <LegalList
            items={[
              'Dados de Discord: ID, nome de usuário, e-mail autorizado e avatar, recebidos via login social.',
              'Dados de serviço: informações do pedido, conta de jogo, credenciais temporárias, mensagens trocadas no chat do pedido e observações fornecidas pelo usuário.',
              'Dados financeiros do booster: nome completo, CPF e dados necessários ao recebimento via PIX.',
              'Dados de verificação de partidas: Riot ID e resultados de partidas consultados na API pública da Riot Games, quando o serviço exigir verificação de rank.',
              'Dados de drops e resolução de casos: justificativas apresentadas por clientes e boosters em solicitações de drop, decisões de aprovação/rejeição e ajustes registrados pela administração no centro de resolução.',
              'Dados técnicos: IP, navegador, dispositivo, páginas acessadas, sessão, cookies necessários e registros de frequência de ações (usados para limites de uso e prevenção de abuso).',
              'Dados de pagamento: registros de confirmação da transação PIX processada pela Mercado Pago; a EloPeak não armazena dados bancários completos.',
            ]}
          />
        </LegalSection>

        <LegalSection title="3. Finalidades">
          <LegalList
            items={[
              'Criar, autenticar e gerenciar contas na plataforma.',
              'Executar serviços contratados, permitir acompanhamento do pedido e comunicação entre cliente e booster.',
              'Processar e confirmar pagamentos via PIX (Mercado Pago) e pagamentos a boosters.',
              'Verificar rank e resultado de partidas junto à API da Riot Games quando aplicável ao serviço.',
              'Registrar o histórico de status e eventos de cada pedido, incluindo solicitações de drop e decisões do centro de resolução, para fins de auditoria, resolução de disputas e suporte.',
              'Aplicar limites de frequência (rate limiting) a ações realizadas diretamente pela plataforma, para prevenção de abuso e fraude.',
              'Prestar suporte, enviar comunicações transacionais e prevenir fraudes.',
              'Cumprir obrigações legais, fiscais, regulatórias e de segurança.',
              'Melhorar a plataforma com análise agregada ou anonimizada sempre que possível.',
            ]}
          />
        </LegalSection>

        <LegalSection title="4. Bases legais">
          <p>
            O tratamento pode se basear na execução de contrato (criação de conta, execução do pedido, pagamento),
            cumprimento de obrigação legal ou regulatória (dados fiscais de pagamento a boosters), legítimo interesse
            para segurança, prevenção de abuso e melhoria da plataforma, e consentimento quando aplicável.
          </p>
        </LegalSection>

        <LegalSection title="5. Menores de idade">
          <p>
            A EloPeak não é destinada a menores de 18 anos e não coleta intencionalmente dados de crianças ou
            adolescentes. Contas identificadas como pertencentes a menores de idade podem ter os dados eliminados e o
            acesso encerrado.
          </p>
        </LegalSection>

        <LegalSection title="6. Credenciais da conta de jogo">
          <p>
            Quando necessárias para execução do serviço, credenciais da conta de jogo recebem tratamento restrito e
            temporário. A EloPeak adota criptografia, controle de acesso por função, acesso limitado ao booster
            designado e exclusão após conclusão e verificação operacional do serviço.
          </p>
        </LegalSection>

        <LegalSection title="7. Registro de eventos, auditoria e prevenção de abuso">
          <p>
            Cada mudança de status de um pedido — incluindo atribuição, aceite dentro da janela de reserva exclusiva,
            solicitações de drop, reatribuições e decisões do centro de resolução — é registrada em um histórico
            interno, junto com o autor da ação e a justificativa informada. Esses registros são usados para dar
            transparência ao andamento do pedido, permitir auditoria interna, resolver disputas entre cliente e
            booster e cumprir obrigações legais. Também mantemos registros técnicos de frequência de ações realizadas
            diretamente na plataforma para aplicar limites de uso (rate limiting) e identificar tentativas de abuso ou
            automação indevida.
          </p>
        </LegalSection>

        <LegalSection title="8. Compartilhamento">
          <LegalList
            items={[
              'Boosters recebem apenas informações necessárias para executar o pedido atribuído; cliente e booster veem reciprocamente Discord ID/nome de usuário no canal do pedido.',
              'Mercado Pago processa os dados necessários à confirmação do pagamento PIX.',
              'Discord provê a autenticação e os canais de atendimento do pedido, sob os próprios termos de privacidade da Discord Inc.',
              'A Riot Games recebe consultas de Riot ID/resultado de partida via API pública, quando o serviço exigir verificação.',
              'Prestadores de infraestrutura e tecnologia (hospedagem, banco de dados) tratam dados sob obrigações contratuais de confidencialidade e segurança.',
              'Autoridades públicas podem receber dados quando houver exigência legal, regulatória ou judicial.',
              'A EloPeak não vende dados pessoais nem compartilha dados para marketing de terceiros sem consentimento.',
            ]}
          />
        </LegalSection>

        <LegalSection title="9. Retenção">
          <LegalList
            items={[
              'Credenciais de conta de jogo: mantidas apenas enquanto necessárias para execução e verificação do pedido.',
              'Dados cadastrais: mantidos enquanto a conta estiver ativa e pelo prazo necessário ao cumprimento de obrigações legais.',
              'Dados financeiros de boosters (nome, CPF, comprovantes): mantidos pelo prazo exigido pela legislação fiscal e contábil aplicável.',
              'Registros de pagamento, chat do pedido e suporte: mantidos conforme requisitos fiscais, contábeis, defesa de direitos e prevenção de fraude.',
              'Histórico de status do pedido, solicitações de drop e decisões do centro de resolução: mantidos pelo prazo necessário à resolução de disputas, auditoria interna e cumprimento de obrigações legais.',
            ]}
          />
        </LegalSection>

        <LegalSection title="10. Segurança">
          <p>
            Usamos medidas técnicas e organizacionais para proteger dados contra acesso não autorizado, perda,
            alteração ou divulgação indevida, incluindo TLS/HTTPS, criptografia quando aplicável, controles de acesso
            por função, auditoria e monitoramento. Incidentes relevantes serão tratados conforme a LGPD e comunicados
            à ANPD e aos titulares quando exigido.
          </p>
        </LegalSection>

        <LegalSection title="11. Cookies">
          <p>
            Cookies e tecnologias similares podem ser usados para manter sessão autenticada, salvar preferências e
            analisar desempenho da plataforma. O usuário pode gerenciar cookies no navegador, mas algumas
            funcionalidades podem ser afetadas.
          </p>
        </LegalSection>

        <LegalSection title="12. Direitos do titular">
          <p>
            Nos termos do art. 18 da LGPD, o usuário pode solicitar confirmação de tratamento, acesso, correção,
            anonimização, eliminação, portabilidade, informação sobre compartilhamento e revisão de decisões
            automatizadas quando aplicável. As solicitações devem ser feitas pelos canais oficiais de suporte da
            EloPeak, com validação de identidade antes do atendimento, e respondidas em prazo razoável nos termos da
            lei.
          </p>
        </LegalSection>

        <LegalSection title="13. Transferência internacional e alterações">
          <p>
            Dados podem ser tratados por fornecedores localizados fora do Brasil (incluindo provedores de hospedagem,
            Discord e Mercado Pago), observadas salvaguardas adequadas nos termos da LGPD. Esta política pode ser
            atualizada para refletir mudanças legais, técnicas ou operacionais, com aviso na plataforma quando houver
            alteração relevante.
          </p>
        </LegalSection>

        <LegalSection title="14. Contato">
          <p>
            Dúvidas, reclamações e solicitações relacionadas a dados pessoais devem ser encaminhadas pelo suporte
            oficial da EloPeak no Discord ou pelos canais de atendimento disponibilizados na plataforma. O usuário
            também pode apresentar reclamação à Autoridade Nacional de Proteção de Dados (ANPD).
          </p>
        </LegalSection>
      </div>
    </div>
  )
}
