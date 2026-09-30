pragma solidity ^0.4.21;


import "./Ownable.sol";
import "../token/ERC20/ERC20Basic.sol";
import "../token/ERC20/SafeERC20.sol";


/**
 * @title Contracts that should be able to recover tokens
 * @dev The owner can send the contract's whole balance of any ERC20 to itself.
 */
contract CanReclaimToken is Ownable {
  using SafeERC20 for ERC20Basic;

  function reclaimToken(ERC20Basic token) external onlyOwner {
    uint256 balance = token.balanceOf(this);
    token.safeTransfer(owner, balance);
  }
}
