# Product

**Status:** the product definition is approved. Nothing described here is implemented yet; see [Roadmap](roadmap.md) for sequencing. Rules marked **(ADR 0002)** come from the domain decisions in [ADR 0002](decisions/0002-domain-model-decisions.md), which is **Proposed** and awaits the owner's approval.

## Purpose

Refrain is a single-author personal music journal. It keeps the author's relationship with music in writing: memories tied to songs, reflections on artists, and journals about whole albums and their individual tracks. Writing is private by default; selected writing is published for anyone to read.

Refrain is not a streaming platform, social network, collaborative service, review aggregator, or multi-user SaaS.

## People

| Role | Count | Can do |
| --- | --- | --- |
| Author (administrator) | Exactly one | Everything in the Writing Studio |
| Reader (public visitor) | Anyone | Read published writing; switch the interface language |

Readers have no accounts, comments, reactions, or follower relationships. There is no public sign-up.

## Two experiences

**Public journal.** Home, album journals, artist journals, memories, and a listing for each. Only published writing appears. Designs: `reference/refrain/pages/refrainV44-{Home,Albums,Grace,Artists,Artist,Memories,Memory}.dc.html`.

**Writing Studio.** The author's private workspace:

- the Desk: all entries, filterable by Draft, Private, and Published, with search and a Recently deleted area;
- an editor for each kind of entry (album journal, artist journal, memory);
- the Catalog of albums, artists, and tracks, with *Add music* (MusicBrainz search);
- confirmations, empty, loading, and error states, and preview.

Designs: `refrainV44-{Desk,AlbumEditor,ArtistEditor,MemoryEditor,Catalog,Search,States}.dc.html`.

## Content

### Music catalog

Albums, artists, and tracks: factual metadata that writing points to. An **album** is the musical work itself, not a particular pressing. Its **reference edition** defines the track order. Other editions can be added later without affecting any writing **(ADR 0002)**.

Records are added from MusicBrainz or entered manually. Album artwork may come from the Cover Art Archive. Artist photographs may come from Wikimedia Commons, but only freely licensed ones, and always with a credit. Adding to the catalog never publishes anything.

### Album journal

Writing about one album:

- an **opening sentence** shown beside the cover;
- an essay about the whole album;
- an optional **margin note**;
- an optional **album rating**.

Under **Track by track**, each track can have its own reflection, an optional **track rating**, a **favourite** mark (a hand-drawn circle), and a **still writing** flag. On the public page, a track with nothing published shows as "not written yet".

An album can have **several journals written over time**. One of them can be **featured** as the album's public presentation **(ADR 0002)**.

### Artist journal

Writing about a musician or band: an opening sentence, an essay, and an optional credited photo. The page also lists related writing automatically: album journals for the artist's albums, tracks the author wrote about, and memories that include their music. An artist can have several journals, and one can be featured **(ADR 0002)**.

### Memory

A titled piece of writing, an optional free-text **when** ("a date, a season, a year"), and an ordered list of the songs and albums it belongs to. The artists are derived from that music.

## Rules

1. **Visibility.** Each language version of an entry is in exactly one state:
   - **Draft:** unfinished and private.
   - **Private:** finished, visible only to the author.
   - **Published:** readable by anyone with the link.

   New writing starts as a draft. Publishing and unpublishing always ask for confirmation, and unpublishing never deletes anything. **(ADR 0002: visibility is per language version.)**
2. **Saving is not publishing.** Saving never changes visibility.
3. **Track reflections are published individually.** A track reflection appears publicly only when the author explicitly publishes it, and only while its album journal is published. "Still writing" describes progress only: it neither publishes nor hides a reflection. **(ADR 0002)**
4. **Ratings and favourites are optional and independent.** Ratings use half steps from 0.5 to 5, defaulting to "No rating". The album rating is never calculated from track ratings. A favourite mark is independent of any rating.
5. **Annotations are data.** A favourite circle, a "still writing" label, or a margin note appears only when the author recorded it.
6. **Writing is never collateral damage.** A catalog record that writing refers to is archived, not deleted. Links to it become plain text, and re-adding the record restores them. Removing a song from a memory never deletes the song. **(ADR 0002)**
7. **Deletion is recoverable.** A deleted entry moves to Recently deleted and can be restored for at least 30 days. Permanent deletion happens only when the author explicitly confirms "Delete now". Automatic permanent deletion stays off until backups and recovery have been tested. **(ADR 0002)**
8. **Language belongs to the writing.** Each entry has an original language (English or Brazilian Portuguese). The author may write a translation into the other language, and it has its own visibility; readers see it with a link to the original. Nothing is ever machine-translated. Switching the interface language changes interface text only. **(ADR 0002)**
9. **Stable public addresses.** A published entry keeps its URL. Changing it is a deliberate action, and the old address redirects to the new one. **(ADR 0002)**
10. **External sources are optional.** If MusicBrainz or an artwork source is unavailable, the catalog and all writing continue to work.
11. **Preview is private.** Previewing unpublished writing shows the public layout to the author only.

## Explicit exclusions

Public accounts, comments, likes, followers, feeds of other users, collaborative editing, audio playback or streaming, recommendations, billing, multiple authors, multi-tenancy, machine translation, and a full editions-management feature. Adding any of these requires an ADR and the author's approval.

## Sample subject

The first end-to-end album journal is planned to be **Grace** (Jeff Buckley, 1994). Its catalog metadata is public. The author's writing and ratings are personal and must never be invented; the mockups mark them with brackets, such as `[Your opening sentence.]`.

## Related

- [Requirements](requirements.md): academic acceptance criteria
- [Data Model](data-model.md): how these rules map to tables and constraints
- [Design System](design-system.md): how these rules appear in the interface
