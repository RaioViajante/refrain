import { awaitingApproval } from "@/i18n/authored";
import { counted } from "@/i18n/format";

import { en, type Dictionary } from "./en";

// The public interface in Brazilian Portuguese (ADR 0008 § 4). The approved
// V4.4 screens are the glossary. Typed as the English dictionary, so a
// missing or an extra key fails the type check. The sentences the author
// wrote or chose about the journal keep their English text, marked as
// English, until the owner approves a Portuguese one (`awaitingApproval`);
// nothing else may stay in English.

export const ptBR: Dictionary = {
  site: {
    name: "refrain",
    description: "Um diário pessoal de música.",
  },
  frame: {
    skipLink: "Pular para o conteúdo",
    navigationLabel: "Principal",
    sections: {
      home: "Início",
      albums: "Álbuns",
      artists: "Artistas",
      memories: "Memórias",
    },
    closingLine: "algumas músicas levam a gente de volta.",
    keepReading: "Continue lendo",
  },
  languageSelector: {
    label: "Idioma",
    note: "Muda só a interface. O que foi escrito fica no idioma original.",
  },
  writingLanguages: {
    en: "inglês",
    "pt-BR": "português",
  },
  writtenIn: (language: string) => `Escrito em ${language}`,
  rating: {
    label: "Minha nota",
    accessible: (value: string) => `Minha nota: ${value} de 5`,
  },
  loading: "Carregando…",
  home: {
    introduction: awaitingApproval(en.home.introduction),
    characterAlt:
      "Desenho a nanquim de uma pessoa de cabelo cacheado e fones de ouvido, sentada de pernas cruzadas no chão, escrevendo num caderno e olhando para cima, ao lado de uma pilha de discos, uma caneca, uma fita cassete e algumas folhas amassadas.",
    nothingPublished: "Nada publicado ainda.",
    mostRecent: "Mais recente:",
    memory: "Memória",
    albumJournal: "Diário de álbum",
    memoryWith: (song: string) => `Memória · ${song}`,
    albumJournalBy: (credit: string) => `Diário de álbum · ${credit}`,
    recentlyWritten: "Escrito recentemente",
    albums: "Álbuns",
    allAlbumJournals: "Todos os diários de álbum",
    artists: "Artistas",
    allArtists: "Todos os artistas",
    memories: "Memórias",
    allMemories: "Todas as memórias",
    noArtwork: "ainda sem capa",
    unavailable: "Não foi possível carregar os textos mais recentes agora.",
  },
  lists: {
    music: "Música: ",
    andMore: (count: number) => `e mais ${count}`,
    albums: (count: number) => counted("pt-BR", count, "álbum", "álbuns"),
    journals: (count: number) => counted("pt-BR", count, "diário", "diários"),
  },
  archives: {
    albums: {
      title: "Álbuns",
      lead: {
        text: "Discos inteiros, escritos devagar. Alguns têm todas as faixas, outros só algumas.",
        lang: "pt-BR",
      },
    },
    artists: {
      title: "Artistas",
      lead: awaitingApproval(en.archives.artists.lead),
    },
    memories: {
      title: "Memórias",
      lead: awaitingApproval(en.archives.memories.lead),
    },
    nothingPublished: "Nada publicado ainda.",
    unavailable: "Não foi possível carregar esta lista agora.",
    tracksWritten: (written: number, total: number) =>
      `${written} de ${total} faixas escritas`,
    anotherJournal: "Outro diário, publicado em",
    aboutAlbum: (title: string) => ` (sobre ${title})`,
    memoryPublished: "Publicada em",
  },
  albumJournal: {
    kind: "Diário de álbum",
    description: "Um diário de álbum.",
    published: "Publicado em",
    goToTracks: "Ir para as faixas",
    artworkFor: (title: string) => `Capa do álbum ${title}`,
    artworkMissingFor: (title: string) =>
      `Capa do álbum ${title}: ainda não disponível`,
    artwork: "Capa do álbum",
    artworkFromArchive: "vem do Cover Art Archive",
    artworkNotYet: "ainda não disponível",
    artworkCaption: "Capa: Cover Art Archive",
    tracks: (count: number) => counted("pt-BR", count, "faixa", "faixas"),
    trackByTrack: "Faixa a faixa",
    trackByTrackHint:
      "Abra uma faixa para ler o que escrevi. Nem toda faixa tem reflexão.",
    favourite: "Favorita: ",
    stillWriting: " (ainda escrevendo)",
    by: (credit: string) => `de ${credit}`,
    track: (number: number) => `Faixa ${number}: `,
    notWrittenYet: "ainda não escrita",
    allAlbums: "Todos os álbuns",
    moreAbout: (name: string) => `Mais sobre ${name}`,
  },
  artist: {
    kind: "Artista",
    description: (name: string) =>
      `Diários de álbum sobre a música de ${name}.`,
    inThisJournal: "Neste diário",
    albumJournals: "Diários de álbum",
    tracksWrittenAbout: "Faixas sobre as quais escrevi",
    trackShare: (written: number, total: number) =>
      `${written} / ${total} faixas`,
    trackShareSpoken: (written: number, total: number) =>
      `${written} de ${total} faixas com texto`,
    inAlbum: (title: string) => `em ${title}`,
    allArtists: "Todos os artistas",
  },
  photo: {
    of: (name: string) => `Foto de ${name}`,
    unavailableNowOf: (name: string) =>
      `Foto de ${name}: indisponível no momento`,
    noneOf: (name: string) => `Ainda sem foto de ${name}`,
    frame: "Foto do artista",
    notYet: "ainda não disponível",
    unavailableNow: "indisponível no momento",
    fromCommons: "do Wikimedia Commons",
    captionPrefix: "Foto: ",
    licenseAsMarked: (name: string) =>
      `${name} (como indicado no Wikimedia Commons)`,
    viaCommons: " · via Wikimedia Commons",
    details: "Detalhes da foto",
    work: "Foto",
    credit: "Crédito",
    source: "Fonte",
    commons: "Wikimedia Commons",
    license: "Licença",
    shareAlike: "Adaptações devem usar a mesma licença.",
    changes: "Alterações",
    standardChanges:
      "Redimensionada e recortada para caber no quadro. Nenhuma outra alteração.",
  },
  memory: {
    kind: "Memória",
    description: "Uma memória em um diário pessoal de música.",
    about: "Sobre esta memória",
    published: "Publicada em",
    music: "A música",
    album: "Álbum",
    allMemories: "Todas as memórias",
  },
  notFound: {
    title: "Nada aqui",
    body: "Esta página não está disponível.",
    back: "Voltar ao início",
    pageTitle: "Não encontrada",
    drawingAlt:
      "Desenho a nanquim de uma pessoa de cabelo cacheado e fones de ouvido, coçando a cabeça diante de um mapa marcado 404.",
  },
};
