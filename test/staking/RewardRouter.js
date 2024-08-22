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
  newWallet,
} = require("../shared/utilities");
const { toChainlinkPrice } = require("../shared/chainlink");
const { toUsd, toNormalizedPrice } = require("../shared/units");
const {
  initVault,
  getBnbConfig,
  getBtcConfig,
  getDaiConfig,
} = require("../core/Vault/helpers");
const { ADDRESS_ZERO } = require("@uniswap/v3-sdk");

use(solidity);

describe("RewardRouter", function () {
  const provider = waffle.provider;
  const [wallet, user0, user1, user2, user3, user4, tokenManager] =
    provider.getWallets();

  const vestingDuration = 365 * 24 * 60 * 60;

  let timelock;
  let rewardManager;

  let vault;
  let nlpManager;
  let nlp;
  let usdg;
  let router;
  let vaultPriceFeed;
  let bnb;
  let bnbPriceFeed;
  let btc;
  let btcPriceFeed;
  let eth;
  let ethPriceFeed;
  let dai;
  let daiPriceFeed;
  let busd;
  let busdPriceFeed;

  let nsc;
  let esNsc;
  let bnNsc;

  let stakedNscTracker;
  let stakedNscDistributor;
  let bonusNscTracker;
  let bonusNscDistributor;
  let feeNscTracker;
  let feeNscDistributor;

  let feeNlpTracker;
  let feeNlpDistributor;
  let stakedNlpTracker;
  let stakedNlpDistributor;

  let nscVester;
  let nlpVester;

  let rewardRouter;

  beforeEach(async () => {
    rewardManager = await deployContract("RewardManager", []);

    bnb = await deployContract("Token", []);
    bnbPriceFeed = await deployContract("PriceFeed", []);

    btc = await deployContract("Token", []);
    btcPriceFeed = await deployContract("PriceFeed", []);

    eth = await deployContract("Token", []);
    ethPriceFeed = await deployContract("PriceFeed", []);

    dai = await deployContract("Token", []);
    daiPriceFeed = await deployContract("PriceFeed", []);

    busd = await deployContract("Token", []);
    busdPriceFeed = await deployContract("PriceFeed", []);

    vault = await deployContract("Vault", []);
    usdg = await deployContract("USDG", [vault.address]);
    router = await deployContract("Router", [
      vault.address,
      usdg.address,
      bnb.address,
    ]);
    vaultPriceFeed = await deployContract("VaultPriceFeed", []);
    nlp = await deployContract("NLP", []);

    await initVault(vault, router, usdg, vaultPriceFeed);
    let shortsTracker = await await deployContract(
      "ShortsTracker",
      [vault.address],
      "ShortsTracker"
    );
    nlpManager = await deployContract("NlpManager", [
      vault.address,
      usdg.address,
      nlp.address,
      shortsTracker.address,
      24 * 60 * 60,
    ]);

    await vaultPriceFeed.setTokenConfig(
      bnb.address,
      bnbPriceFeed.address,
      8,
      false
    );
    await vaultPriceFeed.setTokenConfig(
      btc.address,
      btcPriceFeed.address,
      8,
      false
    );
    await vaultPriceFeed.setTokenConfig(
      eth.address,
      ethPriceFeed.address,
      8,
      false
    );
    await vaultPriceFeed.setTokenConfig(
      dai.address,
      daiPriceFeed.address,
      8,
      false
    );

    await daiPriceFeed.setLatestAnswer(toChainlinkPrice(1));
    await vault.setTokenConfig(...getDaiConfig(dai, daiPriceFeed));

    await btcPriceFeed.setLatestAnswer(toChainlinkPrice(60000));
    await vault.setTokenConfig(...getBtcConfig(btc, btcPriceFeed));

    await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(300));
    await vault.setTokenConfig(...getBnbConfig(bnb, bnbPriceFeed));

    await nlp.setInPrivateTransferMode(true);
    await nlp.setMinter(nlpManager.address, true);
    await nlpManager.setInPrivateMode(true);

    nsc = await deployContract("NSC", []);
    esNsc = await deployContract("EsNSC", []);
    bnNsc = await deployContract("MintableBaseToken", [
      "Bonus NSC",
      "bnNSC",
      0,
    ]);

    // NSC
    stakedNscTracker = await deployContract("RewardTracker", [
      "Staked NSC",
      "sNSC",
    ]);
    stakedNscDistributor = await deployContract("RewardDistributor", [
      esNsc.address,
      stakedNscTracker.address,
    ]);
    await stakedNscTracker.initialize(
      [nsc.address, esNsc.address],
      stakedNscDistributor.address
    );
    await stakedNscDistributor.updateLastDistributionTime();

    bonusNscTracker = await deployContract("RewardTracker", [
      "Staked + Bonus NSC",
      "sbNSC",
    ]);
    bonusNscDistributor = await deployContract("BonusDistributor", [
      bnNsc.address,
      bonusNscTracker.address,
    ]);
    await bonusNscTracker.initialize(
      [stakedNscTracker.address],
      bonusNscDistributor.address
    );
    await bonusNscDistributor.updateLastDistributionTime();

    feeNscTracker = await deployContract("RewardTracker", [
      "Staked + Bonus + Fee NSC",
      "sbfNSC",
    ]);
    feeNscDistributor = await deployContract("RewardDistributor", [
      eth.address,
      feeNscTracker.address,
    ]);
    await feeNscTracker.initialize(
      [bonusNscTracker.address, bnNsc.address],
      feeNscDistributor.address
    );
    await feeNscDistributor.updateLastDistributionTime();

    // NLP
    feeNlpTracker = await deployContract("RewardTracker", ["Fee NLP", "fNLP"]);
    feeNlpDistributor = await deployContract("RewardDistributor", [
      eth.address,
      feeNlpTracker.address,
    ]);
    await feeNlpTracker.initialize([nlp.address], feeNlpDistributor.address);
    await feeNlpDistributor.updateLastDistributionTime();

    stakedNlpTracker = await deployContract("RewardTracker", [
      "Fee + Staked NLP",
      "fsNLP",
    ]);
    stakedNlpDistributor = await deployContract("RewardDistributor", [
      esNsc.address,
      stakedNlpTracker.address,
    ]);
    await stakedNlpTracker.initialize(
      [feeNlpTracker.address],
      stakedNlpDistributor.address
    );
    await stakedNlpDistributor.updateLastDistributionTime();

    nscVester = await deployContract("Vester", [
      "Vested NSC", // _name
      "vNSC", // _symbol
      vestingDuration, // _vestingDuration
      esNsc.address, // _esToken
      feeNscTracker.address, // _pairToken
      nsc.address, // _claimableToken
      stakedNscTracker.address, // _rewardTracker
    ]);

    nlpVester = await deployContract("Vester", [
      "Vested NLP", // _name
      "vNLP", // _symbol
      vestingDuration, // _vestingDuration
      esNsc.address, // _esToken
      stakedNlpTracker.address, // _pairToken
      nsc.address, // _claimableToken
      stakedNlpTracker.address, // _rewardTracker
    ]);

    await stakedNscTracker.setInPrivateTransferMode(true);
    await stakedNscTracker.setInPrivateStakingMode(true);
    await bonusNscTracker.setInPrivateTransferMode(true);
    await bonusNscTracker.setInPrivateStakingMode(true);
    await bonusNscTracker.setInPrivateClaimingMode(true);
    await feeNscTracker.setInPrivateTransferMode(true);
    await feeNscTracker.setInPrivateStakingMode(true);

    await feeNlpTracker.setInPrivateTransferMode(true);
    await feeNlpTracker.setInPrivateStakingMode(true);
    await stakedNlpTracker.setInPrivateTransferMode(true);
    await stakedNlpTracker.setInPrivateStakingMode(true);

    await esNsc.setInPrivateTransferMode(true);

    rewardRouter = await deployContract("RewardRouter", []);
    await rewardRouter.initialize(
      bnb.address,
      nsc.address,
      esNsc.address,
      bnNsc.address,
      nlp.address,
      stakedNscTracker.address,
      bonusNscTracker.address,
      feeNscTracker.address,
      feeNlpTracker.address,
      stakedNlpTracker.address,
      nlpManager.address,
      nscVester.address,
      nlpVester.address
    );
    timelock = await deployContract("Timelock", [
      wallet.address,
      10,
      tokenManager.address,
      tokenManager.address,
      tokenManager.address,
      rewardRouter.address,
      rewardManager.address,
      expandDecimals(1000000, 18),
      10,
      100,
    ]);

    await rewardManager.initialize(
      timelock.address,
      rewardRouter.address,
      nlpManager.address,
      stakedNscTracker.address,
      bonusNscTracker.address,
      feeNscTracker.address,
      feeNlpTracker.address,
      stakedNlpTracker.address,
      stakedNscDistributor.address,
      stakedNlpDistributor.address,
      esNsc.address,
      bnNsc.address,
      nscVester.address,
      nlpVester.address
    );

    // allow bonusNscTracker to stake stakedNscTracker
    await stakedNscTracker.setHandler(bonusNscTracker.address, true);
    // allow bonusNscTracker to stake feeNscTracker
    await bonusNscTracker.setHandler(feeNscTracker.address, true);
    await bonusNscDistributor.setBonusMultiplier(10000);
    // allow feeNscTracker to stake bnNsc
    await bnNsc.setHandler(feeNscTracker.address, true);

    // allow stakedNlpTracker to stake feeNlpTracker
    await feeNlpTracker.setHandler(stakedNlpTracker.address, true);
    // allow feeNlpTracker to stake nlp
    await nlp.setHandler(feeNlpTracker.address, true);

    // mint esNsc for distributors
    await esNsc.setMinter(wallet.address, true);
    await esNsc.mint(stakedNscDistributor.address, expandDecimals(50000, 18));
    await stakedNscDistributor.setTokensPerInterval("20667989410000000"); // 0.02066798941 esNsc per second
    await esNsc.mint(stakedNlpDistributor.address, expandDecimals(50000, 18));
    await stakedNlpDistributor.setTokensPerInterval("20667989410000000"); // 0.02066798941 esNsc per second

    // mint bnNsc for distributor
    await bnNsc.setMinter(wallet.address, true);
    await bnNsc.mint(bonusNscDistributor.address, expandDecimals(1500, 18));

    await esNsc.setHandler(tokenManager.address, true);
    await nscVester.setHandler(wallet.address, true);

    await nlpManager.setGov(timelock.address);
    await stakedNscTracker.setGov(timelock.address);
    await bonusNscTracker.setGov(timelock.address);
    await feeNscTracker.setGov(timelock.address);
    await feeNlpTracker.setGov(timelock.address);
    await stakedNlpTracker.setGov(timelock.address);
    await stakedNscDistributor.setGov(timelock.address);
    await stakedNlpDistributor.setGov(timelock.address);
    await esNsc.setGov(timelock.address);
    await bnNsc.setGov(timelock.address);
    await nscVester.setGov(timelock.address);
    await nlpVester.setGov(timelock.address);

    await rewardManager.updateEsNscHandlers();
    await rewardManager.enableRewardRouter();
  });

  it("inits", async () => {
    expect(await rewardRouter.isInitialized()).eq(true);

    expect(await rewardRouter.weth()).eq(bnb.address);
    expect(await rewardRouter.nsc()).eq(nsc.address);
    expect(await rewardRouter.esNsc()).eq(esNsc.address);
    expect(await rewardRouter.bnNsc()).eq(bnNsc.address);

    expect(await rewardRouter.nlp()).eq(nlp.address);

    expect(await rewardRouter.stakedNscTracker()).eq(stakedNscTracker.address);
    expect(await rewardRouter.bonusNscTracker()).eq(bonusNscTracker.address);
    expect(await rewardRouter.feeNscTracker()).eq(feeNscTracker.address);

    expect(await rewardRouter.feeNlpTracker()).eq(feeNlpTracker.address);
    expect(await rewardRouter.stakedNlpTracker()).eq(stakedNlpTracker.address);

    expect(await rewardRouter.nlpManager()).eq(nlpManager.address);

    expect(await rewardRouter.nscVester()).eq(nscVester.address);
    expect(await rewardRouter.nlpVester()).eq(nlpVester.address);

    await expect(
      rewardRouter.initialize(
        bnb.address,
        nsc.address,
        esNsc.address,
        bnNsc.address,
        nlp.address,
        stakedNscTracker.address,
        bonusNscTracker.address,
        feeNscTracker.address,
        feeNlpTracker.address,
        stakedNlpTracker.address,
        nlpManager.address,
        nscVester.address,
        nlpVester.address
      )
    ).to.be.revertedWith("RewardRouter: already initialized");

    expect(await rewardManager.timelock()).eq(timelock.address);
    expect(await rewardManager.rewardRouter()).eq(rewardRouter.address);
    expect(await rewardManager.nlpManager()).eq(nlpManager.address);
    expect(await rewardManager.stakedNscTracker()).eq(stakedNscTracker.address);
    expect(await rewardManager.bonusNscTracker()).eq(bonusNscTracker.address);
    expect(await rewardManager.feeNscTracker()).eq(feeNscTracker.address);
    expect(await rewardManager.feeNlpTracker()).eq(feeNlpTracker.address);
    expect(await rewardManager.stakedNlpTracker()).eq(stakedNlpTracker.address);
    expect(await rewardManager.stakedNscTracker()).eq(stakedNscTracker.address);
    expect(await rewardManager.stakedNscDistributor()).eq(
      stakedNscDistributor.address
    );
    expect(await rewardManager.stakedNlpDistributor()).eq(
      stakedNlpDistributor.address
    );
    expect(await rewardManager.esNsc()).eq(esNsc.address);
    expect(await rewardManager.bnNsc()).eq(bnNsc.address);
    expect(await rewardManager.nscVester()).eq(nscVester.address);
    expect(await rewardManager.nlpVester()).eq(nlpVester.address);

    await expect(
      rewardManager.initialize(
        timelock.address,
        rewardRouter.address,
        nlpManager.address,
        stakedNscTracker.address,
        bonusNscTracker.address,
        feeNscTracker.address,
        feeNlpTracker.address,
        stakedNlpTracker.address,
        stakedNscDistributor.address,
        stakedNlpDistributor.address,
        esNsc.address,
        bnNsc.address,
        nscVester.address,
        nlpVester.address
      )
    ).to.be.revertedWith("RewardManager: already initialized");
  });

  it("stakeNscForAccount, stakeNsc, stakeEsNsc, unstakeNsc, unstakeEsNsc, claimEsNsc, claimFees, compound, batchCompoundForAccounts", async () => {
    await eth.mint(feeNscDistributor.address, expandDecimals(100, 18));
    await feeNscDistributor.setTokensPerInterval("41335970000000"); // 0.00004133597 ETH per second

    await nsc.setMinter(wallet.address, true);
    await nsc.mint(user0.address, expandDecimals(1500, 18));
    expect(await nsc.balanceOf(user0.address)).eq(expandDecimals(1500, 18));

    await nsc
      .connect(user0)
      .approve(stakedNscTracker.address, expandDecimals(1000, 18));
    await expect(
      rewardRouter
        .connect(user0)
        .stakeNscForAccount(user1.address, expandDecimals(1000, 18))
    ).to.be.revertedWith("Governable: forbidden");

    await rewardRouter.setGov(user0.address);
    await rewardRouter
      .connect(user0)
      .stakeNscForAccount(user1.address, expandDecimals(800, 18));
    expect(await nsc.balanceOf(user0.address)).eq(expandDecimals(700, 18));

    await nsc.mint(user1.address, expandDecimals(200, 18));
    expect(await nsc.balanceOf(user1.address)).eq(expandDecimals(200, 18));
    await nsc
      .connect(user1)
      .approve(stakedNscTracker.address, expandDecimals(200, 18));
    await rewardRouter.connect(user1).stakeNsc(expandDecimals(200, 18));
    expect(await nsc.balanceOf(user1.address)).eq(0);

    expect(await stakedNscTracker.stakedAmounts(user0.address)).eq(0);
    expect(
      await stakedNscTracker.depositBalances(user0.address, nsc.address)
    ).eq(0);
    expect(await stakedNscTracker.stakedAmounts(user1.address)).eq(
      expandDecimals(1000, 18)
    );
    expect(
      await stakedNscTracker.depositBalances(user1.address, nsc.address)
    ).eq(expandDecimals(1000, 18));

    expect(await bonusNscTracker.stakedAmounts(user0.address)).eq(0);
    expect(
      await bonusNscTracker.depositBalances(
        user0.address,
        stakedNscTracker.address
      )
    ).eq(0);
    expect(await bonusNscTracker.stakedAmounts(user1.address)).eq(
      expandDecimals(1000, 18)
    );
    expect(
      await bonusNscTracker.depositBalances(
        user1.address,
        stakedNscTracker.address
      )
    ).eq(expandDecimals(1000, 18));

    expect(await feeNscTracker.stakedAmounts(user0.address)).eq(0);
    expect(
      await feeNscTracker.depositBalances(
        user0.address,
        bonusNscTracker.address
      )
    ).eq(0);
    expect(await feeNscTracker.stakedAmounts(user1.address)).eq(
      expandDecimals(1000, 18)
    );
    expect(
      await feeNscTracker.depositBalances(
        user1.address,
        bonusNscTracker.address
      )
    ).eq(expandDecimals(1000, 18));

    await increaseTime(provider, 24 * 60 * 60);
    await mineBlock(provider);

    expect(await stakedNscTracker.claimable(user0.address)).eq(0);
    expect(await stakedNscTracker.claimable(user1.address)).gt(
      expandDecimals(1785, 18)
    ); // 50000 / 28 => ~1785
    expect(await stakedNscTracker.claimable(user1.address)).lt(
      expandDecimals(1786, 18)
    );

    expect(await bonusNscTracker.claimable(user0.address)).eq(0);
    expect(await bonusNscTracker.claimable(user1.address)).gt(
      "2730000000000000000"
    ); // 2.73, 1000 / 365 => ~2.74
    expect(await bonusNscTracker.claimable(user1.address)).lt(
      "2750000000000000000"
    ); // 2.75

    expect(await feeNscTracker.claimable(user0.address)).eq(0);
    expect(await feeNscTracker.claimable(user1.address)).gt(
      "3560000000000000000"
    ); // 3.56, 100 / 28 => ~3.57
    expect(await feeNscTracker.claimable(user1.address)).lt(
      "3580000000000000000"
    ); // 3.58

    await timelock.mint(esNsc.address, expandDecimals(500, 18));
    await esNsc
      .connect(tokenManager)
      .transferFrom(
        tokenManager.address,
        user2.address,
        expandDecimals(500, 18)
      );
    await rewardRouter.connect(user2).stakeEsNsc(expandDecimals(500, 18));

    expect(await stakedNscTracker.stakedAmounts(user0.address)).eq(0);
    expect(
      await stakedNscTracker.depositBalances(user0.address, nsc.address)
    ).eq(0);
    expect(await stakedNscTracker.stakedAmounts(user1.address)).eq(
      expandDecimals(1000, 18)
    );
    expect(
      await stakedNscTracker.depositBalances(user1.address, nsc.address)
    ).eq(expandDecimals(1000, 18));
    expect(await stakedNscTracker.stakedAmounts(user2.address)).eq(
      expandDecimals(500, 18)
    );
    expect(
      await stakedNscTracker.depositBalances(user2.address, esNsc.address)
    ).eq(expandDecimals(500, 18));

    expect(await bonusNscTracker.stakedAmounts(user0.address)).eq(0);
    expect(
      await bonusNscTracker.depositBalances(
        user0.address,
        stakedNscTracker.address
      )
    ).eq(0);
    expect(await bonusNscTracker.stakedAmounts(user1.address)).eq(
      expandDecimals(1000, 18)
    );
    expect(
      await bonusNscTracker.depositBalances(
        user1.address,
        stakedNscTracker.address
      )
    ).eq(expandDecimals(1000, 18));
    expect(await bonusNscTracker.stakedAmounts(user2.address)).eq(
      expandDecimals(500, 18)
    );
    expect(
      await bonusNscTracker.depositBalances(
        user2.address,
        stakedNscTracker.address
      )
    ).eq(expandDecimals(500, 18));

    expect(await feeNscTracker.stakedAmounts(user0.address)).eq(0);
    expect(
      await feeNscTracker.depositBalances(
        user0.address,
        bonusNscTracker.address
      )
    ).eq(0);
    expect(await feeNscTracker.stakedAmounts(user1.address)).eq(
      expandDecimals(1000, 18)
    );
    expect(
      await feeNscTracker.depositBalances(
        user1.address,
        bonusNscTracker.address
      )
    ).eq(expandDecimals(1000, 18));
    expect(await feeNscTracker.stakedAmounts(user2.address)).eq(
      expandDecimals(500, 18)
    );
    expect(
      await feeNscTracker.depositBalances(
        user2.address,
        bonusNscTracker.address
      )
    ).eq(expandDecimals(500, 18));

    await increaseTime(provider, 24 * 60 * 60);
    await mineBlock(provider);

    expect(await stakedNscTracker.claimable(user0.address)).eq(0);
    expect(await stakedNscTracker.claimable(user1.address)).gt(
      expandDecimals(1785 + 1190, 18)
    );
    expect(await stakedNscTracker.claimable(user1.address)).lt(
      expandDecimals(1786 + 1191, 18)
    );
    expect(await stakedNscTracker.claimable(user2.address)).gt(
      expandDecimals(595, 18)
    );
    expect(await stakedNscTracker.claimable(user2.address)).lt(
      expandDecimals(596, 18)
    );

    expect(await bonusNscTracker.claimable(user0.address)).eq(0);
    expect(await bonusNscTracker.claimable(user1.address)).gt(
      "5470000000000000000"
    ); // 5.47, 1000 / 365 * 2 => ~5.48
    expect(await bonusNscTracker.claimable(user1.address)).lt(
      "5490000000000000000"
    );
    expect(await bonusNscTracker.claimable(user2.address)).gt(
      "1360000000000000000"
    ); // 1.36, 500 / 365 => ~1.37
    expect(await bonusNscTracker.claimable(user2.address)).lt(
      "1380000000000000000"
    );

    expect(await feeNscTracker.claimable(user0.address)).eq(0);
    expect(await feeNscTracker.claimable(user1.address)).gt(
      "5940000000000000000"
    ); // 5.94, 3.57 + 100 / 28 / 3 * 2 => ~5.95
    expect(await feeNscTracker.claimable(user1.address)).lt(
      "5960000000000000000"
    );
    expect(await feeNscTracker.claimable(user2.address)).gt(
      "1180000000000000000"
    ); // 1.18, 100 / 28 / 3 => ~1.19
    expect(await feeNscTracker.claimable(user2.address)).lt(
      "1200000000000000000"
    );

    expect(await esNsc.balanceOf(user1.address)).eq(0);
    await rewardRouter.connect(user1).claimEsNsc();
    expect(await esNsc.balanceOf(user1.address)).gt(
      expandDecimals(1785 + 1190, 18)
    );
    expect(await esNsc.balanceOf(user1.address)).lt(
      expandDecimals(1786 + 1191, 18)
    );

    expect(await eth.balanceOf(user1.address)).eq(0);
    await rewardRouter.connect(user1).claimFees();
    expect(await eth.balanceOf(user1.address)).gt("5940000000000000000");
    expect(await eth.balanceOf(user1.address)).lt("5960000000000000000");

    expect(await esNsc.balanceOf(user2.address)).eq(0);
    await rewardRouter.connect(user2).claimEsNsc();
    expect(await esNsc.balanceOf(user2.address)).gt(expandDecimals(595, 18));
    expect(await esNsc.balanceOf(user2.address)).lt(expandDecimals(596, 18));

    expect(await eth.balanceOf(user2.address)).eq(0);
    await rewardRouter.connect(user2).claimFees();
    expect(await eth.balanceOf(user2.address)).gt("1180000000000000000");
    expect(await eth.balanceOf(user2.address)).lt("1200000000000000000");

    await increaseTime(provider, 24 * 60 * 60);
    await mineBlock(provider);

    const tx0 = await rewardRouter.connect(user1).compound();
    await reportGasUsed(provider, tx0, "compound gas used");

    await increaseTime(provider, 24 * 60 * 60);
    await mineBlock(provider);

    const tx1 = await rewardRouter
      .connect(user0)
      .batchCompoundForAccounts([user1.address, user2.address]);
    await reportGasUsed(provider, tx1, "batchCompoundForAccounts gas used");

    expect(await stakedNscTracker.stakedAmounts(user1.address)).gt(
      expandDecimals(3643, 18)
    );
    expect(await stakedNscTracker.stakedAmounts(user1.address)).lt(
      expandDecimals(3645, 18)
    );
    expect(
      await stakedNscTracker.depositBalances(user1.address, nsc.address)
    ).eq(expandDecimals(1000, 18));
    expect(
      await stakedNscTracker.depositBalances(user1.address, esNsc.address)
    ).gt(expandDecimals(2643, 18));
    expect(
      await stakedNscTracker.depositBalances(user1.address, esNsc.address)
    ).lt(expandDecimals(2645, 18));

    expect(await bonusNscTracker.stakedAmounts(user1.address)).gt(
      expandDecimals(3643, 18)
    );
    expect(await bonusNscTracker.stakedAmounts(user1.address)).lt(
      expandDecimals(3645, 18)
    );

    expect(await feeNscTracker.stakedAmounts(user1.address)).gt(
      expandDecimals(3657, 18)
    );
    expect(await feeNscTracker.stakedAmounts(user1.address)).lt(
      expandDecimals(3659, 18)
    );
    expect(
      await feeNscTracker.depositBalances(
        user1.address,
        bonusNscTracker.address
      )
    ).gt(expandDecimals(3643, 18));
    expect(
      await feeNscTracker.depositBalances(
        user1.address,
        bonusNscTracker.address
      )
    ).lt(expandDecimals(3645, 18));
    expect(
      await feeNscTracker.depositBalances(user1.address, bnNsc.address)
    ).gt("14100000000000000000"); // 14.1
    expect(
      await feeNscTracker.depositBalances(user1.address, bnNsc.address)
    ).lt("14300000000000000000"); // 14.3

    expect(await nsc.balanceOf(user1.address)).eq(0);
    await rewardRouter.connect(user1).unstakeNsc(expandDecimals(300, 18));
    expect(await nsc.balanceOf(user1.address)).eq(expandDecimals(300, 18));

    expect(await stakedNscTracker.stakedAmounts(user1.address)).gt(
      expandDecimals(3343, 18)
    );
    expect(await stakedNscTracker.stakedAmounts(user1.address)).lt(
      expandDecimals(3345, 18)
    );
    expect(
      await stakedNscTracker.depositBalances(user1.address, nsc.address)
    ).eq(expandDecimals(700, 18));
    expect(
      await stakedNscTracker.depositBalances(user1.address, esNsc.address)
    ).gt(expandDecimals(2643, 18));
    expect(
      await stakedNscTracker.depositBalances(user1.address, esNsc.address)
    ).lt(expandDecimals(2645, 18));

    expect(await bonusNscTracker.stakedAmounts(user1.address)).gt(
      expandDecimals(3343, 18)
    );
    expect(await bonusNscTracker.stakedAmounts(user1.address)).lt(
      expandDecimals(3345, 18)
    );

    expect(await feeNscTracker.stakedAmounts(user1.address)).gt(
      expandDecimals(3357, 18)
    );
    expect(await feeNscTracker.stakedAmounts(user1.address)).lt(
      expandDecimals(3359, 18)
    );
    expect(
      await feeNscTracker.depositBalances(
        user1.address,
        bonusNscTracker.address
      )
    ).gt(expandDecimals(3343, 18));
    expect(
      await feeNscTracker.depositBalances(
        user1.address,
        bonusNscTracker.address
      )
    ).lt(expandDecimals(3345, 18));
    expect(
      await feeNscTracker.depositBalances(user1.address, bnNsc.address)
    ).gt("13000000000000000000"); // 13
    expect(
      await feeNscTracker.depositBalances(user1.address, bnNsc.address)
    ).lt("13100000000000000000"); // 13.1

    const esNscBalance1 = await esNsc.balanceOf(user1.address);
    const esNscUnstakeBalance1 = await stakedNscTracker.depositBalances(
      user1.address,
      esNsc.address
    );
    await rewardRouter.connect(user1).unstakeEsNsc(esNscUnstakeBalance1);
    expect(await esNsc.balanceOf(user1.address)).eq(
      esNscBalance1.add(esNscUnstakeBalance1)
    );

    expect(await stakedNscTracker.stakedAmounts(user1.address)).eq(
      expandDecimals(700, 18)
    );
    expect(
      await stakedNscTracker.depositBalances(user1.address, nsc.address)
    ).eq(expandDecimals(700, 18));
    expect(
      await stakedNscTracker.depositBalances(user1.address, esNsc.address)
    ).eq(0);

    expect(await bonusNscTracker.stakedAmounts(user1.address)).eq(
      expandDecimals(700, 18)
    );

    expect(await feeNscTracker.stakedAmounts(user1.address)).gt(
      expandDecimals(702, 18)
    );
    expect(await feeNscTracker.stakedAmounts(user1.address)).lt(
      expandDecimals(703, 18)
    );
    expect(
      await feeNscTracker.depositBalances(
        user1.address,
        bonusNscTracker.address
      )
    ).eq(expandDecimals(700, 18));
    expect(
      await feeNscTracker.depositBalances(user1.address, bnNsc.address)
    ).gt("2720000000000000000"); // 2.72
    expect(
      await feeNscTracker.depositBalances(user1.address, bnNsc.address)
    ).lt("2740000000000000000"); // 2.74

    await expect(
      rewardRouter.connect(user1).unstakeEsNsc(expandDecimals(1, 18))
    ).to.be.revertedWith("RewardTracker: _amount exceeds depositBalance");
  });

  it("mintAndStakeNlp, unstakeAndRedeemNlp, compound, batchCompoundForAccounts", async () => {
    await eth.mint(feeNlpDistributor.address, expandDecimals(100, 18));
    await feeNlpDistributor.setTokensPerInterval("41335970000000"); // 0.00004133597 ETH per second

    await bnb.mint(user1.address, expandDecimals(1, 18));
    await bnb.connect(user1).approve(nlpManager.address, expandDecimals(1, 18));
    const tx0 = await rewardRouter
      .connect(user1)
      .mintAndStakeNlp(
        bnb.address,
        expandDecimals(1, 18),
        expandDecimals(299, 18),
        expandDecimals(299, 18)
      );
    await reportGasUsed(provider, tx0, "mintAndStakeNlp gas used");

    expect(await feeNlpTracker.stakedAmounts(user1.address)).eq(
      expandDecimals(2991, 17)
    );
    expect(await feeNlpTracker.depositBalances(user1.address, nlp.address)).eq(
      expandDecimals(2991, 17)
    );

    expect(await stakedNlpTracker.stakedAmounts(user1.address)).eq(
      expandDecimals(2991, 17)
    );
    expect(
      await stakedNlpTracker.depositBalances(
        user1.address,
        feeNlpTracker.address
      )
    ).eq(expandDecimals(2991, 17));

    await bnb.mint(user1.address, expandDecimals(2, 18));
    await bnb.connect(user1).approve(nlpManager.address, expandDecimals(2, 18));
    await rewardRouter
      .connect(user1)
      .mintAndStakeNlp(
        bnb.address,
        expandDecimals(2, 18),
        expandDecimals(299, 18),
        expandDecimals(299, 18)
      );

    await increaseTime(provider, 24 * 60 * 60 + 1);
    await mineBlock(provider);

    expect(await feeNlpTracker.claimable(user1.address)).gt(
      "3560000000000000000"
    ); // 3.56, 100 / 28 => ~3.57
    expect(await feeNlpTracker.claimable(user1.address)).lt(
      "3580000000000000000"
    ); // 3.58

    expect(await stakedNlpTracker.claimable(user1.address)).gt(
      expandDecimals(1785, 18)
    ); // 50000 / 28 => ~1785
    expect(await stakedNlpTracker.claimable(user1.address)).lt(
      expandDecimals(1786, 18)
    );

    await bnb.mint(user2.address, expandDecimals(1, 18));
    await bnb.connect(user2).approve(nlpManager.address, expandDecimals(1, 18));
    await rewardRouter
      .connect(user2)
      .mintAndStakeNlp(
        bnb.address,
        expandDecimals(1, 18),
        expandDecimals(299, 18),
        expandDecimals(299, 18)
      );

    await expect(
      rewardRouter.connect(user2).unstakeAndRedeemNlp(
        bnb.address,
        expandDecimals(299, 18),
        "990000000000000000", // 0.99
        user2.address
      )
    ).to.be.revertedWith("NlpManager: cooldown duration not yet passed");

    expect(await feeNlpTracker.stakedAmounts(user1.address)).eq(
      "897300000000000000000"
    ); // 897.3
    expect(await stakedNlpTracker.stakedAmounts(user1.address)).eq(
      "897300000000000000000"
    );
    expect(await bnb.balanceOf(user1.address)).eq(0);

    const tx1 = await rewardRouter.connect(user1).unstakeAndRedeemNlp(
      bnb.address,
      expandDecimals(299, 18),
      "990000000000000000", // 0.99
      user1.address
    );
    await reportGasUsed(provider, tx1, "unstakeAndRedeemNlp gas used");

    expect(await feeNlpTracker.stakedAmounts(user1.address)).eq(
      "598300000000000000000"
    ); // 598.3
    expect(await stakedNlpTracker.stakedAmounts(user1.address)).eq(
      "598300000000000000000"
    );
    expect(await bnb.balanceOf(user1.address)).eq("993676666666666666"); // ~0.99

    await increaseTime(provider, 24 * 60 * 60);
    await mineBlock(provider);

    expect(await feeNlpTracker.claimable(user1.address)).gt(
      "5940000000000000000"
    ); // 5.94, 3.57 + 100 / 28 / 3 * 2 => ~5.95
    expect(await feeNlpTracker.claimable(user1.address)).lt(
      "5960000000000000000"
    );
    expect(await feeNlpTracker.claimable(user2.address)).gt(
      "1180000000000000000"
    ); // 1.18, 100 / 28 / 3 => ~1.19
    expect(await feeNlpTracker.claimable(user2.address)).lt(
      "1200000000000000000"
    );

    expect(await stakedNlpTracker.claimable(user1.address)).gt(
      expandDecimals(1785 + 1190, 18)
    );
    expect(await stakedNlpTracker.claimable(user1.address)).lt(
      expandDecimals(1786 + 1191, 18)
    );
    expect(await stakedNlpTracker.claimable(user2.address)).gt(
      expandDecimals(595, 18)
    );
    expect(await stakedNlpTracker.claimable(user2.address)).lt(
      expandDecimals(596, 18)
    );

    expect(await esNsc.balanceOf(user1.address)).eq(0);
    await rewardRouter.connect(user1).claimEsNsc();
    expect(await esNsc.balanceOf(user1.address)).gt(
      expandDecimals(1785 + 1190, 18)
    );
    expect(await esNsc.balanceOf(user1.address)).lt(
      expandDecimals(1786 + 1191, 18)
    );

    expect(await eth.balanceOf(user1.address)).eq(0);
    await rewardRouter.connect(user1).claimFees();
    expect(await eth.balanceOf(user1.address)).gt("5940000000000000000");
    expect(await eth.balanceOf(user1.address)).lt("5960000000000000000");

    expect(await esNsc.balanceOf(user2.address)).eq(0);
    await rewardRouter.connect(user2).claimEsNsc();
    expect(await esNsc.balanceOf(user2.address)).gt(expandDecimals(595, 18));
    expect(await esNsc.balanceOf(user2.address)).lt(expandDecimals(596, 18));

    expect(await eth.balanceOf(user2.address)).eq(0);
    await rewardRouter.connect(user2).claimFees();
    expect(await eth.balanceOf(user2.address)).gt("1180000000000000000");
    expect(await eth.balanceOf(user2.address)).lt("1200000000000000000");

    await increaseTime(provider, 24 * 60 * 60);
    await mineBlock(provider);

    const tx2 = await rewardRouter.connect(user1).compound();
    await reportGasUsed(provider, tx2, "compound gas used");

    await increaseTime(provider, 24 * 60 * 60);
    await mineBlock(provider);

    const tx3 = await rewardRouter.batchCompoundForAccounts([
      user1.address,
      user2.address,
    ]);
    await reportGasUsed(provider, tx1, "batchCompoundForAccounts gas used");

    expect(await stakedNscTracker.stakedAmounts(user1.address)).gt(
      expandDecimals(4165, 18)
    );
    expect(await stakedNscTracker.stakedAmounts(user1.address)).lt(
      expandDecimals(4167, 18)
    );
    expect(
      await stakedNscTracker.depositBalances(user1.address, nsc.address)
    ).eq(0);
    expect(
      await stakedNscTracker.depositBalances(user1.address, esNsc.address)
    ).gt(expandDecimals(4165, 18));
    expect(
      await stakedNscTracker.depositBalances(user1.address, esNsc.address)
    ).lt(expandDecimals(4167, 18));

    expect(await bonusNscTracker.stakedAmounts(user1.address)).gt(
      expandDecimals(4165, 18)
    );
    expect(await bonusNscTracker.stakedAmounts(user1.address)).lt(
      expandDecimals(4167, 18)
    );

    expect(await feeNscTracker.stakedAmounts(user1.address)).gt(
      expandDecimals(4179, 18)
    );
    expect(await feeNscTracker.stakedAmounts(user1.address)).lt(
      expandDecimals(4180, 18)
    );
    expect(
      await feeNscTracker.depositBalances(
        user1.address,
        bonusNscTracker.address
      )
    ).gt(expandDecimals(4165, 18));
    expect(
      await feeNscTracker.depositBalances(
        user1.address,
        bonusNscTracker.address
      )
    ).lt(expandDecimals(4167, 18));
    expect(
      await feeNscTracker.depositBalances(user1.address, bnNsc.address)
    ).gt("12900000000000000000"); // 12.9
    expect(
      await feeNscTracker.depositBalances(user1.address, bnNsc.address)
    ).lt("13100000000000000000"); // 13.1

    expect(await feeNlpTracker.stakedAmounts(user1.address)).eq(
      "598300000000000000000"
    ); // 598.3
    expect(await stakedNlpTracker.stakedAmounts(user1.address)).eq(
      "598300000000000000000"
    );
    expect(await bnb.balanceOf(user1.address)).eq("993676666666666666"); // ~0.99
  });

  it("mintAndStakeNlpETH, unstakeAndRedeemNlpETH", async () => {
    const receiver0 = newWallet();
    await expect(
      rewardRouter
        .connect(user0)
        .mintAndStakeNlpETH(expandDecimals(300, 18), expandDecimals(300, 18), {
          value: 0,
        })
    ).to.be.revertedWith("RewardRouter: invalid msg.value");

    await expect(
      rewardRouter
        .connect(user0)
        .mintAndStakeNlpETH(expandDecimals(300, 18), expandDecimals(300, 18), {
          value: expandDecimals(1, 18),
        })
    ).to.be.revertedWith("NlpManager: insufficient USDG output");

    await expect(
      rewardRouter
        .connect(user0)
        .mintAndStakeNlpETH(expandDecimals(299, 18), expandDecimals(300, 18), {
          value: expandDecimals(1, 18),
        })
    ).to.be.revertedWith("NlpManager: insufficient NLP output");

    expect(await bnb.balanceOf(user0.address)).eq(0);
    expect(await bnb.balanceOf(vault.address)).eq(0);
    expect(await bnb.totalSupply()).eq(0);
    expect(await provider.getBalance(bnb.address)).eq(0);
    expect(await stakedNlpTracker.balanceOf(user0.address)).eq(0);

    await rewardRouter
      .connect(user0)
      .mintAndStakeNlpETH(expandDecimals(299, 18), expandDecimals(299, 18), {
        value: expandDecimals(1, 18),
      });

    expect(await bnb.balanceOf(user0.address)).eq(0);
    expect(await bnb.balanceOf(vault.address)).eq(expandDecimals(1, 18));
    expect(await provider.getBalance(bnb.address)).eq(expandDecimals(1, 18));
    expect(await bnb.totalSupply()).eq(expandDecimals(1, 18));
    expect(await stakedNlpTracker.balanceOf(user0.address)).eq(
      "299100000000000000000"
    ); // 299.1

    await expect(
      rewardRouter
        .connect(user0)
        .unstakeAndRedeemNlpETH(
          expandDecimals(300, 18),
          expandDecimals(1, 18),
          receiver0.address
        )
    ).to.be.revertedWith("RewardTracker: _amount exceeds stakedAmount");

    await expect(
      rewardRouter
        .connect(user0)
        .unstakeAndRedeemNlpETH(
          "299100000000000000000",
          expandDecimals(1, 18),
          receiver0.address
        )
    ).to.be.revertedWith("NlpManager: cooldown duration not yet passed");

    await increaseTime(provider, 24 * 60 * 60 + 10);

    await expect(
      rewardRouter
        .connect(user0)
        .unstakeAndRedeemNlpETH(
          "299100000000000000000",
          expandDecimals(1, 18),
          receiver0.address
        )
    ).to.be.revertedWith("NlpManager: insufficient output");

    await rewardRouter
      .connect(user0)
      .unstakeAndRedeemNlpETH(
        "299100000000000000000",
        "990000000000000000",
        receiver0.address
      );
    expect(await provider.getBalance(receiver0.address)).eq(
      "994009000000000000"
    ); // 0.994009
    expect(await bnb.balanceOf(vault.address)).eq("5991000000000000"); // 0.005991
    expect(await provider.getBalance(bnb.address)).eq("5991000000000000");
    expect(await bnb.totalSupply()).eq("5991000000000000");
  });

  it("nsc: signalTransfer, acceptTransfer", async () => {
    await nsc.setMinter(wallet.address, true);
    await nsc.mint(user1.address, expandDecimals(200, 18));
    expect(await nsc.balanceOf(user1.address)).eq(expandDecimals(200, 18));
    await nsc
      .connect(user1)
      .approve(stakedNscTracker.address, expandDecimals(200, 18));
    await rewardRouter.connect(user1).stakeNsc(expandDecimals(200, 18));
    expect(await nsc.balanceOf(user1.address)).eq(0);

    await nsc.mint(user2.address, expandDecimals(200, 18));
    expect(await nsc.balanceOf(user2.address)).eq(expandDecimals(200, 18));
    await nsc
      .connect(user2)
      .approve(stakedNscTracker.address, expandDecimals(400, 18));
    await rewardRouter.connect(user2).stakeNsc(expandDecimals(200, 18));
    expect(await nsc.balanceOf(user2.address)).eq(0);

    await rewardRouter.connect(user2).signalTransfer(user1.address);

    await increaseTime(provider, 24 * 60 * 60);
    await mineBlock(provider);

    await rewardRouter.connect(user2).signalTransfer(user1.address);
    await rewardRouter.connect(user1).claim();

    await expect(
      rewardRouter.connect(user2).signalTransfer(user1.address)
    ).to.be.revertedWith(
      "RewardRouter: stakedNscTracker.averageStakedAmounts > 0"
    );

    await rewardRouter.connect(user2).signalTransfer(user3.address);

    await expect(
      rewardRouter.connect(user3).acceptTransfer(user1.address)
    ).to.be.revertedWith("RewardRouter: transfer not signalled");

    await nscVester.setBonusRewards(user2.address, expandDecimals(100, 18));

    expect(
      await stakedNscTracker.depositBalances(user2.address, nsc.address)
    ).eq(expandDecimals(200, 18));
    expect(
      await stakedNscTracker.depositBalances(user2.address, esNsc.address)
    ).eq(0);
    expect(
      await feeNscTracker.depositBalances(user2.address, bnNsc.address)
    ).eq(0);
    expect(
      await stakedNscTracker.depositBalances(user3.address, nsc.address)
    ).eq(0);
    expect(
      await stakedNscTracker.depositBalances(user3.address, esNsc.address)
    ).eq(0);
    expect(
      await feeNscTracker.depositBalances(user3.address, bnNsc.address)
    ).eq(0);
    expect(await nscVester.transferredAverageStakedAmounts(user3.address)).eq(
      0
    );
    expect(await nscVester.transferredCumulativeRewards(user3.address)).eq(0);
    expect(await nscVester.bonusRewards(user2.address)).eq(
      expandDecimals(100, 18)
    );
    expect(await nscVester.bonusRewards(user3.address)).eq(0);
    expect(await nscVester.getCombinedAverageStakedAmount(user2.address)).eq(0);
    expect(await nscVester.getCombinedAverageStakedAmount(user3.address)).eq(0);
    expect(await nscVester.getMaxVestableAmount(user2.address)).eq(
      expandDecimals(100, 18)
    );
    expect(await nscVester.getMaxVestableAmount(user3.address)).eq(0);
    expect(
      await nscVester.getPairAmount(user2.address, expandDecimals(892, 18))
    ).eq(0);
    expect(
      await nscVester.getPairAmount(user3.address, expandDecimals(892, 18))
    ).eq(0);

    await rewardRouter.connect(user3).acceptTransfer(user2.address);

    expect(
      await stakedNscTracker.depositBalances(user2.address, nsc.address)
    ).eq(0);
    expect(
      await stakedNscTracker.depositBalances(user2.address, esNsc.address)
    ).eq(0);
    expect(
      await feeNscTracker.depositBalances(user2.address, bnNsc.address)
    ).eq(0);
    expect(
      await stakedNscTracker.depositBalances(user3.address, nsc.address)
    ).eq(expandDecimals(200, 18));
    expect(
      await stakedNscTracker.depositBalances(user3.address, esNsc.address)
    ).gt(expandDecimals(892, 18));
    expect(
      await stakedNscTracker.depositBalances(user3.address, esNsc.address)
    ).lt(expandDecimals(893, 18));
    expect(
      await feeNscTracker.depositBalances(user3.address, bnNsc.address)
    ).gt("547000000000000000"); // 0.547
    expect(
      await feeNscTracker.depositBalances(user3.address, bnNsc.address)
    ).lt("549000000000000000"); // 0.548
    expect(await nscVester.transferredAverageStakedAmounts(user3.address)).eq(
      expandDecimals(200, 18)
    );
    expect(await nscVester.transferredCumulativeRewards(user3.address)).gt(
      expandDecimals(892, 18)
    );
    expect(await nscVester.transferredCumulativeRewards(user3.address)).lt(
      expandDecimals(893, 18)
    );
    expect(await nscVester.bonusRewards(user2.address)).eq(0);
    expect(await nscVester.bonusRewards(user3.address)).eq(
      expandDecimals(100, 18)
    );
    expect(await nscVester.getCombinedAverageStakedAmount(user2.address)).eq(
      expandDecimals(200, 18)
    );
    expect(await nscVester.getCombinedAverageStakedAmount(user3.address)).eq(
      expandDecimals(200, 18)
    );
    expect(await nscVester.getMaxVestableAmount(user2.address)).eq(0);
    expect(await nscVester.getMaxVestableAmount(user3.address)).gt(
      expandDecimals(992, 18)
    );
    expect(await nscVester.getMaxVestableAmount(user3.address)).lt(
      expandDecimals(993, 18)
    );
    expect(
      await nscVester.getPairAmount(user2.address, expandDecimals(992, 18))
    ).eq(0);
    expect(
      await nscVester.getPairAmount(user3.address, expandDecimals(992, 18))
    ).gt(expandDecimals(199, 18));
    expect(
      await nscVester.getPairAmount(user3.address, expandDecimals(992, 18))
    ).lt(expandDecimals(200, 18));

    await nsc
      .connect(user3)
      .approve(stakedNscTracker.address, expandDecimals(400, 18));
    await rewardRouter.connect(user3).signalTransfer(user4.address);
    await rewardRouter.connect(user4).acceptTransfer(user3.address);

    expect(
      await stakedNscTracker.depositBalances(user3.address, nsc.address)
    ).eq(0);
    expect(
      await stakedNscTracker.depositBalances(user3.address, esNsc.address)
    ).eq(0);
    expect(
      await feeNscTracker.depositBalances(user3.address, bnNsc.address)
    ).eq(0);
    expect(
      await stakedNscTracker.depositBalances(user4.address, nsc.address)
    ).eq(expandDecimals(200, 18));
    expect(
      await stakedNscTracker.depositBalances(user4.address, esNsc.address)
    ).gt(expandDecimals(892, 18));
    expect(
      await stakedNscTracker.depositBalances(user4.address, esNsc.address)
    ).lt(expandDecimals(893, 18));
    expect(
      await feeNscTracker.depositBalances(user4.address, bnNsc.address)
    ).gt("547000000000000000"); // 0.547
    expect(
      await feeNscTracker.depositBalances(user4.address, bnNsc.address)
    ).lt("549000000000000000"); // 0.548
    expect(await nscVester.transferredAverageStakedAmounts(user4.address)).gt(
      expandDecimals(200, 18)
    );
    expect(await nscVester.transferredAverageStakedAmounts(user4.address)).lt(
      expandDecimals(201, 18)
    );
    expect(await nscVester.transferredCumulativeRewards(user4.address)).gt(
      expandDecimals(892, 18)
    );
    expect(await nscVester.transferredCumulativeRewards(user4.address)).lt(
      expandDecimals(894, 18)
    );
    expect(await nscVester.bonusRewards(user3.address)).eq(0);
    expect(await nscVester.bonusRewards(user4.address)).eq(
      expandDecimals(100, 18)
    );
    expect(await stakedNscTracker.averageStakedAmounts(user3.address)).gt(
      expandDecimals(1092, 18)
    );
    expect(await stakedNscTracker.averageStakedAmounts(user3.address)).lt(
      expandDecimals(1094, 18)
    );
    expect(await nscVester.transferredAverageStakedAmounts(user3.address)).eq(
      0
    );
    expect(await nscVester.getCombinedAverageStakedAmount(user3.address)).gt(
      expandDecimals(1092, 18)
    );
    expect(await nscVester.getCombinedAverageStakedAmount(user3.address)).lt(
      expandDecimals(1094, 18)
    );
    expect(await nscVester.getCombinedAverageStakedAmount(user4.address)).gt(
      expandDecimals(200, 18)
    );
    expect(await nscVester.getCombinedAverageStakedAmount(user4.address)).lt(
      expandDecimals(201, 18)
    );
    expect(await nscVester.getMaxVestableAmount(user3.address)).eq(0);
    expect(await nscVester.getMaxVestableAmount(user4.address)).gt(
      expandDecimals(992, 18)
    );
    expect(await nscVester.getMaxVestableAmount(user4.address)).lt(
      expandDecimals(993, 18)
    );
    expect(
      await nscVester.getPairAmount(user3.address, expandDecimals(992, 18))
    ).eq(0);
    expect(
      await nscVester.getPairAmount(user4.address, expandDecimals(992, 18))
    ).gt(expandDecimals(199, 18));
    expect(
      await nscVester.getPairAmount(user4.address, expandDecimals(992, 18))
    ).lt(expandDecimals(200, 18));

    await expect(
      rewardRouter.connect(user4).acceptTransfer(user3.address)
    ).to.be.revertedWith("RewardRouter: transfer not signalled");
  });

  it("nsc, nlp: signalTransfer, acceptTransfer", async () => {
    await nsc.setMinter(wallet.address, true);
    await nsc.mint(nscVester.address, expandDecimals(10000, 18));
    await nsc.mint(nlpVester.address, expandDecimals(10000, 18));
    await eth.mint(feeNlpDistributor.address, expandDecimals(100, 18));
    await feeNlpDistributor.setTokensPerInterval("41335970000000"); // 0.00004133597 ETH per second

    await bnb.mint(user1.address, expandDecimals(1, 18));
    await bnb.connect(user1).approve(nlpManager.address, expandDecimals(1, 18));
    await rewardRouter
      .connect(user1)
      .mintAndStakeNlp(
        bnb.address,
        expandDecimals(1, 18),
        expandDecimals(299, 18),
        expandDecimals(299, 18)
      );

    await bnb.mint(user2.address, expandDecimals(1, 18));
    await bnb.connect(user2).approve(nlpManager.address, expandDecimals(1, 18));
    await rewardRouter
      .connect(user2)
      .mintAndStakeNlp(
        bnb.address,
        expandDecimals(1, 18),
        expandDecimals(299, 18),
        expandDecimals(299, 18)
      );

    await nsc.mint(user1.address, expandDecimals(200, 18));
    expect(await nsc.balanceOf(user1.address)).eq(expandDecimals(200, 18));
    await nsc
      .connect(user1)
      .approve(stakedNscTracker.address, expandDecimals(200, 18));
    await rewardRouter.connect(user1).stakeNsc(expandDecimals(200, 18));
    expect(await nsc.balanceOf(user1.address)).eq(0);

    await nsc.mint(user2.address, expandDecimals(200, 18));
    expect(await nsc.balanceOf(user2.address)).eq(expandDecimals(200, 18));
    await nsc
      .connect(user2)
      .approve(stakedNscTracker.address, expandDecimals(400, 18));
    await rewardRouter.connect(user2).stakeNsc(expandDecimals(200, 18));
    expect(await nsc.balanceOf(user2.address)).eq(0);

    await rewardRouter.connect(user2).signalTransfer(user1.address);

    await increaseTime(provider, 24 * 60 * 60);
    await mineBlock(provider);

    await rewardRouter.connect(user2).signalTransfer(user1.address);
    await rewardRouter.connect(user1).compound();

    await expect(
      rewardRouter.connect(user2).signalTransfer(user1.address)
    ).to.be.revertedWith(
      "RewardRouter: stakedNscTracker.averageStakedAmounts > 0"
    );

    await rewardRouter.connect(user2).signalTransfer(user3.address);

    await expect(
      rewardRouter.connect(user3).acceptTransfer(user1.address)
    ).to.be.revertedWith("RewardRouter: transfer not signalled");

    await nscVester.setBonusRewards(user2.address, expandDecimals(100, 18));

    expect(
      await stakedNscTracker.depositBalances(user2.address, nsc.address)
    ).eq(expandDecimals(200, 18));
    expect(
      await stakedNscTracker.depositBalances(user2.address, esNsc.address)
    ).eq(0);
    expect(
      await stakedNscTracker.depositBalances(user3.address, nsc.address)
    ).eq(0);
    expect(
      await stakedNscTracker.depositBalances(user3.address, esNsc.address)
    ).eq(0);

    expect(
      await feeNscTracker.depositBalances(user2.address, bnNsc.address)
    ).eq(0);
    expect(
      await feeNscTracker.depositBalances(user3.address, bnNsc.address)
    ).eq(0);

    expect(await feeNlpTracker.depositBalances(user2.address, nlp.address)).eq(
      "299100000000000000000"
    ); // 299.1
    expect(await feeNlpTracker.depositBalances(user3.address, nlp.address)).eq(
      0
    );

    expect(
      await stakedNlpTracker.depositBalances(
        user2.address,
        feeNlpTracker.address
      )
    ).eq("299100000000000000000"); // 299.1
    expect(
      await stakedNlpTracker.depositBalances(
        user3.address,
        feeNlpTracker.address
      )
    ).eq(0);

    expect(await nscVester.transferredAverageStakedAmounts(user3.address)).eq(
      0
    );
    expect(await nscVester.transferredCumulativeRewards(user3.address)).eq(0);
    expect(await nscVester.bonusRewards(user2.address)).eq(
      expandDecimals(100, 18)
    );
    expect(await nscVester.bonusRewards(user3.address)).eq(0);
    expect(await nscVester.getCombinedAverageStakedAmount(user2.address)).eq(0);
    expect(await nscVester.getCombinedAverageStakedAmount(user3.address)).eq(0);
    expect(await nscVester.getMaxVestableAmount(user2.address)).eq(
      expandDecimals(100, 18)
    );
    expect(await nscVester.getMaxVestableAmount(user3.address)).eq(0);
    expect(
      await nscVester.getPairAmount(user2.address, expandDecimals(892, 18))
    ).eq(0);
    expect(
      await nscVester.getPairAmount(user3.address, expandDecimals(892, 18))
    ).eq(0);

    await rewardRouter.connect(user3).acceptTransfer(user2.address);

    expect(
      await stakedNscTracker.depositBalances(user2.address, nsc.address)
    ).eq(0);
    expect(
      await stakedNscTracker.depositBalances(user2.address, esNsc.address)
    ).eq(0);
    expect(
      await stakedNscTracker.depositBalances(user3.address, nsc.address)
    ).eq(expandDecimals(200, 18));
    expect(
      await stakedNscTracker.depositBalances(user3.address, esNsc.address)
    ).gt(expandDecimals(1785, 18));
    expect(
      await stakedNscTracker.depositBalances(user3.address, esNsc.address)
    ).lt(expandDecimals(1786, 18));

    expect(
      await feeNscTracker.depositBalances(user2.address, bnNsc.address)
    ).eq(0);
    expect(
      await feeNscTracker.depositBalances(user3.address, bnNsc.address)
    ).gt("547000000000000000"); // 0.547
    expect(
      await feeNscTracker.depositBalances(user3.address, bnNsc.address)
    ).lt("549000000000000000"); // 0.548

    expect(await feeNlpTracker.depositBalances(user2.address, nlp.address)).eq(
      0
    );
    expect(await feeNlpTracker.depositBalances(user3.address, nlp.address)).eq(
      "299100000000000000000"
    ); // 299.1

    expect(
      await stakedNlpTracker.depositBalances(
        user2.address,
        feeNlpTracker.address
      )
    ).eq(0);
    expect(
      await stakedNlpTracker.depositBalances(
        user3.address,
        feeNlpTracker.address
      )
    ).eq("299100000000000000000"); // 299.1

    expect(await nscVester.transferredAverageStakedAmounts(user3.address)).eq(
      expandDecimals(200, 18)
    );
    expect(await nscVester.transferredCumulativeRewards(user3.address)).gt(
      expandDecimals(892, 18)
    );
    expect(await nscVester.transferredCumulativeRewards(user3.address)).lt(
      expandDecimals(893, 18)
    );
    expect(await nscVester.bonusRewards(user2.address)).eq(0);
    expect(await nscVester.bonusRewards(user3.address)).eq(
      expandDecimals(100, 18)
    );
    expect(await nscVester.getCombinedAverageStakedAmount(user2.address)).eq(
      expandDecimals(200, 18)
    );
    expect(await nscVester.getCombinedAverageStakedAmount(user3.address)).eq(
      expandDecimals(200, 18)
    );
    expect(await nscVester.getMaxVestableAmount(user2.address)).eq(0);
    expect(await nscVester.getMaxVestableAmount(user3.address)).gt(
      expandDecimals(992, 18)
    );
    expect(await nscVester.getMaxVestableAmount(user3.address)).lt(
      expandDecimals(993, 18)
    );
    expect(
      await nscVester.getPairAmount(user2.address, expandDecimals(992, 18))
    ).eq(0);
    expect(
      await nscVester.getPairAmount(user3.address, expandDecimals(992, 18))
    ).gt(expandDecimals(199, 18));
    expect(
      await nscVester.getPairAmount(user3.address, expandDecimals(992, 18))
    ).lt(expandDecimals(200, 18));
    expect(
      await nscVester.getPairAmount(user1.address, expandDecimals(892, 18))
    ).gt(expandDecimals(199, 18));
    expect(
      await nscVester.getPairAmount(user1.address, expandDecimals(892, 18))
    ).lt(expandDecimals(200, 18));

    await rewardRouter.connect(user1).compound();

    await expect(
      rewardRouter.connect(user3).acceptTransfer(user1.address)
    ).to.be.revertedWith("RewardRouter: transfer not signalled");

    await increaseTime(provider, 24 * 60 * 60);
    await mineBlock(provider);

    await rewardRouter.connect(user1).claim();
    await rewardRouter.connect(user2).claim();
    await rewardRouter.connect(user3).claim();

    expect(await nscVester.getCombinedAverageStakedAmount(user1.address)).gt(
      expandDecimals(1092, 18)
    );
    expect(await nscVester.getCombinedAverageStakedAmount(user1.address)).lt(
      expandDecimals(1094, 18)
    );
    expect(await nscVester.getCombinedAverageStakedAmount(user3.address)).gt(
      expandDecimals(1092, 18)
    );
    expect(await nscVester.getCombinedAverageStakedAmount(user3.address)).lt(
      expandDecimals(1094, 18)
    );

    expect(await nscVester.getMaxVestableAmount(user2.address)).eq(0);
    expect(await nscVester.getMaxVestableAmount(user3.address)).gt(
      expandDecimals(1885, 18)
    );
    expect(await nscVester.getMaxVestableAmount(user3.address)).lt(
      expandDecimals(1887, 18)
    );
    expect(await nscVester.getMaxVestableAmount(user1.address)).gt(
      expandDecimals(1785, 18)
    );
    expect(await nscVester.getMaxVestableAmount(user1.address)).lt(
      expandDecimals(1787, 18)
    );

    expect(
      await nscVester.getPairAmount(user2.address, expandDecimals(992, 18))
    ).eq(0);
    expect(
      await nscVester.getPairAmount(user3.address, expandDecimals(1885, 18))
    ).gt(expandDecimals(1092, 18));
    expect(
      await nscVester.getPairAmount(user3.address, expandDecimals(1885, 18))
    ).lt(expandDecimals(1094, 18));
    expect(
      await nscVester.getPairAmount(user1.address, expandDecimals(1785, 18))
    ).gt(expandDecimals(1092, 18));
    expect(
      await nscVester.getPairAmount(user1.address, expandDecimals(1785, 18))
    ).lt(expandDecimals(1094, 18));

    await rewardRouter.connect(user1).compound();
    await rewardRouter.connect(user3).compound();

    expect(await feeNscTracker.balanceOf(user1.address)).gt(
      expandDecimals(1992, 18)
    );
    expect(await feeNscTracker.balanceOf(user1.address)).lt(
      expandDecimals(1993, 18)
    );

    await nscVester.connect(user1).deposit(expandDecimals(1785, 18));

    expect(await feeNscTracker.balanceOf(user1.address)).gt(
      expandDecimals(1991 - 1092, 18)
    ); // 899
    expect(await feeNscTracker.balanceOf(user1.address)).lt(
      expandDecimals(1993 - 1092, 18)
    ); // 901

    expect(
      await feeNscTracker.depositBalances(user1.address, bnNsc.address)
    ).gt(expandDecimals(4, 18));
    expect(
      await feeNscTracker.depositBalances(user1.address, bnNsc.address)
    ).lt(expandDecimals(6, 18));

    await rewardRouter.connect(user1).unstakeNsc(expandDecimals(200, 18));
    await expect(
      rewardRouter.connect(user1).unstakeEsNsc(expandDecimals(699, 18))
    ).to.be.revertedWith("RewardTracker: burn amount exceeds balance");

    await rewardRouter.connect(user1).unstakeEsNsc(expandDecimals(599, 18));

    await increaseTime(provider, 24 * 60 * 60);
    await mineBlock(provider);

    expect(await feeNscTracker.balanceOf(user1.address)).gt(
      expandDecimals(97, 18)
    );
    expect(await feeNscTracker.balanceOf(user1.address)).lt(
      expandDecimals(99, 18)
    );

    expect(await esNsc.balanceOf(user1.address)).gt(expandDecimals(599, 18));
    expect(await esNsc.balanceOf(user1.address)).lt(expandDecimals(601, 18));

    expect(await nsc.balanceOf(user1.address)).eq(expandDecimals(200, 18));

    await nscVester.connect(user1).withdraw();

    expect(await feeNscTracker.balanceOf(user1.address)).gt(
      expandDecimals(1190, 18)
    ); // 1190 - 98 => 1092
    expect(await feeNscTracker.balanceOf(user1.address)).lt(
      expandDecimals(1191, 18)
    );

    expect(await esNsc.balanceOf(user1.address)).gt(expandDecimals(2378, 18));
    expect(await esNsc.balanceOf(user1.address)).lt(expandDecimals(2380, 18));

    expect(await nsc.balanceOf(user1.address)).gt(expandDecimals(204, 18));
    expect(await nsc.balanceOf(user1.address)).lt(expandDecimals(206, 18));

    expect(await nlpVester.getMaxVestableAmount(user3.address)).gt(
      expandDecimals(1785, 18)
    );
    expect(await nlpVester.getMaxVestableAmount(user3.address)).lt(
      expandDecimals(1787, 18)
    );

    expect(
      await nlpVester.getPairAmount(user3.address, expandDecimals(1785, 18))
    ).gt(expandDecimals(298, 18));
    expect(
      await nlpVester.getPairAmount(user3.address, expandDecimals(1785, 18))
    ).lt(expandDecimals(300, 18));

    expect(await stakedNlpTracker.balanceOf(user3.address)).eq(
      "299100000000000000000"
    );

    expect(await esNsc.balanceOf(user3.address)).gt(expandDecimals(1785, 18));
    expect(await esNsc.balanceOf(user3.address)).lt(expandDecimals(1787, 18));

    expect(await nsc.balanceOf(user3.address)).eq(0);

    await nlpVester.connect(user3).deposit(expandDecimals(1785, 18));

    expect(await stakedNlpTracker.balanceOf(user3.address)).gt(0);
    expect(await stakedNlpTracker.balanceOf(user3.address)).lt(
      expandDecimals(1, 18)
    );

    expect(await esNsc.balanceOf(user3.address)).gt(0);
    expect(await esNsc.balanceOf(user3.address)).lt(expandDecimals(1, 18));

    expect(await nsc.balanceOf(user3.address)).eq(0);

    await expect(
      rewardRouter
        .connect(user3)
        .unstakeAndRedeemNlp(
          bnb.address,
          expandDecimals(1, 18),
          0,
          user3.address
        )
    ).to.be.revertedWith("RewardTracker: burn amount exceeds balance");

    await increaseTime(provider, 24 * 60 * 60);
    await mineBlock(provider);

    await nlpVester.connect(user3).withdraw();

    expect(await stakedNlpTracker.balanceOf(user3.address)).eq(
      "299100000000000000000"
    );

    expect(await esNsc.balanceOf(user3.address)).gt(
      expandDecimals(1785 - 5, 18)
    );
    expect(await esNsc.balanceOf(user3.address)).lt(
      expandDecimals(1787 - 5, 18)
    );

    expect(await nsc.balanceOf(user3.address)).gt(expandDecimals(4, 18));
    expect(await nsc.balanceOf(user3.address)).lt(expandDecimals(6, 18));

    expect(await feeNscTracker.balanceOf(user1.address)).gt(
      expandDecimals(1190, 18)
    );
    expect(await feeNscTracker.balanceOf(user1.address)).lt(
      expandDecimals(1191, 18)
    );

    expect(await esNsc.balanceOf(user1.address)).gt(expandDecimals(2379, 18));
    expect(await esNsc.balanceOf(user1.address)).lt(expandDecimals(2381, 18));

    expect(await nsc.balanceOf(user1.address)).gt(expandDecimals(204, 18));
    expect(await nsc.balanceOf(user1.address)).lt(expandDecimals(206, 18));

    await nscVester.connect(user1).deposit(expandDecimals(365 * 2, 18));

    expect(await feeNscTracker.balanceOf(user1.address)).gt(
      expandDecimals(743, 18)
    ); // 1190 - 743 => 447
    expect(await feeNscTracker.balanceOf(user1.address)).lt(
      expandDecimals(754, 18)
    );

    expect(await nscVester.claimable(user1.address)).eq(0);

    await increaseTime(provider, 48 * 60 * 60);
    await mineBlock(provider);

    expect(await nscVester.claimable(user1.address)).gt("3900000000000000000"); // 3.9
    expect(await nscVester.claimable(user1.address)).lt("4100000000000000000"); // 4.1

    await nscVester.connect(user1).deposit(expandDecimals(365, 18));

    expect(await feeNscTracker.balanceOf(user1.address)).gt(
      expandDecimals(522, 18)
    ); // 743 - 522 => 221
    expect(await feeNscTracker.balanceOf(user1.address)).lt(
      expandDecimals(524, 18)
    );

    await increaseTime(provider, 48 * 60 * 60);
    await mineBlock(provider);

    expect(await nscVester.claimable(user1.address)).gt("9900000000000000000"); // 9.9
    expect(await nscVester.claimable(user1.address)).lt("10100000000000000000"); // 10.1

    expect(await nsc.balanceOf(user1.address)).gt(expandDecimals(204, 18));
    expect(await nsc.balanceOf(user1.address)).lt(expandDecimals(206, 18));

    await nscVester.connect(user1).claim();

    expect(await nsc.balanceOf(user1.address)).gt(expandDecimals(214, 18));
    expect(await nsc.balanceOf(user1.address)).lt(expandDecimals(216, 18));

    await nscVester.connect(user1).deposit(expandDecimals(365, 18));
    expect(await nscVester.balanceOf(user1.address)).gt(
      expandDecimals(1449, 18)
    ); // 365 * 4 => 1460, 1460 - 10 => 1450
    expect(await nscVester.balanceOf(user1.address)).lt(
      expandDecimals(1451, 18)
    );
    expect(await nscVester.getVestedAmount(user1.address)).eq(
      expandDecimals(1460, 18)
    );

    expect(await feeNscTracker.balanceOf(user1.address)).gt(
      expandDecimals(303, 18)
    ); // 522 - 303 => 219
    expect(await feeNscTracker.balanceOf(user1.address)).lt(
      expandDecimals(304, 18)
    );

    await increaseTime(provider, 48 * 60 * 60);
    await mineBlock(provider);

    expect(await nscVester.claimable(user1.address)).gt("7900000000000000000"); // 7.9
    expect(await nscVester.claimable(user1.address)).lt("8100000000000000000"); // 8.1

    await nscVester.connect(user1).withdraw();

    expect(await feeNscTracker.balanceOf(user1.address)).gt(
      expandDecimals(1190, 18)
    );
    expect(await feeNscTracker.balanceOf(user1.address)).lt(
      expandDecimals(1191, 18)
    );

    expect(await nsc.balanceOf(user1.address)).gt(expandDecimals(222, 18));
    expect(await nsc.balanceOf(user1.address)).lt(expandDecimals(224, 18));

    expect(await esNsc.balanceOf(user1.address)).gt(expandDecimals(2360, 18));
    expect(await esNsc.balanceOf(user1.address)).lt(expandDecimals(2362, 18));

    await nscVester.connect(user1).deposit(expandDecimals(365, 18));

    await increaseTime(provider, 500 * 24 * 60 * 60);
    await mineBlock(provider);

    expect(await nscVester.claimable(user1.address)).eq(
      expandDecimals(365, 18)
    );

    await nscVester.connect(user1).withdraw();

    expect(await nsc.balanceOf(user1.address)).gt(
      expandDecimals(222 + 365, 18)
    );
    expect(await nsc.balanceOf(user1.address)).lt(
      expandDecimals(224 + 365, 18)
    );

    expect(await esNsc.balanceOf(user1.address)).gt(
      expandDecimals(2360 - 365, 18)
    );
    expect(await esNsc.balanceOf(user1.address)).lt(
      expandDecimals(2362 - 365, 18)
    );

    expect(await nscVester.transferredAverageStakedAmounts(user2.address)).eq(
      0
    );
    expect(await nscVester.transferredAverageStakedAmounts(user3.address)).eq(
      expandDecimals(200, 18)
    );
    expect(await stakedNscTracker.cumulativeRewards(user2.address)).gt(
      expandDecimals(892, 18)
    );
    expect(await stakedNscTracker.cumulativeRewards(user2.address)).lt(
      expandDecimals(893, 18)
    );
    expect(await stakedNscTracker.cumulativeRewards(user3.address)).gt(
      expandDecimals(892, 18)
    );
    expect(await stakedNscTracker.cumulativeRewards(user3.address)).lt(
      expandDecimals(893, 18)
    );
    expect(await nscVester.transferredCumulativeRewards(user3.address)).gt(
      expandDecimals(892, 18)
    );
    expect(await nscVester.transferredCumulativeRewards(user3.address)).lt(
      expandDecimals(893, 18)
    );
    expect(await nscVester.bonusRewards(user2.address)).eq(0);
    expect(await nscVester.bonusRewards(user3.address)).eq(
      expandDecimals(100, 18)
    );
    expect(await nscVester.getCombinedAverageStakedAmount(user2.address)).eq(
      expandDecimals(200, 18)
    );
    expect(await nscVester.getCombinedAverageStakedAmount(user3.address)).gt(
      expandDecimals(1092, 18)
    );
    expect(await nscVester.getCombinedAverageStakedAmount(user3.address)).lt(
      expandDecimals(1093, 18)
    );
    expect(await nscVester.getMaxVestableAmount(user2.address)).eq(0);
    expect(await nscVester.getMaxVestableAmount(user3.address)).gt(
      expandDecimals(1884, 18)
    );
    expect(await nscVester.getMaxVestableAmount(user3.address)).lt(
      expandDecimals(1886, 18)
    );
    expect(
      await nscVester.getPairAmount(user2.address, expandDecimals(992, 18))
    ).eq(0);
    expect(
      await nscVester.getPairAmount(user3.address, expandDecimals(992, 18))
    ).gt(expandDecimals(574, 18));
    expect(
      await nscVester.getPairAmount(user3.address, expandDecimals(992, 18))
    ).lt(expandDecimals(575, 18));
    expect(
      await nscVester.getPairAmount(user1.address, expandDecimals(892, 18))
    ).gt(expandDecimals(545, 18));
    expect(
      await nscVester.getPairAmount(user1.address, expandDecimals(892, 18))
    ).lt(expandDecimals(546, 18));

    const esNscBatchSender = await deployContract("EsNscBatchSender", [
      esNsc.address,
    ]);

    await timelock.signalSetHandler(
      esNsc.address,
      esNscBatchSender.address,
      true
    );
    await timelock.signalSetHandler(
      nscVester.address,
      esNscBatchSender.address,
      true
    );
    await timelock.signalSetHandler(
      nlpVester.address,
      esNscBatchSender.address,
      true
    );
    await timelock.signalMint(
      esNsc.address,
      wallet.address,
      expandDecimals(1000, 18)
    );

    await increaseTime(provider, 20);
    await mineBlock(provider);

    await timelock.setHandler(esNsc.address, esNscBatchSender.address, true);
    await timelock.setHandler(
      nscVester.address,
      esNscBatchSender.address,
      true
    );
    await timelock.setHandler(
      nlpVester.address,
      esNscBatchSender.address,
      true
    );
    await timelock.processMint(
      esNsc.address,
      wallet.address,
      expandDecimals(1000, 18)
    );

    await esNscBatchSender
      .connect(wallet)
      .send(
        nscVester.address,
        4,
        [user2.address, user3.address],
        [expandDecimals(100, 18), expandDecimals(200, 18)]
      );

    expect(await nscVester.transferredAverageStakedAmounts(user2.address)).gt(
      expandDecimals(37648, 18)
    );
    expect(await nscVester.transferredAverageStakedAmounts(user2.address)).lt(
      expandDecimals(37649, 18)
    );
    expect(await nscVester.transferredAverageStakedAmounts(user3.address)).gt(
      expandDecimals(12810, 18)
    );
    expect(await nscVester.transferredAverageStakedAmounts(user3.address)).lt(
      expandDecimals(12811, 18)
    );
    expect(await nscVester.transferredCumulativeRewards(user2.address)).eq(
      expandDecimals(100, 18)
    );
    expect(await nscVester.transferredCumulativeRewards(user3.address)).gt(
      expandDecimals(892 + 200, 18)
    );
    expect(await nscVester.transferredCumulativeRewards(user3.address)).lt(
      expandDecimals(893 + 200, 18)
    );
    expect(await nscVester.bonusRewards(user2.address)).eq(0);
    expect(await nscVester.bonusRewards(user3.address)).eq(
      expandDecimals(100, 18)
    );
    expect(await nscVester.getCombinedAverageStakedAmount(user2.address)).gt(
      expandDecimals(3971, 18)
    );
    expect(await nscVester.getCombinedAverageStakedAmount(user2.address)).lt(
      expandDecimals(3972, 18)
    );
    expect(await nscVester.getCombinedAverageStakedAmount(user3.address)).gt(
      expandDecimals(7943, 18)
    );
    expect(await nscVester.getCombinedAverageStakedAmount(user3.address)).lt(
      expandDecimals(7944, 18)
    );
    expect(await nscVester.getMaxVestableAmount(user2.address)).eq(
      expandDecimals(100, 18)
    );
    expect(await nscVester.getMaxVestableAmount(user3.address)).gt(
      expandDecimals(1884 + 200, 18)
    );
    expect(await nscVester.getMaxVestableAmount(user3.address)).lt(
      expandDecimals(1886 + 200, 18)
    );
    expect(
      await nscVester.getPairAmount(user2.address, expandDecimals(100, 18))
    ).gt(expandDecimals(3971, 18));
    expect(
      await nscVester.getPairAmount(user2.address, expandDecimals(100, 18))
    ).lt(expandDecimals(3972, 18));
    expect(
      await nscVester.getPairAmount(
        user3.address,
        expandDecimals(1884 + 200, 18)
      )
    ).gt(expandDecimals(7936, 18));
    expect(
      await nscVester.getPairAmount(
        user3.address,
        expandDecimals(1884 + 200, 18)
      )
    ).lt(expandDecimals(7937, 18));

    expect(await nlpVester.transferredAverageStakedAmounts(user4.address)).eq(
      0
    );
    expect(await nlpVester.transferredCumulativeRewards(user4.address)).eq(0);
    expect(await nlpVester.bonusRewards(user4.address)).eq(0);
    expect(await nlpVester.getCombinedAverageStakedAmount(user4.address)).eq(0);
    expect(await nlpVester.getMaxVestableAmount(user4.address)).eq(0);
    expect(
      await nlpVester.getPairAmount(user4.address, expandDecimals(10, 18))
    ).eq(0);

    await esNscBatchSender
      .connect(wallet)
      .send(nlpVester.address, 320, [user4.address], [expandDecimals(10, 18)]);

    expect(await nlpVester.transferredAverageStakedAmounts(user4.address)).eq(
      expandDecimals(3200, 18)
    );
    expect(await nlpVester.transferredCumulativeRewards(user4.address)).eq(
      expandDecimals(10, 18)
    );
    expect(await nlpVester.bonusRewards(user4.address)).eq(0);
    expect(await nlpVester.getCombinedAverageStakedAmount(user4.address)).eq(
      expandDecimals(3200, 18)
    );
    expect(await nlpVester.getMaxVestableAmount(user4.address)).eq(
      expandDecimals(10, 18)
    );
    expect(
      await nlpVester.getPairAmount(user4.address, expandDecimals(10, 18))
    ).eq(expandDecimals(3200, 18));

    await esNscBatchSender
      .connect(wallet)
      .send(nlpVester.address, 320, [user4.address], [expandDecimals(10, 18)]);

    expect(await nlpVester.transferredAverageStakedAmounts(user4.address)).eq(
      expandDecimals(6400, 18)
    );
    expect(await nlpVester.transferredCumulativeRewards(user4.address)).eq(
      expandDecimals(20, 18)
    );
    expect(await nlpVester.bonusRewards(user4.address)).eq(0);
    expect(await nlpVester.getCombinedAverageStakedAmount(user4.address)).eq(
      expandDecimals(6400, 18)
    );
    expect(await nlpVester.getMaxVestableAmount(user4.address)).eq(
      expandDecimals(20, 18)
    );
    expect(
      await nlpVester.getPairAmount(user4.address, expandDecimals(10, 18))
    ).eq(expandDecimals(3200, 18));
  });

  it("handleRewards", async () => {
    const rewardManagerV2 = await deployContract("RewardManager", []);

    // use new rewardRouter, use eth for weth
    const rewardRouterV2 = await deployContract("RewardRouter", []);
    await rewardRouterV2.initialize(
      eth.address,
      nsc.address,
      esNsc.address,
      bnNsc.address,
      nlp.address,
      stakedNscTracker.address,
      bonusNscTracker.address,
      feeNscTracker.address,
      feeNlpTracker.address,
      stakedNlpTracker.address,
      nlpManager.address,
      nscVester.address,
      nlpVester.address
    );

    const timelockV2 = await deployContract("Timelock", [
      wallet.address,
      10,
      tokenManager.address,
      ADDRESS_ZERO,
      tokenManager.address,
      rewardRouterV2.address,
      rewardManagerV2.address,
      expandDecimals(1000000, 18),
      10,
      100,
    ]);

    await rewardManagerV2.initialize(
      timelockV2.address,
      rewardRouterV2.address,
      nlpManager.address,
      stakedNscTracker.address,
      bonusNscTracker.address,
      feeNscTracker.address,
      feeNlpTracker.address,
      stakedNlpTracker.address,
      stakedNscDistributor.address,
      stakedNlpDistributor.address,
      esNsc.address,
      bnNsc.address,
      nscVester.address,
      nlpVester.address
    );

    await timelock.signalSetGov(nlpManager.address, timelockV2.address);
    await timelock.signalSetGov(stakedNscTracker.address, timelockV2.address);
    await timelock.signalSetGov(bonusNscTracker.address, timelockV2.address);
    await timelock.signalSetGov(feeNscTracker.address, timelockV2.address);
    await timelock.signalSetGov(feeNlpTracker.address, timelockV2.address);
    await timelock.signalSetGov(stakedNlpTracker.address, timelockV2.address);
    await timelock.signalSetGov(
      stakedNscDistributor.address,
      timelockV2.address
    );
    await timelock.signalSetGov(
      stakedNlpDistributor.address,
      timelockV2.address
    );
    await timelock.signalSetGov(esNsc.address, timelockV2.address);
    await timelock.signalSetGov(bnNsc.address, timelockV2.address);
    await timelock.signalSetGov(nscVester.address, timelockV2.address);
    await timelock.signalSetGov(nlpVester.address, timelockV2.address);

    await increaseTime(provider, 20);
    await mineBlock(provider);

    await timelock.setGov(nlpManager.address, timelockV2.address);
    await timelock.setGov(stakedNscTracker.address, timelockV2.address);
    await timelock.setGov(bonusNscTracker.address, timelockV2.address);
    await timelock.setGov(feeNscTracker.address, timelockV2.address);
    await timelock.setGov(feeNlpTracker.address, timelockV2.address);
    await timelock.setGov(stakedNlpTracker.address, timelockV2.address);
    await timelock.setGov(stakedNscDistributor.address, timelockV2.address);
    await timelock.setGov(stakedNlpDistributor.address, timelockV2.address);
    await timelock.setGov(esNsc.address, timelockV2.address);
    await timelock.setGov(bnNsc.address, timelockV2.address);
    await timelock.setGov(nscVester.address, timelockV2.address);
    await timelock.setGov(nlpVester.address, timelockV2.address);

    await rewardManagerV2.updateEsNscHandlers();
    await rewardManagerV2.enableRewardRouter();

    await eth.deposit({ value: expandDecimals(10, 18) });

    await nsc.setMinter(wallet.address, true);
    await nsc.mint(nscVester.address, expandDecimals(10000, 18));
    await nsc.mint(nlpVester.address, expandDecimals(10000, 18));

    await eth.mint(feeNlpDistributor.address, expandDecimals(50, 18));
    await feeNlpDistributor.setTokensPerInterval("41335970000000"); // 0.00004133597 ETH per second

    await eth.mint(feeNscDistributor.address, expandDecimals(50, 18));
    await feeNscDistributor.setTokensPerInterval("41335970000000"); // 0.00004133597 ETH per second

    await bnb.mint(user1.address, expandDecimals(1, 18));
    await bnb.connect(user1).approve(nlpManager.address, expandDecimals(1, 18));
    await rewardRouterV2
      .connect(user1)
      .mintAndStakeNlp(
        bnb.address,
        expandDecimals(1, 18),
        expandDecimals(299, 18),
        expandDecimals(299, 18)
      );

    await nsc.mint(user1.address, expandDecimals(200, 18));
    expect(await nsc.balanceOf(user1.address)).eq(expandDecimals(200, 18));
    await nsc
      .connect(user1)
      .approve(stakedNscTracker.address, expandDecimals(200, 18));
    await rewardRouterV2.connect(user1).stakeNsc(expandDecimals(200, 18));
    expect(await nsc.balanceOf(user1.address)).eq(0);

    await increaseTime(provider, 24 * 60 * 60);
    await mineBlock(provider);

    expect(await nsc.balanceOf(user1.address)).eq(0);
    expect(await esNsc.balanceOf(user1.address)).eq(0);
    expect(await bnNsc.balanceOf(user1.address)).eq(0);
    expect(await nlp.balanceOf(user1.address)).eq(0);
    expect(await eth.balanceOf(user1.address)).eq(0);

    expect(
      await stakedNscTracker.depositBalances(user1.address, nsc.address)
    ).eq(expandDecimals(200, 18));
    expect(
      await stakedNscTracker.depositBalances(user1.address, esNsc.address)
    ).eq(0);
    expect(
      await feeNscTracker.depositBalances(user1.address, bnNsc.address)
    ).eq(0);

    await rewardRouterV2.connect(user1).handleRewards(
      true, // _shouldClaimNsc
      true, // _shouldStakeNsc
      true, // _shouldClaimEsNsc
      true, // _shouldStakeEsNsc
      true, // _shouldStakeMultiplierPoints
      true, // _shouldClaimWeth
      false // _shouldConvertWethToEth
    );

    expect(await nsc.balanceOf(user1.address)).eq(0);
    expect(await esNsc.balanceOf(user1.address)).eq(0);
    expect(await bnNsc.balanceOf(user1.address)).eq(0);
    expect(await nlp.balanceOf(user1.address)).eq(0);
    expect(await eth.balanceOf(user1.address)).gt(expandDecimals(7, 18));
    expect(await eth.balanceOf(user1.address)).lt(expandDecimals(8, 18));

    expect(
      await stakedNscTracker.depositBalances(user1.address, nsc.address)
    ).eq(expandDecimals(200, 18));
    expect(
      await stakedNscTracker.depositBalances(user1.address, esNsc.address)
    ).gt(expandDecimals(3571, 18));
    expect(
      await stakedNscTracker.depositBalances(user1.address, esNsc.address)
    ).lt(expandDecimals(3572, 18));
    expect(
      await feeNscTracker.depositBalances(user1.address, bnNsc.address)
    ).gt("540000000000000000"); // 0.54
    expect(
      await feeNscTracker.depositBalances(user1.address, bnNsc.address)
    ).lt("560000000000000000"); // 0.56

    await increaseTime(provider, 24 * 60 * 60);
    await mineBlock(provider);

    const ethBalance0 = await provider.getBalance(user1.address);

    await rewardRouterV2.connect(user1).handleRewards(
      false, // _shouldClaimNsc
      false, // _shouldStakeNsc
      false, // _shouldClaimEsNsc
      false, // _shouldStakeEsNsc
      false, // _shouldStakeMultiplierPoints
      true, // _shouldClaimWeth
      true // _shouldConvertWethToEth
    );

    const ethBalance1 = await provider.getBalance(user1.address);

    expect(await ethBalance1.sub(ethBalance0)).gt(expandDecimals(7, 18));
    expect(await ethBalance1.sub(ethBalance0)).lt(expandDecimals(8, 18));
    expect(await nsc.balanceOf(user1.address)).eq(0);
    expect(await esNsc.balanceOf(user1.address)).eq(0);
    expect(await bnNsc.balanceOf(user1.address)).eq(0);
    expect(await nlp.balanceOf(user1.address)).eq(0);
    expect(await eth.balanceOf(user1.address)).gt(expandDecimals(7, 18));
    expect(await eth.balanceOf(user1.address)).lt(expandDecimals(8, 18));

    expect(
      await stakedNscTracker.depositBalances(user1.address, nsc.address)
    ).eq(expandDecimals(200, 18));
    expect(
      await stakedNscTracker.depositBalances(user1.address, esNsc.address)
    ).gt(expandDecimals(3571, 18));
    expect(
      await stakedNscTracker.depositBalances(user1.address, esNsc.address)
    ).lt(expandDecimals(3572, 18));
    expect(
      await feeNscTracker.depositBalances(user1.address, bnNsc.address)
    ).gt("540000000000000000"); // 0.54
    expect(
      await feeNscTracker.depositBalances(user1.address, bnNsc.address)
    ).lt("560000000000000000"); // 0.56

    await rewardRouterV2.connect(user1).handleRewards(
      false, // _shouldClaimNsc
      false, // _shouldStakeNsc
      true, // _shouldClaimEsNsc
      false, // _shouldStakeEsNsc
      false, // _shouldStakeMultiplierPoints
      false, // _shouldClaimWeth
      false // _shouldConvertWethToEth
    );

    expect(await ethBalance1.sub(ethBalance0)).gt(expandDecimals(7, 18));
    expect(await ethBalance1.sub(ethBalance0)).lt(expandDecimals(8, 18));
    expect(await nsc.balanceOf(user1.address)).eq(0);
    expect(await esNsc.balanceOf(user1.address)).gt(expandDecimals(3571, 18));
    expect(await esNsc.balanceOf(user1.address)).lt(expandDecimals(3572, 18));
    expect(await bnNsc.balanceOf(user1.address)).eq(0);
    expect(await nlp.balanceOf(user1.address)).eq(0);
    expect(await eth.balanceOf(user1.address)).gt(expandDecimals(7, 18));
    expect(await eth.balanceOf(user1.address)).lt(expandDecimals(8, 18));

    expect(
      await stakedNscTracker.depositBalances(user1.address, nsc.address)
    ).eq(expandDecimals(200, 18));
    expect(
      await stakedNscTracker.depositBalances(user1.address, esNsc.address)
    ).gt(expandDecimals(3571, 18));
    expect(
      await stakedNscTracker.depositBalances(user1.address, esNsc.address)
    ).lt(expandDecimals(3572, 18));
    expect(
      await feeNscTracker.depositBalances(user1.address, bnNsc.address)
    ).gt("540000000000000000"); // 0.54
    expect(
      await feeNscTracker.depositBalances(user1.address, bnNsc.address)
    ).lt("560000000000000000"); // 0.56

    await nscVester.connect(user1).deposit(expandDecimals(365, 18));
    await nlpVester.connect(user1).deposit(expandDecimals(365 * 2, 18));

    expect(await ethBalance1.sub(ethBalance0)).gt(expandDecimals(7, 18));
    expect(await ethBalance1.sub(ethBalance0)).lt(expandDecimals(8, 18));
    expect(await nsc.balanceOf(user1.address)).eq(0);
    expect(await esNsc.balanceOf(user1.address)).gt(
      expandDecimals(3571 - 365 * 3, 18)
    );
    expect(await esNsc.balanceOf(user1.address)).lt(
      expandDecimals(3572 - 365 * 3, 18)
    );
    expect(await bnNsc.balanceOf(user1.address)).eq(0);
    expect(await nlp.balanceOf(user1.address)).eq(0);
    expect(await eth.balanceOf(user1.address)).gt(expandDecimals(7, 18));
    expect(await eth.balanceOf(user1.address)).lt(expandDecimals(8, 18));

    expect(
      await stakedNscTracker.depositBalances(user1.address, nsc.address)
    ).eq(expandDecimals(200, 18));
    expect(
      await stakedNscTracker.depositBalances(user1.address, esNsc.address)
    ).gt(expandDecimals(3571, 18));
    expect(
      await stakedNscTracker.depositBalances(user1.address, esNsc.address)
    ).lt(expandDecimals(3572, 18));
    expect(
      await feeNscTracker.depositBalances(user1.address, bnNsc.address)
    ).gt("540000000000000000"); // 0.54
    expect(
      await feeNscTracker.depositBalances(user1.address, bnNsc.address)
    ).lt("560000000000000000"); // 0.56

    await increaseTime(provider, 24 * 60 * 60);
    await mineBlock(provider);

    await rewardRouterV2.connect(user1).handleRewards(
      true, // _shouldClaimNsc
      false, // _shouldStakeNsc
      false, // _shouldClaimEsNsc
      false, // _shouldStakeEsNsc
      false, // _shouldStakeMultiplierPoints
      false, // _shouldClaimWeth
      false // _shouldConvertWethToEth
    );

    expect(await ethBalance1.sub(ethBalance0)).gt(expandDecimals(7, 18));
    expect(await ethBalance1.sub(ethBalance0)).lt(expandDecimals(8, 18));
    expect(await nsc.balanceOf(user1.address)).gt("2900000000000000000"); // 2.9
    expect(await nsc.balanceOf(user1.address)).lt("3100000000000000000"); // 3.1
    expect(await esNsc.balanceOf(user1.address)).gt(
      expandDecimals(3571 - 365 * 3, 18)
    );
    expect(await esNsc.balanceOf(user1.address)).lt(
      expandDecimals(3572 - 365 * 3, 18)
    );
    expect(await bnNsc.balanceOf(user1.address)).eq(0);
    expect(await nlp.balanceOf(user1.address)).eq(0);
    expect(await eth.balanceOf(user1.address)).gt(expandDecimals(7, 18));
    expect(await eth.balanceOf(user1.address)).lt(expandDecimals(8, 18));

    expect(
      await stakedNscTracker.depositBalances(user1.address, nsc.address)
    ).eq(expandDecimals(200, 18));
    expect(
      await stakedNscTracker.depositBalances(user1.address, esNsc.address)
    ).gt(expandDecimals(3571, 18));
    expect(
      await stakedNscTracker.depositBalances(user1.address, esNsc.address)
    ).lt(expandDecimals(3572, 18));
    expect(
      await feeNscTracker.depositBalances(user1.address, bnNsc.address)
    ).gt("540000000000000000"); // 0.54
    expect(
      await feeNscTracker.depositBalances(user1.address, bnNsc.address)
    ).lt("560000000000000000"); // 0.56
  });

  it("StakedNlp", async () => {
    await eth.mint(feeNlpDistributor.address, expandDecimals(100, 18));
    await feeNlpDistributor.setTokensPerInterval("41335970000000"); // 0.00004133597 ETH per second

    await bnb.mint(user1.address, expandDecimals(1, 18));
    await bnb.connect(user1).approve(nlpManager.address, expandDecimals(1, 18));
    await rewardRouter
      .connect(user1)
      .mintAndStakeNlp(
        bnb.address,
        expandDecimals(1, 18),
        expandDecimals(299, 18),
        expandDecimals(299, 18)
      );

    expect(await feeNlpTracker.stakedAmounts(user1.address)).eq(
      expandDecimals(2991, 17)
    );
    expect(await feeNlpTracker.depositBalances(user1.address, nlp.address)).eq(
      expandDecimals(2991, 17)
    );

    expect(await stakedNlpTracker.stakedAmounts(user1.address)).eq(
      expandDecimals(2991, 17)
    );
    expect(
      await stakedNlpTracker.depositBalances(
        user1.address,
        feeNlpTracker.address
      )
    ).eq(expandDecimals(2991, 17));

    const stakedNlp = await deployContract("StakedNlp", [
      nlp.address,
      nlpManager.address,
      stakedNlpTracker.address,
      feeNlpTracker.address,
    ]);

    await expect(
      stakedNlp
        .connect(user2)
        .transferFrom(user1.address, user3.address, expandDecimals(2991, 17))
    ).to.be.revertedWith("StakedNlp: transfer amount exceeds allowance");

    await stakedNlp
      .connect(user1)
      .approve(user2.address, expandDecimals(2991, 17));

    await expect(
      stakedNlp
        .connect(user2)
        .transferFrom(user1.address, user3.address, expandDecimals(2991, 17))
    ).to.be.revertedWith("StakedNlp: cooldown duration not yet passed");

    await increaseTime(provider, 24 * 60 * 60 + 10);
    await mineBlock(provider);

    await expect(
      stakedNlp
        .connect(user2)
        .transferFrom(user1.address, user3.address, expandDecimals(2991, 17))
    ).to.be.revertedWith("RewardTracker: forbidden");

    await timelock.signalSetHandler(
      stakedNlpTracker.address,
      stakedNlp.address,
      true
    );
    await increaseTime(provider, 20);
    await mineBlock(provider);
    await timelock.setHandler(
      stakedNlpTracker.address,
      stakedNlp.address,
      true
    );

    await expect(
      stakedNlp
        .connect(user2)
        .transferFrom(user1.address, user3.address, expandDecimals(2991, 17))
    ).to.be.revertedWith("RewardTracker: forbidden");

    await timelock.signalSetHandler(
      feeNlpTracker.address,
      stakedNlp.address,
      true
    );
    await increaseTime(provider, 20);
    await mineBlock(provider);
    await timelock.setHandler(feeNlpTracker.address, stakedNlp.address, true);

    expect(await feeNlpTracker.stakedAmounts(user1.address)).eq(
      expandDecimals(2991, 17)
    );
    expect(await feeNlpTracker.depositBalances(user1.address, nlp.address)).eq(
      expandDecimals(2991, 17)
    );

    expect(await stakedNlpTracker.stakedAmounts(user1.address)).eq(
      expandDecimals(2991, 17)
    );
    expect(
      await stakedNlpTracker.depositBalances(
        user1.address,
        feeNlpTracker.address
      )
    ).eq(expandDecimals(2991, 17));

    expect(await feeNlpTracker.stakedAmounts(user3.address)).eq(0);
    expect(await feeNlpTracker.depositBalances(user3.address, nlp.address)).eq(
      0
    );

    expect(await stakedNlpTracker.stakedAmounts(user3.address)).eq(0);
    expect(
      await stakedNlpTracker.depositBalances(
        user3.address,
        feeNlpTracker.address
      )
    ).eq(0);

    await stakedNlp
      .connect(user2)
      .transferFrom(user1.address, user3.address, expandDecimals(2991, 17));

    expect(await feeNlpTracker.stakedAmounts(user1.address)).eq(0);
    expect(await feeNlpTracker.depositBalances(user1.address, nlp.address)).eq(
      0
    );

    expect(await stakedNlpTracker.stakedAmounts(user1.address)).eq(0);
    expect(
      await stakedNlpTracker.depositBalances(
        user1.address,
        feeNlpTracker.address
      )
    ).eq(0);

    expect(await feeNlpTracker.stakedAmounts(user3.address)).eq(
      expandDecimals(2991, 17)
    );
    expect(await feeNlpTracker.depositBalances(user3.address, nlp.address)).eq(
      expandDecimals(2991, 17)
    );

    expect(await stakedNlpTracker.stakedAmounts(user3.address)).eq(
      expandDecimals(2991, 17)
    );
    expect(
      await stakedNlpTracker.depositBalances(
        user3.address,
        feeNlpTracker.address
      )
    ).eq(expandDecimals(2991, 17));

    await expect(
      stakedNlp
        .connect(user2)
        .transferFrom(user3.address, user1.address, expandDecimals(3000, 17))
    ).to.be.revertedWith("StakedNlp: transfer amount exceeds allowance");

    await stakedNlp
      .connect(user3)
      .approve(user2.address, expandDecimals(3000, 17));

    await expect(
      stakedNlp
        .connect(user2)
        .transferFrom(user3.address, user1.address, expandDecimals(3000, 17))
    ).to.be.revertedWith("RewardTracker: _amount exceeds stakedAmount");

    await stakedNlp
      .connect(user2)
      .transferFrom(user3.address, user1.address, expandDecimals(1000, 17));

    expect(await feeNlpTracker.stakedAmounts(user1.address)).eq(
      expandDecimals(1000, 17)
    );
    expect(await feeNlpTracker.depositBalances(user1.address, nlp.address)).eq(
      expandDecimals(1000, 17)
    );

    expect(await stakedNlpTracker.stakedAmounts(user1.address)).eq(
      expandDecimals(1000, 17)
    );
    expect(
      await stakedNlpTracker.depositBalances(
        user1.address,
        feeNlpTracker.address
      )
    ).eq(expandDecimals(1000, 17));

    expect(await feeNlpTracker.stakedAmounts(user3.address)).eq(
      expandDecimals(1991, 17)
    );
    expect(await feeNlpTracker.depositBalances(user3.address, nlp.address)).eq(
      expandDecimals(1991, 17)
    );

    expect(await stakedNlpTracker.stakedAmounts(user3.address)).eq(
      expandDecimals(1991, 17)
    );
    expect(
      await stakedNlpTracker.depositBalances(
        user3.address,
        feeNlpTracker.address
      )
    ).eq(expandDecimals(1991, 17));

    await stakedNlp
      .connect(user3)
      .transfer(user1.address, expandDecimals(1500, 17));

    expect(await feeNlpTracker.stakedAmounts(user1.address)).eq(
      expandDecimals(2500, 17)
    );
    expect(await feeNlpTracker.depositBalances(user1.address, nlp.address)).eq(
      expandDecimals(2500, 17)
    );

    expect(await stakedNlpTracker.stakedAmounts(user1.address)).eq(
      expandDecimals(2500, 17)
    );
    expect(
      await stakedNlpTracker.depositBalances(
        user1.address,
        feeNlpTracker.address
      )
    ).eq(expandDecimals(2500, 17));

    expect(await feeNlpTracker.stakedAmounts(user3.address)).eq(
      expandDecimals(491, 17)
    );
    expect(await feeNlpTracker.depositBalances(user3.address, nlp.address)).eq(
      expandDecimals(491, 17)
    );

    expect(await stakedNlpTracker.stakedAmounts(user3.address)).eq(
      expandDecimals(491, 17)
    );
    expect(
      await stakedNlpTracker.depositBalances(
        user3.address,
        feeNlpTracker.address
      )
    ).eq(expandDecimals(491, 17));

    await expect(
      stakedNlp.connect(user3).transfer(user1.address, expandDecimals(492, 17))
    ).to.be.revertedWith("RewardTracker: _amount exceeds stakedAmount");

    expect(await bnb.balanceOf(user1.address)).eq(0);

    await rewardRouter.connect(user1).unstakeAndRedeemNlp(
      bnb.address,
      expandDecimals(2500, 17),
      "830000000000000000", // 0.83
      user1.address
    );

    expect(await bnb.balanceOf(user1.address)).eq("830833333333333333");

    await usdg.addVault(nlpManager.address);

    expect(await bnb.balanceOf(user3.address)).eq("0");

    await rewardRouter.connect(user3).unstakeAndRedeemNlp(
      bnb.address,
      expandDecimals(491, 17),
      "160000000000000000", // 0.16
      user3.address
    );

    expect(await bnb.balanceOf(user3.address)).eq("163175666666666666");
  });

  it("FeeNlp", async () => {
    await eth.mint(feeNlpDistributor.address, expandDecimals(100, 18));
    await feeNlpDistributor.setTokensPerInterval("41335970000000"); // 0.00004133597 ETH per second

    await bnb.mint(user1.address, expandDecimals(1, 18));
    await bnb.connect(user1).approve(nlpManager.address, expandDecimals(1, 18));
    await rewardRouter
      .connect(user1)
      .mintAndStakeNlp(
        bnb.address,
        expandDecimals(1, 18),
        expandDecimals(299, 18),
        expandDecimals(299, 18)
      );

    expect(await feeNlpTracker.stakedAmounts(user1.address)).eq(
      expandDecimals(2991, 17)
    );
    expect(await feeNlpTracker.depositBalances(user1.address, nlp.address)).eq(
      expandDecimals(2991, 17)
    );

    expect(await stakedNlpTracker.stakedAmounts(user1.address)).eq(
      expandDecimals(2991, 17)
    );
    expect(
      await stakedNlpTracker.depositBalances(
        user1.address,
        feeNlpTracker.address
      )
    ).eq(expandDecimals(2991, 17));

    const nlpBalance = await deployContract("NlpBalance", [
      nlpManager.address,
      stakedNlpTracker.address,
    ]);

    await expect(
      nlpBalance
        .connect(user2)
        .transferFrom(user1.address, user3.address, expandDecimals(2991, 17))
    ).to.be.revertedWith("NlpBalance: transfer amount exceeds allowance");

    await nlpBalance
      .connect(user1)
      .approve(user2.address, expandDecimals(2991, 17));

    await expect(
      nlpBalance
        .connect(user2)
        .transferFrom(user1.address, user3.address, expandDecimals(2991, 17))
    ).to.be.revertedWith("NlpBalance: cooldown duration not yet passed");

    await increaseTime(provider, 24 * 60 * 60 + 10);
    await mineBlock(provider);

    await expect(
      nlpBalance
        .connect(user2)
        .transferFrom(user1.address, user3.address, expandDecimals(2991, 17))
    ).to.be.revertedWith("RewardTracker: transfer amount exceeds allowance");

    await timelock.signalSetHandler(
      stakedNlpTracker.address,
      nlpBalance.address,
      true
    );
    await increaseTime(provider, 20);
    await mineBlock(provider);
    await timelock.setHandler(
      stakedNlpTracker.address,
      nlpBalance.address,
      true
    );

    expect(await feeNlpTracker.stakedAmounts(user1.address)).eq(
      expandDecimals(2991, 17)
    );
    expect(await feeNlpTracker.depositBalances(user1.address, nlp.address)).eq(
      expandDecimals(2991, 17)
    );

    expect(await stakedNlpTracker.stakedAmounts(user1.address)).eq(
      expandDecimals(2991, 17)
    );
    expect(
      await stakedNlpTracker.depositBalances(
        user1.address,
        feeNlpTracker.address
      )
    ).eq(expandDecimals(2991, 17));
    expect(await stakedNlpTracker.balanceOf(user1.address)).eq(
      expandDecimals(2991, 17)
    );

    expect(await feeNlpTracker.stakedAmounts(user3.address)).eq(0);
    expect(await feeNlpTracker.depositBalances(user3.address, nlp.address)).eq(
      0
    );

    expect(await stakedNlpTracker.stakedAmounts(user3.address)).eq(0);
    expect(
      await stakedNlpTracker.depositBalances(
        user3.address,
        feeNlpTracker.address
      )
    ).eq(0);
    expect(await stakedNlpTracker.balanceOf(user3.address)).eq(0);

    await nlpBalance
      .connect(user2)
      .transferFrom(user1.address, user3.address, expandDecimals(2991, 17));

    expect(await feeNlpTracker.stakedAmounts(user1.address)).eq(
      expandDecimals(2991, 17)
    );
    expect(await feeNlpTracker.depositBalances(user1.address, nlp.address)).eq(
      expandDecimals(2991, 17)
    );

    expect(await stakedNlpTracker.stakedAmounts(user1.address)).eq(
      expandDecimals(2991, 17)
    );
    expect(
      await stakedNlpTracker.depositBalances(
        user1.address,
        feeNlpTracker.address
      )
    ).eq(expandDecimals(2991, 17));
    expect(await stakedNlpTracker.balanceOf(user1.address)).eq(0);

    expect(await feeNlpTracker.stakedAmounts(user3.address)).eq(0);
    expect(await feeNlpTracker.depositBalances(user3.address, nlp.address)).eq(
      0
    );

    expect(await stakedNlpTracker.stakedAmounts(user3.address)).eq(0);
    expect(
      await stakedNlpTracker.depositBalances(
        user3.address,
        feeNlpTracker.address
      )
    ).eq(0);
    expect(await stakedNlpTracker.balanceOf(user3.address)).eq(
      expandDecimals(2991, 17)
    );

    await expect(
      rewardRouter
        .connect(user1)
        .unstakeAndRedeemNlp(
          bnb.address,
          expandDecimals(2991, 17),
          "0",
          user1.address
        )
    ).to.be.revertedWith("RewardTracker: burn amount exceeds balance");

    await nlpBalance
      .connect(user3)
      .approve(user2.address, expandDecimals(3000, 17));

    await expect(
      nlpBalance
        .connect(user2)
        .transferFrom(user3.address, user1.address, expandDecimals(2992, 17))
    ).to.be.revertedWith("RewardTracker: transfer amount exceeds balance");

    await nlpBalance
      .connect(user2)
      .transferFrom(user3.address, user1.address, expandDecimals(2991, 17));

    expect(await bnb.balanceOf(user1.address)).eq(0);

    await rewardRouter
      .connect(user1)
      .unstakeAndRedeemNlp(
        bnb.address,
        expandDecimals(2991, 17),
        "0",
        user1.address
      );

    expect(await bnb.balanceOf(user1.address)).eq("994009000000000000");
  });
});
