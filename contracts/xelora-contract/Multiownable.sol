pragma solidity 0.4.23;


/**
 * @title Multiownable provides an M-of-N ownership (multi-signature) pattern.
 * @dev A function guarded by `onlyManyOwners` only executes once
 * `howManyOwnersDecide` DISTINCT owners have called it with IDENTICAL calldata
 * (same function selector and same arguments).
 *
 * IMPORTANT behaviour: while the confirmation threshold has not been reached,
 * a call by an owner does NOT revert. It records the owner's vote and returns
 * without running the function body (a revert would roll the vote back). Callers
 * must therefore watch the `Confirmation` / `OperationPerformed` events, or read
 * `pendingConfirmations`, instead of assuming a successful transaction means
 * the action happened. Only guard functions where this is acceptable.
 *
 * Safety properties:
 * - One vote per owner per operation.
 * - Votes are bound to the exact calldata, so owners cannot be tricked into
 *   approving different arguments than the ones they reviewed.
 * - Pending votes expire after OPERATION_TTL.
 * - Any change of the owner set or threshold invalidates all pending votes
 *   (ownershipEpoch is part of the operation id).
 * - An owner can withdraw a vote with `revokeConfirmation`.
 * - The contract deployer starts as the only owner with a threshold of 1 so
 *   that existing deployment scripts keep working; call
 *   `transferOwnershipWithHowMany` right after deployment to move to a real
 *   M-of-N set (for example 2-of-3).
 *
 * This is independent of Ownable's single `owner`. Functions still guarded by
 * `onlyOwner` are not covered by this contract.
 */
contract Multiownable {

  /** Upper bound on owners; keeps the vote loops cheap and gas-safe. */
  uint256 public constant MAX_OWNERS = 10;

  /** How long a partially-confirmed operation stays open. */
  uint256 public constant OPERATION_TTL = 7 days;

  /** Current owners. */
  address[] public owners;

  /** Number of distinct owners that must confirm an operation (M). */
  uint256 public howManyOwnersDecide;

  /** Incremented on every owner-set change; invalidates pending operations. */
  uint256 public ownershipEpoch;

  /** 1-based index into `owners`; 0 means "not an owner". */
  mapping (address => uint256) internal ownerIndex;

  struct Operation {
    uint256 createdAt;
    address[] voters;
  }

  /** Pending operations by id. */
  mapping (bytes32 => Operation) internal operations;


  /** An owner voted for an operation. */
  event Confirmation(
    bytes32 indexed operation,
    address indexed owner,
    uint256 confirmations,
    uint256 required
  );

  /** An owner withdrew their vote. */
  event Revocation(bytes32 indexed operation, address indexed owner);

  /** The threshold was reached and the guarded function body ran. */
  event OperationPerformed(bytes32 indexed operation, address indexed lastOwner);

  /** The owner set and/or threshold changed. */
  event MultiOwnersChanged(address[] newOwners, uint256 newHowManyOwnersDecide);


  /** Restrict to any single current owner (no quorum). */
  modifier onlyAnyOwner() {
    require(isOwner(msg.sender), "Caller is not one of the owners");
    _;
  }

  /**
   * Restrict to a quorum of owners. The body runs only on the call that
   * completes the quorum; earlier calls only record a vote.
   */
  modifier onlyManyOwners() {
    if (_confirm(msg.data)) {
      _;
    }
  }


  /** The deployer is the sole owner with a threshold of 1. */
  constructor() public {
    owners.push(msg.sender);
    ownerIndex[msg.sender] = 1;
    howManyOwnersDecide = 1;
    emit MultiOwnersChanged(owners, howManyOwnersDecide);
  }


  /**
   * @notice Replace the owner set and threshold. Itself requires a quorum of
   * the CURRENT owners.
   * @param _newOwners The new owners (1..MAX_OWNERS, no zero address, no duplicates)
   * @param _newHowMany How many of them must confirm (1..number of owners)
   */
  function transferOwnershipWithHowMany(
    address[] _newOwners,
    uint256 _newHowMany
  )
    public
    onlyManyOwners
  {
    require(_newOwners.length > 0, "Need at least one owner");
    require(_newOwners.length <= MAX_OWNERS, "Too many owners");
    require(_newHowMany > 0 && _newHowMany <= _newOwners.length, "Invalid threshold");

    uint256 i;
    for (i = 0; i < owners.length; i++) {
      delete ownerIndex[owners[i]];
    }
    owners.length = 0;

    for (i = 0; i < _newOwners.length; i++) {
      address newOwner = _newOwners[i];
      require(newOwner != address(0), "Owner must not be the zero address");
      require(ownerIndex[newOwner] == 0, "Duplicate owner");
      owners.push(newOwner);
      ownerIndex[newOwner] = i + 1;
    }

    howManyOwnersDecide = _newHowMany;
    ownershipEpoch = ownershipEpoch + 1;

    emit MultiOwnersChanged(_newOwners, _newHowMany);
  }

  /**
   * @notice Withdraw your own pending vote.
   * @param _operation The operation id (see getOperationId)
   */
  function revokeConfirmation(bytes32 _operation) external onlyAnyOwner {
    Operation storage op = operations[_operation];
    uint256 len = op.voters.length;

    for (uint256 i = 0; i < len; i++) {
      if (op.voters[i] == msg.sender) {
        op.voters[i] = op.voters[len - 1];
        op.voters.length = len - 1;
        if (op.voters.length == 0) {
          delete operations[_operation];
        }
        emit Revocation(_operation, msg.sender);
        return;
      }
    }
    revert("No confirmation from caller to revoke");
  }


  /** Is `_account` currently an owner? */
  function isOwner(address _account) public view returns(bool) {
    return ownerIndex[_account] > 0;
  }

  /** Number of current owners. */
  function ownersCount() public view returns(uint256) {
    return owners.length;
  }

  /** Votes recorded so far for an operation id (0 if none or expired). */
  function pendingConfirmations(bytes32 _operation) public view returns(uint256) {
    Operation storage op = operations[_operation];
    if (op.voters.length > 0 && block.timestamp > op.createdAt + OPERATION_TTL) {
      return 0;
    }
    return op.voters.length;
  }

  /** Has `_owner` already voted for `_operation`? */
  function hasConfirmed(bytes32 _operation, address _owner) public view returns(bool) {
    Operation storage op = operations[_operation];
    if (op.voters.length > 0 && block.timestamp > op.createdAt + OPERATION_TTL) {
      return false;
    }
    for (uint256 i = 0; i < op.voters.length; i++) {
      if (op.voters[i] == _owner) {
        return true;
      }
    }
    return false;
  }

  /**
   * @notice Compute the id of an operation from its full calldata, i.e. the
   * 4-byte selector followed by the ABI-encoded arguments.
   */
  function getOperationId(bytes _callData) public view returns(bytes32) {
    return keccak256(abi.encodePacked(_callData, ownershipEpoch));
  }


  /**
   * @dev Record msg.sender's vote for `_callData`.
   * @return true once the quorum is complete and the body may run
   */
  function _confirm(bytes _callData) internal returns(bool) {
    require(isOwner(msg.sender), "Caller is not one of the owners");

    bytes32 id = keccak256(abi.encodePacked(_callData, ownershipEpoch));
    Operation storage op = operations[id];

    // Drop stale votes
    if (op.voters.length > 0 && block.timestamp > op.createdAt + OPERATION_TTL) {
      delete operations[id];
    }

    for (uint256 i = 0; i < op.voters.length; i++) {
      require(op.voters[i] != msg.sender, "Owner already confirmed this operation");
    }

    if (op.voters.length == 0) {
      op.createdAt = block.timestamp;
    }
    op.voters.push(msg.sender);

    emit Confirmation(id, msg.sender, op.voters.length, howManyOwnersDecide);

    if (op.voters.length < howManyOwnersDecide) {
      return false;
    }

    // Clear BEFORE the body runs (checks-effects-interactions, no replay)
    delete operations[id];
    emit OperationPerformed(id, msg.sender);
    return true;
  }

}
