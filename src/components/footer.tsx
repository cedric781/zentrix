import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t bg-background mt-auto">
      <div className="container mx-auto max-w-6xl px-4 py-8">
        <div className="flex flex-col sm:flex-row gap-4 sm:justify-between items-center text-xs text-muted-foreground">
          <div className="flex flex-wrap items-center gap-4">
            <Link href="/terms" className="hover:text-foreground transition-colors">
              Terms
            </Link>
            <Link href="/privacy" className="hover:text-foreground transition-colors">
              Privacy
            </Link>
            <Link href="/responsible" className="hover:text-foreground transition-colors">
              Responsible Gaming
            </Link>
          </div>
          <div>
            © 2026 Yung Gado
          </div>
        </div>
      </div>
    </footer>
  );
}
