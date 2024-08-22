// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../tokens/MintableBaseToken.sol";

contract NLP is MintableBaseToken {
    constructor() public MintableBaseToken("NSC LP", "NLP", 0) {}

    function id() external pure returns (string memory _name) {
        return "NLP";
    }
}
