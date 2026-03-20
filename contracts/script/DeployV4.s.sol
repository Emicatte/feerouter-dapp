// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/FeeRouterV4.sol";

/**
 * Deploy FeeRouterV4
 *
 * Base Mainnet (8453):
 *   forge script script/DeployV4.s.sol --rpc-url https://mainnet.base.org --broadcast --private-key $PRIVATE_KEY
 *
 * Ethereum Mainnet (1):
 *   forge script script/DeployV4.s.sol --rpc-url https://eth-mainnet.g.alchemy.com/v2/$ALCHEMY_KEY --broadcast --private-key $PRIVATE_KEY
 *
 * Base Sepolia (84532):
 *   forge script script/DeployV4.s.sol --rpc-url https://sepolia.base.org --broadcast --private-key $PRIVATE_KEY
 */
contract DeployFeeRouterV4 is Script {

    // ── Indirizzi per chain ────────────────────────────────────────────────
    // Permit2 — stesso indirizzo su tutte le chain (Uniswap deploy deterministico)
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    // Uniswap V3 SwapRouter02 — stesso su Mainnet + Base
    address constant SWAP_ROUTER = 0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45;

    // WETH per chain
    address constant WETH_MAINNET = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address constant WETH_BASE    = 0x4200000000000000000000000000000000000006;
    address constant WETH_SEPOLIA = 0x4200000000000000000000000000000000000006;

    // Token Base Mainnet
    address constant USDC_BASE  = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant USDT_BASE  = 0xfde4C96256153236aF98292015bA958c14714C22;
    address constant EURC_BASE  = 0x60a3E35Cc3064fC371f477011b3E9dd2313ec445;
    address constant cbBTC_BASE = 0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf;
    address constant DEGEN_BASE = 0x4eDBc9320305298056041910220E3663A92540B6;
    address constant WETH_TOKEN_BASE = 0x4200000000000000000000000000000000000006;

    // Token Ethereum Mainnet
    address constant USDC_ETH  = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;
    address constant USDT_ETH  = 0xdAC17F958D2ee523a2206206994597C13D831ec7;
    address constant EURC_ETH  = 0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c;
    address constant WBTC_ETH  = 0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599;
    address constant WETH_TOKEN_ETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;

    function run() external {
        uint256 deployerKey  = vm.envUint("PRIVATE_KEY");
        address deployerAddr = vm.addr(deployerKey);
        uint256 chainId      = block.chainid;

        vm.startBroadcast(deployerKey);

        // Seleziona WETH per chain
        address weth;
        if      (chainId == 1)     weth = WETH_MAINNET;
        else if (chainId == 8453)  weth = WETH_BASE;
        else                       weth = WETH_SEPOLIA;

        FeeRouterV4 router = new FeeRouterV4(
            PERMIT2,
            deployerAddr,  // TREASURY_VAULT
            deployerAddr,  // ORACLE_SIGNER (da aggiornare con indirizzo backend)
            SWAP_ROUTER,
            weth,
            50,            // 0.5% fee
            deployerAddr   // OWNER
        );

        console.log("FeeRouterV4 deployed:", address(router));
        console.log("Chain ID:", chainId);
        console.log("WETH:", weth);

        // ── Allowlist token per chain ──────────────────────────────────────
        address[] memory tokens;
        bool[]    memory allowed;

        if (chainId == 8453) {
            // Base Mainnet
            tokens  = new address[](6);
            allowed = new bool[](6);
            tokens[0] = USDC_BASE;  allowed[0] = true;
            tokens[1] = USDT_BASE;  allowed[1] = true;
            tokens[2] = EURC_BASE;  allowed[2] = true;
            tokens[3] = cbBTC_BASE; allowed[3] = true;
            tokens[4] = DEGEN_BASE; allowed[4] = true;
            tokens[5] = WETH_TOKEN_BASE; allowed[5] = true;

            // Pool fee overrides per Base
            router.setPoolFeeOverride(WETH_TOKEN_BASE, USDC_BASE,  500);  // ETH/USDC 0.05%
            router.setPoolFeeOverride(WETH_TOKEN_BASE, cbBTC_BASE, 3000); // ETH/cbBTC 0.3%
            router.setPoolFeeOverride(USDC_BASE, EURC_BASE, 100);         // USDC/EURC 0.01%

        } else if (chainId == 1) {
            // Ethereum Mainnet
            tokens  = new address[](5);
            allowed = new bool[](5);
            tokens[0] = USDC_ETH;  allowed[0] = true;
            tokens[1] = USDT_ETH;  allowed[1] = true;
            tokens[2] = EURC_ETH;  allowed[2] = true;
            tokens[3] = WBTC_ETH;  allowed[3] = true;
            tokens[4] = WETH_TOKEN_ETH; allowed[4] = true;

            // Pool fee overrides per Ethereum
            router.setPoolFeeOverride(WETH_TOKEN_ETH, USDC_ETH, 500);
            router.setPoolFeeOverride(WETH_TOKEN_ETH, WBTC_ETH, 3000);
            router.setPoolFeeOverride(USDC_ETH, EURC_ETH, 100);

        } else {
            // Sepolia — token mock
            tokens  = new address[](1);
            allowed = new bool[](1);
            tokens[0] = WETH_SEPOLIA;
            allowed[0] = true;
        }

        router.setTokensAllowed(tokens, allowed);
        console.log("Tokens allowlisted:", tokens.length);

        vm.stopBroadcast();
    }
}
