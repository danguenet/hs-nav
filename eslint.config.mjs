const browserGlobals = Object.fromEntries([
  "Blob", "URL", "addEventListener", "clearTimeout", "confirm", "console", "document", "fetch", "location",
  "navigator", "requestAnimationFrame", "setTimeout"
].map((name) => [name, "readonly"]));

const nodeGlobals = Object.fromEntries([
  "Buffer", "URL", "console", "process", "structuredClone", "setTimeout", "clearTimeout"
].map((name) => [name, "readonly"]));

export default [
  { ignores: ["dist/**", "node_modules/**", "output/**"] },
  {
    files: ["src/**/*.mjs", "preview/**/*.mjs"],
    languageOptions: { ecmaVersion: "latest", sourceType: "module", globals: browserGlobals },
    rules: qualityRules()
  },
  {
    files: ["scripts/**/*.mjs", "test/**/*.mjs"],
    languageOptions: { ecmaVersion: "latest", sourceType: "module", globals: nodeGlobals },
    rules: qualityRules()
  }
];

function qualityRules() {
  return {
    "constructor-super": "error",
    "for-direction": "error",
    "getter-return": "error",
    "no-async-promise-executor": "error",
    "no-constant-binary-expression": "error",
    "no-debugger": "error",
    "no-dupe-args": "error",
    "no-dupe-class-members": "error",
    "no-dupe-else-if": "error",
    "no-dupe-keys": "error",
    "no-func-assign": "error",
    "no-import-assign": "error",
    "no-loss-of-precision": "error",
    "no-new-native-nonconstructor": "error",
    "no-obj-calls": "error",
    "no-promise-executor-return": "error",
    "no-self-assign": "error",
    "no-setter-return": "error",
    "no-sparse-arrays": "error",
    "no-unexpected-multiline": "error",
    "no-unreachable": "error",
    "no-unreachable-loop": "error",
    "no-unsafe-finally": "error",
    "no-unsafe-negation": "error",
    "no-unused-private-class-members": "error",
    "no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrors: "none" }],
    "no-useless-assignment": "error",
    "no-useless-backreference": "error",
    "use-isnan": "error",
    "valid-typeof": "error"
  };
}
