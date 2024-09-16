import fs from "fs";
import { bytesToInt } from "@nomicfoundation/ethereumjs-util";

import { keccak256 } from "../src/internal/util/keccak";

function capitalize(s: string): string {
  return s.length === 0 ? "" : s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Generates all permutations of the given length and number of different
 * elements as an iterator of 0-based indices.
 */
function* genPermutations(elemCount: number, len: number) {
  // We can think of a permutation as a number of base `elemCount`, i.e.
  // each 'digit' is a number between 0 and `elemCount - 1`.
  // Then, to generate all permutations, we simply need to linearly iterate
  // from 0 to max number of permutations (elemCount ** len) and convert
  // each number to a list of digits as per the base `elemCount`, see above.
  const numberOfPermutations = elemCount ** len;
  // Pre-compute the base `elemCount` dividers ([1, elemCount, elemCount ** 2, ...])
  const dividers = Array(elemCount)
    .fill(0)
    .map((_, i) => elemCount ** i);

  for (let number = 0; number < numberOfPermutations; number++) {
    const params = Array(len)
      .fill(0)
      .map((_, i) => Math.floor(number / dividers[i]) % elemCount);
    // Reverse, so that we keep the natural big-endian ordering, i.e.
    // [0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], ...
    params.reverse();

    yield params;
  }
}

type TypeName = { type: string; modifier?: "memory" };
type FnParam = TypeName & { name: string };

/** Computes the function selector for the given function with simple arguments. */
function selector({ name = "log", params = [] as TypeName[] }) {
  const sig = params.map((p) => p.type).join(",");
  return keccak256(Buffer.from(`${name}(${sig})`)).slice(0, 4);
}

/** The types for which we generate `logUint`, `logString`, etc. */
const SINGLE_TYPES = [
  { type: "int256" },
  { type: "uint256" },
  { type: "string", modifier: "memory" },
  { type: "bool" },
  { type: "address" },
  { type: "bytes", modifier: "memory" },
  ...Array.from({ length: 32 }, (_, i) => ({ type: `bytes${i + 1}` })),
] as const;

/** The types for which we generate a `log` function with all possible
 combinations of up to 4 arguments. */
const TYPES = [
  { type: "uint256" },
  { type: "string", modifier: "memory" },
  { type: "bool" },
  { type: "address" },
] as const;

let consoleSolFile = `// SPDX-License-Identifier: MIT
pragma solidity >=0.4.22 <0.9.0;

library console {
    address constant CONSOLE_ADDRESS =
        0x000000000000000000636F6e736F6c652e6c6f67;

    function _sendLogPayloadImplementation(bytes memory payload) internal view {
        address consoleAddress = CONSOLE_ADDRESS;
        /// @solidity memory-safe-assembly
        assembly {
            pop(
                staticcall(
                    gas(),
                    consoleAddress,
                    add(payload, 32),
                    mload(payload),
                    0,
                    0
                )
            )
        }
    }

    function _castToPure(
      function(bytes memory) internal view fnIn
    ) internal pure returns (function(bytes memory) pure fnOut) {
        assembly {
            fnOut := fnIn
        }
    }

    function _sendLogPayload(bytes memory payload) internal pure {
        _castToPure(_sendLogPayloadImplementation)(payload);
    }

    function log() internal pure {
        _sendLogPayload(abi.encodeWithSignature("log()"));
    }
`;

function renderLogFunction({ name = "log", params = [] as FnParam[] }): string {
  let fnParams = params
    .map((p) => `${p.type}${p.modifier ? ` ${p.modifier}` : ""} ${p.name}`)
    .join(", ");
  let sig = params.map((p) => p.type).join(",");
  let passed = params.map((p) => p.name).join(", ");

  return `    function ${name}(${fnParams}) internal pure {
        _sendLogPayload(abi.encodeWithSignature("log(${sig})", ${passed}));
    }

`;
}

let logger =
  "// ------------------------------------\n" +
  "// This code was autogenerated using\n" +
  "// scripts/console-library-generator.ts\n" +
  "// ------------------------------------\n\n";

for (let i = 0; i < SINGLE_TYPES.length; i++) {
  const type = capitalize(SINGLE_TYPES[i].type);

  logger += `export const ${type}Ty = "${type}";\n`;
}

logger +=
  "\n/** Maps from a 4-byte function selector to a signature (argument types) */\n" +
  "export const CONSOLE_LOG_SIGNATURES: Record<number, string[]> = {\n";

/** Maps from a 4-byte function selector to a signature (argument types) */
const CONSOLE_LOG_SIGNATURES: Map<number, string[]> = new Map();

// Add the empty log() first
const sigInt = bytesToInt(selector({ name: "log", params: [] }));
CONSOLE_LOG_SIGNATURES.set(sigInt, []);

// Generate single parameter functions that are type-suffixed for
// backwards-compatibility, e.g. logInt, logUint, logString, etc.
for (let i = 0; i < SINGLE_TYPES.length; i++) {
  const param = { ...SINGLE_TYPES[i], name: "p0" } as const;

  const typeAliased = param.type.replace("int256", "int");
  const nameSuffix = capitalize(typeAliased);

  const signature = bytesToInt(selector({ name: "log", params: [param] }));
  CONSOLE_LOG_SIGNATURES.set(signature, [param.type]);

  // For full backwards compatibility, also support the (invalid) selectors of
  // `log(int)` and `log(uint)`. The selector encoding specifies that one has to
  // use the canonical type name but it seems that we supported it in the past.
  if (["uint256", "int256"].includes(param.type)) {
    const signature = bytesToInt(
      selector({ name: "log", params: [{ type: typeAliased }] })
    );
    CONSOLE_LOG_SIGNATURES.set(signature, [param.type]);
  }

  consoleSolFile += renderLogFunction({
    name: `log${nameSuffix}`,
    params: [param],
  });
}

// Now generate the function definitions for `log` for permutations of
// up to 4 parameters using the `types` (uint256, string, bool, address).
const MAX_NUMBER_OF_PARAMETERS = 4;
for (let paramCount = 0; paramCount < MAX_NUMBER_OF_PARAMETERS; paramCount++) {
  for (const permutation of genPermutations(TYPES.length, paramCount + 1)) {
    const params = permutation.map(
      (typeIndex, i) => ({ ...TYPES[typeIndex], name: `p${i}` } as const)
    );

    consoleSolFile += renderLogFunction({ params });

    const types = params.map((p) => p.type);
    const signature = bytesToInt(selector({ name: "log", params }));
    CONSOLE_LOG_SIGNATURES.set(signature, types);

    // Again, for full backwards compatibility, also support the (invalid)
    // selectors that contain the `int`/`uint` aliases in the selector calculation.
    if (params.some((p) => ["uint256", "int256"].includes(p.type))) {
      const aliased = params.map((p) => ({
        ...p,
        type: p.type.replace("int256", "int"),
      }));

      const signature = bytesToInt(selector({ name: "log", params: aliased }));
      CONSOLE_LOG_SIGNATURES.set(signature, types);
    }
  }
}

for (const [sig, types] of CONSOLE_LOG_SIGNATURES) {
  const typeNames = types.map((t) => `${capitalize(t)}Ty`).join(", ");
  logger += `  ${sig}: [${typeNames}],\n`;
}

consoleSolFile += "}\n";
logger += "};\n";

fs.writeFileSync(
  __dirname + "/../src/internal/hardhat-network/stack-traces/logger.ts",
  logger
);
fs.writeFileSync(__dirname + "/../console.sol", consoleSolFile);
