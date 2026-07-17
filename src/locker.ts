// Shared mapping for both BlitzrLocker instances (BlitzrLockerV3 and BlitzrLockerBondingCurve —
// see subgraph.yaml). BlitzrLocker.launcher is a single address and cannot be shared between the
// two stacks at once (BONDING_CURVE.md -> "Deployment Order"), so Arc runs two separate
// instances of the identical contract. Handlers here are instance-agnostic: `event.address` is
// recorded as the position's `locker`, and CTO events are attributed to a LaunchStack by loading
// the linked Token and reading its own `stack` field, rather than hardcoding either locker's
// address — see LockerPosition/CtoTransfer in schema.graphql.
import {
  PositionRegistered,
  FeesClaimed,
  FeesBurned,
  BurnToggled,
  TokenCTO,
  CTOApplied,
} from "../generated/BlitzrLockerV3/BlitzrLocker";
import { LockerPosition, FeeClaim, CtoTransfer, CtoApplication, Token } from "../generated/schema";
import { bytesFromAddress, ZERO_BI } from "./utils/constants";

export function handlePositionRegistered(event: PositionRegistered): void {
  let id = bytesFromAddress(event.params.token);
  let position = new LockerPosition(id);
  position.token = id;
  position.locker = bytesFromAddress(event.address);
  position.tokenId = event.params.tokenId;
  position.feeWallet = bytesFromAddress(event.params.feeWallet);
  position.pool = bytesFromAddress(event.params.pool);
  position.positionManager = bytesFromAddress(event.params.positionManager);
  position.burnEnabled = false;
  position.cumulativeCreator0 = ZERO_BI;
  position.cumulativeCreator1 = ZERO_BI;
  position.cumulativePlatform0 = ZERO_BI;
  position.cumulativePlatform1 = ZERO_BI;
  position.cumulativeBurned0 = ZERO_BI;
  position.cumulativeBurned1 = ZERO_BI;
  position.save();

  let token = Token.load(id);
  if (token != null) {
    token.feeWallet = bytesFromAddress(event.params.feeWallet);
    token.lockerPosition = id;
    token.save();
  }
}

export function handleFeesClaimed(event: FeesClaimed): void {
  let id = bytesFromAddress(event.params.token);
  let position = LockerPosition.load(id);
  if (position == null) return;

  position.cumulativeCreator0 = position.cumulativeCreator0.plus(event.params.creator0);
  position.cumulativeCreator1 = position.cumulativeCreator1.plus(event.params.creator1);
  position.cumulativePlatform0 = position.cumulativePlatform0.plus(event.params.platform0);
  position.cumulativePlatform1 = position.cumulativePlatform1.plus(event.params.platform1);
  position.save();

  let claimId = event.transaction.hash.concatI32(event.logIndex.toI32());
  let claim = new FeeClaim(claimId);
  claim.position = id;
  claim.feeWallet = bytesFromAddress(event.params.feeWallet);
  claim.creator0 = event.params.creator0;
  claim.creator1 = event.params.creator1;
  claim.platform0 = event.params.platform0;
  claim.platform1 = event.params.platform1;
  claim.timestamp = event.block.timestamp;
  claim.block = event.block.number;
  claim.tx = event.transaction.hash;
  claim.save();
}

export function handleFeesBurned(event: FeesBurned): void {
  let id = bytesFromAddress(event.params.token);
  let position = LockerPosition.load(id);
  if (position == null) return;

  position.cumulativeBurned0 = position.cumulativeBurned0.plus(event.params.amount0);
  position.cumulativeBurned1 = position.cumulativeBurned1.plus(event.params.amount1);
  position.save();
}

export function handleBurnToggled(event: BurnToggled): void {
  let id = bytesFromAddress(event.params.token);
  let position = LockerPosition.load(id);
  if (position == null) return;

  position.burnEnabled = event.params.enabled;
  position.save();
}

export function handleTokenCTO(event: TokenCTO): void {
  let tokenId = bytesFromAddress(event.params.token);
  let token = Token.load(tokenId);

  let id = event.transaction.hash.concatI32(event.logIndex.toI32());
  let cto = new CtoTransfer(id);
  cto.token = tokenId;
  cto.source = token == null ? "BLITZR_V3" : token.stack;
  cto.oldFeeWallet = bytesFromAddress(event.params.oldFeeWallet);
  cto.newFeeWallet = bytesFromAddress(event.params.newFeeWallet);
  cto.timestamp = event.block.timestamp;
  cto.block = event.block.number;
  cto.tx = event.transaction.hash;
  cto.save();

  let position = LockerPosition.load(tokenId);
  if (position != null) {
    position.feeWallet = bytesFromAddress(event.params.newFeeWallet);
    position.save();
  }
}

export function handleCTOApplied(event: CTOApplied): void {
  let tokenId = bytesFromAddress(event.params.token);
  let token = Token.load(tokenId);

  let id = event.transaction.hash.concatI32(event.logIndex.toI32());
  let application = new CtoApplication(id);
  application.token = tokenId;
  application.source = token == null ? "BLITZR_V3" : token.stack;
  application.applicant = bytesFromAddress(event.params.applicant);
  application.proposedFeeWallet = bytesFromAddress(event.params.proposedFeeWallet);
  application.feePaid = event.params.feePaid;
  application.timestamp = event.block.timestamp;
  application.block = event.block.number;
  application.tx = event.transaction.hash;
  application.save();
}
