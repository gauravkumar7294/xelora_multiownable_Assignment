// SHARED SUITE: runs unchanged against BOTH the original and the updated code.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { parse, s, expectRevert, mine, gasCost, deploy } = require("./helpers");

describe("Recoverable (shared)", function () {
  let owner, alice, mock, token;

  beforeEach(async function () {
    [owner, alice] = await ethers.getSigners();
    mock = await deploy("PayableRecoverableMock");
    token = await deploy("XeloraCoin");
  });

  it("owner can reclaim ether sent to the contract", async function () {
    const one = ethers.utils.parseEther("1");
    await owner.sendTransaction({ to: mock.address, value: one });
    expect(s(await ethers.provider.getBalance(mock.address))).to.equal(s(one));

    const before = await owner.getBalance();
    const r = await mine(mock.reclaimEther());
    const after = await owner.getBalance();

    expect(s(await ethers.provider.getBalance(mock.address))).to.equal("0");
    expect(s(after.sub(before).add(gasCost(r)))).to.equal(s(one));
  });

  it("non-owner cannot reclaim ether", async function () {
    await owner.sendTransaction({ to: mock.address, value: 1000 });
    await expectRevert(mock.connect(alice).reclaimEther());
  });

  it("owner can reclaim ERC20 tokens sent to the contract by mistake", async function () {
    await token.transfer(mock.address, parse(25));
    expect(s(await token.balanceOf(mock.address))).to.equal(s(parse(25)));
    const before = await token.balanceOf(owner.address);
    await mock.reclaimToken(token.address);
    expect(s(await token.balanceOf(mock.address))).to.equal("0");
    expect(s((await token.balanceOf(owner.address)).sub(before))).to.equal(s(parse(25)));
  });

  it("non-owner cannot reclaim tokens", async function () {
    await token.transfer(mock.address, parse(1));
    await expectRevert(mock.connect(alice).reclaimToken(token.address));
  });

  it("XeloraCoin itself can recover tokens sent to the token contract", async function () {
    await token.transfer(token.address, parse(7));
    const before = await token.balanceOf(owner.address);
    await token.reclaimToken(token.address);
    expect(s(await token.balanceOf(token.address))).to.equal("0");
    expect(s((await token.balanceOf(owner.address)).sub(before))).to.equal(s(parse(7)));
  });
});
