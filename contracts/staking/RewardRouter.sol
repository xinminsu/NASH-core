// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "../libraries/math/SafeMath.sol";
import "../libraries/token/IERC20.sol";
import "../libraries/token/SafeERC20.sol";
import "../libraries/utils/ReentrancyGuard.sol";
import "../libraries/utils/Address.sol";

import "./interfaces/IRewardTracker.sol";
import "./interfaces/IVester.sol";
import "../tokens/interfaces/IMintable.sol";
import "../tokens/interfaces/IWETH.sol";
import "../core/interfaces/INlpManager.sol";
import "../access/Governable.sol";

contract RewardRouter is ReentrancyGuard, Governable {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;
    using Address for address payable;

    bool public isInitialized;

    address public weth;

    address public nsc;
    address public esNsc;
    address public bnNsc;

    address public nlp; // NSC Liquidity Provider token

    address public stakedNscTracker;
    address public bonusNscTracker;
    address public feeNscTracker;

    address public stakedNlpTracker;
    address public feeNlpTracker;

    address public nlpManager;

    address public nscVester;
    address public nlpVester;

    mapping(address => address) public pendingReceivers;

    event StakeNsc(address account, address token, uint256 amount);
    event UnstakeNsc(address account, address token, uint256 amount);

    event StakeNlp(address account, uint256 amount);
    event UnstakeNlp(address account, uint256 amount);

    receive() external payable {
        require(msg.sender == weth, "Router: invalid sender");
    }

    function initialize(
        address _weth,
        address _nsc,
        address _esNsc,
        address _bnNsc,
        address _nlp,
        address _stakedNscTracker,
        address _bonusNscTracker,
        address _feeNscTracker,
        address _feeNlpTracker,
        address _stakedNlpTracker,
        address _nlpManager,
        address _nscVester,
        address _nlpVester
    ) external onlyGov {
        require(!isInitialized, "RewardRouter: already initialized");
        isInitialized = true;

        weth = _weth;

        nsc = _nsc;
        esNsc = _esNsc;
        bnNsc = _bnNsc;

        nlp = _nlp;

        stakedNscTracker = _stakedNscTracker;
        bonusNscTracker = _bonusNscTracker;
        feeNscTracker = _feeNscTracker;

        feeNlpTracker = _feeNlpTracker;
        stakedNlpTracker = _stakedNlpTracker;

        nlpManager = _nlpManager;

        nscVester = _nscVester;
        nlpVester = _nlpVester;
    }

    // to help users who accidentally send their tokens to this contract
    function withdrawToken(
        address _token,
        address _account,
        uint256 _amount
    ) external onlyGov {
        IERC20(_token).safeTransfer(_account, _amount);
    }

    function batchStakeNscForAccount(
        address[] memory _accounts,
        uint256[] memory _amounts
    ) external nonReentrant onlyGov {
        address _nsc = nsc;
        for (uint256 i = 0; i < _accounts.length; i++) {
            _stakeNsc(msg.sender, _accounts[i], _nsc, _amounts[i]);
        }
    }

    function stakeNscForAccount(
        address _account,
        uint256 _amount
    ) external nonReentrant onlyGov {
        _stakeNsc(msg.sender, _account, nsc, _amount);
    }

    function stakeNsc(uint256 _amount) external nonReentrant {
        _stakeNsc(msg.sender, msg.sender, nsc, _amount);
    }

    function stakeEsNsc(uint256 _amount) external nonReentrant {
        _stakeNsc(msg.sender, msg.sender, esNsc, _amount);
    }

    function unstakeNsc(uint256 _amount) external nonReentrant {
        _unstakeNsc(msg.sender, nsc, _amount, true);
    }

    function unstakeEsNsc(uint256 _amount) external nonReentrant {
        _unstakeNsc(msg.sender, esNsc, _amount, true);
    }

    function mintAndStakeNlp(
        address _token,
        uint256 _amount,
        uint256 _minUsdg,
        uint256 _minNlp
    ) external nonReentrant returns (uint256) {
        require(_amount > 0, "RewardRouter: invalid _amount");

        address account = msg.sender;
        uint256 nlpAmount = INlpManager(nlpManager).addLiquidityForAccount(
            account,
            account,
            _token,
            _amount,
            _minUsdg,
            _minNlp
        );
        IRewardTracker(feeNlpTracker).stakeForAccount(
            account,
            account,
            nlp,
            nlpAmount
        );
        IRewardTracker(stakedNlpTracker).stakeForAccount(
            account,
            account,
            feeNlpTracker,
            nlpAmount
        );

        emit StakeNlp(account, nlpAmount);

        return nlpAmount;
    }

    function mintAndStakeNlpETH(
        uint256 _minUsdg,
        uint256 _minNlp
    ) external payable nonReentrant returns (uint256) {
        require(msg.value > 0, "RewardRouter: invalid msg.value");

        IWETH(weth).deposit{value: msg.value}();
        IERC20(weth).approve(nlpManager, msg.value);

        address account = msg.sender;
        uint256 nlpAmount = INlpManager(nlpManager).addLiquidityForAccount(
            address(this),
            account,
            weth,
            msg.value,
            _minUsdg,
            _minNlp
        );

        IRewardTracker(feeNlpTracker).stakeForAccount(
            account,
            account,
            nlp,
            nlpAmount
        );
        IRewardTracker(stakedNlpTracker).stakeForAccount(
            account,
            account,
            feeNlpTracker,
            nlpAmount
        );

        emit StakeNlp(account, nlpAmount);

        return nlpAmount;
    }

    function unstakeAndRedeemNlp(
        address _tokenOut,
        uint256 _nlpAmount,
        uint256 _minOut,
        address _receiver
    ) external nonReentrant returns (uint256) {
        require(_nlpAmount > 0, "RewardRouter: invalid _nlpAmount");

        address account = msg.sender;
        IRewardTracker(stakedNlpTracker).unstakeForAccount(
            account,
            feeNlpTracker,
            _nlpAmount,
            account
        );
        IRewardTracker(feeNlpTracker).unstakeForAccount(
            account,
            nlp,
            _nlpAmount,
            account
        );
        uint256 amountOut = INlpManager(nlpManager).removeLiquidityForAccount(
            account,
            _tokenOut,
            _nlpAmount,
            _minOut,
            _receiver
        );

        emit UnstakeNlp(account, _nlpAmount);

        return amountOut;
    }

    function unstakeAndRedeemNlpETH(
        uint256 _nlpAmount,
        uint256 _minOut,
        address payable _receiver
    ) external nonReentrant returns (uint256) {
        require(_nlpAmount > 0, "RewardRouter: invalid _nlpAmount");

        address account = msg.sender;
        IRewardTracker(stakedNlpTracker).unstakeForAccount(
            account,
            feeNlpTracker,
            _nlpAmount,
            account
        );
        IRewardTracker(feeNlpTracker).unstakeForAccount(
            account,
            nlp,
            _nlpAmount,
            account
        );
        uint256 amountOut = INlpManager(nlpManager).removeLiquidityForAccount(
            account,
            weth,
            _nlpAmount,
            _minOut,
            address(this)
        );

        IWETH(weth).withdraw(amountOut);

        _receiver.sendValue(amountOut);

        emit UnstakeNlp(account, _nlpAmount);

        return amountOut;
    }

    function claim() external nonReentrant {
        address account = msg.sender;

        IRewardTracker(feeNscTracker).claimForAccount(account, account);
        IRewardTracker(feeNlpTracker).claimForAccount(account, account);

        IRewardTracker(stakedNscTracker).claimForAccount(account, account);
        IRewardTracker(stakedNlpTracker).claimForAccount(account, account);
    }

    function claimEsNsc() external nonReentrant {
        address account = msg.sender;

        IRewardTracker(stakedNscTracker).claimForAccount(account, account);
        IRewardTracker(stakedNlpTracker).claimForAccount(account, account);
    }

    function claimFees() external nonReentrant {
        address account = msg.sender;

        IRewardTracker(feeNscTracker).claimForAccount(account, account);
        IRewardTracker(feeNlpTracker).claimForAccount(account, account);
    }

    function compound() external nonReentrant {
        _compound(msg.sender);
    }

    function compoundForAccount(
        address _account
    ) external nonReentrant onlyGov {
        _compound(_account);
    }

    function handleRewards(
        bool _shouldClaimNsc,
        bool _shouldStakeNsc,
        bool _shouldClaimEsNsc,
        bool _shouldStakeEsNsc,
        bool _shouldStakeMultiplierPoints,
        bool _shouldClaimWeth,
        bool _shouldConvertWethToEth
    ) external nonReentrant {
        address account = msg.sender;

        uint256 nscAmount = 0;
        if (_shouldClaimNsc) {
            uint256 nscAmount0 = IVester(nscVester).claimForAccount(
                account,
                account
            );
            uint256 nscAmount1 = IVester(nlpVester).claimForAccount(
                account,
                account
            );
            nscAmount = nscAmount0.add(nscAmount1);
        }

        if (_shouldStakeNsc && nscAmount > 0) {
            _stakeNsc(account, account, nsc, nscAmount);
        }

        uint256 esNscAmount = 0;
        if (_shouldClaimEsNsc) {
            uint256 esNscAmount0 = IRewardTracker(stakedNscTracker)
                .claimForAccount(account, account);
            uint256 esNscAmount1 = IRewardTracker(stakedNlpTracker)
                .claimForAccount(account, account);
            esNscAmount = esNscAmount0.add(esNscAmount1);
        }

        if (_shouldStakeEsNsc && esNscAmount > 0) {
            _stakeNsc(account, account, esNsc, esNscAmount);
        }

        if (_shouldStakeMultiplierPoints) {
            uint256 bnNscAmount = IRewardTracker(bonusNscTracker)
                .claimForAccount(account, account);
            if (bnNscAmount > 0) {
                IRewardTracker(feeNscTracker).stakeForAccount(
                    account,
                    account,
                    bnNsc,
                    bnNscAmount
                );
            }
        }

        if (_shouldClaimWeth) {
            if (_shouldConvertWethToEth) {
                uint256 weth0 = IRewardTracker(feeNscTracker).claimForAccount(
                    account,
                    address(this)
                );
                uint256 weth1 = IRewardTracker(feeNlpTracker).claimForAccount(
                    account,
                    address(this)
                );

                uint256 wethAmount = weth0.add(weth1);
                IWETH(weth).withdraw(wethAmount);

                payable(account).sendValue(wethAmount);
            } else {
                IRewardTracker(feeNscTracker).claimForAccount(account, account);
                IRewardTracker(feeNlpTracker).claimForAccount(account, account);
            }
        }
    }

    function batchCompoundForAccounts(
        address[] memory _accounts
    ) external nonReentrant onlyGov {
        for (uint256 i = 0; i < _accounts.length; i++) {
            _compound(_accounts[i]);
        }
    }

    function signalTransfer(address _receiver) external nonReentrant {
        require(
            IERC20(nscVester).balanceOf(msg.sender) == 0,
            "RewardRouter: sender has vested tokens"
        );
        require(
            IERC20(nlpVester).balanceOf(msg.sender) == 0,
            "RewardRouter: sender has vested tokens"
        );

        _validateReceiver(_receiver);
        pendingReceivers[msg.sender] = _receiver;
    }

    function acceptTransfer(address _sender) external nonReentrant {
        require(
            IERC20(nscVester).balanceOf(_sender) == 0,
            "RewardRouter: sender has vested tokens"
        );
        require(
            IERC20(nlpVester).balanceOf(_sender) == 0,
            "RewardRouter: sender has vested tokens"
        );

        address receiver = msg.sender;
        require(
            pendingReceivers[_sender] == receiver,
            "RewardRouter: transfer not signalled"
        );
        delete pendingReceivers[_sender];

        _validateReceiver(receiver);
        _compound(_sender);

        uint256 stakedNsc = IRewardTracker(stakedNscTracker).depositBalances(
            _sender,
            nsc
        );
        if (stakedNsc > 0) {
            _unstakeNsc(_sender, nsc, stakedNsc, false);
            _stakeNsc(_sender, receiver, nsc, stakedNsc);
        }

        uint256 stakedEsNsc = IRewardTracker(stakedNscTracker).depositBalances(
            _sender,
            esNsc
        );
        if (stakedEsNsc > 0) {
            _unstakeNsc(_sender, esNsc, stakedEsNsc, false);
            _stakeNsc(_sender, receiver, esNsc, stakedEsNsc);
        }

        uint256 stakedBnNsc = IRewardTracker(feeNscTracker).depositBalances(
            _sender,
            bnNsc
        );
        if (stakedBnNsc > 0) {
            IRewardTracker(feeNscTracker).unstakeForAccount(
                _sender,
                bnNsc,
                stakedBnNsc,
                _sender
            );
            IRewardTracker(feeNscTracker).stakeForAccount(
                _sender,
                receiver,
                bnNsc,
                stakedBnNsc
            );
        }

        uint256 esNscBalance = IERC20(esNsc).balanceOf(_sender);
        if (esNscBalance > 0) {
            IERC20(esNsc).transferFrom(_sender, receiver, esNscBalance);
        }

        uint256 nlpAmount = IRewardTracker(feeNlpTracker).depositBalances(
            _sender,
            nlp
        );
        if (nlpAmount > 0) {
            IRewardTracker(stakedNlpTracker).unstakeForAccount(
                _sender,
                feeNlpTracker,
                nlpAmount,
                _sender
            );
            IRewardTracker(feeNlpTracker).unstakeForAccount(
                _sender,
                nlp,
                nlpAmount,
                _sender
            );

            IRewardTracker(feeNlpTracker).stakeForAccount(
                _sender,
                receiver,
                nlp,
                nlpAmount
            );
            IRewardTracker(stakedNlpTracker).stakeForAccount(
                receiver,
                receiver,
                feeNlpTracker,
                nlpAmount
            );
        }

        IVester(nscVester).transferStakeValues(_sender, receiver);
        IVester(nlpVester).transferStakeValues(_sender, receiver);
    }

    function _validateReceiver(address _receiver) private view {
        require(
            IRewardTracker(stakedNscTracker).averageStakedAmounts(_receiver) ==
                0,
            "RewardRouter: stakedNscTracker.averageStakedAmounts > 0"
        );
        require(
            IRewardTracker(stakedNscTracker).cumulativeRewards(_receiver) == 0,
            "RewardRouter: stakedNscTracker.cumulativeRewards > 0"
        );

        require(
            IRewardTracker(bonusNscTracker).averageStakedAmounts(_receiver) ==
                0,
            "RewardRouter: bonusNscTracker.averageStakedAmounts > 0"
        );
        require(
            IRewardTracker(bonusNscTracker).cumulativeRewards(_receiver) == 0,
            "RewardRouter: bonusNscTracker.cumulativeRewards > 0"
        );

        require(
            IRewardTracker(feeNscTracker).averageStakedAmounts(_receiver) == 0,
            "RewardRouter: feeNscTracker.averageStakedAmounts > 0"
        );
        require(
            IRewardTracker(feeNscTracker).cumulativeRewards(_receiver) == 0,
            "RewardRouter: feeNscTracker.cumulativeRewards > 0"
        );

        require(
            IVester(nscVester).transferredAverageStakedAmounts(_receiver) == 0,
            "RewardRouter: nscVester.transferredAverageStakedAmounts > 0"
        );
        require(
            IVester(nscVester).transferredCumulativeRewards(_receiver) == 0,
            "RewardRouter: nscVester.transferredCumulativeRewards > 0"
        );

        require(
            IRewardTracker(stakedNlpTracker).averageStakedAmounts(_receiver) ==
                0,
            "RewardRouter: stakedNlpTracker.averageStakedAmounts > 0"
        );
        require(
            IRewardTracker(stakedNlpTracker).cumulativeRewards(_receiver) == 0,
            "RewardRouter: stakedNlpTracker.cumulativeRewards > 0"
        );

        require(
            IRewardTracker(feeNlpTracker).averageStakedAmounts(_receiver) == 0,
            "RewardRouter: feeNlpTracker.averageStakedAmounts > 0"
        );
        require(
            IRewardTracker(feeNlpTracker).cumulativeRewards(_receiver) == 0,
            "RewardRouter: feeNlpTracker.cumulativeRewards > 0"
        );

        require(
            IVester(nlpVester).transferredAverageStakedAmounts(_receiver) == 0,
            "RewardRouter: nscVester.transferredAverageStakedAmounts > 0"
        );
        require(
            IVester(nlpVester).transferredCumulativeRewards(_receiver) == 0,
            "RewardRouter: nscVester.transferredCumulativeRewards > 0"
        );

        require(
            IERC20(nscVester).balanceOf(_receiver) == 0,
            "RewardRouter: nscVester.balance > 0"
        );
        require(
            IERC20(nlpVester).balanceOf(_receiver) == 0,
            "RewardRouter: nlpVester.balance > 0"
        );
    }

    function _compound(address _account) private {
        _compoundNsc(_account);
        _compoundNlp(_account);
    }

    function _compoundNsc(address _account) private {
        uint256 esNscAmount = IRewardTracker(stakedNscTracker).claimForAccount(
            _account,
            _account
        );
        if (esNscAmount > 0) {
            _stakeNsc(_account, _account, esNsc, esNscAmount);
        }

        uint256 bnNscAmount = IRewardTracker(bonusNscTracker).claimForAccount(
            _account,
            _account
        );
        if (bnNscAmount > 0) {
            IRewardTracker(feeNscTracker).stakeForAccount(
                _account,
                _account,
                bnNsc,
                bnNscAmount
            );
        }
    }

    function _compoundNlp(address _account) private {
        uint256 esNscAmount = IRewardTracker(stakedNlpTracker).claimForAccount(
            _account,
            _account
        );
        if (esNscAmount > 0) {
            _stakeNsc(_account, _account, esNsc, esNscAmount);
        }
    }

    function _stakeNsc(
        address _fundingAccount,
        address _account,
        address _token,
        uint256 _amount
    ) private {
        require(_amount > 0, "RewardRouter: invalid _amount");

        IRewardTracker(stakedNscTracker).stakeForAccount(
            _fundingAccount,
            _account,
            _token,
            _amount
        );
        IRewardTracker(bonusNscTracker).stakeForAccount(
            _account,
            _account,
            stakedNscTracker,
            _amount
        );
        IRewardTracker(feeNscTracker).stakeForAccount(
            _account,
            _account,
            bonusNscTracker,
            _amount
        );

        emit StakeNsc(_account, _token, _amount);
    }

    function _unstakeNsc(
        address _account,
        address _token,
        uint256 _amount,
        bool _shouldReduceBnNsc
    ) private {
        require(_amount > 0, "RewardRouter: invalid _amount");

        uint256 balance = IRewardTracker(stakedNscTracker).stakedAmounts(
            _account
        );

        IRewardTracker(feeNscTracker).unstakeForAccount(
            _account,
            bonusNscTracker,
            _amount,
            _account
        );
        IRewardTracker(bonusNscTracker).unstakeForAccount(
            _account,
            stakedNscTracker,
            _amount,
            _account
        );
        IRewardTracker(stakedNscTracker).unstakeForAccount(
            _account,
            _token,
            _amount,
            _account
        );

        if (_shouldReduceBnNsc) {
            uint256 bnNscAmount = IRewardTracker(bonusNscTracker)
                .claimForAccount(_account, _account);
            if (bnNscAmount > 0) {
                IRewardTracker(feeNscTracker).stakeForAccount(
                    _account,
                    _account,
                    bnNsc,
                    bnNscAmount
                );
            }

            uint256 stakedBnNsc = IRewardTracker(feeNscTracker).depositBalances(
                _account,
                bnNsc
            );
            if (stakedBnNsc > 0) {
                uint256 reductionAmount = stakedBnNsc.mul(_amount).div(balance);
                IRewardTracker(feeNscTracker).unstakeForAccount(
                    _account,
                    bnNsc,
                    reductionAmount,
                    _account
                );
                IMintable(bnNsc).burn(_account, reductionAmount);
            }
        }

        emit UnstakeNsc(_account, _token, _amount);
    }
}
