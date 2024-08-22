// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../access/Governable.sol";
import "../peripherals/interfaces/ITimelock.sol";

contract RewardManager is Governable {
    bool public isInitialized;

    ITimelock public timelock;
    address public rewardRouter;

    address public nlpManager;

    address public stakedNscTracker;
    address public bonusNscTracker;
    address public feeNscTracker;

    address public feeNlpTracker;
    address public stakedNlpTracker;

    address public stakedNscDistributor;
    address public stakedNlpDistributor;

    address public esNsc;
    address public bnNsc;

    address public nscVester;
    address public nlpVester;

    function initialize(
        ITimelock _timelock,
        address _rewardRouter,
        address _nlpManager,
        address _stakedNscTracker,
        address _bonusNscTracker,
        address _feeNscTracker,
        address _feeNlpTracker,
        address _stakedNlpTracker,
        address _stakedNscDistributor,
        address _stakedNlpDistributor,
        address _esNsc,
        address _bnNsc,
        address _nscVester,
        address _nlpVester
    ) external onlyGov {
        require(!isInitialized, "RewardManager: already initialized");
        isInitialized = true;

        timelock = _timelock;
        rewardRouter = _rewardRouter;

        nlpManager = _nlpManager;

        stakedNscTracker = _stakedNscTracker;
        bonusNscTracker = _bonusNscTracker;
        feeNscTracker = _feeNscTracker;

        feeNlpTracker = _feeNlpTracker;
        stakedNlpTracker = _stakedNlpTracker;

        stakedNscDistributor = _stakedNscDistributor;
        stakedNlpDistributor = _stakedNlpDistributor;

        esNsc = _esNsc;
        bnNsc = _bnNsc;

        nscVester = _nscVester;
        nlpVester = _nlpVester;
    }

    function updateEsNscHandlers() external onlyGov {
        timelock.managedSetHandler(esNsc, rewardRouter, true);
        timelock.managedSetHandler(esNsc, stakedNscDistributor, true);
        timelock.managedSetHandler(esNsc, stakedNlpDistributor, true);
        timelock.managedSetHandler(esNsc, stakedNscTracker, true);
        timelock.managedSetHandler(esNsc, stakedNlpTracker, true);
        timelock.managedSetHandler(esNsc, nscVester, true);
        timelock.managedSetHandler(esNsc, nlpVester, true);
    }

    function enableRewardRouter() external onlyGov {
        timelock.managedSetHandler(nlpManager, rewardRouter, true);

        timelock.managedSetHandler(stakedNscTracker, rewardRouter, true);
        timelock.managedSetHandler(bonusNscTracker, rewardRouter, true);
        timelock.managedSetHandler(feeNscTracker, rewardRouter, true);

        timelock.managedSetHandler(feeNlpTracker, rewardRouter, true);
        timelock.managedSetHandler(stakedNlpTracker, rewardRouter, true);

        timelock.managedSetHandler(esNsc, rewardRouter, true);

        timelock.managedSetMinter(bnNsc, rewardRouter, true);

        timelock.managedSetMinter(esNsc, nscVester, true);
        timelock.managedSetMinter(esNsc, nlpVester, true);

        timelock.managedSetHandler(nscVester, rewardRouter, true);
        timelock.managedSetHandler(nlpVester, rewardRouter, true);

        timelock.managedSetHandler(feeNscTracker, nscVester, true);
        timelock.managedSetHandler(stakedNlpTracker, nlpVester, true);
    }
}
