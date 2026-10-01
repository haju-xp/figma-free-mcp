module.exports = {
  testEnvironment: "node",
  transform: { "^.+\\.ts$": ["ts-jest", { tsconfig: { module: "commonjs", esModuleInterop: true, isolatedModules: true } }] },
  testMatch: ["**/__tests__/**/*.test.ts"],
};
