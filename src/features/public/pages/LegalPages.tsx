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
            Boost, Duo Boost, pacotes de vitórias, MD5, Clash e coaching, prestados por boosters cadastrados e aprovados
            na plataforma. O serviço contratado corresponde apenas ao que for descrito e configurado no pedido.
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
            ]}
          />
        </LegalSection>

        <LegalSection title="5. Boosters">
          <p>
            Boosters passam por um processo de candidatura e aprovação antes de operar na plataforma, com fornecimento
            de nome completo, CPF e demais dados necessários ao pagamento via PIX. A EloPeak pode suspender, rebaixar
            prioridade ou desligar um booster por descumprimento destes Termos, fraude, baixo desempenho ou conduta
            prejudicial a clientes.
          </p>
        </LegalSection>

        <LegalSection title="6. Execução dos serviços">
          <p>
            Após confirmação do pagamento, o serviço será executado conforme as informações do pedido. Em serviços que
            exigirem acesso à conta de jogo, o usuário fornece voluntariamente as credenciais necessárias apenas para a
            execução do pedido. Cliente e booster passam a se identificar reciprocamente (Discord ID/nome de usuário) no
            canal de atendimento do pedido, criado exclusivamente para essa finalidade.
          </p>
          <LegalList
            items={[
              'O booster deve acessar a conta de jogo somente para executar o serviço contratado.',
              'O booster não deve alterar e-mail, senha, dados pessoais ou usar credenciais para outra finalidade.',
              'Prazos podem ser ajustados em caso de manutenção do jogo, indisponibilidade de servidores ou caso fortuito.',
              'O usuário deve evitar acessar a conta de jogo durante a execução para não gerar conflito de sessão.',
              'A verificação de conclusão de alguns serviços é feita por consulta à API pública da Riot Games; instabilidades dessa API podem atrasar a confirmação do pedido.',
            ]}
          />
        </LegalSection>

        <LegalSection title="7. Riscos assumidos pelo usuário">
          <p>
            O usuário reconhece que desenvolvedoras, publicadoras ou administradoras de jogos podem proibir boosting,
            compartilhamento de conta ou práticas semelhantes. O uso desses serviços pode gerar advertências, restrições,
            suspensão temporária, banimento permanente, perda de progresso, itens ou outros efeitos previstos pelas regras
            do jogo.
          </p>
          <p>
            A contratação ocorre por livre escolha do usuário, que assume os riscos associados às regras de terceiros. A
            EloPeak não controla decisões, sanções, instabilidades ou políticas aplicadas pelas empresas responsáveis por
            cada jogo, nem pela Riot Games em relação à API usada para verificação de resultado.
          </p>
        </LegalSection>

        <LegalSection title="8. Pagamento">
          <p>
            Os pagamentos são feitos via PIX, processados pela Mercado Pago, de forma antecipada, e o pedido só é
            processado após confirmação. Os valores são apresentados no checkout conforme serviço, rank, fila, extras e
            demais opções selecionadas. A EloPeak não acessa nem armazena dados bancários ou de conta PIX do cliente —
            esse processamento é feito diretamente pela Mercado Pago.
          </p>
        </LegalSection>

        <LegalSection title="9. Direito de arrependimento e reembolso">
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
              'Solicitações devem ser abertas no suporte oficial da EloPeak, com análise em até 5 dias úteis e estorno em até 15 dias úteis após aprovação, processado pela Mercado Pago.',
            ]}
          />
        </LegalSection>

        <LegalSection title="10. Obrigações do usuário">
          <LegalList
            items={[
              'Fornecer informações, credenciais e códigos temporários corretos quando necessários.',
              'Não alterar senha ou configurações de acesso durante a execução do serviço.',
              'Não utilizar a plataforma para fraude, abuso, engenharia reversa, spam ou tentativa de contornar pagamentos.',
              'Respeitar a legislação aplicável, estes Termos e os fluxos oficiais de atendimento.',
            ]}
          />
        </LegalSection>

        <LegalSection title="11. Limitação de responsabilidade">
          <p>
            A responsabilidade máxima da EloPeak, quando comprovadamente aplicável, fica limitada ao valor pago pelo
            serviço contratado. A EloPeak não se responsabiliza por danos indiretos, lucros cessantes, instabilidades de
            terceiros (incluindo Discord, Mercado Pago e Riot Games), sanções de administradoras de jogos ou acessos
            indevidos posteriores à conclusão do serviço.
          </p>
        </LegalSection>

        <LegalSection title="12. Propriedade intelectual e alterações">
          <p>
            Textos, marcas, layout, imagens e software da plataforma pertencem à EloPeak ou a seus licenciantes. Nomes,
            marcas e materiais de jogos de terceiros pertencem às respectivas desenvolvedoras/publicadoras e são citados
            apenas para identificar os serviços oferecidos. Estes Termos podem ser atualizados para refletir mudanças
            legais, operacionais ou de produto. Alterações relevantes serão comunicadas na plataforma, e o uso continuado
            após a vigência indica aceitação da nova versão.
          </p>
        </LegalSection>

        <LegalSection title="13. Lei aplicável e foro">
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
              'Dados técnicos: IP, navegador, dispositivo, páginas acessadas, sessão e cookies necessários.',
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
            para segurança e melhoria da plataforma, e consentimento quando aplicável.
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
            temporário. A EloPeak adota criptografia, controle de acesso por função, acesso limitado ao booster designado
            e exclusão após conclusão e verificação operacional do serviço.
          </p>
        </LegalSection>

        <LegalSection title="7. Compartilhamento">
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

        <LegalSection title="8. Retenção">
          <LegalList
            items={[
              'Credenciais de conta de jogo: mantidas apenas enquanto necessárias para execução e verificação do pedido.',
              'Dados cadastrais: mantidos enquanto a conta estiver ativa e pelo prazo necessário ao cumprimento de obrigações legais.',
              'Dados financeiros de boosters (nome, CPF, comprovantes): mantidos pelo prazo exigido pela legislação fiscal e contábil aplicável.',
              'Registros de pagamento, chat do pedido e suporte: mantidos conforme requisitos fiscais, contábeis, defesa de direitos e prevenção de fraude.',
            ]}
          />
        </LegalSection>

        <LegalSection title="9. Segurança">
          <p>
            Usamos medidas técnicas e organizacionais para proteger dados contra acesso não autorizado, perda, alteração
            ou divulgação indevida, incluindo TLS/HTTPS, criptografia quando aplicável, controles de acesso por função,
            auditoria e monitoramento. Incidentes relevantes serão tratados conforme a LGPD e comunicados à ANPD e aos
            titulares quando exigido.
          </p>
        </LegalSection>

        <LegalSection title="10. Cookies">
          <p>
            Cookies e tecnologias similares podem ser usados para manter sessão autenticada, salvar preferências e analisar
            desempenho da plataforma. O usuário pode gerenciar cookies no navegador, mas algumas funcionalidades podem ser
            afetadas.
          </p>
        </LegalSection>

        <LegalSection title="11. Direitos do titular">
          <p>
            Nos termos do art. 18 da LGPD, o usuário pode solicitar confirmação de tratamento, acesso, correção,
            anonimização, eliminação, portabilidade, informação sobre compartilhamento e revisão de decisões
            automatizadas quando aplicável. As solicitações devem ser feitas pelos canais oficiais de suporte da EloPeak,
            com validação de identidade antes do atendimento, e respondidas em prazo razoável nos termos da lei.
          </p>
        </LegalSection>

        <LegalSection title="12. Transferência internacional e alterações">
          <p>
            Dados podem ser tratados por fornecedores localizados fora do Brasil (incluindo provedores de hospedagem,
            Discord e Mercado Pago), observadas salvaguardas adequadas nos termos da LGPD. Esta política pode ser
            atualizada para refletir mudanças legais, técnicas ou operacionais, com aviso na plataforma quando houver
            alteração relevante.
          </p>
        </LegalSection>

        <LegalSection title="13. Contato">
          <p>
            Dúvidas, reclamações e solicitações relacionadas a dados pessoais devem ser encaminhadas pelo suporte oficial
            da EloPeak no Discord ou pelos canais de atendimento disponibilizados na plataforma. O usuário também pode
            apresentar reclamação à Autoridade Nacional de Proteção de Dados (ANPD).
          </p>
        </LegalSection>
      </div>
    </div>
  )
}
