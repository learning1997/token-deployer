import { u256 } from '@btc-vision/as-bignum/assembly';
import {
    OP20,
    OP20InitParameters,
    Blockchain,
    Calldata,
    BytesWriter,
    Address,
    Revert,
} from '@btc-vision/btc-runtime/runtime';
import { revertOnError } from '@btc-vision/btc-runtime/runtime/abort/abort';

// Entry point for the contract
Blockchain.contract = () => {
    return new MintableToken();
};

// Required exports for the runtime
export * from '@btc-vision/btc-runtime/runtime/exports';

export function abort(
    message: string | null,
    fileName: string | null,
    lineNumber: u32,
    columnNumber: u32,
): void {
    revertOnError(message || 'Abort!', fileName || 'Unknown', lineNumber, columnNumber);
}

/**
 * @title MintableToken
 * @dev OP-20 Token with mintable supply and customizable initialization.
 */
@final
class MintableToken extends OP20 {

    /**
     * @dev Called once upon contract deployment.
     * Expected calldata: [maxSupply (u256), decimals (u8), name (string), symbol (string), initialMintTo (address), initialMintAmount (u256)]
     */
    public override onDeployment(calldata: Calldata): void {
        const maxSupply = calldata.readU256();
        const decimals = calldata.readU8();
        const name = calldata.readStringWithLength();
        const symbol = calldata.readStringWithLength();
        const initialMintTo = calldata.readAddress();
        const initialMintAmount = calldata.readU256();

        this.instantiate(new OP20InitParameters(maxSupply, decimals, name, symbol));

        if (initialMintAmount > u256.Zero) {
            this._mint(initialMintTo, initialMintAmount);
        }
    }

    /**
     * @dev Admin-only function to mint new tokens.
     */
    @method(
        { name: 'to', type: ABIDataTypes.ADDRESS },
        { name: 'amount', type: ABIDataTypes.UINT256 },
    )
    @returns({ name: 'success', type: ABIDataTypes.BOOL })
    public mint(calldata: Calldata): BytesWriter {
        this.onlyDeployer(Blockchain.tx.sender);

        const to = calldata.readAddress();
        const amount = calldata.readU256();

        this._mint(to, amount);

        return new BytesWriter(0);
    }

    /**
     * @dev Token holders can burn tokens.
     */
    @method({ name: 'amount', type: ABIDataTypes.UINT256 })
    @returns({ name: 'success', type: ABIDataTypes.BOOL })
    public burn(calldata: Calldata): BytesWriter {
        const amount = calldata.readU256();
        this._burn(Blockchain.tx.sender, amount);

        return new BytesWriter(0);
    }
}
