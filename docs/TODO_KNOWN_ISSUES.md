# Known Issues — Zentrix

## Auth (uit PROMPT_03)

### 1. Multiple pnpm-lock.yaml workspace warning
- C:\Users\rapha\pnpm-lock.yaml bestaat (van ander oud project)
- Turbopack pakt dat als project root
- FIX VOOR PROMPT_05: zet turbopack.root: __dirname in next.config.ts
- Of: verwijder C:\Users\rapha\pnpm-lock.yaml (controleer eerst of
  geen oud project ervan afhankelijk is)
