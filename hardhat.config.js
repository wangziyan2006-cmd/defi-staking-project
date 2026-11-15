require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || "",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      chainId: 11155111, // 防呆：RPC 若指向主网(1)会直接报错，避免误用真 ETH 部署
    },
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY,
    // 没有填写 Etherscan Key 时自动跳过 Etherscan，避免 verify 报一堆无意义的错误
    enabled: Boolean(process.env.ETHERSCAN_API_KEY),
  },
  // 免费、无需注册、无需 API Key 的源码验证通道
  sourcify: {
    enabled: true,
  },
};
