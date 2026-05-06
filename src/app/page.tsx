import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { LoginButton } from "@/components/LoginButton";

export default async function Home() {
  const user = await getCurrentUser();
  if (user) redirect("/dashboard");
  return (
    <main className="flex-1 flex flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-4xl font-bold">Zentrix</h1>
      <p className="text-sm opacity-70">Pool-based wagering on Solana</p>
      <LoginButton />
    </main>
  );
}