// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IUniswapV2Router {
    function swapExactETHForTokens(
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external payable returns (uint[] memory amounts);
}

contract IntentSwap {
    using ECDSA for bytes32;

    address public relayer; // optional
    address public immutable uniswapRouter;
    mapping(address => uint256) public nonces;

    bytes32 public constant SWAP_TYPEHASH = keccak256(
        "SwapIntent(address fromToken,address toToken,uint256 amountIn,uint256 minAmountOut,address recipient,uint256 deadline,uint256 nonce)"
    );

    bytes32 public DOMAIN_SEPARATOR;

    struct SwapIntent {
        address fromToken;
        address toToken;
        uint256 amountIn;
        uint256 minAmountOut;
        address recipient;
        uint256 deadline;
        uint256 nonce;
    }

    constructor(address _router) {
        uniswapRouter = _router;

        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("IntentSwap")),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );
    }

    function executeSwap(
        SwapIntent calldata intent,
        bytes calldata signature
    ) external {
        require(block.timestamp <= intent.deadline, "Intent expired");
        require(intent.nonce == nonces[intent.recipient], "Invalid nonce");

        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                DOMAIN_SEPARATOR,
                keccak256(abi.encode(
                    SWAP_TYPEHASH,
                    intent.fromToken,
                    intent.toToken,
                    intent.amountIn,
                    intent.minAmountOut,
                    intent.recipient,
                    intent.deadline,
                    intent.nonce
                ))
            )
        );

        address signer = digest.recover(signature);
        require(signer == intent.recipient, "Invalid signer");

        // Mark nonce used
        nonces[intent.recipient]++;

        // Execute swap (ETH → Token only, for now)
        require(intent.fromToken == address(0), "Only ETH swaps supported");

        address ;
        path[0] = IUniswapV2Router(uniswapRouter).WETH();
        path[1] = intent.toToken;

        IUniswapV2Router(uniswapRouter).swapExactETHForTokens{ value: intent.amountIn }(
            intent.minAmountOut,
            path,
            intent.recipient,
            intent.deadline
        );
    }

    receive() external payable {}
}
