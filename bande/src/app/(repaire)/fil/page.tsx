import { redirect } from "next/navigation";

/**
 * Le fil a déménagé à la racine : c'est la première chose qu'on voit en
 * ouvrant l'application.
 *
 * Cette redirection reste parce que l'ancienne adresse est dans des raccourcis
 * d'écran d'accueil et dans l'historique des navigateurs. Elle ne coûte rien.
 */
export default function Page() {
  redirect("/");
}
