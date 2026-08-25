import coreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

const eslintConfig = [
  {
    ignores: ['.next/', 'node_modules/', 'out/', 'coverage/', 'next-env.d.ts'],
  },
  ...coreWebVitals,
  ...nextTypescript,
];

export default eslintConfig;
