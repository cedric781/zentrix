import { AuthGuard } from "@/components/auth/auth-guard";
import { CreateBetPage } from "@/components/bets/create-bet-page";

export const metadata = {
  title: "Create Bet | Zentrix",
};

export default function NewBetPage() {
  return (
    <AuthGuard>
      <CreateBetPage />
    </AuthGuard>
  );
}
