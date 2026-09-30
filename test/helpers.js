const { ethers, network } = require("hardhat");

const DAY = 24 * 60 * 60;
const ZERO = ethers.constants.AddressZero;

/** Parse a whole-token amount into 18-decimal base units. */
const parse = (n) => ethers.utils.parseUnits(String(n), 18);

/** BigNumber (or number) to string so chai's equal() can compare it. */
const s = (x) => x.toString();

/** Collect every piece of text hanging off an error (ethers wraps the node error). */
function collect(e, depth, out) {
  if (!e || depth > 6) return out;
  if (typeof e === "string") { out.push(e); return out; }
  ["message", "reason", "body", "stack", "data"].forEach((k) => {
    if (typeof e[k] === "string") out.push(e[k]);
  });
  if (e.error) collect(e.error, depth + 1, out);
  if (e.data && typeof e.data === "object") collect(e.data, depth + 1, out);
  return out;
}

/**
 * Assert that a promise (a contract call/transaction) reverts.
 * If `reason` is given, the revert reason string must also match.
 */
async function expectRevert(promise, reason) {
  let failed = false;
  let text = "";
  try {
    await promise;
  } catch (e) {
    failed = true;
    text = collect(e, 0, []).join(" | ");
  }
  if (!failed) {
    throw new Error("Expected the transaction to revert, but it succeeded");
  }
  if (reason && !text.includes(reason)) {
    throw new Error('Expected revert reason "' + reason + '" but got: ' + text);
  }
}

/** Move the local chain forward by `seconds` and mine a block. */
async function increaseTime(seconds) {
  await network.provider.send("evm_increaseTime", [seconds]);
  await network.provider.send("evm_mine");
}

/** Events of a given name in a mined receipt. */
function eventsOf(receipt, name) {
  return (receipt.events || []).filter((e) => e.event === name);
}

/** Send a transaction and wait for it to be mined. */
async function mine(txPromise) {
  const tx = await txPromise;
  return tx.wait();
}

/** Ether spent on gas by a receipt. */
function gasCost(receipt) {
  return receipt.gasUsed.mul(receipt.effectiveGasPrice);
}

async function deploy(name, ...args) {
  const Factory = await ethers.getContractFactory(name);
  const c = await Factory.deploy(...args);
  await c.deployed();
  return c;
}

module.exports = { DAY, ZERO, parse, s, expectRevert, increaseTime, eventsOf, mine, gasCost, deploy };
