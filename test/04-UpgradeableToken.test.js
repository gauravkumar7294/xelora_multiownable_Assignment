// SHARED SUITE: runs unchanged against BOTH the original and the updated code.
// In the updated code the deployer is the sole Multiownable owner with threshold 1,
// so a single call still completes setUpgradeAgent and this suite passes unchanged.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { ZERO, parse, s, expectRevert, eventsOf, mine, deploy } = require("./helpers");

describe("UpgradeableToken (shared)", function () {
  const SUPPLY = parse(1000);
  let owner, alice, stranger, token, agent;

  beforeEach(async function () {
    [owner, alice, stranger] = await ethers.getSigners();
    token = await deploy("UpgradeableTokenMock", SUPPLY);
    agent = await deploy("UpgradeAgentMock", SUPPLY);
  });

  it("starts in WaitingForAgent with nothing upgraded", async function () {
    expect(await token.canUpgrade()).to.equal(true);
    expect(await token.getUpgradeState()).to.equal(2);
    expect(s(await token.totalUpgraded())).to.equal("0");
    expect(await token.upgradeAgent()).to.equal(ZERO);
  });

  it("cannot upgrade before an agent is set", async function () {
    await expectRevert(token.upgrade(1), "State must be correct for upgrade");
  });

  it("only an owner can set the upgrade agent", async function () {
    await expectRevert(token.connect(stranger).setUpgradeAgent(agent.address));
    expect(await token.upgradeAgent()).to.equal(ZERO);
  });

  it("rejects a zero agent, a non-agent, and a supply mismatch", async function () {
    await expectRevert(token.setUpgradeAgent(ZERO), "Ensure upgrade agent address is not blank");
    await expectRevert(token.setUpgradeAgent(alice.address)); // EOA, not an agent
    const badAgent = await deploy("UpgradeAgentMock", SUPPLY.add(1));
    await expectRevert(token.setUpgradeAgent(badAgent.address), "Make sure that token supplies match");
    expect(await token.upgradeAgent()).to.equal(ZERO);
  });

  it("sets the agent, emits UpgradeAgentSet, moves to ReadyToUpgrade", async function () {
    const r = await mine(token.setUpgradeAgent(agent.address));
    expect(await token.upgradeAgent()).to.equal(agent.address);
    expect(await token.getUpgradeState()).to.equal(3);
    expect(eventsOf(r, "UpgradeAgentSet").length).to.equal(1);
  });

  it("lets holders upgrade and updates every counter", async function () {
    await token.setUpgradeAgent(agent.address);
    await token.transfer(alice.address, parse(300));
    const r = await mine(token.connect(alice).upgrade(parse(100)));

    expect(s(await token.balanceOf(alice.address))).to.equal(s(parse(200)));
    expect(s(await token.totalSupply())).to.equal(s(parse(900)));
    expect(s(await token.totalUpgraded())).to.equal(s(parse(100)));
    expect(s(await agent.newBalances(alice.address))).to.equal(s(parse(100)));
    expect(await token.getUpgradeState()).to.equal(4);
    expect(eventsOf(r, "Upgrade").length).to.equal(1);
  });

  it("rejects a zero upgrade and an upgrade above the balance", async function () {
    await token.setUpgradeAgent(agent.address);
    await expectRevert(token.connect(alice).upgrade(0), "Upgrade value must be greater than zero");
    await expectRevert(token.connect(alice).upgrade(1));
  });

  it("cannot change the agent once upgrading has started", async function () {
    await token.setUpgradeAgent(agent.address);
    await token.upgrade(parse(1));
    const another = await deploy("UpgradeAgentMock", SUPPLY.sub(parse(1)));
    await expectRevert(token.setUpgradeAgent(another.address), "Ensure upgrade has not started");
  });
});
