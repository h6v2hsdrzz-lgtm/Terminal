/**
 * Les écrans d'entrée : pas de barre d'onglets, rien à naviguer. On arrive,
 * on répond à deux questions, on est dans la bande.
 */
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-10 zone-sure-haute zone-sure-basse">
      {children}
    </div>
  );
}
