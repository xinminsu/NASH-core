const { expect, use } = require("chai");
const { solidity } = require("ethereum-waffle");
const { deployContract } = require("../shared/fixtures");
const {
  expandDecimals,
  getBlockTime,
  increaseTime,
  mineBlock,
  reportGasUsed,
  print,
} = require("../shared/utilities");
const { toChainlinkPrice } = require("../shared/chainlink");
const { toUsd, toNormalizedPrice } = require("../shared/units");

use(solidity);

describe("BonusDistributor", function () {
  const provider = waffle.provider;
  const [wallet, rewardRouter, user0, user1, user2, user3] =
    provider.getWallets();
  let nsc;
  let esNsc;
  let bnNsc;
  let stakedNscTracker;
  let stakedNscDistributor;
  let bonusNscTracker;
  let bonusNscDistributor;

  beforeEach(async () => {
    nsc = await deployContract("NSC", []);
    esNsc = await deployContract("EsNSC", []);
    bnNsc = await deployContract("MintableBaseToken", [
      "Bonus NSC",
      "bnNSC",
      0,
    ]);

    stakedNscTracker = await deployContract("RewardTracker", [
      "Staked NSC",
      "stNSC",
    ]);
    stakedNscDistributor = await deployContract("RewardDistributor", [
      esNsc.address,
      stakedNscTracker.address,
    ]);
    await stakedNscDistributor.updateLastDistributionTime();

    bonusNscTracker = await deployContract("RewardTracker", [
      "Staked + Bonus NSC",
      "sbNSC",
    ]);
    bonusNscDistributor = await deployContract("BonusDistributor", [
      bnNsc.address,
      bonusNscTracker.address,
    ]);
    await bonusNscDistributor.updateLastDistributionTime();

    await stakedNscTracker.initialize(
      [nsc.address, esNsc.address],
      stakedNscDistributor.address
    );
    await bonusNscTracker.initialize(
      [stakedNscTracker.address],
      bonusNscDistributor.address
    );

    await stakedNscTracker.setInPrivateTransferMode(true);
    await stakedNscTracker.setInPrivateStakingMode(true);
    await bonusNscTracker.setInPrivateTransferMode(true);
    await bonusNscTracker.setInPrivateStakingMode(true);

    await stakedNscTracker.setHandler(rewardRouter.address, true);
    await stakedNscTracker.setHandler(bonusNscTracker.address, true);
    await bonusNscTracker.setHandler(rewardRouter.address, true);
    await bonusNscDistributor.setBonusMultiplier(10000);
  });

  it("distributes bonus", async () => {
    await esNsc.setMinter(wallet.address, true);
    await esNsc.mint(stakedNscDistributor.address, expandDecimals(50000, 18));
    await bnNsc.setMinter(wallet.address, true);
    await bnNsc.mint(bonusNscDistributor.address, expandDecimals(1500, 18));
    await stakedNscDistributor.setTokensPerInterval("20667989410000000"); // 0.02066798941 esNsc per second
    await nsc.setMinter(wallet.address, true);
    await nsc.mint(user0.address, expandDecimals(1000, 18));

    await nsc
      .connect(user0)
      .approve(stakedNscTracker.address, expandDecimals(1001, 18));
    await expect(
      stakedNscTracker
        .connect(rewardRouter)
        .stakeForAccount(
          user0.address,
          user0.address,
          nsc.address,
          expandDecimals(1001, 18)
        )
    ).to.be.revertedWith("BaseToken: transfer amount exceeds balance");
    await stakedNscTracker
      .connect(rewardRouter)
      .stakeForAccount(
        user0.address,
        user0.address,
        nsc.address,
        expandDecimals(1000, 18)
      );
    await expect(
      bonusNscTracker
        .connect(rewardRouter)
        .stakeForAccount(
          user0.address,
          user0.address,
          stakedNscTracker.address,
          expandDecimals(1001, 18)
        )
    ).to.be.revertedWith("RewardTracker: transfer amount exceeds balance");
    await bonusNscTracker
      .connect(rewardRouter)
      .stakeForAccount(
        user0.address,
        user0.address,
        stakedNscTracker.address,
        expandDecimals(1000, 18)
      );

    await increaseTime(provider, 24 * 60 * 60);
    await mineBlock(provider);

    expect(await stakedNscTracker.claimable(user0.address)).gt(
      expandDecimals(1785, 18)
    ); // 50000 / 28 => ~1785
    expect(await stakedNscTracker.claimable(user0.address)).lt(
      expandDecimals(1786, 18)
    );
    expect(await bonusNscTracker.claimable(user0.address)).gt(
      "2730000000000000000"
    ); // 2.73, 1000 / 365 => ~2.74
    expect(await bonusNscTracker.claimable(user0.address)).lt(
      "2750000000000000000"
    ); // 2.75

    await esNsc.mint(user1.address, expandDecimals(500, 18));
    await esNsc
      .connect(user1)
      .approve(stakedNscTracker.address, expandDecimals(500, 18));
    await stakedNscTracker
      .connect(rewardRouter)
      .stakeForAccount(
        user1.address,
        user1.address,
        esNsc.address,
        expandDecimals(500, 18)
      );
    await bonusNscTracker
      .connect(rewardRouter)
      .stakeForAccount(
        user1.address,
        user1.address,
        stakedNscTracker.address,
        expandDecimals(500, 18)
      );

    await increaseTime(provider, 24 * 60 * 60);
    await mineBlock(provider);

    expect(await stakedNscTracker.claimable(user0.address)).gt(
      expandDecimals(1785 + 1190, 18)
    );
    expect(await stakedNscTracker.claimable(user0.address)).lt(
      expandDecimals(1786 + 1191, 18)
    );

    expect(await stakedNscTracker.claimable(user1.address)).gt(
      expandDecimals(595, 18)
    );
    expect(await stakedNscTracker.claimable(user1.address)).lt(
      expandDecimals(596, 18)
    );

    expect(await bonusNscTracker.claimable(user0.address)).gt(
      "5470000000000000000"
    ); // 5.47, 1000 / 365 * 2 => ~5.48
    expect(await bonusNscTracker.claimable(user0.address)).lt(
      "5490000000000000000"
    ); // 5.49

    expect(await bonusNscTracker.claimable(user1.address)).gt(
      "1360000000000000000"
    ); // 1.36, 500 / 365 => ~1.37
    expect(await bonusNscTracker.claimable(user1.address)).lt(
      "1380000000000000000"
    ); // 1.38
  });
});
