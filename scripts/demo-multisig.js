// Manual walk-through for the UPDATED code.  Run:  npx hardhat run scripts/demo-multisig.js
const { ethers } = require("hardhat");

async function main() {
  const [deployer, a, b, c] = await ethers.getSigners();
  const supply = ethers.utils.parseUnits("1000", 18);

  const Token = await ethers.getContractFactory("UpgradeableTokenMock");
  const Agent = await ethers.getContractFactory("UpgradeAgentMock");
  const token = await Token.deploy(supply); await token.deployed();
  const agent = await Agent.deploy(supply); await agent.deployed();

  console.log("1) owners at deploy:", await token.owners(0), "threshold:", (await token.howManyOwnersDecide()).toString());

  await (await token.transferOwnershipWithHowMany([a.address, b.address, c.address], 2)).wait();
  console.log("2) now 2-of-3. owners:", (await token.ownersCount()).toString(), "threshold:", (await token.howManyOwnersDecide()).toString());

  const id = await token.getOperationId(token.interface.encodeFunctionData("setUpgradeAgent", [agent.address]));

  await (await token.connect(a).setUpgradeAgent(agent.address)).wait();
  console.log("3) after owner A votes -> agent:", await token.upgradeAgent(), "| votes:", (await token.pendingConfirmations(id)).toString());

  await (await token.connect(b).setUpgradeAgent(agent.address)).wait();
  console.log("4) after owner B votes -> agent:", await token.upgradeAgent(), "| votes:", (await token.pendingConfirmations(id)).toString());
  console.log("=> the agent was set only when TWO owners agreed.");

  try {
    await token.setUpgradeAgent(agent.address);
    console.log("UNEXPECTED: old deployer key still works");
  } catch (e) {
    console.log("5) the old single key is rejected, as expected.");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
