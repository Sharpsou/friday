import { defineConfig } from 'tsup';

export default defineConfig({
  noExternal: ['@friday/assistant-core'],
});
