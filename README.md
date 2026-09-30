# Xelora Contract: Multiownable Hardening

## Task

Replace the single-key `onlyOwner` guard on an existing privileged function with a
`Multiownable` (M-of-N owners) pattern, and explain the security rationale.

## What changed

| File | Change |
|------|--------|
| `Multiownable.sol` | **New.** M-of-N confirmation contract. |
| `UpgradeableToken.sol` | Inherits `Multiownable`; `setUpgradeAgent` changed from `onlyOwner` to `onlyManyOwners`. |
| `README.md` | This file (the original was misnamed `READE.md`). |

Everything else is unchanged. Note `XeloraCoin` inherits `UpgradeableToken`, so it
gets the new behaviour automatically.

## Why `setUpgradeAgent`

`setUpgradeAgent` is the most dangerous function in the system guarded by one key:

* It chooses the contract that receives holders' burned tokens during an upgrade.
  `upgrade()` destroys the holder's balance first and then trusts the agent to
  mint the replacement. A malicious or mistaken agent means permanent loss for
  every holder who opts in.
* It is irreversible in practice. After the first holder upgrades
  (`Upgrading` state) the agent can no longer be changed.
* With `onlyOwner`, one stolen or phished private key is enough to trigger it.

The other `onlyOwner` functions (`pause`/`unpause`, `reclaimEther`, `reclaimToken`,
and the `TokenVault` functions) are unchanged; see "Extending" below.

## How the pattern works

1. Each owner calls `setUpgradeAgent(agent)` with the **same arguments**.
2. The call is identified by `keccak256(calldata, ownershipEpoch)`. Different
   arguments mean a different operation, so owners cannot be tricked into
   approving something other than what they reviewed.
3. Each call records one vote (one vote per owner, enforced).
4. The call that reaches `howManyOwnersDecide` votes clears the operation first
   and then runs the function body. Nothing can be replayed.

Extra protections:

* **Expiry:** partial votes lapse after 7 days (`OPERATION_TTL`), so an old vote
  cannot be combined with a much later one.
* **Epoch invalidation:** any change to the owner set or threshold invalidates all
  pending votes.
* **Revocation:** an owner can withdraw their vote with `revokeConfirmation(id)`.
* **Bounded owner set:** at most 10 owners, no zero address, no duplicates, and the
  threshold must be between 1 and the number of owners.
* **Rotation is also multi-sig:** `transferOwnershipWithHowMany` is itself guarded
  by `onlyManyOwners`, so one owner cannot rewrite the owner set.

## Rollout

The deployer starts as the only owner with threshold 1 so existing deployment
scripts and mocks keep working. **Immediately after deployment** move to a real
quorum, for example 2-of-3 on independent hardware wallets:

```js
await token.transferOwnershipWithHowMany([a, b, c], 2);   // threshold is 1 now, so it applies immediately
// then, for a token upgrade:
await token.setUpgradeAgent(agent, { from: a });          // records vote 1, no state change
await token.setUpgradeAgent(agent, { from: b });          // vote 2, agent is set
```

Until that call is made the contract is exactly as safe as the old single owner.

## Behaviour to be aware of

* **Non-final votes do not revert.** A successful transaction from the first owner
  means "vote recorded", not "agent set". Watch `Confirmation` and
  `OperationPerformed`, or read `pendingConfirmations(id)`. `getOperationId(callData)`
  computes the id.
* **Validation happens on the final vote.** The checks inside `setUpgradeAgent`
  (`canUpgrade`, `isUpgradeAgent`, supply match) run when the quorum is met. Owners
  should verify the agent off-chain before voting; a bad agent makes the last
  owner's transaction revert.
* **Key loss is now a threshold problem.** Losing more than N-M keys makes the
  guarded functions unusable. Choose M and N with that in mind, and rotate owners
  proactively.
* **Testing.** A Hardhat test suite is in the parent `xelora-testkit/updated` project; see `TESTING_GUIDE.md`. I could not compile it in my sandbox, so run it yourself.

## Extending the pattern

Other privileged paths should move to `onlyManyOwners` (or to the multisig as the
single `owner`) next, in this order of risk:

1. `Recoverable.reclaimToken`, which on `TokenVault` can withdraw the vested tokens.
2. `Pausable.pause` / `unpause` (freezes all transfers).
3. `TokenVault.lock` / `unlock` / `setAllocation` / `transferFor`.
4. `reclaimEther`.

Alternatively, set the `Claimable` owner of every contract to a multisig wallet so
one mechanism covers everything.

## Running the tests

```bash
npm install
npx hardhat compile
npx hardhat test          # shared regression suites + Multiownable suite
npx hardhat run scripts/demo-multisig.js   # optional: watch a 2-of-3 flow
```

Requires Node 18 or newer. Solidity 0.4.23 is downloaded by Hardhat on first compile.
The tests cover both unchanged behaviour (token, vault, recovery, upgrade) and the new
Multiownable behaviour (quorum, revoke, expiry, owner rotation, validation).

## Third-party code

`contracts/zeppelin/` contains compatible re-typings of the OpenZeppelin 1.9.x contracts that the
project imports (`../zeppelin/...`), so the project builds offline. They are MIT licensed
(see `contracts/zeppelin/LICENSE-openzeppelin.txt`). Replace them with the official pinned package
for any production audit. `Multiownable.sol` is an original implementation written for this task
and has not been independently audited.
