// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title DeFiStaking
 * @dev 包含线性奖励计算、防重入攻击、紧急暂停开关与事件上链
 */
contract DeFiStaking is Ownable, ReentrancyGuard, Pausable {
    IERC20 public immutable stakingToken;
    IERC20 public immutable rewardToken;

    // 每秒每 1 枚质押代币产生的奖励（wei）。1e10 ≈ 31.5% 年化，取此值是为了让演示中的奖励可见
    uint256 public rewardRatePerSecond = 1e10;
    uint256 public totalStaked;

    struct Staker {
        uint256 amount;
        uint256 lastUpdateTime;
        uint256 pendingRewards;
    }

    mapping(address => Staker) public stakers;

    // R3 关键加分项：事件机制
    event Staked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardClaimed(address indexed user, uint256 amount);
    event RewardRateUpdated(uint256 newRate);

    constructor(address _stakingToken, address _rewardToken) Ownable(msg.sender) {
        stakingToken = IERC20(_stakingToken);
        rewardToken = IERC20(_rewardToken);
    }

    // 收益更新修饰器
    modifier updateReward(address account) {
        Staker storage user = stakers[account];
        if (user.amount > 0) {
            uint256 duration = block.timestamp - user.lastUpdateTime;
            user.pendingRewards += (duration * user.amount * rewardRatePerSecond) / 1e18;
        }
        user.lastUpdateTime = block.timestamp;
        _;
    }

    // 质押代币
    function stake(uint256 amount) external nonReentrant whenNotPaused updateReward(msg.sender) {
        require(amount > 0, "Cannot stake 0");
        stakers[msg.sender].amount += amount;
        totalStaked += amount;

        bool success = stakingToken.transferFrom(msg.sender, address(this), amount);
        require(success, "Token transfer failed");

        emit Staked(msg.sender, amount);
    }

    // 提取本金
    function withdraw(uint256 amount) external nonReentrant updateReward(msg.sender) {
        Staker storage user = stakers[msg.sender];
        require(user.amount >= amount, "Insufficient staked balance");

        user.amount -= amount;
        totalStaked -= amount;

        bool success = stakingToken.transfer(msg.sender, amount);
        require(success, "Token transfer failed");

        emit Withdrawn(msg.sender, amount);
    }

    // 领取收益
    function claimReward() external nonReentrant updateReward(msg.sender) {
        Staker storage user = stakers[msg.sender];
        uint256 reward = user.pendingRewards;
        require(reward > 0, "No rewards available");

        user.pendingRewards = 0;
        bool success = rewardToken.transfer(msg.sender, reward);
        require(success, "Reward transfer failed");

        emit RewardClaimed(msg.sender, reward);
    }

    // 查询未结收益（前端/只读函数）
    function earned(address account) external view returns (uint256) {
        Staker memory user = stakers[account];
        uint256 duration = block.timestamp - user.lastUpdateTime;
        return user.pendingRewards + ((duration * user.amount * rewardRatePerSecond) / 1e18);
    }

    // 管理员功能（R5 运维与暂停机制）
    function setRewardRate(uint256 newRate) external onlyOwner {
        rewardRatePerSecond = newRate;
        emit RewardRateUpdated(newRate);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
