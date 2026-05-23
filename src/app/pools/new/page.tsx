import { AuthGuard } from "@/components/auth/auth-guard";
import { CreatePoolPage } from "@/components/pools/create-pool-page";

export const metadata = {
  title: "Create Pool | Zentrix",
};

export default function NewPoolPage() {
  return (
    <AuthGuard>
      <CreatePoolPage />
    </AuthGuard>
  );
}
