// Empty stub om @metamask/sdk te aliasen — voorkomt bundle bloat + eval-via-MetaMask SDK.
// Wagmi connectors barrel export importeert metaMask connector die @metamask/sdk
// dynamisch laadt. Voor Zentrix (Solana + Privy) is dat dead weight.

export default {};
