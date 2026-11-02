import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // dsh-plugin 是给浏览器直接加载的经典脚本（自注册 CJS 工厂，按约定不能出现 ESM
    // 语法），不属于 Next 应用，所以 Next 那套模块规则对它不适用。
    "dsh-plugin/**",
  ]),
]);

export default eslintConfig;
