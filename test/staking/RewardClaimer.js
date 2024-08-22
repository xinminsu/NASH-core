const { expect, use } = require("chai");
const { solidity } = require("ethereum-waffle");
const { deployContract } = require("../shared/fixtures");
const {
  expandDecimals,
  getBlockTime,
  increaseTime,
  mineBlock,
  reportGasUsed,
} = require("../shared/utilities");
const { toChainlinkPrice } = require("../shared/chainlink");
const { toUsd, toNormalizedPrice } = require("../shared/units");

use(solidity);

describe("RewardClaimer", function () {
  const provider = waffle.provider;
  const [wallet, user0, user1, user2, user3] = provider.getWallets();
  let rewardClaimer;
  let nsc;
  let esNsc;
  let rewardDistributor;

  beforeEach(async () => {
    nsc = await deployContract("NSC", []);
    esNsc = await deployContract("EsNSC", []);
    rewardClaimer = await deployContract("RewardClaimer", [
      [nsc.address, esNsc.address],
    ]);
  });

  it("inits", async () => {
    expect(await rewardClaimer.isClaimableToken(wallet.address)).eq(false);
    expect(await rewardClaimer.isClaimableToken(nsc.address)).eq(true);
    expect(await rewardClaimer.isClaimableToken(esNsc.address)).eq(true);
  });

  it("setClaimableToken", async () => {
    await expect(
      rewardClaimer.connect(user0).setClaimableToken(user1.address, true)
    ).to.be.revertedWith("Governable: forbidden");

    await rewardClaimer.setGov(user0.address);

    expect(await rewardClaimer.isClaimableToken(user1.address)).eq(false);
    await rewardClaimer.connect(user0).setClaimableToken(user1.address, true);
    expect(await rewardClaimer.isClaimableToken(user1.address)).eq(true);
    await rewardClaimer.connect(user0).setClaimableToken(user1.address, false);
    expect(await rewardClaimer.isClaimableToken(user1.address)).eq(false);
  });

  it("setHandler", async () => {
    await expect(
      rewardClaimer.connect(user0).setHandler(user1.address, true)
    ).to.be.revertedWith("Governable: forbidden");

    await rewardClaimer.setGov(user0.address);

    expect(await rewardClaimer.isHandler(user1.address)).eq(false);
    await rewardClaimer.connect(user0).setHandler(user1.address, true);
    expect(await rewardClaimer.isHandler(user1.address)).eq(true);
  });

  it("withdrawToken", async () => {
    await nsc.setMinter(wallet.address, true);
    await nsc.mint(rewardClaimer.address, 2000);
    await expect(
      rewardClaimer
        .connect(user0)
        .withdrawToken(nsc.address, user1.address, 2000)
    ).to.be.revertedWith("Governable: forbidden");

    await rewardClaimer.setGov(user0.address);

    expect(await nsc.balanceOf(user1.address)).eq(0);
    await rewardClaimer
      .connect(user0)
      .withdrawToken(nsc.address, user1.address, 2000);
    expect(await nsc.balanceOf(user1.address)).eq(2000);
  });

  it("increase, decrease, claim", async () => {
    await expect(
      rewardClaimer.increaseClaimableAmounts(esNsc.address, [user1.address], [])
    ).to.be.revertedWith("RewardClaimer: invalid param");

    await expect(
      rewardClaimer.increaseClaimableAmounts(
        esNsc.address,
        [user1.address],
        [expandDecimals(1, 18)]
      )
    ).to.be.revertedWith("RewardClaimer: forbidden");

    await rewardClaimer.setHandler(wallet.address, true);

    await esNsc.setMinter(wallet.address, true);
    await esNsc.mint(rewardClaimer.address, expandDecimals(1000, 18));

    await nsc.setMinter(wallet.address, true);
    await nsc.mint(rewardClaimer.address, expandDecimals(1000, 18));

    await rewardClaimer.increaseClaimableAmounts(
      esNsc.address,
      [user1.address, user2.address],
      [expandDecimals(1, 18), expandDecimals(2, 18)]
    );

    expect(
      await rewardClaimer.claimableAmount(user1.address, esNsc.address)
    ).eq(expandDecimals(1, 18));

    expect(
      await rewardClaimer.claimableAmount(user2.address, esNsc.address)
    ).eq(expandDecimals(2, 18));

    expect(await rewardClaimer.getWithdrawableAmount(esNsc.address)).eq(
      expandDecimals(997, 18)
    );

    await rewardClaimer.decreaseClaimableAmounts(
      esNsc.address,
      [user1.address, user2.address],
      [expandDecimals(1, 18), expandDecimals(1, 18)]
    );

    expect(
      await rewardClaimer.claimableAmount(user1.address, esNsc.address)
    ).eq(0);

    expect(
      await rewardClaimer.claimableAmount(user2.address, esNsc.address)
    ).eq(expandDecimals(1, 18));

    expect(await rewardClaimer.getWithdrawableAmount(esNsc.address)).eq(
      expandDecimals(999, 18)
    );

    await rewardClaimer.connect(user2).claim(user2.address, [esNsc.address]);
    expect(await esNsc.balanceOf(user2.address)).eq(expandDecimals(1, 18));

    expect(
      await rewardClaimer.claimableAmount(user2.address, esNsc.address)
    ).eq(0);

    expect(await rewardClaimer.getWithdrawableAmount(esNsc.address)).eq(
      expandDecimals(999, 18)
    );
  });

  it("increase, claimForAccount", async () => {
    await rewardClaimer.setHandler(wallet.address, true);

    await nsc.setMinter(wallet.address, true);
    await nsc.mint(rewardClaimer.address, expandDecimals(1000, 18));

    await rewardClaimer.increaseClaimableAmounts(
      nsc.address,
      [user1.address, user2.address],
      [expandDecimals(1, 18), expandDecimals(2, 18)]
    );

    expect(await rewardClaimer.claimableAmount(user1.address, nsc.address)).eq(
      expandDecimals(1, 18)
    );

    expect(await rewardClaimer.getWithdrawableAmount(nsc.address)).eq(
      expandDecimals(997, 18)
    );

    await rewardClaimer.claimForAccount(user1.address, user2.address, [
      nsc.address,
    ]);

    expect(await rewardClaimer.claimableAmount(user2.address, nsc.address)).eq(
      expandDecimals(2, 18)
    );
    expect(await rewardClaimer.claimableAmount(user1.address, nsc.address)).eq(
      0
    );

    expect(await nsc.balanceOf(user2.address)).eq(expandDecimals(1, 18));
    expect(await nsc.balanceOf(user1.address)).eq(0);
  });
});
