require("@nomiclabs/hardhat-ethers");

/** Hardhat configuration: compiles the project with the exact compiler it pins (0.4.23). */
module.exports = {
  solidity: {
    compilers: [{ version: "0.4.23" }]
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts"
  },
  networks: {
    hardhat: {
      allowUnlimitedContractSize: true
    }
  },
  mocha: {
    timeout: 120000
  }
};
