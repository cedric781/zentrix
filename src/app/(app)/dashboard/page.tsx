import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { LoginButton } from "@/components/auth/LoginButton";

export default async function Dashboard() {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  return (
    <main className="flex-1 p-8 flex flex-col gap-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <LoginButton />
      </div>
      <div className="rounded-lg bg-zinc-900 p-6">
        <h2 className="text-sm font-semibold opacity-70 mb-3">Account</h2>
        <pre className="text-sm font-mono overflow-x-auto">
{JSON.stringify(
  {
    id: user.id,
    email: user.email,
    embeddedWallet: user.embeddedWalletAddress ?? "(provisioning…)",
  },
  null,
  2,
)}
        </pre>
      </div>
    </main>
  );
}