# OP-20 Token Launcher (Bitcoin L1)

A premium token deployer for Bitcoin Layer 1 using OP_NET.

## 🚀 Deployment

This project is ready to be hosted on **Netlify** or **Vercel**.

### For Netlify:
1. Push this code to a GitHub repository.
2. Connect the repository to Netlify.
3. Set the **Build Command** to: `npm install && npm run build`
4. Set the **Publish Directory** to: `dist`

### For Vercel:
1. Push this code to a GitHub repository.
2. Import the project into Vercel.
3. Vercel will automatically detect the Vite setup.
4. Set the **Build Command** to: `npm run build`
5. Set the **Output Directory** to: `dist`

## 🛠 Features
- **OPNet Integration:** Uses `@btc-vision/transaction` for Bitcoin smart contract interactions.
- **AssemblyScript:** The smart contract is written in AS and compiled to WASM.
- **Premium UI:** Modern, responsive design with dark mode and glassmorphism.
- **Real Wallet Connection:** Integrates with `OP_WALLET` (injected provider).

## 📄 Development

To run locally:
```bash
npm install
npm run dev
```

To compile the contract:
```bash
npm run build:contract
```

## ⚠️ Requirements
- Node.js 18+
- [OP_WALLET](https://opnet.org) browser extension for testing deployments.
