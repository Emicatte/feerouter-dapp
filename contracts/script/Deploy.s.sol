// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/FeeRouter.sol";

contract DeployFeeRouter is Script {
    function run() external {
        uint256 deployerKey  = vm.envUint("PRIVATE_KEY");
        address feeRecipient = vm.envAddress("FEE_RECIPIENT");
        address owner        = vm.envAddress("OWNER_ADDRESS");

        vm.startBroadcast(deployerKey);
        FeeRouter router = new FeeRouter(feeRecipient, 50, owner);
        console.log("FeeRouter deployed at:", address(router));
        vm.stopBroadcast();
    }
}
