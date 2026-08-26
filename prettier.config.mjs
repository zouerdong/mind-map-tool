/** @type {import("prettier").Config} */
export default {
  printWidth: 100,
  semi: true,
  singleQuote: false,
  trailingComma: "all",
  overrides: [
    {
      files: ["*.md", "*.json", "*.yaml", "*.yml"],
      options: { proseWrap: "preserve" },
    },
  ],
};
