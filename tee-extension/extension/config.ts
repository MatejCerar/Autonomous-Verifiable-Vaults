/**
 * ★ Configuration: version and operation identifiers.
 *
 * Mirrors go/internal/config/config.go. The op-type and op-command strings MUST
 * match the bytes32 constants in contracts/InstructionSender.sol exactly, or
 * actions fall through to "unsupported op type".
 */

export const VERSION = "0.1.0";

export const OP_TYPE_GREETING = "GREETING";
export const OP_COMMAND_SAY_HELLO = "SAY_HELLO";
export const OP_COMMAND_SAY_GOODBYE = "SAY_GOODBYE";

// AVV allocation extension. bytes32("CURATION") / bytes32("CYCLE"), same
// string->bytes32 scheme as the GREETING constants above. These MUST match the
// OP_TYPE_CURATION / OP_COMMAND_CYCLE constants in InstructionSender.sol and the
// CURATION_OPTYPE / CURATION_OPCOMMAND pins in the frontend's src/tee.config.ts:
//   CURATION = 0x4355524154494f4e0000...  CYCLE = 0x4359434c45000000...
export const OP_TYPE_CURATION = "CURATION";
export const OP_COMMAND_CYCLE = "CYCLE";
