import './style.css';
import { BinaryWriter, Address } from '@btc-vision/transaction';
import { JSONRpcProvider, getContract, ABIDataTypes, BitcoinAbiTypes, OP_NET_ABI } from 'opnet';
import { networks } from '@btc-vision/bitcoin';

declare global {
    interface Window {
        opnet?: import('@btc-vision/transaction').OPWallet;
        copyAddr?: () => void;
    }
}

// State
let walletConnected = false;
let walletAddress = ''; // Bitcoin bech32 address (bc1p/tb1p)
let opAddressStr = ''; // OPNet address (opt1/opr1/op1)
let opAddressObj: Address | null = null;
let walletBalance = 0n;
let currentWalletNetwork = 'regtest';
let btcNetwork = networks.regtest;
let provider: JSONRpcProvider | null = null;
const PLATFORM_FEE_ADDRESS = 'bc1p9u2kq9p9p9p9p9p9p9p9p9p9p9p9p9p9p9p9p9p9p9p9p9js3cln5m'; // Default platform wallet (Change to yours)
const PLATFORM_FEE_AMOUNT = 10000n; // 10,000 sats
const MAX_SPEND_LIMIT = 100000n; // 0.001 BTC safety limit
const FACTORY_ADDR: string = (import.meta as any).env?.VITE_CONTRACT_FACTORY || '';
const FACTORY_ABI: any[] = [
    {
        name: 'deployToken',
        inputs: [
            { name: 'maxSupply', type: ABIDataTypes.UINT256 },
            { name: 'decimals', type: ABIDataTypes.UINT8 },
            { name: 'name', type: ABIDataTypes.STRING },
            { name: 'symbol', type: ABIDataTypes.STRING },
            { name: 'initialMintTo', type: ABIDataTypes.ADDRESS },
            { name: 'initialMintAmount', type: ABIDataTypes.UINT256 },
            { name: 'freeMintSupply', type: ABIDataTypes.UINT256 },
            { name: 'freeMintPerTx', type: ABIDataTypes.UINT256 },
            { name: 'freeMintUserCap', type: ABIDataTypes.UINT256 },
            { name: 'tokenOwner', type: ABIDataTypes.ADDRESS },
            { name: 'burnEnabled', type: ABIDataTypes.BOOL }
        ],
        outputs: [{ name: 'success', type: ABIDataTypes.BOOL }],
        type: BitcoinAbiTypes.Function
    },
    {
        name: 'TokenDeployed',
        values: [
            { name: 'deployer', type: ABIDataTypes.ADDRESS },
            { name: 'tokenAddress', type: ABIDataTypes.ADDRESS },
            { name: 'name', type: ABIDataTypes.STRING },
            { name: 'symbol', type: ABIDataTypes.STRING }
        ],
        type: BitcoinAbiTypes.Event
    },
    ...OP_NET_ABI
];

const NETWORK_MAP: Record<string, any> = {
    'mainnet': networks.bitcoin,
    'testnet': networks.opnetTestnet,
    'regtest': networks.regtest
};

const RPC_MAP: Record<string, string> = {
    'mainnet': 'https://api.opnet.org',
    'testnet': 'https://testnet.opnet.org',
    'regtest': 'https://regtest.opnet.org'
};

let customWasmBuffer: Uint8Array | null = null;

// DOM Elements
const walletBtn = document.getElementById('walletBtn') as HTMLButtonElement;
const deployBtn = document.getElementById('deployBtn') as HTMLButtonElement;
const deployText = document.getElementById('deployText') as HTMLSpanElement;
const deploySteps = document.getElementById('deploySteps') as HTMLDivElement;
const successBox = document.getElementById('successBox') as HTMLDivElement;
const errorBox = document.getElementById('errorBox') as HTMLDivElement;
const errorMsg = document.getElementById('errorMsg') as HTMLDivElement;
const tokenName = document.getElementById('tokenName') as HTMLInputElement;
const tokenSymbol = document.getElementById('tokenSymbol') as HTMLInputElement;
const totalSupply = document.getElementById('totalSupply') as HTMLInputElement;
const tokenDecimals = document.getElementById('tokenDecimals') as HTMLSelectElement;
const networkSelect = document.getElementById('networkSelect') as HTMLSelectElement;
const wasmUpload = document.getElementById('wasmUpload') as HTMLInputElement;
const previewIcon = document.getElementById('previewIcon') as HTMLDivElement;
const previewName = document.getElementById('previewName') as HTMLDivElement;
const previewDetails = document.getElementById('previewDetails') as HTMLDivElement;
const gasEst = document.getElementById('gasEst') as HTMLSpanElement;
const initialMintInput = document.getElementById('initialMint') as HTMLInputElement;
const mintableInput = document.getElementById('mintable') as HTMLInputElement;
const burnableInput = document.getElementById('burnable') as HTMLInputElement;
const pausableInput = document.getElementById('pausable') as HTMLInputElement;

const costNetworkFee = document.getElementById('costNetworkFee') as HTMLElement;
const costPlatformFee = document.getElementById('costPlatformFee') as HTMLElement;
const costMaxLimit = document.getElementById('costMaxLimit') as HTMLElement;
const costTotal = document.getElementById('costTotal') as HTMLElement;

// Initialization
function init() {
    document.body.classList.remove('js-loading');
    updatePreview();

    walletBtn.addEventListener('click', toggleWallet);
    deployBtn.addEventListener('click', deployToken);

    [tokenName, tokenSymbol, totalSupply].forEach(el => {
        el.addEventListener('input', updatePreview);
    });

    [tokenDecimals, mintableInput, burnableInput, pausableInput, networkSelect].forEach(el => {
        el.addEventListener('change', updatePreview);
    });
    wasmUpload.addEventListener('change', handleWasmUpload);
}

async function handleWasmUpload(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    const textEl = document.querySelector('.file-text') as HTMLElement;

    if (file) {
        if (!file.name.endsWith('.wasm')) {
            showError('Please upload a valid .wasm file.');
            wasmUpload.value = '';
            return;
        }

        try {
            const buffer = await file.arrayBuffer();
            customWasmBuffer = new Uint8Array(buffer);
            textEl.textContent = `✓ ${file.name}`;
            textEl.classList.add('uploaded');
        } catch (err) {
            showError('Failed to read WASM file.');
            customWasmBuffer = null;
        }
    } else {
        customWasmBuffer = null;
        textEl.textContent = 'Click to upload .wasm';
        textEl.classList.remove('uploaded');
    }
}

async function toggleWallet() {
    if (walletConnected) {
        disconnectWallet();
    } else {
        await connectWallet();
    }
}

async function connectWallet() {
    if (typeof window.opnet === 'undefined') {
        showError('OP_WALLET not found! Please install the extension.');
        return;
    }

    try {
        const accounts = await window.opnet.requestAccounts();
        walletAddress = accounts[0];

        // Fetch wallet's current network
        try {
            currentWalletNetwork = await window.opnet.getNetwork();
            updateNetworkBadge(currentWalletNetwork);
        } catch (e) {
            console.warn('Could not fetch network:', e);
        }

        // Initialize provider
        btcNetwork = NETWORK_MAP[currentWalletNetwork] || networks.regtest;
        provider = new JSONRpcProvider({
            url: RPC_MAP[currentWalletNetwork] || RPC_MAP.regtest,
            network: btcNetwork
        });

        // Resolve OPNet address (opt1... / opr1...)
        // PRIORITY: Get MLDSA Public Key directly from wallet (best for new accounts)
        if (window.opnet && window.opnet.web3) {
            try {
                const mldsaPubKey = await window.opnet.web3.getMLDSAPublicKey();
                opAddressObj = Address.fromString(mldsaPubKey);
                opAddressStr = opAddressObj.p2op(btcNetwork);
                console.log('Resolved MLDSA From Wallet:', mldsaPubKey);
                console.log('OPNet Address:', opAddressStr);
            } catch (e) {
                console.warn('Could not get MLDSA Public Key from wallet, trying RPC:', e);
                // FALLBACK: Try RPC (only works if account has history)
                try {
                    opAddressObj = await provider.getPublicKeyInfo(walletAddress, false);
                    if (opAddressObj) {
                        opAddressStr = opAddressObj.p2op(btcNetwork);
                    } else {
                        opAddressStr = walletAddress;
                    }
                } catch (rpcErr) {
                    console.error('RPC resolution failed as well:', rpcErr);
                    opAddressStr = walletAddress;
                }
            }
        } else {
            opAddressStr = walletAddress;
        }

        // Fetch balance
        await fetchAndDisplayBalance();

        const networkSymbol = currentWalletNetwork === 'regtest' ? 'rBTC' : (currentWalletNetwork === 'mainnet' ? 'BTC' : 'tBTC');

        walletBtn.innerHTML = `
      <div class="left">
        <div class="wallet-icon" style="background:var(--green)">✓</div>
        <span>Connected</span>
      </div>
      <div class="right-info">
        <span class="balance" id="walletBal">${(Number(walletBalance) / 1e8).toFixed(8)} ${networkSymbol}</span>
        <span class="addr" id="walletAddr" title="${opAddressStr}">${opAddressStr.slice(0, 8)}...${opAddressStr.slice(-6)}</span>
      </div>
    `;
        walletBtn.classList.add('connected');
        walletConnected = true;
    } catch (err: unknown) {
        showError('Failed to connect wallet: ' + (err instanceof Error ? err.message : String(err)));
    }
}

async function fetchAndDisplayBalance() {
    try {
        if (!window.opnet) return;
        const balanceObj = await window.opnet.getBalance();
        if (typeof balanceObj === 'bigint') {
            walletBalance = balanceObj;
        } else if (typeof balanceObj === 'number') {
            walletBalance = BigInt(balanceObj);
        } else if (balanceObj && typeof balanceObj === 'object') {
            walletBalance = BigInt((balanceObj as any).total || (balanceObj as any).confirmed || (balanceObj as any).confirmed_satoshi || 0);
        }

        const balDisplay = document.getElementById('walletBal');
        if (balDisplay) {
            const networkSymbol = currentWalletNetwork === 'regtest' ? 'rBTC' : (currentWalletNetwork === 'mainnet' ? 'BTC' : 'tBTC');
            balDisplay.textContent = `${(Number(walletBalance) / 1e8).toFixed(8)} ${networkSymbol}`;
        }
    } catch (e) {
        console.warn('Could not fetch balance:', e);
    }
}

function updateNetworkBadge(net: string) {
    const badge = document.querySelector('.network-badge') as HTMLElement;
    if (!badge) return;

    let displayNet = net.toUpperCase();
    if (net === 'regtest') displayNet = 'Regtest (opr1...)';
    if (net === 'testnet') displayNet = 'Testnet (opt1...)';
    if (net === 'mainnet') displayNet = 'Mainnet (op1...)';

    badge.innerHTML = `<div class="dot"></div> Bitcoin L1 · ${displayNet}`;
}

function disconnectWallet() {
    walletBtn.innerHTML = `
    <div class="left"><div class="wallet-icon">⬡</div><span id="walletText">Connect OP_WALLET</span></div>
    <div class="right-info"><span class="balance" id="walletBal"></span><span class="addr" id="walletAddr"></span></div>
  `;
    walletBtn.classList.remove('connected');
    walletConnected = false;
    walletAddress = '';
    walletBalance = 0n;
}

function updatePreview() {
    const name = tokenName.value || 'Your Token';
    const symbol = tokenSymbol.value || 'SYM';
    const supplyStr = totalSupply.value || '21000000';
    const supply = parseInt(supplyStr).toLocaleString();
    const dec = tokenDecimals.value;
    const selectedNet = networkSelect.value;

    previewIcon.textContent = symbol.slice(0, 2).toUpperCase() || '₿';
    previewName.textContent = name;

    let features = `${symbol.toUpperCase()} · ${supply} supply · ${dec} decimals`;
    if (mintableInput?.checked) features += ' · Mintable';
    if (burnableInput?.checked) features += ' · Burnable';
    if (pausableInput?.checked) features += ' · Pausable';

    previewDetails.textContent = features;

    // Dynamic gas estimate
    const isMintable = mintableInput?.checked;
    const isPausable = pausableInput?.checked;

    // Fee Calculation (Matching BitLaunch style)
    const feeRate = 10; // sat/vB
    let estVBytes = 350; // typical deploy tx base
    if (isMintable) estVBytes += 40;
    if (isPausable) estVBytes += 30;

    const networkFeeSats = feeRate * estVBytes;
    const platformFeeSats = 10000;
    const maxSpendLimitSats = 100000;
    const totalEstSats = networkFeeSats + platformFeeSats;

    const networkSymbol = selectedNet === 'regtest' ? 'rBTC' : (selectedNet === 'mainnet' ? 'BTC' : 'tBTC');

    // Update old simple gas estimate
    const totalEstBTC = (totalEstSats / 1e8).toFixed(6);
    gasEst.textContent = `~${totalEstBTC} ${networkSymbol}`;

    // Update new detailed breakdown
    if (costNetworkFee) costNetworkFee.textContent = `~${networkFeeSats.toLocaleString()} sats`;
    if (costPlatformFee) costPlatformFee.innerHTML = `${platformFeeSats.toLocaleString()} sats <span class="cost-btc">(0.0001 BTC)</span>`;
    if (costMaxLimit) costMaxLimit.textContent = `${maxSpendLimitSats.toLocaleString()} sats`;
    if (costTotal) costTotal.textContent = `~${totalEstSats.toLocaleString()} sats`;
}

async function deployToken() {
    const name = tokenName.value.trim();
    const symbol = tokenSymbol.value.trim();
    const supply = totalSupply.value;
    const selectedNetwork = networkSelect.value;

    if (!walletConnected) {
        showError('Wallet not connected. Please connect OP_WALLET first.');
        return;
    }
    if (!name || !symbol || !supply) {
        showError('Please fill in all required fields.');
        return;
    }

    // Start UI Deployment Flow
    hideAllStatus();
    deployBtn.classList.add('loading');
    deployBtn.disabled = true;
    deployText.textContent = 'Deploying...';
    deploySteps.classList.add('show');

    try {
        // 1. Prepare Calldata
        await runStep('step1', 1000);

        if (!provider) {
            provider = new JSONRpcProvider({
                url: RPC_MAP[currentWalletNetwork] || RPC_MAP.regtest,
                network: btcNetwork
            });
        }

        const decimalsVal = parseInt(tokenDecimals.value);
        const decimalsMultiplier = 10n ** BigInt(decimalsVal);
        const maxSupply = BigInt(supply) * decimalsMultiplier;
        const initialMintAmount = BigInt(initialMintInput.value || supply) * decimalsMultiplier;

        const writer = new BinaryWriter();
        writer.writeU256(maxSupply);
        writer.writeU8(decimalsVal);
        writer.writeStringWithLength(name);
        writer.writeStringWithLength(symbol);

        // Add initialMintTo and initialMintAmount (matching updated MintableToken.ts)
        if (opAddressObj) {
            writer.writeAddress(opAddressObj);
        } else {
            // Last resort: try getting it again or throwing a clear error
            try {
                const retryAddr = await (window.opnet as any).web3.getMLDSAPublicKey();
                writer.writeAddress(Address.fromString(retryAddr));
            } catch (e) {
                throw new Error("Could not resolve your wallet's public key (MLDSA). Please ensure you have funded your account and at least one transaction has confirmed.");
            }
        }
        writer.writeU256(initialMintAmount);
        const calldata = writer.getBuffer();
        console.log('Calldata Prepared (hex):', Array.from(calldata).map(b => b.toString(16).padStart(2, '0')).join(''));

        await runStep('step2', 500);
        if (!window.opnet || !window.opnet.web3) {
            throw new Error('OP_WALLET Web3 provider not found.');
        }
        if (currentWalletNetwork !== selectedNetwork) {
            const expectedPrefix = selectedNetwork === 'regtest' ? 'opr1...' : (selectedNetwork === 'mainnet' ? 'op1...' : 'opt1...');
            throw new Error(`Wallet network mismatch! Your wallet is currently on **${currentWalletNetwork.toUpperCase()}**, but you selected **${selectedNetwork.toUpperCase()}**. Please switch your wallet settings to **${selectedNetwork.toUpperCase()}** (which uses ${expectedPrefix} addresses).`);
        }
        await fetchAndDisplayBalance();
        if (walletBalance === 0n) {
            const networkSymbol = selectedNetwork === 'regtest' ? 'rBTC' : (selectedNetwork === 'mainnet' ? 'BTC' : 'tBTC');
            const addressPrefix = selectedNetwork === 'regtest' ? 'opr1...' : (selectedNetwork === 'mainnet' ? 'op1...' : 'opt1...');
            throw new Error(`Insufficient funds. Your wallet shows **0 balance** on **${selectedNetwork.toUpperCase()}**. Please ensure you have ${networkSymbol} in your **${addressPrefix}** address to pay for gas.`);
        }
        let utxos: any[] | undefined = undefined;
        try {
            if (window.opnet && (window.opnet as any).getUtxos) {
                const detected = await (window.opnet as any).getUtxos(walletAddress);
                if (Array.isArray(detected) && detected.length > 0) {
                    utxos = detected;
                }
            }
        } catch {}
        const isFeeAddrValidForNet = (addr: string, net: string) => {
            if (!addr) return false;
            if (net === 'mainnet') return addr.startsWith('bc1');
            if (net === 'testnet') return addr.startsWith('tb1');
            if (net === 'regtest') return addr.startsWith('bcrt1');
            return false;
        };
        let result: any;
        if (FACTORY_ADDR && opAddressObj) {
            const burnEnabled = !!burnableInput?.checked;
            const freeMintSupply = 0n;
            const freeMintPerTx = 0n;
            const freeMintUserCap = 0n;
            const factory = getContract(FACTORY_ADDR, FACTORY_ABI, provider, btcNetwork, opAddressObj);
            const simulation = await factory.deployToken(
                maxSupply,
                decimalsVal,
                name,
                symbol,
                opAddressObj,
                initialMintAmount,
                freeMintSupply,
                freeMintPerTx,
                freeMintUserCap,
                opAddressObj,
                burnEnabled
            );
            if ((simulation as any).revert) {
                throw new Error(`Simulation failed: ${(simulation as any).revert}`);
            }
            let tokenAddressStr: string | null = null;
            if ((simulation as any).events && (simulation as any).events.length > 0) {
                for (const ev of (simulation as any).events) {
                    const eName = ev.type || ev.name || '';
                    if (eName === 'TokenDeployed') {
                        const addrObj = ev.properties?.tokenAddress || ev.values?.tokenAddress || ev.properties?.token || ev.values?.token;
                        if (addrObj) {
                            try {
                                tokenAddressStr = addrObj.p2op ? addrObj.p2op(btcNetwork) : (addrObj.toString ? addrObj.toString() : String(addrObj));
                            } catch {
                                tokenAddressStr = String(addrObj);
                            }
                        }
                        break;
                    }
                }
            }
            let txHash: string | null = null;
            try {
                const sendOpts: any = {
                    signer: null,
                    mldsaSigner: null,
                    refundTo: walletAddress,
                    feeRate: 10,
                    maximumAllowedSatToSpend: MAX_SPEND_LIMIT,
                    network: btcNetwork
                };
                if (isFeeAddrValidForNet(PLATFORM_FEE_ADDRESS, selectedNetwork)) {
                    sendOpts.optionalOutputs = [{ address: PLATFORM_FEE_ADDRESS, value: Number(PLATFORM_FEE_AMOUNT) }];
                }
                const sendRes = await (simulation as any).sendTransaction(sendOpts);
                txHash = sendRes.transactionId || sendRes.txHash || sendRes.result || null;
            } catch {}
            result = {
                contractAddress: tokenAddressStr,
                transaction: [null, txHash || '']
            };
        } else {
            let bytecode: Uint8Array;
            if (customWasmBuffer) {
                bytecode = customWasmBuffer;
            } else {
                const wasmResponse = await fetch('/build/MintableToken.wasm');
                if (!wasmResponse.ok) throw new Error('Could not find compiled contract WASM. Run "npm run build" first.');
                bytecode = new Uint8Array(await wasmResponse.arrayBuffer());
            }
            const deployOptions: any = {
                bytecode: bytecode,
                calldata: calldata,
                feeRate: 10,
                priorityFee: 10000n,
                gasSatFee: 50000n,
                revealMLDSAPublicKey: true,
                linkMLDSAPublicKeyToAddress: true,
                network: selectedNetwork,
                maximumAllowedSatToSpend: MAX_SPEND_LIMIT,
                optionalOutputs: []
            };
            if (isFeeAddrValidForNet(PLATFORM_FEE_ADDRESS, selectedNetwork)) {
                deployOptions.optionalOutputs.push({
                    address: PLATFORM_FEE_ADDRESS,
                    value: Number(PLATFORM_FEE_AMOUNT)
                });
            }
            if (utxos && utxos.length > 0) {
                deployOptions.utxos = utxos;
            }
            result = await (window.opnet as any).web3.deployContract(deployOptions);
        }

        if (!result || !result.transaction || !result.transaction[1]) {
            throw new Error('Deployment rejected or failed.');
        }

        const revealTxId = result.transaction[1];

        // 3. Broadcasting & Confirmation UI
        await runStep('step3', 1000);
        await runStep('step4', 2000);

        // Finalize UI
        deployBtn.classList.remove('loading');
        deployBtn.disabled = false;
        deployText.textContent = '🚀 Deploy Token';
        deploySteps.classList.remove('show');

        // Show Results
        (document.getElementById('contractAddrText') as HTMLElement).textContent = result.contractAddress || 'Pending...';
        (document.getElementById('txHashText') as HTMLElement).textContent = revealTxId.slice(0, 10) + '...' + revealTxId.slice(-8);

        const opscanLink = document.getElementById('opscanLink') as HTMLAnchorElement;
        opscanLink.href = `https://opscan.io/tx/${revealTxId}`;

        successBox.classList.add('show');

    } catch (err: unknown) {
        let msg = err instanceof Error ? err.message : String(err);

        if (msg.toLowerCase().includes('no utxos')) {
            const networkSymbol = selectedNetwork === 'regtest' ? 'rBTC' : (selectedNetwork === 'mainnet' ? 'BTC' : 'tBTC');
            const addressPrefix = selectedNetwork === 'regtest' ? 'opr1...' : (selectedNetwork === 'mainnet' ? 'op1...' : 'opt1...');
            msg = `
                <div style="text-align:left; margin-top:10px;">
                    <strong>UTXO Sync Issue Detected:</strong><br>
                    You have **${(Number(walletBalance) / 1e8).toFixed(8)} ${networkSymbol}**, but the wallet cannot "see" them for deployment. This is common when:<br><br>
                    1. **Confirmations**: Your faucet funds are still in the mempool (0/1 confirmations). Wait ~10 minutes for a block.<br>
                    2. **Address Type**: Ensure you sent faucet funds to your **Taproot / OPNet (${addressPrefix})** address, not Segwit (bc1q...).<br>
                    3. **Dust**: If you have many tiny UTXOs, the wallet might fail to group them. Try sending your total balance to yourself in one transaction to "consolidate" them.
                </div>
            `;
        }

        showError('Deployment failed: ' + msg);
        deployBtn.classList.remove('loading');
        deployBtn.disabled = false;
        deployText.textContent = '🚀 Deploy Token';
    }
}

async function runStep(id: string, delay: number) {
    const step = document.getElementById(id) as HTMLElement;
    const dot = document.getElementById(id.replace('step', 's') + 'dot') as HTMLElement;

    step.classList.add('active');
    await new Promise(r => setTimeout(r, delay));
    step.classList.remove('active');
    step.classList.add('done');
    dot.textContent = '✓';
}

function showError(msg: string) {
    hideAllStatus();
    errorMsg.innerHTML = msg.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    errorBox.classList.add('show');
}

function hideAllStatus() {
    successBox.classList.remove('show');
    errorBox.classList.remove('show');
    ['step1', 'step2', 'step3', 'step4'].forEach((s, i) => {
        const el = document.getElementById(s);
        if (el) el.classList.remove('active', 'done');
        const dot = document.getElementById('s' + (i + 1) + 'dot');
        if (dot) dot.textContent = (i + 1).toString();
    });
}

// Global scope hacks for legacy HTML event handlers
window.copyAddr = () => {
    const addr = (document.getElementById('contractAddrText') as HTMLElement).textContent || '';
    navigator.clipboard.writeText(addr).then(() => {
        const btn = document.querySelector('.copy-btn') as HTMLButtonElement;
        if (btn) {
            const originalText = btn.textContent;
            btn.textContent = 'Copied!';
            setTimeout(() => btn.textContent = originalText, 2000);
        }
    });
};

init();
