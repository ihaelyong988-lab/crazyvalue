import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      // serwist 빌드 생성물 — 압축 코드라 no-this-alias로 항상 error를 내 `npm run lint`가
      // 늘 실패했다(gitignore 대상이고 원본은 src/app/sw.ts다). 린트는 우리가 쓴 코드만 본다.
      "public/sw.js",
      "public/sw.js.map",
      "public/swe-worker-*.js",
      "public/swe-worker-*.js.map",
    ],
  },
];

export default eslintConfig;
