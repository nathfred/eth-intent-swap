// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IUniswapV2Router {
    function WETH() external pure returns (address);

    function swapExactETHForTokens(
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external payable returns (uint[] memory amounts);

    function swapExactTokensForTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external returns (uint[] memory amounts);
}

contract IntentSwap {
    using ECDSA for bytes32;

    address public relayer;
    address public immutable uniswapRouter;
    mapping(address => uint256) public nonces;

    bytes32 public constant SWAP_TYPEHASH =
        keccak256(
            "SwapIntent(address fromToken,address toToken,uint256 amountIn,uint256 minAmountOut,address recipient,uint256 deadline,uint256 nonce)"
        );

    bytes32 public DOMAIN_SEPARATOR;
    address public constant ETH_ADDRESS = address(0);

    struct SwapIntent {
        address fromToken;
        address toToken;
        uint256 amountIn;
        uint256 minAmountOut;
        address recipient;
        uint256 deadline;
        uint256 nonce;
    }

    receive() external payable {}

    event SwapExecuted(
        address indexed fromToken,
        address indexed toToken,
        uint256 amountIn,
        uint256 minAmountOut,
        address indexed recipient
    );

    constructor(address _router) {
        require(_router != address(0), "Invalid router address");
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

    function setRelayer(address _relayer) external {
        // Add proper access control here
        relayer = _relayer;
    }

    function executeSwap(SwapIntent calldata intent, bytes calldata signature) external {
        require(block.timestamp <= intent.deadline, "Intent expired");
        require(intent.nonce == nonces[intent.recipient], "Invalid nonce");
        require(intent.recipient != address(0), "Invalid recipient");
        require(intent.toToken != address(0), "Invalid destination token");

        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                DOMAIN_SEPARATOR,
                keccak256(
                    abi.encode(
                        SWAP_TYPEHASH,
                        intent.fromToken,
                        intent.toToken,
                        intent.amountIn,
                        intent.minAmountOut,
                        intent.recipient,
                        intent.deadline,
                        intent.nonce
                    )
                )
            )
        );

        address signer = digest.recover(signature);
        require(signer == intent.recipient, "Invalid signer");

        // Mark nonce used
        nonces[intent.recipient]++;

        // Create swap path
        address[] memory path = new address[](2);

        if (intent.fromToken == ETH_ADDRESS) {
            // ETH to Token swap
            path[0] = IUniswapV2Router(uniswapRouter).WETH();
            path[1] = intent.toToken;

            IUniswapV2Router(uniswapRouter).swapExactETHForTokens{ value: intent.amountIn }(
                intent.minAmountOut,
                path,
                intent.recipient,
                intent.deadline
            );
        } else {
            // Token to Token swap
            path[0] = intent.fromToken;
            path[1] = intent.toToken;

            // Transfer tokens from user to contract
            IERC20(intent.fromToken).transferFrom(intent.recipient, address(this), intent.amountIn);

            // Approve router to spend tokens
            IERC20(intent.fromToken).approve(uniswapRouter, intent.amountIn);

            IUniswapV2Router(uniswapRouter).swapExactTokensForTokens(
                intent.amountIn,
                intent.minAmountOut,
                path,
                intent.recipient,
                intent.deadline
            );
        }

        emit SwapExecuted(intent.fromToken, intent.toToken, intent.amountIn, intent.minAmountOut, intent.recipient);
    }
}
