import { afterEach, describe, expect, it, vi } from "vitest";

import {
  lireReseau,
  oublierPanne,
  sAbonnerReseau,
  sansSilence,
  signalerPanne,
  signalerReseau,
} from "./reseau";

/** Remettre le magasin à zéro entre deux tests : il vit à l'échelle du module. */
afterEach(() => {
  oublierPanne();
  signalerReseau(true);
  vi.useRealTimers();
});

describe("l'état du réseau", () => {
  it("ne fabrique un instantané neuf que lorsque quelque chose change", () => {
    const avant = lireReseau();
    expect(lireReseau()).toBe(avant);

    // Deux « toujours en ligne » de suite ne doivent rien remuer : un
    // instantané neuf à chaque sondage ferait boucler le rendu.
    signalerReseau(true);
    expect(lireReseau()).toBe(avant);

    signalerReseau(false);
    expect(lireReseau()).not.toBe(avant);
    expect(lireReseau().horsLigne).toBe(true);
  });

  it("prévient ses abonnés, et seulement quand il le faut", () => {
    const vu = vi.fn();
    const oublier = sAbonnerReseau(vu);

    signalerReseau(false);
    signalerReseau(false);
    expect(vu).toHaveBeenCalledTimes(1);

    signalerReseau(true);
    expect(vu).toHaveBeenCalledTimes(2);

    oublier();
    signalerReseau(false);
    expect(vu).toHaveBeenCalledTimes(2);
    signalerReseau(true);
  });

  it("annonce le retour trois secondes, puis se tait", () => {
    vi.useFakeTimers();
    signalerReseau(false);
    signalerReseau(true);
    expect(lireReseau()).toMatchObject({ horsLigne: false, deRetour: true });

    vi.advanceTimersByTime(3000);
    expect(lireReseau().deRetour).toBe(false);
  });
});

describe("sansSilence", () => {
  it("laisse passer ce qui marche, sans rien afficher", async () => {
    signalerPanne("une vieille panne");
    const ok = await sansSilence(async () => ({ erreur: null }), "Le cœur");
    expect(ok).toBe(true);
    // Et il efface la panne d'avant : un message qui survit à sa cause est un
    // mensonge affiché.
    expect(lireReseau().panne).toBeNull();
  });

  it("montre le message du serveur quand il y en a un", async () => {
    const ok = await sansSilence(async () => ({ erreur: "Ta session a expiré." }), "Le cœur");
    expect(ok).toBe(false);
    expect(lireReseau().panne?.message).toBe("Ta session a expiré.");
  });

  it("dit que c'est le réseau quand il n'y a pas de réponse du tout", async () => {
    const ok = await sansSilence(async () => {
      throw new Error("fetch failed");
    }, "Le retrait");
    expect(ok).toBe(false);
    expect(lireReseau().panne?.message).toMatch(/^Le retrait n'a pas pu partir/);
  });

  it("garde de quoi refaire exactement ce qui a raté", async () => {
    let essais = 0;
    const travail = async () => {
      essais += 1;
      return { erreur: essais === 1 ? "Trop de monde." : null };
    };

    await sansSilence(travail, "Le cœur");
    expect(lireReseau().panne).not.toBeNull();

    // Le bouton « Réessayer » du bandeau, c'est ça.
    lireReseau().panne?.reessayer?.();
    await vi.waitFor(() => expect(lireReseau().panne).toBeNull());
    expect(essais).toBe(2);
  });
});
