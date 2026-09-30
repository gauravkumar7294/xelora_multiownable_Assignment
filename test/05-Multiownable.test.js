// UPDATED-ONLY SUITE: tests the new Multiownable behaviour.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { DAY, ZERO, parse, s, expectRevert, increaseTime, eventsOf, mine, deploy } = require("./helpers");

describe("UPDATED: Multiownable + setUpgradeAgent", function () {
  const SUPPLY = parse(1000);
  let deployer, a, b, c, d, stranger, token, agent, agent2;

  beforeEach(async function () {
    [deployer, a, b, c, d, stranger] = await ethers.getSigners();
    token = await deploy("UpgradeableTokenMock", SUPPLY);
    agent = await deploy("UpgradeAgentMock", SUPPLY);
    agent2 = await deploy("UpgradeAgentMock", SUPPLY);
  });

  const addrs = (...signers) => signers.map((x) => x.address);
  const make2of3 = () => token.transferOwnershipWithHowMany(addrs(a, b, c), 2);
  const opId = (fn, args) => token.getOperationId(token.interface.encodeFunctionData(fn, args));

  describe("initial state", function () {
    it("deployer is the only owner with threshold 1", async function () {
      expect(await token.owners(0)).to.equal(deployer.address);
      expect(s(await token.ownersCount())).to.equal("1");
      expect(s(await token.howManyOwnersDecide())).to.equal("1");
      expect(s(await token.ownershipEpoch())).to.equal("0");
      expect(s(await token.MAX_OWNERS())).to.equal("10");
      expect(s(await token.OPERATION_TTL())).to.equal(String(7 * DAY));
      expect(await token.isOwner(deployer.address)).to.equal(true);
      expect(await token.isOwner(a.address)).to.equal(false);
    });

    it("with threshold 1 the deployer completes setUpgradeAgent in one call", async function () {
      const r = await mine(token.setUpgradeAgent(agent.address));
      expect(await token.upgradeAgent()).to.equal(agent.address);
      expect(eventsOf(r, "OperationPerformed").length).to.equal(1);
    });
  });

  describe("changing owners (transferOwnershipWithHowMany)", function () {
    it("moves to 2-of-3, bumps the epoch, removes the deployer", async function () {
      const r = await mine(make2of3());
      expect(eventsOf(r, "MultiOwnersChanged").length).to.equal(1);
      expect(s(await token.ownersCount())).to.equal("3");
      expect(s(await token.howManyOwnersDecide())).to.equal("2");
      expect(s(await token.ownershipEpoch())).to.equal("1");
      expect(await token.owners(0)).to.equal(a.address);
      expect(await token.owners(2)).to.equal(c.address);
      expect(await token.isOwner(deployer.address)).to.equal(false);
      expect(await token.isOwner(b.address)).to.equal(true);
      await expectRevert(token.owners(3));
    });

    it("validates its input", async function () {
      await expectRevert(token.transferOwnershipWithHowMany([], 1), "Need at least one owner");
      const eleven = Array.from({ length: 11 }, () => ethers.Wallet.createRandom().address);
      await expectRevert(token.transferOwnershipWithHowMany(eleven, 1), "Too many owners");
      await expectRevert(token.transferOwnershipWithHowMany([ZERO, a.address], 1), "Owner must not be the zero address");
      await expectRevert(token.transferOwnershipWithHowMany([a.address, a.address], 1), "Duplicate owner");
      await expectRevert(token.transferOwnershipWithHowMany(addrs(a, b), 0), "Invalid threshold");
      await expectRevert(token.transferOwnershipWithHowMany(addrs(a, b), 3), "Invalid threshold");
    });

    it("accepts exactly 10 owners", async function () {
      const ten = Array.from({ length: 10 }, () => ethers.Wallet.createRandom().address);
      await token.transferOwnershipWithHowMany(ten, 10);
      expect(s(await token.ownersCount())).to.equal("10");
    });

    it("non-owners cannot change owners", async function () {
      await expectRevert(token.connect(stranger).transferOwnershipWithHowMany(addrs(stranger), 1), "Caller is not one of the owners");
    });

    it("itself needs the quorum of the CURRENT owners", async function () {
      await make2of3();
      await token.connect(a).transferOwnershipWithHowMany(addrs(a), 1); // vote 1 of 2: no effect
      expect(s(await token.ownersCount())).to.equal("3");
      await token.connect(b).transferOwnershipWithHowMany(addrs(a), 1); // vote 2: executes
      expect(s(await token.ownersCount())).to.equal("1");
      expect(s(await token.howManyOwnersDecide())).to.equal("1");
    });
  });

  describe("setUpgradeAgent with 2-of-3", function () {
    beforeEach(async function () { await make2of3(); });

    it("first vote is recorded but does NOT execute; second vote executes", async function () {
      const id = await opId("setUpgradeAgent", [agent.address]);

      const r1 = await mine(token.connect(a).setUpgradeAgent(agent.address));
      expect(await token.upgradeAgent()).to.equal(ZERO);
      expect(s(await token.pendingConfirmations(id))).to.equal("1");
      expect(await token.hasConfirmed(id, a.address)).to.equal(true);
      expect(await token.hasConfirmed(id, b.address)).to.equal(false);
      expect(eventsOf(r1, "Confirmation").length).to.equal(1);
      expect(eventsOf(r1, "OperationPerformed").length).to.equal(0);
      expect(eventsOf(r1, "UpgradeAgentSet").length).to.equal(0);

      const r2 = await mine(token.connect(b).setUpgradeAgent(agent.address));
      expect(await token.upgradeAgent()).to.equal(agent.address);
      expect(eventsOf(r2, "OperationPerformed").length).to.equal(1);
      expect(eventsOf(r2, "UpgradeAgentSet").length).to.equal(1);
      expect(s(await token.pendingConfirmations(id))).to.equal("0");
      expect(await token.getUpgradeState()).to.equal(3);
    });

    it("the old single owner (deployer) has lost all power", async function () {
      await expectRevert(token.setUpgradeAgent(agent.address), "Caller is not one of the owners");
    });

    it("a non-owner cannot vote", async function () {
      await expectRevert(token.connect(stranger).setUpgradeAgent(agent.address), "Caller is not one of the owners");
    });

    it("the same owner cannot vote twice", async function () {
      await token.connect(a).setUpgradeAgent(agent.address);
      await expectRevert(token.connect(a).setUpgradeAgent(agent.address), "Owner already confirmed this operation");
      expect(await token.upgradeAgent()).to.equal(ZERO);
    });

    it("votes for DIFFERENT arguments never combine", async function () {
      await token.connect(a).setUpgradeAgent(agent.address);
      await token.connect(b).setUpgradeAgent(agent2.address);
      expect(await token.upgradeAgent()).to.equal(ZERO);
      expect(s(await token.pendingConfirmations(await opId("setUpgradeAgent", [agent.address])))).to.equal("1");
      expect(s(await token.pendingConfirmations(await opId("setUpgradeAgent", [agent2.address])))).to.equal("1");
      // and a third owner completing one of them executes exactly that one
      await token.connect(c).setUpgradeAgent(agent2.address);
      expect(await token.upgradeAgent()).to.equal(agent2.address);
    });

    it("an owner can revoke their vote", async function () {
      const id = await opId("setUpgradeAgent", [agent.address]);
      await token.connect(a).setUpgradeAgent(agent.address);
      const r = await mine(token.connect(a).revokeConfirmation(id));
      expect(eventsOf(r, "Revocation").length).to.equal(1);
      expect(s(await token.pendingConfirmations(id))).to.equal("0");

      await token.connect(b).setUpgradeAgent(agent.address); // only 1 vote now
      expect(await token.upgradeAgent()).to.equal(ZERO);
      expect(s(await token.pendingConfirmations(id))).to.equal("1");
    });

    it("cannot revoke without having voted, and outsiders cannot revoke", async function () {
      const id = await opId("setUpgradeAgent", [agent.address]);
      await token.connect(a).setUpgradeAgent(agent.address);
      await expectRevert(token.connect(b).revokeConfirmation(id), "No confirmation from caller to revoke");
      await expectRevert(token.connect(stranger).revokeConfirmation(id), "Caller is not one of the owners");
    });

    it("votes expire after 7 days", async function () {
      const id = await opId("setUpgradeAgent", [agent.address]);
      await token.connect(a).setUpgradeAgent(agent.address);
      await increaseTime(7 * DAY + 60);
      expect(s(await token.pendingConfirmations(id))).to.equal("0");

      await token.connect(b).setUpgradeAgent(agent.address); // a's vote is stale
      expect(await token.upgradeAgent()).to.equal(ZERO);
      expect(s(await token.pendingConfirmations(id))).to.equal("1");

      await token.connect(a).setUpgradeAgent(agent.address); // fresh quorum
      expect(await token.upgradeAgent()).to.equal(agent.address);
    });

    it("votes do NOT expire before 7 days", async function () {
      await token.connect(a).setUpgradeAgent(agent.address);
      await increaseTime(7 * DAY - 3600);
      await token.connect(b).setUpgradeAgent(agent.address);
      expect(await token.upgradeAgent()).to.equal(agent.address);
    });

    it("changing the owner set invalidates all pending votes", async function () {
      await token.connect(a).setUpgradeAgent(agent.address); // pending vote from a
      await token.connect(a).transferOwnershipWithHowMany(addrs(a, b, c), 2);
      await token.connect(b).transferOwnershipWithHowMany(addrs(a, b, c), 2); // epoch 1 -> 2
      expect(s(await token.ownershipEpoch())).to.equal("2");

      await token.connect(b).setUpgradeAgent(agent.address); // a's old vote must not count
      expect(await token.upgradeAgent()).to.equal(ZERO);
      await token.connect(a).setUpgradeAgent(agent.address);
      expect(await token.upgradeAgent()).to.equal(agent.address);
    });

    it("if the final vote fails validation, it reverts and earlier votes stay pending", async function () {
      const bad = await deploy("UpgradeAgentMock", SUPPLY.add(1));
      const id = await opId("setUpgradeAgent", [bad.address]);
      await token.connect(a).setUpgradeAgent(bad.address);
      await expectRevert(token.connect(b).setUpgradeAgent(bad.address), "Make sure that token supplies match");
      expect(await token.upgradeAgent()).to.equal(ZERO);
      expect(s(await token.pendingConfirmations(id))).to.equal("1");
      expect(await token.hasConfirmed(id, b.address)).to.equal(false);
    });

    it("a 3-of-3 threshold needs all three owners", async function () {
      await token.connect(a).transferOwnershipWithHowMany(addrs(a, b, c), 3);
      await token.connect(b).transferOwnershipWithHowMany(addrs(a, b, c), 3);
      expect(s(await token.howManyOwnersDecide())).to.equal("3");
      await token.connect(a).setUpgradeAgent(agent.address);
      await token.connect(b).setUpgradeAgent(agent.address);
      expect(await token.upgradeAgent()).to.equal(ZERO);
      await token.connect(c).setUpgradeAgent(agent.address);
      expect(await token.upgradeAgent()).to.equal(agent.address);
    });

    it("holders can upgrade normally after the multi-owner agent is set", async function () {
      await token.connect(a).setUpgradeAgent(agent.address);
      await token.connect(b).setUpgradeAgent(agent.address);
      await token.transfer(d.address, parse(50)); // deployer still holds the tokens
      await token.connect(d).upgrade(parse(20));
      expect(s(await agent.newBalances(d.address))).to.equal(s(parse(20)));
      expect(await token.getUpgradeState()).to.equal(4);
    });
  });

  describe("interaction with the remaining Ownable/Claimable owner", function () {
    it("pause() is still governed by the single Ownable owner (documented residual risk)", async function () {
      const x = await deploy("XeloraCoin");
      await x.transferOwnershipWithHowMany(addrs(a, b, c), 2);
      await x.pause(); // deployer is still the Ownable owner
      expect(await x.paused()).to.equal(true);
      await x.unpause();
      await expectRevert(x.connect(a).pause()); // multi-owner is NOT the Ownable owner
    });

    it("end-to-end on XeloraCoin: 2-of-3 sets the agent, holder upgrades", async function () {
      const x = await deploy("XeloraCoin");
      const full = await x.totalSupply();
      const ag = await deploy("UpgradeAgentMock", full);
      await x.transferOwnershipWithHowMany(addrs(a, b, c), 2);
      await x.connect(a).setUpgradeAgent(ag.address);
      expect(await x.upgradeAgent()).to.equal(ZERO);
      await x.connect(c).setUpgradeAgent(ag.address);
      expect(await x.upgradeAgent()).to.equal(ag.address);
      await x.transfer(d.address, parse(10));
      await x.connect(d).upgrade(parse(4));
      expect(s(await ag.newBalances(d.address))).to.equal(s(parse(4)));
    });
  });
});
