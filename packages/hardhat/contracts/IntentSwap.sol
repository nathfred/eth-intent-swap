// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

// Manual ReentrancyGuard implementation to avoid version conflicts
abstract contract ReentrancyGuard {
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;

    uint256 private _status;

    constructor() {
        _status = _NOT_ENTERED;
    }

    modifier nonReentrant() {
        require(_status != _ENTERED, "ReentrancyGuard: reentrant call");
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }
}

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

    function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts);
}

contract IntentSwap is ReentrancyGuard, Ownable {
    using ECDSA for bytes32;
    using SafeERC20 for IERC20;

    address public relayer;
    address public immutable uniswapRouter;
    mapping(address => uint256) public nonces;

    // Fee system
    uint256 public constant MAX_FEE_BPS = 1000; // 10% max fee
    uint256 public feeBps = 30; // 0.3% default fee
    address public feeRecipient;

    bytes32 public constant SWAP_TYPEHASH =
        keccak256(
            "SwapIntent(address fromToken,address toToken,uint256 amountIn,uint256 minAmountOut,address recipient,uint256 deadline,uint256 nonce)"
        );

    bytes32 public DOMAIN_SEPARATOR;
    address public constant ETH_ADDRESS = address(0);

    // Intent storage structures
    struct StoredSwapIntent {
        uint256 id;
        address fromToken;
        address toToken;
        uint256 amountIn;
        uint256 minAmountOut;
        address creator;
        uint256 deadline;
        bool fulfilled;
        bool cancelled;
    }

    struct SwapIntent {
        address fromToken;
        address toToken;
        uint256 amountIn;
        uint256 minAmountOut;
        address recipient;
        uint256 deadline;
        uint256 nonce;
    }

    // Intent storage
    uint256 public nextIntentId = 1;
    mapping(uint256 => StoredSwapIntent) public intents;
    mapping(address => uint256[]) public userIntents;

    // Emergency controls
    bool public paused = false;
    mapping(address => bool) public authorizedFulfillers;

    receive() external payable {}

    event SwapExecuted(
        address indexed fromToken,
        address indexed toToken,
        uint256 amountIn,
        uint256 minAmountOut,
        address indexed recipient
    );

    event IntentCreated(
        uint256 indexed intentId,
        address indexed creator,
        address fromToken,
        address toToken,
        uint256 amountIn,
        uint256 minAmountOut,
        uint256 deadline
    );

    event IntentCancelled(uint256 indexed intentId, address indexed creator);
    event IntentFulfilled(uint256 indexed intentId, address indexed fulfiller);
    event RelayerUpdated(address indexed oldRelayer, address indexed newRelayer);
    event FeeUpdated(uint256 oldFee, uint256 newFee);
    event FeeRecipientUpdated(address indexed oldRecipient, address indexed newRecipient);
    event PauseStatusChanged(bool paused);
    event FulfillerAuthorizationChanged(address indexed fulfiller, bool authorized);

    modifier notPaused() {
        require(!paused, "Contract is paused");
        _;
    }

    modifier onlyAuthorizedFulfiller() {
        require(authorizedFulfillers[msg.sender] || msg.sender == owner(), "Not authorized fulfiller");
        _;
    }

    constructor(address _router, address _feeRecipient) Ownable(msg.sender) {
        require(_router != address(0), "Invalid router address");
        require(_feeRecipient != address(0), "Invalid fee recipient");

        uniswapRouter = _router;
        feeRecipient = _feeRecipient;

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

    function setRelayer(address _relayer) external onlyOwner {
        require(_relayer != address(0), "Invalid relayer address");
        address oldRelayer = relayer;
        relayer = _relayer;
        emit RelayerUpdated(oldRelayer, _relayer);
    }

    function setFee(uint256 _feeBps) external onlyOwner {
        require(_feeBps <= MAX_FEE_BPS, "Fee too high");
        uint256 oldFee = feeBps;
        feeBps = _feeBps;
        emit FeeUpdated(oldFee, _feeBps);
    }

    function setFeeRecipient(address _feeRecipient) external onlyOwner {
        require(_feeRecipient != address(0), "Invalid fee recipient");
        address oldRecipient = feeRecipient;
        feeRecipient = _feeRecipient;
        emit FeeRecipientUpdated(oldRecipient, _feeRecipient);
    }

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit PauseStatusChanged(_paused);
    }

    function setFulfillerAuthorization(address _fulfiller, bool _authorized) external onlyOwner {
        require(_fulfiller != address(0), "Invalid fulfiller address");
        authorizedFulfillers[_fulfiller] = _authorized;
        emit FulfillerAuthorizationChanged(_fulfiller, _authorized);
    }

    // Create a stored intent
    function createSwapIntent(
        address _fromToken,
        address _toToken,
        uint256 _amountIn,
        uint256 _minAmountOut,
        uint256 _deadline
    ) external payable nonReentrant notPaused returns (uint256) {
        require(_deadline > block.timestamp, "Invalid deadline");
        require(_toToken != address(0), "Invalid destination token");
        require(_fromToken != _toToken, "Same token swap not allowed");
        require(_amountIn > 0, "Invalid amount");
        require(_minAmountOut > 0, "Invalid min amount out");

        // If from token is ETH, check msg.value
        if (_fromToken == ETH_ADDRESS) {
            require(msg.value == _amountIn, "Incorrect ETH amount");
        } else {
            require(msg.value == 0, "ETH not expected for token swap");
            // Use SafeERC20 for secure token transfers
            IERC20(_fromToken).safeTransferFrom(msg.sender, address(this), _amountIn);
        }

        uint256 intentId = nextIntentId++;

        intents[intentId] = StoredSwapIntent({
            id: intentId,
            fromToken: _fromToken,
            toToken: _toToken,
            amountIn: _amountIn,
            minAmountOut: _minAmountOut,
            creator: msg.sender,
            deadline: _deadline,
            fulfilled: false,
            cancelled: false
        });

        userIntents[msg.sender].push(intentId);

        emit IntentCreated(intentId, msg.sender, _fromToken, _toToken, _amountIn, _minAmountOut, _deadline);

        return intentId;
    }

    // Cancel an intent
    function cancelSwapIntent(uint256 _intentId) external nonReentrant notPaused {
        StoredSwapIntent storage intent = intents[_intentId];
        require(intent.creator == msg.sender, "Not intent creator");
        require(!intent.fulfilled, "Intent already fulfilled");
        require(!intent.cancelled, "Intent already cancelled");
        require(intent.id != 0, "Intent does not exist");

        intent.cancelled = true;

        // Refund tokens
        if (intent.fromToken == ETH_ADDRESS) {
            (bool success, ) = payable(msg.sender).call{ value: intent.amountIn }("");
            require(success, "ETH transfer failed");
        } else {
            IERC20(intent.fromToken).safeTransfer(msg.sender, intent.amountIn);
        }

        emit IntentCancelled(_intentId, msg.sender);
    }

    // Get user's intents
    function getUserIntents(address user) external view returns (StoredSwapIntent[] memory) {
        uint256[] memory userIntentIds = userIntents[user];
        StoredSwapIntent[] memory result = new StoredSwapIntent[](userIntentIds.length);

        for (uint256 i = 0; i < userIntentIds.length; i++) {
            result[i] = intents[userIntentIds[i]];
        }

        return result;
    }

    // Get current user's intents
    function getMyIntents() external view returns (StoredSwapIntent[] memory) {
        return this.getUserIntents(msg.sender);
    }

    // Fulfill a stored intent with better access control and MEV protection
    function fulfillIntent(uint256 _intentId) external nonReentrant onlyAuthorizedFulfiller notPaused {
        StoredSwapIntent storage intent = intents[_intentId];
        require(intent.id != 0, "Intent does not exist");
        require(!intent.fulfilled, "Intent already fulfilled");
        require(!intent.cancelled, "Intent cancelled");
        require(block.timestamp <= intent.deadline, "Intent expired");

        intent.fulfilled = true;

        // Calculate fee
        uint256 feeAmount = (intent.amountIn * feeBps) / 10000;
        uint256 swapAmount = intent.amountIn - feeAmount;

        // Execute the swap
        address[] memory path = new address[](2);

        if (intent.fromToken == ETH_ADDRESS) {
            // ETH to Token swap
            path[0] = IUniswapV2Router(uniswapRouter).WETH();
            path[1] = intent.toToken;

            // Send fee to fee recipient
            if (feeAmount > 0) {
                (bool feeSuccess, ) = payable(feeRecipient).call{ value: feeAmount }("");
                require(feeSuccess, "Fee transfer failed");
            }

            IUniswapV2Router(uniswapRouter).swapExactETHForTokens{ value: swapAmount }(
                intent.minAmountOut,
                path,
                intent.creator,
                intent.deadline
            );
        } else {
            // Token to Token swap
            path[0] = intent.fromToken;
            path[1] = intent.toToken;

            // Send fee to fee recipient
            if (feeAmount > 0) {
                IERC20(intent.fromToken).safeTransfer(feeRecipient, feeAmount);
            }

            // Approve router to spend tokens
            IERC20(intent.fromToken).approve(uniswapRouter, 0); // Reset approval first
            IERC20(intent.fromToken).approve(uniswapRouter, swapAmount);

            IUniswapV2Router(uniswapRouter).swapExactTokensForTokens(
                swapAmount,
                intent.minAmountOut,
                path,
                intent.creator,
                intent.deadline
            );
        }

        emit IntentFulfilled(_intentId, msg.sender);
        emit SwapExecuted(intent.fromToken, intent.toToken, swapAmount, intent.minAmountOut, intent.creator);
    }

    // Original signature-based execution with improvements
    function executeSwap(SwapIntent calldata intent, bytes calldata signature) external payable nonReentrant notPaused {
        require(block.timestamp <= intent.deadline, "Intent expired");
        require(intent.nonce == nonces[intent.recipient], "Invalid nonce");
        require(intent.recipient != address(0), "Invalid recipient");
        require(intent.toToken != address(0), "Invalid destination token");
        require(intent.fromToken != intent.toToken, "Same token swap not allowed");
        require(intent.amountIn > 0, "Invalid amount");
        require(intent.minAmountOut > 0, "Invalid min amount out");

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

        // Calculate fee
        uint256 feeAmount = (intent.amountIn * feeBps) / 10000;
        uint256 swapAmount = intent.amountIn - feeAmount;

        // Create swap path
        address[] memory path = new address[](2);

        if (intent.fromToken == ETH_ADDRESS) {
            require(msg.value == intent.amountIn, "Incorrect ETH amount");

            // ETH to Token swap
            path[0] = IUniswapV2Router(uniswapRouter).WETH();
            path[1] = intent.toToken;

            // Send fee to fee recipient
            if (feeAmount > 0) {
                (bool feeSuccess, ) = payable(feeRecipient).call{ value: feeAmount }("");
                require(feeSuccess, "Fee transfer failed");
            }

            IUniswapV2Router(uniswapRouter).swapExactETHForTokens{ value: swapAmount }(
                intent.minAmountOut,
                path,
                intent.recipient,
                intent.deadline
            );
        } else {
            require(msg.value == 0, "ETH not expected for token swap");

            // Token to Token swap
            path[0] = intent.fromToken;
            path[1] = intent.toToken;

            // Transfer tokens from user to contract
            IERC20(intent.fromToken).safeTransferFrom(intent.recipient, address(this), intent.amountIn);

            // Send fee to fee recipient
            if (feeAmount > 0) {
                IERC20(intent.fromToken).safeTransfer(feeRecipient, feeAmount);
            }

            // Approve router to spend tokens
            IERC20(intent.fromToken).approve(uniswapRouter, 0); // Reset approval first
            IERC20(intent.fromToken).approve(uniswapRouter, swapAmount);

            IUniswapV2Router(uniswapRouter).swapExactTokensForTokens(
                swapAmount,
                intent.minAmountOut,
                path,
                intent.recipient,
                intent.deadline
            );
        }

        emit SwapExecuted(intent.fromToken, intent.toToken, swapAmount, intent.minAmountOut, intent.recipient);
    }

    // Emergency functions
    function emergencyWithdraw(address token, uint256 amount) external onlyOwner {
        if (token == ETH_ADDRESS) {
            (bool success, ) = payable(owner()).call{ value: amount }("");
            require(success, "ETH transfer failed");
        } else {
            IERC20(token).safeTransfer(owner(), amount);
        }
    }

    // View functions for better UX
    function getIntent(uint256 _intentId) external view returns (StoredSwapIntent memory) {
        return intents[_intentId];
    }

    function getUserIntentCount(address user) external view returns (uint256) {
        return userIntents[user].length;
    }

    // Function to estimate swap output (for better UX)
    function estimateSwapOutput(
        address fromToken,
        address toToken,
        uint256 amountIn
    ) external view returns (uint256[] memory amounts) {
        address[] memory path = new address[](2);

        if (fromToken == ETH_ADDRESS) {
            path[0] = IUniswapV2Router(uniswapRouter).WETH();
            path[1] = toToken;
        } else {
            path[0] = fromToken;
            path[1] = toToken;
        }

        return IUniswapV2Router(uniswapRouter).getAmountsOut(amountIn, path);
    }
}
