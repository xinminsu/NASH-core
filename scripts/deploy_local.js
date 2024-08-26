const { expect, use } = require("chai");
const { solidity } = require("ethereum-waffle");
const {
  expandDecimals,
  getBlockTime,
  increaseTime,
  mineBlock,
  reportGasUsed,
  newWallet,
} = require("./shared/utilities");
const { toChainlinkPrice } = require("./shared/chainlink");
const { toUsd, toNormalizedPrice } = require("./shared/units");
const {
  initVault,
  getBnbConfig,
  getBtcConfig,
  getDaiConfig,
  getEthConfig,
} = require("./helpers");
const {
  getFrameSigner,
  deployContract,
  contractAt,
  sendTxn,
  writeTmpAddresses,
} = require("./shared/helpers");
const { errors } = require("../test/core/Vault/helpers");
const { network } = require("hardhat");

const partnerContracts = [
  "0x46a208f987F2002899bA37b2A32a394D34F30a88", // nj
  "0xc0271BDA95f78EF80728152eE9B6c5A915E91DA5", // rs
  "0xAa7E7f2532d0C8B642027844e654F32C40A9e36a", // rs
  "0x16740dAC5E7fe366e741D0622F8f570Af671738d", // ke
  "0x577BdeD1b0686D7e00ED6208e7Db8B098f23949b", // ke
  "0xab22E9da996D874CA0026f531e61472B55af33AE", // ll
  "0x882304271Ee4851133005f817AF762f97D9dbd07", // ll
];
const minter = [
  "0x46a208f987F2002899bA37b2A32a394D34F30a88", // nj
];

let signers = [
  "0x46a208f987F2002899bA37b2A32a394D34F30a88", // nj
  "0xc0271BDA95f78EF80728152eE9B6c5A915E91DA5", // rs
  "0xAa7E7f2532d0C8B642027844e654F32C40A9e36a", // rs
  "0x16740dAC5E7fe366e741D0622F8f570Af671738d", // ke
  "0x577BdeD1b0686D7e00ED6208e7Db8B098f23949b", // ke
  "0xab22E9da996D874CA0026f531e61472B55af33AE", // ll
  "0x882304271Ee4851133005f817AF762f97D9dbd07", // ll
];

const updaters = [
  "0x46a208f987F2002899bA37b2A32a394D34F30a88", // nj
  "0xc0271BDA95f78EF80728152eE9B6c5A915E91DA5", // rs
  "0xAa7E7f2532d0C8B642027844e654F32C40A9e36a", // rs
  "0x16740dAC5E7fe366e741D0622F8f570Af671738d", // ke
  "0x577BdeD1b0686D7e00ED6208e7Db8B098f23949b", // ke
  "0xab22E9da996D874CA0026f531e61472B55af33AE", // ll
  "0x882304271Ee4851133005f817AF762f97D9dbd07", // ll
];

const maxTokenSupply = expandDecimals("100000000", 18);

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function deployTokenManager() {
  const tokenManager = await deployContract(
    "TokenManager",
    [1],
    "TokenManager"
  );

  if (network.name == "localhost") {
    const signer = await getFrameSigner();
    signers = [signer.address];
  }

  await sendTxn(tokenManager.initialize(signers), "tokenManager.initialize");
  return tokenManager;
}

async function deployOrderBook(tokens, router, vault, usdg) {
  const { wbnb } = tokens;

  const orderBook = await deployContract("OrderBook", []);

  // Arbitrum mainnet addresses
  await sendTxn(
    orderBook.initialize(
      router.address, // router
      vault.address, // vault
      wbnb.address, // weth
      usdg.address, // usdg
      "2000000000000000", // 0.002 BNB
      expandDecimals(10, 30) // min purchase token amount usd
    ),
    "orderBook.initialize"
  );

  writeTmpAddresses({
    orderBook: orderBook.address,
  });
  return orderBook;
}

async function deployOrderExecutor(vault, orderBook) {
  return await deployContract("OrderExecutor", [
    vault.address,
    orderBook.address,
  ]);
}

async function deployPositionManager(vault, router, wbnb, orderBook) {
  const depositFee = 50;
  const positionManager = await deployContract("PositionManager", [
    vault.address,
    router.address,
    wbnb.address,
    depositFee,
    orderBook.address,
  ]);
  const signer = await getFrameSigner();
  await sendTxn(
    positionManager.setOrderKeeper(signer.address, true),
    "positionManager.setOrderKeeper(signer)"
  );
  await sendTxn(
    positionManager.setLiquidator(signer.address, true),
    "positionManager.setLiquidator(liquidator)"
  );
  await sendTxn(
    router.addPlugin(positionManager.address),
    "router.addPlugin(positionManager)"
  );

  for (let i = 0; i < partnerContracts.length; i++) {
    const partnerContract = partnerContracts[i];
    await sendTxn(
      positionManager.setPartner(partnerContract, true),
      "positionManager.setPartner(partnerContract)"
    );
  }
  return positionManager;
}

async function deployPositionRouter(vault, router, wbnb) {
  const depositFee = 30; // 0.3%
  const minExecutionFee = 1600000000000000; // 0.0016 BNB
  const positionRouter = await deployContract("PositionRouter", [
    vault.address,
    router.address,
    wbnb.address,
    depositFee,
    minExecutionFee,
  ]);
  const referralStorage = await deployContract("ReferralStorage", []);

  await sendTxn(
    positionRouter.setReferralStorage(referralStorage.address),
    "positionRouter.setReferralStorage"
  );
  await sendTxn(
    referralStorage.setHandler(positionRouter.address, true),
    "referralStorage.setHandler(positionRouter)"
  );

  await sendTxn(router.addPlugin(positionRouter.address), "router.addPlugin");

  await sendTxn(
    positionRouter.setDelayValues(1, 180, 30 * 60),
    "positionRouter.setDelayValues"
  );
  // await sendTxn(
  //   timelock.setContractHandler(positionRouter.address, true),
  //   "timelock.setContractHandler(positionRouter)"
  // );
  return [referralStorage, positionRouter];
}

async function setVaultTokenConfig(
  vault,
  vaultPriceFeed,
  tokens,
  ethPriceFeed,
  btcPriceFeed,
  bnbPriceFeed,
  busdPriceFeed,
  usdtPriceFeed
) {
  // const provider = ethers.provider;
  await vaultPriceFeed.setTokenConfig(
    tokens.usdt.address, // _token
    usdtPriceFeed.address, // _priceFeed
    8, // _priceDecimals
    true // _isStrictStable
  );
  await vaultPriceFeed.setTokenConfig(
    tokens.busd.address, // _token
    busdPriceFeed.address, // _priceFeed
    8, // _priceDecimals
    true // _isStrictStable
  );
  await vaultPriceFeed.setTokenConfig(
    tokens.eth.address, // _token
    ethPriceFeed.address, // _priceFeed
    8, // _priceDecimals
    false // _isStrictStable
  );
  await vaultPriceFeed.setTokenConfig(
    tokens.btc.address, // _token
    btcPriceFeed.address, // _priceFeed
    8, // _priceDecimals
    false // _isStrictStable
  );
  await vaultPriceFeed.setTokenConfig(
    tokens.bnb.address, // _token
    bnbPriceFeed.address, // _priceFeed
    8, // _priceDecimals
    false // _isStrictStable
  );
  await vault.setIsSwapEnabled(true);
  console.log("start to update price");
  await ethPriceFeed.setLatestAnswer(toChainlinkPrice(1500));
  await btcPriceFeed.setLatestAnswer(toChainlinkPrice(20000));
  await bnbPriceFeed.setLatestAnswer(toChainlinkPrice(300));
  await busdPriceFeed.setLatestAnswer(toChainlinkPrice(1));
  await usdtPriceFeed.setLatestAnswer(toChainlinkPrice(1));
  console.log("start to setTokenConfig");
  await sleep(5000);
  let tokenArr = [tokens.usdt, tokens.busd, tokens.eth, tokens.bnb, tokens.btc];
  for (i = 0; i < tokenArr.length; i++) {
    await sleep(5000);
    await sendTxn(
      vault.setTokenConfig(
        tokenArr[i].address,
        tokenArr[i].decimals,
        tokenArr[i].tokenWeight,
        tokenArr[i].minProfitBps,
        expandDecimals(tokenArr[i].maxUsdgAmount, 18),
        tokenArr[i].isStable,
        tokenArr[i].isShortable
      ),
      "vault.setTokenConfig"
    );
  }
  // await vault.setTokenConfig(...getEthConfig(eth, ethPriceFeed));
  // await vault.setTokenConfig(...getBtcConfig(btc, btcPriceFeed));
  // await vault.setTokenConfig(...getBnbConfig(bnb, bnbPriceFeed));
  // await vault.setTokenConfig(...getDaiConfig(busd, busdPriceFeed));
}

// TODO: fix price feed
async function deployPriceFeed(
  vault,
  tokens,
  timelock,
  tokenManager,
  positionRouter,
  vaultPriceFeed,
  positionManager
) {
  const { btc, eth, bnb, busd, usdt } = tokens;
  const tokenArr = [btc, eth, bnb, busd, usdt];
  const fastPriceTokens = [btc, eth, bnb, busd, usdt];
  if (fastPriceTokens.find((t) => !t.fastPricePrecision)) {
    throw new Error("Invalid price precision");
  }

  if (fastPriceTokens.find((t) => !t.maxCumulativeDeltaDiff)) {
    throw new Error("Invalid price maxCumulativeDeltaDiff");
  }

  const signer = await getFrameSigner();

  const fastPriceEvents = await deployContract("FastPriceEvents", []);

  const secondaryPriceFeed = await deployContract("FastPriceFeed", [
    5 * 60, // _priceDuration
    // 60 * 60, // _maxPriceUpdateDelay
    0, // _minBlockInterval
    750, // _maxDeviationBasisPoints
    fastPriceEvents.address, // _fastPriceEvents
    tokenManager.address, // _tokenManager
    positionRouter.address,
  ]);

  await sendTxn(
    secondaryPriceFeed.initialize(1, signers, updaters),
    "secondaryPriceFeed.initialize"
  );
  await sendTxn(
    secondaryPriceFeed.setMaxTimeDeviation(60 * 60),
    "secondaryPriceFeed.setMaxTimeDeviation"
  );

  await sendTxn(
    positionRouter.setPositionKeeper(secondaryPriceFeed.address, true),
    "positionRouter.setPositionKeeper(secondaryPriceFeed)"
  );

  await sendTxn(
    fastPriceEvents.setIsPriceFeed(secondaryPriceFeed.address, true),
    "fastPriceEvents.setIsPriceFeed"
  );

  await sendTxn(
    vaultPriceFeed.setMaxStrictPriceDeviation(expandDecimals(1, 28)),
    "vaultPriceFeed.setMaxStrictPriceDeviation"
  ); // 0.05 USD
  await sendTxn(
    vaultPriceFeed.setPriceSampleSpace(1),
    "vaultPriceFeed.setPriceSampleSpace"
  );
  await sendTxn(
    vaultPriceFeed.setSecondaryPriceFeed(secondaryPriceFeed.address),
    "vaultPriceFeed.setSecondaryPriceFeed"
  );
  await sendTxn(
    vaultPriceFeed.setIsAmmEnabled(false),
    "vaultPriceFeed.setIsAmmEnabled"
  );
  // await sendTxn(
  //   priceFeedTimelock.setChainlinkFlags(chainlinkFlags.address),
  //   "vaultPriceFeed.setChainlinkFlags"
  // );
  for (const token of tokenArr) {
    await sendTxn(
      vaultPriceFeed.setTokenConfig(
        token.address, // _token
        token.priceFeed, // _priceFeed
        token.priceDecimals, // _priceDecimals
        token.isStrictStable // _isStrictStable
      ),
      `vaultPriceFeed.setTokenConfig(${token.name}) ${token.address} ${token.priceFeed}`
    );
  }

  await sendTxn(
    secondaryPriceFeed.setTokens(
      fastPriceTokens.map((t) => t.address),
      fastPriceTokens.map((t) => t.fastPricePrecision)
    ),
    "secondaryPriceFeed.setTokens"
  );
  await sendTxn(
    secondaryPriceFeed.setMaxTimeDeviation(60 * 60),
    "secondaryPriceFeed.setMaxTimeDeviation"
  );
  await sendTxn(
    vault.setPriceFeed(vaultPriceFeed.address),
    "vault.setPriceFeed"
  );
  await sendTxn(
    vault.setIsLeverageEnabled(true),
    "vault.setIsLeverageEnabled(true)"
  );
  await sendTxn(secondaryPriceFeed.setUpdater(signer.address, true));

  await sendTxn(
    vault.setLiquidator(positionManager.address, true),
    "vault.setLiquidator(positionManager.address, true)"
  );
  return [fastPriceEvents, secondaryPriceFeed];
}

async function deployVault(tokens) {
  const { bnb, btc, eth, busd, usdt, wbnb } = tokens;
  const tokenArr = [btc, eth, bnb, busd, usdt];
  const vault = await deployContract("Vault", []);
  await vault.deployed();
  const usdg = await deployContract("USDG", [vault.address]);
  await usdg.deployed();
  const router = await deployContract("Router", [
    vault.address,
    usdg.address,
    wbnb.address,
  ]);
  await router.deployed();
  // const router = await contractAt("Router", "0xaBBc5F99639c9B6bCb58544ddf04EFA6802F4064")
  // const vaultPriceFeed = await contractAt("VaultPriceFeed", "0x30333ce00ac3025276927672aaefd80f22e89e54")
  // const secondaryPriceFeed = await deployContract("FastPriceFeed", [5 * 60])

  const vaultPriceFeed = await deployContract("VaultPriceFeed", []);
  await vaultPriceFeed.deployed();

  await sendTxn(
    vaultPriceFeed.setMaxStrictPriceDeviation(expandDecimals(1, 28)),
    "vaultPriceFeed.setMaxStrictPriceDeviation"
  ); // 0.05 USD
  await sendTxn(
    vaultPriceFeed.setPriceSampleSpace(1),
    "vaultPriceFeed.setPriceSampleSpace"
  );
  await sendTxn(
    vaultPriceFeed.setIsAmmEnabled(false),
    "vaultPriceFeed.setIsAmmEnabled"
  );
  await sendTxn(
    vaultPriceFeed.setIsSecondaryPriceEnabled(true),
    "vaultPriceFeed.setIsSecondaryPriceEnabled"
  );
  await sendTxn(
    vaultPriceFeed.setUseV2Pricing(true),
    "vaultPriceFeed.setUseV2Pricing(true)"
  );
  for (let i = 0; i < tokenArr.length; i++) {
    await vaultPriceFeed.setSpreadBasisPoints(tokenArr[i].address, 0);
  }
  const nlp = await deployContract("NLP", []);
  await sendTxn(
    nlp.setInPrivateTransferMode(true),
    "nlp.setInPrivateTransferMode"
  );
  // const nlp = await contractAt("NLP", "0x4277f8F2c384827B5273592FF7CeBd9f2C1ac258")
  const shortsTracker = await deployShortsTracker(vault);

  const nlpManager = await deployContract("NlpManager", [
    vault.address,
    usdg.address,
    nlp.address,
    shortsTracker.address,
    15 * 60,
  ]);
  await sendTxn(
    nlpManager.setInPrivateMode(true),
    "nlpManager.setInPrivateMode"
  );

  await sendTxn(
    nlpManager.setShortsTrackerAveragePriceWeight(10000),
    "nlpManager.setShortsTrackerAveragePriceWeight(10000)"
  );

  await sendTxn(nlp.setMinter(nlpManager.address, true), "nlp.setMinter");
  await sendTxn(usdg.addVault(nlpManager.address), "usdg.addVault(nlpManager)");

  await sendTxn(
    vault.initialize(
      router.address, // router
      usdg.address, // usdg
      vaultPriceFeed.address, // priceFeed
      toUsd(2), // liquidationFeeUsd
      100000, // fundingRateFactor
      100000 // stableFundingRateFactor
    ),
    "vault.initialize"
  );

  await sendTxn(vault.setFundingRate(36, 1000, 1000), "vault.setFundingRate");

  await sendTxn(vault.setInManagerMode(true), "vault.setInManagerMode");
  await sendTxn(vault.setManager(nlpManager.address, true), "vault.setManager");

  await sendTxn(
    vault.setFees(
      10, // _taxBasisPoints
      5, // _stableTaxBasisPoints
      20, // _mintBurnFeeBasisPoints
      20, // _swapFeeBasisPoints
      1, // _stableSwapFeeBasisPoints
      10, // _marginFeeBasisPoints
      toUsd(2), // _liquidationFeeUsd
      24 * 60 * 60, // _minProfitTime
      true // _hasDynamicFees
    ),
    "vault.setFees"
  );

  const vaultErrorController = await deployContract("VaultErrorController", []);
  await sendTxn(
    vault.setErrorController(vaultErrorController.address),
    "vault.setErrorController"
  );
  await sendTxn(
    vaultErrorController.setErrors(vault.address, errors),
    "vaultErrorController.setErrors"
  );

  const vaultUtils = await deployContract("VaultUtils", [vault.address]);
  await sendTxn(vault.setVaultUtils(vaultUtils.address), "vault.setVaultUtils");

  return [
    vault,
    usdg,
    router,
    vaultPriceFeed,
    nlp,
    nlpManager,
    vaultUtils,
    shortsTracker,
  ];
}

async function deployShortsTracker(vault) {
  const shortsTracker = await deployContract(
    "ShortsTracker",
    [vault.address],
    "ShortsTracker"
  );

  return shortsTracker;
}

async function deployNsc() {
  const nsc = await deployContract("NSC", []);
  for (let i = 0; i < minter.length; i++) {
    await sendTxn(
      nsc.setMinter(minter[i], true),
      `nsc.setMinter: ${minter[i]}`
    );
  }
  const esNsc = await deployContract("EsNSC", []);
  const bnNsc = await deployContract("MintableBaseToken", [
    "Bonus NSC",
    "bnNSC",
    0,
  ]);
  return [nsc, esNsc, bnNsc];
}

async function deployBalanceUpdater() {
  const balanceUpdater = await deployContract("BalanceUpdater", []);
  return balanceUpdater;
}

async function deployBatchSender() {
  const batchSender = await deployContract("BatchSender", []);
  return batchSender;
}

async function deployEsNscBatchSender(esNsc) {
  const esNscBatchSender = await deployContract("EsNscBatchSender", [
    esNsc.address,
  ]);

  return esNscBatchSender;
}

async function deployNscTimelock(tokenManager, rewardManager) {
  const buffer = 24 * 60 * 60;
  // const buffer = 5;
  const longBuffer = 7 * 24 * 60 * 60;
  // const longBuffer = 10;
  const mintReceiver = tokenManager;
  // const mintReceiver = { address: AddressZero };
  const signer = await getFrameSigner();
  const nscTimelock = await deployContract(
    "NscTimelock",
    [
      signer.address,
      buffer,
      longBuffer,
      rewardManager.address,
      tokenManager.address,
      mintReceiver.address,
      maxTokenSupply,
    ],
    "NscTimelock"
    // { gasLimit: 100000000 }
  );
  return nscTimelock;
}

async function deployOrderBookReader() {
  const orderBookReader = await deployContract("OrderBookReader", []);

  writeTmpAddresses({
    orderBookReader: orderBookReader.address,
  });
  return orderBookReader;
}

async function deployReader() {
  const reader = await deployContract("Reader", [], "Reader");

  writeTmpAddresses({
    reader: reader.address,
  });
  return reader;
}

async function deployRewardReader() {
  const rewardReader = await deployContract("RewardReader", [], "RewardReader");
  return rewardReader;
}

async function deployTimeLock(
  tokenManager,
  nlpManager,
  rewardRouter,
  positionRouter,
  positionManager,
  rewardManager
) {
  const signer = await getFrameSigner();

  // const buffer = 5;
  const buffer = 24 * 60 * 60;

  const mintReceiver = tokenManager;

  const timelock = await deployContract(
    "Timelock",
    [
      signer.address,
      buffer,
      tokenManager.address,
      mintReceiver.address,
      nlpManager.address,
      rewardRouter.address,
      rewardManager.address,
      maxTokenSupply,
      10, // marginFeeBasisPoints 0.1%
      100, // maxMarginFeeBasisPoints 1%
    ],
    "Timelock"
  );
  await timelock.deployed();
  const deployedTimelock = await contractAt(
    "Timelock",
    timelock.address,
    signer
  );

  await sendTxn(
    deployedTimelock.setContractHandler(positionRouter.address, true),
    "deployedTimelock.setContractHandler(positionRouter)"
  );
  await sendTxn(
    deployedTimelock.setShouldToggleIsLeverageEnabled(true),
    "deployedTimelock.setShouldToggleIsLeverageEnabled(true)"
  );
  await sendTxn(
    deployedTimelock.setContractHandler(positionManager.address, true),
    "deployedTimelock.setContractHandler(positionManager)"
  );

  // // update gov of vault
  // const vaultGov = await contractAt("Timelock", await vault.gov(), signer);

  // await sendTxn(
  //   vaultGov.signalSetGov(vault.address, deployedTimelock.address),
  //   "vaultGov.signalSetGov"
  // );
  // await sendTxn(
  //   deployedTimelock.signalSetGov(vault.address, vaultGov.address),
  //   "deployedTimelock.signalSetGov(vault)"
  // );
  // await sendTxn(
  //   timelock.setVaultUtils(vault.address, vaultUtils.address),
  //   "timelock.setVaultUtils"
  // );

  for (let i = 0; i < signers.length; i++) {
    const signer = signers[i];
    await sendTxn(
      deployedTimelock.setContractHandler(signer, true),
      `deployedTimelock.setContractHandler(${signer})`
    );
  }

  // const keepers = [
  //   "0x46a208f987F2002899bA37b2A32a394D34F30a88", // nj
  //   "0xc0271BDA95f78EF80728152eE9B6c5A915E91DA5", // rs
  //   "0xc0271BDA95f78EF80728152eE9B6c5A915E91DA5", // ke
  // ];

  // for (let i = 0; i < keepers.length; i++) {
  //   const keeper = keepers[i];
  //   await sendTxn(
  //     deployedTimelock.setKeeper(keeper, true),
  //     `deployedTimelock.setKeeper(${keeper})`
  //   );
  // }

  await sendTxn(
    deployedTimelock.setContractHandler(positionManager.address, true),
    "deployedTimelock.setContractHandler(positionManager)"
  );

  return timelock;
}

async function deployVaultReader() {
  const vaultReader = await deployContract("VaultReader", [], "VaultReader");

  writeTmpAddresses({
    reader: vaultReader.address,
  });

  return vaultReader;
}

async function deployStakedNlp(
  nlp,
  nlpManager,
  stakedNlpTracker,
  feeNlpTracker
) {
  const stakedNlp = await deployContract("StakedNlp", [
    nlp.address,
    nlpManager.address,
    stakedNlpTracker.address,
    feeNlpTracker.address,
  ]);

  const nlpBalance = await deployContract("NlpBalance", [
    nlpManager.address,
    stakedNlpTracker.address,
  ]);

  return [stakedNlp, nlpBalance];
}

async function deployRewardRouter(
  tokens,
  nlpManager,
  nlp,
  nsc,
  esNsc,
  bnNsc,
  timelock
) {
  const { wbnb } = tokens;

  const vestingDuration = 365 * 24 * 60 * 60;
  await sendTxn(
    esNsc.setInPrivateTransferMode(true),
    "esNsc.setInPrivateTransferMode"
  );
  await sendTxn(
    nlp.setInPrivateTransferMode(true),
    "nlp.setInPrivateTransferMode"
  );

  const stakedNscTracker = await deployContract("RewardTracker", [
    "Staked NSC",
    "sNSC",
  ]);
  const stakedNscDistributor = await deployContract("RewardDistributor", [
    esNsc.address,
    stakedNscTracker.address,
  ]);
  await sendTxn(
    stakedNscTracker.initialize(
      [nsc.address, esNsc.address],
      stakedNscDistributor.address
    ),
    "stakedNscTracker.initialize"
  );
  await sendTxn(
    stakedNscDistributor.updateLastDistributionTime(),
    "stakedNscDistributor.updateLastDistributionTime"
  );

  const bonusNscTracker = await deployContract("RewardTracker", [
    "Staked + Bonus NSC",
    "sbNSC",
  ]);
  const bonusNscDistributor = await deployContract("BonusDistributor", [
    bnNsc.address,
    bonusNscTracker.address,
  ]);
  await sendTxn(
    bonusNscTracker.initialize(
      [stakedNscTracker.address],
      bonusNscDistributor.address
    ),
    "bonusNscTracker.initialize"
  );
  await sendTxn(
    bonusNscDistributor.updateLastDistributionTime(),
    "bonusNscDistributor.updateLastDistributionTime"
  );

  const feeNscTracker = await deployContract("RewardTracker", [
    "Staked + Bonus + Fee NSC",
    "sbfNSC",
  ]);
  const feeNscDistributor = await deployContract("RewardDistributor", [
    wbnb.address,
    feeNscTracker.address,
  ]);
  await sendTxn(
    feeNscTracker.initialize(
      [bonusNscTracker.address, bnNsc.address],
      feeNscDistributor.address
    ),
    "feeNscTracker.initialize"
  );
  await sendTxn(
    feeNscDistributor.updateLastDistributionTime(),
    "feeNscDistributor.updateLastDistributionTime"
  );

  const feeNlpTracker = await deployContract("RewardTracker", [
    "Fee NLP",
    "fNLP",
  ]);
  const feeNlpDistributor = await deployContract("RewardDistributor", [
    wbnb.address,
    feeNlpTracker.address,
  ]);
  await sendTxn(
    feeNlpTracker.initialize([nlp.address], feeNlpDistributor.address),
    "feeNlpTracker.initialize"
  );
  await sendTxn(
    feeNlpDistributor.updateLastDistributionTime(),
    "feeNlpDistributor.updateLastDistributionTime"
  );

  const stakedNlpTracker = await deployContract("RewardTracker", [
    "Fee + Staked NLP",
    "fsNLP",
  ]);
  const stakedNlpDistributor = await deployContract("RewardDistributor", [
    esNsc.address,
    stakedNlpTracker.address,
  ]);
  await sendTxn(
    stakedNlpTracker.initialize(
      [feeNlpTracker.address],
      stakedNlpDistributor.address
    ),
    "stakedNlpTracker.initialize"
  );
  await sendTxn(
    stakedNlpDistributor.updateLastDistributionTime(),
    "stakedNlpDistributor.updateLastDistributionTime"
  );

  await sendTxn(
    stakedNscTracker.setInPrivateTransferMode(true),
    "stakedNscTracker.setInPrivateTransferMode"
  );
  await sendTxn(
    stakedNscTracker.setInPrivateStakingMode(true),
    "stakedNscTracker.setInPrivateStakingMode"
  );
  await sendTxn(
    bonusNscTracker.setInPrivateTransferMode(true),
    "bonusNscTracker.setInPrivateTransferMode"
  );
  await sendTxn(
    bonusNscTracker.setInPrivateStakingMode(true),
    "bonusNscTracker.setInPrivateStakingMode"
  );
  await sendTxn(
    bonusNscTracker.setInPrivateClaimingMode(true),
    "bonusNscTracker.setInPrivateClaimingMode"
  );
  await sendTxn(
    feeNscTracker.setInPrivateTransferMode(true),
    "feeNscTracker.setInPrivateTransferMode"
  );
  await sendTxn(
    feeNscTracker.setInPrivateStakingMode(true),
    "feeNscTracker.setInPrivateStakingMode"
  );

  await sendTxn(
    feeNlpTracker.setInPrivateTransferMode(true),
    "feeNlpTracker.setInPrivateTransferMode"
  );
  await sendTxn(
    feeNlpTracker.setInPrivateStakingMode(true),
    "feeNlpTracker.setInPrivateStakingMode"
  );
  await sendTxn(
    stakedNlpTracker.setInPrivateTransferMode(true),
    "stakedNlpTracker.setInPrivateTransferMode"
  );
  await sendTxn(
    stakedNlpTracker.setInPrivateStakingMode(true),
    "stakedNlpTracker.setInPrivateStakingMode"
  );

  const nscVester = await deployContract("Vester", [
    "Vested NSC", // _name
    "vNSC", // _symbol
    vestingDuration, // _vestingDuration
    esNsc.address, // _esToken
    feeNscTracker.address, // _pairToken
    nsc.address, // _claimableToken
    stakedNscTracker.address, // _rewardTracker
  ]);

  const nlpVester = await deployContract("Vester", [
    "Vested NLP", // _name
    "vNLP", // _symbol
    vestingDuration, // _vestingDuration
    esNsc.address, // _esToken
    stakedNlpTracker.address, // _pairToken
    nsc.address, // _claimableToken
    stakedNlpTracker.address, // _rewardTracker
  ]);

  const rewardRouter = await deployContract("RewardRouter", []);
  await sendTxn(
    rewardRouter.initialize(
      wbnb.address,
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
    ),
    "rewardRouter.initialize"
  );

  await sendTxn(
    nlpManager.setHandler(rewardRouter.address, true),
    "nlpManager.setHandler(rewardRouter)"
  );

  // allow rewardRouter to stake in stakedNscTracker
  await sendTxn(
    stakedNscTracker.setHandler(rewardRouter.address, true),
    "stakedNscTracker.setHandler(rewardRouter)"
  );
  // allow bonusNscTracker to stake stakedNscTracker
  await sendTxn(
    stakedNscTracker.setHandler(bonusNscTracker.address, true),
    "stakedNscTracker.setHandler(bonusNscTracker)"
  );
  // allow rewardRouter to stake in bonusNscTracker
  await sendTxn(
    bonusNscTracker.setHandler(rewardRouter.address, true),
    "bonusNscTracker.setHandler(rewardRouter)"
  );
  // allow bonusNscTracker to stake feeNscTracker
  await sendTxn(
    bonusNscTracker.setHandler(feeNscTracker.address, true),
    "bonusNscTracker.setHandler(feeNscTracker)"
  );
  // bonus multiplier basis: 10000, so 5000 is 50% per year.
  await sendTxn(
    bonusNscDistributor.setBonusMultiplier(5000),
    "bonusNscDistributor.setBonusMultiplier"
  );
  // allow rewardRouter to stake in feeNscTracker
  await sendTxn(
    feeNscTracker.setHandler(rewardRouter.address, true),
    "feeNscTracker.setHandler(rewardRouter)"
  );
  // allow stakedNscTracker to stake esNsc
  await sendTxn(
    esNsc.setHandler(stakedNscTracker.address, true),
    "esNsc.setHandler(stakedNscTracker)"
  );
  // allow feeNscTracker to stake bnNsc
  await sendTxn(
    bnNsc.setHandler(feeNscTracker.address, true),
    "bnNsc.setHandler(feeNscTracker"
  );
  // allow rewardRouter to burn bnNsc
  await sendTxn(
    bnNsc.setMinter(rewardRouter.address, true),
    "bnNsc.setMinter(rewardRouter"
  );
  for (let i = 0; i < minter.length; i++) {
    await sendTxn(
      bnNsc.setMinter(minter[i], true),
      `bnNsc.setMinter: ${minter[i]}`
    );
  }

  // allow stakedNlpTracker to stake feeNlpTracker
  await sendTxn(
    feeNlpTracker.setHandler(stakedNlpTracker.address, true),
    "feeNlpTracker.setHandler(stakedNlpTracker)"
  );
  // allow feeNlpTracker to stake nlp
  await sendTxn(
    nlp.setHandler(feeNlpTracker.address, true),
    "nlp.setHandler(feeNlpTracker)"
  );

  // allow rewardRouter to stake in feeNlpTracker
  await sendTxn(
    feeNlpTracker.setHandler(rewardRouter.address, true),
    "feeNlpTracker.setHandler(rewardRouter)"
  );
  // allow rewardRouter to stake in stakedNlpTracker
  await sendTxn(
    stakedNlpTracker.setHandler(rewardRouter.address, true),
    "stakedNlpTracker.setHandler(rewardRouter)"
  );

  await sendTxn(
    esNsc.setHandler(rewardRouter.address, true),
    "esNsc.setHandler(rewardRouter)"
  );
  await sendTxn(
    esNsc.setHandler(stakedNscDistributor.address, true),
    "esNsc.setHandler(stakedNscDistributor)"
  );
  await sendTxn(
    esNsc.setHandler(stakedNlpDistributor.address, true),
    "esNsc.setHandler(stakedNlpDistributor)"
  );
  await sendTxn(
    esNsc.setHandler(stakedNlpTracker.address, true),
    "esNsc.setHandler(stakedNlpTracker)"
  );
  await sendTxn(
    esNsc.setHandler(nscVester.address, true),
    "esNsc.setHandler(nscVester)"
  );
  await sendTxn(
    esNsc.setHandler(nlpVester.address, true),
    "esNsc.setHandler(nlpVester)"
  );

  await sendTxn(
    esNsc.setMinter(nscVester.address, true),
    "esNsc.setMinter(nscVester)"
  );
  await sendTxn(
    esNsc.setMinter(nlpVester.address, true),
    "esNsc.setMinter(nlpVester)"
  );
  for (let i = 0; i < minter.length; i++) {
    await sendTxn(
      esNsc.setMinter(minter[i], true),
      `esNsc.setMinter: ${minter[i]}`
    );
  }

  await sendTxn(
    nscVester.setHandler(rewardRouter.address, true),
    "nscVester.setHandler(rewardRouter)"
  );
  await sendTxn(
    nlpVester.setHandler(rewardRouter.address, true),
    "nlpVester.setHandler(rewardRouter)"
  );

  await sendTxn(
    feeNscTracker.setHandler(nscVester.address, true),
    "feeNscTracker.setHandler(nscVester)"
  );
  await sendTxn(
    stakedNlpTracker.setHandler(nlpVester.address, true),
    "stakedNlpTracker.setHandler(nlpVester)"
  );

  return [
    stakedNscTracker,
    stakedNscDistributor,
    bonusNscTracker,
    bonusNscDistributor,
    feeNscTracker,
    feeNscDistributor,
    feeNlpTracker,
    feeNlpDistributor,
    stakedNlpTracker,
    stakedNlpDistributor,
    nscVester,
    nlpVester,
    rewardRouter,
  ];
}
async function deployStakeManager() {
  const stakeManager = await deployContract("StakeManager", []);
  return stakeManager;
}

async function main() {
  const provider = ethers.provider;
  const signer = await getFrameSigner();

  let bnb, btc, eth, busd, usdt;
  if (network.name == "localhost") {
    bnb = await deployContract("Token", []);
    await bnb.deployed();

    btc = await deployContract("Token", []);
    await btc.deployed();

    eth = await deployContract("Token", []);
    await eth.deployed();

    busd = await deployContract("Token", []);
    await busd.deployed();

    usdt = await deployContract("Token", []);
    await usdt.deployed();
  } else {
    bnb = await contractAt(
      "Token",
      "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd"
    );
    btc = await contractAt(
      "Token",
      "0x88448E5608F35E1f67Bdb39cbA3445Fc923b09e5"
    );
    eth = await contractAt(
      "Token",
      "0x143DFdedF1062155B9E6ea80D1645D650C509780"
    );
    busd = await contractAt(
      "Token",
      "0x6993eC95A649310C88a946A94c20B2aBd37251eC"
    );
    usdt = await contractAt(
      "Token",
      "0xd4f65b75a2294e4e0cc4e6833092b5a29315c973"
    );
  }

  const bnbPriceFeed = await deployContract("PriceFeed", []);
  await bnbPriceFeed.deployed();
  console.log("bnbPriceFeed address:", bnbPriceFeed.address);

  const btcPriceFeed = await deployContract("PriceFeed", []);
  await btcPriceFeed.deployed();
  console.log("btcPriceFeed address:", btcPriceFeed.address);

  const ethPriceFeed = await deployContract("PriceFeed", []);
  await ethPriceFeed.deployed();
  console.log("ethPriceFeed address:", ethPriceFeed.address);

  const busdPriceFeed = await deployContract("PriceFeed", []);
  await busdPriceFeed.deployed();
  console.log("busdPriceFeed address:", busdPriceFeed.address);

  const usdtPriceFeed = await deployContract("PriceFeed", []);
  await usdtPriceFeed.deployed();
  console.log("usdtPriceFeed address:", usdtPriceFeed.address);

  const tokens = {
    btc: {
      name: "btc",
      address: btc.address,
      priceFeed: btcPriceFeed.address,
      decimals: 8,
      priceDecimals: 8,
      fastPricePrecision: 1000,
      maxCumulativeDeltaDiff: 10 * 1000 * 1000,
      isStrictStable: false,
      tokenWeight: 19000,
      minProfitBps: 0,
      maxUsdgAmount: 200 * 1000 * 1000,
      bufferAmount: 1500,
      isStable: false,
      isShortable: true,
      maxGlobalShortSize: 20 * 1000 * 1000,
    },
    eth: {
      name: "eth",
      address: eth.address,
      priceFeed: ethPriceFeed.address,
      decimals: 18,
      priceDecimals: 8,
      fastPricePrecision: 1000,
      maxCumulativeDeltaDiff: 10 * 1000 * 1000,
      isStrictStable: false,
      tokenWeight: 30000,
      minProfitBps: 0,
      maxUsdgAmount: 400 * 1000 * 1000,
      bufferAmount: 42000,
      isStable: false,
      isShortable: true,
      maxGlobalShortSize: 35 * 1000 * 1000,
    },
    bnb: {
      name: "bnb",
      address: bnb.address,
      priceFeed: bnbPriceFeed.address,
      decimals: 18,
      priceDecimals: 8,
      fastPricePrecision: 1000,
      maxCumulativeDeltaDiff: 10 * 1000 * 1000,
      isStrictStable: false,
      tokenWeight: 1000,
      minProfitBps: 0,
      maxUsdgAmount: 200 * 1000 * 1000,
      bufferAmount: 42000,
      isStable: false,
      isShortable: true,
      maxGlobalShortSize: 35 * 1000 * 1000,
    },
    busd: {
      name: "busd",
      address: busd.address,
      priceFeed: busdPriceFeed.address,
      decimals: 18,
      priceDecimals: 8,
      fastPricePrecision: 1000,
      maxCumulativeDeltaDiff: 10 * 1000 * 1000,
      isStrictStable: true,
      tokenWeight: 25000,
      minProfitBps: 0,
      maxUsdgAmount: 800 * 1000 * 1000,
      bufferAmount: 95 * 1000 * 1000,
      isStable: true,
      isShortable: false,
    },
    usdt: {
      name: "usdt",
      address: usdt.address,
      priceFeed: usdtPriceFeed.address,
      decimals: 18,
      priceDecimals: 8,
      fastPricePrecision: 1000,
      maxCumulativeDeltaDiff: 10 * 1000 * 1000,
      isStrictStable: true,
      tokenWeight: 25000,
      minProfitBps: 0,
      maxUsdgAmount: 800 * 1000 * 1000,
      bufferAmount: 95 * 1000 * 1000,
      isStable: true,
      isShortable: false,
    },
    wbnb: {
      name: "bnb",
      address: bnb.address,
      priceFeed: bnbPriceFeed.address,
      decimals: 18,
      priceDecimals: 8,
      isStrictStable: false,
      fastPricePrecision: 1000,
      maxCumulativeDeltaDiff: 10 * 1000 * 1000,
    },
  };
  const [nsc, esNsc, bnNsc] = await deployNsc();

  const [
    vault,
    usdg,
    router,
    vaultPriceFeed,
    nlp,
    nlpManager,
    vaultUtils,
    shortsTracker,
  ] = await deployVault(tokens);

  const tokenManager = await deployTokenManager();
  console.log("TokenManager address:", tokenManager.address);

  // const nlpManager = await deployNlpManager(vault, usdg, nlp);
  // console.log("NlpManager address:", nlpManager.address);

  const orderBook = await deployOrderBook(tokens, router, vault, usdg);
  console.log("OrderBook address:", orderBook.address);

  // const orderExecutor = await deployOrderExecutor(vault, orderBook);
  // console.log("OrderExecutor address:", orderExecutor.address);

  const [referralStorage, positionRouter] = await deployPositionRouter(
    vault,
    router,
    tokens.wbnb
  );
  console.log("PositionRouter address:", positionRouter.address);

  const positionManager = await deployPositionManager(
    vault,
    router,
    tokens.wbnb,
    orderBook
  );
  console.log("PositionManager address:", positionManager.address);

  const [
    stakedNscTracker,
    stakedNscDistributor,
    bonusNscTracker,
    bonusNscDistributor,
    feeNscTracker,
    feeNscDistributor,
    feeNlpTracker,
    feeNlpDistributor,
    stakedNlpTracker,
    stakedNlpDistributor,
    nscVester,
    nlpVester,
    rewardRouter,
  ] = await deployRewardRouter(tokens, nlpManager, nlp, nsc, esNsc, bnNsc);
  const rewardManager = await deployContract(
    "RewardManager",
    [],
    "RewardManager"
  );

  const timelock = await deployTimeLock(
    tokenManager,
    nlpManager,
    rewardRouter,
    positionRouter,
    positionManager,
    rewardManager
  );

  // const vaultUnils = await deployVaultUtiles(vault, timelock);
  // console.log("VaultUnils address:", vaultUnils.address);

  await sendTxn(esNsc.setGov(timelock.address), "set gov");
  await sendTxn(bnNsc.setGov(timelock.address), "set gov");
  await sendTxn(nscVester.setGov(timelock.address), "set gov");
  await sendTxn(nlpVester.setGov(timelock.address), "set gov");
  await sendTxn(shortsTracker.setGov(timelock.address), "set gov");
  await sendTxn(nlpManager.setGov(timelock.address), "set gov");
  await sendTxn(stakedNscTracker.setGov(timelock.address), "set gov");
  await sendTxn(bonusNscTracker.setGov(timelock.address), "set gov");
  await sendTxn(feeNscTracker.setGov(timelock.address), "set gov");
  await sendTxn(feeNlpTracker.setGov(timelock.address), "set gov");
  await sendTxn(stakedNlpTracker.setGov(timelock.address), "set gov");
  await sendTxn(stakedNscDistributor.setGov(timelock.address), "set gov");
  await sendTxn(stakedNlpDistributor.setGov(timelock.address), "set gov");

  await sendTxn(
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
    ),
    "rewardManager.initialize"
  );

  await sendTxn(
    rewardManager.updateEsNscHandlers(),
    "rewardManager.updateEsNscHandlers"
  );
  await sendTxn(
    rewardManager.enableRewardRouter(),
    "rewardManager.enableRewardRouter"
  );

  // const priceFeedTimelock = await deployPriceFeedTimelock(
  //   router,
  //   vaultPriceFeed,
  //   tokenManager
  // );

  const [fastPriceEvents, secondaryPriceFeed] = await deployPriceFeed(
    vault,
    tokens,
    timelock,
    tokenManager,
    positionRouter,
    vaultPriceFeed,
    positionManager
  );

  await setVaultTokenConfig(
    vault,
    vaultPriceFeed,
    tokens,
    ethPriceFeed,
    btcPriceFeed,
    bnbPriceFeed,
    busdPriceFeed,
    usdtPriceFeed
  );

  await sendTxn(
    vault.setGov(timelock.address),
    "vault.setGov(timelock.address)"
  );
  await sendTxn(
    vaultPriceFeed.setGov(timelock.address),
    "vaultPriceFeed.setGov"
  );

  const balanceUpdater = await deployBalanceUpdater();
  const batchSender = await deployBatchSender();
  const esNscBatchSender = await deployEsNscBatchSender(esNsc);
  const nscTimelock = await deployNscTimelock(tokenManager, rewardManager);
  const orderBookReader = await deployOrderBookReader();
  const reader = await deployReader();
  const rewardReader = await deployRewardReader();
  const vaultReader = await deployVaultReader();
  const [stakedNlp, nlpBalance] = await deployStakedNlp(
    nlp,
    nlpManager,
    stakedNlpTracker,
    feeNlpTracker
  );
  const stakeManager = await deployStakeManager();
  // const bridge = await deployBridge(nsc, wNsc);
  // const snapshotToken = await deploySnapshotToken();

  // const addresses = await deployFaucetToken();
  await router.addPlugin(orderBook.address);
  await router.approvePlugin(orderBook.address);
  await router.approvePlugin(positionRouter.address);
  await router.approvePlugin(positionManager.address);
  await positionRouter.setPositionKeeper(signer.address, true);

  const minExecutionFee = "0.0016";
  await positionRouter.setMinExecutionFee(
    ethers.utils.parseEther(minExecutionFee)
  );
  await orderBook.setMinExecutionFee(ethers.utils.parseEther(minExecutionFee));
  await orderBook.setMinPurchaseTokenAmountUsd(100);

  await sendTxn(
    referralStorage.setTier(0, 1000, 5000),
    "referralStorage.setTier 0"
  );
  await sendTxn(
    referralStorage.setTier(1, 2000, 5000),
    "referralStorage.setTier 1"
  );
  await sendTxn(
    referralStorage.setTier(2, 2500, 4000),
    "referralStorage.setTier 2"
  );

  console.log('NATIVE_TOKEN: "%s",', tokens.wbnb.address);
  console.log('btc: "%s",', btc.address);
  console.log('btcPriceFeed: "%s",', btcPriceFeed.address);
  console.log('eth: "%s",', eth.address);
  console.log('ethPriceFeed: "%s",', ethPriceFeed.address);
  console.log('bnb: "%s",', bnb.address);
  console.log('bnbPriceFeed: "%s",', bnbPriceFeed.address);
  console.log('busd: "%s",', busd.address);
  console.log('busdPriceFeed: "%s",', busdPriceFeed.address);
  console.log('usdt: "%s",', usdt.address);
  console.log('usdtPriceFeed: "%s",', usdtPriceFeed.address);
  console.log('VaultReader: "%s",', vaultReader.address);
  console.log('Reader: "%s",', reader.address);
  console.log('OrderBook: "%s",', orderBook.address);
  console.log('OrderBookReader: "%s",', orderBookReader.address);
  console.log('Router: "%s",', router.address);
  console.log('USDG: "%s",', usdg.address);
  console.log('Vault: "%s",', vault.address);
  console.log('PositionRouter: "%s",', positionRouter.address);
  console.log('PositionManager: "%s",', positionManager.address);
  console.log('NlpManager: "%s",', nlpManager.address);
  console.log('NSC: "%s",', nsc.address);
  console.log('ES_NSC: "%s",', esNsc.address);
  console.log('BN_NSC: "%s",', bnNsc.address);
  console.log('NLP: "%s",', nlp.address);
  console.log('RewardRouter: "%s",', rewardRouter.address);
  console.log('RewardReader: "%s",', rewardReader.address);
  console.log('StakedNscTracker: "%s",', stakedNscTracker.address);
  console.log('BonusNscTracker: "%s",', bonusNscTracker.address);
  console.log('FeeNscTracker: "%s",', feeNscTracker.address);
  console.log('StakedNlpTracker: "%s",', stakedNlpTracker.address);
  console.log('FeeNlpTracker: "%s",', feeNlpTracker.address);
  console.log('StakedNscDistributor: "%s",', stakedNscDistributor.address);
  console.log('StakedNlpDistributor: "%s",', stakedNlpDistributor.address);
  console.log('FeeNlpDistributor: "%s",', feeNlpDistributor.address);
  console.log('FeeNscDistributor: "%s",', feeNscDistributor.address);
  console.log('NscVester: "%s",', nscVester.address);
  console.log('NlpVester: "%s",', nlpVester.address);
  console.log('ReferralStorage: "%s",', referralStorage.address);
  console.log('VaultPriceFeed: "%s",', vaultPriceFeed.address);
  console.log('NscTimelock: "%s",', nscTimelock.address);
  console.log('Timelock: "%s",', timelock.address);
  console.log('FeeNscRewardDistributor: "%s",', feeNscDistributor.address);
  console.log('EsnscNscRewardDistributor: "%s",', stakedNscDistributor.address);
  console.log('FeeNlpRewardDistributor: "%s",', feeNlpDistributor.address);
  console.log('EsnscNlpRewardDistributor: "%s",', stakedNlpDistributor.address);
  console.log('SecondaryPriceFeed: "%s",', secondaryPriceFeed.address);
  console.log('BonusNscDistributor: "%s",', bonusNscDistributor.address);
  console.log('BatchSender: "%s",', batchSender.address);
  console.log('ShortsTracker: "%s",', shortsTracker.address);
  console.log('RewardManager: "%s",', rewardManager.address);
  console.log('FastPriceEvents: "%s"', fastPriceEvents.address);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
