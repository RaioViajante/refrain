# Product

**Status:** approved product definition. Nothing described here is implemented yet; see [Roadmap](roadmap.md) for sequencing.

## Purpose

Refrain is a single-author personal music journal. It keeps the author's relationship with music in writing: memories tied to songs, reflections on artists, and journals about whole albums and their individual tracks. Writing is private by default; selected entries are published for anyone to read.

Refrain is not a streaming platform, social network, collaborative service, review aggregator, or multi-user SaaS.

## People

| Role | Count | Can do |
| --- | --- | --- |
| Author (administrator) | Exactly one | Everything in the Writing Studio |
| Reader (public visitor) | Anyone | Read published entries; switch the interface language |

Readers have no accounts, comments, reactions, or follower relationships. There is no public sign-up.

## Two experiences

**Public journal.** Home, album journals, artist journals, and memories, plus a listing for each. Only published entries appear. The design for these pages is in `reference/refrain/pages/refrainV44-{Home,Albums,Grace,Artists,Artist,Memories,Memory}.dc.html`.

**Writing Studio.** The author's private workspace:

- **Desk:** all entries, filterable by Draft, Private, and Published, with search and a Recently deleted area.
- **Editors:** one each for album journals, artist journals, and memories.
- **Catalog:** albums, artists, and tracks, plus *Add music*, which searches MusicBrainz.
- **States:** confirmation dialogs, empty, loading, and error states, and preview.

The designs are in `refrainV44-{Desk,AlbumEditor,ArtistEditor,MemoryEditor,Catalog,Search,States}.dc.html`.

## Content

### Music catalog

The catalog holds albums, artists, and tracks: factual metadata that writing points to. Records are added from MusicBrainz or entered manually. Album artwork may come from the Cover Art Archive and artist photographs from Wikimedia Commons, but only freely licensed photos, and always with a credit. Adding a record to the catalog never publishes anything.

### Album journal

Writing about one album:

- an **opening sentence** shown beside the cover;
- an essay **about the whole album**;
- an optional **margin note**;
- an optional **album rating**.

Under **Track by track**, every track on the album can have its own reflection, an optional **track rating**, a **favourite** mark (shown as a hand-drawn circle), and a **still writing** flag. On the public page, tracks without a reflection show as "not written yet".

### Artist journal

Writing about a musician or band: an opening sentence, an essay, and an optional credited photo. The page also lists related writing automatically: album journals for the artist's albums, tracks the author wrote about, and memories that include the artist's music. These links are derived from other entries and are not edited here.

### Memory

A titled piece of writing, an optional free-text **when** ("a date, a season, a year"), and an ordered list of the songs and albums it belongs to. The artists are derived from that music.

## Rules

1. **Visibility.** Every entry is in exactly one state:
   - **Draft**: unfinished and private.
   - **Private**: finished, visible only to the author.
   - **Published**: readable by anyone with the link.

   New entries start as drafts. Publishing and unpublishing always ask for confirmation, and unpublishing never deletes anything.
2. **Saving is not publishing.** Saving never changes visibility.
3. **Ratings are optional and independent.** Ratings use half steps from 0.5 to 5, and the default is "No rating". The album rating is never calculated from track ratings.
4. **Annotations are data.** A favourite circle, a "still writing" label, or a margin note appears only when the author recorded it.
5. **Writing is never collateral damage.** Removing a catalog record keeps all writing. Links to the removed record become plain text and can be linked again later. Removing a song from a memory never deletes the song.
6. **Deletion is recoverable.** A deleted entry moves to Recently deleted for 30 days and can be restored. After 30 days, or after an explicit second confirmation, it is gone.
7. **Language belongs to the writing.** Each entry records the language it was written in (English or Brazilian Portuguese). The author may write a translation into the other language, and readers see it with a link to the original. Nothing is machine-translated. Switching the interface language changes interface text only.
8. **External sources are optional.** If MusicBrainz or an artwork source is unavailable, the catalog and all writing continue to work.
9. **Preview is private.** Previewing a draft or private entry shows the public layout to the author only.

## Explicit exclusions

Public accounts, comments, likes, followers, feeds of other users, collaborative editing, audio playback or streaming, recommendations, billing, multiple authors, multi-tenancy, and machine translation. Proposals that add any of these require an ADR and the author's approval.

## Sample subject

The first end-to-end album journal is planned to be **Grace** (Jeff Buckley, 1994). Its catalog metadata is public. The author's writing and ratings about it are personal and must never be invented: the mockups mark these with brackets, such as `[Your opening sentence.]`.

## Related

- [Requirements](requirements.md): academic acceptance criteria
- [Data Model](data-model.md): how these rules map to tables and constraints
- [Design System](design-system.md): how these rules appear in the interface
