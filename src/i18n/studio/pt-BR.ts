import { counted, ratingText } from "@/i18n/format";

import type { StudioDictionary } from "./en";

// The Writing Studio in Brazilian Portuguese (ADR 0008 § 4). It has exactly
// the English dictionary's keys, which the type checks. The V4.4 screens'
// Portuguese is the glossary ("Estúdio de escrita", "Mesa", "Catálogo",
// "Excluídos recentemente", "Faixa a faixa", "Publicar…"); everything else is
// written to match it. Interface copy only: never writing.

/** "1 privado", "2 privados": the word after a count, zero taking the plural. */
const after = (n: number, one: string, other: string) =>
  `${n} ${n === 1 ? one : other}`;

export const studioPtBR: StudioDictionary = {
  meta: {
    studio: "Estúdio de escrita · refrain",
    signIn: "Entrar · refrain",
    catalog: "Catálogo · refrain",
    addMusic: "Adicionar música · refrain",
    reviewBeforeAdding: "Revisar antes de adicionar · refrain",
    chooseEdition: "Escolher uma edição · refrain",
    artists: "Artistas · refrain",
    newArtist: "Adicionar um artista · refrain",
    artist: "Artista · refrain",
    photo: "Foto · refrain",
    photoReview: "Revisar foto · refrain",
    albums: "Álbuns · refrain",
    newAlbum: "Adicionar um álbum · refrain",
    album: "Álbum · refrain",
    artwork: "Capa · refrain",
    tracks: "Faixas · refrain",
    newTrack: "Adicionar uma faixa · refrain",
    track: "Faixa · refrain",
    journals: "Diários · refrain",
    newJournal: "Escrever um diário · refrain",
    journal: "Diário · refrain",
    editJournal: "Editar um diário · refrain",
    deleted: "Excluídos recentemente · refrain",
    memories: "Memórias · refrain",
    newMemory: "Escrever uma memória · refrain",
    memory: "Memória · refrain",
  },
  frame: {
    studio: "Estúdio de escrita",
    skipLink: "Pular para o conteúdo",
    navigationLabel: "Estúdio de escrita",
    desk: "Mesa",
    catalog: "Catálogo",
    catalogNavigationLabel: "Seções do catálogo",
    overview: "Visão geral",
    artists: "Artistas",
    albums: "Álbuns",
    tracks: "Faixas",
    closingLine: "algumas músicas levam a gente de volta.",
    loading: "Carregando…",
    unavailable:
      "O estúdio não está disponível agora. Tente de novo mais tarde.",
  },
  languageSelector: {
    label: "Idioma",
    note: "Muda só a interface. O que foi escrito fica no idioma original.",
  },
  languageNames: {
    en: "English",
    "pt-BR": "Português (Brasil)",
  },
  languageInSentence: {
    en: "inglês",
    "pt-BR": "português (Brasil)",
  },
  signIn: {
    title: "Entrar",
    email: "E-mail",
    password: "Senha",
    submit: "Entrar",
    pending: "Entrando…",
    mismatch: "Esse e-mail e essa senha não conferem.",
    tooMany: "Tentativas demais. Espere um minuto e tente de novo.",
    refused: "Esta entrada foi recusada. Recarregue a página e tente de novo.",
    failed: "Não deu para entrar. Tente de novo.",
  },
  signOut: {
    action: "Sair",
    pending: "Saindo…",
    failed: "Não deu para sair. Tente de novo.",
  },
  common: {
    cancel: "Cancelar",
    working: "Trabalhando…",
    saving: "Salvando…",
    savedNow: "Salvo agora",
    unsaved: "Alterações não salvas",
    leaveUnsaved: "Há alterações não salvas. Sair sem salvar?",
    edit: "Editar",
    optional: "opcional",
  },
  statusInSentence: {
    draft: "um rascunho",
    private: "privada",
    published: "publicada",
  },
  statusLower: {
    draft: "rascunho",
    private: "privada",
    published: "publicada",
  },
  status: {
    draft: "Rascunho",
    private: "Privado",
    published: "Publicado",
  },
  // "Memória" is feminine.
  memoryStatus: {
    draft: "Rascunho",
    private: "Privada",
    published: "Publicada",
  },
  fields: {
    required: "Este campo é obrigatório.",
    tooLong: "Isto está longo demais.",
    invalid: "Isto não é válido.",
  },
  failures: {
    unauthorized:
      "Sua sessão terminou. Entre de novo em outra aba e tente outra vez. O que você digitou continua aqui.",
    unavailable:
      "O estúdio não consegue verificar sua sessão agora. Tente de novo daqui a pouco. O que você digitou continua aqui.",
    invalidInput: "Alguns campos precisam de atenção.",
    notFound: "Esse registro não existe mais. Recarregue a página.",
    inUse: "Algo ainda depende dele. Arquive em vez de excluir.",
    blockedBy: {
      album_credits:
        "Ele tem crédito em um álbum. Remova esses créditos primeiro, ou arquive em vez de excluir.",
      track_credits:
        "Ele tem crédito em uma faixa. Remova esses créditos primeiro, ou arquive em vez de excluir.",
      journals:
        "Há diários escritos sobre ele, então ele continua no seu catálogo. Arquive em vez de excluir.",
      memories:
        "Uma memória aponta para ele, então ele continua no seu catálogo. Arquive em vez de excluir.",
      albums:
        "Ele está em um álbum. Tire do álbum primeiro, ou arquive em vez de excluir.",
      reflections:
        "Há uma reflexão escrita sobre esta faixa, então ela continua no álbum.",
    },
    duplicate: "Esse identificador do MusicBrainz já está no seu catálogo.",
    archived:
      "Um registro arquivado não pode ser adicionado. Restaure-o primeiro.",
    conflict: {
      journal:
        "Este diário mudou em outro lugar desde que você o abriu, então nada foi salvo. Seu texto continua aqui: copie, recarregue a página e salve de novo.",
      memory:
        "Esta memória mudou em outro lugar desde que você a abriu, então nada foi salvo. Seu texto continua aqui: copie, recarregue a página e salve de novo.",
    },
    deleted: {
      journal:
        "Este diário está em Excluídos recentemente, então não pode ser alterado.",
      memory:
        "Esta memória está em Excluídos recentemente, então não pode ser alterada.",
    },
    notDeleted: {
      journal:
        "Este diário não está em Excluídos recentemente, então não há nada para restaurar. Talvez ele já tenha sido restaurado. Recarregue a página.",
      memory:
        "Esta memória não está em Excluídos recentemente, então não há nada para restaurar. Talvez ela já tenha sido restaurada. Recarregue a página.",
    },
    unsupported:
      "Este texto tem uma formatação que o editor simples não consegue mostrar sem perder, então ele não foi mexido.",
    reviewChanged:
      "O que seria publicado mudou desde que você olhou, ou a sua confirmação expirou, então nada foi publicado nem salvo. Seu texto continua aqui. Revise de novo para continuar.",
    nothingToPublish: {
      journal:
        "Uma versão precisa de uma frase de abertura ou de algum texto para ser publicada, e uma versão publicada precisa manter um deles. Nada foi alterado. Escreva algo primeiro, ou despublique antes de esvaziá-la.",
      memory:
        "Uma memória precisa de um título e de algum texto para ser publicada, e uma memória publicada precisa mantê-los. Nada foi alterado. Escreva algo primeiro, ou despublique antes de esvaziá-la.",
    },
    statusChanged:
      "Esta versão foi alterada em outro lugar (outra aba pode tê-la publicado ou despublicado), então nada foi alterado aqui. A página agora mostra como ela está. Confira e escolha de novo.",
    unreachable:
      "O estúdio não respondeu, então não se sabe se isto funcionou. Recarregue a página para ver o que foi salvo antes de tentar de novo. O que você digitou continua aqui.",
    noAddress: {
      journal:
        "Este diário não tem endereço, então não pode ser publicado. Nada foi alterado.",
      memory:
        "Esta memória não tem endereço, então não pode ser publicada. Nada foi alterado.",
    },
    providerUnavailable:
      "Não deu para acessar o MusicBrainz, o Cover Art Archive ou o Wikimedia Commons, então nada foi alterado. Seu catálogo e seus textos continuam funcionando. Tente de novo daqui a pouco.",
    providerNotFound:
      "O MusicBrainz ou o Wikimedia Commons não tem mais esse registro ou arquivo. Busque de novo.",
    stale:
      "Algo mudou desde que você olhou: o MusicBrainz, o Cover Art Archive, o Wikimedia Commons ou este registro no seu catálogo. Nada foi alterado. Revise de novo.",
    unsupportedRelease:
      "Este lançamento não pode ser adicionado como um único álbum. Adicione à mão, ou vincule um álbum que você já tem.",
    alreadyLinked:
      "Este registro já está vinculado a outra entrada do MusicBrainz, e um vínculo nunca é substituído. Nada foi alterado.",
    notLinked:
      "Este álbum ainda não está vinculado ao MusicBrainz, então não há capas para escolher.",
    publicPage:
      "Um diário publicado mostra isto numa página pública, e esta mudança chegaria aos leitores sem uma confirmação, que ainda não existe. Nada foi alterado. Uma foto sempre pode ser removida; para trocá-la, ou para restaurar um artista que tem uma, remova-a primeiro ou despublique os diários que a mostram.",
    photoNotUsable:
      "Esta foto não pode mais ser usada: a licença, o crédito ou o arquivo mudou no Wikimedia Commons. Nada foi alterado. Escolha outra, ou revise de novo.",
    failed: "Algo deu errado, e nada foi alterado. Tente de novo.",
  },
  publicPageNote:
    "Na web, a página só abre no endereço onde as leituras públicas estão ligadas. Elas vêm desligadas por padrão; numa instalação padrão, nada abre na web.",
  records: {
    restore: {
      artist: "Restaurar artista",
      album: "Restaurar álbum",
      track: "Restaurar faixa",
    },
    archive: {
      artist: "Arquivar artista…",
      album: "Arquivar álbum…",
      track: "Arquivar faixa…",
    },
    remove: {
      artist: "Excluir artista…",
      album: "Excluir álbum…",
      track: "Excluir faixa…",
    },
    archiveQuestion: {
      artist: "Arquivar este artista?",
      album: "Arquivar este álbum?",
      track: "Arquivar esta faixa?",
    },
    archiveConfirm: "Arquivar",
    removeQuestion: {
      artist: "Excluir este artista?",
      album: "Excluir este álbum?",
      track: "Excluir esta faixa?",
    },
    removeConfirm: "Excluir",
    removeBody: {
      artist:
        "Isto remove o artista do seu catálogo de vez. Só funciona quando nada se refere a ele: se algo se referir, nada é excluído, e você pode arquivá-lo. Isto nunca exclui o que você escreveu.",
      album:
        "Isto remove o álbum do seu catálogo de vez. Só funciona quando nada se refere a ele: se algo se referir, nada é excluído, e você pode arquivá-lo. Isto nunca exclui o que você escreveu.",
      track:
        "Isto remove a faixa do seu catálogo de vez. Só funciona quando nada se refere a ela: se algo se referir, nada é excluído, e você pode arquivá-la. Isto nunca exclui o que você escreveu.",
    },
  },
  artistRows: {
    artist: (legend: string, n: number) => `${legend}: artista ${n}`,
    choose: "Escolha um artista",
    creditedAs: (legend: string, n: number) =>
      `${legend}: creditado como, artista ${n}`,
    creditedAsPlaceholder: "Creditado como (opcional)",
    moveUp: (n: number) => `Mover o artista ${n} para cima`,
    moveDown: (n: number) => `Mover o artista ${n} para baixo`,
    remove: (n: number) => `Remover o artista ${n}`,
    removeShort: "Remover",
    addFirst: "Adicionar um artista",
    addAnother: "Adicionar outro artista",
  },
  artwork: {
    noneLabel: "Ainda sem capa do álbum",
    none: "ainda sem capa",
    label: "Capa do álbum",
    labelFor: (title: string) => `Capa do álbum ${title}`,
    notShown: "capa não exibida",
  },
  counts: {
    journals: (n: number) => counted("pt-BR", n, "diário", "diários"),
    memories: (n: number) => counted("pt-BR", n, "memória", "memórias"),
    artists: (n: number) => counted("pt-BR", n, "artista", "artistas"),
    albums: (n: number) => counted("pt-BR", n, "álbum", "álbuns"),
    tracks: (n: number) => counted("pt-BR", n, "faixa", "faixas"),
    words: (n: number) => counted("pt-BR", n, "palavra", "palavras"),
  },
  catalog: {
    title: "Catálogo",
    lead: "Os artistas, álbuns e faixas para onde o seu texto aponta. Nada aqui apaga texto.",
    addMusic: "Adicionar música",
    emptyTitle: "Nada no catálogo ainda",
    emptyStart: "Tudo começa com um artista ou uma banda. ",
    emptyFind: "Encontre um no MusicBrainz",
    emptyOr: " ou ",
    emptyByHand: "adicione um à mão",
    emptyEnd:
      ", depois um álbum que credite esse artista, e a música que você ama vai ter onde morar.",
    areasLabel: "Áreas do catálogo",
    addArtist: "Adicionar um artista",
    addAlbum: "Adicionar um álbum",
    addTrack: "Adicionar uma faixa",
    albumsSummary: (albums: number, withoutTracks: number) =>
      `${counted("pt-BR", albums, "álbum", "álbuns")} · ${counted("pt-BR", withoutTracks, "álbum", "álbuns")} sem faixas`,
    tracksSummary: (tracks: number, onNoAlbum: number) =>
      `${counted("pt-BR", tracks, "faixa", "faixas")} · ${counted("pt-BR", onNoAlbum, "faixa", "faixas")} fora de qualquer álbum`,
    archivedNote: (n: number) =>
      `${counted("pt-BR", n, "registro arquivado", "registros arquivados")}. Registros arquivados ficam fora das listas de escolha e continuam ligados aos textos que os usam.`,
  },
  artists: {
    title: "Artistas",
    lead: "As pessoas e bandas por trás da música sobre a qual você escreve.",
    add: "Adicionar um artista",
    emptyTitle: "Nenhum artista ainda",
    emptyBody:
      "Tudo começa com um artista ou uma banda. Adicione um, depois um álbum que o credite, e a música que você ama vai ter onde morar.",
    listLabel: "Artistas",
    archived: "Arquivados",
    archivedHint:
      "Fora das listas de escolha. Os álbuns, faixas e diários deles continuam intactos.",
    archivedLabel: "Artistas arquivados",
    band: "Banda",
    person: "Pessoa",
  },
  photograph: {
    of: (name: string) => `Foto de ${name}`,
    noneOf: (name: string) => `Ainda sem foto de ${name}`,
    notShown: "foto não exibida",
    noneYet: "ainda sem foto",
    captionPrefix: "Foto: ",
    licenseAsMarked: (name: string) =>
      `${name} (como indicado no Wikimedia Commons)`,
    viaCommons: " · via Wikimedia Commons",
    details: "Detalhes da foto",
    work: "Foto",
    credit: "Crédito",
    source: "Fonte",
    sourceCommons: "Wikimedia Commons, ",
    filePage: "a página do arquivo",
    license: "Licença",
    shareAlike: ". Adaptações precisam usar a mesma licença.",
    changes: "Alterações",
    standardChanges:
      "Redimensionada e recortada para caber no quadro. Nenhuma outra alteração.",
  },
  catalogRecord: {
    archiveOrDelete: "Arquivar ou excluir",
  },
  artist: {
    back: "← Artistas",
    archived:
      "Este artista está arquivado: fora das listas de escolha, com tudo o que foi escrito sobre ele mantido.",
    photograph: "Foto",
    photoUnreadable:
      "A foto registrada não está no formato que o Refrain grava, então não é exibida. Abra a página da foto para removê-la.",
    noPhoto: "Sem foto. A página funciona sem uma.",
    restoreToChangePhoto: "Restaure o artista para trocar a foto.",
    choosePhoto: "Escolher no Wikimedia Commons…",
    changePhoto: "Trocar ou remover a foto…",
    albums: "Álbuns",
    noAlbums: "Nenhum álbum credita este artista ainda. ",
    addAlbum: "Adicionar um álbum",
    credited: (albums: number, tracks: number) =>
      `Creditado em ${counted("pt-BR", albums, "álbum", "álbuns")} e ${counted("pt-BR", tracks, "faixa", "faixas")}.`,
    archiveNote: (albums: number, tracks: number, journals: number) =>
      `Arquivar tira o artista das listas de escolha e não exclui nada. ${counted("pt-BR", albums, "álbum", "álbuns")} e ${counted("pt-BR", tracks, "faixa", "faixas")} mantêm o crédito, e ${counted("pt-BR", journals, "diário escrito", "diários escritos")} sobre o artista continuam como estão, mostrando o nome como texto simples.`,
  },
  artistForm: {
    name: "Nome",
    kind: "Pessoa ou banda",
    person: "Uma pessoa",
    group: "Uma banda ou grupo",
    sortName: "Nome para ordenar (opcional)",
    sortNameHint:
      "Como arquivar o nome nas listas, por exemplo “Buckley, Jeff”.",
    mbArtistId: "ID de artista do MusicBrainz (opcional)",
    mbArtistIdHint:
      "Preenchido quando você adiciona ou vincula este artista em Adicionar música. Salvar este formulário não consulta nada.",
    save: "Salvar artista",
    add: "Adicionar artista",
  },
  photoPage: {
    title: "Foto",
    lead: "Escolha uma foto com licença livre do Wikimedia Commons, ou nenhuma. Só aparecem fotos com uma licença que o Refrain aceita e um autor identificado, e nada muda até você escolher uma.",
    onFile: "Registrada",
    notShownTitle: "Não exibida",
    notShownBody:
      "A foto registrada não está no formato que o Refrain grava (pode ter sido alterada fora do estúdio), então não é exibida. Remova-a e escolha de novo.",
    archived:
      "Este artista está arquivado. Restaure-o para escolher uma foto; a foto registrada ainda pode ser removida.",
    search: "Buscar no Wikimedia Commons",
    looking: "Procurando no Wikimedia Commons…",
    source:
      "Fotos do Wikimedia Commons, cada uma com a sua licença e com o crédito que ela pede. Uma licença livre cobre a foto, não as pessoas nela.",
    check: {
      new_version:
        "Uma nova versão deste arquivo foi enviada ao Wikimedia Commons depois que você o escolheu, e o quadro agora mostra essa versão. Revise de novo, ou remova.",
      details_changed:
        "O crédito ou a licença no Wikimedia Commons mudou depois que você escolheu este arquivo. Revise de novo para manter a atribuição correta, ou remova.",
      missing:
        "O Wikimedia Commons não tem mais este arquivo; ele pode ter sido apagado. Remova-o, ou escolha outro.",
      not_usable:
        "No Wikimedia Commons, este arquivo não atende mais às regras de licença e crédito do Refrain. Remova-o, ou escolha outro.",
      unavailable:
        "Não deu para verificar este arquivo no Wikimedia Commons agora. A foto registrada não mudou.",
    },
    onPublicPageTitle: "Exibido numa página pública",
    onPublicPageBody:
      "Um diário publicado coloca este artista numa página pública, então a foto dele não pode ser substituída: uma nova chegaria aos leitores sem uma confirmação, que ainda não existe. Você ainda pode removê-la acima. Para escolher outra, despublique primeiro os diários que mostram este artista.",
    checkTitle: "A foto registrada",
    reviewAgain: "Revisar de novo",
    searchFor: (name: string) =>
      `Busque no Wikimedia Commons uma foto de ${name}.`,
    unreachableTitle: "Não deu para acessar o Wikimedia Commons.",
    unreachableBody:
      "Seu catálogo e seus textos continuam funcionando, e a foto registrada não mudou. Tente de novo daqui a pouco.",
    tryAgain: "Tentar de novo",
    nothingFound: (query: string) => `Nada encontrado para “${query}”.`,
    nothingFoundHint: "Confira a grafia ou tente menos palavras.",
    fromCommons: "Do Wikimedia Commons",
    canBeChosen: (n: number) =>
      n === 1
        ? "1 foto pode ser escolhida."
        : `${n} fotos podem ser escolhidas.`,
    lookClosely:
      "Uma busca encontra palavras, não pessoas. Olhe com atenção antes de escolher.",
    nothingOffered: "Nada encontrado aqui pode ser oferecido.",
    suggestedTitle: "Sugeridas pelo Wikidata",
    suggestionsUnavailable:
      "Não deu para acessar o Wikidata ou o Wikimedia Commons para buscar sugestões. Busque abaixo.",
    suggestionsNoItem:
      "O Wikidata não tem uma única entrada para o vínculo deste artista com o MusicBrainz, então não há sugestões. Busque abaixo.",
    suggestionsNone:
      "A entrada do Wikidata para este artista não tem nenhuma foto que o Refrain possa oferecer.",
    suggestionsRefused: (n: number) =>
      n === 1
        ? " 1 arquivo não atendeu às regras de licença e crédito."
        : ` ${n} arquivos não atenderam às regras de licença e crédito.`,
    suggestionsLead: (name: string) =>
      `O Wikidata liga a entrada de ${name} no MusicBrainz a estes arquivos. É uma pista, não uma prova: confira se cada foto mostra mesmo esse artista antes de escolher.`,
    candidate: (title: string) => `Candidata: ${title}`,
    review: "Revisar",
    refused: (n: number) =>
      n === 1
        ? "Mais 1 arquivo não pode ser oferecido: a licença, o crédito, o formato ou o tamanho não atende às regras do Refrain."
        : `Mais ${n} arquivos não podem ser oferecidos: a licença, o crédito, o formato ou o tamanho deles não atende às regras do Refrain.`,
  },
  removePhoto: {
    action: "Remover a foto…",
    pending: "Removendo…",
    done: "Foto removida, com o crédito e o registro dela.",
    question: (name: string) => `Remover a foto de ${name}?`,
    confirmLabel: "Remover",
    body: "O artista volta a mostrar o quadro “ainda sem foto”, e o crédito e o registro da foto saem junto. Você pode escolher uma foto de novo quando quiser.",
  },
  photoReview: {
    back: "← Foto",
    title: "Revisar foto",
    unreachableBody:
      "Nada foi alterado. Seu catálogo e seus textos continuam funcionando. Tente de novo daqui a pouco.",
    forArtist: (name: string) => `Para ${name}.`,
    noSuchFile: "O Wikimedia Commons não tem esse arquivo.",
    noSuchFileBody:
      "Ele pode ter sido apagado ou renomeado. Nada foi alterado.",
    backToPhoto: "Voltar à foto",
    notShown: (title: string) => `${title} não é exibido`,
    creditShown: "Crédito exibido",
    noCredit: "Nenhum que possa ser exibido",
    creator: "Autor",
    notNamed: "Não identificado",
    sourceNote: ". A nota de fonte do arquivo: ",
    licenseNotAccepted: "Nenhuma que o Refrain aceite",
    size: "Tamanho",
    anotherFormat: "outro formato",
    version: "Versão",
    uploaded: (date: string) => `Enviada em ${date}`,
    cantBeUsed: "Esta foto não pode ser usada.",
    chooseAnother: "Escolher outra",
    personalityTitle: "Direitos de imagem",
    personalityBody:
      "O Wikimedia Commons avisa que as pessoas na foto podem ter direitos que restringem alguns usos da imagem delas, seja qual for a licença.",
    otherRestrictions: "Outras restrições indicadas no Wikimedia Commons: ",
    freeLicenseNote:
      "Uma licença livre cobre a foto, não as pessoas nela. Se a página do arquivo lista mais de uma licença, confira se elas são alternativas, e não condições que valem todas juntas. Antes de uma foto aparecer numa página pública, ela precisa da revisão de direitos da lista de verificação do Refrain para publicação hospedada.",
    archived: "Este artista está arquivado. Restaure-o para trocar a foto.",
    isCurrent: "Esta é a foto registrada, nesta versão.",
    onPublicPageBody:
      "Um diário publicado coloca este artista numa página pública, então a foto dele não pode ser substituída aqui: uma nova chegaria aos leitores sem uma confirmação, que ainda não existe. Você ainda pode remover a foto, e a página passa a mostrar o quadro vazio. Para escolher outra, despublique primeiro os diários que mostram este artista.",
    refusals: {
      unsupported_license:
        "A licença não é uma que o Refrain aceita (CC0, domínio público, ou CC BY ou CC BY-SA de 2.0 a 4.0, genérica ou internacional).",
      license_mismatch:
        "Os dados da licença no Wikimedia Commons se contradizem, então não fica claro qual licença vale.",
      non_free:
        "O Wikimedia Commons indica que o arquivo não tem licença livre.",
      no_creator: "O arquivo não identifica o fotógrafo ou autor a creditar.",
      credit_not_plain:
        "O crédito tem uma formatação que o Refrain não consegue mostrar como texto simples.",
      credit_too_long:
        "O crédito é longo demais para aparecer embaixo de uma foto.",
      deletion_requested:
        "O arquivo foi indicado para exclusão no Wikimedia Commons.",
      unsupported_format: "Não é uma foto JPEG ou PNG.",
      too_small: "É menor que 600 × 400 pixels.",
      unexpected_address:
        "Os endereços do arquivo no Wikimedia Commons não estão numa forma que o Refrain consiga mostrar com segurança.",
    },
  },
  approvePhoto: {
    label: "Sua escolha",
    replaces: "Ela substitui a foto registrada, com o crédito dela.",
    use: "Usar esta foto",
    useInstead: "Usar esta foto no lugar",
  },
  albums: {
    title: "Álbuns",
    lead: "Cada álbum é a obra em si, com o lançamento que define a ordem das faixas. Os diários são escritos sobre álbuns.",
    add: "Adicionar um álbum",
    emptyTitle: "Nenhum álbum ainda",
    emptyBody:
      "Adicione um álbum, credite um artista e monte a lista de faixas. Depois você pode escrever um diário sobre ele.",
    listLabel: "Álbuns",
    archived: "Arquivados",
    archivedHint:
      "Fora das listas de escolha. Os diários deles continuam intactos.",
    archivedLabel: "Álbuns arquivados",
    noArtist: "nenhum artista creditado",
    usedIn: (n: number) =>
      `usado em ${counted("pt-BR", n, "entrada", "entradas")}`,
  },
  album: {
    back: "← Álbuns",
    archivedOption: (name: string) => `${name} (arquivado)`,
    archived:
      "Este álbum está arquivado: fora das listas de escolha, com os diários e a lista de faixas mantidos.",
    details: "Detalhes",
    artworkTitle: "Capa e MusicBrainz",
    coverSource: "Capa: Cover Art Archive. ",
    noArtwork: "Ainda sem capa. ",
    linked:
      "Vinculado ao MusicBrainz, então dá para escolher uma capa do Cover Art Archive.",
    notLinked:
      "Não vinculado ao MusicBrainz. Encontre-o em Adicionar música e vincule-o para escolher uma capa.",
    changeArtwork: "Trocar a capa",
    chooseArtwork: "Escolher a capa",
    findOnMusicBrainz: "Encontrar no MusicBrainz",
    tracklist: "Lista de faixas",
    journalsTitle: "Diários sobre este álbum",
    noJournals: "Nada escrito sobre este álbum ainda.",
    journalStarted: (date: string) => `Diário começado em ${date}`,
    edited: (date: string) => `editado em ${date}`,
    nothingWritten: "Nada escrito ainda",
    writeJournal: "Escrever um diário sobre este álbum",
    archiveNote: (entries: number) =>
      `Arquivar tira o álbum das listas de escolha e não exclui nada. ${counted("pt-BR", entries, "entrada escrita", "entradas escritas")} sobre ele continuam como estão, mostrando o título como texto simples. A lista de faixas e os créditos são mantidos.`,
  },
  albumForm: {
    yearProblem: "Escreva o ano com quatro dígitos, como 1994.",
    artistFirst: "Adicione um artista primeiro",
    artistFirstBody: "Um álbum é creditado a pelo menos um artista ou banda.",
    title: "Título",
    titleHint:
      "Os títulos não precisam ser únicos: dois álbuns podem ter o mesmo nome.",
    credits: "Artistas creditados",
    creditsProblem:
      "Escolha um artista para cada linha, e nenhum artista duas vezes.",
    year: "Primeiro lançamento (opcional)",
    edition: "Edição de referência",
    editionHint:
      "O lançamento que define a ordem das faixas. Tudo aqui é opcional.",
    label: "Gravadora",
    releaseDate: "Data de lançamento",
    country: "País (duas letras)",
    mbReleaseGroupId: "ID de grupo de lançamentos do MusicBrainz (opcional)",
    mbReleaseGroupIdHint:
      "Preenchido quando você adiciona ou vincula este álbum em Adicionar música. Salvar este formulário não consulta nada.",
    save: "Salvar álbum",
    add: "Adicionar álbum",
  },
  tracklist: {
    added: "Adicionada ao fim da lista de faixas.",
    lengthProblem: "Escreva a duração em minutos e segundos, como 3:42.",
    created: "Faixa criada e adicionada ao fim da lista de faixas.",
    empty:
      "Nenhuma faixa ainda. Adicione as que você já tem, ou crie a primeira abaixo.",
    label: "Lista de faixas",
    archived: "arquivada",
    moveUp: (title: string) => `Mover “${title}” para cima`,
    movedUp: (title: string) => `“${title}” foi para cima.`,
    moveDown: (title: string) => `Mover “${title}” para baixo`,
    movedDown: (title: string) => `“${title}” foi para baixo.`,
    // Begins with the button's visible word (WCAG 2.5.3).
    removeLabel: (title: string) => `Remover “${title}” deste álbum`,
    remove: "Remover",
    hasReflection:
      "Há uma reflexão escrita sobre esta faixa, então ela continua no álbum.",
    addExisting: "Adicionar uma faixa que você já tem",
    chooseTrack: "Escolha uma faixa",
    addToAlbum: "Adicionar ao álbum",
    createTitle: "Criar uma nova faixa neste álbum",
    title: "Título",
    length: "Duração (3:42)",
    creditAlbumArtists: "Creditar os artistas do álbum nesta faixa",
    createAndAdd: "Criar e adicionar",
    removeQuestion: "Tirar esta faixa do álbum?",
    removeConfirm: "Tirar do álbum",
    removed: (title: string) => `“${title}” saiu deste álbum.`,
    removeBody: (title: string) =>
      `“${title}” continua no seu catálogo e em qualquer outro álbum. Só o lugar dela nesta lista de faixas sai.`,
  },
  artworkPage: {
    title: "Capa",
    coverSource: "Capa: Cover Art Archive",
    noArtwork: "Ainda sem capa. O álbum mostra o quadro “ainda sem capa”.",
    onPublicPageBody:
      "Um diário publicado mostra este álbum, então a capa não pode mudar aqui: uma mudança chegaria aos leitores sem uma confirmação, que ainda não existe. Despublique o diário primeiro se a capa precisar mudar.",
    archived: "Este álbum está arquivado. Restaure-o para trocar a capa.",
    notLinkedTitle: "Não vinculado ao MusicBrainz",
    notLinkedStart:
      "A capa vem do Cover Art Archive, que precisa saber qual álbum do MusicBrainz é este. Encontre-o em ",
    notLinkedEnd: " e escolha “Vincular a este álbum”.",
    unreachableTitle: "Não deu para acessar o Cover Art Archive.",
    unreachableBody:
      "Seu catálogo e seus textos continuam funcionando. Tente de novo daqui a pouco.",
    source:
      "Capa do Cover Art Archive, adicionada só se você escolher. As imagens têm direitos autorais dos seus donos.",
    frontCovers: "Capas frontais",
    noFrontCover:
      "O Cover Art Archive não tem capa frontal para a edição deste álbum.",
    fromReleaseGroup:
      "O álbum ainda não tem uma edição no MusicBrainz, então estas são as capas que o arquivo mostra para o álbum como um todo.",
    frontCoverOf: (title: string, n: number) => `${title}, capa frontal ${n}`,
    current: "Capa atual",
    use: "Usar esta capa",
    useInstead: "Usar esta capa no lugar",
    frontCoverNumber: (n: number) => ` (capa frontal ${n})`,
    remove: "Remover a capa…",
    removeQuestion: "Remover a capa deste álbum?",
    removeConfirm: "Remover",
    removeBody:
      "O álbum volta a mostrar o quadro “ainda sem capa”. Você pode escolher uma capa de novo quando quiser.",
  },
  tracks: {
    title: "Faixas",
    lead: "Todas as gravações do seu catálogo. Uma gravação pode estar em vários álbuns sem ser copiada.",
    add: "Adicionar uma faixa",
    emptyTitle: "Nenhuma faixa ainda",
    emptyBody:
      "Adicione faixas aqui, ou monte a lista de faixas de um álbum e crie as faixas no caminho.",
    listLabel: "Faixas",
    archived: "Arquivadas",
    archivedLabel: "Faixas arquivadas",
    onNoAlbum: "fora de qualquer álbum",
    onAlbums: (n: number) => `em ${counted("pt-BR", n, "álbum", "álbuns")}`,
  },
  track: {
    back: "← Faixas",
    archived:
      "Esta faixa está arquivada: fora das listas de escolha, e mantida nos álbuns em que já está.",
    onAlbums: "Nestes álbuns",
    noAlbum: "Fora de qualquer álbum. Adicione-a pela página de um álbum.",
    memories: "Memórias",
    noMemory: "Nenhuma memória pertence a esta música ainda.",
    memoriesLabel: "Memórias com esta música",
    archivedNoMemory:
      "Uma faixa arquivada não pode entrar numa nova memória. Restaure-a primeiro.",
    writeMemory: "Escrever uma memória sobre esta música",
    archiveNote:
      "Arquivar tira a faixa das listas de escolha e não exclui nada. Ela continua nos álbuns em que já está, e o que foi escrito sobre ela fica intacto.",
  },
  trackForm: {
    title: "Título",
    length: "Duração (opcional)",
    lengthHint: "Minutos e segundos, como 3:42.",
    credits: "Artistas creditados (opcional)",
    noCredits: "Nenhum artista creditado. Uma faixa pode existir sozinha.",
    creditNote: "Nota de crédito (opcional)",
    creditNoteHint:
      "O que os créditos dizem e um vínculo de artista não diz, como “feat. alguém”.",
    mbRecordingId: "ID de gravação do MusicBrainz (opcional)",
    album: "Adicionar a um álbum (opcional)",
    albumPlaceholder: "Ainda fora de qualquer álbum",
    albumHint:
      "Ela vai para o fim da lista de faixas do álbum. Uma faixa pode estar em vários álbuns; adicione os outros pela página do álbum.",
    save: "Salvar faixa",
    add: "Adicionar faixa",
  },
  addMusic: {
    back: "← Voltar ao catálogo",
    title: "Adicionar música",
    lead: "Busque álbuns e artistas no MusicBrainz e adicione ao seu catálogo. Adicionar não publica nada.",
    search: "Buscar no MusicBrainz",
    searchFor: "Buscar por",
    kinds: { albums: "Álbuns", artists: "Artistas" },
    searching: "Buscando no MusicBrainz…",
    length: "Use de 1 a 200 caracteres.",
    unreachableTitle: "Não deu para acessar o MusicBrainz.",
    unreachableBody:
      "Seu catálogo e seus textos continuam funcionando. Tente de novo daqui a pouco.",
    source:
      "Dados do MusicBrainz. Capa do Cover Art Archive, adicionada só se você escolher.",
    resultCount: (n: number) =>
      n === 1
        ? "1 resultado do MusicBrainz."
        : `${n} resultados do MusicBrainz.`,
    inCatalog: "No catálogo",
    alreadyInCatalog: "Já no seu catálogo",
    fromMusicBrainz: "Do MusicBrainz",
    nothingNew: "Nada novo encontrado no MusicBrainz.",
    release: "Lançamento",
    artist: "Artista",
    add: "Adicionar",
    addAlbumLabel: (title: string, credit: string | null) =>
      ` ${title}${credit ? ` de ${credit}` : ""}`,
  },
  editions: {
    back: "← Adicionar música",
    firstReleased: (year: string) => `lançado em ${year}`,
    alreadyStart: "Este álbum é ",
    alreadyEnd:
      " no seu catálogo, então não pode ser adicionado de novo. A capa pode ser escolhida na página dele.",
    choose: "Escolha uma edição",
    explain:
      "O álbum é a obra. Uma edição é um lançamento dela, com as suas próprias faixas, gravadora e data. A edição que você escolher define a lista de faixas do álbum; você revisa tudo antes de adicionar.",
    none: "O MusicBrainz não lista nenhuma edição.",
    original: "lançamento original",
    noDate: "sem data",
    review: "Revisar",
    reviewLabel: (date: string | null, place: string | null) =>
      ` a edição ${[date ?? "sem data", place].filter(Boolean).join(", ")}`,
    showing: (shown: number, total: number) =>
      `Mostrando as primeiras ${shown} de ${total} edições.`,
    source: "Dados do MusicBrainz.",
  },
  release: {
    back: "← Outras edições",
    lead: "Revise o que será adicionado ao seu catálogo. Adicionar não publica nada, e nada que já está no seu catálogo muda.",
    alreadyAlbumEnd: " no seu catálogo, então não é adicionado de novo.",
    editionBelongs: "Esta edição pertence a ",
    unsupportedTitle: "Esta edição não pode ser adicionada como um único álbum",
    unsupported: {
      no_tracks: "O MusicBrainz não lista faixas para esta edição.",
      too_many_tracks:
        "Esta edição tem mais faixas ou discos do que um álbum do catálogo comporta.",
      repeated_recording:
        "Esta edição lista a mesma gravação duas vezes, e um álbum tem cada gravação uma vez só.",
      no_credits: "O MusicBrainz não credita nenhum artista nesta edição.",
      too_many_credits:
        "Esta edição credita mais artistas do que o catálogo comporta.",
      text_too_long:
        "Um título ou nome desta edição é mais longo do que o catálogo comporta.",
    },
    unsupportedHint:
      "Escolha outra edição, adicione o álbum à mão, ou vincule um álbum que você já tem.",
    album: "O álbum",
    title: "Título",
    creditedTo: "Creditado a",
    noArtist: "nenhum artista creditado",
    firstReleased: "Primeiro lançamento",
    notKnown: "não se sabe",
    kind: "Tipo",
    notGiven: "não informado",
    edition: "Esta edição",
    released: "Lançada em",
    partialDate: " (só o ano é guardado: o catálogo grava datas completas)",
    country: "País",
    label: "Gravadora",
    note: "Nota",
    status: "Situação",
    tracks: "Faixas",
    tracksHint: (n: number) =>
      `${counted("pt-BR", n, "faixa", "faixas")}, na ordem desta edição. Uma faixa que já está no seu catálogo mantém o próprio título e os próprios detalhes.`,
    archivedInCatalog: " · no seu catálogo, arquivado: restaure primeiro",
    inCatalog: " · já no seu catálogo",
    artists: "Artistas",
    keptAsItIs: " · já no seu catálogo, mantido como está",
    newBand: " · novo, como banda",
    newPerson: " · novo, como pessoa",
    kindUnknown: " (o MusicBrainz não diz; você pode mudar isso no catálogo)",
    linkTitle: "Ou vincule um álbum que você já tem",
    linkHint:
      "Vincular só registra que o seu álbum é este álbum e esta edição do MusicBrainz. O título, os créditos, as faixas e a capa continuam exatamente como estão.",
  },
  releaseApproval: {
    artwork: "Capa",
    artworkUnavailable:
      "Não deu para acessar o Cover Art Archive, então nenhuma capa é oferecida agora. Você pode escolher depois, na página do álbum.",
    noFrontCover:
      "O Cover Art Archive não tem capa frontal para esta edição. O álbum vai mostrar “ainda sem capa”.",
    chooseCover: "Escolha uma capa frontal do Cover Art Archive, ou nenhuma.",
    noArtwork: "Sem capa",
    frontCover: (n: number) => `Capa frontal ${n}`,
    adding: "Adicionando…",
    add: "Adicionar ao catálogo",
    addHint:
      "Adiciona este álbum, a edição, as faixas e qualquer artista novo. Nada é publicado.",
    link: "Vincular a este álbum",
    linkQuestion: (title: string) => `Vincular “${title}” ao MusicBrainz?`,
    linkConfirm: "Vincular",
    linkBody:
      "Isto registra qual álbum e qual edição do MusicBrainz ele é, para que se possa escolher uma capa. O título, os créditos, as faixas e a capa continuam exatamente como estão, e um vínculo que já existe nunca é substituído.",
  },
  artistReview: {
    lead: "Revise o que será adicionado ao seu catálogo. Adicionar não publica nada.",
    name: "Nome",
    sortedAs: "Ordenado como",
    addedAs: "Adicionado como",
    band: "banda",
    person: "pessoa",
    alreadyStart: "Este artista é ",
    tooLong:
      "Este nome é mais longo do que o catálogo comporta. Adicione à mão.",
    linkTitle: "Ou vincule um artista que você já tem",
    linkHint:
      "Vincular só registra qual artista do MusicBrainz ele é. O nome e o resto continuam exatamente como estão.",
    nothingPublished: "Nada é publicado.",
    link: "Vincular a este artista",
    linkBody:
      "Isto registra qual artista do MusicBrainz ele é. O nome, o nome para ordenar e o tipo continuam exatamente como estão, e um vínculo que já existe nunca é substituído.",
  },
  journals: {
    title: "Diários",
    lead: "O que você escreve sobre os álbuns que ama. Um álbum pode ter quantos diários você quiser, escritos ao longo dos anos.",
    emptyTitle: "Nada escrito ainda",
    emptyBody:
      "Escolha um álbum e comece um diário. Ele começa como um rascunho que só você vê, e só é salvo quando você salva.",
    totalsLabel: "Totais de diários",
    listLabel: "Diários",
    deletedHint:
      "Levados para lá, não apagados: o texto fica no banco de dados, e nada o remove sozinho. Você pode restaurar um diário de lá; a exclusão definitiva ainda não existe.",
    openDeleted: "Abrir Excluídos recentemente",
    rowDates: (started: string, edited: string, wordCount: number) =>
      `começado em ${started} · editado em ${edited} · ${counted("pt-BR", wordCount, "palavra", "palavras")}`,
  },
  newJournal: {
    journals: "Diários",
    writeAbout: (title: string) => `Escrever sobre ${title}`,
    back: "← Diários",
    albumFirst: "Adicione um álbum primeiro",
    albumFirstBody: "Um diário é escrito sobre um álbum do seu catálogo.",
    which: "Sobre qual álbum é?",
  },
  journalMargin: {
    fromCatalog: "Do seu catálogo",
    editInCatalog: "Editar no catálogo",
    artwork: "Capa",
    coverSource: "Cover Art Archive",
    noArtwork: "Ainda sem capa",
    change: "Trocar…",
    changeLabel: " a capa do álbum",
  },
  journal: {
    restoredPrivate:
      "Restaurado de Excluídos recentemente. Uma versão que estava publicada quando ele foi excluído agora é privada. Restaurar não publica nada: para publicá-lo de novo, você verá primeiro tudo o que seria publicado, inclusive as reflexões de faixa que você tinha marcado para incluir ao publicar.",
    restored:
      "Restaurado de Excluídos recentemente, com o texto exatamente como você deixou.",
    theAlbum: "O álbum",
    facts: (
      language: string,
      wordCount: number,
      started: string,
      edited: string,
    ) =>
      ` · escrito em ${language} · ${counted("pt-BR", wordCount, "palavra", "palavras")} · começado em ${started} · editado em ${edited} (datas em UTC)`,
    inDeleted: (date: string) =>
      `Este diário está em Excluídos recentemente desde ${date}. O texto fica guardado no banco de dados, e não pode ser alterado lá até você restaurá-lo.`,
    unsupported:
      "Este texto tem uma formatação que o editor simples não consegue mostrar sem perder. Ele está intacto.",
    edit: "Editar este diário",
    state: "Situação",
    versions: "Versões por idioma: ",
    version: (language: string, isOriginal: boolean, status: string) =>
      `${language}${isOriginal ? " (original)" : " (sua tradução)"}, ${status}`,
    noTranslation:
      ". Você não escreveu uma tradução, e nada é traduzido para você.",
    deletedLabel: "Excluído: ",
    deletedYes: "sim, em Excluídos recentemente",
    deletedNo: "não",
    manage: "Gerenciar",
  },
  restoreJournal: {
    label: (album: string) => `Restaurar o diário sobre ${album}`,
    action: "Restaurar…",
    question: "Restaurar este diário?",
    confirmLabel: "Restaurar diário",
    body: "O diário volta para os seus diários com o texto exatamente como você deixou.",
    wasPublished:
      "Uma versão que estava publicada quando ele foi excluído volta como privada. Restaurar não publica nada. Para publicá-lo de novo, você verá primeiro tudo o que seria publicado, inclusive as reflexões de faixa que você tinha marcado para incluir ao publicar.",
    stays: "Rascunhos continuam rascunhos, e o que é privado continua privado.",
  },
  editJournal: {
    back: "← O diário",
    title: "Editar um diário",
    deleted:
      "Este diário está em Excluídos recentemente, então não pode ser editado. O texto está guardado.",
    unsupported:
      "Este texto tem uma formatação que o editor simples não consegue mostrar sem perder, então não pode ser editado aqui. Ele está intacto.",
    theJournal: "O diário",
    editing: "Editando o seu diário de álbum",
    editingLabel: "Editando: ",
  },
  editor: {
    reflectionProblem:
      "Uma reflexão está longa demais ou não é válida, então nada foi salvo. Seu texto continua aqui.",
    writtenIn: "Escrito em",
    saveDraft: "Salvar como rascunho",
    save: "Salvar",
    published:
      "Esta versão está publicada. Salvar muda o texto publicado. Antes de uma mudança no texto publicado ser salva, você vai ver exatamente o que muda e confirmar. Nada é salvo sem isso.",
    otherPublished:
      "Outra versão deste diário está publicada. Uma mudança no texto publicado vai mostrar o que muda e perguntar antes.",
    opening: "Frase de abertura (opcional)",
    openingHint: "Uma linha que abre o diário, com as suas palavras.",
    reflection: "Sua reflexão",
    reflectionHint:
      "Uma linha em branco começa um novo parágrafo. O texto é guardado como texto simples.",
    albumRating: "Sua nota para o álbum",
    albumRatingHint:
      "Definida à parte. Nunca é calculada a partir das notas das faixas.",
    writtenInLanguage: (language: "en" | "pt-BR") =>
      `Escrito em ${language === "en" ? "inglês" : "português (Brasil)"}`,
    languageNote:
      "O idioma em que você escreve este diário. Ele fica registrado com o diário, e nada é traduzido para você.",
    createNote:
      "Um diário novo começa como um rascunho privado. Nada aqui é publicado.",
    editNote: "Salvar nunca muda quem pode ver este diário.",
  },
  rating: {
    none: "Sem nota",
    clear: "Limpar",
    stars: (halfSteps: number) =>
      `${ratingText("pt-BR", halfSteps)} ${halfSteps < 4 ? "estrela" : "estrelas"}`,
  },
  trackByTrack: {
    title: "Faixa a faixa",
    hint: "Escreva sobre as faixas que quiser. As vazias aparecem como “ainda não escrita”.",
    empty:
      "Este álbum ainda não tem faixas. Adicione-as no catálogo, e elas aparecem aqui.",
    trackLabel: (n: number) => `Faixa ${n}: `,
    archived: " · arquivada no catálogo",
    notInEdition: " · fora da edição de referência",
    states: {
      empty: "vazia",
      "still writing": "ainda escrevendo",
      written: "escrita",
    },
    visibility: {
      public: "pública",
      included: "incluída ao publicar",
      private: "privada",
    },
    edited: " · editada",
    unreadable:
      "Esta reflexão tem uma formatação que o editor simples não consegue mostrar sem perder, então não pode ser editada aqui. Ela está intacta.",
    textLabel: (title: string, language: string) =>
      `Sua reflexão sobre ${title}, em ${language}`,
    placeholder: "O que você percebeu nesta faixa…",
    alsoWritten: (languages: string) =>
      `Também escrita em ${languages}. Ela fica como está, e continua privada a menos que seja incluída ao publicar e que essa versão seja publicada.`,
    rating: "Nota desta faixa",
    favourite: "Marcar como favorita",
    favouriteHint: "Aparece como um pequeno círculo depois de publicada.",
    stillWriting: "Ainda escrevendo",
    stillWritingHint: "Aparece como “ainda escrevendo” até você desmarcar.",
    include: "Incluir ao publicar",
    includeHint:
      "Sozinho, não publica nada: passa a valer quando esta versão é publicada.",
    sentence: {
      nothingSaved: {
        lead: "Nada salvo ainda",
        rest: ". Quando você salvar, ela continua privada: só você vê.",
      },
      privateOnSave: {
        lead: "Privada",
        rest: ". Ao salvar, ela deixa de ser incluída ao publicar. Só você vê.",
      },
      private: {
        lead: "Privada",
        rest: ". Ela não é incluída ao publicar. Só você vê.",
      },
      includedOnSave: (language: string) => ({
        lead: "Incluída ao publicar, quando você salvar",
        rest: `. Isso sozinho não publica nada: a versão em ${language} do diário também precisa ser publicada.`,
      }),
      public: (language: string, note: string) => ({
        lead: "Pública",
        rest: `. Ela faz parte da versão em ${language} que está marcada como publicada nos seus registros. ${note}`,
      }),
      noText: (language: string) => ({
        lead: "Incluída ao publicar",
        rest: `, mas ainda não há texto em ${language}, então não há nada para publicar.`,
      }),
      notPublished: (language: string, status: string) => ({
        lead: "Incluída ao publicar, ainda não publicada",
        rest: `: a versão em ${language} deste diário não está publicada (ela é ${status}). Ela só é publicada junto com essa versão.`,
      }),
    },
  },
  review: {
    noRating: "sem nota",
    unsupported:
      "Este texto tem uma formatação que a visualização simples não consegue mostrar. Ele é público exatamente como está guardado.",
    nothing: "Nada.",
    nothingYet: "Nada ainda.",
    cleared: "Nada: isto foi apagado.",
    yes: "Sim",
    no: "Não",
    noSongsYet: "Nenhuma música ainda.",
    noSongs: "Nenhuma música.",
    places: {
      title: "Título",
      opening: "Frase de abertura",
      marginNote: "Nota na margem",
      body: "Sua reflexão",
      memory: "A memória",
      albumRating: "Sua nota para o álbum",
      trackText: "Reflexão sobre a faixa",
      trackRating: "Nota da faixa",
      favourite: "Marcada como favorita",
      stillWriting: "Com o rótulo “ainda escrevendo”",
      when: "Quando",
      music: "A música",
    },
  },
  publish: {
    statusDraft: "é um rascunho",
    statusPrivate: "é privada",
    statusPublished: "já está publicada",
    title: (language: string) => `Publicar a versão em ${language}?`,
    confirmLabel: (language: string) => `Publicar a versão em ${language}`,
    region: "O que será publicado",
    close: "Fechar",
    reviewAgain: "Revisar de novo",
    reading: "Lendo o que seria publicado…",
    changed:
      "O que seria publicado mudou desde que você olhou, ou esta revisão expirou. Nada foi publicado. Revise de novo para ver como está agora.",
    unreadable:
      "Parte deste texto tem uma formatação que a visualização simples não consegue mostrar, então você não consegue ler tudo aqui. Ele não pode ser publicado pelo estúdio até que possa.",
    everything: (language: string) =>
      `Isto é tudo o que será marcado como publicado na versão em ${language}. Nada é publicado até você apertar o botão abaixo. Nada do que você faz nesta revisão muda ou apaga algo: fechá-la deixa tudo como estava.`,
    statusNow: (status: string, note: string) =>
      `Agora esta versão ${status}. Publicar marca a versão como publicada nos seus registros. ${note}`,
    opening: "Frase de abertura",
    none: "Nenhuma.",
    reflection: "Sua reflexão",
    address: "O endereço",
    wasPublic: " (este endereço já foi público antes)",
    artistPages: (n: number) => `Páginas de artista que vão abrir (${n})`,
    noArtistAddress:
      "Sem endereço: outro artista tem o mesmo, então nenhuma das duas páginas é exibida.",
    withPhoto: (title: string, credit: string, license: string) =>
      `Com a foto ${title} (${credit}, ${license})`,
    withoutPhoto: "Sem foto",
    artistPagesHint:
      "Cada artista creditado neste álbum ganha uma página pública quando isto é publicado, se ainda não tiver uma. Para deixar um de fora, mude primeiro os créditos do álbum e revise de novo.",
    addressChanges: "Páginas de artista cujo endereço muda",
    addressChange: (name: string, from: string, to: string | null) =>
      `${name}: ${from} vira ${to ?? "sem endereço"}, porque um artista com o mesmo nome ganha uma página. O endereço antigo vai parar de funcionar.`,
    alreadyPublic: " (já pública por outra versão)",
    reflections: (language: string, n: number) =>
      `Reflexões de faixa que serão publicadas em ${language} (${n})`,
    noReflections:
      "Nenhuma reflexão de faixa está incluída. Publicar nunca muda quais faixas são incluídas; você faz isso em cada faixa.",
    favourite: "Marcada como favorita",
    rated: (stars: string) => `Nota: ${stars}`,
    stillWriting: "Com o rótulo “ainda escrevendo”",
    selectionHint:
      "Nada aqui muda quais reflexões são incluídas. Para mudar isso, feche esta revisão, mude na faixa e revise de novo.",
    changeSelection: "Mudar quais reflexões são incluídas, nas faixas",
    staysPrivate: "O que continua privado",
    allIncluded:
      "Todas as reflexões de faixa que você escreveu neste idioma estão incluídas ao publicar, ou você ainda não escreveu nenhuma.",
    notIncluded: (language: string, n: number, titles: string) =>
      `Reflexões de faixa que você escreveu em ${language} e que não estão incluídas ao publicar (${n}): ${titles}. Elas continuam privadas.`,
    flaggedWithoutText: (n: number, language: string) =>
      n === 1
        ? `1 faixa está incluída ao publicar, mas não tem texto em ${language}, então nada dela é público neste idioma.`
        : `${n} faixas estão incluídas ao publicar, mas não têm texto em ${language}, então nada delas é público neste idioma.`,
    othersStay:
      "As outras versões, os seus rascunhos e tudo o que está em Excluídos recentemente continuam como estão.",
  },
  visibility: {
    statusSet: (language: string, status: "draft" | "private") =>
      `${language}: ${status === "private" ? "agora privada." : "de volta a rascunho."}`,
    unpublished: (language: string, status: "draft" | "private") =>
      `A versão em ${language} não está mais publicada. Agora ela é ${status === "private" ? "privada" : "um rascunho"}. Nada foi excluído.`,
    published: (language: string, note: string) =>
      `A versão em ${language} agora está publicada no seu diário. ${note}`,
    heading: (language: string, isOriginal: boolean) =>
      `Visibilidade · ${language}${isOriginal ? " (original)" : ""}`,
    unpublish: "Despublicar…",
    publishedHint: (note: string) =>
      `Publicada quer dizer que esta versão está marcada como publicada nos seus registros. ${note}`,
    privateState: (language: string) =>
      `Situação privada da versão em ${language}`,
    publish: "Publicar…",
    privateHint:
      "Um rascunho ainda está sendo escrito; privado está pronto por enquanto. Os dois são só seus. Publicar… mostra exatamente o que será publicado antes de qualquer mudança.",
    remove: "Mover para Excluídos recentemente…",
    unpublishQuestion: (language: string) =>
      `Despublicar a versão em ${language}?`,
    unpublishConfirm: "Despublicar",
    unpublishBody:
      "Esta versão não vai mais estar marcada como publicada. Nada é excluído: o texto, as reflexões de faixa e o endereço continuam como estão, e as outras versões não são mexidas. Você pode publicá-la de novo depois; isso vai mostrar antes o que seria publicado.",
    after: "Depois de despublicar, ela fica",
    afterPrivate: "Privada (pronta por enquanto)",
    afterDraft: "Um rascunho (ainda sendo escrito)",
    removeQuestion: "Mover este diário para Excluídos recentemente?",
    removeConfirm: "Mover para Excluídos recentemente",
    removeBody:
      "Isto não apaga o texto. Ele fica no seu banco de dados, e nada o remove sozinho. O diário sai das suas listas e não pode ser editado enquanto estiver em Excluídos recentemente. Você pode restaurá-lo de lá; a exclusão definitiva ainda não existe. Álbuns, artistas e faixas continuam no seu catálogo.",
  },
  change: {
    title: "Atualizar o texto publicado?",
    confirmLabel: "Salvar e atualizar o texto publicado",
    region: "O que vai mudar no texto publicado",
    reading: "Lendo o que mudaria…",
    textKept: "Seu texto continua no editor.",
    unreadable:
      "Parte deste texto tem uma formatação que a visualização simples não consegue mostrar, então você não consegue ler tudo aqui. Ele não pode ser salvo pelo estúdio até que possa.",
    lead: (note: string) =>
      `Esta versão está publicada, então salvar muda o texto publicado. Aqui está exatamente o que muda. Nada é salvo até você apertar o botão abaixo, e cancelar deixa o seu texto no editor. Isto atualiza o que está marcado como publicado nos seus registros. ${note}`,
    added: "Adicionado",
    changed: "Alterado",
    publishedNow: "Publicado agora",
    publishedAfter: "Publicado depois de salvar",
    publishedAfterNew: "Publicado depois de salvar (novo)",
    removals: "O que você tira do texto publicado não precisa desta revisão.",
  },
  deleted: {
    title: "Excluídos recentemente",
    lead: "Diários e memórias que você moveu para cá não são apagados: o texto fica no banco de dados, e nada o remove sozinho. Restaurar traz de volta como estava. A exclusão definitiva ainda não existe.",
    hint: "Um diário que estava publicado quando foi excluído volta como privado. Restaurar nunca publica nada; publicá-lo de novo mostra primeiro tudo o que seria publicado, inclusive as reflexões de faixa que você tinha marcado para incluir ao publicar.",
    journals: "Diários",
    nothingHere: "Nada aqui",
    noJournal: "Nenhum diário está em Excluídos recentemente.",
    journalsLabel: "Diários excluídos recentemente",
    deletedOn: (date: string) => `excluído em ${date}`,
    version: (language: string, status: string, wasPublished: boolean) =>
      `${language}: ${status}${wasPublished ? ", volta como privada" : ""}`,
    memories: "Memórias",
    noMemory: "Nenhuma memória está em Excluídos recentemente.",
    memoriesLabel: "Memórias excluídas recentemente",
  },
  restoreMemory: {
    label: (title: string) => `Restaurar a memória “${title}”`,
    question: "Restaurar esta memória?",
    confirmLabel: "Restaurar memória",
    body: "A memória volta para as suas memórias com o texto e as músicas exatamente como você deixou.",
    wasPublished:
      "Ela estava publicada quando foi excluída, e volta como privada. Restaurar não publica nada.",
    stays: "Um rascunho continua rascunho, e o que é privado continua privado.",
  },
  memories: {
    title: "Memórias",
    lead: "Os momentos para onde as músicas levam você de volta. Uma memória pertence a quantas músicas você quiser, na ordem que escolher.",
    movedToDeleted:
      "A memória está em Excluídos recentemente. O texto está guardado, e você pode restaurá-la de lá.",
    emptyTitle: "Nenhuma memória ainda",
    emptyBody:
      "Anote um momento para onde uma música leva você de volta. Ela começa como um rascunho que só você vê, e só é salva quando você salva.",
    totalsLabel: "Totais de memórias",
    publishingNote: "Publicar memórias ainda não está disponível.",
    kind: "Memória",
    noSongs: "Nenhuma música ainda",
    andMore: (shown: string, more: number) => `${shown} e mais ${more}`,
    editLabel: (title: string) => `Editar a memória ${title}`,
  },
  recording: {
    song: "Música",
    on: (albums: string) => `em ${albums}`,
    archived: "arquivada no seu catálogo",
  },
  memory: {
    restoredPrivate:
      "Restaurada de Excluídos recentemente. Ela estava publicada quando foi excluída, e agora é privada. Restaurar não publica nada.",
    restored:
      "Restaurada de Excluídos recentemente, com o texto e as músicas exatamente como você deixou.",
    back: "← Memórias",
    unsupportedTitle: "Esta memória não pode ser editada aqui",
    unsupportedBody:
      "O texto tem uma formatação que o editor simples não consegue mostrar sem perder, então ele não foi mexido.",
    backToDeleted: "← Excluídos recentemente",
    inDeletedKind: "Memória, em Excluídos recentemente",
    deletedFacts: (wordCount: number, date: string) =>
      ` · ${counted("pt-BR", wordCount, "palavra", "palavras")} · excluída em ${date} (UTC)`,
    inDeleted: (date: string) =>
      `Esta memória está em Excluídos recentemente desde ${date}. O texto e as músicas estão guardados, e ela não pode ser alterada lá até você restaurá-la.`,
    wasPublished: " Ela estava publicada, e volta como privada.",
    music: "A música",
  },
  memoryEditor: {
    whenRemoved: "O “quando”",
    musicProblem:
      "Uma música aparece duas vezes, ou há músicas demais, então nada foi salvo.",
    newMemory: "Nova memória",
    writeTitle: "Escrever uma memória",
    editTitle: "Editar uma memória",
    published:
      "Esta memória está publicada. Salvar muda o que os leitores veem: antes de uma mudança ser salva, você vai ver exatamente o que muda, e a pergunta vem antes.",
    title: "Título",
    titlePlaceholder: "Um título para esta memória",
    when: "Quando",
    whenPlaceholder: "uma data, uma estação, um ano",
    whenHint: "Do jeito que você lembra. Não precisa ser exato.",
    body: "A memória",
    bodyPlaceholder: "Escreva o que você lembra…",
    artists: "Artistas, a partir da música",
    noArtists: "Nenhum ainda. Eles vêm das músicas que você adicionar.",
    languageHint:
      "O idioma em que você escreve esta memória. Ele fica registrado com a memória, e nada é traduzido para você.",
    languageFixed:
      "O idioma em que ela foi escrita. Nada é traduzido para você.",
    createNote:
      "Uma memória nova começa como um rascunho privado. Nada aqui é publicado.",
    removalQuestion: "Tirar isto da memória publicada?",
    removalConfirm: "Salvar e tirar",
    removalBody:
      "Esta memória está publicada. Salvar tira isto do que os leitores veem; nada mais muda, e nada é excluído do seu catálogo. Cancelar deixa o seu texto no editor.",
  },
  memoryMusic: {
    moved: (
      title: string,
      direction: "up" | "down",
      place: number,
      total: number,
    ) =>
      `${title} foi para ${direction === "up" ? "cima" : "baixo"}, para a posição ${place} de ${total}.`,
    removed: (title: string) =>
      `${title} saiu desta memória. Ela continua no seu catálogo.`,
    added: (title: string) => `${title} entrou nesta memória.`,
    empty:
      "Nenhuma música ainda. Adicione as músicas a que esta memória pertence; elas vêm do seu catálogo.",
    listLabel: "Músicas desta memória",
    moveUp: (title: string, n: number, total: number) =>
      `Mover ${title} para cima (música ${n} de ${total})`,
    moveDown: (title: string, n: number, total: number) =>
      `Mover ${title} para baixo (música ${n} de ${total})`,
    remove: (title: string, n: number, total: number) =>
      `Remover ${title} desta memória (música ${n} de ${total})`,
    album: "Álbum",
    readOnly:
      "Esta memória também pertence a um álbum, que este editor ainda não consegue mudar, então a música dela fica como está. O título e o texto ainda podem ser salvos.",
    addLabel: "Adicionar uma música do seu catálogo",
    addPlaceholder: "Adicionar uma música",
    resultsLabel: "Músicas do seu catálogo",
    inCatalog: "No seu catálogo",
    noMatch: (query: string) =>
      `Nenhuma música do seu catálogo corresponde a “${query}”.`,
    addTrack: "Adicionar uma faixa ao seu catálogo",
    add: (title: string, facts: string) =>
      `Adicionar ${title}, ${facts}, a esta memória`,
    removeHint:
      "Remover uma música desta memória nunca a exclui do seu catálogo.",
    firstFound: (n: number) =>
      `As primeiras ${n} músicas encontradas. Digite mais para filtrar.`,
    found: (n: number) =>
      n === 1 ? "1 música encontrada." : `${n} músicas encontradas.`,
  },
  memoryControls: {
    unpublished: (status: "draft" | "private") =>
      `Esta memória não está mais publicada. Agora ela é ${status === "private" ? "privada" : "um rascunho"}. Nada foi excluído.`,
    nowPrivate: "Agora privada.",
    backToDraft: "De volta a rascunho.",
    published: (note: string) => `Esta memória agora está publicada. ${note}`,
    visibility: "Visibilidade",
    states: {
      draft: "Rascunho. Inacabada e privada.",
      private: "Privada. Só você vê.",
      published:
        "Publicada. Salvar uma mudança que os leitores veriam mostra o que muda e pergunta antes.",
    },
    privateState: "Situação privada desta memória",
    saveFirst:
      "Salve as suas alterações primeiro: Publicar… mostra o que está salvo.",
    publishedHint: (note: string) =>
      `Salvar nunca muda quem pode vê-la. ${note}`,
    remove: "Excluir…",
    saveBeforeDelete:
      "Salve as suas alterações primeiro, ou elas se perderiam.",
    songsStay: "As músicas dela continuam no seu catálogo.",
    removeQuestion: "Excluir esta memória?",
    removeConfirm: "Excluir memória",
    removeBody: (title: string) =>
      `“${title}” vai para Excluídos recentemente. O texto fica guardado lá, e nada o remove sozinho: você pode restaurá-la quando quiser. As músicas dela continuam no seu catálogo.`,
    unpublishQuestion: "Despublicar esta memória?",
    unpublishBody:
      "Ela não vai mais estar publicada, então nenhum leitor pode vê-la. Nada é excluído: o texto, as músicas e o endereço continuam como estão. Você pode publicá-la de novo depois; isso vai mostrar antes o que seria publicado.",
  },
  memoryPublish: {
    linksToArtist: (name: string) => `${name} (com link para a página)`,
    onAlbum: (title: string, linksToJournal: boolean) =>
      `em ${title}${linksToJournal ? " (com link para o diário do álbum)" : ""}`,
    linksToJournal: "com link para o diário do álbum",
    title: "Publicar esta memória?",
    confirmLabel: "Publicar esta memória",
    everything: (language: string) =>
      `Isto é tudo o que será publicado desta memória, em ${language}. Nada é publicado até você apertar o botão abaixo. Nada do que você faz nesta revisão muda ou apaga algo: fechá-la deixa tudo como estava.`,
    statusNow: (status: string, note: string) =>
      `Agora esta memória ${status}. Publicar marca a memória como publicada nos seus registros. ${note}`,
    noWhen: "Nenhum. A página não mostra data para ela.",
    music: (n: number) => `A música (${n})`,
    noSongs: "Nenhuma música. A página não mostra nenhuma.",
    albumPrefix: "Álbum: ",
    musicHint:
      "Títulos de música, artistas e álbuns aparecem como o seu catálogo os nomeia. Publicar uma memória não abre nenhuma página de artista: um artista ou um diário de álbum só ganha link quando a página dele já é pública.",
    othersStay:
      "As suas outras memórias, os seus rascunhos, os seus diários de álbum e as reflexões de faixa deles, e tudo o que está em Excluídos recentemente continuam como estão.",
  },
  memoryChange: {
    title: "Atualizar a memória publicada?",
    confirmLabel: "Salvar e atualizar a memória publicada",
    region: "O que vai mudar na memória publicada",
    lead: (note: string) =>
      `Esta memória está publicada, então salvar muda o que os leitores veem. Aqui está exatamente o que muda. Nada é salvo até você apertar o botão abaixo, e cancelar deixa o seu texto no editor. Isto atualiza o que está marcado como publicado nos seus registros. ${note}`,
    takenAway: "Tirado da memória publicada",
  },
  desk: {
    title: "Mesa",
    lead: "Tudo o que você está escrevendo. Tudo aqui é privado.",
    nothingWritten: "Nada escrito ainda.",
    firstSteps: {
      addArtist: "Adicione um artista",
      addArtistRest: ", ou uma banda.",
      addAlbum: "Adicione um álbum",
      addAlbumRest: " que credite esse artista.",
      tracklist: "Monte a lista de faixas na página do álbum.",
      writeJournal: "Escreva um diário",
      writeJournalRest:
        " sobre ele. Ele começa como um rascunho que só você vê.",
      orBefore: "Ou ",
      writeMemory: "escreva uma memória",
      orAfter:
        " agora, e adicione as músicas quando elas estiverem no seu catálogo.",
    },
    startWith:
      "Comece por um álbum que você ama, ou por um momento para onde uma música leva você de volta. Tudo começa como um rascunho que só você vê.",
    writeJournal: "Escrever um diário",
    writeMemory: "Escrever uma memória",
    yourJournals: "Seus diários",
    journalsSummary: (
      total: number,
      draft: number,
      priv: number,
      published: number,
    ) =>
      `${counted("pt-BR", total, "diário", "diários")}: ${after(draft, "rascunho", "rascunhos")}, ${after(priv, "privado", "privados")}, ${after(published, "publicado", "publicados")}.`,
    journalsLabel: "Diários",
    albumJournal: "Diário de álbum",
    tracksWritten: (written: number, total: number) =>
      `${written} de ${counted("pt-BR", total, "faixa escrita", "faixas escritas")}`,
    editJournalAbout: (album: string) => `Editar o diário sobre ${album}`,
    allJournals: "Todos os diários",
    allJournalsCount: (n: number) => `Todos os ${n} diários`,
    yourMemories: "Suas memórias",
    memoriesSummary: (
      total: number,
      draft: number,
      priv: number,
      published: number,
    ) =>
      `${counted("pt-BR", total, "memória", "memórias")}: ${after(draft, "rascunho", "rascunhos")}, ${after(priv, "privada", "privadas")}${published > 0 ? `, ${after(published, "publicada", "publicadas")}` : ""}.`,
    memoriesLabel: "Memórias",
    allMemories: "Todas as memórias",
    allMemoriesCount: (n: number) => `Todas as ${n} memórias`,
    memories: "Memórias",
    recentlyDeleted: (n: number) => `Excluídos recentemente (${n})`,
    yourCatalog: "Seu catálogo: ",
    catalogComma: ", ",
    catalogAnd: " e ",
    catalogEnd: ". ",
    openCatalog: "Abrir o catálogo",
    catalogClose: ".",
  },
};
