// SHARED SUITE: runs unchanged against BOTH the original and the updated code.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { ZERO, parse, s, expectRevert, eventsOf, mine, deploy } = require("./helpers");

describe("XeloraCoin (shared)", function () {
  const SUPPLY = ethers.BigNumber.from(10).pow(11).mul(ethers.BigNumber.from(10).pow(18));
  let owner, alice, bob, token;

  beforeEach(async function () {
    [owner, alice, bob] = await ethers.getSigners();
    token = await deploy("XeloraCoin");
  });

  it("has the correct metadata", async function () {
    expect(await token.name()).to.equal("XeloraCoin");
    expect(await token.symbol()).to.equal("FXC");
    expect(await token.decimals()).to.equal(18);
  });

  it("mints the whole 100 billion supply to the deployer", async function () {
    expect(s(await token.totalSupply())).to.equal(s(SUPPLY));
    expect(s(await token.INITIAL_SUPPLY())).to.equal(s(SUPPLY));
    expect(s(await token.balanceOf(owner.address))).to.equal(s(SUPPLY));
  });

  it("transfers tokens and emits Transfer", async function () {
    const r = await mine(token.transfer(alice.address, parse(10)));
    expect(s(await token.balanceOf(alice.address))).to.equal(s(parse(10)));
    expect(eventsOf(r, "Transfer").length).to.equal(1);
  });

  it("rejects transfers above balance and to the zero address", async function () {
    await expectRevert(token.connect(alice).transfer(bob.address, 1));
    await expectRevert(token.transfer(ZERO, 1));
  });

  it("supports approve + transferFrom", async function () {
    await token.approve(alice.address, parse(5));
    expect(s(await token.allowance(owner.address, alice.address))).to.equal(s(parse(5)));
    await token.connect(alice).transferFrom(owner.address, bob.address, parse(3));
    expect(s(await token.balanceOf(bob.address))).to.equal(s(parse(3)));
    await expectRevert(token.connect(alice).transferFrom(owner.address, bob.address, parse(3)));
  });

  it("owner can pause: transfers/approvals blocked, unpause restores", async function () {
    await token.pause();
    expect(await token.paused()).to.equal(true);
    await expectRevert(token.transfer(alice.address, 1));
    await expectRevert(token.approve(alice.address, 1));
    await token.unpause();
    await token.transfer(alice.address, 1);
    expect(s(await token.balanceOf(alice.address))).to.equal("1");
  });

  it("non-owner cannot pause or unpause", async function () {
    await expectRevert(token.connect(alice).pause());
    await token.pause();
    await expectRevert(token.connect(alice).unpause());
  });

  it("canUpgrade() mirrors !paused", async function () {
    expect(await token.canUpgrade()).to.equal(true);
    await token.pause();
    expect(await token.canUpgrade()).to.equal(false);
    expect(await token.getUpgradeState()).to.equal(1); // NotAllowed
    await token.unpause();
    expect(await token.canUpgrade()).to.equal(true);
  });

  it("uses two-step ownership (Claimable)", async function () {
    await token.transferOwnership(alice.address);
    expect(await token.owner()).to.equal(owner.address);
    expect(await token.pendingOwner()).to.equal(alice.address);
    await expectRevert(token.connect(bob).claimOwnership());
    await token.connect(alice).claimOwnership();
    expect(await token.owner()).to.equal(alice.address);
    await expectRevert(token.pause()); // old owner lost the right
    await token.connect(alice).pause();
  });

  it("full upgrade flow on the real XeloraCoin", async function () {
    const agent = await deploy("UpgradeAgentMock", SUPPLY);
    expect(await token.getUpgradeState()).to.equal(2); // WaitingForAgent
    await token.setUpgradeAgent(agent.address);
    expect(await token.getUpgradeState()).to.equal(3); // ReadyToUpgrade
    await token.transfer(alice.address, parse(100));
    await token.connect(alice).upgrade(parse(40));
    expect(s(await token.balanceOf(alice.address))).to.equal(s(parse(60)));
    expect(s(await token.totalSupply())).to.equal(s(SUPPLY.sub(parse(40))));
    expect(s(await agent.newBalances(alice.address))).to.equal(s(parse(40)));
    expect(await token.getUpgradeState()).to.equal(4); // Upgrading
  });

  it("cannot set an upgrade agent while paused", async function () {
    const agent = await deploy("UpgradeAgentMock", SUPPLY);
    await token.pause();
    await expectRevert(token.setUpgradeAgent(agent.address), "Ensure the token is upgradeable in the first place");
  });
});
