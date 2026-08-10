/**
 * Portuguese (Brazil) - the default, and the source of truth for the shape of
 * a dictionary. `en-US.ts` is type-checked against this file, so a key added
 * here fails the build until the other locale carries it too.
 *
 * Rule denials are keyed by their stable `code`, never by their English text:
 * the code is the contract between the domain layer and the interface, and it
 * is what lets `src/lib/rules.ts` stay English as the house rules require
 * while the player reads their own language.
 */
export const ptBR = {
  locale: {
    switchTo: 'English',
    label: 'Idioma',
  },

  common: {
    signIn: 'Entrar',
    signOut: 'Sair',
    manage: 'Gerenciar',
    close: 'fechar',
    reason: 'Motivo',
    you: 'você',
    none: '—',
    working: 'Enviando',
    points: 'pontos',
    level: 'Nível',
    character: 'Personagem',
    characters: 'Personagens',
    guild: 'Guild',
    email: 'E-mail',
    password: 'Senha',
    status: 'Situação',
    save: 'Salvar alterações',
  },

  nav: {
    dashboard: 'Painel',
    profile: 'Personagens',
    events: 'Eventos',
    auctions: 'Leilões',
    market: 'Loja',
    members: 'Membros',
    eventAdmin: 'Admin de eventos',
    audit: 'Auditoria',
    invites: 'Convites',
  },

  landing: {
    eyebrow: 'GuildMate — terminal de operações',
    headline: ['Pontos são', 'minerados', ', não', 'emitidos.'],
    lede:
      'Rode os eventos, leilões e a loja da sua guild sobre um livro-razão que ninguém edita por baixo dos panos. Um admin anuncia um código com hora para morrer, os jogadores resgatam, e os pontos só viram moeda quando gente suficiente apareceu de verdade.',
    joinGuild: 'Entrar numa guild',
    lifecycleTitle: 'A vida de um ponto',
    lifecycle: {
      raw: {
        state: 'BRUTO',
        line: 'Resgatar o código já registra os pontos. Eles ainda não são gastáveis.',
      },
      refined: {
        state: 'REFINADO',
        line: 'O evento atinge o mínimo de participantes e esses mesmos pontos viram moeda.',
      },
      slag: {
        state: 'ESCÓRIA',
        line: 'A presença não fecha até o prazo. O evento é cancelado e todo ponto é revertido.',
      },
    },
    lifecycleFooter:
      'Correções são linhas novas, nunca edições. Os pontos de um alt sobem para o main, e só um main dá lance no leilão.',
    nations: {
      BELLATO: 'Engenheiros. Mechs em campo e uma conta de manutenção que ninguém avisa.',
      CORA: 'Fé e força. Invocações que continuam lutando depois que você olha para o lado.',
      ACCRETIA: 'Máquinas. Sem cura, então cada avanço é uma decisão de suprimento.',
    },
  },

  auth: {
    signInTitle: 'Entrar',
    noAccount: 'Ainda não tem conta?',
    alreadyMember: 'Já é membro?',
    joinTitle: 'Entrar numa guild',
    joinSubtitle: 'Sua conta e seu primeiro personagem.',
    createAccount: 'Criar conta',
    passwordHint: 'No mínimo 10 caracteres.',
    noGuildsYet:
      'Nenhuma guild está aceitando membros ainda. Guild só nasce de um link de convite — peça um a quem administra o servidor.',
    directoryTitle: 'Diretório de guilds',
    directorySubtitle:
      'Só a contagem. Quem está numa guild é visível para os membros dela, não para o público.',
    directoryEmpty: 'Nenhuma guild foi criada ainda.',
    directoryHead: ['Guild', 'Situação', 'Membros', 'Ativos', 'Restritos'],
  },

  invite: {
    createTitle: 'Criar guild',
    createSubtitle: 'Você vira o líder. O convite é gasto no instante em que a guild existe.',
    guildName: 'Nome da guild',
    guildNameHint: 'O endereço web é derivado daqui.',
    tag: 'Tag',
    tagHint: 'Opcional. Até 8 caracteres.',
    submit: 'Criar guild',
    requiredTitle: 'Convite obrigatório',
    refusals: {
      UNKNOWN: 'Este link de convite não é válido. Peça um novo a quem administra o servidor.',
      EXPIRED: 'Este convite expirou. Eles duram 24 horas — peça um link novo.',
      REDEEMED: 'Este convite já foi usado. Cada um cria exatamente uma guild.',
      REVOKED: 'Este convite foi revogado.',
    },
    adminIssueTitle: 'Emitir convite de guild',
    adminIssueSubtitle: 'Um link de uso único, válido por 24 horas. É o único jeito de criar guild.',
    note: 'Anotação',
    noteHint: 'Para quem é? Aparece na lista, nunca para quem recebe.',
    issue: 'Emitir convite',
    copyOnce: 'Copie agora — o link aparece uma única vez',
    expires: 'Expira',
    listTitle: 'Convites',
    listSubtitle: 'O recibo de cada guild deste servidor.',
    listEmpty: 'Nenhum convite foi emitido ainda.',
    listHead: ['Token', 'Para', 'Situação', 'Expira', 'Resgatado por', 'Guild', ''],
    revoke: 'Revogar',
  },

  dashboard: {
    spendable: 'Pontos gastáveis',
    spendableHint: 'Valem em leilão. Lances ativos já estão descontados.',
    pending: 'Pontos pendentes',
    pendingHint: 'Esperando o evento bater o quórum.',
    redeemTitle: 'Registrar presença num evento',
    redeemSubtitle: 'Digite o código que o admin anunciou. Ele só vale dentro da janela definida.',
    charactersTitle: 'Seus personagens',
    manageRoster: 'Gerenciar elenco',
    noCharacters: 'Nenhum personagem ainda.',
    charactersHead: ['Nome', 'Tipo', 'Raça', 'Biosuit', 'Nível'],
    ledgerTitle: 'Livro de pontos',
    ledgerSubtitle: 'Toda entrada que já afetou seu saldo.',
    ledgerEmpty: 'Nenhuma movimentação de pontos ainda.',
    ledgerHead: ['Quando', 'Valor', 'Estado', 'Motivo'],
  },

  redeem: {
    needCharacter: 'Crie um personagem antes de registrar presença.',
    code: 'Código do evento',
    codeHint: 'Maiúsculas não importam; hífens são ignorados.',
    submit: 'Resgatar código',
    awarded: 'pontos',
    for: 'em',
    confirmed: 'O evento está confirmado, então esses pontos já são gastáveis.',
    pendingPrefix: 'Pendente:',
    pendingSuffix: 'registros. Os pontos viram moeda quando o evento bater o quórum.',
  },

  profile: {
    accountTitle: 'Conta',
    activeCount: 'ativos',
    slotsUsed: 'vagas usadas',
    rosterTitle: 'Seu elenco',
    rosterSubtitle: 'Um main e seus alts. Os pontos de evento de um alt são creditados ao main.',
    rosterHead: ['Nome', 'Tipo', 'Raça', 'Biosuit', 'Nível', ''],
    addTitle: 'Adicionar personagem',
    rosterFull:
      'Seu elenco está cheio. Aposentar um personagem não libera vaga: o nome dele segue reservado na guild.',
    addAsAlt: 'Personagens novos entram como alt. Os pontos de evento sobem para o seu main.',
    addAsMain: 'Este será seu personagem principal: o que dá lance nos leilões.',
    add: 'Adicionar personagem',
    added: 'Personagem adicionado.',
    retired: 'aposentado',
    manage: 'Gerenciar',
    name: 'Nome',
    biosuit: 'Biosuit',
    saved: 'Salvo.',
    makeMain: 'Tornar meu main',
    makeMainHint: 'Seu main atual vira alt. Pontos já ganhos não se movem.',
    retire: 'Aposentar personagem',
    mainCannotRetire: 'Promova outro personagem a main antes de aposentar este.',
  },

  characterFields: {
    name: 'Nome do personagem',
    race: 'Raça',
    biosuit: 'Biosuit',
    level: 'Nível atual',
    kind: 'Tipo de personagem',
    kindHint: 'Só um personagem principal pode gastar pontos em leilões.',
    main: 'Main',
    alt: 'Alt',
  },

  events: {
    title: 'Eventos',
    subtitle:
      'Um evento confirma ao atingir o mínimo de registros; caso contrário é cancelado e todo ponto é revertido.',
    empty: 'Nenhum evento ainda.',
    head: ['Evento', 'Pontos', 'Situação', 'Registros', 'Janela do código', 'Prazo do quórum'],
    openUntil: 'aberto até',
    closed: 'fechada',
  },

  auctions: {
    spendable: 'Pontos gastáveis',
    spendableHint: 'Lances que você está ganhando já estão descontados.',
    openCount: 'Leilões abertos',
    openTitle: 'Leilões abertos',
    openSubtitle:
      'Pagos com pontos confirmados. Um lance dentro da janela final estende o relógio.',
    empty: 'Nenhum leilão em andamento.',
    ends: 'Encerra',
    winning: 'você está ganhando',
    startingBid: 'Lance inicial',
    currentBid: 'Lance atual',
    next: 'próximo:',
    settledTitle: 'Encerrados',
    needMain: 'Só um personagem main pode dar lance.',
    yourBid: 'Seu lance',
    bid: 'Dar lance',
    minimum: 'mínimo',
  },

  market: {
    title: 'Loja da guild',
    subtitle: 'Itens anunciados pelos membros, com preço em diamantes. A troca acontece no jogo.',
    empty: 'Nada à venda no momento.',
    head: ['Item', 'Raridade', 'Tipo', 'Nv', 'Qtd', 'Preço', 'Vendedor'],
    listTitle: 'Anunciar um item',
    listSubtitle: 'Você só edita ou retira anúncios que criou.',
    needCharacter: 'Crie um personagem antes de anunciar itens.',
    sellingCharacter: 'Personagem vendedor',
    itemName: 'Nome do item',
    type: 'Tipo',
    rarity: 'Raridade',
    itemLevel: 'Nível do item',
    quantity: 'Quantidade',
    price: 'Preço (diamantes)',
    notes: 'Observações',
    notesPlaceholder: 'Atributos, upgrades, onde encontrar você...',
    publish: 'Publicar anúncio',
    published: 'Anúncio publicado.',
  },

  admin: {
    membersStat: 'Membros',
    activeStat: 'Ativos',
    restrictedStat: 'Restritos',
    liveRestrictionsStat: 'Restrições ativas',
    rosterTitle: 'Elenco',
    rosterSubtitle:
      'Níveis, pontos e contagem de registros. Você só modera membros de patente inferior à sua.',
    rosterEmpty: 'Nenhum membro ainda.',
    rosterHead: ['Membro', 'Personagem main', 'Nv', 'Papel', 'Situação', 'Eventos', 'Pontos', 'Gerenciar'],
    restrictionsTitle: 'Restrições ativas',
    restrictionsEmpty: 'Nenhuma restrição em vigor.',
    restrictionsHead: ['Membro', 'Tipo', 'Motivo', 'Desde', 'Até'],
    manageMember: 'Gerenciando',
    deactivate: 'Desativar',
    reactivate: 'Reativar',
    restriction: 'Restrição',
    ban: 'Banimento',
    suspension: 'Suspensão',
    blockEvents: 'Bloquear eventos',
    blockAuctions: 'Bloquear leilões',
    blockMarket: 'Bloquear loja',
    durationDays: 'Duração (dias)',
    durationHint: '0 significa permanente.',
    applyRestriction: 'Aplicar restrição',
    restrictionApplied: 'Restrição aplicada.',
    role: 'Papel',
    changeRole: 'Alterar papel',
    revokeAccess: 'Revogar acesso permanentemente',
    revokeReasonPlaceholder: 'Motivo (permanente, mínimo 5 caracteres)',
    accessRevoked: 'acesso revogado',

    createEventTitle: 'Criar evento',
    createEventSubtitle:
      'O código é gerado aqui e mostrado uma única vez. Ele expira depois da duração que você escolher.',
    eventName: 'Nome do evento',
    description: 'Descrição',
    points: 'Pontos',
    codeLifetime: 'Duração do código (min)',
    codeLifetimeHint: 'Por quanto tempo o código funciona. Padrão: 60.',
    minParticipants: 'Mínimo de participantes',
    minParticipantsHint: 'Abaixo disso no prazo, o evento cancela.',
    createEvent: 'Criar evento e gerar código',
    codeRevealTitle: 'Código de entrada — mostrado uma única vez',
    codeRevealHint: 'Anuncie agora. Ele é guardado com hash e não pode ser recuperado.',
    eventsTitle: 'Eventos',
    eventsEmpty: 'Nenhum evento ainda.',
    eventsHead: ['Evento', 'Pontos', 'Situação', 'Regs', 'Código', 'Fecha', 'Prazo', 'Gerenciar'],
    newPointValue: 'Novo valor em pontos',
    rescoreHint: 'Vale para todo mundo já registrado.',
    rescore: 'Recalcular',
    cancelReasonPlaceholder: 'Motivo do cancelamento',
    grantTitle: 'Pontuar um membro manualmente',
    grantSubtitle:
      'Exige um evento existente. Você não pode dar pontos para a própria conta nem para os alts dela.',
    grantEventHint: 'Só dá para conceder pontos contra um evento real.',
    grantMemberHint: 'Sua própria conta não aparece nesta lista.',
    grantPoints: 'Conceder pontos',
    grantReasonPlaceholder: 'Compareceu mas o código expirou',
    logTitle: 'Registro de presenças',
    logSubtitle:
      'Quem reivindicou o quê, quando e em qual nível. Impressões de IP repetidas merecem atenção.',
    logEmpty: 'Nenhum registro ainda.',
    logHead: ['Quando', 'Evento', 'Personagem', 'Tipo', 'Nv', 'Membro', 'Origem', 'Estado', 'IP'],
    auditTitle: 'Trilha de auditoria',
    auditSubtitle:
      'Somente inserção. Segredos e códigos de evento são redigidos antes de qualquer escrita aqui.',
    auditEmpty: 'Nada registrado ainda.',
    auditHead: ['Quando', 'Autor', 'Ação', 'Entidade', 'Detalhe'],
  },

  errors: {
    // Account and access.
    ACCOUNT_BANNED: 'Esta conta está banida',
    ACCOUNT_SUSPENDED: 'Esta conta está suspensa',
    ACCOUNT_INACTIVE: 'Esta conta está inativa',
    ACCOUNT_DELETED: 'Esta conta não tem mais acesso',
    ACCOUNT_LOCKED: 'Tentativas demais. Tente de novo mais tarde.',
    INVALID_CREDENTIALS: 'E-mail ou senha inválidos',
    UNAUTHENTICATED: 'Entre para fazer isso',
    FORBIDDEN: 'Você não tem permissão para acessar este recurso',
    RESTRICTED: 'Você está impedido de fazer isso no momento',
    RATE_LIMITED: 'Tentativas demais. Espere um pouco.',
    REGISTRATION_FAILED: 'Não foi possível criar esta conta',
    GUILD_NOT_FOUND: 'Essa guild não existe ou não está aceitando membros',
    GUILD_EXISTS: 'Já existe uma guild com esse nome',
    VALIDATION_ERROR: 'Confira o formulário e tente de novo',
    INTERNAL_ERROR: 'Algo deu errado. Tente de novo.',
    SERVICE_UNAVAILABLE: 'Serviço indisponível no momento. Tente daqui a pouco.',
    NOT_FOUND: 'Não encontrado',

    // Invites.
    INVITE_INVALID: 'Este link de convite não é válido',
    INVITE_EXPIRED: 'Este convite expirou',
    INVITE_USED: 'Este convite já foi usado',
    INVITE_REVOKED: 'Este convite foi revogado',
    INVITE_NOT_LIVE: 'Este convite não está mais ativo',
    ALREADY_IN_GUILD:
      'Você já pertence a uma guild. Saia da conta e resgate este convite com uma conta nova.',

    // Roster.
    ROSTER_FULL: 'Uma conta pode ter no máximo 10 personagens',
    MAIN_REQUIRED: 'Crie seu personagem principal antes de adicionar um alt',
    MAIN_ALREADY_EXISTS: 'Esta conta já tem um personagem principal. Promova outro no lugar.',
    MAIN_CANNOT_RETIRE: 'Promova outro personagem a main antes de aposentar este',
    LAST_CHARACTER: 'Uma conta precisa manter pelo menos um personagem',
    ALREADY_MAIN: 'Este já é o seu personagem principal',
    CHARACTER_INACTIVE: 'Este personagem está aposentado',
    NAME_TAKEN: 'Esse nome de personagem já existe nesta guild',
    INVALID_NAME: 'O nome do personagem precisa ter entre 2 e 40 caracteres',
    INVALID_BIOSUIT: 'Um biosuit é obrigatório',
    INVALID_LEVEL: 'O nível precisa ser um número inteiro entre 1 e 999',

    // Events and points.
    EVENT_CANCELLED: 'Este evento foi cancelado',
    EVENT_CLOSED: 'Este evento não aceita mais registros',
    EVENT_NOT_STARTED: 'Este evento ainda não começou',
    CODE_EXPIRED: 'Este código de evento expirou',
    CODE_INVALID: 'Código inválido',
    ALREADY_REGISTERED: 'Esta conta já se registrou neste evento',
    LEVEL_TOO_LOW: 'Seu nível é baixo demais para este evento',
    ALT_NOT_ELIGIBLE: 'Só personagens principais ganham pontos nesta guild',
    SELF_GRANT_FORBIDDEN: 'Um admin não pode dar pontos para a própria conta',
    INVALID_TTL: 'A duração do código é inválida',
    INVALID_POINTS: 'Os pontos precisam ser um número inteiro entre 1 e 100000',
    INVALID_QUORUM: 'O mínimo de participantes precisa ser pelo menos 1',
    REASON_REQUIRED: 'Um motivo é obrigatório',

    // Auctions and market.
    AUCTION_CLOSED: 'Este leilão não está aberto',
    AUCTION_ENDED: 'Este leilão foi encerrado',
    ALREADY_WINNING: 'Você já é o maior lance',
    BID_TOO_LOW: 'Seu lance está abaixo do mínimo',
    INSUFFICIENT_POINTS: 'Você não tem pontos confirmados suficientes para este lance',
    MAIN_CHARACTER_REQUIRED: 'Só um personagem principal pode dar lance',
    INVALID_AMOUNT: 'O lance precisa ser um número inteiro positivo',
    LISTING_CLOSED: 'Este anúncio já foi encerrado',
    INVALID_PRICE: 'O preço precisa ser de pelo menos 1 diamante',
    INVALID_QUANTITY: 'A quantidade precisa estar entre 1 e 9999',

    // Moderation.
    SELF_MODERATION_FORBIDDEN: 'Você não pode aplicar isso à sua própria conta',
    INSUFFICIENT_RANK: 'Você não pode moderar alguém de patente igual ou superior',
  },

  badges: {
    OPEN: 'aberto',
    PENDING: 'pendente',
    PENDING_CONFIRMATION: 'aguardando',
    CONFIRMED: 'confirmado',
    CANCELLED: 'cancelado',
    REVERSED: 'revertido',
    SETTLED: 'liquidado',
    CLOSED: 'fechado',
    ACTIVE: 'ativo',
    INACTIVE: 'inativo',
    BANNED: 'banido',
    DELETED: 'removido',
    EXPIRED: 'expirado',
    SOLD: 'vendido',
    RESERVED: 'reservado',
    DRAFT: 'rascunho',
    LIVE: 'ativo',
    REDEEMED: 'resgatado',
    REVOKED: 'revogado',
    MAIN: 'main',
    ALT: 'alt',
    MEMBER: 'membro',
    VICE_LEADER: 'vice-líder',
    LEADER: 'líder',
    SUPER_ADMIN: 'super admin',
    COMMON: 'comum',
    UNCOMMON: 'incomum',
    RARE: 'raro',
    EPIC: 'épico',
    LEGENDARY: 'lendário',
    BELLATO: 'bellato',
    CORA: 'cora',
    ACCRETIA: 'accretia',
  },
} as const

/**
 * `as const` above stops a typo from widening a key away, but it also freezes
 * every value to its exact Portuguese string - which would make it impossible
 * for another locale to say anything different. Widening back to `string`
 * keeps the *shape* enforced while leaving the words free.
 */
type Widen<T> = T extends string
  ? string
  : T extends readonly (infer U)[]
    ? readonly Widen<U>[]
    : { -readonly [K in keyof T]: Widen<T[K]> }

export type Dictionary = Widen<typeof ptBR>
