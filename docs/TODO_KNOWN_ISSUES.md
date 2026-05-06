# Known Issues — Zentrix

## Auth (uit PROMPT_03)

### 1. Email + embeddedWallet niet ge-refreshed na initial provisioning
- getCurrentUser() schrijft user-velden alleen bij eerste call
- Privy stuurt embedded Solana wallet asynchroon — kan minuten duren
- Email kan ontbreken bij Google login depending on Privy config
- FIX VOOR PROMPT_05: getCurrentUser moet Privy opnieuw bevragen +
  DB updaten als email of embeddedWalletAddress nog null zijn
- Check ook Privy dashboard → User data → Email = enabled

### 2. Multiple pnpm-lock.yaml workspace warning
- C:\Users\rapha\pnpm-lock.yaml bestaat (van ander oud project)
- Turbopack pakt dat als project root
- FIX VOOR PROMPT_05: zet turbopack.root: __dirname in next.config.ts
- Of: verwijder C:\Users\rapha\pnpm-lock.yaml (controleer eerst of
  geen oud project ervan afhankelijk is)
