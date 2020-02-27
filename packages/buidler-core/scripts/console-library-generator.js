const fs = require('fs');
const eutil = require('ethereumjs-util');

const functionPrefix =
  "\tfunction";
const functionBody = ") internal view {" +
  "\n\t\t(bool ignored, ) = CONSOLE_ADDRESS.staticcall(abi.encodeWithSignature(\"log(";
const functionSuffix = "));" +
  "\n\t\tignored;" +
  "\n\t}" +
  "\n" +
  "\n";

let logger = "// ------------------------------------\n" +
  "// This code was autogenerated using\n" +
  "// scripts/console-library-generator.js\n" +
  "// ------------------------------------\n\n";

const singleTypes = ["int", "uint", "string memory", "bool", "address", "bytes memory", "byte"];
for (let i = 0; i < singleTypes.length; i++) {
  const singleType = singleTypes[i].replace(" memory", "");
  const type = singleType.charAt(0).toUpperCase() + singleType.slice(1);
  logger += "export const " + type + "Ty = \"" + type + "\";\n"
}

const offset = singleTypes.length - 1;
for (let i = 1; i <= 32; i++) {
  singleTypes[offset + i] = "bytes" + i.toString();
  logger += "export const Bytes" + i.toString() + "Ty = \"Bytes" + i.toString() + "\";\n";
}

const types = ["uint", "string memory", "bool", "address"];

let consoleSolFIle = "pragma solidity >= 0.5.0 <0.7.0;" +
  "\n" +
  "\n" +
  "library console {" +
  "\n" +
    "\taddress constant CONSOLE_ADDRESS = address(0x000000000000000000636F6e736F6c652e6c6f67);" +
  "\n" +
  "\n" +
  "\tfunction log() internal view {\n" +
  "\t\t(bool ignored, ) = CONSOLE_ADDRESS.staticcall(abi.encodeWithSignature(\"log()\"));\n" +
  "\t\tignored;\n" +
  "\t}";

logger += "\n// In order to optimize map lookup\n" +
  "// we'll store 4byte signature as int\n" +
  "export const ConsoleLogs = {\n";


// Add the empty log() first
const sigInt = eutil.bufferToInt(eutil.keccak256("log" + "()").slice(0, 4));
logger += "  " + sigInt + ": [],\n";

for (let i = 0; i < singleTypes.length; i++) {
  const type = singleTypes[i].replace(" memory", "");
  const nameSuffix = type.charAt(0).toUpperCase() + type.slice(1);
  
  const sigInt = eutil.bufferToInt(eutil.keccak256("log" + "(" + type + ")").slice(0, 4));
  logger += "  " + sigInt + ": [" + type.charAt(0).toUpperCase() + type.slice(1) + "Ty],\n";
  
  consoleSolFIle +=
    functionPrefix + " log" + nameSuffix + 
    "(" + singleTypes[i] + " p0"+
    functionBody +
    type + ')", ' +
    "p0" +
    functionSuffix
}

const maxNumberOfParameters = 4;
const numberOfPermutations = {};
const dividers = {};
const paramsNames = {};

for (let i = 0; i < maxNumberOfParameters; i++) {
  dividers[i] = Math.pow(maxNumberOfParameters, i);
  numberOfPermutations[i] = Math.pow(maxNumberOfParameters, i + 1);

  paramsNames[i] = [];
  for (let j = 0; j <= i; j++) {
    paramsNames[i][j] = "p" + j.toString()
  }
}

for (let i = 0; i < maxNumberOfParameters; i++) {
  for (let j = 0; j < numberOfPermutations[i]; j++) {
    const params = [];

    for (let k = 0; k <= i; k++) {
      params.push(types[Math.floor(j / dividers[k]) % types.length])
    }
    params.reverse();

    let sigParams = [];
    let constParams = [];
    
    let input = "";
    let internalParamsNames = [];
    for (let k = 0; k <= i; k++) {
      input += params[k] + " " + paramsNames[i][k] + ", ";
      internalParamsNames.push(paramsNames[i][k]);
      
      let param = params[k].replace(" memory", ""); 
      sigParams.push(param);
      constParams.push(param.charAt(0).toUpperCase() + param.slice(1) + "Ty")
    }

    consoleSolFIle +=
      functionPrefix + ' log(' +
      input.substr(0, input.length - 2) +
      functionBody +
      sigParams.join(",") + ')", ' +
      internalParamsNames.join(", ") +
      functionSuffix;

    if (sigParams.length !== 1) {
      const sigInt = eutil.bufferToInt(eutil.keccak256("log(" + sigParams.join(",") + ")").slice(0, 4));
      logger += "  " + sigInt + ": [" + constParams.join(", ") + "],\n";
    }
  }
}

consoleSolFIle += "}\n";
logger = logger.slice(0, logger.length - 2) + logger.slice(logger.length - 1) + "};\n";

fs.writeFileSync(__dirname + "/../src/internal/buidler-evm/stack-traces/logger.ts", logger);
fs.writeFileSync(__dirname + "/../console.sol", consoleSolFIle);
