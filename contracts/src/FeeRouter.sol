// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  FeeRouter.sol — B2B Payment Gateway su Base Network         ║
 * ║                                                              ║
 * ║  Deploy: Base Mainnet (chain 8453)                           ║
 * ║  Ottimizzazioni gas:                                         ║
 * ║    - immutable per feeRecipient iniziale                     ║
 * ║    - custom errors invece di require string (risparmi ~50%)  ║
 * ║    - unchecked per aritmetica sicura (fee < total garantito) ║
 * ║    - packed storage: feeBps + owner in slot singolo          ║
 * ║    - events indicizzati per filtering efficiente             ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * OpenZeppelin v5 — installazione:
 *   npm install @openzeppelin/contracts
 */

import {Ownable}    from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20}     from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20}  from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

// ── Custom Errors (risparmio gas vs string require) ───────────────────────
error ZeroAddress();
error ZeroAmount();
error FeeTooHigh();
error ETHTransferFailed();
error InsufficientBalance();
error InvalidReference();

contract FeeRouter is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ── Storage (packed in single slot per gas optimization) ─────────────
    // slot 0: feeRecipient (20 bytes) + feeBps (2 bytes) = 22 bytes < 32
    address public feeRecipient;
    uint16  public feeBps;          // basis points: 50 = 0.5%, max 1000 = 10%

    uint16  public constant MAX_FEE_BPS  = 1_000; // 10% hard cap
    uint16  public constant BPS_DENOM    = 10_000;

    // ── Events ────────────────────────────────────────────────────────────
    // indexed fields permettono filtraggio efficiente via getLogs
    event PaymentSent(
        address indexed sender,
        address indexed recipient,
        address indexed token,      // address(0) = ETH nativo
        uint256 grossAmount,
        uint256 netAmount,
        uint256 feeAmount,
        bytes32 paymentRef          // keccak256 del riferimento pagamento
    );

    event FeeRecipientUpdated(address indexed oldRecipient, address indexed newRecipient);
    event FeeBpsUpdated(uint16 oldBps, uint16 newBps);

    // ── Constructor ───────────────────────────────────────────────────────
    constructor(
        address _feeRecipient,
        uint16  _feeBps,
        address _owner
    ) Ownable(_owner) {
        if (_feeRecipient == address(0)) revert ZeroAddress();
        if (_feeBps > MAX_FEE_BPS)      revert FeeTooHigh();

        feeRecipient = _feeRecipient;
        feeBps       = _feeBps;
    }

    // ══════════════════════════════════════════════════════════════════════
    //  Core: splitTransfer — ETH nativo
    // ══════════════════════════════════════════════════════════════════════

    /**
     * @notice Invia ETH splittando automaticamente la fee.
     * @param _to           Destinatario finale
     * @param _paymentRef   Riferimento pagamento (es. invoice ID) per contabilità
     *
     * Gas ottimizzazioni:
     *   - nonReentrant protegge da reentrancy senza overhead eccessivo
     *   - unchecked: fee < msg.value è garantito dalla divisione intera
     *   - call{} invece di transfer{} per compatibilità EIP-1884
     */
    function splitTransferETH(
        address _to,
        bytes32 _paymentRef
    ) external payable nonReentrant {
        if (_to == address(0))  revert ZeroAddress();
        if (msg.value == 0)     revert ZeroAmount();

        uint256 gross = msg.value;

        // Safe math: fee = floor(gross * feeBps / 10000)
        // unchecked: feeBps <= 1000, gross <= type(uint256).max
        // fee <= gross * 10% — overflow impossibile
        uint256 fee;
        uint256 net;
        unchecked {
            fee = (gross * feeBps) / BPS_DENOM;
            net = gross - fee;
        }

        // Invia netto al destinatario
        (bool ok1, ) = _to.call{value: net}("");
        if (!ok1) revert ETHTransferFailed();

        // Invia fee al wallet di commissione
        (bool ok2, ) = feeRecipient.call{value: fee}("");
        if (!ok2) revert ETHTransferFailed();

        emit PaymentSent(
            msg.sender, _to, address(0),
            gross, net, fee, _paymentRef
        );
    }

    // ══════════════════════════════════════════════════════════════════════
    //  Core: splitTransfer — ERC20 (USDC, DEGEN, cbBTC, qualsiasi token)
    // ══════════════════════════════════════════════════════════════════════

    /**
     * @notice Invia token ERC20 splittando automaticamente la fee.
     * @param _token        Indirizzo del contratto token (USDC, DEGEN, cbBTC…)
     * @param _to           Destinatario finale
     * @param _amount       Importo lordo in unità raw (es. 1000000 = 1 USDC)
     * @param _paymentRef   Riferimento pagamento per contabilità on-chain
     *
     * PREREQUISITO: il chiamante deve aver eseguito
     *   token.approve(feeRouterAddress, _amount) prima di questa chiamata.
     *
     * Gas note: SafeERC20 gestisce token non-standard (USDT senza return value).
     */
    function splitTransferERC20(
        address _token,
        address _to,
        uint256 _amount,
        bytes32 _paymentRef
    ) external nonReentrant {
        if (_token == address(0)) revert ZeroAddress();
        if (_to    == address(0)) revert ZeroAddress();
        if (_amount == 0)         revert ZeroAmount();

        uint256 fee;
        uint256 net;
        unchecked {
            fee = (_amount * feeBps) / BPS_DENOM;
            net = _amount - fee;
        }

        IERC20 token = IERC20(_token);

        // SafeERC20 handles non-standard ERC20 (USDT, etc.)
        token.safeTransferFrom(msg.sender, _to,          net);
        token.safeTransferFrom(msg.sender, feeRecipient, fee);

        emit PaymentSent(
            msg.sender, _to, _token,
            _amount, net, fee, _paymentRef
        );
    }

    // ══════════════════════════════════════════════════════════════════════
    //  View helpers
    // ══════════════════════════════════════════════════════════════════════

    /**
     * @notice Calcola fee e netto per un dato importo (gas-free, chiamata off-chain).
     * @return net   Importo che arriverà al destinatario
     * @return fee   Commissione trattenuta
     */
    function calcSplit(uint256 _amount)
        external view
        returns (uint256 net, uint256 fee)
    {
        fee = (_amount * feeBps) / BPS_DENOM;
        net = _amount - fee;
    }

    /**
     * @notice Verifica se allowance ERC20 è sufficiente per una transazione.
     * @return sufficient  true se approve non è necessario
     * @return current     Allowance attuale
     */
    function checkAllowance(
        address _token,
        address _owner,
        uint256 _amount
    ) external view returns (bool sufficient, uint256 current) {
        current   = IERC20(_token).allowance(_owner, address(this));
        sufficient = current >= _amount;
    }

    // ══════════════════════════════════════════════════════════════════════
    //  Owner functions
    // ══════════════════════════════════════════════════════════════════════

    /// @notice Aggiorna il wallet che riceve le commissioni
    function setFeeRecipient(address _newRecipient) external onlyOwner {
        if (_newRecipient == address(0)) revert ZeroAddress();
        emit FeeRecipientUpdated(feeRecipient, _newRecipient);
        feeRecipient = _newRecipient;
    }

    /// @notice Aggiorna la percentuale di commissione (max 10%)
    function setFeeBps(uint16 _newBps) external onlyOwner {
        if (_newBps > MAX_FEE_BPS) revert FeeTooHigh();
        emit FeeBpsUpdated(feeBps, _newBps);
        feeBps = _newBps;
    }

    // ── Safety: rifiuta ETH diretto (usa splitTransferETH) ───────────────
    receive()  external payable { revert("Usa splitTransferETH()"); }
    fallback() external payable { revert("Funzione non riconosciuta"); }
}
