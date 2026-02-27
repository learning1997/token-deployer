import { BinaryWriter } from '@btc-vision/transaction';
import { TransactionFactory, IDeploymentParameters, Wallet } from '@btc-vision/transaction';
import { networks } from '@btc-vision/bitcoin';
import { readFileSync } from 'fs';

/**
 * OPNet Deployment Script for MintableToken
 */
async function deploy() {
    // 1. Configuration
    const network = networks.regtest; // Or mainnet/testnet
    const feeRate = 20; // sat/vB
    const priorityFee = 10000n; // sat

    // 2. Load Contract Bytecode
    // Ensure you have compiled the contract first!
    const bytecode = readFileSync('./build/MintableToken.wasm');

    // 3. Prepare Constructor Calldata
    // Order: maxSupply (u256), decimals (u8), name (string), symbol (string)
    const writer = new BinaryWriter();

    const maxSupply = 21000000n * (10n ** 18n); // 21M with 18 decimals
    writer.writeU256(maxSupply);
    writer.writeU8(18); // Decimals
    writer.writeString("My Mintable Token"); // Name
    writer.writeString("MMT"); // Symbol

    const constructorCalldata = writer.getBuffer();

    // 4. Setup Signers (REPLACE WITH YOUR KEYS)
    const wallet = Wallet.fromWif('YOUR_WIF_PRIVATE_KEY', 'YOUR_MLDSA_PRIVATE_KEY', network);
    // ^ REQUIRED for mainnet deployment. For local testing/regtest, check OPNet CLI or wallet docs.
    // Use `opnet keygen` to generate quantum-safe keys.

    // 5. Fetch UTXOs (Placeholder)
    // You would typically fetch these from an RPC or indexer
    const utxos: any[] = [
        /* { txid, vout, value, scriptPubKey } */
    ];

    // 6. Define Deployment Parameters
    const params: IDeploymentParameters = {
        signer: wallet.keypair,
        mldsaSigner: wallet.mldsaKeypair,
        network: network,
        utxos: utxos,
        from: wallet.p2tr, // Sender address
        feeRate: feeRate,
        priorityFee: priorityFee,
        gasSatFee: 50000n, // Estimated gas fee
        bytecode: bytecode,
        calldata: constructorCalldata,
        challenge: {
            // Challenge solution from current epoch
            // result: "...",
            // salt: "..."
        } as any,
    };

    // 7. Create Deployment
    const factory = new TransactionFactory();
    try {
        const result = await factory.signDeployment(params);

        console.log('--- Deployment Plan Created ---');
        console.log('Contract Address:', result.contractAddress);
        console.log('Funding TX Hex:', result.transaction[0]);
        console.log('Reveal TX Hex:', result.transaction[1]);

        // Next step: Broadcast transactions to the network
        // Note: Funding TX MUST be confirmed/in mempool before Reveal TX
    } catch (error) {
        console.error('Deployment failed:', error);
    }
}

deploy().catch(console.error);