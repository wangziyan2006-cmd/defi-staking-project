const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

// 与合约默认值保持一致：每秒每枚代币 1e10 wei（≈31.5% 年化）
const RATE_PER_SECOND = 10n ** 10n;
const ONE = 10n ** 18n;

describe("DeFiStaking Contract Suite", function () {
  let token, staking, owner, addr1, addr2;
  let tokenAddress, stakingAddress;

  beforeEach(async function () {
    [owner, addr1, addr2] = await ethers.getSigners();

    const MockToken = await ethers.getContractFactory("MockToken");
    token = await MockToken.deploy("Mock Token", "MTK");
    await token.waitForDeployment();
    tokenAddress = await token.getAddress();

    const DeFiStaking = await ethers.getContractFactory("DeFiStaking");
    staking = await DeFiStaking.deploy(tokenAddress, tokenAddress);
    await staking.waitForDeployment();
    stakingAddress = await staking.getAddress();

    // 给合约充值奖励资金池，给测试用户转代币
    await token.transfer(stakingAddress, ethers.parseEther("10000"));
    await token.transfer(addr1.address, ethers.parseEther("1000"));
    await token.transfer(addr2.address, ethers.parseEther("1000"));

    await token.connect(addr1).approve(stakingAddress, ethers.parseEther("1000"));
    await token.connect(addr2).approve(stakingAddress, ethers.parseEther("1000"));
  });

  // ---------- R3：核心功能 ----------

  it("Should allow user to stake tokens and emit Staked event", async function () {
    const stakeAmount = ethers.parseEther("100");

    await expect(staking.connect(addr1).stake(stakeAmount))
      .to.emit(staking, "Staked")
      .withArgs(addr1.address, stakeAmount);

    expect(await staking.totalStaked()).to.equal(stakeAmount);
    const info = await staking.stakers(addr1.address);
    expect(info.amount).to.equal(stakeAmount);
  });

  it("Should allow user to withdraw staked tokens and emit Withdrawn event", async function () {
    const stakeAmount = ethers.parseEther("100");
    await staking.connect(addr1).stake(stakeAmount);

    await expect(staking.connect(addr1).withdraw(stakeAmount))
      .to.emit(staking, "Withdrawn")
      .withArgs(addr1.address, stakeAmount);

    expect(await staking.totalStaked()).to.equal(0);
    const info = await staking.stakers(addr1.address);
    expect(info.amount).to.equal(0);
  });

  it("Should track totalStaked across multiple stakers", async function () {
    await staking.connect(addr1).stake(ethers.parseEther("100"));
    await staking.connect(addr2).stake(ethers.parseEther("250"));

    expect(await staking.totalStaked()).to.equal(ethers.parseEther("350"));

    await staking.connect(addr2).withdraw(ethers.parseEther("250"));
    expect(await staking.totalStaked()).to.equal(ethers.parseEther("100"));
  });

  // ---------- 奖励计算 ----------

  it("Should accrue rewards linearly over time (earned view matches math)", async function () {
    const stakeAmount = ethers.parseEther("100");
    await staking.connect(addr1).stake(stakeAmount);

    const duration = 3600n; // 1 小时
    await time.increase(Number(duration));

    const expected = (duration * stakeAmount * RATE_PER_SECOND) / ONE;
    expect(await staking.earned(addr1.address)).to.equal(expected);
  });

  it("Should pay out rewards on claim and reset pending rewards", async function () {
    const stakeAmount = ethers.parseEther("100");
    const stakeTx = await staking.connect(addr1).stake(stakeAmount);
    const stakeReceipt = await stakeTx.wait();
    const t0 = (await ethers.provider.getBlock(stakeReceipt.blockNumber)).timestamp;

    await time.increase(3600);
    const before = await token.balanceOf(addr1.address);

    const claimTx = await staking.connect(addr1).claimReward();
    const claimReceipt = await claimTx.wait();
    const t1 = (await ethers.provider.getBlock(claimReceipt.blockNumber)).timestamp;

    // 用真实区块时间戳推算应发奖励，避免测试对 +1 秒的区块间隔敏感
    const expected = (BigInt(t1 - t0) * stakeAmount * RATE_PER_SECOND) / ONE;

    await expect(claimTx)
      .to.emit(staking, "RewardClaimed")
      .withArgs(addr1.address, expected);

    expect(await token.balanceOf(addr1.address)).to.equal(before + expected);
    expect(await staking.earned(addr1.address)).to.equal(0);
  });

  it("Should keep rewards accruing after a partial withdraw (no reward loss)", async function () {
    const stakeAmount = ethers.parseEther("200");
    const stakeTx = await staking.connect(addr1).stake(stakeAmount);
    const stakeReceipt = await stakeTx.wait();
    const t0 = (await ethers.provider.getBlock(stakeReceipt.blockNumber)).timestamp;

    await time.increase(1800); // 先攒 30 分钟

    const withdrawTx = await staking.connect(addr1).withdraw(ethers.parseEther("100"));
    const withdrawReceipt = await withdrawTx.wait();
    const t1 = (await ethers.provider.getBlock(withdrawReceipt.blockNumber)).timestamp;

    const firstLeg = (BigInt(t1 - t0) * stakeAmount * RATE_PER_SECOND) / ONE;

    // 提取后未领取的收益应保留在 pendingRewards 中，不应清零
    const info = await staking.stakers(addr1.address);
    expect(info.pendingRewards).to.equal(firstLeg);
    expect(info.amount).to.equal(ethers.parseEther("100"));

    await time.increase(1800); // 剩余一半仓位再跑 30 分钟
    const earned = await staking.earned(addr1.address);
    expect(earned).to.be.greaterThan(firstLeg + firstLeg / 4n);
  });

  // ---------- 权限（R3：access control） ----------

  it("Should reject setRewardRate from non-owner", async function () {
    await expect(staking.connect(addr1).setRewardRate(1)).to.be.revertedWithCustomError(
      staking,
      "OwnableUnauthorizedAccount"
    );
  });

  it("Should reject pause from non-owner", async function () {
    await expect(staking.connect(addr1).pause()).to.be.revertedWithCustomError(
      staking,
      "OwnableUnauthorizedAccount"
    );
  });

  it("Should let owner update reward rate and emit RewardRateUpdated", async function () {
    const newRate = 2n * RATE_PER_SECOND;
    await expect(staking.connect(owner).setRewardRate(newRate))
      .to.emit(staking, "RewardRateUpdated")
      .withArgs(newRate);

    expect(await staking.rewardRatePerSecond()).to.equal(newRate);
  });

  // ---------- Pausable 运维（R5） ----------

  it("Should block staking while paused and restore it after unpause", async function () {
    await staking.pause();

    await expect(
      staking.connect(addr1).stake(ethers.parseEther("50"))
    ).to.be.revertedWithCustomError(staking, "EnforcedPause");

    await staking.unpause();
    await expect(staking.connect(addr1).stake(ethers.parseEther("50"))).to.emit(
      staking,
      "Staked"
    );
  });

  it("Should still allow withdraw while paused (funds never locked in)", async function () {
    await staking.connect(addr1).stake(ethers.parseEther("100"));
    await staking.pause();

    await expect(staking.connect(addr1).withdraw(ethers.parseEther("100"))).to.emit(
      staking,
      "Withdrawn"
    );
  });

  // ---------- 边界与 revert ----------

  it("Should reject staking zero amount", async function () {
    await expect(staking.connect(addr1).stake(0)).to.be.revertedWith("Cannot stake 0");
  });

  it("Should reject withdrawing more than staked", async function () {
    await staking.connect(addr1).stake(ethers.parseEther("100"));
    await expect(
      staking.connect(addr1).withdraw(ethers.parseEther("101"))
    ).to.be.revertedWith("Insufficient staked balance");
  });

  it("Should reject claiming when no rewards are available", async function () {
    await expect(staking.connect(addr2).claimReward()).to.be.revertedWith(
      "No rewards available"
    );
  });

  it("Should revert staking when allowance is insufficient (ERC20 custom error)", async function () {
    await token.connect(addr2).approve(stakingAddress, 0);
    await expect(
      staking.connect(addr2).stake(ethers.parseEther("100"))
    ).to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance");
  });

  it("Should revert staking when the user has no tokens (ERC20 custom error)", async function () {
    const poor = (await ethers.getSigners())[5];
    // 先给足授权额度，才能走到「余额不足」这一层的检查
    await token.connect(poor).approve(stakingAddress, ethers.parseEther("100"));
    await expect(
      staking.connect(poor).stake(ethers.parseEther("100"))
    ).to.be.revertedWithCustomError(token, "ERC20InsufficientBalance");
  });
});
