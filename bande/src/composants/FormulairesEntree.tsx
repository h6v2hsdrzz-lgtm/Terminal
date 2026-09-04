"use client";

import { useActionState } from "react";

import { BoutonPrincipal, Champ, MessageErreur, styleChamp, styleChampCode } from "./Champ";
import { actionCreerBande, actionRejoindre, actionReprendre } from "@/lib/actions";
import { ETAT_INITIAL } from "@/lib/formulaire";

/**
 * Les trois formulaires d'entrée.
 *
 * Ils partagent la même mécanique : une action serveur branchée sur
 * `useActionState`, qui renvoie un message plutôt que de lever. Une erreur ici
 * — un code inconnu, un pseudo déjà pris — n'est pas une panne, c'est une
 * réponse : elle s'affiche dans le formulaire, sans le vider.
 */

export function FormulaireCreer() {
  const [etat, envoyer, enCours] = useActionState(actionCreerBande, ETAT_INITIAL);

  return (
    <form action={envoyer} className="space-y-5">
      <Champ id="bande" libelle="Le nom de la bande" aide="Ça se change plus tard.">
        <input
          id="bande"
          name="bande"
          required
          maxLength={40}
          autoComplete="off"
          placeholder="Les Trois Fromages"
          className={styleChamp}
        />
      </Champ>

      <Champ id="pseudo" libelle="Et toi, c'est comment ?">
        <input
          id="pseudo"
          name="pseudo"
          required
          maxLength={24}
          autoComplete="nickname"
          placeholder="Momo"
          className={styleChamp}
        />
      </Champ>

      {etat.erreur && <MessageErreur>{etat.erreur}</MessageErreur>}
      <BoutonPrincipal enCours={enCours}>Créer la bande</BoutonPrincipal>
    </form>
  );
}

export function FormulaireRejoindre() {
  const [etat, envoyer, enCours] = useActionState(actionRejoindre, ETAT_INITIAL);

  return (
    <form action={envoyer} className="space-y-5">
      <Champ id="invitation" libelle="Le code de la bande">
        <input
          id="invitation"
          name="invitation"
          required
          maxLength={12}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="ABC234"
          className={styleChampCode}
        />
      </Champ>

      <Champ id="pseudo" libelle="Et toi, c'est comment ?">
        <input
          id="pseudo"
          name="pseudo"
          required
          maxLength={24}
          autoComplete="nickname"
          placeholder="Sam"
          className={styleChamp}
        />
      </Champ>

      {etat.erreur && <MessageErreur>{etat.erreur}</MessageErreur>}
      <BoutonPrincipal enCours={enCours}>Rejoindre</BoutonPrincipal>
    </form>
  );
}

export function FormulaireReprendre() {
  const [etat, envoyer, enCours] = useActionState(actionReprendre, ETAT_INITIAL);

  return (
    <form action={envoyer} className="space-y-5">
      <Champ id="reprise" libelle="Ton code de reprise">
        <input
          id="reprise"
          name="reprise"
          required
          maxLength={20}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="ABCD-EFGH-JKLM"
          className={styleChampCode}
        />
      </Champ>

      {etat.erreur && <MessageErreur>{etat.erreur}</MessageErreur>}
      <BoutonPrincipal enCours={enCours}>Me reconnecter</BoutonPrincipal>
    </form>
  );
}
