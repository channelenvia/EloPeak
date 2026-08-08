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
            concorda com estes Termos de Uso. Caso não concorde com alguma condição, o usuário não deve utilizar a
            plataforma nem contratar serviços.
          </p>
        </LegalSection>

        <LegalSection title="2. Objeto da plataforma">
          <p>
            A EloPeak oferece uma plataforma de intermediação de serviços digitais relacionados a jogos, incluindo Solo
            Boost, Duo Boost, pacotes de vitórias, MD5 e coaching. O serviço contratado corresponde apenas ao que for
            descrito e configurado no pedido.
          </p>
        </LegalSection>

        <LegalSection title="3. Cadastro e autenticação">
          <p>
            O acesso à plataforma é realizado por login social via Discord. Ao vincular sua conta, o usuário autoriza o
            uso das informações necessárias para autenticação e identificação dentro da EloPeak.
          </p>
          <LegalList
            items={[
              'Podemos receber Discord ID, nome de usuário, nome de exibição, e-mail autorizado e avatar.',
              'A EloPeak não solicita nem armazena a senha da conta Discord.',
              'O usuário deve manter a própria conta Discord segura e informar suspeitas de uso não autorizado.',
              'É proibido criar cadastros múltiplos, transferir conta da plataforma ou fornecer dados falsos.',
            ]}
          />
        </LegalSection>

        <LegalSection title="4. Execução dos serviços">
          <p>
            Após confirmação do pagamento, o serviço será executado conforme as informações do pedido. Em serviços que
            exigirem acesso à conta de jogo, o usuário fornece voluntariamente as credenciais necessárias apenas para a
            execução do pedido.
          </p>
          <LegalList
            items={[
              'O booster deve acessar a conta de jogo somente para executar o serviço contratado.',
              'O booster não deve alterar e-mail, senha, dados pessoais ou usar credenciais para outra finalidade.',
              'Prazos podem ser ajustados em caso de manutenção do jogo, indisponibilidade de servidores ou caso fortuito.',
              'O usuário deve evitar acessar a conta de jogo durante a execução para não gerar conflito de sessão.',
            ]}
          />
        </LegalSection>

        <LegalSection title="5. Riscos assumidos pelo usuário">
          <p>
            O usuário reconhece que desenvolvedoras, publicadoras ou administradoras de jogos podem proibir boosting,
            compartilhamento de conta ou práticas semelhantes. O uso desses serviços pode gerar advertências, restrições,
            suspensão temporária, banimento permanente, perda de progresso, itens ou outros efeitos previstos pelas regras
            do jogo.
          </p>
          <p>
            A contratação ocorre por livre escolha do usuário, que assume os riscos associados às regras de terceiros. A
            EloPeak não controla decisões, sanções, instabilidades ou políticas aplicadas pelas empresas responsáveis por
            cada jogo.
          </p>
        </LegalSection>

        <LegalSection title="6. Pagamento">
          <p>
            Os pagamentos são feitos via PIX, de forma antecipada, e o pedido só é processado após confirmação. Os valores
            são apresentados no checkout conforme serviço, rank, fila, extras e demais opções selecionadas.
          </p>
        </LegalSection>

        <LegalSection title="7. Reembolso">
          <p>
            O usuário pode solicitar reembolso quando houver não execução total por responsabilidade da EloPeak ou
            impossibilidade técnica comprovada após o pagamento.
          </p>
          <LegalList
            items={[
              'Se houver execução parcial, o reembolso poderá ser proporcional à parte não executada.',
              'Não há reembolso por desistência após início do serviço.',
              'Não há reembolso por suspensão, banimento ou penalidade aplicada pela administradora do jogo, pois esse risco é assumido pelo usuário.',
              'Pedidos abandonados por falta de credenciais corretas ou regularização de acesso por 7 dias corridos podem ser cancelados sem reembolso.',
              'Solicitações devem ser abertas no suporte oficial da EloPeak, com análise em até 5 dias úteis e estorno em até 15 dias úteis após aprovação.',
            ]}
          />
        </LegalSection>

        <LegalSection title="8. Obrigações do usuário">
          <LegalList
            items={[
              'Fornecer informações, credenciais e códigos temporários corretos quando necessários.',
              'Não alterar senha ou configurações de acesso durante a execução do serviço.',
              'Não utilizar a plataforma para fraude, abuso, engenharia reversa, spam ou tentativa de contornar pagamentos.',
              'Respeitar a legislação aplicável, estes Termos e os fluxos oficiais de atendimento.',
            ]}
          />
        </LegalSection>

        <LegalSection title="9. Limitação de responsabilidade">
          <p>
            A responsabilidade máxima da EloPeak, quando comprovadamente aplicável, fica limitada ao valor pago pelo
            serviço contratado. A EloPeak não se responsabiliza por danos indiretos, lucros cessantes, instabilidades de
            terceiros, sanções de administradoras de jogos ou acessos indevidos posteriores à conclusão do serviço.
          </p>
        </LegalSection>

        <LegalSection title="10. Propriedade intelectual e alterações">
          <p>
            Textos, marcas, layout, imagens e software da plataforma pertencem à EloPeak ou a seus licenciantes. Estes
            Termos podem ser atualizados para refletir mudanças legais, operacionais ou de produto. Alterações relevantes
            serão comunicadas na plataforma, e o uso continuado após a vigência indica aceitação da nova versão.
          </p>
        </LegalSection>

        <LegalSection title="11. Lei aplicável">
          <p>
            Estes Termos são regidos pelas leis da República Federativa do Brasil. Controvérsias serão tratadas conforme
            a legislação brasileira aplicável.
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
          description="Esta política explica como a EloPeak trata dados pessoais em conformidade com a LGPD e com a operação da plataforma."
        />

        <LegalSection title="1. Dados coletados">
          <p>Coletamos apenas dados necessários para autenticação, segurança, atendimento, execução dos pedidos e obrigações legais.</p>
          <LegalList
            items={[
              'Dados de Discord: ID, usuário, nome de exibição, e-mail autorizado e avatar.',
              'Dados de serviço: informações do pedido, conta de jogo, credenciais temporárias e observações fornecidas pelo usuário.',
              'Dados técnicos: IP, navegador, dispositivo, páginas acessadas, sessão e cookies necessários.',
              'Dados de pagamento: registros de confirmação via PIX; a EloPeak não armazena dados bancários completos.',
            ]}
          />
        </LegalSection>

        <LegalSection title="2. Finalidades">
          <LegalList
            items={[
              'Criar, autenticar e gerenciar contas na plataforma.',
              'Executar serviços contratados e permitir acompanhamento do pedido.',
              'Processar e confirmar pagamentos via PIX.',
              'Prestar suporte, enviar comunicações transacionais e prevenir fraudes.',
              'Cumprir obrigações legais, fiscais, regulatórias e de segurança.',
              'Melhorar a plataforma com análise agregada ou anonimizada sempre que possível.',
            ]}
          />
        </LegalSection>

        <LegalSection title="3. Bases legais">
          <p>
            O tratamento pode se basear na execução de contrato, cumprimento de obrigação legal ou regulatória, legítimo
            interesse para segurança e melhoria da plataforma, e consentimento quando aplicável.
          </p>
        </LegalSection>

        <LegalSection title="4. Credenciais da conta de jogo">
          <p>
            Quando necessárias para execução do serviço, credenciais da conta de jogo recebem tratamento restrito e
            temporário. A EloPeak adota criptografia, controle de acesso por função, acesso limitado ao booster designado
            e exclusão após conclusão e verificação operacional do serviço.
          </p>
        </LegalSection>

        <LegalSection title="5. Compartilhamento">
          <LegalList
            items={[
              'Boosters recebem apenas informações necessárias para executar o pedido atribuído.',
              'Prestadores de tecnologia podem tratar dados sob obrigações de confidencialidade e segurança.',
              'Autoridades públicas podem receber dados quando houver exigência legal, regulatória ou judicial.',
              'A EloPeak não vende dados pessoais nem compartilha dados para marketing de terceiros sem consentimento.',
            ]}
          />
        </LegalSection>

        <LegalSection title="6. Retenção">
          <LegalList
            items={[
              'Credenciais de conta de jogo: mantidas apenas enquanto necessárias para execução e verificação do pedido.',
              'Dados cadastrais: mantidos enquanto a conta estiver ativa e pelo prazo necessário ao cumprimento de obrigações legais.',
              'Registros de pagamento e suporte: mantidos conforme requisitos fiscais, contábeis, defesa de direitos e prevenção de fraude.',
            ]}
          />
        </LegalSection>

        <LegalSection title="7. Segurança">
          <p>
            Usamos medidas técnicas e organizacionais para proteger dados contra acesso não autorizado, perda, alteração
            ou divulgação indevida, incluindo TLS/HTTPS, criptografia quando aplicável, controles de acesso, auditoria e
            monitoramento. Incidentes relevantes serão tratados conforme a LGPD e comunicados quando exigido.
          </p>
        </LegalSection>

        <LegalSection title="8. Cookies">
          <p>
            Cookies e tecnologias similares podem ser usados para manter sessão autenticada, salvar preferências e analisar
            desempenho da plataforma. O usuário pode gerenciar cookies no navegador, mas algumas funcionalidades podem ser
            afetadas.
          </p>
        </LegalSection>

        <LegalSection title="9. Direitos do titular">
          <p>
            O usuário pode solicitar confirmação de tratamento, acesso, correção, anonimização, eliminação, portabilidade,
            informação sobre compartilhamento e revisão de decisões automatizadas quando aplicável. As solicitações devem
            ser feitas pelos canais oficiais de suporte da EloPeak, com validação de identidade antes do atendimento.
          </p>
        </LegalSection>

        <LegalSection title="10. Transferência internacional e alterações">
          <p>
            Dados podem ser tratados por fornecedores localizados fora do Brasil, observadas salvaguardas adequadas. Esta
            política pode ser atualizada para refletir mudanças legais, técnicas ou operacionais, com aviso na plataforma
            quando houver alteração relevante.
          </p>
        </LegalSection>

        <LegalSection title="11. Contato">
          <p>
            Dúvidas, reclamações e solicitações relacionadas a dados pessoais devem ser encaminhadas pelo suporte oficial
            da EloPeak no Discord ou pelos canais de atendimento disponibilizados na plataforma.
          </p>
        </LegalSection>
      </div>
    </div>
  )
}
