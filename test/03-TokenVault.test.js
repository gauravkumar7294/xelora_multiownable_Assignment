// SHARED SUITE: runs unchanged against BOTH the original and the updated code.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { DAY, ZERO, parse, s, expectRevert, increaseTime, eventsOf, mine, deploy } = require("./helpers");

describe("TokenVault (shared)", function () {
  const TOTAL = parse(1000);
  const VESTING = 30 * DAY;
  let owner, b1, b2, stranger, token, vault;

  beforeEach(async function () {
    [owner, b1, b2, stranger] = await ethers.getSigners();
    token = await deploy("XeloraCoin");
    vault = await deploy("TokenVault", token.address, TOTAL, VESTING);
  });

  async function fundAndAllocate() {
    await token.transfer(vault.address, TOTAL);
    await vault.setAllocation(b1.address, parse(600));
    await vault.setAllocation(b2.address, parse(400));
  }

  describe("construction", function () {
    it("stores its parameters", async function () {
      expect(await vault.token()).to.equal(token.address);
      expect(s(await vault.tokensToBeAllocated())).to.equal(s(TOTAL));
      expect(s(await vault.vestingPeriod())).to.equal(s(VESTING));
      expect(await vault.owner()).to.equal(owner.address);
    });
    it("rejects a zero token address", async function () {
      await expectRevert(deploy("TokenVault", ZERO, TOTAL, VESTING), "Token address should not be blank");
    });
    it("rejects a zero allocation total", async function () {
      await expectRevert(deploy("TokenVault", token.address, 0, VESTING), "Token allocation should be greater than zero");
    });
  });

  describe("setAllocation", function () {
    it("records allocations and emits Allocated", async function () {
      const r = await mine(vault.setAllocation(b1.address, parse(600)));
      expect(s(await vault.allocations(b1.address))).to.equal(s(parse(600)));
      expect(s(await vault.tokensAllocated())).to.equal(s(parse(600)));
      expect(eventsOf(r, "Allocated").length).to.equal(1);
    });
    it("is owner only", async function () {
      await expectRevert(vault.connect(stranger).setAllocation(b1.address, 1));
    });
    it("rejects zero beneficiary, zero amount and duplicates", async function () {
      await expectRevert(vault.setAllocation(ZERO, 1), "Beneficiary of allocation must not be blank");
      await expectRevert(vault.setAllocation(b1.address, 0), "Amount of allocation must not be zero");
      await vault.setAllocation(b1.address, 1);
      await expectRevert(vault.setAllocation(b1.address, 1), "Allocation amount for this beneficiary is not already set");
    });
  });

  describe("lock", function () {
    it("requires all tokens allocated", async function () {
      await token.transfer(vault.address, TOTAL);
      await vault.setAllocation(b1.address, parse(600));
      await expectRevert(vault.lock(), "Expected to allocate all tokens");
    });
    it("requires the vault to be funded", async function () {
      await vault.setAllocation(b1.address, parse(600));
      await vault.setAllocation(b2.address, parse(400));
      await expectRevert(vault.lock(), "Vault must own enough tokens to distribute");
    });
    it("is owner only", async function () {
      await fundAndAllocate();
      await expectRevert(vault.connect(stranger).lock());
    });
    it("locks, emits Locked, and blocks further allocations", async function () {
      await fundAndAllocate();
      const r = await mine(vault.lock());
      expect(eventsOf(r, "Locked").length).to.equal(1);
      expect((await vault.lockedAt()).gt(0)).to.equal(true);
      await expectRevert(vault.setAllocation(stranger.address, 1), "Expected vault to be loadable");
      await expectRevert(vault.lock(), "Expected vault to be loadable");
    });
  });

  describe("unlock / claim / transferFor", function () {
    beforeEach(async function () {
      await fundAndAllocate();
      await vault.lock();
    });

    it("cannot unlock before the vesting period ends", async function () {
      await expectRevert(vault.unlock(), "Lock up must be over");
      await increaseTime(VESTING - 1000);
      await expectRevert(vault.unlock(), "Lock up must be over");
    });
    it("cannot claim before unlock", async function () {
      await expectRevert(vault.connect(b1).claim(), "Expected the vault to be unlocked");
      await expectRevert(vault.transferFor(b1.address), "Expected the vault to be unlocked");
    });
    it("unlock is owner only and one-time", async function () {
      await increaseTime(VESTING + 10);
      await expectRevert(vault.connect(stranger).unlock());
      const r = await mine(vault.unlock());
      expect(eventsOf(r, "Unlocked").length).to.equal(1);
      await expectRevert(vault.unlock(), "Must not be unlocked yet");
    });
    it("beneficiaries can claim exactly once", async function () {
      await increaseTime(VESTING + 10);
      await vault.unlock();
      const r = await mine(vault.connect(b1).claim());
      expect(eventsOf(r, "Distributed").length).to.equal(1);
      expect(s(await token.balanceOf(b1.address))).to.equal(s(parse(600)));
      expect(s(await vault.claimed(b1.address))).to.equal(s(parse(600)));
      expect(s(await vault.totalClaimed())).to.equal(s(parse(600)));
      await expectRevert(vault.connect(b1).claim(), "Tokens to claim must be greater than zero");
    });
    it("accounts without an allocation cannot claim", async function () {
      await increaseTime(VESTING + 10);
      await vault.unlock();
      await expectRevert(vault.connect(stranger).claim(), "Tokens to claim must be greater than zero");
    });
    it("owner can push tokens with transferFor; others cannot", async function () {
      await increaseTime(VESTING + 10);
      await vault.unlock();
      await expectRevert(vault.connect(stranger).transferFor(b2.address));
      await vault.transferFor(b2.address);
      expect(s(await token.balanceOf(b2.address))).to.equal(s(parse(400)));
      await expectRevert(vault.transferFor(b2.address), "Tokens to claim must be greater than zero");
    });
    it("vault ends empty once everyone has been paid", async function () {
      await increaseTime(VESTING + 10);
      await vault.unlock();
      await vault.connect(b1).claim();
      await vault.transferFor(b2.address);
      expect(s(await token.balanceOf(vault.address))).to.equal("0");
      expect(s(await vault.totalClaimed())).to.equal(s(TOTAL));
    });
  });

  describe("[KNOWN ISSUES] documented behaviour that exists in BOTH versions", function () {
    it("anyone can block lock() by sending 1 unit of FXC to the vault", async function () {
      await fundAndAllocate();
      await token.transfer(stranger.address, 1);
      await token.connect(stranger).transfer(vault.address, 1);
      await expectRevert(vault.lock(), "Vault must own enough tokens to distribute");

      // recovery path: owner reclaims everything, re-sends the exact amount
      await vault.reclaimToken(token.address);
      await token.transfer(vault.address, TOTAL);
      await vault.lock();
      expect((await vault.lockedAt()).gt(0)).to.equal(true);
    });

    it("owner can drain the locked vault through reclaimToken()", async function () {
      await fundAndAllocate();
      await vault.lock();
      const before = await token.balanceOf(owner.address);
      await vault.reclaimToken(token.address);
      expect(s(await token.balanceOf(vault.address))).to.equal("0");
      expect(s((await token.balanceOf(owner.address)).sub(before))).to.equal(s(TOTAL));

      await increaseTime(VESTING + 10);
      await vault.unlock();
      await expectRevert(vault.connect(b1).claim()); // beneficiaries are now unpaid
    });
  });
});
