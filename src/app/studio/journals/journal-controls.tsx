"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import {
  ConfirmDialog,
  SelectField,
  useSubmission,
} from "@/app/studio/form-kit";
import {
  deleteJournalAction,
  setJournalPrivacyAction,
} from "@/app/studio/journals/actions";
import { PublishDialog } from "@/app/studio/journals/publish-dialog";
import { failureMessage } from "@/app/studio/messages";
import { StatusMark } from "@/app/studio/status-mark";
import { useStudio } from "@/app/studio/studio-locale";
import type { VisibilityStatus } from "@/modules/journals";

type PrivateStatus = "draft" | "private";
type Language = "en" | "pt-BR";

interface VersionState {
  locale: Language;
  isOriginal: boolean;
  status: VisibilityStatus;
}

/**
 * Who can see each language version, and moving the journal to Recently
 * deleted. Each version has its own panel: Publish… shows the author what
 * readers would see and publishes only on their confirmation; Unpublish…
 * asks first, removes the version from publication, and deletes nothing. A
 * version never changes another version's state. Deleting asks first, and
 * keeps the writing.
 */
export function JournalControls({
  entryId,
  versions,
}: {
  entryId: string;
  versions: VersionState[];
}) {
  const router = useRouter();
  const { locale: ui, words: t, href } = useStudio();
  const w = t.visibility;
  const names = t.languageInSentence;
  const { pending, failure, run, clearFailure } = useSubmission();
  const [asking, setAsking] = useState<
    | { kind: "unpublish"; locale: Language }
    | { kind: "publish"; locale: Language }
    | { kind: "delete" }
    | undefined
  >();
  const [after, setAfter] = useState<PrivateStatus>("private");
  const [message, setMessage] = useState("");

  // The status each version showed when the page was drawn. The server
  // applies a change only if the version still has it, so a stale tab fails
  // with a clear message instead of undoing what another tab did.
  function shown(locale: Language): VisibilityStatus {
    return versions.find((v) => v.locale === locale)?.status ?? "draft";
  }

  async function setStatus(locale: Language, next: PrivateStatus) {
    setMessage("");
    const result = await run(() =>
      setJournalPrivacyAction({
        entryId,
        locale,
        status: next,
        expectedStatus: shown(locale),
      }),
    );
    setAsking(undefined);
    if (!result.ok && result.code === "status_changed") {
      // Show how it really stands now.
      router.refresh();
    }
    if (result.ok) {
      setMessage(w.statusSet(names[locale], next));
      router.refresh();
    }
  }

  async function unpublish(locale: Language) {
    setMessage("");
    const result = await run(() =>
      setJournalPrivacyAction({
        entryId,
        locale,
        status: after,
        expectedStatus: shown(locale),
      }),
    );
    setAsking(undefined);
    if (!result.ok && result.code === "status_changed") {
      router.refresh();
    }
    if (result.ok) {
      setMessage(w.unpublished(names[locale], after));
      router.refresh();
    }
  }

  // After a publication or an unpublication the control that opened the dialog
  // is replaced when the page refreshes, so focus goes to the heading of the
  // version whose state changed, once the new state has arrived.
  const seen = useRef(
    Object.fromEntries(versions.map((v) => [v.locale, v.status])),
  );
  useEffect(() => {
    for (const version of versions) {
      if (seen.current[version.locale] !== version.status) {
        document.getElementById(`visibility-${version.locale}`)?.focus();
      }
      seen.current[version.locale] = version.status;
    }
  }, [versions]);

  function published(locale: Language | undefined) {
    setAsking(undefined);
    if (locale) {
      setMessage(w.published(names[locale], t.publicPageNote));
    }
    router.refresh();
  }

  async function remove() {
    const result = await run(() => deleteJournalAction(entryId));
    setAsking(undefined);
    if (result.ok) {
      router.push(href("/studio/journals"));
    }
  }

  const unpublishing = asking?.kind === "unpublish" ? asking.locale : undefined;
  const publishing = asking?.kind === "publish" ? asking.locale : undefined;

  return (
    <div className="space-y-5">
      {versions.map((version) => {
        const name = names[version.locale];
        const heading = w.heading(name, version.isOriginal);
        return (
          <section
            key={version.locale}
            aria-labelledby={`visibility-${version.locale}`}
            className="space-y-2"
          >
            <p
              className="studio-label"
              id={`visibility-${version.locale}`}
              tabIndex={-1}
            >
              {heading}
            </p>
            <p className="studio-meta">
              <StatusMark locale={ui} status={version.status} />
            </p>
            {version.status === "published" ? (
              <>
                <div className="studio-actions">
                  <button
                    type="button"
                    className="studio-button"
                    disabled={pending}
                    onClick={() => {
                      clearFailure();
                      setMessage("");
                      setAfter("private");
                      setAsking({ kind: "unpublish", locale: version.locale });
                    }}
                  >
                    {w.unpublish}
                  </button>
                </div>
                <p className="studio-hint" style={{ maxWidth: "52ch" }}>
                  {w.publishedHint(t.publicPageNote)}
                </p>
              </>
            ) : (
              <>
                <div
                  className="studio-actions"
                  role="group"
                  aria-label={w.privateState(name)}
                >
                  <button
                    type="button"
                    className={`studio-button ${version.status === "draft" ? "studio-button-primary" : ""}`}
                    aria-pressed={version.status === "draft"}
                    disabled={pending}
                    onClick={() => {
                      clearFailure();
                      void setStatus(version.locale, "draft");
                    }}
                  >
                    {t.status.draft}
                  </button>
                  <button
                    type="button"
                    className={`studio-button ${version.status === "private" ? "studio-button-primary" : ""}`}
                    aria-pressed={version.status === "private"}
                    disabled={pending}
                    onClick={() => {
                      clearFailure();
                      void setStatus(version.locale, "private");
                    }}
                  >
                    {t.status.private}
                  </button>
                  <button
                    type="button"
                    className="studio-button"
                    disabled={pending}
                    onClick={() => {
                      clearFailure();
                      setMessage("");
                      setAsking({ kind: "publish", locale: version.locale });
                    }}
                  >
                    {w.publish}
                  </button>
                </div>
                <p className="studio-hint" style={{ maxWidth: "52ch" }}>
                  {w.privateHint}
                </p>
              </>
            )}
          </section>
        );
      })}

      <div>
        <button
          type="button"
          className="studio-button"
          disabled={pending}
          onClick={() => {
            clearFailure();
            setAsking({ kind: "delete" });
          }}
        >
          <svg
            aria-hidden
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            style={{ display: "inline", marginRight: 8, verticalAlign: "-2px" }}
          >
            <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5M7 7v4M9 7v4" />
          </svg>
          {w.remove}
        </button>
      </div>

      <p
        role={failure ? "alert" : "status"}
        className={failure ? "studio-problem" : "studio-hint"}
        style={{ maxWidth: "62ch" }}
      >
        {failure ? failureMessage(t, failure) : message}
      </p>

      <PublishDialog
        entryId={entryId}
        locale={publishing ?? versions[0]?.locale ?? "en"}
        open={publishing !== undefined}
        onClose={() => setAsking(undefined)}
        onPublished={() => published(publishing)}
      />

      <ConfirmDialog
        open={unpublishing !== undefined}
        title={w.unpublishQuestion(unpublishing ? names[unpublishing] : "")}
        confirmLabel={w.unpublishConfirm}
        pending={pending}
        onConfirm={() => unpublishing && unpublish(unpublishing)}
        onCancel={() => setAsking(undefined)}
      >
        <div className="space-y-3">
          <p>{w.unpublishBody}</p>
          <SelectField
            label={w.after}
            value={after}
            onChange={(value) => setAfter(value as PrivateStatus)}
            options={[
              { value: "private", label: w.afterPrivate },
              { value: "draft", label: w.afterDraft },
            ]}
          />
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={asking?.kind === "delete"}
        title={w.removeQuestion}
        confirmLabel={w.removeConfirm}
        pending={pending}
        onConfirm={remove}
        onCancel={() => setAsking(undefined)}
      >
        <p>{w.removeBody}</p>
      </ConfirmDialog>
    </div>
  );
}
