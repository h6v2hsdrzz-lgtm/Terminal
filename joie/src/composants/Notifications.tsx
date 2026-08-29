"use client";

import { CheckCircle2, TriangleAlert, X } from "lucide-react";

import { useJournal } from "./FournisseurJournal";

/** Retours d'action, en bas de l'écran sur téléphone, en haut à droite ailleurs. */
export function Notifications() {
  const { messages, fermerMessage } = useJournal();

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-3 bottom-3 z-50 flex flex-col items-center gap-2 sm:inset-x-auto sm:right-4 sm:top-4 sm:items-end"
    >
      {messages.map((message) => (
        <div
          key={message.id}
          className="pointer-events-auto flex w-full max-w-sm items-start gap-2 rounded-xl border border-bordure bg-surface px-3 py-2.5 shadow-[var(--ombre)]"
        >
          <span className={message.ton === "succes" ? "text-vert" : "text-rouge"}>
            {message.ton === "succes" ? <CheckCircle2 size={16} /> : <TriangleAlert size={16} />}
          </span>
          <p className="flex-1 text-sm">{message.texte}</p>
          <button
            type="button"
            onClick={() => fermerMessage(message.id)}
            aria-label="Fermer"
            className="text-faible transition hover:text-texte"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
